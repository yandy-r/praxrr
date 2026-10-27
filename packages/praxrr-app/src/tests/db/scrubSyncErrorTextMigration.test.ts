import { assert, assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { migration as scrubSyncErrorTextMigration } from '$db/migrations/20261028_scrub_sync_error_text.ts';
import { loadMigrations, runMigrations } from '$db/migrations.ts';
import { GENERIC_SYNC_ERROR_TEXT } from '$sync/syncHistoryFailure.ts';

/**
 * Point the db singleton at a scratch SQLite file under a fresh temp base path, run the full
 * migration chain, invoke the test body, then tear the connection down. Mirrors
 * canaryMigration.test.ts.
 */
function migratedTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test({
    name,
    sanitizeResources: false,
    fn: async () => {
      const originalBasePath = config.paths.base;
      const tempBasePath = `/tmp/praxrr-tests/scrub-sync-error-text-${crypto.randomUUID()}`;
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

const ARR_URL = 'http://radarr:7878/api/v3/qualityprofile?apikey=SECRET123';
const RAW_HTTP_ERROR = 'HTTP 400: Bad Request | {"message":"apikey=SECRET123 at ' + ARR_URL + '"}';
const REJECTED_400 = 'The Arr instance rejected the request (HTTP 400).';
const SAFE_ERROR = 'The Arr instance timed out.';
const ORACLE = 'SECRET123';

const MALFORMED_SECTIONS = '[{"section":"qualityProfiles","error":"broken';
const NON_ARRAY_SECTIONS = '{"legacy":true}';
const SAFE_SECTIONS = '[{"section":"qualityProfiles","status":"success","itemsSynced":1,"error":null}]';
const UNSAFE_SECTIONS = JSON.stringify([
  { section: 'qualityProfiles', status: 'failed', itemsSynced: 0, error: RAW_HTTP_ERROR, errorCode: null },
  { section: 'mediaManagement', status: 'skipped', itemsSynced: 0, error: SAFE_ERROR },
  { section: 'delayProfiles', status: 'success', itemsSynced: 2, error: null },
]);

interface PkRow {
  pk: string;
  text: string | null;
}

function seedInstance(name: string): number {
  const existing = db.queryFirst<{ id: number }>('SELECT id FROM arr_instances WHERE name = ?', name);
  if (existing) return existing.id;
  db.execute(
    "INSERT INTO arr_instances (name, type, url, api_key) VALUES (?, ?, ?, '')",
    name,
    'radarr',
    'http://localhost:7878'
  );
  const row = db.queryFirst<{ id: number }>('SELECT id FROM arr_instances WHERE name = ?', name);
  assertExists(row);
  return row.id;
}

function seedHistory(): void {
  db.execute(
    `INSERT INTO sync_history
       (arr_instance_id, instance_name, arr_type, trigger, status, section_results, error, started_at)
     VALUES
       (NULL, 'unsafe', 'radarr', 'manual', 'failed', ?, ?, '2026-07-08T10:00:00.000Z'),
       (NULL, 'safe', 'radarr', 'manual', 'success', ?, ?, '2026-07-08T11:00:00.000Z'),
       (NULL, 'malformed', 'radarr', 'manual', 'failed', ?, ?, '2026-07-08T12:00:00.000Z'),
       (NULL, 'non-array', 'radarr', 'manual', 'failed', ?, ?, '2026-07-08T13:00:00.000Z'),
       (NULL, 'generic', 'radarr', 'manual', 'failed', '[]', ?, '2026-07-08T14:00:00.000Z')`,
    UNSAFE_SECTIONS,
    RAW_HTTP_ERROR,
    SAFE_SECTIONS,
    SAFE_ERROR,
    MALFORMED_SECTIONS,
    RAW_HTTP_ERROR,
    NON_ARRAY_SECTIONS,
    RAW_HTTP_ERROR,
    'fetch failed: ' + ARR_URL
  );
}

interface LastErrorTarget {
  table: string;
  key: Record<string, number>;
  unsafeValue: string;
}

function seedLastErrorTargets(instanceId: number): LastErrorTarget[] {
  const otherInstanceId = seedInstance('scrub-other');
  db.execute(
    'INSERT INTO trash_guide_sources (name, repository_url, local_path, arr_type) VALUES (?, ?, ?, ?)',
    'scrub-source',
    'https://example.com/trash.git',
    '/tmp/trash',
    'radarr'
  );
  const source = db.queryFirst<{ id: number }>("SELECT id FROM trash_guide_sources WHERE name = 'scrub-source'");
  assertExists(source);

  const targets: LastErrorTarget[] = [
    { table: 'arr_sync_quality_profiles_config', key: { instance_id: instanceId }, unsafeValue: RAW_HTTP_ERROR },
    {
      table: 'arr_sync_delay_profiles_config',
      key: { instance_id: instanceId },
      unsafeValue: 'fetch failed: ' + ARR_URL,
    },
    { table: 'arr_sync_media_management', key: { instance_id: instanceId }, unsafeValue: RAW_HTTP_ERROR },
    {
      table: 'arr_sync_metadata_profiles_config',
      key: { instance_id: instanceId },
      unsafeValue: 'fetch failed: ' + ARR_URL,
    },
    {
      table: 'trash_guide_sync_config',
      key: { instance_id: instanceId, source_id: source.id },
      unsafeValue: RAW_HTTP_ERROR,
    },
  ];

  for (const target of targets) {
    const columns = Object.keys(target.key);
    db.execute(
      `INSERT INTO ${target.table} (${columns.join(', ')}, last_error) VALUES (${columns.map(() => '?').join(', ')}, ?)`,
      ...Object.values(target.key),
      target.unsafeValue
    );
  }

  // Safe and null rows in every target table must keep their stored values.
  db.execute(
    'INSERT INTO arr_sync_quality_profiles_config (instance_id, last_error) VALUES (?, ?)',
    otherInstanceId,
    SAFE_ERROR
  );
  db.execute('INSERT INTO arr_sync_delay_profiles_config (instance_id, last_error) VALUES (?, NULL)', otherInstanceId);
  db.execute(
    'INSERT INTO arr_sync_media_management (instance_id, last_error) VALUES (?, ?)',
    otherInstanceId,
    SAFE_ERROR
  );
  db.execute(
    'INSERT INTO arr_sync_metadata_profiles_config (instance_id, last_error) VALUES (?, NULL)',
    otherInstanceId
  );
  db.execute(
    'INSERT INTO trash_guide_sync_config (instance_id, source_id, last_error) VALUES (?, ?, ?)',
    otherInstanceId,
    source.id,
    SAFE_ERROR
  );

  return targets;
}

function lastErrorRows(table: string): PkRow[] {
  const pkColumns: Record<string, string> = {
    arr_sync_quality_profiles_config: 'CAST(instance_id AS TEXT) AS pk, last_error AS text',
    arr_sync_delay_profiles_config: 'CAST(instance_id AS TEXT) AS pk, last_error AS text',
    arr_sync_media_management: 'CAST(instance_id AS TEXT) AS pk, last_error AS text',
    arr_sync_metadata_profiles_config: 'CAST(instance_id AS TEXT) AS pk, last_error AS text',
    trash_guide_sync_config: "instance_id || ':' || source_id AS pk, last_error AS text",
  };
  return db.query<PkRow>(`SELECT ${pkColumns[table]} FROM ${table} ORDER BY pk`);
}

function snapshotTargetedText(): { history: PkRow[]; tables: Record<string, PkRow[]> } {
  return {
    history: db.query<PkRow>(
      "SELECT CAST(id AS TEXT) AS pk, error || '\n' || section_results AS text FROM sync_history ORDER BY id"
    ),
    tables: Object.fromEntries(
      [
        'arr_sync_quality_profiles_config',
        'arr_sync_delay_profiles_config',
        'arr_sync_media_management',
        'arr_sync_metadata_profiles_config',
        'trash_guide_sync_config',
      ].map((table) => [table, lastErrorRows(table)])
    ),
  };
}

function totalChanges(): number {
  return db.queryFirst<{ n: number }>('SELECT total_changes() AS n')?.n ?? -1;
}

function assertOracleGone(): void {
  assert(!dumpTargetedText().includes(ORACLE), 'scrubbed rows must not retain the seeded secret oracle');
  const errorColumnCount =
    db.queryFirst<{ n: number }>("SELECT COUNT(*) AS n FROM sync_history WHERE error LIKE '%SECRET123%'")?.n ?? -1;
  assertEquals(errorColumnCount, 0, 'sync_history.error must not retain the seeded secret oracle');
}

function dumpTargetedText(): string {
  const parts: string[] = [];
  for (const row of db.query<{ error: string | null; section_results: string }>(
    'SELECT error, section_results FROM sync_history'
  )) {
    parts.push(row.error ?? '', row.section_results);
  }
  for (const table of [
    'arr_sync_quality_profiles_config',
    'arr_sync_delay_profiles_config',
    'arr_sync_media_management',
    'arr_sync_metadata_profiles_config',
    'trash_guide_sync_config',
  ]) {
    for (const row of db.query<{ last_error: string | null }>(`SELECT last_error FROM ${table}`)) {
      parts.push(row.last_error ?? '');
    }
  }
  return parts.join('\n');
}

migratedTest('migration 20261028 is registered immediately after 20261027', () => {
  const migrations = loadMigrations();
  const previousIndex = migrations.findIndex((candidate) => candidate.version === 20261027);
  const scrubIndex = migrations.findIndex((candidate) => candidate.version === 20261028);

  assert(previousIndex >= 0, 'migration 20261027 should be registered');
  assertEquals(scrubIndex, previousIndex + 1);
  assertEquals(scrubSyncErrorTextMigration.version, 20261028);
});

migratedTest('migration 20261028 scrubs every persisted sync error column and is idempotent', async () => {
  const instanceId = seedInstance('scrub-main');
  seedHistory();
  const targets = seedLastErrorTargets(instanceId);

  const scrub = scrubSyncErrorTextMigration.afterUp;
  assertExists(scrub);
  await scrub();

  // sync_history.error: raw HTTP detail maps to the closed reason; free-form URL detail
  // collapses to the generic text; already-safe text is unchanged.
  const history = db.query<{ instance_name: string; error: string | null; section_results: string }>(
    'SELECT instance_name, error, section_results FROM sync_history ORDER BY started_at'
  );
  assertEquals(history.length, 5);
  assertEquals(history[0]?.error, REJECTED_400);
  assertEquals(history[1]?.error, SAFE_ERROR);
  assertEquals(history[4]?.error, GENERIC_SYNC_ERROR_TEXT);

  // section_results[].error is sanitized per element; non-error fields survive.
  const firstSections = JSON.parse(history[0]?.section_results ?? 'null') as Array<Record<string, unknown>>;
  assertEquals(firstSections[0]?.error, REJECTED_400);
  assertEquals(firstSections[0]?.errorCode, 'rejected');
  assertEquals(firstSections[1]?.error, SAFE_ERROR);
  assertEquals(firstSections[1]?.errorCode, undefined);
  assertEquals(firstSections[2]?.error, null);
  assertEquals(history[1]?.section_results, SAFE_SECTIONS, 'safe section_results must keep their stored bytes');

  // Malformed and non-array JSON never crash the migration and stay untouched.
  assertEquals(history[2]?.section_results, MALFORMED_SECTIONS);
  assertEquals(history[2]?.error, REJECTED_400, 'a malformed section_results row still gets its error column scrubbed');
  assertEquals(history[3]?.section_results, NON_ARRAY_SECTIONS);
  assertEquals(history[3]?.error, REJECTED_400);

  // Every single-column target is scrubbed.
  for (const target of targets) {
    const where = Object.keys(target.key)
      .map((column) => `${column} = ?`)
      .join(' AND ');
    const row = db.queryFirst<{ last_error: string | null }>(
      `SELECT last_error FROM ${target.table} WHERE ${where}`,
      ...Object.values(target.key)
    );
    assertExists(row);
    const expected = target.unsafeValue.startsWith('HTTP 400:') ? REJECTED_400 : GENERIC_SYNC_ERROR_TEXT;
    assertEquals(row.last_error, expected, `${target.table}.last_error should be scrubbed`);
  }

  // Rows that were already safe (or null) are unchanged.
  const safeQuality = db.queryFirst<{ last_error: string | null }>(
    'SELECT last_error FROM arr_sync_quality_profiles_config WHERE instance_id != ?',
    instanceId
  );
  assertEquals(safeQuality?.last_error, SAFE_ERROR);
  const nullDelay = db.queryFirst<{ last_error: string | null }>(
    'SELECT last_error FROM arr_sync_delay_profiles_config WHERE instance_id != ?',
    instanceId
  );
  assertEquals(nullDelay?.last_error, null);

  assertOracleGone();

  // Repeating the scrub changes nothing.
  const before = snapshotTargetedText();
  const changesBefore = totalChanges();
  await scrub();
  assertEquals(totalChanges(), changesBefore, 'repeat scrub must not write any row');
  assertEquals(snapshotTargetedText(), before);
});
