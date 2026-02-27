<script lang="ts">
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import Table from '$ui/table/Table.svelte';
	import { createSearchStore } from '$lib/client/stores/search.ts';
	import type { Column, SortState } from '$ui/table/types.ts';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';

	$: source = $page.data.source;
	$: qualityProfiles = $page.data.qualityProfiles ?? [];

	const search = createSearchStore();
	const debouncedQuery = search.debouncedQuery;
	let initializedFromUrl = false;
	let initialSort: SortState | null = null;
	let sortState: SortState | null = null;

	function readSortFromUrl(): SortState | null {
		const key = $page.url.searchParams.get('sort')?.trim();
		if (key !== 'name') return null;

		return {
			key,
			direction: $page.url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
		};
	}

	function updateUrlState(query: string, sort: SortState | null): void {
		const url = new URL(window.location.href);
		const nextQuery = query.trim();

		if (nextQuery) {
			url.searchParams.set('q', nextQuery);
		} else {
			url.searchParams.delete('q');
		}

		if (sort) {
			url.searchParams.set('sort', sort.key);
			url.searchParams.set('dir', sort.direction);
		} else {
			url.searchParams.delete('sort');
			url.searchParams.delete('dir');
		}

		const next = `${url.pathname}${url.search}${url.hash}`;
		const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		if (next !== current) {
			window.history.replaceState(window.history.state, '', next);
		}
	}

	function handleSortChange(nextSort: SortState | null): void {
		sortState = nextSort;
	}

	$: if (!initializedFromUrl) {
		const initialQuery = $page.url.searchParams.get('q')?.trim() ?? '';
		if (initialQuery.length > 0) {
			search.setQuery(initialQuery);
		}

		initialSort = readSortFromUrl();
		sortState = initialSort;
		initializedFromUrl = true;
	}

	$: if (browser && initializedFromUrl) {
		updateUrlState($debouncedQuery, sortState);
	}

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
		{initialSort}
		onSortChange={handleSortChange}
	/>
</div>
