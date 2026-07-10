export type TrendChartPointState = 'measured' | 'unknown' | 'profile-missing' | 'not-evaluated' | 'not-recorded';

export type TrendChartBand = 'healthy' | 'attention' | 'needs-review' | 'unknown';

export interface TrendChartPoint {
  generatedAt: string;
  engineVersion: string;
  state: TrendChartPointState;
  score: number | null;
  /** The band persisted with this observation. Never recompute it from current policy. */
  band?: TrendChartBand | null;
}

export interface TrendChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TrendChartOptions {
  width?: number;
  height?: number;
  padding?: Partial<TrendChartPadding>;
  minimumTickSpacing?: number;
  maximumTicks?: number;
}

export type TimeDomain = readonly [minimum: number, maximum: number];

export interface TrendChartMarker {
  sourceIndex: number;
  timestamp: number;
  engineVersion: string;
  score: number;
  band: TrendChartBand | null;
  x: number;
  y: number;
}

export type TrendChartGapReason = Exclude<TrendChartPointState, 'measured'> | 'invalid-time' | 'invalid-score';

export interface TrendChartGapMarker {
  sourceIndex: number;
  timestamp: number | null;
  engineVersion: string;
  reason: TrendChartGapReason;
  x: number | null;
}

export interface TrendChartSegment {
  engineVersion: string;
  points: readonly TrendChartMarker[];
  path: string;
}

export interface TrendChartTimeTick {
  timestamp: number;
  x: number;
}

export interface TrendChartScoreTick {
  score: number;
  y: number;
}

export interface TrendChartGeometry {
  width: number;
  height: number;
  padding: TrendChartPadding;
  domain: TimeDomain | null;
  markers: readonly TrendChartMarker[];
  gaps: readonly TrendChartGapMarker[];
  segments: readonly TrendChartSegment[];
  timeTicks: readonly TrendChartTimeTick[];
  scoreTicks: readonly TrendChartScoreTick[];
}

export interface TrendChartEngineBoundary {
  engineVersion: string;
  startsAt: string;
  pointIndex: number;
}

export interface TrendChartEngineRule {
  engineVersion: string;
  pointIndex: number;
  x: number;
}

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 240;
const DEFAULT_PADDING: TrendChartPadding = { top: 16, right: 16, bottom: 28, left: 40 };
const DEFAULT_MINIMUM_TICK_SPACING = 88;
const DEFAULT_MAXIMUM_TICKS = 8;
const SCORE_TICKS = [0, 25, 50, 75, 100] as const;

export const MAX_VISIBLE_CHART_INDICATORS = 80;

/**
 * Deterministically bound repeated SVG indicators while retaining both ends of the history.
 * Exact unsampled facts remain available to the point inspector and history table.
 */
export function sampleTrendChartIndicators<T>(
  items: readonly T[],
  maximum = MAX_VISIBLE_CHART_INDICATORS
): readonly T[] {
  const cap = Math.max(1, Math.floor(finitePositive(maximum, MAX_VISIBLE_CHART_INDICATORS)));
  if (items.length <= cap) return items;
  if (cap === 1) return [items[0]];

  const lastIndex = items.length - 1;
  return Array.from({ length: cap }, (_, index) => items[Math.round((index * lastIndex) / (cap - 1))]);
}

/** Convert exact engine transition facts into SVG rules for one plot. */
export function buildTrendChartEngineRules(
  geometry: TrendChartGeometry,
  boundaries: readonly TrendChartEngineBoundary[]
): TrendChartEngineRule[] {
  if (geometry.domain === null) return [];
  const domain = geometry.domain;
  const range: TimeDomain = [geometry.padding.left, geometry.width - geometry.padding.right];

  return boundaries.flatMap((boundary) => {
    if (boundary.pointIndex <= 0) return [];
    const x = scaleTime(Date.parse(boundary.startsAt), domain, range);
    return x === null ? [] : [{ engineVersion: boundary.engineVersion, pointIndex: boundary.pointIndex, x }];
  });
}

/** Locate the rendered x-coordinate for a measured point or explicit gap. */
export function trendChartPointX(geometry: TrendChartGeometry, sourceIndex: number): number | null {
  return (
    geometry.markers.find((marker) => marker.sourceIndex === sourceIndex)?.x ??
    geometry.gaps.find((gap) => gap.sourceIndex === sourceIndex)?.x ??
    null
  );
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizePadding(options: TrendChartOptions, width: number, height: number): TrendChartPadding {
  const requested = options.padding ?? {};
  const horizontalLimit = width / 2;
  const verticalLimit = height / 2;

  return {
    top: Math.min(finiteNonNegative(requested.top, DEFAULT_PADDING.top), verticalLimit),
    right: Math.min(finiteNonNegative(requested.right, DEFAULT_PADDING.right), horizontalLimit),
    bottom: Math.min(finiteNonNegative(requested.bottom, DEFAULT_PADDING.bottom), verticalLimit),
    left: Math.min(finiteNonNegative(requested.left, DEFAULT_PADDING.left), horizontalLimit),
  };
}

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function scoreIsMeasured(score: number | null): score is number {
  return score !== null && Number.isFinite(score) && score >= 0 && score <= 100;
}

function numberForPath(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Map a timestamp into a finite drawing range. An equal-time domain is centred. */
export function scaleTime(timestamp: number, domain: TimeDomain, range: TimeDomain): number | null {
  const [domainMinimum, domainMaximum] = domain;
  const [rangeMinimum, rangeMaximum] = range;
  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(domainMinimum) ||
    !Number.isFinite(domainMaximum) ||
    domainMinimum > domainMaximum ||
    !Number.isFinite(rangeMinimum) ||
    !Number.isFinite(rangeMaximum)
  ) {
    return null;
  }

  const scaled =
    domainMinimum === domainMaximum
      ? rangeMinimum + (rangeMaximum - rangeMinimum) / 2
      : rangeMinimum + ((timestamp - domainMinimum) / (domainMaximum - domainMinimum)) * (rangeMaximum - rangeMinimum);
  return Number.isFinite(scaled) ? scaled : null;
}

/** Map a score against the fixed 0..100 domain. Invalid or out-of-contract values are gaps. */
export function scaleScore(score: number | null, top: number, bottom: number): number | null {
  if (!scoreIsMeasured(score) || !Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  const scaled = bottom - (score / 100) * (bottom - top);
  return Number.isFinite(scaled) ? scaled : null;
}

/**
 * Produce deterministic actual-time ticks. Narrow plots collapse to one midpoint tick; equal-time
 * domains always produce exactly one tick.
 */
export function buildAdaptiveTimeTicks(
  domain: TimeDomain | null,
  availableWidth: number,
  minimumSpacing = DEFAULT_MINIMUM_TICK_SPACING,
  maximumTicks = DEFAULT_MAXIMUM_TICKS
): number[] {
  if (
    domain === null ||
    !Number.isFinite(domain[0]) ||
    !Number.isFinite(domain[1]) ||
    domain[0] > domain[1] ||
    !Number.isFinite(availableWidth) ||
    availableWidth < 0
  ) {
    return [];
  }

  if (domain[0] === domain[1]) return [domain[0]];

  const spacing = finitePositive(minimumSpacing, DEFAULT_MINIMUM_TICK_SPACING);
  const cap = Math.max(1, Math.floor(finitePositive(maximumTicks, DEFAULT_MAXIMUM_TICKS)));
  const count = Math.min(cap, availableWidth < spacing ? 1 : Math.floor(availableWidth / spacing) + 1);
  if (count === 1) return [(domain[0] + domain[1]) / 2];

  const interval = (domain[1] - domain[0]) / (count - 1);
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? domain[1] : domain[0] + interval * index));
}

/** Build SVG-ready geometry without smoothing, interpolation, or inferred cadence. */
export function buildTrendChartGeometry(
  points: readonly TrendChartPoint[],
  options: TrendChartOptions = {}
): TrendChartGeometry {
  const width = finitePositive(options.width, DEFAULT_WIDTH);
  const height = finitePositive(options.height, DEFAULT_HEIGHT);
  const padding = normalizePadding(options, width, height);
  const xRange: TimeDomain = [padding.left, Math.max(padding.left, width - padding.right)];
  const plotTop = padding.top;
  const plotBottom = Math.max(plotTop, height - padding.bottom);
  const timestamps = points.map((point) => parseTimestamp(point.generatedAt));
  const finiteTimestamps = timestamps.filter((timestamp): timestamp is number => timestamp !== null);
  const domain: TimeDomain | null =
    finiteTimestamps.length === 0 ? null : [Math.min(...finiteTimestamps), Math.max(...finiteTimestamps)];

  if (domain === null) {
    return {
      width,
      height,
      padding,
      domain,
      markers: [],
      gaps: points.map((point, sourceIndex) => ({
        sourceIndex,
        timestamp: null,
        engineVersion: point.engineVersion,
        reason: 'invalid-time',
        x: null,
      })),
      segments: [],
      timeTicks: [],
      scoreTicks: [],
    };
  }

  const markers: TrendChartMarker[] = [];
  const gaps: TrendChartGapMarker[] = [];
  const segments: TrendChartSegment[] = [];
  let run: TrendChartMarker[] = [];
  let runEngineVersion: string | null = null;

  const flushRun = (): void => {
    if (run.length >= 2 && runEngineVersion !== null) {
      segments.push({
        engineVersion: runEngineVersion,
        points: run,
        path: run
          .map((point, index) => `${index === 0 ? 'M' : 'L'} ${numberForPath(point.x)} ${numberForPath(point.y)}`)
          .join(' '),
      });
    }
    run = [];
    runEngineVersion = null;
  };

  for (let sourceIndex = 0; sourceIndex < points.length; sourceIndex += 1) {
    const point = points[sourceIndex];
    const timestamp = timestamps[sourceIndex];
    const x = timestamp === null ? null : scaleTime(timestamp, domain, xRange);
    const score = point.score;
    const y = scaleScore(score, plotTop, plotBottom);

    if (point.state !== 'measured' || timestamp === null || x === null || !scoreIsMeasured(score) || y === null) {
      flushRun();
      gaps.push({
        sourceIndex,
        timestamp,
        engineVersion: point.engineVersion,
        reason:
          point.state !== 'measured'
            ? point.state
            : timestamp === null || x === null
              ? 'invalid-time'
              : 'invalid-score',
        x,
      });
      continue;
    }

    if (runEngineVersion !== null && point.engineVersion !== runEngineVersion) flushRun();

    const marker: TrendChartMarker = {
      sourceIndex,
      timestamp,
      engineVersion: point.engineVersion,
      score,
      band: point.band ?? null,
      x,
      y,
    };
    markers.push(marker);
    run.push(marker);
    runEngineVersion = point.engineVersion;
  }
  flushRun();

  const availableWidth = xRange[1] - xRange[0];
  const timeTicks = buildAdaptiveTimeTicks(
    domain,
    availableWidth,
    options.minimumTickSpacing,
    options.maximumTicks
  ).map((timestamp) => ({ timestamp, x: scaleTime(timestamp, domain, xRange) as number }));
  const scoreTicks = SCORE_TICKS.map((score) => ({ score, y: scaleScore(score, plotTop, plotBottom) as number }));

  return { width, height, padding, domain, markers, gaps, segments, timeTicks, scoreTicks };
}
