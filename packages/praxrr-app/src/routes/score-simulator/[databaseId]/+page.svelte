<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import Tabs from '$ui/navigation/tabs/Tabs.svelte';
  import DisclosureSection from '$ui/form/DisclosureSection.svelte';
  import { SS_ADVANCED_OPTIONS } from '$shared/disclosure/sectionKeys.ts';
  import { alertStore } from '$lib/client/alerts/store';
  import {
    getSelectedProfileScore,
    parseBatchTitles,
    buildRankingFromResults,
    buildComparisonResult,
  } from './helpers';
  import type { ComparisonResult, RankedRelease } from './helpers';
  import ReleaseInput from './components/ReleaseInput.svelte';
  import SimulationResults from './components/SimulationResults.svelte';
  import ScoreBreakdown from './components/ScoreBreakdown.svelte';
  import BatchInput from './components/BatchInput.svelte';
  import PresetSelector from './components/PresetSelector.svelte';
  import ProfileComparison from './components/ProfileComparison.svelte';
  import ComparisonView from './components/ComparisonView.svelte';
  import RankingTable from './components/RankingTable.svelte';
  import type { PageData } from './$types';
  import type { components } from '$api/v1.d.ts';
  import type { PresetCategory } from './helpers';

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

  const SIMULATION_REQUEST_TIMEOUT_MS = 15000;

  let releaseTitle = '';
  let mediaType: MediaType = 'movie';
  let selectedProfileName: string | null = null;
  let singleSimulationResult: SimulateScoreResponse | null = null;
  let batchSimulationResult: SimulateScoreResponse | null = null;
  let isSimulatingSingle = false;
  let isSimulatingBatch = false;
  let singleSimulationRequestToken = 0;
  let batchSimulationRequestToken = 0;
  let activeSingleSimulationAbortController: AbortController | null = null;
  let activeBatchSimulationAbortController: AbortController | null = null;
  let parserAvailable = data.parserAvailable;
  let parserHealthInterval: ReturnType<typeof setInterval> | null = null;

  // Phase 2 state
  let batchRawText = '';
  let comparisonProfileName: string | null = null;
  let selectedReleaseId: string | null = null;

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

  $: comparisonProfileLabel =
    comparisonProfileName === null
      ? null
      : (qualityProfileOptions.find((profile) => profile.value === comparisonProfileName)?.displayName ??
        comparisonProfileName);

  $: selectedProfileScore = getSelectedProfileScore(singleSimulationResult, selectedProfileName);
  $: canClearMainSection =
    releaseTitle.trim().length > 0 ||
    mediaType !== 'movie' ||
    selectedProfileName !== null ||
    singleSimulationResult !== null;
  $: canClearAdvancedSection =
    batchRawText.trim().length > 0 ||
    comparisonProfileName !== null ||
    batchSimulationResult !== null;

  // Batch reactive state
  $: batchTitles = parseBatchTitles(batchRawText, mediaType);
  $: rankedReleases = batchSimulationResult
    ? buildRankingFromResults(batchSimulationResult.results, selectedProfileName ?? '')
    : ([] as RankedRelease[]);
  $: comparisonResult = comparisonProfileName && singleSimulationResult?.results?.[0] && selectedProfileName
    ? buildComparisonResult(singleSimulationResult.results[0], selectedProfileName, comparisonProfileName)
    : (null as ComparisonResult | null);
  $: profileNames = [selectedProfileName, comparisonProfileName].filter(
    (name): name is string => name !== null
  );

  onMount(() => {
    if (!browser) return;

    if (!parserAvailable) {
      alertStore.add('warning', 'Parser service unavailable...', 0);
    }

    const initialize = async () => {
      await refreshParserAvailability();
      await simulateSingle();

      parserHealthInterval = setInterval(() => {
        if (!parserAvailable) {
          void refreshParserAvailability();
        }
      }, 3000);
    };
    void initialize();
  });

  onDestroy(() => {
    cancelSingleSimulationRequest();
    cancelBatchSimulationRequest();
    if (parserHealthInterval) {
      clearInterval(parserHealthInterval);
      parserHealthInterval = null;
    }
  });

  async function simulateSingle() {
    const title = releaseTitle.trim();
    if (!title || !selectedProfileName) {
      cancelSingleSimulationRequest();
      isSimulatingSingle = false;
      singleSimulationResult = null;
      return;
    }

    const { requestToken, abortController, timeout } = createSingleSimulationRequestContext();
    const arrType: ArrType = mediaType === 'movie' ? 'radarr' : 'sonarr';

    try {
      const response = await fetch('/api/v1/simulate/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          databaseId: data.currentDatabase.id,
          releases: [{ id: generateReleaseId(), title, type: mediaType }],
          profileNames,
          arrType,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody?.error ?? `Simulation failed (HTTP ${response.status})`;
        throw new Error(message);
      }

      const result = (await response.json()) as SimulateScoreResponse;
      if (requestToken !== singleSimulationRequestToken) {
        return;
      }

      parserAvailable = result.parserAvailable;
      singleSimulationResult = result;
    } catch (err) {
      if (requestToken !== singleSimulationRequestToken) {
        return;
      }

      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }

      console.error('Score simulation failed:', err);
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to run score simulation.');
    } finally {
      finalizeSingleSimulationRequest(requestToken, abortController, timeout);
    }
  }

  async function simulateBatch() {
    if (!selectedProfileName || batchTitles.length === 0) {
      cancelBatchSimulationRequest();
      isSimulatingBatch = false;
      batchSimulationResult = null;
      return;
    }

    const { requestToken, abortController, timeout } = createBatchSimulationRequestContext();
    selectedReleaseId = null;
    const arrType: ArrType = mediaType === 'movie' ? 'radarr' : 'sonarr';

    try {
      const response = await fetch('/api/v1/simulate/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          databaseId: data.currentDatabase.id,
          releases: batchTitles,
          profileNames,
          arrType,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody?.error ?? `Simulation failed (HTTP ${response.status})`;
        throw new Error(message);
      }

      const result = (await response.json()) as SimulateScoreResponse;
      if (requestToken !== batchSimulationRequestToken) {
        return;
      }

      parserAvailable = result.parserAvailable;
      batchSimulationResult = result;
    } catch (err) {
      if (requestToken !== batchSimulationRequestToken) {
        return;
      }

      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }

      console.error('Batch simulation failed:', err);
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to run batch simulation.');
    } finally {
      finalizeBatchSimulationRequest(requestToken, abortController, timeout);
    }
  }

  function cancelSingleSimulationRequest() {
    if (!activeSingleSimulationAbortController) {
      return;
    }

    activeSingleSimulationAbortController.abort();
    activeSingleSimulationAbortController = null;
  }

  function cancelBatchSimulationRequest() {
    if (!activeBatchSimulationAbortController) {
      return;
    }

    activeBatchSimulationAbortController.abort();
    activeBatchSimulationAbortController = null;
  }

  function createSingleSimulationRequestContext(): {
    requestToken: number;
    abortController: AbortController;
    timeout: ReturnType<typeof setTimeout>;
  } {
    cancelSingleSimulationRequest();
    const requestToken = ++singleSimulationRequestToken;
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, SIMULATION_REQUEST_TIMEOUT_MS);

    activeSingleSimulationAbortController = abortController;
    isSimulatingSingle = true;

    return { requestToken, abortController, timeout };
  }

  function createBatchSimulationRequestContext(): {
    requestToken: number;
    abortController: AbortController;
    timeout: ReturnType<typeof setTimeout>;
  } {
    cancelBatchSimulationRequest();
    const requestToken = ++batchSimulationRequestToken;
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, SIMULATION_REQUEST_TIMEOUT_MS);

    activeBatchSimulationAbortController = abortController;
    isSimulatingBatch = true;

    return { requestToken, abortController, timeout };
  }

  function finalizeSingleSimulationRequest(
    requestToken: number,
    abortController: AbortController,
    timeout: ReturnType<typeof setTimeout>
  ) {
    clearTimeout(timeout);
    if (activeSingleSimulationAbortController === abortController) {
      activeSingleSimulationAbortController = null;
    }

    if (requestToken === singleSimulationRequestToken) {
      isSimulatingSingle = false;
    }
  }

  function finalizeBatchSimulationRequest(
    requestToken: number,
    abortController: AbortController,
    timeout: ReturnType<typeof setTimeout>
  ) {
    clearTimeout(timeout);
    if (activeBatchSimulationAbortController === abortController) {
      activeBatchSimulationAbortController = null;
    }

    if (requestToken === batchSimulationRequestToken) {
      isSimulatingBatch = false;
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

  function generateReleaseId(): string {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }

    return `release-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function handleReleaseInput() {
    void simulateSingle();
  }

  function handleProfileChange(event: CustomEvent<{ profileName: string | null }>) {
    selectedProfileName = event.detail.profileName;
    batchSimulationResult = null;
    selectedReleaseId = null;
    void simulateSingle();
  }

  function handleBatchSimulate() {
    void simulateBatch();
  }

  function handlePresetSelected(event: CustomEvent<{ titles: string[]; category: PresetCategory; mediaType: MediaType }>) {
    batchRawText = event.detail.titles.join('\n');
    mediaType = event.detail.mediaType;
    selectedReleaseId = null;
    void simulateBatch();
  }

  function handleComparisonProfileChange(event: CustomEvent<{ profileName: string | null }>) {
    comparisonProfileName = event.detail.profileName;
    if (singleSimulationResult) {
      void simulateSingle();
    }

    if (batchSimulationResult) {
      void simulateBatch();
    }
  }

  function handleReleaseSelect(event: CustomEvent<{ id: string }>) {
    selectedReleaseId = event.detail.id;
  }

  function clearMainSection() {
    cancelSingleSimulationRequest();
    releaseTitle = '';
    mediaType = 'movie';
    selectedProfileName = null;
    singleSimulationResult = null;
    selectedReleaseId = null;
    isSimulatingSingle = false;
  }

  function clearAdvancedSection() {
    cancelBatchSimulationRequest();
    batchRawText = '';
    comparisonProfileName = null;
    batchSimulationResult = null;
    selectedReleaseId = null;
    isSimulatingBatch = false;
  }
</script>

<svelte:head>
  <title>Score Simulator - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
  <Tabs {tabs} responsive />

  <DisclosureSection
    sectionKey={SS_ADVANCED_OPTIONS}
    initialMode="basic"
    sectionTitle="Batch & Comparison"
    sectionHint="Batch input, preset examples, and profile comparison."
    showAdvancedLabel="Show Advanced"
    hideAdvancedLabel="Hide Advanced"
  >
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
      <div class="min-w-0 space-y-4">
        <div class="flex items-start gap-2">
          <div class="flex-1">
            <ReleaseInput
              bind:title={releaseTitle}
              bind:mediaType
              bind:selectedProfileName
              qualityProfiles={qualityProfileOptions}
              isSimulating={isSimulatingSingle}
              {parserAvailable}
              canClear={canClearMainSection}
              on:input={handleReleaseInput}
              on:profileChange={handleProfileChange}
              on:clear={clearMainSection}
            />
          </div>
          <div class="pt-1">
            <PresetSelector {mediaType} compact on:presetSelected={handlePresetSelected} />
          </div>
        </div>

        <ScoreBreakdown profileScore={selectedProfileScore} />

        {#if comparisonResult && comparisonProfileLabel && selectedProfileLabel}
          <ComparisonView
            {comparisonResult}
            profileALabel={selectedProfileLabel}
            profileBLabel={comparisonProfileLabel}
          />
        {/if}
      </div>

      <div class="min-w-0">
        <SimulationResults
          result={singleSimulationResult}
          {selectedProfileName}
          {selectedProfileLabel}
          isSimulating={isSimulatingSingle}
        />
      </div>
    </div>

    <svelte:fragment slot="advanced">
      <div class="space-y-4">
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BatchInput
            bind:rawText={batchRawText}
            isSimulating={isSimulatingBatch}
            {parserAvailable}
            canClear={canClearAdvancedSection}
            on:batchSimulate={handleBatchSimulate}
            on:clear={clearAdvancedSection}
          />

          <div class="space-y-4">
            <PresetSelector {mediaType} on:presetSelected={handlePresetSelected} />
            <ProfileComparison
              qualityProfiles={qualityProfileOptions}
              primaryProfileName={selectedProfileName}
              bind:comparisonProfileName
              on:comparisonProfileChange={handleComparisonProfileChange}
            />
          </div>
        </div>
        {#if batchSimulationResult || isSimulatingBatch}
          <div class="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <div class="space-y-1">
              <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Batch Results
              </h3>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                Ranked results for the release titles in the batch input.
              </p>
            </div>
            <RankingTable
              {rankedReleases}
              comparisonActive={comparisonProfileName !== null}
              isSimulating={isSimulatingBatch}
              simulationResult={batchSimulationResult}
              {selectedProfileName}
              {selectedProfileLabel}
              on:releaseSelect={handleReleaseSelect}
            />
          </div>
        {/if}
      </div>
    </svelte:fragment>
  </DisclosureSection>
</div>
