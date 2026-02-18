<script lang="ts">
	import { AlertTriangle, X, FileText, Calendar, CircleDot, Check } from 'lucide-svelte';
	import type { RenameJobLog } from '$lib/server/rename/types.ts';
	import { createSearchStore, getPersistentSearchStore, type SearchStore } from '$lib/client/stores/search';
	import type { Readable } from 'svelte/store';
	import { page } from '$app/stores';
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import ActionButton from '$ui/actions/ActionButton.svelte';
	import Dropdown from '$ui/dropdown/Dropdown.svelte';
	import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
	import ExpandableTable from '$ui/table/ExpandableTable.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import type { Column } from '$ui/table/types';

	let searchStore: SearchStore = createSearchStore();
	let debouncedQuery: Readable<string> = searchStore.debouncedQuery;
	$: if ($page?.params?.id) {
		searchStore = getPersistentSearchStore(`renameRunHistorySearch:${$page.params.id}`);
		debouncedQuery = searchStore.debouncedQuery;
	}

	export let runs: RenameJobLog[] = [];

	// Filter state
	let dateFilter: 'all' | 'today' | 'yesterday' | 'week' | 'month' = 'all';
	let statusFilter: 'all' | 'success' | 'partial' | 'failed' | 'skipped' = 'all';

	// Filter runs based on all criteria
	$: filteredRuns = filterRuns(runs, $debouncedQuery, dateFilter, statusFilter);

	function filterRuns(
		items: RenameJobLog[],
		query: string,
		date: typeof dateFilter,
		status: typeof statusFilter
	): RenameJobLog[] {
		let result = items;

		// Text search (search in renamed item titles)
		if (query) {
			const queryLower = query.toLowerCase();
			result = result.filter(
				(item) =>
					item.renamedItems.some((r) => r.title.toLowerCase().includes(queryLower)) ||
					item.status.toLowerCase().includes(queryLower)
			);
		}

		// Date filter
		if (date !== 'all') {
			const now = new Date();
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const yesterday = new Date(today);
			yesterday.setDate(yesterday.getDate() - 1);
			const weekAgo = new Date(today);
			weekAgo.setDate(weekAgo.getDate() - 7);
			const monthAgo = new Date(today);
			monthAgo.setDate(monthAgo.getDate() - 30);

			result = result.filter((item) => {
				const itemDate = new Date(item.startedAt);
				switch (date) {
					case 'today':
						return itemDate >= today;
					case 'yesterday':
						return itemDate >= yesterday && itemDate < today;
					case 'week':
						return itemDate >= weekAgo;
					case 'month':
						return itemDate >= monthAgo;
					default:
						return true;
				}
			});
		}

		// Status filter
		if (status !== 'all') {
			result = result.filter((item) => item.status === status);
		}

		return result;
	}

	// Check if any filters are active
	$: hasActiveFilters = dateFilter !== 'all' || statusFilter !== 'all';

	let expandedIds: Set<string> = new Set();

	const columns: Column<RenameJobLog>[] = [
		{ key: 'runNumber', header: '#', sortable: false },
		{ key: 'date', header: 'Date', sortable: true },
		{ key: 'duration', header: 'Duration', sortable: false },
		{ key: 'status', header: 'Status', sortable: true },
		{ key: 'summary', header: 'Summary', sortable: false }
	];

	// Status badge config
	const statusConfig = {
		success: { variant: 'success' as const, icon: Check },
		partial: { variant: 'warning' as const, icon: AlertTriangle },
		failed: { variant: 'danger' as const, icon: X },
		skipped: { variant: 'neutral' as const, icon: X }
	};

	function getRunNumber(row: RenameJobLog): number {
		const originalIndex = runs.findIndex((r) => r.id === row.id);
		return runs.length - originalIndex;
	}

	function formatDate(isoString: string): string {
		const date = new Date(isoString);
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		let dateStr: string;
		if (date.toDateString() === today.toDateString()) {
			dateStr = 'Today';
		} else if (date.toDateString() === yesterday.toDateString()) {
			dateStr = 'Yesterday';
		} else {
			dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		}

		const timeStr = date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});

		return `${dateStr}, ${timeStr}`;
	}

	function formatDuration(startedAt: string, completedAt: string): string {
		const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
	}

	function getFileName(path: string): string {
		return path.split('/').pop() || path;
	}
</script>

<div class="-mx-4 bg-neutral-50 px-4 pt-2 pb-6 md:-mx-8 md:px-8 dark:bg-neutral-900">
	<div class="mb-4">
		<ActionsBar>
			<SearchAction {searchStore} placeholder="Search runs..." />

			<!-- Date Filter -->
			<ActionButton icon={Calendar} hasDropdown square title="Filter by date">
				<Dropdown slot="dropdown" position="right" mobilePosition="middle">
					{#each [{ value: 'all', label: 'All time' }, { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'week', label: 'Last 7 days' }, { value: 'month', label: 'Last 30 days' }] as const as option}
						<DropdownItem
							label={option.label}
							selected={dateFilter === option.value}
							on:click={() => (dateFilter = option.value)}
						/>
					{/each}
				</Dropdown>
			</ActionButton>

			<!-- Status Filter -->
			<ActionButton icon={CircleDot} hasDropdown square title="Filter by status">
				<Dropdown slot="dropdown" position="right" mobilePosition="middle">
					{#each [{ value: 'all', label: 'All' }, { value: 'success', label: 'Success' }, { value: 'partial', label: 'Partial' }, { value: 'failed', label: 'Failed' }, { value: 'skipped', label: 'Skipped' }] as const as option}
						<DropdownItem
							label={option.label}
							selected={statusFilter === option.value}
							on:click={() => (statusFilter = option.value)}
						/>
					{/each}
				</Dropdown>
			</ActionButton>
		</ActionsBar>
	</div>

	<ExpandableTable
		{columns}
		data={filteredRuns}
		getRowId={(row) => row.id}
		bind:expandedRows={expandedIds}
		chevronPosition="right"
		flushExpanded={true}
		emptyMessage="No rename runs yet. Configure and enable rename to start."
		responsive
	>
		<svelte:fragment slot="cell" let:row let:column>
			{#if column.key === 'runNumber'}
				<span class="font-mono text-neutral-500 dark:text-neutral-500">
					#{getRunNumber(row)}
				</span>
			{:else if column.key === 'date'}
				<div class="flex items-center gap-2">
					<span class="text-neutral-600 dark:text-neutral-400">
						{formatDate(row.startedAt)}
					</span>
					{#if row.config.dryRun}
						<span
							class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
						>
							DRY
						</span>
					{/if}
					{#if row.config.manual}
						<span
							class="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-400"
						>
							MANUAL
						</span>
					{/if}
				</div>
			{:else if column.key === 'duration'}
				<span class="font-mono text-xs text-neutral-600 dark:text-neutral-400">
					{formatDuration(row.startedAt, row.completedAt)}
				</span>
			{:else if column.key === 'status'}
				{@const config = statusConfig[row.status] || statusConfig.failed}
				<Badge variant={config.variant} icon={config.icon} size="md">
					{row.status.charAt(0).toUpperCase() + row.status.slice(1)}
				</Badge>
			{:else if column.key === 'summary'}
				<span class="text-sm text-neutral-600 dark:text-neutral-400">
					<span class="font-mono">{row.library.totalItems.toLocaleString()}</span> scanned
					<span class="mx-1 text-neutral-300 dark:text-neutral-600">&rarr;</span>
					<span class="font-mono">{row.results.filesNeedingRename}</span> need rename
					<span class="mx-1 text-neutral-300 dark:text-neutral-600">&rarr;</span>
					<span class="font-mono">{row.results.filesRenamed}</span>
					{row.config.dryRun ? 'would rename' : 'renamed'}
				</span>
			{/if}
		</svelte:fragment>

		<svelte:fragment slot="expanded" let:row>
			<div class="space-y-3 p-6">
				<!-- Config -->
				<div class="flex">
					<span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400"
						>Config</span
					>
					<span class="text-sm text-neutral-900 dark:text-neutral-100">
						{#if row.config.renameFolders}Folders enabled{:else}Files only{/if}
						{#if row.config.ignoreTag}
							| Ignore tag: "{row.config.ignoreTag}"
						{/if}
					</span>
				</div>

				<!-- Library -->
				<div class="flex">
					<span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400"
						>Library</span
					>
					<span class="text-sm text-neutral-900 dark:text-neutral-100">
						<span class="font-mono">{row.library.totalItems.toLocaleString()}</span> items
						<span class="ml-1 font-mono text-xs text-neutral-500 dark:text-neutral-400">
							({row.library.fetchDurationMs}ms)
						</span>
					</span>
				</div>

				<!-- Filtering -->
				{#if row.filtering.skippedByTag > 0}
					<div class="flex">
						<span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400"
							>Filtered</span
						>
						<span class="text-sm text-neutral-900 dark:text-neutral-100">
							<span class="font-mono">{row.filtering.skippedByTag}</span> skipped by tag
							<span class="mx-1 text-neutral-400">&rarr;</span>
							<span class="font-mono font-medium">{row.filtering.afterIgnoreTag}</span> remaining
						</span>
					</div>
				{/if}

				<!-- Results -->
				<div class="flex">
					<span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400"
						>Results</span
					>
					<span class="text-sm text-neutral-900 dark:text-neutral-100">
						{#if row.config.dryRun}
							<span class="font-mono">{row.results.filesNeedingRename}</span> files would be renamed
						{:else}
							<span class="font-mono">{row.results.filesRenamed}</span>/<span class="font-mono"
								>{row.results.filesNeedingRename}</span
							>
							files renamed
							{#if row.results.foldersRenamed > 0}
								, <span class="font-mono">{row.results.foldersRenamed}</span> folders
							{/if}
						{/if}
						{#if row.results.commandsFailed > 0}
							<span class="font-mono text-red-600 dark:text-red-400"
								>, {row.results.commandsFailed} failed</span
							>
						{/if}
					</span>
				</div>

				<!-- Renamed Items -->
				{#if row.renamedItems.length > 0}
					{@const itemsColumns = [
						{ key: 'title', header: 'Title', sortable: false },
						{ key: 'files', header: 'Files', sortable: false, align: 'center' as const }
					]}
					<div class="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-700">
						<div
							class="mb-3 flex items-center gap-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-300"
						>
							<FileText size={14} />
							Items {row.config.dryRun ? 'Needing Rename' : 'Renamed'}
						</div>
						<ExpandableTable
							columns={itemsColumns}
							data={row.renamedItems}
							getRowId={(item) => item.id}
							compact={true}
							emptyMessage="No items"
							responsive
						>
							<svelte:fragment slot="cell" let:row={item} let:column>
								{#if column.key === 'title'}
									<span class="text-neutral-900 dark:text-neutral-100">{item.title}</span>
								{:else if column.key === 'files'}
									<Badge variant="neutral" mono>{item.files.length}</Badge>
								{/if}
							</svelte:fragment>

							<svelte:fragment slot="expanded" let:row={item}>
								<div class="space-y-3 p-4">
									{#each item.files as file}
										<div class="space-y-1">
											<div class="flex gap-2">
												<span
													class="w-12 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400"
													>From:</span
												>
												<span
													class="break-all font-mono text-xs text-neutral-700 dark:text-neutral-300"
												>
													{getFileName(file.existingPath)}
												</span>
											</div>
											<div class="flex gap-2">
												<span
													class="w-12 shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400"
													>To:</span
												>
												<span
													class="break-all font-mono text-xs text-neutral-700 dark:text-neutral-300"
												>
													{getFileName(file.newPath)}
												</span>
											</div>
										</div>
									{/each}
								</div>
							</svelte:fragment>
						</ExpandableTable>
					</div>
				{/if}
			</div>
		</svelte:fragment>
	</ExpandableTable>
</div>
