<script lang="ts">
  import Tabs from '$ui/navigation/tabs/Tabs.svelte';
  import { page } from '$app/stores';
  import { Library, RefreshCw, ArrowUpCircle, FileEdit, ScrollText, Settings } from 'lucide-svelte';
  import type { LayoutData } from './$types';

  export let data: LayoutData;

  $: instanceId = $page.params.id;
  $: currentPath = $page.url.pathname;
  $: instanceName = data?.instance?.name ?? 'Instance';

  $: tabs = [
    {
      label: 'Sync',
      href: `/arr/${instanceId}/sync`,
      active: currentPath.includes('/sync'),
      icon: RefreshCw,
    },
    {
      label: 'Upgrades',
      href: `/arr/${instanceId}/upgrades`,
      active: currentPath.includes('/upgrades'),
      icon: ArrowUpCircle,
    },
    {
      label: 'Renames',
      href: `/arr/${instanceId}/rename`,
      active: currentPath.includes('/rename'),
      icon: FileEdit,
    },
    {
      label: 'Library',
      href: `/arr/${instanceId}/library`,
      active: currentPath.includes('/library'),
      icon: Library,
    },
    {
      label: 'Logs',
      href: `/arr/${instanceId}/logs`,
      active: currentPath.includes('/logs'),
      icon: ScrollText,
    },
    {
      label: 'Settings',
      href: `/arr/${instanceId}/settings`,
      active: currentPath.includes('/settings'),
      icon: Settings,
    },
  ];

  $: breadcrumb = {
    parent: {
      label: 'Instances',
      href: '/arr',
    },
    current: instanceName,
  };
</script>

<div class="p-4 md:p-8">
  <Tabs {tabs} {breadcrumb} responsive />
  <slot />
</div>
