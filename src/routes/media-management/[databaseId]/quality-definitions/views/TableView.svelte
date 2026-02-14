<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Table from '$ui/table/Table.svelte';
	import Button from '$ui/button/Button.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import type { Column } from '$ui/table/types';
	import { Tag, Copy, Download } from 'lucide-svelte';
	import type { QualityDefinitionListItem } from '$shared/pcd/display.ts';
	import { ARR_APP_TYPES, type ArrIconKey, getArrAppMetadata, isArrAppType } from '$shared/arr/capabilities.ts';
	import radarrLogo from '$lib/client/assets/Radarr.svg';
	import sonarrLogo from '$lib/client/assets/Sonarr.svg';

	export let configs: QualityDefinitionListItem[];
	export let databaseId: number;

	const dispatch = createEventDispatcher<{
		clone: { name: string; arr_type: string };
		export: { name: string; arr_type: string };
	}>();

	// Available logo assets keyed by ArrIconKey.
	// Lidarr does not currently have a dedicated asset, so initial fallback is used.
	const logoAssets: Record<string, string> = {
		radarr: radarrLogo,
		sonarr: sonarrLogo
	};

	const appLogos: Partial<Record<ArrIconKey, string>> = Object.fromEntries(
		ARR_APP_TYPES.map((type) => [type, logoAssets[type]])
	) as Partial<Record<ArrIconKey, string>>;

	function formatTypeLabel(type: string): string {
		if (!type) {
			return 'Unknown';
		}

		return type.charAt(0).toUpperCase() + type.slice(1);
	}

	function getAppLabel(type: string): string {
		if (!isArrAppType(type)) {
			return formatTypeLabel(type);
		}

		return getArrAppMetadata(type).label;
	}

	function getLogoPath(type: string): string {
		if (!isArrAppType(type)) {
			return '';
		}

		const metadata = getArrAppMetadata(type);
		return appLogos[metadata.iconKey] ?? '';
	}

	function getAppInitial(type: string): string {
		return getAppLabel(type).slice(0, 1).toUpperCase();
	}

	function getBadgeVariant(type: string): 'radarr' | 'sonarr' | 'lidarr' | 'warning' {
		return isArrAppType(type) ? type : 'warning';
	}

	function getRowHref(config: QualityDefinitionListItem): string {
		if (!config.name?.trim() || !isArrAppType(config.arr_type)) {
			return `/media-management/${databaseId}/quality-definitions`;
		}

		return `/media-management/${databaseId}/quality-definitions/${config.arr_type}/${encodeURIComponent(config.name)}`;
	}

	const columns: Column<QualityDefinitionListItem>[] = [
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
		}
	];
</script>

<Table {columns} data={configs} rowHref={getRowHref} hoverable={true}>
	<svelte:fragment slot="cell" let:row let:column>
		{#if column.key === 'name'}
			<span class="font-medium">{row.name}</span>
		{:else if column.key === 'arr_type'}
			{@const appLabel = getAppLabel(row.arr_type)}
			{@const logoPath = getLogoPath(row.arr_type)}
			<div class="flex items-center gap-2">
				{#if logoPath}
					<img src={logoPath} alt={`${appLabel} logo`} class="h-5 w-5" />
				{:else}
					<div
						class="flex h-5 w-5 items-center justify-center rounded text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
						style="background-color: var(--arr-lidarr-color);"
					>
						{getAppInitial(row.arr_type)}
					</div>
				{/if}
				<Badge variant={getBadgeVariant(row.arr_type)} size="sm">{appLabel}</Badge>
			</div>
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
