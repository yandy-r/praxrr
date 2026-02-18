<script lang="ts">
	import Group from './group.svelte';
	import GroupItem from './groupItem.svelte';
	import Version from './version.svelte';
	import { X } from 'lucide-svelte';
	import { resolveNavIcon } from '$lib/client/navigation/iconMap';
	import NavScopeSelector from './navScopeSelector.svelte';
	import { navIconStore } from '$stores/navIcons';
	import { mobileNavOpen } from '$stores/mobileNav';
	import { navScope } from '$stores/navScope.ts';
	import {
		ARR_CONDITION_TARGET_OPTIONS,
		supportsFeature,
		type ArrFeature,
	} from '$shared/arr/capabilities.ts';
	import { NAV_GROUP_ID } from '$shared/navigation/constants.ts';
	import { page } from '$app/stores';
	import { type ArrType } from '$shared/pcd/types.ts';
	import type { NavGroupId, NavShell, ResolvedNavItem } from '$shared/navigation/types.ts';
	import SectionHeader from './sectionHeader.svelte';
	import logo from '$assets/logo.svg';

	export let version: string = '';
	export let navShell: NavShell | undefined = undefined;

	$: useEmoji = $navIconStore === 'emoji';
	$: groups = navShell?.groups ?? [];
	const collapsedGroupIds = new Set<string>([NAV_GROUP_ID.settings, NAV_GROUP_ID.dev]);
	const collapsedItemIds = new Set(['policies.media_management']);

	type ScopeAwareNavItem = ResolvedNavItem & { requiredFeature?: ArrFeature };
	type ScopeFilterMode = 'visible' | 'disabled';

	type ScopeAwareNavEntry = {
		item: ScopeAwareNavItem;
		mode: ScopeFilterMode;
	};

	type ScopeAwareNavGroup = {
		id: NavGroupId;
		label: string;
		items: ScopeAwareNavEntry[];
	};

	/**
	 * Scope filtering matrix:
	 * - all => unchanged shell shape.
	 * - scope-specific unsupported leaf items => hidden (no safe fallback).
	 * - scope-specific unsupported items with children => disabled + annotation for discovery.
	 */
	const scopeReasonCache = new Map<ArrType, string>(
		ARR_CONDITION_TARGET_OPTIONS.map((option) => [option.value, option.label])
	);

	function resolveScopeLabel(scope: ArrType): string {
		return scopeReasonCache.get(scope) ?? scope;
	}

	const scopeUnavailableMessage = (scope: ArrType, item: ScopeAwareNavItem): string => {
		return `${item.label} is unavailable while browsing ${resolveScopeLabel(scope)}.`;
	};

	const isScopedItemVisible = (item: ScopeAwareNavItem, scope: ArrType): boolean => {
		if (scope === 'all' || !item.requiredFeature) {
			return true;
		}

		return supportsFeature(scope, item.requiredFeature);
	};

	const resolveScopeEntries = (scope: ArrType, source: typeof groups): ScopeAwareNavGroup[] => {
		const scopedGroups: Array<ScopeAwareNavGroup | null> = source.map((group) => {
			const items = group.items
				.map((item) => {
					const navItem = item as ScopeAwareNavItem;
					if (isScopedItemVisible(navItem, scope)) {
						return { item: navItem, mode: 'visible' as const };
					}

					if (navItem.hasChildren) {
						return { item: navItem, mode: 'disabled' as const };
					}

					return null;
				})
				.filter((entry): entry is ScopeAwareNavEntry => entry !== null);

			if (items.length === 0) {
				return null;
			}

			return {
				id: group.id,
				label: group.label,
				items,
			};
		});

		return scopedGroups.filter((group): group is ScopeAwareNavGroup => group !== null);
	};

	$: filteredGroups = resolveScopeEntries($navScope, groups);
	$: currentPath = $page.url.pathname;

	const isInitiallyOpen = (groupId: string, itemId: string): boolean =>
		!collapsedGroupIds.has(groupId) && !collapsedItemIds.has(itemId);

	const isItemActive = (item: ScopeAwareNavItem): boolean =>
		item.activePattern
			? currentPath.includes(item.activePattern)
			: currentPath === item.href || currentPath.startsWith(`${item.href}/`);

	const shouldOpenItem = (groupId: string, itemId: string, item: ScopeAwareNavItem): boolean =>
		isInitiallyOpen(groupId, itemId) || isItemActive(item);

	// Close mobile nav when page changes
	$: if ($page.url.pathname) {
		mobileNavOpen.close();
	}

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
		<NavScopeSelector {navShell} />

		{#each filteredGroups as group (group.id)}
			{#each group.items as entry, index (entry.item.id)}
				{#if entry.mode === 'visible'}
					<Group
						label={useEmoji && entry.item.emoji ? `${entry.item.emoji} ${entry.item.label}` : entry.item.label}
						href={entry.item.href}
						icon={useEmoji ? undefined : resolveNavIcon(entry.item.iconKey)}
						sectionLabel={index === 0 ? group.label : undefined}
						initialOpen={shouldOpenItem(group.id, entry.item.id, entry.item)}
						hasItems={entry.item.hasChildren}
					>
						{#if entry.item.hasChildren}
							{#each entry.item.children as child (child.id)}
								<GroupItem label={child.label} href={child.href} activePattern={child.activePattern} />
							{/each}
						{/if}
					</Group>
				{:else}
					<div class="mb-4">
						{#if index === 0}
							<SectionHeader label={group.label} />
						{/if}
						<div class="mb-1 flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
							{#if !useEmoji}
								<svelte:component this={resolveNavIcon(entry.item.iconKey)} class="h-4 w-4 flex-shrink-0" />
							{/if}
							<div class="min-w-0">
								<div class="font-semibold">
									{#if useEmoji && entry.item.emoji}
										{entry.item.emoji} {entry.item.label}
									{:else}
										{entry.item.label}
									{/if}
								</div>
								<div class="text-xs text-neutral-500 dark:text-neutral-500">
									{scopeUnavailableMessage($navScope, entry.item)}
								</div>
							</div>
						</div>
					</div>
				{/if}
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
