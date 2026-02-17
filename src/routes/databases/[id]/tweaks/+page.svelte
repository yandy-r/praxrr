<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<svelte:head>
	<title>Tweaks - {data.database.name} - Praxrr</title>
</svelte:head>

<div class="mt-6">
	<div
		class="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900"
	>
		<p class="text-neutral-500 dark:text-neutral-400">No tweaks available for this database.</p>
	</div>
</div>
