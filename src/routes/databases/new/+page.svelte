<script lang="ts">
	import InstanceForm from '../components/InstanceForm.svelte';
	import type { ActionData, PageData } from './$types';

	export let form: ActionData;
	export let data: PageData;
</script>

<svelte:head>
	<title>Link Database - Praxrr</title>
</svelte:head>

<div class="p-4 md:p-8">
	<InstanceForm mode="create" {form} {data} />
</div>
