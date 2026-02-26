import { db } from '../db.ts';
import { parseTrashGuideSourceArrType, type TrashGuideSourceArrType } from '$lib/server/trashguide/types.ts';

export type TrashIdMappingEntityType = 'custom_format' | 'quality_profile' | 'quality_size' | 'naming';

const VALID_ENTITY_TYPES: ReadonlySet<string> = new Set<TrashIdMappingEntityType>([
  'custom_format',
  'quality_profile',
  'quality_size',
  'naming',
]);

interface TrashIdMappingRow {
  source_id: number;
  trash_id: string;
  arr_type: string;
  entity_type: string;
  entity_name: string;
}

export interface TrashIdMapping {
  sourceId: number;
  trashId: string;
  arrType: TrashGuideSourceArrType;
  entityType: TrashIdMappingEntityType;
  entityName: string;
}

export interface TrashIdMappingInput {
  sourceId: number;
  trashId: string;
  arrType: TrashGuideSourceArrType;
  entityType: TrashIdMappingEntityType;
  entityName: string;
}

export interface TrashIdMappingRename {
  sourceId: number;
  trashId: string;
  arrType: TrashGuideSourceArrType;
  entityType: TrashIdMappingEntityType;
  previousName: string;
  nextName: string;
}

export interface TrashIdMappingDiff {
  created: TrashIdMappingInput[];
  renamed: TrashIdMappingRename[];
  unchanged: TrashIdMapping[];
  removed: TrashIdMapping[];
}

function parseEntityType(raw: string): TrashIdMappingEntityType {
  if (VALID_ENTITY_TYPES.has(raw)) {
    return raw as TrashIdMappingEntityType;
  }

  throw new Error(`Invalid TRaSH entity type mapping value: ${raw}`);
}

function rowToMapping(row: TrashIdMappingRow): TrashIdMapping {
  return {
    sourceId: row.source_id,
    trashId: row.trash_id,
    arrType: parseTrashGuideSourceArrType(row.arr_type),
    entityType: parseEntityType(row.entity_type),
    entityName: row.entity_name,
  };
}

function assertSource(input: TrashIdMappingInput, sourceId: number): void {
  if (input.sourceId !== sourceId) {
    throw new Error(`TRaSH mapping source mismatch: expected ${sourceId}, received ${input.sourceId}`);
  }
}

function assertArrType(input: TrashIdMappingInput, arrType: TrashGuideSourceArrType): void {
  if (input.arrType !== arrType) {
    throw new Error(`TRaSH mapping arr_type mismatch: expected ${arrType}, received ${input.arrType}`);
  }
}

function buildMappingKey(input: {
  readonly sourceId: number;
  readonly trashId: string;
  readonly entityType: TrashIdMappingEntityType;
}): string {
  return `${input.sourceId}:${input.entityType}:${input.trashId}`;
}

function normalizeMappings(
  mappings: readonly TrashIdMappingInput[],
  sourceId: number,
  arrType: TrashGuideSourceArrType
): TrashIdMappingInput[] {
  const unique = new Map<string, TrashIdMappingInput>();
  for (const mapping of mappings) {
    assertSource(mapping, sourceId);
    assertArrType(mapping, arrType);

    const key = buildMappingKey(mapping);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, mapping);
      continue;
    }

    if (existing.entityName !== mapping.entityName) {
      throw new Error(
        `Conflicting TRaSH mapping rows for ${mapping.entityType}:${mapping.trashId} (source=${sourceId})`
      );
    }
  }

  return [...unique.values()].sort((a, b) => {
    if (a.entityType !== b.entityType) {
      return a.entityType.localeCompare(b.entityType);
    }
    if (a.entityName !== b.entityName) {
      return a.entityName.localeCompare(b.entityName);
    }
    return a.trashId.localeCompare(b.trashId);
  });
}

function computeDiff(current: readonly TrashIdMapping[], next: readonly TrashIdMappingInput[]): TrashIdMappingDiff {
  const currentByKey = new Map<string, TrashIdMapping>();
  for (const row of current) {
    currentByKey.set(buildMappingKey(row), row);
  }

  const nextByKey = new Map<string, TrashIdMappingInput>();
  for (const row of next) {
    nextByKey.set(buildMappingKey(row), row);
  }

  const created: TrashIdMappingInput[] = [];
  const renamed: TrashIdMappingRename[] = [];
  const unchanged: TrashIdMapping[] = [];

  for (const row of next) {
    const key = buildMappingKey(row);
    const prev = currentByKey.get(key);
    if (!prev) {
      created.push(row);
      continue;
    }

    if (prev.entityName !== row.entityName) {
      renamed.push({
        sourceId: row.sourceId,
        arrType: row.arrType,
        entityType: row.entityType,
        trashId: row.trashId,
        previousName: prev.entityName,
        nextName: row.entityName,
      });
      continue;
    }

    unchanged.push(prev);
  }

  const removed = current.filter((row) => !nextByKey.has(buildMappingKey(row)));

  return {
    created,
    renamed,
    unchanged,
    removed,
  };
}

/**
 * Database queries for TRaSH ID mappings.
 * Tracks the mapping between TRaSH guide entity IDs and their current names
 * to support diff detection and rename propagation across Arr instances.
 */
export const trashIdMappingsQueries = {
  /**
   * Get mapping rows for one source, optionally scoped by arr_type.
   */
  getBySource(sourceId: number, arrType?: TrashGuideSourceArrType): TrashIdMapping[] {
    const rows = arrType
      ? db.query<TrashIdMappingRow>(
          `SELECT source_id, trash_id, arr_type, entity_type, entity_name
					 FROM trash_id_mappings
					 WHERE source_id = ? AND arr_type = ?
					 ORDER BY entity_type ASC, entity_name ASC, trash_id ASC`,
          sourceId,
          arrType
        )
      : db.query<TrashIdMappingRow>(
          `SELECT source_id, trash_id, arr_type, entity_type, entity_name
					 FROM trash_id_mappings
					 WHERE source_id = ?
					 ORDER BY entity_type ASC, entity_name ASC, trash_id ASC`,
          sourceId
        );

    return rows.map(rowToMapping);
  },

  /**
   * Lookup mapping rows by arr_type and trash_id across sources.
   */
  getByArrTypeAndTrashId(
    arrType: TrashGuideSourceArrType,
    trashId: string,
    entityType?: TrashIdMappingEntityType
  ): TrashIdMapping[] {
    const rows = entityType
      ? db.query<TrashIdMappingRow>(
          `SELECT source_id, trash_id, arr_type, entity_type, entity_name
					 FROM trash_id_mappings
					 WHERE arr_type = ? AND trash_id = ? AND entity_type = ?
					 ORDER BY source_id ASC`,
          arrType,
          trashId,
          entityType
        )
      : db.query<TrashIdMappingRow>(
          `SELECT source_id, trash_id, arr_type, entity_type, entity_name
					 FROM trash_id_mappings
					 WHERE arr_type = ? AND trash_id = ?
					 ORDER BY source_id ASC, entity_type ASC`,
          arrType,
          trashId
        );

    return rows.map(rowToMapping);
  },

  /**
   * Lookup a single mapping row by source + identity key.
   */
  getByIdentity(
    sourceId: number,
    arrType: TrashGuideSourceArrType,
    trashId: string,
    entityType: TrashIdMappingEntityType
  ): TrashIdMapping | undefined {
    const row = db.queryFirst<TrashIdMappingRow>(
      `SELECT source_id, trash_id, arr_type, entity_type, entity_name
			 FROM trash_id_mappings
			 WHERE source_id = ? AND arr_type = ? AND trash_id = ? AND entity_type = ?
			 LIMIT 1`,
      sourceId,
      arrType,
      trashId,
      entityType
    );
    return row ? rowToMapping(row) : undefined;
  },

  /**
   * Upsert one mapping row.
   */
  upsert(mapping: TrashIdMappingInput): number {
    return db.execute(
      `INSERT INTO trash_id_mappings (source_id, trash_id, arr_type, entity_type, entity_name)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(source_id, trash_id, entity_type)
			 DO UPDATE SET
			   arr_type = excluded.arr_type,
			   entity_name = excluded.entity_name`,
      mapping.sourceId,
      mapping.trashId,
      mapping.arrType,
      mapping.entityType,
      mapping.entityName
    );
  },

  /**
   * Upsert many mapping rows in one transaction.
   */
  upsertMany(mappings: readonly TrashIdMappingInput[]): void {
    if (mappings.length === 0) {
      return;
    }

    const normalized = normalizeMappings(mappings, mappings[0].sourceId, mappings[0].arrType);

    db.beginTransaction();
    try {
      for (const mapping of normalized) {
        this.upsert(mapping);
      }
      db.commit();
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Compute diff against current persisted mappings for one source + arr_type.
   */
  diffSourceMappings(
    sourceId: number,
    arrType: TrashGuideSourceArrType,
    nextMappings: readonly TrashIdMappingInput[]
  ): TrashIdMappingDiff {
    const normalized = normalizeMappings(nextMappings, sourceId, arrType);
    const current = this.getBySource(sourceId, arrType);
    return computeDiff(current, normalized);
  },

  /**
   * Replace source mappings atomically for one arr_type.
   * Returns diff data so callers can process upstream deletes/renames.
   */
  replaceSourceMappings(
    sourceId: number,
    arrType: TrashGuideSourceArrType,
    nextMappings: readonly TrashIdMappingInput[]
  ): TrashIdMappingDiff {
    const normalized = normalizeMappings(nextMappings, sourceId, arrType);
    const current = this.getBySource(sourceId, arrType);
    const diff = computeDiff(current, normalized);

    db.beginTransaction();
    try {
      db.execute('DELETE FROM trash_id_mappings WHERE source_id = ? AND arr_type = ?', sourceId, arrType);

      for (const mapping of normalized) {
        this.upsert(mapping);
      }

      db.commit();
      return diff;
    } catch (error) {
      db.rollback();
      throw error;
    }
  },

  /**
   * Delete all mappings for a source, optionally scoped by arr_type.
   */
  deleteBySource(sourceId: number, arrType?: TrashGuideSourceArrType): number {
    if (arrType) {
      return db.execute('DELETE FROM trash_id_mappings WHERE source_id = ? AND arr_type = ?', sourceId, arrType);
    }
    return db.execute('DELETE FROM trash_id_mappings WHERE source_id = ?', sourceId);
  },
};
