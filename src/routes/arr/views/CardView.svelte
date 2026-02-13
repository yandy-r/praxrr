<script lang="ts">
	import { resolve } from '$app/paths';
	import { ExternalLink, Trash2 } from 'lucide-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import Badge from '$ui/badge/Badge.svelte';
	import type { ArrInstance } from '$db/queries/arrInstances.ts';
	import type { ArrIconKey } from '$shared/arr/capabilities.ts';
	import { ARR_APP_TYPES, getArrAppMetadata, isArrAppType } from '$shared/arr/capabilities.ts';
	import radarrLogo from '$lib/client/assets/Radarr.svg';
	import sonarrLogo from '$lib/client/assets/Sonarr.svg';
	import { createEventDispatcher } from 'svelte';

	export let instances: ArrInstance[];

	const dispatch = createEventDispatcher<{
		delete: ArrInstance;
	}>();

	// Available logo assets keyed by ArrIconKey.
	// Apps without a logo asset (e.g. Lidarr) fall back to the initial-letter
	// display in the template, driven by capability metadata.
	const logoAssets: Record<string, string> = {
		radarr: radarrLogo,
		sonarr: sonarrLogo
	};

	// Build logo lookup from registered Arr app types so every app in
	// ARR_APP_TYPES is represented. Missing assets resolve to undefined.
	const logos: Partial<Record<ArrIconKey, string>> = Object.fromEntries(
		ARR_APP_TYPES.map((type) => [type, logoAssets[type]])
	) as Partial<Record<ArrIconKey, string>>;

	// Track loaded images
	let loadedImages = new SvelteSet<number>();

	function formatType(type: string): string {
		return type.charAt(0).toUpperCase() + type.slice(1);
	}

	function getAppLabel(type: string): string {
		if (!isArrAppType(type)) {
			return formatType(type);
		}

		return getArrAppMetadata(type).label;
	}

	// Get logo path from centralized metadata
	function getLogoPath(type: string): string {
		if (!isArrAppType(type)) {
			return '';
		}

		const metadata = getArrAppMetadata(type);
		return logos[metadata.iconKey] ?? '';
	}

	function getAppInitial(type: string): string {
		return getAppLabel(type).slice(0, 1).toUpperCase();
	}

	function handleImageLoad(id: number) {
		loadedImages.add(id);
	}

	// Handle delete click
	function handleDeleteClick(e: MouseEvent, instance: ArrInstance) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('delete', instance);
	}

	// Handle external link click
	function handleExternalClick(e: MouseEvent, url: string) {
		e.stopPropagation();
		e.preventDefault();
		window.open(url, '_blank');
	}
</script>

<div class="grid grid-cols-1 gap-3">
	{#each instances as instance (instance.id)}
		{@const appLabel = getAppLabel(instance.type)}
		{@const logoPath = getLogoPath(instance.type)}
		{@const instanceHref = resolve('/arr/[id]', { id: instance.id.toString() })}
		<a
			href={instanceHref}
			class="group flex cursor-pointer items-center gap-4 rounded-lg border border-neutral-200 bg-white p-3 text-left transition-all hover:border-neutral-300 hover:shadow-md active:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700 dark:active:bg-neutral-800"
		>
			<!-- Left: Logo + Name -->
			<div class="flex min-w-0 flex-1 items-center gap-3">
				<div class="relative h-10 w-10 flex-shrink-0">
					{#if logoPath}
						{#if !loadedImages.has(instance.id)}
							<div
								class="absolute inset-0 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-700"
							></div>
						{/if}
						<img
							src={logoPath}
							alt={`${appLabel} logo`}
							class="h-10 w-10 rounded-lg {loadedImages.has(instance.id)
								? 'opacity-100'
								: 'opacity-0'}"
							on:load={() => handleImageLoad(instance.id)}
						/>
					{:else}
						<div
							class="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
						>
							{getAppInitial(instance.type)}
						</div>
					{/if}
				</div>
				<div class="min-w-0">
					<h3 class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
						{instance.name}
					</h3>
					<div class="mt-1 flex flex-col items-start gap-1">
						<Badge variant="neutral">{appLabel}</Badge>
						{#if instance.enabled}
							<Badge variant="success">Enabled</Badge>
						{:else}
							<Badge variant="neutral">Disabled</Badge>
						{/if}
						<Badge variant="neutral" mono>{instance.url}</Badge>
					</div>
				</div>
			</div>

			<!-- Action buttons -->
			<div class="relative z-10 flex flex-shrink-0 items-center gap-1">
				<button
					type="button"
					on:click={(e) => handleExternalClick(e, instance.url)}
					class="rounded-md p-1.5 text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
				>
					<ExternalLink size={16} />
				</button>
				<button
					type="button"
					on:click={(e) => handleDeleteClick(e, instance)}
					class="rounded-md p-1.5 text-neutral-400 transition-colors hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400"
				>
					<Trash2 size={16} />
				</button>
			</div>
		</a>
	{/each}
</div>
