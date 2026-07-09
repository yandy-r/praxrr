<script lang="ts">
  import Card from '$ui/card/Card.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import type { components } from '$api/v1.d.ts';

  type GoalPlan = components['schemas']['GoalPlan'];
  type GoalCfDecision = components['schemas']['GoalCfDecision'];

  export let plan: GoalPlan;
  /** Count of field changes the sandbox diff reports (what apply would write). */
  export let changeCount: number = 0;

  const CATEGORY_LABELS: Record<string, string> = {
    unwanted: 'Unwanted',
    hdr_dv: 'Dolby Vision',
    hdr_hdr10plus: 'HDR10+',
    hdr_baseline: 'HDR',
    remux: 'Remux',
    release_group_tier_1: 'Release Group T1',
    release_group_tier_2: 'Release Group T2',
    release_group_tier_3: 'Release Group T3',
    audio_lossless: 'Lossless Audio',
    audio_advanced: 'Advanced Audio',
    audio_baseline: 'Audio',
    streaming_service: 'Streaming',
    movie_version: 'Edition',
    repack_proper: 'Repack/Proper',
    resolution: 'Resolution',
  };

  function reasonLine(decision: GoalCfDecision): string {
    const reason = decision.reason;
    if (decision.category === 'unwanted') return 'Hard-rejected as an unwanted format';
    if (decision.category === 'resolution' && reason.ceiling) {
      return `${reason.ceiling === 'above' ? 'Above' : reason.ceiling === 'match' ? 'At' : 'Below'} your resolution ceiling`;
    }
    if (reason.ceiling === 'above') return 'Demoted — above your resolution ceiling';
    const parts = [`base ${reason.base >= 0 ? '+' : ''}${reason.base}`];
    for (const contribution of reason.axisContributions) {
      if (contribution.delta === 0) continue;
      parts.push(`${contribution.delta >= 0 ? '+' : ''}${contribution.delta} ${contribution.axis}`);
    }
    return parts.join(', ');
  }

  $: sortedDecisions = [...plan.decisions].sort((a, b) => b.score - a.score);
</script>

<div class="space-y-4">
  <!-- Coverage + thresholds -->
  <div class="grid gap-3 sm:grid-cols-3">
    <Card>
      <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Coverage</p>
      <p class="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
        {plan.coverage.scored} / {plan.coverage.total} scored
      </p>
      {#if plan.coverage.uncategorized > 0}
        <p class="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
          {plan.coverage.uncategorized} left untouched
        </p>
      {/if}
    </Card>
    <Card>
      <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Thresholds</p>
      <p class="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
        min {plan.thresholds.minimumScore} · until {plan.thresholds.upgradeUntilScore}
      </p>
      <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
        increment {plan.thresholds.upgradeScoreIncrement}
      </p>
    </Card>
    <Card>
      <p class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">Changes on apply</p>
      <p class="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-50">{changeCount}</p>
      <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">fields vs current config</p>
    </Card>
  </div>

  <!-- Generated scores (transparency — always shown) -->
  <Card>
    <h3 class="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Generated custom-format scores</h3>
    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="text-xs text-neutral-500 dark:text-neutral-400">
          <tr>
            <th class="pr-3 pb-2 font-medium">Custom format</th>
            <th class="pr-3 pb-2 font-medium">Category</th>
            <th class="pr-3 pb-2 text-right font-medium">Score</th>
            <th class="pb-2 font-medium">Why</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedDecisions as decision (decision.customFormatName)}
            <tr class="border-t border-neutral-100 dark:border-neutral-800">
              <td class="py-1.5 pr-3 font-medium text-neutral-900 dark:text-neutral-100">
                {decision.customFormatName}
              </td>
              <td class="py-1.5 pr-3">
                <Badge variant={decision.category === 'unwanted' ? 'danger' : 'neutral'}>
                  {CATEGORY_LABELS[decision.category] ?? decision.category}
                </Badge>
              </td>
              <td
                class="py-1.5 pr-3 text-right font-mono tabular-nums {decision.score < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-emerald-600 dark:text-emerald-400'}"
              >
                {decision.score}
              </td>
              <td class="py-1.5 text-xs text-neutral-500 dark:text-neutral-400">{reasonLine(decision)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Card>

  <!-- Uncategorized (flagged, never silently mis-scored) -->
  {#if plan.uncategorized.length > 0}
    <Card>
      <h3 class="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Not scored by this goal ({plan.uncategorized.length})
      </h3>
      <p class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
        These custom formats don't map to a goal category, so their existing scores are left untouched.
      </p>
      <div class="flex flex-wrap gap-1.5">
        {#each plan.uncategorized as cf (cf.name)}
          <Badge variant="neutral">{cf.name}</Badge>
        {/each}
      </div>
    </Card>
  {/if}
</div>
