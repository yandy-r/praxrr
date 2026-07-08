<script lang="ts">
  import { AlertTriangle } from 'lucide-svelte';
  import type { components } from '$api/v1.d.ts';
  import { describeChange } from '../helpers.ts';

  type SkippedChange = components['schemas']['SkippedChange'];

  export let skipped: SkippedChange[] = [];
</script>

{#if skipped.length > 0}
  <div class="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
    <div class="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
      <AlertTriangle size={16} />
      <span>{skipped.length} change{skipped.length > 1 ? 's' : ''} skipped</span>
    </div>
    <ul class="space-y-1.5">
      {#each skipped as entry (describeChange(entry.change) + entry.reason)}
        <li class="text-xs text-amber-800 dark:text-amber-200">
          <span class="font-medium">{describeChange(entry.change)}</span>
          <span class="text-amber-600 dark:text-amber-300"> — {entry.reason}</span>
        </li>
      {/each}
    </ul>
  </div>
{/if}
