<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import ExpandableTable from '$ui/table/ExpandableTable.svelte';
	import type { Column } from '$ui/table/types';
	import Badge from '$ui/badge/Badge.svelte';
	import Score from '$ui/arr/Score.svelte';
	import SimulationResults from './SimulationResults.svelte';
	import type { RankedRelease, ScoreOverrideMap, ScoreThresholdState } from '../helpers';
	import type { components } from '$api/v1.d.ts';

	type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];

	export let rankedReleases: RankedRelease[] = [];
	export let comparisonActive: boolean = false;
	export let isSimulating: boolean = false;
	export let simulationResult: SimulateScoreResponse | null = null;
	export let selectedProfileName: string | null = null;
	export let selectedProfileLabel: string | null = null;
	export let overrides: ScoreOverrideMap = {};

	const dispatch = createEventDispatcher<{ releaseSelect: { id: string } }>();

	let expandedRows: Set<string | number> = new Set();

	$: baseColumns = [
		{
			key: 'rank',
			header: '#',
			width: 'w-12',
			align: 'center' as const,
			sortable: true,
			sortAccessor: (row: RankedRelease) => row.rank,
			defaultSortDirection: 'asc' as const,
		},
		{
			key: 'title',
			header: 'Release Title',
			sortable: true,
			sortAccessor: (row: RankedRelease) => row.title,
		},
		{
			key: 'totalScore',
			header: 'Score',
			width: 'w-24',
			align: 'right' as const,
			sortable: true,
			sortAccessor: (row: RankedRelease) => row.totalScore,
			defaultSortDirection: 'desc' as const,
		},
		{
			key: 'matchedCfCount',
			header: 'Matched CFs',
			width: 'w-28',
			align: 'center' as const,
			sortable: true,
			sortAccessor: (row: RankedRelease) => row.matchedCfCount,
			hideOnMobile: true,
		},
		{
			key: 'thresholdState',
			header: 'Threshold',
			width: 'w-28',
			align: 'center' as const,
			hideOnMobile: true,
		},
	] satisfies Column<RankedRelease>[];

	$: comparisonColumns = comparisonActive
		? [
				{
					key: 'comparisonScore',
					header: 'Profile B',
					width: 'w-24',
					align: 'right' as const,
					sortable: true,
					sortAccessor: (row: RankedRelease) => row.comparisonScore ?? 0,
					hideOnMobile: true,
				},
				{
					key: 'scoreDelta',
					header: 'Delta',
					width: 'w-20',
					align: 'right' as const,
					sortable: true,
					sortAccessor: (row: RankedRelease) => row.scoreDelta ?? 0,
					hideOnMobile: true,
				},
			]
		: [];

	$: columns = [...baseColumns, ...comparisonColumns] as Column<RankedRelease>[];

	$: showSkeleton = isSimulating && rankedReleases.length === 0;
	$: showEmpty = !isSimulating && rankedReleases.length === 0;
	$: overrideCount = Object.keys(overrides).length;
	$: hasActiveOverrides = overrideCount > 0;

	function getRowId(row: RankedRelease): string {
		return row.id;
	}

	function handleRowClick(row: RankedRelease) {
		dispatch('releaseSelect', { id: row.id });
	}

	function getThresholdBadgeVariant(state: ScoreThresholdState | null): 'danger' | 'success' | 'warning' {
		switch (state) {
			case 'below':
				return 'danger';
			case 'accepted':
				return 'warning';
			case 'upgrade-reached':
				return 'success';
			default:
				return 'neutral' as 'danger';
		}
	}

	function getThresholdLabel(state: ScoreThresholdState | null): string {
		switch (state) {
			case 'below':
				return 'Below';
			case 'accepted':
				return 'Accepted';
			case 'upgrade-reached':
				return 'Upgrade';
			default:
				return '—';
		}
	}

	const SKELETON_ROWS = 5;
</script>

<div aria-live="polite" class="space-y-2">
	{#if showSkeleton}
		<div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700/60">
			<div class="divide-y divide-neutral-100 dark:divide-neutral-800">
				{#each Array(SKELETON_ROWS) as _, i (i)}
					<div class="flex items-center gap-4 px-4 py-3">
						<div class="h-4 w-8 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"></div>
						<div class="h-4 flex-1 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"></div>
						<div class="h-4 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"></div>
						<div class="hidden h-4 w-20 animate-pulse rounded bg-neutral-200 sm:block dark:bg-neutral-700"></div>
						<div class="hidden h-4 w-20 animate-pulse rounded bg-neutral-200 sm:block dark:bg-neutral-700"></div>
					</div>
				{/each}
			</div>
		</div>
	{:else if showEmpty}
		<div class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
			Run a batch simulation to see ranked results
		</div>
	{:else}
		<div class="space-y-2">
			{#if hasActiveOverrides}
				<div class="flex items-center justify-end">
					<Badge variant="warning" size="sm">
						Ranked with {overrideCount} overrides
					</Badge>
				</div>
			{/if}
			<div class="min-w-0 overflow-x-auto">
				<ExpandableTable
					{columns}
					data={rankedReleases}
					{getRowId}
					compact={true}
					emptyMessage="No ranked results"
					chevronPosition="right"
					responsive={true}
					pageSize={20}
					defaultSort={{ key: 'rank', direction: 'asc' }}
					onRowClick={handleRowClick}
					bind:expandedRows
				>
					<svelte:fragment slot="cell" let:row let:column>
						{#if column.key === 'rank'}
							<span class="font-mono text-xs font-medium text-neutral-600 dark:text-neutral-300">
								{row.rank}
							</span>
						{:else if column.key === 'title'}
							<div class="min-w-0 max-w-full">
								<span
									class="block max-w-full break-words text-xs sm:max-w-[36rem] sm:truncate sm:text-sm"
									title={row.title}
								>
									{row.title}
								</span>
							</div>
						{:else if column.key === 'totalScore'}
							<span
								class="inline-flex rounded px-1 py-0.5 {hasActiveOverrides
									? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
									: ''}"
							>
								<Score score={row.totalScore} showSign={true} />
							</span>
						{:else if column.key === 'matchedCfCount'}
							<span class="text-xs text-neutral-600 dark:text-neutral-300">
								{row.matchedCfCount} / {row.totalCfCount}
							</span>
						{:else if column.key === 'thresholdState'}
							{#if row.thresholdState}
								<Badge variant={getThresholdBadgeVariant(row.thresholdState)} size="sm">
									{getThresholdLabel(row.thresholdState)}
								</Badge>
							{:else}
								<span class="text-xs text-neutral-400">—</span>
							{/if}
						{:else if column.key === 'comparisonScore'}
							<span
								class="inline-flex rounded px-1 py-0.5 {hasActiveOverrides
									? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
									: ''}"
							>
								<Score score={row.comparisonScore ?? null} showSign={true} />
							</span>
						{:else if column.key === 'scoreDelta'}
							<span
								class="inline-flex rounded px-1 py-0.5 {hasActiveOverrides
									? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
									: ''}"
							>
								<Score score={row.scoreDelta ?? null} showSign={true} />
							</span>
						{/if}
					</svelte:fragment>

					<svelte:fragment slot="expanded" let:row>
						<div class="min-w-0 overflow-hidden border-t border-neutral-100 dark:border-neutral-800">
							<SimulationResults
								result={simulationResult}
								releaseId={row.id}
								{selectedProfileName}
								{selectedProfileLabel}
								isSimulating={false}
							/>
						</div>
					</svelte:fragment>
				</ExpandableTable>
			</div>
		</div>
	{/if}
</div>
