import { db } from '../db.ts';

export type ManagedEntityType = 'customFormat' | 'qualityProfile';
export type ManagedSourceKind = 'pcd' | 'trash';

export interface ArrManagedEntity {
  instanceId: number;
  section: 'qualityProfiles';
  entityType: ManagedEntityType;
  remoteId: number;
  arrName: string;
  pcdName: string;
  /** Positive PCD database id or TRaSH source id. */
  databaseId: number;
  sourceKind: ManagedSourceKind;
  firstSyncedAt: string;
  lastSyncedAt: string;
}

const managedEntitySelect = `
  SELECT instance_id AS instanceId, section, entity_type AS entityType, remote_id AS remoteId,
         arr_name AS arrName, pcd_name AS pcdName, database_id AS databaseId,
         source_kind AS sourceKind, first_synced_at AS firstSyncedAt, last_synced_at AS lastSyncedAt
    FROM arr_managed_entities`;

export const arrManagedEntitiesQueries = {
  /** Only confirmed creates may establish ownership. Preserve the first creation timestamp. */
  recordCreated(row: Omit<ArrManagedEntity, 'firstSyncedAt' | 'lastSyncedAt'> & { at: string }): void {
    db.execute(
      `INSERT INTO arr_managed_entities
         (instance_id, section, entity_type, remote_id, arr_name, pcd_name, database_id,
          source_kind, first_synced_at, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instance_id, entity_type, remote_id) DO UPDATE SET
         arr_name = excluded.arr_name,
         pcd_name = excluded.pcd_name,
         database_id = excluded.database_id,
         source_kind = excluded.source_kind,
         last_synced_at = excluded.last_synced_at`,
      row.instanceId,
      row.section,
      row.entityType,
      row.remoteId,
      row.arrName,
      row.pcdName,
      row.databaseId,
      row.sourceKind,
      row.at,
      row.at
    );
  },

  /** Updating a same-name foreign entity must never adopt it into the ledger. */
  touchUpdated(
    instanceId: number,
    entityType: ManagedEntityType,
    remoteId: number,
    arrName: string,
    pcdName: string,
    at: string
  ): void {
    db.execute(
      `UPDATE arr_managed_entities SET arr_name = ?, pcd_name = ?, last_synced_at = ?
        WHERE instance_id = ? AND entity_type = ? AND remote_id = ?`,
      arrName,
      pcdName,
      at,
      instanceId,
      entityType,
      remoteId
    );
  },

  listForInstance(instanceId: number): ArrManagedEntity[] {
    return db.query<ArrManagedEntity>(
      `${managedEntitySelect} WHERE instance_id = ? ORDER BY entity_type, remote_id`,
      instanceId
    );
  },

  deleteConfirmed(instanceId: number, entityType: ManagedEntityType, remoteId: number): void {
    db.execute(
      'DELETE FROM arr_managed_entities WHERE instance_id = ? AND entity_type = ? AND remote_id = ?',
      instanceId,
      entityType,
      remoteId
    );
  },

  clearInstance(instanceId: number): void {
    db.execute('DELETE FROM arr_managed_entities WHERE instance_id = ?', instanceId);
  },

  listRemoteIds(instanceId: number, entityType: ManagedEntityType): Set<number> {
    const rows = db.query<{ remoteId: number }>(
      'SELECT remote_id AS remoteId FROM arr_managed_entities WHERE instance_id = ? AND entity_type = ?',
      instanceId,
      entityType
    );
    return new Set(rows.map((row) => row.remoteId));
  },
};
