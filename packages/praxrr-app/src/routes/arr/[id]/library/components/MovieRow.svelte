<script lang="ts">
  import { Check, CircleAlert } from 'lucide-svelte';
  import Score from '$ui/arr/Score.svelte';
  import CustomFormatBadge from '$ui/arr/CustomFormatBadge.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import type { RadarrLibraryItem } from '$utils/arr/types.ts';
  import type { Column } from '$ui/table/types';

  export let row: RadarrLibraryItem;
  export let column: Column<RadarrLibraryItem>;
  export let mode: 'cell' | 'expanded' = 'cell';

  function getProgressColor(progress: number, cutoffMet: boolean): string {
    if (cutoffMet) return 'bg-green-500 dark:bg-green-400';
    if (progress >= 0.75) return 'bg-yellow-500 dark:bg-yellow-400';
    if (progress >= 0.5) return 'bg-orange-500 dark:bg-orange-400';
    return 'bg-red-500 dark:bg-red-400';
  }

  function formatDate(isoString?: string): string {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }
</script>

{#if mode === 'cell'}
  {#if column.key === 'title'}
    <div>
      <div class="font-medium text-neutral-900 dark:text-neutral-50">{row.title}</div>
      {#if row.year}
        <div class="text-xs text-neutral-500 dark:text-neutral-400">{row.year}</div>
      {/if}
    </div>
  {:else if column.key === 'qualityProfileName'}
    <div class="group relative inline-flex">
      <Badge variant={row.isPraxrrProfile ? 'accent' : 'warning'} icon={row.isPraxrrProfile ? null : CircleAlert} mono>
        {row.qualityProfileName}
      </Badge>
      {#if !row.isPraxrrProfile}
        <div
          class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded bg-neutral-800 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 group-hover:opacity-100 dark:bg-neutral-700"
        >
          Not managed by Praxrr
        </div>
      {/if}
    </div>
  {:else if column.key === 'qualityName'}
    <Badge variant="neutral" mono>{row.qualityName ?? 'N/A'}</Badge>
  {:else if column.key === 'customFormatScore'}
    <div class="text-right">
      <Score score={row.customFormatScore} showSign={false} colored={false} />
      <span class="text-xs text-neutral-500 dark:text-neutral-400">
        / {row.cutoffScore.toLocaleString()}
      </span>
    </div>
  {:else if column.key === 'progress'}
    <div class="flex items-center gap-2">
      <div class="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          class="h-full rounded-full transition-all {getProgressColor(row.progress, row.cutoffMet)}"
          style="width: {Math.min(row.progress * 100, 100)}%"
        ></div>
      </div>
      {#if row.cutoffMet}
        <Check size={16} class="flex-shrink-0 text-green-600 dark:text-green-400" />
      {:else}
        <span class="w-10 text-right font-mono text-xs text-neutral-500 dark:text-neutral-400">
          {Math.round(row.progress * 100)}%
        </span>
      {/if}
    </div>
  {:else if column.key === 'popularity'}
    <Badge variant="neutral" mono>{row.popularity?.toFixed(1) ?? '-'}</Badge>
  {:else if column.key === 'dateAdded'}
    <Badge variant="neutral" mono>{formatDate(row.dateAdded)}</Badge>
  {/if}
{:else}
  <!-- Expanded content -->
  <div class="flex flex-col gap-3 p-4">
    <!-- File Name -->
    {#if row.fileName}
      <code class="font-mono text-xs break-all text-neutral-600 dark:text-neutral-400">{row.fileName}</code>
    {/if}

    <!-- Custom Formats with Scores (sorted by score descending) -->
    {#if row.scoreBreakdown.length > 0}
      <div class="flex flex-wrap items-center gap-2">
        {#each [...row.scoreBreakdown].sort((a, b) => b.score - a.score) as item}
          <CustomFormatBadge name={item.name} score={item.score} />
        {/each}
      </div>
    {:else}
      <div class="text-xs text-neutral-500 dark:text-neutral-400">No custom formats matched</div>
    {/if}
  </div>
{/if}
