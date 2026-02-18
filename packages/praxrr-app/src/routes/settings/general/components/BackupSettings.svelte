<script lang="ts">
	import { enhance } from '$app/forms';
	import { alertStore } from '$alerts/store';
	import { Save, Check } from 'lucide-svelte';
	import NumberInput from '$ui/form/NumberInput.svelte';
	import IconCheckbox from '$ui/form/IconCheckbox.svelte';
	import type { BackupSettings } from './types';

	export let settings: BackupSettings;
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
	<!-- Header -->
	<div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">
			Backup Configuration
		</h2>
		<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
			Configure automatic backups, schedule, and retention policy
		</p>
	</div>

	<!-- Form -->
	<form
		method="POST"
		action="?/updateBackups"
		class="p-6"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add('error', (result.data as { error?: string }).error || 'Failed to save');
				} else if (result.type === 'success') {
					alertStore.add('success', 'Backup settings saved successfully!');
				}
				await update();
			};
		}}
	>
		<div class="space-y-6">
			<!-- Enable Backups -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Enable Features</h3>
				<div class="space-y-2">
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
								Enable Automatic Backups
							</span>
							<p class="text-xs text-neutral-500 dark:text-neutral-400">
								Automatically create backups according to the schedule
							</p>
						</button>
					</div>

					<div class="flex items-center gap-3">
						<IconCheckbox
							icon={Check}
							checked={settings.compression_enabled}
							on:click={() => (settings.compression_enabled = !settings.compression_enabled)}
						/>
						<input
							type="hidden"
							name="compression_enabled"
							value={settings.compression_enabled ? 'on' : ''}
						/>
						<button
							type="button"
							class="flex-1 text-left"
							on:click={() => (settings.compression_enabled = !settings.compression_enabled)}
						>
							<span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
								Enable Compression
							</span>
							<p class="text-xs text-neutral-500 dark:text-neutral-400">
								Compress backups to save disk space
							</p>
						</button>
					</div>
				</div>
			</div>

			<!-- Schedule Configuration -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Backup Schedule</h3>
				<div class="space-y-2">
					<label class="block">
						<span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
							Schedule
						</span>
						<select
							name="schedule"
							bind:value={settings.schedule}
							class="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
						>
							<option value="daily">Daily</option>
							<option value="weekly">Weekly</option>
							<option value="monthly">Monthly</option>
							<option value="hourly">Hourly</option>
							<option value="*/6 hours">Every 6 hours</option>
							<option value="*/12 hours">Every 12 hours</option>
						</select>
						<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
							How often to create automatic backups
						</p>
					</label>
				</div>
			</div>

			<!-- Retention Policy -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
					Retention Policy
				</h3>
				<div class="space-y-2">
					<label class="block">
						<span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
							Retention Period (days)
						</span>
						<NumberInput
							name="retention_days"
							bind:value={settings.retention_days}
							min={1}
							max={365}
						/>
						<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
							Delete backups older than this many days
						</p>
					</label>
				</div>
			</div>

			<!-- Action Buttons -->
			<div class="flex justify-end gap-3 border-t border-neutral-200 pt-6 dark:border-neutral-800">
				<button
					type="submit"
					class="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600"
				>
					<Save size={16} />
					Save Changes
				</button>
			</div>
		</div>
	</form>
</div>
