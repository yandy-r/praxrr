<script lang="ts">
  import {
    Check,
    SlidersHorizontal,
    TableProperties,
    RefreshCw,
    ExternalLink,
    ChevronLeft,
    ChevronRight,
    Rows3,
  } from 'lucide-svelte';
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import SearchAction from '$ui/actions/SearchAction.svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';
  import Dropdown from '$ui/dropdown/Dropdown.svelte';
  import IconCheckbox from '$ui/form/IconCheckbox.svelte';
  import NumberInput from '$ui/form/NumberInput.svelte';
  import { type SearchStore } from '$stores/search';

  type FilterOperator = 'eq' | 'neq';
  type FilterField = 'qualityName' | 'qualityProfileName';

  interface ActiveFilter {
    field: FilterField;
    operator: FilterOperator;
    value: string | number | boolean;
    label: string;
  }

  export let searchStore: SearchStore;
  export let visibleColumns: Set<string>;
  export let toggleableColumns: readonly string[];
  export let columnLabels: Record<string, string>;
  export let activeFilters: ActiveFilter[];
  export let uniqueQualities: string[];
  export let uniqueProfiles: string[];

  export let onToggleColumn: (key: string) => void;
  export let onToggleFilter: (
    field: FilterField,
    operator: FilterOperator,
    value: string | number | boolean,
    label: string
  ) => void;
  export let onRefresh: () => void;
  export let onOpen: () => void = () => {};
  export let instanceType: string = 'radarr';
  export let page: number = 1;
  export let pageSize: number = 100;
  export let totalRecords: number = 0;
  export let totalPages: number = 0;
  export let hasNext: boolean = false;
  export let isPaginationLoading: boolean = false;
  export let openUrl = '';
  export let onPreviousPage: () => void = () => {};
  export let onNextPage: () => void = () => {};
  export let onChangePageSize: (nextSize: number) => void = () => {};
  export let disablePaginationControls: boolean = false;

  $: displayStart = totalRecords > 0 ? (page - 1) * pageSize + 1 : 0;
  $: displayEnd = totalRecords > 0 ? Math.min(page * pageSize, totalRecords) : 0;
  $: isFirstPage = page <= 1;
  $: hasVisibleNext = page < totalPages || hasNext;
  $: isPreviousDisabled = disablePaginationControls || isPaginationLoading || isFirstPage;
  $: isNextDisabled = disablePaginationControls || isPaginationLoading || !hasVisibleNext;
  $: displayTotalPages = Math.max(1, totalPages);

  $: isRadarr = instanceType === 'radarr';
  $: isLidarr = instanceType === 'lidarr';
  $: searchPlaceholder = isRadarr ? 'Search movies...' : isLidarr ? 'Search albums...' : 'Search series...';
  $: openLabel = isRadarr ? 'Open in Radarr' : isLidarr ? 'Open in Lidarr' : 'Open in Sonarr';
  $: filterDescription = isRadarr
    ? 'Filter movies by quality or profile'
    : isLidarr
      ? 'Filter albums by profile'
      : 'Filter series by profile';

  function onPageSizeInput(value: number) {
    if (value <= 0) return;
    onChangePageSize(value);
  }

  function handleOpen() {
    if (openUrl) {
      window.open(openUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    onOpen();
  }
</script>

<ActionsBar>
  <SearchAction {searchStore} placeholder={searchPlaceholder} responsive />
  <ActionButton icon={SlidersHorizontal} hasDropdown={true} dropdownPosition="right">
    <svelte:fragment slot="dropdown" let:dropdownPosition let:open>
      <Dropdown position={dropdownPosition} mobilePosition="middle" minWidth="16rem">
        <div class="border-b border-neutral-100 px-4 py-3 dark:border-neutral-700">
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            {filterDescription}
          </p>
        </div>
        <div class="max-h-96 overflow-y-auto">
          <!-- Quality Filter (Radarr only) -->
          {#if isRadarr && uniqueQualities.length > 0}
            <div class="border-b border-neutral-100 dark:border-neutral-700">
              <div class="bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
                <span class="text-xs font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400"
                  >Quality</span
                >
              </div>
              {#each uniqueQualities as quality}
                <button
                  type="button"
                  on:click={() => onToggleFilter('qualityName', 'eq', quality, quality)}
                  class="flex w-full items-center justify-between gap-3 px-4 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 {activeFilters.find(
                    (f) => f.field === 'qualityName' && f.value === quality
                  )
                    ? 'bg-neutral-50 dark:bg-neutral-700'
                    : ''}"
                >
                  <span class="text-neutral-700 dark:text-neutral-300">{quality}</span>
                  <IconCheckbox
                    checked={!!activeFilters.find((f) => f.field === 'qualityName' && f.value === quality)}
                    icon={Check}
                    color="blue"
                    shape="circle"
                  />
                </button>
              {/each}
            </div>
          {/if}

          <!-- Profile Filter -->
          <div>
            <div class="bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
              <span class="text-xs font-medium tracking-wider text-neutral-500 uppercase dark:text-neutral-400"
                >Profile</span
              >
            </div>
            {#each uniqueProfiles as profile}
              <button
                type="button"
                on:click={() => onToggleFilter('qualityProfileName', 'eq', profile, profile)}
                class="flex w-full items-center justify-between gap-3 px-4 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 {activeFilters.find(
                  (f) => f.field === 'qualityProfileName' && f.value === profile
                )
                  ? 'bg-neutral-50 dark:bg-neutral-700'
                  : ''}"
              >
                <span class="text-neutral-700 dark:text-neutral-300">{profile}</span>
                <IconCheckbox
                  checked={!!activeFilters.find((f) => f.field === 'qualityProfileName' && f.value === profile)}
                  icon={Check}
                  color="blue"
                  shape="circle"
                />
              </button>
            {/each}
          </div>
        </div>
      </Dropdown>
    </svelte:fragment>
  </ActionButton>
  <ActionButton icon={TableProperties} hasDropdown={true} dropdownPosition="right">
    <svelte:fragment slot="dropdown" let:dropdownPosition let:open>
      <Dropdown position={dropdownPosition} mobilePosition="middle" minWidth="14rem">
        <div class="border-b border-neutral-100 px-4 py-3 dark:border-neutral-700">
          <p class="text-xs text-neutral-500 dark:text-neutral-400">Toggle visible table columns</p>
        </div>
        <div class="py-1">
          {#each toggleableColumns as colKey}
            <button
              type="button"
              on:click={() => onToggleColumn(colKey)}
              class="flex w-full items-center justify-between gap-3 px-4 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 {visibleColumns.has(
                colKey
              )
                ? 'bg-neutral-50 dark:bg-neutral-700'
                : ''}"
            >
              <span class="text-neutral-700 dark:text-neutral-300">{columnLabels[colKey]}</span>
              <IconCheckbox checked={visibleColumns.has(colKey)} icon={Check} color="blue" shape="circle" />
            </button>
          {/each}
        </div>
      </Dropdown>
    </svelte:fragment>
  </ActionButton>
  <ActionButton icon={RefreshCw} hasDropdown={true} dropdownPosition="right">
    <svelte:fragment slot="dropdown" let:dropdownPosition let:open>
      <Dropdown position={dropdownPosition} minWidth="10rem">
        <button
          type="button"
          on:click={onRefresh}
          class="w-full rounded-lg px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          Refresh library
        </button>
      </Dropdown>
    </svelte:fragment>
  </ActionButton>
  <ActionButton icon={ExternalLink} hasDropdown={true} dropdownPosition="right">
    <svelte:fragment slot="dropdown" let:dropdownPosition let:open>
      <Dropdown position={dropdownPosition} minWidth="10rem">
        <button
          type="button"
          on:click={handleOpen}
          class="w-full rounded-lg px-4 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          {openLabel}
        </button>
      </Dropdown>
    </svelte:fragment>
  </ActionButton>
  <ActionButton
    icon={Rows3}
    hasDropdown={true}
    dropdownPosition="right"
    disabled={disablePaginationControls || isPaginationLoading}
  >
    <svelte:fragment slot="dropdown" let:dropdownPosition>
      <Dropdown position={dropdownPosition} minWidth="10rem">
        <div class="p-3">
          <label for="libraryPageSize" class="mb-2 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Rows per page
          </label>
          <NumberInput
            name="libraryPageSize"
            id="libraryPageSize"
            bind:value={pageSize}
            min={10}
            max={250}
            step={10}
            onchange={onPageSizeInput}
            disabled={disablePaginationControls || isPaginationLoading}
          />
        </div>
      </Dropdown>
    </svelte:fragment>
  </ActionButton>
</ActionsBar>

<div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  <p role="status" aria-live="polite" aria-atomic="true" class="text-sm text-neutral-600 dark:text-neutral-400">
    Showing {displayStart}-{displayEnd} of {totalRecords} records
  </p>
  <nav aria-label="Library pagination" class="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
    <button
      type="button"
      aria-label="Previous page"
      disabled={isPreviousDisabled}
      on:click={onPreviousPage}
      class="rounded p-1 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-700"
    >
      <ChevronLeft size={20} />
    </button>
    <span>Page {page} of {displayTotalPages}</span>
    <button
      type="button"
      aria-label="Next page"
      disabled={isNextDisabled}
      on:click={onNextPage}
      class="rounded p-1 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-700"
    >
      <ChevronRight size={20} />
    </button>
  </nav>
</div>
