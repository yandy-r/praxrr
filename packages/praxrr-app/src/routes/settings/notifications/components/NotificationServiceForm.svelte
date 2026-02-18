<script lang="ts">
	import { enhance } from '$app/forms';
	import { alertStore } from '$alerts/store';
	import DiscordConfiguration from './DiscordConfiguration.svelte';
	import { siDiscord } from 'simple-icons';
	import { groupNotificationTypesByCategory } from '$shared/notifications/types';
	import { Plus, Save, Check } from 'lucide-svelte';
	import IconCheckbox from '$ui/form/IconCheckbox.svelte';

	export let mode: 'create' | 'edit' = 'create';
	export let initialData: {
		name?: string;
		serviceType?: string;
		config?: Record<string, unknown>;
		enabledTypes?: string[];
	} = {};

	let selectedType: 'discord' | 'slack' | 'email' =
		(initialData.serviceType as 'discord') || 'discord';
	let serviceName = initialData.name || '';

	// Group notification types by category
	const groupedTypes = groupNotificationTypesByCategory();

	// Track enabled types state
	let enabledTypesState: Record<string, boolean> = {};

	// Initialize enabled types from initialData
	$: {
		for (const [, types] of Object.entries(groupedTypes)) {
			for (const type of types) {
				if (enabledTypesState[type.id] === undefined) {
					enabledTypesState[type.id] = initialData.enabledTypes?.includes(type.id) || false;
				}
			}
		}
	}
</script>

<form
	method="POST"
	action="?/{mode}"
	use:enhance={() => {
		return async ({ result, update }) => {
			if (result.type === 'failure' && result.data) {
				alertStore.add(
					'error',
					(result.data as { error?: string }).error || `Failed to ${mode} service`
				);
			} else if (result.type === 'redirect') {
				alertStore.add(
					'success',
					`Notification service ${mode === 'create' ? 'created' : 'updated'} successfully`
				);
			}
			await update();
		};
	}}
	class="space-y-6"
>
	<!-- Basic Settings -->
	<div
		class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
	>
		<h2 class="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">Basic Settings</h2>

		<div class="space-y-4">
			<!-- Service Type -->
			<div>
				<label for="type" class="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
					Service Type
					<span class="text-red-500">*</span>
				</label>
				<div class="relative mt-1">
					<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
						{#if selectedType === 'discord'}
							<svg
								role="img"
								viewBox="0 0 24 24"
								class="h-4 w-4 text-neutral-600 dark:text-neutral-400"
								fill="currentColor"
							>
								<path d={siDiscord.path} />
							</svg>
						{/if}
					</div>
					<select
						id="type"
						name="type"
						bind:value={selectedType}
						required
						disabled={mode === 'edit'}
						class="block w-full rounded-lg border border-neutral-300 bg-white py-2 pr-3 pl-10 text-sm text-neutral-900 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
					>
						<option value="discord">Discord</option>
					</select>
				</div>
				{#if mode === 'edit'}
					<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
						Service type cannot be changed after creation
					</p>
				{/if}
			</div>

			<!-- Service Name -->
			<div>
				<label for="name" class="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
					Service Name
					<span class="text-red-500">*</span>
				</label>
				<input
					type="text"
					id="name"
					name="name"
					bind:value={serviceName}
					required
					placeholder="e.g., Main Discord Server"
					class="mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
				/>
				<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
					A friendly name to identify this notification service
				</p>
			</div>
		</div>
	</div>

	<!-- Service Configuration -->
	{#if selectedType === 'discord'}
		<DiscordConfiguration config={initialData.config} {mode} />
	{/if}

	<!-- Notification Types -->
	<div
		class="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900"
	>
		<h2 class="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
			Notification Types
		</h2>
		<p class="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
			Select which types of notifications should be sent to this service
		</p>

		<div class="space-y-4">
			{#each Object.entries(groupedTypes) as [category, types]}
				<div>
					<h3 class="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
						{category}
					</h3>
					<div class="space-y-2">
						{#each types as type}
							<div class="flex items-center gap-3">
								<IconCheckbox
									icon={Check}
									checked={enabledTypesState[type.id]}
									on:click={() => (enabledTypesState[type.id] = !enabledTypesState[type.id])}
								/>
								<input
									type="hidden"
									name={type.id}
									value={enabledTypesState[type.id] ? 'on' : ''}
								/>
								<button
									type="button"
									class="text-sm text-neutral-700 dark:text-neutral-300"
									on:click={() => (enabledTypesState[type.id] = !enabledTypesState[type.id])}
								>
									{type.label}
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Actions -->
	<div class="flex justify-end gap-3">
		<a
			href="/settings/notifications"
			class="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
		>
			Cancel
		</a>
		<button
			type="submit"
			class="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600"
		>
			{#if mode === 'create'}
				<Plus size={16} />
				Create Service
			{:else}
				<Save size={16} />
				Update Service
			{/if}
		</button>
	</div>
</form>
