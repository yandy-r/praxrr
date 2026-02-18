<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import TestForm from '../components/TestForm.svelte';
	import DirtyModal from '$ui/modal/DirtyModal.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	function handleCancel() {
		goto(`/custom-formats/${$page.params.databaseId}/${$page.params.id}/testing`);
	}
</script>

<svelte:head>
	<title>New Test - {data.format.name} - Praxrr</title>
</svelte:head>

<TestForm
	mode="create"
	formatName={data.format.name}
	canWriteToBase={data.canWriteToBase}
	initialData={{
		title: '',
		type: 'movie',
		shouldMatch: true,
		description: ''
	}}
	onCancel={handleCancel}
/>

<DirtyModal />
