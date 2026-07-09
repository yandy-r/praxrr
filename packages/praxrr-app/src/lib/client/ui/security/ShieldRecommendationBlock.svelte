<script lang="ts">
  import NarrationBlock from '$lib/client/ui/narration/NarrationBlock.svelte';
  import ShieldFixControl from './ShieldFixControl.svelte';
  import type { NarrationLine } from '$shared/narration/index.ts';
  import type { WireRecommendation } from '$lib/server/security/responses.ts';

  /**
   * A single shield recommendation: the non-shaming narration line plus its concrete fix. Reuses the
   * shared {@link NarrationBlock} so tone/verbose rendering matches the rest of the app. A
   * warning/danger recommendation always carries a real fix (enforced by the engine), so the fix line
   * is never empty for the findings that matter.
   */
  export let recommendation: WireRecommendation;
  export let verbose = false;

  $: line = {
    headline: recommendation.headline,
    detail: recommendation.detail,
    tone: recommendation.tone,
    templateVersion: recommendation.templateVersion,
  } satisfies NarrationLine;
</script>

<div class="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
  <NarrationBlock {line} {verbose} />
  {#if recommendation.fix.kind !== 'none'}
    <ShieldFixControl fix={recommendation.fix} />
  {/if}
</div>
