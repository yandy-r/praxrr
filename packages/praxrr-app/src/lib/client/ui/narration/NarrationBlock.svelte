<script lang="ts">
  import type { NarrationLine, NarrationTone } from '$shared/narration/index.ts';

  /**
   * Dumb presentational renderer for a single {@link NarrationLine}. The headline always shows;
   * detail lines show only when `verbose` and the line has any. Tone comes off `line.tone` — no
   * separate tone prop — and the host owns the verbose toggle. This component computes nothing.
   */
  export let line: NarrationLine;
  export let verbose = false;

  const TONE_CLASS: Record<NarrationTone, string> = {
    neutral: 'text-neutral-700 dark:text-neutral-300',
    info: 'text-accent-700 dark:text-accent-400',
    warning: 'text-amber-800 dark:text-amber-300',
    danger: 'text-red-800 dark:text-red-300',
  };

  $: toneClass = TONE_CLASS[line.tone];
  $: showDetail = verbose && line.detail.length > 0;
</script>

<div class="space-y-1 text-sm {toneClass}">
  <p class="font-medium">{line.headline}</p>
  {#if showDetail}
    <ul class="list-disc space-y-0.5 pl-5 text-xs opacity-90">
      {#each line.detail as detail}
        <li>{detail}</li>
      {/each}
    </ul>
  {/if}
</div>
