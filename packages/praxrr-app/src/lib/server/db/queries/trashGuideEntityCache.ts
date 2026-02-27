import { db } from '../db.ts';
import {
  parseTrashGuideEntityType,
  parseTrashGuideSourceArrType,
  type TrashGuideEntityType,
  type TrashGuideSourceArrType,
} from '$shared/trashguide/types.ts';

interface TrashGuideEntityCacheRow {
  id: number;
  source_id: number;
  trash_id: string;
  entity_type: string;
  name: string;
  json_data: string;
  file_path: string;
  content_hash: string;
  fetched_at: string;
}

interface TrashGuideEntityCacheWithSourceRow extends TrashGuideEntityCacheRow {
  source_name: string;
  source_arr_type: string;
}

export interface TrashGuideEntityCache {
  id: number;
  sourceId: number;
  trashId: string;
  entityType: TrashGuideEntityType;
  name: string;
  jsonData: string;
  filePath: string;
  contentHash: string;
  fetchedAt: string;
}

export interface TrashGuideEntitySourceMetadata {
  type: 'trash';
  id: number;
  name: string;
  arrType: TrashGuideSourceArrType;
}

export interface TrashGuideEntityCacheWithSource extends TrashGuideEntityCache {
  source: TrashGuideEntitySourceMetadata;
}

export interface TrashGuideEntityCacheInput {
  sourceId: number;
  trashId: string;
  entityType: TrashGuideEntityType;
  name: string;
  jsonData: string;
  filePath: string;
  contentHash: string;
}

export interface TrashGuideEntityCacheHash {
  trashId: string;
  entityType: TrashGuideEntityType;
  contentHash: string;
  filePath: string;
}

function normalizeTrashId(trashId: string): string {
  return trashId.trim().toLowerCase();
}

function assertRowSource(entity: TrashGuideEntityCacheInput, expectedSourceId: number): void {
  if (entity.sourceId !== expectedSourceId) {
    throw new Error(`TRaSH entity source_id mismatch: expected ${expectedSourceId}, got ${entity.sourceId}`);
  }
}

function rowToCache(row: TrashGuideEntityCacheRow): TrashGuideEntityCache {
  return {
    id: row.id,
    sourceId: row.source_id,
    trashId: normalizeTrashId(row.trash_id),
    entityType: parseTrashGuideEntityType(row.entity_type),
    name: row.name,
    jsonData: row.json_data,
    filePath: row.file_path,
    contentHash: row.content_hash,
    fetchedAt: row.fetched_at,
  };
}

function rowToCacheWithSource(row: TrashGuideEntityCacheWithSourceRow): TrashGuideEntityCacheWithSource {
  return {
    ...rowToCache(row),
    source: {
      type: 'trash',
      id: row.source_id,
      name: row.source_name,
      arrType: parseTrashGuideSourceArrType(row.source_arr_type),
    },
  };
}

function rowToHash(row: TrashGuideEntityCacheRow): TrashGuideEntityCacheHash {
  return {
    trashId: normalizeTrashId(row.trash_id),
    entityType: parseTrashGuideEntityType(row.entity_type),
    contentHash: row.content_hash,
    filePath: row.file_path,
  };
}

export const trashGuideEntityCacheQueries = {
  /**
   * Upsert a single parsed entity.
   */
  upsert(entity: TrashGuideEntityCacheInput): number {
    const normalizedTrashId = normalizeTrashId(entity.trashId);
    if (!normalizedTrashId) {
      throw new Error('TRaSH entity trash_id must be non-empty');
    }

    return db.execute(
      `INSERT INTO trash_guide_entity_cache (source_id, trash_id, entity_type, name, json_data, file_path, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, trash_id, entity_type)
       DO UPDATE SET
         name = excluded.name,
         json_data = excluded.json_data,
         file_path = excluded.file_path,
         content_hash = excluded.content_hash`,
      entity.sourceId,
      normalizedTrashId,
      entity.entityType,
      entity.name,
      entity.jsonData,
      entity.filePath,
      entity.contentHash
    );
  },

  /**
   * Upsert multiple parsed entities in a transaction.
   */
  upsertMany(entities: TrashGuideEntityCacheInput[]): void {
    if (entities.length === 0) {
      return;
    }

    const sourceId = entities[0].sourceId;
    for (const entity of entities) {
      assertRowSource(entity, sourceId);
    }

    db.beginTransaction();
    try {
      for (const entity of entities) {
        this.upsert(entity);
      }

      db.commit();
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Replace all cached entities for a source.
   */
  replaceSourceCache(sourceId: number, entities: TrashGuideEntityCacheInput[]): void {
    db.beginTransaction();
    try {
      db.execute('DELETE FROM trash_guide_entity_cache WHERE source_id = ?', sourceId);

      for (const entity of entities) {
        assertRowSource(entity, sourceId);
        this.upsert(entity);
      }

      db.commit();
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Delete all cached entities for a source.
   */
  deleteSourceCache(sourceId: number): number {
    return db.execute('DELETE FROM trash_guide_entity_cache WHERE source_id = ?', sourceId);
  },

  /**
   * Delete cached entities for a source by type.
   */
  deleteSourceCacheByType(sourceId: number, entityType: TrashGuideEntityType): number {
    return db.execute(
      'DELETE FROM trash_guide_entity_cache WHERE source_id = ? AND entity_type = ?',
      sourceId,
      entityType
    );
  },

  /**
   * Get all cached entities for a source.
   */
  getBySource(sourceId: number): TrashGuideEntityCache[] {
    return db
      .query<TrashGuideEntityCacheRow>(
        `SELECT *
         FROM trash_guide_entity_cache
         WHERE source_id = ?
         ORDER BY entity_type ASC, name ASC`,
        sourceId
      )
      .map(rowToCache);
  },

  /**
   * Get all cached entities for a source with normalized source metadata.
   */
  getBySourceWithMetadata(sourceId: number): TrashGuideEntityCacheWithSource[] {
    return db
      .query<TrashGuideEntityCacheWithSourceRow>(
        `SELECT c.*,
                s.name AS source_name,
                s.arr_type AS source_arr_type
           FROM trash_guide_entity_cache c
           JOIN trash_guide_sources s ON s.id = c.source_id
          WHERE c.source_id = ?
          ORDER BY c.entity_type ASC, c.name ASC`,
        sourceId
      )
      .map(rowToCacheWithSource);
  },

  /**
   * Get cached entities by source and section.
   */
  getBySourceAndType(sourceId: number, entityType: TrashGuideEntityType): TrashGuideEntityCache[] {
    return db
      .query<TrashGuideEntityCacheRow>(
        `SELECT *
         FROM trash_guide_entity_cache
         WHERE source_id = ? AND entity_type = ?
         ORDER BY name ASC`,
        sourceId,
        entityType
      )
      .map(rowToCache);
  },

  /**
   * Get cached entities by source, section, and a scoped set of TRaSH ids.
   */
  getBySourceTypeAndTrashIds(
    sourceId: number,
    entityType: TrashGuideEntityType,
    trashIds: string[]
  ): TrashGuideEntityCache[] {
    const normalizedTrashIds = [...new Set(trashIds.map(normalizeTrashId).filter((trashId) => trashId.length > 0))];
    if (normalizedTrashIds.length === 0) {
      return [];
    }

    const placeholders = normalizedTrashIds.map(() => '?').join(', ');
    return db
      .query<TrashGuideEntityCacheRow>(
        `SELECT *
         FROM trash_guide_entity_cache
         WHERE source_id = ? AND entity_type = ? AND trash_id IN (${placeholders})
         ORDER BY name ASC`,
        sourceId,
        entityType,
        ...normalizedTrashIds
      )
      .map(rowToCache);
  },

  /**
   * Get a single cached entity by key.
   */
  getByKey(sourceId: number, trashId: string, entityType: TrashGuideEntityType): TrashGuideEntityCache | undefined {
    const normalizedTrashId = normalizeTrashId(trashId);
    if (!normalizedTrashId) {
      return undefined;
    }

    const row = db.queryFirst<TrashGuideEntityCacheRow>(
      `SELECT *
       FROM trash_guide_entity_cache
       WHERE source_id = ? AND trash_id = ? AND entity_type = ?`,
      sourceId,
      normalizedTrashId,
      entityType
    );

    return row ? rowToCache(row) : undefined;
  },

  /**
   * Search cached entities by name within a source and section.
   */
  searchByName(sourceId: number, entityType: TrashGuideEntityType, search: string): TrashGuideEntityCache[] {
    const term = `%${search}%`;
    return db
      .query<TrashGuideEntityCacheRow>(
        `SELECT *
         FROM trash_guide_entity_cache
         WHERE source_id = ?
           AND entity_type = ?
           AND name LIKE ?
         ORDER BY name ASC`,
        sourceId,
        entityType,
        term
      )
      .map(rowToCache);
  },

  /**
   * Return hashes for change detection.
   */
  getHashes(sourceId: number, entityType?: TrashGuideEntityType): TrashGuideEntityCacheHash[] {
    const rows = entityType
      ? db.query<TrashGuideEntityCacheRow>(
          `SELECT *
           FROM trash_guide_entity_cache
           WHERE source_id = ? AND entity_type = ?`,
          sourceId,
          entityType
        )
      : db.query<TrashGuideEntityCacheRow>(
          `SELECT *
           FROM trash_guide_entity_cache
           WHERE source_id = ?`,
          sourceId
        );

    return rows.map(rowToHash);
  },

  /**
   * Get change decision for a specific cached entity.
   */
  hasContentChanged(sourceId: number, trashId: string, entityType: TrashGuideEntityType, contentHash: string): boolean {
    const normalizedTrashId = normalizeTrashId(trashId);
    if (!normalizedTrashId) {
      return false;
    }

    const row = db.queryFirst<{ content_hash: string }>(
      `SELECT content_hash
       FROM trash_guide_entity_cache
       WHERE source_id = ? AND trash_id = ? AND entity_type = ?`,
      sourceId,
      normalizedTrashId,
      entityType
    );

    if (!row) {
      return false;
    }

    return row.content_hash !== contentHash;
  },
};
