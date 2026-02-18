<script lang="ts">
	import { AlertTriangle, X, Search, Calendar, Filter, CircleDot, Check } from 'lucide-svelte';
	import type { UpgradeJobLog } from '$lib/server/upgrades/types.ts';
	import { createSearchStore, getPersistentSearchStore, type SearchStore } from '$lib/client/stores/search';
	import type { Readable } from 'svelte/store';
	import { page } from '$app/stores';
	import ActionsBar from '$ui/actions/ActionsBar.svelte';
	import SearchAction from '$ui/actions/SearchAction.svelte';
	import ActionButton from '$ui/actions/ActionButton.svelte';
	import Dropdown from '$ui/dropdown/Dropdown.svelte';
	import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
	import ExpandableTable from '$ui/table/ExpandableTable.svelte';
	import Score from '$ui/arr/Score.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import type { Column } from '$ui/table/types';

	let searchStore: SearchStore = createSearchStore();
	let debouncedQuery: Readable<string> = searchStore.debouncedQuery;
	$: if ($page?.params?.id) {
		searchStore = getPersistentSearchStore(`upgradeRunHistorySearch:${$page.params.id}`);
		debouncedQuery = searchStore.debouncedQuery;
	}

	export let runs: UpgradeJobLog[] = [];

	// Filter state
	let dateFilter: 'all' | 'today' | 'yesterday' | 'week' | 'month' = 'all';
	let filterFilter: string = 'all';
	let statusFilter: 'all' | 'success' | 'partial' | 'failed' | 'skipped' = 'all';

	// Get unique filter names from runs
	$: uniqueFilters = [...new Set(runs.map((r) => r.config.selectedFilter).filter(Boolean))];

	// Filter runs based on all criteria
	$: filteredRuns = filterRuns(runs, $debouncedQuery, dateFilter, filterFilter, statusFilter);

	function filterRuns(
		items: UpgradeJobLog[],
		query: string,
		date: typeof dateFilter,
		filter: string,
		status: typeof statusFilter
	): UpgradeJobLog[] {
		let result = items;

		// Text search
		if (query) {
			const queryLower = query.toLowerCase();
			result = result.filter(
				(item) =>
					item.config.selectedFilter.toLowerCase().includes(queryLower) ||
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

		// Filter name filter
		if (filter !== 'all') {
			result = result.filter((item) => item.config.selectedFilter === filter);
		}

		// Status filter
		if (status !== 'all') {
			result = result.filter((item) => item.status === status);
		}

		return result;
	}

	// Check if any filters are active
	$: hasActiveFilters = dateFilter !== 'all' || filterFilter !== 'all' || statusFilter !== 'all';

	let expandedIds: Set<string> = new Set();

	const columns: Column<UpgradeJobLog>[] = [
		{ key: 'runNumber', header: '#', sortable: false },
		{ key: 'filter', header: 'Filter', sortable: true },
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

	function getRunNumber(row: UpgradeJobLog): number {
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

	function formatSchedule(minutes: number): string {
		if (minutes < 60) return `Every ${minutes} minutes`;
		if (minutes === 60) return 'Every hour';
		if (minutes < 1440) return `Every ${minutes / 60} hours`;
		return 'Every day';
	}

	function formatFilterMode(mode: string): string {
		return mode
			.split('_')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');
	}

	function formatMethod(method: string): string {
		return method
			.split('_')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');
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

			<!-- Filter Name Filter -->
			<ActionButton icon={Filter} hasDropdown square title="Filter by filter name">
				<Dropdown slot="dropdown" position="right" mobilePosition="middle">
					<DropdownItem
						label="All filters"
						selected={filterFilter === 'all'}
						on:click={() => (filterFilter = 'all')}
					/>
					{#each uniqueFilters as filter}
						<DropdownItem
							label={filter}
							selected={filterFilter === filter}
							on:click={() => (filterFilter = filter)}
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
		emptyMessage="No upgrade runs yet. Configure and enable upgrades to start."
		responsive
	>
		<svelte:fragment slot="cell" let:row let:column>
			{#if column.key === 'runNumber'}
				<span class="font-mono text-neutral-500 dark:text-neutral-500">
					#{getRunNumber(row)}
				</span>
			{:else if column.key === 'filter'}
				<div class="flex items-center gap-2">
					<span class="font-medium text-neutral-900 dark:text-neutral-100">
						{row.config.selectedFilter || 'Unknown'}
					</span>
					{#if row.config.dryRun}
						<span
							class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
						>
							DRY
						</span>
					{/if}
				</div>
			{:else if column.key === 'date'}
				<span class="text-neutral-600 dark:text-neutral-400">
					{formatDate(row.startedAt)}
				</span>
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
					<span class="font-mono">{row.filter.matchedCount}</span> filtered
					<span class="mx-1 text-neutral-300 dark:text-neutral-600">&rarr;</span>
					<span class="font-mono">{row.filter.afterCooldown}</span> after cooldown
					<span class="mx-1 text-neutral-300 dark:text-neutral-600">&rarr;</span>
					<span class="font-mono">{row.selection.actualCount}</span> selected
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
						Schedule: {formatSchedule(row.config.schedule)} | Mode: {formatFilterMode(
							row.config.filterMode
						)}
					</span>
				</div>

				<!-- Library -->
				<div class="flex">
					<span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400"
						>Library</span
					>
					<span class="text-sm text-neutral-900 dark:text-neutral-100">
						<span class="font-mono">{row.library.totalItems.toLocaleString()}</span> items
						{#if row.library.fetchedFromCache}
							<span class="text-neutral-500 dark:text-neutral-400">(cached)</span>
						{/if}
						<span class="ml-1 font-mono text-xs text-neutral-500 dark:text-neutral-400">
							({row.library.fetchDurationMs}ms)
						</span>
					</span>
				</div>

				<!-- Filter -->
				<div class="flex">
					<span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400"
						>Filter</span
					>
					<span class="text-sm text-neutral-900 dark:text-neutral-100">
						"{row.filter.name}"
						<span class="mx-1 text-neutral-400">&rarr;</span>
						<span class="font-mono font-medium">{row.filter.matchedCount}</span> filtered
						<span class="mx-1 text-neutral-400">&rarr;</span>
						<span class="font-mono font-medium">{row.filter.afterCooldown}</span> after cooldown
					</span>
				</div>

				<!-- Selection -->
				<div class="flex">
					<span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400"
						>Selection</span
					>
					<span class="text-sm text-neutral-900 dark:text-neutral-100">
						{formatMethod(row.selection.method)}
						<span class="font-mono font-medium">{row.selection.actualCount}</span> of
						<span class="font-mono">{row.selection.requestedCount}</span>
					</span>
				</div>

				<!-- Results -->
				<div class="flex">
					<span class="w-24 shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400"
						>Results</span
					>
					<span class="text-sm text-neutral-900 dark:text-neutral-100">
						{#if row.config.dryRun}
							<span class="font-mono">{row.results.searchesTriggered}</span> previewed,
							<span
								class="{row.results.successful > 0
									? 'text-green-600 dark:text-green-400'
									: ''} font-mono">{row.results.successful}</span
							> upgrades found
						{:else}
							<span class="font-mono">{row.results.searchesTriggered}</span> searches triggered,
							<span
								class="{row.results.successful > 0
									? 'text-green-600 dark:text-green-400'
									: ''} font-mono">{row.results.successful}</span
							> grabbed
						{/if}
						{#if row.results.failed > 0}
							<span class="font-mono text-red-600 dark:text-red-400"
								>, {row.results.failed} failed</span
							>
						{/if}
					</span>
				</div>

				<!-- Items Searched -->
				{#if row.selection.items.length > 0}
					{@const itemsColumns = [
						{ key: 'title', header: 'Title', sortable: false },
						{ key: 'current', header: 'Current', sortable: false, align: 'center' as const },
						{ key: 'upgrade', header: 'Upgrade', sortable: false, align: 'center' as const },
						{ key: 'delta', header: 'Delta', sortable: false, align: 'center' as const },
						{ key: 'formats', header: 'Formats', sortable: false }
					]}
					<div class="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-700">
						<div
							class="mb-3 flex items-center gap-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-300"
						>
							<Search size={14} />
							Items Searched
						</div>
						<ExpandableTable
							columns={itemsColumns}
							data={row.selection.items}
							getRowId={(item) => item.id}
							compact={true}
							emptyMessage="No items"
							responsive
						>
							<svelte:fragment slot="cell" let:row={item} let:column>
								{#if column.key === 'title'}
									<span class="text-neutral-900 dark:text-neutral-100">{item.title}</span>
								{:else if column.key === 'current'}
									<Badge variant="neutral" mono>{item.original.score.toLocaleString()}</Badge>
								{:else if column.key === 'upgrade'}
									{#if item.upgrade}
										<Badge variant="neutral" mono>{item.upgrade.score.toLocaleString()}</Badge>
									{:else}
										<span class="text-neutral-400">—</span>
									{/if}
								{:else if column.key === 'delta'}
									{#if item.upgrade && item.scoreDelta !== null}
										<Badge variant={item.scoreDelta >= 0 ? 'success' : 'danger'} mono>
											{item.scoreDelta >= 0 ? '+' : ''}{item.scoreDelta.toLocaleString()}
										</Badge>
									{:else}
										<span class="text-neutral-400">—</span>
									{/if}
								{:else if column.key === 'formats'}
									{#if item.upgrade && item.upgrade.formats.length > 0}
										<div class="flex flex-wrap gap-1">
											{#each item.upgrade.formats as format}
												<Badge variant="success" size="sm">{format}</Badge>
											{/each}
										</div>
									{:else}
										<Badge variant="neutral" size="sm">No upgrade</Badge>
									{/if}
								{/if}
							</svelte:fragment>

							<svelte:fragment slot="expanded" let:row={item}>
								<div class="space-y-2 py-2 pl-2">
									<div class="flex gap-2">
										<span
											class="w-16 shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400"
											>Current:</span
										>
										<span
											class="truncate font-mono text-xs text-neutral-700 dark:text-neutral-300"
											title={item.original.fileName}
										>
											{item.original.fileName}
										</span>
									</div>
									{#if item.upgrade}
										<div class="flex gap-2">
											<span
												class="w-16 shrink-0 text-xs font-medium text-emerald-600 dark:text-emerald-400"
												>Upgrade:</span
											>
											<span
												class="truncate font-mono text-xs text-neutral-700 dark:text-neutral-300"
												title={item.upgrade.release}
											>
												{item.upgrade.release}
											</span>
										</div>
									{:else}
										<div class="text-xs text-neutral-500 italic dark:text-neutral-400">
											No upgrade available
										</div>
									{/if}
								</div>
							</svelte:fragment>
						</ExpandableTable>
					</div>
				{/if}
			</div>
		</svelte:fragment>
	</ExpandableTable>
</div>
