import { assertEquals } from '@std/assert';
import { toConfigHealthTrendCsv } from '$lib/server/health/trendCsv.ts';
import type {
  ConfigHealthTrendCriterion,
  ConfigHealthTrendPoint,
  ConfigHealthTrendResult,
} from '$lib/server/health/trends.ts';

const HEADER = 'snapshotId,generatedAt,engineVersion,scopeKind,profileName,state,score,band,criteria';
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠'] as const;

function result(points: readonly ConfigHealthTrendPoint[], profile: string | null = null): ConfigHealthTrendResult {
  return {
    instance: { id: 12, name: 'Living Room Sonarr', arrType: 'sonarr' },
    currentEngineVersion: '9',
    normalizedFilter: {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-10T12:00:00.000Z',
      profile,
    },
    retention: {
      days: 90,
      maxEntries: 5000,
      ageCutoffAt: '2026-04-11T12:00:00.000Z',
      oldestAvailableAt: points[0]?.generatedAt ?? null,
      newestAvailableAt: points.at(-1)?.generatedAt ?? null,
    },
    availableProfiles: profile === null ? [] : [profile],
    counts: {
      points: points.length,
      measured: points.filter((point) => point.state === 'measured').length,
      unknown: points.filter((point) => point.state === 'unknown').length,
      missing: points.filter((point) => point.state === 'profile-missing' || point.state === 'not-recorded').length,
    },
    engineBoundaries: [],
    points,
  };
}

function point(snapshotId: number, overrides: Partial<ConfigHealthTrendPoint> = {}): ConfigHealthTrendPoint {
  return {
    snapshotId,
    generatedAt: `2026-06-${String(snapshotId).padStart(2, '0')}T00:00:00.000Z`,
    engineVersion: '1',
    state: 'measured',
    score: 80,
    band: 'attention',
    criteria: [],
    ...overrides,
  };
}

/** Parse the fixed CSV output, including CR/LF embedded inside quoted cells. */
function parseCsv(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      record.push(cell);
      cell = '';
    } else if (character === '\r' && csv[index + 1] === '\n') {
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
      index += 1;
    } else {
      cell += character;
    }
  }

  record.push(cell);
  records.push(record);
  return records;
}

Deno.test('trend CSV returns only the fixed header for an empty canonical result', () => {
  assertEquals(toConfigHealthTrendCsv(result([])), HEADER);
});

Deno.test('trend CSV preserves numeric zero and leaves nullable score and band cells blank', () => {
  const csv = toConfigHealthTrendCsv(
    result([
      point(1, { score: 0, band: 'healthy' }),
      point(2, { state: 'unknown', score: null, band: 'unknown' }),
      point(3, { state: 'not-recorded', score: null, band: null }),
    ])
  );
  const rows = parseCsv(csv);

  assertEquals(rows[1].slice(3, 9), ['overall', '', 'measured', '0', 'healthy', '[]']);
  assertEquals(rows[2].slice(3, 9), ['overall', '', 'unknown', '', 'unknown', '[]']);
  assertEquals(rows[3].slice(3, 9), ['overall', '', 'not-recorded', '', '', '[]']);
});

Deno.test('trend CSV keeps nested criterion JSON compact and exactly round-trippable', () => {
  const criteria: readonly ConfigHealthTrendCriterion[] = [
    {
      id: 'criterion,one',
      label: 'Quoted "label"\r\nnext line',
      state: 'measured',
      score: 0,
      weight: 25,
      contribution: 0,
    },
    {
      id: 'criterion-two',
      label: 'Not evaluated',
      state: 'not-evaluated',
      score: null,
      weight: 10,
      contribution: null,
    },
  ];
  const csv = toConfigHealthTrendCsv(result([point(1, { criteria })]));
  const criteriaCell = parseCsv(csv)[1][8];

  assertEquals(criteriaCell, JSON.stringify(criteria));
  assertEquals(JSON.parse(criteriaCell), criteria);
});

Deno.test('trend CSV formula-neutralizes every dangerous exact-profile prefix before quoting', () => {
  for (const prefix of FORMULA_PREFIXES) {
    const profile = `${prefix}profile, "quoted"\r\nnext`;
    const row = parseCsv(toConfigHealthTrendCsv(result([point(1)], profile)))[1];

    assertEquals(row[3], 'profile');
    assertEquals(row[4], `'${profile}`);
  }
});

Deno.test('trend CSV preserves non-leading formula characters and ordinary Unicode exactly', () => {
  const profile = 'profile = + - @ ＝ ＋ － ＠ 日本語';
  const row = parseCsv(toConfigHealthTrendCsv(result([point(1)], profile)))[1];

  assertEquals(row[4], profile);
});

Deno.test('trend CSV preserves canonical point identity, count and order without sorting or dropping rows', () => {
  const points = [
    point(9, { generatedAt: '2026-06-01T00:00:00.000Z' }),
    point(3, { generatedAt: '2026-06-01T00:00:00.000Z', engineVersion: '@engine' }),
    point(7, { generatedAt: '2026-07-01T00:00:00.000Z', state: 'profile-missing', score: null, band: null }),
  ];
  const rows = parseCsv(toConfigHealthTrendCsv(result(points, 'Exact Profile')));

  assertEquals(rows.length - 1, points.length);
  assertEquals(
    rows.slice(1).map((row) => Number(row[0])),
    points.map((candidate) => candidate.snapshotId)
  );
  assertEquals(
    rows.slice(1).map((row) => row[1]),
    points.map((candidate) => candidate.generatedAt)
  );
  assertEquals(
    rows.slice(1).map((row) => row[2]),
    ['1', "'@engine", '1']
  );
});
