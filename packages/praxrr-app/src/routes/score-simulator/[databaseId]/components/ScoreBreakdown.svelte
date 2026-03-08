<script lang="ts">
	import Score from '$ui/arr/Score.svelte';
	import CustomFormatBadge from '$ui/arr/CustomFormatBadge.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import NumberInput from '$ui/form/NumberInput.svelte';
	import { RotateCcw, X } from 'lucide-svelte';
	import type { components } from '$api/v1.d.ts';
	import {
		applyScoreOverrides,
		computeOverriddenTotal,
		resolveScoreThresholdState,
		resolveThresholdWithOverrides,
		sortScoreContributionsByMagnitude,
		type ScoreOverrideMap,
		type ScoreThresholdState,
	} from '../helpers.ts';

	type SimulateProfileScore = components['schemas']['SimulateProfileScore'];

	export let profileScore: SimulateProfileScore | null = null;
	export let overrides: ScoreOverrideMap = {};
	export let onOverrideChange: ((cfName: string, score: number) => void) | undefined = undefined;
	export let onOverrideReset: ((cfName: string) => void) | undefined = undefined;
	export let onOverrideResetAll: (() => void) | undefined = undefined;

	let thresholdState: ScoreThresholdState | null = null;
	let overriddenThresholdState: ScoreThresholdState | null = null;
	let editingCfName: string | null = null;

	$: totalScore = profileScore?.totalScore ?? 0;
	$: minimumScore = profileScore?.minimumScore ?? 0;
	$: upgradeUntilScore = profileScore?.upgradeUntilScore ?? 0;
	$: hasOverrides = Object.keys(overrides).length > 0;

	$: thresholdState = resolveScoreThresholdState(profileScore);
	$: overriddenContributions = profileScore
		? applyScoreOverrides(sortScoreContributionsByMagnitude(profileScore.contributions), overrides)
		: [];
	$: overriddenTotal = profileScore ? computeOverriddenTotal(profileScore.contributions, overrides) : 0;
	$: overriddenThresholdState = profileScore
		? resolveThresholdWithOverrides(profileScore, overrides)
		: null;
	$: activeTotalScore = hasOverrides ? overriddenTotal : totalScore;
	$: activeThresholdState = hasOverrides ? overriddenThresholdState : thresholdState;
	$: totalDelta = overriddenTotal - totalScore;
	$: overrideCount = Object.keys(overrides).length;
	$: minimumGap = Math.max(minimumScore - activeTotalScore, 0);
	$: upgradeGap = Math.max(upgradeUntilScore - activeTotalScore, 0);
	$: summaryMessage = activeThresholdState ? decisionSummary(activeThresholdState) : '';

	function selectInputText(node: HTMLElement) {
		const rafId = requestAnimationFrame(() => {
			const input = node.querySelector('input') as HTMLInputElement | null;
			input?.focus();
			input?.select();
		});

		return {
			destroy() {
				cancelAnimationFrame(rafId);
			},
		};
	}

	function handleOverrideChangeEvent(cfName: string, event: CustomEvent<number | undefined>) {
		if (event.detail === undefined) {
			onOverrideReset?.(cfName);
			editingCfName = null;
		}
	}

	function handleOverrideKeydown(event: KeyboardEvent | CustomEvent<unknown>) {
		const keyboardEvent = event as KeyboardEvent;
		if (keyboardEvent.key !== 'Escape') {
			return;
		}

		keyboardEvent.preventDefault();
		editingCfName = null;
	}

	function thresholdLabel(state: ScoreThresholdState): string {
		if (state === 'below') return 'Below Minimum';
		if (state === 'accepted') return 'Accepted - Upgrades Enabled';
		return 'Upgrade Until Reached';
	}

	function decisionSummary(state: ScoreThresholdState): string {
		if (state === 'below') return 'This release would not be grabbed.';
		if (state === 'accepted') return 'This release is eligible to grab.';
		return 'This release meets your upgrade target.';
	}
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
>
	{#if !profileScore}
		<div class="py-6 text-sm text-neutral-500 dark:text-neutral-400">
			Select a profile to see score breakdown.
		</div>
	{:else}
		<div class="space-y-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
						Total Score
					</div>
					<div class="mt-1 flex items-baseline gap-2" aria-live="polite">
						<Score score={activeTotalScore} size="md" />
						{#if hasOverrides}
							<span class="text-xs font-mono text-neutral-500 dark:text-neutral-400">
								(Δ {totalDelta > 0 ? '+' : ''}{totalDelta.toLocaleString()})
							</span>
							<span class="text-xs text-neutral-500 dark:text-neutral-400">
								was <span class="font-mono line-through">{totalScore.toLocaleString()}</span>
							</span>
						{/if}
					</div>
				</div>
				{#if activeThresholdState}
					<Badge variant={activeThresholdState === 'below' ? 'danger' : 'success'} size="md"
						><span class={activeThresholdState === 'upgrade-reached' ? 'opacity-70' : ''}>
							{thresholdLabel(activeThresholdState)}
						</span></Badge
					>
				{/if}
			</div>

			<div class="flex flex-wrap gap-2">
				<Badge variant="neutral" size="md" mono={true}>Min: {minimumScore.toLocaleString()}</Badge>
				<Badge variant="neutral" size="md" mono={true}
					>Upgrade Until: {upgradeUntilScore.toLocaleString()}</Badge
				>
			</div>

			{#if activeThresholdState}
				<div class="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/60">
					<p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{summaryMessage}</p>
					<div class="mt-2 flex flex-wrap gap-2 text-xs">
						<span
							class="rounded bg-white px-2 py-1 font-mono text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
						>
							Current: {activeTotalScore.toLocaleString()}
						</span>
						<span
							class="rounded bg-white px-2 py-1 font-mono text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
						>
							Minimum Required: {minimumScore.toLocaleString()}
						</span>
						{#if activeThresholdState === 'below'}
							<span
								class="rounded bg-white px-2 py-1 font-mono text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
							>
								Remaining to Minimum: {minimumGap.toLocaleString()}
							</span>
						{:else if activeThresholdState === 'accepted'}
							<span
								class="rounded bg-white px-2 py-1 font-mono text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
							>
								Remaining to Upgrade Target: {upgradeGap.toLocaleString()}
							</span>
						{/if}
					</div>
				</div>
			{/if}

			<div>
				<div class="mb-2 flex items-center justify-between gap-2">
					<div class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
						Contributions
					</div>
					{#if hasOverrides}
						<div class="flex items-center gap-2">
							<span
								class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
								aria-label="{overrideCount} active overrides"
							>
								{overrideCount} override{overrideCount === 1 ? '' : 's'}
							</span>
							{#if onOverrideResetAll}
								<button
									type="button"
									class="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900/70"
									on:click={onOverrideResetAll}
								>
									<RotateCcw size={12} />
									Reset All
								</button>
							{/if}
						</div>
					{/if}
				</div>
				{#if overriddenContributions.length === 0}
					<div class="text-sm text-neutral-500 dark:text-neutral-400">No score contributions.</div>
				{:else}
					<ul class="space-y-2">
						{#each overriddenContributions as contribution (contribution.cfName)}
							{@const hasOverride = contribution.originalScore !== undefined}
							{@const scoreDelta = hasOverride
								? contribution.score - (contribution.originalScore ?? 0)
								: 0}
							<li
								class="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-2.5 py-2 dark:border-neutral-800 {hasOverride
									? 'dark:bg-amber-900/20'
									: ''}"
								class:bg-amber-50={hasOverride}
								class:border-l-2={hasOverride}
								class:border-amber-500={hasOverride}
							>
								<CustomFormatBadge name={contribution.cfName} score={contribution.score} />
								<div class="flex items-center gap-2">
									{#if editingCfName === contribution.cfName}
										<div class="w-28" use:selectInputText>
											<NumberInput
												name="override-{contribution.cfName}"
												value={contribution.score}
												step={1}
												compact
												font="mono"
												on:keydown={(event) => handleOverrideKeydown(event)}
												onchange={(value) => {
													onOverrideChange?.(contribution.cfName, Math.round(value));
													editingCfName = null;
												}}
												on:change={(event) =>
													handleOverrideChangeEvent(contribution.cfName, event)}
											/>
										</div>
									{:else}
										<button
											type="button"
											class="rounded px-1 py-0.5 text-left transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 dark:hover:bg-neutral-800"
											on:click={() => (editingCfName = contribution.cfName)}
										>
											<Score score={contribution.score} size="sm" />
										</button>
									{/if}

									{#if hasOverride}
										<span class="text-xs text-neutral-400 line-through dark:text-neutral-500">
											{contribution.originalScore?.toLocaleString()}
										</span>
										<span
											class="text-xs font-mono {scoreDelta > 0
												? 'text-emerald-600 dark:text-emerald-400'
												: scoreDelta < 0
													? 'text-red-600 dark:text-red-400'
													: 'text-neutral-500 dark:text-neutral-400'}"
										>
											{scoreDelta > 0 ? '+' : ''}{scoreDelta.toLocaleString()}
										</span>
										{#if onOverrideReset}
											<button
												type="button"
												class="inline-flex items-center rounded border border-amber-300 bg-white p-1 text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900/70"
												aria-label="Reset override for {contribution.cfName}"
												on:click={() => onOverrideReset?.(contribution.cfName)}
											>
												<X size={12} />
											</button>
										{/if}
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
</div>
