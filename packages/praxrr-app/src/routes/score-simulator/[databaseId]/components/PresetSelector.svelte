<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { BookOpen, ChevronDown } from 'lucide-svelte';
  import { clickOutside } from '$lib/client/utils/clickOutside';
  import Dropdown from '$ui/dropdown/Dropdown.svelte';
  import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
  import { getPresetsForCategory } from '../presets.ts';
  import type { PresetCategory } from '../helpers.ts';

  interface PresetSelectorEvents {
    presetSelected: { titles: string[]; category: PresetCategory };
  }

  export let sampleCategory: PresetCategory;
  export let compact: boolean = false;

  const dispatch = createEventDispatcher<PresetSelectorEvents>();

  let dropdownOpen = false;
  let selectedCategory: PresetCategory = sampleCategory;

  $: if (!dropdownOpen) {
    selectedCategory = sampleCategory;
  }
  $: presetGroups = getPresetsForCategory(selectedCategory);

  function selectPreset(group: { label: string; titles: Array<{ label: string; title: string }> }) {
    const titles = group.titles.map((t) => t.title);
    dispatch('presetSelected', { titles, category: selectedCategory });
    dropdownOpen = false;
  }

  function setCategory(category: PresetCategory) {
    selectedCategory = category;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      dropdownOpen = false;
    }
  }
</script>

<div class="relative" use:clickOutside={() => (dropdownOpen = false)}>
  {#if compact}
    <button
      type="button"
      class="inline-flex items-center justify-center rounded-lg border border-neutral-300 p-2 text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      title="Try Examples"
      on:click={() => (dropdownOpen = !dropdownOpen)}
      on:keydown={handleKeydown}
    >
      <BookOpen size={14} />
    </button>
  {:else}
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      on:click={() => (dropdownOpen = !dropdownOpen)}
      on:keydown={handleKeydown}
    >
      <BookOpen size={14} />
      Try Examples
      <ChevronDown size={12} class="text-neutral-500 dark:text-neutral-400" />
    </button>
  {/if}

  {#if dropdownOpen}
    <Dropdown position="left" minWidth="16rem">
      <div class="max-h-80 overflow-y-auto py-1" role="menu" tabindex="-1" on:keydown={handleKeydown}>
        <div class="px-3 pt-2 pb-1">
          <p class="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            Media Type
          </p>
          <div class="mt-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              class="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors {selectedCategory === 'movie'
                ? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
                : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
              on:click={() => setCategory('movie')}
            >
              Movie
            </button>
            <button
              type="button"
              class="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors {selectedCategory ===
              'series'
                ? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
                : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
              on:click={() => setCategory('series')}
            >
              Series
            </button>
            <button
              type="button"
              class="col-span-2 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors {selectedCategory ===
              'anime'
                ? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
                : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
              on:click={() => setCategory('anime')}
            >
              Anime
            </button>
          </div>
        </div>
        <div class="mt-1 border-t border-neutral-200 dark:border-neutral-700"></div>

        {#each presetGroups as group (group.label)}
          <div class="px-3 pt-2.5 pb-0.5">
            <p class="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
              {group.label}
            </p>
            {#if group.description}
              <p class="text-[10px] text-neutral-500 dark:text-neutral-400">
                {group.description}
              </p>
            {/if}
          </div>
          <DropdownItem
            label={`${group.titles.length} titles - Load all`}
            compact
            onSelect={() => selectPreset(group)}
          />
        {/each}

        {#if presetGroups.length === 0}
          <p class="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">
            No sample groups available for this media type.
          </p>
        {/if}
      </div>
    </Dropdown>
  {/if}
</div>
