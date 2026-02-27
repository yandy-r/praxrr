<script lang="ts">
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import Table from '$ui/table/Table.svelte';
	import { createSearchStore } from '$lib/client/stores/search.ts';
	import type { Column } from '$ui/table/types.ts';
	import { page } from '$app/stores';

	$: source = $page.data.source;
	$: namingConfigs = $page.data.namingConfigs ?? [];

	const search = createSearchStore();
	const debouncedQuery = search.debouncedQuery;

	$: filtered = $debouncedQuery
		? namingConfigs.filter(
				(nc: any) => nc.name.toLowerCase().includes($debouncedQuery.toLowerCase())
			)
		: namingConfigs;

	$: columns = [
		{
			key: 'name',
			header: 'Name',
			sortable: true
		}
	] satisfies Column<any>[];
</script>

<svelte:head>
	<title>Naming - {source?.name ?? 'TRaSH Source'} - Praxrr</title>
</svelte:head>

<div class="mt-6 space-y-4">
	<ActionsBar>
		<SearchAction searchStore={search} placeholder="Search naming configs..." responsive />
	</ActionsBar>

	<Table
		{columns}
		data={filtered}
		rowHref={(row) => `/databases/trash/${source?.id}/naming/${row.trashId}/`}
		emptyMessage="No naming configs cached. Try syncing the source."
		responsive
	/>
</div>
