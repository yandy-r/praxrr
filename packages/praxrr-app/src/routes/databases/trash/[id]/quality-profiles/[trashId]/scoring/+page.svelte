<script lang="ts">
	import Table from '$ui/table/Table.svelte';
	import type { Column } from '$ui/table/types.ts';
	import { escapeHtml } from '$lib/client/utils/escapeHtml.ts';
	import { page } from '$app/stores';

	$: entity = $page.data.entity;
	$: scoringRows = ($page.data.scoringItems ?? []) as ScoringTableRow[];

	interface ScoringTableRow {
		name: string;
		score: number | null;
		custom_format_trash_id: string | null;
	}

	$: columns = [
		{
			key: 'name',
			header: 'Custom Format',
			sortable: true
		},
		{
			key: 'score',
			header: 'Score',
			align: 'right' as const,
			sortable: true,
			cell: (row: ScoringTableRow) => (row.score !== null ? String(row.score) : '-')
		},
		{
			key: 'custom_format_trash_id',
			header: 'TRaSH ID',
			cell: (row: ScoringTableRow) =>
				row.custom_format_trash_id
					? {
							html: `<span class="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">${escapeHtml(row.custom_format_trash_id.substring(0, 8))}...</span>`
						}
					: '-'
		}
	] satisfies Column<ScoringTableRow>[];
</script>

<svelte:head>
	<title>{entity?.name ?? 'Quality Profile'} - Scoring - Praxrr</title>
</svelte:head>

<div class="mt-6">
	{#if scoringItems.length === 0}
		<div
			class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
		>
			<p class="text-neutral-600 dark:text-neutral-400">
				No custom format scores defined for this profile.
			</p>
		</div>
	{:else}
		<Table
			columns={columns}
			data={scoringRows}
			compact
			emptyMessage="No scoring entries"
			responsive
		/>
	{/if}
</div>
