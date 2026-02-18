<script lang="ts">
	import { enhance } from '$app/forms';
	import { alertStore } from '$alerts/store';
	import { Save, RotateCcw, Eye, EyeOff, Check } from 'lucide-svelte';
	import IconCheckbox from '$ui/form/IconCheckbox.svelte';
	import type { AISettings } from './types';

	export let settings: AISettings;

	let showApiKey = false;

	// Default values
	const DEFAULTS = {
		enabled: false,
		api_url: 'https://api.openai.com/v1',
		api_key: '',
		model: 'gpt-4o-mini'
	};

	function resetToDefaults() {
		settings.enabled = DEFAULTS.enabled;
		settings.api_url = DEFAULTS.api_url;
		settings.api_key = DEFAULTS.api_key;
		settings.model = DEFAULTS.model;
	}
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
	<!-- Header -->
	<div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">AI Configuration</h2>
		<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
			Configure AI-powered features like commit message generation. Works with OpenAI, Ollama, LM
			Studio, or any OpenAI-compatible API.
		</p>
	</div>

	<!-- Form -->
	<form
		method="POST"
		action="?/updateAI"
		class="p-6"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add('error', (result.data as { error?: string }).error || 'Failed to save');
				} else if (result.type === 'success') {
					alertStore.add('success', 'AI settings saved successfully!');
				}
				await update();
			};
		}}
	>
		<div class="space-y-6">
			<!-- Enable Toggle -->
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
						Enable AI Features
					</span>
					<p class="text-xs text-neutral-500 dark:text-neutral-400">
						Enable AI-powered commit message generation
					</p>
				</button>
			</div>

			{#if settings.enabled}
				<!-- Divider -->
				<div class="border-t border-neutral-200 dark:border-neutral-800"></div>

				<!-- API URL -->
				<div>
					<label
						for="api_url"
						class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50"
					>
						API URL
					</label>
					<input
						type="url"
						id="api_url"
						name="api_url"
						bind:value={settings.api_url}
						placeholder="https://api.openai.com/v1"
						class="block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:placeholder-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
					/>
					<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
						OpenAI-compatible endpoint. Examples: Ollama (http://localhost:11434/v1), LM Studio
						(http://localhost:1234/v1)
					</p>
				</div>

				<!-- API Key -->
				<div>
					<label
						for="api_key"
						class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50"
					>
						API Key
					</label>
					<div class="relative">
						<input
							type={showApiKey ? 'text' : 'password'}
							id="api_key"
							name="api_key"
							bind:value={settings.api_key}
							placeholder="sk-..."
							class="block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-10 font-mono text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:placeholder-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
						/>
						<button
							type="button"
							on:click={() => (showApiKey = !showApiKey)}
							class="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
						>
							{#if showApiKey}
								<EyeOff size={16} />
							{:else}
								<Eye size={16} />
							{/if}
						</button>
					</div>
					<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
						Required for cloud providers. Leave empty for local APIs like Ollama.
					</p>
				</div>

				<!-- Model -->
				<div>
					<label
						for="model"
						class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50"
					>
						Model
					</label>
					<input
						type="text"
						id="model"
						name="model"
						bind:value={settings.model}
						placeholder="gpt-4o-mini"
						class="block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:placeholder-neutral-500 dark:focus:border-neutral-500 dark:focus:ring-neutral-500"
					/>
					<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
						Model name. Examples: gpt-4o-mini, llama3.2, claude-3-haiku
					</p>
				</div>
			{/if}
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
