<script lang="ts">
  import type { components } from '$lib/api/v1.d.ts';
  import { HEALTH_BAND_LABEL } from '$lib/client/ui/health/healthStatus.ts';
  import { ATTENTION_THRESHOLD, HEALTHY_THRESHOLD } from '$shared/health/index.ts';
  import Card from '$ui/card/Card.svelte';
  import TrendPlot from './TrendPlot.svelte';
  import {
    buildTrendChartEngineRules,
    buildTrendChartGeometry,
    collectBoundedTrendChartCriteria,
    trendChartPointX,
    type TrendChartCriterionDefinition,
    type TrendChartGapReason,
    type TrendChartGeometry,
    type TrendChartPoint,
  } from './trendChart.ts';

  type TrendResponse = components['schemas']['ConfigHealthTrendsResponse'];
  type TrendPoint = components['schemas']['ConfigHealthTrendPoint'];
  type TrendCriterion = components['schemas']['ConfigHealthTrendCriterion'];

  interface CriterionChart {
    definition: TrendChartCriterionDefinition;
    score: TrendChartGeometry;
    contribution: TrendChartGeometry;
  }

  export let result: TrendResponse;

  const WIDTH = 720;
  const HEIGHT = 260;
  const SMALL_HEIGHT = 220;
  const PADDING = { top: 18, right: 18, bottom: 42, left: 52 } as const;
  let selectedIndex = 0;

  function criterionPoint(
    point: TrendPoint,
    criterion: TrendCriterion | undefined,
    field: 'score' | 'contribution'
  ): TrendChartPoint {
    if (point.state !== 'measured') {
      return {
        generatedAt: point.generatedAt,
        engineVersion: point.engineVersion,
        state: point.state,
        score: null,
      };
    }

    return {
      generatedAt: point.generatedAt,
      engineVersion: point.engineVersion,
      state: criterion?.state ?? 'not-recorded',
      score: criterion?.[field] ?? null,
    };
  }

  function buildCriterionCharts(
    points: readonly TrendPoint[],
    definitions: readonly TrendChartCriterionDefinition[]
  ): CriterionChart[] {
    return definitions.map((definition) => {
      const criterionFor = (point: TrendPoint): TrendCriterion | undefined =>
        point.criteria.find((criterion) => criterion.id === definition.id);
      const scorePoints = points.map((point) => criterionPoint(point, criterionFor(point), 'score'));
      const contributionPoints = points.map((point) => criterionPoint(point, criterionFor(point), 'contribution'));
      const options = { width: WIDTH, height: SMALL_HEIGHT, padding: PADDING } as const;

      return {
        definition,
        score: buildTrendChartGeometry(scorePoints, options),
        contribution: buildTrendChartGeometry(contributionPoints, options),
      };
    });
  }

  function formatTimestamp(value: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 'Invalid recorded time';
    return new Date(timestamp).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');
  }

  function pointStateLabel(point: TrendPoint): string {
    switch (point.state) {
      case 'measured':
        return point.band === null ? 'Measured' : HEALTH_BAND_LABEL[point.band];
      case 'unknown':
        return 'Unknown score';
      case 'profile-missing':
        return 'Profile missing';
      case 'not-recorded':
        return 'Evidence not recorded';
    }
  }

  function criterionStateLabel(criterion: TrendCriterion): string {
    switch (criterion.state) {
      case 'measured':
        return `score ${criterion.score ?? 'not recorded'}, contribution ${criterion.contribution ?? 'not recorded'}`;
      case 'not-evaluated':
        return 'not evaluated';
      case 'not-recorded':
        return 'not recorded';
    }
  }

  function gapLabel(reason: TrendChartGapReason): string {
    switch (reason) {
      case 'unknown':
        return 'Unknown score';
      case 'profile-missing':
        return 'Profile missing';
      case 'not-evaluated':
        return 'Not evaluated';
      case 'not-recorded':
        return 'Not recorded';
      case 'invalid-time':
        return 'Invalid time';
      case 'invalid-score':
        return 'Invalid score';
    }
  }

  function summaryText(): string {
    if (result.points.length === 0) return 'This applied selection contains no persisted health observations.';
    if (result.counts.measured === 0) {
      return `${result.counts.points} persisted observation${result.counts.points === 1 ? '' : 's'}, with no measured score in this scope.`;
    }

    const sparse = result.counts.measured === 1 ? ' The single measured point shows no direction of change.' : '';
    const gaps = result.counts.unknown + result.counts.missing;
    const gapText = gaps > 0 ? ` ${gaps} observation${gaps === 1 ? '' : 's'} form explicit evidence gaps.` : '';
    const transitions = Math.max(0, result.engineBoundaries.length - 1);
    const engineText =
      transitions > 0 ? ` ${transitions} engine transition${transitions === 1 ? '' : 's'} divide comparable runs.` : '';
    return `${result.counts.measured} of ${result.counts.points} observations contain measured scores.${sparse}${gapText}${engineText}`;
  }

  function selectPoint(index: number): void {
    if (result.points.length === 0) return;
    selectedIndex = Math.max(0, Math.min(index, result.points.length - 1));
  }

  function handleChartKeydown(event: KeyboardEvent): void {
    let nextIndex = selectedIndex;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex -= 1;
        break;
      case 'ArrowRight':
        nextIndex += 1;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = result.points.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectPoint(nextIndex);
  }

  $: if (result.points.length === 0) selectedIndex = 0;
  $: if (selectedIndex >= result.points.length && result.points.length > 0) selectedIndex = result.points.length - 1;
  $: overallGeometry = buildTrendChartGeometry(result.points, { width: WIDTH, height: HEIGHT, padding: PADDING });
  $: criterionSelection = collectBoundedTrendChartCriteria(result.points);
  $: criterionCharts =
    result.normalizedFilter.profile === null ? buildCriterionCharts(result.points, criterionSelection.definitions) : [];
  $: selectedPoint = result.points[selectedIndex] ?? null;
  $: selectedOverallX = trendChartPointX(overallGeometry, selectedIndex);
  $: overallEngineRules = buildTrendChartEngineRules(overallGeometry, result.engineBoundaries);
  $: currentPolicyReference = {
    healthyThreshold: HEALTHY_THRESHOLD,
    attentionThreshold: ATTENTION_THRESHOLD,
    engineVersion: result.currentEngineVersion,
  } as const;
</script>

<section class="space-y-4" aria-labelledby="health-trend-heading">
  <div class="space-y-1">
    <h2 id="health-trend-heading" class="text-base font-semibold text-neutral-900 dark:text-neutral-100">
      Health trend analysis
    </h2>
    <p id="health-trend-summary" class="text-sm text-neutral-600 dark:text-neutral-300">{summaryText()}</p>
  </div>

  {#if result.points.length === 0}
    <Card>
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        No chart axes are shown because the applied selection contains no persisted points.
      </p>
    </Card>
  {:else}
    <div class="space-y-4">
      <div
        class="focus-visible:ring-accent-500 cursor-ew-resize rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-200 dark:focus-visible:ring-offset-neutral-900"
        role="slider"
        tabindex="0"
        aria-label="Trend point"
        aria-valuemin="1"
        aria-valuemax={result.points.length}
        aria-valuenow={selectedIndex + 1}
        aria-valuetext={selectedPoint
          ? `${formatTimestamp(selectedPoint.generatedAt)}, ${pointStateLabel(selectedPoint)}`
          : ''}
        aria-describedby="health-trend-keyboard-help health-trend-summary"
        onkeydown={handleChartKeydown}
      >
        Keyboard point selector: <span class="font-semibold">{selectedIndex + 1} of {result.points.length}</span>
      </div>

      <Card padding="sm">
        <figure aria-labelledby="overall-chart-title" aria-describedby="overall-chart-description">
          <figcaption class="mb-3 flex flex-wrap items-start justify-between gap-3 px-1">
            <div class="max-w-2xl">
              <h3 id="overall-chart-title" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {result.normalizedFilter.profile === null
                  ? 'Overall score and band'
                  : `${result.normalizedFilter.profile} score and band`}
              </h3>
              <p id="overall-chart-description" class="text-xs text-neutral-500 dark:text-neutral-400">
                Scores and marker colors are persisted historical evidence. Background bands and labelled thresholds are
                a current-policy reference for engine v{result.currentEngineVersion} only, so an older engine's stored band
                may differ at the same score. Lines stop at evidence gaps and engine changes.
              </p>
            </div>
            <div
              class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-600 dark:text-neutral-300"
              aria-label="Chart legend"
            >
              <span class="inline-flex items-center gap-1.5"
                ><span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>Persisted band</span
              >
              <span class="inline-flex items-center gap-1.5"
                ><span class="font-mono font-bold">×</span>Evidence gap</span
              >
              <span class="inline-flex items-center gap-1.5"
                ><span class="w-5 border-t-2 border-dashed border-neutral-500"></span>Engine change</span
              >
            </div>
          </figcaption>

          <TrendPlot
            geometry={overallGeometry}
            engineRules={overallEngineRules}
            selectedX={selectedOverallX}
            regionLabel="Scrollable overall score chart. Use arrow keys to scroll horizontally on narrow screens."
            imageLabel="Persisted config health score history. Marker fill is the persisted band; background thresholds are current-policy reference only."
            showPersistedBands={true}
            {currentPolicyReference}
          />
        </figure>

        <div class="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-700/60">
          <p id="health-trend-keyboard-help" class="text-xs text-neutral-500 dark:text-neutral-400">
            Use Left and Right Arrow to inspect adjacent points; Home and End jump to the first and last point. The
            violet rule marks the selected timestamp in every chart.
          </p>

          <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div class="flex gap-2">
              <button
                type="button"
                class="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                disabled={selectedIndex === 0}
                onclick={() => selectPoint(selectedIndex - 1)}>Previous point</button
              >
              <button
                type="button"
                class="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                disabled={selectedIndex >= result.points.length - 1}
                onclick={() => selectPoint(selectedIndex + 1)}>Next point</button
              >
            </div>
            <span class="text-xs font-medium text-neutral-500 dark:text-neutral-400"
              >Point {selectedIndex + 1} of {result.points.length}</span
            >
          </div>

          {#if selectedPoint}
            <div class="mt-3 rounded-lg bg-neutral-100 p-3 text-sm dark:bg-neutral-900/70" aria-live="polite">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="font-semibold text-neutral-900 dark:text-neutral-100">
                  {formatTimestamp(selectedPoint.generatedAt)}
                </p>
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  Snapshot {selectedPoint.snapshotId} · Engine v{selectedPoint.engineVersion}
                </p>
              </div>
              <p class="mt-1 text-neutral-700 dark:text-neutral-200">
                {pointStateLabel(selectedPoint)}{selectedPoint.state === 'measured' && selectedPoint.score !== null
                  ? ` · Score ${selectedPoint.score}`
                  : ''}
              </p>
              {#if selectedPoint.state === 'measured'}
                <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {selectedPoint.band === null
                    ? 'No band was persisted for this point.'
                    : `${HEALTH_BAND_LABEL[selectedPoint.band]} is the band persisted by engine v${selectedPoint.engineVersion}.`}
                  Current threshold shading for engine v{result.currentEngineVersion} is reference only.
                </p>
              {:else}
                <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  This state is an explicit gap, not a zero score.
                </p>
              {/if}
              {#if result.normalizedFilter.profile === null && selectedPoint.criteria.length > 0}
                <ul class="mt-2 grid gap-1 text-xs text-neutral-600 sm:grid-cols-2 dark:text-neutral-300">
                  {#each selectedPoint.criteria as criterion (criterion.id)}
                    <li>
                      <span class="font-medium text-neutral-800 dark:text-neutral-100">{criterion.label}:</span>
                      {criterionStateLabel(criterion)}
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
      </Card>

      {#if result.normalizedFilter.profile !== null}
        <Card>
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Historical profile criteria</h3>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            Historical criterion scores and contributions were not recorded for profiles. The chart shows only the
            selected profile's persisted score and band.
          </p>
        </Card>
      {:else if criterionCharts.length === 0}
        <Card>
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Overall criterion history</h3>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            No persisted criterion observations are available in this selection.
          </p>
        </Card>
      {:else}
        <section class="space-y-3" aria-labelledby="criterion-trends-heading">
          <div>
            <h3 id="criterion-trends-heading" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Overall criterion history
            </h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              Solid circles show criterion score; dashed diamonds show weighted contribution. Both use the fixed 0–100
              scale.
            </p>
          </div>

          {#if criterionSelection.hasOmitted}
            <p
              class="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-300"
              role="status"
              aria-live="polite"
            >
              Showing the first {criterionCharts.length} distinct criterion charts in canonical evidence order. Additional
              distinct criteria are omitted from charts for performance. Exact evidence remains available in the history table
              and exports.
            </p>
          {/if}

          <div class="grid gap-4 lg:grid-cols-2">
            {#each criterionCharts as chart (chart.definition.id)}
              <Card padding="sm">
                <figure aria-label={`${chart.definition.label} score and contribution history`}>
                  <figcaption class="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                    <span class="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
                      >{chart.definition.label}</span
                    >
                    <span class="flex flex-wrap gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                      <span class="inline-flex items-center gap-1"
                        ><span class="border-accent-600 h-2 w-2 rounded-full border"></span>Score</span
                      >
                      <span class="inline-flex items-center gap-1"
                        ><span class="inline-block h-2 w-2 rotate-45 border border-violet-600"></span>Contribution</span
                      >
                    </span>
                  </figcaption>

                  <TrendPlot
                    geometry={chart.score}
                    secondaryGeometry={chart.contribution}
                    engineRules={buildTrendChartEngineRules(chart.score, result.engineBoundaries)}
                    selectedX={trendChartPointX(chart.score, selectedIndex)}
                    regionLabel={`Scrollable ${chart.definition.label} chart. Use arrow keys to scroll horizontally on narrow screens.`}
                    imageLabel={`${chart.definition.label} actual-time history on a zero to one hundred scale`}
                    compact={true}
                  />

                  {#if chart.score.gaps.length > 0}
                    <p class="px-1 pt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                      × marks {chart.score.gaps
                        .map((gap) => gapLabel(gap.reason))
                        .filter((label, index, labels) => labels.indexOf(label) === index)
                        .join(', ')
                        .toLowerCase()}.
                    </p>
                  {/if}
                </figure>
              </Card>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  {/if}
</section>
