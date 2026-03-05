import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pcdManager } from '$pcd/index.ts';
import { parseWithCacheBatch, isParserHealthy, matchPatternsBatch } from '$lib/server/utils/arr/parser/index.ts';
import {
  getAllConditionsForEvaluation,
  evaluateCustomFormat,
  getParsedInfo,
  extractAllPatterns,
} from '$pcd/entities/customFormats/index.ts';
import { scoring } from '$pcd/entities/qualityProfiles/index.ts';
import type { components } from '$api/v1.d.ts';

type SimulateScoreRequest = components['schemas']['SimulateScoreRequest'];
type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];
type SimulateReleaseResult = components['schemas']['SimulateReleaseResult'];
type SimulateCfMatch = components['schemas']['SimulateCfMatch'];
type SimulateProfileScore = components['schemas']['SimulateProfileScore'];
type SimulateScoreContribution = components['schemas']['SimulateScoreContribution'];
type ParsedInfo = components['schemas']['ParsedInfo'];

function isArrType(value: string): value is SimulateScoreRequest['arrType'] {
  return value === 'radarr' || value === 'sonarr';
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

  const existingProfiles = await cache.kb.selectFrom('quality_profiles').select(['name']).execute();
  const existingProfileNames = new Set(existingProfiles.map((profile) => profile.name));
  const missingProfiles = profileNames.filter((profileName) => !existingProfileNames.has(profileName));

  if (missingProfiles.length > 0) {
    return json(
      {
        error: 'Quality profiles not found',
        missing: missingProfiles,
      },
      { status: 404 }
    );
  }

  const profileScoresByName = new Map<string, Awaited<ReturnType<typeof scoring>>>();

  try {
    for (const profileName of profileNames) {
      const profileScoreData = await scoring(cache, databaseId, profileName);
      profileScoresByName.set(profileName, profileScoreData);
    }
  } catch (err) {
    if (err instanceof Error) {
      const match = /^Quality profile (.+) not found$/.exec(err.message);
      if (match) {
        return json(
          {
            error: err.message,
            missing: [match[1]],
          },
          { status: 404 }
        );
      }
    }

    throw err;
  }

  const customFormats = await getAllConditionsForEvaluation(cache);
  const allPatterns = extractAllPatterns(customFormats);
  const releaseTitles = releases.map((release) => release.title);
  const patternMatchResults = await matchPatternsBatch(releaseTitles, allPatterns);

  const results: SimulateReleaseResult[] = releases.map((release) => {
    const cacheKey = `${release.title}:${release.type}`;
    const parsed = parseResults.get(cacheKey);

    if (!parsed) {
      const profileScores: SimulateProfileScore[] = profileNames.map((profileName) => {
        const profileData = profileScoresByName.get(profileName);
        if (!profileData) {
          throw error(500, `Score data unavailable for profile ${profileName}`);
        }

        return {
          profileName,
          totalScore: 0,
          minimumScore: profileData.minimum_custom_format_score,
          upgradeUntilScore: profileData.upgrade_until_score,
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

    const profileScores: SimulateProfileScore[] = profileNames.map((profileName) => {
      const profileData = profileScoresByName.get(profileName);

      if (!profileData) {
        throw error(500, `Score data unavailable for profile ${profileName}`);
      }

      let totalScore = 0;
      const contributions: SimulateScoreContribution[] = [];

      for (const cfMatch of cfMatches) {
        if (!cfMatch.matches) {
          continue;
        }

        const cfScoring = profileData.customFormats.find((customFormat) => customFormat.name === cfMatch.name);
        const score = cfScoring?.scores[arrType] ?? 0;

        if (score !== 0) {
          contributions.push({
            cfName: cfMatch.name,
            score,
          });
        }

        totalScore += score;
      }

      return {
        profileName,
        totalScore,
        minimumScore: profileData.minimum_custom_format_score,
        upgradeUntilScore: profileData.upgrade_until_score,
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
