<script lang="ts">
  import { onMount } from 'svelte';
  import { RefreshCw } from 'lucide-svelte';
  import { alertStore } from '$alerts/store';
  import Card from '$ui/card/Card.svelte';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import CollapsibleCard from '$ui/card/CollapsibleCard.svelte';
  import NarrationBlock from '$lib/client/ui/narration/NarrationBlock.svelte';
  import { HEALTH_BAND_LABEL, HEALTH_BAND_TEXT_CLASS, bandVariant } from '$ui/health/healthStatus.ts';
  import type {
    ConfigHealthDetailResponse,
    ConfigHealthTrendPoint,
    ConfigHealthTrendsResponse,
    WireCriterion,
  } from '$server/health/responses.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  type ErrorResponse = { error: string };

  // Trend sparkline geometry — a fixed-viewBox SVG scaled by CSS, so no layout math is needed.
  const SPARK_W = 320;
  const SPARK_H = 56;
  const TREND_DAYS = 30;

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

  function scoreToY(score: number): number {
    const clamped = Math.max(0, Math.min(100, score));
    return SPARK_H - (clamped / 100) * SPARK_H;
  }

  function buildSparkline(points: readonly ConfigHealthTrendPoint[]): string {
    if (points.length === 0) return '';
    if (points.length === 1) {
      const y = scoreToY(points[0].overallScore).toFixed(2);
      return `0,${y} ${SPARK_W},${y}`;
    }
    const stepX = SPARK_W / (points.length - 1);
    return points.map((p, i) => `${(i * stepX).toFixed(2)},${scoreToY(p.overallScore).toFixed(2)}`).join(' ');
  }

  let detail: ConfigHealthDetailResponse | null = null;
  let trends: ConfigHealthTrendsResponse | null = null;
  let loading = false;
  let recomputing = false;
  let loadError: string | null = null;
  let detailRequestId = 0;
  let verbose = false;

  // Trends are supplementary — a failure to load the sparkline series must not blank the report that
  // already resolved, so it is fetched and guarded independently under the shared supersede guard.
  async function loadTrends(instanceId: number, requestId: number) {
    try {
      const trendResponse = await fetch(`/api/v1/config-health/${instanceId}/trends?days=${TREND_DAYS}`);
      if (requestId !== detailRequestId) return;
      if (trendResponse.ok) {
        const nextTrends = (await trendResponse.json()) as ConfigHealthTrendsResponse;
        if (requestId !== detailRequestId) return;
        trends = nextTrends;
      }
    } catch {
      /* sparkline is optional; ignore trend fetch failures */
    }
  }

  async function loadAll() {
    if (data.instanceId === null) return;
    const instanceId = data.instanceId;
    const requestId = ++detailRequestId;
    loading = true;
    loadError = null;

    try {
      const response = await fetch(`/api/v1/config-health/${instanceId}`);
      if (requestId !== detailRequestId) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (requestId !== detailRequestId) return;
        loadError = body?.error ?? `Failed to load config health (HTTP ${response.status})`;
        return;
      }

      const nextDetail = (await response.json()) as ConfigHealthDetailResponse;
      if (requestId !== detailRequestId) return;
      detail = nextDetail;

      await loadTrends(instanceId, requestId);
    } catch (err) {
      if (requestId !== detailRequestId) return;
      loadError = err instanceof Error ? err.message : 'Failed to load config health';
    } finally {
      if (requestId === detailRequestId) loading = false;
    }
  }

  /**
   * On-demand recompute: POST to persist a fresh snapshot, then adopt the returned detail and reload
   * the trend series so the sparkline gains exactly one point. Distinct from Refresh (a free,
   * unthrottled GET re-read that persists nothing). Rate-limited (429) and in-flight-bounded (409) per
   * instance; scoring does no live Arr I/O, so a degraded instance still returns 200 (`unknown` band).
   */
  async function recompute() {
    if (data.instanceId === null || recomputing) return;
    const instanceId = data.instanceId;
    // Supersede any in-flight GET so a slow Refresh can't clobber the POST result assigned below.
    const requestId = ++detailRequestId;
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
      loadError = null;
      await loadTrends(instanceId, requestId);
      alertStore.add('success', `Health recomputed and saved — status: ${HEALTH_BAND_LABEL[nextDetail.overall.band]}.`);
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to recompute config health');
    } finally {
      recomputing = false;
    }
  }

  $: sparklinePoints = buildSparkline(trends?.points ?? []);

  onMount(() => {
    void loadAll();
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
          disabled={loading || recomputing}
          on:click={loadAll}
        >
          <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          type="button"
          title="Recompute from stored drift and configuration and save a trend snapshot"
          class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          disabled={recomputing || (loading && !detail)}
          on:click={recompute}
        >
          <RefreshCw size={14} class={recomputing ? 'animate-spin' : ''} />
          Recompute
        </button>
      </div>
    </div>

    {#if loadError}
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
      >
        <span>{loadError}</span>
        <button
          type="button"
          class="rounded-lg border border-red-400 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
          on:click={loadAll}
        >
          Retry
        </button>
      </div>
    {:else if loading && !detail}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        Loading config health…
      </div>
    {:else if detail}
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

      <!-- Trend sparkline -->
      {#if trends && trends.points.length > 0}
        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Trend <span class="text-neutral-500 dark:text-neutral-400">(last {TREND_DAYS} days)</span>
          </h2>
          <Card>
            <svg
              viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
              width="100%"
              height={SPARK_H}
              preserveAspectRatio="none"
              role="img"
              aria-label="Overall score trend"
              class={HEALTH_BAND_TEXT_CLASS[detail.overall.band]}
            >
              <polyline
                points={sparklinePoints}
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
              />
            </svg>
            <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              {trends.points.length} snapshot{trends.points.length === 1 ? '' : 's'}
            </p>
          </Card>
        </section>
      {/if}

      <!-- Suggestions -->
      {#if detail.overall.suggestions.length > 0}
        <CollapsibleCard title="Suggestions" description="Non-judgemental remediation hints for this instance.">
          <div class="space-y-3">
            <div class="flex justify-end">
              <button
                type="button"
                class="text-accent-600 dark:text-accent-500 text-xs font-medium hover:underline"
                on:click={() => (verbose = !verbose)}
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
  {/if}
</div>
