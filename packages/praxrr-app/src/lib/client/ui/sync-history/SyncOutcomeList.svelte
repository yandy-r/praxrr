<script lang="ts">
  import Badge from '$ui/badge/Badge.svelte';
  import type { SyncEntityOutcome } from '$sync/types.ts';
  import type { SyncPreviewSection } from '$sync/preview/types.ts';
  import { syncOutcomeLabel, syncOutcomeVariant } from '$ui/sync-history/syncOutcomeStatus.ts';

  /**
   * Presentational list of CONFIRMED per-entity apply outcomes (issue #232). Renders the actual
   * write results — grouped by section — separately from the planned preview/`SyncHistoryDiff`
   * changes, so a confirmed success/skip/failure is never mistaken for planned intent. Renders
   * nothing when empty; callers own the empty-state copy.
   */
  export let outcomes: SyncEntityOutcome[];

  interface SectionGroup {
    section: SyncPreviewSection;
    label: string;
    outcomes: SyncEntityOutcome[];
  }

  const SECTION_LABEL: Record<SyncPreviewSection, string> = {
    qualityProfiles: 'Quality Profiles',
    delayProfiles: 'Delay Profiles',
    mediaManagement: 'Media Management',
    metadataProfiles: 'Metadata Profiles'
  };

  function groupBySection(input: SyncEntityOutcome[]): SectionGroup[] {
    const groups: SectionGroup[] = [];
    const index = new Map<SyncPreviewSection, SectionGroup>();
    for (const outcome of input) {
      let group = index.get(outcome.section);
      if (!group) {
        group = { section: outcome.section, label: SECTION_LABEL[outcome.section] ?? outcome.section, outcomes: [] };
        index.set(outcome.section, group);
        groups.push(group);
      }
      group.outcomes.push(outcome);
    }
    return groups;
  }

  $: groups = groupBySection(outcomes);
</script>

{#if outcomes.length > 0}
  <div class="space-y-4">
    {#each groups as group (group.section)}
      <div class="space-y-2">
        <h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
          {group.label}
        </h3>
        <ul class="space-y-1.5">
          {#each group.outcomes as outcome, i (`${outcome.entityType}:${outcome.name}:${i}`)}
            <li
              class="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
            >
              <Badge variant={syncOutcomeVariant(outcome.status)}>{syncOutcomeLabel(outcome.action, outcome.status)}</Badge>
              <span class="font-medium text-neutral-900 dark:text-neutral-100">{outcome.name}</span>
              <span class="text-xs text-neutral-500 dark:text-neutral-400">{outcome.entityType}</span>
              {#if outcome.remoteId}
                <span class="text-xs text-neutral-400 dark:text-neutral-500">#{outcome.remoteId}</span>
              {/if}
              {#if outcome.reason}
                <span
                  class="w-full text-xs {outcome.status === 'failed'
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-neutral-500 dark:text-neutral-400'}"
                >
                  {outcome.reason}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
{/if}
