<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { Database, Plus } from 'lucide-svelte';
	import EmptyState from '$ui/state/EmptyState.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	const storageKey = 'mediaManagementDatabase';
	const sectionKey = 'mediaManagementSection';
	let redirecting = false;

	onMount(() => {
		if (!browser || data.databases.length === 0) return;

		const storedId = localStorage.getItem(storageKey);
		const stored = storedId ? Number(storedId) : NaN;
		const isValidStored =
			Number.isFinite(stored) && data.databases.some((db) => db.id === stored);

		const storedSection = localStorage.getItem(sectionKey);
		const allowedSections = new Set(['naming', 'media-settings', 'quality-definitions']);
		const isValidSection = storedSection ? allowedSections.has(storedSection) : false;
		const fallbackSection = isValidSection ? storedSection! : data.section ?? 'naming';
		const section = data.sectionFromUrl ? data.section : fallbackSection;

		const targetId = isValidStored ? stored : data.databases[0].id;

		redirecting = true;
		goto(`/media-management/${targetId}/${section}`);
	});
</script>

<svelte:head>
	<title>Media Management - Praxrr</title>
</svelte:head>

{#if data.databases.length === 0}
	<EmptyState
		icon={Database}
		title="No Databases Linked"
		description="Link a Praxrr Compliant Database to manage media settings."
		buttonText="Link Database"
		buttonHref="/databases/new"
		buttonIcon={Plus}
	/>
{:else}
	<div class="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
		{redirecting ? 'Opening your last selected database…' : 'Loading databases…'}
	</div>
{/if}
