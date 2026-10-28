<script lang="ts">
  import { alertStore } from '$alerts/store';
  import Modal from '$ui/modal/Modal.svelte';
  import BundleImportPanel from './BundleImportPanel.svelte';
  import type { EntityType } from '$shared/pcd/portable.ts';
  import { exportBundle, listBundleTargets, type BundleTarget, type PcdBundle } from '$lib/client/bundles/api.ts';

  export let open = false;
  export let databaseId: number;
  export let entityType: EntityType;
  export let sourceName: string;

  let targets: BundleTarget[] = [];
  let targetId = '';
  let bundle: PcdBundle | null = null;
  let loading = false;
  let importing = false;
  let initialized = '';
  let generation = 0;
  $: sourceKey = JSON.stringify([databaseId, entityType, sourceName]);
  $: if (open && initialized !== sourceKey) {
    initialized = sourceKey;
    void initialize();
  }
  $: if (!open) {
    initialized = '';
    generation += 1;
  }
  $: target = targets.find((entry) => String(entry.id) === targetId);
  $: canWriteToBase = !!target?.has_personal_access_token && !target?.local_ops_enabled;

  async function initialize() {
    const current = ++generation;
    loading = true;
    bundle = null;
    targetId = '';
    try {
      const [databases, exported] = await Promise.all([
        listBundleTargets(),
        exportBundle(databaseId, entityType, sourceName),
      ]);
      if (current !== generation) return;
      targets = databases.filter((entry) => entry.id !== databaseId && !!entry.enabled);
      targetId = targets.length ? String(targets[0].id) : '';
      bundle = exported;
    } catch (error) {
      if (current === generation)
        alertStore.add('error', error instanceof Error ? error.message : 'Could not prepare copy');
    } finally {
      if (current === generation) loading = false;
    }
  }

  function close() {
    if (!importing) open = false;
  }
</script>

<Modal
  {open}
  header="Copy to database…"
  confirmText="Close"
  cancelText="Cancel"
  size="xl"
  loading={importing}
  on:confirm={close}
  on:cancel={close}
>
  <div slot="body" class="space-y-5">
    <p class="text-sm text-neutral-600 dark:text-neutral-400">
      Copy “{sourceName}” and its dependencies to another database. Preview before applying.
    </p>
    {#if loading}
      <p role="status">Loading bundle and databases…</p>
    {:else if bundle && targets.length}
      <label class="block space-y-1 text-sm"
        ><span class="block font-medium">Target database</span>
        <select
          bind:value={targetId}
          disabled={importing}
          class="w-full rounded-md border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-950"
        >
          {#each targets as database}<option value={String(database.id)}>{database.name}</option>{/each}
        </select>
      </label>
      {#if target}
        {#key target.id}
          <BundleImportPanel
            databaseId={target.id}
            {canWriteToBase}
            {bundle}
            showInput={false}
            bind:busy={importing}
            on:applied={() => {
              open = false;
            }}
          />
        {/key}
      {/if}
    {:else if bundle}
      <p role="status">Link another database before copying entities.</p>
    {:else}
      <p role="status">Could not prepare the copy. Close this dialog and try again.</p>
    {/if}
  </div>
</Modal>
