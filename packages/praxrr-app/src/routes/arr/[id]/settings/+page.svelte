<script lang="ts">
  import InstanceForm from '../../components/InstanceForm.svelte';
  import type { ActionData, PageData } from './$types';

  export let form: ActionData;
  export let data: PageData;
</script>

<svelte:head>
  <title>{data.instance.name} - Settings - Praxrr</title>
</svelte:head>

{#if !data.canEditCoreConnectionFields}
  <div
    class="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
  >
    <p class="text-sm font-medium">This instance is managed by environment variables.</p>
    <p class="mt-1 text-sm">
      Connection settings are sourced from startup environment variables and can only be updated there.
      Edit the relevant `*_INSTANCE_*` variables and restart the container to apply changes.
    </p>
  </div>
{/if}

<InstanceForm
  mode="edit"
  {form}
  instance={data.instance}
  canEditCoreConnectionFields={data.canEditCoreConnectionFields}
/>
