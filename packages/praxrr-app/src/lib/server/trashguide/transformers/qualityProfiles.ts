import type { OrderedItem, QualityDefinitionEntry } from '$shared/pcd/display.ts';
import type {
  PortableCustomFormatScore,
  PortableQualityDefinitions,
  PortableQualityProfile,
} from '$shared/pcd/portable.ts';
import { getLanguageForProfile, getQuality, mapQualityName } from '$sync/mappings.ts';
import type {
  TrashGuideCustomFormatEntity,
  TrashGuideQualityProfileEntity,
  TrashGuideQualitySizeEntity,
  TrashGuideSupportedArrType,
} from '../types.ts';

export interface TrashGuideQualityProfileTransformContext {
  arrType: TrashGuideSupportedArrType;
  customFormatsByTrashId: ReadonlyMap<string, TrashGuideCustomFormatEntity>;
  customFormatsByName: ReadonlyMap<string, readonly TrashGuideCustomFormatEntity[]>;
}

export interface TrashGuideQualityDefinitionsTransformResult {
  portableEntityType: 'radarr_quality_definitions' | 'sonarr_quality_definitions';
  data: PortableQualityDefinitions;
}

interface OrderedItemDraft {
  item: OrderedItem;
  upgradeCandidate: boolean;
}

export function toPortableQualityProfile(
  entity: TrashGuideQualityProfileEntity,
  context: TrashGuideQualityProfileTransformContext
): PortableQualityProfile {
  if (entity.arr_type !== context.arrType) {
    throw new Error(
      `Quality profile "${entity.name}" arr_type "${entity.arr_type}" does not match transform arr_type "${context.arrType}"`
    );
  }

  return {
    name: entity.name,
    description: entity.description,
    tags: [],
    language: normalizeProfileLanguage(entity),
    orderedItems: toOrderedItems(entity),
    minimumScore: entity.min_format_score,
    upgradeUntilScore: entity.cutoff_format_score,
    upgradeScoreIncrement: entity.min_upgrade_format_score,
    customFormatScores: toCustomFormatScores(entity, context),
  };
}

export function toPortableQualityDefinitions(
  entity: TrashGuideQualitySizeEntity,
  arrType: TrashGuideSupportedArrType
): TrashGuideQualityDefinitionsTransformResult {
  if (entity.arr_type !== arrType) {
    throw new Error(
      `Quality-size "${entity.name}" arr_type "${entity.arr_type}" does not match transform arr_type "${arrType}"`
    );
  }

  if (arrType === 'sonarr' && entity.profile_type === 'movie') {
    throw new Error(
      `Quality-size "${entity.name}" profile_type "${entity.profile_type}" is incompatible with arr_type "${arrType}"`
    );
  }

  const entriesByQuality = new Map<string, { qualityId: number; entry: QualityDefinitionEntry }>();
  for (const quality of entity.qualities) {
    const resolved = resolveQualityName(quality.quality, arrType, `${entity.name}:quality-size`);
    if (entriesByQuality.has(resolved.name)) {
      throw new Error(
        `Ambiguous quality-size mapping for "${entity.name}": quality "${quality.quality}" resolves to duplicate "${resolved.name}"`
      );
    }
    entriesByQuality.set(resolved.name, {
      qualityId: resolved.id,
      entry: {
        quality_name: resolved.name,
        min_size: quality.min,
        preferred_size: quality.preferred,
        max_size: quality.max,
      },
    });
  }

  const entries = [...entriesByQuality.values()].sort((a, b) => a.qualityId - b.qualityId).map((row) => row.entry);

  return {
    portableEntityType: arrType === 'radarr' ? 'radarr_quality_definitions' : 'sonarr_quality_definitions',
    data: {
      name: entity.name,
      entries,
    },
  };
}

function normalizeProfileLanguage(entity: TrashGuideQualityProfileEntity): string | null {
  if (entity.arr_type !== 'radarr') {
    return null;
  }

  const resolved = getLanguageForProfile(entity.language ?? 'any', entity.arr_type).name;
  return resolved === 'Any' ? null : resolved;
}

function toOrderedItems(entity: TrashGuideQualityProfileEntity): OrderedItem[] {
  const rawCutoff = entity.cutoff.trim();
  if (rawCutoff.length === 0) {
    throw new Error(`Quality profile "${entity.name}" has an empty cutoff`);
  }

  const normalizedCutoff = resolveQualityNameOrNull(rawCutoff, entity.arr_type);
  const drafts: OrderedItemDraft[] = entity.items.map((item, index) => {
    const qualityCandidates = item.qualities.length > 0 ? item.qualities : [item.name];
    const mappedQualities = normalizeQualityList(qualityCandidates, entity.arr_type, `${entity.name}:${item.name}`);
    if (mappedQualities.length === 0) {
      throw new Error(`Quality profile "${entity.name}" item "${item.name}" does not contain any qualities`);
    }

    const position = index + 1;
    if (mappedQualities.length === 1) {
      const qualityName = mappedQualities[0];
      return {
        item: {
          type: 'quality',
          name: qualityName,
          position,
          enabled: item.allowed,
          upgradeUntil: false,
          members: [],
        },
        upgradeCandidate:
          qualityName === normalizedCutoff ||
          item.name.trim().localeCompare(rawCutoff, undefined, { sensitivity: 'accent' }) === 0,
      } satisfies OrderedItemDraft;
    }

    const groupName = item.name.trim();
    if (groupName.length === 0) {
      throw new Error(`Quality profile "${entity.name}" includes a group item with an empty name`);
    }

    return {
      item: {
        type: 'group',
        name: groupName,
        position,
        enabled: item.allowed,
        upgradeUntil: false,
        members: mappedQualities.map((name) => ({ name })),
      },
      upgradeCandidate:
        groupName.localeCompare(rawCutoff, undefined, { sensitivity: 'accent' }) === 0 ||
        (normalizedCutoff !== null && mappedQualities.includes(normalizedCutoff)),
    } satisfies OrderedItemDraft;
  });

  const upgradeCandidates = drafts.filter((row) => row.upgradeCandidate);
  if (upgradeCandidates.length === 0) {
    throw new Error(
      `Quality profile "${entity.name}" cutoff "${entity.cutoff}" did not resolve to any quality or quality group`
    );
  }
  if (upgradeCandidates.length > 1) {
    throw new Error(
      `Ambiguous cutoff mapping for quality profile "${entity.name}": "${entity.cutoff}" matched multiple quality rows`
    );
  }

  const selected = upgradeCandidates[0];
  return drafts.map((row) => ({
    ...row.item,
    upgradeUntil: row === selected,
  }));
}

function toCustomFormatScores(
  entity: TrashGuideQualityProfileEntity,
  context: TrashGuideQualityProfileTransformContext
): PortableCustomFormatScore[] {
  const scoreSet = normalizeScoreSet(entity.score_set);
  const scoresByCustomFormat = new Map<string, PortableCustomFormatScore>();

  for (const item of entity.format_items) {
    const resolved = resolveCustomFormatReference(entity, item, context);
    if (resolved.customFormat === null && item.score === null) {
      continue;
    }

    if (scoresByCustomFormat.has(resolved.customFormatName)) {
      throw new Error(
        `Ambiguous custom format score mapping for profile "${entity.name}": duplicate format "${resolved.customFormatName}"`
      );
    }
    const score =
      item.score !== null
        ? item.score
        : resolveScoreFromCustomFormat(entity, resolved.customFormat, scoreSet, item.custom_format_trash_id);

    scoresByCustomFormat.set(resolved.customFormatName, {
      customFormatName: resolved.customFormatName,
      arrType: entity.arr_type,
      score,
    });
  }

  return [...scoresByCustomFormat.values()].sort((a, b) => {
    if (a.customFormatName !== b.customFormatName) {
      return a.customFormatName.localeCompare(b.customFormatName);
    }
    return a.arrType.localeCompare(b.arrType);
  });
}

function normalizeScoreSet(value: string | null): string {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : 'default';
}

function resolveCustomFormatReference(
  entity: TrashGuideQualityProfileEntity,
  item: TrashGuideQualityProfileEntity['format_items'][number],
  context: TrashGuideQualityProfileTransformContext
): { customFormatName: string; customFormat: TrashGuideCustomFormatEntity | null } {
  const statedName = item.name.trim();
  if (statedName.length === 0) {
    throw new Error(`Quality profile "${entity.name}" contains an empty custom format name entry`);
  }

  let resolvedFromTrashId: TrashGuideCustomFormatEntity | null = null;
  if (item.custom_format_trash_id !== null) {
    const mapped = context.customFormatsByTrashId.get(item.custom_format_trash_id.toLowerCase());
    if (!mapped) {
      const fallbackByName = context.customFormatsByName.get(statedName.toLowerCase());
      if (!fallbackByName || fallbackByName.length === 0) {
        return {
          customFormatName: statedName,
          customFormat: null,
        };
      }
      if (fallbackByName.length > 1) {
        throw new Error(
          `Ambiguous custom format reference in profile "${entity.name}": name "${statedName}" matches multiple custom formats`
        );
      }
      resolvedFromTrashId = fallbackByName[0];
    } else {
      resolvedFromTrashId = mapped;
    }
  }

  if (resolvedFromTrashId !== null && statedName !== resolvedFromTrashId.name) {
    return {
      customFormatName: resolvedFromTrashId.name,
      customFormat: resolvedFromTrashId,
    };
  }

  if (item.custom_format_trash_id !== null && item.score !== null) {
    throw new Error(
      `Ambiguous custom format score mapping in profile "${entity.name}": item "${statedName}" includes both score and trash_id`
    );
  }

  return {
    customFormatName: resolvedFromTrashId?.name ?? statedName,
    customFormat: resolvedFromTrashId,
  };
}

function resolveScoreFromCustomFormat(
  entity: TrashGuideQualityProfileEntity,
  customFormat: TrashGuideCustomFormatEntity | null,
  scoreSet: string,
  customFormatTrashId: string | null
): number {
  if (!customFormat || customFormatTrashId === null) {
    throw new Error(
      `Quality profile "${entity.name}" has a format item without explicit score and without a resolvable custom format trash_id`
    );
  }

  const scoreBySet = customFormat.scores[scoreSet];
  if (typeof scoreBySet === 'number' && Number.isFinite(scoreBySet)) {
    return scoreBySet;
  }

  const fallbackScore = customFormat.scores.default;
  if (typeof fallbackScore === 'number' && Number.isFinite(fallbackScore)) {
    return fallbackScore;
  }

  return 0;
}

function normalizeQualityList(
  qualities: readonly string[],
  arrType: TrashGuideSupportedArrType,
  context: string
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const quality of qualities) {
    const resolved = resolveQualityName(quality, arrType, context).name;
    if (seen.has(resolved)) {
      throw new Error(
        `Ambiguous quality mapping for "${context}": duplicate quality "${resolved}" after normalization`
      );
    }
    seen.add(resolved);
    normalized.push(resolved);
  }
  return normalized;
}

function resolveQualityName(
  value: string,
  arrType: TrashGuideSupportedArrType,
  context: string
): { name: string; id: number } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`Missing quality value in ${context}`);
  }

  const mappedName = mapQualityName(trimmed, arrType);
  const resolved = getQuality(mappedName, arrType);
  if (!resolved) {
    throw new Error(
      `Unknown quality "${value}" in ${context} for arr_type "${arrType}" after normalization to "${mappedName}"`
    );
  }

  return {
    name: resolved.name,
    id: resolved.id,
  };
}

function resolveQualityNameOrNull(value: string, arrType: TrashGuideSupportedArrType): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const mappedName = mapQualityName(trimmed, arrType);
  return getQuality(mappedName, arrType)?.name ?? null;
}
