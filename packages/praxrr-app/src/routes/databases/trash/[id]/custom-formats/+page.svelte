<script lang="ts">
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import Table from '$ui/table/Table.svelte';
	import { createSearchStore } from '$lib/client/stores/search.ts';
	import type { Column } from '$ui/table/types.ts';
	import { page } from '$app/stores';

	$: source = $page.data.source;
	$: customFormats = $page.data.customFormats ?? [];

	const search = createSearchStore();
	const debouncedQuery = search.debouncedQuery;

	$: filtered = $debouncedQuery
		? customFormats.filter(
				(cf: any) => cf.name.toLowerCase().includes($debouncedQuery.toLowerCase())
			)
		: customFormats;

	$: columns = [
		{
			key: 'name',
			header: 'Name',
			sortable: true
		},
		{
			key: 'description',
			header: 'Description',
			cell: (row: any) =>
				row.description
					? row.description.length > 80
						? row.description.substring(0, 80) + '...'
						: row.description
					: '-'
		},
		{
			key: 'conditions',
			header: 'Conditions',
			align: 'center' as const,
			cell: (row: any) => String(row.conditions?.length ?? 0)
		}
	] satisfies Column<any>[];
</script>

<svelte:head>
	<title>Custom Formats - {source?.name ?? 'TRaSH Source'} - Praxrr</title>
</svelte:head>

<div class="mt-6 space-y-4">
	<ActionsBar>
		<SearchAction searchStore={search} placeholder="Search custom formats..." responsive />
	</ActionsBar>

	<Table
		{columns}
		data={filtered}
		rowHref={(row) => `/databases/trash/${source?.id}/custom-formats/${row.trashId}/`}
		emptyMessage="No custom formats cached. Try syncing the source."
		responsive
	/>
</div>
