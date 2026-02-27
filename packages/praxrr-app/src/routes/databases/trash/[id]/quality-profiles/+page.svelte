<script lang="ts">
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import Table from '$ui/table/Table.svelte';
	import { createSearchStore } from '$lib/client/stores/search.ts';
	import type { Column } from '$ui/table/types.ts';
	import { page } from '$app/stores';

	$: source = $page.data.source;
	$: qualityProfiles = $page.data.qualityProfiles ?? [];

	const search = createSearchStore();
	const debouncedQuery = search.debouncedQuery;

	$: filtered = $debouncedQuery
		? qualityProfiles.filter(
				(qp: any) => qp.name.toLowerCase().includes($debouncedQuery.toLowerCase())
			)
		: qualityProfiles;

	$: columns = [
		{
			key: 'name',
			header: 'Name',
			sortable: true
		},
		{
			key: 'upgrades_allowed',
			header: 'Upgrades',
			align: 'center' as const,
			cell: (row: any) => (row.upgrades_allowed ? 'Yes' : 'No')
		},
		{
			key: 'custom_formats',
			header: 'CF Scores',
			align: 'center' as const,
			cell: (row: any) => String(row.custom_formats?.total ?? 0)
		},
		{
			key: 'language',
			header: 'Language',
			cell: (row: any) => row.language?.name ?? 'Any'
		}
	] satisfies Column<any>[];
</script>

<svelte:head>
	<title>Quality Profiles - {source?.name ?? 'TRaSH Source'} - Praxrr</title>
</svelte:head>

<div class="mt-6 space-y-4">
	<ActionsBar>
		<SearchAction searchStore={search} placeholder="Search quality profiles..." responsive />
	</ActionsBar>

	<Table
		{columns}
		data={filtered}
		rowHref={(row) => `/databases/trash/${source?.id}/quality-profiles/${row.trashId}/`}
		emptyMessage="No quality profiles cached. Try syncing the source."
		responsive
	/>
</div>
