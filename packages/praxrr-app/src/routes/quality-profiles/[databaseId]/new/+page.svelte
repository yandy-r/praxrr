<script lang="ts">
  import { goto } from '$app/navigation';
  import GeneralForm from '../components/GeneralForm.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  // Default initial data for new profile
  const initialData = {
    name: '',
    tags: [],
    description: '',
    language: null,
  };

  function handleCancel() {
    goto(`/quality-profiles/${data.currentDatabase.id}`);
  }
</script>

<svelte:head>
  <title>New Quality Profile - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="p-8">
  <GeneralForm
    mode="create"
    canWriteToBase={data.canWriteToBase}
    {initialData}
    availableLanguages={data.availableLanguages}
    onCancel={handleCancel}
  />
</div>

<DirtyModal />
