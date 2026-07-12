import { assert, assertEquals, assertExists, assertRejects, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { runMigrations } from '$db/migrations.ts';
import { pluginRegistryQueries } from '$db/queries/pluginRegistry.ts';
import type { PluginManifest } from '$shared/plugins/index.ts';

/** Run each assertion against a fresh database after the complete registered migration chain. */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/plugin-registry-${crypto.randomUUID()}`;
      await Deno.mkdir(tempBasePath, { recursive: true });

      db.close();
      config.setBasePath(tempBasePath);

      try {
        await db.initialize();
        await runMigrations();
        await fn();
      } finally {
        db.close();
        config.setBasePath(originalBasePath);
        await Deno.remove(tempBasePath, { recursive: true }).catch(() => {});
      }
    },
  });
}

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    apiVersion: '1',
    id: 'com.acme.plugin',
    name: 'Acme Plugin',
    version: '1.0.0',
    runtime: 'wasm',
    entry: 'plugin.wasm',
    extensionPoints: ['config.profileCompiled.observe'],
    capabilities: ['read:resolved-profile'],
    ...overrides,
  };
}

migratedTest('migration 20260724 is ordered and creates the namespace-qualified registry identity', () => {
  const applied = db.query<{ version: number; name: string }>(
    'SELECT version, name FROM migrations WHERE version IN (?, ?) ORDER BY version',
    20260723,
    20260724
  );
  assertEquals(applied, [
    { version: 20260723, name: 'Add canary preview evidence' },
    { version: 20260724, name: 'Create plugin registry' },
  ]);

  const columns = db.query<{ name: string; notnull: number; dflt_value: string | null }>(
    'PRAGMA table_info(plugin_registry)'
  );
  assertEquals(
    columns.map((column) => column.name),
    [
      'api_version',
      'plugin_id',
      'manifest_json',
      'enabled',
      'discovered',
      'lifecycle_state',
      'last_error',
      'registered_at',
      'created_at',
      'updated_at',
    ]
  );
  assertEquals(columns.find((column) => column.name === 'enabled')?.dflt_value, '1');
  assertEquals(columns.find((column) => column.name === 'discovered')?.dflt_value, '1');

  const identityIndex = db.queryFirst<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_plugin_registry_identity'"
  );
  assertExists(identityIndex);
  assert(identityIndex.sql.includes('api_version, plugin_id COLLATE NOCASE'));
});

migratedTest('first discovery defaults enabled and preserves exact validated manifest fields', async () => {
  const manifest = makeManifest({ id: 'com.acme.exact-name', name: '  Exact Display Name  ' });

  const rows = await pluginRegistryQueries.reconcile([{ manifest }]);

  assertEquals(rows.length, 1);
  assertEquals(rows[0].apiVersion, '1');
  assertEquals(rows[0].pluginId, 'com.acme.exact-name');
  assertEquals(rows[0].manifest.id, 'com.acme.exact-name');
  assertEquals(rows[0].manifest.name, '  Exact Display Name  ');
  assertEquals(rows[0].enabled, true);
  assertEquals(rows[0].discovered, true);
  assertEquals(rows[0].state, 'registered');
  assertEquals(rows[0].lastError, null);
  assert(rows[0].registeredAt.length > 0);
});

migratedTest('enable and disable decisions survive reconciliation and database restart', async () => {
  const manifest = makeManifest({ id: 'com.acme.toggle' });
  await pluginRegistryQueries.reconcile([{ manifest }]);

  assertEquals(pluginRegistryQueries.setEnabled('1', 'COM.ACME.TOGGLE', false)?.enabled, false);
  assertEquals((await pluginRegistryQueries.reconcile([{ manifest }]))[0].enabled, false);
  assertEquals(pluginRegistryQueries.setEnabled('1', 'com.acme.toggle', true)?.enabled, true);

  db.close();
  await db.initialize();

  const restarted = pluginRegistryQueries.get('1', 'COM.ACME.TOGGLE');
  assertExists(restarted);
  assertEquals(restarted.enabled, true);
  assertEquals((await pluginRegistryQueries.reconcile([{ manifest }]))[0].enabled, true);
});

migratedTest('missing and reappearing plugins retain their enablement decision', async () => {
  const manifest = makeManifest({ id: 'com.acme.reappears' });
  await pluginRegistryQueries.reconcile([{ manifest }]);
  pluginRegistryQueries.setEnabled('1', manifest.id, false);

  const missing = await pluginRegistryQueries.reconcile([]);
  assertEquals(missing.length, 1);
  assertEquals(missing[0].enabled, false);
  assertEquals(missing[0].discovered, false);
  assertEquals(missing[0].state, 'unloaded');

  const reappeared = await pluginRegistryQueries.reconcile([{ manifest }]);
  assertEquals(reappeared.length, 1);
  assertEquals(reappeared[0].enabled, false);
  assertEquals(reappeared[0].discovered, true);
  assertEquals(reappeared[0].state, 'registered');
});

migratedTest('manifest changes preserve enablement and exact replacement values', async () => {
  const original = makeManifest({ id: 'com.acme.updated', name: 'Original', version: '1.0.0' });
  await pluginRegistryQueries.reconcile([{ manifest: original }]);
  pluginRegistryQueries.setEnabled('1', original.id, false);

  const changed = makeManifest({
    id: original.id,
    name: '  Updated Without Trimming  ',
    version: '2.0.0',
    extensionPoints: ['sync.previewComputed.observe'],
    capabilities: ['read:sync-preview'],
  });
  const [record] = await pluginRegistryQueries.reconcile([{ manifest: changed }]);

  assertEquals(record.enabled, false);
  assertEquals(record.manifest.name, '  Updated Without Trimming  ');
  assertEquals(record.manifest.version, '2.0.0');
  assertEquals(record.manifest.extensionPoints, ['sync.previewComputed.observe']);
});

migratedTest('identity lookup is case-insensitive but never falls back across API versions', async () => {
  const manifest = makeManifest({ id: 'com.acme.identity' });
  await pluginRegistryQueries.reconcile([{ manifest }]);

  assertEquals(pluginRegistryQueries.get('1', 'COM.ACME.IDENTITY')?.pluginId, 'com.acme.identity');
  assertEquals(pluginRegistryQueries.get('2', 'com.acme.identity'), undefined);

  db.execute(
    `INSERT INTO plugin_registry (api_version, plugin_id, manifest_json)
     VALUES (?, ?, ?)`,
    '2',
    manifest.id,
    JSON.stringify({ ...manifest, apiVersion: '2' })
  );
  assertEquals(
    db.query<{ api_version: string }>(
      'SELECT api_version FROM plugin_registry WHERE plugin_id = ? COLLATE NOCASE ORDER BY api_version',
      manifest.id
    ),
    [{ api_version: '1' }, { api_version: '2' }]
  );
  assertThrows(() =>
    db.execute(
      `INSERT INTO plugin_registry (api_version, plugin_id, manifest_json)
       VALUES (?, ?, ?)`,
      '1',
      'COM.ACME.IDENTITY',
      JSON.stringify(manifest)
    )
  );
});

migratedTest('duplicate reconciliation rejects before changing the previous durable snapshot', async () => {
  const current = makeManifest({ id: 'com.acme.current' });
  await pluginRegistryQueries.reconcile([{ manifest: current }]);

  await assertRejects(
    () =>
      pluginRegistryQueries.reconcile([
        { manifest: makeManifest({ id: 'com.acme.duplicate' }) },
        { manifest: makeManifest({ id: 'com.acme.duplicate' }) },
      ]),
    Error,
    'Duplicate plugin id'
  );

  assertEquals(
    pluginRegistryQueries.list().map((row) => row.pluginId),
    ['com.acme.current']
  );
  assertEquals(pluginRegistryQueries.get('1', current.id)?.discovered, true);
});

migratedTest('malformed persisted manifest JSON is rejected at the repository boundary', () => {
  db.execute(
    `INSERT INTO plugin_registry (api_version, plugin_id, manifest_json)
     VALUES (?, ?, ?)`,
    '1',
    'com.acme.malformed',
    '{not-json'
  );

  assertThrows(
    () => pluginRegistryQueries.get('1', 'com.acme.malformed'),
    Error,
    "Persisted manifest for plugin 'com.acme.malformed' is not valid JSON"
  );
});

migratedTest('persisted manifest identity mismatch is rejected at the repository boundary', () => {
  const manifest = makeManifest({ id: 'com.acme.manifest-id' });
  db.execute(
    `INSERT INTO plugin_registry (api_version, plugin_id, manifest_json)
     VALUES (?, ?, ?)`,
    '1',
    'com.acme.row-id',
    JSON.stringify(manifest)
  );

  assertThrows(
    () => pluginRegistryQueries.get('1', 'com.acme.row-id'),
    Error,
    "Persisted manifest identity does not match plugin registry row 'com.acme.row-id'"
  );
});
