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

  // Target Arr app whose supported qualities seed the new profile's ladder ('' = Radarr + Sonarr).
  let arrType = '';
  const arrTypeOptions = [
    { value: '', label: 'Radarr + Sonarr (video)' },
    { value: 'radarr', label: 'Radarr' },
    { value: 'sonarr', label: 'Sonarr' },
    { value: 'lidarr', label: 'Lidarr (audio)' },
  ];
  $: actionUrl = arrType ? `?arrType=${encodeURIComponent(arrType)}` : '';

  function handleCancel() {
    goto(`/quality-profiles/${data.currentDatabase.id}`);
  }
</script>

<svelte:head>
  <title>New Quality Profile - {data.currentDatabase.name} - Praxrr</title>
</svelte:head>

<div class="space-y-6 p-8">
  <GeneralForm
    mode="create"
    canWriteToBase={data.canWriteToBase}
    {initialData}
    availableLanguages={data.availableLanguages}
    {actionUrl}
    onCancel={handleCancel}
  />

  <div class="space-y-2 md:px-4">
    <label for="qp-arr-type" class="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
      Target Arr app
    </label>
    <p class="text-xs text-neutral-600 dark:text-neutral-400">
      The new profile's quality ladder is seeded with only the qualities this app supports.
    </p>
    <select
      id="qp-arr-type"
      class="w-full max-w-sm rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
      bind:value={arrType}
    >
      {#each arrTypeOptions as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>
</div>

<DirtyModal />
