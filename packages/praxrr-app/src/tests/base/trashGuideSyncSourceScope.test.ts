import { assertEquals, assertThrows } from '@std/assert';
import { db } from '../../lib/server/db/db.ts';
import {
  type TrashGuideSyncConfig,
  trashGuideSyncQueries,
  TrashGuideSyncScopeError,
  type TrashGuideSyncSelection,
} from '../../lib/server/db/queries/trashGuideSync.ts';

type Restore = () => void;

interface SqlCall {
  sql: string;
  params: unknown[];
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

Deno.test('trashGuideSyncQueries getSourceHydrationByInstance returns source metadata with scoped state', () => {
  const restores: Restore[] = [];
  const expectedConfig: TrashGuideSyncConfig = {
    instanceId: 301,
    sourceId: 81,
    trigger: 'manual',
    cron: null,
    nextRunAt: null,
    syncStatus: 'idle',
    lastError: null,
    lastSyncedAt: null,
    shouldSync: false,
    instanceType: 'radarr',
    sourceArrType: 'radarr',
  };
  const expectedSelections: TrashGuideSyncSelection[] = [
    {
      instanceId: 301,
      sourceId: 81,
      sectionType: 'customFormats',
      itemName: 'TRaSH CF One',
    },
  ];

  patchTarget(
    db,
    'query',
    ((sql: string, ...params: unknown[]) => {
      assertEquals(sql.includes('FROM arr_instances ai'), true);
      assertEquals(params, [301]);
      return [
        {
          source_id: 81,
          source_name: 'TRaSH Radarr 81',
          source_arr_type: 'radarr',
        },
      ];
    }) as typeof db.query,
    restores
  );
  patchTarget(
    trashGuideSyncQueries,
    'getConfig',
    ((instanceId: number, sourceId: number) => {
      assertEquals(instanceId, 301);
      assertEquals(sourceId, 81);
      return expectedConfig;
    }) as typeof trashGuideSyncQueries.getConfig,
    restores
  );
  patchTarget(
    trashGuideSyncQueries,
    'getSelections',
    ((instanceId: number, sourceId: number) => {
      assertEquals(instanceId, 301);
      assertEquals(sourceId, 81);
      return expectedSelections;
    }) as typeof trashGuideSyncQueries.getSelections,
    restores
  );

  try {
    const hydration = trashGuideSyncQueries.getSourceHydrationByInstance(301);

    assertEquals(hydration, [
      {
        sourceId: 81,
        sourceName: 'TRaSH Radarr 81',
        sourceArrType: 'radarr',
        config: expectedConfig,
        selections: expectedSelections,
      },
    ]);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSyncQueries assertScope rejects arr_type mismatches with explicit error code', () => {
  const restores: Restore[] = [];
  let capturedScopeQuery = false;
  let scopeQuery: SqlCall = {
    sql: '',
    params: [],
  };

  patchTarget(
    db,
    'queryFirst',
    ((sql: string, ...params: unknown[]) => {
      capturedScopeQuery = true;
      scopeQuery = { sql, params };
      return {
        instance_type: 'sonarr',
        source_arr_type: 'radarr',
      };
    }) as typeof db.queryFirst,
    restores
  );

  try {
    const error = assertThrows(() => trashGuideSyncQueries.assertScope(44, 15), TrashGuideSyncScopeError);

    assertEquals(error.code, 'arr_type_mismatch');
    assertEquals(error.message, 'TRaSH source arr_type mismatch: source arr_type=radarr, instance type=sonarr');
    assertEquals(capturedScopeQuery, true);
    assertEquals(scopeQuery.sql.includes('JOIN trash_guide_sources s ON s.id = ?'), true);
    assertEquals(scopeQuery.params, [15, 44]);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSyncQueries saveState deduplicates repeated selections by section and item name', () => {
  const restores: Restore[] = [];
  const executeCalls: SqlCall[] = [];
  let beginCalls = 0;
  let commitCalls = 0;
  let rollbackCalls = 0;

  patchTarget(
    db,
    'queryFirst',
    (() => ({
      instance_type: 'radarr',
      source_arr_type: 'radarr',
    })) as typeof db.queryFirst,
    restores
  );
  patchTarget(
    db,
    'execute',
    ((sql: string, ...params: unknown[]) => {
      executeCalls.push({ sql, params });
      return 1;
    }) as typeof db.execute,
    restores
  );
  patchTarget(
    db,
    'beginTransaction',
    (() => {
      beginCalls += 1;
    }) as typeof db.beginTransaction,
    restores
  );
  patchTarget(
    db,
    'commit',
    (() => {
      commitCalls += 1;
    }) as typeof db.commit,
    restores
  );
  patchTarget(
    db,
    'rollback',
    (() => {
      rollbackCalls += 1;
    }) as typeof db.rollback,
    restores
  );

  try {
    trashGuideSyncQueries.saveState({
      instanceId: 220,
      sourceId: 88,
      trigger: 'manual',
      selections: [
        { sectionType: 'customFormats', itemName: 'TRaSH CF One' },
        { sectionType: 'customFormats', itemName: 'TRaSH CF One' },
        { sectionType: 'qualityProfiles', itemName: 'TRaSH QP One' },
      ],
    });

    assertEquals(beginCalls, 1);
    assertEquals(commitCalls, 1);
    assertEquals(rollbackCalls, 0);

    const configUpserts = executeCalls.filter((call) => call.sql.includes('INSERT INTO trash_guide_sync_config'));
    assertEquals(configUpserts.length, 1);

    const selectionDelete = executeCalls.filter((call) => call.sql.includes('DELETE FROM trash_guide_sync_selections'));
    assertEquals(selectionDelete.length, 1);
    assertEquals(selectionDelete[0].params, [220, 88]);

    const selectionInserts = executeCalls.filter((call) =>
      call.sql.includes('INSERT INTO trash_guide_sync_selections')
    );
    assertEquals(selectionInserts.length, 2);
    assertEquals(selectionInserts[0].params, [220, 88, 'customFormats', 'TRaSH CF One']);
    assertEquals(selectionInserts[1].params, [220, 88, 'qualityProfiles', 'TRaSH QP One']);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});

Deno.test('trashGuideSyncQueries saveState fails fast on scope mismatch before transactional writes', () => {
  const restores: Restore[] = [];
  let beginCalls = 0;
  let executeCalls = 0;

  patchTarget(
    db,
    'queryFirst',
    (() => ({
      instance_type: 'sonarr',
      source_arr_type: 'radarr',
    })) as typeof db.queryFirst,
    restores
  );
  patchTarget(
    db,
    'beginTransaction',
    (() => {
      beginCalls += 1;
    }) as typeof db.beginTransaction,
    restores
  );
  patchTarget(
    db,
    'execute',
    (() => {
      executeCalls += 1;
      return 1;
    }) as typeof db.execute,
    restores
  );

  try {
    const error = assertThrows(
      () =>
        trashGuideSyncQueries.saveState({
          instanceId: 221,
          sourceId: 89,
          trigger: 'manual',
          selections: [],
        }),
      TrashGuideSyncScopeError
    );

    assertEquals(error.code, 'arr_type_mismatch');
    assertEquals(beginCalls, 0);
    assertEquals(executeCalls, 0);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }
});
