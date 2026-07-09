<script lang="ts">
  import { onMount } from 'svelte';
  import { RefreshCw } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import DriftFieldDiff from '$ui/drift/DriftFieldDiff.svelte';
  import NarrationBlock from '$ui/narration/NarrationBlock.svelte';
  import { DRIFT_STATUS_LABEL, driftStatusVariant } from '$ui/drift/driftStatus.ts';
  import { alertStore } from '$alerts/store';
  import { narrateDriftReason, narrateDriftCounts, narrateDriftEntity } from '$shared/narration/index.ts';
  import type { NarrationLevel } from '$shared/narration/index.ts';
  import type { DriftDetailResponse } from '$sync/drift/responses.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  type ErrorResponse = { error: string };

  function formatWhen(iso: string | null): string {
    if (!iso) return 'Never';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? 'Never' : parsed.toLocaleString();
  }

  let detail: DriftDetailResponse | null = null;
  let loading = false;
  let loadError: string | null = null;
  let refreshing = false;
  let detailRequestId = 0;
  let verbose = false;
  $: level = (verbose ? 'verbose' : 'summary') as NarrationLevel;

  async function loadDetail() {
    if (data.instanceId === null) return;
    const instanceId = data.instanceId;
    const requestId = ++detailRequestId;
    loading = true;
    loadError = null;

    try {
      const response = await fetch(`/api/v1/drift/${instanceId}`);
      if (requestId !== detailRequestId) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (requestId !== detailRequestId) return;
        loadError = body?.error ?? `Failed to load drift detail (HTTP ${response.status})`;
        return;
      }

      const next = (await response.json()) as DriftDetailResponse;
      if (requestId !== detailRequestId) return;
      detail = next;
    } catch (err) {
      if (requestId !== detailRequestId) return;
      loadError = err instanceof Error ? err.message : 'Failed to load drift detail';
    } finally {
      // loadDetail is the sole owner of `loading` (calls never overlap; refreshNow doesn't set
      // it), so clear it unconditionally — otherwise a refresh that bumps the guard mid-load
      // would strand the spinner forever.
      loading = false;
    }
  }

  async function refreshNow() {
    if (data.instanceId === null || refreshing) return;
    const instanceId = data.instanceId;
    // A fresh check supersedes any in-flight GET: bump the guard so a slow load can't
    // clobber the POST result assigned below.
    const requestId = ++detailRequestId;
    refreshing = true;

    try {
      const response = await fetch(`/api/v1/drift/${instanceId}`, { method: 'POST' });

      if (response.status === 429) {
        alertStore.add('warning', 'Too many drift refreshes for this instance — try again shortly.');
        return;
      }
      if (response.status === 409) {
        alertStore.add('info', 'A drift check for this instance is already in progress.');
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        alertStore.add('error', body?.error ?? `Failed to refresh drift (HTTP ${response.status})`);
        return;
      }

      const next = (await response.json()) as DriftDetailResponse;
      if (requestId !== detailRequestId) return;
      detail = next;
      alertStore.add('success', 'Drift check complete.');
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to refresh drift');
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    void loadDetail();
  });
</script>

<svelte:head>
  <title>Drift Detail - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <a href="/drift" class="text-accent-600 dark:text-accent-500 text-sm font-medium hover:underline">← Back to drift</a
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
          <Badge variant={driftStatusVariant(detail.status)}>{DRIFT_STATUS_LABEL[detail.status]}</Badge>
        {/if}
      </div>
      <button
        type="button"
        class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        disabled={refreshing || (loading && !detail)}
        on:click={refreshNow}
      >
        <RefreshCw size={14} class={refreshing ? 'animate-spin' : ''} />
        Refresh now
      </button>
    </div>

    {#if loadError}
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
        Loading drift detail…
      </div>
    {:else if detail}
      <div class="flex flex-wrap items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <span>Drifted {detail.counts.drifted}</span>
        <span>Missing {detail.counts.missing}</span>
        <span>Unmanaged {detail.counts.unmanaged}</span>
        <span>Checked {formatWhen(detail.checkedAt)}</span>
      </div>

      <div class="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <div class="flex items-start justify-between gap-3">
          <NarrationBlock line={narrateDriftReason(detail.status, detail.reason, level)} {verbose} />
          <button
            type="button"
            class="text-accent-600 dark:text-accent-500 shrink-0 text-xs font-medium hover:underline"
            on:click={() => (verbose = !verbose)}
          >
            {verbose ? 'Hide details' : 'Show details'}
          </button>
        </div>
        <NarrationBlock line={narrateDriftCounts(detail.counts, detail.status, level)} {verbose} />
      </div>

      {#if detail.drift.length === 0 && detail.missing.length === 0 && detail.unmanaged.length === 0}
        <div
          class="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200"
        >
          No drift detected — this instance matches the resolved PCD state.
        </div>
      {/if}

      {#if detail.drift.length > 0}
        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Drifted <span class="text-neutral-500 dark:text-neutral-400">({detail.drift.length})</span>
          </h2>
          <div class="space-y-3">
            {#each detail.drift as change (`${change.section}:${change.entityType}:${change.name}:${change.remoteId ?? ''}`)}
              <div class="space-y-2">
                <NarrationBlock line={narrateDriftEntity(change, detail.arrType, level)} {verbose} />
                <DriftFieldDiff {change} />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if detail.missing.length > 0}
        <section class="space-y-3">
          <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Missing <span class="text-neutral-500 dark:text-neutral-400">({detail.missing.length})</span>
          </h2>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Managed entities absent on this instance — a sync would create them.
          </p>
          <div class="space-y-2">
            {#each detail.missing as change (`${change.section}:${change.entityType}:${change.name}:${change.remoteId ?? ''}`)}
              <div class="space-y-2">
                <NarrationBlock line={narrateDriftEntity(change, detail.arrType, level)} {verbose} />
                <DriftFieldDiff {change} />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if detail.unmanaged.length > 0}
        <details class="rounded-lg border border-neutral-200 dark:border-neutral-800">
          <summary class="cursor-pointer px-4 py-2 text-sm text-neutral-500 dark:text-neutral-400">
            Unmanaged on instance ({detail.unmanaged.length}) — info only, not alerting
          </summary>
          <div class="space-y-2 px-4 pt-1 pb-4 opacity-70">
            {#each detail.unmanaged as change (`${change.section}:${change.entityType}:${change.name}:${change.remoteId ?? ''}`)}
              <div class="space-y-2">
                <NarrationBlock line={narrateDriftEntity(change, detail.arrType, level)} {verbose} />
                <DriftFieldDiff {change} />
              </div>
            {/each}
          </div>
        </details>
      {/if}
    {/if}
  {/if}
</div>
