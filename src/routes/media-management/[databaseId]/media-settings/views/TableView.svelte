<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Table from '$ui/table/Table.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import Button from '$ui/button/Button.svelte';
	import type { Column } from '$ui/table/types';
	import { Tag, Info, RefreshCw, Copy, Download } from 'lucide-svelte';
	import type { MediaSettingsListItem } from '$shared/pcd/display.ts';
	import type { ArrAppType } from '$shared/arr/capabilities.ts';
	import radarrLogo from '$lib/client/assets/Radarr.svg';
	import sonarrLogo from '$lib/client/assets/Sonarr.svg';

	export let configs: MediaSettingsListItem[];
	export let databaseId: number;

	const dispatch = createEventDispatcher<{
		clone: { name: string; arr_type: string };
		export: { name: string; arr_type: string };
	}>();

	const logos: Partial<Record<ArrAppType, string>> = {
		radarr: radarrLogo,
		sonarr: sonarrLogo
	};
	const validArrTypes: ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];

	function isSupportedArrType(arrType: string): arrType is ArrAppType {
		return validArrTypes.includes(arrType as ArrAppType);
	}

	function getAppLabel(arrType: string): string {
		return isSupportedArrType(arrType)
			? arrType.charAt(0).toUpperCase() + arrType.slice(1)
			: 'Unknown';
	}

	function getLogoPath(arrType: string): string {
		if (!isSupportedArrType(arrType)) {
			return '';
		}

		return logos[arrType] ?? '';
	}

	const propersRepacksConfig: Record<string, { variant: 'neutral' | 'success' | 'warning'; label: string }> = {
		doNotPrefer: { variant: 'neutral', label: 'Do Not Prefer' },
		preferAndUpgrade: { variant: 'success', label: 'Prefer & Upgrade' },
		doNotUpgradeAutomatically: { variant: 'warning', label: 'No Auto Upgrade' }
	};

	function getRowHref(config: MediaSettingsListItem): string {
		if (!isSupportedArrType(config.arr_type)) {
			return `/media-management/${databaseId}/media-settings`;
		}

		return `/media-management/${databaseId}/media-settings/${config.arr_type}/${encodeURIComponent(config.name)}`;
	}

	const columns: Column<MediaSettingsListItem>[] = [
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
			key: 'propers_repacks',
			header: 'Propers & Repacks',
			headerIcon: RefreshCw
		},
		{
			key: 'enable_media_info',
			header: 'Media Info',
			headerIcon: Info
		}
	];
</script>

<Table {columns} data={configs} rowHref={getRowHref} hoverable={true}>
	<svelte:fragment slot="cell" let:row let:column>
		{#if column.key === 'name'}
			<span class="font-medium">{row.name}</span>
		{:else if column.key === 'arr_type'}
			<div class="flex items-center gap-2">
				{#if getLogoPath(row.arr_type)}
					<img
						src={getLogoPath(row.arr_type)}
						alt={`${getAppLabel(row.arr_type)} logo`}
						class="h-5 w-5"
					/>
				{:else}
					<div
						class="flex h-5 w-5 items-center justify-center rounded bg-neutral-100 text-[0.6rem] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
					>
						{getAppLabel(row.arr_type).slice(0, 1).toUpperCase()}
					</div>
				{/if}
			</div>
		{:else if column.key === 'propers_repacks'}
			{@const config = propersRepacksConfig[row.propers_repacks] || { variant: 'neutral', label: row.propers_repacks }}
			<Badge variant={config.variant}>{config.label}</Badge>
		{:else if column.key === 'enable_media_info'}
			{#if row.enable_media_info}
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
