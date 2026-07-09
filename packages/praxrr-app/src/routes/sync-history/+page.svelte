<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { History, Download, ChevronLeft, ChevronRight, X } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Table from '$ui/table/Table.svelte';
  import Button from '$ui/button/Button.svelte';
  import DropdownSelect from '$ui/dropdown/DropdownSelect.svelte';
  import EmptyState from '$ui/state/EmptyState.svelte';
  import type { Column } from '$ui/table/types';
  import type { SyncHistorySummary } from '$db/queries/syncHistory.ts';
  import type {
    SyncOperationStatus,
    SyncPreviewArrType,
    SyncPreviewSection,
    SyncTrigger,
  } from '$sync/syncHistory/types.ts';
  import {
    SYNC_HISTORY_STATUS_LABEL,
    syncHistoryStatusVariant,
    type SyncHistoryBadgeVariant,
  } from '$ui/sync-history/syncHistoryStatus.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  // --- Filter option catalogs -------------------------------------------------

  const TRIGGER_LABEL: Record<SyncTrigger, string> = {
    manual: 'Manual',
    schedule: 'Schedule',
    system: 'System',
  };

  const SECTION_LABEL: Record<SyncPreviewSection, string> = {
    qualityProfiles: 'Quality Profiles',
    delayProfiles: 'Delay Profiles',
    mediaManagement: 'Media Management',
    metadataProfiles: 'Metadata Profiles',
  };

  const ARR_TYPE_LABEL: Record<SyncPreviewArrType, string> = {
    radarr: 'Radarr',
    sonarr: 'Sonarr',
    lidarr: 'Lidarr',
  };

  const statusOptions = [
    { value: '', label: 'All statuses' },
    ...(Object.keys(SYNC_HISTORY_STATUS_LABEL) as SyncOperationStatus[]).map((value) => ({
      value,
      label: SYNC_HISTORY_STATUS_LABEL[value],
    })),
  ];

  const triggerOptions = [
    { value: '', label: 'All triggers' },
    ...(Object.keys(TRIGGER_LABEL) as SyncTrigger[]).map((value) => ({ value, label: TRIGGER_LABEL[value] })),
  ];

  const sectionOptions = [
    { value: '', label: 'All sections' },
    ...(Object.keys(SECTION_LABEL) as SyncPreviewSection[]).map((value) => ({ value, label: SECTION_LABEL[value] })),
  ];

  const arrTypeOptions = [
    { value: '', label: 'All apps' },
    ...(Object.keys(ARR_TYPE_LABEL) as SyncPreviewArrType[]).map((value) => ({ value, label: ARR_TYPE_LABEL[value] })),
  ];

  $: instanceOptions = [
    { value: '', label: 'All instances' },
    ...data.instances.map((instance) => ({ value: String(instance.id), label: instance.name })),
  ];

  // --- Badge rendering (Table cells accept html strings only) -----------------

  const BADGE_BASE = 'inline-flex items-center gap-1 rounded font-medium px-1.5 py-0.5 text-[10px]';

  const STATUS_BADGE_CLASS: Record<SyncHistoryBadgeVariant, string> = {
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    danger: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  };

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusBadgeHtml(status: SyncOperationStatus): string {
    const variant = syncHistoryStatusVariant(status);
    return `<span class="${BADGE_BASE} ${STATUS_BADGE_CLASS[variant]}">${SYNC_HISTORY_STATUS_LABEL[status]}</span>`;
  }

  function triggerBadgeHtml(trigger: SyncTrigger): string {
    const label = TRIGGER_LABEL[trigger] ?? trigger;
    return `<span class="${BADGE_BASE} ${STATUS_BADGE_CLASS.neutral}">${escapeHtml(label)}</span>`;
  }

  function arrTypeBadgeHtml(arrType: SyncPreviewArrType): string {
    return `<span style="background-color: var(--arr-${arrType}-color); color: #111827;" class="${BADGE_BASE}">${escapeHtml(arrType)}</span>`;
  }

  function formatWhen(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
  }

  const columns: Column<SyncHistorySummary>[] = [
    {
      key: 'startedAt',
      header: 'Started',
      width: '180px',
      cell: (row) => ({
        html: `<span class="font-mono text-xs text-neutral-600 dark:text-neutral-400">${escapeHtml(formatWhen(row.startedAt))}</span>`,
      }),
    },
    {
      key: 'instanceName',
      header: 'Instance',
      cell: (row) => ({
        html: `<div class="flex items-center gap-2"><span class="font-medium text-neutral-900 dark:text-neutral-100">${escapeHtml(row.instanceName)}</span>${arrTypeBadgeHtml(row.arrType)}</div>`,
      }),
    },
    {
      key: 'trigger',
      header: 'Trigger',
      cell: (row) => ({ html: triggerBadgeHtml(row.trigger) }),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => ({ html: statusBadgeHtml(row.status) }),
    },
    {
      key: 'sectionsRun',
      header: 'Sections',
      align: 'right',
      cell: (row) => String(row.sectionsRun),
    },
    {
      key: 'itemsSynced',
      header: 'Items',
      align: 'right',
      cell: (row) => String(row.itemsSynced),
    },
    {
      key: 'entityChangeCount',
      header: 'Changes',
      align: 'right',
      cell: (row) => String(row.entityChangeCount),
    },
    {
      key: 'failureCount',
      header: 'Failures',
      align: 'right',
      cell: (row) => ({
        html:
          row.failureCount > 0
            ? `<span class="font-semibold text-red-600 dark:text-red-400">${row.failureCount}</span>`
            : '<span class="text-neutral-400 dark:text-neutral-500">0</span>',
      }),
    },
  ];

  // --- URL-driven filter + pagination state -----------------------------------

  // Local mirrors for the free-text + date inputs (native inputs, applied on change).
  let qValue = data.filters.q ?? '';
  let fromValue = (data.filters.from ?? '').slice(0, 10);
  let toValue = (data.filters.to ?? '').slice(0, 10);

  function updateParams(next: Record<string, string | number | undefined | null>) {
    const url = new URL($page.url);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === null || value === '') {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    goto(url.toString(), { invalidateAll: true });
  }

  // Any filter change resets pagination to the first page.
  function setFilter(key: string, value: string | number | undefined) {
    updateParams({ [key]: value, page: undefined });
  }

  function clearFilters() {
    qValue = '';
    fromValue = '';
    toValue = '';
    goto('/sync-history', { invalidateAll: true });
  }

  function goToPage(pageNum: number) {
    updateParams({ page: pageNum });
  }

  // --- Derived view state -----------------------------------------------------

  $: successCount = data.rows.filter((row) => row.status === 'success').length;
  $: partialCount = data.rows.filter((row) => row.status === 'partial').length;
  $: failedCount = data.rows.filter((row) => row.status === 'failed').length;

  $: totalPages = data.pageSize > 0 ? Math.ceil(data.total / data.pageSize) : 0;
  $: currentPage = data.page;

  $: hasActiveFilters = Boolean(
    data.filters.q ||
    data.filters.status ||
    data.filters.trigger ||
    data.filters.section ||
    data.filters.arrType ||
    data.filters.instanceId !== undefined ||
    data.filters.from ||
    data.filters.to
  );

  $: showEmptyState = data.total === 0 && !hasActiveFilters;

  // Export shares the active filters (minus pagination) and appends a format param.
  $: exportQuery = (() => {
    const params = new URLSearchParams($page.url.searchParams);
    params.delete('page');
    params.delete('pageSize');
    return params.toString();
  })();
  $: exportJsonHref = `/api/v1/sync-history/export?${exportQuery ? `${exportQuery}&` : ''}format=json`;
  $: exportCsvHref = `/api/v1/sync-history/export?${exportQuery ? `${exportQuery}&` : ''}format=csv`;
</script>

<svelte:head>
  <title>Sync History - Praxrr</title>
</svelte:head>

<div class="space-y-8">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Sync History</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Every Arr sync run recorded as a durable audit entry — trigger, target instance, per-section outcomes, and the
        applied configuration changes.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Button href={exportJsonHref} text="Export JSON" icon={Download} variant="secondary" />
      <Button href={exportCsvHref} text="Export CSV" icon={Download} variant="secondary" />
    </div>
  </div>

  {#if showEmptyState}
    <EmptyState
      icon={History}
      title="No sync history yet"
      description="Sync runs are recorded here after you sync a Radarr, Sonarr, or Lidarr instance."
      buttonText="View Arr instances"
      buttonHref="/arr"
    />
  {:else}
    <!-- KPI row -->
    <CardGrid columns={4}>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Total runs</p>
        <p class="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{data.total}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Success (page)</p>
        <p class="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{successCount}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Partial (page)</p>
        <p class="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">{partialCount}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Failed (page)</p>
        <p class="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{failedCount}</p>
      </Card>
    </CardGrid>

    <!-- Filter bar -->
    <div class="flex flex-wrap items-end gap-3">
      <label class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
        Search
        <input
          type="search"
          placeholder="Instance or error…"
          class="w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          bind:value={qValue}
          on:change={() => setFilter('q', qValue.trim() || undefined)}
        />
      </label>

      <DropdownSelect
        label="Status"
        value={data.filters.status ?? ''}
        options={statusOptions}
        on:change={(event) => setFilter('status', event.detail || undefined)}
      />
      <DropdownSelect
        label="Trigger"
        value={data.filters.trigger ?? ''}
        options={triggerOptions}
        on:change={(event) => setFilter('trigger', event.detail || undefined)}
      />
      <DropdownSelect
        label="Section"
        value={data.filters.section ?? ''}
        options={sectionOptions}
        on:change={(event) => setFilter('section', event.detail || undefined)}
      />
      <DropdownSelect
        label="App"
        value={data.filters.arrType ?? ''}
        options={arrTypeOptions}
        on:change={(event) => setFilter('arrType', event.detail || undefined)}
      />
      <DropdownSelect
        label="Instance"
        value={data.filters.instanceId !== undefined ? String(data.filters.instanceId) : ''}
        options={instanceOptions}
        on:change={(event) => setFilter('instanceId', event.detail || undefined)}
      />

      <label class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
        From
        <input
          type="date"
          class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          bind:value={fromValue}
          on:change={() => setFilter('from', fromValue || undefined)}
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
        To
        <input
          type="date"
          class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          bind:value={toValue}
          on:change={() => setFilter('to', toValue || undefined)}
        />
      </label>

      {#if hasActiveFilters}
        <Button text="Clear" icon={X} variant="ghost" on:click={clearFilters} />
      {/if}
    </div>

    <!-- Results -->
    <Table
      {columns}
      data={data.rows}
      rowHref={(row) => `/sync-history/${row.id}`}
      emptyMessage="No sync runs match these filters."
      hoverable
      compact
      responsive
    />

    <!-- Server pagination -->
    {#if totalPages > 1}
      <div class="flex items-center justify-between text-sm text-neutral-600 dark:text-neutral-400">
        <span>Page {currentPage} of {totalPages} · {data.total} total</span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            disabled={currentPage <= 1}
            on:click={() => goToPage(currentPage - 1)}
            class="flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-1.5 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            on:click={() => goToPage(currentPage + 1)}
            class="flex items-center gap-1 rounded-lg border border-neutral-300 px-3 py-1.5 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>
