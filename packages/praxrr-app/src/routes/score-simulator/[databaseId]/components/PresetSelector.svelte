<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { BookOpen, ChevronDown } from 'lucide-svelte';
  import { clickOutside } from '$lib/client/utils/clickOutside';
  import Dropdown from '$ui/dropdown/Dropdown.svelte';
  import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
  import { getPresetsForCategory } from '../presets.ts';
  import type { PresetCategory } from '../helpers.ts';

  type MediaType = 'movie' | 'series';

  interface PresetSelectorEvents {
    presetSelected: { titles: string[]; category: PresetCategory; mediaType: MediaType };
  }

  export let mediaType: MediaType;
  export let compact: boolean = false;

  const dispatch = createEventDispatcher<PresetSelectorEvents>();

  let dropdownOpen = false;

  $: category = mediaType as PresetCategory;
  $: presetGroups = getPresetsForCategory(category);

  function selectPreset(group: { label: string; titles: Array<{ label: string; title: string }> }) {
    const titles = group.titles.map((t) => t.title);
    dispatch('presetSelected', { titles, category, mediaType });
    dropdownOpen = false;
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
          <DropdownItem label="{group.titles.length} titles — Load all" compact on:click={() => selectPreset(group)} />
        {/each}
      </div>
    </Dropdown>
  {/if}
</div>
