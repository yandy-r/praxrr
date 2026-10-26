<script lang="ts">
  import ActionButton from './ActionButton.svelte';
  import Dropdown from '$ui/dropdown/Dropdown.svelte';
  import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
  import { Eye, LayoutGrid, Table } from 'lucide-svelte';
  import type { ViewMode } from '$lib/client/stores/dataPage';

  export let value: ViewMode = 'table';
  export let position: 'left' | 'right' | 'middle' = 'right';
</script>

<ActionButton icon={Eye} title="Choose view" hasDropdown={true} dropdownPosition={position}>
  <Dropdown slot="dropdown" label="View" {position}>
    <DropdownItem
      role="menuitemradio"
      icon={LayoutGrid}
      label="Cards"
      selected={value === 'cards'}
      on:click={() => (value = 'cards')}
    />
    <DropdownItem
      role="menuitemradio"
      icon={Table}
      label="Table"
      selected={value === 'table'}
      on:click={() => (value = 'table')}
    />
  </Dropdown>
</ActionButton>
