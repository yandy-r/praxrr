/**
 * Entity Deserialization
 *
 * Creates entities from portable format by calling existing PCD create functions.
 * Used by clone (serialize → rename → deserialize) and import.
 */

import type { PCDCache, WriteResult } from '$pcd/index.ts';
import { getCache, ValidationError, type OperationLayer } from '$pcd/index.ts';
import type {
  PortableDelayProfile,
  PortableRegularExpression,
  PortableCustomFormat,
  PortableQualityProfile,
  PortableLidarrNaming,
  PortableLidarrMediaSettings,
  PortableLidarrMetadataProfile,
  PortableRadarrNaming,
  PortableSonarrNaming,
  PortableMediaSettings,
  PortableQualityDefinitions,
  PortableLidarrQualityDefinitions,
} from '$shared/pcd/portable.ts';
import * as delayProfileQueries from './delayProfiles/index.ts';
import * as regexQueries from './regularExpressions/index.ts';
import * as cfQueries from './customFormats/index.ts';
import * as qpQueries from './qualityProfiles/index.ts';
import * as namingQueries from './mediaManagement/naming/index.ts';
import * as mediaSettingsQueries from './mediaManagement/media-settings/index.ts';
import * as qualityDefsQueries from './mediaManagement/quality-definitions/index.ts';
import * as metadataProfilesQueries from './metadataProfiles/index.ts';
import { createLidarrNaming } from './mediaManagement/naming/create.ts';
import type { EntityType } from '$shared/pcd/portable.ts';
import type { ConditionData } from '$shared/pcd/display.ts';
import { logger } from '$logger/logger.ts';
import {
  normalizeLidarrMetadataProfileReleaseStatusRows,
  normalizeLidarrMetadataProfileTypeRows,
} from './metadataProfiles/normalize.ts';

// ============================================================================
// COMMON OPTIONS
// ============================================================================

interface DeserializeOptions<T> {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  portable: T;
  presenceCache?: PCDCache;
}

export interface EntityDeserializerOptions {
  databaseId: number;
  cache: PCDCache;
  layer: OperationLayer;
  data: unknown;
  /**
   * Repo base import only: the registered cache (all layers) the import's skip rule consults. A
   * reference absent from `cache` but present here names an entity the import skipped because a
   * user entity already holds that name; it cannot be written in the base layer, so the reference
   * is dropped with a warning instead of failing the whole import. Omit everywhere else.
   */
  presenceCache?: PCDCache;
}

export type EntityDeserializer = (options: EntityDeserializerOptions) => Promise<unknown>;

export interface DeserializeByEntityTypeOptions extends EntityDeserializerOptions {
  entityType: EntityType;
}

const ENTITY_DESERIALIZERS: Record<EntityType, EntityDeserializer> = {
  delay_profile: (options) => {
    return deserializeDelayProfile({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableDelayProfile>(options.data),
    });
  },
  regular_expression: (options) => {
    return deserializeRegularExpression({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableRegularExpression>(options.data),
    });
  },
  custom_format: (options) => {
    return deserializeCustomFormat({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableCustomFormat>(options.data),
      presenceCache: options.presenceCache,
    });
  },
  quality_profile: (options) => {
    return deserializeQualityProfile({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableQualityProfile>(options.data),
      presenceCache: options.presenceCache,
    });
  },
  radarr_naming: (options) => {
    return deserializeRadarrNaming({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableRadarrNaming>(options.data),
    });
  },
  sonarr_naming: (options) => {
    return deserializeSonarrNaming({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableSonarrNaming>(options.data),
    });
  },
  lidarr_naming: (options) => {
    return deserializeLidarrNaming({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableLidarrNaming>(options.data),
    });
  },
  radarr_media_settings: (options) => {
    return deserializeRadarrMediaSettings({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableMediaSettings>(options.data),
    });
  },
  sonarr_media_settings: (options) => {
    return deserializeSonarrMediaSettings({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableMediaSettings>(options.data),
    });
  },
  lidarr_media_settings: (options) => {
    return deserializeLidarrMediaSettings({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableLidarrMediaSettings>(options.data),
    });
  },
  radarr_quality_definitions: (options) => {
    return deserializeRadarrQualityDefinitions({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableQualityDefinitions>(options.data),
    });
  },
  sonarr_quality_definitions: (options) => {
    return deserializeSonarrQualityDefinitions({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableQualityDefinitions>(options.data),
    });
  },
  lidarr_quality_definitions: (options) => {
    return deserializeLidarrQualityDefinitions({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableLidarrQualityDefinitions>(options.data),
    });
  },
  lidarr_metadata_profile: (options) => {
    return deserializeLidarrMetadataProfile({
      databaseId: options.databaseId,
      cache: options.cache,
      layer: options.layer,
      portable: asPortableData<PortableLidarrMetadataProfile>(options.data),
    });
  },
};

/**
 * Cast helper for already-validated portable entity payloads.
 *
 * @precondition Call `validatePortableData` for the target entity type before invoking this helper.
 */
function asPortableData<T>(data: unknown): T {
  return data as unknown as T;
}

export function getEntityDeserializer(entityType: EntityType): EntityDeserializer {
  return ENTITY_DESERIALIZERS[entityType];
}

export async function deserializeByEntityType({
  databaseId,
  cache,
  layer,
  entityType,
  data,
}: DeserializeByEntityTypeOptions) {
  const handler = getEntityDeserializer(entityType);
  return handler({
    databaseId,
    cache,
    layer,
    data,
  });
}

// ============================================================================
// DELAY PROFILES
// ============================================================================

export async function deserializeDelayProfile(options: DeserializeOptions<PortableDelayProfile>) {
  const { databaseId, cache, layer, portable } = options;

  return delayProfileQueries.create({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// REGULAR EXPRESSIONS
// ============================================================================

export async function deserializeRegularExpression(options: DeserializeOptions<PortableRegularExpression>) {
  const { databaseId, cache, layer, portable } = options;

  return regexQueries.create({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// CUSTOM FORMATS
// ============================================================================

export async function deserializeCustomFormat(options: DeserializeOptions<PortableCustomFormat>): Promise<WriteResult> {
  const { databaseId, cache, layer } = options;

  // 0. Refuse before any write when a condition references an entity the database lacks: the
  // condition steps run after the format is created, so a late FK failure would leave it partial.
  const droppedRegexes = await userOnlyReferences(cache, options.presenceCache, {
    label: 'regular expression',
    table: 'regular_expressions',
    names: options.portable.conditions.flatMap(conditionRegexNames),
  });
  const referencesDropped = (condition: ConditionData) =>
    conditionRegexNames(condition).some((name) => droppedRegexes.has(name));
  const portable: PortableCustomFormat = {
    ...options.portable,
    conditions: options.portable.conditions.filter((condition) => !referencesDropped(condition)),
  };
  if (droppedRegexes.size > 0) {
    await logger.warn('Dropping custom format conditions on regular expressions that exist only in the user layer', {
      source: 'PCDImporter',
      meta: {
        databaseId,
        entity: portable.name,
        regularExpressions: [...droppedRegexes],
        droppedConditions: options.portable.conditions.filter(referencesDropped).map((condition) => condition.name),
      },
    });
  }
  await assertReferencesExist(cache, 'custom format', portable.name, [
    {
      label: 'regular expression',
      table: 'regular_expressions',
      names: portable.conditions.flatMap(conditionRegexNames),
    },
    { label: 'language', table: 'languages', names: portable.conditions.flatMap(conditionLanguageNames) },
  ]);

  // 1. Create the format
  const createResult = await cfQueries.create({
    databaseId,
    cache,
    layer,
    input: {
      name: portable.name,
      description: portable.description,
      includeInRename: portable.includeInRename,
      tags: portable.tags,
    },
  });
  if (!createResult.success) return createResult;

  // 2. Add conditions (empty originalConditions = all new)
  if (portable.conditions.length > 0) {
    const conditionsResult = await cfQueries.updateConditions({
      databaseId,
      cache: requireFreshCache(databaseId),
      layer,
      formatName: portable.name,
      originalConditions: [],
      conditions: portable.conditions,
    });
    if (!conditionsResult.success) return conditionsResult;
  }

  // 3. Add tests
  for (const test of portable.tests) {
    const testResult = await cfQueries.createTest({
      databaseId,
      layer,
      formatName: portable.name,
      input: {
        title: test.title,
        type: test.type,
        should_match: test.shouldMatch,
        description: test.description,
      },
    });
    if (!testResult.success) return testResult;
  }

  return createResult;
}

// ============================================================================
// QUALITY PROFILES
// ============================================================================

export async function deserializeQualityProfile(
  options: DeserializeOptions<PortableQualityProfile>
): Promise<WriteResult> {
  const { databaseId, cache, layer } = options;

  // 0. Refuse before any write when the profile references an entity the database lacks: the
  // qualities and scoring steps run after the profile is created, so a late FK failure would
  // leave a profile with default qualities and no scores.
  const droppedFormats = await userOnlyReferences(cache, options.presenceCache, {
    label: 'custom format',
    table: 'custom_formats',
    names: options.portable.customFormatScores.map((score) => score.customFormatName),
  });
  const portable: PortableQualityProfile = {
    ...options.portable,
    customFormatScores: options.portable.customFormatScores.filter(
      (score) => !droppedFormats.has(score.customFormatName)
    ),
  };
  if (droppedFormats.size > 0) {
    await logger.warn('Dropping quality profile scores for custom formats that exist only in the user layer', {
      source: 'PCDImporter',
      meta: {
        databaseId,
        entity: portable.name,
        customFormats: [...droppedFormats],
        droppedScores: options.portable.customFormatScores
          .filter((score) => droppedFormats.has(score.customFormatName))
          .map((score) => `${score.customFormatName}:${score.arrType}`),
      },
    });
  }
  await assertReferencesExist(cache, 'quality profile', portable.name, [
    {
      label: 'custom format',
      table: 'custom_formats',
      names: portable.customFormatScores.map((score) => score.customFormatName),
    },
    {
      label: 'quality',
      table: 'qualities',
      names: portable.orderedItems.flatMap((item) =>
        item.type === 'quality' ? [item.name] : (item.members ?? []).map((member) => member.name)
      ),
    },
    {
      label: 'language',
      table: 'languages',
      names: portable.language === null ? [] : [portable.language],
    },
  ]);

  // 1. Create the profile (sets up default qualities)
  const createResult = await qpQueries.create({
    databaseId,
    cache,
    layer,
    input: {
      name: portable.name,
      description: portable.description,
      tags: portable.tags,
      language: portable.language,
    },
  });
  if (!createResult.success) return createResult;

  // 2. Update qualities to match portable
  const qualitiesResult = await qpQueries.updateQualities({
    databaseId,
    cache: requireFreshCache(databaseId),
    layer,
    profileName: portable.name,
    input: { orderedItems: portable.orderedItems },
  });
  if (!qualitiesResult.success) return qualitiesResult;

  // 3. Update scoring
  const scoringResult = await qpQueries.updateScoring({
    databaseId,
    cache: requireFreshCache(databaseId),
    layer,
    profileName: portable.name,
    input: {
      minimumScore: portable.minimumScore,
      upgradeUntilScore: portable.upgradeUntilScore,
      upgradeScoreIncrement: portable.upgradeScoreIncrement,
      customFormatScores: portable.customFormatScores,
    },
  });
  if (!scoringResult.success) return scoringResult;

  return createResult;
}

// ============================================================================
// REFERENCE CHECKS
// ============================================================================

interface ReferenceSet {
  /** Human label used in the error message, e.g. "custom format". */
  label: string;
  table: 'custom_formats' | 'regular_expressions' | 'qualities' | 'languages';
  names: string[];
}

function requireFreshCache(databaseId: number): PCDCache {
  const freshCache = getCache(databaseId);
  if (!freshCache) throw new Error('Database cache not available');
  return freshCache;
}

/** Condition types whose regex the condition writer stores in `condition_patterns`. */
const PATTERN_CONDITION_TYPES: Record<string, true> = { release_title: true, release_group: true, edition: true };

/** Regex names the condition writer stores: pattern condition types only. */
function conditionRegexNames(condition: ConditionData): string[] {
  if (PATTERN_CONDITION_TYPES[condition.type] !== true) return [];
  return (condition.patterns ?? []).map((pattern) => pattern.name);
}

/** Language names the condition writer stores in `condition_languages`: `language` type only. */
function conditionLanguageNames(condition: ConditionData): string[] {
  if (condition.type !== 'language') return [];
  return (condition.languages ?? []).map((language) => language.name);
}

/** ASCII-only fold, matching SQLite's built-in `lower()`. */
function foldAscii(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/** Folded (`lower(name)`) names in `table` that match any of `names` case-insensitively. */
async function foldedNamesIn(cache: PCDCache, table: ReferenceSet['table'], names: string[]): Promise<Set<string>> {
  const rows = await cache.kb
    .selectFrom(table)
    .select((eb) => eb.fn<string>('lower', [eb.ref('name')]).as('folded'))
    .where((eb) => eb.fn('lower', [eb.ref('name')]), 'in', names.map(foldAscii))
    .execute();
  return new Set(rows.map((row) => row.folded));
}

/**
 * Repo base import only (`presenceCache` set): names in `reference` with no match at all, not even
 * case-insensitively, in the import cache but a case-insensitive match in `presenceCache`. The
 * import skipped those upstream entities because a user entity already holds the name (its skip
 * rule matches case-insensitively, so this does too), so a base-layer reference to them can never
 * be written; the caller drops just those references, logged, instead of failing the whole
 * link/sync. A name the import cache knows under different case is a repo typo and is not
 * dropped, so the reference pre-check rejects it the same way on link and on sync.
 */
async function userOnlyReferences(
  cache: PCDCache,
  presenceCache: PCDCache | undefined,
  reference: ReferenceSet
): Promise<Set<string>> {
  const wanted = [...new Set(reference.names)];
  if (!presenceCache || wanted.length === 0) return new Set();

  const inImport = await foldedNamesIn(cache, reference.table, wanted);
  const absent = wanted.filter((name) => !inImport.has(foldAscii(name)));
  if (absent.length === 0) return new Set();

  const inPresence = await foldedNamesIn(presenceCache, reference.table, absent);
  return new Set(absent.filter((name) => inPresence.has(foldAscii(name))));
}

/**
 * Throw a {@link ValidationError} naming every referenced entity absent from `cache`.
 *
 * Matching is exact (case-sensitive), the same semantics as the name-based foreign keys the later
 * write steps insert into. Callers pass the cache current at the time of the entity write, so a
 * dependency created earlier in the same bundle resolves.
 */
async function assertReferencesExist(
  cache: PCDCache,
  entityLabel: string,
  entityName: string,
  references: ReferenceSet[]
): Promise<void> {
  const missing: string[] = [];
  for (const { label, table, names } of references) {
    const wanted = [...new Set(names)];
    if (wanted.length === 0) continue;
    const rows = await cache.kb.selectFrom(table).select('name').where('name', 'in', wanted).execute();
    const found = new Set(rows.map((row) => row.name));
    for (const name of wanted) {
      if (!found.has(name)) missing.push(`${label} "${name}"`);
    }
  }
  if (missing.length > 0) {
    throw new ValidationError(`Cannot import ${entityLabel} "${entityName}": missing ${missing.join(', ')}`);
  }
}

// ============================================================================
// NAMING
// ============================================================================

export async function deserializeRadarrNaming(options: DeserializeOptions<PortableRadarrNaming>) {
  const { databaseId, cache, layer, portable } = options;

  return namingQueries.createRadarrNaming({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeSonarrNaming(options: DeserializeOptions<PortableSonarrNaming>) {
  const { databaseId, cache, layer, portable } = options;

  return namingQueries.createSonarrNaming({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeLidarrNaming(options: DeserializeOptions<PortableLidarrNaming>) {
  const { databaseId, cache, layer, portable } = options;

  return createLidarrNaming({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// MEDIA SETTINGS
// ============================================================================

export async function deserializeRadarrMediaSettings(options: DeserializeOptions<PortableMediaSettings>) {
  const { databaseId, cache, layer, portable } = options;

  return mediaSettingsQueries.createRadarrMediaSettings({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeSonarrMediaSettings(options: DeserializeOptions<PortableMediaSettings>) {
  const { databaseId, cache, layer, portable } = options;

  return mediaSettingsQueries.createSonarrMediaSettings({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeLidarrMediaSettings(options: DeserializeOptions<PortableLidarrMediaSettings>) {
  const { databaseId, cache, layer, portable } = options;

  return mediaSettingsQueries.createLidarrMediaSettings({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// QUALITY DEFINITIONS
// ============================================================================

export async function deserializeRadarrQualityDefinitions(options: DeserializeOptions<PortableQualityDefinitions>) {
  const { databaseId, cache, layer, portable } = options;

  return qualityDefsQueries.createRadarrQualityDefinitions({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeSonarrQualityDefinitions(options: DeserializeOptions<PortableQualityDefinitions>) {
  const { databaseId, cache, layer, portable } = options;

  return qualityDefsQueries.createSonarrQualityDefinitions({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

export async function deserializeLidarrQualityDefinitions(
  options: DeserializeOptions<PortableLidarrQualityDefinitions>
) {
  const { databaseId, cache, layer, portable } = options;

  return qualityDefsQueries.createLidarrQualityDefinitions({
    databaseId,
    cache,
    layer,
    input: portable,
  });
}

// ============================================================================
// LIDARR METADATA PROFILES
// ============================================================================

export async function deserializeLidarrMetadataProfile(options: DeserializeOptions<PortableLidarrMetadataProfile>) {
  const { databaseId, cache, layer, portable } = options;

  return metadataProfilesQueries.create({
    databaseId,
    cache,
    layer,
    input: {
      name: portable.name,
      description: portable.description,
      primaryAlbumTypes: normalizeLidarrMetadataProfileTypeRows('primary', portable.primaryTypes),
      secondaryAlbumTypes: normalizeLidarrMetadataProfileTypeRows('secondary', portable.secondaryTypes),
      releaseStatuses: normalizeLidarrMetadataProfileReleaseStatusRows(portable.releaseStatuses),
    },
  });
}
