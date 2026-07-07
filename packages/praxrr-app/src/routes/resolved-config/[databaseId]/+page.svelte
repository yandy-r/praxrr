<script lang="ts">
  import { onMount } from 'svelte';
  import type { ComponentType, SvelteComponent } from 'svelte';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import type { components } from '$api/v1.d.ts';
  import ResolvedStatePanel from './ResolvedStatePanel.svelte';
  import LiveDiffPanel from './LiveDiffPanel.svelte';
  import CrossInstanceGrid from './CrossInstanceGrid.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  type ResolvedEntityType = components['schemas']['ResolvedEntityState']['entityType'];
  type ArrAppType = components['schemas']['ResolvedInstanceState']['arrType'];
  type ResolvedEntityListResponse = components['schemas']['ResolvedEntityListResponse'];
  type ErrorResponse = components['schemas']['ErrorResponse'];

  interface EntityTypeOption {
    value: ResolvedEntityType;
    label: string;
    perArr: boolean;
  }

  const ENTITY_TYPE_OPTIONS: EntityTypeOption[] = [
    { value: 'qualityProfile', label: 'Quality Profile', perArr: false },
    { value: 'customFormat', label: 'Custom Format', perArr: false },
    { value: 'delayProfile', label: 'Delay Profile', perArr: false },
    { value: 'regularExpression', label: 'Regular Expression', perArr: false },
    { value: 'naming', label: 'Naming', perArr: true },
    { value: 'mediaSettings', label: 'Media Settings', perArr: true },
    { value: 'qualityDefinitions', label: 'Quality Definitions', perArr: true },
    { value: 'lidarrMetadataProfile', label: 'Lidarr Metadata Profile', perArr: true },
  ];

  const ARR_TYPE_OPTIONS: { value: ArrAppType; label: string }[] = [
    { value: 'radarr', label: 'Radarr' },
    { value: 'sonarr', label: 'Sonarr' },
    { value: 'lidarr', label: 'Lidarr' },
  ];

  /** Common prop contract every registered panel component must accept. */
  interface ResolvedConfigPanelProps {
    databaseId: number;
    entityType: ResolvedEntityType;
    arrType?: ArrAppType;
    entityName: string | null;
  }

  interface ConfigPanel {
    id: string;
    label: string;
    component: ComponentType<SvelteComponent<ResolvedConfigPanelProps>>;
  }

  // Panels register here — one entry per feature panel. Task 4.2 (LiveDiffPanel) and
  // Task 4.3 (CrossInstanceGrid) each append one additional entry to this array.
  const panels: ConfigPanel[] = [
    { id: 'resolved-state', label: 'Resolved State', component: ResolvedStatePanel },
    { id: 'live-diff', label: 'Live Diff', component: LiveDiffPanel },
    { id: 'cross-instance', label: 'Compare Instances', component: CrossInstanceGrid },
  ];

  let activePanelId = panels[0].id;
  $: activePanel = panels.find((panel) => panel.id === activePanelId) ?? panels[0];

  let selectedEntityType: ResolvedEntityType = ENTITY_TYPE_OPTIONS[0].value;
  let selectedArrType: ArrAppType = 'radarr';
  let selectedEntityName: string | null = null;
  let entityNames: string[] = [];
  let namesLoading = false;
  let namesError: string | null = null;

  $: currentOption =
    ENTITY_TYPE_OPTIONS.find((option) => option.value === selectedEntityType) ?? ENTITY_TYPE_OPTIONS[0];
  $: requiresArrType = currentOption.perArr;
  $: isLidarrOnly = selectedEntityType === 'lidarrMetadataProfile';
  $: currentArrType = computeArrTypeFor(selectedEntityType, selectedArrType);

  function computeArrTypeFor(entityType: ResolvedEntityType, arrType: ArrAppType): ArrAppType | undefined {
    const option = ENTITY_TYPE_OPTIONS.find((candidate) => candidate.value === entityType);
    if (!option?.perArr) return undefined;
    return entityType === 'lidarrMetadataProfile' ? 'lidarr' : arrType;
  }

  function handleDatabaseChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (value) goto(`/resolved-config/${value}`);
  }

  function handleEntityTypeChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as ResolvedEntityType;
    selectedEntityType = value;
    selectedArrType = 'radarr';
    void loadEntityNames(computeArrTypeFor(value, 'radarr'));
  }

  function handleArrTypeChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value as ArrAppType;
    selectedArrType = value;
    void loadEntityNames(computeArrTypeFor(selectedEntityType, value));
  }

  function handleEntityNameChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    selectedEntityName = value || null;
  }

  async function loadEntityNames(arrTypeOverride: ArrAppType | undefined) {
    if (data.selectedDatabaseId === null || data.error) return;

    namesLoading = true;
    namesError = null;
    entityNames = [];
    selectedEntityName = null;

    try {
      const query = new URLSearchParams();
      if (arrTypeOverride) query.set('arrType', arrTypeOverride);
      const queryString = query.toString();
      const response = await fetch(
        `/api/v1/pcd/${data.selectedDatabaseId}/resolved/${selectedEntityType}${queryString ? `?${queryString}` : ''}`
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        namesError = body?.error ?? `Failed to load entities (HTTP ${response.status})`;
        return;
      }

      const body = (await response.json()) as ResolvedEntityListResponse;
      entityNames = body.entities.map((entity) => entity.name);
      selectedEntityName = entityNames[0] ?? null;
    } catch (err) {
      namesError = err instanceof Error ? err.message : 'Failed to load entities';
    } finally {
      namesLoading = false;
    }
  }

  onMount(() => {
    if (browser && data.selectedDatabaseId !== null && !data.error) {
      void loadEntityNames(currentArrType);
    }
  });
</script>

<svelte:head>
  <title>Resolved Config - Praxrr</title>
</svelte:head>

<div class="space-y-8">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Resolved Config Viewer</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Inspect the fully resolved PCD configuration state for an entity — the same state Praxrr applies when syncing to
        Radarr, Sonarr, and Lidarr.
      </p>
    </div>
    {#if data.databases.length > 0}
      <label class="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        Database:
        <select
          class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          value={data.selectedDatabaseId ?? ''}
          on:change={handleDatabaseChange}
        >
          <option value="" disabled>Select a database…</option>
          {#each data.databases as database (database.id)}
            <option value={database.id}>{database.name}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>

  {#if data.databases.length === 0}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      Link a Praxrr Compliant Database to inspect its resolved configuration.
    </div>
  {:else if data.selectedDatabaseId === null}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      {data.error ?? 'Select a database above to inspect its resolved configuration.'}
    </div>
  {:else if data.error}
    <div
      class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
    >
      {data.error}
    </div>
  {:else}
    {@const currentDatabaseId = data.selectedDatabaseId}
    <section class="space-y-4">
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
          Entity type
          <select
            class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={selectedEntityType}
            on:change={handleEntityTypeChange}
          >
            {#each ENTITY_TYPE_OPTIONS as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>

        {#if requiresArrType}
          {#if isLidarrOnly}
            <span class="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
              Arr app
              <span
                class="rounded-lg border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-400"
              >
                Lidarr
              </span>
            </span>
          {:else}
            <label class="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
              Arr app
              <select
                class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={selectedArrType}
                on:change={handleArrTypeChange}
              >
                {#each ARR_TYPE_OPTIONS as option (option.value)}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>
          {/if}
        {/if}

        <label class="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
          Entity name
          <select
            class="min-w-48 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={selectedEntityName ?? ''}
            disabled={namesLoading || entityNames.length === 0}
            on:change={handleEntityNameChange}
          >
            {#if entityNames.length === 0}
              <option value="" disabled>No entities</option>
            {/if}
            {#each entityNames as name (name)}
              <option value={name}>{name}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if namesError}
        <div
          class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
        >
          {namesError}
        </div>
      {:else if namesLoading}
        <div
          class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          Loading entities…
        </div>
      {:else if entityNames.length === 0}
        <div
          class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          No {currentOption.label} entities found in this database{requiresArrType ? ` for ${currentArrType}` : ''}.
        </div>
      {:else}
        <div class="flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
          {#each panels as panel (panel.id)}
            <button
              type="button"
              class="border-b-2 px-4 py-2 text-sm font-medium transition-colors {panel.id === activePanelId
                ? 'border-accent-600 text-accent-600 dark:border-accent-500 dark:text-accent-500'
                : 'border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'}"
              on:click={() => (activePanelId = panel.id)}
            >
              {panel.label}
            </button>
          {/each}
        </div>

        <div class="pt-4">
          <svelte:component
            this={activePanel.component}
            databaseId={currentDatabaseId}
            entityType={selectedEntityType}
            arrType={currentArrType}
            entityName={selectedEntityName}
          />
        </div>
      {/if}
    </section>
  {/if}
</div>
