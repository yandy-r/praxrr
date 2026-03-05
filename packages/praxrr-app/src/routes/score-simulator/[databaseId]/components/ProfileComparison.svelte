<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { ChevronDown, X } from 'lucide-svelte';
  import { clickOutside } from '$lib/client/utils/clickOutside';
  import Dropdown from '$ui/dropdown/Dropdown.svelte';
  import DropdownItem from '$ui/dropdown/DropdownItem.svelte';

  interface QualityProfileOption {
    id: number;
    name: string;
    value: string;
    displayName?: string;
  }

  interface ProfileComparisonEvents {
    comparisonProfileChange: { profileName: string | null };
  }

  export let qualityProfiles: QualityProfileOption[];
  export let primaryProfileName: string | null;
  export let comparisonProfileName: string | null = null;
  export let disabled: boolean = false;

  const dispatch = createEventDispatcher<ProfileComparisonEvents>();

  let dropdownOpen = false;

  $: isDisabled = disabled || !primaryProfileName;
  $: selectedLabel =
    qualityProfiles.find((p) => p.value === comparisonProfileName)?.displayName ??
    qualityProfiles.find((p) => p.value === comparisonProfileName)?.name ??
    null;

  function selectProfile(profileName: string | null) {
    comparisonProfileName = profileName;
    dropdownOpen = false;
    dispatch('comparisonProfileChange', { profileName });
  }

  function clearComparison() {
    selectProfile(null);
  }
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Compare With</p>
  <div class="flex items-center gap-2">
    <div class="relative flex-1" use:clickOutside={() => (dropdownOpen = false)}>
      <button
        type="button"
        class="inline-flex w-full items-center justify-between rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 {isDisabled
          ? 'text-neutral-400 dark:text-neutral-500'
          : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
        disabled={isDisabled}
        on:click={() => (dropdownOpen = !dropdownOpen)}
      >
        <span class={comparisonProfileName ? '' : 'text-neutral-400 dark:text-neutral-500'}>
          {selectedLabel ?? 'Select comparison profile...'}
        </span>
        <ChevronDown size={14} class="text-neutral-500 dark:text-neutral-400" />
      </button>

      {#if dropdownOpen}
        <Dropdown position="left" minWidth="100%">
          <div class="max-h-80 overflow-y-auto py-1">
            {#each qualityProfiles as profile (profile.id)}
              <DropdownItem
                label={profile.displayName ?? profile.name}
                selected={comparisonProfileName === profile.value}
                onSelect={() => selectProfile(profile.value)}
              />
            {/each}
          </div>
        </Dropdown>
      {/if}
    </div>

    {#if comparisonProfileName}
      <button
        type="button"
        class="inline-flex items-center justify-center rounded-lg border border-neutral-300 p-2 text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        title="Clear comparison"
        on:click={clearComparison}
      >
        <X size={14} />
      </button>
    {/if}
  </div>

  {#if isDisabled && !primaryProfileName}
    <p class="text-xs text-neutral-400 dark:text-neutral-500">Select a primary profile first.</p>
  {/if}
</div>
