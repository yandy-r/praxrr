<script lang="ts">
  import Tabs from '$ui/navigation/tabs/Tabs.svelte';
  import { LayoutDashboard, FileText, Layers, Ruler, Type, Settings } from 'lucide-svelte';
  import { page } from '$app/stores';

  $: source = $page.data.source;
  $: currentPath = $page.url.pathname;

  $: tabs = source
    ? [
        {
          label: 'Overview',
          href: `/databases/trash/${source.id}`,
          icon: LayoutDashboard,
          active: currentPath === `/databases/trash/${source.id}`,
        },
        {
          label: 'Custom Formats',
          href: `/databases/trash/${source.id}/custom-formats`,
          icon: FileText,
          active: currentPath.includes('/custom-formats'),
        },
        {
          label: 'Quality Profiles',
          href: `/databases/trash/${source.id}/quality-profiles`,
          icon: Layers,
          active: currentPath.includes('/quality-profiles'),
        },
        {
          label: 'Quality Sizes',
          href: `/databases/trash/${source.id}/quality-sizes`,
          icon: Ruler,
          active: currentPath.includes('/quality-sizes'),
        },
        {
          label: 'Naming',
          href: `/databases/trash/${source.id}/naming`,
          icon: Type,
          active: currentPath.includes('/naming'),
        },
        {
          label: 'Settings',
          href: `/databases/trash/${source.id}/settings`,
          icon: Settings,
          active: currentPath.includes('/settings'),
        },
      ]
    : [];

  $: breadcrumb = {
    parent: {
      label: 'Databases',
      href: '/databases',
    },
    current: source?.name ?? '',
  };
</script>

<div class="p-4 md:p-8">
  <Tabs {tabs} {breadcrumb} responsive />
  <slot />
</div>
