<script lang="ts">
  import { CheckCircle2, RefreshCw, XCircle } from 'lucide-svelte';
  import type { components } from '$api/v1.d.ts';
  import Badge from '$ui/badge/Badge.svelte';
  import { FIELD_META, formatFieldValue } from '$ui/resolved/fieldChangeDisplay.ts';

  type ResolvedEntityType = components['schemas']['ResolvedEntityState']['entityType'];
  type ArrAppType = components['schemas']['ResolvedInstanceState']['arrType'];
  type ResolvedLiveDiffResponse = components['schemas']['ResolvedLiveDiffResponse'];
  type SyncPreviewAction = components['schemas']['SyncPreviewAction'];
  type ErrorResponse = components['schemas']['ErrorResponse'];

  // Instance options are always a concrete Arr app -- `arrType` on this wire type also
  // covers the compare response's `null` (unrecognized arr_type) case, which never
  // applies to the instance list built server-side by `+page.server.ts`.
  interface InstanceOption {
    id: number;
    name: string;
    type: NonNullable<ArrAppType>;
  }

  export let databaseId: number;
  export let entityType: ResolvedEntityType;
  export let arrType: ArrAppType | undefined = undefined;
  export let entityName: string | null;
  export let instances: InstanceOption[] = [];

  interface CheckContext {
    instanceId: number;
    entityType: ResolvedEntityType;
    entityName: string;
  }

  type CreateOrDeleteAction = Extract<SyncPreviewAction, 'create' | 'delete'>;

  const ACTION_BANNER_META: Record<
    CreateOrDeleteAction,
    { glyph: string; heading: string; description: string; wrapClass: string; textClass: string }
  > = {
    create: {
      glyph: '+',
      heading: 'Would create',
      description: 'Entity missing on instance — sync would create it.',
      wrapClass: 'border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-900/20',
      textClass: 'text-emerald-900 dark:text-emerald-200',
    },
    delete: {
      glyph: '-',
      heading: 'Would delete',
      description: 'Entity exists on the instance but not in the resolved PCD state — sync would delete it.',
      wrapClass: 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-900/20',
      textClass: 'text-red-900 dark:text-red-200',
    },
  };

  let selectedInstanceId: number | null = null;

  let checking = false;
  let checkError: string | null = null;
  let rateLimited = false;
  let result: ResolvedLiveDiffResponse | null = null;
  let lastCheckContext: CheckContext | null = null;
  let checkRequestId = 0;

  $: filteredInstances = arrType ? instances.filter((instance) => instance.type === arrType) : instances;
  $: if (selectedInstanceId !== null && !filteredInstances.some((instance) => instance.id === selectedInstanceId)) {
    selectedInstanceId = null;
  }
  $: selectedInstance = filteredInstances.find((instance) => instance.id === selectedInstanceId) ?? null;

  // The displayed check result/error is only valid for the exact instance + entity it was
  // computed against -- if the user changes the instance selection or the parent's entity
  // selection changes, the previous terminal state must disappear (never conflatable with
  // a fresh, not-yet-checked state).
  $: contextMatchesLastCheck =
    lastCheckContext !== null &&
    selectedInstanceId === lastCheckContext.instanceId &&
    entityType === lastCheckContext.entityType &&
    entityName === lastCheckContext.entityName;
  $: displayResult = contextMatchesLastCheck ? result : null;
  $: displayError = contextMatchesLastCheck ? checkError : null;
  $: displayRateLimited = contextMatchesLastCheck ? rateLimited : false;

  $: changeRow = displayResult?.changes[0] ?? null;
  $: fields = changeRow?.fields ?? [];
  $: isInSync = changeRow !== null && (changeRow.action === 'unchanged' || fields.length === 0);
  $: createOrDeleteMeta =
    changeRow !== null && !isInSync && (changeRow.action === 'create' || changeRow.action === 'delete')
      ? ACTION_BANNER_META[changeRow.action as CreateOrDeleteAction]
      : null;
  $: showFieldTable = changeRow !== null && !isInSync && createOrDeleteMeta === null;

  async function runCheck() {
    if (entityName === null || selectedInstanceId === null || checking) return;

    const instanceId = selectedInstanceId;
    const checkEntityType = entityType;
    const checkEntityName = entityName;
    // Generation guard: if a newer runCheck starts before this one's awaits resolve, this
    // call's `requestId` no longer matches `checkRequestId` and its result/context
    // assignment below is skipped -- an older, slower response can never clobber a newer
    // one's state.
    const requestId = ++checkRequestId;

    checking = true;
    result = null;
    checkError = null;
    rateLimited = false;

    try {
      const response = await fetch(
        `/api/v1/pcd/${databaseId}/resolved/${checkEntityType}/${encodeURIComponent(checkEntityName)}/diff?instanceId=${instanceId}`
      );
      if (requestId !== checkRequestId) return;

      if (response.status === 429) {
        rateLimited = true;
      } else if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (requestId !== checkRequestId) return;
        checkError = body?.error ?? `Failed to check live diff (HTTP ${response.status})`;
      } else {
        const nextResult = (await response.json()) as ResolvedLiveDiffResponse;
        if (requestId !== checkRequestId) return;
        result = nextResult;
      }
    } catch (err) {
      if (requestId !== checkRequestId) return;
      checkError = err instanceof Error ? err.message : 'Failed to check live diff';
    } finally {
      if (requestId === checkRequestId) {
        lastCheckContext = { instanceId, entityType: checkEntityType, entityName: checkEntityName };
        checking = false;
      }
    }
  }

  function handleInstanceChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    selectedInstanceId = value ? Number.parseInt(value, 10) : null;
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-end gap-3">
    <label class="flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-400">
      Arr instance
      <select
        class="min-w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        value={selectedInstanceId ?? ''}
        disabled={filteredInstances.length === 0}
        on:change={handleInstanceChange}
      >
        <option value="" disabled>Select an instance…</option>
        {#each filteredInstances as instance (instance.id)}
          <option value={instance.id}>{instance.name} ({instance.type})</option>
        {/each}
      </select>
    </label>

    {#if selectedInstance}
      <Badge variant={selectedInstance.type}>{selectedInstance.type}</Badge>
    {/if}

    <button
      type="button"
      class="flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-accent-500 dark:hover:bg-accent-600"
      disabled={checking || entityName === null || selectedInstanceId === null}
      on:click={runCheck}
    >
      <RefreshCw size={14} class={checking ? 'animate-spin' : ''} />
      Check against live
    </button>
  </div>

  {#if entityName === null}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      Select an entity to check it against a live Arr instance.
    </div>
  {:else if filteredInstances.length === 0}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      No enabled Arr instances{arrType ? ` of type ${arrType}` : ''} are configured to check this entity against.
    </div>
  {:else if checking}
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
      <span>Rate limited — try again shortly.</span>
      <button
        type="button"
        class="rounded-lg border border-amber-400 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
        on:click={runCheck}
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
        on:click={runCheck}
      >
        Retry
      </button>
    </div>
  {:else if changeRow !== null}
    {#if isInSync}
      <div
        class="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200"
      >
        <CheckCircle2 size={16} class="shrink-0" />
        In sync — no differences detected.
      </div>
    {:else if createOrDeleteMeta}
      <div class="rounded-lg border p-3 text-sm {createOrDeleteMeta.wrapClass} {createOrDeleteMeta.textClass}">
        <span class="font-semibold">
          <span aria-hidden="true">{createOrDeleteMeta.glyph}</span>
          {createOrDeleteMeta.heading}
        </span>
        <span class="block">{createOrDeleteMeta.description}</span>
      </div>
    {:else if showFieldTable}
      <div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table class="w-full text-sm">
          <thead class="bg-neutral-50 dark:bg-neutral-900">
            <tr class="text-left text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              <th class="px-4 py-2">Field</th>
              <th class="px-4 py-2">Change</th>
              <th class="px-4 py-2">Current (live)</th>
              <th class="px-4 py-2">Desired (PCD)</th>
            </tr>
          </thead>
          <tbody>
            {#each fields as fieldChange (fieldChange.field)}
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
  {:else}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      Select an instance and click "Check against live" to compare the resolved PCD state against it.
    </div>
  {/if}
</div>
