<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { alertStore } from '$alerts/store';
  import Badge from '$ui/badge/Badge.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import SyncHistoryDiff from '$ui/sync-history/SyncHistoryDiff.svelte';
  import { SYNC_HISTORY_STATUS_LABEL, syncHistoryStatusVariant } from '$ui/sync-history/syncHistoryStatus.ts';
  import type { CanaryRolloutStatus } from '$sync/canary/types.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

  // Lifecycle-status presentation (distinct from the canary OUTCOME status, which reuses the
  // shared sync-history helper). Kept inline so this page does not couple to the sibling
  // `canaryStatus.ts` badge helper still being authored under $ui/canary.
  const ROLLOUT_STATUS_LABEL: Record<CanaryRolloutStatus, string> = {
    canary_running: 'Canary running',
    awaiting_confirmation: 'Awaiting confirmation',
    rolling_out: 'Rolling out',
    completed: 'Completed',
    aborted: 'Aborted',
    failed: 'Failed',
  };

  const ROLLOUT_STATUS_VARIANT: Record<CanaryRolloutStatus, BadgeVariant> = {
    canary_running: 'info',
    awaiting_confirmation: 'warning',
    rolling_out: 'info',
    completed: 'success',
    aborted: 'neutral',
    failed: 'danger',
  };

  let proceedOpen = false;
  let abortOpen = false;
  let submitting = false;

  $: rollout = data.rollout;
  $: diagnostics = data.diagnostics;
  $: remainingCount = rollout.remainingTargets.length;
  $: atGate = rollout.status === 'awaiting_confirmation';

  function formatWhen(iso: string | null): string {
    if (!iso) return '—';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
  }

  // camelCase section key → "Title Case" (e.g. qualityProfiles → "Quality Profiles").
  function formatSection(section: string): string {
    const spaced = section.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  // POST the state-guarded gate decision. `stateToken` is echoed back exactly as loaded; a
  // stale token (409/422) means the gate moved on — surface the server message and refresh.
  async function submitGate(action: 'proceed' | 'abort') {
    if (submitting) return;
    submitting = true;
    try {
      const response = await fetch(`/api/v1/canary/rollouts/${rollout.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stateToken: rollout.stateToken }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        alertStore.add('error', body?.error ?? `Failed to ${action} rollout (HTTP ${response.status})`);
        // The gate moved on (stale token 422 / wrong-state 409) or the request failed:
        // close the confirm modals and reload authoritative rollout state so the now-stale
        // token/status is never re-submitted on a retry.
        proceedOpen = false;
        abortOpen = false;
        await invalidateAll();
        return;
      }

      const plural = remainingCount === 1 ? '' : 's';
      alertStore.add(
        'success',
        action === 'proceed'
          ? `Rolling out to ${remainingCount} remaining instance${plural}.`
          : 'Rollout aborted. Remaining instances were not touched.'
      );
      proceedOpen = false;
      abortOpen = false;
      await invalidateAll();
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : `Failed to ${action} rollout`);
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Canary Rollout Detail - Praxrr</title>
</svelte:head>

<div class="space-y-6">
  <div>
    <a href="/canary" class="text-accent-600 dark:text-accent-500 text-sm font-medium hover:underline"
      >← Back to canary rollouts</a
    >
  </div>

  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        {rollout.canaryInstanceName}
      </h1>
      <Badge variant={rollout.arrType}>{rollout.arrType}</Badge>
      <Badge variant={ROLLOUT_STATUS_VARIANT[rollout.status]}>{ROLLOUT_STATUS_LABEL[rollout.status]}</Badge>
      {#if rollout.canaryStatus}
        <Badge variant={syncHistoryStatusVariant(rollout.canaryStatus)}>
          Canary: {SYNC_HISTORY_STATUS_LABEL[rollout.canaryStatus]}
        </Badge>
      {/if}
    </div>
  </div>

  <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
    <div>
      <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Started</dt>
      <dd class="text-neutral-900 dark:text-neutral-100">{formatWhen(rollout.startedAt)}</dd>
    </div>
    <div>
      <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Finished</dt>
      <dd class="text-neutral-900 dark:text-neutral-100">{formatWhen(rollout.finishedAt)}</dd>
    </div>
    <div>
      <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Batch size</dt>
      <dd class="text-neutral-900 dark:text-neutral-100">{rollout.maxBatchSize}</dd>
    </div>
    <div>
      <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Partial policy</dt>
      <dd class="text-neutral-900 dark:text-neutral-100">{rollout.partialPolicy}</dd>
    </div>
    <div>
      <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Remaining</dt>
      <dd class="text-neutral-900 dark:text-neutral-100">{remainingCount}</dd>
    </div>
    <div>
      <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Trigger</dt>
      <dd class="text-neutral-900 dark:text-neutral-100">{rollout.trigger}</dd>
    </div>
  </dl>

  {#if rollout.canaryError}
    <div
      class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
    >
      {rollout.canaryError}
    </div>
  {:else if rollout.canaryOutput}
    <div
      class="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
    >
      {rollout.canaryOutput}
    </div>
  {/if}

  <!-- Canary section diagnostics — failed sections / failedProfiles from the recorded audit row. -->
  <section class="space-y-3">
    <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
      Canary sections
      {#if diagnostics}
        <span class="text-neutral-500 dark:text-neutral-400">({diagnostics.sectionResults.length})</span>
      {/if}
    </h2>
    {#if !diagnostics}
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        No sync-history audit row is linked to this canary — diagnostics are unavailable (history may be disabled).
      </p>
    {:else if diagnostics.sectionResults.length === 0}
      <p class="text-sm text-neutral-500 dark:text-neutral-400">No per-section results were recorded for the canary.</p>
    {:else}
      <ul class="space-y-2">
        {#each diagnostics.sectionResults as result (result.section)}
          <li
            class="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800"
          >
            <span class="font-medium text-neutral-900 dark:text-neutral-100">{formatSection(result.section)}</span>
            <Badge variant={syncHistoryStatusVariant(result.status)}>{SYNC_HISTORY_STATUS_LABEL[result.status]}</Badge>
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

  <!-- Remaining preview: the config delta the canary applied is the representative diff that
       will roll out to the same-arr_type peers. Rendered in the SyncHistoryDiff layout. -->
  <section class="space-y-3">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Remaining preview
        {#if diagnostics}
          <span class="text-neutral-500 dark:text-neutral-400">({diagnostics.changes.length})</span>
        {/if}
      </h2>
      <span class="text-xs text-neutral-500 dark:text-neutral-400">
        Config delta the canary applied — the same changes roll out to {remainingCount} remaining {remainingCount === 1
          ? 'instance'
          : 'instances'}.
      </span>
    </div>

    {#if remainingCount === 0}
      <p class="text-sm text-neutral-500 dark:text-neutral-400">No remaining same-type instances were in scope.</p>
    {:else}
      <ul class="flex flex-wrap gap-2">
        {#each rollout.remainingTargets as target (target.instanceId)}
          <li
            class="rounded-lg border border-neutral-200 px-3 py-1 text-xs text-neutral-700 dark:border-neutral-800 dark:text-neutral-300"
          >
            {target.instanceName}
          </li>
        {/each}
      </ul>
    {/if}

    {#if !diagnostics || diagnostics.changes.length === 0}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        No entity-level changes were captured for the canary — the remaining instances receive the same section sync
        with no config-level diff to preview.
      </div>
    {:else}
      <SyncHistoryDiff changes={diagnostics.changes} />
    {/if}
  </section>

  <!-- Rollout results — populated once the batched rollout job runs. -->
  {#if rollout.rolloutResults.length > 0}
    <section class="space-y-3">
      <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Rollout results <span class="text-neutral-500 dark:text-neutral-400">({rollout.rolloutResults.length})</span>
      </h2>
      <ul class="space-y-2">
        {#each rollout.rolloutResults as result (result.instanceId)}
          <li
            class="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800"
          >
            <span class="font-medium text-neutral-900 dark:text-neutral-100">{result.instanceName}</span>
            <Badge variant={result.status === 'success' ? 'success' : result.status === 'skipped' ? 'neutral' : 'danger'}>
              {result.status}
            </Badge>
            {#if result.error}
              <span class="text-xs text-red-700 dark:text-red-300">{result.error}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- Verification gate — only while awaiting confirmation. -->
  {#if atGate}
    <section
      class="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-900/20"
    >
      <div>
        <h2 class="text-sm font-semibold text-amber-900 dark:text-amber-200">Verification gate</h2>
        <p class="mt-1 text-sm text-amber-900 dark:text-amber-200">
          Review the canary result above. Proceeding syncs the remaining {remainingCount}
          {remainingCount === 1 ? 'instance' : 'instances'} in batches of {rollout.maxBatchSize}.
        </p>
      </div>

      <p class="text-xs text-amber-800 dark:text-amber-300">
        The canary's own writes are <strong>already applied</strong> to
        <strong>{rollout.canaryInstanceName}</strong> — aborting only spares the remaining instances, it does not revert
        the canary. To roll the canary back, open its database
        <a href="/databases" class="font-medium underline">Snapshots</a> and restore the pre-sync snapshot (rollback).
      </p>

      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 dark:bg-emerald-700 dark:hover:bg-emerald-600"
          disabled={submitting}
          on:click={() => (proceedOpen = true)}
        >
          Proceed to remaining {remainingCount}
          {remainingCount === 1 ? 'instance' : 'instances'}
        </button>
        <button
          type="button"
          class="rounded-lg border border-red-400 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
          disabled={submitting}
          on:click={() => (abortOpen = true)}
        >
          Abort rollout
        </button>
      </div>
    </section>
  {/if}
</div>

<Modal
  open={proceedOpen}
  header="Proceed with rollout"
  bodyMessage={`Sync the remaining ${remainingCount} ${remainingCount === 1 ? 'instance' : 'instances'} in batches of ${rollout.maxBatchSize}? This applies the canary's config to the rest of the ${rollout.arrType} fleet.`}
  confirmText="Proceed"
  loading={submitting}
  on:confirm={() => submitGate('proceed')}
  on:cancel={() => (proceedOpen = false)}
/>

<Modal
  open={abortOpen}
  header="Abort rollout"
  bodyMessage="Abort this rollout? The remaining instances are never touched. The canary's own writes are already applied — recover them via the database Snapshots / rollback surface."
  confirmText="Abort rollout"
  confirmDanger={true}
  loading={submitting}
  on:confirm={() => submitGate('abort')}
  on:cancel={() => (abortOpen = false)}
/>
