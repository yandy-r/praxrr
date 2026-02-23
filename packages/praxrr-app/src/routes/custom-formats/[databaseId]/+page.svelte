<script lang="ts">
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import ActionButton from '$ui/actions/ActionButton.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import ViewToggle from '$ui/actions/ViewToggle.svelte';
	import InfoModal from '$ui/modal/InfoModal.svelte';
	import CloneModal from '$ui/modal/CloneModal.svelte';
	import TableView from './views/TableView.svelte';
	import CardView from './views/CardView.svelte';
	import SearchFilterAction from './components/SearchFilterAction.svelte';
	import { createDataPageStore } from '$lib/client/stores/dataPage';
	import { browser } from '$app/environment';
	import { Info, Plus } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { alertStore } from '$alerts/store';
	import type { CustomFormatTableRow } from '$shared/pcd/display.ts';
	import type { PageData } from './$types';

	export let data: PageData;

	let infoModalOpen = false;
	let cloneModalOpen = false;
	let cloneSourceName = '';

	function handleClone(event: CustomEvent<{ name: string }>) {
		cloneSourceName = event.detail.name;
		cloneModalOpen = true;
	}

	async function handleExport(event: CustomEvent<{ name: string }>) {
		const { name } = event.detail;
		try {
			const params = new URLSearchParams({
				databaseId: String(data.currentDatabase.id),
				entityType: 'custom_format',
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

	const SEARCH_FILTER_STORAGE_KEY = 'customFormatsSearchFilter';

	// Default search filter options
	const defaultSearchOptions = [
		{ key: 'name', label: 'Name', enabled: true },
		{ key: 'tags', label: 'Tags', enabled: true },
		{ key: 'description', label: 'Description', enabled: false }
	];

	// Load saved preferences from localStorage or use defaults
	function loadSearchOptions() {
		if (!browser) return defaultSearchOptions;
		try {
			const saved = localStorage.getItem(SEARCH_FILTER_STORAGE_KEY);
			if (saved) {
				const savedMap = new Map(JSON.parse(saved) as [string, boolean][]);
				return defaultSearchOptions.map((opt) => ({
					...opt,
					enabled: savedMap.has(opt.key) ? savedMap.get(opt.key)! : opt.enabled
				}));
			}
		} catch {
			// Ignore parse errors, use defaults
		}
		return defaultSearchOptions;
	}

	let searchOptions = loadSearchOptions();

	// Save to localStorage when options change
	$: if (browser) {
		const enabledMap = searchOptions.map((opt) => [opt.key, opt.enabled] as [string, boolean]);
		localStorage.setItem(SEARCH_FILTER_STORAGE_KEY, JSON.stringify(enabledMap));
	}

	// Initialize data page store (we'll use search and view, but do our own filtering)
	const { search, view, setItems } = createDataPageStore(data.customFormats, {
		storageKey: 'customFormatsView',
		defaultView: 'cards',
		searchKeys: ['name'], // Placeholder, we do our own filtering
		searchKey: `customFormatsSearch:${data.currentDatabase.id}`
	});

	// Extract the debounced query store for reactive access
	const debouncedQuery = search.debouncedQuery;

	// Update items when data changes (e.g., switching databases)
	$: setItems(data.customFormats);

	// Custom filtering based on selected search options
	$: filtered = filterFormats(data.customFormats, $debouncedQuery, searchOptions);

	function filterFormats(
		items: CustomFormatTableRow[],
		query: string,
		options: typeof searchOptions
	): CustomFormatTableRow[] {
		if (!query) return items;

		const queryLower = query.toLowerCase();
		const enabledKeys = options.filter((o) => o.enabled).map((o) => o.key);

		return items.filter((item) => {
			return enabledKeys.some((key) => {
				if (key === 'tags') {
					// Search within tag names
					return item.tags.some((tag) => tag.name.toLowerCase().includes(queryLower));
				}
				const value = item[key as keyof CustomFormatTableRow];
				if (value == null) return false;
				return String(value).toLowerCase().includes(queryLower);
			});
		});
	}

	// Map databases to tabs
	$: tabs = data.databases.map((db) => ({
		label: db.name,
		href: `/custom-formats/${db.id}`,
		active: db.id === data.currentDatabase.id
	}));

	// Persist selected database tab
	$: if (browser && data.currentDatabase?.id) {
		localStorage.setItem('customFormatsDatabase', String(data.currentDatabase.id));
	}
</script>

<svelte:head>
	<title>Custom Formats - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
	<!-- Tabs -->
	<Tabs {tabs} responsive />

	<!-- Actions Bar -->
	<ActionsBar className="w-full justify-center mx-auto md:w-auto md:mx-0">
		<SearchAction searchStore={search} placeholder="Search custom formats..." responsive />
		<ActionButton
			icon={Plus}
			on:click={() => goto(`/custom-formats/${data.currentDatabase.id}/new`)}
		/>
		<SearchFilterAction bind:options={searchOptions} />
		<ViewToggle bind:value={$view} />
		<ActionButton icon={Info} on:click={() => (infoModalOpen = true)} />
	</ActionsBar>

	<!-- Custom Formats Content -->
	<div class="mt-6">
		{#if data.customFormats.length === 0}
			<div
				class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
			>
				<p class="text-neutral-600 dark:text-neutral-400">
					No custom formats found for {data.currentDatabase.name}
				</p>
			</div>
		{:else if filtered.length === 0}
			<div
				class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
			>
				<p class="text-neutral-600 dark:text-neutral-400">No custom formats match your search</p>
			</div>
		{:else if $view === 'table'}
			<TableView formats={filtered} on:clone={handleClone} on:export={handleExport} />
		{:else}
			<CardView formats={filtered} on:clone={handleClone} on:export={handleExport} />
		{/if}
	</div>
</div>

<!-- Info Modal -->
<InfoModal bind:open={infoModalOpen} header="About Custom Formats">
	<div class="space-y-4 text-sm text-neutral-700 dark:text-neutral-300">
		<section>
			<h3 class="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">
				What Are Custom Formats?
			</h3>
			<p>
				Custom formats are rules that match specific release characteristics like codec, resolution,
				source, or release group. They're used to score releases and guide quality decisions.
			</p>
		</section>

		<section>
			<h3 class="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">How They Work</h3>
			<p>
				Each custom format contains one or more conditions. A release must match all required
				conditions (or at least one non-required condition) to be assigned the custom format.
				Quality profiles then assign scores to determine which releases are preferred.
			</p>
		</section>

		<section>
			<h3 class="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">Condition Types</h3>
			<ul class="list-inside list-disc space-y-1">
				<li><strong>Release Title</strong> - Match patterns in the release name</li>
				<li><strong>Release Group</strong> - Match specific release groups</li>
				<li><strong>Edition</strong> - Match edition names (Director's Cut, etc.)</li>
				<li><strong>Language</strong> - Match audio language</li>
				<li><strong>Source</strong> - Match release source (BluRay, WEB, etc.)</li>
				<li><strong>Resolution</strong> - Match video resolution</li>
			</ul>
		</section>
	</div>
</InfoModal>

<CloneModal
	bind:open={cloneModalOpen}
	databaseId={data.currentDatabase.id}
	entityType="custom_format"
	sourceName={cloneSourceName}
	existingNames={data.customFormats.map((f) => f.name)}
	canWriteToBase={data.canWriteToBase}
/>
