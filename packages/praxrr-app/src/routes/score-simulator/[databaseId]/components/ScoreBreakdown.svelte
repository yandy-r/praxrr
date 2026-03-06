<script lang="ts">
	import { tick } from 'svelte';
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

	async function startEditing(cfName: string) {
		editingCfName = cfName;
		await tick();
		const numberInput = document.getElementsByName(`override-${cfName}`).item(0) as
			| HTMLInputElement
			| null;
		numberInput?.focus();
		numberInput?.select();
	}

	function handleOverrideInput(cfName: string, score: number) {
		onOverrideChange?.(cfName, Math.round(score));
	}

	function handleOverrideChangeEvent(cfName: string, event: CustomEvent<number | undefined>) {
		if (event.detail === undefined) {
			onOverrideReset?.(cfName);
			editingCfName = null;
			return;
		}

		onOverrideChange?.(cfName, Math.round(event.detail));
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
					<Badge
						variant={activeThresholdState === 'below' ? 'danger' : 'success'}
						size="md"
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

			<div>
				<div class="mb-2 flex items-center justify-between gap-2">
					<div class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
						Contributions
					</div>
					{#if hasOverrides}
						<div class="flex items-center gap-2">
							<span
								class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
								aria-label="Overrides active"
							>
								{Object.keys(overrides).length} override{Object.keys(overrides).length === 1 ? '' : 's'}
							</span>
							{#if onOverrideResetAll}
								<button
									type="button"
									class="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900/70"
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
									? 'border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/20'
									: ''}"
							>
								<CustomFormatBadge
									name={contribution.cfName}
									score={contribution.score}
								/>
								<div class="flex items-center gap-2">
									{#if editingCfName === contribution.cfName}
										<div class="w-28">
											<NumberInput
												name="override-{contribution.cfName}"
												value={contribution.score}
												step={1}
												compact
												font="mono"
												on:keydown={handleOverrideKeydown}
												onchange={(value) => handleOverrideInput(contribution.cfName, value)}
												on:change={(event) => handleOverrideChangeEvent(contribution.cfName, event)}
											/>
										</div>
									{:else}
										<button
											type="button"
											class="rounded px-1 py-0.5 text-left transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 dark:hover:bg-neutral-800"
											on:click={() => startEditing(contribution.cfName)}
										>
											<Score score={contribution.score} size="sm" />
										</button>
									{/if}

									{#if hasOverride}
										<span class="text-xs font-mono text-neutral-500 line-through dark:text-neutral-400">
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
												class="inline-flex items-center rounded border border-amber-300 bg-white p-1 text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900/70"
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
