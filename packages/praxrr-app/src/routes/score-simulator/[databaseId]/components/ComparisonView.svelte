<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Score from '$ui/arr/Score.svelte';
  import CustomFormatBadge from '$ui/arr/CustomFormatBadge.svelte';
  import type { ComparisonResult } from '../helpers.ts';

  export let comparisonResult: ComparisonResult | null = null;
  export let profileALabel: string;
  export let profileBLabel: string;

  let isMobile = false;
  let activeTab: 'a' | 'b' = 'a';
  let mediaQuery: MediaQueryList | null = null;

  function handleMediaChange(event: MediaQueryListEvent | MediaQueryList) {
    isMobile = event.matches;
  }

  onMount(() => {
    mediaQuery = window.matchMedia('(max-width: 767px)');
    isMobile = mediaQuery.matches;
    mediaQuery.addEventListener('change', handleMediaChange);
  });

  onDestroy(() => {
    if (mediaQuery) {
      mediaQuery.removeEventListener('change', handleMediaChange);
    }
  });

  function deltaColorClass(delta: number): string {
    if (delta > 0) return 'text-emerald-600 dark:text-emerald-400';
    if (delta < 0) return 'text-red-600 dark:text-red-400';
    return 'text-neutral-500';
  }

  function formatDelta(delta: number): string {
    if (delta > 0) return `+${delta.toLocaleString()}`;
    return delta.toLocaleString();
  }

  $: sortedContributions = comparisonResult
    ? [...comparisonResult.contributions].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    : [];
</script>

{#if comparisonResult}
  <div class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
    <div class="space-y-4">
      <!-- Delta Summary -->
      <div
        class="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3 dark:border-neutral-800"
        aria-live="polite"
      >
        <div>
          <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Score Difference</div>
          <div class="mt-1">
            <span class="font-mono text-lg font-semibold {deltaColorClass(comparisonResult.totalDelta)}">
              {formatDelta(comparisonResult.totalDelta)}
            </span>
          </div>
        </div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400">
          {profileALabel}
          <span class="font-mono font-medium text-neutral-700 dark:text-neutral-300">
            {comparisonResult.profileATotal.toLocaleString()}
          </span>
          vs
          {profileBLabel}
          <span class="font-mono font-medium text-neutral-700 dark:text-neutral-300">
            {comparisonResult.profileBTotal.toLocaleString()}
          </span>
        </div>
      </div>

      <!-- Mobile Tab Switcher -->
      {#if isMobile}
        <div class="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors {activeTab === 'a'
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
              : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'}"
            on:click={() => (activeTab = 'a')}
          >
            {profileALabel}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors {activeTab === 'b'
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
              : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'}"
            on:click={() => (activeTab = 'b')}
          >
            {profileBLabel}
          </button>
        </div>
      {/if}

      <!-- Desktop: Side-by-side / Mobile: Tabbed content -->
      {#if !isMobile}
        <!-- Desktop Side-by-Side Headers -->
        <div
          class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
        >
          <span>Custom Format</span>
          <span class="w-20 text-right">{profileALabel}</span>
          <span class="w-20 text-right">{profileBLabel}</span>
          <span class="w-20 text-right">Delta</span>
        </div>

        {#if sortedContributions.length === 0}
          <div class="text-sm text-neutral-500 dark:text-neutral-400">No contributions to compare.</div>
        {:else}
          <ul class="space-y-1">
            {#each sortedContributions as row (row.cfName)}
              <li
                class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 rounded-md px-2.5 py-2 {row.delta !== 0
                  ? 'border-l-2 border-accent-500'
                  : 'border-l-2 border-transparent'}"
              >
                <CustomFormatBadge name={row.cfName} score={row.scoreA} />
                <span class="w-20 text-right">
                  <Score score={row.scoreA} size="sm" />
                </span>
                <span class="w-20 text-right">
                  <Score score={row.scoreB} size="sm" />
                </span>
                <span class="w-20 text-right">
                  <span class="font-mono text-xs font-medium {deltaColorClass(row.delta)}">
                    {formatDelta(row.delta)}
                  </span>
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <!-- Mobile Tabbed View -->
        {#if sortedContributions.length === 0}
          <div class="text-sm text-neutral-500 dark:text-neutral-400">No contributions to compare.</div>
        {:else}
          <ul class="space-y-1">
            {#each sortedContributions as row (row.cfName)}
              <li
                class="flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 {row.delta !== 0
                  ? 'border-l-2 border-l-accent-500 border-neutral-200 dark:border-neutral-800'
                  : 'border-neutral-200 dark:border-neutral-800'}"
              >
                <div class="flex-1 min-w-0">
                  <CustomFormatBadge name={row.cfName} score={activeTab === 'a' ? row.scoreA : row.scoreB} />
                </div>
                <div class="flex items-center gap-3">
                  <Score score={activeTab === 'a' ? row.scoreA : row.scoreB} size="sm" />
                  <span class="font-mono text-xs font-medium {deltaColorClass(row.delta)}">
                    {formatDelta(row.delta)}
                  </span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
{/if}
