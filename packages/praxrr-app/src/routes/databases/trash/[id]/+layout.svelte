<script lang="ts">
	import Tabs from '$ui/navigation/tabs/Tabs.svelte';
	import { LayoutDashboard, Settings } from 'lucide-svelte';
	import { page } from '$app/stores';

	$: source = $page.data.source;
	$: currentPath = $page.url.pathname;

	$: tabs = source
		? [
				{
					label: 'Overview',
					href: `/databases/trash/${source.id}`,
					icon: LayoutDashboard,
					active: currentPath === `/databases/trash/${source.id}`
				},
				{
					label: 'Settings',
					href: `/databases/trash/${source.id}/settings`,
					icon: Settings,
					active: currentPath.includes('/settings')
				}
			]
		: [];

	$: breadcrumb = {
		parent: {
			label: 'Databases',
			href: '/databases'
		},
		current: source?.name ?? ''
	};
</script>

<div class="p-4 md:p-8">
	<Tabs {tabs} {breadcrumb} responsive />
	<slot />
</div>
