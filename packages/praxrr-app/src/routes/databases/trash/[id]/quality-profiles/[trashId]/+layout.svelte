<script lang="ts">
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import { page } from '$app/stores';
	import { FileText, ListOrdered, Target } from 'lucide-svelte';

	$: sourceId = $page.params.id;
	$: trashId = $page.params.trashId;
	$: currentPath = $page.url.pathname;

	$: tabs = [
		{
			label: 'General',
			href: `/databases/trash/${sourceId}/quality-profiles/${trashId}/general`,
			active: currentPath.includes('/general'),
			icon: FileText
		},
		{
			label: 'Qualities',
			href: `/databases/trash/${sourceId}/quality-profiles/${trashId}/qualities`,
			active: currentPath.includes('/qualities'),
			icon: ListOrdered
		},
		{
			label: 'Scoring',
			href: `/databases/trash/${sourceId}/quality-profiles/${trashId}/scoring`,
			active: currentPath.includes('/scoring'),
			icon: Target
		}
	];

	$: backButton = { label: 'Back' };
</script>

<div class="p-4 md:p-8">
	<Tabs {tabs} {backButton} responsive />
	<slot />
</div>
