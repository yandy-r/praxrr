<script lang="ts">
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import Table from '$ui/table/Table.svelte';
	import { createSearchStore } from '$lib/client/stores/search.ts';
	import type { Column, SortState } from '$ui/table/types.ts';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';

	$: source = $page.data.source;
	$: qualitySizes = $page.data.qualitySizes ?? [];

	const search = createSearchStore();
	const debouncedQuery = search.debouncedQuery;
	let initializedFromUrl = false;
	let initialSort: SortState | null = null;
	let sortState: SortState | null = null;

	function readSortFromUrl(): SortState | null {
		const key = $page.url.searchParams.get('sort')?.trim();
		if (key !== 'name' && key !== 'quality_count') return null;

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
		{initialSort}
		onSortChange={handleSortChange}
	/>
</div>
