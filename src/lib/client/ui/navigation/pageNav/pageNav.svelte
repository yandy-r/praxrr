<script lang="ts">
		import Group from './group.svelte';
	import GroupItem from './groupItem.svelte';
	import Version from './version.svelte';
	import { FolderTree, Link, Sliders, Palette, Microscope, Tag, Clock, Settings, X, Wrench } from 'lucide-svelte';
	import { navIconStore } from '$stores/navIcons';
	import { mobileNavOpen } from '$stores/mobileNav';
	import { page } from '$app/stores';
	import logo from '$assets/logo-512.png';

	export let version: string = '';

	$: useEmoji = $navIconStore === 'emoji';

	// Close mobile nav when page changes
	$: $page.url.pathname, mobileNavOpen.close();

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
	<div class="flex items-center justify-between border-b border-neutral-200 py-4 pl-8 pr-4 md:hidden dark:border-neutral-800">
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
		{#if import.meta.env.DEV}
			<Group
				label={useEmoji ? '🛠️ Dev' : 'Dev'}
				href="/dev"
				icon={useEmoji ? undefined : Wrench}
				initialOpen={true}
				hasItems={true}
			>
				<GroupItem label="Components" href="/dev/components" />
			</Group>
		{/if}

		<Group
			label={useEmoji ? '📦 Databases' : 'Databases'}
			href="/databases"
			icon={useEmoji ? undefined : FolderTree}
		/>

		<Group
			label={useEmoji ? '🔗 Arrs' : 'Arrs'}
			href="/arr"
			icon={useEmoji ? undefined : Link}
		/>

		<Group
			label={useEmoji ? '⚡ Quality Profiles' : 'Quality Profiles'}
			href="/quality-profiles"
			icon={useEmoji ? undefined : Sliders}
			initialOpen={true}
			hasItems={true}
		>
			<GroupItem label="Testing" href="/quality-profiles/entity-testing" />
		</Group>

		<Group
			label={useEmoji ? '🎨 Custom Formats' : 'Custom Formats'}
			href="/custom-formats"
			icon={useEmoji ? undefined : Palette}
			initialOpen={false}
		/>

		<Group
			label={useEmoji ? '🔬 Regular Expressions' : 'Regular Expressions'}
			href="/regular-expressions"
			icon={useEmoji ? undefined : Microscope}
			initialOpen={false}
		/>

		<Group
			label={useEmoji ? '🏷️ Media Management' : 'Media Management'}
			href="/media-management"
			icon={useEmoji ? undefined : Tag}
			initialOpen={true}
			hasItems={true}
		>
			<GroupItem label="Naming Settings" href="/media-management?section=naming" activePattern="/naming" />
			<GroupItem label="Quality Definitions" href="/media-management?section=quality-definitions" activePattern="/quality-definitions" />
			<GroupItem label="Media Settings" href="/media-management?section=media-settings" activePattern="/media-settings" />
		</Group>

		<Group
			label={useEmoji ? '⏳ Delay Profiles' : 'Delay Profiles'}
			href="/delay-profiles"
			icon={useEmoji ? undefined : Clock}
			initialOpen={false}
		/>

		<Group
			label={useEmoji ? '🏷️ Metadata Profiles' : 'Metadata Profiles'}
			href="/metadata-profiles"
			icon={useEmoji ? undefined : Tag}
			initialOpen={false}
		/>

		<Group
			label={useEmoji ? '⚙️ Settings' : 'Settings'}
			href="/settings"
			icon={useEmoji ? undefined : Settings}
			initialOpen={true}
			hasItems={true}
		>
			<GroupItem label="General" href="/settings/general" />
			<GroupItem label="Jobs" href="/settings/jobs" />
			<GroupItem label="Logs" href="/settings/logs" />
			<GroupItem label="Backups" href="/settings/backups" />
			<GroupItem label="Notifications" href="/settings/notifications" />
			<GroupItem label="Security" href="/settings/security" />
			<GroupItem label="About" href="/settings/about" />
			<GroupItem label="Log Out" href="/auth/logout" />
		</Group>

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
