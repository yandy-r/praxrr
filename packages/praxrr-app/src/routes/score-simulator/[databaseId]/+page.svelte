<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import Tabs from '$ui/navigation/tabs/Tabs.svelte';
  import { alertStore } from '$lib/client/alerts/store';
  import { getSelectedProfileScore } from './helpers';
  import ReleaseInput from './components/ReleaseInput.svelte';
  import SimulationResults from './components/SimulationResults.svelte';
  import ScoreBreakdown from './components/ScoreBreakdown.svelte';
  import type { PageData } from './$types';
  import type { components } from '$api/v1.d.ts';

  type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];
  type SimulateProfileScore = components['schemas']['SimulateProfileScore'];
  type MediaType = components['schemas']['MediaType'];
  type ArrType = components['schemas']['SimulateScoreRequest']['arrType'];
  interface SimulatorProfileOption {
    id: number;
    name: string;
    value: string;
    displayName: string;
  }

  export let data: PageData;

  const databaseStorageKey = 'scoreSimulatorDatabase';
  const titleStorageKey = 'scoreSimulator.lastTitle';
  const profileStorageKey = 'scoreSimulator.lastProfileName';

  let releaseTitle = '';
  let mediaType: MediaType = 'movie';
  let selectedProfileName: string | null = null;
  let simulationResult: SimulateScoreResponse | null = null;
  let isSimulating = false;
  let simulationRequestToken = 0;
  let parserAvailable = data.parserAvailable;
  let parserHealthInterval: ReturnType<typeof setInterval> | null = null;
  let mounted = false;

  $: tabs = data.databases.map((db) => ({
    label: db.name,
    href: `/score-simulator/${db.id}`,
    active: db.id === data.currentDatabase.id,
  }));

  $: qualityProfileOptions = (
    data.qualityProfiles as Array<{
      id: number;
      name: string;
      value?: string;
      displayName?: string;
    }>
  ).map(
    (profile): SimulatorProfileOption => ({
      id: profile.id,
      name: profile.name,
      value: profile.value ?? `pcd:${encodeURIComponent(profile.name)}`,
      displayName: profile.displayName ?? profile.name,
    })
  );
  $: selectedProfileLabel =
    selectedProfileName === null
      ? null
      : (qualityProfileOptions.find((profile) => profile.value === selectedProfileName)?.displayName ??
        selectedProfileName);

  $: selectedProfileScore = getSelectedProfileScore(simulationResult, selectedProfileName);

  onMount(() => {
    if (!browser) return;

    localStorage.setItem(databaseStorageKey, String(data.currentDatabase.id));

    if (!parserAvailable) {
      alertStore.add('warning', 'Parser service unavailable...', 0);
    }

    const initialize = async () => {
      await restorePersistedState();
      mounted = true;
      await refreshParserAvailability();
      await simulate();

      parserHealthInterval = setInterval(() => {
        if (!parserAvailable) {
          void refreshParserAvailability();
        }
      }, 3000);
    };
    void initialize();
  });

  onDestroy(() => {
    if (parserHealthInterval) {
      clearInterval(parserHealthInterval);
      parserHealthInterval = null;
    }
  });

  $: if (browser && mounted) {
    localStorage.setItem(databaseStorageKey, String(data.currentDatabase.id));
    localStorage.setItem(titleStorageKey, releaseTitle);

    if (selectedProfileName) {
      localStorage.setItem(profileStorageKey, selectedProfileName);
    } else {
      localStorage.removeItem(profileStorageKey);
    }
  }

  async function simulate() {
    const title = releaseTitle.trim();
    if (!title || !selectedProfileName) {
      simulationResult = null;
      return;
    }

    const requestToken = ++simulationRequestToken;
    isSimulating = true;
    const arrType: ArrType = mediaType === 'movie' ? 'radarr' : 'sonarr';

    try {
      const response = await fetch('/api/v1/simulate/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId: data.currentDatabase.id,
          releases: [{ id: generateReleaseId(), title, type: mediaType }],
          profileNames: [selectedProfileName],
          arrType,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody?.error ?? `Simulation failed (HTTP ${response.status})`;
        throw new Error(message);
      }

      const result = (await response.json()) as SimulateScoreResponse;
      if (requestToken !== simulationRequestToken) {
        return;
      }

      parserAvailable = result.parserAvailable;
      simulationResult = result;
    } catch (err) {
      if (requestToken !== simulationRequestToken) {
        return;
      }

      console.error('Score simulation failed:', err);
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to run score simulation.');
    } finally {
      if (requestToken === simulationRequestToken) {
        isSimulating = false;
      }
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
      // Keep current availability state and retry on interval.
    }
  }

  function generateReleaseId(): string {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }

    return `release-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function handleReleaseInput() {
    void simulate();
  }

  function handleProfileChange(event: CustomEvent<{ profileName: string | null }>) {
    selectedProfileName = event.detail.profileName;
    void simulate();
  }

  async function restorePersistedState() {
    const storedTitle = localStorage.getItem(titleStorageKey);
    if (storedTitle) {
      releaseTitle = storedTitle;
    }

    const storedProfileName = localStorage.getItem(profileStorageKey);
    if (storedProfileName && qualityProfileOptions.some((profile) => profile.value === storedProfileName)) {
      selectedProfileName = storedProfileName;
    }
  }
</script>

<svelte:head>
  <title>Score Simulator - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
  <Tabs {tabs} responsive />

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
    <div class="space-y-4">
      <ReleaseInput
        bind:title={releaseTitle}
        bind:mediaType
        bind:selectedProfileName
        qualityProfiles={qualityProfileOptions}
        {isSimulating}
        {parserAvailable}
        on:input={handleReleaseInput}
        on:profileChange={handleProfileChange}
      />

      <ScoreBreakdown profileScore={selectedProfileScore} />
    </div>

    <div>
      <SimulationResults result={simulationResult} {selectedProfileName} {selectedProfileLabel} {isSimulating} />
    </div>
  </div>
</div>
