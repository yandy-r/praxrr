<script lang="ts">
  import { tick } from 'svelte';
  import { uniqueId } from '$lib/client/utils/uniqueId';
  import { focusOutside } from '$lib/client/utils/focusOutside';
  import { accentStore, accentColors, type AccentColor } from '$stores/accent';
  import Dropdown from '$ui/dropdown/Dropdown.svelte';
  import { Check } from 'lucide-svelte';

  let open = false;
  let triggerEl: HTMLElement;
  const dropdownId = uniqueId('accent-menu');

  function closeDropdown() {
    open = false;
    triggerEl?.focus();
  }

  async function toggleDropdown(event: MouseEvent) {
    open = !open;
    if (open && event.detail === 0) {
      await tick();
      document.getElementById(dropdownId)?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
    }
  }

  $: currentColor = accentColors.find((c) => c.value === $accentStore) ?? accentColors[0];

  function select(accent: AccentColor) {
    accentStore.set(accent);
    closeDropdown();
  }

  function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.accent-picker')) {
      open = false;
    }
  }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="accent-picker relative" use:focusOutside={() => (open = false)}>
  <button
    type="button"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={dropdownId}
    bind:this={triggerEl}
    on:click|stopPropagation={toggleDropdown}
    on:keydown={(event) => {
      if (open && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeDropdown();
      }
    }}
    class="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-800"
    aria-label="Select accent color"
  >
    <span class="h-4 w-4 rounded-full" style="background-color: {currentColor.color}"></span>
  </button>

  {#if open}
    <Dropdown
      id={dropdownId}
      label="Accent colors"
      onClose={closeDropdown}
      position="middle"
      minWidth="auto"
      fixed={true}
      {triggerEl}
    >
      <div class="flex flex-col gap-2 p-2">
        {#each accentColors as accent}
          <button
            tabindex="-1"
            type="button"
            role="menuitemradio"
            aria-checked={$accentStore === accent.value}
            on:click|stopPropagation={() => select(accent.value)}
            class="relative flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
            style="background-color: {accent.color}"
            aria-label={accent.label}
          >
            {#if $accentStore === accent.value}
              <Check size={14} class="text-white" />
            {/if}
          </button>
        {/each}
      </div>
    </Dropdown>
  {/if}
</div>
