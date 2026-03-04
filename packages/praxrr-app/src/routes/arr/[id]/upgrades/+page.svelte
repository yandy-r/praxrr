<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import type { FilterConfig, FilterMode } from '$shared/upgrades/filters';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { alertStore } from '$lib/client/alerts/store';
	import { isDirty, initEdit, update, current, clear } from '$lib/client/stores/dirty';
	import { Info, Save, Play, RotateCcw, Settings, History } from 'lucide-svelte';
	import CoreSettings from './components/CoreSettings.svelte';
	import FilterSettings from './components/FilterSettings.svelte';
	import RunHistory from './components/RunHistory.svelte';
	import DirtyModal from '$ui/modal/DirtyModal.svelte';
	import StickyCard from '$ui/card/StickyCard.svelte';
	import CollapsibleCard from '$ui/card/CollapsibleCard.svelte';
	import Button from '$ui/button/Button.svelte';
	import { ARR_UPGRADES_FILTER } from '$shared/disclosure/sectionKeys';

	export let data: PageData;
	export let form: ActionData;

	// Initialize dirty tracking on mount (same pattern as sync page)
	onMount(() => {
		const initialFormData = {
			enabled: data.config?.enabled ?? false,
			dryRun: data.config?.dryRun ?? true,
			schedule: String(data.config?.schedule ?? 360),
			filterMode: (data.config?.filterMode ?? 'round_robin') as FilterMode,
			filters: JSON.stringify(data.config?.filters ?? [])
		};
		// Always use initEdit - isDirty should be false until user makes changes
		initEdit(initialFormData);
		return () => clear();
	});

	// Track if config exists
	$: isNewConfig = !data.config;

	// Dev mode check - use VITE_CHANNEL which is explicitly set in dev mode
	const isDev = import.meta.env.VITE_CHANNEL === 'dev';

	let saving = false;
	let running = false;
	let clearing = false;

	// Read current values from dirty store (same pattern as working pages)
	$: enabled = ($current.enabled ?? false) as boolean;
	$: dryRun = ($current.dryRun ?? true) as boolean;
	$: schedule = ($current.schedule ?? '360') as string;
	$: filterMode = ($current.filterMode ?? 'round_robin') as FilterMode;
	$: filters = JSON.parse(($current.filters ?? '[]') as string) as FilterConfig[];

	// Handle form response - use a processed flag to avoid re-running on field changes
	let lastFormId: unknown = null;
	$: if (form && form !== lastFormId) {
		lastFormId = form;
		if (form.success && !form.queued && !form.cacheCleared) {
			alertStore.add('success', 'Configuration saved successfully');
			initEdit({ enabled, dryRun, schedule, filterMode, filters: JSON.stringify(filters) });
		}
		if (form.success && form.queued) {
			alertStore.add('success', 'Upgrade run queued');
		}
		if (form.success && form.cacheCleared) {
			alertStore.add('success', 'Dry run cache cleared');
		}
		if (form.error) {
			alertStore.add('error', form.error);
		}
	}
</script>

<svelte:head>
	<title>{data.instance.name} - Upgrades - Praxrr</title>
</svelte:head>

<StickyCard position="top">
	<div slot="left">
		<h1 class="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Upgrades</h1>
		<p class="text-sm text-neutral-500 dark:text-neutral-400">
			Automatically search for better quality releases.
		</p>
	</div>
	<div slot="right" class="flex items-center gap-2">
		<Button text="Info" icon={Info} href="/arr/upgrades/info" />
		{#if !isNewConfig && data.config?.dryRun}
			<Button
				text={clearing ? 'Clearing...' : 'Reset'}
				icon={RotateCcw}
				disabled={clearing || running || saving}
				on:click={() => {
					const clearForm = document.getElementById('clear-cache-form');
					if (clearForm instanceof HTMLFormElement) {
						clearForm.requestSubmit();
					}
				}}
			/>
			<Button
				text={running ? 'Running...' : 'Test'}
				icon={Play}
				iconColor="text-amber-600 dark:text-amber-400"
				disabled={running || saving || clearing || $isDirty}
				on:click={() => {
					const runForm = document.getElementById('run-form');
					if (runForm instanceof HTMLFormElement) {
						runForm.requestSubmit();
					}
				}}
			/>
		{:else if !isNewConfig && isDev}
			<Button
				text={running ? 'Running...' : 'Dev Run'}
				icon={Play}
				iconColor="text-red-600 dark:text-red-400"
				disabled={running || saving || $isDirty}
				on:click={() => {
					const runForm = document.getElementById('run-form');
					if (runForm instanceof HTMLFormElement) {
						runForm.requestSubmit();
					}
				}}
			/>
		{/if}
		<Button
			text={saving ? 'Saving...' : 'Save'}
			icon={Save}
			iconColor="text-blue-600 dark:text-blue-400"
			disabled={saving || running || !$isDirty}
			on:click={() => {
				const saveForm = document.getElementById('save-form');
				if (saveForm instanceof HTMLFormElement) {
					saveForm.requestSubmit();
				}
			}}
		/>
	</div>
</StickyCard>

<div class="mt-6 space-y-6">
	<section>
		<h2
			class="mb-3 flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100"
		>
			<Settings size={18} class="text-neutral-500 dark:text-neutral-400" />
			Settings
		</h2>
		<CoreSettings
			{enabled}
			{dryRun}
			{schedule}
			{filterMode}
			lastRunAt={data.config?.lastRunAt ?? null}
			onEnabledChange={(v) => update('enabled', v)}
			onDryRunChange={(v) => update('dryRun', v)}
			onScheduleChange={(v) => update('schedule', v)}
			onFilterModeChange={(v) => update('filterMode', v)}
		/>
	</section>

	<section>
		<CollapsibleCard title="Filters" sectionKey={ARR_UPGRADES_FILTER} defaultOpen={true}>
			<FilterSettings
				{filters}
				onFiltersChange={(v) => update('filters', JSON.stringify(v))}
			/>
		</CollapsibleCard>
	</section>
</div>

<section class="mt-6">
	<h2
		class="mb-3 flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-neutral-100"
	>
		<History size={18} class="text-neutral-500 dark:text-neutral-400" />
		Run History
	</h2>
	<RunHistory runs={data.upgradeRuns} />
</section>

<!-- Hidden forms -->
<form
	id="save-form"
	method="POST"
	action="?/save"
	class="hidden"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<input type="hidden" name="enabled" value={enabled} />
	<input type="hidden" name="dryRun" value={dryRun} />
	<input type="hidden" name="schedule" value={schedule} />
	<input type="hidden" name="filterMode" value={filterMode} />
	<input type="hidden" name="filters" value={JSON.stringify(filters)} />
</form>
{#if !isNewConfig && (data.config?.dryRun || isDev)}
	<form
		id="run-form"
		method="POST"
		action="?/run"
		class="hidden"
		use:enhance={() => {
			running = true;
			return async ({ update }) => {
				await update({ reset: false });
				running = false;
			};
		}}
	></form>
{/if}
{#if !isNewConfig && data.config?.dryRun}
	<form
		id="clear-cache-form"
		method="POST"
		action="?/clearCache"
		class="hidden"
		use:enhance={() => {
			clearing = true;
			return async ({ update }) => {
				await update({ reset: false });
				clearing = false;
			};
		}}
	></form>
{/if}

<DirtyModal />
