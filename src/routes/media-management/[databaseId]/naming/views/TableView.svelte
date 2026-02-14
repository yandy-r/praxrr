<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Table from '$ui/table/Table.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import Button from '$ui/button/Button.svelte';
	import type { Column } from '$ui/table/types';
	import { Tag, ToggleRight, Copy, Download } from 'lucide-svelte';
	import type { NamingListItem } from '$shared/pcd/display.ts';
	import radarrLogo from '$lib/client/assets/Radarr.svg';
	import sonarrLogo from '$lib/client/assets/Sonarr.svg';
	import lidarrLogo from '$lib/client/assets/Lidarr.png';
	import { isArrAppType } from '$shared/arr/capabilities.ts';
	import { getMediaManagementDisplayName } from '$shared/arr/displayName.ts';

	export let configs: NamingListItem[];
	export let databaseId: number;

	const dispatch = createEventDispatcher<{
		clone: { name: string; arr_type: string };
		export: { name: string; arr_type: string };
	}>();

	const logos: Record<string, string> = {
		radarr: radarrLogo,
		sonarr: sonarrLogo,
		lidarr: lidarrLogo
	};

	function getRowHref(config: NamingListItem): string {
		if (!config.name?.trim() || !isArrAppType(config.arr_type)) {
			return `/media-management/${databaseId}/naming`;
		}

		return `/media-management/${databaseId}/naming/${config.arr_type}/${encodeURIComponent(config.name)}`;
	}

	function getLogo(config: NamingListItem): string {
		if (!isArrAppType(config.arr_type)) {
			return '';
		}

		return logos[config.arr_type] ?? '';
	}

	function getArrTypeInitial(appType: string): string {
		if (!appType) {
			return '?';
		}
		return appType.charAt(0).toUpperCase();
	}

	const columns: Column<NamingListItem>[] = [
		{
			key: 'name',
			header: 'Name',
			headerIcon: Tag,
			align: 'left',
			sortable: true
		},
		{
			key: 'arr_type',
			header: 'Type',
			sortable: true
		},
		{
			key: 'rename',
			header: 'Rename',
			headerIcon: ToggleRight
		}
	];
</script>

<Table {columns} data={configs} rowHref={getRowHref} hoverable={true}>
	<svelte:fragment slot="cell" let:row let:column>
		{#if column.key === 'name'}
			<span class="font-medium">{getMediaManagementDisplayName(row.name, row.arr_type)}</span>
		{:else if column.key === 'arr_type'}
			<div class="flex items-center gap-2">
				{#if getLogo(row)}
					<img
						src={getLogo(row)}
						alt={row.arr_type}
						class="h-5 w-5"
					/>
				{:else}
					<div
						class="flex h-5 w-5 items-center justify-center rounded bg-neutral-100 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
					>
						{getArrTypeInitial(row.arr_type)}
					</div>
				{/if}
			</div>
		{:else if column.key === 'rename'}
			{#if row.rename}
				<Badge variant="success">Enabled</Badge>
			{:else}
				<Badge variant="neutral">Disabled</Badge>
			{/if}
		{/if}
	</svelte:fragment>

	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<svelte:fragment slot="actions" let:row>
		<div class="flex items-center justify-end gap-0.5" on:click|stopPropagation>
			<Button
				icon={Download}
				size="xs"
				variant="ghost"
				tooltip="Export"
				on:click={() => dispatch('export', { name: row.name, arr_type: row.arr_type })}
			/>
			<Button
				icon={Copy}
				size="xs"
				variant="ghost"
				tooltip="Clone"
				on:click={() => dispatch('clone', { name: row.name, arr_type: row.arr_type })}
			/>
		</div>
	</svelte:fragment>
</Table>
