import type { components } from '$api/v1.d.ts';

type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];
type SimulateScoreContribution = components['schemas']['SimulateScoreContribution'];
type SimulateProfileScore = components['schemas']['SimulateProfileScore'];

export type ScoreThresholdState = 'below' | 'accepted' | 'upgrade-reached';

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
