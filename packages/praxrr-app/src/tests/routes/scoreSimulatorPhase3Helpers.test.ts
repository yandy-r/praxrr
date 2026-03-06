import { assertEquals, assertNotEquals } from '@std/assert';
import {
  applyScoreOverrides,
  computeOverriddenTotal,
  resolveThresholdWithOverrides,
} from '../../routes/score-simulator/[databaseId]/helpers.ts';
import type { components } from '$api/v1.d.ts';

type SimulateProfileScore = components['schemas']['SimulateProfileScore'];

function makeProfileScore(
  totalScore: number,
  minimumScore: number,
  upgradeUntilScore: number,
  contributions: Array<{ cfName: string; score: number }>
): SimulateProfileScore {
  return {
    profileName: 'pcd:alpha',
    totalScore,
    minimumScore,
    upgradeUntilScore,
    contributions,
  };
}

Deno.test('applyScoreOverrides returns new array and does not mutate input', () => {
  const contributions = [
    { cfName: 'CF-One', score: 10 },
    { cfName: 'CF-Two', score: -5 },
  ];
  const originalSnapshot = structuredClone(contributions);

  const overridden = applyScoreOverrides(contributions, { 'CF-One': 15 });

  assertNotEquals(overridden, contributions);
  assertEquals(overridden[0] === contributions[0], false);
  assertEquals(overridden[1] === contributions[1], false);
  assertEquals(contributions, originalSnapshot);
});

Deno.test('applyScoreOverrides applies changed overrides and tracks original score', () => {
  const contributions = [
    { cfName: 'CF-One', score: 10 },
    { cfName: 'CF-Two', score: 20 },
  ];

  const overridden = applyScoreOverrides(contributions, {
    'CF-One': -3,
    Missing: 999,
  });

  assertEquals(overridden, [
    { cfName: 'CF-One', score: -3, originalScore: 10 },
    { cfName: 'CF-Two', score: 20 },
  ]);
});

Deno.test('applyScoreOverrides ignores unknown keys and unchanged overrides', () => {
  const contributions = [
    { cfName: 'CF-One', score: 0 },
    { cfName: 'CF-Two', score: 7 },
  ];

  const overridden = applyScoreOverrides(contributions, {
    Missing: 5,
    'CF-One': 0,
  });

  assertEquals(overridden, [
    { cfName: 'CF-One', score: 0 },
    { cfName: 'CF-Two', score: 7 },
  ]);
});

Deno.test('computeOverriddenTotal returns original total for empty overrides map', () => {
  const contributions = [
    { cfName: 'CF-One', score: 10 },
    { cfName: 'CF-Two', score: -3 },
    { cfName: 'CF-Three', score: 0 },
  ];

  assertEquals(computeOverriddenTotal(contributions, {}), 7);
});

Deno.test('computeOverriddenTotal applies overrides including zero and negative values', () => {
  const contributions = [
    { cfName: 'CF-One', score: 10 },
    { cfName: 'CF-Two', score: 5 },
    { cfName: 'CF-Three', score: 2 },
  ];

  const total = computeOverriddenTotal(contributions, {
    'CF-One': 0,
    'CF-Two': -8,
    Missing: 1000,
  });

  assertEquals(total, -6);
});

Deno.test('resolveThresholdWithOverrides returns null for null profile score', () => {
  assertEquals(resolveThresholdWithOverrides(null, { 'CF-One': 50 }), null);
});

Deno.test('resolveThresholdWithOverrides keeps accepted when overrides are unchanged', () => {
  const profile = makeProfileScore(12, 10, 20, [
    { cfName: 'CF-One', score: 8 },
    { cfName: 'CF-Two', score: 4 },
  ]);

  assertEquals(resolveThresholdWithOverrides(profile, { 'CF-One': 8 }), 'accepted');
});

Deno.test('resolveThresholdWithOverrides transitions accepted to below', () => {
  const profile = makeProfileScore(12, 10, 20, [
    { cfName: 'CF-One', score: 8 },
    { cfName: 'CF-Two', score: 4 },
  ]);

  assertEquals(resolveThresholdWithOverrides(profile, { 'CF-One': 3 }), 'below');
});

Deno.test('resolveThresholdWithOverrides transitions below to accepted at minimum threshold', () => {
  const profile = makeProfileScore(7, 10, 20, [
    { cfName: 'CF-One', score: 7 },
  ]);

  assertEquals(resolveThresholdWithOverrides(profile, { 'CF-One': 10 }), 'accepted');
});

Deno.test('resolveThresholdWithOverrides transitions accepted to upgrade-reached at upgrade threshold', () => {
  const profile = makeProfileScore(12, 10, 20, [
    { cfName: 'CF-One', score: 8 },
    { cfName: 'CF-Two', score: 4 },
  ]);

  assertEquals(resolveThresholdWithOverrides(profile, { 'CF-One': 16 }), 'upgrade-reached');
});
