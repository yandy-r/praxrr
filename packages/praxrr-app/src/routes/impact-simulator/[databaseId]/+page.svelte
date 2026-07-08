<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { Film, Tv, Link, Shield, Play, Eraser, AlertTriangle } from 'lucide-svelte';
  import Button from '$ui/button/Button.svelte';
  import Tabs from '$ui/navigation/tabs/Tabs.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import { alertStore } from '$lib/client/alerts/store';
  import { current, initEdit, update, clear } from '$lib/client/stores/dirty';
  import ProposedChangesEditor from './components/ProposedChangesEditor.svelte';
  import ImpactResults from './components/ImpactResults.svelte';
  import ConfigDiffPanel from './components/ConfigDiffPanel.svelte';
  import CascadePanel from './components/CascadePanel.svelte';
  import SkippedChangesPanel from './components/SkippedChangesPanel.svelte';
  import { parseReleaseTitles, type ImpactArrType, type ImpactProfileOption } from './helpers.ts';
  import { copyShareLink, parseUrlState, type ImpactUrlState, type ShareLinkMode } from './urlState.ts';
  import type { PageData } from './$types';
  import type { components } from '$api/v1.d.ts';

  type SimulateImpactResponse = components['schemas']['SimulateImpactResponse'];
  type ProposedChange = components['schemas']['ProposedChange'];

  export let data: PageData;

  const SIMULATION_REQUEST_TIMEOUT_MS = 15000;
  const MAX_PROFILES = 10;

  let releaseRawText = '';
  let arrType: ImpactArrType = 'radarr';
  let selectedProfileValues: string[] = [];
  let result: SimulateImpactResponse | null = null;
  let isSimulating = false;
  let simulationRequestToken = 0;
  let activeAbortController: AbortController | null = null;
  let parserAvailable = data.parserAvailable;
  let parserHealthInterval: ReturnType<typeof setInterval> | null = null;

  $: tabs = data.databases.map((db) => ({
    label: db.name,
    href: `/impact-simulator/${db.id}`,
    active: db.id === data.currentDatabase.id,
  }));

  $: profileOptions = data.qualityProfiles as ImpactProfileOption[];
  $: selectedProfiles = profileOptions.filter((profile) => selectedProfileValues.includes(profile.value));
  $: proposedChanges = ($current.proposedChanges ?? []) as ProposedChange[];
  $: releases = parseReleaseTitles(releaseRawText, arrType);
  $: canSimulate = releases.length > 0 && selectedProfileValues.length > 0 && !isSimulating;

  onMount(() => {
    if (!browser) return;

    const urlState = parseUrlState($page.url.searchParams);

    if (urlState.arrType) {
      arrType = urlState.arrType;
    }

    if (urlState.releases && urlState.releases.length > 0) {
      releaseRawText = urlState.releases.join('\n');
    }

    if (urlState.profileNames && urlState.profileNames.length > 0) {
      const known = urlState.profileNames.filter((value) => profileOptions.some((profile) => profile.value === value));
      if (known.length !== urlState.profileNames.length) {
        alertStore.add('warning', 'Some profiles from the URL are not available in this database.');
      }
      selectedProfileValues = known.slice(0, MAX_PROFILES);
    }

    // Only keep changes that target a currently-selected editable profile.
    const editableNames = new Set(
      selectedProfiles.filter((profile) => profile.editable).map((profile) => profile.name)
    );
    const hydratedChanges = (urlState.proposedChanges ?? []).filter((change) => editableNames.has(change.profileName));
    initEdit({ proposedChanges: hydratedChanges });

    if (!parserAvailable) {
      alertStore.add('warning', 'Release scoring needs the parser service, which is currently unavailable.', 0);
    }

    const initialize = async () => {
      await refreshParserAvailability();
      if (releases.length > 0 && selectedProfileValues.length > 0) {
        await simulate();
      }

      parserHealthInterval = setInterval(() => {
        if (!parserAvailable) {
          void refreshParserAvailability();
        }
      }, 3000);
    };
    void initialize();
  });

  onDestroy(() => {
    cancelSimulationRequest();
    if (parserHealthInterval) {
      clearInterval(parserHealthInterval);
      parserHealthInterval = null;
    }
    clear();
  });

  function createSimulationRequestContext(): {
    requestToken: number;
    abortController: AbortController;
    timeout: ReturnType<typeof setTimeout>;
  } {
    cancelSimulationRequest();
    const requestToken = ++simulationRequestToken;
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, SIMULATION_REQUEST_TIMEOUT_MS);

    activeAbortController = abortController;
    isSimulating = true;

    return { requestToken, abortController, timeout };
  }

  function cancelSimulationRequest() {
    if (!activeAbortController) {
      return;
    }

    activeAbortController.abort();
    activeAbortController = null;
  }

  function finalizeSimulationRequest(
    requestToken: number,
    abortController: AbortController,
    timeout: ReturnType<typeof setTimeout>
  ) {
    clearTimeout(timeout);
    if (activeAbortController === abortController) {
      activeAbortController = null;
    }

    if (requestToken === simulationRequestToken) {
      isSimulating = false;
    }
  }

  async function simulate() {
    const releaseInputs = parseReleaseTitles(releaseRawText, arrType);
    const profileNames = [...selectedProfileValues];
    const changes = (get(current).proposedChanges ?? []) as ProposedChange[];

    if (releaseInputs.length === 0 || profileNames.length === 0) {
      alertStore.add('warning', 'Add at least one release title and select a quality profile.');
      return;
    }

    const { requestToken, abortController, timeout } = createSimulationRequestContext();

    try {
      const response = await fetch('/api/v1/simulate/impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          databaseId: data.currentDatabase.id,
          arrType,
          releases: releaseInputs,
          profileNames,
          proposedChanges: changes,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody?.error ?? `Simulation failed (HTTP ${response.status})`;
        throw new Error(message);
      }

      const payload = (await response.json()) as SimulateImpactResponse;
      if (requestToken !== simulationRequestToken) {
        return;
      }

      parserAvailable = payload.parserAvailable;
      result = payload;
    } catch (err) {
      if (requestToken !== simulationRequestToken) {
        return;
      }

      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }

      console.error('Impact simulation failed:', err);
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to run impact simulation.');
    } finally {
      finalizeSimulationRequest(requestToken, abortController, timeout);
    }
  }

  async function refreshParserAvailability() {
    try {
      const response = await fetch('/api/v1/parser/health');
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { parserAvailable?: boolean };
      if (typeof payload.parserAvailable === 'boolean') {
        parserAvailable = payload.parserAvailable;
      }
    } catch (err) {
      console.debug('Parser health check failed:', err);
    }
  }

  function setArrType(next: ImpactArrType) {
    arrType = next;
  }

  function toggleProfile(value: string) {
    if (selectedProfileValues.includes(value)) {
      selectedProfileValues = selectedProfileValues.filter((entry) => entry !== value);
      const removed = profileOptions.find((profile) => profile.value === value);
      if (removed) {
        const next = proposedChanges.filter((change) => change.profileName !== removed.name);
        if (next.length !== proposedChanges.length) {
          update('proposedChanges', next);
        }
      }
      return;
    }

    if (selectedProfileValues.length >= MAX_PROFILES) {
      alertStore.add('warning', `You can select at most ${MAX_PROFILES} profiles.`);
      return;
    }

    selectedProfileValues = [...selectedProfileValues, value];
  }

  function handleEditorChange(event: CustomEvent<{ changes: ProposedChange[] }>) {
    update('proposedChanges', event.detail.changes);
  }

  function buildShareState(): ImpactUrlState {
    return {
      arrType,
      profileNames: selectedProfileValues,
      releases: releases.map((release) => release.title),
      proposedChanges,
    };
  }

  async function handleCopyLink(mode: ShareLinkMode) {
    const copyLabel = mode === 'safe' ? 'Safe link' : 'Full link';
    try {
      const { success, truncated } = await copyShareLink(
        buildShareState(),
        `${window.location.origin}${$page.url.pathname}`,
        { mode }
      );

      if (!success) {
        alertStore.add('info', 'Could not copy to clipboard. Copy the URL from the address bar.');
        return;
      }

      if (truncated) {
        alertStore.add('warning', `${copyLabel} copied. Some state was omitted to fit URL limits.`);
        return;
      }

      alertStore.add('success', `${copyLabel} copied to clipboard.`);
    } catch {
      alertStore.add('error', `Failed to generate ${copyLabel.toLowerCase()}.`);
    }
  }

  function clearAll() {
    cancelSimulationRequest();
    releaseRawText = '';
    arrType = 'radarr';
    selectedProfileValues = [];
    result = null;
    isSimulating = false;
    update('proposedChanges', []);
  }
</script>

<svelte:head>
  <title>Impact Simulator - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <Tabs {tabs} responsive />
    <div class="flex items-center gap-2">
      <Button text="Copy Full Link" variant="secondary" size="xs" icon={Link} on:click={() => handleCopyLink('full')} />
      <Button
        text="Copy Safe Link"
        variant="secondary"
        size="xs"
        icon={Shield}
        on:click={() => handleCopyLink('safe')}
      />
    </div>
  </div>

  {#if !parserAvailable}
    <div
      class="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <AlertTriangle size={16} />
      <span
        >Parser service unavailable — release scoring is disabled. Config diff and cascade results are still shown.</span
      >
    </div>
  {/if}

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
    <div class="min-w-0 space-y-4">
      <!-- Arr type -->
      <div class="space-y-1.5">
        <p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Arr Type</p>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {arrType ===
            'radarr'
              ? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
              : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
            on:click={() => setArrType('radarr')}
          >
            <Film size={14} />
            Radarr (movie)
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {arrType ===
            'sonarr'
              ? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
              : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
            on:click={() => setArrType('sonarr')}
          >
            <Tv size={14} />
            Sonarr (series)
          </button>
        </div>
      </div>

      <!-- Release titles -->
      <div class="space-y-1.5">
        <label for="impact-release-titles" class="text-xs font-medium text-neutral-700 dark:text-neutral-300">
          Release Titles ({releases.length}/50)
        </label>
        <textarea
          id="impact-release-titles"
          rows="5"
          bind:value={releaseRawText}
          placeholder="One release title per line…"
          class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-neutral-900 focus:border-accent-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        ></textarea>
      </div>

      <!-- Profiles -->
      <div class="space-y-1.5">
        <p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">
          Quality Profiles ({selectedProfileValues.length}/{MAX_PROFILES})
        </p>
        <div
          class="max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700"
        >
          {#if profileOptions.length === 0}
            <p class="px-1 py-2 text-xs text-neutral-500 dark:text-neutral-400">No quality profiles available.</p>
          {:else}
            {#each profileOptions as profile (profile.value)}
              <label
                class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <input
                  type="checkbox"
                  checked={selectedProfileValues.includes(profile.value)}
                  on:change={() => toggleProfile(profile.value)}
                />
                <span class="flex-1 truncate" title={profile.displayName}>{profile.displayName}</span>
                {#if !profile.editable}
                  <Badge variant="trash" size="sm">TRaSH</Badge>
                {/if}
              </label>
            {/each}
          {/if}
        </div>
      </div>

      <ProposedChangesEditor
        profiles={selectedProfiles}
        customFormats={data.customFormats}
        changes={proposedChanges}
        on:change={handleEditorChange}
      />

      <div class="flex items-center gap-2">
        <Button
          text={isSimulating ? 'Simulating…' : 'Simulate'}
          variant="primary"
          size="sm"
          icon={Play}
          disabled={!canSimulate}
          on:click={() => void simulate()}
        />
        <Button text="Clear" variant="ghost" size="sm" icon={Eraser} on:click={clearAll} />
      </div>
    </div>

    <div class="min-w-0 space-y-4">
      <ImpactResults releaseImpacts={result?.releaseImpacts ?? []} {parserAvailable} {isSimulating} />
      <ConfigDiffPanel configDiff={result?.configDiff ?? []} />
      <CascadePanel cascade={result?.cascade ?? []} />
      <SkippedChangesPanel skipped={result?.skippedChanges ?? []} />
    </div>
  </div>
</div>

<DirtyModal />
