<script lang="ts">
  import { onMount } from 'svelte';
  import { Save } from 'lucide-svelte';
  import Card from '$ui/card/Card.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import { alertStore } from '$alerts/store';
  import type { PageData } from './$types';

  export let data: PageData;

  type CanaryPartialPolicy = 'gate' | 'abort';

  /**
   * Exact shape of the `GET`/`PATCH /api/v1/canary/settings` 200 body (locked contract).
   * `enabled`/`autoSelect` are booleans; `defaultCanaryInstanceId` is null when unset.
   */
  interface CanarySettingsResponse {
    enabled: boolean;
    autoSelect: boolean;
    defaultMaxBatchSize: number;
    defaultCanaryInstanceId: number | null;
    defaultPartialPolicy: CanaryPartialPolicy;
  }

  type ErrorResponse = { error: string };

  let loading = false;
  let loadError: string | null = null;
  let saving = false;

  // Form state — hydrated from the authoritative payload on load and after every save
  // (no dirty tracking: this small panel re-reads the server value after each PATCH, matching
  // the drift settings panel convention).
  let enabled = false;
  let defaultCanaryInstanceId: number | null = null;
  let defaultMaxBatchSize = 1;
  let defaultPartialPolicy: CanaryPartialPolicy = 'gate';

  function hydrate(settings: CanarySettingsResponse) {
    enabled = settings.enabled;
    defaultCanaryInstanceId = settings.defaultCanaryInstanceId;
    defaultMaxBatchSize = settings.defaultMaxBatchSize;
    defaultPartialPolicy = settings.defaultPartialPolicy;
  }

  async function loadSettings() {
    loading = true;
    loadError = null;

    try {
      const response = await fetch('/api/v1/canary/settings');
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        loadError = body?.error ?? `Failed to load canary settings (HTTP ${response.status})`;
        return;
      }
      hydrate((await response.json()) as CanarySettingsResponse);
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load canary settings';
    } finally {
      loading = false;
    }
  }

  async function saveSettings() {
    if (saving) return;
    saving = true;

    const maxBatchSize = Math.max(1, Math.floor(defaultMaxBatchSize) || 1);

    try {
      const response = await fetch('/api/v1/canary/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          defaultCanaryInstanceId,
          defaultMaxBatchSize: maxBatchSize,
          defaultPartialPolicy,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        alertStore.add('error', body?.error ?? `Failed to update canary settings (HTTP ${response.status})`);
        return;
      }

      hydrate((await response.json()) as CanarySettingsResponse);
      alertStore.add('success', 'Canary settings updated.');
    } catch (err) {
      alertStore.add('error', err instanceof Error ? err.message : 'Failed to update canary settings');
    } finally {
      saving = false;
    }
  }

  // Bind the select through a string so the "no default" option maps to null.
  let canarySelectValue = '';
  $: canarySelectValue = defaultCanaryInstanceId === null ? '' : String(defaultCanaryInstanceId);
  function onCanaryChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    defaultCanaryInstanceId = value === '' ? null : Number(value);
  }

  onMount(() => {
    void loadSettings();
  });
</script>

<svelte:head>
  <title>Canary Sync Settings - Praxrr</title>
</svelte:head>

<div class="p-4 md:p-8">
  <div class="mb-8">
    <h1 class="text-2xl font-bold text-neutral-900 md:text-3xl dark:text-neutral-50">Canary Sync Settings</h1>
    <p class="mt-3 text-base text-neutral-600 md:text-lg dark:text-neutral-400">
      Sync one low-risk canary instance first, verify the result, then roll out to the rest of the same Arr type.
    </p>
  </div>

  {#if loadError}
    <div
      class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
    >
      <span>{loadError}</span>
      <button
        type="button"
        class="rounded-lg border border-red-400 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
        on:click={loadSettings}
      >
        Retry
      </button>
    </div>
  {/if}

  <Card>
    <div class="space-y-6">
      <!-- Opt-in -->
      <label class="flex items-start gap-3 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          class="mt-0.5 h-4 w-4 rounded border-neutral-300 dark:border-neutral-700"
          bind:checked={enabled}
          disabled={loading}
        />
        <span>
          <span class="font-medium text-neutral-900 dark:text-neutral-50">Enable canary sync</span>
          <span class="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
            Opt in to staged rollouts. When disabled, syncs run against all instances at once.
          </span>
        </span>
      </label>

      <!-- Default canary instance -->
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-neutral-900 dark:text-neutral-50">Default canary instance</span>
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          Optional. When unset, the canary is chosen at start time (least-critical instance within the target Arr type).
        </span>
        <select
          class="mt-1 w-full max-w-md rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          value={canarySelectValue}
          disabled={loading}
          on:change={onCanaryChange}
        >
          <option value="">No default (choose at start time)</option>
          {#each data.instances as instance (instance.id)}
            <option value={String(instance.id)}>{instance.name} ({instance.type})</option>
          {/each}
        </select>
        {#if data.instances.length === 0}
          <span class="text-xs text-amber-600 dark:text-amber-400">
            No eligible Radarr, Sonarr, or Lidarr instances are enabled yet.
          </span>
        {/if}
      </label>

      <!-- Default max batch size -->
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-neutral-900 dark:text-neutral-50">Default max batch size</span>
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          How many remaining instances sync in parallel per batch after the canary is promoted.
        </span>
        <input
          type="number"
          min="1"
          step="1"
          class="mt-1 w-28 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          bind:value={defaultMaxBatchSize}
          disabled={loading}
        />
      </label>

      <!-- Default partial policy -->
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-neutral-900 dark:text-neutral-50">Default partial policy</span>
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          What happens when the canary partially succeeds:
          <Badge variant="warning">gate</Badge> pauses for manual confirmation,
          <Badge variant="danger">abort</Badge> stops the rollout.
        </span>
        <select
          class="mt-1 w-full max-w-md rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          bind:value={defaultPartialPolicy}
          disabled={loading}
        >
          <option value="gate">Gate — pause for confirmation</option>
          <option value="abort">Abort — stop the rollout</option>
        </select>
      </label>

      <!-- Action -->
      <div class="flex justify-end border-t border-neutral-200 pt-6 dark:border-neutral-800">
        <button
          type="button"
          class="bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving || loading}
          on:click={saveSettings}
        >
          <Save size={16} />
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  </Card>
</div>
