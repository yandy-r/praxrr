<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { alertStore } from '$alerts/store';
  import Badge from '$ui/badge/Badge.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import { SYNC_HISTORY_STATUS_LABEL, syncHistoryStatusVariant } from '$ui/sync-history/syncHistoryStatus.ts';
  import type { GeneratePreviewResult } from '$sync/preview/orchestrator.ts';
  import type { EntityChange, SyncPreviewSummary } from '$sync/preview/types.ts';
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
  let submittingAction: 'proceed' | 'abort' | null = null;

  $: rollout = data.rollout;
  $: diagnostics = data.diagnostics;
  $: remainingCount = rollout.remainingTargets.length;
  $: atGate = rollout.status === 'awaiting_confirmation';
  $: remainingPreview = rollout.remainingPreview;
  $: previewAvailable = remainingPreview.availability === 'available';
  $: availablePreviews = remainingPreview.availability === 'available' ? remainingPreview.previews : [];
  $: partialPreviews = remainingPreview.availability === 'unavailable' ? remainingPreview.partialPreviews : [];
  $: previewTotals = sumPreviewTotals(availablePreviews);
  $: hasPlannedChanges = mutationCount(previewTotals) > 0;

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

  function mutationCount(summary: SyncPreviewSummary): number {
    return summary.totalCreates + summary.totalUpdates + summary.totalDeletes;
  }

  function sumPreviewTotals(previews: readonly GeneratePreviewResult[]): SyncPreviewSummary {
    return previews.reduce<SyncPreviewSummary>(
      (totals, preview) => ({
        totalCreates: totals.totalCreates + preview.summary.totalCreates,
        totalUpdates: totals.totalUpdates + preview.summary.totalUpdates,
        totalDeletes: totals.totalDeletes + preview.summary.totalDeletes,
        totalUnchanged: totals.totalUnchanged + preview.summary.totalUnchanged,
      }),
      { totalCreates: 0, totalUpdates: 0, totalDeletes: 0, totalUnchanged: 0 }
    );
  }

  function previewSummary(preview: GeneratePreviewResult): string {
    const { totalCreates, totalUpdates, totalDeletes, totalUnchanged } = preview.summary;
    return `${totalCreates} create, ${totalUpdates} update, ${totalDeletes} delete, ${totalUnchanged} unchanged`;
  }

  function plannedEntities(preview: GeneratePreviewResult): Array<{ section: string; entity: EntityChange }> {
    const entities: Array<{ section: string; entity: EntityChange }> = [];
    const push = (section: string, values: readonly EntityChange[]) => {
      for (const entity of values) entities.push({ section, entity });
    };

    if (preview.qualityProfiles) {
      push('qualityProfiles', preview.qualityProfiles.customFormats);
      push('qualityProfiles', preview.qualityProfiles.qualityProfiles);
    }
    if (preview.delayProfiles?.profile) push('delayProfiles', [preview.delayProfiles.profile]);
    if (preview.mediaManagement) {
      if (preview.mediaManagement.naming) push('mediaManagement', [preview.mediaManagement.naming]);
      push('mediaManagement', preview.mediaManagement.qualityDefinitions);
      if (preview.mediaManagement.mediaSettings) push('mediaManagement', [preview.mediaManagement.mediaSettings]);
    }
    if (preview.metadataProfiles?.profile) push('metadataProfiles', [preview.metadataProfiles.profile]);

    return entities;
  }

  function actionVariant(action: EntityChange['action']): BadgeVariant {
    if (action === 'create') return 'success';
    if (action === 'update') return 'info';
    if (action === 'delete') return 'danger';
    return 'neutral';
  }

  function formatValue(value: unknown): string {
    if (value === undefined) return '—';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  // POST the state-guarded gate decision. `stateToken` is echoed back exactly as loaded; a
  // stale token (409/422) means the gate moved on — surface the server message and refresh.
  async function submitGate(action: 'proceed' | 'abort') {
    if (submitting) return;
    submitting = true;
    submittingAction = action;
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
      submittingAction = null;
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

  <!-- Confirmed canary execution — failed sections / failedProfiles from the recorded audit row. -->
  <section class="space-y-3">
    <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
      Confirmed canary sections
      {#if diagnostics}
        <span class="text-neutral-500 dark:text-neutral-400">({diagnostics.sectionResults.length})</span>
      {/if}
    </h2>
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      Actual results recorded when the canary sync ran. These are separate from the planned remaining-target preview.
    </p>
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

  <!-- Planned remaining-target evidence. Never infer availability from mutation or array counts. -->
  <section class="space-y-3" aria-labelledby="remaining-preview-heading">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="remaining-preview-heading" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Remaining-target preview
      </h2>
      <span class="text-xs text-neutral-500 dark:text-neutral-400">
        Generated {formatWhen(remainingPreview.generatedAt)} for {remainingCount} remaining {remainingCount === 1
          ? 'instance'
          : 'instances'}
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

    {#if remainingPreview.availability === 'available'}
      <div
        class="space-y-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-100"
      >
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-semibold">Remaining preview complete</h3>
          <Badge variant="success">
            {hasPlannedChanges ? 'Available · Changes planned' : 'Available · No changes'}
          </Badge>
        </div>

        {#if hasPlannedChanges}
          <div class="space-y-3">
            <p>
              Planned changes across all remaining targets: <strong>{previewTotals.totalCreates} creates</strong>,
              <strong>{previewTotals.totalUpdates} updates</strong>, and
              <strong>{previewTotals.totalDeletes} deletes</strong>. These are planned changes, not confirmed outcomes.
            </p>

            <ul class="space-y-2">
              {#each remainingPreview.previews as preview (preview.instanceId)}
                <li
                  class="rounded-md border border-emerald-200 bg-white/60 p-3 dark:border-emerald-900/60 dark:bg-neutral-950/30"
                >
                  <details open={mutationCount(preview.summary) > 0}>
                    <summary class="cursor-pointer font-medium">
                      {preview.instanceName}
                      <span class="ml-2 text-xs font-normal text-emerald-800 dark:text-emerald-300">
                        {previewSummary(preview)}
                      </span>
                    </summary>

                    <div class="mt-3 space-y-2">
                      {#each plannedEntities(preview) as planned, index (`${planned.section}:${planned.entity.entityType}:${planned.entity.name}:${index}`)}
                        <details
                          open={planned.entity.action !== 'unchanged'}
                          class="rounded border border-neutral-200 bg-white px-3 py-2 text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                        >
                          <summary class="cursor-pointer">
                            <span class="font-medium">{planned.entity.name}</span>
                            <span class="mx-2 text-xs text-neutral-500 dark:text-neutral-400">
                              {formatSection(planned.section)} · {planned.entity.entityType}
                            </span>
                            <Badge variant={actionVariant(planned.entity.action)}>{planned.entity.action}</Badge>
                          </summary>
                          {#if planned.entity.fields.length > 0}
                            <dl class="mt-2 space-y-2 border-t border-neutral-200 pt-2 text-xs dark:border-neutral-700">
                              {#each planned.entity.fields as field (field.field)}
                                <div>
                                  <dt class="font-medium">{field.field}</dt>
                                  <dd class="mt-0.5 break-all text-neutral-600 dark:text-neutral-400">
                                    {formatValue(field.current)} → {formatValue(field.desired)}
                                  </dd>
                                </div>
                              {/each}
                            </dl>
                          {:else}
                            <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                              No field-level values were recorded for this {planned.entity.action} action.
                            </p>
                          {/if}
                        </details>
                      {/each}
                    </div>
                  </details>
                </li>
              {/each}
            </ul>
          </div>
        {:else}
          <p>
            Preview completed for {remainingCount} remaining {remainingCount === 1 ? 'instance' : 'instances'}. No
            changes are currently planned.
          </p>
        {/if}
      </div>
    {:else}
      <div
        class="space-y-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-100"
        aria-labelledby="remaining-preview-unavailable-heading"
      >
        <div class="flex flex-wrap items-center gap-2">
          <h3 id="remaining-preview-unavailable-heading" class="font-semibold">Remaining preview unavailable</h3>
          <Badge variant="danger">Unavailable</Badge>
        </div>
        <p>{remainingPreview.failure.message}</p>
        <p><strong>Recovery:</strong> {remainingPreview.failure.recoveryAction}</p>
        <p class="text-xs text-red-800 dark:text-red-300">
          Abort this rollout, complete the recovery action, then start a new rollout. No remaining-target changes can be
          authorized from incomplete evidence.
        </p>

        {#if partialPreviews.length > 0}
          <details
            class="rounded-md border border-red-200 bg-white/60 p-3 dark:border-red-900/60 dark:bg-neutral-950/30"
          >
            <summary class="cursor-pointer font-medium">
              Incomplete preview details ({partialPreviews.length}
              {partialPreviews.length === 1 ? 'target' : 'targets'})
            </summary>
            <p class="mt-2 text-xs text-red-800 dark:text-red-300">
              These diagnostic pieces are incomplete and cannot authorize rollout.
            </p>
            <ul class="mt-2 space-y-1 text-xs">
              {#each partialPreviews as preview (preview.instanceId)}
                <li>{preview.instanceName}: {previewSummary(preview)}</li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>
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
            <Badge
              variant={result.status === 'success' ? 'success' : result.status === 'skipped' ? 'neutral' : 'danger'}
            >
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
          Review the confirmed canary result and planned remaining-target evidence above. Proceeding syncs the remaining
          {remainingCount}
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
          disabled={submitting || !previewAvailable}
          aria-describedby={!previewAvailable ? 'proceed-disabled-reason' : undefined}
          on:click={() => (proceedOpen = true)}
        >
          {submittingAction === 'proceed' ? 'Proceeding…' : `Proceed to remaining ${remainingCount}`}
          {submittingAction === 'proceed' ? '' : remainingCount === 1 ? 'instance' : 'instances'}
        </button>
        <button
          type="button"
          class="rounded-lg border border-red-400 px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
          disabled={submitting}
          on:click={() => (abortOpen = true)}
        >
          {submittingAction === 'abort' ? 'Aborting…' : 'Abort rollout'}
        </button>
      </div>
      {#if !previewAvailable}
        <p id="proceed-disabled-reason" class="text-xs font-medium text-amber-900 dark:text-amber-200">
          Proceed is disabled until a complete remaining-target preview is available. Abort remains available.
        </p>
      {/if}
    </section>
  {/if}
</div>

<Modal
  open={proceedOpen}
  header="Proceed with rollout"
  bodyMessage={`Sync the remaining ${remainingCount} ${remainingCount === 1 ? 'instance' : 'instances'} in batches of ${rollout.maxBatchSize}? Sync re-evaluates current state, so actual outcomes can differ from the reviewed preview.`}
  confirmText="Proceed"
  loading={submitting}
  on:confirm={() => submitGate('proceed')}
  on:cancel={() => (proceedOpen = false)}
/>

<Modal
  open={abortOpen}
  header="Abort rollout"
  bodyMessage="Remaining instances will not be touched. The confirmed canary changes are already applied and are not rolled back. Recover them separately through the database Snapshots / rollback surface."
  confirmText="Abort rollout"
  confirmDanger={true}
  loading={submitting}
  on:confirm={() => submitGate('abort')}
  on:cancel={() => (abortOpen = false)}
/>
