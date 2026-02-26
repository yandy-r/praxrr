<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Table from '$ui/table/Table.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import SourceBadge from '$ui/badge/SourceBadge.svelte';
	import Button from '$ui/button/Button.svelte';
	import type { Column } from '$ui/table/types';
	import { Tag, ToggleRight, Copy, Download, Database } from 'lucide-svelte';
	import type { SourcedNamingListItem } from '$shared/pcd/display.ts';
	import type { SourceRef } from '$shared/sources/types.ts';
	import type { ArrAppType } from '$shared/arr/capabilities.ts';
	import radarrLogo from '$lib/client/assets/Radarr.svg';
	import sonarrLogo from '$lib/client/assets/Sonarr.svg';
	import lidarrLogo from '$lib/client/assets/Lidarr.png';
	import { getMediaManagementDisplayName, getMediaManagementRouteName } from '$shared/arr/displayName.ts';

	export let configs: SourcedNamingListItem[];
	export let databaseId: number;
	export let currentDatabaseId: number;
	export let currentDatabaseName: string;
	export let sources: SourceRef[] = [];
	export let showSourceBadges = false;

	const dispatch = createEventDispatcher<{
		clone: { name: string; arr_type: string };
		export: { name: string; arr_type: string };
	}>();

	const supportedArrTypes: ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];

	const logos: Partial<Record<ArrAppType, string>> = {
		radarr: radarrLogo,
		sonarr: sonarrLogo,
		lidarr: lidarrLogo
	};
	$: sourceLookup = new Map(sources.map((source) => [`${source.type}:${source.id}`, source] as const));
	$: fallbackSource = {
		type: 'pcd' as const,
		id: currentDatabaseId,
		name: currentDatabaseName
	};

	interface ResolvedSource {
		type: SourceRef['type'];
		id: number;
		name: string;
		arrType: ArrAppType | null;
	}

	function isSupportedArrType(arrType: string): arrType is ArrAppType {
		return supportedArrTypes.includes(arrType as ArrAppType);
	}

	function resolveSource(config: SourcedNamingListItem): ResolvedSource {
		if (config.sourceType && typeof config.sourceDatabaseId === 'number') {
			const matched = sourceLookup.get(`${config.sourceType}:${config.sourceDatabaseId}`);
			if (matched) {
				return {
					type: matched.type,
					id: matched.id,
					name: matched.name,
					arrType: matched.type === 'trash' ? matched.arrType : null
				};
			}

			return {
				type: config.sourceType,
				id: config.sourceDatabaseId,
				name: config.sourceDatabaseName ?? `Source ${config.sourceDatabaseId}`,
				arrType: null
			};
		}

		return {
			type: fallbackSource.type,
			id: fallbackSource.id,
			name: fallbackSource.name,
			arrType: null
		};
	}

	function resolveSourceDatabaseId(config: SourcedNamingListItem): number {
		if (config.sourceType === 'pcd' && typeof config.sourceDatabaseId === 'number') {
			return config.sourceDatabaseId;
		}

		return databaseId;
	}

	function isTrashRow(config: SourcedNamingListItem): boolean {
		return config.sourceType === 'trash';
	}

	function isEditableRow(config: SourcedNamingListItem): boolean {
		return !isTrashRow(config) && resolveSourceDatabaseId(config) === currentDatabaseId;
	}

	function getRowHref(config: SourcedNamingListItem): string | null {
		if (isTrashRow(config)) {
			return null;
		}

		const sourceDatabaseId = resolveSourceDatabaseId(config);
		const routeName = getMediaManagementRouteName(config.name, config.arr_type).trim();
		if (!routeName || !isSupportedArrType(config.arr_type)) {
			return `/media-management/${sourceDatabaseId}/naming`;
		}

		return `/media-management/${sourceDatabaseId}/naming/${config.arr_type}/${encodeURIComponent(routeName)}`;
	}

	function getLogo(config: SourcedNamingListItem): string {
		if (!isSupportedArrType(config.arr_type)) {
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

	const baseColumns: Column<SourcedNamingListItem>[] = [
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

	const sourceColumn: Column<SourcedNamingListItem> = {
		key: 'source',
		header: 'Source',
		headerIcon: Database,
		align: 'left',
		width: 'w-40',
		sortable: true,
		sortAccessor: (row) => resolveSource(row).name.toLowerCase()
	};

	$: columns = showSourceBadges ? [baseColumns[0], sourceColumn, ...baseColumns.slice(1)] : baseColumns;
</script>

<Table {columns} data={configs} rowHref={getRowHref} hoverable={true}>
	<svelte:fragment slot="cell" let:row let:column>
		{#if column.key === 'name'}
			<span class="font-medium">{getMediaManagementDisplayName(row.name, row.arr_type)}</span>
		{:else if column.key === 'source'}
			{@const source = resolveSource(row)}
			<SourceBadge
				sourceType={source.type}
				sourceName={source.name}
				arrType={source.arrType}
				size="sm"
			/>
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
		{#if isEditableRow(row)}
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
		{/if}
	</svelte:fragment>
</Table>
