<script lang="ts">
	import { AlertTriangle, Eye, FilterX, Loader2, RefreshCw, Save, Search } from 'lucide-svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import Button from '$ui/button/Button.svelte';
	import SourceBadge from '$ui/badge/SourceBadge.svelte';
	import { parseUTC } from '$shared/utils/dates';

	type TrashGuideSourceArrType = 'radarr' | 'sonarr' | 'lidarr';
	type TrashGuideSyncStatus = 'idle' | 'pending' | 'in_progress' | 'failed';
	type TrashGuideSyncSectionType =
		| 'qualityProfiles'
		| 'customFormats'
		| 'qualityDefinitions'
		| 'naming'
		| 'mediaManagement';

	type ViewState = 'loading' | 'server-error' | 'no-sources' | 'filtered-empty' | 'ready';

	interface TrashGuideSyncConfig {
		syncStatus: TrashGuideSyncStatus;
		lastError: string | null;
		lastSyncedAt: string | null;
	}

	interface TrashGuideSyncSelection {
		sectionType: TrashGuideSyncSectionType;
		itemName: string;
	}

	interface TrashGuideSyncSourceHydration {
		sourceId: number;
		sourceName: string;
		sourceArrType: TrashGuideSourceArrType;
		config: TrashGuideSyncConfig | null;
		selections: TrashGuideSyncSelection[];
	}

	interface SelectionGroup {
		sectionType: TrashGuideSyncSectionType;
		label: string;
		items: string[];
	}

	const SECTION_ORDER: readonly TrashGuideSyncSectionType[] = [
		'qualityProfiles',
		'customFormats',
		'qualityDefinitions',
		'naming',
		'mediaManagement'
	];

	const SECTION_LABELS: Record<TrashGuideSyncSectionType, string> = {
		qualityProfiles: 'Quality Profiles',
		customFormats: 'Custom Formats',
		qualityDefinitions: 'Quality Definitions',
		naming: 'Naming',
		mediaManagement: 'Media Management'
	};

	export let sources: TrashGuideSyncSourceHydration[] = [];
	export let isLoading = false;
	export let loadError: string | null = null;
	export let isDirty = false;
	export let previewEnabled = false;

	let sourceFilter = '';

	function compareSources(a: TrashGuideSyncSourceHydration, b: TrashGuideSyncSourceHydration): number {
		const byName = a.sourceName.localeCompare(b.sourceName, undefined, { sensitivity: 'base' });
		if (byName !== 0) {
			return byName;
		}

		return a.sourceId - b.sourceId;
	}

	function getSelectionGroups(selections: TrashGuideSyncSelection[]): SelectionGroup[] {
		const selectionMap = new Map<TrashGuideSyncSectionType, Set<string>>();

		for (const selection of selections) {
			if (!selectionMap.has(selection.sectionType)) {
				selectionMap.set(selection.sectionType, new Set<string>());
			}

			selectionMap.get(selection.sectionType)?.add(selection.itemName);
		}

		const groups: SelectionGroup[] = [];
		for (const sectionType of SECTION_ORDER) {
			const items = selectionMap.get(sectionType);
			if (!items || items.size === 0) {
				continue;
			}

			groups.push({
				sectionType,
				label: SECTION_LABELS[sectionType],
				items: [...items].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
			});
		}

		return groups;
	}

	function getStatusVariant(config: TrashGuideSyncConfig | null): 'neutral' | 'warning' | 'danger' | 'info' {
		if (!config) {
			return 'neutral';
		}

		switch (config.syncStatus) {
			case 'failed':
				return 'danger';
			case 'in_progress':
				return 'info';
			case 'pending':
				return 'warning';
			default:
				return 'neutral';
		}
	}

	function getStatusLabel(config: TrashGuideSyncConfig | null): string {
		if (!config) {
			return 'Not configured';
		}

		switch (config.syncStatus) {
			case 'failed':
				return 'Failed';
			case 'in_progress':
				return 'In progress';
			case 'pending':
				return 'Pending';
			default:
				return 'Idle';
		}
	}

	function formatLastSynced(value: string | null): string {
		const parsed = parseUTC(value);
		if (!parsed) {
			return 'Never';
		}

		return parsed.toLocaleString();
	}

	function clearFilter() {
		sourceFilter = '';
	}

	$: orderedSources = [...sources].sort(compareSources);
	$: normalizedFilter = sourceFilter.trim().toLowerCase();
	$: filteredSources = orderedSources.filter((source) => {
		if (!normalizedFilter) {
			return true;
		}

		return (
			source.sourceName.toLowerCase().includes(normalizedFilter) ||
			source.sourceArrType.toLowerCase().includes(normalizedFilter)
		);
	});
	$: viewState = isLoading
		? 'loading'
		: loadError
			? 'server-error'
			: orderedSources.length === 0
				? 'no-sources'
				: filteredSources.length === 0
					? 'filtered-empty'
					: 'ready';

	// Source state is read-only in Task 3.1, so dirty/preview stay deterministic across states.
	$: {
		switch (viewState as ViewState) {
			case 'loading':
			case 'server-error':
			case 'no-sources':
			case 'filtered-empty':
			case 'ready':
				isDirty = false;
				previewEnabled = false;
				break;
		}
	}
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
	<div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<h2 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">TRaSH Guide Sources</h2>
		<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
			Review source-scoped TRaSH sync selections and status context for this instance.
		</p>
	</div>

	<div class="space-y-4 p-6">
		<div class="relative">
			<Search
				size={14}
				class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
			/>
			<input
				type="text"
				bind:value={sourceFilter}
				class="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-neutral-800 outline-none transition-colors focus:border-accent-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
				placeholder="Filter sources by name or Arr type"
				disabled={isLoading || orderedSources.length === 0}
				aria-label="Filter TRaSH sources"
			/>
		</div>

		{#if viewState === 'loading'}
			<div class="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
				<Loader2 size={14} class="animate-spin" />
				<span>Loading TRaSH source sync state...</span>
			</div>
		{:else if viewState === 'server-error'}
			<div
				class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
			>
				<div class="flex items-start gap-2">
					<AlertTriangle size={14} class="mt-0.5 flex-shrink-0" />
					<div>
						<p class="font-medium">Unable to load TRaSH source sync state</p>
						<p class="mt-1">{loadError ?? 'An unexpected server error occurred.'}</p>
					</div>
				</div>
			</div>
		{:else if viewState === 'no-sources'}
			<p class="text-sm text-neutral-500 dark:text-neutral-400">
				No enabled TRaSH Guide sources are linked for this instance type.
			</p>
		{:else if viewState === 'filtered-empty'}
			<div class="rounded-md border border-neutral-200 p-4 dark:border-neutral-700">
				<div class="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
					<FilterX size={14} />
					<span>No TRaSH sources match your current filter</span>
				</div>
				<p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
					Clear your filter to view all source groups.
				</p>
				<div class="mt-3">
					<Button text="Clear filter" size="xs" variant="ghost" on:click={clearFilter} />
				</div>
			</div>
		{:else}
			<div class="space-y-4">
				{#each filteredSources as source}
					{@const selectionGroups = getSelectionGroups(source.selections)}
					<div
						class="rounded-md border border-neutral-200 p-4 dark:border-neutral-700"
					>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div class="flex flex-wrap items-center gap-2">
								<SourceBadge
									sourceType="trash"
									sourceName={source.sourceName}
									arrType={source.sourceArrType}
								/>
								<Badge variant={getStatusVariant(source.config)} size="sm">
									{getStatusLabel(source.config)}
								</Badge>
							</div>
							<div class="text-xs text-neutral-500 dark:text-neutral-400">
								Last synced: {formatLastSynced(source.config?.lastSyncedAt ?? null)}
							</div>
						</div>

						{#if source.config?.lastError}
							<p class="mt-2 text-xs text-red-600 dark:text-red-300">{source.config.lastError}</p>
						{/if}

						<div class="mt-3 text-sm text-neutral-700 dark:text-neutral-300">
							{source.selections.length} selected {source.selections.length === 1 ? 'item' : 'items'}
							across {selectionGroups.length} {selectionGroups.length === 1 ? 'section' : 'sections'}.
						</div>

						{#if selectionGroups.length === 0}
							<p class="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
								No TRaSH selections are currently configured for this source.
							</p>
						{:else}
							<div class="mt-3 space-y-3">
								{#each selectionGroups as group}
									<div>
										<div class="text-xs font-medium text-neutral-600 dark:text-neutral-300">
											{group.label}
										</div>
										<div class="mt-1 flex flex-wrap gap-1.5">
											{#each group.items as item}
												<Badge variant="neutral" size="sm" mono>{item}</Badge>
											{/each}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="border-t border-neutral-200 px-4 py-4 md:px-6 dark:border-neutral-800">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<p class="text-xs text-neutral-500 dark:text-neutral-400">
				Preview, save, and sync controls unlock when editable source actions are available.
			</p>
			<div class="flex items-center gap-2">
				<Button
					text="Preview Sync"
					variant="secondary"
					size="sm"
					disabled
					icon={Eye}
					iconColor="text-blue-600 dark:text-blue-400"
				/>
				<Button
					text="Sync Now"
					variant="secondary"
					size="sm"
					disabled
					icon={RefreshCw}
					iconColor="text-blue-600 dark:text-blue-400"
				/>
				<Button
					text="Save"
					variant="secondary"
					size="sm"
					disabled
					icon={Save}
					iconColor="text-green-600 dark:text-green-400"
				/>
			</div>
		</div>
	</div>
</div>
