<script lang="ts">
  import { browser } from '$app/environment';
  import type { components } from '$api/v1.d.ts';
  import JsonView from '$ui/meta/JsonView.svelte';

  type ResolvedEntityType = components['schemas']['ResolvedEntityState']['entityType'];
  type ArrAppType = components['schemas']['ResolvedInstanceState']['arrType'];
  type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
  type ErrorResponse = components['schemas']['ErrorResponse'];
  type Layer = 'resolved' | 'base' | 'user';

  export let databaseId: number;
  export let entityType: ResolvedEntityType;
  export let arrType: ArrAppType | undefined = undefined;
  export let entityName: string | null;

  const activeLayer: Layer = 'resolved';

  let loading = false;
  let error: string | null = null;
  let state: ResolvedEntityState | null = null;
  let showRaw = false;
  let lastFetchKey: string | null = null;

  $: fetchKey =
    entityName === null ? null : `${databaseId}:${entityType}:${arrType ?? ''}:${entityName}:${activeLayer}`;
  $: if (browser) {
    void syncFetch(fetchKey);
  }

  async function syncFetch(key: string | null) {
    if (key === lastFetchKey) return;
    lastFetchKey = key;

    if (key === null || entityName === null) {
      state = null;
      error = null;
      loading = false;
      return;
    }

    await loadEntity();
  }

  async function loadEntity() {
    if (entityName === null) return;

    loading = true;
    error = null;
    showRaw = false;

    try {
      const query = new URLSearchParams({ layer: activeLayer });
      if (arrType) query.set('arrType', arrType);
      const response = await fetch(
        `/api/v1/pcd/${databaseId}/resolved/${entityType}/${encodeURIComponent(entityName)}?${query.toString()}`
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        error = body?.error ?? `Failed to load resolved state (HTTP ${response.status})`;
        state = null;
        return;
      }

      state = (await response.json()) as ResolvedEntityState;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load resolved state';
      state = null;
    } finally {
      loading = false;
    }
  }

  $: fields = state?.entity ? Object.entries(state.entity) : [];

  function formatValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return `Array (${value.length})`;
    if (typeof value === 'object') return 'Object';
    return String(value);
  }

  function isComplex(value: unknown): boolean {
    return typeof value === 'object' && value !== null;
  }
</script>

<div class="space-y-4">
  <!--
    Layer segmented control: Resolved | Base | User overrides. Base/User are disabled
    until Task 4.1 wires `layer=base|user` fetches into this panel.
  -->
  <div
    class="inline-flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700"
    role="tablist"
    aria-label="Resolved config layer"
  >
    <button
      type="button"
      role="tab"
      aria-selected={activeLayer === 'resolved'}
      class="bg-accent-600 px-3 py-1.5 text-sm font-medium text-white"
    >
      Resolved
    </button>
    <!-- TODO(Task 4.1): enable Base/User segments via layer=base|user fetches. -->
    <button
      type="button"
      role="tab"
      aria-selected={false}
      disabled
      title="wired in a later task"
      class="cursor-not-allowed border-l border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-400 dark:border-neutral-700 dark:text-neutral-600"
    >
      Base
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={false}
      disabled
      title="wired in a later task"
      class="cursor-not-allowed border-l border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-400 dark:border-neutral-700 dark:text-neutral-600"
    >
      User Overrides
    </button>
  </div>

  {#if entityName === null}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      Select an entity to view its resolved state.
    </div>
  {:else if loading}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      Loading resolved state…
    </div>
  {:else if error}
    <div
      class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
    >
      {error}
    </div>
  {:else if state && !state.present}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      This entity does not exist in the resolved state.
    </div>
  {:else if state}
    <div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table class="w-full text-sm">
        <thead class="bg-neutral-50 dark:bg-neutral-900">
          <tr class="text-left text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
            <th class="px-4 py-2">Field</th>
            <th class="px-4 py-2">Value</th>
          </tr>
        </thead>
        <tbody>
          {#each fields as [key, value] (key)}
            <tr class="border-t border-neutral-200 dark:border-neutral-800">
              <td class="px-4 py-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">{key}</td>
              <td class="px-4 py-2 text-neutral-900 dark:text-neutral-100">
                {#if isComplex(value)}
                  <span class="text-neutral-500 italic dark:text-neutral-400">{formatValue(value)}</span>
                {:else}
                  {formatValue(value)}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <button
      type="button"
      class="text-xs font-medium text-accent-600 hover:underline dark:text-accent-500"
      on:click={() => (showRaw = !showRaw)}
    >
      {showRaw ? 'Hide' : 'Show'} raw JSON
    </button>

    {#if showRaw}
      <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <JsonView data={state.entity} />
      </div>
    {/if}
  {/if}
</div>
