import { assertEquals, assertThrows } from '@std/assert';
import { db } from '$db/db.ts';
import { pcdSnapshotQueries } from '$db/queries/pcdSnapshots.ts';
import { __testOnly, snapshotService } from '$pcd/snapshots/service.ts';
import type { PcdSnapshotDetail } from '$pcd/snapshots/types.ts';
import { logger } from '$logger/logger.ts';

type Restore = () => void;
type Restores = Restore[];

interface PublishedOpRow {
  id: number;
  origin: string;
  sequence: number | null;
  state: string;
  source: string;
  content_hash: string | null;
  sql: string;
  metadata: string | null;
}

interface SnapshotInsertInput {
  databaseId: number;
  type: 'auto' | 'manual';
  trigger: 'pull' | 'sync' | 'manual';
  description?: string | null;
  opsSequenceMaxId: number;
  opsCountBase: number;
  opsCountUser: number;
  cacheStateHash?: string | null;
  targetInstanceIds?: number[] | null;
}

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

function toLocalSqlTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').split('.')[0];
}

function patchLoggerForTest(restores: Restores): void {
  patchTarget(logger, 'debug', (async () => undefined) as typeof logger.debug, restores);
  patchTarget(logger, 'info', (async () => undefined) as typeof logger.info, restores);
  patchTarget(logger, 'warn', (async () => undefined) as typeof logger.warn, restores);
  patchTarget(logger, 'error', (async () => undefined) as typeof logger.error, restores);
  patchTarget(logger, 'errorWithTrace', (async () => undefined) as typeof logger.errorWithTrace, restores);
}

function setDbForAutoSnapshotMetadata(
  restores: Restores,
  dbInputs: {
    latestSnapshot?: { ops_sequence_max_id: number; cache_state_hash: string | null; created_at: string };
    metadataMaxId?: number;
    opsCountBase?: number;
    opsCountUser?: number;
    publishedRows?: PublishedOpRow[];
  }
): void {
  const {
    latestSnapshot = { ops_sequence_max_id: 99, cache_state_hash: 'same-hash', created_at: '2026-03-01 00:00:00' },
    metadataMaxId = 99,
    opsCountBase = 2,
    opsCountUser = 1,
    publishedRows = [
      {
        id: 1,
        origin: 'base',
        sequence: 1,
        state: 'published',
        source: 'seed',
        content_hash: 'same-hash',
        sql: 'INSERT ...',
        metadata: null,
      },
    ],
  } = dbInputs;

  patchTarget(
    db,
    'query',
    ((sql: string, ..._params: unknown[]): PublishedOpRow[] => {
      if (sql.includes('FROM pcd_ops') && sql.includes("state = 'published'")) {
        return publishedRows;
      }

      return [];
    }) as typeof db.query,
    restores
  );

  patchTarget(
    db,
    'queryFirst',
    ((sql: string, ..._params: unknown[]) => {
      if (sql.includes('MAX(id) as max_id FROM pcd_ops')) {
        return { max_id: metadataMaxId };
      }

      if (sql.includes('COUNT(*) as count FROM pcd_ops') && sql.includes("origin = 'base'")) {
        return { count: opsCountBase };
      }

      if (sql.includes('COUNT(*) as count FROM pcd_ops') && sql.includes("origin = 'user'")) {
        return { count: opsCountUser };
      }

      if (sql.includes('FROM pcd_snapshots')) {
        return latestSnapshot ? latestSnapshot : undefined;
      }

      return undefined;
    }) as typeof db.queryFirst,
    restores
  );
}

Deno.test('snapshotService.parseCreatedAtUtc treats SQLite UTC timestamps as UTC', () => {
  assertEquals(__testOnly.parseCreatedAtUtc('2026-03-01 12:34:56'), Date.UTC(2026, 2, 1, 12, 34, 56));
  assertEquals(__testOnly.parseCreatedAtUtc('2026-03-01T12:34:56Z'), Date.UTC(2026, 2, 1, 12, 34, 56));
});

Deno.test('snapshotService.parseCreatedAtUtc throws for invalid timestamps', () => {
  assertThrows(() => {
    __testOnly.parseCreatedAtUtc('not-a-timestamp');
  }, Error, 'Invalid pcd snapshot created_at value');
});

Deno.test('snapshotService.createAutoSnapshot skips duplicate snapshot within UTC dedupe window', async () => {
  const restores: Restores = [];
  patchLoggerForTest(restores);
  const fixedNow = Date.UTC(2026, 2, 1, 12, 0, 0);
  const duplicateCreatedAt = toLocalSqlTimestamp(new Date(fixedNow - 10_000));
  const oldNow = Date.now;
  Date.now = () => fixedNow;
  let createCalls = 0;
  let pruned = -1;

  try {
    setDbForAutoSnapshotMetadata(restores, {
      latestSnapshot: {
        ops_sequence_max_id: 99,
        cache_state_hash: null,
        created_at: duplicateCreatedAt,
      },
      metadataMaxId: 99,
      opsCountBase: 2,
      opsCountUser: 1,
      publishedRows: [
        // Empty published-op snapshot for deterministic null cache hash
      ],
    });

    patchTarget(
      pcdSnapshotQueries,
      'create',
      (() => {
        createCalls += 1;
        throw new Error('should not create duplicate');
      }) as typeof pcdSnapshotQueries.create,
      restores
    );

    patchTarget(
      pcdSnapshotQueries,
      'pruneAutoSnapshots',
      ((..._args: Parameters<typeof pcdSnapshotQueries.pruneAutoSnapshots>) => {
        pruned += 1;
        return 0;
      }) as typeof pcdSnapshotQueries.pruneAutoSnapshots,
      restores
    );

    const snapshot = await snapshotService.createAutoSnapshot({
      databaseId: 42,
      trigger: 'pull',
    });

    assertEquals(snapshot, null);
    assertEquals(createCalls, 0);
    assertEquals(pruned, -1);
  } finally {
    Date.now = oldNow;
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test(
  'snapshotService.createAutoSnapshot creates and prunes auto snapshots when dedupe does not match',
  async () => {
    const restores: Restores = [];
    patchLoggerForTest(restores);
    let pruneArgs: Parameters<typeof pcdSnapshotQueries.pruneAutoSnapshots> | null = null;
    const capturedCreateInput = {
      databaseId: null as number | null,
      type: null as SnapshotInsertInput['type'] | null,
      trigger: null as SnapshotInsertInput['trigger'] | null,
      opsSequenceMaxId: null as number | null,
      opsCountBase: null as number | null,
      opsCountUser: null as number | null,
    };

    setDbForAutoSnapshotMetadata(restores, {
      latestSnapshot: undefined,
      metadataMaxId: 101,
      opsCountBase: 3,
      opsCountUser: 7,
    });

    patchTarget(
      pcdSnapshotQueries,
      'create',
      ((input: SnapshotInsertInput): PcdSnapshotDetail => {
        capturedCreateInput.databaseId = input.databaseId;
        capturedCreateInput.type = input.type;
        capturedCreateInput.trigger = input.trigger;
        capturedCreateInput.opsSequenceMaxId = input.opsSequenceMaxId;
        capturedCreateInput.opsCountBase = input.opsCountBase;
        capturedCreateInput.opsCountUser = input.opsCountUser;
        return {
          id: 301,
          databaseId: input.databaseId,
          type: input.type,
          trigger: input.trigger,
          description: null,
          opsSequenceMaxId: input.opsSequenceMaxId,
          opsCountBase: input.opsCountBase,
          opsCountUser: input.opsCountUser,
          cacheStateHash: input.cacheStateHash ?? null,
          targetInstanceIds: null,
          createdAt: '2026-03-01 00:00:00',
        };
      }) as typeof pcdSnapshotQueries.create,
      restores
    );

    patchTarget(
      pcdSnapshotQueries,
      'pruneAutoSnapshots',
      ((...args: Parameters<typeof pcdSnapshotQueries.pruneAutoSnapshots>) => {
        pruneArgs = args;
        return 2;
      }) as typeof pcdSnapshotQueries.pruneAutoSnapshots,
      restores
    );

    try {
      const snapshot = await snapshotService.createAutoSnapshot({
        databaseId: 43,
        trigger: 'sync',
      });

      assertEquals(snapshot?.id, 301);
      assertEquals(snapshot?.databaseId, 43);
      assertEquals(capturedCreateInput.databaseId, 43);
      assertEquals(capturedCreateInput.type, 'auto');
      assertEquals(capturedCreateInput.trigger, 'sync');
      assertEquals(capturedCreateInput.opsSequenceMaxId, 101);
      assertEquals(capturedCreateInput.opsCountBase, 3);
      assertEquals(capturedCreateInput.opsCountUser, 7);
      assertEquals(pruneArgs, [43, 50, 30]);
    } finally {
      for (const restore of restores.reverse()) {
        restore();
      }
    }
  }
);

Deno.test('snapshotService.createAutoSnapshot logs prune failures as errors and keeps snapshot', async () => {
  const restores: Restores = [];
  patchLoggerForTest(restores);
  let loggedError = false;
  let errorMessage = '';

  setDbForAutoSnapshotMetadata(restores, {
    latestSnapshot: undefined,
    metadataMaxId: 101,
    opsCountBase: 3,
    opsCountUser: 7,
  });

  patchTarget(
    logger,
    'error',
    ((..._args: unknown[]) => {
      loggedError = true;
      const payload = _args[1];
      if (payload && typeof payload === 'object' && 'meta' in payload) {
        const meta = (payload as { meta?: { error?: unknown } }).meta;
        if (meta && 'error' in meta) {
          errorMessage = String(meta.error);
        }
      }
    }) as typeof logger.error,
    restores
  );

  patchTarget(
    pcdSnapshotQueries,
    'create',
    (() => ({
      id: 501,
      databaseId: 43,
      type: 'auto',
      trigger: 'sync',
      description: null,
      opsSequenceMaxId: 101,
      opsCountBase: 3,
      opsCountUser: 7,
      cacheStateHash: null,
      targetInstanceIds: null,
      createdAt: '2026-03-01 00:00:00',
    })) as typeof pcdSnapshotQueries.create,
    restores
  );

  patchTarget(
    pcdSnapshotQueries,
    'pruneAutoSnapshots',
    (() => {
      throw new Error('prune failed');
    }) as typeof pcdSnapshotQueries.pruneAutoSnapshots,
    restores
  );

  try {
    const snapshot = await snapshotService.createAutoSnapshot({
      databaseId: 43,
      trigger: 'sync',
    });

    assertEquals(snapshot?.id, 501);
    assertEquals(loggedError, true);
    assertEquals(errorMessage, 'prune failed');
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('snapshotService.createManualSnapshot does not invoke auto pruning and stores manual trigger', async () => {
  const restores: Restores = [];
  patchLoggerForTest(restores);
  const capturedCreateInput = {
    databaseId: null as number | null,
    type: null as SnapshotInsertInput['type'] | null,
    trigger: null as SnapshotInsertInput['trigger'] | null,
    opsCountBase: null as number | null,
    opsCountUser: null as number | null,
    description: null as string | null,
  };
  let pruneCalled = 0;

  setDbForAutoSnapshotMetadata(restores, {
    latestSnapshot: undefined,
    metadataMaxId: 11,
    opsCountBase: 4,
    opsCountUser: 8,
  });

  patchTarget(
    pcdSnapshotQueries,
    'create',
    ((input: SnapshotInsertInput): PcdSnapshotDetail => {
      capturedCreateInput.databaseId = input.databaseId;
      capturedCreateInput.type = input.type;
      capturedCreateInput.trigger = input.trigger;
      capturedCreateInput.opsCountBase = input.opsCountBase;
      capturedCreateInput.opsCountUser = input.opsCountUser;
      capturedCreateInput.description = input.description ?? null;
      return {
        id: 401,
        databaseId: input.databaseId,
        type: input.type,
        trigger: input.trigger,
        description: input.description ?? null,
        opsSequenceMaxId: input.opsSequenceMaxId,
        opsCountBase: input.opsCountBase,
        opsCountUser: input.opsCountUser,
        cacheStateHash: input.cacheStateHash ?? null,
        targetInstanceIds: null,
        createdAt: '2026-03-01 00:00:00',
      };
    }) as typeof pcdSnapshotQueries.create,
    restores
  );

  patchTarget(
    pcdSnapshotQueries,
    'pruneAutoSnapshots',
    (() => {
      pruneCalled += 1;
      return 0;
    }) as typeof pcdSnapshotQueries.pruneAutoSnapshots,
    restores
  );

  try {
    const snapshot = await snapshotService.createManualSnapshot({
      databaseId: 44,
      description: 'user note',
    });

    assertEquals(snapshot.id, 401);
    assertEquals(capturedCreateInput.databaseId, 44);
    assertEquals(capturedCreateInput.type, 'manual');
    assertEquals(capturedCreateInput.trigger, 'manual');
    assertEquals(capturedCreateInput.description, 'user note');
    assertEquals(capturedCreateInput.opsCountBase, 4);
    assertEquals(capturedCreateInput.opsCountUser, 8);
    assertEquals(pruneCalled, 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('snapshotService.createAutoSnapshot returns null when database metadata retrieval fails', async () => {
  const restores: Restores = [];
  patchLoggerForTest(restores);
  let loggedErrorMessage = '';

  patchTarget(
    db,
    'queryFirst',
    ((..._args: unknown[]) => {
      throw new Error('metadata query failed');
    }) as typeof db.queryFirst,
    restores
  );

  patchTarget(
    logger,
    'error',
    ((message: string, payload?: unknown) => {
      const payloadAsString = payload instanceof Error
        ? payload.message
        : typeof payload === 'string'
        ? payload
        : payload
        ? JSON.stringify(payload)
        : '';
      loggedErrorMessage = `${message} ${payloadAsString}`.trim();
    }) as typeof logger.error,
    restores
  );

  try {
    const snapshot = await snapshotService.createAutoSnapshot({
      databaseId: 45,
      trigger: 'pull',
    });

    assertEquals(snapshot, null);
    assertEquals(loggedErrorMessage.includes('Auto snapshot creation failed'), true);
    assertEquals(loggedErrorMessage.includes('metadata query failed'), true);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
