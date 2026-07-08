<script lang="ts">
  import type { DriftEntityChange } from '$sync/drift/types.ts';
  import { FIELD_META, formatFieldValue } from '$ui/resolved/fieldChangeDisplay.ts';

  /**
   * Dumb (presentational) drift entity renderer. Given a single precomputed
   * `DriftEntityChange`, it renders either the Field / Change / Current (live) / Desired
   * (PCD) table (for `update` entities with field-level diffs) or an identity-only row
   * (for `create` / `delete` entities, whose `fields` are always empty).
   *
   * It self-fetches nothing and never inverts the field direction: `current` is always the
   * LIVE Arr value and `desired` is always the PCD value, exactly as persisted.
   */
  export let change: DriftEntityChange;

  $: fields = change.fields;
  $: showFieldTable = change.action === 'update' && fields.length > 0;
</script>

{#if showFieldTable}
  <div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
    <div
      class="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {change.entityType} <span class="text-neutral-500 dark:text-neutral-400">"{change.name}"</span>
      </span>
    </div>
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
{:else}
  <div
    class="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700 dark:border-neutral-800 dark:text-neutral-300"
  >
    <span class="font-medium text-neutral-900 dark:text-neutral-100">
      {change.entityType} <span class="text-neutral-500 dark:text-neutral-400">"{change.name}"</span>
    </span>
    <span class="text-neutral-400 dark:text-neutral-500">—</span>
    <span class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
      {change.action}
    </span>
  </div>
{/if}
