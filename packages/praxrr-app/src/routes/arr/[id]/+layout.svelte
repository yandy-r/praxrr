<script lang="ts">
  import Tabs from '$ui/navigation/tabs/Tabs.svelte';
  import VersionSupportBadge from '$ui/arr/VersionSupportBadge.svelte';
  import CompatibilityBanner from '$ui/arr/CompatibilityBanner.svelte';
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
  {#if data?.versionCompatibility}
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <span class="text-xs font-medium text-neutral-500 dark:text-neutral-400">Version</span>
      <VersionSupportBadge version={data.versionCompatibility.detectedVersion} tier={data.versionCompatibility.tier} />
    </div>
    <div class="mt-3">
      <CompatibilityBanner compatibility={data.versionCompatibility} />
    </div>
  {/if}
  <slot />
</div>
