<script lang="ts">
	import DetailHeader from '../../components/DetailHeader.svelte';
	import DetailCard from '../../components/DetailCard.svelte';
	import DetailField from '../../components/DetailField.svelte';
	import Table from '$ui/table/Table.svelte';
	import type { Column } from '$ui/table/types.ts';
	import { page } from '$app/stores';

	$: source = $page.data.source;
	$: entity = $page.data.entity;
	$: fetchedAt = $page.data.fetchedAt;

	$: qualities = entity?.qualities ?? [];

	function formatSize(mb: number): string {
		if (mb >= 1000) {
			return `${(mb / 1000).toFixed(1)} GB`;
		}
		return `${mb.toFixed(1)} MB`;
	}

	$: columns = [
		{
			key: 'quality',
			header: 'Quality',
			sortable: true
		},
		{
			key: 'min',
			header: 'Min',
			align: 'right' as const,
			sortable: true,
			cell: (row: any) => formatSize(row.min)
		},
		{
			key: 'preferred',
			header: 'Preferred',
			align: 'right' as const,
			sortable: true,
			cell: (row: any) => formatSize(row.preferred)
		},
		{
			key: 'max',
			header: 'Max',
			align: 'right' as const,
			sortable: true,
			cell: (row: any) => formatSize(row.max)
		}
	] satisfies Column<any>[];

	function formatDate(date: string): string {
		return new Date(date).toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>{entity?.name ?? 'Quality Size'} - Praxrr</title>
</svelte:head>

{#if entity}
	<div class="mt-6 space-y-6">
		<DetailHeader name={entity.name} arrType={source?.arrType ?? 'radarr'} />

		<DetailCard title="Details">
			<DetailField label="Name" value={entity.name} />
			<DetailField label="Profile Type" value={entity.profile_type} />
			<DetailField label="File Path" value={entity.file_path} mono />
			<DetailField label="Fetched At" value={formatDate(fetchedAt)} />
		</DetailCard>

		<div>
			<h3 class="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
				Quality Entries ({qualities.length})
			</h3>
			<Table
				columns={columns}
				data={qualities}
				compact
				hoverable={false}
				emptyMessage="No quality entries defined."
				responsive
			/>
		</div>
	</div>
{/if}
