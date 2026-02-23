import { assertEquals } from '@std/assert';
import * as deserialize from '$pcd/entities/deserialize.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import { deleteCache, getCache, setCache } from '$pcd/database/registry.ts';
import { Database } from '@jsr/db__sqlite';
import type { PCDCache } from '$pcd/index.ts';
import { Kysely } from 'kysely';
import { DenoSqlite3Dialect } from '@soapbox/kysely-deno-sqlite';
import type { PCDDatabase } from '$shared/pcd/types.ts';
import type { PcdOp } from '$db/queries/pcdOps.ts';
import { logger } from '$logger/logger.ts';

const DATABASE_ID = 9320;
const PCD_SCHEMA_SQL_PATH = new URL('../../../../../praxrr-schema/ops/0.schema.sql', import.meta.url);
const PCD_SCHEMA_SQL = Deno.readTextFileSync(PCD_SCHEMA_SQL_PATH);

type Restore = () => void;

function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K], restores: Restore[]): void {
  const original = target[key];
  target[key] = replacement;
  restores.push(() => {
    target[key] = original;
  });
}

function patchCompilePathDependencies(restores: Restore[]): void {
  patch(pcdOpHistoryQueries, 'create', () => 1, restores);
  patch(pcdOpHistoryQueries, 'listLatestByDatabaseWithOps', () => [], restores);
  patch(pcdOpHistoryQueries, 'listLatestConflictsByDatabase', () => [], restores);
}

function patchMutedLogger(restores: Restore[]): void {
  patch(
    logger,
    'debug',
    async () => {
      return undefined;
    },
    restores
  );

  patch(
    logger,
    'info',
    async () => {
      return undefined;
    },
    restores
  );

  patch(
    logger,
    'warn',
    async () => {
      return undefined;
    },
    restores
  );

  patch(
    logger,
    'error',
    async () => {
      return undefined;
    },
    restores
  );

  patch(
    logger,
    'errorWithTrace',
    async () => {
      return undefined;
    },
    restores
  );
}

function patchDatabaseInstance(restores: Restore[], localPath: string): void {
  patch(
    databaseInstancesQueries,
    'getById',
    () => ({
      id: DATABASE_ID,
      uuid: 'deserialize-instance',
      name: 'deserialize-instance',
      repository_url: '',
      local_path: localPath,
      sync_strategy: 0,
      auto_pull: 1,
      enabled: 1,
      personal_access_token: null,
      is_private: 0,
      local_ops_enabled: 0,
      git_user_name: null,
      git_user_email: null,
      conflict_strategy: 'override',
      last_synced_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    restores
  );
}

function patchInMemoryPcdOps(restores: Restore[], databaseId: number): PcdOp[] {
  const createdOps: PcdOp[] = [];
  let nextOpId = 1;

  patch(
    pcdOpsQueries,
    'create',
    (input) => {
      const opId = nextOpId++;
      const metadata = (() => {
        if (input.metadata === null || input.metadata === undefined) {
          return null;
        }
        if (typeof input.metadata === 'string') {
          return input.metadata;
        }
        return JSON.stringify(input.metadata);
      })();
      const desiredState = (() => {
        if (input.desiredState === null || input.desiredState === undefined) {
          return null;
        }
        if (typeof input.desiredState === 'string') {
          return input.desiredState;
        }
        return JSON.stringify(input.desiredState);
      })();
      createdOps.push({
        id: opId,
        database_id: input.databaseId,
        origin: input.origin,
        state: input.state,
        source: input.source,
        filename: input.filename ?? null,
        op_number: input.opNumber ?? null,
        sequence: input.sequence ?? null,
        sql: input.sql,
        metadata,
        desired_state: desiredState,
        content_hash: input.contentHash ?? null,
        last_seen_in_repo_at: input.lastSeenInRepoAt ?? null,
        superseded_by_op_id: input.supersededByOpId ?? null,
        pushed_at: input.pushedAt ?? null,
        pushed_commit: input.pushedCommit ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return opId;
    },
    restores
  );

  patch(
    pcdOpsQueries,
    'listByDatabaseAndOrigin',
    (id, origin, options) => {
      if (id !== databaseId) return [];
      return createdOps
        .filter((op) => op.origin === origin)
        .filter((op) => !options?.states || options.states.length === 0 || options.states.includes(op.state))
        .filter((op) => !options?.source || op.source === options.source)
        .sort((left, right) => left.id - right.id);
    },
    restores
  );

  patch(
    pcdOpsQueries,
    'getById',
    (id) => {
      return createdOps.find((op) => op.id === id);
    },
    restores
  );

  patch(pcdOpsQueries, 'update', () => true, restores);

  return createdOps;
}

function readOperationTitles(operations: PcdOp[]): string[] {
  return operations
    .map((op) => {
      if (!op.metadata) return '';
      const rawMetadata = op.metadata as unknown;
      if (typeof rawMetadata === 'string') {
        try {
          const decoded = JSON.parse(rawMetadata) as { title?: string };
          return decoded.title ?? '';
        } catch {
          return '';
        }
      }

      if (typeof rawMetadata === 'object') {
        const decoded = rawMetadata as { title?: string };
        return decoded.title ?? '';
      }
      return '';
    })
    .filter(Boolean);
}

function readOperationSql(operations: PcdOp[]): string[] {
  return operations.map((operation) => operation.sql);
}

const CUSTOM_FORMAT_FIXTURE_SQL = `
INSERT INTO tags (name) VALUES ('Drama');
INSERT INTO tags (name) VALUES ('Sci-Fi');
`;

const QUALITY_PROFILE_FIXTURE_SQL = `
INSERT INTO qualities (id, name) VALUES (1, 'Remux-1080p');
INSERT INTO qualities (id, name) VALUES (2, 'Bluray-1080p');
INSERT INTO tags (name) VALUES ('Profile-Tag');
`;

function createCacheFixture(databaseId: number, schemaSql: string) {
  const db = new Database(':memory:', { int64: true });
  const kb = new Kysely<PCDDatabase>({
    dialect: new DenoSqlite3Dialect({
      database: db,
    }),
  });
  const tempPath = Deno.makeTempDirSync({ prefix: 'pcd-deserialize-' });
  const schemaDir = `${tempPath}/deps/schema/ops`;

  Deno.mkdirSync(schemaDir, { recursive: true });
  Deno.writeTextFileSync(`${schemaDir}/000-schema.sql`, schemaSql);
  db.exec(schemaSql);
  const cache = {
    kb,
    getRawDb: () => db,
    validateSql: () => ({ valid: true }),
    close: () => {},
  } as unknown as PCDCache;

  setCache(databaseId, cache);
  return {
    db,
    kb,
    cache,
    localPath: tempPath,
    destroy: async () => {
      await kb.destroy();
      db.close();
      const activeCache = getCache(databaseId);
      if (activeCache) {
        activeCache.close();
      }
      deleteCache(databaseId);
      await Deno.remove(tempPath, { recursive: true });
    },
  };
}

Deno.test('pcd entities: custom format deserialization builds base, conditions, and tests', async () => {
  const restores: Restore[] = [];
  const fixture = createCacheFixture(
    DATABASE_ID,
    `${PCD_SCHEMA_SQL}
${CUSTOM_FORMAT_FIXTURE_SQL}`
  );
  const createdOps = patchInMemoryPcdOps(restores, DATABASE_ID);

  try {
    patchMutedLogger(restores);
    patchCompilePathDependencies(restores);
    patchDatabaseInstance(restores, fixture.localPath);

    const result = await deserialize.deserializeCustomFormat({
      databaseId: DATABASE_ID,
      cache: fixture.cache,
      layer: 'user',
      portable: {
        name: 'CF-Compound',
        description: 'Compound custom format',
        includeInRename: true,
        tags: ['Drama', 'Sci-Fi'],
        conditions: [
          {
            name: 'HD',
            type: 'quality_modifier',
            negate: false,
            required: false,
            qualityModifiers: ['1080p'],
            arrType: 'all',
          },
        ],
        tests: [
          {
            title: 'Matches release',
            type: 'movie',
            shouldMatch: true,
            description: 'Expected a positive match',
          },
        ],
      },
    });

    assertEquals(result.success, true);
    assertEquals(typeof result.filepath, 'string');
    assertEquals(result.filepath?.startsWith('pcd_ops:'), true);
    const sqlText = readOperationSql(createdOps).join('\n');
    const titles = readOperationTitles(createdOps);
    assertEquals(createdOps.length >= 5, true);
    assertEquals(sqlText.includes('custom_format'), true);
    assertEquals(titles.length >= 1, true);
    assertEquals(
      titles.some((title) => title.includes('custom format')),
      true
    );
  } finally {
    while (restores.length > 0) restores.pop()?.();
    await fixture.destroy();
  }
});

Deno.test('pcd entities: quality profile deserialization updates qualities and scoring after create', async () => {
  const restores: Restore[] = [];
  const fixture = createCacheFixture(
    DATABASE_ID,
    `${PCD_SCHEMA_SQL}
${QUALITY_PROFILE_FIXTURE_SQL}`
  );
  const createdOps = patchInMemoryPcdOps(restores, DATABASE_ID);

  try {
    patchMutedLogger(restores);
    patchCompilePathDependencies(restores);
    patchDatabaseInstance(restores, fixture.localPath);

    const result = await deserialize.deserializeQualityProfile({
      databaseId: DATABASE_ID,
      cache: fixture.cache,
      layer: 'user',
      portable: {
        name: 'QP-Compound',
        description: 'Compound quality profile',
        tags: ['Profile-Tag'],
        language: null,
        orderedItems: [
          {
            type: 'quality',
            name: 'Bluray-1080p',
            position: 1,
            enabled: true,
            upgradeUntil: false,
            members: [],
          },
        ],
        minimumScore: 10,
        upgradeUntilScore: 100,
        upgradeScoreIncrement: 5,
        customFormatScores: [],
      },
    });

    assertEquals(result.success, true);
    assertEquals(result.filepath, 'pcd_ops:1');
    const sqlStatements = readOperationSql(createdOps);
    const sqlText = sqlStatements.join('\n');
    const titles = readOperationTitles(createdOps);

    assertEquals(createdOps.length >= 2, true);
    assertEquals(sqlText.includes('quality_profile'), true);
    assertEquals(titles.length >= 1, true);
    assertEquals(
      titles.some((title) => title.includes('quality profile')),
      true
    );

    assertEquals(result.success, true);
    assertEquals(typeof result.filepath, 'string');
    assertEquals(result.filepath?.startsWith('pcd_ops:'), true);
  } finally {
    while (restores.length > 0) restores.pop()?.();
    await fixture.destroy();
  }
});
