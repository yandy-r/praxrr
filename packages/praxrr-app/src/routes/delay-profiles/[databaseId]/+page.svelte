<script lang="ts">
  import CopyToDatabaseModal from '$ui/bundles/CopyToDatabaseModal.svelte';
  import { downloadBundle } from '$lib/client/bundles/api.ts';
  import Tabs from '$ui/navigation/tabs/Tabs.svelte';
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';
  import SearchAction from '$ui/actions/SearchAction.svelte';
  import ViewToggle from '$ui/actions/ViewToggle.svelte';
  import InfoModal from '$ui/modal/InfoModal.svelte';
  import CloneModal from '$ui/modal/CloneModal.svelte';
  import TableView from './views/TableView.svelte';
  import CardView from './views/CardView.svelte';
  import LocalOnlyFilterAction from '$ui/actions/LocalOnlyFilterAction.svelte';
  import {
    countLocallyModified,
    filterLocallyModified,
    loadLocalOnly,
    saveLocalOnly,
  } from '$lib/client/utils/locallyModified.ts';
  import { createDataPageStore } from '$lib/client/stores/dataPage';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { alertStore } from '$alerts/store';
  import { Info, Plus } from 'lucide-svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  let showInfoModal = false;
  let cloneModalOpen = false;
  let cloneSourceName = '';
  let copyModalOpen = false;
  function handleCopy(event: CustomEvent<{ name: string }>) {
    cloneSourceName = event.detail.name;
    copyModalOpen = true;
  }
  async function handleExport(event: CustomEvent<{ name: string }>) {
    try {
      await downloadBundle(data.currentDatabase.id, 'delay_profile', event.detail.name);
      alertStore.add('success', 'Bundle downloaded');
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Export failed');
    }
  }

  let onlyLocal = false;
  let initializedLocalOnlyKey = '';

  $: localOnlyStorageKey = `delayProfilesLocalOnly:${data.currentDatabase.id}`;
  $: if (initializedLocalOnlyKey !== localOnlyStorageKey) {
    initializedLocalOnlyKey = localOnlyStorageKey;
    onlyLocal = loadLocalOnly(localOnlyStorageKey);
  }

  function toggleOnlyLocal() {
    onlyLocal = !onlyLocal;
    saveLocalOnly(localOnlyStorageKey, onlyLocal);
  }

  function handleClone(event: CustomEvent<{ name: string }>) {
    cloneSourceName = event.detail.name;
    cloneModalOpen = true;
  }

  async function handleClipboard(event: CustomEvent<{ name: string }>) {
    const { name } = event.detail;
    try {
      const params = new URLSearchParams({
        databaseId: String(data.currentDatabase.id),
        entityType: 'delay_profile',
        name,
      });
      const res = await fetch(`/api/v1/pcd/export?${params}`);
      const json = await res.json();
      if (!res.ok) {
        alertStore.add('error', json.error || 'Export failed');
        return;
      }
      await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
      alertStore.add('success', `Copied "${name}" to clipboard`);
    } catch {
      alertStore.add('error', 'Export failed');
    }
  }

  // Initialize data page store
  const { search, view, filtered, setItems } = createDataPageStore(data.delayProfiles, {
    storageKey: 'delayProfilesView',
    searchKeys: ['name'],
    searchKey: `delayProfilesSearch:${data.currentDatabase.id}`,
  });

  // Update items when data changes (e.g., switching databases)
  $: setItems(data.delayProfiles);

  $: locallyModifiedCount = countLocallyModified(data.delayProfiles);
  $: filteredProfiles = filterLocallyModified($filtered, onlyLocal);

  // Map databases to tabs
  $: tabs = data.databases.map((db) => ({
    label: db.name,
    href: `/delay-profiles/${db.id}`,
    active: db.id === data.currentDatabase.id,
  }));

  // Persist selected database tab
  $: if (browser && data.currentDatabase?.id) {
    localStorage.setItem('delayProfilesDatabase', String(data.currentDatabase.id));
  }
</script>

<svelte:head>
  <title>Delay Profiles - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
  <!-- Tabs -->
  <Tabs {tabs} responsive />

  <!-- Actions Bar -->
  <ActionsBar>
    <SearchAction searchStore={search} placeholder="Search delay profiles..." responsive />
    <LocalOnlyFilterAction active={onlyLocal} count={locallyModifiedCount} on:toggle={toggleOnlyLocal} />
    <ViewToggle bind:value={$view} />
    <ActionButton icon={Info} label="About delay profiles" on:click={() => (showInfoModal = true)} />
    <ActionButton
      icon={Plus}
      label="Add delay profile"
      on:click={() => goto(`/delay-profiles/${data.currentDatabase.id}/new`)}
    />
  </ActionsBar>

  <!-- Delay Profiles Content -->
  <div class="mt-6">
    {#if data.delayProfiles.length === 0}
      <div
        class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p class="text-neutral-600 dark:text-neutral-400">
          No delay profiles found for {data.currentDatabase.name}
        </p>
      </div>
    {:else if filteredProfiles.length === 0}
      <div
        class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p class="text-neutral-600 dark:text-neutral-400">
          {onlyLocal ? 'No locally modified delay profiles' : 'No delay profiles match your search'}
        </p>
      </div>
    {:else if $view === 'table'}
      <TableView
        profiles={filteredProfiles}
        on:clone={handleClone}
        on:export={handleExport}
        on:copy={handleCopy}
        on:clipboard={handleClipboard}
      />
    {:else}
      <CardView
        profiles={filteredProfiles}
        on:clone={handleClone}
        on:export={handleExport}
        on:copy={handleCopy}
        on:clipboard={handleClipboard}
      />
    {/if}
  </div>
</div>

<InfoModal bind:open={showInfoModal} header="How Delay Profile Sync Works">
  <div class="space-y-4 text-sm text-neutral-600 dark:text-neutral-400">
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Replaces Existing Profiles</div>
      <p class="mt-1">
        When syncing, all existing delay profiles on the arr instance are deleted and replaced with the ones you've
        selected. The default profile (which cannot be deleted) is preserved.
      </p>
    </div>
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Selection Order = Priority</div>
      <p class="mt-1">
        The order you select profiles determines their priority. The first profile in your selection list gets the
        highest priority (order 1), the second gets order 2, and so on.
      </p>
    </div>
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-100">Tag-Based Matching</div>
      <p class="mt-1">
        Delay profiles use tags to apply to specific series/movies. When multiple profiles match (via tags), the one
        with the lowest order number takes precedence.
      </p>
    </div>
  </div>
</InfoModal>

<CloneModal
  bind:open={cloneModalOpen}
  databaseId={data.currentDatabase.id}
  entityType="delay_profile"
  sourceName={cloneSourceName}
  existingNames={data.delayProfiles.map((p) => p.name)}
  canWriteToBase={data.canWriteToBase}
/>

<CopyToDatabaseModal
  bind:open={copyModalOpen}
  databaseId={data.currentDatabase.id}
  entityType="delay_profile"
  sourceName={cloneSourceName}
/>
