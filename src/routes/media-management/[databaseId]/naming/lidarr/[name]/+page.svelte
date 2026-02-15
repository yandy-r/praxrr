<script lang="ts">
	import LidarrNamingForm from '../../components/LidarrNamingForm.svelte';
	import DirtyModal from '$ui/modal/DirtyModal.svelte';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<LidarrNamingForm
	mode="edit"
	databaseName={data.currentDatabase.name}
	canWriteToBase={data.canWriteToBase}
	actionUrl="?/update"
	initialData={data.namingConfig}
/>

<DirtyModal />
