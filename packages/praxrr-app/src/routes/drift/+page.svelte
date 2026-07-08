<script lang="ts">
  import { onMount } from 'svelte';
  import { RefreshCw, Activity } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import EmptyState from '$ui/state/EmptyState.svelte';
  import { alertStore } from '$alerts/store';
  import { DRIFT_STATUS_LABEL, driftStatusVariant } from '$ui/drift/driftStatus.ts';
  import type { DriftInstanceSummary, DriftSettingsResponse } from '$sync/drift/responses.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  /** Aggregate totals block returned by `GET /api/v1/drift/summary`. */
  interface DriftSummaryTotals {
    instances: number;
    inSync: number;
    drifted: number;
    unreachable: number;
    unauthorized: number;
    error: number;
    neverChecked: number;
  }

  /** Exact shape of the `GET /api/v1/drift/summary` 200 body. */
  interface DriftSummaryResponse {
    generatedAt: string;
    settings: DriftSettingsResponse;
    totals: DriftSummaryTotals;
    instances: DriftInstanceSummary[];
  }

  type ErrorResponse = { error: string };

  function formatWhen(iso: string | null): string {
    if (!iso) return 'Never';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? 'Never' : parsed.toLocaleString();
  }

  let summary: DriftSummaryResponse | null = null;
  let loading = false;
  let loadError: string | null = null;
  let summaryRequestId = 0;

  // Drift settings form state — hydrated from the authoritative summary payload each load
  // (no dirty tracking: this two-field panel re-reads the server value after every save).
  let settingsEnabled = false;
  let settingsInterval = 15;
  let savingSettings = false;

  async function loadSummary() {
    const requestId = ++summaryRequestId;
    loading = true;
    loadError = null;

    try {
      const response = await fetch('/api/v1/drift/summary');
      if (requestId !== summaryRequestId) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (requestId !== summaryRequestId) return;
        loadError = body?.error ?? `Failed to load drift status (HTTP ${response.status})`;
        return;
      }

      const next = (await response.json()) as DriftSummaryResponse;
      if (requestId !== summaryRequestId) return;
      summary = next;
      settingsEnabled = next.settings.enabled;
      settingsInterval = next.settings.intervalMinutes;
    } catch (err) {
      if (requestId !== summaryRequestId) return;
      loadError = err instanceof Error ? err.message : 'Failed to load drift status';
    } finally {
      if (requestId === summaryRequestId) loading = false;
    }
  }

  async function saveSettings() {
    if (savingSettings) return;
    savingSettings = true;

    const intervalMinutes = Math.max(5, Math.floor(settingsInterval) || 5);

    try {
      const response = await fetch('/api/v1/drift/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: settingsEnabled, intervalMinutes }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        alertStore.add('error', body?.error ?? `Failed to update drift settings (HTTP ${response.status})`);
        return;
      }

      const settings = (await response.json()) as DriftSettingsResponse;
      if (summary) summary = { ...summary, settings };
      settingsEnabled = settings.enabled;
      settingsInterval = settings.intervalMinutes;
      alertStore.add('success', 'Drift settings updated.');
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to update drift settings');
    } finally {
      savingSettings = false;
    }
  }

  $: totals = summary?.totals ?? null;

  onMount(() => {
    void loadSummary();
  });
</script>

<svelte:head>
  <title>Drift - Praxrr</title>
</svelte:head>

<div class="space-y-8">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Drift Detection</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Compare each Arr instance's live configuration against the resolved PCD state and surface where they have
        drifted apart.
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
      title="No Arr instances to check"
      description="Drift detection needs at least one enabled Radarr, Sonarr, or Lidarr instance to compare against."
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
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">In sync</p>
        <p class="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{totals?.inSync ?? '—'}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Drifted</p>
        <p class="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">{totals?.drifted ?? '—'}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Unreachable</p>
        <p class="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{totals?.unreachable ?? '—'}</p>
      </Card>
    </CardGrid>

    <!-- Per-instance list -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Instances</h2>
      {#if summary}
        <div class="space-y-3">
          {#each summary.instances as instance (instance.instanceId)}
            <Card href={`/drift/${instance.instanceId}`} hoverable>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-3">
                  <span class="font-medium text-neutral-900 dark:text-neutral-100">{instance.instanceName}</span>
                  <Badge variant={instance.arrType}>{instance.arrType}</Badge>
                  <Badge variant={driftStatusVariant(instance.status)}>{DRIFT_STATUS_LABEL[instance.status]}</Badge>
                </div>
                <div class="flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>Drifted {instance.counts.drifted}</span>
                  <span>Missing {instance.counts.missing}</span>
                  <span>Unmanaged {instance.counts.unmanaged}</span>
                  <span>Checked {formatWhen(instance.checkedAt)}</span>
                </div>
              </div>
            </Card>
          {/each}
        </div>
      {:else if loading}
        <div
          class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          Loading drift status…
        </div>
      {/if}
    </section>

    <!-- Drift settings -->
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Drift settings</h2>
      <Card>
        <div class="flex flex-wrap items-end gap-6">
          <label class="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-neutral-300 dark:border-neutral-700"
              bind:checked={settingsEnabled}
            />
            Enable scheduled drift checks
          </label>

          <label class="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
            Interval (minutes)
            <input
              type="number"
              min="5"
              step="1"
              class="w-28 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              bind:value={settingsInterval}
            />
          </label>

          <button
            type="button"
            class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            disabled={savingSettings}
            on:click={saveSettings}
          >
            {savingSettings ? 'Saving…' : 'Save settings'}
          </button>
        </div>
        {#if summary}
          <p class="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            Last run {formatWhen(summary.settings.lastRunAt)} · Next run {formatWhen(summary.settings.nextRunAt)}
          </p>
        {/if}
      </Card>
    </section>
  {/if}
</div>
