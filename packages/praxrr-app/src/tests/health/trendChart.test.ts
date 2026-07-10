import { assert, assertEquals } from '@std/assert';
import {
  buildAdaptiveTimeTicks,
  buildTrendChartGeometry,
  scaleScore,
  scaleTime,
  type TrendChartPoint,
  type TrendChartPointState,
} from '../../routes/config-health/[instanceId]/components/trendChart.ts';

const START = Date.parse('2026-07-10T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const PLOT = { width: 100, height: 100, padding: { top: 0, right: 0, bottom: 0, left: 0 } } as const;

function point(
  hours: number,
  score: number | null,
  state: TrendChartPointState = 'measured',
  engineVersion = '1'
): TrendChartPoint {
  return {
    generatedAt: new Date(START + hours * HOUR).toISOString(),
    engineVersion,
    state,
    score,
  };
}

Deno.test('trend chart returns no axes or measured geometry for an empty selection', () => {
  assertEquals(buildTrendChartGeometry([], PLOT), {
    width: 100,
    height: 100,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    domain: null,
    markers: [],
    gaps: [],
    segments: [],
    timeTicks: [],
    scoreTicks: [],
  });
});

Deno.test('trend chart centres a singleton as one marker and never invents a line', () => {
  const geometry = buildTrendChartGeometry([point(0, 0)], PLOT);

  assertEquals(geometry.markers, [{ sourceIndex: 0, timestamp: START, engineVersion: '1', score: 0, x: 50, y: 100 }]);
  assertEquals(geometry.segments, []);
  assertEquals(geometry.timeTicks, [{ timestamp: START, x: 50 }]);
});

Deno.test('trend chart preserves deterministic input order for equal timestamps', () => {
  const geometry = buildTrendChartGeometry([point(0, 25), point(0, 75)], PLOT);

  assertEquals(
    geometry.markers.map(({ sourceIndex, x, y }) => ({ sourceIndex, x, y })),
    [
      { sourceIndex: 0, x: 50, y: 75 },
      { sourceIndex: 1, x: 50, y: 25 },
    ]
  );
  assertEquals(geometry.segments[0].path, 'M 50 75 L 50 25');
});

Deno.test('trend chart uses actual elapsed time rather than point indexes', () => {
  const geometry = buildTrendChartGeometry([point(0, 0), point(1, 50), point(4, 100)], PLOT);

  assertEquals(
    geometry.markers.map(({ x, y }) => ({ x, y })),
    [
      { x: 0, y: 100 },
      { x: 25, y: 50 },
      { x: 100, y: 0 },
    ]
  );
  assertEquals(geometry.segments[0].path, 'M 0 100 L 25 50 L 100 0');
});

Deno.test('fixed score scaling retains measured zero and rejects non-finite or out-of-range scores', () => {
  assertEquals(scaleScore(0, 10, 210), 210);
  assertEquals(scaleScore(50, 10, 210), 110);
  assertEquals(scaleScore(100, 10, 210), 10);
  assertEquals(scaleScore(null, 10, 210), null);
  assertEquals(scaleScore(Number.NaN, 10, 210), null);
  assertEquals(scaleScore(Number.POSITIVE_INFINITY, 10, 210), null);
  assertEquals(scaleScore(-1, 10, 210), null);
  assertEquals(scaleScore(101, 10, 210), null);
  assertEquals(scaleScore(50, -Number.MAX_VALUE, Number.MAX_VALUE), null);
});

Deno.test('time scaling guards invalid domains and centres equal timestamps', () => {
  assertEquals(scaleTime(5, [0, 10], [20, 120]), 70);
  assertEquals(scaleTime(5, [5, 5], [20, 120]), 70);
  assertEquals(scaleTime(Number.NaN, [0, 10], [20, 120]), null);
  assertEquals(scaleTime(5, [10, 0], [20, 120]), null);
  assertEquals(scaleTime(5, [0, Number.POSITIVE_INFINITY], [20, 120]), null);
  assertEquals(scaleTime(5, [0, 10], [-Number.MAX_VALUE, Number.MAX_VALUE]), null);
});

Deno.test('time ticks adapt to available width while remaining deterministic', () => {
  const domain = [START, START + 3 * HOUR] as const;

  assertEquals(buildAdaptiveTimeTicks(domain, 300, 100, 8), [START, START + HOUR, START + 2 * HOUR, START + 3 * HOUR]);
  assertEquals(buildAdaptiveTimeTicks(domain, 50, 100, 8), [START + 1.5 * HOUR]);
  assertEquals(buildAdaptiveTimeTicks([START, START], 300), [START]);
  assertEquals(buildAdaptiveTimeTicks(null, 300), []);
  assertEquals(buildAdaptiveTimeTicks(domain, Number.NaN), []);
});

Deno.test('every explicit absence state breaks segments without becoming a zero score', () => {
  const gapStates: Exclude<TrendChartPointState, 'measured'>[] = [
    'unknown',
    'profile-missing',
    'not-evaluated',
    'not-recorded',
  ];

  for (const state of gapStates) {
    const geometry = buildTrendChartGeometry([point(0, 30), point(1, 0, state), point(2, 40)], PLOT);
    assertEquals(geometry.markers.length, 2);
    assertEquals(geometry.gaps, [
      { sourceIndex: 1, timestamp: START + HOUR, engineVersion: '1', reason: state, x: 50 },
    ]);
    assertEquals(geometry.segments, []);
  }
});

Deno.test('engine version transitions are hard segment boundaries', () => {
  const geometry = buildTrendChartGeometry(
    [point(0, 10, 'measured', '1'), point(1, 20, 'measured', '1'), point(2, 30, 'measured', '2')],
    PLOT
  );

  assertEquals(geometry.markers.length, 3);
  assertEquals(geometry.segments.length, 1);
  assertEquals(geometry.segments[0].engineVersion, '1');
  assertEquals(
    geometry.segments[0].points.map((marker) => marker.sourceIndex),
    [0, 1]
  );
});

Deno.test('contiguous measured runs create separate line segments around explicit gaps', () => {
  const geometry = buildTrendChartGeometry(
    [
      point(0, 10),
      point(1, 20),
      point(2, null, 'unknown'),
      point(3, 30, 'measured', '2'),
      point(4, 40, 'measured', '2'),
    ],
    PLOT
  );

  assertEquals(
    geometry.segments.map((segment) => ({
      engineVersion: segment.engineVersion,
      sourceIndexes: segment.points.map((marker) => marker.sourceIndex),
    })),
    [
      { engineVersion: '1', sourceIndexes: [0, 1] },
      { engineVersion: '2', sourceIndexes: [3, 4] },
    ]
  );
});

Deno.test('non-finite values become finite-safe gaps and break neighboring lines', () => {
  const invalidTime = { ...point(1, 20), generatedAt: 'not-a-date' };
  const geometry = buildTrendChartGeometry(
    [point(0, 10), invalidTime, point(2, Number.POSITIVE_INFINITY), point(3, 40)],
    PLOT
  );

  assertEquals(
    geometry.markers.map((marker) => marker.sourceIndex),
    [0, 3]
  );
  assertEquals(
    geometry.gaps.map(({ sourceIndex, reason, x }) => ({ sourceIndex, reason, x })),
    [
      { sourceIndex: 1, reason: 'invalid-time', x: null },
      { sourceIndex: 2, reason: 'invalid-score', x: 100 * (2 / 3) },
    ]
  );
  assertEquals(geometry.segments, []);
  assert(
    [...geometry.markers.flatMap((marker) => [marker.x, marker.y]), ...geometry.timeTicks.map((tick) => tick.x)].every(
      Number.isFinite
    )
  );
});

Deno.test('geometry is deterministic and does not mutate its source points', () => {
  const points = [point(0, 10), point(1, 20), point(3, null, 'not-recorded')];
  const before = structuredClone(points);

  assertEquals(buildTrendChartGeometry(points, PLOT), buildTrendChartGeometry(points, PLOT));
  assertEquals(points, before);
});
