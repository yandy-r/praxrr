// YAN-744 regression: exportDraftOps must regenerate canonical entities/*.yaml in the
// export clone, so a fresh import of the repo reproduces the exported change. Exercises
// the REAL exporter end-to-end (preflight, real git remote, clone, push, pull, compile)
// plus a real importBaseOps round-trip into a fresh database.

import { assert, assertEquals } from '@std/assert';
import { db } from '$db/db.ts';
import { databaseInstancesQueries } from '$db/queries/databaseInstances.ts';
import { databaseInstanceCredentialsQueries } from '$db/queries/databaseInstanceCredentials.ts';
import { pcdOpsQueries, type PcdOp } from '$db/queries/pcdOps.ts';
import { config } from '$utils/config/config.ts';
import { encryptDatabasePersonalAccessToken } from '$utils/encryption/database-credentials.ts';
import { __resetArrCredentialKeyRingForTest } from '$utils/encryption/keys.ts';
import { exportDraftOps } from '$pcd/ops/exporter.ts';
import { importBaseOps } from '$pcd/ops/importBaseOps.ts';
import { getCache, deleteCache } from '$pcd/database/registry.ts';
import { migratedTest } from '../snapshots/rollbackTestHelpers.ts';

const SCHEMA_SQL = Deno.readTextFileSync(new URL('../../../../../praxrr-schema/ops/0.schema.sql', import.meta.url));

const MANIFEST = JSON.stringify(
  {
    name: 'Export YAML Test DB',
    version: '1.0.0',
    description: 'Round-trip fixture',
    dependencies: {
      'https://github.com/yandy-r/praxrr-schema': '1.0.0',
    },
    praxrr: {
      minimum_version: '2.1.0',
    },
  },
  null,
  2
);

async function git(args: string[], cwd?: string): Promise<string> {
  const command = new Deno.Command('git', {
    args,
    cwd,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
    env: {
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
    },
  });
  const { code, stdout, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(new TextDecoder().decode(stderr));
  }
  return new TextDecoder().decode(stdout).trim();
}

const TEST_MASTER_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const TEST_MASTER_KEY_VERSION = 'v-export-yaml-test';

// Seeds an encrypted database PAT credential so export preflight (canWriteToBase) passes
// without tripping the plaintext-PAT schema trigger. The local bare remote never uses the token.
async function seedDatabasePat(databaseId: number): Promise<void> {
  const mutableConfig = config as unknown as {
    arrCredentialMasterKey: string | null;
    arrCredentialMasterKeyVersion: string | null;
  };
  mutableConfig.arrCredentialMasterKey = TEST_MASTER_KEY;
  mutableConfig.arrCredentialMasterKeyVersion = TEST_MASTER_KEY_VERSION;
  __resetArrCredentialKeyRingForTest();

  const { credential } = await encryptDatabasePersonalAccessToken('test-token');
  databaseInstanceCredentialsQueries.upsert({
    instanceId: databaseId,
    ciphertext: credential.ciphertext,
    nonce: credential.nonce,
    keyVersion: credential.keyVersion,
  });
}

/** Return metadata.export_batch === true. */
function isExportBatchOp(op: PcdOp): boolean {
  if (!op.metadata) return false;
  try {
    const parsed = JSON.parse(op.metadata) as { operation?: string; entity?: string; export_batch?: unknown };
    return parsed.operation === 'export' && parsed.entity === 'batch' && parsed.export_batch === true;
  } catch {
    return false;
  }
}

migratedTest('exportDraftOps: regenerates entity YAML so a fresh import sees the change', async () => {
  const root = `/tmp/praxrr-tests/export-yaml-${crypto.randomUUID()}`;
  const remote = `${root}/remote.git`;
  const localPath = `${root}/local`;
  const freshPath = `${root}/fresh`;
  let databaseId = 0;
  let freshId = 0;

  try {
    await Deno.mkdir(remote, { recursive: true });
    await git(['init', '--bare', '--initial-branch=main'], remote);
    await git(['clone', remote, localPath], root);
    await git(['config', 'user.name', 'Praxrr Test'], localPath);
    await git(['config', 'user.email', 'praxrr@example.invalid'], localPath);

    await Deno.mkdir(`${localPath}/deps/schema/ops`, { recursive: true });
    await Deno.writeTextFile(`${localPath}/deps/schema/ops/0.schema.sql`, SCHEMA_SQL);
    await Deno.writeTextFile(`${localPath}/pcd.json`, MANIFEST);
    await Deno.mkdir(`${localPath}/entities/custom-formats`, { recursive: true });
    await Deno.writeTextFile(`${localPath}/entities/custom-formats/test-format.yaml`, 'name: Test Format\n');
    await git(['add', '-A'], localPath);
    await git(['commit', '-m', 'seed'], localPath);
    await git(['push', 'origin', 'HEAD:main'], localPath);

    databaseId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: `export-yaml-${crypto.randomUUID()}`,
      repositoryUrl: remote,
      localPath,
    });
    // Preflight: encrypted credential envelope satisfies canWriteToBase (local bare remote needs no token).
    await seedDatabasePat(databaseId);
    db.execute(
      `UPDATE database_instances
			SET git_user_name = 'Praxrr Test', git_user_email = 'praxrr@example.invalid', enabled = 1
			WHERE id = ?`,
      databaseId
    );

    pcdOpsQueries.create({
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'repo',
      sql: "INSERT INTO custom_formats (name, description, include_in_rename) VALUES ('Test Format', 'base desc', 0);",
      metadata: JSON.stringify({ operation: 'create', entity: 'custom_format', name: 'Test Format' }),
      sequence: 1,
    });
    const draftOpId = pcdOpsQueries.create({
      databaseId,
      origin: 'base',
      state: 'draft',
      source: 'local',
      sql: "UPDATE custom_formats SET description = 'drafted new desc' WHERE name = 'Test Format';",
      metadata: JSON.stringify({ operation: 'update', entity: 'custom_format', name: 'Test Format' }),
      sequence: 2,
    });
    // Local tweak: published user op. Canonical YAML must never carry it.
    pcdOpsQueries.create({
      databaseId,
      origin: 'user',
      state: 'published',
      source: 'local',
      sql: "UPDATE custom_formats SET description = 'tweaked desc' WHERE name = 'Test Format';",
      metadata: JSON.stringify({ operation: 'update', entity: 'custom_format', name: 'Test Format' }),
      sequence: 3,
    });

    const result = await exportDraftOps(databaseId, [draftOpId], 'export: update test format');
    assertEquals(result.success, true);

    // The exported YAML in the pushed commit carries the drafted value, not the tweak.
    const remoteYaml = await git(['show', 'main:entities/custom-formats/test-format.yaml'], remote);
    assertEquals(remoteYaml.includes('drafted new desc'), true);
    assertEquals(remoteYaml.includes('tweaked desc'), false);

    // Local repo fast-forwarded to the export commit.
    const localYaml = await Deno.readTextFile(`${localPath}/entities/custom-formats/test-format.yaml`);
    assertEquals(localYaml.includes('drafted new desc'), true);

    // Batch bookkeeping: one published repo op flagged export_batch, draft superseded.
    const batchOps = pcdOpsQueries.listByDatabase(databaseId, 'base').filter(isExportBatchOp);
    assertEquals(batchOps.length, 1);
    assertEquals(batchOps[0].state, 'published');
    assertEquals(pcdOpsQueries.getById(draftOpId)?.state, 'superseded');

    // Fresh clone + fresh database import: the change must be present.
    await git(['clone', remote, freshPath], root);
    freshId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: `export-yaml-fresh-${crypto.randomUUID()}`,
      repositoryUrl: remote,
      localPath: freshPath,
    });
    db.execute(`UPDATE database_instances SET enabled = 1 WHERE id = ?`, freshId);

    await importBaseOps(freshId, freshPath);
    assertEquals(pcdOpsQueries.listByDatabase(freshId).length > 0, true);

    const cache = getCache(freshId);
    assert(cache, 'fresh import must leave a compiled registered cache');
    const row = await cache.kb
      .selectFrom('custom_formats')
      .select('description')
      .where('name', '=', 'Test Format')
      .executeTakeFirst();
    assertEquals(row?.description, 'drafted new desc');
  } finally {
    deleteCache(databaseId);
    deleteCache(freshId);
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

migratedTest('exportDraftOps: rename removes the old YAML file from the export commit', async () => {
  const root = `/tmp/praxrr-tests/export-yaml-rename-${crypto.randomUUID()}`;
  const remote = `${root}/remote.git`;
  const localPath = `${root}/local`;
  let databaseId = 0;

  try {
    await Deno.mkdir(remote, { recursive: true });
    await git(['init', '--bare', '--initial-branch=main'], remote);
    await git(['clone', remote, localPath], root);
    await git(['config', 'user.name', 'Praxrr Test'], localPath);
    await git(['config', 'user.email', 'praxrr@example.invalid'], localPath);

    await Deno.mkdir(`${localPath}/deps/schema/ops`, { recursive: true });
    await Deno.writeTextFile(`${localPath}/deps/schema/ops/0.schema.sql`, SCHEMA_SQL);
    await Deno.writeTextFile(`${localPath}/pcd.json`, MANIFEST);
    await Deno.mkdir(`${localPath}/entities/custom-formats`, { recursive: true });
    await Deno.writeTextFile(`${localPath}/entities/custom-formats/original-name.yaml`, 'name: Original Name\n');
    await git(['add', '-A'], localPath);
    await git(['commit', '-m', 'seed'], localPath);
    await git(['push', 'origin', 'HEAD:main'], localPath);

    databaseId = databaseInstancesQueries.create({
      uuid: crypto.randomUUID(),
      name: `export-yaml-rename-${crypto.randomUUID()}`,
      repositoryUrl: remote,
      localPath,
    });
    // Second block: same credential envelope.
    await seedDatabasePat(databaseId);
    db.execute(
      `UPDATE database_instances
			SET git_user_name = 'Praxrr Test', git_user_email = 'praxrr@example.invalid', enabled = 1
			WHERE id = ?`,
      databaseId
    );

    pcdOpsQueries.create({
      databaseId,
      origin: 'base',
      state: 'published',
      source: 'repo',
      sql: "INSERT INTO custom_formats (name, description, include_in_rename) VALUES ('Original Name', 'base desc', 0);",
      metadata: JSON.stringify({ operation: 'create', entity: 'custom_format', name: 'Original Name' }),
      sequence: 1,
    });
    const renameOpId = pcdOpsQueries.create({
      databaseId,
      origin: 'base',
      state: 'draft',
      source: 'local',
      sql: "UPDATE custom_formats SET name = 'Renamed Format' WHERE name = 'Original Name';",
      metadata: JSON.stringify({
        operation: 'update',
        entity: 'custom_format',
        name: 'Renamed Format',
        previousName: 'Original Name',
      }),
      sequence: 2,
    });

    const result = await exportDraftOps(databaseId, [renameOpId], 'export: rename format');
    assertEquals(result.success, true);

    const oldFile = await git(['cat-file', '-e', 'main:entities/custom-formats/original-name.yaml'], remote).then(
      () => true,
      () => false
    );
    assertEquals(oldFile, false, 'old YAML file must be deleted by the export');

    const newYaml = await git(['show', 'main:entities/custom-formats/renamed-format.yaml'], remote).then(
      (text) => text,
      () => null
    );
    assert(newYaml !== null, 'renamed YAML file must exist in the export commit');
    assertEquals(newYaml.includes('name: Renamed Format'), true);
  } finally {
    deleteCache(databaseId);
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
