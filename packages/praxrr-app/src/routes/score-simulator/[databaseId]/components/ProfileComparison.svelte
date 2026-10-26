<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { ChevronDown, X } from 'lucide-svelte';
  import { clickOutside } from '$lib/client/utils/clickOutside';
  import { focusOutside } from '$lib/client/utils/focusOutside';
  import { uniqueId } from '$lib/client/utils/uniqueId';
  import Dropdown from '$ui/dropdown/Dropdown.svelte';
  import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
  import type { SimulatorProfileOption } from '../helpers.ts';

  interface ProfileComparisonEvents {
    comparisonProfileChange: { profileName: string | null };
  }

  export let qualityProfiles: SimulatorProfileOption[];
  export let primaryProfileName: string | null;
  export let comparisonProfileName: string | null = null;
  export let disabled: boolean = false;

  const dispatch = createEventDispatcher<ProfileComparisonEvents>();

  let dropdownOpen = false;
  const dropdownId = uniqueId('comparison-profile-dropdown');
  let triggerEl: HTMLButtonElement | undefined;

  $: isDisabled = disabled || !primaryProfileName;
  $: selectedLabel =
    qualityProfiles.find((p) => p.value === comparisonProfileName)?.displayName ??
    qualityProfiles.find((p) => p.value === comparisonProfileName)?.name ??
    null;

  function closeDropdown() {
    if (!dropdownOpen) return;
    dropdownOpen = false;
    triggerEl?.focus();
  }

  async function toggleDropdown(event: MouseEvent) {
    if (isDisabled) return;
    dropdownOpen = !dropdownOpen;
    if (dropdownOpen && event.detail === 0) {
      await tick();
      document.getElementById(dropdownId)?.querySelector<HTMLElement>('[role="option"]')?.focus();
    }
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && dropdownOpen) {
      event.preventDefault();
      closeDropdown();
    }
  }

  function selectProfile(profileName: string | null) {
    comparisonProfileName = profileName;
    closeDropdown();
    dispatch('comparisonProfileChange', { profileName });
  }

  function clearComparison() {
    comparisonProfileName = null;
    dispatch('comparisonProfileChange', { profileName: null });
    triggerEl?.focus();
  }
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Compare With</p>
  <div class="flex items-center gap-2">
    <div
      class="relative flex-1"
      use:clickOutside={() => (dropdownOpen = false)}
      use:focusOutside={() => (dropdownOpen = false)}
    >
      <button
        type="button"
        class="inline-flex w-full items-center justify-between rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 {isDisabled
          ? 'text-neutral-400 dark:text-neutral-500'
          : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-700'}"
        bind:this={triggerEl}
        disabled={isDisabled}
        aria-haspopup="listbox"
        aria-expanded={dropdownOpen}
        aria-controls={dropdownId}
        on:click={toggleDropdown}
        on:keydown={handleTriggerKeydown}
      >
        <span class={comparisonProfileName ? '' : 'text-neutral-400 dark:text-neutral-500'}>
          {selectedLabel ?? 'Select comparison profile...'}
        </span>
        <ChevronDown size={14} class="text-neutral-500 dark:text-neutral-400" />
      </button>

      {#if dropdownOpen}
        <Dropdown
          id={dropdownId}
          role="listbox"
          label="Comparison profile"
          onClose={closeDropdown}
          position="left"
          minWidth="100%"
        >
          <div class="max-h-80 overflow-y-auto py-1">
            {#each qualityProfiles as profile (profile.id)}
              <DropdownItem
                label={profile.displayName ?? profile.name}
                role="option"
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
