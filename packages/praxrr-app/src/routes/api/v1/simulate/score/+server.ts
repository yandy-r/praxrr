import { json, error, type RequestHandler } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { parseWithCacheBatch, isParserHealthy, matchPatternsBatch } from '$lib/server/utils/arr/parser/index.ts';
import {
  getAllConditionsForEvaluation,
  evaluateCustomFormat,
  evaluateCustomFormatWithoutParse,
  getParsedInfo,
  extractAllPatterns,
} from '$pcd/entities/customFormats/index.ts';
import { scoring, QualityProfileScoringNotFoundError } from '$pcd/entities/qualityProfiles/index.ts';
import { inferAnimeSourceFromFormats } from '$pcd/simulate/animeInference.ts';
import { isArrType, isReleaseType, parseProfileSelector } from '$pcd/simulate/selectors.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { trashGuideSourcesQueries } from '$db/queries/trashGuideSources.ts';
import { trashIdMappingsQueries } from '$db/queries/trashIdMappings.ts';
import { parseCachedEntity } from '$lib/server/trashguide/displayTransform.ts';
import { discoverTrashGuideFiles } from '$lib/server/trashguide/fetcher.ts';
import { parseTrashGuideEntities } from '$lib/server/trashguide/parser.ts';
import { cache } from '$cache/cache.ts';
import { logger } from '$logger/logger.ts';
import type {
  TrashGuideCfGroupEntity,
  TrashGuideCustomFormatEntity,
  TrashGuideCustomFormatSpecification,
  TrashGuideQualityProfileEntity,
} from '$lib/server/trashguide/types.ts';
import type { components } from '$api/v1.d.ts';
import type { ConditionData, CustomFormatWithConditions } from '$shared/pcd/display.ts';

type SimulateScoreRequest = components['schemas']['SimulateScoreRequest'];
type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];
type SimulateReleaseResult = components['schemas']['SimulateReleaseResult'];
type SimulateCfMatch = components['schemas']['SimulateCfMatch'];
type SimulateProfileScore = components['schemas']['SimulateProfileScore'];
type SimulateScoreContribution = components['schemas']['SimulateScoreContribution'];
type PcdProfileScoreData = Awaited<ReturnType<typeof scoring>>;

const FALLBACK_CF_GROUPS_TTL = 600; // 10 minutes

interface ResolvedPcdProfile {
  kind: 'pcd';
  requestKey: string;
  pcdName: string;
  scoreData: PcdProfileScoreData;
}

interface ResolvedTrashProfile {
  kind: 'trash';
  requestKey: string;
  sourceId: number;
  trashName: string;
  entity: TrashGuideQualityProfileEntity;
}

type ResolvedProfile = ResolvedPcdProfile | ResolvedTrashProfile;

function groupIncludesProfile(group: TrashGuideCfGroupEntity, profile: ResolvedTrashProfile): boolean {
  const includeEntries = Object.entries(group.quality_profiles.include);
  return includeEntries.some(
    ([profileName, profileTrashId]) =>
      profileName === profile.trashName || profileTrashId.toLowerCase() === profile.entity.trash_id.toLowerCase()
  );
}

function normalizeTrashScoreSet(value: string | null): string {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : 'default';
}

function resolveTrashScoreFromCustomFormat(
  customFormat: TrashGuideCustomFormatEntity | null,
  scoreSet: string
): number | null {
  if (!customFormat) {
    return null;
  }

  const bySet = customFormat.scores[scoreSet];
  if (typeof bySet === 'number' && Number.isFinite(bySet)) {
    return bySet;
  }

  const fallback = customFormat.scores.default;
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return fallback;
  }

  return null;
}

function normalizeCfKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function readOptionalStringField(fields: Readonly<Record<string, unknown>>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function readRequiredStringField(
  fields: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  context: string,
  fallback?: string
): string {
  const fallbackValue = typeof fallback === 'string' ? fallback.trim() : '';
  const value = readOptionalStringField(fields, keys);
  if (value !== null) {
    return value;
  }

  if (fallbackValue.length > 0) {
    return fallbackValue;
  }

  throw error(500, `Missing required TRaSH specification string field (${keys.join(', ')}) for ${context}`);
}

function readOptionalNumberField(fields: Readonly<Record<string, unknown>>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function readOptionalBooleanField(
  fields: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  fallback: boolean
): boolean {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }

  return fallback;
}

// Radarr QualitySource enum → canonical name (matches parser enum values)
const radarrSourceById: Record<number, string> = {
  0: 'unknown',
  1: 'cam',
  2: 'telesync',
  3: 'telecine',
  4: 'workprint',
  5: 'dvd',
  6: 'television',
  7: 'webdl',
  8: 'webrip',
  9: 'bluray',
};

// Sonarr QualitySource enum → canonical name (different numbering from Radarr)
const sonarrSourceById: Record<number, string> = {
  0: 'unknown',
  1: 'television',
  2: 'television',
  3: 'webdl',
  4: 'webrip',
  5: 'dvd',
  6: 'bluray',
  7: 'bluray',
};

// Resolution enum → canonical name (same across Sonarr/Radarr, uses pixel counts)
const resolutionById: Record<number, string> = {
  0: 'unknown',
  360: '360p',
  480: '480p',
  540: '540p',
  576: '576p',
  720: '720p',
  1080: '1080p',
  2160: '2160p',
};

// QualityModifier enum → canonical name (same across Sonarr/Radarr)
const modifierById: Record<number, string> = {
  0: 'none',
  1: 'regional',
  2: 'screener',
  3: 'rawhd',
  4: 'brdisk',
  5: 'remux',
};

// ReleaseType enum → canonical name (Sonarr-specific, Radarr doesn't use)
const releaseTypeById: Record<number, string> = {
  0: 'unknown',
  1: 'single_episode',
  2: 'multi_episode',
  3: 'season_pack',
};

// Language enum → canonical name (same across Sonarr/Radarr, includes special IDs)
const languageById: Record<number, string> = {
  [-2]: 'Original',
  [-1]: 'Any',
  0: 'Unknown',
  1: 'English',
  2: 'French',
  3: 'Spanish',
  4: 'German',
  5: 'Italian',
  6: 'Danish',
  7: 'Dutch',
  8: 'Japanese',
  9: 'Icelandic',
  10: 'Chinese',
  11: 'Russian',
  12: 'Polish',
  13: 'Vietnamese',
  14: 'Swedish',
  15: 'Norwegian',
  16: 'Finnish',
  17: 'Turkish',
  18: 'Portuguese',
  19: 'Flemish',
  20: 'Greek',
  21: 'Korean',
  22: 'Hungarian',
  23: 'Hebrew',
  24: 'Lithuanian',
  25: 'Czech',
  26: 'Hindi',
  27: 'Romanian',
  28: 'Thai',
  29: 'Bulgarian',
  30: 'Portuguese (BR)',
  31: 'Arabic',
  32: 'Ukrainian',
  33: 'Persian',
  34: 'Bengali',
  35: 'Slovak',
  36: 'Latvian',
  37: 'Spanish (Latino)',
  38: 'Catalan',
  39: 'Croatian',
  40: 'Serbian',
  41: 'Bosnian',
  42: 'Estonian',
  43: 'Tamil',
  44: 'Indonesian',
  45: 'Telugu',
  46: 'Macedonian',
  47: 'Slovenian',
  48: 'Malayalam',
  49: 'Kannada',
  50: 'Albanian',
  51: 'Afrikaans',
  52: 'Marathi',
  53: 'Tagalog',
  54: 'Urdu',
  55: 'Romansh',
  56: 'Mongolian',
  57: 'Georgian',
  58: 'Original',
};

function resolveNumericEnum(rawValue: string, map: Record<number, string>, fallback: string): string {
  if (/^-?\d+$/.test(rawValue)) {
    return map[Number(rawValue)] ?? fallback;
  }
  return rawValue;
}

function getSourceMap(arrType: string): Record<number, string> {
  return arrType === 'sonarr' ? sonarrSourceById : radarrSourceById;
}

function mapSpecificationImplementation(value: string): ConditionData['type'] {
  switch (value) {
    case 'ReleaseTitleSpecification':
      return 'release_title';
    case 'LanguageSpecification':
      return 'language';
    case 'SourceSpecification':
      return 'source';
    case 'ResolutionSpecification':
      return 'resolution';
    case 'QualityModifierSpecification':
      return 'quality_modifier';
    case 'ReleaseTypeSpecification':
      return 'release_type';
    case 'IndexerFlagSpecification':
      return 'indexer_flag';
    case 'SizeSpecification':
      return 'size';
    case 'YearSpecification':
      return 'year';
    case 'EditionSpecification':
      return 'edition';
    case 'ReleaseGroupSpecification':
      return 'release_group';
    default:
      throw error(500, `Unsupported TRaSH specification implementation "${value}"`);
  }
}

function toConditionData(
  entity: TrashGuideCustomFormatEntity,
  spec: TrashGuideCustomFormatSpecification
): ConditionData {
  const normalizedType = mapSpecificationImplementation(spec.implementation);
  const base: ConditionData = {
    name: spec.name,
    type: normalizedType,
    arrType: entity.arr_type,
    negate: spec.negate,
    required: spec.required,
  };
  const context = `${entity.name}:${spec.name}`;

  switch (normalizedType) {
    case 'release_title':
    case 'edition':
    case 'release_group':
      return {
        ...base,
        patterns: [
          {
            name: spec.name,
            pattern: readRequiredStringField(spec.fields, ['value', 'pattern', 'regex'], context),
          },
        ],
      };
    case 'language': {
      const rawLang = readRequiredStringField(spec.fields, ['value'], context, spec.name);
      return {
        ...base,
        languages: [
          {
            name: resolveNumericEnum(rawLang, languageById, rawLang),
            except: readOptionalBooleanField(spec.fields, ['exceptLanguage'], false),
          },
        ],
      };
    }
    case 'source': {
      const rawSource = readRequiredStringField(spec.fields, ['value'], context, spec.name);
      return {
        ...base,
        sources: [resolveNumericEnum(rawSource, getSourceMap(entity.arr_type), rawSource)],
      };
    }
    case 'resolution': {
      const rawRes = readRequiredStringField(spec.fields, ['value'], context, spec.name);
      return {
        ...base,
        resolutions: [resolveNumericEnum(rawRes, resolutionById, rawRes)],
      };
    }
    case 'quality_modifier': {
      const rawMod = readRequiredStringField(spec.fields, ['value'], context, spec.name);
      return {
        ...base,
        qualityModifiers: [resolveNumericEnum(rawMod, modifierById, rawMod)],
      };
    }
    case 'release_type': {
      const rawRt = readRequiredStringField(spec.fields, ['value'], context, spec.name);
      return {
        ...base,
        releaseTypes: [resolveNumericEnum(rawRt, releaseTypeById, rawRt)],
      };
    }
    case 'indexer_flag':
      return {
        ...base,
        indexerFlags: [readRequiredStringField(spec.fields, ['value'], context, spec.name)],
      };
    case 'size':
      return {
        ...base,
        size: {
          minBytes: readOptionalNumberField(spec.fields, ['min', 'minSize', 'minimum']),
          maxBytes: readOptionalNumberField(spec.fields, ['max', 'maxSize', 'maximum']),
        },
      };
    case 'year':
      return {
        ...base,
        years: {
          minYear: readOptionalNumberField(spec.fields, ['min', 'minimum']),
          maxYear: readOptionalNumberField(spec.fields, ['max', 'maximum']),
        },
      };
  }

  throw error(500, `Unsupported normalized condition type: ${normalizedType}`);
}

async function loadFallbackCfGroups(
  sourceId: number,
  arrType: SimulateScoreRequest['arrType']
): Promise<TrashGuideCfGroupEntity[]> {
  const cacheKey = `simulate:cfgroups:${sourceId}`;
  const cached = cache.get<TrashGuideCfGroupEntity[]>(cacheKey);
  if (cached) {
    return cached;
  }

  let source;
  try {
    source = trashGuideSourcesQueries.getById(sourceId);
  } catch (err) {
    await logger.warn('TRaSH source lookup failed during score simulation', {
      source: 'SimulateScoreRoute',
      meta: {
        sourceId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return [];
  }

  if (!source || source.arr_type !== arrType) {
    cache.set(cacheKey, [], FALLBACK_CF_GROUPS_TTL);
    return [];
  }

  try {
    const discovery = await discoverTrashGuideFiles({
      local_path: source.local_path,
      arr_type: source.arr_type,
    });
    const parsed = await parseTrashGuideEntities({
      arr_type: source.arr_type,
      discovery,
    });
    const fallbackGroups = [...parsed.entities.custom_format_groups];
    cache.set(cacheKey, fallbackGroups, FALLBACK_CF_GROUPS_TTL);

    if (fallbackGroups.length > 0) {
      await logger.info('Loaded fallback TRaSH CF groups for score simulation', {
        source: 'SimulateScoreRoute',
        meta: {
          sourceId,
          arrType,
          groupCount: fallbackGroups.length,
        },
      });
    }

    return fallbackGroups;
  } catch (err) {
    await logger.warn('Failed to load fallback TRaSH CF groups for score simulation', {
      source: 'SimulateScoreRoute',
      meta: {
        sourceId,
        arrType,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return [];
  }
}

export const POST: RequestHandler = async ({ request }) => {
  let body: SimulateScoreRequest;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid request body: expected valid JSON');
  }
  const { databaseId, releases, profileNames, arrType } = body;

  if (typeof databaseId !== 'number' || !Number.isFinite(databaseId)) {
    throw error(400, 'databaseId must be a finite number');
  }

  if (!isArrType(arrType)) {
    throw error(400, 'Invalid arrType. Expected one of: radarr, sonarr');
  }

  if (!Array.isArray(profileNames) || profileNames.length === 0) {
    throw error(400, 'Missing or empty profileNames array');
  }

  if (profileNames.length > 10) {
    throw error(400, 'profileNames exceeds maximum of 10');
  }

  if (!Array.isArray(releases) || releases.length === 0) {
    throw error(400, 'Missing or empty releases array');
  }

  if (releases.length > 50) {
    throw error(400, 'releases exceeds maximum of 50');
  }

  for (let i = 0; i < releases.length; i++) {
    const release = releases[i];
    if (typeof release !== 'object' || release === null) {
      throw error(400, `releases[${i}]: must be an object`);
    }
    if (typeof release.title !== 'string' || release.title.trim() === '') {
      throw error(400, `releases[${i}].title: must be a non-empty string`);
    }
    if (!isReleaseType(release.type)) {
      throw error(400, `releases[${i}].type: must be one of "movie", "series"`);
    }
  }

  for (const selector of profileNames) {
    parseProfileSelector(selector);
  }

  const parserAvailable = await isParserHealthy();
  if (!parserAvailable) {
    return json({
      parserAvailable: false,
      results: [],
    } satisfies SimulateScoreResponse);
  }

  const parseItems = releases.map((release) => ({
    title: release.title,
    type: release.type,
  }));
  const parseResults = await parseWithCacheBatch(parseItems);

  const cache = pcdManager.getCache(databaseId);
  if (!cache) {
    throw error(404, 'Database not found or cache not available');
  }

  const sourceById = new Map(trashGuideManager.listSources().map((source) => [source.id, source]));
  const resolvedProfiles: ResolvedProfile[] = [];
  const missingProfiles: string[] = [];

  for (const profileSelector of profileNames) {
    const parsedSelector = parseProfileSelector(profileSelector);

    if (parsedSelector.kind === 'pcd') {
      try {
        const scoreData = await scoring(cache, databaseId, parsedSelector.name);
        resolvedProfiles.push({
          kind: 'pcd',
          requestKey: profileSelector,
          pcdName: parsedSelector.name,
          scoreData,
        });
      } catch (err) {
        if (err instanceof QualityProfileScoringNotFoundError) {
          missingProfiles.push(profileSelector);
        } else {
          throw error(500, `Failed to load scoring data for profile "${parsedSelector.name}"`);
        }
      }
      continue;
    }

    const source = sourceById.get(parsedSelector.sourceId);
    if (!source || source.arrType !== arrType) {
      missingProfiles.push(profileSelector);
      continue;
    }

    const cachedEntity = trashGuideEntityCacheQueries
      .getBySourceAndType(parsedSelector.sourceId, 'quality_profile')
      .find((entity) => entity.name === parsedSelector.name);

    if (!cachedEntity) {
      missingProfiles.push(profileSelector);
      continue;
    }

    const parsedEntity = parseCachedEntity(cachedEntity, 'quality_profile');
    if (!parsedEntity) {
      missingProfiles.push(profileSelector);
      continue;
    }

    resolvedProfiles.push({
      kind: 'trash',
      requestKey: profileSelector,
      sourceId: parsedSelector.sourceId,
      trashName: parsedSelector.name,
      entity: parsedEntity,
    });
  }

  if (missingProfiles.length > 0) {
    return json(
      {
        error: 'Quality profiles not found',
        missing: missingProfiles,
      },
      { status: 404 }
    );
  }

  const trashCustomFormatsBySource = new Map<number, Map<string, TrashGuideCustomFormatEntity>>();
  const trashCustomFormatsByNameBySource = new Map<number, Map<string, TrashGuideCustomFormatEntity[]>>();
  const trashProfilesBySource = new Map<number, ResolvedTrashProfile[]>();
  const trashSourceIds = new Set<number>();
  for (const profile of resolvedProfiles) {
    if (profile.kind === 'trash') {
      trashSourceIds.add(profile.sourceId);
      const existing = trashProfilesBySource.get(profile.sourceId);
      if (existing) {
        existing.push(profile);
      } else {
        trashProfilesBySource.set(profile.sourceId, [profile]);
      }
    }
  }

  const trashCfGroupsBySource = new Map<number, TrashGuideCfGroupEntity[]>();

  for (const sourceId of trashSourceIds) {
    const byTrashId = new Map<string, TrashGuideCustomFormatEntity>();
    const byName = new Map<string, TrashGuideCustomFormatEntity[]>();
    const cachedCustomFormats = trashGuideEntityCacheQueries.getBySourceAndType(sourceId, 'custom_format');
    for (const cachedCustomFormat of cachedCustomFormats) {
      const parsedCustomFormat = parseCachedEntity(cachedCustomFormat, 'custom_format');
      if (!parsedCustomFormat) {
        continue;
      }

      byTrashId.set(parsedCustomFormat.trash_id.toLowerCase(), parsedCustomFormat);
      const nameKey = parsedCustomFormat.name.trim().toLowerCase();
      if (nameKey.length > 0) {
        const existing = byName.get(nameKey);
        if (existing) {
          existing.push(parsedCustomFormat);
        } else {
          byName.set(nameKey, [parsedCustomFormat]);
        }
      }
    }
    trashCustomFormatsBySource.set(sourceId, byTrashId);
    trashCustomFormatsByNameBySource.set(sourceId, byName);

    const cfGroups: TrashGuideCfGroupEntity[] = [];
    const cachedGroups = trashGuideEntityCacheQueries.getBySourceAndType(sourceId, 'custom_format_group');
    for (const cachedGroup of cachedGroups) {
      const parsedGroup = parseCachedEntity(cachedGroup, 'custom_format_group');
      if (parsedGroup) {
        cfGroups.push(parsedGroup);
      }
    }

    const sourceProfiles = trashProfilesBySource.get(sourceId) ?? [];
    const missingGroupCoverage = sourceProfiles.some(
      (profile) => !cfGroups.some((group) => groupIncludesProfile(group, profile))
    );

    if (cfGroups.length === 0 || missingGroupCoverage) {
      const fallbackGroups = await loadFallbackCfGroups(sourceId, arrType);
      if (fallbackGroups.length > 0) {
        const merged = new Map<string, TrashGuideCfGroupEntity>();
        for (const group of cfGroups) {
          merged.set(group.trash_id.toLowerCase(), group);
        }
        for (const group of fallbackGroups) {
          merged.set(group.trash_id.toLowerCase(), group);
        }
        cfGroups.length = 0;
        cfGroups.push(...merged.values());
      }
    }

    trashCfGroupsBySource.set(sourceId, cfGroups);
  }

  const trashScoreMapsByRequestKey = new Map<string, Map<string, number>>();
  const trashMappingNamesBySource = new Map<number, Map<string, string>>();
  for (const sourceId of trashSourceIds) {
    const source = sourceById.get(sourceId);
    if (!source) {
      continue;
    }

    const rows = trashIdMappingsQueries.getBySource(sourceId, source.arrType);
    const byTrashId = new Map<string, string>();
    for (const row of rows) {
      if (row.entityType !== 'custom_format') {
        continue;
      }
      byTrashId.set(row.trashId.toLowerCase(), row.entityName);
    }
    trashMappingNamesBySource.set(sourceId, byTrashId);
  }

  const pcdCustomFormatNames = new Set<string>();
  for (const profile of resolvedProfiles) {
    if (profile.kind !== 'pcd') {
      continue;
    }

    for (const customFormat of profile.scoreData.customFormats) {
      const name = customFormat.name.trim();
      if (name.length > 0) {
        pcdCustomFormatNames.add(name);
      }
    }
  }

  const allPcdCustomFormats = await getAllConditionsForEvaluation(cache);
  const pcdCustomFormatsByName = new Map(allPcdCustomFormats.map((customFormat) => [customFormat.name, customFormat]));

  // PCD formats keyed by their normalised name — scoped to PCD only.
  const pcdCustomFormatsByKey = new Map<string, CustomFormatWithConditions>();

  for (const customFormatName of pcdCustomFormatNames) {
    const customFormat = pcdCustomFormatsByName.get(customFormatName);
    if (!customFormat) {
      continue;
    }

    pcdCustomFormatsByKey.set(normalizeCfKey(customFormat.name), {
      name: customFormat.name,
      conditions: customFormat.conditions,
    });
  }

  // TRaSH formats stored per source so they never share a key-space with PCD.
  const trashCustomFormatsByKeyBySource = new Map<number, Map<string, CustomFormatWithConditions>>();

  for (const profile of resolvedProfiles) {
    if (profile.kind !== 'trash') {
      continue;
    }

    const scoreByCfName = new Map<string, number>();
    const scoreByCfKey = new Map<string, number>();
    const scoreSet = normalizeTrashScoreSet(profile.entity.score_set);
    const customFormatsByTrashId = trashCustomFormatsBySource.get(profile.sourceId) ?? new Map();
    const customFormatsByName = trashCustomFormatsByNameBySource.get(profile.sourceId) ?? new Map();
    const mappedNamesByTrashId = trashMappingNamesBySource.get(profile.sourceId) ?? new Map();

    // Lazily create the per-source CF definitions map.
    if (!trashCustomFormatsByKeyBySource.has(profile.sourceId)) {
      trashCustomFormatsByKeyBySource.set(profile.sourceId, new Map());
    }
    const trashCfsByKey = trashCustomFormatsByKeyBySource.get(profile.sourceId)!;

    for (const formatItem of profile.entity.format_items) {
      const statedName = formatItem.name.trim();
      if (statedName.length === 0) {
        continue;
      }

      let referencedCustomFormat: TrashGuideCustomFormatEntity | null = null;
      if (formatItem.custom_format_trash_id !== null) {
        referencedCustomFormat = customFormatsByTrashId.get(formatItem.custom_format_trash_id.toLowerCase()) ?? null;
      }
      if (!referencedCustomFormat) {
        const byName = customFormatsByName.get(statedName.toLowerCase()) ?? [];
        if (byName.length === 1) {
          referencedCustomFormat = byName[0];
        }
      }

      let score: number | null = formatItem.score;
      if (score === null) {
        score = resolveTrashScoreFromCustomFormat(referencedCustomFormat, scoreSet);
      }

      if (score === null || !Number.isFinite(score)) {
        score = 0;
      }

      scoreByCfName.set(statedName.toLowerCase(), score);
      scoreByCfKey.set(normalizeCfKey(statedName), score);
      if (referencedCustomFormat && referencedCustomFormat.name.trim().length > 0) {
        scoreByCfName.set(referencedCustomFormat.name.toLowerCase(), score);
        scoreByCfKey.set(normalizeCfKey(referencedCustomFormat.name), score);
      }

      if (formatItem.custom_format_trash_id !== null) {
        const mappedName = mappedNamesByTrashId.get(formatItem.custom_format_trash_id.toLowerCase());
        if (mappedName && mappedName.trim().length > 0) {
          scoreByCfName.set(mappedName.toLowerCase(), score);
          scoreByCfKey.set(normalizeCfKey(mappedName), score);
        }
      }

      if (referencedCustomFormat !== null) {
        const mappedName =
          formatItem.custom_format_trash_id !== null
            ? (mappedNamesByTrashId.get(formatItem.custom_format_trash_id.toLowerCase())?.trim() ?? '')
            : '';
        const displayName =
          mappedName.length > 0
            ? mappedName
            : referencedCustomFormat.name.trim().length > 0
              ? referencedCustomFormat.name
              : statedName;

        // Write into the source-scoped map, not the shared PCD map.
        trashCfsByKey.set(normalizeCfKey(displayName), {
          name: displayName,
          conditions: referencedCustomFormat.specifications.map((spec) =>
            toConditionData(referencedCustomFormat, spec)
          ),
        });
      }
    }

    // Resolve CF groups that include this profile.
    const cfGroups = trashCfGroupsBySource.get(profile.sourceId) ?? [];
    for (const group of cfGroups) {
      const profileIncluded = groupIncludesProfile(group, profile);
      if (!profileIncluded) {
        continue;
      }

      for (const groupCf of group.custom_formats) {
        const cfKey = normalizeCfKey(groupCf.name);
        // format_items take precedence — skip if already resolved.
        if (trashCfsByKey.has(cfKey)) {
          continue;
        }

        const referencedCf = customFormatsByTrashId.get(groupCf.trash_id.toLowerCase()) ?? null;
        const score = resolveTrashScoreFromCustomFormat(referencedCf, scoreSet) ?? 0;

        const displayName = referencedCf?.name?.trim() || groupCf.name;
        scoreByCfName.set(displayName.toLowerCase(), score);
        scoreByCfKey.set(normalizeCfKey(displayName), score);

        if (referencedCf) {
          const cfEntity: TrashGuideCustomFormatEntity = referencedCf;
          trashCfsByKey.set(normalizeCfKey(displayName), {
            name: displayName,
            conditions: cfEntity.specifications.map((spec: TrashGuideCustomFormatSpecification) =>
              toConditionData(cfEntity, spec)
            ),
          });
        }
      }
    }

    for (const [key, value] of scoreByCfKey) {
      if (!scoreByCfName.has(key)) {
        scoreByCfName.set(key, value);
      }
    }

    trashScoreMapsByRequestKey.set(profile.requestKey, scoreByCfName);
  }

  // Collect all unique custom formats across both sources for a single
  // pattern-matching pre-fetch pass, but keep them organised by source so
  // per-profile evaluation never crosses source boundaries.
  const pcdCustomFormats = [...pcdCustomFormatsByKey.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Build a deduplicated union of all formats for pattern pre-fetching.
  const allFormatsForPatterns: CustomFormatWithConditions[] = [...pcdCustomFormats];
  for (const trashCfs of trashCustomFormatsByKeyBySource.values()) {
    for (const cf of trashCfs.values()) {
      allFormatsForPatterns.push(cf);
    }
  }

  const allPatterns = extractAllPatterns(allFormatsForPatterns);
  const releaseTitles = releases.map((release) => release.title);
  const patternMatchResults = await matchPatternsBatch(releaseTitles, allPatterns);

  const results: SimulateReleaseResult[] = releases.map((release) => {
    const cacheKey = `${release.title}:${release.type}`;
    const parsed = parseResults.get(cacheKey) ?? null;
    const patternMatches = patternMatchResults?.get(release.title);
    const effectiveParsed = inferAnimeSourceFromFormats(parsed, release.title, allFormatsForPatterns, patternMatches);

    const profileScores: SimulateProfileScore[] = resolvedProfiles.map((profile) => {
      // Resolve the format definitions that belong exclusively to this profile.
      const profileFormats: CustomFormatWithConditions[] =
        profile.kind === 'pcd'
          ? pcdCustomFormats
          : [...(trashCustomFormatsByKeyBySource.get(profile.sourceId)?.values() ?? [])].sort((a, b) =>
              a.name.localeCompare(b.name)
            );

      // Evaluate conditions against the release for this profile's own formats.
      const cfMatches: SimulateCfMatch[] = profileFormats.map((customFormat) => {
        if (customFormat.conditions.length === 0) {
          return { name: customFormat.name, matches: false, conditions: [] };
        }

        const evaluation = effectiveParsed
          ? evaluateCustomFormat(customFormat.conditions, effectiveParsed, release.title, patternMatches)
          : evaluateCustomFormatWithoutParse(customFormat.conditions, release.title, patternMatches);
        return {
          name: customFormat.name,
          matches: evaluation.matches,
          conditions: evaluation.conditions,
        };
      });

      let totalScore = 0;
      const contributions: SimulateScoreContribution[] = [];

      for (const cfMatch of cfMatches) {
        if (!cfMatch.matches) {
          continue;
        }

        let score = 0;
        if (profile.kind === 'pcd') {
          const cfScoring = profile.scoreData.customFormats.find((customFormat) => customFormat.name === cfMatch.name);
          score = cfScoring?.scores[arrType] ?? 0;
        } else {
          const scoreByCfName = trashScoreMapsByRequestKey.get(profile.requestKey);
          const direct = scoreByCfName?.get(cfMatch.name.toLowerCase()) ?? null;
          if (direct !== null) {
            score = direct;
          } else {
            score = scoreByCfName?.get(normalizeCfKey(cfMatch.name)) ?? 0;
          }
        }

        if (score !== 0) {
          contributions.push({ cfName: cfMatch.name, score });
        }

        totalScore += score;
      }

      if (profile.kind === 'pcd') {
        return {
          profileName: profile.requestKey,
          totalScore,
          minimumScore: profile.scoreData.minimum_custom_format_score,
          upgradeUntilScore: profile.scoreData.upgrade_until_score,
          contributions,
        };
      }

      return {
        profileName: profile.requestKey,
        totalScore,
        minimumScore: profile.entity.min_format_score,
        upgradeUntilScore: profile.entity.cutoff_format_score,
        contributions,
      };
    });

    // Top-level cfMatches: emit the first profile's format matches for
    // backward-compatibility with clients that read this field directly.
    const firstProfile = resolvedProfiles[0];
    const firstProfileFormats: CustomFormatWithConditions[] =
      firstProfile?.kind === 'pcd'
        ? pcdCustomFormats
        : [
            ...(trashCustomFormatsByKeyBySource.get((firstProfile as ResolvedTrashProfile)?.sourceId)?.values() ?? []),
          ].sort((a, b) => a.name.localeCompare(b.name));
    const topLevelCfMatches: SimulateCfMatch[] = firstProfileFormats.map((customFormat) => {
      if (customFormat.conditions.length === 0) {
        return { name: customFormat.name, matches: false, conditions: [] };
      }
      const evaluation = effectiveParsed
        ? evaluateCustomFormat(customFormat.conditions, effectiveParsed, release.title, patternMatches)
        : evaluateCustomFormatWithoutParse(customFormat.conditions, release.title, patternMatches);
      return { name: customFormat.name, matches: evaluation.matches, conditions: evaluation.conditions };
    });

    return {
      id: release.id,
      title: release.title,
      parsed: effectiveParsed ? getParsedInfo(effectiveParsed) : null,
      cfMatches: topLevelCfMatches,
      profileScores,
    };
  });

  return json({
    parserAvailable: true,
    results,
  } satisfies SimulateScoreResponse);
};
