<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Table from '$ui/table/Table.svelte';
	import Button from '$ui/button/Button.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import SourceBadge from '$ui/badge/SourceBadge.svelte';
	import type { Column } from '$ui/table/types';
	import { Tag, Copy, Download, Database } from 'lucide-svelte';
	import type { SourcedQualityDefinitionListItem } from '$shared/pcd/display.ts';
	import type { SourceRef } from '$shared/sources/types.ts';
	import {
		ARR_APP_TYPES,
		type ArrAppType,
		type ArrIconKey,
		getArrAppMetadata,
		isArrAppType
	} from '$shared/arr/capabilities.ts';
	import { getMediaManagementDisplayName, getMediaManagementRouteName } from '$shared/arr/displayName.ts';
	import radarrLogo from '$lib/client/assets/Radarr.svg';
	import sonarrLogo from '$lib/client/assets/Sonarr.svg';
	import lidarrLogo from '$lib/client/assets/Lidarr.png';

	export let configs: SourcedQualityDefinitionListItem[];
	export let databaseId: number;
	export let currentDatabaseId: number;
	export let currentDatabaseName: string;
	export let sources: SourceRef[] = [];
	export let showSourceBadges = false;

	const dispatch = createEventDispatcher<{
		clone: { name: string; arr_type: string };
		export: { name: string; arr_type: string };
	}>();

	// Available logo assets keyed by ArrIconKey.
	const logoAssets: Record<string, string> = {
		radarr: radarrLogo,
		sonarr: sonarrLogo,
		lidarr: lidarrLogo
	};

	const appLogos: Partial<Record<ArrIconKey, string>> = Object.fromEntries(
		ARR_APP_TYPES.map((type) => [type, logoAssets[type]])
	) as Partial<Record<ArrIconKey, string>>;
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

	function getMappedQualityLabel(qualityCount: number): string {
		if (qualityCount === 0) {
			return 'No mapped qualities';
		}

		return qualityCount === 1 ? '1 mapped quality' : `${qualityCount} mapped qualities`;
	}

	function resolveSource(config: SourcedQualityDefinitionListItem): ResolvedSource {
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

	function resolveSourceDatabaseId(config: SourcedQualityDefinitionListItem): number {
		if (config.sourceType === 'pcd' && typeof config.sourceDatabaseId === 'number') {
			return config.sourceDatabaseId;
		}

		return databaseId;
	}

	function isTrashRow(config: SourcedQualityDefinitionListItem): boolean {
		return config.sourceType === 'trash';
	}

	function isEditableRow(config: SourcedQualityDefinitionListItem): boolean {
		return !isTrashRow(config) && resolveSourceDatabaseId(config) === currentDatabaseId;
	}

	function getRowHref(config: SourcedQualityDefinitionListItem): string | null {
		if (isTrashRow(config)) {
			return null;
		}

		const sourceDatabaseId = resolveSourceDatabaseId(config);
		const routeName = getMediaManagementRouteName(config.name, config.arr_type).trim();
		if (!routeName || !isArrAppType(config.arr_type)) {
			return `/media-management/${sourceDatabaseId}/quality-definitions`;
		}

		return `/media-management/${sourceDatabaseId}/quality-definitions/${config.arr_type}/${encodeURIComponent(routeName)}`;
	}

	const baseColumns: Column<SourcedQualityDefinitionListItem>[] = [
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

	const sourceColumn: Column<SourcedQualityDefinitionListItem> = {
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
			{@const appLabel = getAppLabel(row.arr_type)}
			{@const logoPath = getLogoPath(row.arr_type)}
			{@const hasAppMapping = isArrAppType(row.arr_type)}
			{@const hasMappedQualities = row.quality_count > 0}
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
				{#if !hasAppMapping}
					<Badge variant="warning" size="sm">Missing app mapping</Badge>
				{:else if !hasMappedQualities}
					<Badge variant="warning" size="sm">Missing quality mappings</Badge>
				{/if}
				<Badge variant={hasMappedQualities ? 'neutral' : 'warning'} size="sm">
					{getMappedQualityLabel(row.quality_count)}
				</Badge>
			</div>
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
