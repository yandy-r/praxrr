<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RefreshCw } from 'lucide-svelte';
  import type { components } from '$api/v1.d.ts';
  import { alertStore } from '$alerts/store';
  import Card from '$ui/card/Card.svelte';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import CollapsibleCard from '$ui/card/CollapsibleCard.svelte';
  import NarrationBlock from '$lib/client/ui/narration/NarrationBlock.svelte';
  import { HEALTH_BAND_LABEL, HEALTH_BAND_TEXT_CLASS, bandVariant } from '$ui/health/healthStatus.ts';
  import type { ConfigHealthDetailResponse, WireCriterion } from '$server/health/responses.ts';
  import TrendFilters, { type TrendFilterSelection } from './components/TrendFilters.svelte';
  import HealthTrendChart from './components/HealthTrendChart.svelte';
  import HealthTrendTable from './components/HealthTrendTable.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  type ConfigHealthTrendsResponse = components['schemas']['ConfigHealthTrendsResponse'];
  type ErrorResponse = { error: string };

  const TREND_TIME_ZONE = 'UTC';
  const DEFAULT_TREND_FILTER: TrendFilterSelection = {
    range: '30',
    days: 30,
    from: null,
    to: null,
    profile: null,
  };

  function formatWhen(iso: string | null): string {
    if (!iso) return 'Never';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? 'Never' : parsed.toLocaleString();
  }

  function formatScore(score: number | null): string {
    return score === null ? '—' : String(score);
  }

  function formatContribution(criterion: WireCriterion): string {
    if (criterion.score === null) return 'Not evaluated';
    return `+${criterion.contribution} pts`;
  }

  function trendRequestUrl(instanceId: number, filter: TrendFilterSelection): string {
    const params = new URLSearchParams();
    if (filter.days !== null) params.set('days', String(filter.days));
    if (filter.range === 'custom' && filter.from !== null) params.set('from', filter.from);
    if (filter.range === 'custom' && filter.to !== null) params.set('to', filter.to);
    if (filter.profile !== null) params.set('profile', filter.profile);
    const query = params.toString();
    return `/api/v1/config-health/${instanceId}/trends${query ? `?${query}` : ''}`;
  }

  function exportUrl(result: ConfigHealthTrendsResponse, format: 'json' | 'csv'): string {
    if (data.instanceId === null) return '#';
    const params = new URLSearchParams({ format });
    if (result.normalizedFilter.from !== null) params.set('from', result.normalizedFilter.from);
    params.set('to', result.normalizedFilter.to);
    if (result.normalizedFilter.profile !== null) params.set('profile', result.normalizedFilter.profile);
    return `/api/v1/config-health/${data.instanceId}/trends/export?${params.toString()}`;
  }

  let detail: ConfigHealthDetailResponse | null = null;
  let detailLoading = false;
  let recomputing = false;
  let detailError: string | null = null;
  let detailRequestId = 0;
  let verbose = false;

  let trendResult: ConfigHealthTrendsResponse | null = null;
  let trendLoading = false;
  let trendError: string | null = null;
  let trendStatus = 'Trend history has not loaded yet.';
  let trendRequestId = 0;
  let trendAbortController: AbortController | null = null;
  let appliedTrendFilter: TrendFilterSelection = DEFAULT_TREND_FILTER;
  let failedTrendFilter: TrendFilterSelection | null = null;

  async function loadTrends(filter: TrendFilterSelection): Promise<void> {
    if (data.instanceId === null) return;
    const instanceId = data.instanceId;
    const requestId = ++trendRequestId;
    trendAbortController?.abort();
    const controller = new AbortController();
    trendAbortController = controller;
    trendLoading = true;
    trendError = null;
    trendStatus = trendResult
      ? 'Updating trend history. The previous successful result remains visible.'
      : 'Loading trend history.';

    try {
      const response = await fetch(trendRequestUrl(instanceId, filter), { signal: controller.signal });
      if (requestId !== trendRequestId) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (requestId !== trendRequestId) return;
        throw new Error(body?.error ?? `Failed to load trend history (HTTP ${response.status})`);
      }

      const nextResult = (await response.json()) as ConfigHealthTrendsResponse;
      if (requestId !== trendRequestId) return;
      trendResult = nextResult;
      appliedTrendFilter = { ...filter };
      failedTrendFilter = null;
      trendStatus = `Trend history updated: ${nextResult.counts.points} persisted snapshot${nextResult.counts.points === 1 ? '' : 's'}.`;
    } catch (error) {
      if (controller.signal.aborted || requestId !== trendRequestId) return;
      trendError = error instanceof Error ? error.message : 'Failed to load trend history';
      failedTrendFilter = { ...filter };
      trendStatus = trendResult
        ? 'Trend update failed. The previous successful result remains visible.'
        : 'Trend history failed to load.';
    } finally {
      if (requestId === trendRequestId) {
        trendLoading = false;
        if (trendAbortController === controller) trendAbortController = null;
      }
    }
  }

  async function loadDetail(): Promise<void> {
    if (data.instanceId === null) return;
    const instanceId = data.instanceId;
    const requestId = ++detailRequestId;
    detailLoading = true;
    detailError = null;

    try {
      const response = await fetch(`/api/v1/config-health/${instanceId}`);
      if (requestId !== detailRequestId) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (requestId !== detailRequestId) return;
        detailError = body?.error ?? `Failed to load config health (HTTP ${response.status})`;
        return;
      }

      const nextDetail = (await response.json()) as ConfigHealthDetailResponse;
      if (requestId !== detailRequestId) return;
      detail = nextDetail;
    } catch (err) {
      if (requestId !== detailRequestId) return;
      detailError = err instanceof Error ? err.message : 'Failed to load config health';
    } finally {
      if (requestId === detailRequestId) detailLoading = false;
    }
  }

  /**
   * On-demand recompute: POST to persist a fresh snapshot, then adopt the returned detail and reload
   * the applied trend selection so eligible history gains the new point. Distinct from Refresh (a free,
   * unthrottled GET re-read that persists nothing). Rate-limited (429) and in-flight-bounded (409) per
   * instance; scoring does no live Arr I/O, so a degraded instance still returns 200 (`unknown` band).
   */
  async function recompute() {
    if (data.instanceId === null || recomputing) return;
    const instanceId = data.instanceId;
    // Supersede an in-flight detail GET so it cannot clobber the persisted recompute response.
    const requestId = ++detailRequestId;
    detailLoading = false;
    recomputing = true;

    try {
      const response = await fetch(`/api/v1/config-health/${instanceId}/recompute`, { method: 'POST' });

      if (response.status === 429) {
        alertStore.add('warning', 'Too many recompute requests for this instance — try again shortly.');
        return;
      }
      if (response.status === 409) {
        alertStore.add('info', 'A config health recompute for this instance is already in progress.');
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        alertStore.add('error', body?.error ?? `Failed to recompute config health (HTTP ${response.status})`);
        return;
      }

      const nextDetail = (await response.json()) as ConfigHealthDetailResponse;
      if (requestId !== detailRequestId) return;
      detail = nextDetail;
      detailError = null;
      void loadTrends(appliedTrendFilter);
      alertStore.add('success', `Health recomputed and saved — status: ${HEALTH_BAND_LABEL[nextDetail.overall.band]}.`);
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to recompute config health');
    } finally {
      recomputing = false;
    }
  }

  function applyTrendFilters(event: CustomEvent<TrendFilterSelection>): void {
    void loadTrends(event.detail);
  }

  function retryTrends(): void {
    void loadTrends(failedTrendFilter ?? appliedTrendFilter);
  }

  function refreshTrends(): void {
    void loadTrends(appliedTrendFilter);
  }

  function showAllRetained(): void {
    void loadTrends({
      range: 'all',
      days: null,
      from: null,
      to: null,
      profile: appliedTrendFilter.profile,
    });
  }

  function appliedRangeText(result: ConfigHealthTrendsResponse, filter: TrendFilterSelection): string {
    const from = result.normalizedFilter.from ?? 'earliest retained evidence';
    const to = result.normalizedFilter.to;
    if (filter.range === 'all') return `All retained history through ${to}`;
    if (filter.days !== null) return `Last ${filter.days} days (${from} through ${to})`;
    return `${from} through ${to}`;
  }

  function evidenceStateText(result: ConfigHealthTrendsResponse): string {
    if (result.points.length === 0) {
      return appliedTrendFilter.range === 'all'
        ? 'No Config Health snapshots have been collected or remain retained for this instance.'
        : 'No snapshots match the applied range. Try a wider range or All retained.';
    }
    if (result.points.length === 1)
      return 'One persisted point is available; it does not establish a direction of change.';
    if (result.counts.measured === 0) {
      return `All ${result.counts.points} points are explicit unknown, missing, or not-recorded evidence gaps.`;
    }
    const gaps = result.counts.unknown + result.counts.missing;
    return gaps > 0
      ? `${result.counts.measured} measured point${result.counts.measured === 1 ? '' : 's'} and ${gaps} explicit evidence gap${gaps === 1 ? '' : 's'}.`
      : `${result.counts.measured} measured points with no missing or unknown evidence in this selection.`;
  }

  function retentionText(result: ConfigHealthTrendsResponse): string {
    const countPolicy =
      result.retention.maxEntries > 0
        ? `${result.retention.maxEntries} snapshots across all instances`
        : 'no configured snapshot-count cap';
    const earliest = result.retention.oldestAvailableAt ?? 'none in this selection';
    return `Current policy retains up to ${result.retention.days} days and ${countPolicy}. Earliest evidence shown here: ${earliest}. Older evidence may have been pruned; this view cannot identify which policy removed it.`;
  }

  function engineContextText(result: ConfigHealthTrendsResponse): string {
    const storedVersions = [...new Set(result.engineBoundaries.map((boundary) => boundary.engineVersion))];
    const history = storedVersions.length > 0 ? storedVersions.map((version) => `v${version}`).join(', ') : 'none';
    return `Current engine v${result.currentEngineVersion}. Stored versions in this selection: ${history}. Engine boundaries separate comparable runs; no cross-version delta is inferred.`;
  }

  $: jsonExportHref = trendResult ? exportUrl(trendResult, 'json') : null;
  $: csvExportHref = trendResult ? exportUrl(trendResult, 'csv') : null;

  onMount(() => {
    void loadDetail();
    void loadTrends(DEFAULT_TREND_FILTER);
  });

  onDestroy(() => {
    detailRequestId += 1;
    trendRequestId += 1;
    trendAbortController?.abort();
  });
</script>

<svelte:head>
  <title>Config Health Detail - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <a href="/config-health" class="text-accent-600 dark:text-accent-500 text-sm font-medium hover:underline"
      >← Back to config health</a
    >
  </div>

  {#if data.instanceId === null || data.error}
    <div
      class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
    >
      {data.error ?? 'Invalid instance ID'}
    </div>
  {:else}
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {detail?.instanceName ?? `Instance ${data.instanceId}`}
        </h1>
        {#if detail}
          <Badge variant={detail.arrType}>{detail.arrType}</Badge>
          <Badge variant={bandVariant(detail.overall.band)}>{HEALTH_BAND_LABEL[detail.overall.band]}</Badge>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          title="Re-read the current computed health (does not save a trend snapshot)"
          class="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          disabled={detailLoading || recomputing}
          onclick={loadDetail}
        >
          <RefreshCw size={14} class={detailLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          type="button"
          title="Recompute from stored drift and configuration and save a trend snapshot"
          class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          disabled={recomputing || (detailLoading && !detail)}
          onclick={recompute}
        >
          <RefreshCw size={14} class={recomputing ? 'animate-spin' : ''} />
          Recompute
        </button>
      </div>
    </div>

    {#if detailError}
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
      >
        <span>{detailError}</span>
        <button
          type="button"
          class="rounded-lg border border-red-400 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
          onclick={loadDetail}
        >
          Retry current health
        </button>
      </div>
    {/if}

    {#if detailLoading && !detail}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        Loading config health…
      </div>
    {/if}

    {#if detail}
      <div class="flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          Overall score
          <span class="ml-1 text-base font-bold {HEALTH_BAND_TEXT_CLASS[detail.overall.band]}"
            >{detail.overall.band === 'unknown' ? '—' : detail.overall.score}</span
          >
        </span>
        <span>Engine v{detail.engineVersion}</span>
        <span>Scored {formatWhen(detail.generatedAt)}</span>
      </div>

      <!-- Overall criteria contributions -->
      <section class="space-y-3">
        <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Overall breakdown</h2>
        <CardGrid columns={4}>
          {#each detail.overall.criteria as criterion (criterion.id)}
            <Card>
              <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                {criterion.label}
              </p>
              <p class="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                {formatScore(criterion.score)}
              </p>
              <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{formatContribution(criterion)}</p>
            </Card>
          {/each}
        </CardGrid>
      </section>

      <!-- Suggestions -->
      {#if detail.overall.suggestions.length > 0}
        <CollapsibleCard title="Suggestions" description="Non-judgemental remediation hints for this instance.">
          <div class="space-y-3">
            <div class="flex justify-end">
              <button
                type="button"
                class="text-accent-600 dark:text-accent-500 text-xs font-medium hover:underline"
                onclick={() => (verbose = !verbose)}
              >
                {verbose ? 'Hide details' : 'Show details'}
              </button>
            </div>
            {#each detail.overall.suggestions as suggestion (suggestion.headline)}
              <NarrationBlock line={suggestion} {verbose} />
            {/each}
          </div>
        </CollapsibleCard>
      {/if}

      <!-- Per-profile breakdown -->
      {#if detail.profiles.length > 0}
        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Profiles <span class="text-neutral-500 dark:text-neutral-400">({detail.profiles.length})</span>
          </h2>
          <div class="space-y-3">
            {#each detail.profiles as profile (profile.name)}
              <Card>
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="flex flex-wrap items-center gap-3">
                    <span class="font-medium text-neutral-900 dark:text-neutral-100">{profile.name}</span>
                    <Badge variant={bandVariant(profile.band)}>{HEALTH_BAND_LABEL[profile.band]}</Badge>
                  </div>
                  <span class="text-sm font-bold {HEALTH_BAND_TEXT_CLASS[profile.band]}">
                    {profile.band === 'unknown' ? '—' : profile.score}
                  </span>
                </div>
                <div class="mt-3 flex flex-wrap gap-2">
                  {#each profile.criteria as criterion (criterion.id)}
                    <span
                      class="inline-flex items-center gap-1.5 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
                    >
                      <span class="font-medium text-neutral-900 dark:text-neutral-100">{criterion.label}</span>
                      <span class="text-neutral-500 dark:text-neutral-400">{formatContribution(criterion)}</span>
                    </span>
                  {/each}
                </div>
              </Card>
            {/each}
          </div>
        </section>
      {/if}
    {/if}

    <section
      class="space-y-4 border-t border-neutral-200 pt-6 dark:border-neutral-800"
      aria-label="Config Health history"
    >
      <TrendFilters
        instances={data.instances}
        instanceId={data.instanceId}
        availableProfiles={trendResult?.availableProfiles ?? []}
        appliedFilter={appliedTrendFilter}
        on:apply={applyTrendFilters}
      />

      <p class="text-sm text-neutral-600 dark:text-neutral-300" role="status" aria-live="polite">
        {trendStatus}
      </p>

      {#if trendError}
        <div
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
        >
          <div>
            <p class="font-medium">Trend history could not be updated.</p>
            <p class="mt-1">{trendError}</p>
            {#if trendResult}
              <p class="mt-1 text-xs">The previous successful result remains below with its original applied labels.</p>
            {/if}
          </div>
          <button
            type="button"
            class="rounded-lg border border-red-400 px-3 py-2 text-sm font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
            onclick={retryTrends}
          >
            Retry trend request
          </button>
        </div>
      {/if}

      {#if trendLoading && !trendResult}
        <div
          class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
          aria-busy="true"
        >
          Loading persisted trend evidence…
        </div>
      {/if}

      {#if trendResult}
        <div class="space-y-4" aria-busy={trendLoading}>
          <div
            class="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div class="min-w-0 space-y-1">
              <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Applied historical evidence
              </h2>
              <p class="text-sm break-words text-neutral-600 dark:text-neutral-300">
                {appliedRangeText(trendResult, appliedTrendFilter)} · {trendResult.normalizedFilter.profile === null
                  ? 'Overall health'
                  : `Exact profile: ${trendResult.normalizedFilter.profile}`}
              </p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                {trendResult.counts.points} point{trendResult.counts.points === 1 ? '' : 's'} · Times shown in
                {TREND_TIME_ZONE}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                onclick={refreshTrends}
              >
                <RefreshCw size={14} class={trendLoading ? 'animate-spin' : ''} />
                Refresh history
              </button>
              {#if jsonExportHref && csvExportHref}
                <a
                  href={jsonExportHref}
                  class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 rounded-lg px-3 py-2 text-sm font-medium text-white"
                >
                  Export JSON
                </a>
                <a
                  href={csvExportHref}
                  class="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  Export CSV
                </a>
              {/if}
            </div>
          </div>

          <div
            class="rounded-lg border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-200"
          >
            <p>{evidenceStateText(trendResult)}</p>
            {#if trendResult.points.length === 0 && appliedTrendFilter.range !== 'all'}
              <button
                type="button"
                class="text-accent-600 dark:text-accent-400 mt-2 font-medium hover:underline"
                onclick={showAllRetained}
              >
                Show all retained history
              </button>
            {/if}
          </div>

          <div class="grid gap-3 lg:grid-cols-2">
            <div
              class="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
            >
              <h3 class="font-semibold text-neutral-900 dark:text-neutral-100">Retention context</h3>
              <p class="mt-1">{retentionText(trendResult)}</p>
            </div>
            <div
              class="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300"
            >
              <h3 class="font-semibold text-neutral-900 dark:text-neutral-100">Engine context</h3>
              <p class="mt-1">{engineContextText(trendResult)}</p>
            </div>
          </div>

          <HealthTrendChart result={trendResult} />
          <HealthTrendTable result={trendResult} timeZone={TREND_TIME_ZONE} />
        </div>
      {/if}
    </section>
  {/if}
</div>
