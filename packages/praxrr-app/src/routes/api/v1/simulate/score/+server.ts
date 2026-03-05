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
import { parseCachedEntity } from '$lib/server/trashguide/displayTransform.ts';
import type { TrashGuideQualityProfileEntity } from '$lib/server/trashguide/types.ts';
import type { components } from '$api/v1.d.ts';

type SimulateScoreRequest = components['schemas']['SimulateScoreRequest'];
type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];
type SimulateReleaseResult = components['schemas']['SimulateReleaseResult'];
type SimulateCfMatch = components['schemas']['SimulateCfMatch'];
type SimulateProfileScore = components['schemas']['SimulateProfileScore'];
type SimulateScoreContribution = components['schemas']['SimulateScoreContribution'];
type ParsedInfo = components['schemas']['ParsedInfo'];
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

function fallbackParsedInfo(): ParsedInfo {
  return {
    source: 'Unknown',
    resolution: 'Unknown',
    modifier: 'None',
    languages: [],
    releaseGroup: null,
    year: 0,
    edition: null,
    releaseType: null,
  };
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
      return { kind: 'pcd', name: selector };
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

export const POST: RequestHandler = async ({ request }) => {
  const body: SimulateScoreRequest = await request.json();
  const { databaseId, releases, profileNames, arrType } = body;

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
      } catch {
        missingProfiles.push(profileSelector);
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

  const customFormats = await getAllConditionsForEvaluation(cache);
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
        parsed: fallbackParsedInfo(),
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
          const formatItem = profile.entity.format_items.find((customFormat) => customFormat.name === cfMatch.name);
          score = formatItem?.score ?? 0;
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
