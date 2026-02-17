<script lang="ts">
	import { page } from '$app/stores';
	import { navIconStore } from '$stores/navIcons';
	import {
		FolderTree,
		Link,
		Sliders,
		Palette,
		Settings,
		Microscope,
		Tag,
		Clock
	} from 'lucide-svelte';

	type NavItem = {
		href: string;
		label: string;
		shortLabel?: string;
		icon: typeof FolderTree;
		emoji: string;
		priority: 'always' | 'medium' | 'low';
	};

	const items: NavItem[] = [
		{ href: '/databases', label: 'Databases', icon: FolderTree, emoji: '📦', priority: 'always' },
		{ href: '/arr', label: 'Arrs', icon: Link, emoji: '🔗', priority: 'always' },
		{ href: '/quality-profiles', label: 'Profiles', icon: Sliders, emoji: '⚡', priority: 'always' },
		{ href: '/custom-formats', label: 'Formats', icon: Palette, emoji: '🎨', priority: 'always' },
		{ href: '/settings', label: 'Settings', icon: Settings, emoji: '⚙️', priority: 'always' },
		{ href: '/regular-expressions', label: 'Regex', icon: Microscope, emoji: '🔬', priority: 'medium' },
		{ href: '/media-management', label: 'Media', icon: Tag, emoji: '🏷️', priority: 'low' },
		{ href: '/delay-profiles', label: 'Delay', icon: Clock, emoji: '⏳', priority: 'low' },
		{ href: '/metadata-profiles', label: 'Metadata', icon: Tag, emoji: '🏷️', priority: 'low' }
	];

	$: useEmoji = $navIconStore === 'emoji';
	$: pathname = $page.url.pathname;

	function isActive(href: string, currentPath: string): boolean {
		if (href === '/') return currentPath === '/';
		return currentPath.startsWith(href);
	}
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-200 bg-neutral-50 pb-[env(safe-area-inset-bottom)] md:hidden dark:border-neutral-800 dark:bg-neutral-900"
>
	<div class="flex items-center justify-around px-1">
		{#each items as item}
			{@const active = isActive(item.href, pathname)}
			<a
				href={item.href}
				class="flex flex-col items-center justify-center py-2 transition-colors
					{item.priority === 'medium' ? 'hidden sm:flex' : ''}
					{item.priority === 'low' ? 'hidden' : ''}
					{active
					? 'text-accent-600 dark:text-accent-400'
					: 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'}"
			>
				{#if useEmoji}
					<span class="text-xl">{item.emoji}</span>
				{:else}
					<svelte:component this={item.icon} size={20} strokeWidth={active ? 2.5 : 2} />
				{/if}
				<span class="mt-0.5 text-[10px] font-medium">{item.shortLabel ?? item.label}</span>
			</a>
		{/each}
	</div>
</nav>
