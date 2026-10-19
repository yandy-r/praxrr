import { assertEquals, assertExists, assertThrows } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { arrSyncQueries, InvalidProfileSelectionError, type ProfileSelection } from '$db/queries/arrSync.ts';

const DB_A = 1;
const DB_B = 2;
const MISSING_DB = 999;

type QualityProfilesConfigRow = {
  trigger: string;
  cron: string | null;
};

function bootstrapSchema(): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE arr_instances (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL
    );

    CREATE TABLE database_instances (
      id INTEGER PRIMARY KEY
    );

    CREATE TABLE arr_sync_quality_profiles (
      instance_id INTEGER NOT NULL,
      database_id INTEGER NOT NULL,
      profile_name TEXT NOT NULL,
      PRIMARY KEY (instance_id, database_id, profile_name),
      FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE,
      FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE
    );

    CREATE TABLE arr_sync_quality_profiles_config (
      instance_id INTEGER PRIMARY KEY,
      trigger TEXT NOT NULL DEFAULT 'manual',
      cron TEXT,
      next_run_at TEXT,
      should_sync INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE arr_sync_delay_profiles_config (
      instance_id INTEGER PRIMARY KEY,
      trigger TEXT NOT NULL DEFAULT 'manual',
      cron TEXT,
      next_run_at TEXT,
      database_id INTEGER REFERENCES database_instances(id) ON DELETE SET NULL,
      profile_name TEXT,
      should_sync INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      last_synced_at TEXT
    );

    INSERT INTO database_instances (id) VALUES (${DB_A}), (${DB_B});
  `);
}

function insertInstance(id: number): void {
  db.execute('INSERT INTO arr_instances (id, type) VALUES (?, ?)', id, 'radarr');
}

function getSelections(instanceId: number): ProfileSelection[] {
  return [...arrSyncQueries.getQualityProfilesSync(instanceId).selections].sort((a, b) =>
    a.databaseId !== b.databaseId ? a.databaseId - b.databaseId : a.profileName.localeCompare(b.profileName)
  );
}

function getConfigRow(instanceId: number): QualityProfilesConfigRow {
  const row = db.queryFirst<QualityProfilesConfigRow>(
    'SELECT trigger, cron FROM arr_sync_quality_profiles_config WHERE instance_id = ?',
    instanceId
  );
  assertExists(row);
  return row;
}

Deno.test({
  name: 'arrSync selection writes stay database-scoped and atomic',
  sanitizeResources: false,
  fn: async (t) => {
    const originalBasePath = config.paths.base;
    const tempBasePath = `/tmp/praxrr-tests/arr-sync-selection-integrity-${crypto.randomUUID()}`;

    await Deno.mkdir(tempBasePath, { recursive: true });

    db.close();
    config.setBasePath(tempBasePath);

    try {
      await db.initialize();
      bootstrapSchema();

      await t.step('quality profile rename only rewrites selections of the owning database', () => {
        insertInstance(1);
        insertInstance(2);
        arrSyncQueries.saveQualityProfilesSync(
          1,
          [
            { databaseId: DB_A, profileName: 'HD' },
            { databaseId: DB_B, profileName: 'HD' },
          ],
          { trigger: 'manual', cron: null }
        );
        arrSyncQueries.saveQualityProfilesSync(2, [{ databaseId: DB_B, profileName: 'HD' }], {
          trigger: 'manual',
          cron: null,
        });

        arrSyncQueries.updateQualityProfileName(DB_A, 'HD', 'HD Bluray');

        assertEquals(getSelections(1), [
          { databaseId: DB_A, profileName: 'HD Bluray' },
          { databaseId: DB_B, profileName: 'HD' },
        ]);
        assertEquals(getSelections(2), [{ databaseId: DB_B, profileName: 'HD' }]);
      });

      await t.step('quality profile rename merges into an existing selection of the new name', () => {
        insertInstance(3);
        arrSyncQueries.saveQualityProfilesSync(
          3,
          [
            { databaseId: DB_A, profileName: 'Old' },
            { databaseId: DB_A, profileName: 'New' },
          ],
          { trigger: 'manual', cron: null }
        );

        arrSyncQueries.updateQualityProfileName(DB_A, 'Old', 'New');

        assertEquals(getSelections(3), [{ databaseId: DB_A, profileName: 'New' }]);
      });

      await t.step('delay profile rename only rewrites the owning database selection', () => {
        insertInstance(4);
        insertInstance(5);
        db.execute(
          'INSERT INTO arr_sync_delay_profiles_config (instance_id, database_id, profile_name) VALUES (?, ?, ?), (?, ?, ?)',
          4,
          DB_A,
          'Standard',
          5,
          DB_B,
          'Standard'
        );

        arrSyncQueries.updateDelayProfileName(DB_A, 'Standard', 'Standard v2');

        assertEquals(arrSyncQueries.getDelayProfilesSync(4).databaseId, DB_A);
        assertEquals(arrSyncQueries.getDelayProfilesSync(4).profileName, 'Standard v2');
        assertEquals(arrSyncQueries.getDelayProfilesSync(5).databaseId, DB_B);
        assertEquals(arrSyncQueries.getDelayProfilesSync(5).profileName, 'Standard');
      });

      await t.step('failed save keeps previous selections and config intact', () => {
        insertInstance(6);
        arrSyncQueries.saveQualityProfilesSync(6, [{ databaseId: DB_A, profileName: 'Keep' }], {
          trigger: 'schedule',
          cron: '0 * * * *',
        });

        assertThrows(() =>
          arrSyncQueries.saveQualityProfilesSync(
            6,
            [
              { databaseId: DB_B, profileName: 'Fine' },
              { databaseId: MISSING_DB, profileName: 'Orphan' },
            ],
            { trigger: 'manual', cron: null }
          )
        );

        assertEquals(getSelections(6), [{ databaseId: DB_A, profileName: 'Keep' }]);
        assertEquals(getConfigRow(6), { trigger: 'schedule', cron: '0 * * * *' });
      });

      await t.step('duplicate selections are persisted once', () => {
        insertInstance(7);
        arrSyncQueries.saveQualityProfilesSync(
          7,
          [
            { databaseId: DB_A, profileName: 'Dup' },
            { databaseId: DB_A, profileName: 'Dup' },
            { databaseId: DB_B, profileName: 'Dup' },
          ],
          { trigger: 'manual', cron: null }
        );

        assertEquals(getSelections(7), [
          { databaseId: DB_A, profileName: 'Dup' },
          { databaseId: DB_B, profileName: 'Dup' },
        ]);
      });

      await t.step('invalid selections are rejected before any write', () => {
        insertInstance(8);
        arrSyncQueries.saveQualityProfilesSync(8, [{ databaseId: DB_A, profileName: ' Spaced ' }], {
          trigger: 'manual',
          cron: null,
        });

        const invalidPayloads: unknown[][] = [
          [{ databaseId: DB_A, profileName: '   ' }],
          [{ databaseId: 1.5, profileName: 'X' }],
          [{ databaseId: '1', profileName: 'X' }],
          [{ databaseId: 0, profileName: 'X' }],
          [null],
        ];

        for (const payload of invalidPayloads) {
          assertThrows(
            () => arrSyncQueries.saveQualityProfilesSync(8, payload, { trigger: 'schedule', cron: '5 * * * *' }),
            InvalidProfileSelectionError
          );
        }

        // Exact untrimmed name persisted by the earlier valid save; config never touched by rejects.
        assertEquals(getSelections(8), [{ databaseId: DB_A, profileName: ' Spaced ' }]);
        assertEquals(getConfigRow(8), { trigger: 'manual', cron: null });
      });
    } finally {
      db.close();
      config.setBasePath(originalBasePath);
      await Deno.remove(tempBasePath, { recursive: true }).catch(() => undefined);
    }
  },
});
