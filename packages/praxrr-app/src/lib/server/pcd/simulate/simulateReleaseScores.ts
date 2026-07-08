/**
 * Shared PCD release scorer for the impact simulator.
 *
 * Scores a set of release titles against a set of PCD quality profiles using a
 * given cache's current custom-format scores. Because the impact simulator runs
 * this against both the live cache and an isolated sandbox cache (with proposed
 * score changes applied), it must re-derive each profile's total from the cache
 * rather than mutating a fixed contribution list — this is what lets a
 * matched-but-zero custom format's score change (0 -> N) actually move the total.
 *
 * Conditions are read once by the caller (they are invariant across the current
 * and sandbox caches in Phase-2, which only changes scores/thresholds) and
 * passed in via {@link SimulateScoreContext.formats}. Scores and thresholds are
 * read per-cache via {@link scoring}. PCD profiles only — TRaSH resolution lives
 * in the score route.
 */

import type { PCDCache } from '$pcd/index.ts';
import {
  evaluateCustomFormat,
  evaluateCustomFormatWithoutParse,
  getParsedInfo,
} from '$pcd/entities/customFormats/index.ts';
import { scoring, QualityProfileScoringNotFoundError } from '$pcd/entities/qualityProfiles/index.ts';
import { inferAnimeSourceFromFormats } from './animeInference.ts';
import type { ParseResult } from '$lib/server/utils/arr/parser/types.ts';
import type { CustomFormatWithConditions } from '$shared/pcd/display.ts';

type PcdProfileScoreData = Awaited<ReturnType<typeof scoring>>;

export interface SimulateScoreContext {
  arrType: 'radarr' | 'sonarr';
  releases: { id?: string; title: string; type: 'movie' | 'series' }[];
  /** PCD profile names only (pcd:-stripped). */
  profileNames: string[];
  /** Parsed release info keyed `${title}:${type}`. */
  parseResults: Map<string, ParseResult | null>;
  /** Pattern-match results keyed by release title, then pattern. */
  patternMatches: Map<string, Map<string, boolean>> | null;
  /** All PCD custom formats with conditions (cache-invariant in Phase-2). */
  formats: CustomFormatWithConditions[];
}

export interface SimulatedProfileScore {
  profileName: string;
  totalScore: number;
  minimumScore: number;
  upgradeUntilScore: number;
  /** Every matched custom format's score (including 0), keyed by CF name. */
  matchedCfScores: Map<string, number>;
}

export interface SimulateReleaseScoreResult {
  id?: string;
  title: string;
  /** Parsed release info (source-inferred for anime); invariant across caches in Phase-2. */
  parsed: ReturnType<typeof getParsedInfo> | null;
  profiles: SimulatedProfileScore[];
}

/**
 * Score every release against every PCD profile using the given cache's scores.
 * Missing profiles are skipped (fail-soft), matching the score route.
 */
export async function simulateReleaseScores(
  cache: PCDCache,
  databaseId: number,
  ctx: SimulateScoreContext
): Promise<SimulateReleaseScoreResult[]> {
  const scoreDatas = new Map<string, PcdProfileScoreData>();
  for (const profileName of ctx.profileNames) {
    try {
      scoreDatas.set(profileName, await scoring(cache, databaseId, profileName));
    } catch (err) {
      if (err instanceof QualityProfileScoringNotFoundError) continue;
      throw err;
    }
  }

  return ctx.releases.map((release) => {
    const parsed = ctx.parseResults.get(`${release.title}:${release.type}`) ?? null;
    const patternMatches = ctx.patternMatches?.get(release.title);
    const effectiveParsed = inferAnimeSourceFromFormats(parsed, release.title, ctx.formats, patternMatches);

    const profiles: SimulatedProfileScore[] = [];
    for (const profileName of ctx.profileNames) {
      const scoreData = scoreDatas.get(profileName);
      if (!scoreData) continue;

      let totalScore = 0;
      const matchedCfScores = new Map<string, number>();

      for (const customFormat of ctx.formats) {
        if (customFormat.conditions.length === 0) continue;

        const evaluation = effectiveParsed
          ? evaluateCustomFormat(customFormat.conditions, effectiveParsed, release.title, patternMatches)
          : evaluateCustomFormatWithoutParse(customFormat.conditions, release.title, patternMatches);
        if (!evaluation.matches) continue;

        const cfScoring = scoreData.customFormats.find((cf) => cf.name === customFormat.name);
        const score = cfScoring?.scores[ctx.arrType] ?? 0;
        totalScore += score;
        matchedCfScores.set(customFormat.name, score);
      }

      profiles.push({
        profileName,
        totalScore,
        minimumScore: scoreData.minimum_custom_format_score,
        upgradeUntilScore: scoreData.upgrade_until_score,
        matchedCfScores,
      });
    }

    return {
      id: release.id,
      title: release.title,
      parsed: effectiveParsed ? getParsedInfo(effectiveParsed) : null,
      profiles,
    };
  });
}
