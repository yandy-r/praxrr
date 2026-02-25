<script lang="ts">
	import TrashGuideForm from '../../components/TrashGuideForm.svelte';
	import type { ActionData } from './$types';

	export let form: ActionData;
</script>

<svelte:head>
	<title>Add TRaSH Guides - Praxrr</title>
</svelte:head>

<div class="p-4 md:p-8">
	<TrashGuideForm mode="create" {form} />
</div>
