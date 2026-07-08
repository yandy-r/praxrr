<script lang="ts">
  import GeneralForm from '../../components/GeneralForm.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  // Build initial data from server
  $: initialData = {
    name: data.profile.name,
    tags: data.profile.tags.map((t) => t.name),
    description: data.profile.description ?? '',
    language: data.profile.language ?? null,
  };
</script>

<svelte:head>
  <title>{data.profile.name} - General - Praxrr</title>
</svelte:head>

<div class="mt-6">
  <GeneralForm
    mode="edit"
    canWriteToBase={data.canWriteToBase}
    actionUrl="?/update"
    {initialData}
    availableLanguages={data.availableLanguages}
  />
</div>
