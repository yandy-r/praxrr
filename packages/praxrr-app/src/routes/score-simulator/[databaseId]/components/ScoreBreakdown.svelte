<script lang="ts">
	import Score from '$ui/arr/Score.svelte';
	import CustomFormatBadge from '$ui/arr/CustomFormatBadge.svelte';
	import Badge from '$ui/badge/Badge.svelte';
	import type { components } from '$api/v1.d.ts';
	import { resolveScoreThresholdState, sortScoreContributionsByMagnitude, type ScoreThresholdState } from '../helpers.ts';

	type SimulateProfileScore = components['schemas']['SimulateProfileScore'];

	export let profileScore: SimulateProfileScore | null = null;

	let thresholdState: ScoreThresholdState | null = null;

	$: totalScore = profileScore?.totalScore ?? 0;
	$: minimumScore = profileScore?.minimumScore ?? 0;
	$: upgradeUntilScore = profileScore?.upgradeUntilScore ?? 0;

	$: thresholdState = resolveScoreThresholdState(profileScore);
	$: contributions = profileScore ? sortScoreContributionsByMagnitude(profileScore.contributions) : [];

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
		<div class="space-y-4" aria-live="polite">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
						Total Score
					</div>
					<div class="mt-1">
						<Score score={totalScore} size="md" />
					</div>
				</div>
				{#if thresholdState}
					<Badge
						variant={thresholdState === 'below' ? 'danger' : 'success'}
						size="md"
						><span class={thresholdState === 'upgrade-reached' ? 'opacity-70' : ''}>
							{thresholdLabel(thresholdState)}
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
				<div class="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
					Contributions
				</div>
				{#if contributions.length === 0}
					<div class="text-sm text-neutral-500 dark:text-neutral-400">No score contributions.</div>
				{:else}
					<ul class="space-y-2">
						{#each contributions as contribution (contribution.cfName)}
							<li
								class="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-2.5 py-2 dark:border-neutral-800"
							>
								<CustomFormatBadge
									name={contribution.cfName}
									score={contribution.score}
								/>
								<Score score={contribution.score} size="sm" />
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
</div>
