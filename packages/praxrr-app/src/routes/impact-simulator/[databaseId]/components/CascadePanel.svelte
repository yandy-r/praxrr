<script lang="ts">
  import { Network } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import type { components } from '$api/v1.d.ts';

  type CascadeWarning = components['schemas']['CascadeWarning'];

  export let cascade: CascadeWarning[] = [];

  function totalFor(warning: CascadeWarning): number {
    return warning.counts.total ?? 0;
  }

  function arrBreakdown(warning: CascadeWarning): Array<{ arrType: string; count: number }> {
    return Object.entries(warning.byArrType).map(([arrType, count]) => ({ arrType, count }));
  }
</script>

{#if cascade.length > 0}
  <div class="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
    <div class="flex items-center gap-2">
      <Network size={16} class="text-neutral-500 dark:text-neutral-400" />
      <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Cascade impact</h3>
    </div>
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      Entities that reference the edited custom formats in your current configuration.
    </p>
    <ul class="space-y-2">
      {#each cascade as warning (warning.name + warning.arrType)}
        <li class="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{warning.name}</span>
            <span class="text-xs text-neutral-500 dark:text-neutral-400">
              affects {warning.truncated ? 'at least ' : ''}{totalFor(warning)} related
              {totalFor(warning) === 1 ? 'entity' : 'entities'}
            </span>
          </div>
          {#if arrBreakdown(warning).length > 0}
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#each arrBreakdown(warning) as entry (entry.arrType)}
                <Badge variant="neutral" size="sm">{entry.arrType}: {entry.count}</Badge>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}
