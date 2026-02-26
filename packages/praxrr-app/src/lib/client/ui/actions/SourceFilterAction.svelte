<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { createEventDispatcher } from 'svelte';
	import type { ComponentType } from 'svelte';
	import { ChevronDown, Database, Filter, Trash2 } from 'lucide-svelte';
	import { clickOutside } from '$lib/client/utils/clickOutside';
	import Dropdown from '$ui/dropdown/Dropdown.svelte';
	import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
	import type { SourceRef } from '$shared/sources/types.ts';

	type SourceFilterSelectionMode = 'single' | 'multi';
	type SourceFilterKey = `${SourceRef['type']}:${number}`;

	interface SourceOption {
		key: SourceFilterKey;
		source: SourceRef;
		icon: ComponentType;
	}

	interface SourceFilterChangeDetail {
		selectedKeys: SourceFilterKey[];
		selectedSources: SourceRef[];
		selectionMode: SourceFilterSelectionMode;
		active: boolean;
	}

	export let sources: SourceRef[] = [];
	export let selectedKeys: SourceFilterKey[] = [];
	export let selectionMode: SourceFilterSelectionMode = 'multi';
	export let position: 'left' | 'right' | 'middle' = 'right';
	export let responsive: boolean = true;
	export let hideWhenSingle: boolean = true;
	export let pillsThreshold: number = 5;
	export let dropdownOnly: boolean = false;
	export let label: string = 'Sources';
	export let ariaLabel: string = 'Filter by source';
	export let disabled: boolean = false;
	export let active: boolean | undefined = undefined;

	const dispatch = createEventDispatcher<{ change: SourceFilterChangeDetail }>();

	let isMobile = false;
	let mediaQuery: MediaQueryList | null = null;
	let dropdownOpen = false;
	let triggerEl: HTMLElement;

	function toSourceKey(source: SourceRef): SourceFilterKey {
		return `${source.type}:${source.id}`;
	}

	function getSourceIcon(source: SourceRef): ComponentType {
		return source.type === 'trash' ? Trash2 : Database;
	}

	function isSameSelection(a: SourceFilterKey[], b: SourceFilterKey[]): boolean {
		return a.length === b.length && a.every((value, index) => value === b[index]);
	}

	function normalizeSelection(
		keys: SourceFilterKey[],
		options: SourceOption[],
		mode: SourceFilterSelectionMode
	): SourceFilterKey[] {
		if (options.length === 0) return [];

		const validKeys = new Set(options.map((option) => option.key));
		const filteredKeys = [...new Set(keys.filter((key) => validKeys.has(key)))];

		if (mode === 'single') {
			if (filteredKeys.length > 0) return [filteredKeys[0]];
			return [options[0].key];
		}

		if (filteredKeys.length === 0) {
			return options.map((option) => option.key);
		}

		return options
			.filter((option) => filteredKeys.includes(option.key))
			.map((option) => option.key);
	}

	function computeActiveState(
		keys: SourceFilterKey[],
		options: SourceOption[],
		mode: SourceFilterSelectionMode
	): boolean {
		if (options.length === 0) return false;
		if (mode === 'multi') return keys.length < options.length;
		if (options.length === 1 || keys.length === 0) return false;
		return keys[0] !== options[0].key;
	}

	function optionAriaLabel(option: SourceOption): string {
		const selected = selectedSet.has(option.key);
		if (selectionMode === 'single') {
			return `Show only source ${option.source.name}`;
		}
		return `${selected ? 'Exclude' : 'Include'} source ${option.source.name}`;
	}

	function emitChange(nextKeys: SourceFilterKey[]) {
		const normalized = normalizeSelection(nextKeys, sourceOptions, selectionMode);
		if (isSameSelection(normalized, normalizedSelectedKeys)) return;

		selectedKeys = normalized;
		const selectedSet = new Set(normalized);
		const selectedSources = sourceOptions
			.filter((option) => selectedSet.has(option.key))
			.map((option) => option.source);

		dispatch('change', {
			selectedKeys: normalized,
			selectedSources,
			selectionMode,
			active: computeActiveState(normalized, sourceOptions, selectionMode)
		});
	}

	function toggleSource(key: SourceFilterKey) {
		if (disabled) return;

		if (selectionMode === 'single') {
			emitChange([key]);
			dropdownOpen = false;
			return;
		}

		const isSelected = selectedSet.has(key);
		if (isSelected && normalizedSelectedKeys.length === 1) {
			return;
		}

		if (isSelected) {
			emitChange(normalizedSelectedKeys.filter((selectedKey) => selectedKey !== key));
			return;
		}

		emitChange([...normalizedSelectedKeys, key]);
	}

	function selectAllSources() {
		if (disabled) return;
		emitChange(sourceOptions.map((option) => option.key));
	}

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

	function handleMediaChange(event: MediaQueryListEvent) {
		isMobile = event.matches;
		if (!event.matches) return;
		dropdownOpen = false;
	}

	$: sourceOptions = sources.map((source) => ({
		key: toSourceKey(source),
		source,
		icon: getSourceIcon(source)
	}));

	$: normalizedSelectedKeys = normalizeSelection(selectedKeys, sourceOptions, selectionMode);
	$: selectedSet = new Set(normalizedSelectedKeys);
	$: useMobileMode = responsive && isMobile;
	$: useDropdown = dropdownOnly || useMobileMode || sourceOptions.length >= pillsThreshold;
	$: shouldRender = sourceOptions.length > 0 && (!hideWhenSingle || sourceOptions.length > 1);
	$: computedActive = computeActiveState(normalizedSelectedKeys, sourceOptions, selectionMode);
	$: resolvedActive = active ?? computedActive;
	$: countLabel = `${normalizedSelectedKeys.length}/${sourceOptions.length}`;
</script>

{#if shouldRender}
	{#if useDropdown}
		<div
			class="relative flex"
			bind:this={triggerEl}
			use:clickOutside={() => (dropdownOpen = false)}
			role="group"
			aria-label={ariaLabel}
		>
			<button
				type="button"
				title={ariaLabel}
				class="flex h-10 items-center gap-2 border border-neutral-300 bg-white px-3 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700/60 dark:bg-neutral-800/50 dark:text-neutral-200 dark:hover:bg-neutral-800"
				aria-haspopup="menu"
				aria-expanded={dropdownOpen}
				aria-label={ariaLabel}
				on:click={() => !disabled && (dropdownOpen = !dropdownOpen)}
				{disabled}
			>
				<Filter size={16} class={resolvedActive ? 'text-accent-600 dark:text-accent-400' : ''} />
				<span>{label}</span>
				{#if resolvedActive}
					<span
						class="rounded-full bg-accent-100 px-1.5 py-0.5 text-xs font-semibold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
					>
						{countLabel}
					</span>
				{/if}
				<ChevronDown
					size={16}
					class="text-neutral-400 transition-transform {dropdownOpen
						? 'rotate-180'
						: ''}"
				/>
			</button>

			{#if dropdownOpen}
				<Dropdown {position} mobilePosition="middle" minWidth="14rem" {triggerEl}>
					{#if selectionMode === 'multi'}
						<DropdownItem
							icon={Filter}
							label="All sources"
							selected={normalizedSelectedKeys.length === sourceOptions.length}
							on:click={selectAllSources}
						/>
					{/if}
					{#each sourceOptions as option (option.key)}
						<DropdownItem
							icon={option.icon}
							label={option.source.name}
							selected={selectedSet.has(option.key)}
							on:click={() => toggleSource(option.key)}
						/>
					{/each}
				</Dropdown>
			{/if}
		</div>
	{:else}
		<div class="flex" role="group" aria-label={ariaLabel}>
			{#each sourceOptions as option, index (option.key)}
				<button
					type="button"
					class="flex h-10 min-w-0 items-center gap-2 border border-neutral-300 px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700/60 {index > 0
						? '-ml-px'
						: ''} {selectedSet.has(option.key)
						? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
						: 'bg-white text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-800/50 dark:text-neutral-200 dark:hover:bg-neutral-800'}"
					aria-pressed={selectedSet.has(option.key)}
					aria-label={optionAriaLabel(option)}
					title={option.source.name}
					on:click={() => toggleSource(option.key)}
					{disabled}
				>
					<svelte:component
						this={option.icon}
						size={16}
						class={selectedSet.has(option.key)
							? 'text-accent-600 dark:text-accent-400'
							: 'text-neutral-500 dark:text-neutral-400'}
					/>
					<span class="max-w-[10rem] truncate">{option.source.name}</span>
				</button>
			{/each}
		</div>
	{/if}
{/if}
