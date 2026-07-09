<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { Camera, Plus, Trash2 } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Table from '$ui/table/Table.svelte';
  import Button from '$ui/button/Button.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import { alertStore } from '$alerts/store';
  import type { Column } from '$ui/table/types';
  import type { PcdSnapshotDetail, SnapshotTrigger, SnapshotType } from '$pcd/snapshots/types.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  const TYPE_LABEL: Record<SnapshotType, string> = {
    manual: 'Manual',
    auto: 'Auto',
  };

  const TRIGGER_LABEL: Record<SnapshotTrigger, string> = {
    pull: 'Pull',
    sync: 'Sync',
    manual: 'Manual',
    rollback: 'Rollback',
  };

  // --- Badge rendering (Table cells accept html strings only) -----------------

  const BADGE_BASE = 'inline-flex items-center gap-1 rounded font-medium px-1.5 py-0.5 text-[10px]';
  const NEUTRAL_BADGE = 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
  const ACCENT_BADGE = 'bg-accent-100 text-accent-800 dark:bg-accent-900 dark:text-accent-200';
  const INFO_BADGE = 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatWhen(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
  }

  function typeBadgeHtml(type: SnapshotType): string {
    const cls = type === 'manual' ? ACCENT_BADGE : NEUTRAL_BADGE;
    return `<span class="${BADGE_BASE} ${cls}">${escapeHtml(TYPE_LABEL[type] ?? type)}</span>`;
  }

  function triggerBadgeHtml(trigger: SnapshotTrigger): string {
    const cls = trigger === 'rollback' ? INFO_BADGE : NEUTRAL_BADGE;
    return `<span class="${BADGE_BASE} ${cls}">${escapeHtml(TRIGGER_LABEL[trigger] ?? trigger)}</span>`;
  }

  const columns: Column<PcdSnapshotDetail>[] = [
    {
      key: 'createdAt',
      header: 'Created',
      width: '190px',
      cell: (row) => ({
        html: `<span class="font-mono text-xs text-neutral-600 dark:text-neutral-400">${escapeHtml(formatWhen(row.createdAt))}</span>`,
      }),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (row) => ({ html: typeBadgeHtml(row.type) }),
    },
    {
      key: 'trigger',
      header: 'Trigger',
      cell: (row) => ({ html: triggerBadgeHtml(row.trigger) }),
    },
    {
      key: 'description',
      header: 'Description',
      cell: (row) =>
        row.description
          ? { html: `<span class="text-neutral-900 dark:text-neutral-100">${escapeHtml(row.description)}</span>` }
          : { html: '<span class="text-neutral-400 dark:text-neutral-500">—</span>' },
    },
    {
      key: 'ops',
      header: 'Ops (base / user)',
      align: 'right',
      cell: (row) => ({
        html: `<span class="font-mono text-xs text-neutral-600 dark:text-neutral-400">${row.opsCountBase} / ${row.opsCountUser}</span>`,
      }),
    },
    {
      key: 'cacheStateHash',
      header: 'Fingerprint',
      cell: (row) =>
        row.cacheStateHash
          ? {
              html: `<span class="font-mono text-xs text-neutral-500 dark:text-neutral-400">${escapeHtml(row.cacheStateHash.slice(0, 12))}</span>`,
            }
          : { html: '<span class="text-neutral-400 dark:text-neutral-500">—</span>' },
    },
  ];

  // --- Derived KPI state ------------------------------------------------------

  $: manualCount = data.snapshots.filter((row) => row.type === 'manual').length;
  $: autoCount = data.snapshots.filter((row) => row.type === 'auto').length;
  $: rollbackCount = data.snapshots.filter((row) => row.trigger === 'rollback').length;
  $: showEmptyState = data.loadError === null && data.total === 0;
  // The list is capped server-side; the Manual/Auto/Pre-rollback breakdown counts only the
  // loaded page, so surface that when Total exceeds what was loaded (avoids implying they
  // reconcile with Total).
  $: breakdownCapped = data.total > data.snapshots.length;

  // --- Create manual snapshot -------------------------------------------------

  let description = '';
  let creating = false;

  async function createSnapshot() {
    if (data.databaseId === null || creating) return;
    creating = true;
    try {
      const response = await fetch(`/api/v1/pcd/${data.databaseId}/snapshots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: description.trim() || undefined }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        alertStore.add('error', body?.error ?? `Failed to create snapshot (HTTP ${response.status})`);
        return;
      }
      description = '';
      alertStore.add('success', 'Snapshot created');
      await invalidateAll();
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Failed to create snapshot');
    } finally {
      creating = false;
    }
  }

  // --- Delete snapshot --------------------------------------------------------

  let deleteTarget: PcdSnapshotDetail | null = null;
  let deleting = false;

  function requestDelete(row: PcdSnapshotDetail) {
    deleteTarget = row;
  }

  function cancelDelete() {
    if (deleting) return;
    deleteTarget = null;
  }

  async function confirmDelete() {
    if (data.databaseId === null || deleteTarget === null || deleting) return;
    const target = deleteTarget;
    deleting = true;
    try {
      const response = await fetch(`/api/v1/pcd/${data.databaseId}/snapshots/${target.id}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        alertStore.add('error', body?.error ?? `Failed to delete snapshot (HTTP ${response.status})`);
        return;
      }
      alertStore.add('success', 'Snapshot deleted');
      deleteTarget = null;
      await invalidateAll();
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Failed to delete snapshot');
    } finally {
      deleting = false;
    }
  }
</script>

<svelte:head>
  <title>Snapshots - Praxrr</title>
</svelte:head>

<div class="space-y-8 pt-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Snapshots</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Point-in-time captures of this database's PCD desired state. Restore rewinds the PCD config only — it does not
        touch your Arr instances until the next sync.
      </p>
    </div>
    <div class="flex items-end gap-2">
      <label class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
        Description (optional)
        <input
          type="text"
          placeholder="Before big change…"
          maxlength="1000"
          class="w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          bind:value={description}
          disabled={creating}
        />
      </label>
      <Button text="Create snapshot" icon={Plus} variant="primary" disabled={creating} on:click={createSnapshot} />
    </div>
  </div>

  {#if data.loadError}
    <div
      class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
    >
      {data.loadError}
    </div>
  {:else if showEmptyState}
    <Card>
      <div class="flex flex-col items-center gap-4 px-4 py-10 text-center">
        <div class="rounded-full bg-neutral-100 p-4 dark:bg-neutral-800">
          <Camera class="h-8 w-8 text-neutral-400 dark:text-neutral-500" />
        </div>
        <div>
          <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">No snapshots yet</h2>
          <p class="mx-auto mt-1 max-w-md text-sm text-neutral-600 dark:text-neutral-400">
            Snapshots are captured automatically before risky operations (pulls, syncs, rollbacks) and can be created
            manually. Create the first one to enable point-in-time restore.
          </p>
        </div>
        <Button text="Create snapshot" icon={Plus} variant="primary" disabled={creating} on:click={createSnapshot} />
      </div>
    </Card>
  {:else}
    <!-- KPI row -->
    <CardGrid columns={4}>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Total</p>
        <p class="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{data.total}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Manual</p>
        <p class="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{manualCount}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Auto</p>
        <p class="mt-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">{autoCount}</p>
      </Card>
      <Card>
        <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Pre-rollback</p>
        <p class="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400">{rollbackCount}</p>
      </Card>
    </CardGrid>

    {#if breakdownCapped}
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        Manual / Auto / Pre-rollback count the {data.snapshots.length} most recent snapshots shown below.
      </p>
    {/if}

    <!-- Results -->
    <Table
      {columns}
      data={data.snapshots}
      rowHref={(row) => `/databases/${data.databaseId}/snapshots/${row.id}`}
      emptyMessage="No snapshots recorded for this database."
      hoverable
      compact
      responsive
    >
      <svelte:fragment slot="actions" let:row>
        <div class="relative z-20 flex justify-end">
          <Button
            icon={Trash2}
            variant="ghost"
            size="xs"
            ariaLabel="Delete snapshot"
            tooltip="Delete snapshot"
            on:click={() => requestDelete(row)}
          />
        </div>
      </svelte:fragment>
    </Table>
  {/if}
</div>

<Modal
  open={deleteTarget !== null}
  header="Delete snapshot"
  confirmText="Delete"
  cancelText="Cancel"
  confirmDanger
  loading={deleting}
  on:confirm={confirmDelete}
  on:cancel={cancelDelete}
>
  <div slot="body" class="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
    <p>
      Permanently delete this snapshot? Point-in-time restore to this exact state will no longer be possible. This does
      not affect your current PCD config or any Arr instance.
    </p>
    {#if deleteTarget}
      <p class="text-neutral-500 dark:text-neutral-500">
        Captured {formatWhen(deleteTarget.createdAt)} · {TRIGGER_LABEL[deleteTarget.trigger] ?? deleteTarget.trigger}
      </p>
    {/if}
  </div>
</Modal>
