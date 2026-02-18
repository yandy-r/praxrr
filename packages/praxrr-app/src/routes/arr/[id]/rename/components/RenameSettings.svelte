<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { parseUTC } from '$shared/utils/dates';
	import FormInput from '$ui/form/FormInput.svelte';
	import DropdownSelect from '$ui/dropdown/DropdownSelect.svelte';
	import Toggle from '$ui/toggle/Toggle.svelte';

	export let enabled: boolean = false;
	export let dryRun: boolean = true;
	export let renameFolders: boolean = false;
	export let ignoreTag: string = '';
	export let schedule: string = '1440';
	export let summaryNotifications: boolean = true;
	export let lastRunAt: string | null = null;

	export let onEnabledChange: ((value: boolean) => void) | undefined = undefined;
	export let onDryRunChange: ((value: boolean) => void) | undefined = undefined;
	export let onRenameFoldersChange: ((value: boolean) => void) | undefined = undefined;
	export let onIgnoreTagChange: ((value: string) => void) | undefined = undefined;
	export let onScheduleChange: ((value: string) => void) | undefined = undefined;
	export let onSummaryNotificationsChange: ((value: boolean) => void) | undefined = undefined;

	const scheduleOptions = [
		{ value: '60', label: '1 hour' },
		{ value: '120', label: '2 hours' },
		{ value: '240', label: '4 hours' },
		{ value: '360', label: '6 hours' },
		{ value: '480', label: '8 hours' },
		{ value: '720', label: '12 hours' },
		{ value: '1440', label: '24 hours' },
		{ value: '2880', label: '2 days' },
		{ value: '10080', label: '1 week' }
	];

	// Cooldown tracking
	let now = Date.now();
	let interval: ReturnType<typeof setInterval>;

	onMount(() => {
		interval = setInterval(() => {
			now = Date.now();
		}, 1000);
	});

	onDestroy(() => {
		if (interval) clearInterval(interval);
	});

	$: scheduleMinutes = parseInt(schedule, 10);
	$: lastRunTime = parseUTC(lastRunAt)?.getTime() ?? null;
	$: scheduleMs = scheduleMinutes * 60 * 1000;
	$: nextRunTime = lastRunTime ? lastRunTime + scheduleMs : null;
	$: timeUntilNext = nextRunTime ? nextRunTime - now : null;

	function formatTimeRemaining(ms: number): string {
		if (ms <= 0) return 'now';
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		if (hours > 0) {
			const remainingMinutes = minutes % 60;
			return `${hours}h ${remainingMinutes}m`;
		}
		if (minutes > 0) {
			return `${minutes}m`;
		}
		return `${seconds}s`;
	}

	function formatLastRun(isoString: string): string {
		const date = parseUTC(isoString);
		if (!date) return '-';
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		let dateStr: string;
		if (date.toDateString() === today.toDateString()) {
			dateStr = 'Today';
		} else if (date.toDateString() === yesterday.toDateString()) {
			dateStr = 'Yesterday';
		} else {
			dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		}

		const timeStr = date.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});

		return `${dateStr}, ${timeStr}`;
	}
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
>
	<!-- Mobile: 2-column grid, Desktop: inline flex -->
	<div class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 md:flex md:flex-wrap md:gap-x-6">
		<!-- Status -->
		<span class="text-sm text-neutral-500 md:hidden dark:text-neutral-400">Status</span>
		<div class="md:flex md:items-center md:gap-2">
			<span class="hidden text-sm text-neutral-500 md:inline dark:text-neutral-400">Status:</span>
			<Toggle
				checked={enabled}
				label={enabled ? 'Enabled' : 'Disabled'}
				color={enabled ? 'green' : 'red'}
				on:change={(e) => onEnabledChange?.(e.detail)}
			/>
		</div>

		<!-- Dry Run -->
		<span class="text-sm text-neutral-500 md:hidden dark:text-neutral-400">Dry Run</span>
		<div class="md:flex md:items-center md:gap-2">
			<span class="hidden text-sm text-neutral-500 md:inline dark:text-neutral-400">Dry Run:</span>
			<Toggle
				checked={dryRun}
				label={dryRun ? 'On' : 'Off'}
				color={dryRun ? 'amber' : 'neutral'}
				checkboxColor={dryRun ? '#F59E0B' : 'neutral'}
				on:change={(e) => onDryRunChange?.(e.detail)}
			/>
		</div>

		<!-- Rename Folders -->
		<span class="text-sm text-neutral-500 md:hidden dark:text-neutral-400">Folders</span>
		<div class="md:flex md:items-center md:gap-2">
			<span class="hidden text-sm text-neutral-500 md:inline dark:text-neutral-400">Folders:</span>
			<Toggle
				checked={renameFolders}
				label={renameFolders ? 'On' : 'Off'}
				color={renameFolders ? 'accent' : 'neutral'}
				on:change={(e) => onRenameFoldersChange?.(e.detail)}
			/>
		</div>

		<!-- Summary Notifications -->
		<span class="text-sm text-neutral-500 md:hidden dark:text-neutral-400">Summary</span>
		<div class="md:flex md:items-center md:gap-2">
			<span class="hidden text-sm text-neutral-500 md:inline dark:text-neutral-400">Summary:</span>
			<Toggle
				checked={summaryNotifications}
				label={summaryNotifications ? 'On' : 'Off'}
				color={summaryNotifications ? 'accent' : 'neutral'}
				on:change={(e) => onSummaryNotificationsChange?.(e.detail)}
			/>
		</div>

		<!-- Divider (desktop only) -->
		<div class="hidden h-6 w-px bg-neutral-200 md:block dark:bg-neutral-700"></div>

		<!-- Schedule -->
		<span class="text-sm text-neutral-500 md:hidden dark:text-neutral-400">Schedule</span>
		<div class="md:flex md:items-center md:gap-2">
			<span class="hidden text-sm text-neutral-500 md:inline dark:text-neutral-400">Schedule:</span>
			<DropdownSelect
				value={schedule}
				options={scheduleOptions}
				on:change={(e) => onScheduleChange?.(e.detail)}
			/>
		</div>

		<!-- Ignore Tag -->
		<span class="text-sm text-neutral-500 md:hidden dark:text-neutral-400">Ignore Tag</span>
		<div class="md:flex md:items-center md:gap-2">
			<span class="hidden text-sm text-neutral-500 md:inline dark:text-neutral-400">Ignore Tag:</span>
			<FormInput
				label="Ignore Tag"
				hideLabel
				name="ignore-tag"
				size="md"
				value={ignoreTag}
				placeholder="no-rename"
				on:input={(e) => onIgnoreTagChange?.(e.detail)}
			/>
		</div>
	</div>

	<!-- Status info -->
	{#if lastRunAt}
		<div class="mt-4 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4 text-xs text-neutral-500 md:mt-3 md:border-0 md:pt-0 dark:border-neutral-700 dark:text-neutral-400">
			{#if !enabled}
				<span
					class="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
					>Paused</span
				>
			{:else if timeUntilNext !== null && timeUntilNext <= 0}
				<span
					class="rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-700 dark:bg-green-900/50 dark:text-green-400"
					>Ready</span
				>
			{:else if timeUntilNext !== null}
				<span>
					Next Run: <span
						class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
						>{formatTimeRemaining(timeUntilNext)}</span
					>
				</span>
			{/if}
			<span>
				Last Run: <span
					class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
					>{formatLastRun(lastRunAt)}</span
				>
			</span>
		</div>
	{/if}
</div>
