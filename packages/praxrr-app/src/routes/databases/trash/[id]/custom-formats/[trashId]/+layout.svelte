<script lang="ts">
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import { page } from '$app/stores';
	import { FileText, Filter } from 'lucide-svelte';

	$: sourceId = $page.params.id;
	$: trashId = $page.params.trashId;
	$: currentPath = $page.url.pathname;

	$: tabs = [
		{
			label: 'General',
			href: `/databases/trash/${sourceId}/custom-formats/${trashId}/general`,
			active: currentPath.includes('/general'),
			icon: FileText
		},
		{
			label: 'Conditions',
			href: `/databases/trash/${sourceId}/custom-formats/${trashId}/conditions`,
			active: currentPath.includes('/conditions'),
			icon: Filter
		}
	];

	$: backButton = { label: 'Back' };
</script>

<div class="p-4 md:p-8">
	<Tabs {tabs} {backButton} responsive />
	<slot />
</div>
