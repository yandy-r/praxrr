<script lang="ts">
  import Tabs from '$ui/navigation/tabs/Tabs.svelte';
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';
  import SearchAction from '$ui/actions/SearchAction.svelte';
  import SourceFilterAction from '$ui/actions/SourceFilterAction.svelte';
  import ViewToggle from '$ui/actions/ViewToggle.svelte';
  import InfoModal from '$ui/modal/InfoModal.svelte';
  import CloneModal from '$ui/modal/CloneModal.svelte';
  import TableView from './views/TableView.svelte';
  import CardView from './views/CardView.svelte';
  import SearchFilterAction from './components/SearchFilterAction.svelte';
  import { createDataPageStore } from '$lib/client/stores/dataPage';
  import { browser } from '$app/environment';
  import { Info, Plus } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { alertStore } from '$alerts/store';
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
  import type { CustomFormatTableRow } from '$shared/pcd/display.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  let infoModalOpen = false;
  let cloneModalOpen = false;
  let cloneSourceName = '';

  function handleClone(event: CustomEvent<{ name: string }>) {
    cloneSourceName = event.detail.name;
    cloneModalOpen = true;
  }

  async function handleExport(event: CustomEvent<{ name: string }>) {
    const { name } = event.detail;
    try {
      const params = new URLSearchParams({
        databaseId: String(data.currentDatabase.id),
        entityType: 'custom_format',
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

  const SEARCH_FILTER_STORAGE_KEY = 'customFormatsSearchFilter';
  const SOURCE_FILTER_STORAGE_PREFIX = 'customFormatsSourceFilter';

  // Default search filter options
  const defaultSearchOptions = [
    { key: 'name', label: 'Name', enabled: true },
    { key: 'tags', label: 'Tags', enabled: true },
    { key: 'description', label: 'Description', enabled: false },
  ];

  // Load saved preferences from localStorage or use defaults
  function loadSearchOptions() {
    if (!browser) return defaultSearchOptions;
    try {
      const saved = localStorage.getItem(SEARCH_FILTER_STORAGE_KEY);
      if (saved) {
        const savedMap = new Map(JSON.parse(saved) as [string, boolean][]);
        return defaultSearchOptions.map((opt) => ({
          ...opt,
          enabled: savedMap.has(opt.key) ? savedMap.get(opt.key)! : opt.enabled,
        }));
      }
    } catch {
      // Ignore parse errors, use defaults
    }
    return defaultSearchOptions;
  }

  let searchOptions = loadSearchOptions();

  function clearSourceFilters() {
    selectedSourceKeys = allSourceKeys(availableSources);
  }

  // Save to localStorage when options change
  $: if (browser) {
    const enabledMap = searchOptions.map((opt) => [opt.key, opt.enabled] as [string, boolean]);
    localStorage.setItem(SEARCH_FILTER_STORAGE_KEY, JSON.stringify(enabledMap));
  }

  // Initialize data page store (we'll use search and view, but do our own filtering)
  const { search, view, setItems } = createDataPageStore(data.customFormats, {
    storageKey: 'customFormatsView',
    defaultView: 'cards',
    searchKeys: ['name'], // Placeholder, we do our own filtering
    searchKey: `customFormatsSearch:${data.currentDatabase.id}`,
  });

  // Extract the debounced query store for reactive access
  const debouncedQuery = search.debouncedQuery;

  // Update items when data changes (e.g., switching databases)
  $: setItems(data.customFormats);

  let selectedSourceKeys: SourceFilterSelection = [];
  let initializedSourceFilterKey = '';

  $: availableSources = data.sourceContext.availableSources;
  $: showSourceBadges = data.sourceContext.showAllSourcesTab;
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

  $: sourceFiltered = filterBySourceSelection(data.customFormats, selectedSourceKeys, fallbackSourceKey);

  // Custom filtering based on selected search options
  $: filtered = filterFormats(sourceFiltered, $debouncedQuery, searchOptions);
  $: sourceFilterActive = isSourceFilterActive(selectedSourceKeys, availableSources);
  $: hasSearchQuery = $debouncedQuery.trim().length > 0;
  $: showSourceClearAction = sourceFilterActive && availableSources.length > 1;

  $: emptyMessage = (() => {
    if (sourceFilterActive && hasSearchQuery) {
      return 'No custom formats match your search and source filters';
    }

    if (sourceFilterActive) {
      return 'No custom formats match your selected sources';
    }

    return 'No custom formats match your search';
  })();

  function filterFormats(
    items: CustomFormatTableRow[],
    query: string,
    options: typeof searchOptions
  ): CustomFormatTableRow[] {
    if (!query) return items;

    const queryLower = query.toLowerCase();
    const enabledKeys = options.filter((o) => o.enabled).map((o) => o.key);

    return items.filter((item) => {
      return enabledKeys.some((key) => {
        if (key === 'tags') {
          // Search within tag names
          return item.tags.some((tag) => tag.name.toLowerCase().includes(queryLower));
        }
        const value = item[key as keyof CustomFormatTableRow];
        if (value == null) return false;
        return String(value).toLowerCase().includes(queryLower);
      });
    });
  }

  // Map databases to tabs
  $: tabs = data.databases.map((db) => ({
    label: db.name,
    href: `/custom-formats/${db.id}`,
    active: db.id === data.currentDatabase.id,
  }));

  // Persist selected database tab
  $: if (browser && data.currentDatabase?.id) {
    localStorage.setItem('customFormatsDatabase', String(data.currentDatabase.id));
  }
</script>

<svelte:head>
  <title>Custom Formats - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
  <!-- Tabs -->
  <Tabs {tabs} responsive />

  <!-- Actions Bar -->
  <ActionsBar className="w-full justify-center mx-auto md:w-auto md:mx-0">
    <SearchAction searchStore={search} placeholder="Search custom formats..." responsive />
    <ActionButton icon={Plus} on:click={() => goto(`/custom-formats/${data.currentDatabase.id}/new`)} />
    <SearchFilterAction bind:options={searchOptions} />
    <div title={sourceFilterDisabledReason ?? undefined}>
      <SourceFilterAction
        sources={availableSources}
        bind:selectedKeys={selectedSourceKeys}
        disabled={Boolean(sourceFilterDisabledReason)}
        label="Sources"
        ariaLabel="Filter custom formats by source"
        dropdownOnly
        responsive
      />
    </div>
    <ViewToggle bind:value={$view} />
    <ActionButton icon={Info} on:click={() => (infoModalOpen = true)} />
  </ActionsBar>

  <!-- Custom Formats Content -->
  <div class="mt-6">
    {#if data.customFormats.length === 0}
      <div
        class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p class="text-neutral-600 dark:text-neutral-400">
          No custom formats found for {data.currentDatabase.name}
        </p>
      </div>
    {:else if filtered.length === 0}
      <div
        class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p class="text-neutral-600 dark:text-neutral-400">{emptyMessage}</p>
        {#if showSourceClearAction}
          <button
            type="button"
            class="mt-3 text-sm font-medium text-accent-700 transition-colors hover:text-accent-600 dark:text-accent-300 dark:hover:text-accent-200"
            on:click={clearSourceFilters}
          >
            Clear source filters
          </button>
        {/if}
      </div>
    {:else if $view === 'table'}
      <TableView
        formats={filtered}
        sources={availableSources}
        currentDatabaseId={data.currentDatabase.id}
        currentDatabaseName={data.currentDatabase.name}
        {showSourceBadges}
        on:clone={handleClone}
        on:export={handleExport}
      />
    {:else}
      <CardView
        formats={filtered}
        sources={availableSources}
        currentDatabaseId={data.currentDatabase.id}
        currentDatabaseName={data.currentDatabase.name}
        {showSourceBadges}
        on:clone={handleClone}
        on:export={handleExport}
      />
    {/if}
  </div>
</div>

<!-- Info Modal -->
<InfoModal bind:open={infoModalOpen} header="About Custom Formats">
  <div class="space-y-4 text-sm text-neutral-700 dark:text-neutral-300">
    <section>
      <h3 class="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">What Are Custom Formats?</h3>
      <p>
        Custom formats are rules that match specific release characteristics like codec, resolution, source, or release
        group. They're used to score releases and guide quality decisions.
      </p>
    </section>

    <section>
      <h3 class="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">How They Work</h3>
      <p>
        Each custom format contains one or more conditions. A release must match all required conditions (or at least
        one non-required condition) to be assigned the custom format. Quality profiles then assign scores to determine
        which releases are preferred.
      </p>
    </section>

    <section>
      <h3 class="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">Condition Types</h3>
      <ul class="list-inside list-disc space-y-1">
        <li><strong>Release Title</strong> - Match patterns in the release name</li>
        <li><strong>Release Group</strong> - Match specific release groups</li>
        <li><strong>Edition</strong> - Match edition names (Director's Cut, etc.)</li>
        <li><strong>Language</strong> - Match audio language</li>
        <li><strong>Source</strong> - Match release source (BluRay, WEB, etc.)</li>
        <li><strong>Resolution</strong> - Match video resolution</li>
      </ul>
    </section>
  </div>
</InfoModal>

<CloneModal
  bind:open={cloneModalOpen}
  databaseId={data.currentDatabase.id}
  entityType="custom_format"
  sourceName={cloneSourceName}
  existingNames={data.customFormats
    .filter((format) => isCurrentDatabasePcdItem(format, data.currentDatabase.id))
    .map((format) => format.name)}
  canWriteToBase={data.canWriteToBase}
/>
