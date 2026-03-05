import { assertEquals } from '@std/assert';
import {
  getSelectedProfileScore,
  resolveScoreThresholdState,
  sortScoreContributionsByMagnitude,
  type ScoreThresholdState,
} from '../../routes/score-simulator/[databaseId]/helpers.ts';
import type { components } from '$api/v1.d.ts';

type SimulateScoreResponse = components['schemas']['SimulateScoreResponse'];
type SimulateProfileScore = components['schemas']['SimulateProfileScore'];
type SimulateScoreContribution = components['schemas']['SimulateScoreContribution'];

Deno.test('getSelectedProfileScore returns null without a selected profile or result', () => {
  const result: SimulateScoreResponse = { parserAvailable: true, results: [] };
  assertEquals(getSelectedProfileScore(null, 'pcd:alpha'), null);
  assertEquals(getSelectedProfileScore(result, null), null);
});

Deno.test('getSelectedProfileScore matches by profile name', () => {
  const response: SimulateScoreResponse = {
    parserAvailable: true,
    results: [
      {
        id: '1',
        title: 'Release A',
        parsed: {
          source: 'Bluray',
          resolution: '1080p',
          modifier: 'None',
          languages: ['English'],
          year: 2024,
        },
        cfMatches: [],
        profileScores: [
          {
            profileName: 'pcd:alpha',
            totalScore: 10,
            minimumScore: 1,
            upgradeUntilScore: 15,
            contributions: [],
          },
          {
            profileName: 'trash:1:name',
            totalScore: 8,
            minimumScore: 1,
            upgradeUntilScore: 20,
            contributions: [],
          },
        ],
      },
    ],
  };

  const selected = getSelectedProfileScore(response, 'trash:1:name');
  assertEquals(selected?.profileName, 'trash:1:name');
  assertEquals(selected?.totalScore, 8);
  assertEquals(getSelectedProfileScore(response, 'pcd:missing'), null);
});

Deno.test('resolveScoreThresholdState maps totals to stable states', () => {
  const asProfile = (scores: {
    totalScore: number;
    minimumScore: number;
    upgradeUntilScore: number;
  }): SimulateProfileScore =>
    ({
      profileName: 'pcd:alpha',
      totalScore: scores.totalScore,
      minimumScore: scores.minimumScore,
      upgradeUntilScore: scores.upgradeUntilScore,
      contributions: [],
    }) as SimulateProfileScore;

  assertEquals(resolveScoreThresholdState(null), null);
  assertEquals(
    resolveScoreThresholdState(asProfile({ totalScore: 4, minimumScore: 10, upgradeUntilScore: 20 })),
    'below'
  );
  assertEquals(
    resolveScoreThresholdState(asProfile({ totalScore: 15, minimumScore: 10, upgradeUntilScore: 20 })),
    'accepted'
  );
  assertEquals(
    resolveScoreThresholdState(asProfile({ totalScore: 25, minimumScore: 10, upgradeUntilScore: 20 })),
    'upgrade-reached'
  );
});

Deno.test('sortScoreContributionsByMagnitude sorts by absolute score descending', () => {
  const contributions: SimulateScoreContribution[] = [
    { cfName: 'small-negative', score: -5 },
    { cfName: 'large-positive', score: 8 },
    { cfName: 'medium-positive', score: 6 },
    { cfName: 'large-negative', score: -8 },
  ];

  const sorted = sortScoreContributionsByMagnitude(contributions);
  assertEquals(sorted[0]?.cfName, 'large-positive');
  assertEquals(sorted[1]?.cfName, 'large-negative');
  assertEquals(sorted[2]?.cfName, 'medium-positive');
  assertEquals(sorted[3]?.cfName, 'small-negative');
});
