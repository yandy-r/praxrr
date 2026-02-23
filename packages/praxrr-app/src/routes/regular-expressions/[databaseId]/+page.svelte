<script lang="ts">
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import ActionButton from '$ui/actions/ActionButton.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import ViewToggle from '$ui/actions/ViewToggle.svelte';
	import InfoModal from '$ui/modal/InfoModal.svelte';
	import CloneModal from '$ui/modal/CloneModal.svelte';
	import Dropdown from '$ui/dropdown/Dropdown.svelte';
	import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
	import TableView from './views/TableView.svelte';
	import CardView from './views/CardView.svelte';
	import SearchFilterAction from './components/SearchFilterAction.svelte';
	import { createDataPageStore } from '$lib/client/stores/dataPage';
	import { browser } from '$app/environment';
	import { Info, Plus, FileText, Users } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { alertStore } from '$alerts/store';
	import type { RegularExpressionWithTags } from '$shared/pcd/display';
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
				entityType: 'regular_expression',
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

	const SEARCH_FILTER_STORAGE_KEY = 'regularExpressionsSearchFilter';

	// Default search filter options - everything except description
	const defaultSearchOptions = [
		{ key: 'name', label: 'Name', enabled: true },
		{ key: 'tags', label: 'Tags', enabled: true },
		{ key: 'pattern', label: 'Pattern', enabled: true },
		{ key: 'description', label: 'Description', enabled: false },
		{ key: 'regex101_id', label: 'Regex101 ID', enabled: true }
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
	const { search, view, setItems } = createDataPageStore(data.regularExpressions, {
		storageKey: 'regularExpressionsView',
		defaultView: 'cards',
		searchKeys: ['name'], // Placeholder, we do our own filtering
		searchKey: `regularExpressionsSearch:${data.currentDatabase.id}`
	});

	// Extract the debounced query store for reactive access
	const debouncedQuery = search.debouncedQuery;

	// Update items when data changes (e.g., switching databases)
	$: setItems(data.regularExpressions);

	// Custom filtering based on selected search options
	$: filtered = filterExpressions(data.regularExpressions, $debouncedQuery, searchOptions);

	function filterExpressions(
		items: RegularExpressionWithTags[],
		query: string,
		options: typeof searchOptions
	): RegularExpressionWithTags[] {
		if (!query) return items;

		const queryLower = query.toLowerCase();
		const enabledKeys = options.filter((o) => o.enabled).map((o) => o.key);

		return items.filter((item) => {
			return enabledKeys.some((key) => {
				if (key === 'tags') {
					// Search within tag names
					return item.tags.some((tag) => tag.name.toLowerCase().includes(queryLower));
				}
				const value = item[key as keyof RegularExpressionWithTags];
				if (value == null) return false;
				return String(value).toLowerCase().includes(queryLower);
			});
		});
	}

	// Map databases to tabs
	$: tabs = data.databases.map((db) => ({
		label: db.name,
		href: `/regular-expressions/${db.id}`,
		active: db.id === data.currentDatabase.id
	}));

	// Persist selected database tab
	$: if (browser && data.currentDatabase?.id) {
		localStorage.setItem('regularExpressionsDatabase', String(data.currentDatabase.id));
	}
</script>

<svelte:head>
	<title>Regular Expressions - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4 pb-8 md:px-8">
	<!-- Tabs -->
	<Tabs {tabs} responsive />

	<!-- Actions Bar -->
	<ActionsBar>
		<SearchAction searchStore={search} placeholder="Search regular expressions..." responsive />
		<ActionButton icon={Plus} hasDropdown={true} dropdownPosition="right">
			<svelte:fragment slot="dropdown">
				<Dropdown position="right">
					<DropdownItem
						icon={FileText}
						label="Blank"
						on:click={() => goto(`/regular-expressions/${data.currentDatabase.id}/new`)}
					/>
					<DropdownItem
						icon={Users}
						label="Release Group"
						on:click={() =>
							goto(`/regular-expressions/${data.currentDatabase.id}/new?preset=release-group`)}
					/>
				</Dropdown>
			</svelte:fragment>
		</ActionButton>
		<SearchFilterAction bind:options={searchOptions} />
		<ViewToggle bind:value={$view} />
		<ActionButton icon={Info} on:click={() => (infoModalOpen = true)} />
	</ActionsBar>

	<!-- Regular Expressions Content -->
	<div class="mt-6">
		{#if data.regularExpressions.length === 0}
			<div
				class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
			>
				<p class="text-neutral-600 dark:text-neutral-400">
					No regular expressions found for {data.currentDatabase.name}
				</p>
			</div>
		{:else if filtered.length === 0}
			<div
				class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
			>
				<p class="text-neutral-600 dark:text-neutral-400">
					No regular expressions match your search
				</p>
			</div>
		{:else if $view === 'table'}
			<TableView expressions={filtered} on:clone={handleClone} on:export={handleExport} />
		{:else}
			<CardView expressions={filtered} on:clone={handleClone} on:export={handleExport} />
		{/if}
	</div>
</div>

<!-- Info Modal -->
<InfoModal bind:open={infoModalOpen} header="About Regular Expressions">
	<div class="space-y-4 text-sm text-neutral-700 dark:text-neutral-300">
		<section>
			<h3 class="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">How It Works</h3>
			<p>
				Regular expressions in Praxrr are separated from custom formats to make them reusable.
				When multiple custom formats share the same pattern, you only need to update it in one
				place.
			</p>
			<p class="mt-2">
				When custom formats are synced to your Arr instances, Praxrr compiles the referenced
				patterns into the format each Arr expects. The regular expressions themselves are
				<strong>not</strong> synced directly—only the compiled custom formats are.
			</p>
		</section>

		<section>
			<h3 class="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">Regex Flavor</h3>
			<p>
				Radarr and Sonarr use the <strong>.NET regex engine</strong> (specifically .NET 6+). Patterns
				are matched case-insensitively by default.
			</p>
		</section>

		<section>
			<h3 class="mb-2 font-semibold text-neutral-900 dark:text-neutral-100">Testing Patterns</h3>
			<p>
				Use <a
					href="https://regex101.com"
					target="_blank"
					rel="noopener noreferrer"
					class="text-accent-600 hover:underline dark:text-accent-400">regex101.com</a
				>
				to test your patterns. Make sure to select the <strong>.NET</strong> flavor from the dropdown
				for accurate results.
			</p>
			<p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
				Tip: When saving a regex101 link, include the version number (e.g., <code
					class="rounded bg-neutral-100 px-1 dark:bg-neutral-800">ABC123/1</code
				>) to ensure it always points to your specific version.
			</p>
		</section>
	</div>
</InfoModal>

<CloneModal
	bind:open={cloneModalOpen}
	databaseId={data.currentDatabase.id}
	entityType="regular_expression"
	sourceName={cloneSourceName}
	existingNames={data.regularExpressions.map((r) => r.name)}
	canWriteToBase={data.canWriteToBase}
/>
