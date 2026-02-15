<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import CardGrid from '$ui/card/CardGrid.svelte';
	import Card from '$ui/card/Card.svelte';
	import Label from '$ui/label/Label.svelte';
	import Button from '$ui/button/Button.svelte';
	import { Copy, Download } from 'lucide-svelte';
	import type { NamingListItem } from '$shared/pcd/display.ts';
	import type { ArrAppType } from '$shared/arr/capabilities.ts';
	import radarrLogo from '$lib/client/assets/Radarr.svg';
	import sonarrLogo from '$lib/client/assets/Sonarr.svg';
	import lidarrLogo from '$lib/client/assets/Lidarr.png';
	import { getMediaManagementDisplayName } from '$shared/arr/displayName.ts';

	export let configs: NamingListItem[];
	export let databaseId: number;

	const dispatch = createEventDispatcher<{
		clone: { name: string; arr_type: string };
		export: { name: string; arr_type: string };
	}>();

	const supportedArrTypes: ArrAppType[] = ['radarr', 'sonarr', 'lidarr'];

	const logos: Partial<Record<ArrAppType, string>> = {
		radarr: radarrLogo,
		sonarr: sonarrLogo,
		lidarr: lidarrLogo
	};

	let loadedImages = new SvelteSet<string>();

	function handleImageLoad(name: string) {
		loadedImages.add(name);
	}

	function isSupportedArrType(arrType: string): arrType is ArrAppType {
		return supportedArrTypes.includes(arrType as ArrAppType);
	}

	function getConfigHref(config: NamingListItem): string {
		const trimmedName = config.name?.trim();
		if (!trimmedName || !isSupportedArrType(config.arr_type)) {
			return `/media-management/${databaseId}/naming`;
		}

		return `/media-management/${databaseId}/naming/${config.arr_type}/${encodeURIComponent(trimmedName)}`;
	}

	function getLogo(config: NamingListItem): string {
		if (!isSupportedArrType(config.arr_type)) {
			return '';
		}
		return logos[config.arr_type] ?? '';
	}

	function getArrTypeInitial(appType: string): string {
		if (!appType) {
			return '?';
		}
		return appType.charAt(0).toUpperCase();
	}
</script>

<CardGrid columns={1} flush>
	{#each configs as config (config.arr_type + ':' + config.name)}
		<Card href={getConfigHref(config)} hoverable>
			<div class="flex items-center gap-4">
				<!-- Logo + Name -->
				<div class="flex min-w-0 flex-1 items-center gap-3">
					<div class="relative h-10 w-10 flex-shrink-0">
						{#if !loadedImages.has(config.name)}
							<div
								class="absolute inset-0 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-700"
							></div>
						{/if}
						{#if getLogo(config)}
							<img
								src={getLogo(config)}
								alt="{config.arr_type} logo"
								class="h-10 w-10 rounded-lg {loadedImages.has(config.name)
									? 'opacity-100'
									: 'opacity-0'}"
								on:load={() => handleImageLoad(config.name)}
							/>
						{:else}
							<div
								class="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
							>
								{getArrTypeInitial(config.arr_type)}
							</div>
						{/if}
					</div>
					<div class="min-w-0">
						<h3 class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
							{getMediaManagementDisplayName(config.name, config.arr_type)}
						</h3>
						<div class="mt-1">
							{#if config.rename}
								<Label variant="success" size="sm" rounded="md">Rename Enabled</Label>
							{:else}
								<Label variant="secondary" size="sm" rounded="md">Rename Disabled</Label>
							{/if}
						</div>
					</div>
				</div>

				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
				<div class="flex items-center gap-0.5" on:click|stopPropagation|preventDefault>
					<Button
						icon={Download}
						size="xs"
						variant="ghost"
						tooltip="Export"
						on:click={() => dispatch('export', { name: config.name, arr_type: config.arr_type })}
					/>
					<Button
						icon={Copy}
						size="xs"
						variant="ghost"
						tooltip="Clone"
						on:click={() => dispatch('clone', { name: config.name, arr_type: config.arr_type })}
					/>
				</div>
			</div>
		</Card>
	{/each}
</CardGrid>
