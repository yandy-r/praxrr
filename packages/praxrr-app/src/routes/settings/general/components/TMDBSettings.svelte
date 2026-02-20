<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { alertStore } from '$alerts/store';
	import { Save, RotateCcw, Eye, EyeOff, FlaskConical, Loader2 } from 'lucide-svelte';
	import MaskedApiKey from '$ui/form/MaskedApiKey.svelte';
	import type { TMDBSettings } from './types';

	export let settings: TMDBSettings;

	let showApiKey = false;
	let isTesting = false;
	let apiKeyInput = '';
	let isKeyRevealed = false;
	let revealedApiKey = '';
	let remaskSession = 0;
	let revealInProgress = false;
	let copyAfterReveal = false;
	let revealSubmitButton: HTMLButtonElement | null = null;
	let revealRequestToken = 0;
	let pendingRevealRequestToken = 0;
	let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
	const revealTimeoutMs = 30_000;
	$: hasStoredKey = settings.has_api_key || Boolean(settings.api_key_masked);

	const DEFAULTS = {
		apiKey: ''
	};

	$: maskedApiKeyValue = isKeyRevealed && revealedApiKey ? revealedApiKey : settings.api_key_masked;
	$: plainApiKeyValue = isKeyRevealed && revealedApiKey ? revealedApiKey : '';

	function clearAutoHideTimer() {
		if (autoHideTimer) {
			clearTimeout(autoHideTimer);
			autoHideTimer = null;
		}
	}

	function setRevealedApiKey(value: string) {
		isKeyRevealed = Boolean(value);
		revealedApiKey = value;

		clearAutoHideTimer();
		if (isKeyRevealed) {
			autoHideTimer = setTimeout(() => {
				setRevealedApiKey('');
			}, revealTimeoutMs);
		}

		remaskSession += 1;
	}

	function requestReveal(showError = false) {
		if (!hasStoredKey || !revealSubmitButton) {
			if (showError) {
				alertStore.add('error', 'Unable to retrieve API key');
			}
			return;
		}

		pendingRevealRequestToken = ++revealRequestToken;
		revealInProgress = true;
		revealSubmitButton.click();
	}

	function resetToDefaults() {
		apiKeyInput = DEFAULTS.apiKey;
		setRevealedApiKey('');
	}

	function handleRevealChange(event: CustomEvent<{ revealed: boolean; reason: 'manual' | 'timeout' }>) {
		if (!event.detail.revealed) {
			setRevealedApiKey('');
			return;
		}

		requestReveal();
	}

	function handleCopyFeedback(event: CustomEvent<{ success: boolean; message: string; error?: Error }>) {
		if (event.detail.success) {
			alertStore.add('success', 'API key copied to clipboard');
			return;
		}

		if (event.detail.error?.message === 'Missing key value') {
			copyAfterReveal = true;
			requestReveal();
			return;
		}

		alertStore.add('error', event.detail.message || 'Copy failed');
	}

	async function copyRevealedApiKey() {
		if (!revealedApiKey) {
			return;
		}

		try {
			await navigator.clipboard.writeText(revealedApiKey);
			alertStore.add('success', 'API key copied to clipboard');
		} catch {
			alertStore.add('error', 'Could not copy API key');
		}
	}

	onDestroy(() => {
		clearAutoHideTimer();
	});

	async function testConnection() {
		if (!apiKeyInput) {
			alertStore.add('error', 'Please enter an API key first');
			return;
		}

		isTesting = true;
		try {
			const response = await fetch('/api/tmdb/test', {
				method: 'POST',
			headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ apiKey: apiKeyInput })
			});
			const data = await response.json();

			if (data.success) {
				alertStore.add('success', 'TMDB connection successful!');
			} else {
				alertStore.add('error', data.error || 'Connection failed');
			}
		} catch {
			alertStore.add('error', 'Failed to test connection');
		} finally {
			isTesting = false;
		}
	}
</script>

<div
	class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
	<!-- Header -->
	<div class="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
		<h2 class="text-lg font-semibold text-neutral-900 md:text-xl dark:text-neutral-50">TMDB Configuration</h2>
		<p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
			Configure TMDB API access for searching movies and TV series.
		</p>
	</div>

	<!-- Form -->
	<form
		method="POST"
		action="?/updateTMDB"
		class="p-6"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'failure' && result.data) {
					alertStore.add('error', (result.data as { error?: string }).error || 'Failed to save');
				} else if (result.type === 'success') {
					alertStore.add('success', 'TMDB settings saved successfully!');
				}
				await update();
			};
		}}
	>
		<div class="space-y-6">
			<!-- Stored API Read Access Token -->
			<div>
				<label
					for="tmdb_stored_api_key"
					class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50"
				>
					Stored API Read Access Token
				</label>
				{#key remaskSession}
					<MaskedApiKey
						id="tmdb_stored_api_key"
						label="API Read Access Token"
						maskedValue={maskedApiKeyValue}
						value={plainApiKeyValue}
						hasValue={settings.has_api_key}
						revealLabel="Show"
						hideLabel="Hide"
						copyLabel="Copy"
						disabled={revealInProgress}
						on:revealChange={handleRevealChange}
						on:copyFeedback={handleCopyFeedback}
					/>
				{/key}
				<p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
					Use the API Read Access Token (not API Key) from
					<a
						href="https://www.themoviedb.org/settings/api"
						target="_blank"
						rel="noopener noreferrer"
						class="text-accent-600 hover:underline dark:text-accent-400"
					>themoviedb.org</a
					>
				</p>
			</div>

			<!-- Update API Read Access Token -->
			<div>
				<label
					for="tmdb_api_key"
					class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50"
				>
					Update API Read Access Token
				</label>
				<div class="relative">
					<input
						type={showApiKey ? 'text' : 'password'}
						id="tmdb_api_key"
						name="api_key"
						bind:value={apiKeyInput}
						placeholder="Enter new token to save"
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

			<div class="flex items-center gap-2">
				<button
					type="button"
					on:click={testConnection}
					disabled={isTesting}
					class="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
				>
					{#if isTesting}
						<Loader2 size={16} class="animate-spin" />
					{:else}
						<FlaskConical size={16} />
					{/if}
					Test
				</button>

				<button
					type="submit"
					class="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600"
				>
					<Save size={16} />
					Save Settings
				</button>
			</div>
			</div>
		</form>

		<form
			method="POST"
			action="?/revealTMDB"
			class="hidden"
			use:enhance={() => {
				const requestToken = pendingRevealRequestToken;
				return async ({ result, update }) => {
					if (requestToken !== revealRequestToken) {
						return;
					}

					revealInProgress = false;
					if (result.type === 'success') {
						const response = result.data as { revealedTmdbKey?: string };
						if (response?.revealedTmdbKey) {
							setRevealedApiKey(response.revealedTmdbKey);
							if (copyAfterReveal) {
							await copyRevealedApiKey();
								copyAfterReveal = false;
							}
						} else {
							alertStore.add('error', 'Unable to retrieve API key');
							setRevealedApiKey('');
						}
					} else {
						alertStore.add('error', 'Unable to retrieve API key');
						setRevealedApiKey('');
					}

					copyAfterReveal = false;
					await update();
				};
			}}
		>
			<button
				type="submit"
				class="hidden"
				aria-label="Reveal TMDB API key"
				bind:this={revealSubmitButton}
			></button>
		</form>
</div>
