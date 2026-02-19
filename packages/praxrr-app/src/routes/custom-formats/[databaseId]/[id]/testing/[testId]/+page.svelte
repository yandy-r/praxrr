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
	<title>Edit Test - {data.format.name} - Praxrr</title>
</svelte:head>

<TestForm
	mode="edit"
	formatName={data.format.name}
	canWriteToBase={data.canWriteToBase}
	actionUrl="?/update"
	initialData={{
		title: data.test.title,
		type: data.test.type as 'movie' | 'series',
		shouldMatch: data.test.should_match,
		description: data.test.description ?? ''
	}}
	onCancel={handleCancel}
/>

<DirtyModal />
