<script lang="ts">
  import { onMount } from 'svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import SyncHistoryDiff from '$ui/sync-history/SyncHistoryDiff.svelte';
  import SyncOutcomeList from '$ui/sync-history/SyncOutcomeList.svelte';
  import { SYNC_HISTORY_STATUS_LABEL, syncHistoryStatusVariant } from '$ui/sync-history/syncHistoryStatus.ts';
  import type { SyncHistoryDetail } from '$db/queries/syncHistory.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  type ErrorResponse = { error: string };

  let detail: SyncHistoryDetail | null = null;
  let loading = false;
  let loadError: string | null = null;
  let notFound = false;
  let detailRequestId = 0;

  function formatWhen(iso: string | null): string {
    if (!iso) return '—';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
  }

  function formatDuration(ms: number | null): string {
    if (ms === null || ms < 0) return '—';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  }

  // camelCase section key → "Title Case" (e.g. qualityProfiles → "Quality Profiles").
  function formatSection(section: string): string {
    const spaced = section.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  async function loadDetail() {
    if (data.id === null) return;
    const id = data.id;
    const requestId = ++detailRequestId;
    loading = true;
    loadError = null;
    notFound = false;

    try {
      const response = await fetch(`/api/v1/sync-history/${id}`);
      if (requestId !== detailRequestId) return;

      if (response.status === 404) {
        notFound = true;
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (requestId !== detailRequestId) return;
        loadError = body?.error ?? `Failed to load sync history detail (HTTP ${response.status})`;
        return;
      }

      const next = (await response.json()) as SyncHistoryDetail;
      if (requestId !== detailRequestId) return;
      detail = next;
    } catch (err) {
      if (requestId !== detailRequestId) return;
      loadError = err instanceof Error ? err.message : 'Failed to load sync history detail';
    } finally {
      // loadDetail is the sole owner of `loading` (calls never overlap), so clear it
      // unconditionally.
      loading = false;
    }
  }

  onMount(() => {
    void loadDetail();
  });
</script>

<svelte:head>
  <title>Sync History Detail - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <a href="/sync-history" class="text-accent-600 dark:text-accent-500 text-sm font-medium hover:underline"
      >← Back to sync history</a
    >
  </div>

  {#if data.id === null || data.error}
    <div
      class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
    >
      {data.error ?? 'Invalid sync history id'}
    </div>
  {:else if notFound}
    <div
      class="rounded-lg border border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
    >
      Sync history entry #{data.id} was not found. It may have been pruned by the retention policy.
    </div>
  {:else if loadError}
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
    >
      <span>{loadError}</span>
      <button
        type="button"
        class="rounded-lg border border-red-400 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
        on:click={loadDetail}
      >
        Retry
      </button>
    </div>
  {:else if loading && !detail}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      Loading sync history detail…
    </div>
  {:else if detail}
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {detail.instanceName}
        </h1>
        <Badge variant={detail.arrType}>{detail.arrType}</Badge>
        <Badge variant={syncHistoryStatusVariant(detail.status)}>{SYNC_HISTORY_STATUS_LABEL[detail.status]}</Badge>
      </div>
    </div>

    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Started</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{formatWhen(detail.startedAt)}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Finished</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{formatWhen(detail.finishedAt)}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Duration</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{formatDuration(detail.durationMs)}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Trigger</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">
          {detail.trigger}{#if detail.triggerEvent}
            <span class="text-neutral-500 dark:text-neutral-400"> ({detail.triggerEvent})</span>
          {/if}
        </dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Sections run</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{detail.sectionsRun} / {detail.sectionsAttempted.length}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Items synced</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{detail.itemsSynced}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Failures</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{detail.failureCount}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Changes</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{detail.entityChangeCount}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Confirmed outcomes</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{detail.entityOutcomeCount}</dd>
      </div>
      {#if detail.previewId}
        <div>
          <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Preview</dt>
          <dd class="truncate font-mono text-xs text-neutral-900 dark:text-neutral-100" title={detail.previewId}>
            {detail.previewId}
          </dd>
        </div>
      {/if}
    </dl>

    {#if detail.error}
      <div
        class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
      >
        {detail.error}
      </div>
    {/if}

    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Sections <span class="text-neutral-500 dark:text-neutral-400">({detail.sectionResults.length})</span>
      </h2>
      {#if detail.sectionResults.length === 0}
        <p class="text-sm text-neutral-500 dark:text-neutral-400">No per-section results were recorded for this run.</p>
      {:else}
        <ul class="space-y-2">
          {#each detail.sectionResults as result (result.section)}
            <li
              class="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800"
            >
              <span class="font-medium text-neutral-900 dark:text-neutral-100">{formatSection(result.section)}</span>
              <Badge variant={syncHistoryStatusVariant(result.status)}>{SYNC_HISTORY_STATUS_LABEL[result.status]}</Badge
              >
              <span class="text-xs text-neutral-500 dark:text-neutral-400">{result.itemsSynced} items</span>
              {#if result.failedProfiles && result.failedProfiles.length > 0}
                <span class="text-xs text-amber-700 dark:text-amber-300">
                  Failed profiles: {result.failedProfiles.join(', ')}
                </span>
              {/if}
              {#if result.error}
                <span class="text-xs text-red-700 dark:text-red-300">{result.error}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="space-y-3">
      <div class="space-y-1">
        <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Confirmed outcomes <span class="text-neutral-500 dark:text-neutral-400">({detail.entityOutcomes.length})</span>
        </h2>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          Per-entity results captured from the actual Arr writes — distinct from the planned changes below.
        </p>
      </div>
      {#if detail.entityOutcomes.length === 0}
        <div
          class="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          No confirmed per-entity outcomes were recorded for this run. Runs predating this feature, or runs where every
          section was skipped, have none.
        </div>
      {:else}
        <SyncOutcomeList outcomes={detail.entityOutcomes} />
      {/if}
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Planned changes <span class="text-neutral-500 dark:text-neutral-400">({detail.changes.length})</span>
      </h2>
      {#if detail.changes.length === 0}
        <div
          class="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          No entity-level changes were captured for this run — see the per-section outcomes above. Some sections (such
          as media management) or runs where the pre-sync diff could not be captured do not record entity detail.
        </div>
      {:else}
        <SyncHistoryDiff changes={detail.changes} />
      {/if}
    </section>
  {/if}
</div>
