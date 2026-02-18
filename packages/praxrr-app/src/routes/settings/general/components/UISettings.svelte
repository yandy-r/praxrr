<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { navIconStore, type NavIconStyle } from '$stores/navIcons';
	import { alertSettingsStore, type AlertPosition, DEFAULT_ALERT_SETTINGS } from '$alerts/settings';
	import { alertStore } from '$alerts/store';
	import { AlertTriangle, Check, CheckCircle, Info, Save, XCircle } from 'lucide-svelte';
	import IconCheckbox from '$ui/form/IconCheckbox.svelte';
	import SearchDropdown from '$ui/form/SearchDropdown.svelte';
	import NumberInput from '$ui/form/NumberInput.svelte';

	const alertPositionOptions = [
		{ value: 'top-left', label: 'Top left' },
		{ value: 'top-center', label: 'Top center' },
		{ value: 'top-right', label: 'Top right' },
		{ value: 'bottom-left', label: 'Bottom left' },
		{ value: 'bottom-center', label: 'Bottom center' },
		{ value: 'bottom-right', label: 'Bottom right' }
	];

	let navIconStyle: NavIconStyle = 'lucide';
	let alertPosition: AlertPosition = DEFAULT_ALERT_SETTINGS.position;
	let alertDurationSeconds: number | undefined = Math.round(
		DEFAULT_ALERT_SETTINGS.durationMs / 1000
	);

	let savedNavIconStyle: NavIconStyle = navIconStyle;
	let savedAlertPosition: AlertPosition = alertPosition;
	let savedAlertDurationSeconds = alertDurationSeconds ?? 0;

	onMount(() => {
		savedNavIconStyle = get(navIconStore);
		navIconStyle = savedNavIconStyle;

		const settings = get(alertSettingsStore);
		savedAlertPosition = settings.position;
		alertPosition = savedAlertPosition;
		savedAlertDurationSeconds = Math.round(settings.durationMs / 1000);
		alertDurationSeconds = savedAlertDurationSeconds;
	});

	$: useEmojis = navIconStyle === 'emoji';
	$: normalizedDurationSeconds = alertDurationSeconds ?? savedAlertDurationSeconds;
	$: hasChanges =
		navIconStyle !== savedNavIconStyle ||
		alertPosition !== savedAlertPosition ||
		normalizedDurationSeconds !== savedAlertDurationSeconds;

	function toggleNavIcons() {
		navIconStyle = navIconStyle === 'emoji' ? 'lucide' : 'emoji';
	}

	function saveSettings() {
		const durationSeconds = alertDurationSeconds ?? savedAlertDurationSeconds;
		const durationMs = Math.max(0, Math.round(durationSeconds * 1000));

		navIconStore.setStyle(navIconStyle);
		alertSettingsStore.setSettings({ position: alertPosition, durationMs });

		savedNavIconStyle = navIconStyle;
		savedAlertPosition = alertPosition;
		savedAlertDurationSeconds = durationSeconds;
		alertDurationSeconds = durationSeconds;
		alertStore.add('success', 'Interface settings saved.');
	}
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
	<!-- Header -->
	<div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">Interface</h2>
		<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
			Customize the look and feel of the application
		</p>
	</div>

	<!-- Settings -->
	<div class="p-6">
		<div class="space-y-6">
			<div class="space-y-3">
				<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Navigation</h3>
				<div class="space-y-2">
					<div class="flex items-center gap-3">
						<IconCheckbox icon={Check} checked={useEmojis} on:click={toggleNavIcons} />
						<button type="button" class="flex-1 text-left" on:click={toggleNavIcons}>
							<span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
								Use Emojis
							</span>
							<p class="text-xs text-neutral-500 dark:text-neutral-400">
								Show emojis instead of icons in the sidebar navigation
							</p>
						</button>
					</div>
				</div>
			</div>

			<div class="space-y-3">
				<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Alerts</h3>
				<div class="space-y-4">
					<div>
						<label
							for="alert_position"
							class="mb-1 block text-sm font-medium text-neutral-900 dark:text-neutral-50"
						>
							Position
						</label>
						<SearchDropdown
							name="alert_position"
							label="Position"
							options={alertPositionOptions}
							value={alertPosition}
							on:change={(event) => (alertPosition = event.detail as AlertPosition)}
						/>
						<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
							Choose where alerts appear on the screen. On mobile, only top or bottom applies.
						</p>
					</div>

					<div>
						<label
							for="alert_duration"
							class="mb-1 block text-sm font-medium text-neutral-900 dark:text-neutral-50"
						>
							Duration (seconds)
						</label>
						<NumberInput
							name="alert_duration"
							id="alert_duration"
							value={alertDurationSeconds}
							min={0}
							step={1}
							onchange={(value) => (alertDurationSeconds = value)}
						/>
						<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
							Set to 0 to keep alerts until dismissed.
						</p>
					</div>

				</div>
			</div>
		</div>

		<div
			class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-6 dark:border-neutral-800"
		>
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
					Test Alerts
				</span>
				<button
					type="button"
					on:click={() => alertStore.add('success', 'Success alert example.')}
					class="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
				>
					<CheckCircle size={14} class="text-green-600 dark:text-green-400" />
					Success
				</button>
				<button
					type="button"
					on:click={() => alertStore.add('error', 'Error alert example.')}
					class="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
				>
					<XCircle size={14} class="text-red-600 dark:text-red-400" />
					Error
				</button>
				<button
					type="button"
					on:click={() => alertStore.add('warning', 'Warning alert example.')}
					class="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
				>
					<AlertTriangle size={14} class="text-yellow-500 dark:text-yellow-400" />
					Warning
				</button>
				<button
					type="button"
					on:click={() => alertStore.add('info', 'Info alert example.')}
					class="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
				>
					<Info size={14} class="text-blue-600 dark:text-blue-400" />
					Info
				</button>
			</div>
			<button
				type="button"
				on:click={saveSettings}
				disabled={!hasChanges}
				class="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-accent-500 dark:hover:bg-accent-600"
			>
				<Save size={16} />
				Save Settings
			</button>
		</div>
	</div>
</div>
