<script lang="ts" context="module">
  let autoSectionCounter = 0;

  function nextAutoSectionId() {
    autoSectionCounter += 1;
    return `advanced-section-${autoSectionCounter}`;
  }

  function createDefaultSectionId(): string {
    return nextAutoSectionId();
  }
</script>

<script lang="ts">
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { ChevronDown } from 'lucide-svelte';
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import type { UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';

  export let sectionId: string = '';
  export let sectionTitle = 'Advanced settings';
  export let sectionHint = 'These options are hidden by default and are optional.';
  export let showAdvancedLabel = 'Show Advanced';
  export let hideAdvancedLabel = 'Hide Advanced';
  export let mode: UiPreferenceMode = 'basic';

  const fallbackSectionId = createDefaultSectionId();
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const slideDuration = reducedMotion ? 0 : 200;

  $: resolvedSectionId = sectionId ? sectionId : fallbackSectionId;
  $: advancedPanelId = `${resolvedSectionId}-panel`;
  $: advancedHeadingId = `${resolvedSectionId}-heading`;
  $: isAdvanced = mode === 'advanced';
  $: toggleLabel = isAdvanced ? hideAdvancedLabel : showAdvancedLabel;
  $: toggleAriaLabel = isAdvanced ? hideAdvancedLabel : showAdvancedLabel;

  function toggleMode() {
    mode = isAdvanced ? 'basic' : 'advanced';
  }
</script>

<div class="space-y-3">
  <div class="rounded-xl border border-neutral-300 bg-white px-4 py-4 dark:border-neutral-700/60 dark:bg-neutral-900">
    <slot />
  </div>

  <div
    class="rounded-xl border border-neutral-300 bg-neutral-50 dark:border-neutral-700/60 dark:bg-neutral-900/50"
  >
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-neutral-200 bg-white px-4 py-2.5 dark:border-neutral-700/60 dark:bg-neutral-950/40"
    >
      <div class="min-w-0">
        <p id={advancedHeadingId} class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {sectionTitle}
        </p>
        {#if sectionHint}
          <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{sectionHint}</p>
        {/if}
      </div>
      <ActionsBar className="w-auto">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700/60 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          aria-expanded={isAdvanced}
          aria-controls={advancedPanelId}
          aria-label={toggleAriaLabel}
          onclick={toggleMode}
        >
          <ChevronDown
            size={14}
            class="transition-transform duration-200 ease-in-out {isAdvanced ? 'rotate-180' : 'rotate-0'}"
          />
          {toggleLabel}
        </button>
      </ActionsBar>
    </div>

    {#if isAdvanced}
      <div
        id={advancedPanelId}
        role="region"
        aria-labelledby={advancedHeadingId}
        class="px-4 pb-4 pt-3"
        transition:slide={{ duration: slideDuration, easing: quintOut }}
      >
        <slot name="advanced">
          <p class="text-sm text-neutral-500 dark:text-neutral-400">No advanced options available for this section.</p>
        </slot>
      </div>
    {/if}
  </div>
</div>
