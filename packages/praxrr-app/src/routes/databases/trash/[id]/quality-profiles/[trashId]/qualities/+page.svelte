<script lang="ts">
	import Table from '$ui/table/Table.svelte';
	import type { Column } from '$ui/table/types.ts';
	import { page } from '$app/stores';

	$: entity = $page.data.entity;
	$: items = entity?.items ?? [];

	$: tableData = items.map((item: any, index: number) => ({
		position: index + 1,
		name: item.name,
		allowed: item.allowed,
		qualities: item.qualities,
		isGroup: Array.isArray(item.qualities) && item.qualities.length > 1
	}));

	$: columns = [
		{
			key: 'position',
			header: '#',
			width: 'w-16',
			align: 'center' as const
		},
		{
			key: 'name',
			header: 'Name'
		},
		{
			key: 'allowed',
			header: 'Allowed',
			align: 'center' as const,
			cell: (row: any) =>
				row.allowed
					? { html: '<span class="text-emerald-600 dark:text-emerald-400">&#10003;</span>' }
					: { html: '<span class="text-neutral-400 dark:text-neutral-600">&#10007;</span>' }
		},
		{
			key: 'qualities',
			header: 'Sub-Qualities',
			cell: (row: any) => (row.isGroup ? row.qualities.join(', ') : '-')
		}
	] satisfies Column<any>[];
</script>

<svelte:head>
	<title>{entity?.name ?? 'Quality Profile'} - Qualities - Praxrr</title>
</svelte:head>

<div class="mt-6">
	<Table
		columns={columns}
		data={tableData}
		compact
		hoverable={false}
		emptyMessage="No quality items defined."
		responsive
	/>
</div>
