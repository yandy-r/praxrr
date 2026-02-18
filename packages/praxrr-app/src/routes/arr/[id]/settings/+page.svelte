<script lang="ts">
  import InstanceForm from '../../components/InstanceForm.svelte';
  import type { ActionData, PageData } from './$types';

  export let form: ActionData;
  export let data: PageData;
</script>

<svelte:head>
  <title>{data.instance.name} - Settings - Praxrr</title>
</svelte:head>

<InstanceForm mode="edit" {form} instance={data.instance} />
