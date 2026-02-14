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
	let cloneEntityType: EntityType = 'radarr_media_settings';
	let cloneArrType: ArrAppType | null = null;

	const validArrTypes: ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];

	function isValidArrType(arrType: string): arrType is ArrAppType {
		return validArrTypes.includes(arrType as ArrAppType);
	}

	$: cloneExistingNames = cloneArrType
		? data.mediaSettingsConfigs.filter((config) => config.arr_type === cloneArrType).map((config) => config.name)
		: [];

	function resolveEntityType(arrType: string): EntityType | null {
		if (!isValidArrType(arrType)) {
			return null;
		}

		return `${arrType}_media_settings` as EntityType;
	}

	function handleClone(event: CustomEvent<{ name: string; arr_type: string }>) {
		if (!event.detail.name?.trim()) {
			alertStore.add('error', 'Missing media settings name');
			return;
		}

		const arrType = event.detail.arr_type;
		if (!isValidArrType(arrType)) {
			alertStore.add('error', `Unknown media settings type "${event.detail.arr_type}"`);
			return;
		}

		const entityType = resolveEntityType(arrType);
		if (!entityType) {
			alertStore.add('error', `Unknown media settings type "${event.detail.arr_type}"`);
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
			alertStore.add('error', 'Missing media settings details');
			return;
		}
		const entityType = resolveEntityType(arr_type);
		if (!entityType) {
			alertStore.add('error', `Unknown media settings type "${arr_type}"`);
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
	const { search, view, filtered, setItems } = createDataPageStore(data.mediaSettingsConfigs, {
		storageKey: 'mediaSettingsView',
		searchKeys: ['name'],
		searchKey: `mediaSettingsConfigsSearch:${data.currentDatabase.id}`
	});

	// Update items when data changes
	$: setItems(data.mediaSettingsConfigs);
</script>

<!-- Actions Bar -->
<ActionsBar>
	<SearchAction searchStore={search} placeholder="Search media settings..." responsive />
	<ActionButton
		icon={Plus}
		on:click={() =>
			goto(resolve('/media-management/[databaseId]/media-settings/new', { databaseId: data.currentDatabase.id.toString() }))}
	/>
	<ViewToggle bind:value={$view} />
</ActionsBar>

<!-- Media Settings Content -->
<div class="mt-6">
	{#if data.mediaSettingsConfigs.length === 0}
		<div
			class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
		>
			<p class="text-neutral-600 dark:text-neutral-400">
				No media settings configs found for {data.currentDatabase.name}
			</p>
		</div>
	{:else if $filtered.length === 0}
		<div
			class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
		>
			<p class="text-neutral-600 dark:text-neutral-400">No media settings configs match your search</p>
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
