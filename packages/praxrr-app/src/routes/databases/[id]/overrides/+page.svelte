<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { Undo2, RotateCcw, AlertTriangle } from 'lucide-svelte';
  import ActionsBar from '$ui/actions/ActionsBar.svelte';
  import SearchAction from '$ui/actions/SearchAction.svelte';
  import ActionButton from '$ui/actions/ActionButton.svelte';
  import ExpandableTable from '$ui/table/ExpandableTable.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import Button from '$ui/button/Button.svelte';
  import Modal from '$ui/modal/Modal.svelte';
  import PageTitle from '$ui/meta/PageTitle.svelte';
  import { alertStore } from '$alerts/store';
  import { getPersistentSearchStore, type SearchStore } from '$lib/client/stores/search';
  import { FIELD_META, formatFieldValue } from '$ui/resolved/fieldChangeDisplay.ts';
  import { parseUTC } from '$shared/utils/dates';
  import type { components } from '$api/v1.d.ts';
  import type { Column } from '$ui/table/types';
  import type { PageData } from './$types';

  type OverrideEntity = PageData['entities'][number];
  type EntityRef = components['schemas']['PcdOverrideEntityRef'];
  type ErrorResponse = components['schemas']['PcdOverrideErrorResponse'];

  export let data: PageData;

  let searchStore: SearchStore;
  $: searchStore = getPersistentSearchStore(`databaseOverridesSearch:${$page.params.id}`, {
    debounceMs: 300,
  });

  const ENTITY_TYPE_LABELS: Record<OverrideEntity['entityType'], string> = {
    delayProfile: 'Delay Profile',
    regularExpression: 'Regular Expression',
    customFormat: 'Custom Format',
    qualityProfile: 'Quality Profile',
    naming: 'Naming',
    mediaSettings: 'Media Settings',
    qualityDefinitions: 'Quality Definitions',
    lidarrMetadataProfile: 'Metadata Profile',
  };

  const KIND_META: Record<OverrideEntity['kind'], { label: string; variant: 'success' | 'danger' | 'warning' }> = {
    created: { label: 'Created', variant: 'success' },
    deleted: { label: 'Deleted', variant: 'danger' },
    modified: { label: 'Modified', variant: 'warning' },
  };

  function entityKey(entity: EntityRef): string {
    return `${entity.entityType}|${entity.arrType ?? ''}|${entity.name}`;
  }

  function arrVariant(arrType: string): 'radarr' | 'sonarr' | 'lidarr' | 'neutral' {
    return arrType === 'radarr' || arrType === 'sonarr' || arrType === 'lidarr' ? arrType : 'neutral';
  }

  function formatWhen(iso: string): string {
    const parsed = parseUTC(iso);
    return !parsed || Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
  }

  function lastChange(entity: OverrideEntity): string {
    return entity.ops.length > 0 ? entity.ops[entity.ops.length - 1].createdAt : '';
  }

  const columns: Column<OverrideEntity>[] = [
    { key: 'entityType', header: 'Entity type', sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'ops', header: 'Ops', align: 'right', sortable: true, sortAccessor: (row) => row.ops.length },
    {
      key: 'lastChange',
      header: 'Last change',
      sortable: true,
      sortAccessor: (row) => lastChange(row),
    },
  ];

  $: filtered = data.entities.filter((entity) => {
    const query = $searchStore.query?.trim().toLowerCase();
    if (!query) return true;
    return (
      entity.name.toLowerCase().includes(query) ||
      ENTITY_TYPE_LABELS[entity.entityType].toLowerCase().includes(query) ||
      entity.entityType.toLowerCase().includes(query) ||
      (entity.arrType ?? '').toLowerCase().includes(query) ||
      entity.kind.includes(query)
    );
  });

  // Per-entity selected op ids (selective revert).
  let selectedOps: Record<string, number[]> = {};

  $: pruneSelectedOps(data.entities);

  function pruneSelectedOps(entities: OverrideEntity[]) {
    const next: Record<string, number[]> = {};
    for (const entity of entities) {
      const key = entityKey(entity);
      const selected = selectedOps[key];
      if (!selected?.length) continue;
      const availableIds = new Set(entity.ops.map((op) => op.id));
      const retained = selected.filter((id) => availableIds.has(id));
      if (retained.length > 0) next[key] = retained;
    }
    selectedOps = next;
  }

  function toggleOp(entity: OverrideEntity, opId: number, checked: boolean) {
    const key = entityKey(entity);
    const current = selectedOps[key] ?? [];
    const next = checked ? [...current, opId] : current.filter((id) => id !== opId);
    selectedOps = { ...selectedOps, [key]: next };
  }

  function isSelected(entity: OverrideEntity, opId: number): boolean {
    return (selectedOps[entityKey(entity)] ?? []).includes(opId);
  }

  // --- Revert -----------------------------------------------------------------

  type RevertTarget = {
    entity: OverrideEntity;
    opIds: number[] | null;
    cascadeGroup: boolean;
  };

  let revertTarget: RevertTarget | null = null;
  let reverting = false;
  let groupEntities: EntityRef[] = [];

  function requestRevertAll(entity: OverrideEntity) {
    groupEntities = [];
    revertTarget = { entity, opIds: null, cascadeGroup: false };
  }

  function requestRevertSelected(entity: OverrideEntity) {
    const opIds = selectedOps[entityKey(entity)] ?? [];
    if (opIds.length === 0) return;
    groupEntities = [];
    revertTarget = { entity, opIds: [...opIds], cascadeGroup: false };
  }

  function cancelRevert() {
    if (reverting) return;
    revertTarget = null;
  }

  function revertUrl(entity: EntityRef): string {
    const query = entity.arrType ? `?arrType=${encodeURIComponent(entity.arrType)}` : '';
    return (
      `/api/v1/pcd/${data.databaseId}/overrides/${entity.entityType}/` +
      `${encodeURIComponent(entity.name)}/revert${query}`
    );
  }

  async function executeRevert(target: RevertTarget) {
    reverting = true;
    try {
      const body: components['schemas']['PcdOverrideRevertRequest'] = {
        cascadeGroup: target.cascadeGroup,
      };
      if (target.opIds) body.opIds = target.opIds;
      const response = await fetch(revertUrl(target.entity), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => null)) as ErrorResponse | null;
        if (response.status === 409 && err?.reason === 'group_dependency') {
          groupEntities = err.entities ?? [];
          revertTarget = { ...target, cascadeGroup: true };
          alertStore.add(
            'warning',
            err.error ?? 'These operations are grouped with other entities. Revert the group together to continue.'
          );
          return;
        }
        const message = err?.error ?? `Failed to revert (HTTP ${response.status})`;
        const blockingOps = err?.blockingOpIds?.length
          ? ` Blocking operation IDs: ${err.blockingOpIds.join(', ')}.`
          : '';
        alertStore.add('error', `${message}${blockingOps}`);
        revertTarget = null;
        if (response.status === 404 || response.status === 409) await invalidateAll();
        return;
      }
      const result = (await response.json()) as components['schemas']['PcdOverrideRevertResult'];
      selectedOps = { ...selectedOps, [entityKey(target.entity)]: [] };
      revertTarget = null;
      alertStore.add(
        'success',
        `Reverted ${result.revertedOpIds.length} operation${result.revertedOpIds.length === 1 ? '' : 's'} for "${target.entity.name}"`
      );
      await invalidateAll();
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Failed to revert');
      revertTarget = null;
    } finally {
      reverting = false;
    }
  }

  function confirmRevert() {
    if (!revertTarget || reverting) return;
    void executeRevert(revertTarget);
  }

  // --- Undo -------------------------------------------------------------------

  let undoOpen = false;
  let undoing = false;

  $: undoEntityNames = (data.lastAction?.entities ?? []).map((entity) => entity.name).join(', ');

  function requestUndo() {
    if (!data.lastAction) return;
    undoOpen = true;
  }

  function cancelUndo() {
    if (undoing) return;
    undoOpen = false;
  }

  async function confirmUndo() {
    if (!data.lastAction || undoing) return;
    undoing = true;
    try {
      const body: components['schemas']['PcdOverrideUndoRequest'] = {
        expectedActionId: data.lastAction.actionId,
      };
      const response = await fetch(`/api/v1/pcd/${data.databaseId}/overrides/undo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => null)) as ErrorResponse | null;
        alertStore.add('error', err?.error ?? `Failed to undo (HTTP ${response.status})`);
        undoOpen = false;
        await invalidateAll();
        return;
      }
      const result = (await response.json()) as components['schemas']['PcdOverrideUndoResult'];
      undoOpen = false;
      alertStore.add(
        'success',
        `Undid last change (${result.revertedOpIds.length} operation${result.revertedOpIds.length === 1 ? '' : 's'} reverted)`
      );
      await invalidateAll();
    } catch (error) {
      alertStore.add('error', error instanceof Error ? error.message : 'Failed to undo');
      undoOpen = false;
    } finally {
      undoing = false;
    }
  }
</script>

<PageTitle parts={['Local overrides', $page.data.database?.name]} />

<div class="space-y-6 pt-4">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Local overrides</h1>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Entities that differ from the upstream (base) layer because of local edits. Reverting drops the local operations
        so the entity matches upstream again.
      </p>
    </div>
  </div>

  <ActionsBar className="justify-end">
    <SearchAction {searchStore} placeholder="Search local overrides..." />
    <ActionButton icon={Undo2} label="Undo last change" disabled={!data.lastAction || undoing} on:click={requestUndo} />
  </ActionsBar>

  {#if data.lastAction}
    <p class="text-xs text-neutral-500 dark:text-neutral-400">
      Undo last change will revert the most recent local change{#if undoEntityNames}
        affecting {undoEntityNames}{/if}
      ({data.lastAction.opIds.length} operation{data.lastAction.opIds.length === 1 ? '' : 's'},{' '}
      {formatWhen(data.lastAction.createdAt)}).
    </p>
  {:else}
    <p class="text-xs text-neutral-500 dark:text-neutral-400">There is no local change to undo.</p>
  {/if}

  {#if data.unmappedOpCount > 0}
    <div
      class="rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-200"
    >
      {data.unmappedOpCount} local operation{data.unmappedOpCount === 1 ? " isn't" : "s aren't"} tied to a manageable entity;
      they are included in Undo.
    </div>
  {/if}

  {#if data.unavailable}
    <div
      class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-200"
    >
      This database is not available right now, so local overrides cannot be loaded.
    </div>
  {:else if data.entities.length === 0}
    <div
      class="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      No local overrides — this database matches upstream.
    </div>
  {:else}
    <ExpandableTable
      {columns}
      data={filtered}
      getRowId={(row) => entityKey(row)}
      emptyMessage="No local overrides match your search."
      compact
      responsive
    >
      <svelte:fragment slot="cell" let:row let:column>
        {#if column.key === 'entityType'}
          <span class="inline-flex flex-wrap items-center gap-1.5">
            <Badge variant="info" size="sm">{ENTITY_TYPE_LABELS[row.entityType]}</Badge>
            {#if row.arrType}
              <Badge variant={arrVariant(row.arrType)} size="sm">{row.arrType}</Badge>
            {/if}
          </span>
        {:else if column.key === 'name'}
          <span class="inline-flex flex-wrap items-center gap-1.5">
            <span class="font-medium text-neutral-900 dark:text-neutral-100">{row.name}</span>
            <Badge variant={KIND_META[row.kind].variant} size="sm">{KIND_META[row.kind].label}</Badge>
            {#if row.hasPendingConflict}
              <Badge variant="warning" size="sm" icon={AlertTriangle}>Pending conflict</Badge>
            {/if}
          </span>
        {:else if column.key === 'ops'}
          <span class="font-mono text-xs text-neutral-600 dark:text-neutral-400">{row.ops.length}</span>
        {:else if column.key === 'lastChange'}
          <span class="font-mono text-xs text-neutral-600 dark:text-neutral-400">
            {lastChange(row) ? formatWhen(lastChange(row)) : '—'}
          </span>
        {/if}
      </svelte:fragment>

      <svelte:fragment slot="actions" let:row>
        <div class="flex items-center justify-end gap-1">
          <Button
            text="Revert selected"
            size="xs"
            disabled={reverting || (selectedOps[entityKey(row)] ?? []).length === 0}
            on:click={() => requestRevertSelected(row)}
          />
          <Button
            text="Revert all"
            size="xs"
            variant="danger"
            disabled={reverting}
            on:click={() => requestRevertAll(row)}
          />
        </div>
      </svelte:fragment>

      <svelte:fragment slot="expanded" let:row>
        <div class="space-y-5 p-4">
          <div>
            <h3 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              Field changes from upstream
            </h3>
            {#if row.overrides.length === 0}
              <p class="text-sm text-neutral-500 dark:text-neutral-400">
                No field differences — the local operations net out to the upstream values, but they can still be
                reverted.
              </p>
            {:else}
              <div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
                <table class="w-full text-sm">
                  <thead class="bg-neutral-50 dark:bg-neutral-900">
                    <tr
                      class="text-left text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
                    >
                      <th class="px-4 py-2">Field</th>
                      <th class="px-4 py-2">Change</th>
                      <th class="px-4 py-2">Base value</th>
                      <th class="px-4 py-2">Resolved value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each row.overrides as fieldChange (fieldChange.field)}
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
          </div>

          <div>
            <h3 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              Local operations
            </h3>
            <ul
              class="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
            >
              {#each row.ops as op (op.id)}
                <li class="flex items-start gap-3 px-4 py-2.5">
                  <input
                    type="checkbox"
                    class="mt-1"
                    checked={isSelected(row, op.id)}
                    aria-label={`Select operation ${op.id} for revert`}
                    on:change={(event) => toggleOp(row, op.id, (event.currentTarget as HTMLInputElement).checked)}
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                        #{op.id}
                      </span>
                      <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {op.title}
                      </span>
                      <Badge variant="neutral" size="sm">{op.operation}</Badge>
                      {#if op.status}
                        <Badge variant="neutral" size="sm">{op.status}</Badge>
                      {/if}
                    </div>
                    {#if op.summary}
                      <p class="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{op.summary}</p>
                    {/if}
                    <p class="mt-0.5 font-mono text-xs text-neutral-500 dark:text-neutral-400">
                      {formatWhen(op.createdAt)}{#if op.changedFields.length > 0}
                        · {op.changedFields.join(', ')}{/if}
                    </p>
                  </div>
                </li>
              {/each}
            </ul>
            <div class="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                text="Revert selected"
                size="sm"
                disabled={reverting || (selectedOps[entityKey(row)] ?? []).length === 0}
                on:click={() => requestRevertSelected(row)}
              />
              <Button
                text="Revert all"
                size="sm"
                variant="danger"
                icon={RotateCcw}
                disabled={reverting}
                on:click={() => requestRevertAll(row)}
              />
            </div>
          </div>
        </div>
      </svelte:fragment>
    </ExpandableTable>
  {/if}
</div>

<Modal
  open={revertTarget !== null}
  header={revertTarget?.cascadeGroup ? 'Revert group together' : 'Revert local overrides'}
  confirmText={revertTarget?.cascadeGroup ? 'Revert group together' : 'Revert'}
  cancelText="Cancel"
  confirmDanger
  loading={reverting}
  on:confirm={confirmRevert}
  on:cancel={cancelRevert}
>
  <div slot="body" class="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
    {#if revertTarget}
      {#if revertTarget.cascadeGroup}
        <p>These operations are grouped with operations on other entities, so they can only be reverted together.</p>
        {#if groupEntities.length > 0}
          <ul class="list-disc space-y-1 pl-5">
            {#each groupEntities as entity (entityKey(entity))}
              <li>
                {ENTITY_TYPE_LABELS[entity.entityType] ?? entity.entityType} — {entity.name}{#if entity.arrType}
                  ({entity.arrType}){/if}
              </li>
            {/each}
          </ul>
        {/if}
        <p>Reverting the group will drop the local operations for all of these entities.</p>
      {:else if revertTarget.opIds}
        <p>
          Revert {revertTarget.opIds.length} selected operation{revertTarget.opIds.length === 1 ? '' : 's'} for "{revertTarget
            .entity.name}"? The remaining local operations stay in place.
        </p>
      {:else}
        <p>
          Revert all local operations for "{revertTarget.entity.name}"? The entity will match upstream again{#if revertTarget.entity.kind === 'created'}
            and will be removed, since it was created locally{/if}{#if revertTarget.entity.kind === 'deleted'}
            and will be restored from upstream{/if}.
        </p>
      {/if}
    {/if}
  </div>
</Modal>

<Modal
  open={undoOpen}
  header="Undo last change"
  confirmText="Undo"
  cancelText="Cancel"
  confirmDanger
  loading={undoing}
  on:confirm={confirmUndo}
  on:cancel={cancelUndo}
>
  <div slot="body" class="space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
    <p>
      Undo the most recent local change{#if undoEntityNames}
        affecting {undoEntityNames}{/if}? This can't be redone except by editing again.
    </p>
  </div>
</Modal>
