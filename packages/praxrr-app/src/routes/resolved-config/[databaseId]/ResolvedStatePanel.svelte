<script lang="ts">
  import { browser } from '$app/environment';
  import { AlertTriangle } from 'lucide-svelte';
  import type { components } from '$api/v1.d.ts';
  import JsonView from '$ui/meta/JsonView.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import { FIELD_META, formatFieldValue, formatLineage } from '$ui/resolved/fieldChangeDisplay.ts';
  import { explainResolvedProvenance, type ResolvedProvenanceKind } from '$shared/pcd/resolvedProvenance.ts';

  type ResolvedEntityType = components['schemas']['ResolvedEntityState']['entityType'];
  type ArrAppType = components['schemas']['ResolvedInstanceState']['arrType'];
  type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
  type FieldChange = components['schemas']['FieldChange'];
  type FieldLineage = components['schemas']['FieldLineage'];
  type ErrorResponse = components['schemas']['ErrorResponse'];
  type Layer = 'resolved' | 'base' | 'user';

  export let databaseId: number;
  export let entityType: ResolvedEntityType;
  export let arrType: ArrAppType | undefined = undefined;
  export let entityName: string | null;

  const LAYER_OPTIONS: { id: Layer; label: string }[] = [
    { id: 'resolved', label: 'Resolved' },
    { id: 'base', label: 'Base' },
    { id: 'user', label: 'User Overrides' },
  ];

  let activeLayer: Layer = 'resolved';

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

    // Capture the key this call is fetching for -- if a newer selection supersedes it
    // (entity/layer/arrType change) before this call's awaits resolve, `fetchKey` will
    // have moved on and every guard below bails instead of letting an older, slower
    // response overwrite a newer one's state.
    const requestKey = fetchKey;

    loading = true;
    error = null;
    showRaw = false;

    try {
      const query = new URLSearchParams({ layer: activeLayer });
      if (arrType) query.set('arrType', arrType);
      // Exact per-field lineage is only meaningful for the fully-resolved layer.
      if (activeLayer === 'resolved') query.set('includeLineage', 'true');
      const response = await fetch(
        `/api/v1/pcd/${databaseId}/resolved/${entityType}/${encodeURIComponent(entityName)}?${query.toString()}`
      );
      if (requestKey !== fetchKey) return;

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (requestKey !== fetchKey) return;
        error = body?.error ?? `Failed to load resolved state (HTTP ${response.status})`;
        state = null;
        return;
      }

      const nextState = (await response.json()) as ResolvedEntityState;
      if (requestKey !== fetchKey) return;
      state = nextState;
    } catch (err) {
      if (requestKey !== fetchKey) return;
      error = err instanceof Error ? err.message : 'Failed to load resolved state';
      state = null;
    } finally {
      if (requestKey === fetchKey) {
        loading = false;
      }
    }
  }

  function selectLayer(layer: Layer) {
    if (loading || layer === activeLayer) return;
    activeLayer = layer;
  }

  $: fields = state?.entity ? Object.entries(state.entity) : [];
  $: overrides = (state?.overrides ?? []) as FieldChange[];
  // Per-field lineage lookup keyed by the diff field path. Top-level scalar keys match the entity
  // field table's `Source` column directly; nested/array paths (e.g. conditions["X"].negate) do not
  // correspond to a top-level key, so they are listed in the full lineage table below instead.
  $: lineage = (state?.lineage ?? []) as FieldLineage[];
  $: lineageByField = new Map<string, FieldLineage>(
    lineage.map((entry) => [entry.fieldPath, entry] as [string, FieldLineage])
  );
  // Nested/array leaves (paths that are not a bare top-level key) — surfaced in a dedicated table.
  $: nestedLineage = lineage.filter((entry) => /[.[]/.test(entry.fieldPath));
  $: provenance = state
    ? explainResolvedProvenance({
        // Entity names are selected from the resolved-layer list, so a loaded base response has
        // independent evidence that the selected entity is present in resolved config.
        basePresent: state.layer === 'base' ? state.present : null,
        resolvedPresent: state.layer === 'base' ? true : state.present,
        overrides: state.layer === 'user' ? overrides : null,
        hasPendingConflict: state.hasPendingConflict,
      })
    : null;

  function provenanceVariant(kind: ResolvedProvenanceKind): 'neutral' | 'info' | 'warning' | 'accent' {
    if (kind === 'pending-conflict') return 'warning';
    if (kind === 'user-override') return 'info';
    if (kind === 'user-created') return 'accent';
    return 'neutral';
  }

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
  <!-- Layer segmented control: Resolved | Base | User overrides. -->
  <div
    class="inline-flex overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700"
    role="tablist"
    aria-label="Resolved config layer"
  >
    {#each LAYER_OPTIONS as layerOption, index (layerOption.id)}
      <button
        type="button"
        role="tab"
        aria-selected={activeLayer === layerOption.id}
        disabled={loading}
        class="px-3 py-1.5 text-sm font-medium transition-colors {index > 0
          ? 'border-l border-neutral-300 dark:border-neutral-700'
          : ''} {activeLayer === layerOption.id
          ? 'bg-accent-600 text-white'
          : 'text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800'}"
        on:click={() => selectLayer(layerOption.id)}
      >
        {layerOption.label}
      </button>
    {/each}
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
  {:else if state}
    {#if state.hasPendingConflict}
      <div
        class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
      >
        <Badge variant="warning" icon={AlertTriangle}>Pending value-guard conflict</Badge>
        <span>
          A value-guard conflict is pending for this entity — the resolved value shown here is not unambiguous.
          <a href={`/databases/${databaseId}/conflicts`} class="font-medium underline hover:no-underline">
            Review conflicts
          </a>
        </span>
      </div>
    {/if}

    {#if provenance}
      <div
        class="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
      >
        <Badge variant={provenanceVariant(provenance.kind)}>{provenance.label}</Badge>
        <span>{provenance.detail}</span>
        {#if activeLayer === 'resolved' && state.lineageStatus === 'ambiguous'}
          <Badge variant="warning">Lineage ambiguous</Badge>
        {/if}
      </div>
    {/if}

    {#if activeLayer === 'user'}
      {#if overrides.length === 0}
        <div
          class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
        >
          No user overrides — resolved state matches base.
        </div>
      {:else}
        <div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table class="w-full text-sm">
            <thead class="bg-neutral-50 dark:bg-neutral-900">
              <tr class="text-left text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                <th class="px-4 py-2">Field</th>
                <th class="px-4 py-2">Change</th>
                <th class="px-4 py-2">Base value</th>
                <th class="px-4 py-2">Resolved value</th>
              </tr>
            </thead>
            <tbody>
              {#each overrides as fieldChange (fieldChange.field)}
                {@const fieldMeta = FIELD_META[fieldChange.type]}
                <tr class="border-t border-neutral-200 dark:border-neutral-800">
                  <td class="px-4 py-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">
                    {fieldChange.field}
                  </td>
                  <td class="px-4 py-2 align-top">
                    <span
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold {fieldMeta.textClass}"
                    >
                      <span aria-hidden="true">{fieldMeta.glyph}</span>
                      {fieldMeta.label}
                    </span>
                  </td>
                  <td class="px-4 py-2 align-top">
                    <pre
                      class="max-w-xs overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-xs whitespace-pre-wrap text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">{formatFieldValue(
                        fieldChange.current
                      )}</pre>
                  </td>
                  <td class="px-4 py-2 align-top">
                    <pre
                      class="max-w-xs overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-xs whitespace-pre-wrap text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">{formatFieldValue(
                        fieldChange.desired
                      )}</pre>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {:else if !state.present}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        {activeLayer === 'base'
          ? 'Does not exist in the base-side layer.'
          : 'This entity does not exist in the resolved state.'}
      </div>
    {:else}
      <div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table class="w-full text-sm">
          <thead class="bg-neutral-50 dark:bg-neutral-900">
            <tr class="text-left text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              <th class="px-4 py-2">Field</th>
              <th class="px-4 py-2">Value</th>
              {#if activeLayer === 'resolved'}
                <th class="px-4 py-2">Source</th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each fields as [key, value] (key)}
              {@const lineage = lineageByField.get(key)}
              <tr class="border-t border-neutral-200 dark:border-neutral-800">
                <td class="px-4 py-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">{key}</td>
                <td class="px-4 py-2 text-neutral-900 dark:text-neutral-100">
                  {#if isComplex(value)}
                    <span class="text-neutral-500 italic dark:text-neutral-400">{formatValue(value)}</span>
                  {:else}
                    {formatValue(value)}
                  {/if}
                </td>
                {#if activeLayer === 'resolved'}
                  <td class="px-4 py-2 align-top whitespace-nowrap">
                    {#if lineage}
                      {@const meta = formatLineage(lineage)}
                      <span class="inline-flex items-center gap-1.5" title={meta.detail}>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {#if lineage.status === 'resolved' && lineage.sourceKind !== 'schema-default'}
                          <span class="text-xs text-neutral-400 dark:text-neutral-500">
                            {meta.explicit ? 'explicit' : 'default'}
                          </span>
                        {/if}
                      </span>
                    {:else}
                      <span class="text-xs text-neutral-400 dark:text-neutral-500">—</span>
                    {/if}
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if activeLayer === 'resolved' && nestedLineage.length > 0}
        <div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
          <div
            class="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium tracking-wide text-neutral-500 uppercase dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
          >
            Nested field lineage
          </div>
          <table class="w-full text-sm">
            <tbody>
              {#each nestedLineage as entry (entry.fieldPath)}
                {@const meta = formatLineage(entry)}
                <tr class="border-t border-neutral-200 first:border-t-0 dark:border-neutral-800">
                  <td class="px-4 py-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">{entry.fieldPath}</td>
                  <td class="px-4 py-2 align-top whitespace-nowrap">
                    <span class="inline-flex items-center gap-1.5" title={meta.detail}>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {#if entry.status === 'resolved' && entry.sourceKind !== 'schema-default'}
                        <span class="text-xs text-neutral-400 dark:text-neutral-500">
                          {meta.explicit ? 'explicit' : 'default'}
                        </span>
                      {/if}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <button
        type="button"
        class="text-accent-600 dark:text-accent-500 text-xs font-medium hover:underline"
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
  {/if}
</div>
