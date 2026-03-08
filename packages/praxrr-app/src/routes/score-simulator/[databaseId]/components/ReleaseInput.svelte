<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { AlertTriangle, BookOpen, ChevronDown, Clapperboard, Loader2, Film, Tv } from 'lucide-svelte';
	import { clickOutside } from '$lib/client/utils/clickOutside';
	import Dropdown from '$ui/dropdown/Dropdown.svelte';
	import DropdownItem from '$ui/dropdown/DropdownItem.svelte';
	import type { PresetCategory, SimulatorProfileOption } from '../helpers.ts';

	interface ReleaseInputEvents {
		input: { title: string };
		profileChange: { profileName: string | null };
		tryExampleRelease: undefined;
		clear: undefined;
	}

	export let title: string;
	export let sampleCategory: PresetCategory;
	export let qualityProfiles: SimulatorProfileOption[];
	export let selectedProfileName: string | null;
	export let isSimulating: boolean;
	export let parserAvailable: boolean;
	export let canClear: boolean = false;
	export let showQuickStart: boolean = false;

	const dispatch = createEventDispatcher<ReleaseInputEvents>();

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let profileDropdownOpen = false;

	$: canSimulate = Boolean(selectedProfileName);

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

	function selectAppType(nextCategory: PresetCategory) {
		sampleCategory = nextCategory;
		dispatch('input', { title });
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

	function handleClear() {
		if (isSimulating || !canClear) {
			return;
		}
		dispatch('clear');
	}

	onDestroy(() => {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
	});
</script>

<div class="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
	<div class="space-y-1">
		<h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
			Single Release Score Simulation
		</h2>
		<p class="text-xs text-neutral-500 dark:text-neutral-400">
			Enter a release title, then choose media type and quality profile.
		</p>
	</div>

	{#if showQuickStart}
		<div
			class="space-y-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/40"
		>
			<div class="space-y-1">
				<h3 class="text-xs font-semibold text-neutral-900 dark:text-neutral-100">Start in 3 steps</h3>
				<ol class="space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
					<li>1. Choose profile</li>
					<li>2. Paste release title</li>
					<li>3. Run simulation</li>
				</ol>
			</div>
			<p class="text-xs text-neutral-500 dark:text-neutral-400">
				Simulation changes are temporary until you save on the scoring page.
			</p>
		</div>
	{/if}

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

	<div class="space-y-1.5">
		<div class="space-y-1.5">
			<p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">Media Type</p>
			<div class="grid grid-cols-3 gap-2">
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {sampleCategory ===
					'movie'
						? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
						: 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
					on:click={() => selectAppType('movie')}
				>
					<Film size={14} />
					Movie
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {sampleCategory ===
					'series'
						? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
						: 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
					on:click={() => selectAppType('series')}
				>
					<Tv size={14} />
					Series
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {sampleCategory ===
					'anime'
						? 'border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-400 dark:bg-accent-900/30 dark:text-accent-200'
						: 'border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
					on:click={() => selectAppType('anime')}
				>
					<Tv size={14} />
					Anime
				</button>
			</div>
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
					{qualityProfiles.find((profile) => profile.value === selectedProfileName)?.displayName ??
						'Select quality profile...'}
				</span>
				<ChevronDown size={14} class="text-neutral-500 dark:text-neutral-400" />
			</button>

			{#if profileDropdownOpen}
				<Dropdown position="left" minWidth="100%">
					<div class="max-h-80 overflow-y-auto py-1">
						<DropdownItem
							label="No Profile"
							selected={selectedProfileName === null}
							onSelect={() => selectProfile(null)}
						/>
						{#each qualityProfiles as profile (profile.id)}
							<DropdownItem
								label={profile.displayName ?? profile.name}
								selected={selectedProfileName === profile.value}
								onSelect={() => selectProfile(profile.value)}
							/>
						{/each}
					</div>
				</Dropdown>
			{/if}
		</div>
	</div>

	<div class="flex items-center justify-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
			on:click={() => dispatch('tryExampleRelease')}
		>
			<BookOpen size={14} />
			Try example release
		</button>
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-100 {canClear
				? 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
				: 'pointer-events-none cursor-default border-neutral-200 bg-neutral-50 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'}"
			disabled={isSimulating || !canClear}
			on:click={handleClear}
		>
			Clear
		</button>
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
