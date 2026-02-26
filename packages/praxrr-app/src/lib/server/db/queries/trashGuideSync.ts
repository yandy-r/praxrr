import { db } from '../db.ts';
import type { ArrType } from '$shared/pcd/types.ts';
import { parseTrashGuideSourceArrType, type TrashGuideSourceArrType } from '$lib/server/trashguide/types.ts';

export type TrashGuideSyncTrigger = 'none' | 'manual' | 'on_pull' | 'on_change' | 'schedule';
export type TrashGuideSyncStatus = 'idle' | 'pending' | 'in_progress' | 'failed';
export type TrashGuideSyncSectionType =
  | 'qualityProfiles'
  | 'customFormats'
  | 'qualityDefinitions'
  | 'naming'
  | 'mediaManagement';

const VALID_TRIGGERS: ReadonlySet<string> = new Set<TrashGuideSyncTrigger>([
  'none',
  'manual',
  'on_pull',
  'on_change',
  'schedule',
]);

const VALID_STATUSES: ReadonlySet<string> = new Set<TrashGuideSyncStatus>(['idle', 'pending', 'in_progress', 'failed']);

const VALID_SECTION_TYPES: ReadonlySet<string> = new Set<TrashGuideSyncSectionType>([
  'qualityProfiles',
  'customFormats',
  'qualityDefinitions',
  'naming',
  'mediaManagement',
]);

function toDbBoolean(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function parseTrashGuideSyncTrigger(raw: string): TrashGuideSyncTrigger {
  if (VALID_TRIGGERS.has(raw)) {
    return raw as TrashGuideSyncTrigger;
  }

  throw new Error(`Invalid TRaSH sync trigger: ${raw}`);
}

function parseTrashGuideSyncStatus(raw: string): TrashGuideSyncStatus {
  if (VALID_STATUSES.has(raw)) {
    return raw as TrashGuideSyncStatus;
  }

  throw new Error(`Invalid TRaSH sync status: ${raw}`);
}

function parseTrashGuideSectionType(raw: string): TrashGuideSyncSectionType {
  if (VALID_SECTION_TYPES.has(raw)) {
    return raw as TrashGuideSyncSectionType;
  }

  throw new Error(`Invalid TRaSH sync section type: ${raw}`);
}

function parseInstanceArrType(raw: string): ArrType {
  if (raw === 'radarr' || raw === 'sonarr' || raw === 'lidarr' || raw === 'all') {
    return raw;
  }

  throw new Error(`Invalid arr instance type: ${raw}`);
}

interface TrashGuideSyncConfigRow {
  instance_id: number;
  source_id: number;
  trigger: string;
  cron: string | null;
  next_run_at: string | null;
  sync_status: string;
  last_error: string | null;
  last_synced_at: string | null;
  should_sync: number;
  instance_type: string;
  source_arr_type: string;
}

interface TrashGuideSyncSelectionRow {
  instance_id: number;
  source_id: number;
  section_type: string;
  item_name: string;
  instance_type: string;
  source_arr_type: string;
}

interface TrashGuideSyncSourceRow {
  source_id: number;
  source_name: string;
  source_arr_type: string;
}

interface ScopeCheckRow {
  instance_type: string;
  source_arr_type: string;
}

export interface TrashGuideSyncConfig {
  instanceId: number;
  sourceId: number;
  trigger: TrashGuideSyncTrigger;
  cron: string | null;
  nextRunAt: string | null;
  syncStatus: TrashGuideSyncStatus;
  lastError: string | null;
  lastSyncedAt: string | null;
  shouldSync: boolean;
  instanceType: ArrType;
  sourceArrType: TrashGuideSourceArrType;
}

export interface TrashGuideSyncSelection {
  instanceId: number;
  sourceId: number;
  sectionType: TrashGuideSyncSectionType;
  itemName: string;
}

export interface TrashGuideSyncSelectionInput {
  sectionType: TrashGuideSyncSectionType;
  itemName: string;
}

export interface TrashGuideSyncSourceHydration {
  sourceId: number;
  sourceName: string;
  sourceArrType: TrashGuideSourceArrType;
  config: TrashGuideSyncConfig | null;
  selections: TrashGuideSyncSelection[];
}

export interface TrashGuideSyncConfigInput {
  instanceId: number;
  sourceId: number;
  trigger: TrashGuideSyncTrigger;
  cron?: string | null;
  nextRunAt?: string | null;
  syncStatus?: TrashGuideSyncStatus;
  lastError?: string | null;
  lastSyncedAt?: string | null;
  shouldSync?: boolean;
}

function rowToConfig(row: TrashGuideSyncConfigRow): TrashGuideSyncConfig {
  return {
    instanceId: row.instance_id,
    sourceId: row.source_id,
    trigger: parseTrashGuideSyncTrigger(row.trigger),
    cron: row.cron,
    nextRunAt: row.next_run_at,
    syncStatus: parseTrashGuideSyncStatus(row.sync_status),
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    shouldSync: row.should_sync === 1,
    instanceType: parseInstanceArrType(row.instance_type),
    sourceArrType: parseTrashGuideSourceArrType(row.source_arr_type),
  };
}

function rowToSelection(row: TrashGuideSyncSelectionRow): TrashGuideSyncSelection {
  return {
    instanceId: row.instance_id,
    sourceId: row.source_id,
    sectionType: parseTrashGuideSectionType(row.section_type),
    itemName: row.item_name,
  };
}

function assertScope(instanceId: number, sourceId: number): void {
  const scope = db.queryFirst<ScopeCheckRow>(
    `SELECT ai.type AS instance_type, s.arr_type AS source_arr_type
     FROM arr_instances ai
     JOIN trash_guide_sources s ON s.id = ?
     WHERE ai.id = ?`,
    sourceId,
    instanceId
  );

  if (!scope) {
    throw new Error(`Failed to validate TRaSH sync scope for instanceId=${instanceId}, sourceId=${sourceId}`);
  }

  const sourceArrType = parseTrashGuideSourceArrType(scope.source_arr_type);
  const instanceType = parseInstanceArrType(scope.instance_type);

  if (instanceType !== sourceArrType) {
    throw new Error(`TRaSH source arr_type mismatch: source arr_type=${sourceArrType}, instance type=${instanceType}`);
  }
}

function triggerPlaceholders(triggers: string[]): string {
  return triggers.map(() => '?').join(', ');
}

export const trashGuideSyncQueries = {
  /**
   * Get all TRaSH sync configs for an instance.
   */
  getConfigsByInstance(instanceId: number): TrashGuideSyncConfig[] {
    return db
      .query<TrashGuideSyncConfigRow>(
        `SELECT tgsync.instance_id,
                tgsync.source_id,
                tgsync.trigger,
                tgsync.cron,
                tgsync.next_run_at,
                tgsync.sync_status,
                tgsync.last_error,
                tgsync.last_synced_at,
                tgsync.should_sync,
                ai.type AS instance_type,
                s.arr_type AS source_arr_type
           FROM trash_guide_sync_config tgsync
           JOIN arr_instances ai ON ai.id = tgsync.instance_id
           JOIN trash_guide_sources s ON s.id = tgsync.source_id
          WHERE tgsync.instance_id = ?
            AND ai.type = s.arr_type`,
        instanceId
      )
      .map(rowToConfig);
  },

  /**
   * Get all TRaSH sync selections for an instance.
   */
  getSelectionsByInstance(instanceId: number): TrashGuideSyncSelection[] {
    return db
      .query<TrashGuideSyncSelectionRow>(
        `SELECT tgs.instance_id,
                tgs.source_id,
                tgs.section_type,
                tgs.item_name,
                ai.type AS instance_type,
                s.arr_type AS source_arr_type
           FROM trash_guide_sync_selections tgs
           JOIN arr_instances ai ON ai.id = tgs.instance_id
           JOIN trash_guide_sources s ON s.id = tgs.source_id
          WHERE tgs.instance_id = ?
            AND ai.type = s.arr_type`,
        instanceId
      )
      .map(rowToSelection);
  },

  /**
   * Return source-grouped TRaSH sync state for an Arr instance.
   */
  getSourceHydrationByInstance(instanceId: number): TrashGuideSyncSourceHydration[] {
    const rows = db.query<TrashGuideSyncSourceRow>(
      `SELECT s.id AS source_id,
              s.name AS source_name,
              s.arr_type AS source_arr_type
         FROM arr_instances ai
         JOIN trash_guide_sources s ON s.arr_type = ai.type
        WHERE ai.id = ?
          AND s.enabled = 1
        ORDER BY s.name`,
      instanceId
    );

    return rows.map((row) => ({
      sourceId: row.source_id,
      sourceName: row.source_name,
      sourceArrType: parseTrashGuideSourceArrType(row.source_arr_type),
      config: trashGuideSyncQueries.getConfig(instanceId, row.source_id) ?? null,
      selections: trashGuideSyncQueries.getSelections(instanceId, row.source_id),
    }));
  },

  /**
   * Get all TRaSH sync configs for one source.
   */
  getConfigsBySource(sourceId: number): TrashGuideSyncConfig[] {
    return db
      .query<TrashGuideSyncConfigRow>(
        `SELECT tgsync.instance_id,
                tgsync.source_id,
                tgsync.trigger,
                tgsync.cron,
                tgsync.next_run_at,
                tgsync.sync_status,
                tgsync.last_error,
                tgsync.last_synced_at,
                tgsync.should_sync,
                ai.type AS instance_type,
                s.arr_type AS source_arr_type
           FROM trash_guide_sync_config tgsync
           JOIN arr_instances ai ON ai.id = tgsync.instance_id
           JOIN trash_guide_sources s ON s.id = tgsync.source_id
          WHERE tgsync.source_id = ?
            AND ai.type = s.arr_type`,
        sourceId
      )
      .map(rowToConfig);
  },

  /**
   * Get a single config row for an instance/source pair.
   */
  getConfig(instanceId: number, sourceId: number): TrashGuideSyncConfig | undefined {
    const row = db.queryFirst<TrashGuideSyncConfigRow>(
      `SELECT tgsync.instance_id,
              tgsync.source_id,
              tgsync.trigger,
              tgsync.cron,
              tgsync.next_run_at,
              tgsync.sync_status,
              tgsync.last_error,
              tgsync.last_synced_at,
              tgsync.should_sync,
              ai.type AS instance_type,
              s.arr_type AS source_arr_type
         FROM trash_guide_sync_config tgsync
         JOIN arr_instances ai ON ai.id = tgsync.instance_id
         JOIN trash_guide_sources s ON s.id = tgsync.source_id
        WHERE tgsync.instance_id = ?
          AND tgsync.source_id = ?
          AND ai.type = s.arr_type`,
      instanceId,
      sourceId
    );

    return row ? rowToConfig(row) : undefined;
  },

  /**
   * Save or replace a TRaSH sync config row.
   */
  saveConfig(input: TrashGuideSyncConfigInput): void {
    assertScope(input.instanceId, input.sourceId);

    db.execute(
      `INSERT INTO trash_guide_sync_config (
         instance_id,
         source_id,
         trigger,
         cron,
         next_run_at,
         sync_status,
         last_error,
         last_synced_at,
         should_sync
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instance_id, source_id)
       DO UPDATE SET
         trigger = excluded.trigger,
         cron = excluded.cron,
         next_run_at = excluded.next_run_at,
         sync_status = excluded.sync_status,
         last_error = excluded.last_error,
         last_synced_at = excluded.last_synced_at,
         should_sync = excluded.should_sync`,
      input.instanceId,
      input.sourceId,
      input.trigger,
      input.cron ?? null,
      input.nextRunAt ?? null,
      input.syncStatus ?? 'idle',
      input.lastError ?? null,
      input.lastSyncedAt ?? null,
      toDbBoolean(input.shouldSync ?? false)
    );
  },

  /**
   * Delete a sync config row.
   */
  deleteConfig(instanceId: number, sourceId: number): boolean {
    const affected = db.execute(
      'DELETE FROM trash_guide_sync_config WHERE instance_id = ? AND source_id = ?',
      instanceId,
      sourceId
    );
    return affected > 0;
  },

  /**
   * Set should_sync for one config row.
   */
  setShouldSync(instanceId: number, sourceId: number, shouldSync: boolean): void {
    assertScope(instanceId, sourceId);

    db.execute(
      'UPDATE trash_guide_sync_config SET should_sync = ? WHERE instance_id = ? AND source_id = ?',
      toDbBoolean(shouldSync),
      instanceId,
      sourceId
    );
  },

  /**
   * Set should_sync for every config associated with a source.
   */
  setShouldSyncForSource(sourceId: number, shouldSync: boolean): number {
    return db.execute(
      'UPDATE trash_guide_sync_config SET should_sync = ? WHERE source_id = ?',
      toDbBoolean(shouldSync),
      sourceId
    );
  },

  /**
   * Mark all configs for one source as pending and set should_sync.
   */
  setStatusPendingBySource(sourceId: number): number {
    return db.execute(
      "UPDATE trash_guide_sync_config SET sync_status = 'pending', should_sync = 1 WHERE source_id = ?",
      sourceId
    );
  },

  /**
   * Mark matching configs for one source for a trigger as pending.
   */
  markForSyncBySource(sourceId: number, trigger: 'on_pull' | 'on_change'): number {
    const triggers = trigger === 'on_change' ? ['on_pull', 'on_change'] : ['on_pull'];
    const placeholders = triggerPlaceholders(triggers);

    return db.execute(
      `UPDATE trash_guide_sync_config
         SET should_sync = 1, sync_status = 'pending'
       WHERE source_id = ?
         AND trigger IN (${placeholders})`,
      sourceId,
      ...triggers
    );
  },

  /**
   * Atomically claim a sync row.
   */
  claimSync(instanceId: number, sourceId: number): boolean {
    assertScope(instanceId, sourceId);

    const result = db.execute(
      "UPDATE trash_guide_sync_config SET sync_status = 'in_progress' WHERE instance_id = ? AND source_id = ? AND sync_status = 'pending'",
      instanceId,
      sourceId
    );
    return result > 0;
  },

  completeSync(instanceId: number, sourceId: number): void {
    assertScope(instanceId, sourceId);

    db.execute(
      "UPDATE trash_guide_sync_config SET sync_status = 'idle', should_sync = 0, last_error = NULL, last_synced_at = ? WHERE instance_id = ? AND source_id = ?",
      new Date().toISOString(),
      instanceId,
      sourceId
    );
  },

  failSync(instanceId: number, sourceId: number, error: string): void {
    assertScope(instanceId, sourceId);

    db.execute(
      "UPDATE trash_guide_sync_config SET sync_status = 'failed', should_sync = 0, last_error = ? WHERE instance_id = ? AND source_id = ?",
      error,
      instanceId,
      sourceId
    );
  },

  /**
   * Get all pending configs (legacy compatibility for future scheduler-style processing).
   */
  getPendingConfigs(): TrashGuideSyncConfig[] {
    return db
      .query<TrashGuideSyncConfigRow>(
        `SELECT tgsync.instance_id,
                tgsync.source_id,
                tgsync.trigger,
                tgsync.cron,
                tgsync.next_run_at,
                tgsync.sync_status,
                tgsync.last_error,
                tgsync.last_synced_at,
                tgsync.should_sync,
                ai.type AS instance_type,
                s.arr_type AS source_arr_type
           FROM trash_guide_sync_config tgsync
           JOIN arr_instances ai ON ai.id = tgsync.instance_id
           JOIN trash_guide_sources s ON s.id = tgsync.source_id
          WHERE tgsync.sync_status = 'pending'
            AND ai.type = s.arr_type`
      )
      .map(rowToConfig);
  },

  /**
   * Get all scheduled configs.
   */
  getScheduledConfigs(): TrashGuideSyncConfig[] {
    return db
      .query<TrashGuideSyncConfigRow>(
        `SELECT tgsync.instance_id,
                tgsync.source_id,
                tgsync.trigger,
                tgsync.cron,
                tgsync.next_run_at,
                tgsync.sync_status,
                tgsync.last_error,
                tgsync.last_synced_at,
                tgsync.should_sync,
                ai.type AS instance_type,
                s.arr_type AS source_arr_type
           FROM trash_guide_sync_config tgsync
           JOIN arr_instances ai ON ai.id = tgsync.instance_id
           JOIN trash_guide_sources s ON s.id = tgsync.source_id
          WHERE tgsync.trigger = 'schedule'
            AND ai.type = s.arr_type`
      )
      .map(rowToConfig);
  },

  /**
   * Return instance IDs for a source.
   */
  getInstanceIdsForSource(sourceId: number): number[] {
    const rows = db.query<{ instance_id: number }>(
      `SELECT tgsync.instance_id
       FROM trash_guide_sync_config tgsync
       JOIN arr_instances ai ON ai.id = tgsync.instance_id
       JOIN trash_guide_sources s ON s.id = tgsync.source_id
       WHERE tgsync.source_id = ?
         AND ai.type = s.arr_type`,
      sourceId
    );

    return rows.map((row) => row.instance_id);
  },

  /**
   * Return instance IDs for all sources that match a trigger.
   */
  getInstanceIdsForTrigger(trigger: 'on_pull' | 'on_change'): number[] {
    const triggers = trigger === 'on_change' ? ['on_pull', 'on_change'] : ['on_pull'];
    const placeholders = triggerPlaceholders(triggers);

    const rows = db.query<{ instance_id: number }>(
      `SELECT instance_id
       FROM trash_guide_sync_config
       WHERE trigger IN (${placeholders})
       GROUP BY instance_id`,
      ...triggers
    );

    return rows.map((row) => row.instance_id);
  },

  /**
   * Get all selections for an instance/source pair.
   */
  getSelections(instanceId: number, sourceId: number): TrashGuideSyncSelection[] {
    assertScope(instanceId, sourceId);

    return db
      .query<TrashGuideSyncSelectionRow>(
        `SELECT tgs.instance_id,
                tgs.source_id,
                tgs.section_type,
                tgs.item_name,
                ai.type AS instance_type,
                s.arr_type AS source_arr_type
           FROM trash_guide_sync_selections tgs
           JOIN arr_instances ai ON ai.id = tgs.instance_id
           JOIN trash_guide_sources s ON s.id = tgs.source_id
          WHERE tgs.instance_id = ?
            AND tgs.source_id = ?
            AND ai.type = s.arr_type`,
        instanceId,
        sourceId
      )
      .map(rowToSelection);
  },

  /**
   * Replace all selections for an instance/source pair.
   */
  setSelections(instanceId: number, sourceId: number, selections: TrashGuideSyncSelectionInput[]): void {
    assertScope(instanceId, sourceId);

    db.beginTransaction();
    try {
      db.execute(
        'DELETE FROM trash_guide_sync_selections WHERE instance_id = ? AND source_id = ?',
        instanceId,
        sourceId
      );

      const seen = new Set<string>();
      for (const selection of selections) {
        if (!selection.itemName.trim()) {
          throw new Error('TRaSH sync selection item_name is required');
        }

        const sectionType = parseTrashGuideSectionType(selection.sectionType);

        const key = `${sectionType}:${selection.itemName}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        db.execute(
          'INSERT INTO trash_guide_sync_selections (instance_id, source_id, section_type, item_name) VALUES (?, ?, ?, ?)',
          instanceId,
          sourceId,
          sectionType,
          selection.itemName
        );
      }

      db.commit();
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Remove all selections for an instance/source pair.
   */
  clearSelections(instanceId: number, sourceId: number): boolean {
    assertScope(instanceId, sourceId);
    const affected = db.execute(
      'DELETE FROM trash_guide_sync_selections WHERE instance_id = ? AND source_id = ?',
      instanceId,
      sourceId
    );
    return affected > 0;
  },
};
