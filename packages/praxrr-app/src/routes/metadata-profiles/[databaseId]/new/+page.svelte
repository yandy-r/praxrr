<script lang="ts">
  import { goto } from '$app/navigation';
  import MetadataProfileForm from '../components/MetadataProfileForm.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  function handleCancel() {
    goto(`/metadata-profiles/${data.currentDatabase.id}`);
  }
</script>

<svelte:head>
  <title>New Metadata Profile - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="p-4 md:p-8">
  <MetadataProfileForm
    mode="create"
    databaseName={data.currentDatabase.name}
    canWriteToBase={data.canWriteToBase}
    initialData={data.initialData}
    onCancel={handleCancel}
  />
</div>

<DirtyModal />
