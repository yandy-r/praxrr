<script lang="ts">
	import { goto } from '$app/navigation';
	import { Plus } from 'lucide-svelte';
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import ActionButton from '$ui/actions/ActionButton.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import SourceFilterAction from '$ui/actions/SourceFilterAction.svelte';
	import ViewToggle from '$ui/actions/ViewToggle.svelte';
	import CloneModal from '$ui/modal/CloneModal.svelte';
	import TableView from './views/TableView.svelte';
	import CardView from './views/CardView.svelte';
	import { createDataPageStore } from '$lib/client/stores/dataPage';
	import { browser } from '$app/environment';
	import { alertStore } from '$alerts/store';
	import type { QualityProfileTableRow } from '$shared/pcd/display.ts';
	import type { SourceRef } from '$shared/sources/types.ts';
	import type { PageData } from './$types';

	export let data: PageData;

	type SourceFilterKey = `${SourceRef['type']}:${number}`;

	const SOURCE_FILTER_STORAGE_KEY = 'qualityProfilesSourceFilter';

	let cloneModalOpen = false;
	let cloneSourceName = '';
	let selectedSourceKeys: SourceFilterKey[] = loadSelectedSourceKeys(
		data.sourceContext.availableSources,
		data.sourceContext.defaultSourceKey
	);

	function handleClone(event: CustomEvent<{ name: string }>) {
		cloneSourceName = event.detail.name;
		cloneModalOpen = true;
	}

	async function handleExport(event: CustomEvent<{ name: string }>) {
		const { name } = event.detail;
		try {
			const params = new URLSearchParams({
				databaseId: String(data.currentDatabase.id),
				entityType: 'quality_profile',
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

	function toSourceKey(source: Pick<SourceRef, 'type' | 'id'>): SourceFilterKey {
		return `${source.type}:${source.id}` as SourceFilterKey;
	}

	function sameSelection(a: SourceFilterKey[], b: SourceFilterKey[]): boolean {
		return a.length === b.length && a.every((value, index) => value === b[index]);
	}

	function defaultSourceKeys(sources: SourceRef[], fallbackKey: string): SourceFilterKey[] {
		if (sources.length === 0) return [];
		if (sources.length >= 2) {
			return sources.map((source) => toSourceKey(source));
		}
		const validFallback = sources.some((source) => toSourceKey(source) === fallbackKey);
		return validFallback ? [fallbackKey as SourceFilterKey] : [toSourceKey(sources[0])];
	}

	function normalizeSourceKeys(
		keys: SourceFilterKey[],
		sources: SourceRef[],
		fallbackKey: string
	): SourceFilterKey[] {
		if (sources.length === 0) return [];

		const validKeys = new Set(sources.map((source) => toSourceKey(source)));
		const selectedKeys = [...new Set(keys.filter((key) => validKeys.has(key)))];
		if (selectedKeys.length === 0) {
			return defaultSourceKeys(sources, fallbackKey);
		}

		return sources
			.map((source) => toSourceKey(source))
			.filter((key) => selectedKeys.includes(key));
	}

	function loadSelectedSourceKeys(sources: SourceRef[], fallbackKey: string): SourceFilterKey[] {
		const defaults = defaultSourceKeys(sources, fallbackKey);
		if (!browser) return defaults;

		const saved = localStorage.getItem(SOURCE_FILTER_STORAGE_KEY);
		if (!saved) return defaults;

		try {
			const parsed = JSON.parse(saved);
			if (!Array.isArray(parsed)) return defaults;
			const persistedKeys = parsed.filter((value): value is SourceFilterKey => typeof value === 'string');
			return normalizeSourceKeys(persistedKeys, sources, fallbackKey);
		} catch {
			return defaults;
		}
	}

	function withSourceFallback(profile: QualityProfileTableRow): QualityProfileTableRow {
		if (profile.sourceType && profile.sourceDatabaseId != null && profile.sourceDatabaseName) {
			return profile;
		}

		return {
			...profile,
			sourceType: 'pcd',
			sourceDatabaseId: data.currentDatabase.id,
			sourceDatabaseName: data.currentDatabase.name
		};
	}

	function filterBySelectedSources(
		profiles: QualityProfileTableRow[],
		selectedKeys: SourceFilterKey[]
	): QualityProfileTableRow[] {
		if (selectedKeys.length === 0) return profiles;

		const selectedSet = new Set(selectedKeys);
		return profiles.filter((profile) => {
			const sourceType = profile.sourceType ?? 'pcd';
			const sourceDatabaseId = profile.sourceDatabaseId ?? data.currentDatabase.id;
			return selectedSet.has(`${sourceType}:${sourceDatabaseId}` as SourceFilterKey);
		});
	}

	function isSourceFilterActive(selectedKeys: SourceFilterKey[], sources: SourceRef[]): boolean {
		if (sources.length === 0) return false;
		const allKeys = sources.map((source) => toSourceKey(source));
		if (selectedKeys.length !== allKeys.length) return true;
		const selectedSet = new Set(selectedKeys);
		return allKeys.some((key) => !selectedSet.has(key));
	}

	function isCurrentDatabasePcdProfile(profile: QualityProfileTableRow): boolean {
		const sourceType = profile.sourceType ?? 'pcd';
		const sourceDatabaseId = profile.sourceDatabaseId ?? data.currentDatabase.id;
		return sourceType === 'pcd' && sourceDatabaseId === data.currentDatabase.id;
	}

	// Initialize data page store
	const { search, view, filtered: searchFiltered, setItems } = createDataPageStore(
		data.qualityProfiles.map((profile) => withSourceFallback(profile)),
		{
			storageKey: 'qualityProfilesView',
			defaultView: 'cards',
			searchKeys: ['name'],
			searchKey: `qualityProfilesSearch:${data.currentDatabase.id}`
		}
	);

	// Update items when data changes (e.g., switching databases)
	$: setItems(data.qualityProfiles.map((profile) => withSourceFallback(profile)));
	$: {
		const normalizedKeys = normalizeSourceKeys(
			selectedSourceKeys,
			data.sourceContext.availableSources,
			data.sourceContext.defaultSourceKey
		);
		if (!sameSelection(selectedSourceKeys, normalizedKeys)) {
			selectedSourceKeys = normalizedKeys;
		}
	}
	$: sourceFilterActive = isSourceFilterActive(selectedSourceKeys, data.sourceContext.availableSources);
	$: filteredProfiles = filterBySelectedSources($searchFiltered, selectedSourceKeys);
	$: sourceFilterStatusMessage = sourceFilterActive
		? `Showing ${filteredProfiles.length} of ${$searchFiltered.length} quality profiles after source filtering`
		: '';
	$: filteredEmptyMessage =
		sourceFilterActive && $search.query
			? 'No quality profiles match your search and selected sources'
			: sourceFilterActive
				? 'No quality profiles match your selected sources'
				: 'No quality profiles match your search';
	$: if (browser) {
		localStorage.setItem(SOURCE_FILTER_STORAGE_KEY, JSON.stringify(selectedSourceKeys));
	}

	// Map databases to tabs
	$: tabs = data.databases.map((db) => ({
		label: db.name,
		href: `/quality-profiles/${db.id}`,
		active: db.id === data.currentDatabase.id
	}));

	// Persist selected database tab
	$: if (browser && data.currentDatabase?.id) {
		localStorage.setItem('qualityProfilesDatabase', String(data.currentDatabase.id));
	}
</script>

<svelte:head>
	<title>Quality Profiles - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
	<!-- Tabs -->
	<Tabs {tabs} responsive />

	<!-- Actions Bar -->
	<ActionsBar>
		<SearchAction searchStore={search} placeholder="Search quality profiles..." />
		<SourceFilterAction
			sources={data.sourceContext.availableSources}
			bind:selectedKeys={selectedSourceKeys}
			disabled={Boolean(data.sourceContext.filterDisabledReason)}
			ariaLabel="Filter quality profiles by source"
			dropdownOnly
		/>
		<ActionButton
			icon={Plus}
			on:click={() => goto(`/quality-profiles/${data.currentDatabase.id}/new`)}
		/>
		<ViewToggle bind:value={$view} />
	</ActionsBar>

	<!-- Quality Profiles Content -->
	<div class="mt-6">
		{#if sourceFilterStatusMessage}
			<p class="mb-3 text-xs text-neutral-500 dark:text-neutral-400" role="status" aria-live="polite">
				{sourceFilterStatusMessage}
			</p>
		{/if}

		{#if data.qualityProfiles.length === 0}
			<div
				class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
			>
				<p class="text-neutral-600 dark:text-neutral-400">
					No quality profiles found for {data.currentDatabase.name}
				</p>
			</div>
		{:else if filteredProfiles.length === 0}
			<div
				class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
			>
				<p class="text-neutral-600 dark:text-neutral-400">{filteredEmptyMessage}</p>
			</div>
		{:else if $view === 'table'}
			<TableView
				profiles={filteredProfiles}
				availableSources={data.sourceContext.availableSources}
				showSourceBadges={data.sourceContext.showAllSourcesTab}
				currentDatabaseId={data.currentDatabase.id}
				on:clone={handleClone}
				on:export={handleExport}
			/>
		{:else}
			<CardView
				profiles={filteredProfiles}
				availableSources={data.sourceContext.availableSources}
				showSourceBadges={data.sourceContext.showAllSourcesTab}
				currentDatabaseId={data.currentDatabase.id}
				on:clone={handleClone}
				on:export={handleExport}
			/>
		{/if}
	</div>
</div>

<CloneModal
	bind:open={cloneModalOpen}
	databaseId={data.currentDatabase.id}
	entityType="quality_profile"
	sourceName={cloneSourceName}
	existingNames={data.qualityProfiles
		.filter((profile) => isCurrentDatabasePcdProfile(profile))
		.map((profile) => profile.name)}
	canWriteToBase={data.canWriteToBase}
/>
