<script lang="ts">
  import CopyToDatabaseModal from '$ui/bundles/CopyToDatabaseModal.svelte';
  import { downloadBundle } from '$lib/client/bundles/api.ts';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Tabs from '$ui/navigation/tabs/Tabs.svelte';
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';
  import SearchAction from '$ui/actions/SearchAction.svelte';
  import ViewToggle from '$ui/actions/ViewToggle.svelte';
  import LocalOnlyFilterAction from '$ui/actions/LocalOnlyFilterAction.svelte';
  import {
    countLocallyModified,
    filterLocallyModified,
    loadLocalOnly,
    saveLocalOnly,
  } from '$lib/client/utils/locallyModified.ts';
  import { createDataPageStore } from '$lib/client/stores/dataPage';
  import { browser } from '$app/environment';
  import Table from '$ui/table/Table.svelte';
  import type { Column } from '$ui/table/types';
  import type { LidarrMetadataProfileListItem } from '$shared/pcd/display.ts';
  import { escapeHtml } from '$lib/client/utils/escapeHtml.ts';
  import CardGrid from '$ui/card/CardGrid.svelte';
  import Card from '$ui/card/Card.svelte';
  import { Tag, CheckCircle2, CalendarClock, Plus, Copy, Download, DatabaseZap, ClipboardCopy } from 'lucide-svelte';
  import type { PageData } from './$types';
  import { alertStore } from '$alerts/store';
  import Button from '$ui/button/Button.svelte';
  import CloneModal from '$ui/modal/CloneModal.svelte';
  import LocallyModifiedBadge from '$ui/badge/LocallyModifiedBadge.svelte';
  import { locallyModifiedBadgeHtml } from '$ui/badge/locallyModified.ts';

  export let data: PageData;

  const { search, view, filtered, setItems } = createDataPageStore(data.metadataProfiles, {
    storageKey: 'metadataProfilesView',
    searchKeys: ['name'],
    searchKey: `metadataProfilesSearch:${data.currentDatabase.id}`,
  });

  $: setItems(data.metadataProfiles);

  let onlyLocal = false;
  let initializedLocalOnlyKey = '';

  $: localOnlyStorageKey = `metadataProfilesLocalOnly:${data.currentDatabase.id}`;
  $: if (initializedLocalOnlyKey !== localOnlyStorageKey) {
    initializedLocalOnlyKey = localOnlyStorageKey;
    onlyLocal = loadLocalOnly(localOnlyStorageKey);
  }

  function toggleOnlyLocal() {
    onlyLocal = !onlyLocal;
    saveLocalOnly(localOnlyStorageKey, onlyLocal);
  }

  $: locallyModifiedCount = countLocallyModified(data.metadataProfiles);
  $: filteredProfiles = filterLocallyModified($filtered, onlyLocal);

  $: tabs = data.databases.map((database) => ({
    label: database.name,
    href: `/metadata-profiles/${database.id}`,
    active: database.id === data.currentDatabase.id,
  }));

  $: if (browser && data.currentDatabase?.id) {
    localStorage.setItem('metadataProfilesDatabase', String(data.currentDatabase.id));
  }

  let cloneModalOpen = false;
  let cloneSourceName = '';
  let copyModalOpen = false;
  function handleCopy(name: string) {
    cloneSourceName = name;
    copyModalOpen = true;
  }
  async function handleExport(name: string) {
    try {
      await downloadBundle(data.currentDatabase.id, 'lidarr_metadata_profile', name);
      alertStore.add('success', 'Bundle downloaded');
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Export failed');
    }
  }

  function getRowHref(row: LidarrMetadataProfileListItem): string {
    return `/metadata-profiles/${data.currentDatabase.id}/${encodeURIComponent(row.name)}`;
  }

  function handleClone(name: string) {
    cloneSourceName = name;
    cloneModalOpen = true;
  }

  async function handleClipboard(name: string) {
    try {
      const params = new URLSearchParams({
        databaseId: String(data.currentDatabase.id),
        entityType: 'lidarr_metadata_profile',
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

  const columns: Column<LidarrMetadataProfileListItem>[] = [
    {
      key: 'name',
      header: 'Name',
      headerIcon: Tag,
      align: 'left',
      sortable: true,
      cell: (row: LidarrMetadataProfileListItem) => ({
        html: `<div class="font-medium text-neutral-900 dark:text-neutral-100">${escapeHtml(row.name)}</div>${row.locallyModified ? locallyModifiedBadgeHtml() : ''}`,
      }),
    },
    {
      key: 'description',
      header: 'Description',
      align: 'left',
      cell: (row: LidarrMetadataProfileListItem) => ({
        html: row.description
          ? escapeHtml(String(row.description))
          : '<span class="text-neutral-400">No description</span>',
      }),
    },
    {
      key: 'primaryAllowedCount',
      header: 'Primary',
      align: 'left',
      width: 'w-40',
      cell: (row: LidarrMetadataProfileListItem) => ({
        html: `<div class="text-xs text-neutral-700 dark:text-neutral-300">${row.primaryAllowedCount}/${row.primaryTypeCount} allowed</div>`,
      }),
    },
    {
      key: 'secondaryAllowedCount',
      header: 'Secondary',
      align: 'left',
      width: 'w-44',
      cell: (row: LidarrMetadataProfileListItem) => ({
        html: `<div class="text-xs text-neutral-700 dark:text-neutral-300">${row.secondaryAllowedCount}/${row.secondaryTypeCount} allowed</div>`,
      }),
    },
    {
      key: 'releaseStatusAllowedCount',
      header: 'Release',
      align: 'left',
      width: 'w-40',
      cell: (row: LidarrMetadataProfileListItem) => ({
        html: `<div class="text-xs text-neutral-700 dark:text-neutral-300">${row.releaseStatusAllowedCount}/${row.releaseStatusCount} allowed</div>`,
      }),
    },
    {
      key: 'updated_at',
      header: 'Updated',
      align: 'left',
      width: 'w-40',
      cell: (row: LidarrMetadataProfileListItem) => ({
        html: `<span class="text-xs text-neutral-500 dark:text-neutral-400">${escapeHtml(row.updated_at || 'Never')}</span>`,
      }),
    },
  ];
</script>

<svelte:head>
  <title>Metadata Profiles - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
  <Tabs {tabs} responsive />

  <ActionsBar>
    <SearchAction searchStore={search} placeholder="Search metadata profiles..." responsive />
    <LocalOnlyFilterAction active={onlyLocal} count={locallyModifiedCount} on:toggle={toggleOnlyLocal} />
    <ViewToggle bind:value={$view} />
    <ActionButton
      icon={Plus}
      label="Add metadata profile"
      on:click={() => goto(`/metadata-profiles/${$page.params.databaseId}/new`)}
    />
  </ActionsBar>

  <div class="mt-6">
    {#if data.metadataProfiles.length === 0}
      <div
        class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p class="text-neutral-600 dark:text-neutral-400">
          No metadata profiles found for {data.currentDatabase.name}
        </p>
      </div>
    {:else if filteredProfiles.length === 0}
      <div
        class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
      >
        <p class="text-neutral-600 dark:text-neutral-400">
          {onlyLocal ? 'No locally modified metadata profiles' : 'No metadata profiles match your search'}
        </p>
      </div>
    {:else if $view === 'table'}
      <Table
        data={filteredProfiles}
        {columns}
        emptyMessage="No metadata profiles found"
        rowHref={getRowHref}
        rowLabel={(row) => row.name}
        compact={false}
        hoverable={true}
      >
        <svelte:fragment slot="actions" let:row>
          <div class="flex items-center justify-end gap-0.5">
            <Button
              icon={Download}
              size="xs"
              variant="ghost"
              tooltip="Download bundle"
              on:click={(event) => {
                event.stopPropagation();
                handleExport(row.name);
              }}
            />
            <Button
              icon={DatabaseZap}
              size="xs"
              variant="ghost"
              tooltip="Copy to database…"
              on:click={(event) => {
                event.stopPropagation();
                handleCopy(row.name);
              }}
            />
            <Button
              icon={ClipboardCopy}
              size="xs"
              variant="ghost"
              tooltip="Copy JSON to clipboard"
              on:click={(event) => {
                event.stopPropagation();
                handleClipboard(row.name);
              }}
            />
            <Button
              icon={Copy}
              size="xs"
              variant="ghost"
              tooltip="Clone"
              on:click={(event) => {
                event.stopPropagation();
                handleClone(row.name);
              }}
            />
          </div>
        </svelte:fragment>
      </Table>
    {:else}
      <CardGrid flush>
        {#each filteredProfiles as profile (profile.id)}
          <Card hoverable className="relative">
            <a href={getRowHref(profile)} aria-label={profile.name} class="absolute inset-0 rounded-xl"></a>
            <svelte:fragment slot="header">
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
                    >{profile.name}</span
                  >
                  {#if profile.locallyModified}
                    <LocallyModifiedBadge />
                  {/if}
                </div>
                <div class="relative z-10 flex items-center gap-0.5">
                  <Button
                    icon={Download}
                    size="xs"
                    variant="ghost"
                    tooltip="Download bundle"
                    on:click={() => handleExport(profile.name)}
                  />
                  <Button
                    icon={DatabaseZap}
                    size="xs"
                    variant="ghost"
                    tooltip="Copy to database…"
                    on:click={() => handleCopy(profile.name)}
                  />
                  <Button
                    icon={ClipboardCopy}
                    size="xs"
                    variant="ghost"
                    tooltip="Copy JSON to clipboard"
                    on:click={() => handleClipboard(profile.name)}
                  />
                  <Button
                    icon={Copy}
                    size="xs"
                    variant="ghost"
                    tooltip="Clone"
                    on:click={() => handleClone(profile.name)}
                  />
                </div>
              </div>
            </svelte:fragment>

            <div class="space-y-3 text-xs">
              <div class="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
                <CheckCircle2 size={12} />
                <span>{profile.primaryAllowedCount}/{profile.primaryTypeCount} primary types allowed</span>
              </div>
              <div class="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
                <CheckCircle2 size={12} />
                <span>{profile.secondaryAllowedCount}/{profile.secondaryTypeCount} secondary types allowed</span>
              </div>
              <div class="flex items-center gap-1 text-neutral-600 dark:text-neutral-400">
                <CheckCircle2 size={12} />
                <span>{profile.releaseStatusAllowedCount}/{profile.releaseStatusCount} release statuses allowed</span>
              </div>
              <div class="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                <CalendarClock size={12} />
                <span>{profile.updated_at || 'Never'}</span>
              </div>
            </div>
          </Card>
        {/each}
      </CardGrid>
    {/if}
  </div>
</div>

<CloneModal
  bind:open={cloneModalOpen}
  databaseId={data.currentDatabase.id}
  entityType="lidarr_metadata_profile"
  sourceName={cloneSourceName}
  existingNames={data.metadataProfiles.map((profile) => profile.name)}
  canWriteToBase={data.canWriteToBase}
/>

<CopyToDatabaseModal
  bind:open={copyModalOpen}
  databaseId={data.currentDatabase.id}
  entityType="lidarr_metadata_profile"
  sourceName={cloneSourceName}
/>
