<script lang="ts">
	import MediaSettingsForm from '../../components/MediaSettingsForm.svelte';
	import DirtyModal from '$ui/modal/DirtyModal.svelte';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<MediaSettingsForm
	mode="edit"
	arrType="sonarr"
	databaseName={data.currentDatabase.name}
	canWriteToBase={data.canWriteToBase}
	actionUrl="?/update"
	initialData={data.mediaSettingsConfig}
/>

<DirtyModal />
