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
	import { alertStore } from '$alerts/store';
	import { Plus } from 'lucide-svelte';
	import type { EntityType } from '$shared/pcd/portable.ts';
	import { getArrAppMetadata, isArrAppType, type ArrAppType } from '$shared/arr/capabilities.ts';
	import type { PageData } from './$types';

	export let data: PageData;

	let cloneModalOpen = false;
	let cloneSourceName = '';
	let cloneEntityType: EntityType = 'radarr_quality_definitions';
	let cloneArrType: ArrAppType | null = null;

	$: cloneExistingNames = cloneArrType
		? data.qualityDefinitionsConfigs.filter((config) => config.arr_type === cloneArrType).map((config) => config.name)
		: [];

	function formatType(type: string): string {
		if (!type) {
			return 'Unknown';
		}

		return type.charAt(0).toUpperCase() + type.slice(1);
	}

	function resolveQualityTypeLabel(arrType: string): string {
		if (!isArrAppType(arrType)) {
			return formatType(arrType);
		}

		return getArrAppMetadata(arrType).label;
	}

	function resolveQualityDefinitionsEntityType(arrType: string): EntityType | null {
		if (!isArrAppType(arrType)) {
			return null;
		}

		return `${arrType}_quality_definitions` as EntityType;
	}

	function handleClone(event: CustomEvent<{ name: string; arr_type: string }>) {
		if (!event.detail.name?.trim()) {
			alertStore.add('error', 'Cannot clone quality definitions without a config name');
			return;
		}

		const arrType = event.detail.arr_type;
		if (!isArrAppType(arrType)) {
			alertStore.add('error', `Unknown quality definitions type: ${resolveQualityTypeLabel(arrType)}`);
			return;
		}

		const resolvedType = resolveQualityDefinitionsEntityType(arrType);
		if (!resolvedType) {
			alertStore.add('error', `Unknown quality definitions type: ${resolveQualityTypeLabel(event.detail.arr_type)}`);
			return;
		}

		cloneSourceName = event.detail.name;
		cloneEntityType = resolvedType;
		cloneArrType = arrType;
		cloneModalOpen = true;
	}

	async function handleExport(event: CustomEvent<{ name: string; arr_type: string }>) {
		if (!event.detail.name?.trim()) {
			alertStore.add('error', 'Cannot export quality definitions without a config name');
			return;
		}

		const entityType = resolveQualityDefinitionsEntityType(event.detail.arr_type);
		if (!entityType) {
			alertStore.add('error', `Unknown quality definitions type: ${resolveQualityTypeLabel(event.detail.arr_type)}`);
			return;
		}

		const { name } = event.detail;
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
	const { search, view, filtered, setItems } = createDataPageStore(data.qualityDefinitionsConfigs, {
		storageKey: 'qualityDefinitionsView',
		searchKeys: ['name'],
		searchKey: `qualityDefinitionsConfigsSearch:${data.currentDatabase.id}`
	});

	// Update items when data changes
	$: setItems(data.qualityDefinitionsConfigs);
</script>

<!-- Actions Bar -->
<ActionsBar>
	<SearchAction searchStore={search} placeholder="Search quality definitions..." responsive />
	<ActionButton
		icon={Plus}
		on:click={() => goto(`/media-management/${data.currentDatabase.id}/quality-definitions/new`)}
	/>
	<ViewToggle bind:value={$view} />
</ActionsBar>

<!-- Quality Definitions Content -->
<div class="mt-6">
	{#if data.qualityDefinitionsConfigs.length === 0}
		<div
			class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
		>
			<p class="text-neutral-600 dark:text-neutral-400">
				No quality definitions configs found for {data.currentDatabase.name}
			</p>
		</div>
	{:else if $filtered.length === 0}
		<div
			class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
		>
			<p class="text-neutral-600 dark:text-neutral-400">
				No quality definitions configs match your search
			</p>
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
