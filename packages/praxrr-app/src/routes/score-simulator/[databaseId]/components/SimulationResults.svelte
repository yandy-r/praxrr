<script lang="ts">
  import {
    HardDrive,
    Layers,
    Tag,
    Earth,
    Calendar,
    Users,
    Bookmark,
    CircleCheck,
    CircleX,
    Loader2,
    TriangleAlert,
    ChevronLeft,
    ChevronRight,
  } from 'lucide-svelte';
  import type { ComponentType } from 'svelte';
  import ExpandableTable from '$ui/table/ExpandableTable.svelte';
  import type { Column } from '$ui/table/types';
  import CustomFormatBadge from '$ui/arr/CustomFormatBadge.svelte';
  import Score from '$ui/arr/Score.svelte';
  import Badge from '$ui/badge/Badge.svelte';
  import type { components } from '$api/v1.d.ts';

  type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];
  type SimulateReleaseResult = components['schemas']['SimulateReleaseResult'];
  type SimulateProfileScore = components['schemas']['SimulateProfileScore'];
  type SimulateConditionResult = components['schemas']['SimulateConditionResult'];

  interface MetadataBadgeItem {
    label: string;
    value: string;
    icon: ComponentType;
    iconClass: string;
  }

  interface CustomFormatRow {
    name: string;
    matches: boolean;
    score: number;
    conditions: SimulateConditionResult[];
  }

  export let result: SimulateScoreResponse | null = null;
  export let selectedProfileName: string | null = null;
  export let selectedProfileLabel: string | null = null;
  export let isSimulating: boolean = false;
  export let releaseId: string | null = null;

  let expandedRows: Set<string | number> = new Set();

  $: releaseResult = releaseId
    ? (result?.results?.find((r) => r.id === releaseId) ?? null)
    : (result?.results?.[0] ?? null);
  $: profileScore = getProfileScore(releaseResult, selectedProfileName);
  $: scoreByCfName = new Map(profileScore?.contributions.map((item) => [item.cfName, item.score]) ?? []);
  $: customFormatRows = mapCustomFormatRows(releaseResult, scoreByCfName);
  $: sortedCustomFormatRows = [...customFormatRows].sort(compareCustomFormatRows);

  const CF_PAGE_SIZE = 15;
  let cfPage = 0;
  $: totalCfPages = Math.max(1, Math.ceil(sortedCustomFormatRows.length / CF_PAGE_SIZE));
  $: cfPage = Math.min(cfPage, totalCfPages - 1);
  $: paginatedCfRows = sortedCustomFormatRows.slice(cfPage * CF_PAGE_SIZE, (cfPage + 1) * CF_PAGE_SIZE);
  // Reset to page 0 when the release changes (new simulation result or different
  // release selection), but NOT on every sort/profile change — sortedCustomFormatRows
  // produces a new array reference on every reactive update, making
  // `if (sortedCustomFormatRows)` vacuously truthy and resetting the page on
  // profile switches even when the user is mid-pagination.
  $: if (releaseResult) cfPage = 0;

  const tableColumns: Column<CustomFormatRow>[] = [
    { key: 'name', header: 'Custom Format', sortable: true },
    { key: 'matches', header: 'Match', width: 'w-24', align: 'center', sortable: true },
    {
      key: 'score',
      header: 'Score',
      width: 'w-24',
      align: 'right',
      sortable: true,
      sortAccessor: (row) => row.score,
    },
  ];

  $: metadataBadges = buildMetadataBadges(releaseResult);
  $: hasResults = releaseResult !== null && profileScore !== null;

  function getProfileScore(
    release: SimulateReleaseResult | null,
    profileName: string | null
  ): SimulateProfileScore | null {
    if (!release || !profileName) return null;
    return release.profileScores.find((profile) => profile.profileName === profileName) ?? null;
  }

  function mapCustomFormatRows(release: SimulateReleaseResult | null, scores: Map<string, number>): CustomFormatRow[] {
    if (!release) return [];
    return release.cfMatches.map((cfMatch) => ({
      name: cfMatch.name,
      matches: cfMatch.matches,
      score: scores.get(cfMatch.name) ?? 0,
      conditions: cfMatch.conditions,
    }));
  }

  function compareCustomFormatRows(a: CustomFormatRow, b: CustomFormatRow): number {
    if (a.matches !== b.matches) {
      return a.matches ? -1 : 1;
    }

    const absoluteScoreDiff = Math.abs(b.score) - Math.abs(a.score);
    if (absoluteScoreDiff !== 0) {
      return absoluteScoreDiff;
    }

    return a.name.localeCompare(b.name);
  }

  $: parseFailed = releaseResult !== null && releaseResult.parsed === null;

  function buildMetadataBadges(release: SimulateReleaseResult | null): MetadataBadgeItem[] {
    if (!release || !release.parsed) return [];

    const parsed = release.parsed;
    return [
      {
        label: 'Source',
        value: parsed.source || '—',
        icon: HardDrive,
        iconClass: 'text-blue-500',
      },
      {
        label: 'Resolution',
        value: parsed.resolution || '—',
        icon: Layers,
        iconClass: 'text-indigo-500',
      },
      {
        label: 'Modifier',
        value: parsed.modifier || '—',
        icon: Tag,
        iconClass: 'text-amber-500',
      },
      {
        label: 'Languages',
        value: parsed.languages.length > 0 ? parsed.languages.join(', ') : '—',
        icon: Earth,
        iconClass: 'text-emerald-500',
      },
      {
        label: 'Year',
        value: parsed.year > 0 ? String(parsed.year) : '—',
        icon: Calendar,
        iconClass: 'text-purple-500',
      },
      {
        label: 'Release Group',
        value: parsed.releaseGroup?.trim() ? parsed.releaseGroup : '—',
        icon: Users,
        iconClass: 'text-teal-500',
      },
      {
        label: 'Edition',
        value: parsed.edition?.trim() ? parsed.edition : '—',
        icon: Bookmark,
        iconClass: 'text-orange-500',
      },
    ];
  }

  function getRowId(row: CustomFormatRow): string {
    return row.name;
  }

  function formatConditionType(conditionType: string): string {
    return conditionType
      .split('_')
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }

  function isNotApplicableCondition(conditionType: string): boolean {
    return conditionType === 'indexer_flag' || conditionType === 'size';
  }

  function getConditionValue(condition: SimulateConditionResult, key: 'expected' | 'actual'): string {
    if (isNotApplicableCondition(condition.conditionType)) {
      return 'N/A';
    }

    const value = key === 'expected' ? condition.expected : condition.actual;
    return value.trim().length > 0 ? value : '—';
  }
</script>

<div aria-live="polite" class="relative rounded-xl border border-neutral-200 p-4 dark:border-neutral-700/60">
  {#if isSimulating}
    <div class="pointer-events-none absolute inset-0 z-10 flex items-start justify-end p-3">
      <span
        class="inline-flex items-center gap-1.5 rounded-md bg-white/90 px-2 py-1 text-xs text-neutral-600 shadow-sm dark:bg-neutral-900/90 dark:text-neutral-300"
      >
        <Loader2 size={12} class="animate-spin" />
        Simulating...
      </span>
    </div>
  {/if}

  <div class:opacity-60={isSimulating} class="space-y-4">
    {#if !result}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        Run a simulation to see parsed metadata, custom format matches, and score impact.
      </div>
    {:else if !hasResults}
      <div
        class="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        Select a quality profile to show scoring results.
      </div>
    {:else}
      {#if parseFailed}
        <div
          class="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <TriangleAlert size={16} class="shrink-0" />
          <span>Parser could not parse this release title. Metadata and custom format matching are unavailable.</span>
        </div>
      {/if}

      {#if !parseFailed}
        <section class="space-y-3">
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Parsed Metadata</h3>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {#each metadataBadges as item (item.label)}
              <div
                class="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800"
              >
                <svelte:component this={item.icon} size={12} class={item.iconClass} />
                <span class="text-neutral-500 dark:text-neutral-400">{item.label}</span>
                <span class="font-medium text-neutral-800 dark:text-neutral-100">{item.value}</span>
              </div>
            {/each}
          </div>
        </section>

        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Custom Format Matches</h3>
            {#if selectedProfileLabel ?? selectedProfileName}
              <Badge variant="neutral" size="sm">{selectedProfileLabel ?? selectedProfileName}</Badge>
            {/if}
          </div>

          <ExpandableTable
            columns={tableColumns}
            data={paginatedCfRows}
            {getRowId}
            compact={true}
            emptyMessage="No custom formats available"
            chevronPosition="right"
            responsive={true}
            defaultSort={null}
            disableExpandWhen={(row) => row.conditions.length === 0}
            bind:expandedRows
          >
            <svelte:fragment slot="cell" let:row let:column>
              {#if column.key === 'name'}
                <CustomFormatBadge name={row.name} score={row.score} />
              {:else if column.key === 'matches'}
                {#if row.matches}
                  <span class="inline-flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                    <CircleCheck size={16} />
                  </span>
                {:else}
                  <span class="inline-flex items-center justify-center text-red-600 dark:text-red-400">
                    <CircleX size={16} />
                  </span>
                {/if}
              {:else if column.key === 'score'}
                <Score score={row.score} />
              {/if}
            </svelte:fragment>

            <svelte:fragment slot="expanded" let:row>
              <div class="p-3">
                <table class="w-full text-xs">
                  <thead>
                    <tr
                      class="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
                    >
                      <th class="px-2 py-2 font-medium">Condition</th>
                      <th class="px-2 py-2 font-medium">Type</th>
                      <th class="px-2 py-2 font-medium">Expected</th>
                      <th class="px-2 py-2 font-medium">Actual</th>
                      <th class="px-2 py-2 text-right font-medium">Passes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each row.conditions as condition (condition.conditionName)}
                      <tr class="border-b border-neutral-100 dark:border-neutral-800">
                        <td class="px-2 py-2 align-top">
                          <div class="flex flex-wrap items-center gap-1.5">
                            <span class="font-medium text-neutral-800 dark:text-neutral-100"
                              >{condition.conditionName}</span
                            >
                            {#if condition.required}
                              <Badge variant="warning" size="sm">Required</Badge>
                            {/if}
                            {#if condition.negate}
                              <Badge variant="info" size="sm">Negate</Badge>
                            {/if}
                          </div>
                        </td>
                        <td class="px-2 py-2 font-mono text-neutral-600 dark:text-neutral-300">
                          {formatConditionType(condition.conditionType)}
                        </td>
                        <td class="px-2 py-2 text-neutral-700 dark:text-neutral-200">
                          {getConditionValue(condition, 'expected')}
                        </td>
                        <td class="px-2 py-2 text-neutral-700 dark:text-neutral-200">
                          {getConditionValue(condition, 'actual')}
                        </td>
                        <td class="px-2 py-2 text-right">
                          {#if condition.passes}
                            <span
                              class="inline-flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400"
                            >
                              <CircleCheck size={14} />
                              Pass
                            </span>
                          {:else}
                            <span class="inline-flex items-center justify-end gap-1 text-red-600 dark:text-red-400">
                              <CircleX size={14} />
                              Fail
                            </span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </svelte:fragment>
          </ExpandableTable>

          {#if totalCfPages > 1}
            <div class="flex items-center justify-between pt-2">
              <span class="text-xs text-neutral-500 dark:text-neutral-400">
                {cfPage * CF_PAGE_SIZE + 1}–{Math.min((cfPage + 1) * CF_PAGE_SIZE, sortedCustomFormatRows.length)} of {sortedCustomFormatRows.length}
              </span>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="inline-flex items-center justify-center rounded-md border border-neutral-300 p-1.5 text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  disabled={cfPage === 0}
                  on:click={() => (cfPage = Math.max(0, cfPage - 1))}
                >
                  <ChevronLeft size={14} />
                </button>
                <span class="px-2 text-xs text-neutral-600 dark:text-neutral-300">
                  {cfPage + 1} / {totalCfPages}
                </span>
                <button
                  type="button"
                  class="inline-flex items-center justify-center rounded-md border border-neutral-300 p-1.5 text-neutral-600 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  disabled={cfPage >= totalCfPages - 1}
                  on:click={() => (cfPage = Math.min(totalCfPages - 1, cfPage + 1))}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          {/if}
        </section>
      {/if}
    {/if}
  </div>
</div>
