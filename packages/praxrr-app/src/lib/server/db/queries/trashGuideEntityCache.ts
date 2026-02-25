import { db } from '../db.ts';

export type TrashGuideEntityType = 'custom_format' | 'quality_profile' | 'quality_size' | 'naming';

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set<TrashGuideEntityType>([
  'custom_format',
  'quality_profile',
  'quality_size',
  'naming',
]);

function parseEntityType(raw: string): TrashGuideEntityType {
  if (VALID_ENTITY_TYPES.has(raw)) {
    return raw as TrashGuideEntityType;
  }

  throw new Error(`Invalid TRaSH entity type: ${raw}`);
}

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

function assertRowSource(entity: TrashGuideEntityCacheInput, expectedSourceId: number): void {
  if (entity.sourceId !== expectedSourceId) {
    throw new Error(`TRaSH entity source_id mismatch: expected ${expectedSourceId}, got ${entity.sourceId}`);
  }
}

function rowToCache(row: TrashGuideEntityCacheRow): TrashGuideEntityCache {
  return {
    id: row.id,
    sourceId: row.source_id,
    trashId: row.trash_id,
    entityType: parseEntityType(row.entity_type),
    name: row.name,
    jsonData: row.json_data,
    filePath: row.file_path,
    contentHash: row.content_hash,
    fetchedAt: row.fetched_at,
  };
}

function rowToHash(row: TrashGuideEntityCacheRow): TrashGuideEntityCacheHash {
  return {
    trashId: row.trash_id,
    entityType: parseEntityType(row.entity_type),
    contentHash: row.content_hash,
    filePath: row.file_path,
  };
}

export const trashGuideEntityCacheQueries = {
  /**
   * Upsert a single parsed entity.
   */
  upsert(entity: TrashGuideEntityCacheInput): number {
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
      entity.trashId,
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
   * Get a single cached entity by key.
   */
  getByKey(sourceId: number, trashId: string, entityType: TrashGuideEntityType): TrashGuideEntityCache | undefined {
    const row = db.queryFirst<TrashGuideEntityCacheRow>(
      `SELECT *
       FROM trash_guide_entity_cache
       WHERE source_id = ? AND trash_id = ? AND entity_type = ?`,
      sourceId,
      trashId,
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
    const row = db.queryFirst<{ content_hash: string }>(
      `SELECT content_hash
       FROM trash_guide_entity_cache
       WHERE source_id = ? AND trash_id = ? AND entity_type = ?`,
      sourceId,
      trashId,
      entityType
    );

    return row?.content_hash !== contentHash;
  },
};
