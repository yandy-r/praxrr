<script lang="ts">
  import NarrationBlock from '$ui/narration/NarrationBlock.svelte';
  import { narrateEntityChange } from '$shared/narration/index.ts';
  import type { NarrationLevel } from '$shared/narration/index.ts';
  import type {
    EntityChange,
    SyncPreviewArrType,
    SyncPreviewFieldChangeType,
    SyncPreviewSection,
  } from '$sync/preview/types.ts';

  export let entity: EntityChange;
  export let arrType: SyncPreviewArrType;
  export let section: SyncPreviewSection;
  export let level: NarrationLevel;
  export let defaultExpanded = false;

  let expanded = defaultExpanded;

  type ActionType = EntityChange['action'];
  type ActionMeta = {
    icon: string;
    label: string;
    bgClass: string;
    textClass: string;
  };
  const ACTION_META: Record<ActionType, ActionMeta> = {
    create: {
      icon: '+',
      label: 'Planned create',
      bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
      textClass: 'text-emerald-700 dark:text-emerald-300',
    },
    update: {
      icon: '~',
      label: 'Planned update',
      bgClass: 'bg-amber-100 dark:bg-amber-900/30',
      textClass: 'text-amber-700 dark:text-amber-300',
    },
    delete: {
      icon: '-',
      label: 'Planned delete',
      bgClass: 'bg-red-100 dark:bg-red-900/30',
      textClass: 'text-red-700 dark:text-red-300',
    },
    unchanged: {
      icon: '=',
      label: 'Already matching',
      bgClass: 'bg-neutral-100 dark:bg-neutral-800',
      textClass: 'text-neutral-600 dark:text-neutral-300',
    },
  };

  type FieldMeta = {
    label: string;
    textClass: string;
  };
  const FIELD_META: Record<SyncPreviewFieldChangeType, FieldMeta> = {
    added: {
      label: 'Added',
      textClass: 'text-emerald-700 dark:text-emerald-300',
    },
    changed: {
      label: 'Changed',
      textClass: 'text-amber-700 dark:text-amber-300',
    },
    removed: {
      label: 'Removed',
      textClass: 'text-red-700 dark:text-red-300',
    },
  };

  $: actionMeta = ACTION_META[entity.action];
  $: narration = narrateEntityChange(entity, arrType, section, level);
  $: entityLabel = `${entity.name}`;
  $: entityMeta = `${entity.entityType}${entity.remoteId ? ` (id: ${entity.remoteId})` : ''}`;
  $: summaryText = entity.fields.length === 1 ? '1 field change' : `${entity.fields.length} field changes`;

  function formatValue(value: unknown): string {
    if (value === undefined) {
      return 'undefined';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value, null, 2);
  }

  function toggle() {
    expanded = !expanded;
  }
</script>

<div class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
  <button
    type="button"
    class="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
    aria-expanded={expanded}
    on:click={toggle}
  >
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-neutral-900 dark:text-neutral-50">{entityLabel}</span>
        <span
          class="inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold {actionMeta.bgClass} {actionMeta.textClass}"
        >
          {actionMeta.icon}
          {actionMeta.label}
        </span>
      </div>
      <div class="text-xs text-neutral-500 dark:text-neutral-400">{entityMeta}</div>
    </div>
    <div class="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
      {#if entity.fields.length === 0}
        <span>No field diffs</span>
      {:else}
        <span>{summaryText}</span>
      {/if}
      <span class="text-neutral-400">{expanded ? '▾' : '▸'}</span>
    </div>
  </button>

  {#if expanded}
    <div class="space-y-3 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">
      <NarrationBlock line={narration} verbose={level === 'verbose'} />
      {#if entity.fields.length === 0}
        <p class="text-sm text-neutral-600 dark:text-neutral-400">
          No field-level differences were detected for this entity.
        </p>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr
                class="border-b border-neutral-200 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
              >
                <th class="pb-2 font-medium">Field</th>
                <th class="pb-2 font-medium">Change</th>
                <th class="pb-2 font-medium">Current</th>
                <th class="pb-2 font-medium">Desired</th>
              </tr>
            </thead>
            <tbody>
              {#each entity.fields as fieldChange}
                {@const fieldMeta = FIELD_META[fieldChange.type]}
                <tr class="border-b border-neutral-100 dark:border-neutral-800">
                  <td class="py-2 align-top font-mono text-xs text-neutral-700 dark:text-neutral-200">
                    {fieldChange.field}
                  </td>
                  <td class="py-2 align-top">
                    <span class={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${fieldMeta.textClass}`}
                      >{fieldMeta.label}</span
                    >
                  </td>
                  <td class="py-2 align-top">
                    <pre
                      class="max-w-xs overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
{formatValue(fieldChange.current)}</pre>
                  </td>
                  <td class="py-2 align-top">
                    <pre
                      class="max-w-xs overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
{formatValue(fieldChange.desired)}</pre>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>
