<script lang="ts">
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import SearchAction from '$ui/actions/SearchAction.svelte';
  import SourceFilterAction from '$ui/actions/SourceFilterAction.svelte';
  import Table from '$ui/table/Table.svelte';
  import { createSearchStore } from '$lib/client/stores/search.ts';
  import type { Column, SortState } from '$ui/table/types.ts';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import type { PageData } from './$types';
  import type { SourcedQualityDefinitionListItem } from '$shared/pcd/display.ts';
  import {
    allSourceKeys,
    filterBySourceSelection,
    isSourceFilterActive,
    loadSourceSelection,
    normalizeSourceSelection,
    sameSelection,
    toSourceFilterKey,
    type SourceFilterSelection,
  } from '$lib/client/utils/sourceFilter.ts';

  export let data: PageData;

  const SOURCE_FILTER_STORAGE_PREFIX = 'trashQualitySizesSourceFilter';
  let selectedSourceKeys: SourceFilterSelection = [];
  let initializedSourceFilterKey = '';
  let sourceFilterStorageKey = '';

  const search = createSearchStore();
  const debouncedQuery = search.debouncedQuery;
  let initializedFromUrl = false;
  let initialSort: SortState | null = null;
  let sortState: SortState | null = null;

  $: qualitySizes = data.qualitySizes ?? [];
  $: availableSources = data.sourceContext.availableSources;
  $: sourceFilterDisabledReason = data.sourceContext.filterDisabledReason;
  $: skippedEntityCount = data.skippedEntityCount ?? 0;
  $: fallbackSourceKey = toSourceFilterKey({
    type: 'trash',
    id: data.source.id,
  });
  $: sourceFilterStorageKey = `${SOURCE_FILTER_STORAGE_PREFIX}:${data.source.id}`;

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

  $: filtered = $debouncedQuery
    ? qualitySizes.filter((size: SourcedQualityDefinitionListItem) =>
        size.name.toLowerCase().includes($debouncedQuery.toLowerCase())
      )
    : qualitySizes;
  $: sourceFiltered = filterBySourceSelection(filtered, selectedSourceKeys, fallbackSourceKey);
  $: sourceFilterActive = isSourceFilterActive(selectedSourceKeys, availableSources);
  $: hasSearchQuery = $debouncedQuery.trim().length > 0;
  $: showSourceClearAction = sourceFilterActive && availableSources.length > 1;
  $: emptyMessage = sourceFilterActive
    ? hasSearchQuery
      ? 'No quality sizes match your search and selected sources'
      : 'No quality sizes match your selected sources'
    : 'No quality sizes match your search';
  $: columns = [
    data.sourceContext.showAllSourcesTab
      ? {
          key: 'sourceDatabaseName',
          header: 'Source',
          sortable: true,
        }
      : null,
    {
      key: 'name',
      header: 'Name',
      sortable: true,
    },
    {
      key: 'quality_count',
      header: 'Quality Count',
      align: 'center' as const,
      sortable: true,
    },
  ].filter(Boolean) as Column<SourcedQualityDefinitionListItem>[];

  $: if (!initializedFromUrl) {
    const initialQuery = $page.url.searchParams.get('q')?.trim() ?? '';
    if (initialQuery.length > 0) {
      search.setQuery(initialQuery);
    }

    const key = $page.url.searchParams.get('sort')?.trim();
    initialSort =
      key === 'name' || key === 'sourceDatabaseName' || key === 'quality_count'
        ? {
            key,
            direction: $page.url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc',
          }
        : null;
    sortState = initialSort;
    initializedFromUrl = true;
  }

  $: if (browser && initializedFromUrl) {
    const url = new URL(window.location.href);
    const nextQuery = $debouncedQuery.trim();

    if (nextQuery) {
      url.searchParams.set('q', nextQuery);
    } else {
      url.searchParams.delete('q');
    }

    if (sortState) {
      url.searchParams.set('sort', sortState.key);
      url.searchParams.set('dir', sortState.direction);
    } else {
      url.searchParams.delete('sort');
      url.searchParams.delete('dir');
    }

    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      window.history.replaceState(window.history.state, '', next);
    }
  }

  function handleSortChange(nextSort: SortState | null): void {
    sortState = nextSort;
  }

  function clearSourceFilters() {
    selectedSourceKeys = allSourceKeys(availableSources);
  }
</script>

<svelte:head>
  <title>Quality Sizes - {data.source?.name ?? 'TRaSH Source'} - Praxrr</title>
</svelte:head>

<div class="mt-6 space-y-4">
  <ActionsBar>
    <SearchAction searchStore={search} placeholder="Search quality sizes..." responsive />
    <div title={sourceFilterDisabledReason ?? undefined}>
      <SourceFilterAction
        sources={availableSources}
        bind:selectedKeys={selectedSourceKeys}
        disabled={Boolean(sourceFilterDisabledReason)}
        ariaLabel="Filter quality sizes by source"
        responsive
      />
    </div>
  </ActionsBar>

  {#if skippedEntityCount > 0}
    <div
      class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900 dark:text-amber-200"
    >
      {skippedEntityCount} malformed row(s) were skipped because cached TRaSH data could not be parsed.
    </div>
  {/if}

  {#if qualitySizes.length === 0}
    <div
      class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p class="text-neutral-600 dark:text-neutral-400">No quality sizes cached. Try syncing sources.</p>
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
  {:else}
    <Table
      {columns}
      data={sourceFiltered}
      rowHref={(row) => {
        if (!row.trashId) {
          return null;
        }
        return `/databases/trash/${row.sourceDatabaseId ?? data.source.id}/quality-sizes/${row.trashId}/`;
      }}
      emptyMessage="No quality sizes cached. Try syncing sources."
      responsive
      {initialSort}
      onSortChange={handleSortChange}
    />
  {/if}
</div>
