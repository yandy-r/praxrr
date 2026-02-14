<script lang="ts">
	import RadarrNamingForm from '../components/RadarrNamingForm.svelte';
	import SonarrNamingForm from '../components/SonarrNamingForm.svelte';
	import DirtyModal from '$ui/modal/DirtyModal.svelte';
	import RadarrIcon from '$lib/client/assets/Radarr.svg';
	import SonarrIcon from '$lib/client/assets/Sonarr.svg';
	import LidarrIcon from '$lib/client/assets/Lidarr.png';
	import type { ArrAppType } from '$shared/pcd/types.ts';
	import type { PageData } from './$types';

	export let data: PageData;

	let selectedArrType: ArrAppType | null = null;

	const arrTypeOptions: { value: ArrAppType; label: string; description: string; icon: string }[] = [
		{
			value: 'radarr',
			label: 'Radarr',
			description: 'Movie naming configuration',
			icon: RadarrIcon
		},
		{
			value: 'sonarr',
			label: 'Sonarr',
			description: 'TV series naming configuration',
			icon: SonarrIcon
		},
		{
			value: 'lidarr',
			label: 'Lidarr',
			description: 'Music naming configuration',
			icon: LidarrIcon
		}
	];
</script>

{#if !selectedArrType}
	<div class="grid gap-4 sm:grid-cols-2">
		{#each arrTypeOptions as option (option.value)}
			<button
				type="button"
				onclick={() => (selectedArrType = option.value)}
				class="flex items-center gap-4 rounded-lg border border-neutral-200 bg-white p-6 text-left transition-colors hover:border-accent-500 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-accent-400"
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
	<RadarrNamingForm
		mode="create"
		databaseName={data.currentDatabase.name}
		canWriteToBase={data.canWriteToBase}
		initialData={null}
	/>
{:else}
	<SonarrNamingForm
		arrType={selectedArrType}
		mode="create"
		databaseName={data.currentDatabase.name}
		canWriteToBase={data.canWriteToBase}
		initialData={null}
	/>
{/if}

<DirtyModal />
