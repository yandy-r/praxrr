<script lang="ts">
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import DirtyModal from '$ui/modal/DirtyModal.svelte';
	import { page } from '$app/stores';
	import { FileText, Scale, Layers } from 'lucide-svelte';

	$: databaseId = $page.params.databaseId;
	$: profileId = $page.params.id;
	$: currentPath = $page.url.pathname;

	$: tabs = [
		{
			label: 'General',
			href: `/quality-profiles/${databaseId}/${profileId}/general`,
			active: currentPath.includes('/general'),
			icon: FileText
		},
		{
			label: 'Scoring',
			href: `/quality-profiles/${databaseId}/${profileId}/scoring`,
			active: currentPath.includes('/scoring'),
			icon: Scale
		},
		{
			label: 'Qualities',
			href: `/quality-profiles/${databaseId}/${profileId}/qualities`,
			active: currentPath.includes('/qualities'),
			icon: Layers
		}
	];

	$: backButton = { label: 'Back' };
</script>

<div class="p-4 md:p-8">
	<Tabs {tabs} {backButton} responsive />
	<slot />
</div>

<DirtyModal />
