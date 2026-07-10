// Route wiring tests for the `includeLineage` opt-in on the named resolved-config endpoint
// (issue #231). Builds a real temp-dir PCD cache, registers it, and invokes the GET handler.
// The lineage engine itself is covered by tests/pcd/resolved/lineage/*; here we only assert the
// route attaches `lineage` + `lineageStatus` when (and only when) requested, at layer=resolved.

// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SvelteKit app ambient types for route tests
/// <reference path="../../app.d.ts" />

import { assert, assertEquals } from '@std/assert';
import { GET as GET_NAMED } from '../../routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/+server.ts';
import { PCDCache } from '$pcd/index.ts';
import { setCache, deleteCache } from '$pcd/database/registry.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import type { ListPcdOpsOptions, PcdOp, PcdOpOrigin } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { clearSchemaDefaultsCache } from '$pcd/resolved/lineage/schemaDefaults.ts';
import type { components } from '$api/v1.d.ts';
import { logger } from '$logger/logger.ts';

type ResolvedEntityState = components['schemas']['ResolvedEntityState'];
type NamedGetEvent = Parameters<typeof GET_NAMED>[0];

const DATABASE_ID = 88231;
const SCHEMA_FILES = ['0.schema.sql', '1.languages.sql', '2.qualities.sql'] as const;

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

function makeOp(id: number, sql: string, origin: PcdOpOrigin = 'base'): PcdOp {
  return {
    id,
    database_id: DATABASE_ID,
    origin,
    state: 'published',
    source: 'repo',
    filename: null,
    op_number: null,
    sequence: id,
    sql,
    metadata: null,
    desired_state: null,
    content_hash: null,
    last_seen_in_repo_at: null,
    superseded_by_op_id: null,
    pushed_at: null,
    pushed_commit: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
  };
}

function buildEvent(query: string): NamedGetEvent {
  const event: Partial<NamedGetEvent> = {
    url: new URL(`http://localhost/api/v1/pcd/${DATABASE_ID}/resolved/customFormat/CF${query}`),
    params: { databaseId: String(DATABASE_ID), entityType: 'customFormat', name: 'CF' },
    locals: {
      user: {
        id: 1,
        username: 'user-1',
        password_hash: 'hash',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      session: null,
      authBypass: false,
    },
  };
  return event as NamedGetEvent;
}

async function withFixture(fn: () => Promise<void>): Promise<void> {
  const restores: Restore[] = [];
  for (const level of ['debug', 'info', 'warn', 'error', 'errorWithTrace'] as const) {
    patchTarget(logger, level, (async () => undefined) as (typeof logger)[typeof level], restores);
  }
  clearSchemaDefaultsCache();

  const pcdPath = await Deno.makeTempDir({ prefix: 'lineage-route-' });
  await Deno.mkdir(`${pcdPath}/deps/schema/ops`, { recursive: true });
  await Deno.mkdir(`${pcdPath}/tweaks`, { recursive: true });
  for (const file of SCHEMA_FILES) {
    const src = new URL(`../../../../praxrr-schema/ops/${file}`, import.meta.url);
    await Deno.writeTextFile(`${pcdPath}/deps/schema/ops/${file}`, await Deno.readTextFile(src));
  }

  const baseOps = [makeOp(1, "INSERT INTO custom_formats (name, include_in_rename) VALUES ('CF', 0)")];
  patchTarget(
    pcdOpsQueries,
    'listByDatabaseAndOrigin',
    ((_id: number, origin: PcdOpOrigin, options?: ListPcdOpsOptions): PcdOp[] =>
      origin === 'base' && (options?.states ?? []).includes('published')
        ? baseOps
        : []) as typeof pcdOpsQueries.listByDatabaseAndOrigin,
    restores
  );
  patchTarget(
    databaseInstancesQueries,
    'getById',
    ((id: number) =>
      id === DATABASE_ID
        ? ({ id, local_path: pcdPath, enabled: 1, conflict_strategy: 'override' } as unknown as ReturnType<
            typeof databaseInstancesQueries.getById
          >)
        : undefined) as typeof databaseInstancesQueries.getById,
    restores
  );
  patchTarget(
    pcdOpHistoryQueries,
    'listLatestByDatabaseWithOps',
    (() => []) as typeof pcdOpHistoryQueries.listLatestByDatabaseWithOps,
    restores
  );
  patchTarget(
    pcdOpHistoryQueries,
    'listLatestConflictsByDatabase',
    (() => []) as typeof pcdOpHistoryQueries.listLatestConflictsByDatabase,
    restores
  );

  // Register a real resolved cache (all layers) so `resolveLayerState(layer=resolved)` reads it.
  const cache = new PCDCache(pcdPath, DATABASE_ID);
  await cache.buildReadOnly({ layers: new Set(['schema', 'base', 'tweaks', 'user']) });
  setCache(DATABASE_ID, cache);

  try {
    await fn();
  } finally {
    deleteCache(DATABASE_ID);
    cache.close();
    await Deno.remove(pcdPath, { recursive: true });
    for (const restore of restores.reverse()) restore();
  }
}

Deno.test('route: includeLineage=true attaches lineage + lineageStatus at layer=resolved', async () => {
  await withFixture(async () => {
    const response = await GET_NAMED(buildEvent('?includeLineage=true'));
    assertEquals(response.status, 200);
    const body = (await response.json()) as ResolvedEntityState;
    assert(Array.isArray(body.lineage), 'lineage array attached');
    assertEquals(body.lineageStatus, 'available');
    const include = body.lineage?.find((l) => l.fieldPath === 'includeInRename');
    assertEquals(include?.sourceKind, 'base-op');
    assertEquals(include?.explicit, true);
  });
});

Deno.test('route: omitting includeLineage leaves the response lineage-free (byte-identical default)', async () => {
  await withFixture(async () => {
    const response = await GET_NAMED(buildEvent(''));
    assertEquals(response.status, 200);
    const body = (await response.json()) as ResolvedEntityState;
    assertEquals(body.lineage, undefined);
    assertEquals(body.lineageStatus, undefined);
  });
});

Deno.test('route: includeLineage is ignored for layer=base', async () => {
  await withFixture(async () => {
    const response = await GET_NAMED(buildEvent('?layer=base&includeLineage=true'));
    assertEquals(response.status, 200);
    const body = (await response.json()) as ResolvedEntityState;
    assertEquals(body.lineage, undefined, 'lineage is resolved-layer only');
  });
});
