<script lang="ts">
	import { page } from '$app/stores';
	import { resolveNavIcon } from '$lib/client/navigation/iconMap';
	import { navIconStore } from '$stores/navIcons';
	import { navScope } from '$stores/navScope.ts';
	import { supportsFeature, type ArrFeature } from '$shared/arr/capabilities.ts';
	import type { ArrType } from '$shared/pcd/types.ts';
	import type { NavShell, ResolvedNavItem } from '$shared/navigation/types.ts';

	type FlattenedNavItem = ResolvedNavItem & {
		sourceIndex: number;
	};

	type ScopeAwareNavItem = ResolvedNavItem & { requiredFeature?: ArrFeature };

	const priorityOrder: Record<ResolvedNavItem['mobilePriority'], number> = {
		always: 0,
		medium: 1,
		low: 2,
	};
	const shortLabelByHref: Record<string, string> = {
		'/quality-profiles': 'Profiles',
		'/custom-formats': 'Formats',
		'/regular-expressions': 'Regex',
		'/media-management': 'Media',
		'/metadata-profiles': 'Metadata',
		'/delay-profiles': 'Delay',
	};

	export let navShell: NavShell | undefined = undefined;

	$: flattenedItems = buildBottomNavItems(navShell, $navScope);

	$: useEmoji = $navIconStore === 'emoji';
	$: pathname = $page.url.pathname;

	function isActive(href: string, currentPath: string): boolean {
		if (href === '/') return currentPath === '/';
		return currentPath.startsWith(href);
	}

	function shortLabel(item: FlattenedNavItem): string {
		return shortLabelByHref[item.href] ?? item.label;
	}

	function isScopedItemVisible(item: ScopeAwareNavItem, scope: ArrType): boolean {
		if (scope === 'all' || !item.requiredFeature) {
			return true;
		}

		return supportsFeature(scope, item.requiredFeature);
	}

	function buildBottomNavItems(shell: NavShell | undefined, scope: ArrType): FlattenedNavItem[] {
		const flattened: FlattenedNavItem[] = [];
		let sourceIndex = 0;

		for (const group of shell?.groups ?? []) {
			for (const item of group.items as ScopeAwareNavItem[]) {
				if (!isScopedItemVisible(item, scope)) {
					continue;
				}

				flattened.push({
					...item,
					sourceIndex: sourceIndex++,
				});
			}
		}

		return flattened.sort((left, right) => {
			const priorityDiff = priorityOrder[left.mobilePriority] - priorityOrder[right.mobilePriority];
			if (priorityDiff !== 0) {
				return priorityDiff;
			}

			return left.sourceIndex - right.sourceIndex;
		});
	}
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-200 bg-neutral-50 pb-[env(safe-area-inset-bottom)] md:hidden dark:border-neutral-800 dark:bg-neutral-900"
>
	<div class="flex items-center justify-around px-1">
		{#each flattenedItems as item (item.id)}
			{@const active = isActive(item.href, pathname)}
			{@const icon = useEmoji ? undefined : resolveNavIcon(item.iconKey)}
			<a
				href={item.href}
				class="flex flex-col items-center justify-center py-2 transition-colors
					{item.mobilePriority === 'medium' ? 'hidden sm:flex' : ''}
					{item.mobilePriority === 'low' ? 'hidden' : ''}
					{active
					? 'text-accent-600 dark:text-accent-400'
					: 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'}"
			>
				{#if useEmoji}
					<span class="text-xl">{item.emoji}</span>
				{:else}
					{#if icon}
						<svelte:component this={icon} size={20} strokeWidth={active ? 2.5 : 2} />
					{/if}
				{/if}
				<span class="mt-0.5 text-[10px] font-medium">{shortLabel(item)}</span>
			</a>
		{/each}
	</div>
</nav>
