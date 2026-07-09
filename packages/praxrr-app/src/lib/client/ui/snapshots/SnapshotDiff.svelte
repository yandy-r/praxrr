<script lang="ts">
  import type { RollbackSection, RollbackSummary } from '$pcd/snapshots/rollback/types.ts';
  import type { EntityChange, SyncPreviewAction } from '$sync/preview/types.ts';
  import { FIELD_META, formatFieldValue } from '$ui/resolved/fieldChangeDisplay.ts';

  /**
   * Dumb (presentational) rollback / point-in-time-restore diff renderer. Given the grouped
   * `RollbackSection`s from a `RollbackPreview`, it renders each family as a group of
   * `EntityChange` rows (entityType + name + action badge) with a field-level Current ->
   * After-restore table.
   *
   * Direction never inverts: `FieldChange.current` is the CURRENT PCD desired-state and
   * `FieldChange.desired` is the SNAPSHOT restore-target, so the columns read "Current" and
   * "After restore" — never "Desired". Mirrors `$ui/sync-history/SyncHistoryDiff.svelte`.
   *
   * The preview enumerates every config family and every entity (including unchanged ones);
   * this component focuses the view on actionable changes (create/update/delete) and reports
   * the unchanged tally per section so the noise stays out of the diff.
   */
  export let sections: RollbackSection[];
  export let summary: RollbackSummary;

  interface VisibleSection {
    title: string;
    key: string;
    actionable: EntityChange[];
    unchangedCount: number;
  }

  const ACTION_META: Record<SyncPreviewAction, { label: string; textClass: string }> = {
    create: { label: 'Create', textClass: 'text-emerald-700 dark:text-emerald-300' },
    update: { label: 'Update', textClass: 'text-amber-700 dark:text-amber-300' },
    delete: { label: 'Delete', textClass: 'text-red-700 dark:text-red-300' },
    unchanged: { label: 'Unchanged', textClass: 'text-neutral-500 dark:text-neutral-400' },
  };

  function toVisibleSections(input: RollbackSection[]): VisibleSection[] {
    const result: VisibleSection[] = [];
    for (const section of input) {
      const actionable = section.changes.filter((change) => change.action !== 'unchanged');
      if (actionable.length === 0) {
        continue;
      }
      result.push({
        title: section.title,
        key: section.entityType,
        actionable,
        unchangedCount: section.changes.length - actionable.length,
      });
    }
    return result;
  }

  $: visibleSections = toVisibleSections(sections);
  $: hasChanges = summary.totalCreates + summary.totalUpdates + summary.totalDeletes > 0;
</script>

<div class="flex flex-col gap-6">
  <!-- Summary legend -->
  <div class="flex flex-wrap items-center gap-2 text-xs font-medium">
    <span
      class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
    >
      {summary.totalCreates} create
    </span>
    <span
      class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
    >
      {summary.totalUpdates} update
    </span>
    <span
      class="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-300"
    >
      {summary.totalDeletes} delete
    </span>
    <span
      class="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
    >
      {summary.totalUnchanged} unchanged
    </span>
  </div>

  {#if !hasChanges}
    <div
      class="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
    >
      This snapshot matches the current PCD state — restoring it would make no changes.
    </div>
  {:else}
    {#each visibleSections as section (section.key)}
      <section class="flex flex-col gap-3">
        <div class="flex flex-wrap items-baseline gap-2">
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{section.title}</h3>
          {#if section.unchangedCount > 0}
            <span class="text-xs text-neutral-500 dark:text-neutral-400">
              {section.unchangedCount} unchanged
            </span>
          {/if}
        </div>

        {#each section.actionable as change (change.entityType + ':' + change.name)}
          {@const actionMeta = ACTION_META[change.action]}
          <div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div
              class="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                "{change.name}"
              </span>
              <span class="font-mono text-xs text-neutral-400 dark:text-neutral-500">{change.entityType}</span>
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {actionMeta.textClass}"
              >
                {actionMeta.label}
              </span>
            </div>

            {#if change.fields.length > 0}
              <table class="w-full text-sm">
                <thead class="bg-neutral-50 dark:bg-neutral-900">
                  <tr
                    class="text-left text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
                  >
                    <th class="px-4 py-2">Field</th>
                    <th class="px-4 py-2">Change</th>
                    <th class="px-4 py-2">Current</th>
                    <th class="px-4 py-2">After restore</th>
                  </tr>
                </thead>
                <tbody>
                  {#each change.fields as fieldChange (fieldChange.field)}
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
            {/if}
          </div>
        {/each}
      </section>
    {/each}
  {/if}
</div>
