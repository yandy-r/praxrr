<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { Database, Plus } from 'lucide-svelte';
	import EmptyState from '$ui/state/EmptyState.svelte';

	export let data: { databases: { id: number; name: string }[] };

	const storageKey = 'metadataProfilesDatabase';
	let redirecting = false;

	onMount(() => {
		if (!browser || data.databases.length === 0) return;

		const storedId = localStorage.getItem(storageKey);
		const parsed = storedId ? Number(storedId) : NaN;
		const hasStored = Number.isFinite(parsed) && data.databases.some((database) => database.id === parsed);
		const databaseId = hasStored ? parsed : data.databases[0].id;

		redirecting = true;
		goto(`/metadata-profiles/${databaseId}`);
	});
</script>

<svelte:head>
	<title>Metadata Profiles - Profilarr</title>
</svelte:head>

{#if data.databases.length === 0}
	<EmptyState
		icon={Database}
		title="No Databases Linked"
		description="Link a Profilarr Compliant Database to manage metadata profiles."
		buttonText="Link Database"
		buttonHref="/databases/new"
		buttonIcon={Plus}
	/>
{:else}
	<div class="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
		{redirecting ? 'Opening your metadata profile library…' : 'Loading metadata profiles…'}
	</div>
{/if}
