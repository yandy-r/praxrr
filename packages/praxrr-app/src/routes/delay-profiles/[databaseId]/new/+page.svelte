<script lang="ts">
  import { goto } from '$app/navigation';
  import DelayProfileForm from '../components/DelayProfileForm.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  // Default initial data for create mode
  const initialData = {
    name: '',
    preferredProtocol: 'prefer_usenet' as const,
    usenetDelay: 0,
    torrentDelay: 0,
    bypassIfHighestQuality: false,
    bypassIfAboveCfScore: false,
    minimumCfScore: 0,
  };

  function handleCancel() {
    goto(`/delay-profiles/${data.currentDatabase.id}`);
  }
</script>

<svelte:head>
  <title>New Delay Profile - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="p-4 md:p-8">
  <DelayProfileForm
    mode="create"
    databaseName={data.currentDatabase.name}
    canWriteToBase={data.canWriteToBase}
    {initialData}
    onCancel={handleCancel}
  />
</div>

<DirtyModal />
