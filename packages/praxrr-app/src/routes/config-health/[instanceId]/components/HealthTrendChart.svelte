<script lang="ts">
  import type { components } from '$lib/api/v1.d.ts';
  import Card from '$ui/card/Card.svelte';
  import { HEALTH_BAND_LABEL } from '$lib/client/ui/health/healthStatus.ts';
  import { ATTENTION_THRESHOLD, HEALTHY_THRESHOLD } from '$shared/health/index.ts';
  import {
    buildTrendChartGeometry,
    scaleTime,
    type TrendChartGapReason,
    type TrendChartGeometry,
    type TrendChartMarker,
    type TrendChartPoint,
  } from './trendChart.ts';

  type TrendResponse = components['schemas']['ConfigHealthTrendsResponse'];
  type TrendPoint = components['schemas']['ConfigHealthTrendPoint'];
  type TrendCriterion = components['schemas']['ConfigHealthTrendCriterion'];

  interface CriterionDefinition {
    id: string;
    label: string;
  }

  interface CriterionChart {
    definition: CriterionDefinition;
    score: TrendChartGeometry;
    contribution: TrendChartGeometry;
  }

  interface EngineRule {
    engineVersion: string;
    pointIndex: number;
    x: number;
  }

  export let result: TrendResponse;

  const WIDTH = 720;
  const HEIGHT = 260;
  const SMALL_HEIGHT = 220;
  const PADDING = { top: 18, right: 18, bottom: 42, left: 52 } as const;
  const MAX_VISIBLE_MARKERS = 80;

  let selectedIndex = 0;

  function collectCriteria(points: readonly TrendPoint[]): CriterionDefinition[] {
    const criteria = new Map<string, CriterionDefinition>();
    for (const point of points) {
      for (const criterion of point.criteria) {
        if (!criteria.has(criterion.id)) criteria.set(criterion.id, { id: criterion.id, label: criterion.label });
      }
    }
    return [...criteria.values()];
  }

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
    definitions: readonly CriterionDefinition[]
  ): CriterionChart[] {
    return definitions.map((definition) => {
      const scorePoints = points.map((point) =>
        criterionPoint(
          point,
          point.criteria.find((criterion) => criterion.id === definition.id),
          'score'
        )
      );
      const contributionPoints = points.map((point) =>
        criterionPoint(
          point,
          point.criteria.find((criterion) => criterion.id === definition.id),
          'contribution'
        )
      );
      const options = { width: WIDTH, height: SMALL_HEIGHT, padding: PADDING } as const;

      return {
        definition,
        score: buildTrendChartGeometry(scorePoints, options),
        contribution: buildTrendChartGeometry(contributionPoints, options),
      };
    });
  }

  function engineRules(geometry: TrendChartGeometry): EngineRule[] {
    if (geometry.domain === null) return [];
    const range = [geometry.padding.left, geometry.width - geometry.padding.right] as const;

    return result.engineBoundaries.flatMap((boundary) => {
      if (boundary.pointIndex <= 0) return [];
      const timestamp = Date.parse(boundary.startsAt);
      const x = scaleTime(timestamp, geometry.domain!, range);
      return x === null ? [] : [{ engineVersion: boundary.engineVersion, pointIndex: boundary.pointIndex, x }];
    });
  }

  function visibleMarkers(markers: readonly TrendChartMarker[]): readonly TrendChartMarker[] {
    if (markers.length <= MAX_VISIBLE_MARKERS) return markers;
    const step = Math.ceil(markers.length / MAX_VISIBLE_MARKERS);
    return markers.filter((_, index) => index === 0 || index === markers.length - 1 || index % step === 0);
  }

  function pointX(geometry: TrendChartGeometry, sourceIndex: number): number | null {
    return (
      geometry.markers.find((marker) => marker.sourceIndex === sourceIndex)?.x ??
      geometry.gaps.find((gap) => gap.sourceIndex === sourceIndex)?.x ??
      null
    );
  }

  function formatTimestamp(value: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 'Invalid recorded time';
    return new Date(timestamp).toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC');
  }

  function formatTick(timestamp: number, domain: readonly [number, number] | null): string {
    const date = new Date(timestamp);
    if (domain !== null && domain[1] - domain[0] <= 2 * 24 * 60 * 60 * 1000) {
      return date.toISOString().slice(11, 16);
    }
    return date.toISOString().slice(0, 10);
  }

  function tickAnchor(index: number, count: number): 'start' | 'middle' | 'end' {
    if (index === 0) return 'start';
    if (index === count - 1) return 'end';
    return 'middle';
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
  $: criteria = collectCriteria(result.points);
  $: criterionCharts = result.normalizedFilter.profile === null ? buildCriterionCharts(result.points, criteria) : [];
  $: selectedPoint = result.points[selectedIndex] ?? null;
  $: selectedOverallX = pointX(overallGeometry, selectedIndex);
  $: overallEngineRules = engineRules(overallGeometry);
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
        class="focus-visible:ring-accent-500 cursor-ew-resize rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-200 dark:focus-visible:ring-offset-neutral-900"
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
            <div>
              <h3 id="overall-chart-title" class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {result.normalizedFilter.profile === null
                  ? 'Overall score and band'
                  : `${result.normalizedFilter.profile} score and band`}
              </h3>
              <p id="overall-chart-description" class="text-xs text-neutral-500 dark:text-neutral-400">
                Persisted scores on a fixed 0–100 scale. Lines stop at evidence gaps and engine changes.
              </p>
            </div>
            <div
              class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-600 dark:text-neutral-300"
              aria-label="Chart legend"
            >
              <span class="inline-flex items-center gap-1.5"
                ><span class="border-accent-600 h-2.5 w-2.5 rounded-full border-2"></span>Measured</span
              >
              <span class="inline-flex items-center gap-1.5"
                ><span class="font-mono font-bold">×</span>Evidence gap</span
              >
              <span class="inline-flex items-center gap-1.5"
                ><span class="w-5 border-t-2 border-dashed border-neutral-500"></span>Engine change</span
              >
            </div>
          </figcaption>

          <div class="overflow-x-auto pb-1" aria-label="Scrollable overall score chart">
            <svg
              class="h-auto min-w-[40rem] text-neutral-700 dark:text-neutral-200"
              viewBox={`0 0 ${overallGeometry.width} ${overallGeometry.height}`}
              role="img"
              aria-labelledby="overall-svg-title overall-svg-description"
            >
              <title id="overall-svg-title">Persisted config health score trend</title>
              <desc id="overall-svg-description"
                >Actual-time score history from zero to one hundred, with labelled band thresholds, evidence gaps, and
                engine boundaries. Exact values are in the point inspector and trend table.</desc
              >

              <rect
                x={overallGeometry.padding.left}
                y={overallGeometry.padding.top}
                width={overallGeometry.width - overallGeometry.padding.left - overallGeometry.padding.right}
                height={(overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) * 0.15}
                class="fill-emerald-50 dark:fill-emerald-950/20"
              />
              <rect
                x={overallGeometry.padding.left}
                y={overallGeometry.padding.top +
                  (overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) * 0.15}
                width={overallGeometry.width - overallGeometry.padding.left - overallGeometry.padding.right}
                height={(overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) * 0.25}
                class="fill-amber-50 dark:fill-amber-950/20"
              />
              <rect
                x={overallGeometry.padding.left}
                y={overallGeometry.padding.top +
                  (overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) * 0.4}
                width={overallGeometry.width - overallGeometry.padding.left - overallGeometry.padding.right}
                height={(overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) * 0.6}
                class="fill-red-50 dark:fill-red-950/20"
              />

              {#each overallGeometry.scoreTicks as tick (tick.score)}
                <line
                  x1={overallGeometry.padding.left}
                  x2={overallGeometry.width - overallGeometry.padding.right}
                  y1={tick.y}
                  y2={tick.y}
                  class="stroke-neutral-300 dark:stroke-neutral-700"
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                />
                <text
                  x={overallGeometry.padding.left - 8}
                  y={tick.y + 4}
                  text-anchor="end"
                  class="fill-current text-[11px]">{tick.score}</text
                >
              {/each}

              <line
                x1={overallGeometry.padding.left}
                x2={overallGeometry.width - overallGeometry.padding.right}
                y1={overallGeometry.padding.top +
                  (overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) *
                    (1 - HEALTHY_THRESHOLD / 100)}
                y2={overallGeometry.padding.top +
                  (overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) *
                    (1 - HEALTHY_THRESHOLD / 100)}
                class="stroke-emerald-700 dark:stroke-emerald-400"
                stroke-width="1.5"
                stroke-dasharray="2 3"
                vector-effect="non-scaling-stroke"
              />
              <text
                x={overallGeometry.width - overallGeometry.padding.right - 4}
                y={overallGeometry.padding.top +
                  (overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) *
                    (1 - HEALTHY_THRESHOLD / 100) -
                  4}
                text-anchor="end"
                class="fill-emerald-800 text-[10px] font-medium dark:fill-emerald-300"
                >Healthy {HEALTHY_THRESHOLD}+</text
              >
              <line
                x1={overallGeometry.padding.left}
                x2={overallGeometry.width - overallGeometry.padding.right}
                y1={overallGeometry.padding.top +
                  (overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) *
                    (1 - ATTENTION_THRESHOLD / 100)}
                y2={overallGeometry.padding.top +
                  (overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) *
                    (1 - ATTENTION_THRESHOLD / 100)}
                class="stroke-amber-700 dark:stroke-amber-400"
                stroke-width="1.5"
                stroke-dasharray="5 3"
                vector-effect="non-scaling-stroke"
              />
              <text
                x={overallGeometry.width - overallGeometry.padding.right - 4}
                y={overallGeometry.padding.top +
                  (overallGeometry.height - overallGeometry.padding.bottom - overallGeometry.padding.top) *
                    (1 - ATTENTION_THRESHOLD / 100) -
                  4}
                text-anchor="end"
                class="fill-amber-800 text-[10px] font-medium dark:fill-amber-300"
                >Attention {ATTENTION_THRESHOLD}+</text
              >

              {#each overallEngineRules as boundary (`${boundary.pointIndex}-${boundary.engineVersion}`)}
                <line
                  x1={boundary.x}
                  x2={boundary.x}
                  y1={overallGeometry.padding.top}
                  y2={overallGeometry.height - overallGeometry.padding.bottom}
                  class="stroke-neutral-600 dark:stroke-neutral-300"
                  stroke-width="1.5"
                  stroke-dasharray="6 4"
                  vector-effect="non-scaling-stroke"
                />
                <text
                  x={boundary.x + 4}
                  y={overallGeometry.padding.top + 11}
                  class="fill-current text-[10px] font-semibold">v{boundary.engineVersion}</text
                >
              {/each}

              {#each overallGeometry.segments as segment, index (`${segment.engineVersion}-${index}`)}
                <path
                  d={segment.path}
                  fill="none"
                  class="stroke-accent-600 dark:stroke-accent-400"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  vector-effect="non-scaling-stroke"
                />
              {/each}

              {#each visibleMarkers(overallGeometry.markers) as marker (marker.sourceIndex)}
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r="3.5"
                  class="stroke-accent-700 dark:stroke-accent-300 fill-white dark:fill-neutral-900"
                  stroke-width="2"
                  vector-effect="non-scaling-stroke"
                />
              {/each}

              {#each overallGeometry.gaps as gap (gap.sourceIndex)}
                {#if gap.x !== null}
                  <g
                    class="stroke-neutral-700 dark:stroke-neutral-200"
                    stroke-width="2"
                    vector-effect="non-scaling-stroke"
                  >
                    <line
                      x1={gap.x - 4}
                      x2={gap.x + 4}
                      y1={overallGeometry.height - overallGeometry.padding.bottom + 5}
                      y2={overallGeometry.height - overallGeometry.padding.bottom + 13}
                    />
                    <line
                      x1={gap.x + 4}
                      x2={gap.x - 4}
                      y1={overallGeometry.height - overallGeometry.padding.bottom + 5}
                      y2={overallGeometry.height - overallGeometry.padding.bottom + 13}
                    />
                  </g>
                {/if}
              {/each}

              {#if selectedOverallX !== null}
                <line
                  x1={selectedOverallX}
                  x2={selectedOverallX}
                  y1={overallGeometry.padding.top}
                  y2={overallGeometry.height - overallGeometry.padding.bottom}
                  class="stroke-violet-700 dark:stroke-violet-300"
                  stroke-width="2"
                  vector-effect="non-scaling-stroke"
                />
              {/if}

              {#each overallGeometry.timeTicks as tick, index (tick.timestamp)}
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={overallGeometry.height - overallGeometry.padding.bottom}
                  y2={overallGeometry.height - overallGeometry.padding.bottom + 5}
                  class="stroke-current"
                  stroke-width="1"
                  vector-effect="non-scaling-stroke"
                />
                <text
                  x={tick.x}
                  y={overallGeometry.height - 10}
                  text-anchor={tickAnchor(index, overallGeometry.timeTicks.length)}
                  class="fill-current text-[11px]">{formatTick(tick.timestamp, overallGeometry.domain)}</text
                >
              {/each}
            </svg>
          </div>
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
              {#if selectedPoint.state !== 'measured'}
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

                  <div class="overflow-x-auto" aria-label={`Scrollable ${chart.definition.label} chart`}>
                    <svg
                      class="h-auto min-w-[32rem] text-neutral-700 dark:text-neutral-200"
                      viewBox={`0 0 ${chart.score.width} ${chart.score.height}`}
                      role="img"
                      aria-label={`${chart.definition.label} actual-time history on a zero to one hundred scale`}
                    >
                      {#each chart.score.scoreTicks as tick (tick.score)}
                        <line
                          x1={chart.score.padding.left}
                          x2={chart.score.width - chart.score.padding.right}
                          y1={tick.y}
                          y2={tick.y}
                          class="stroke-neutral-300 dark:stroke-neutral-700"
                          stroke-width="1"
                          vector-effect="non-scaling-stroke"
                        />
                        <text
                          x={chart.score.padding.left - 8}
                          y={tick.y + 4}
                          text-anchor="end"
                          class="fill-current text-[11px]">{tick.score}</text
                        >
                      {/each}

                      {#each engineRules(chart.score) as boundary (`${boundary.pointIndex}-${boundary.engineVersion}`)}
                        <line
                          x1={boundary.x}
                          x2={boundary.x}
                          y1={chart.score.padding.top}
                          y2={chart.score.height - chart.score.padding.bottom}
                          class="stroke-neutral-600 dark:stroke-neutral-300"
                          stroke-width="1.5"
                          stroke-dasharray="6 4"
                          vector-effect="non-scaling-stroke"
                        />
                        <text
                          x={boundary.x + 4}
                          y={chart.score.padding.top + 11}
                          class="fill-current text-[10px] font-semibold">v{boundary.engineVersion}</text
                        >
                      {/each}

                      {#each chart.score.segments as segment, index (`score-${segment.engineVersion}-${index}`)}
                        <path
                          d={segment.path}
                          fill="none"
                          class="stroke-accent-600 dark:stroke-accent-400"
                          stroke-width="2"
                          stroke-linejoin="round"
                          vector-effect="non-scaling-stroke"
                        />
                      {/each}
                      {#each chart.contribution.segments as segment, index (`contribution-${segment.engineVersion}-${index}`)}
                        <path
                          d={segment.path}
                          fill="none"
                          class="stroke-violet-700 dark:stroke-violet-300"
                          stroke-width="2"
                          stroke-dasharray="5 3"
                          stroke-linejoin="round"
                          vector-effect="non-scaling-stroke"
                        />
                      {/each}

                      {#each visibleMarkers(chart.score.markers) as marker (marker.sourceIndex)}
                        <circle
                          cx={marker.x}
                          cy={marker.y}
                          r="3"
                          class="stroke-accent-700 dark:stroke-accent-300 fill-white dark:fill-neutral-900"
                          stroke-width="2"
                          vector-effect="non-scaling-stroke"
                        />
                      {/each}
                      {#each visibleMarkers(chart.contribution.markers) as marker (marker.sourceIndex)}
                        <rect
                          x={marker.x - 3}
                          y={marker.y - 3}
                          width="6"
                          height="6"
                          transform={`rotate(45 ${marker.x} ${marker.y})`}
                          class="fill-white stroke-violet-700 dark:fill-neutral-900 dark:stroke-violet-300"
                          stroke-width="1.5"
                          vector-effect="non-scaling-stroke"
                        />
                      {/each}

                      {#each chart.score.gaps as gap (gap.sourceIndex)}
                        {#if gap.x !== null}
                          <g
                            class="stroke-neutral-700 dark:stroke-neutral-200"
                            stroke-width="2"
                            vector-effect="non-scaling-stroke"
                          >
                            <line
                              x1={gap.x - 3}
                              x2={gap.x + 3}
                              y1={chart.score.height - chart.score.padding.bottom + 5}
                              y2={chart.score.height - chart.score.padding.bottom + 11}
                            />
                            <line
                              x1={gap.x + 3}
                              x2={gap.x - 3}
                              y1={chart.score.height - chart.score.padding.bottom + 5}
                              y2={chart.score.height - chart.score.padding.bottom + 11}
                            />
                          </g>
                        {/if}
                      {/each}

                      {#if pointX(chart.score, selectedIndex) !== null}
                        <line
                          x1={pointX(chart.score, selectedIndex) ?? 0}
                          x2={pointX(chart.score, selectedIndex) ?? 0}
                          y1={chart.score.padding.top}
                          y2={chart.score.height - chart.score.padding.bottom}
                          class="stroke-violet-700 dark:stroke-violet-300"
                          stroke-width="2"
                          vector-effect="non-scaling-stroke"
                        />
                      {/if}

                      {#each chart.score.timeTicks as tick, index (tick.timestamp)}
                        <line
                          x1={tick.x}
                          x2={tick.x}
                          y1={chart.score.height - chart.score.padding.bottom}
                          y2={chart.score.height - chart.score.padding.bottom + 5}
                          class="stroke-current"
                          stroke-width="1"
                          vector-effect="non-scaling-stroke"
                        />
                        <text
                          x={tick.x}
                          y={chart.score.height - 10}
                          text-anchor={tickAnchor(index, chart.score.timeTicks.length)}
                          class="fill-current text-[11px]">{formatTick(tick.timestamp, chart.score.domain)}</text
                        >
                      {/each}
                    </svg>
                  </div>

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
