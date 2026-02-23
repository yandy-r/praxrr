import { assertEquals, assertMatch } from '@std/assert';
import { BaseTest, type TestContext } from '../../base/BaseTest.ts';
import type { PCDCache } from '$pcd/database/cache.ts';
import { deleteCache, getCache } from '$pcd/database/registry.ts';
import { compile } from '$pcd/database/compiler.ts';
import { writeOperationsFromSql } from '$pcd/ops/writer.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { type PcdOp, type PcdOpSource, pcdOpsQueries, type PcdOpState } from '$db/queries/pcdOps.ts';
import { pcdOpHistoryQueries } from '$db/queries/pcdOpHistory.ts';
import type { OperationMetadata } from '$pcd/core/types.ts';

interface DelayProfileRow {
  id: number;
  name: string;
  preferred_protocol: string;
  usenet_delay: number | null;
  torrent_delay: number | null;
  bypass_if_highest_quality: number;
  bypass_if_above_custom_format_score: number;
  minimum_custom_format_score: number | null;
}

interface DelayProfileFixture {
  sql: string;
  metadata: OperationMetadata;
  desiredState: Record<string, unknown>;
}

interface HistoryCapture {
  opId: number;
  status: string;
  rowcount: number | null;
  conflictReason: string | null;
}

class CacheParityTest extends BaseTest {
  private static readonly DATABASE_ID = 9112;
  private pcdPath = '';
  private operationStore: PcdOp[] = [];
  private nextOperationId = 1;
  private historyRows: HistoryCapture[] = [];

  private baseProfileOperations: DelayProfileFixture[] = [
    {
      sql: `INSERT INTO delay_profiles (
        name, preferred_protocol, usenet_delay, torrent_delay,
        bypass_if_highest_quality, bypass_if_above_custom_format_score, minimum_custom_format_score
      ) VALUES (
        'Migration-Profile', 'both', 120, 240, 1, 0, 900
      )`,
      metadata: {
        operation: 'create',
        entity: 'delay_profile',
        name: 'Migration-Profile',
        stableKey: {
          key: 'delay_profile_name',
          value: 'Migration-Profile',
        },
        summary: 'Create migration profile',
        title: 'Create migration profile',
      },
      desiredState: {
        name: 'Migration-Profile',
        preferred_protocol: 'both',
        usenet_delay: 120,
        torrent_delay: 240,
        bypass_if_highest_quality: true,
        bypass_if_above_custom_format_score: false,
        minimum_custom_format_score: 900,
      },
    },
    {
      sql: "UPDATE delay_profiles SET usenet_delay = 180, bypass_if_highest_quality = 0 WHERE name = 'Migration-Profile'",
      metadata: {
        operation: 'update',
        entity: 'delay_profile',
        name: 'Migration-Profile',
        stableKey: {
          key: 'delay_profile_name',
          value: 'Migration-Profile',
        },
      },
      desiredState: {
        name: 'Migration-Profile',
        preferred_protocol: 'both',
        usenet_delay: 180,
        torrent_delay: 240,
        bypass_if_highest_quality: false,
        bypass_if_above_custom_format_score: false,
        minimum_custom_format_score: 900,
      },
    },
  ];

  private mismatchOperation: DelayProfileFixture = {
    sql: "UPDATE delay_profiles SET usenet_delay = 999 WHERE name = 'Missing-Migration-Profile'",
    metadata: {
      operation: 'update',
      entity: 'delay_profile',
      name: 'Missing-Migration-Profile',
      stableKey: {
        key: 'delay_profile_name',
        value: 'Missing-Migration-Profile',
      },
    },
    desiredState: {
      name: 'Missing-Migration-Profile',
      preferred_protocol: 'both',
      usenet_delay: 999,
    },
  };

  private installSchema(): Promise<void> {
    return Deno.mkdir(`${this.pcdPath}/deps/schema/ops`, { recursive: true }).then(() =>
      Deno.writeTextFile(
        `${this.pcdPath}/deps/schema/ops/0.schema.sql`,
        `
CREATE TABLE IF NOT EXISTS delay_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  preferred_protocol TEXT NOT NULL,
  usenet_delay INTEGER,
  torrent_delay INTEGER,
  bypass_if_highest_quality INTEGER NOT NULL DEFAULT 0,
  bypass_if_above_custom_format_score INTEGER NOT NULL DEFAULT 0,
  minimum_custom_format_score INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`.trim()
      )
    );
  }

  private installDatabaseInstancePatch(): void {
    this.installPatch(databaseInstancesQueries, 'getById', (id: number) => {
      if (id !== CacheParityTest.DATABASE_ID) {
        return undefined;
      }

      return {
        id,
        uuid: 'cache-parity-fixture',
        name: 'cache-parity-fixture',
        repository_url: 'file:///tmp/cache-parity-fixture',
        local_path: this.pcdPath,
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
      };
    });
  }

  private installHistoryPatch(): void {
    this.installPatch(pcdOpHistoryQueries, 'create', (input) => {
      this.historyRows.push({
        opId: input.opId,
        status: input.status,
        rowcount: input.rowcount ?? null,
        conflictReason: input.conflictReason ?? null,
      });
      return this.historyRows.length;
    });

    this.installPatch(pcdOpHistoryQueries, 'listLatestByDatabaseWithOps', () => []);
    this.installPatch(pcdOpHistoryQueries, 'listLatestConflictsByDatabase', () => []);
    this.installPatch(pcdOpHistoryQueries, 'listByDatabase', () => []);
    this.installPatch(pcdOpHistoryQueries, 'listByOp', () => []);
  }

  private installPcdOpsPatch(): void {
    this.operationStore = [];
    this.nextOperationId = 1;

    this.installPatch(pcdOpsQueries, 'create', (input) => {
      const now = new Date().toISOString();
      const operation: PcdOp = {
        id: this.nextOperationId++,
        database_id: input.databaseId,
        origin: input.origin,
        state: input.state,
        source: input.source,
        filename: input.filename ?? null,
        op_number: input.opNumber ?? null,
        sequence: input.sequence ?? null,
        sql: input.sql,
        metadata: input.metadata ?? null,
        desired_state: input.desiredState ?? null,
        content_hash: input.contentHash ?? null,
        last_seen_in_repo_at: input.lastSeenInRepoAt ?? null,
        superseded_by_op_id: input.supersededByOpId ?? null,
        pushed_at: input.pushedAt ?? null,
        pushed_commit: input.pushedCommit ?? null,
        created_at: now,
        updated_at: now,
      };
      this.operationStore.push(operation);
      return operation.id;
    });

    this.installPatch(pcdOpsQueries, 'listByDatabase', (databaseId) =>
      this.operationStore.filter((operation) => operation.database_id === databaseId).sort((a, b) => a.id - b.id)
    );

    this.installPatch(pcdOpsQueries, 'listByDatabaseAndOrigin', (databaseId, origin, options) => {
      const targetStates = options?.states as PcdOpState[] | undefined;
      const targetSource = options?.source as PcdOpSource | undefined;

      let rows = this.operationStore.filter(
        (operation) => operation.database_id === databaseId && operation.origin === origin
      );

      if (targetStates?.length) {
        rows = rows.filter((operation) => targetStates.includes(operation.state));
      }

      if (targetSource) {
        rows = rows.filter((operation) => operation.source === targetSource);
      }

      return rows.sort((a, b) => a.id - b.id);
    });

    this.installPatch(pcdOpsQueries, 'getById', (id) => this.operationStore.find((operation) => operation.id === id));

    this.installPatch(pcdOpsQueries, 'update', () => {
      return true;
    });
  }

  private seedLegacyOperations(source: PcdOpSource, fixtures: DelayProfileFixture[]): void {
    this.historyRows = [];
    for (const fixture of fixtures) {
      const now = new Date().toISOString();
      this.operationStore.push({
        id: this.nextOperationId++,
        database_id: CacheParityTest.DATABASE_ID,
        origin: 'user',
        state: 'published',
        source,
        filename: null,
        op_number: null,
        sequence: null,
        sql: fixture.sql,
        metadata: JSON.stringify(fixture.metadata),
        desired_state: JSON.stringify(fixture.desiredState),
        content_hash: null,
        last_seen_in_repo_at: null,
        superseded_by_op_id: null,
        pushed_at: null,
        pushed_commit: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  private snapshotDelayProfiles(cache: PCDCache): DelayProfileRow[] {
    const rows = cache.query<DelayProfileRow>(`
      SELECT
        id,
        name,
        preferred_protocol,
        usenet_delay,
        torrent_delay,
        bypass_if_highest_quality,
        bypass_if_above_custom_format_score,
        minimum_custom_format_score
      FROM delay_profiles
      ORDER BY id
    `);

    return rows.map((row) => ({
      ...row,
      bypass_if_highest_quality: Number(row.bypass_if_highest_quality),
      bypass_if_above_custom_format_score: Number(row.bypass_if_above_custom_format_score),
    }));
  }

  private async buildLegacySnapshot(): Promise<DelayProfileRow[]> {
    await compile(this.pcdPath, CacheParityTest.DATABASE_ID);

    const cache = getCache(CacheParityTest.DATABASE_ID);
    if (!cache) {
      throw new Error('compiled cache should exist after legacy compile');
    }

    return this.snapshotDelayProfiles(cache);
  }

  private buildHybridSnapshot(): DelayProfileRow[] {
    const cache = getCache(CacheParityTest.DATABASE_ID);
    if (!cache) {
      throw new Error('compiled cache should exist after writeOperationsFromSql');
    }

    return this.snapshotDelayProfiles(cache);
  }

  private async runLegacyReplay(
    fixtures: DelayProfileFixture[] = this.baseProfileOperations,
    source: PcdOpSource = 'repo'
  ): Promise<{ snapshot: DelayProfileRow[]; history: HistoryCapture[] }> {
    this.clearRuntimeState();
    this.historyRows = [];
    this.operationStore = [];
    this.nextOperationId = 1;
    this.seedLegacyOperations(source, fixtures);

    const snapshot = await this.buildLegacySnapshot();
    return {
      snapshot,
      history: [...this.historyRows],
    };
  }

  private async buildValidationCache(): Promise<void> {
    await compile(this.pcdPath, CacheParityTest.DATABASE_ID);
  }

  private clearRuntimeState(): void {
    const existing = getCache(CacheParityTest.DATABASE_ID);
    if (existing) {
      existing.close();
    }
    deleteCache(CacheParityTest.DATABASE_ID);
    this.historyRows = [];
    this.operationStore = [];
    this.nextOperationId = 1;
  }

  protected override beforeEach(context: TestContext): void {
    this.pcdPath = `${context.tempDir}/migration-cache-parity`;
    this.clearRuntimeState();
    this.installDatabaseInstancePatch();
    this.installPcdOpsPatch();
    this.installHistoryPatch();
  }

  protected override afterEach(): void {
    this.clearRuntimeState();
  }

  private async runHybridReplay(): Promise<{ snapshot: DelayProfileRow[]; history: HistoryCapture[] }> {
    this.clearRuntimeState();
    await this.buildValidationCache();

    const writeResult = await writeOperationsFromSql({
      databaseId: CacheParityTest.DATABASE_ID,
      layer: 'user',
      description: 'cache-parity-hybrid-replay',
      source: 'import',
      operations: this.baseProfileOperations.map((fixture) => ({
        sql: fixture.sql,
        metadata: fixture.metadata,
        desiredState: fixture.desiredState,
      })),
    });

    if (!writeResult.success) {
      throw new Error(writeResult.error);
    }

    const snapshot = this.buildHybridSnapshot();

    return {
      snapshot,
      history: [...this.historyRows],
    };
  }

  private async runHybridGuardMismatch(): Promise<string> {
    await this.buildValidationCache();

    const writeResult = await writeOperationsFromSql({
      databaseId: CacheParityTest.DATABASE_ID,
      layer: 'user',
      description: 'cache-parity-hybrid-mismatch',
      source: 'import',
      operations: [
        {
          sql: this.mismatchOperation.sql,
          metadata: this.mismatchOperation.metadata,
          desiredState: this.mismatchOperation.desiredState,
        },
      ],
    });

    return writeResult.error ?? '';
  }

  runTests(): void {
    this.test('legacy SQL and hybrid input replay produce cache parity and matching history states', async () => {
      await this.installSchema();

      const legacy = await this.runLegacyReplay();
      const hybrid = await this.runHybridReplay();

      assertEquals(hybrid.snapshot, legacy.snapshot);
      assertEquals(
        legacy.history.map((entry) => entry.status),
        ['applied', 'applied']
      );
      assertEquals(
        hybrid.history.map((entry) => entry.status),
        ['applied', 'applied']
      );
    });

    this.test('guard mismatches fail deterministically in replay and history', async () => {
      await this.installSchema();
      const mismatchLegacy = await this.runLegacyReplay([this.mismatchOperation]);
      assertEquals(mismatchLegacy.snapshot, []);

      assertEquals(mismatchLegacy.history.length, 1);
      assertEquals(mismatchLegacy.history[0].status, 'conflicted');
      assertEquals(mismatchLegacy.history[0].conflictReason, 'guard_mismatch');

      this.clearRuntimeState();
      const beforeWriteHistoryCount = this.historyRows.length;

      const writeMismatchError = await this.runHybridGuardMismatch();
      assertMatch(writeMismatchError, /guard_mismatch/i);
      assertEquals(this.historyRows.length, beforeWriteHistoryCount);
    });
  }

  override run(): Promise<void> {
    this.runTests();
    return Promise.resolve();
  }
}

const test = new CacheParityTest();
await test.run();
