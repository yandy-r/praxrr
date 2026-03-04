<script lang="ts">
  import { onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { ChevronDown } from 'lucide-svelte';
  import { getUserInterfacePreferenceSectionStore, type UiPreferenceMode } from '$stores/userInterfacePreferences';
  import type { SectionKey } from '$shared/disclosure/sectionKeys.ts';

  export let title: string;
  export let description: string = '';
  export let sectionKey: SectionKey | undefined = undefined;
  export let defaultOpen: boolean = true;

  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const slideDuration = reducedMotion ? 0 : 200;

  let isOpen = defaultOpen;

  // Persistence via store when sectionKey is provided
  let sectionStore: ReturnType<typeof getUserInterfacePreferenceSectionStore> | null = null;
  let unsubscribe: (() => void) | null = null;

  if (sectionKey) {
    const defaultMode: UiPreferenceMode = defaultOpen ? 'advanced' : 'basic';
    sectionStore = getUserInterfacePreferenceSectionStore(sectionKey, defaultMode);

    unsubscribe = sectionStore.mode.subscribe((value) => {
      isOpen = value === 'advanced';
    });
  }

  function toggle() {
    isOpen = !isOpen;
    if (sectionStore) {
      sectionStore.mode.set(isOpen ? 'advanced' : 'basic');
    }
  }

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
    if (sectionStore) {
      sectionStore.cleanup();
    }
  });
</script>

<div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
  <button
    type="button"
    class="flex w-full items-center justify-between gap-3 border-b border-neutral-200 px-6 py-4 text-left dark:border-neutral-800"
    aria-expanded={isOpen}
    onclick={toggle}
  >
    <div class="min-w-0">
      <h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">
        {title}
      </h2>
      {#if description}
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
      {/if}
    </div>
    <ChevronDown
      size={20}
      class="shrink-0 text-neutral-400 transition-transform duration-200 ease-in-out dark:text-neutral-500 {isOpen
        ? 'rotate-180'
        : 'rotate-0'}"
    />
  </button>

  {#if isOpen}
    <div class="p-6" transition:slide={{ duration: slideDuration, easing: quintOut }}>
      <slot />
    </div>
  {/if}
</div>
