<script lang="ts">
  import { onDestroy } from 'svelte';
  import { enhance } from '$app/forms';
  import { alertStore } from '$alerts/store';
  import { Save, RotateCcw, Eye, EyeOff, Check } from 'lucide-svelte';
  import MaskedApiKey from '$ui/form/MaskedApiKey.svelte';
  import IconCheckbox from '$ui/form/IconCheckbox.svelte';
  import type { AISettings } from './types';

  export let settings: AISettings;

  let showApiKey = false;
  let apiKeyInput = '';
  let isApiKeyRevealed = false;
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

  // Default values
  const DEFAULTS = {
    enabled: false,
    api_url: 'https://api.openai.com/v1',
    api_key: '',
    model: 'gpt-4o-mini',
  };

  $: maskedApiKeyValue = isApiKeyRevealed && revealedApiKey ? revealedApiKey : settings.api_key_masked;
  $: plainApiKeyValue = isApiKeyRevealed && revealedApiKey ? revealedApiKey : '';

  function clearAutoHideTimer() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function setRevealedApiKey(value: string) {
    isApiKeyRevealed = Boolean(value);
    revealedApiKey = value;

    clearAutoHideTimer();
    if (isApiKeyRevealed) {
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
    settings.enabled = DEFAULTS.enabled;
    settings.api_url = DEFAULTS.api_url;
    apiKeyInput = DEFAULTS.api_key;
    settings.model = DEFAULTS.model;
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
</script>

<form
  method="POST"
  action="?/updateAI"
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
      <IconCheckbox icon={Check} checked={settings.enabled} on:click={() => (settings.enabled = !settings.enabled)} />
      <input type="hidden" name="enabled" value={settings.enabled ? 'on' : ''} />
      <button type="button" class="flex-1 text-left" on:click={() => (settings.enabled = !settings.enabled)}>
        <span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Enable AI Features</span>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">Enable AI-powered commit message generation</p>
      </button>
    </div>

    {#if settings.enabled}
      <!-- Divider -->
      <div class="border-t border-neutral-200 dark:border-neutral-800"></div>

      <!-- API URL -->
      <div>
        <label for="api_url" class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50">
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
          OpenAI-compatible endpoint. Examples: Ollama (http://localhost:11434/v1), LM Studio (http://localhost:1234/v1)
        </p>
      </div>

      <!-- Stored API Key -->
      <div>
        <label for="ai-stored-api-key" class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50">
          Stored API Key
        </label>
        {#key remaskSession}
          <MaskedApiKey
            id="ai-stored-api-key"
            label="AI API Key"
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
          Stored key values are hidden by default for security.
        </p>
      </div>

      <!-- API Key -->
      <div>
        <label for="api_key" class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50">
          Update API Key
        </label>
        <div class="relative">
          <input
            type={showApiKey ? 'text' : 'password'}
            id="api_key"
            name="api_key"
            bind:value={apiKeyInput}
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
        <label for="model" class="mb-2 block text-sm font-semibold text-neutral-900 dark:text-neutral-50">
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
      class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
    >
      <Save size={16} />
      Save Settings
    </button>
  </div>
</form>

<form
  method="POST"
  action="?/revealAI"
  class="hidden"
  use:enhance={() => {
    const requestToken = pendingRevealRequestToken;
    return async ({ result, update }) => {
      if (requestToken !== revealRequestToken) {
        return;
      }

      revealInProgress = false;
      if (result.type === 'success') {
        const response = result.data as { revealedAiKey?: string };
        if (response?.revealedAiKey) {
          setRevealedApiKey(response.revealedAiKey);
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
  <button type="submit" class="hidden" aria-label="Reveal AI API key" bind:this={revealSubmitButton}></button>
</form>
