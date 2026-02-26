<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Table from '$ui/table/Table.svelte';
	import Button from '$ui/button/Button.svelte';
	import SourceBadge from '$ui/badge/SourceBadge.svelte';
	import type { Column } from '$ui/table/types';
	import type { QualityProfileTableRow } from '$shared/pcd/display.ts';
	import type { SourceRef } from '$shared/sources/types.ts';
	import { ARR_APP_TYPES, getArrAppMetadata } from '$shared/arr/capabilities.ts';
	import {
		Tag,
		FileText,
		Layers,
		BookOpenText,
		Gauge,
		Earth,
		Database,
		Copy,
		Download
	} from 'lucide-svelte';
	import { page } from '$app/stores';

	export let profiles: QualityProfileTableRow[];
	export let availableSources: SourceRef[] = [];
	export let showSourceBadges = false;
	export let currentDatabaseId: number;

	const dispatch = createEventDispatcher<{ clone: { name: string }; export: { name: string } }>();

	$: databaseId = $page.params.databaseId;
	$: sourceMap = new Map(availableSources.map((source) => [`${source.type}:${source.id}`, source]));

	function resolveSourceDatabaseId(row: QualityProfileTableRow): number {
		if (row.sourceType === 'pcd' && typeof row.sourceDatabaseId === 'number') {
			return row.sourceDatabaseId;
		}

		const fallbackDatabaseId = Number(databaseId);
		if (Number.isInteger(fallbackDatabaseId)) {
			return fallbackDatabaseId;
		}

		return currentDatabaseId;
	}

	function isTrashRow(row: QualityProfileTableRow): boolean {
		return row.sourceType === 'trash';
	}

	function isEditableRow(row: QualityProfileTableRow): boolean {
		return !isTrashRow(row) && resolveSourceDatabaseId(row) === currentDatabaseId;
	}

	function getRowHref(row: QualityProfileTableRow): string | null {
		if (isTrashRow(row)) {
			return null;
		}

		return `/quality-profiles/${resolveSourceDatabaseId(row)}/${row.id}/general`;
	}

	function resolveSource(row: QualityProfileTableRow): SourceRef | null {
		const fallbackDatabaseId = Number(databaseId);
		const sourceType = row.sourceType ?? 'pcd';
		const sourceDatabaseId =
			row.sourceDatabaseId != null
				? row.sourceDatabaseId
				: Number.isFinite(fallbackDatabaseId)
					? fallbackDatabaseId
					: null;

		if (sourceDatabaseId == null) return null;

		const sourceKey = `${sourceType}:${sourceDatabaseId}`;
		const matchedSource = sourceMap.get(sourceKey);
		if (matchedSource) return matchedSource;

		if (sourceType === 'pcd' && row.sourceDatabaseName) {
			return {
				type: 'pcd',
				id: sourceDatabaseId,
				name: row.sourceDatabaseName
			};
		}

		return null;
	}

	const qualitySecondary =
		'inline-flex items-center leading-none font-medium font-mono px-2.5 py-1 text-xs rounded-md bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
	const qualitySuccess =
		'inline-flex items-center leading-none font-medium font-mono px-2.5 py-1 text-xs rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
	const labelSecondary =
		'inline-flex items-center leading-none font-medium font-mono px-2 py-1 text-[10px] rounded-md bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
	const labelSecondaryNoMono =
		'inline-flex items-center leading-none font-medium px-2 py-1 text-[10px] rounded-md bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';

	const sourceColumn: Column<QualityProfileTableRow> = {
		key: 'source',
		header: 'Source',
		headerIcon: Database,
		align: 'left',
		width: 'w-44'
	};

	// Define table columns for quality profiles
	const baseColumns: Column<QualityProfileTableRow>[] = [
		{
			key: 'name',
			header: 'Name',
			headerIcon: Tag,
			align: 'left',
			sortable: true,
			cell: (row: QualityProfileTableRow) => ({
				html: `
					<div>
						<div class="font-medium">${row.name}</div>
						${
							row.tags.length > 0
								? `
							<div class="mt-1 flex flex-wrap gap-1">
								${row.tags
									.map(
										(tag) => `
									<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-accent-100 text-accent-800 dark:bg-accent-900 dark:text-accent-200">
										${tag.name}
									</span>
								`
									)
									.join('')}
							</div>
						`
								: ''
						}
					</div>
				`
			})
		},
		{
			key: 'description',
			header: 'Description',
			headerIcon: FileText,
			align: 'left',
			cell: (row: QualityProfileTableRow) => ({
				html: row.description || '<span class="text-neutral-400">No description</span>'
			})
		},
		{
			key: 'qualities',
			header: 'Qualities',
			headerIcon: Layers,
			align: 'left',
			width: 'w-48',
			cell: (row: QualityProfileTableRow) => {
				return {
					html: `
						<div class="flex flex-wrap gap-1 py-1">
							${row.qualities
								.map(
									(q) => `
								<span class="${q.is_upgrade_until ? qualitySuccess : qualitySecondary}">${q.name}</span>
							`
								)
								.join('')}
						</div>
					`
				};
			}
		},
		{
			key: 'custom_formats',
			header: 'Custom Formats',
			headerIcon: BookOpenText,
			align: 'left',
			width: 'w-48',
			cell: (row: QualityProfileTableRow) => {
				const appRows = ARR_APP_TYPES.map((arrType) => {
					const label = getArrAppMetadata(arrType).label;
					const count = row.custom_formats[arrType] ?? 0;
					return `<div class="flex items-center gap-1.5">${label}: <span class="${labelSecondary}">${count}</span></div>`;
				}).join('');

				return {
					html: `
						<div class="text-xs space-y-1">
							<div class="flex items-center gap-1.5">All: <span class="${labelSecondary}">${row.custom_formats.all}</span></div>
							${appRows}
						</div>
					`
				};
			}
		},
		{
			key: 'scores',
			header: 'Scores',
			headerIcon: Gauge,
			align: 'left',
			width: 'w-52',
			cell: (row: QualityProfileTableRow) => ({
				html: `
					<div class="text-xs space-y-1">
						<div class="flex items-center gap-1.5">Minimum: <span class="${labelSecondary}">${row.minimum_custom_format_score}</span></div>
						${
							row.upgrades_allowed
								? `
							<div class="flex items-center gap-1.5">Upgrade Until: <span class="${labelSecondary}">${row.upgrade_until_score}</span></div>
							<div class="flex items-center gap-1.5">Increment: <span class="${labelSecondary}">${row.upgrade_score_increment}</span></div>
						`
								: `
							<div class="text-neutral-500 dark:text-neutral-400">No Upgrades</div>
						`
						}
					</div>
				`
			})
		},
		{
			key: 'language',
			header: 'Language',
			headerIcon: Earth,
			align: 'left',
			width: 'w-40',
			cell: (row: QualityProfileTableRow) => {
				return {
					html: `<span class="${labelSecondaryNoMono}">${row.language ? (row.language.name === 'Original' ? 'Any' : row.language.name) : 'Any'}</span>`
				};
			}
		}
	];

	$: columns = showSourceBadges ? [sourceColumn, ...baseColumns] : baseColumns;
</script>

<Table
	data={profiles}
	{columns}
	emptyMessage="No quality profiles found"
	hoverable={true}
	compact={false}
	rowHref={getRowHref}
	pageSize={50}
>
	<svelte:fragment slot="cell" let:row let:column>
		{#if column.key === 'source'}
			{@const source = resolveSource(row)}
			{#if source}
				<SourceBadge
					sourceType={source.type}
					sourceName={source.name}
					arrType={source.type === 'trash' ? source.arrType : null}
				/>
			{:else}
				<span class="text-xs text-neutral-400">-</span>
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
					on:click={() => dispatch('export', { name: row.name })}
				/>
				<Button
					icon={Copy}
					size="xs"
					variant="ghost"
					tooltip="Clone"
					on:click={() => dispatch('clone', { name: row.name })}
				/>
			</div>
		{/if}
	</svelte:fragment>
</Table>
