<script lang="ts">
	import MetadataProfileForm from '../components/MetadataProfileForm.svelte';
	import DirtyModal from '$ui/modal/DirtyModal.svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	export let data: PageData;

	function handleCancel() {
		goto(`/metadata-profiles/${data.currentDatabase.id}`);
	}
</script>

<svelte:head>
	<title>{data.currentProfile.name} - Metadata Profile - Profilarr</title>
</svelte:head>

<div class="p-4 md:p-8">
	<MetadataProfileForm
		mode="edit"
		databaseName={data.currentDatabase.name}
		canWriteToBase={data.canWriteToBase}
		actionUrl="?/update"
		initialData={{
			name: data.currentProfile.name,
			description: data.currentProfile.description ?? '',
			primaryTypes: data.currentProfile.primaryTypes,
			secondaryTypes: data.currentProfile.secondaryTypes,
			releaseStatuses: data.currentProfile.releaseStatuses
		}}
		onCancel={handleCancel}
	/>
</div>

<DirtyModal />
