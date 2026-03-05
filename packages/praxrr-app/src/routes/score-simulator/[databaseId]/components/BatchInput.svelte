<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { AlertTriangle, Loader2, Play, Copy } from 'lucide-svelte';

  interface BatchInputEvents {
    batchSimulate: { titles: string[] };
    titlesChange: { rawText: string };
  }

  export let rawText: string;
  export let isSimulating: boolean;
  export let parserAvailable: boolean;

  const dispatch = createEventDispatcher<BatchInputEvents>();

  const MAX_TITLES = 50;
  const MAX_TITLE_LENGTH = 500;

  $: lines = rawText.split('\n').filter((line) => line.trim().length > 0);
  $: validLines = lines.filter((line) => line.trim().length <= MAX_TITLE_LENGTH);
  $: lineCount = validLines.length;
  $: overLimit = lineCount > MAX_TITLES;
  $: duplicateSet = findDuplicates(lines);
  $: hasValidTitles = lineCount > 0;

  function findDuplicates(titleLines: string[]): Set<string> {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const line of titleLines) {
      const trimmed = line.trim().toLowerCase();
      if (!trimmed) continue;
      if (seen.has(trimmed)) {
        dupes.add(trimmed);
      }
      seen.add(trimmed);
    }
    return dupes;
  }

  $: longLines = lines.filter((line) => line.trim().length > MAX_TITLE_LENGTH);
  $: hasDuplicates = duplicateSet.size > 0;
  $: hasLongLines = longLines.length > 0;

  function handleInput(event: Event) {
    rawText = (event.currentTarget as HTMLTextAreaElement).value;
    dispatch('titlesChange', { rawText });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      triggerSimulate();
    }
  }

  function triggerSimulate() {
    if (!hasValidTitles || isSimulating) return;
    const titles = validLines.map((line) => line.trim()).slice(0, MAX_TITLES);
    dispatch('batchSimulate', { titles });
  }
</script>

<div class="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
  <div class="space-y-1">
    <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Batch Input</h2>
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      Enter one release title per line (up to {MAX_TITLES}). Press Ctrl+Enter to simulate.
    </p>
  </div>

  {#if !parserAvailable}
    <div
      class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200"
    >
      <AlertTriangle size={14} class="mt-0.5 shrink-0" />
      <p>Parser service unavailable. Batch simulation requires the parser to evaluate release titles.</p>
    </div>
  {/if}

  <div class="space-y-1.5">
    <div class="flex items-center justify-between">
      <label for="batch-input-textarea" class="text-xs font-medium text-neutral-700 dark:text-neutral-300">
        Release Titles
      </label>
      <span
        class="text-xs {overLimit
          ? 'font-medium text-amber-600 dark:text-amber-400'
          : 'text-neutral-500 dark:text-neutral-400'}"
        aria-live="polite"
      >
        {lineCount} / {MAX_TITLES} titles
      </span>
    </div>
    <textarea
      id="batch-input-textarea"
      class="focus:border-accent-500 dark:focus:border-accent-400 h-48 w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs text-neutral-900 transition-colors outline-none placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      placeholder="Movie.2024.2160p.WEB-DL.DDP5.1.H.265-GROUP&#10;Movie.2024.1080p.BluRay.x264.DTS-GROUP&#10;Movie.2024.720p.WEBRip.x265-GROUP"
      value={rawText}
      on:input={handleInput}
      on:keydown={handleKeydown}
    ></textarea>
  </div>

  {#if hasLongLines}
    <div
      class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200"
    >
      <AlertTriangle size={14} class="mt-0.5 shrink-0" />
      <p>
        {longLines.length} line{longLines.length > 1 ? 's' : ''} exceed {MAX_TITLE_LENGTH} characters and will be skipped.
      </p>
    </div>
  {/if}

  {#if hasDuplicates}
    <div
      class="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-700/60 dark:bg-blue-900/30 dark:text-blue-200"
    >
      <Copy size={14} class="mt-0.5 shrink-0" />
      <p>
        {duplicateSet.size} duplicate title{duplicateSet.size > 1 ? 's' : ''} detected. Duplicates will be included in results.
      </p>
    </div>
  {/if}

  <div class="flex items-center justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      disabled={!hasValidTitles || isSimulating}
      on:click={triggerSimulate}
    >
      {#if isSimulating}
        <Loader2 size={14} class="animate-spin" />
        Simulating...
      {:else}
        <Play size={14} />
        Simulate All
      {/if}
    </button>
  </div>
</div>
