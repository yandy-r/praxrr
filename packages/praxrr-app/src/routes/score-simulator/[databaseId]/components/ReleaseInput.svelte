<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { AlertTriangle, ChevronDown, Clapperboard, Loader2, Film, Tv } from 'lucide-svelte';
	import { clickOutside } from '$lib/client/utils/clickOutside';
	import Dropdown from '$ui/dropdown/Dropdown.svelte';
	import DropdownItem from '$ui/dropdown/DropdownItem.svelte';

	type MediaType = 'movie' | 'series';
	type ArrType = 'radarr' | 'sonarr' | null;

	interface QualityProfileOption {
		id: number;
		name: string;
	}

	interface ReleaseInputEvents {
		input: { title: string };
		profileChange: { profileName: string | null };
		arrTypeChange: { arrType: ArrType };
	}

	export let title: string;
	export let mediaType: MediaType;
	export let arrType: ArrType;
	export let qualityProfiles: QualityProfileOption[];
	export let selectedProfileName: string | null;
	export let isSimulating: boolean;
	export let parserAvailable: boolean;

	const dispatch = createEventDispatcher<ReleaseInputEvents>();

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let profileDropdownOpen = false;

	$: canSimulate = arrType !== null && Boolean(selectedProfileName);

	function scheduleInputDispatch() {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		debounceTimer = setTimeout(() => {
			dispatch('input', { title });
		}, 300);
	}

	function handleTitleInput(event: Event) {
		title = (event.currentTarget as HTMLTextAreaElement).value;
		scheduleInputDispatch();
	}

	function selectMediaType(nextMediaType: MediaType) {
		mediaType = nextMediaType;
	}

	function selectArrType(nextArrType: Exclude<ArrType, null>) {
		arrType = nextArrType;
		dispatch('arrTypeChange', { arrType: nextArrType });
	}

	function selectProfile(profileName: string | null) {
		selectedProfileName = profileName;
		profileDropdownOpen = false;
		dispatch('profileChange', { profileName });
	}

	function triggerSimulateNow() {
		if (!canSimulate || isSimulating) {
			return;
		}

		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}

		dispatch('input', { title });
	}

	onDestroy(() => {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
	});
</script>

<div class="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
	<div class="space-y-1">
		<h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Release Input</h2>
		<p class="text-xs text-neutral-500 dark:text-neutral-400">
			Enter a release title, then choose media type, arr type, and quality profile.
		</p>
	</div>

	{#if !parserAvailable}
		<div
			class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200"
		>
			<AlertTriangle size={14} class="mt-0.5 shrink-0" />
			<p>
				Parser service unavailable. Score simulation requires parser output to evaluate release titles.
			</p>
		</div>
	{/if}

	<div class="space-y-1.5">
		<label for="score-simulator-title" class="text-xs font-medium text-neutral-700 dark:text-neutral-300">
			Release Title
		</label>
		<textarea
			id="score-simulator-title"
			class="h-24 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-accent-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-accent-400"
			placeholder="Movie.2024.2160p.WEB-DL.DDP5.1.H.265-GROUP"
			value={title}
			on:input={handleTitleInput}
		></textarea>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div class="space-y-1.5">
			<p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Media Type</p>
			<div class="grid grid-cols-2 gap-2">
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {mediaType ===
					'movie'
						? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
						: 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
					on:click={() => selectMediaType('movie')}
				>
					<Film size={14} />
					Movie
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {mediaType ===
					'series'
						? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
						: 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
					on:click={() => selectMediaType('series')}
				>
					<Tv size={14} />
					Series
				</button>
			</div>
		</div>

		<div class="space-y-1.5">
			<p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Arr Type</p>
			<div class="grid grid-cols-2 gap-2">
				<button
					type="button"
					class="rounded-lg border px-3 py-2 text-xs font-medium transition-colors {arrType ===
					'radarr'
						? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
						: 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
					on:click={() => selectArrType('radarr')}
				>
					Radarr
				</button>
				<button
					type="button"
					class="rounded-lg border px-3 py-2 text-xs font-medium transition-colors {arrType ===
					'sonarr'
						? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
						: 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
					on:click={() => selectArrType('sonarr')}
				>
					Sonarr
				</button>
			</div>
			{#if arrType === null}
				<p class="text-[11px] text-amber-700 dark:text-amber-300">Select an arr type to continue.</p>
			{/if}
		</div>
	</div>

	<div class="space-y-1.5">
		<p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Quality Profile</p>
		<div class="relative" use:clickOutside={() => (profileDropdownOpen = false)}>
			<button
				type="button"
				class="inline-flex w-full items-center justify-between rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
				on:click={() => (profileDropdownOpen = !profileDropdownOpen)}
			>
				<span class={selectedProfileName ? '' : 'text-neutral-400 dark:text-neutral-500'}>
					{selectedProfileName ?? 'Select quality profile...'}
				</span>
				<ChevronDown size={14} class="text-neutral-500 dark:text-neutral-400" />
			</button>

			{#if profileDropdownOpen}
				<Dropdown position="left" minWidth="100%">
					<DropdownItem
						label="No Profile"
						selected={selectedProfileName === null}
						on:click={() => selectProfile(null)}
					/>
					{#each qualityProfiles as profile (profile.id)}
						<DropdownItem
							label={profile.name}
							selected={selectedProfileName === profile.name}
							on:click={() => selectProfile(profile.name)}
						/>
					{/each}
				</Dropdown>
			{/if}
		</div>
	</div>

	<div class="flex items-center justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
			disabled={!canSimulate || isSimulating}
			on:click={triggerSimulateNow}
		>
			{#if isSimulating}
				<Loader2 size={14} class="animate-spin" />
			{:else}
				<Clapperboard size={14} />
			{/if}
			{isSimulating ? 'Simulating...' : 'Simulate'}
		</button>
	</div>
</div>
