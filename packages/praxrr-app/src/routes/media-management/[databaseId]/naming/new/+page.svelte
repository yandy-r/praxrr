<script lang="ts">
  import RadarrNamingForm from '../components/RadarrNamingForm.svelte';
  import LidarrNamingForm from '../components/LidarrNamingForm.svelte';
  import SonarrNamingForm from '../components/SonarrNamingForm.svelte';
  import DirtyModal from '$ui/modal/DirtyModal.svelte';
  import RadarrIcon from '$lib/client/assets/Radarr.svg';
  import SonarrIcon from '$lib/client/assets/Sonarr.svg';
  import LidarrIcon from '$lib/client/assets/Lidarr.png';
  import { AlertTriangle } from 'lucide-svelte';
  import type { ArrAppType } from '$shared/pcd/types.ts';
  import type { PageData } from './$types';

  export let data: PageData;

  let selectedArrType: ArrAppType | null = null;

  const arrTypeOptions: { value: ArrAppType; label: string; description: string; icon: string }[] = [
    {
      value: 'radarr',
      label: 'Radarr',
      description: 'Movie naming configuration',
      icon: RadarrIcon,
    },
    {
      value: 'sonarr',
      label: 'Sonarr',
      description: 'TV series naming configuration',
      icon: SonarrIcon,
    },
    {
      value: 'lidarr',
      label: 'Lidarr',
      description: 'Music naming configuration',
      icon: LidarrIcon,
    },
  ];

  $: selectedLabel = arrTypeOptions.find((option) => option.value === selectedArrType)?.label ?? '';
</script>

{#snippet missingDefaultsWarning(label: string)}
  <div class="rounded-lg border border-amber-300 bg-amber-50 p-6 dark:border-amber-700 dark:bg-amber-950">
    <div class="flex items-start gap-3">
      <AlertTriangle size={20} class="mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
      <div class="space-y-2">
        <h3 class="font-medium text-amber-800 dark:text-amber-200">
          No default {label} naming configuration found
        </h3>
        <p class="text-sm text-amber-700 dark:text-amber-300">
          The PCD database may not be synced or doesn't contain naming seed data for {label}.
        </p>
        <a
          href="/databases"
          class="inline-block text-sm font-medium text-amber-800 underline hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
        >
          Check database status
        </a>
      </div>
    </div>
  </div>
{/snippet}

{#if !selectedArrType}
  <div class="grid gap-4 sm:grid-cols-2">
    {#each arrTypeOptions as option (option.value)}
      <button
        type="button"
        onclick={() => (selectedArrType = option.value)}
        class="hover:border-accent-500 dark:hover:border-accent-400 flex items-center gap-4 rounded-lg border border-neutral-200 bg-white p-6 text-left transition-colors dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div class="flex h-12 w-12 items-center justify-center">
          <img src={option.icon} alt={option.label} class="h-10 w-10" />
        </div>
        <div>
          <div class="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {option.label}
          </div>
          <div class="text-sm text-neutral-500 dark:text-neutral-400">
            {option.description}
          </div>
        </div>
      </button>
    {/each}
  </div>
{:else if selectedArrType === 'radarr'}
  {#if data.radarrDefaults}
    <RadarrNamingForm
      mode="create"
      databaseName={data.currentDatabase.name}
      canWriteToBase={data.canWriteToBase}
      initialData={{ ...data.radarrDefaults, name: '' }}
    />
  {:else}
    {@render missingDefaultsWarning(selectedLabel)}
  {/if}
{:else if selectedArrType === 'lidarr'}
  {#if data.lidarrDefaults}
    <LidarrNamingForm
      mode="create"
      databaseName={data.currentDatabase.name}
      canWriteToBase={data.canWriteToBase}
      initialData={{ ...data.lidarrDefaults, name: '' }}
    />
  {:else}
    {@render missingDefaultsWarning(selectedLabel)}
  {/if}
{:else if data.sonarrDefaults}
  <SonarrNamingForm
    arrType={selectedArrType}
    mode="create"
    databaseName={data.currentDatabase.name}
    canWriteToBase={data.canWriteToBase}
    initialData={{ ...data.sonarrDefaults, name: '' }}
  />
{:else}
  {@render missingDefaultsWarning(selectedLabel)}
{/if}

<DirtyModal />
