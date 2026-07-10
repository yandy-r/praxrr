import { assertEquals, assertExists } from '@std/assert';
import { config } from '$config';
import { db } from '$db/db.ts';
import { arrSyncQueries, type ReviewedSyncClaim } from '$db/queries/arrSync.ts';
import type { SectionType } from '$sync/types.ts';

const SECTIONS: readonly SectionType[] = ['qualityProfiles', 'delayProfiles', 'mediaManagement', 'metadataProfiles'];

const TABLES: Record<SectionType, string> = {
  qualityProfiles: 'arr_sync_quality_profiles_config',
  delayProfiles: 'arr_sync_delay_profiles_config',
  mediaManagement: 'arr_sync_media_management',
  metadataProfiles: 'arr_sync_metadata_profiles_config',
};

interface StatusRow {
  sync_status: string;
  should_sync: number;
  last_error: string | null;
}

function bootstrapSchema(): void {
  db.exec(`
		CREATE TABLE arr_instances (
			id INTEGER PRIMARY KEY,
			type TEXT NOT NULL
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
			should_sync INTEGER NOT NULL DEFAULT 0,
			sync_status TEXT NOT NULL DEFAULT 'idle',
			last_error TEXT,
			last_synced_at TEXT
		);

		CREATE TABLE arr_sync_media_management (
			instance_id INTEGER PRIMARY KEY,
			trigger TEXT NOT NULL DEFAULT 'manual',
			cron TEXT,
			next_run_at TEXT,
			should_sync INTEGER NOT NULL DEFAULT 0,
			sync_status TEXT NOT NULL DEFAULT 'idle',
			last_error TEXT,
			last_synced_at TEXT
		);

		CREATE TABLE arr_sync_metadata_profiles_config (
			instance_id INTEGER PRIMARY KEY,
			trigger TEXT NOT NULL DEFAULT 'manual',
			cron TEXT,
			next_run_at TEXT,
			should_sync INTEGER NOT NULL DEFAULT 0,
			sync_status TEXT NOT NULL DEFAULT 'idle',
			last_error TEXT,
			last_synced_at TEXT
		);
	`);
}

function insertInstance(instanceId: number): void {
  db.execute("INSERT INTO arr_instances (id, type) VALUES (?, 'lidarr')", instanceId);
  for (const section of SECTIONS) {
    db.execute(
      `INSERT INTO ${TABLES[section]}
			 (instance_id, trigger, should_sync, sync_status)
			 VALUES (?, 'manual', 0, 'idle')`,
      instanceId
    );
  }
}

function getStatus(instanceId: number, section: SectionType): StatusRow {
  const row = db.queryFirst<StatusRow>(
    `SELECT sync_status, should_sync, last_error FROM ${TABLES[section]} WHERE instance_id = ?`,
    instanceId
  );
  assertExists(row);
  return row;
}

function setStatus(
  instanceId: number,
  section: SectionType,
  syncStatus: string,
  shouldSync = syncStatus === 'pending' ? 1 : 0
): void {
  db.execute(
    `UPDATE ${TABLES[section]}
		 SET sync_status = ?, should_sync = ?, last_error = NULL
		 WHERE instance_id = ?`,
    syncStatus,
    shouldSync,
    instanceId
  );
}

function setOrdinaryPending(instanceId: number, section: SectionType): void {
  switch (section) {
    case 'qualityProfiles':
      arrSyncQueries.setQualityProfilesStatusPending(instanceId);
      return;
    case 'delayProfiles':
      arrSyncQueries.setDelayProfilesStatusPending(instanceId);
      return;
    case 'mediaManagement':
      arrSyncQueries.setMediaManagementStatusPending(instanceId);
      return;
    case 'metadataProfiles':
      arrSyncQueries.setMetadataProfilesStatusPending(instanceId);
      return;
  }
}

function setOrdinaryShouldSync(instanceId: number, section: SectionType): void {
  switch (section) {
    case 'qualityProfiles':
      arrSyncQueries.setQualityProfilesShouldSync(instanceId, true);
      return;
    case 'delayProfiles':
      arrSyncQueries.setDelayProfilesShouldSync(instanceId, true);
      return;
    case 'mediaManagement':
      arrSyncQueries.setMediaManagementShouldSync(instanceId, true);
      return;
    case 'metadataProfiles':
      arrSyncQueries.setMetadataProfilesShouldSync(instanceId, true);
      return;
  }
}

function claimOrdinary(instanceId: number, section: SectionType): boolean {
  switch (section) {
    case 'qualityProfiles':
      return arrSyncQueries.claimQualityProfilesSync(instanceId);
    case 'delayProfiles':
      return arrSyncQueries.claimDelayProfilesSync(instanceId);
    case 'mediaManagement':
      return arrSyncQueries.claimMediaManagementSync(instanceId);
    case 'metadataProfiles':
      return arrSyncQueries.claimMetadataProfilesSync(instanceId);
  }
}

function completeOrdinary(instanceId: number, section: SectionType): void {
  switch (section) {
    case 'qualityProfiles':
      arrSyncQueries.completeQualityProfilesSync(instanceId);
      return;
    case 'delayProfiles':
      arrSyncQueries.completeDelayProfilesSync(instanceId);
      return;
    case 'mediaManagement':
      arrSyncQueries.completeMediaManagementSync(instanceId);
      return;
    case 'metadataProfiles':
      arrSyncQueries.completeMetadataProfilesSync(instanceId);
      return;
  }
}

function failOrdinary(instanceId: number, section: SectionType): void {
  switch (section) {
    case 'qualityProfiles':
      arrSyncQueries.failQualityProfilesSync(instanceId, 'ordinary failure');
      return;
    case 'delayProfiles':
      arrSyncQueries.failDelayProfilesSync(instanceId, 'ordinary failure');
      return;
    case 'mediaManagement':
      arrSyncQueries.failMediaManagementSync(instanceId, 'ordinary failure');
      return;
    case 'metadataProfiles':
      arrSyncQueries.failMetadataProfilesSync(instanceId, 'ordinary failure');
      return;
  }
}

Deno.test({
  name: 'reviewed sync claims are all-or-none, deterministic, and ownership safe',
  sanitizeResources: false,
  fn: async (t) => {
    const originalBasePath = config.paths.base;
    const tempBasePath = `/tmp/praxrr-tests/reviewed-sync-claims-${crypto.randomUUID()}`;
    await Deno.mkdir(tempBasePath, { recursive: true });

    db.close();
    config.setBasePath(tempBasePath);

    try {
      await db.initialize();
      bootstrapSchema();
      insertInstance(1);
      insertInstance(2);

      await t.step('claims only the exact selected rows in deterministic section order', () => {
        const claim = arrSyncQueries.claimReviewedSyncSections(1, [
          'mediaManagement',
          'qualityProfiles',
          'mediaManagement',
        ]);
        assertExists(claim);
        assertEquals(claim.sections, ['qualityProfiles', 'mediaManagement']);
        assertEquals(getStatus(1, 'qualityProfiles').sync_status, 'in_progress');
        assertEquals(getStatus(1, 'mediaManagement').sync_status, 'in_progress');
        assertEquals(getStatus(1, 'delayProfiles').sync_status, 'idle');
        assertEquals(getStatus(1, 'metadataProfiles').sync_status, 'idle');
        for (const section of SECTIONS) {
          assertEquals(getStatus(2, section).sync_status, 'idle');
        }

        const forgedClaim = { ...claim } as ReviewedSyncClaim;
        assertEquals(arrSyncQueries.releaseReviewedSyncSections(forgedClaim), false);
        assertEquals(getStatus(1, 'qualityProfiles').sync_status, 'in_progress');
        assertEquals(arrSyncQueries.releaseReviewedSyncSections(claim), true);
        assertEquals(arrSyncQueries.releaseReviewedSyncSections(claim), false);
        assertEquals(getStatus(1, 'qualityProfiles').sync_status, 'idle');
        assertEquals(getStatus(1, 'mediaManagement').sync_status, 'idle');
      });

      await t.step('partial acquisition rolls back every earlier section transition', () => {
        setStatus(1, 'qualityProfiles', 'idle');
        setOrdinaryPending(1, 'delayProfiles');
        assertEquals(claimOrdinary(1, 'delayProfiles'), true);

        assertEquals(arrSyncQueries.claimReviewedSyncSections(1, ['delayProfiles', 'qualityProfiles']), null);
        assertEquals(getStatus(1, 'qualityProfiles').sync_status, 'idle');
        assertEquals(getStatus(1, 'delayProfiles').sync_status, 'in_progress');
        completeOrdinary(1, 'delayProfiles');
      });

      await t.step('reviewed-after-normal preserves the active ordinary claim for every section', () => {
        for (const section of SECTIONS) {
          setStatus(1, section, 'idle');
          setOrdinaryPending(1, section);
          assertEquals(claimOrdinary(1, section), true, section);
          assertEquals(arrSyncQueries.claimReviewedSyncSections(1, [section]), null, section);
          assertEquals(getStatus(1, section).sync_status, 'in_progress', section);
          completeOrdinary(1, section);
        }
      });

      await t.step('normal-after-reviewed cannot steal any reviewed section claim', () => {
        for (const section of SECTIONS) {
          setStatus(1, section, 'idle');
          const claim = arrSyncQueries.claimReviewedSyncSections(1, [section]);
          assertExists(claim, section);

          setOrdinaryPending(1, section);
          assertEquals(getStatus(1, section).sync_status, 'in_progress', section);
          assertEquals(claimOrdinary(1, section), false, section);

          completeOrdinary(1, section);
          failOrdinary(1, section);
          assertEquals(getStatus(1, section).sync_status, 'in_progress', section);
          assertEquals(getStatus(1, section).last_error, null, section);

          assertEquals(arrSyncQueries.releaseReviewedSyncSections(claim), true, section);
          assertEquals(getStatus(1, section).sync_status, 'pending', section);
          assertEquals(claimOrdinary(1, section), true, section);
          completeOrdinary(1, section);
        }
      });

      await t.step('reviewed claims consume pre-claim pending signals', () => {
        for (const section of SECTIONS) {
          setStatus(1, section, 'pending');
          const claim = arrSyncQueries.claimReviewedSyncSections(1, [section]);
          assertExists(claim, section);
          assertEquals(getStatus(1, section).should_sync, 0, section);

          assertEquals(arrSyncQueries.completeReviewedSyncSections(claim), true, section);
          assertEquals(getStatus(1, section).sync_status, 'idle', section);
          assertEquals(getStatus(1, section).should_sync, 0, section);
        }
      });

      await t.step('reviewed completion preserves ordinary setter signals raised after claim', () => {
        for (const section of SECTIONS) {
          setStatus(1, section, 'pending');
          const claim = arrSyncQueries.claimReviewedSyncSections(1, [section]);
          assertExists(claim, section);
          assertEquals(getStatus(1, section).should_sync, 0, section);

          setOrdinaryShouldSync(1, section);
          assertEquals(arrSyncQueries.completeReviewedSyncSections(claim), true, section);
          assertEquals(getStatus(1, section).sync_status, 'pending', section);
          assertEquals(getStatus(1, section).should_sync, 1, section);

          assertEquals(claimOrdinary(1, section), true, section);
          completeOrdinary(1, section);
        }
      });

      await t.step('reviewed release restores prior states and failure affects only owned rows', () => {
        setStatus(1, 'qualityProfiles', 'failed');
        setStatus(1, 'delayProfiles', 'pending');
        const releaseClaim = arrSyncQueries.claimReviewedSyncSections(1, ['delayProfiles', 'qualityProfiles']);
        assertExists(releaseClaim);
        assertEquals(arrSyncQueries.releaseReviewedSyncSections(releaseClaim), true);
        assertEquals(getStatus(1, 'qualityProfiles').sync_status, 'failed');
        assertEquals(getStatus(1, 'qualityProfiles').should_sync, 0);
        assertEquals(getStatus(1, 'delayProfiles').sync_status, 'pending');
        assertEquals(getStatus(1, 'delayProfiles').should_sync, 1);

        setStatus(1, 'qualityProfiles', 'idle');
        setStatus(1, 'delayProfiles', 'idle');
        setStatus(1, 'mediaManagement', 'idle');
        const failClaim = arrSyncQueries.claimReviewedSyncSections(1, ['qualityProfiles', 'delayProfiles']);
        assertExists(failClaim);
        assertEquals(arrSyncQueries.failReviewedSyncSections(failClaim, 'review invalidated'), true);
        assertEquals(getStatus(1, 'qualityProfiles').sync_status, 'failed');
        assertEquals(getStatus(1, 'qualityProfiles').last_error, 'review invalidated');
        assertEquals(getStatus(1, 'delayProfiles').sync_status, 'failed');
        assertEquals(getStatus(1, 'mediaManagement').sync_status, 'idle');
      });

      await t.step('bulk ordinary triggers preserve reviewed in-progress ownership', () => {
        for (const section of SECTIONS) setStatus(1, section, 'idle');
        db.execute("UPDATE arr_sync_quality_profiles_config SET trigger = 'on_change' WHERE instance_id = 1");
        db.execute("UPDATE arr_sync_delay_profiles_config SET trigger = 'on_change' WHERE instance_id = 1");
        db.execute("UPDATE arr_sync_media_management SET trigger = 'on_change' WHERE instance_id = 1");
        db.execute("UPDATE arr_sync_metadata_profiles_config SET trigger = 'on_change' WHERE instance_id = 1");

        const claim = arrSyncQueries.claimReviewedSyncSections(1, SECTIONS);
        assertExists(claim);
        arrSyncQueries.markForSync('on_change');
        for (const section of SECTIONS) {
          assertEquals(getStatus(1, section).sync_status, 'in_progress', section);
        }
        assertEquals(arrSyncQueries.releaseReviewedSyncSections(claim), true);
        for (const section of SECTIONS) {
          assertEquals(getStatus(1, section).sync_status, 'pending', section);
        }
      });

      await t.step('reviewed failure preserves bulk mark signals raised after claim', () => {
        for (const section of SECTIONS) {
          setStatus(1, section, 'idle');
          db.execute(`UPDATE ${TABLES[section]} SET trigger = 'on_change' WHERE instance_id = 1`);
        }
        const claim = arrSyncQueries.claimReviewedSyncSections(1, SECTIONS);
        assertExists(claim);

        arrSyncQueries.markForSync('on_change');
        assertEquals(arrSyncQueries.failReviewedSyncSections(claim, 'review invalidated'), true);
        for (const section of SECTIONS) {
          const status = getStatus(1, section);
          assertEquals(status.sync_status, 'pending', section);
          assertEquals(status.should_sync, 1, section);
          assertEquals(status.last_error, 'review invalidated', section);
        }
      });
    } finally {
      arrSyncQueries.recoverInterruptedSyncs();
      db.close();
      config.setBasePath(originalBasePath);
      await Deno.remove(tempBasePath, { recursive: true }).catch(() => undefined);
    }
  },
});
