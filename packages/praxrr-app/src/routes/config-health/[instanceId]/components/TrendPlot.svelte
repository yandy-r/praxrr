<script lang="ts">
  import { HEALTH_BAND_LABEL } from '$lib/client/ui/health/healthStatus.ts';
  import {
    combineTrendChartSegmentPaths,
    MAX_VISIBLE_CHART_INDICATORS,
    sampleTrendChartIndicators,
    type TrendChartEngineRule,
    type TrendChartGeometry,
    type TrendChartMarker,
  } from './trendChart.ts';

  interface CurrentPolicyReference {
    healthyThreshold: number;
    attentionThreshold: number;
    engineVersion: string;
  }

  export let geometry: TrendChartGeometry;
  export let secondaryGeometry: TrendChartGeometry | null = null;
  export let engineRules: readonly TrendChartEngineRule[] = [];
  export let selectedX: number | null = null;
  export let regionLabel: string;
  export let imageLabel: string;
  export let compact = false;
  export let showPersistedBands = false;
  export let currentPolicyReference: CurrentPolicyReference | null = null;

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

  function policyY(threshold: number): number {
    const plotHeight = geometry.height - geometry.padding.bottom - geometry.padding.top;
    return geometry.padding.top + plotHeight * (1 - threshold / 100);
  }

  function persistedBandLabel(marker: TrendChartMarker): string {
    return marker.band === null ? 'not recorded' : HEALTH_BAND_LABEL[marker.band];
  }

  function markerClass(marker: TrendChartMarker): string {
    const fill =
      !showPersistedBands || marker.band === null
        ? 'fill-white dark:fill-neutral-900'
        : marker.band === 'healthy'
          ? 'fill-emerald-500'
          : marker.band === 'attention'
            ? 'fill-amber-400'
            : marker.band === 'needs-review'
              ? 'fill-red-500'
              : 'fill-neutral-400';
    return `stroke-accent-700 dark:stroke-accent-300 ${fill}`;
  }

  $: visibleMarkers = sampleTrendChartIndicators(geometry.markers);
  $: visibleSecondaryMarkers = sampleTrendChartIndicators(secondaryGeometry?.markers ?? []);
  $: primaryPath = combineTrendChartSegmentPaths(geometry.segments);
  $: secondaryPath = combineTrendChartSegmentPaths(secondaryGeometry?.segments ?? []);
  $: drawableGaps = geometry.gaps.filter((gap) => gap.x !== null);
  $: visibleGaps = sampleTrendChartIndicators(drawableGaps);
  $: visibleEngineRules = sampleTrendChartIndicators(engineRules);
  $: indicatorsSampled =
    geometry.markers.length > MAX_VISIBLE_CHART_INDICATORS ||
    (secondaryGeometry?.markers.length ?? 0) > MAX_VISIBLE_CHART_INDICATORS ||
    drawableGaps.length > MAX_VISIBLE_CHART_INDICATORS ||
    engineRules.length > MAX_VISIBLE_CHART_INDICATORS;
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -- scroll region must be keyboard reachable on narrow screens -->
<div
  class="focus-visible:ring-accent-500 max-w-full overflow-x-auto rounded-lg pb-1 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-offset-neutral-950"
  role="region"
  aria-label={regionLabel}
  tabindex="0"
>
  <svg
    class:min-w-[32rem]={compact}
    class:min-w-[40rem]={!compact}
    class="h-auto text-neutral-700 dark:text-neutral-200"
    viewBox={`0 0 ${geometry.width} ${geometry.height}`}
    role="img"
    aria-label={imageLabel}
  >
    {#if currentPolicyReference !== null}
      <rect
        x={geometry.padding.left}
        y={geometry.padding.top}
        width={geometry.width - geometry.padding.left - geometry.padding.right}
        height={policyY(currentPolicyReference.healthyThreshold) - geometry.padding.top}
        class="fill-emerald-50 dark:fill-emerald-950/20"
      />
      <rect
        x={geometry.padding.left}
        y={policyY(currentPolicyReference.healthyThreshold)}
        width={geometry.width - geometry.padding.left - geometry.padding.right}
        height={policyY(currentPolicyReference.attentionThreshold) - policyY(currentPolicyReference.healthyThreshold)}
        class="fill-amber-50 dark:fill-amber-950/20"
      />
      <rect
        x={geometry.padding.left}
        y={policyY(currentPolicyReference.attentionThreshold)}
        width={geometry.width - geometry.padding.left - geometry.padding.right}
        height={geometry.height - geometry.padding.bottom - policyY(currentPolicyReference.attentionThreshold)}
        class="fill-red-50 dark:fill-red-950/20"
      />
    {/if}

    {#each geometry.scoreTicks as tick (tick.score)}
      <line
        x1={geometry.padding.left}
        x2={geometry.width - geometry.padding.right}
        y1={tick.y}
        y2={tick.y}
        class="stroke-neutral-300 dark:stroke-neutral-700"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <text x={geometry.padding.left - 8} y={tick.y + 4} text-anchor="end" class="fill-current text-[11px]"
        >{tick.score}</text
      >
    {/each}

    {#if currentPolicyReference !== null}
      <line
        x1={geometry.padding.left}
        x2={geometry.width - geometry.padding.right}
        y1={policyY(currentPolicyReference.healthyThreshold)}
        y2={policyY(currentPolicyReference.healthyThreshold)}
        class="stroke-emerald-700 dark:stroke-emerald-400"
        stroke-width="1.5"
        stroke-dasharray="2 3"
        vector-effect="non-scaling-stroke"
      />
      <text
        x={geometry.width - geometry.padding.right - 4}
        y={policyY(currentPolicyReference.healthyThreshold) - 4}
        text-anchor="end"
        class="fill-emerald-800 text-[10px] font-medium dark:fill-emerald-300"
        >v{currentPolicyReference.engineVersion} current healthy {currentPolicyReference.healthyThreshold}+</text
      >
      <line
        x1={geometry.padding.left}
        x2={geometry.width - geometry.padding.right}
        y1={policyY(currentPolicyReference.attentionThreshold)}
        y2={policyY(currentPolicyReference.attentionThreshold)}
        class="stroke-amber-700 dark:stroke-amber-400"
        stroke-width="1.5"
        stroke-dasharray="5 3"
        vector-effect="non-scaling-stroke"
      />
      <text
        x={geometry.width - geometry.padding.right - 4}
        y={policyY(currentPolicyReference.attentionThreshold) - 4}
        text-anchor="end"
        class="fill-amber-800 text-[10px] font-medium dark:fill-amber-300"
        >v{currentPolicyReference.engineVersion} current attention {currentPolicyReference.attentionThreshold}+</text
      >
    {/if}

    {#each visibleEngineRules as boundary (`${boundary.pointIndex}-${boundary.engineVersion}`)}
      <line
        x1={boundary.x}
        x2={boundary.x}
        y1={geometry.padding.top}
        y2={geometry.height - geometry.padding.bottom}
        class="stroke-neutral-600 dark:stroke-neutral-300"
        stroke-width="1.5"
        stroke-dasharray="6 4"
        vector-effect="non-scaling-stroke"
      />
      <text x={boundary.x + 4} y={geometry.padding.top + 11} class="fill-current text-[10px] font-semibold"
        >v{boundary.engineVersion}</text
      >
    {/each}

    {#if primaryPath !== null}
      <path
        d={primaryPath}
        fill="none"
        class="stroke-accent-600 dark:stroke-accent-400"
        stroke-width={compact ? 2 : 2.5}
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    {/if}
    {#if secondaryPath !== null}
      <path
        d={secondaryPath}
        fill="none"
        class="stroke-violet-700 dark:stroke-violet-300"
        stroke-width="2"
        stroke-dasharray="5 3"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    {/if}

    {#each visibleMarkers as marker (marker.sourceIndex)}
      <circle
        cx={marker.x}
        cy={marker.y}
        r={compact ? 3 : 3.5}
        class={markerClass(marker)}
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      >
        {#if showPersistedBands}<title>Persisted band: {persistedBandLabel(marker)}</title>{/if}
      </circle>
    {/each}
    {#each visibleSecondaryMarkers as marker (marker.sourceIndex)}
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

    {#each visibleGaps as gap (gap.sourceIndex)}
      <g class="stroke-neutral-700 dark:stroke-neutral-200" stroke-width="2" vector-effect="non-scaling-stroke">
        <line
          x1={(gap.x as number) - (compact ? 3 : 4)}
          x2={(gap.x as number) + (compact ? 3 : 4)}
          y1={geometry.height - geometry.padding.bottom + 5}
          y2={geometry.height - geometry.padding.bottom + (compact ? 11 : 13)}
        />
        <line
          x1={(gap.x as number) + (compact ? 3 : 4)}
          x2={(gap.x as number) - (compact ? 3 : 4)}
          y1={geometry.height - geometry.padding.bottom + 5}
          y2={geometry.height - geometry.padding.bottom + (compact ? 11 : 13)}
        />
      </g>
    {/each}

    {#if selectedX !== null}
      <line
        x1={selectedX}
        x2={selectedX}
        y1={geometry.padding.top}
        y2={geometry.height - geometry.padding.bottom}
        class="stroke-violet-700 dark:stroke-violet-300"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    {/if}

    {#each geometry.timeTicks as tick, index (tick.timestamp)}
      <line
        x1={tick.x}
        x2={tick.x}
        y1={geometry.height - geometry.padding.bottom}
        y2={geometry.height - geometry.padding.bottom + 5}
        class="stroke-current"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <text
        x={tick.x}
        y={geometry.height - 10}
        text-anchor={tickAnchor(index, geometry.timeTicks.length)}
        class="fill-current text-[11px]">{formatTick(tick.timestamp, geometry.domain)}</text
      >
    {/each}
  </svg>
</div>

{#if indicatorsSampled}
  <p class="px-1 pt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
    Repeated SVG indicators are sampled for performance: {visibleMarkers.length} of {geometry.markers.length} score markers,
    {visibleSecondaryMarkers.length} of {secondaryGeometry?.markers.length ?? 0} contribution markers,
    {visibleGaps.length} of {drawableGaps.length} gaps, and {visibleEngineRules.length} of {engineRules.length} engine changes
    are drawn. Exact facts remain in the point inspector and history table.
  </p>
{/if}
