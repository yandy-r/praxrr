<script lang="ts">
  import { onMount } from 'svelte';
  import { RefreshCw, Activity } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import EmptyState from '$ui/state/EmptyState.svelte';
  import { HEALTH_BAND_LABEL, HEALTH_BAND_TEXT_CLASS, bandVariant } from '$ui/health/healthStatus.ts';
  import { bandFor } from '$shared/health/index.ts';
  import type { ConfigHealthSummaryResponse } from '$server/health/responses.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  type ErrorResponse = { error: string };

  function formatWhen(iso: string | null): string {
    if (!iso) return 'Never';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? 'Never' : parsed.toLocaleString();
  }

  let summary: ConfigHealthSummaryResponse | null = null;
  let loading = false;
  let loadError: string | null = null;
  let summaryRequestId = 0;

  async function loadSummary() {
    const requestId = ++summaryRequestId;
    loading = true;
    loadError = null;

    try {
      const response = await fetch('/api/v1/config-health/summary');
      if (requestId !== summaryRequestId) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (requestId !== summaryRequestId) return;
        loadError = body?.error ?? `Failed to load config health (HTTP ${response.status})`;
        return;
      }

      const next = (await response.json()) as ConfigHealthSummaryResponse;
      if (requestId !== summaryRequestId) return;
      summary = next;
    } catch (err) {
      if (requestId !== summaryRequestId) return;
      loadError = err instanceof Error ? err.message : 'Failed to load config health';
    } finally {
      if (requestId === summaryRequestId) loading = false;
    }
  }

  $: totals = summary?.totals ?? null;
  // Colour the fleet average by the band that average score would resolve to (null => no scored
  // instances, rendered as a dash). `bandFor` is the SSOT threshold policy — never hardcode cutoffs.
  $: averageClass =
    totals && totals.averageScore !== null
      ? HEALTH_BAND_TEXT_CLASS[bandFor(totals.averageScore, true)]
      : 'text-neutral-500 dark:text-neutral-400';

  onMount(() => {
    void loadSummary();
  });
</script>

<svelte:head>
  <title>Config Health - Praxrr</title>
</svelte:head>

<div class="space-y-8">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Config Health</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Score each Arr instance's configuration for completeness, drift, coherence, and compatibility, and surface where
        it needs attention.
      </p>
    </div>
    <button
      type="button"
      class="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
      disabled={loading}
      on:click={loadSummary}
    >
      <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
      Refresh
    </button>
  </div>

  {#if data.instances.length === 0}
    <EmptyState
      icon={Activity}
      title="No Arr instances to score"
      description="Config health needs at least one enabled Radarr, Sonarr, or Lidarr instance to evaluate."
      buttonText="Add Arr instance"
      buttonHref="/arr"
    />
  {:else}
    {#if loadError}
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
      >
        <span>{loadError}</span>
        <button
          type="button"
          class="rounded-lg border border-red-400 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
          on:click={loadSummary}
        >
          Retry
        </button>
      </div>
    {/if}

    <!-- KPI row -->
    <CardGrid columns={4}>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Instances</p>
        <p class="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{totals?.instances ?? '—'}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Average score</p>
        <p class="mt-1 text-2xl font-bold {averageClass}">{totals?.averageScore ?? '—'}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Attention</p>
        <p class="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">{totals?.attention ?? '—'}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Needs review</p>
        <p class="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{totals?.needsReview ?? '—'}</p>
      </Card>
    </CardGrid>

    <!-- Per-instance list -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Instances</h2>
      {#if summary}
        <div class="space-y-3">
          {#each summary.instances as instance (instance.instanceId)}
            <Card href={`/config-health/${instance.instanceId}`} hoverable>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-3">
                  <span class="font-medium text-neutral-900 dark:text-neutral-100">{instance.instanceName}</span>
                  <Badge variant={instance.arrType}>{instance.arrType}</Badge>
                  <Badge variant={bandVariant(instance.band)}>{HEALTH_BAND_LABEL[instance.band]}</Badge>
                </div>
                <div class="flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
                  <span class="font-semibold {HEALTH_BAND_TEXT_CLASS[instance.band]}">
                    {instance.band === 'unknown' ? '—' : instance.score}
                  </span>
                  <span>Scored {formatWhen(instance.generatedAt)}</span>
                </div>
              </div>
            </Card>
          {/each}
        </div>
      {:else if loading}
        <div
          class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          Loading config health…
        </div>
      {/if}
    </section>
  {/if}
</div>
