import { json, error, type RequestHandler } from '@sveltejs/kit';
import { pcdManager } from '$pcd/index.ts';
import { parseWithCacheBatch, isParserHealthy, matchPatternsBatch } from '$lib/server/utils/arr/parser/index.ts';
import {
  getAllConditionsForEvaluation,
  evaluateCustomFormat,
  getParsedInfo,
  extractAllPatterns,
} from '$pcd/entities/customFormats/index.ts';
import { scoring } from '$pcd/entities/qualityProfiles/index.ts';
import { trashGuideManager } from '$lib/server/trashguide/manager.ts';
import { trashGuideEntityCacheQueries } from '$db/queries/trashGuideEntityCache.ts';
import { trashIdMappingsQueries } from '$db/queries/trashIdMappings.ts';
import { parseCachedEntity } from '$lib/server/trashguide/displayTransform.ts';
import type {
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

function isArrType(value: string): value is SimulateScoreRequest['arrType'] {
  return value === 'radarr' || value === 'sonarr';
}

function isReleaseType(value: unknown): value is 'movie' | 'series' {
  return value === 'movie' || value === 'series';
}

function parseProfileSelector(
  selector: string
): { kind: 'pcd'; name: string } | { kind: 'trash'; sourceId: number; name: string } {
  if (selector.startsWith('pcd:')) {
    return {
      kind: 'pcd',
      name: decodeURIComponent(selector.slice(4)),
    };
  }

  if (selector.startsWith('trash:')) {
    const match = /^trash:(\d+):(.*)$/.exec(selector);
    if (!match) {
      throw error(400, `Invalid trash profile selector format: "${selector}". Expected "trash:<sourceId>:<name>"`);
    }

    return {
      kind: 'trash',
      sourceId: Number.parseInt(match[1], 10),
      name: decodeURIComponent(match[2]),
    };
  }

  // Backward compatibility with plain profile names.
  return { kind: 'pcd', name: selector };
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
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = value.trim();
    if (normalized.length > 0) {
      return normalized;
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
    case 'language':
      return {
        ...base,
        languages: [
          {
            name: readRequiredStringField(spec.fields, ['value'], context, spec.name),
            except: readOptionalBooleanField(spec.fields, ['exceptLanguage'], false),
          },
        ],
      };
    case 'source':
      return {
        ...base,
        sources: [readRequiredStringField(spec.fields, ['value'], context, spec.name)],
      };
    case 'resolution':
      return {
        ...base,
        resolutions: [readRequiredStringField(spec.fields, ['value'], context, spec.name)],
      };
    case 'quality_modifier':
      return {
        ...base,
        qualityModifiers: [readRequiredStringField(spec.fields, ['value'], context, spec.name)],
      };
    case 'release_type':
      return {
        ...base,
        releaseTypes: [readRequiredStringField(spec.fields, ['value'], context, spec.name)],
      };
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
        if (err instanceof Error && err.message.includes('not found')) {
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
  const trashSourceIds = new Set<number>();
  for (const profile of resolvedProfiles) {
    if (profile.kind === 'trash') {
      trashSourceIds.add(profile.sourceId);
    }
  }

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

  const pcdCustomFormats = await getAllConditionsForEvaluation(cache);
  const pcdCustomFormatsByName = new Map(pcdCustomFormats.map((customFormat) => [customFormat.name, customFormat]));
  const selectedCustomFormatsByKey = new Map<string, CustomFormatWithConditions>();

  for (const customFormatName of pcdCustomFormatNames) {
    const customFormat = pcdCustomFormatsByName.get(customFormatName);
    if (!customFormat) {
      continue;
    }

    selectedCustomFormatsByKey.set(normalizeCfKey(customFormat.name), {
      name: customFormat.name,
      conditions: customFormat.conditions,
    });
  }

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
        continue;
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
            ? mappedNamesByTrashId.get(formatItem.custom_format_trash_id.toLowerCase())?.trim() ?? ''
            : '';
        const displayName =
          mappedName.length > 0
            ? mappedName
            : (referencedCustomFormat.name.trim().length > 0 ? referencedCustomFormat.name : statedName);

        selectedCustomFormatsByKey.set(normalizeCfKey(displayName), {
          name: displayName,
          conditions: referencedCustomFormat.specifications.map((spec) => toConditionData(referencedCustomFormat, spec)),
        });
      }
    }

    for (const [key, value] of scoreByCfKey) {
      if (!scoreByCfName.has(key)) {
        scoreByCfName.set(key, value);
      }
    }

    trashScoreMapsByRequestKey.set(profile.requestKey, scoreByCfName);
  }

  const customFormats = [...selectedCustomFormatsByKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  const allPatterns = extractAllPatterns(customFormats);
  const releaseTitles = releases.map((release) => release.title);
  const patternMatchResults = await matchPatternsBatch(releaseTitles, allPatterns);

  const results: SimulateReleaseResult[] = releases.map((release) => {
    const cacheKey = `${release.title}:${release.type}`;
    const parsed = parseResults.get(cacheKey);

    if (!parsed) {
      const profileScores: SimulateProfileScore[] = resolvedProfiles.map((profile) => {
        if (profile.kind === 'pcd') {
          return {
            profileName: profile.requestKey,
            totalScore: 0,
            minimumScore: profile.scoreData.minimum_custom_format_score,
            upgradeUntilScore: profile.scoreData.upgrade_until_score,
            contributions: [],
          };
        }

        return {
          profileName: profile.requestKey,
          totalScore: 0,
          minimumScore: profile.entity.min_format_score,
          upgradeUntilScore: profile.entity.cutoff_format_score,
          contributions: [],
        };
      });

      return {
        id: release.id,
        title: release.title,
        parsed: null,
        cfMatches: customFormats.map((customFormat) => ({
          name: customFormat.name,
          matches: false,
          conditions: [],
        })),
        profileScores,
      };
    }

    const patternMatches = patternMatchResults?.get(release.title);

    const cfMatches: SimulateCfMatch[] = customFormats.map((customFormat) => {
      if (customFormat.conditions.length === 0) {
        return {
          name: customFormat.name,
          matches: false,
          conditions: [],
        };
      }

      const evaluation = evaluateCustomFormat(customFormat.conditions, parsed, release.title, patternMatches);

      return {
        name: customFormat.name,
        matches: evaluation.matches,
        conditions: evaluation.conditions,
      };
    });

    const profileScores: SimulateProfileScore[] = resolvedProfiles.map((profile) => {
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
          contributions.push({
            cfName: cfMatch.name,
            score,
          });
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

    return {
      id: release.id,
      title: release.title,
      parsed: getParsedInfo(parsed),
      cfMatches,
      profileScores,
    };
  });

  return json({
    parserAvailable: true,
    results,
  } satisfies SimulateScoreResponse);
};
