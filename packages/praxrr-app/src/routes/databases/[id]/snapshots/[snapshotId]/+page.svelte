<script lang="ts">
  import { onMount } from 'svelte';
  import { RotateCcw } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import SnapshotDiff from '$ui/snapshots/SnapshotDiff.svelte';
  import { alertStore } from '$alerts/store';
  import type { PcdSnapshotFullDetail, SnapshotTrigger, SnapshotType } from '$pcd/snapshots/types.ts';
  import type { RollbackPreview, RollbackResult } from '$pcd/snapshots/rollback/types.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  type ErrorResponse = { error: string };

  const TYPE_LABEL: Record<SnapshotType, string> = { manual: 'Manual', auto: 'Auto' };
  const TRIGGER_LABEL: Record<SnapshotTrigger, string> = {
    pull: 'Pull',
    sync: 'Sync',
    manual: 'Manual',
    rollback: 'Rollback',
  };

  let detail: PcdSnapshotFullDetail | null = null;
  let preview: RollbackPreview | null = null;
  let loading = false;
  let loadError: string | null = null;
  let notFound = false;
  let requestSeq = 0;

  let restoreModalOpen = false;
  let restoring = false;

  $: listHref = data.databaseId !== null ? `/databases/${data.databaseId}/snapshots` : '/databases';
  $: hasChanges =
    preview !== null && preview.summary.totalCreates + preview.summary.totalUpdates + preview.summary.totalDeletes > 0;
  $: canRestore = preview !== null && preview.reconstructable && hasChanges && !restoring;

  function formatWhen(iso: string | null): string {
    if (!iso) return '—';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
  }

  async function loadAll() {
    if (data.databaseId === null || data.snapshotId === null) return;
    const databaseId = data.databaseId;
    const snapshotId = data.snapshotId;
    const seq = ++requestSeq;
    loading = true;
    loadError = null;
    notFound = false;

    try {
      const [detailResponse, previewResponse] = await Promise.all([
        fetch(`/api/v1/pcd/${databaseId}/snapshots/${snapshotId}`),
        fetch(`/api/v1/pcd/${databaseId}/snapshots/${snapshotId}/rollback/preview`),
      ]);
      if (seq !== requestSeq) return;

      if (detailResponse.status === 404) {
        notFound = true;
        return;
      }
      if (!detailResponse.ok) {
        const body = (await detailResponse.json().catch(() => null)) as ErrorResponse | null;
        loadError = body?.error ?? `Failed to load snapshot (HTTP ${detailResponse.status})`;
        return;
      }
      detail = (await detailResponse.json()) as PcdSnapshotFullDetail;

      if (previewResponse.ok) {
        preview = (await previewResponse.json()) as RollbackPreview;
      } else {
        preview = null;
        const body = (await previewResponse.json().catch(() => null)) as ErrorResponse | null;
        loadError = body?.error ?? `Failed to load restore preview (HTTP ${previewResponse.status})`;
      }
    } catch (err) {
      if (seq !== requestSeq) return;
      loadError = err instanceof Error ? err.message : 'Failed to load snapshot';
    } finally {
      if (seq === requestSeq) loading = false;
    }
  }

  function openRestoreModal() {
    if (!canRestore) return;
    restoreModalOpen = true;
  }

  function cancelRestore() {
    if (restoring) return;
    restoreModalOpen = false;
  }

  async function confirmRestore() {
    if (data.databaseId === null || data.snapshotId === null || preview === null || restoring) return;
    const databaseId = data.databaseId;
    const snapshotId = data.snapshotId;
    restoring = true;
    try {
      const response = await fetch(`/api/v1/pcd/${databaseId}/snapshots/${snapshotId}/rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedCurrentStateHash: preview.currentStateHash ?? '' }),
      });

      if (response.status === 422) {
        restoreModalOpen = false;
        alertStore.add('warning', 'The PCD state changed since this preview. Reloading the latest preview.');
        await loadAll();
        return;
      }
      if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        alertStore.add('error', body?.error ?? 'Snapshot cannot be verified for restore.');
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        alertStore.add('error', body?.error ?? `Restore failed (HTTP ${response.status})`);
        return;
      }

      const result = (await response.json()) as RollbackResult;
      restoreModalOpen = false;
      alertStore.add(
        'success',
        `Restored PCD state: ${result.opsUndone} ops undone, ${result.opsReactivated} reactivated.`
      );
      await loadAll();
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Restore failed');
    } finally {
      restoring = false;
    }
  }

  onMount(() => {
    void loadAll();
  });
</script>

<svelte:head>
  <title>Snapshot detail - Praxrr</title>
</svelte:head>

<div class="space-y-6 pt-4">
  <div>
    <a href={listHref} class="text-accent-600 dark:text-accent-500 text-sm font-medium hover:underline"
      >← Back to snapshots</a
    >
  </div>

  {#if data.snapshotId === null || data.error}
    <div
      class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
    >
      {data.error ?? 'Invalid snapshot id'}
    </div>
  {:else if notFound}
    <div
      class="rounded-lg border border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
    >
      Snapshot #{data.snapshotId} was not found. It may have been deleted.
    </div>
  {:else if loadError && !detail}
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
      Loading snapshot…
    </div>
  {:else if detail}
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Snapshot #{detail.id}</h1>
        <Badge variant={detail.type === 'manual' ? 'accent' : 'neutral'}>{TYPE_LABEL[detail.type] ?? detail.type}</Badge
        >
        <Badge variant={detail.trigger === 'rollback' ? 'info' : 'neutral'}
          >{TRIGGER_LABEL[detail.trigger] ?? detail.trigger}</Badge
        >
        <Badge variant={detail.isRestorable ? 'success' : 'danger'}
          >{detail.isRestorable ? 'Restorable' : 'Not restorable'}</Badge
        >
      </div>
      <Button
        text="Restore to this snapshot"
        icon={RotateCcw}
        variant="danger"
        disabled={!canRestore}
        on:click={openRestoreModal}
      />
    </div>

    {#if detail.description}
      <p class="text-sm text-neutral-700 dark:text-neutral-300">{detail.description}</p>
    {/if}

    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Captured</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{formatWhen(detail.createdAt)}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Trigger</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{TRIGGER_LABEL[detail.trigger] ?? detail.trigger}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Ops (base / user)</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{detail.opsCountBase} / {detail.opsCountUser}</dd>
      </div>
      <div>
        <dt class="text-xs tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Ops written since</dt>
        <dd class="text-neutral-900 dark:text-neutral-100">{detail.opsWrittenSince}</dd>
      </div>
    </dl>

    <!-- PCD-only scope note -->
    <div
      class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200"
    >
      Restore rewinds this database's <strong>PCD desired state</strong> only. It does not push anything to your Arr
      instances — those change on the next sync. To see what the next sync would apply, check the
      <a href="/drift" class="font-medium underline">Drift dashboard</a>
      and
      <a href="/sync-history" class="font-medium underline">Sync History</a>.
    </div>

    {#if loadError && !preview}
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
    {:else if preview && !preview.reconstructable}
      <div
        class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
      >
        This snapshot cannot be restored. {preview.reason ??
          'Its recorded state could not be reconstructed or verified.'}
      </div>
    {:else if preview}
      <section class="space-y-3">
        <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Restore preview</h2>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          What restoring this snapshot would change in the current PCD desired state.
        </p>
        <SnapshotDiff sections={preview.sections} summary={preview.summary} />
      </section>
    {/if}
  {/if}
</div>

<Modal
  open={restoreModalOpen}
  header="Restore to this snapshot"
  confirmText="Restore"
  cancelText="Cancel"
  confirmDanger
  loading={restoring}
  on:confirm={confirmRestore}
  on:cancel={cancelRestore}
>
  <div slot="body" class="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
    <p>
      Rewind this database's PCD desired state to snapshot #{data.snapshotId}? A pre-rollback snapshot is captured
      first, so this restore is itself reversible.
    </p>
    {#if preview}
      <p class="text-neutral-500 dark:text-neutral-500">
        {preview.summary.totalCreates} create · {preview.summary.totalUpdates} update · {preview.summary.totalDeletes}
        delete
      </p>
    {/if}
    <p>Your Arr instances are not changed until the next sync.</p>
  </div>
</Modal>
