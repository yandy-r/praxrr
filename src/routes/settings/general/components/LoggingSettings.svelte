<script lang="ts">
	import { enhance } from '$app/forms';
	import { alertStore } from '$alerts/store';
	import { Save, RotateCcw, Check } from 'lucide-svelte';
	import NumberInput from '$ui/form/NumberInput.svelte';
	import IconCheckbox from '$ui/form/IconCheckbox.svelte';
	import type { LogSettings } from './types';

	export let settings: LogSettings;

	// Default values
	const DEFAULTS = {
		retention_days: 30,
		min_level: 'INFO',
		enabled: true,
		file_logging: true,
		console_logging: true
	};

	// Reset to defaults (client-side only)
	function resetToDefaults() {
		settings.retention_days = DEFAULTS.retention_days;
		settings.min_level = DEFAULTS.min_level as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
		settings.enabled = DEFAULTS.enabled;
		settings.file_logging = DEFAULTS.file_logging;
		settings.console_logging = DEFAULTS.console_logging;
	}
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
	<!-- Header -->
	<div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">
			Logging Configuration
		</h2>
		<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
			Configure how Praxrr handles application logs, rotation, and retention
		</p>
	</div>

	<!-- Form -->
	<form
		method="POST"
		action="?/updateLogs"
		class="p-6"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add('error', (result.data as { error?: string }).error || 'Failed to save');
				} else if (result.type === 'success') {
					alertStore.add('success', 'Log settings saved successfully!');
				}
				await update();
			};
		}}
	>
		<div class="space-y-6">
			<!-- Toggles Section -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Enable Features</h3>
				<div class="space-y-2">
					<!-- Enable Logging -->
					<div class="flex items-center gap-3">
						<IconCheckbox
							icon={Check}
							checked={settings.enabled}
							on:click={() => (settings.enabled = !settings.enabled)}
						/>
						<input type="hidden" name="enabled" value={settings.enabled ? 'on' : ''} />
						<button
							type="button"
							class="flex-1 text-left"
							on:click={() => (settings.enabled = !settings.enabled)}
						>
							<span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
								Enable Logging
							</span>
							<p class="text-xs text-neutral-500 dark:text-neutral-400">
								Master switch for all logging functionality
							</p>
						</button>
					</div>

					<!-- File Logging -->
					<div class="flex items-center gap-3">
						<IconCheckbox
							icon={Check}
							checked={settings.file_logging}
							on:click={() => (settings.file_logging = !settings.file_logging)}
						/>
						<input type="hidden" name="file_logging" value={settings.file_logging ? 'on' : ''} />
						<button
							type="button"
							class="flex-1 text-left"
							on:click={() => (settings.file_logging = !settings.file_logging)}
						>
							<span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
								File Logging
							</span>
							<p class="text-xs text-neutral-500 dark:text-neutral-400">Write logs to disk</p>
						</button>
					</div>

					<!-- Console Logging -->
					<div class="flex items-center gap-3">
						<IconCheckbox
							icon={Check}
							checked={settings.console_logging}
							on:click={() => (settings.console_logging = !settings.console_logging)}
						/>
						<input
							type="hidden"
							name="console_logging"
							value={settings.console_logging ? 'on' : ''}
						/>
						<button
							type="button"
							class="flex-1 text-left"
							on:click={() => (settings.console_logging = !settings.console_logging)}
						>
							<span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
								Console Logging
							</span>
							<p class="text-xs text-neutral-500 dark:text-neutral-400">Output logs to terminal</p>
						</button>
					</div>
				</div>
			</div>

			<!-- Divider -->
			<div class="border-t border-neutral-200 dark:border-neutral-800"></div>

			<!-- Log Level -->
			<div>
				<label
					for="min_level"
					class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50"
				>
					Minimum Log Level
				</label>
				<select
					id="min_level"
					name="min_level"
					bind:value={settings.min_level}
					required
					class="block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
				>
					<option value="DEBUG">DEBUG - All logs including debug information</option>
					<option value="INFO">INFO - Informational messages and above</option>
					<option value="WARN">WARN - Warnings and errors only</option>
					<option value="ERROR">ERROR - Errors only</option>
				</select>
				<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
					Only log messages at or above this level will be recorded
				</p>
			</div>

			<!-- Divider -->
			<div class="border-t border-neutral-200 dark:border-neutral-800"></div>

			<!-- Retention -->
			<div>
				<h3 class="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
					Retention Policy
				</h3>
				<div>
					<label
						for="retention_days"
						class="mb-1 block text-sm font-medium text-neutral-900 dark:text-neutral-50"
					>
						Retention (days)
					</label>
					<NumberInput
						name="retention_days"
						id="retention_days"
						bind:value={settings.retention_days}
						min={1}
						max={365}
						required
					/>
					<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
						Keep daily log files for 1-365 days. Logs are automatically rotated daily
						(YYYY-MM-DD.log format).
					</p>
				</div>
			</div>
		</div>

		<!-- Action buttons -->
		<div
			class="mt-6 flex flex-col gap-3 border-t border-neutral-200 pt-6 md:flex-row md:items-center md:justify-between dark:border-neutral-800"
		>
			<button
				type="button"
				on:click={resetToDefaults}
				class="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
			>
				<RotateCcw size={16} />
				Reset to Defaults
			</button>

			<button
				type="submit"
				class="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600"
			>
				<Save size={16} />
				Save Settings
			</button>
		</div>
	</form>
</div>
