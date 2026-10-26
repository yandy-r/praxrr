<script lang="ts">
  import { Binoculars } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';
  import Dropdown from '$ui/dropdown/Dropdown.svelte';
  import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
  import { uniqueId } from '$lib/client/utils/uniqueId';

  export let options: { key: string; label: string; enabled: boolean }[] = [];

  const dispatch = createEventDispatcher<{ change: { key: string; enabled: boolean }[] }>();

  function toggleOption(key: string) {
    options = options.map((opt) => (opt.key === key ? { ...opt, enabled: !opt.enabled } : opt));
    dispatch('change', options);
  }

  $: enabledCount = options.filter((o) => o.enabled).length;

  const searchInHeaderId = uniqueId('search-in-header');
</script>

<ActionButton icon={Binoculars} hasDropdown square label="Choose search filters" dropdownPosition="right">
  <svelte:fragment slot="dropdown" let:dropdownPosition let:close>
    <Dropdown position={dropdownPosition} minWidth="12rem" role="menu" label="Choose search filters" onClose={close}>
      <div role="group" aria-labelledby={searchInHeaderId}>
        <div id={searchInHeaderId} class="px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Search in...
        </div>
        {#each options as option (option.key)}
          <DropdownItem
            label={option.label}
            role="menuitemcheckbox"
            selected={option.enabled}
            on:click={() => toggleOption(option.key)}
          />
        {/each}
      </div>
    </Dropdown>
  </svelte:fragment>
  {#if enabledCount < options.length}
    <span
      aria-hidden="true"
      class="bg-accent-600 absolute top-4 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
    >
      {enabledCount}
    </span>
  {/if}
</ActionButton>
