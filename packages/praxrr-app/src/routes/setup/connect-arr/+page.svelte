<script lang="ts">
  import { goto } from '$app/navigation';
  import { alertStore } from '$alerts/store';
  import { current } from '$lib/client/stores/dirty';
  import InstanceForm from '../../arr/components/InstanceForm.svelte';
  import Button from '$ui/button/Button.svelte';
  import { ArrowRight, Wifi, Loader2, CheckCircle2 } from 'lucide-svelte';
  import type { ActionData, PageData } from './$types';

  export let data: PageData;
  export let form: ActionData;

  type TestStatus = 'idle' | 'testing' | 'success' | 'fail';

  // Sanitized failure reasons from POST /api/v1/setup/test-connection; copy is
  // deliberately distinct for "can't reach it" vs "reached it, key is wrong".
  const FAILURE_COPY: Record<string, string> = {
    unreachable: 'Could not reach this instance. Check the URL and that it is running.',
    unauthorized: 'Connected, but the API key was rejected.',
    invalid_response: 'The instance responded, but not like a supported Arr app.',
    timeout: 'The connection timed out. Check the URL and network access.',
    rate_limited: 'Too many attempts. Wait a moment and try again.',
  };

  let testStatus: TestStatus = 'idle';
  let testMessage = '';
  let advancing = false;

  // InstanceForm owns the type/url/apiKey fields via the shared dirty store;
  // read them here rather than duplicating inputs for this affordance.
  $: type = ($current.type ?? '') as string;
  $: url = ($current.url ?? '') as string;
  $: apiKey = ($current.apiKey ?? '') as string;

  async function handleTestConnection() {
    if (!type || !url || !apiKey) {
      alertStore.add('error', 'Please fill in Type, URL, and API Key');
      return;
    }

    testStatus = 'testing';
    testMessage = '';
    try {
      const response = await fetch('/api/v1/setup/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, url, apiKey }),
      });
      const result = await response.json();

      if (result.success) {
        testStatus = 'success';
        testMessage = result.appName
          ? `Connected to ${result.appName} ${result.version ?? ''}`.trim()
          : 'Connection successful!';
      } else {
        testStatus = 'fail';
        testMessage = FAILURE_COPY[result.reason as string] ?? 'Connection test failed.';
      }
    } catch {
      testStatus = 'fail';
      testMessage = FAILURE_COPY.unreachable;
    }
  }

  async function handleContinue() {
    advancing = true;
    try {
      const res = await fetch('/api/v1/setup/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStep: 'link-database' }),
      });
      if (!res.ok) throw new Error('Failed to advance setup step');
      await goto('/setup/link-database');
    } catch {
      alertStore.add('error', 'Could not continue — please try again.');
    } finally {
      advancing = false;
    }
  }
</script>

<svelte:head>
  <title>Connect - Setup - Praxrr</title>
</svelte:head>

{#if data.instances.length > 0}
  <div class="space-y-6">
    <div
      class="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950"
    >
      <CheckCircle2 size={20} class="mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
      <div>
        <p class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Already connected</p>
        <p class="text-sm text-neutral-600 dark:text-neutral-400">
          {data.instances[0].name} ({data.instances[0].type}) is already connected.
        </p>
      </div>
    </div>

    <Button
      variant="primary"
      size="md"
      icon={ArrowRight}
      iconPosition="right"
      text={advancing ? 'Continuing…' : 'Continue'}
      disabled={advancing}
      on:click={handleContinue}
    />
  </div>
{:else}
  <div class="space-y-6">
    <InstanceForm mode="create" {form} />

    <div class="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Test connection</p>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            Verify Praxrr can reach this instance before saving.
          </p>
        </div>
        <Button
          text={testStatus === 'testing' ? 'Testing...' : 'Test connection'}
          icon={testStatus === 'testing' ? Loader2 : Wifi}
          disabled={testStatus === 'testing' || !type || !url || !apiKey}
          on:click={handleTestConnection}
        />
      </div>
      {#if testStatus === 'success'}
        <p class="text-xs text-green-600 dark:text-green-400" role="status">{testMessage}</p>
      {:else if testStatus === 'fail'}
        <p class="text-xs text-red-600 dark:text-red-400" role="status">{testMessage}</p>
      {/if}
    </div>
  </div>
{/if}
