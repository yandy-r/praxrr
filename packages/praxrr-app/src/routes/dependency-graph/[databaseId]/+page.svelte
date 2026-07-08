<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { components } from '$api/v1.d.ts';
	import { alertStore } from '$alerts/store';
	import { NODE_META } from '$ui/graph/nodeStyles.ts';
	import AdjacencyTable from './AdjacencyTable.svelte';
	import type { PageData } from './$types';

	type DependencyGraphResponse = components['schemas']['DependencyGraphResponse'];
	type GraphNodeKind = components['schemas']['GraphNodeKind'];

	export let data: PageData;

	const ARR_FILTERS: { value: string; label: string }[] = [
		{ value: '', label: 'Any arr' },
		{ value: 'radarr', label: 'Radarr' },
		{ value: 'sonarr', label: 'Sonarr' },
		{ value: 'lidarr', label: 'Lidarr' }
	];

	const NODE_KIND_FILTERS: { value: string; label: string }[] = [
		{ value: '', label: 'All types' },
		...(['custom_format', 'quality_profile', 'regular_expression', 'quality', 'quality_definition'] as GraphNodeKind[]).map(
			(kind) => ({ value: kind, label: NODE_META[kind].label })
		)
	];

	let arrType = '';
	let nodeKind = '';
	let graph: DependencyGraphResponse | null = null;
	let loading = false;
	let requestId = 0;

	$: focusKey = $page.url.searchParams.get('focus');

	// Switching database via the in-page dropdown is a client-side navigation between two
	// instances of the same [databaseId] route: SvelteKit reruns load() (updating
	// data.selectedDatabaseId) but reuses this component, so onMount does not re-run. Reset
	// and refetch on databaseId change (requestId guards overlapping fetches). Mirrors the
	// resolved-config page's guard.
	let previousDatabaseId = data.selectedDatabaseId;
	$: if (data.selectedDatabaseId !== previousDatabaseId) {
		previousDatabaseId = data.selectedDatabaseId;
		graph = null;
		loadGraph();
	}

	function onDatabaseChange(event: Event) {
		const id = (event.target as HTMLSelectElement).value;
		if (id) {
			localStorage.setItem('dependencyGraphDatabase', id);
			goto(`/dependency-graph/${id}`);
		}
	}

	async function loadGraph() {
		if (!browser || data.selectedDatabaseId == null || data.error) return;
		const id = ++requestId;
		loading = true;
		try {
			const params = new URLSearchParams();
			if (arrType) params.set('arrType', arrType);
			if (nodeKind) params.set('nodeKind', nodeKind);
			const query = params.toString();
			const url = `/api/v1/pcd/${data.selectedDatabaseId}/graph${query ? `?${query}` : ''}`;
			const response = await fetch(url);
			if (id !== requestId) return; // a newer request superseded this one
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				alertStore.add('error', body?.error ?? `Failed to load dependency graph (${response.status})`);
				graph = null;
				return;
			}
			graph = (await response.json()) as DependencyGraphResponse;
		} catch (error) {
			if (id !== requestId) return;
			alertStore.add('error', error instanceof Error ? error.message : 'Failed to load dependency graph');
			graph = null;
		} finally {
			if (id === requestId) loading = false;
		}
	}

	function onFilterChange() {
		loadGraph();
	}

	onMount(loadGraph);
</script>

<svelte:head>
	<title>Dependency Graph - Praxrr</title>
</svelte:head>

<div class="space-y-8">
	<div>
		<h1 class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Dependency Graph</h1>
		<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
			Resolved dependencies between config entities — which custom formats are scored by which quality profiles,
			which regular expressions each custom format uses, and which qualities a profile enables.
		</p>
	</div>

	<div class="flex flex-wrap items-end gap-4">
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium text-neutral-700 dark:text-neutral-300">Database</span>
			<select
				class="rounded border border-neutral-300 bg-white px-3 py-1.5 dark:border-neutral-600 dark:bg-neutral-800"
				value={data.selectedDatabaseId ?? ''}
				on:change={onDatabaseChange}
			>
				{#each data.databases as database (database.id)}
					<option value={database.id}>{database.name}</option>
				{/each}
			</select>
		</label>

		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium text-neutral-700 dark:text-neutral-300">Arr scope</span>
			<select
				class="rounded border border-neutral-300 bg-white px-3 py-1.5 dark:border-neutral-600 dark:bg-neutral-800"
				bind:value={arrType}
				on:change={onFilterChange}
			>
				{#each ARR_FILTERS as filter (filter.value)}
					<option value={filter.value}>{filter.label}</option>
				{/each}
			</select>
		</label>

		<label class="flex flex-col gap-1 text-sm">
			<span class="font-medium text-neutral-700 dark:text-neutral-300">Entity type</span>
			<select
				class="rounded border border-neutral-300 bg-white px-3 py-1.5 dark:border-neutral-600 dark:bg-neutral-800"
				bind:value={nodeKind}
				on:change={onFilterChange}
			>
				{#each NODE_KIND_FILTERS as filter (filter.value)}
					<option value={filter.value}>{filter.label}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if data.error}
		<div
			class="rounded border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500 dark:border-neutral-600 dark:text-neutral-400"
		>
			{data.error}
		</div>
	{:else if loading && !graph}
		<div
			class="rounded border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500 dark:border-neutral-600 dark:text-neutral-400"
		>
			Loading dependency graph…
		</div>
	{:else if graph}
		{#if graph.truncated}
			<div
				class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
			>
				This graph is large and was truncated for performance. Filter by arr scope or entity type to narrow it.
			</div>
		{/if}
		<AdjacencyTable
			nodes={graph.nodes}
			edges={graph.edges}
			databaseId={graph.databaseId}
			{focusKey}
		/>
	{/if}
</div>
