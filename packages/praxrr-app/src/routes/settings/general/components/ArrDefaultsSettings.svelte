<script lang="ts">
	import { enhance } from '$app/forms';
	import { alertStore } from '$alerts/store';
	import { Save, Check } from 'lucide-svelte';
	import IconCheckbox from '$ui/form/IconCheckbox.svelte';
	import type { GeneralSettings } from './types';

	export let settings: GeneralSettings;
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
	<!-- Header -->
	<div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">
			Arr Instance Defaults
		</h2>
		<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
			Configure default settings applied when adding new Radarr/Sonarr instances
		</p>
	</div>

	<!-- Form -->
	<form
		method="POST"
		action="?/updateArrDefaults"
		class="p-6"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add('error', (result.data as { error?: string }).error || 'Failed to save');
				} else if (result.type === 'success') {
					alertStore.add('success', 'Arr default settings saved successfully!');
				}
				await update();
			};
		}}
	>
		<div class="space-y-6">
			<!-- Delay Profile Defaults -->
			<div class="space-y-3">
				<h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-50">Delay Profiles</h3>
				<div class="space-y-2">
					<div class="flex items-center gap-3">
						<IconCheckbox
							icon={Check}
							checked={settings.apply_default_delay_profiles}
							on:click={() =>
								(settings.apply_default_delay_profiles = !settings.apply_default_delay_profiles)}
						/>
						<input
							type="hidden"
							name="apply_default_delay_profiles"
							value={settings.apply_default_delay_profiles ? 'on' : ''}
						/>
						<button
							type="button"
							class="flex-1 text-left"
							on:click={() =>
								(settings.apply_default_delay_profiles = !settings.apply_default_delay_profiles)}
						>
							<span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
								Apply Default Delay Profile
							</span>
							<p class="text-xs text-neutral-500 dark:text-neutral-400">
								Automatically configure the default delay profile when adding new arr instances
							</p>
						</button>
					</div>
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
