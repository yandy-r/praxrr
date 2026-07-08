<script lang="ts">
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';
  import SearchAction from '$ui/actions/SearchAction.svelte';
  import SourceFilterAction from '$ui/actions/SourceFilterAction.svelte';
  import ViewToggle from '$ui/actions/ViewToggle.svelte';
  import CloneModal from '$ui/modal/CloneModal.svelte';
  import TableView from './views/TableView.svelte';
  import CardView from './views/CardView.svelte';
  import { createDataPageStore } from '$lib/client/stores/dataPage';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { alertStore } from '$alerts/store';
  import { Plus } from 'lucide-svelte';
  import type { EntityType } from '$shared/pcd/portable.ts';
  import type { ArrAppType } from '$shared/arr/capabilities.ts';
  import type { PageData } from './$types';
  import {
    allSourceKeys,
    filterBySourceSelection,
    isCurrentDatabasePcdItem,
    isSourceFilterActive,
    loadSourceSelection,
    normalizeSourceSelection,
    sameSelection,
    toSourceFilterKey,
    type SourceFilterSelection,
  } from '$lib/client/utils/sourceFilter.ts';

  export let data: PageData;

  let cloneModalOpen = false;
  let cloneSourceName = '';
  let cloneEntityType: EntityType = 'radarr_naming';
  let cloneArrType: ArrAppType | null = null;
  const namingSearchKeys: Array<keyof PageData['namingConfigs'][number]> = ['name', 'arr_type'];
  const supportedNamingArrTypes: ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];
  const SOURCE_FILTER_STORAGE_PREFIX = 'namingSourceFilter';
  let selectedSourceKeys: SourceFilterSelection = [];
  let initializedSourceFilterKey = '';

  function isSupportedArrType(arrType: string): arrType is ArrAppType {
    return supportedNamingArrTypes.includes(arrType as ArrAppType);
  }

  function clearSourceFilters() {
    selectedSourceKeys = allSourceKeys(availableSources);
  }

  $: cloneExistingNames = cloneArrType
    ? data.namingConfigs
        .filter(
          (config) => isCurrentDatabasePcdItem(config, data.currentDatabase.id) && config.arr_type === cloneArrType
        )
        .map((config) => config.name)
    : [];

  function toEntityType(arrType: string): EntityType | null {
    if (!isSupportedArrType(arrType)) {
      return null;
    }

    return `${arrType}_naming` as EntityType;
  }

  function handleClone(event: CustomEvent<{ name: string; arr_type: string }>) {
    if (!event.detail.name?.trim()) {
      alertStore.add('error', 'Missing naming config name');
      return;
    }

    const arrType = event.detail.arr_type;
    if (!isSupportedArrType(arrType)) {
      alertStore.add('error', `Unknown naming type "${arrType}"`);
      return;
    }

    const entityType = toEntityType(arrType);
    if (!entityType) {
      alertStore.add('error', `Unknown naming type "${event.detail.arr_type}"`);
      return;
    }

    cloneSourceName = event.detail.name;
    cloneEntityType = entityType;
    cloneArrType = arrType;
    cloneModalOpen = true;
  }

  async function handleExport(event: CustomEvent<{ name: string; arr_type: string }>) {
    const { name, arr_type } = event.detail;
    if (!name?.trim()) {
      alertStore.add('error', 'Missing naming config name');
      return;
    }

    const entityType = toEntityType(arr_type);
    if (!entityType) {
      alertStore.add('error', `Unknown naming type "${arr_type}"`);
      return;
    }

    try {
      const params = new URLSearchParams({
        databaseId: String(data.currentDatabase.id),
        entityType,
        name,
      });
      const res = await fetch(`/api/v1/pcd/export?${params}`);
      const json = await res.json();
      if (!res.ok) {
        alertStore.add('error', json.error || 'Export failed');
        return;
      }
      await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
      alertStore.add('success', `Copied "${name}" to clipboard`);
    } catch {
      alertStore.add('error', 'Export failed');
    }
  }

  // Initialize data page store
  const { search, view, filtered, setItems } = createDataPageStore(data.namingConfigs, {
    storageKey: 'namingSettingsView',
    searchKeys: namingSearchKeys,
    searchKey: `namingConfigsSearch:${data.currentDatabase.id}`,
  });

  // Update items when data changes
  $: setItems(data.namingConfigs);
  $: availableSources = data.sourceContext.availableSources;
  $: sourceFilterDisabledReason = data.sourceContext.filterDisabledReason;
  $: sourceFilterStorageKey = `${SOURCE_FILTER_STORAGE_PREFIX}:${data.currentDatabase.id}`;
  $: fallbackSourceKey = toSourceFilterKey({ type: 'pcd', id: data.currentDatabase.id });

  $: if (initializedSourceFilterKey !== sourceFilterStorageKey) {
    initializedSourceFilterKey = sourceFilterStorageKey;
    selectedSourceKeys = loadSourceSelection(
      sourceFilterStorageKey,
      availableSources,
      data.sourceContext.defaultSourceKey,
      true
    );
  }

  $: {
    const normalized = normalizeSourceSelection(
      selectedSourceKeys,
      availableSources,
      data.sourceContext.defaultSourceKey,
      true
    );
    if (!sameSelection(normalized, selectedSourceKeys)) {
      selectedSourceKeys = normalized;
    }
  }

  $: if (browser && initializedSourceFilterKey === sourceFilterStorageKey) {
    localStorage.setItem(sourceFilterStorageKey, JSON.stringify(selectedSourceKeys));
  }

  $: sourceFiltered = filterBySourceSelection($filtered, selectedSourceKeys, fallbackSourceKey);
  $: sourceFilterActive = isSourceFilterActive(selectedSourceKeys, availableSources);
  $: hasSearchQuery = $search.query.trim().length > 0;
  $: showSourceClearAction = sourceFilterActive && availableSources.length > 1;
  $: emptyMessage = sourceFilterActive
    ? hasSearchQuery
      ? 'No naming configs match your search and selected sources'
      : 'No naming configs match your selected sources'
    : 'No naming configs match your search';
</script>

<!-- Actions Bar -->
<ActionsBar>
  <SearchAction searchStore={search} placeholder="Search naming configs..." responsive />
  <div title={sourceFilterDisabledReason ?? undefined}>
    <SourceFilterAction
      sources={availableSources}
      bind:selectedKeys={selectedSourceKeys}
      disabled={Boolean(sourceFilterDisabledReason)}
      ariaLabel="Filter naming configs by source"
      responsive
    />
  </div>
  <ActionButton
    icon={Plus}
    on:click={() =>
      goto(resolve('/media-management/[databaseId]/naming/new', { databaseId: data.currentDatabase.id.toString() }))}
  />
  <ViewToggle bind:value={$view} />
</ActionsBar>

<!-- Naming Configs Content -->
<div class="mt-6">
  {#if data.namingConfigs.length === 0}
    <div
      class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p class="text-neutral-600 dark:text-neutral-400">
        No naming configs found for {data.currentDatabase.name}
      </p>
    </div>
  {:else if sourceFiltered.length === 0}
    <div
      class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p class="text-neutral-600 dark:text-neutral-400">{emptyMessage}</p>
      {#if showSourceClearAction}
        <button
          type="button"
          class="text-accent-700 hover:text-accent-600 dark:text-accent-300 dark:hover:text-accent-200 mt-3 text-sm font-medium transition-colors"
          on:click={clearSourceFilters}
        >
          Clear source filters
        </button>
      {/if}
    </div>
  {:else if $view === 'table'}
    <TableView
      configs={sourceFiltered}
      databaseId={data.currentDatabase.id}
      currentDatabaseId={data.currentDatabase.id}
      currentDatabaseName={data.currentDatabase.name}
      sources={availableSources}
      showSourceBadges={data.sourceContext.showAllSourcesTab}
      on:clone={handleClone}
      on:export={handleExport}
    />
  {:else}
    <CardView
      configs={sourceFiltered}
      databaseId={data.currentDatabase.id}
      currentDatabaseId={data.currentDatabase.id}
      currentDatabaseName={data.currentDatabase.name}
      sources={availableSources}
      showSourceBadges={data.sourceContext.showAllSourcesTab}
      on:clone={handleClone}
      on:export={handleExport}
    />
  {/if}
</div>

<CloneModal
  bind:open={cloneModalOpen}
  databaseId={data.currentDatabase.id}
  entityType={cloneEntityType}
  sourceName={cloneSourceName}
  existingNames={cloneExistingNames}
  canWriteToBase={data.canWriteToBase}
/>
