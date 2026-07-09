<script lang="ts">
  import type { SyncEntityChange, SyncPreviewSection } from '$sync/syncHistory/types.ts';
  import type { SyncPreviewAction } from '$sync/preview/types.ts';
  import { FIELD_META, formatFieldValue } from '$ui/resolved/fieldChangeDisplay.ts';

  /**
   * Dumb (presentational) sync-history diff renderer. Given the flat list of
   * `SyncEntityChange`s captured for one audited sync run, it groups them by section
   * then by category and renders each entity (entityType + name + action badge) with
   * its field-level before -> after diff table.
   *
   * It self-fetches nothing and never inverts the field direction: `current` is always
   * the LIVE (old) Arr value and `desired` is always the PCD (new) value, exactly as
   * persisted. Mirrors `$ui/drift/DriftFieldDiff.svelte`. Renders nothing when empty;
   * the detail page handles the empty/degrade case.
   */
  export let changes: SyncEntityChange[];

  interface CategoryGroup {
    category: string;
    label: string;
    entities: SyncEntityChange[];
  }

  interface SectionGroup {
    section: SyncPreviewSection;
    label: string;
    categories: CategoryGroup[];
  }

  const SECTION_LABEL: Record<SyncPreviewSection, string> = {
    qualityProfiles: 'Quality Profiles',
    delayProfiles: 'Delay Profiles',
    mediaManagement: 'Media Management',
    metadataProfiles: 'Metadata Profiles',
  };

  const ACTION_META: Record<SyncPreviewAction, { label: string; textClass: string }> = {
    create: { label: 'Create', textClass: 'text-emerald-700 dark:text-emerald-300' },
    update: { label: 'Update', textClass: 'text-amber-700 dark:text-amber-300' },
    delete: { label: 'Delete', textClass: 'text-red-700 dark:text-red-300' },
    unchanged: { label: 'Unchanged', textClass: 'text-neutral-500 dark:text-neutral-400' },
  };

  /** Humanizes a raw camelCase category key (e.g. `customFormats` -> `Custom Formats`). */
  function humanize(value: string): string {
    const spaced = value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim();
    if (spaced.length === 0) return value;
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function groupChanges(input: SyncEntityChange[]): SectionGroup[] {
    const sections: SectionGroup[] = [];
    const sectionIndex = new Map<SyncPreviewSection, SectionGroup>();

    for (const change of input) {
      let section = sectionIndex.get(change.section);
      if (!section) {
        section = { section: change.section, label: SECTION_LABEL[change.section] ?? change.section, categories: [] };
        sectionIndex.set(change.section, section);
        sections.push(section);
      }

      let category = section.categories.find((entry) => entry.category === change.category);
      if (!category) {
        category = { category: change.category, label: humanize(change.category), entities: [] };
        section.categories.push(category);
      }

      category.entities.push(change);
    }

    return sections;
  }

  $: groups = groupChanges(changes);
</script>

{#if groups.length > 0}
  <div class="flex flex-col gap-6">
    {#each groups as section (section.section)}
      <section class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{section.label}</h3>
        {#each section.categories as category (category.category)}
          <div class="flex flex-col gap-2">
            <h4 class="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              {category.label}
            </h4>
            {#each category.entities as change (change.entityType + ':' + change.name)}
              {@const actionMeta = ACTION_META[change.action]}
              <div class="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
                <div
                  class="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {change.entityType} <span class="text-neutral-500 dark:text-neutral-400">"{change.name}"</span>
                  </span>
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {actionMeta.textClass}"
                  >
                    {actionMeta.label}
                  </span>
                </div>
                {#if change.action === 'update' && change.fields.length > 0}
                  <table class="w-full text-sm">
                    <thead class="bg-neutral-50 dark:bg-neutral-900">
                      <tr
                        class="text-left text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
                      >
                        <th class="px-4 py-2">Field</th>
                        <th class="px-4 py-2">Change</th>
                        <th class="px-4 py-2">Before (live)</th>
                        <th class="px-4 py-2">After (PCD)</th>
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
          </div>
        {/each}
      </section>
    {/each}
  </div>
{/if}
