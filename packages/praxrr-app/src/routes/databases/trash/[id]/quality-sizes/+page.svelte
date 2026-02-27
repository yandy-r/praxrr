<script lang="ts">
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import Table from '$ui/table/Table.svelte';
	import { createSearchStore } from '$lib/client/stores/search.ts';
	import type { Column } from '$ui/table/types.ts';
	import { page } from '$app/stores';

	$: source = $page.data.source;
	$: qualitySizes = $page.data.qualitySizes ?? [];

	const search = createSearchStore();
	const debouncedQuery = search.debouncedQuery;

	$: filtered = $debouncedQuery
		? qualitySizes.filter(
				(qs: any) => qs.name.toLowerCase().includes($debouncedQuery.toLowerCase())
			)
		: qualitySizes;

	$: columns = [
		{
			key: 'name',
			header: 'Name',
			sortable: true
		},
		{
			key: 'quality_count',
			header: 'Quality Count',
			align: 'center' as const,
			sortable: true
		}
	] satisfies Column<any>[];
</script>

<svelte:head>
	<title>Quality Sizes - {source?.name ?? 'TRaSH Source'} - Praxrr</title>
</svelte:head>

<div class="mt-6 space-y-4">
	<ActionsBar>
		<SearchAction searchStore={search} placeholder="Search quality sizes..." responsive />
	</ActionsBar>

	<Table
		{columns}
		data={filtered}
		rowHref={(row) => `/databases/trash/${source?.id}/quality-sizes/${row.trashId}/`}
		emptyMessage="No quality sizes cached. Try syncing the source."
		responsive
	/>
</div>
