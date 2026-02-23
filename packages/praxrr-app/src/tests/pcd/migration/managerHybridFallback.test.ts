import { assertEquals, assertRejects } from '@std/assert';
import { pcdManager } from '$pcd/core/manager.ts';
import { pcdOpsQueries } from '$db/queries/pcdOps.ts';
import { MigrationReaderError } from '$pcd/ops/importBaseOps.ts';
import { config } from '$config';

import type { PcdOp } from '$db/queries/pcdOps.ts';

Deno.test('pcdManager: hybrid base-op parse failures fall back to sql-only import', async () => {
  const restores: Array<() => void> = [];
  const tempPath = `/tmp/praxrr-tests/pcd-hybrid-fallback-${crypto.randomUUID()}`;
  const databaseId = 9010;
  const importedFilenames: string[] = [];
  const createdOps: PcdOp[] = [];

  function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;
    restores.push(() => {
      target[key] = original;
    });
  }

  function restoreAll(): void {
    while (restores.length > 0) {
      restores.pop()?.();
    }
  }

  try {
    await Deno.mkdir(`${tempPath}/ops`, { recursive: true });
    await Deno.mkdir(`${tempPath}/entities`, { recursive: true });
    await Deno.writeTextFile(
      `${tempPath}/ops/001-base.sql`,
      'CREATE TABLE IF NOT EXISTS fallback_guard (id INTEGER PRIMARY KEY);'
    );
    await Deno.writeTextFile(`${tempPath}/entities/unsupported.txt`, 'unsupported migration payload');

    patch(pcdOpsQueries, 'getBaseByFilename', () => undefined);
    patch(pcdOpsQueries, 'create', (input) => {
      const created = new Date().toISOString();
      const op: PcdOp = {
        id: createdOps.length + 1,
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
        created_at: created,
        updated_at: created,
      };

      createdOps.push(op);
      importedFilenames.push(input.filename ?? '');
      return op.id;
    });
    patch(pcdOpsQueries, 'update', () => true);
    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0);

    const configMutable = config as {
      pcdMigrationIngestionMode: 'sql-only' | 'hybrid';
      pcdMigrationAllowLegacyFallback: boolean;
    };

    patch(configMutable, 'pcdMigrationIngestionMode', 'hybrid');
    patch(configMutable, 'pcdMigrationAllowLegacyFallback', true);

    await (
      pcdManager as unknown as { importBaseOpsWithOrchestration: (id: number, path: string) => Promise<void> }
    ).importBaseOpsWithOrchestration(databaseId, tempPath);

    assertEquals(importedFilenames, ['001-base.sql']);
    assertEquals(createdOps.length, 1);
  } finally {
    restoreAll();
    await Deno.remove(tempPath, { recursive: true });
  }
});

Deno.test('pcdManager: sql-only mode imports base ops without migration fallback logic', async () => {
  const restores: Array<() => void> = [];
  const tempPath = `/tmp/praxrr-tests/pcd-sql-only-${crypto.randomUUID()}`;
  const databaseId = 9011;
  const importedFilenames: string[] = [];
  const createdOps: PcdOp[] = [];

  function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;
    restores.push(() => {
      target[key] = original;
    });
  }

  function restoreAll(): void {
    while (restores.length > 0) {
      restores.pop()?.();
    }
  }

  try {
    await Deno.mkdir(`${tempPath}/ops`, { recursive: true });
    await Deno.mkdir(`${tempPath}/entities`, { recursive: true });
    await Deno.writeTextFile(
      `${tempPath}/ops/001-base.sql`,
      'CREATE TABLE IF NOT EXISTS fallback_guard (id INTEGER PRIMARY KEY);'
    );
    await Deno.writeTextFile(`${tempPath}/entities/unsupported.txt`, 'unsupported migration payload');

    patch(pcdOpsQueries, 'getBaseByFilename', () => undefined);
    patch(pcdOpsQueries, 'create', (input) => {
      const created = new Date().toISOString();
      const op: PcdOp = {
        id: createdOps.length + 1,
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
        created_at: created,
        updated_at: created,
      };

      createdOps.push(op);
      importedFilenames.push(input.filename ?? '');
      return op.id;
    });
    patch(pcdOpsQueries, 'update', () => true);
    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0);

    const configMutable = config as {
      pcdMigrationIngestionMode: 'sql-only' | 'hybrid';
      pcdMigrationAllowLegacyFallback: boolean;
    };

    patch(configMutable, 'pcdMigrationIngestionMode', 'sql-only');
    patch(configMutable, 'pcdMigrationAllowLegacyFallback', false);

    await (
      pcdManager as unknown as { importBaseOpsWithOrchestration: (id: number, path: string) => Promise<void> }
    ).importBaseOpsWithOrchestration(databaseId, tempPath);

    assertEquals(importedFilenames, ['001-base.sql']);
    assertEquals(createdOps.length, 1);
  } finally {
    restoreAll();
    await Deno.remove(tempPath, { recursive: true });
  }
});

Deno.test('pcdManager: hybrid mode with legacy fallback disabled rethrows migration parse errors', async () => {
  const restores: Array<() => void> = [];
  const tempPath = `/tmp/praxrr-tests/pcd-hybrid-no-fallback-${crypto.randomUUID()}`;
  const databaseId = 9012;
  const createdOps: PcdOp[] = [];

  function patch<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
    const original = target[key];
    target[key] = replacement;
    restores.push(() => {
      target[key] = original;
    });
  }

  function restoreAll(): void {
    while (restores.length > 0) {
      restores.pop()?.();
    }
  }

  try {
    await Deno.mkdir(`${tempPath}/ops`, { recursive: true });
    await Deno.mkdir(`${tempPath}/entities`, { recursive: true });
    await Deno.writeTextFile(
      `${tempPath}/ops/001-base.sql`,
      'CREATE TABLE IF NOT EXISTS fallback_guard (id INTEGER PRIMARY KEY);'
    );
    await Deno.writeTextFile(`${tempPath}/entities/unsupported.txt`, 'unsupported migration payload');

    patch(pcdOpsQueries, 'getBaseByFilename', () => undefined);
    patch(pcdOpsQueries, 'create', (input) => {
      const created = new Date().toISOString();
      const op: PcdOp = {
        id: createdOps.length + 1,
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
        created_at: created,
        updated_at: created,
      };

      createdOps.push(op);
      return op.id;
    });
    patch(pcdOpsQueries, 'update', () => true);
    patch(pcdOpsQueries, 'markBaseOrphaned', () => 0);

    const configMutable = config as {
      pcdMigrationIngestionMode: 'sql-only' | 'hybrid';
      pcdMigrationAllowLegacyFallback: boolean;
    };

    patch(configMutable, 'pcdMigrationIngestionMode', 'hybrid');
    patch(configMutable, 'pcdMigrationAllowLegacyFallback', false);

    await assertRejects(
      () =>
        (
          pcdManager as unknown as { importBaseOpsWithOrchestration: (id: number, path: string) => Promise<void> }
        ).importBaseOpsWithOrchestration(databaseId, tempPath),
      MigrationReaderError,
      'Failed to read migration entity sources'
    );
    assertEquals(createdOps.length, 0);
  } finally {
    restoreAll();
    await Deno.remove(tempPath, { recursive: true });
  }
});
