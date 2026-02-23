<script lang="ts">
  import { resolve } from '$app/paths';
  import { ExternalLink, Trash2 } from 'lucide-svelte';
  import Table from '$ui/table/Table.svelte';
  import TableActionButton from '$ui/table/TableActionButton.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import type { Column } from '$ui/table/types';
  import type { ArrInstance } from '$db/queries/arrInstances.ts';
  import type { ArrIconKey } from '$shared/arr/capabilities.ts';
  import { ARR_APP_TYPES, getArrAppMetadata, isArrAppType } from '$shared/arr/capabilities.ts';
  import { resolveInstanceBrowserUrl } from '$shared/arr/instanceUrl.ts';
  import radarrLogo from '$lib/client/assets/Radarr.svg';
  import sonarrLogo from '$lib/client/assets/Sonarr.svg';
  import lidarrLogo from '$lib/client/assets/Lidarr.png';
  import { createEventDispatcher } from 'svelte';

  export let instances: ArrInstance[];

  const dispatch = createEventDispatcher<{
    delete: ArrInstance;
  }>();

  const logoAssets: Record<string, string> = {
    radarr: radarrLogo,
    sonarr: sonarrLogo,
    lidarr: lidarrLogo,
  };

  // Build logo lookup from registered Arr app types so every app in
  // ARR_APP_TYPES is represented. Missing assets resolve to undefined.
  const logos: Partial<Record<ArrIconKey, string>> = Object.fromEntries(
    ARR_APP_TYPES.map((type) => [type, logoAssets[type]])
  ) as Partial<Record<ArrIconKey, string>>;

  function formatType(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  function getAppLabel(type: string): string {
    if (!isArrAppType(type)) {
      return formatType(type);
    }

    return getArrAppMetadata(type).label;
  }

  // Get logo path from centralized metadata
  function getLogoPath(type: string): string {
    if (!isArrAppType(type)) {
      return '';
    }

    const metadata = getArrAppMetadata(type);
    return logos[metadata.iconKey] ?? '';
  }

  function getAppInitial(type: string): string {
    return getAppLabel(type).slice(0, 1).toUpperCase();
  }

  function getRowHref(instance: ArrInstance): string {
    return resolve('/arr/[id]', { id: instance.id.toString() });
  }

  // Handle delete click
  function handleDeleteClick(e: Event, instance: ArrInstance) {
    e.stopPropagation();
    e.preventDefault();
    dispatch('delete', instance);
  }

  // Handle external link click
  function handleExternalClick(e: Event, instance: ArrInstance) {
    e.stopPropagation();
    e.preventDefault();
    window.open(resolveInstanceBrowserUrl(instance), '_blank', 'noopener,noreferrer');
  }

  // Define table columns
  const columns: Column<ArrInstance>[] = [
    { key: 'name', header: 'Name', align: 'left' },
    { key: 'url', header: 'URL', align: 'left' },
    { key: 'enabled', header: 'Enabled', align: 'center', width: 'w-24' },
  ];
</script>

<Table {columns} data={instances} hoverable={true} rowHref={getRowHref}>
  <svelte:fragment slot="cell" let:row let:column>
    {#if column.key === 'name'}
      {@const appLabel = getAppLabel(row.type)}
      {@const logoPath = getLogoPath(row.type)}
      <div class="flex items-center gap-3">
        {#if logoPath}
          <img src={logoPath} alt={`${appLabel} logo`} class="h-8 w-8 rounded-lg" />
        {:else}
          <div
            class="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
          >
            {getAppInitial(row.type)}
          </div>
        {/if}
        <div class="flex items-center gap-2">
          <div class="font-medium text-neutral-900 dark:text-neutral-50">
            {row.name}
          </div>
          <Badge variant="neutral">{appLabel}</Badge>
        </div>
      </div>
    {:else if column.key === 'url'}
      <Badge variant="neutral" mono>{row.url}</Badge>
    {:else if column.key === 'enabled'}
      <div class="flex justify-center">
        {#if row.enabled}
          <Badge variant="success">Enabled</Badge>
        {:else}
          <Badge variant="neutral">Disabled</Badge>
        {/if}
      </div>
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="actions" let:row>
    <div class="relative z-10 flex items-center justify-end gap-1">
      <TableActionButton
        icon={ExternalLink}
        title="Open in {getAppLabel(row.type)}"
        on:click={(e) => handleExternalClick(e, row)}
      />
      <TableActionButton
        icon={Trash2}
        title="Delete instance"
        variant="danger"
        on:click={(e) => handleDeleteClick(e, row)}
      />
    </div>
  </svelte:fragment>
</Table>
