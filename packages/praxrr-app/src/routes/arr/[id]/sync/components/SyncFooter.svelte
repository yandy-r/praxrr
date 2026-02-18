<script lang="ts">
	import Button from '$ui/button/Button.svelte';
	import CronInput from '$ui/cron/CronInput.svelte';
	import Toggle from '$ui/toggle/Toggle.svelte';
	import { RefreshCw, Save, Loader2, AlertTriangle } from 'lucide-svelte';
	import { createEventDispatcher } from 'svelte';

	export let syncTrigger: 'manual' | 'on_pull' | 'on_change' | 'schedule' = 'manual';
	export let cronExpression: string = '0 * * * *';
	export let saving: boolean = false;
	export let syncing: boolean = false;
	export let isDirty: boolean = false;
	export let canSave: boolean = true;
	export let warning: string | null = null;

	const dispatch = createEventDispatcher<{ save: void; sync: void }>();

	const triggerOptions = [
		{ value: 'manual', label: 'Manual' },
		{ value: 'on_pull', label: 'On Pull' },
		{ value: 'on_change', label: 'On Change' },
		{ value: 'schedule', label: 'Schedule' }
	] as const;

	// Save disabled when not dirty or can't save, Sync disabled when dirty (unsaved changes)
	$: saveDisabled = saving || !isDirty || !canSave;
	$: syncDisabled = syncing || isDirty;

	function selectTrigger(value: (typeof triggerOptions)[number]['value'], enabled: boolean) {
		// Keep trigger single-select: selecting a toggle sets it; unchecking the active one is ignored.
		if (enabled) {
			syncTrigger = value;
		}
	}
</script>

<div class="border-t border-neutral-200 px-4 py-4 md:px-6 dark:border-neutral-800">
	<div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<!-- Trigger options -->
		<div class="flex flex-wrap items-center gap-3 md:gap-4">
			<span class="text-sm text-neutral-500 dark:text-neutral-400">Trigger</span>
			{#each triggerOptions as option}
				<Toggle
					checked={syncTrigger === option.value}
					label={option.label}
					ariaLabel={`Set trigger to ${option.label}`}
					on:change={(e) => selectTrigger(option.value, e.detail)}
				/>
			{/each}

			{#if syncTrigger === 'schedule'}
				<div class="min-w-[18rem] flex-1">
					<CronInput bind:value={cronExpression} disabled={saving} />
				</div>
			{/if}
		</div>

		<!-- Warning + Buttons -->
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
			{#if warning}
				<div class="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
					<AlertTriangle size={14} class="flex-shrink-0" />
					<span>{warning}</span>
				</div>
			{/if}
			<div class="flex items-center gap-3">
				<Button
					text="Sync Now"
					variant="secondary"
					disabled={syncDisabled}
					icon={syncing ? Loader2 : RefreshCw}
					iconColor={syncing
						? 'text-blue-600 dark:text-blue-400 animate-spin'
						: 'text-blue-600 dark:text-blue-400'}
					title={isDirty ? 'Save changes before syncing' : ''}
					on:click={() => dispatch('sync')}
				/>
				<Button
					text="Save"
					variant="secondary"
					disabled={saveDisabled}
					icon={saving ? Loader2 : Save}
					iconColor={saving
						? 'text-green-600 dark:text-green-400 animate-spin'
						: 'text-green-600 dark:text-green-400'}
					on:click={() => dispatch('save')}
				/>
			</div>
		</div>
	</div>
</div>
