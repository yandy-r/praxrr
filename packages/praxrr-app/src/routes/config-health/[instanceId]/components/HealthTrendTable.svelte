<script lang="ts">
  import type { components } from '$api/v1.d.ts';

  type TrendResult = components['schemas']['ConfigHealthTrendsResponse'];
  type TrendPoint = components['schemas']['ConfigHealthTrendPoint'];
  type TrendCriterion = components['schemas']['ConfigHealthTrendCriterion'];
  type EngineBoundary = components['schemas']['ConfigHealthTrendEngineBoundary'];

  export let result: TrendResult;
  export let timeZone: string = 'UTC';

  const PAGE_SIZE = 50;
  const countFormatter = new Intl.NumberFormat('en-US');

  const POINT_STATE_LABEL: Record<TrendPoint['state'], string> = {
    measured: 'Measured',
    unknown: 'Unknown — score not measured',
    'profile-missing': 'Profile missing at this snapshot',
    'not-recorded': 'Evidence not recorded',
  };

  const CRITERION_STATE_LABEL: Record<TrendCriterion['state'], string> = {
    measured: 'Measured',
    'not-evaluated': 'Not evaluated',
    'not-recorded': 'Not recorded',
  };

  function createTimestampFormatter(zone: string): Intl.DateTimeFormat {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZone: zone,
        timeZoneName: 'short',
      });
    } catch {
      return new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZone: 'UTC',
        timeZoneName: 'short',
      });
    }
  }

  let timestampFormatter = createTimestampFormatter(timeZone);
  let displayedTimeZone = timestampFormatter.resolvedOptions().timeZone;
  let currentPage = 1;
  let previousResult = result;
  let totalPages: number;
  let pageStart: number;
  let pageEnd: number;
  let visiblePoints: TrendPoint[];
  $: timestampFormatter = createTimestampFormatter(timeZone);
  $: displayedTimeZone = timestampFormatter.resolvedOptions().timeZone;
  $: totalPages = Math.max(1, Math.ceil(result.points.length / PAGE_SIZE));
  $: currentPage = Math.min(currentPage, totalPages);
  $: pageStart = (currentPage - 1) * PAGE_SIZE;
  $: pageEnd = Math.min(pageStart + PAGE_SIZE, result.points.length);
  $: visiblePoints = result.points.slice(pageStart, pageEnd);
  $: if (result !== previousResult) {
    previousResult = result;
    currentPage = 1;
  }

  function formatTimestamp(value: string): string {
    const timestamp = new Date(value);
    return Number.isFinite(timestamp.getTime())
      ? timestampFormatter.format(timestamp)
      : `${value} (${displayedTimeZone})`;
  }

  function formatCount(value: number): string {
    return countFormatter.format(value);
  }

  function formatPointScore(point: TrendPoint): string {
    if (point.score !== null) return String(point.score);
    if (point.state === 'unknown') return 'Not measured';
    if (point.state === 'profile-missing') return 'Profile unavailable';
    return 'Not recorded';
  }

  function formatBand(point: TrendPoint): string {
    if (point.band === 'healthy') return 'Healthy';
    if (point.band === 'attention') return 'Attention';
    if (point.band === 'needs-review') return 'Needs review';
    if (point.band === 'unknown') return 'Unknown';
    return point.state === 'profile-missing' ? 'Profile unavailable' : 'Not recorded';
  }

  function formatCriterionValue(value: number | null, state: TrendCriterion['state']): string {
    if (value !== null) return String(value);
    return state === 'not-evaluated' ? 'Not evaluated' : 'Not recorded';
  }

  function boundaryAt(pointIndex: number): EngineBoundary | undefined {
    return result.engineBoundaries.find((boundary) => boundary.pointIndex === pointIndex);
  }

  function stateClass(state: TrendPoint['state']): string {
    switch (state) {
      case 'measured':
        return 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200';
      case 'unknown':
        return 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
      case 'profile-missing':
        return 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200';
      case 'not-recorded':
        return 'border-neutral-300 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
    }
  }

  function criterionStateClass(state: TrendCriterion['state']): string {
    switch (state) {
      case 'measured':
        return 'text-emerald-700 dark:text-emerald-300';
      case 'not-evaluated':
        return 'text-amber-700 dark:text-amber-300';
      case 'not-recorded':
        return 'text-neutral-500 dark:text-neutral-400';
    }
  }
</script>

<section class="space-y-3" aria-labelledby="health-trend-table-heading">
  <div class="flex flex-wrap items-end justify-between gap-2">
    <div>
      <h3 id="health-trend-table-heading" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Historical evidence table
      </h3>
      <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {formatCount(result.counts.points)} persisted snapshot{result.counts.points === 1 ? '' : 's'} in canonical chronological
        order. Times are shown in {displayedTimeZone}.
      </p>
    </div>
    {#if result.counts.points === 1}
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        One point is evidence, but does not establish a trend.
      </p>
    {/if}
  </div>

  {#if result.points.length === 0}
    <div
      class="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-300"
    >
      No persisted snapshots match this selection.
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -- scroll region must be keyboard reachable on narrow screens -->
    <div
      class="focus-visible:ring-accent-500 max-w-full overflow-x-auto rounded-xl border border-neutral-300 bg-white focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:focus-visible:ring-offset-neutral-950"
      role="region"
      aria-label={`Config Health history table. Times shown in ${displayedTimeZone}. Scroll horizontally on narrow screens.`}
      tabindex="0"
    >
      <table id="health-trend-table" class="w-full min-w-[64rem] border-collapse text-left text-sm">
        <caption class="sr-only">
          Config Health points {formatCount(pageStart + 1)} through {formatCount(pageEnd)} of
          {formatCount(result.counts.points)} in server-provided chronological order, including snapshot identity, engine
          boundaries, evidence states, scores, bands, and persisted overall criterion values.
        </caption>
        <thead class="border-b border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/70">
          <tr>
            <th scope="col" class="w-52 px-4 py-3 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              Timestamp ({displayedTimeZone})
            </th>
            <th scope="col" class="w-24 px-4 py-3 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              Snapshot
            </th>
            <th scope="col" class="w-44 px-4 py-3 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              Engine
            </th>
            <th scope="col" class="w-56 px-4 py-3 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              Evidence state
            </th>
            <th scope="col" class="w-40 px-4 py-3 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              Score and band
            </th>
            <th scope="col" class="min-w-96 px-4 py-3 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
              Persisted criteria
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
          {#each visiblePoints as point, pointIndex (point.snapshotId)}
            <tr
              class="align-top odd:bg-white even:bg-neutral-50/60 dark:odd:bg-neutral-900 dark:even:bg-neutral-900/50"
            >
              <td class="px-4 py-4 text-neutral-800 dark:text-neutral-200">
                <time datetime={point.generatedAt} class="whitespace-nowrap">{formatTimestamp(point.generatedAt)}</time>
                <span class="mt-1 block font-mono text-[0.7rem] break-all text-neutral-500 dark:text-neutral-400">
                  {point.generatedAt}
                </span>
              </td>
              <th scope="row" class="px-4 py-4 font-mono font-medium text-neutral-900 dark:text-neutral-100">
                #{point.snapshotId}
              </th>
              <td class="px-4 py-4 text-neutral-700 dark:text-neutral-300">
                <span class="font-mono break-all">v{point.engineVersion}</span>
                {#if boundaryAt(pageStart + pointIndex)}
                  <span
                    class="mt-2 block rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
                  >
                    {pageStart + pointIndex === 0 ? 'Series starts' : 'Engine changed'} here
                  </span>
                {/if}
              </td>
              <td class="px-4 py-4">
                <span
                  class={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${stateClass(point.state)}`}
                >
                  {POINT_STATE_LABEL[point.state]}
                </span>
                <span class="mt-1 block font-mono text-[0.7rem] text-neutral-500 dark:text-neutral-400"
                  >{point.state}</span
                >
              </td>
              <td class="px-4 py-4 text-neutral-800 dark:text-neutral-200">
                <span class="block font-semibold">Score: {formatPointScore(point)}</span>
                <span class="mt-1 block">Band: {formatBand(point)}</span>
              </td>
              <td class="px-4 py-4">
                {#if result.normalizedFilter.profile !== null}
                  <p class="text-sm text-neutral-600 dark:text-neutral-300">
                    Historical profile criterion contributions were not recorded. This point contains profile score and
                    band evidence only.
                  </p>
                {:else if point.criteria.length === 0}
                  <p class="text-sm text-neutral-500 dark:text-neutral-400">
                    {point.state === 'not-recorded'
                      ? 'Criterion breakdown not recorded.'
                      : 'No persisted criterion entries.'}
                  </p>
                {:else}
                  <ul class="space-y-3" aria-label={`Persisted criteria for snapshot ${point.snapshotId}`}>
                    {#each point.criteria as criterion, criterionIndex (`${criterion.id}-${criterionIndex}`)}
                      <li class="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                        <div class="flex flex-wrap items-baseline justify-between gap-2">
                          <p
                            class="min-w-0 font-medium [overflow-wrap:anywhere] break-words text-neutral-900 dark:text-neutral-100"
                          >
                            {criterion.label}
                          </p>
                          <span class={`text-xs font-medium ${criterionStateClass(criterion.state)}`}>
                            {CRITERION_STATE_LABEL[criterion.state]}
                          </span>
                        </div>
                        <p class="mt-1 font-mono text-[0.7rem] break-all text-neutral-500 dark:text-neutral-400">
                          {criterion.id} · {criterion.state}
                        </p>
                        <dl class="mt-2 grid grid-cols-3 gap-3 text-xs">
                          <div>
                            <dt class="text-neutral-500 dark:text-neutral-400">Score</dt>
                            <dd class="mt-0.5 font-medium text-neutral-800 dark:text-neutral-200">
                              {formatCriterionValue(criterion.score, criterion.state)}
                            </dd>
                          </div>
                          <div>
                            <dt class="text-neutral-500 dark:text-neutral-400">Weight</dt>
                            <dd class="mt-0.5 font-medium text-neutral-800 dark:text-neutral-200">
                              {formatCriterionValue(criterion.weight, criterion.state)}
                            </dd>
                          </div>
                          <div>
                            <dt class="text-neutral-500 dark:text-neutral-400">Contribution</dt>
                            <dd class="mt-0.5 font-medium text-neutral-800 dark:text-neutral-200">
                              {formatCriterionValue(criterion.contribution, criterion.state)}
                            </dd>
                          </div>
                        </dl>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <nav
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900/60"
      aria-label="Historical evidence table pagination"
    >
      <p class="text-xs text-neutral-600 dark:text-neutral-300" role="status" aria-live="polite" aria-atomic="true">
        Showing chronological snapshots {formatCount(pageStart + 1)}–{formatCount(pageEnd)} of
        {formatCount(result.counts.points)}. Page {formatCount(currentPage)} of {formatCount(totalPages)}.
      </p>

      {#if totalPages > 1}
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="focus-visible:ring-accent-500 min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 dark:focus-visible:ring-offset-neutral-950"
            aria-label="First evidence page"
            aria-controls="health-trend-table"
            disabled={currentPage === 1}
            onclick={() => (currentPage = 1)}
          >
            First
          </button>
          <button
            type="button"
            class="focus-visible:ring-accent-500 min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 dark:focus-visible:ring-offset-neutral-950"
            aria-label="Previous evidence page"
            aria-controls="health-trend-table"
            disabled={currentPage === 1}
            onclick={() => (currentPage = Math.max(1, currentPage - 1))}
          >
            Previous
          </button>

          <label class="flex min-h-11 items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
            Page
            <select
              class="focus-visible:ring-accent-500 min-h-11 rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm text-neutral-900 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:focus-visible:ring-offset-neutral-950"
              aria-label="Historical evidence page"
              aria-controls="health-trend-table"
              bind:value={currentPage}
            >
              {#each Array(totalPages) as _, pageIndex}
                <option value={pageIndex + 1}>{pageIndex + 1} of {totalPages}</option>
              {/each}
            </select>
          </label>

          <button
            type="button"
            class="focus-visible:ring-accent-500 min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 dark:focus-visible:ring-offset-neutral-950"
            aria-label="Next evidence page"
            aria-controls="health-trend-table"
            disabled={currentPage === totalPages}
            onclick={() => (currentPage = Math.min(totalPages, currentPage + 1))}
          >
            Next
          </button>
          <button
            type="button"
            class="focus-visible:ring-accent-500 min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 dark:focus-visible:ring-offset-neutral-950"
            aria-label="Last evidence page"
            aria-controls="health-trend-table"
            disabled={currentPage === totalPages}
            onclick={() => (currentPage = totalPages)}
          >
            Last
          </button>
        </div>
      {/if}
    </nav>
  {/if}
</section>
