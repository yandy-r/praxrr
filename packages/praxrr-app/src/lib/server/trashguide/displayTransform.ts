import type {
  CustomFormatTableRow,
  QualityProfileTableRow,
  QualityItem,
  SourcedNamingListItem,
  SourcedQualityDefinitionListItem,
} from '$shared/pcd/display.ts';
import type { ArrConditionTargetType } from '$shared/arr/capabilities.ts';
import type { TrashGuideEntityCache } from '$db/queries/trashGuideEntityCache.ts';
import type {
  TrashGuideCustomFormatEntity,
  TrashGuideParsedEntity,
  TrashGuideNamingEntity,
  TrashGuideQualityProfileEntity,
  TrashGuideQualitySizeEntity,
  TrashGuideEntityType,
  TrashGuideSupportedArrType,
} from './types.ts';
import { normalizeTrashId } from './ids.ts';
import { parseMarkdown } from '$utils/markdown/markdown.ts';
import { logger } from '$logger/logger.ts';

export interface TrashGuideSourceRef {
  id: number;
  name: string;
  arrType: TrashGuideSupportedArrType;
}

interface SourcedResult {
  sourceType: 'trash';
  sourceDatabaseId: number;
  sourceDatabaseName: string;
  trashId: string;
}

function toSourceFields(source: TrashGuideSourceRef, trashId: string): SourcedResult {
  return {
    sourceType: 'trash',
    sourceDatabaseId: source.id,
    sourceDatabaseName: source.name,
    trashId,
  };
}

function toSyntheticId(sourceId: number, trashId: string): number {
  const normalized = normalizeTrashId(trashId);
  let hash = 2_166_136_261; // FNV-1a offset basis

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619); // FNV prime
  }

  const suffix = (hash >>> 0) % 1_000_000_000;
  return -(sourceId * 1_000_000_000 + suffix + 1);
}

type ParsedTrashGuideEntityByType<T extends TrashGuideEntityType> = Extract<TrashGuideParsedEntity, { entity_type: T }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCustomFormatEntity(value: unknown): value is ParsedTrashGuideEntityByType<'custom_format'> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.entity_type === 'custom_format' &&
    typeof value.name === 'string' &&
    Array.isArray(value.specifications) &&
    typeof value.file_path === 'string'
  );
}

function isQualityProfileEntity(value: unknown): value is ParsedTrashGuideEntityByType<'quality_profile'> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.entity_type === 'quality_profile' &&
    typeof value.name === 'string' &&
    typeof value.file_path === 'string' &&
    typeof value.upgrade_allowed === 'boolean'
  );
}

function isQualitySizeEntity(value: unknown): value is ParsedTrashGuideEntityByType<'quality_size'> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.entity_type === 'quality_size' &&
    typeof value.name === 'string' &&
    typeof value.file_path === 'string' &&
    Array.isArray(value.qualities)
  );
}

function isNamingEntity(value: unknown): value is ParsedTrashGuideEntityByType<'naming'> {
  if (!isRecord(value)) {
    return false;
  }

  return value.entity_type === 'naming' && typeof value.name === 'string' && typeof value.file_path === 'string';
}

function isExpectedEntity<T extends TrashGuideEntityType>(
  value: unknown,
  expectedEntityType: T
): value is ParsedTrashGuideEntityByType<T> {
  switch (expectedEntityType) {
    case 'custom_format':
      return isCustomFormatEntity(value);
    case 'quality_profile':
      return isQualityProfileEntity(value);
    case 'quality_size':
      return isQualitySizeEntity(value);
    case 'naming':
      return isNamingEntity(value);
    default:
      return false;
  }
}

function logMalformedCacheRow(cache: TrashGuideEntityCache, sourceType: TrashGuideEntityType, reason: string): void {
  void logger.warn('Failed to parse TRaSH cache row', {
    source: 'TRaSH:DisplayTransform',
    meta: {
      sourceType,
      sourceId: cache.sourceId,
      sourceName: cache.name,
      trashId: cache.trashId,
      error: reason,
    },
  });
}

export function parseCachedEntity<T extends TrashGuideEntityType>(
  cache: TrashGuideEntityCache,
  expectedEntityType: T
): ParsedTrashGuideEntityByType<T> | null {
  try {
    const parsed = JSON.parse(cache.jsonData);
    if (!isRecord(parsed)) {
      logMalformedCacheRow(cache, expectedEntityType, 'Invalid JSON object in TRaSH cache');
      return null;
    }

    if (!isExpectedEntity(parsed, expectedEntityType)) {
      const reason =
        typeof parsed.entity_type === 'string'
          ? `TRaSH cache row entity_type mismatch: expected ${expectedEntityType}, got ${parsed.entity_type}`
          : 'TRaSH cache row missing entity_type';
      logMalformedCacheRow(cache, expectedEntityType, reason);
      return null;
    }

    return parsed;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    logMalformedCacheRow(cache, expectedEntityType, 'Malformed JSON in TRaSH cache row');
    return null;
  }
}

export function toSourcedCustomFormatRow(
  cache: TrashGuideEntityCache,
  source: TrashGuideSourceRef
): CustomFormatTableRow | null {
  const entity = parseCachedEntity(cache, 'custom_format');
  if (!entity) return null;

  const target = source.arrType as ArrConditionTargetType;
  const conditions = Array.isArray(entity.specifications)
    ? entity.specifications.map((spec) => ({
        name: spec.name,
        type: spec.implementation,
        required: spec.required,
        negate: spec.negate,
      }))
    : [];

  return {
    id: toSyntheticId(source.id, cache.trashId),
    name: cache.name,
    description: typeof entity.description === 'string' ? entity.description : null,
    tags: [],
    conditions,
    arrTargets: [target],
    testCount: 0,
    ...toSourceFields(source, cache.trashId),
  };
}

function mapQualityItems(entity: TrashGuideQualityProfileEntity): QualityItem[] {
  const cutoff = entity.cutoff?.trim();

  return entity.items.map((item, index) => {
    const hasMultipleQualities = Array.isArray(item.qualities) && item.qualities.length > 1;
    const normalizedName = hasMultipleQualities ? item.name : (item.qualities[0] ?? item.name);

    return {
      position: index + 1,
      type: hasMultipleQualities ? 'group' : 'quality',
      name: normalizedName,
      is_upgrade_until:
        cutoff === normalizedName ||
        cutoff === item.name ||
        (Array.isArray(item.qualities) && item.qualities.includes(cutoff ?? '')),
    };
  });
}

export function toSourcedQualityProfileRow(
  cache: TrashGuideEntityCache,
  source: TrashGuideSourceRef
): QualityProfileTableRow | null {
  const entity = parseCachedEntity(cache, 'quality_profile');
  if (!entity) return null;

  const perArrTypeCount = Array.isArray(entity.format_items) ? entity.format_items.length : 0;

  return {
    id: toSyntheticId(source.id, cache.trashId),
    name: cache.name,
    description: parseMarkdown(typeof entity.description === 'string' ? entity.description : null),
    tags: [],
    upgrades_allowed: Boolean(entity.upgrade_allowed),
    minimum_custom_format_score: entity.min_format_score,
    upgrade_until_score: entity.cutoff_format_score,
    upgrade_score_increment: entity.min_upgrade_format_score,
    custom_formats: {
      all: 0,
      radarr: source.arrType === 'radarr' ? perArrTypeCount : 0,
      sonarr: source.arrType === 'sonarr' ? perArrTypeCount : 0,
      total: perArrTypeCount,
    },
    qualities: mapQualityItems(entity),
    language:
      typeof entity.language === 'string' && entity.language.trim().length > 0
        ? {
            name: entity.language,
            type: 'simple',
          }
        : undefined,
    ...toSourceFields(source, cache.trashId),
  };
}

export function toSourcedQualityDefinitionListItem(
  cache: TrashGuideEntityCache,
  source: TrashGuideSourceRef
): SourcedQualityDefinitionListItem | null {
  const entity = parseCachedEntity(cache, 'quality_size');
  if (!entity) return null;

  return {
    name: cache.name,
    arr_type: source.arrType,
    quality_count: Array.isArray(entity.qualities) ? entity.qualities.length : 0,
    updated_at: cache.fetchedAt,
    ...toSourceFields(source, cache.trashId),
  };
}

export function toSourcedNamingListItem(
  cache: TrashGuideEntityCache,
  source: TrashGuideSourceRef
): SourcedNamingListItem | null {
  const entity = parseCachedEntity(cache, 'naming');
  if (!entity) return null;

  return {
    name: cache.name,
    arr_type: source.arrType,
    rename: true,
    updated_at: cache.fetchedAt,
    ...toSourceFields(source, cache.trashId),
  };
}
