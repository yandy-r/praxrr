<script lang="ts">
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import ActionButton from '$ui/actions/ActionButton.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import ViewToggle from '$ui/actions/ViewToggle.svelte';
	import CloneModal from '$ui/modal/CloneModal.svelte';
	import TableView from './views/TableView.svelte';
	import CardView from './views/CardView.svelte';
	import { createDataPageStore } from '$lib/client/stores/dataPage';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { alertStore } from '$alerts/store';
	import { Plus } from 'lucide-svelte';
	import type { EntityType } from '$shared/pcd/portable.ts';
	import type { ArrAppType } from '$shared/arr/capabilities.ts';
	import type { PageData } from './$types';

	export let data: PageData;

	let cloneModalOpen = false;
	let cloneSourceName = '';
	let cloneEntityType: EntityType = 'radarr_naming';
	let cloneArrType: ArrAppType | null = null;
	const namingSearchKeys: Array<keyof PageData['namingConfigs'][number]> = ['name', 'arr_type'];
	const supportedNamingArrTypes: ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];

	function isSupportedArrType(arrType: string): arrType is ArrAppType {
		return supportedNamingArrTypes.includes(arrType as ArrAppType);
	}

	$: cloneExistingNames = cloneArrType
		? data.namingConfigs.filter((config) => config.arr_type === cloneArrType).map((config) => config.name)
		: [];

	function toEntityType(arrType: string): EntityType | null {
		if (!isSupportedArrType(arrType)) {
			return null;
		}

		return `${arrType}_naming` as EntityType;
	}

	function handleClone(event: CustomEvent<{ name: string; arr_type: string }>) {
		if (!event.detail.name?.trim()) {
			alertStore.add('error', 'Missing naming config name');
			return;
		}

		const arrType = event.detail.arr_type;
		if (!isSupportedArrType(arrType)) {
			alertStore.add('error', `Unknown naming type "${arrType}"`);
			return;
		}

		const entityType = toEntityType(arrType);
		if (!entityType) {
			alertStore.add('error', `Unknown naming type "${event.detail.arr_type}"`);
			return;
		}

		cloneSourceName = event.detail.name;
		cloneEntityType = entityType;
		cloneArrType = arrType;
		cloneModalOpen = true;
	}

	async function handleExport(event: CustomEvent<{ name: string; arr_type: string }>) {
		const { name, arr_type } = event.detail;
		if (!name?.trim()) {
			alertStore.add('error', 'Missing naming config name');
			return;
		}

		const entityType = toEntityType(arr_type);
		if (!entityType) {
			alertStore.add('error', `Unknown naming type "${arr_type}"`);
			return;
		}

		try {
			const params = new URLSearchParams({
				databaseId: String(data.currentDatabase.id),
				entityType,
				name
			});
			const res = await fetch(`/api/v1/pcd/export?${params}`);
			const json = await res.json();
			if (!res.ok) {
				alertStore.add('error', json.error || 'Export failed');
				return;
			}
			await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
			alertStore.add('success', `Copied "${name}" to clipboard`);
		} catch {
			alertStore.add('error', 'Export failed');
		}
	}

	// Initialize data page store
	const { search, view, filtered, setItems } = createDataPageStore(data.namingConfigs, {
		storageKey: 'namingSettingsView',
		searchKeys: namingSearchKeys,
		searchKey: `namingConfigsSearch:${data.currentDatabase.id}`
	});

	// Update items when data changes
	$: setItems(data.namingConfigs);
</script>

<!-- Actions Bar -->
<ActionsBar>
	<SearchAction searchStore={search} placeholder="Search naming configs..." responsive />
	<ActionButton
		icon={Plus}
		on:click={() =>
			goto(resolve('/media-management/[databaseId]/naming/new', { databaseId: data.currentDatabase.id.toString() }))}
	/>
	<ViewToggle bind:value={$view} />
</ActionsBar>

<!-- Naming Configs Content -->
<div class="mt-6">
	{#if data.namingConfigs.length === 0}
		<div
			class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
		>
			<p class="text-neutral-600 dark:text-neutral-400">
				No naming configs found for {data.currentDatabase.name}
			</p>
		</div>
	{:else if $filtered.length === 0}
		<div
			class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
		>
			<p class="text-neutral-600 dark:text-neutral-400">No naming configs match your search</p>
		</div>
	{:else if $view === 'table'}
		<TableView configs={$filtered} databaseId={data.currentDatabase.id} on:clone={handleClone} on:export={handleExport} />
	{:else}
		<CardView configs={$filtered} databaseId={data.currentDatabase.id} on:clone={handleClone} on:export={handleExport} />
	{/if}
</div>

<CloneModal
	bind:open={cloneModalOpen}
	databaseId={data.currentDatabase.id}
	entityType={cloneEntityType}
	sourceName={cloneSourceName}
	existingNames={cloneExistingNames}
	canWriteToBase={data.canWriteToBase}
/>
