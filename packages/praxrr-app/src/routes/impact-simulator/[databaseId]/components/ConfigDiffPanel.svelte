<script lang="ts">
  import { ArrowRight, GitCompare } from 'lucide-svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import type { components } from '$api/v1.d.ts';

  type EntityConfigDiff = components['schemas']['EntityConfigDiff'];
  type FieldChange = components['schemas']['FieldChange'];

  export let configDiff: EntityConfigDiff[] = [];

  $: entriesWithChanges = configDiff.filter((entry) => entry.changes.length > 0);

  function formatValue(value: FieldChange['current']): string {
    if (value === null || value === undefined) {
      return '—';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }
</script>

{#if entriesWithChanges.length > 0}
  <div class="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
    <div class="flex items-center gap-2">
      <GitCompare size={16} class="text-neutral-500 dark:text-neutral-400" />
      <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Config diff</h3>
    </div>
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      Current vs proposed profile configuration (parser-independent).
    </p>
    <div class="space-y-3">
      {#each entriesWithChanges as entry (entry.name + entry.arrType)}
        <div class="rounded-md border border-neutral-200 dark:border-neutral-800">
          <div class="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{entry.name}</span>
            <Badge variant={entry.arrType === 'radarr' ? 'radarr' : 'sonarr'} size="sm">{entry.arrType}</Badge>
          </div>
          <div class="divide-y divide-neutral-100 dark:divide-neutral-800">
            {#each entry.changes as change (change.field)}
              <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 text-xs">
                <span class="truncate font-mono text-neutral-600 dark:text-neutral-300" title={change.field}>
                  {change.field}
                </span>
                <span class="flex items-center gap-1.5 justify-self-center text-neutral-500 dark:text-neutral-400">
                  <span class="font-mono text-red-600 dark:text-red-400">{formatValue(change.current)}</span>
                  <ArrowRight size={12} />
                  <span class="font-mono text-emerald-600 dark:text-emerald-400">{formatValue(change.desired)}</span>
                </span>
                <span></span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}
