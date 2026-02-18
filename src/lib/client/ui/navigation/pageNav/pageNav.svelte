<script lang="ts">
  import Group from './group.svelte';
  import GroupItem from './groupItem.svelte';
  import Version from './version.svelte';
  import { X } from 'lucide-svelte';
	import { resolveNavIcon } from '$lib/client/navigation/iconMap';
  import { navIconStore } from '$stores/navIcons';
  import { mobileNavOpen } from '$stores/mobileNav';
  import { NAV_GROUP_ID } from '$shared/navigation/constants.ts';
  import { page } from '$app/stores';
  import logo from '$assets/logo.svg';
  import type { NavShell } from '$shared/navigation/types.ts';

  export let version: string = '';
  export let navShell: NavShell | undefined = undefined;

  $: useEmoji = $navIconStore === 'emoji';
  $: groups = navShell?.groups ?? [];
  const collapsedGroupIds = new Set([NAV_GROUP_ID.settings, NAV_GROUP_ID.dev]);
  const collapsedItemIds = new Set(['policies.media_management']);
  const isInitiallyOpen = (groupId: string, itemId: string): boolean =>
    !collapsedGroupIds.has(groupId) && !collapsedItemIds.has(itemId);

  // Close mobile nav when page changes
  $: ($page.url.pathname, mobileNavOpen.close());

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && $mobileNavOpen) mobileNavOpen.close();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Mobile backdrop -->
{#if $mobileNavOpen}
  <button
    type="button"
    class="fixed inset-0 z-[60] bg-black/50 md:hidden"
    on:click={() => mobileNavOpen.close()}
    aria-label="Close menu"
  ></button>
{/if}

<nav
  class="fixed top-0 left-0 z-[70] flex h-full w-[90vw] flex-col border-r border-neutral-200 bg-neutral-50 transition-transform duration-200 dark:border-neutral-800 dark:bg-neutral-900
		{$mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}
		md:top-16 md:h-[calc(100vh-4rem)] md:w-80 md:translate-x-0 md:border-t"
>
  <!-- Mobile header with logo and close button -->
  <div
    class="flex items-center justify-between border-b border-neutral-200 py-4 pl-8 pr-4 md:hidden dark:border-neutral-800"
  >
    <div class="flex items-center gap-2">
      <img src={logo} alt="Praxrr logo" class="h-5 w-5" />
      <span class="text-xl font-bold text-neutral-900 dark:text-neutral-100">praxrr</span>
    </div>
    <button
      type="button"
      on:click={() => mobileNavOpen.close()}
      class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      aria-label="Close menu"
    >
      <X size={20} />
    </button>
  </div>

  <div class="flex-1 overflow-y-auto p-4">
    {#each groups as group (group.id)}
      {#each group.items as item, index (item.id)}
		<Group
			label={useEmoji && item.emoji ? `${item.emoji} ${item.label}` : item.label}
			href={item.href}
			icon={useEmoji ? undefined : resolveNavIcon(item.iconKey)}
			sectionLabel={index === 0 ? group.label : undefined}
			initialOpen={isInitiallyOpen(group.id, item.id)}
			hasItems={item.hasChildren}
		>
          {#if item.hasChildren}
            {#each item.children as child (child.id)}
              <GroupItem label={child.label} href={child.href} activePattern={child.activePattern} />
            {/each}
          {/if}
        </Group>
      {/each}
    {/each}

    <!-- Version scrolls with content on mobile -->
    <div class="mt-2 md:hidden">
      <Version {version} />
    </div>
  </div>

  <!-- Version pinned to bottom on desktop only -->
  <div class="hidden shrink-0 p-4 md:block">
    <Version {version} />
  </div>
</nav>
