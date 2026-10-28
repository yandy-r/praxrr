<script lang="ts">
  import CopyToDatabaseModal from '$ui/bundles/CopyToDatabaseModal.svelte';
  import { downloadBundle } from '$lib/client/bundles/api.ts';
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';
  import PageTitle from '$ui/meta/PageTitle.svelte';
  import SearchAction from '$ui/actions/SearchAction.svelte';
  import LocalOnlyFilterAction from '$ui/actions/LocalOnlyFilterAction.svelte';
  import ViewToggle from '$ui/actions/ViewToggle.svelte';
  import CloneModal from '$ui/modal/CloneModal.svelte';
  import TableView from './views/TableView.svelte';
  import CardView from './views/CardView.svelte';
  import { createDataPageStore } from '$lib/client/stores/dataPage';
  import {
    countLocallyModified,
    filterLocallyModified,
    loadLocalOnly,
    saveLocalOnly,
  } from '$lib/client/utils/locallyModified.ts';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { alertStore } from '$alerts/store';
  import { Plus } from 'lucide-svelte';
  import type { EntityType } from '$shared/pcd/portable.ts';
  import type { ArrAppType } from '$shared/arr/capabilities.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  let cloneModalOpen = false;
  let cloneSourceName = '';
  let cloneEntityType: EntityType = 'radarr_media_settings';
  let cloneArrType: ArrAppType | null = null;

  const validArrTypes: ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];

  function isValidArrType(arrType: string): arrType is ArrAppType {
    return validArrTypes.includes(arrType as ArrAppType);
  }

  $: cloneExistingNames = cloneArrType
    ? data.mediaSettingsConfigs.filter((config) => config.arr_type === cloneArrType).map((config) => config.name)
    : [];

  function resolveEntityType(arrType: string): EntityType | null {
    if (!isValidArrType(arrType)) {
      return null;
    }

    return `${arrType}_media_settings` as EntityType;
  }

  function handleClone(event: CustomEvent<{ name: string; arr_type: string }>) {
    if (!event.detail.name?.trim()) {
      alertStore.add('error', 'Missing media settings name');
      return;
    }

    const arrType = event.detail.arr_type;
    if (!isValidArrType(arrType)) {
      alertStore.add('error', `Unknown media settings type "${event.detail.arr_type}"`);
      return;
    }

    const entityType = resolveEntityType(arrType);
    if (!entityType) {
      alertStore.add('error', `Unknown media settings type "${event.detail.arr_type}"`);
      return;
    }

    cloneSourceName = event.detail.name;
    cloneEntityType = entityType;
    cloneArrType = arrType;
    cloneModalOpen = true;
  }

  let copyModalOpen = false;
  function handleCopy(event: CustomEvent<{ name: string; arr_type: string }>) {
    handleClone(event);
    if (cloneModalOpen) {
      cloneModalOpen = false;
      copyModalOpen = true;
    }
  }
  async function handleExport(event: CustomEvent<{ name: string; arr_type: string }>) {
    const entityType = resolveEntityType(event.detail.arr_type);
    if (!entityType || !event.detail.name?.trim()) {
      alertStore.add('error', 'Invalid media settings config');
      return;
    }
    try {
      await downloadBundle(data.currentDatabase.id, entityType, event.detail.name);
      alertStore.add('success', 'Bundle downloaded');
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Export failed');
    }
  }
  async function handleClipboard(event: CustomEvent<{ name: string; arr_type: string }>) {
    const { name, arr_type } = event.detail;
    if (!name?.trim()) {
      alertStore.add('error', 'Missing media settings details');
      return;
    }
    const entityType = resolveEntityType(arr_type);
    if (!entityType) {
      alertStore.add('error', `Unknown media settings type "${arr_type}"`);
      return;
    }
    try {
      const params = new URLSearchParams({
        databaseId: String(data.currentDatabase.id),
        entityType,
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
  const { search, view, filtered, setItems } = createDataPageStore(data.mediaSettingsConfigs, {
    storageKey: 'mediaSettingsView',
    searchKeys: ['name', 'arr_type'],
    searchKey: `mediaSettingsConfigsSearch:${data.currentDatabase.id}`,
  });

  // Update items when data changes
  $: setItems(data.mediaSettingsConfigs);

  const LOCAL_ONLY_STORAGE_PREFIX = 'mediaSettingsLocalOnly';
  let localOnly = false;
  let initializedLocalOnlyKey = '';

  function toggleLocalOnly() {
    localOnly = !localOnly;
    saveLocalOnly(localOnlyStorageKey, localOnly);
  }

  $: localOnlyStorageKey = `${LOCAL_ONLY_STORAGE_PREFIX}:${data.currentDatabase.id}`;
  $: if (initializedLocalOnlyKey !== localOnlyStorageKey) {
    initializedLocalOnlyKey = localOnlyStorageKey;
    localOnly = loadLocalOnly(localOnlyStorageKey);
  }
  $: localModifiedCount = countLocallyModified(data.mediaSettingsConfigs);

  $: localFiltered = filterLocallyModified($filtered, localOnly);
</script>

<PageTitle parts={['Media Settings', data.currentDatabase.name]} />

<!-- Actions Bar -->
<ActionsBar>
  <SearchAction searchStore={search} placeholder="Search media settings..." responsive />
  <LocalOnlyFilterAction active={localOnly} count={localModifiedCount} on:toggle={toggleLocalOnly} />
  <ActionButton
    icon={Plus}
    label="Add media settings config"
    on:click={() =>
      goto(
        resolve('/media-management/[databaseId]/media-settings/new', { databaseId: data.currentDatabase.id.toString() })
      )}
  />
  <ViewToggle bind:value={$view} />
</ActionsBar>

<!-- Advanced disclosure behavior for media settings forms is configured in the route family create/edit screens. -->

<!-- Media Settings Content -->
<div class="mt-6">
  {#if data.mediaSettingsConfigs.length === 0}
    <div
      class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p class="text-neutral-600 dark:text-neutral-400">
        No media settings configs found for {data.currentDatabase.name}
      </p>
    </div>
  {:else if localFiltered.length === 0}
    <div
      class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
    >
      <p class="text-neutral-600 dark:text-neutral-400">
        {localOnly
          ? 'No locally modified media settings configs match your search'
          : 'No media settings configs match your search'}
      </p>
    </div>
  {:else if $view === 'table'}
    <TableView
      configs={localFiltered}
      databaseId={data.currentDatabase.id}
      on:clone={handleClone}
      on:copy={handleCopy}
      on:clipboard={handleClipboard}
      on:export={handleExport}
    />
  {:else}
    <CardView
      configs={localFiltered}
      databaseId={data.currentDatabase.id}
      on:clone={handleClone}
      on:copy={handleCopy}
      on:clipboard={handleClipboard}
      on:export={handleExport}
    />
  {/if}
</div>

<CloneModal
  bind:open={cloneModalOpen}
  databaseId={data.currentDatabase.id}
  entityType={cloneEntityType}
  sourceName={cloneSourceName}
  existingNames={cloneExistingNames}
  canWriteToBase={data.canWriteToBase}
/>

<CopyToDatabaseModal
  bind:open={copyModalOpen}
  databaseId={data.currentDatabase.id}
  entityType={cloneEntityType}
  sourceName={cloneSourceName}
/>
