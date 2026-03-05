import type { components } from '$api/v1.d.ts';

type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];
type SimulateScoreContribution = components['schemas']['SimulateScoreContribution'];
type SimulateProfileScore = components['schemas']['SimulateProfileScore'];
type SimulateReleaseResult = components['schemas']['SimulateReleaseResult'];
type SimulateReleaseInput = components['schemas']['SimulateReleaseInput'];
type MediaType = components['schemas']['MediaType'];
type ParsedInfo = components['schemas']['ParsedInfo'];

export type ScoreThresholdState = 'below' | 'accepted' | 'upgrade-reached';

export type BatchInputState = {
  rawText: string;
  titles: string[];
  active: boolean;
};

export type ComparisonState = {
  comparisonProfileName: string | null;
  showDeltas: boolean;
};

export type ProfileScoreDelta = {
  cfName: string;
  scoreA: number;
  scoreB: number;
  delta: number;
};

export type ComparisonResult = {
  profileAName: string;
  profileBName: string;
  profileATotal: number;
  profileBTotal: number;
  totalDelta: number;
  contributions: ProfileScoreDelta[];
};

export type RankedRelease = {
  id: string;
  title: string;
  rank: number;
  totalScore: number;
  thresholdState: ScoreThresholdState | null;
  matchedCfCount: number;
  totalCfCount: number;
  parsed: ParsedInfo | null;
  comparisonScore?: number;
  comparisonRank?: number;
  scoreDelta?: number;
};

export type PresetCategory = 'movie' | 'series';

export type PresetGroup = {
  category: PresetCategory;
  label: string;
  description: string;
  titles: Array<{ label: string; title: string }>;
};

export function getSelectedProfileScore(
  result: SimulateScoreResponse | null,
  profileName: string | null
): SimulateProfileScore | null {
  if (!result || !profileName) {
    return null;
  }

  const firstResult = result.results[0];
  if (!firstResult) {
    return null;
  }

  return firstResult.profileScores.find((profile) => profile.profileName === profileName) ?? null;
}

export function resolveScoreThresholdState(profileScore: SimulateProfileScore | null): ScoreThresholdState | null {
  if (!profileScore) {
    return null;
  }

  if (profileScore.totalScore < profileScore.minimumScore) {
    return 'below';
  }

  if (profileScore.totalScore < profileScore.upgradeUntilScore) {
    return 'accepted';
  }

  return 'upgrade-reached';
}

export function sortScoreContributionsByMagnitude(
  contributions: readonly SimulateScoreContribution[]
): SimulateScoreContribution[] {
  return [...contributions].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}

const MAX_BATCH_TITLES = 50;
const MAX_TITLE_LENGTH = 500;
let releaseIdCounter = 0;

function createReleaseId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  releaseIdCounter += 1;
  return `release-${Date.now()}-${releaseIdCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseBatchTitles(rawText: string, mediaType: MediaType): SimulateReleaseInput[] {
  if (!rawText.trim()) {
    return [];
  }

  const lines = rawText.split('\n');
  const results: SimulateReleaseInput[] = [];

  for (const line of lines) {
    if (results.length >= MAX_BATCH_TITLES) {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.length > MAX_TITLE_LENGTH) {
      continue;
    }

    results.push({
      id: createReleaseId(),
      title: trimmed,
      type: mediaType,
    });
  }

  return results;
}

export function buildRankingFromResults(results: SimulateReleaseResult[], profileName: string): RankedRelease[] {
  const ranked: RankedRelease[] = [];

  for (const result of results) {
    const profileScore = result.profileScores.find((p) => p.profileName === profileName);
    if (!profileScore) {
      return [];
    }

    ranked.push({
      id: result.id,
      title: result.title,
      rank: 0,
      totalScore: profileScore.totalScore,
      thresholdState: resolveScoreThresholdState(profileScore),
      matchedCfCount: profileScore.contributions.filter((c) => c.score !== 0).length,
      totalCfCount: profileScore.contributions.length,
      parsed: result.parsed,
    });
  }

  ranked.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.matchedCfCount !== a.matchedCfCount) return b.matchedCfCount - a.matchedCfCount;
    return a.title.localeCompare(b.title);
  });

  let currentRank = 1;
  for (let i = 0; i < ranked.length; i++) {
    if (i > 0 && ranked[i].totalScore !== ranked[i - 1].totalScore) {
      currentRank = i + 1;
    }
    ranked[i].rank = currentRank;
  }

  return ranked;
}

export function buildComparisonResult(
  releaseResult: SimulateReleaseResult,
  profileAName: string,
  profileBName: string
): ComparisonResult | null {
  const profileA = releaseResult.profileScores.find((p) => p.profileName === profileAName);
  const profileB = releaseResult.profileScores.find((p) => p.profileName === profileBName);

  if (!profileA || !profileB) {
    return null;
  }

  const cfScoresA = new Map(profileA.contributions.map((c) => [c.cfName, c.score]));
  const cfScoresB = new Map(profileB.contributions.map((c) => [c.cfName, c.score]));

  const allCfNames = new Set([...cfScoresA.keys(), ...cfScoresB.keys()]);

  const contributions: ProfileScoreDelta[] = [];
  for (const cfName of allCfNames) {
    const scoreA = cfScoresA.get(cfName) ?? 0;
    const scoreB = cfScoresB.get(cfName) ?? 0;
    contributions.push({
      cfName,
      scoreA,
      scoreB,
      delta: scoreB - scoreA,
    });
  }

  contributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    profileAName,
    profileBName,
    profileATotal: profileA.totalScore,
    profileBTotal: profileB.totalScore,
    totalDelta: profileB.totalScore - profileA.totalScore,
    contributions,
  };
}
