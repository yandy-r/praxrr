import { assertEquals, assertThrows } from '@std/assert';
import { db } from '../../lib/server/db/db.ts';
import { startupPullQueries } from '../../lib/server/db/queries/startupPull.ts';

type Restore = () => void;

function patchTarget<T extends object, K extends keyof T>(
  target: T,
  key: K,
  replacement: T[K],
  restores: Restore[]
): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

Deno.test('getLatest maps db row fields to camelCase startup run record', () => {
  const restores: Restore[] = [];
  const row = {
    id: 'run-2026-01-01',
    status: 'success',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: null,
    imported: 1,
    skipped_default: 2,
    skipped_no_match: 3,
    conflicted: 4,
    failed: 5,
    instances_total: 6,
    instances_failed: 7,
    created_at: '2026-01-01T00:00:00.100Z',
  };

  patchTarget(db, 'queryFirst', (() => row) as typeof db.queryFirst, restores);

  try {
    const result = startupPullQueries.getLatest();
    assertEquals(result, {
      id: row.id,
      status: 'success',
      startedAt: row.started_at,
      finishedAt: null,
      imported: 1,
      skippedDefault: 2,
      skippedNoMatch: 3,
      conflicted: 4,
      failed: 5,
      instancesTotal: 6,
      instancesFailed: 7,
      createdAt: row.created_at,
    });
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('getLatest throws when DB returns an invalid startup pull status', () => {
  const restores: Restore[] = [];
  const row = {
    id: 'run-2026-01-01',
    status: 'bogus',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: null,
    imported: 0,
    skipped_default: 0,
    skipped_no_match: 0,
    conflicted: 0,
    failed: 0,
    instances_total: 0,
    instances_failed: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  patchTarget(db, 'queryFirst', (() => row) as typeof db.queryFirst, restores);

  try {
    assertThrows(() => startupPullQueries.getLatest(), Error, `Invalid StartupPullRunStatus value: ${row.status}`);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('getLatestWithOutcomes maps run and instance rows', () => {
  const restores: Restore[] = [];
  const runRow = {
    id: 'run-2026-01-01',
    status: 'partial',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:00:20.000Z',
    imported: 10,
    skipped_default: 1,
    skipped_no_match: 2,
    conflicted: 0,
    failed: 3,
    instances_total: 5,
    instances_failed: 1,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const outcomeRows = [
    {
      id: 9,
      run_id: runRow.id,
      instance_id: 11,
      instance_name: 'radarr-main',
      arr_type: 'radarr',
      status: 'failure',
      imported: 1,
      skipped_default: 0,
      skipped_no_match: 1,
      conflicted: 0,
      failed: 1,
      created_at: '2026-01-01T00:00:00.100Z',
    },
  ];

  patchTarget(db, 'queryFirst', (() => runRow) as typeof db.queryFirst, restores);
  patchTarget(db, 'query', (() => outcomeRows) as typeof db.query, restores);

  try {
    const result = startupPullQueries.getLatestWithOutcomes();
    assertEquals(result, {
      id: runRow.id,
      status: 'partial',
      startedAt: runRow.started_at,
      finishedAt: runRow.finished_at,
      imported: 10,
      skippedDefault: 1,
      skippedNoMatch: 2,
      conflicted: 0,
      failed: 3,
      instancesTotal: 5,
      instancesFailed: 1,
      createdAt: runRow.created_at,
      instances: [
        {
          id: 9,
          runId: runRow.id,
          instanceId: 11,
          instanceName: 'radarr-main',
          arrType: 'radarr',
          status: 'failure',
          imported: 1,
          skippedDefault: 0,
          skippedNoMatch: 1,
          conflicted: 0,
          failed: 1,
          createdAt: outcomeRows[0].created_at,
        },
      ],
    });
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('getByIdWithOutcomes throws on invalid arr_type in outcome rows', () => {
  const restores: Restore[] = [];
  const runRow = {
    id: 'run-2026-01-01',
    status: 'failed',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: null,
    imported: 0,
    skipped_default: 0,
    skipped_no_match: 0,
    conflicted: 0,
    failed: 1,
    instances_total: 1,
    instances_failed: 1,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const badOutcomeRows = [
    {
      id: 3,
      run_id: runRow.id,
      instance_id: 8,
      instance_name: 'broken',
      arr_type: 'not-a-type',
      status: 'success',
      imported: 0,
      skipped_default: 0,
      skipped_no_match: 0,
      conflicted: 0,
      failed: 0,
      created_at: '2026-01-01T00:00:00.200Z',
    },
  ];

  patchTarget(db, 'queryFirst', (() => runRow) as typeof db.queryFirst, restores);
  patchTarget(db, 'query', (() => badOutcomeRows) as typeof db.query, restores);

  try {
    assertThrows(
      () => startupPullQueries.getByIdWithOutcomes('run-2026-01-01'),
      Error,
      `Invalid ArrAppType value: ${badOutcomeRows[0].arr_type}`
    );
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
