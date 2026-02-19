<script lang="ts">
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import DirtyModal from '$ui/modal/DirtyModal.svelte';
	import { page } from '$app/stores';
	import { FileText, Filter, FlaskConical } from 'lucide-svelte';

	$: databaseId = $page.params.databaseId;
	$: formatId = $page.params.id;
	$: currentPath = $page.url.pathname;

	$: tabs = [
		{
			label: 'General',
			href: `/custom-formats/${databaseId}/${formatId}/general`,
			active: currentPath.includes('/general'),
			icon: FileText
		},
		{
			label: 'Conditions',
			href: `/custom-formats/${databaseId}/${formatId}/conditions`,
			active: currentPath.includes('/conditions'),
			icon: Filter
		},
		{
			label: 'Testing',
			href: `/custom-formats/${databaseId}/${formatId}/testing`,
			active: currentPath.includes('/testing'),
			icon: FlaskConical
		}
	];

	$: backButton = { label: 'Back' };
</script>

<div class="p-4 md:p-8">
	<Tabs {tabs} {backButton} responsive />
	<slot />
</div>

<DirtyModal />
