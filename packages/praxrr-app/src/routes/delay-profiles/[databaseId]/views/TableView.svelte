<script lang="ts">
  import { ClipboardCopy, DatabaseZap } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import Table from '$ui/table/Table.svelte';
  import Button from '$ui/button/Button.svelte';
  import type { Column } from '$ui/table/types';
  import type { DelayProfileListItem } from '$shared/pcd/display.ts';
  import { escapeHtml } from '$lib/client/utils/escapeHtml.ts';
  import { locallyModifiedBadgeHtml } from '$ui/badge/locallyModified.ts';
  import { Tag, Clock, Zap, Shield, Copy, Download } from 'lucide-svelte';
  import { page } from '$app/stores';

  export let profiles: DelayProfileListItem[];

  const dispatch = createEventDispatcher<{
    clone: { name: string };
    export: { name: string };
    copy: { name: string };
    clipboard: { name: string };
  }>();

  $: databaseId = $page.params.databaseId;

  function getRowHref(row: DelayProfileListItem): string {
    return `/delay-profiles/${databaseId}/${encodeURIComponent(row.name)}`;
  }

  function formatProtocol(protocol: string): string {
    switch (protocol) {
      case 'prefer_usenet':
        return 'Prefer Usenet';
      case 'prefer_torrent':
        return 'Prefer Torrent';
      case 'only_usenet':
        return 'Only Usenet';
      case 'only_torrent':
        return 'Only Torrent';
      default:
        // Rendered via a Table html cell: escape anything outside the known enum.
        return escapeHtml(protocol);
    }
  }

  function formatDelay(minutes: number | null): string {
    if (minutes === null) return '-';
    if (minutes === 0) return 'No delay';
    return `${minutes}m`;
  }

  const columns: Column<DelayProfileListItem>[] = [
    {
      key: 'name',
      header: 'Name',
      headerIcon: Tag,
      align: 'left',
      sortable: true,
      cell: (row: DelayProfileListItem) => ({
        html: `<div class="font-medium">${escapeHtml(row.name)}</div>${row.locallyModified ? locallyModifiedBadgeHtml() : ''}`,
      }),
    },
    {
      key: 'preferred_protocol',
      header: 'Protocol',
      headerIcon: Zap,
      align: 'left',
      width: 'w-44',
      cell: (row: DelayProfileListItem) => ({
        html: `<span class="font-mono text-xs bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded">${formatProtocol(row.preferred_protocol)}</span>`,
      }),
    },
    {
      key: 'delays',
      header: 'Delays',
      headerIcon: Clock,
      align: 'left',
      width: 'w-48',
      cell: (row: DelayProfileListItem) => ({
        html: `
					<div class="text-xs space-y-0.5">
						${row.usenet_delay !== null ? `<div>Usenet: <span class="font-mono text-[10px] bg-neutral-100 dark:bg-neutral-800 px-1 rounded">${formatDelay(row.usenet_delay)}</span></div>` : ''}
						${row.torrent_delay !== null ? `<div>Torrent: <span class="font-mono text-[10px] bg-neutral-100 dark:bg-neutral-800 px-1 rounded">${formatDelay(row.torrent_delay)}</span></div>` : ''}
					</div>
				`,
      }),
    },
    {
      key: 'bypass',
      header: 'Bypass',
      headerIcon: Shield,
      align: 'left',
      width: 'w-56',
      cell: (row: DelayProfileListItem) => {
        const bypasses: string[] = [];
        if (row.bypass_if_highest_quality) {
          bypasses.push('Highest Quality');
        }
        if (row.bypass_if_above_custom_format_score && row.minimum_custom_format_score !== null) {
          bypasses.push(`CF Score ≥ ${row.minimum_custom_format_score}`);
        }

        if (bypasses.length === 0) {
          return { html: '<span class="text-neutral-400">None</span>' };
        }

        return {
          html: `
						<div class="text-xs space-y-0.5">
							${bypasses.map((b) => `<div class="font-mono text-[10px] bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-1.5 py-0.5 rounded inline-block">${b}</div>`).join('')}
						</div>
					`,
        };
      },
    },
  ];
</script>

<Table
  data={profiles}
  {columns}
  emptyMessage="No delay profiles found"
  hoverable={true}
  compact={false}
  rowHref={getRowHref}
  rowLabel={(row) => row.name}
>
  <!-- presentation role: stopPropagation wrapper; inner buttons carry the interaction -->
  <svelte:fragment slot="actions" let:row>
    <div role="presentation" class="flex items-center justify-end gap-0.5" on:click|stopPropagation>
      <Button
        icon={Download}
        size="xs"
        variant="ghost"
        tooltip="Download bundle"
        on:click={() => dispatch('export', { name: row.name })}
      />
      <Button
        icon={DatabaseZap}
        size="xs"
        variant="ghost"
        tooltip="Copy to database…"
        on:click={() => dispatch('copy', { name: row.name })}
      />
      <Button
        icon={ClipboardCopy}
        size="xs"
        variant="ghost"
        tooltip="Copy JSON to clipboard"
        on:click={() => dispatch('clipboard', { name: row.name })}
      />
      <Button
        icon={Copy}
        size="xs"
        variant="ghost"
        tooltip="Clone"
        on:click={() => dispatch('clone', { name: row.name })}
      />
    </div>
  </svelte:fragment>
</Table>
