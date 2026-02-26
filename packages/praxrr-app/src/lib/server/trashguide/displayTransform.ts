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
  TrashGuideNamingEntity,
  TrashGuideQualityProfileEntity,
  TrashGuideQualitySizeEntity,
  TrashGuideSupportedArrType,
} from './types.ts';
import { parseMarkdown } from '$utils/markdown/markdown.ts';

export interface TrashGuideSourceRef {
  id: number;
  name: string;
  arrType: TrashGuideSupportedArrType;
}

interface SourcedResult {
  sourceType: 'trash';
  sourceDatabaseId: number;
  sourceDatabaseName: string;
}

function toSourceFields(source: TrashGuideSourceRef): SourcedResult {
  return {
    sourceType: 'trash',
    sourceDatabaseId: source.id,
    sourceDatabaseName: source.name,
  };
}

function toSyntheticId(sourceId: number, trashId: string): number {
  const parsed = Number.parseInt(trashId.slice(0, 8), 16);
  const suffix = Number.isFinite(parsed) ? parsed % 1_000_000 : 0;
  return -(sourceId * 1_000_000 + suffix + 1);
}

function parseCachedEntity<T extends object>(cache: TrashGuideEntityCache): T | null {
  try {
    const parsed = JSON.parse(cache.jsonData);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export function toSourcedCustomFormatRow(
  cache: TrashGuideEntityCache,
  source: TrashGuideSourceRef
): CustomFormatTableRow | null {
  const entity = parseCachedEntity<TrashGuideCustomFormatEntity>(cache);
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
    ...toSourceFields(source),
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
  const entity = parseCachedEntity<TrashGuideQualityProfileEntity>(cache);
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
    ...toSourceFields(source),
  };
}

export function toSourcedQualityDefinitionListItem(
  cache: TrashGuideEntityCache,
  source: TrashGuideSourceRef
): SourcedQualityDefinitionListItem | null {
  const entity = parseCachedEntity<TrashGuideQualitySizeEntity>(cache);
  if (!entity) return null;

  return {
    name: cache.name,
    arr_type: source.arrType,
    quality_count: Array.isArray(entity.qualities) ? entity.qualities.length : 0,
    updated_at: cache.fetchedAt,
    ...toSourceFields(source),
  };
}

export function toSourcedNamingListItem(
  cache: TrashGuideEntityCache,
  source: TrashGuideSourceRef
): SourcedNamingListItem | null {
  const entity = parseCachedEntity<TrashGuideNamingEntity>(cache);
  if (!entity) return null;

  return {
    name: cache.name,
    arr_type: source.arrType,
    rename: true,
    updated_at: cache.fetchedAt,
    ...toSourceFields(source),
  };
}
