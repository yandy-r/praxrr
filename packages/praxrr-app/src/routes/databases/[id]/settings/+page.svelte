<script lang="ts">
  import InstanceForm from '../../components/InstanceForm.svelte';
  import type { ActionData, PageData } from './$types';

  export let form: ActionData;
  export let data: PageData;
</script>

<svelte:head>
  <title>Settings - {data.database.name} - Praxrr</title>
</svelte:head>

<InstanceForm
  mode="edit"
  {form}
  instance={data.database}
  hasStoredPersonalAccessToken={data.hasPersonalAccessToken}
  personalAccessTokenMasked={data.personalAccessTokenMasked}
/>
