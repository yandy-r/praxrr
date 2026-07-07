<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { CheckCircle2, RefreshCw, XCircle } from 'lucide-svelte';
  import type { components } from '$api/v1.d.ts';
  import Badge from '$ui/badge/Badge.svelte';
  import Table from '$ui/table/Table.svelte';
  import type { Column } from '$ui/table/types';

  type ResolvedEntityType = components['schemas']['ResolvedEntityState']['entityType'];
  type ArrAppType = components['schemas']['ResolvedInstanceState']['arrType'];
  type CrossInstanceComparisonResponse = components['schemas']['CrossInstanceComparisonResponse'];
  type ResolvedInstanceState = components['schemas']['ResolvedInstanceState'];
  type ResolvedInstanceReason = NonNullable<ResolvedInstanceState['error']>;
  type FieldChange = components['schemas']['FieldChange'];
  type FieldChangeType = components['schemas']['SyncPreviewFieldChangeType'];
  type ErrorResponse = components['schemas']['ErrorResponse'];

  export let databaseId: number;
  export let entityType: ResolvedEntityType;
  export let arrType: ArrAppType | undefined = undefined;
  export let entityName: string | null;

  // Server cap lives in packages/praxrr-app/src/lib/server/pcd/resolved/limits.ts
  // (COMPARE_MAX_INSTANCES) -- duplicated here since that module is server-only and
  // cannot be imported from client code.
  const MAX_INSTANCES = 8;

  interface InstanceOption {
    id: number;
    name: string;
    type: ArrAppType;
  }

  interface InstancesListResponse {
    instances: InstanceOption[];
  }

  interface CompareContext {
    instanceIds: number[];
    entityType: ResolvedEntityType;
    entityName: string;
    includeLive: boolean;
  }

  type GridCell =
    | { kind: 'match'; value: unknown }
    | { kind: 'diff'; type: FieldChangeType; value: unknown }
    | { kind: 'unavailable'; reason: string };

  interface GridRow {
    field: string;
    cells: Record<number, GridCell>;
  }

  const FIELD_META: Record<FieldChangeType, { glyph: string; label: string; textClass: string }> = {
    added: { glyph: '+', label: 'Added', textClass: 'text-emerald-700 dark:text-emerald-300' },
    changed: { glyph: '~', label: 'Changed', textClass: 'text-amber-700 dark:text-amber-300' },
    removed: { glyph: '-', label: 'Removed', textClass: 'text-red-700 dark:text-red-300' },
  };

  const REASON_LABELS: Record<ResolvedInstanceReason, string> = {
    unreachable: 'Unreachable',
    timeout: 'Timed out',
    unauthorized: 'Unauthorized',
    invalid_response: 'Invalid response',
    unsupported: 'Unsupported entity type',
    not_found: 'Not found',
    incompatible: 'Incompatible arr type',
    'rate-limited': 'Rate limited',
    error: 'Error',
  };

  let instances: InstanceOption[] = [];
  let instancesLoading = false;
  let instancesError: string | null = null;

  let selectedInstanceIds: number[] = [];
  let capMessage: string | null = null;
  let includeLive = false;

  let comparing = false;
  let compareError: string | null = null;
  let rateLimited = false;
  let result: CrossInstanceComparisonResponse | null = null;
  let lastCompareContext: CompareContext | null = null;

  $: filteredInstances = arrType ? instances.filter((instance) => instance.type === arrType) : instances;

  // Drop any selected instance that fell out of the (possibly arrType-filtered) instance
  // list -- guarded so it only reassigns when something actually needs pruning, avoiding
  // an infinite reactive loop from creating a new array reference every run.
  $: {
    const validIds = new Set(filteredInstances.map((instance) => instance.id));
    const pruned = selectedInstanceIds.filter((id) => validIds.has(id));
    if (pruned.length !== selectedInstanceIds.length) {
      selectedInstanceIds = pruned;
    }
  }

  // The displayed comparison is only valid for the exact selection it was computed
  // against -- if the entity, instance selection, or includeLive flag changes, the
  // previous terminal state must disappear (never conflatable with a fresh, not-yet-run
  // comparison).
  $: contextMatchesLastCompare =
    lastCompareContext !== null &&
    entityType === lastCompareContext.entityType &&
    entityName === lastCompareContext.entityName &&
    includeLive === lastCompareContext.includeLive &&
    sameInstanceIds(selectedInstanceIds, lastCompareContext.instanceIds);
  $: displayResult = contextMatchesLastCompare ? result : null;
  $: displayError = contextMatchesLastCompare ? compareError : null;
  $: displayRateLimited = contextMatchesLastCompare ? rateLimited : false;

  $: columns = displayResult ? buildColumns(displayResult) : [];
  $: rows = displayResult ? buildRows(displayResult) : [];
  $: comparableCount = displayResult?.diffs.length ?? 0;
  $: hasDifferences = rows.length > 0;
  $: emptyDiffMessage = lastCompareContext?.includeLive
    ? 'All selected instances match the desired state'
    : 'Desired payloads are identical across selected instances';

  function sameInstanceIds(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((id, index) => id === b[index]);
  }

  function reasonLabel(reason: ResolvedInstanceState['error']): string {
    if (!reason) return 'Unavailable';
    return REASON_LABELS[reason];
  }

  function instanceStatus(instance: ResolvedInstanceState): {
    variant: 'success' | 'warning' | 'danger';
    glyph: string;
    label: string;
  } {
    if (instance.compatible && instance.present) {
      return { variant: 'success', glyph: '+', label: 'Compatible' };
    }
    return {
      variant: instance.error === 'rate-limited' ? 'warning' : 'danger',
      glyph: '-',
      label: reasonLabel(instance.error),
    };
  }

  function buildColumns(data: CrossInstanceComparisonResponse): Column<GridRow>[] {
    return [
      { key: 'field', header: 'Field', align: 'left' },
      ...data.instances.map((instance): Column<GridRow> => ({
        key: String(instance.instanceId),
        header: instance.instanceName,
        align: 'left',
      })),
    ];
  }

  function buildRows(data: CrossInstanceComparisonResponse): GridRow[] {
    const fieldOrder: string[] = [];
    const baselineValueByField = new Map<string, unknown>();
    const fieldChangesByInstance = new Map<number, Map<string, FieldChange>>();

    for (const diffRow of data.diffs) {
      const change = diffRow.changes[0];
      const fieldsMap = new Map<string, FieldChange>();
      for (const fieldChange of change?.fields ?? []) {
        if (!baselineValueByField.has(fieldChange.field)) {
          baselineValueByField.set(fieldChange.field, fieldChange.current);
        }
        if (!fieldOrder.includes(fieldChange.field)) {
          fieldOrder.push(fieldChange.field);
        }
        fieldsMap.set(fieldChange.field, fieldChange);
      }
      fieldChangesByInstance.set(diffRow.instanceId, fieldsMap);
    }

    return fieldOrder.map((field) => {
      const cells: Record<number, GridCell> = {};
      for (const instance of data.instances) {
        const instanceFields = fieldChangesByInstance.get(instance.instanceId);
        if (!instanceFields) {
          cells[instance.instanceId] = { kind: 'unavailable', reason: reasonLabel(instance.error) };
          continue;
        }
        const fieldChange = instanceFields.get(field);
        cells[instance.instanceId] = fieldChange
          ? { kind: 'diff', type: fieldChange.type, value: fieldChange.desired }
          : { kind: 'match', value: baselineValueByField.get(field) };
      }
      return { field, cells };
    });
  }

  function formatFieldValue(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value, null, 2);
  }

  function handleInstanceToggle(id: number, checked: boolean) {
    if (checked) {
      if (selectedInstanceIds.length >= MAX_INSTANCES) {
        capMessage = `You can compare up to ${MAX_INSTANCES} instances at a time -- deselect one first.`;
        return;
      }
      selectedInstanceIds = [...selectedInstanceIds, id];
    } else {
      selectedInstanceIds = selectedInstanceIds.filter((existing) => existing !== id);
    }
    capMessage = null;
  }

  async function loadInstances() {
    instancesLoading = true;
    instancesError = null;

    try {
      const response = await fetch(`/resolved-config/${databaseId}/instances`);

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        instancesError = body?.error ?? `Failed to load Arr instances (HTTP ${response.status})`;
        instances = [];
        return;
      }

      const body = (await response.json()) as InstancesListResponse;
      instances = body.instances;
    } catch (err) {
      instancesError = err instanceof Error ? err.message : 'Failed to load Arr instances';
      instances = [];
    } finally {
      instancesLoading = false;
    }
  }

  async function runCompare() {
    if (entityName === null || selectedInstanceIds.length === 0 || comparing) return;

    const instanceIds = [...selectedInstanceIds];
    const compareEntityType = entityType;
    const compareEntityName = entityName;
    const compareIncludeLive = includeLive;

    comparing = true;
    result = null;
    compareError = null;
    rateLimited = false;

    try {
      const query = new URLSearchParams({
        instanceIds: instanceIds.join(','),
        includeLive: String(compareIncludeLive),
      });
      const response = await fetch(
        `/api/v1/pcd/${databaseId}/resolved/${compareEntityType}/${encodeURIComponent(compareEntityName)}/compare?${query.toString()}`
      );

      if (response.status === 429) {
        rateLimited = true;
      } else if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        compareError = body?.error ?? `Failed to compare instances (HTTP ${response.status})`;
      } else {
        result = (await response.json()) as CrossInstanceComparisonResponse;
      }
    } catch (err) {
      compareError = err instanceof Error ? err.message : 'Failed to compare instances';
    } finally {
      lastCompareContext = {
        instanceIds,
        entityType: compareEntityType,
        entityName: compareEntityName,
        includeLive: compareIncludeLive,
      };
      comparing = false;
    }
  }

  onMount(() => {
    if (browser) void loadInstances();
  });
</script>

<div class="space-y-4">
  <div class="space-y-3">
    <div class="flex flex-col gap-2">
      <span class="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        Instances to compare (up to {MAX_INSTANCES})
      </span>
      <div class="flex flex-wrap gap-3">
        {#each filteredInstances as instance (instance.id)}
          {@const isSelected = selectedInstanceIds.includes(instance.id)}
          {@const atCap = !isSelected && selectedInstanceIds.length >= MAX_INSTANCES}
          <label
            class="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm dark:border-neutral-800 {atCap
              ? 'opacity-50'
              : ''}"
          >
            <input
              type="checkbox"
              checked={isSelected}
              disabled={atCap}
              on:change={(event) =>
                handleInstanceToggle(instance.id, (event.currentTarget as HTMLInputElement).checked)}
            />
            <span class="text-neutral-900 dark:text-neutral-100">{instance.name}</span>
            <Badge variant={instance.type}>{instance.type}</Badge>
          </label>
        {/each}
      </div>
      {#if capMessage}
        <p class="text-xs text-amber-700 dark:text-amber-300">{capMessage}</p>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-4">
      <label class="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" bind:checked={includeLive} />
        Include live state
      </label>
      <button
        type="button"
        class="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-accent-500 dark:hover:bg-accent-600"
        disabled={comparing || entityName === null || selectedInstanceIds.length === 0}
        on:click={runCompare}
      >
        <RefreshCw size={14} class={comparing ? 'animate-spin' : ''} />
        Compare
      </button>
    </div>
    <p class="text-xs text-neutral-500 dark:text-neutral-500">Fetches live state from each instance -- rate limited.</p>
  </div>

  {#if entityName === null}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      Select an entity to compare it across Arr instances.
    </div>
  {:else if instancesLoading}
    <div class="animate-pulse space-y-2">
      <div class="h-4 w-1/3 rounded bg-neutral-200 dark:bg-neutral-700"></div>
      <div class="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-700"></div>
    </div>
  {:else if instancesError}
    <div
      class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
    >
      {instancesError}
    </div>
  {:else if filteredInstances.length === 0}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      No enabled Arr instances{arrType ? ` of type ${arrType}` : ''} are configured to compare this entity against.
    </div>
  {:else if comparing}
    <div class="animate-pulse space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div class="h-4 w-1/4 rounded bg-neutral-200 dark:bg-neutral-700"></div>
      <div class="h-4 w-full rounded bg-neutral-200 dark:bg-neutral-700"></div>
      <div class="h-4 w-5/6 rounded bg-neutral-200 dark:bg-neutral-700"></div>
      <div class="h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700"></div>
    </div>
  {:else if displayRateLimited}
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <span>Rate limited -- try again shortly.</span>
      <button
        type="button"
        class="rounded-lg border border-amber-400 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
        on:click={runCompare}
      >
        Retry
      </button>
    </div>
  {:else if displayError}
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
    >
      <span class="flex items-center gap-2">
        <XCircle size={16} class="shrink-0" />
        {displayError}
      </span>
      <button
        type="button"
        class="rounded-lg border border-red-400 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-200 dark:hover:bg-red-900/40"
        on:click={runCompare}
      >
        Retry
      </button>
    </div>
  {:else if displayResult}
    <div class="flex flex-wrap items-center gap-3">
      {#each displayResult.instances as instance (instance.instanceId)}
        {@const status = instanceStatus(instance)}
        <div class="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">{instance.instanceName}</span>
          <Badge variant={instance.arrType}>{instance.arrType}</Badge>
          <Badge variant={status.variant}>
            <span aria-hidden="true">{status.glyph}</span>
            {status.label}
          </Badge>
        </div>
      {/each}
    </div>

    {#if comparableCount === 0}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        No selected instance is compatible with this entity -- see the status badges above.
      </div>
    {:else if !hasDifferences}
      <div
        class="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200"
      >
        <CheckCircle2 size={16} class="shrink-0" />
        {emptyDiffMessage}
      </div>
    {:else}
      <Table {columns} data={rows} emptyMessage="No differing fields">
        <svelte:fragment slot="cell" let:row let:column>
          {#if column.key === 'field'}
            <span class="font-mono text-xs text-neutral-500 dark:text-neutral-400">{row.field}</span>
          {:else}
            {@const cell = row.cells[Number(column.key)]}
            {#if cell.kind === 'diff'}
              {@const meta = FIELD_META[cell.type]}
              <div class="space-y-0.5">
                <span class="inline-flex items-center gap-1 text-xs font-semibold {meta.textClass}">
                  <span aria-hidden="true">{meta.glyph}</span>
                  {meta.label}
                </span>
                <div
                  class="max-w-xs overflow-x-auto font-mono text-xs whitespace-pre-wrap text-neutral-700 dark:text-neutral-200"
                >
                  {formatFieldValue(cell.value)}
                </div>
              </div>
            {:else if cell.kind === 'match'}
              <div class="space-y-0.5">
                <span
                  class="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400"
                >
                  <span aria-hidden="true">=</span>
                  Matches baseline
                </span>
                <div
                  class="max-w-xs overflow-x-auto font-mono text-xs whitespace-pre-wrap text-neutral-700 dark:text-neutral-200"
                >
                  {formatFieldValue(cell.value)}
                </div>
              </div>
            {:else}
              <span class="inline-flex items-center gap-1 text-xs font-semibold text-neutral-400 dark:text-neutral-500">
                <span aria-hidden="true">×</span>
                {cell.reason}
              </span>
            {/if}
          {/if}
        </svelte:fragment>
      </Table>
    {/if}
  {:else}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      Select instances above and click "Compare" to compare the resolved PCD state across them.
    </div>
  {/if}
</div>
