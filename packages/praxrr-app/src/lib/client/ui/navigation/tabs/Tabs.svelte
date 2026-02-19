<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import type { ComponentType } from 'svelte';
	import { ArrowLeft, ChevronRight, ChevronDown } from 'lucide-svelte';
	import { clickOutside } from '$lib/client/utils/clickOutside';
	import Dropdown from '$ui/dropdown/Dropdown.svelte';
	import DropdownItem from '$ui/dropdown/DropdownItem.svelte';

	interface Tab {
		label: string;
		href: string;
		active?: boolean;
		icon?: ComponentType;
	}

	interface BackButton {
		label: string;
	}

	interface Breadcrumb {
		parent: {
			label: string;
			href: string;
		};
		current: string;
	}

	export let tabs: Tab[] = [];
	export let backButton: BackButton | undefined = undefined;
	export let breadcrumb: Breadcrumb | undefined = undefined;
	export let responsive: boolean = false;
	export let hideWhenSingle: boolean = true;
	export let hiddenSpacerClass: string = 'h-1';

	// Mobile detection
	let isMobile = false;
	let mediaQuery: MediaQueryList | null = null;
	let dropdownOpen = false;
	let triggerEl: HTMLElement;

	onMount(() => {
		if (responsive && typeof window !== 'undefined') {
			mediaQuery = window.matchMedia('(max-width: 767px)');
			isMobile = mediaQuery.matches;
			mediaQuery.addEventListener('change', handleMediaChange);
		}
	});

	onDestroy(() => {
		if (mediaQuery) {
			mediaQuery.removeEventListener('change', handleMediaChange);
		}
	});

	function handleMediaChange(e: MediaQueryListEvent) {
		isMobile = e.matches;
	}

	$: useMobileMode = responsive && isMobile;

	// Get current active tab
	$: activeTab = tabs.find((t) => t.active) ?? tabs[0];

	function handleTabSelect(href: string) {
		dropdownOpen = false;
		goto(href);
	}
</script>

{#if hideWhenSingle && tabs.length <= 1 && !backButton && !breadcrumb}
	<div class={hiddenSpacerClass}></div>
{:else if useMobileMode}
	<!-- Mobile: Custom dropdown with icons -->
	<div class="border-b border-neutral-200 py-3 dark:border-neutral-800">
		<div class="relative" bind:this={triggerEl} use:clickOutside={() => (dropdownOpen = false)}>
			<button
				type="button"
				on:click={() => (dropdownOpen = !dropdownOpen)}
				class="flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-50 dark:border-neutral-700/60 dark:bg-neutral-800/50 dark:text-neutral-100 dark:hover:bg-neutral-700"
			>
				<span class="flex items-center gap-2">
					{#if activeTab?.icon}
						<svelte:component this={activeTab.icon} size={16} class="text-accent-500" />
					{/if}
					{activeTab?.label ?? 'Select...'}
				</span>
				<ChevronDown
					size={16}
					class="text-neutral-400 transition-transform {dropdownOpen ? 'rotate-180' : ''}"
				/>
			</button>

			{#if dropdownOpen}
				<Dropdown position="left" minWidth="100%" {triggerEl}>
					{#each tabs as tab}
						<DropdownItem
							icon={tab.icon}
							label={tab.label}
							selected={tab.active}
							on:click={() => handleTabSelect(tab.href)}
						/>
					{/each}
				</Dropdown>
			{/if}
		</div>
	</div>
{:else}
	<!-- Desktop: Tab bar -->
	<div class="border-b border-neutral-200 dark:border-neutral-800">
		<nav class="-mb-px flex items-center justify-between gap-2" aria-label="Tabs">
			<div class="flex gap-2">
				{#each tabs as tab (tab.href)}
					<a
						href={tab.href}
						data-sveltekit-preload-data="tap"
						class="flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors {tab.active
							? 'border-accent-600 text-accent-600 dark:border-accent-500 dark:text-accent-500'
							: 'border-transparent text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-neutral-50'}"
					>
						{#if tab.icon}
							<svelte:component this={tab.icon} size={16} />
						{/if}
						{tab.label}
					</a>
				{/each}

				<!-- Actions slot for custom action tabs (like Add Instance) -->
				<slot name="actions" />
			</div>

			{#if breadcrumb}
				<div class="flex items-center gap-2 text-sm">
					<a
						href={breadcrumb.parent.href}
						class="text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
					>
						{breadcrumb.parent.label}
					</a>
					<ChevronRight size={14} class="text-neutral-400 dark:text-neutral-600" />
					<span class="font-medium text-neutral-900 dark:text-neutral-50">{breadcrumb.current}</span>
				</div>
			{:else if backButton}
				<button
					type="button"
					on:click={() => history.back()}
					class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
				>
					<ArrowLeft size={14} />
					{backButton.label}
				</button>
			{/if}
		</nav>
	</div>
{/if}
