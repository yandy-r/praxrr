/**
 * Pure-engine tests for Config Health (issue #22): determinism/order-invariance, the exact
 * contribution-sum invariant, null-exclusion (skipped != 0), band thresholds, version stamping,
 * disabled-criteria exclusion, and monotonicity. No DB, no mocks — the engine is pure.
 */

import { assert, assertEquals } from '@std/assert';
import {
  CONFIG_HEALTH_ENGINE_VERSION,
  DEFAULT_CRITERIA,
  computeHealthReport,
  type CriterionConfig,
  type DriftFacts,
  type HealthInputs,
  type ProfileFacts,
  type ScoredUnit
} from '$shared/health/index.ts';

function makeProfile(overrides: Partial<ProfileFacts> = {}): ProfileFacts {
  return {
    name: 'HD Bluray + WEB',
    arrType: 'radarr',
    compatible: true,
    enabledQualityCount: 5,
    hasCutoff: true,
    assignedCfCount: 40,
    totalCfCount: 47,
    recommendedCfCount: 47,
    thresholds: { minimumScore: 0, upgradeUntilScore: 10000, upgradeScoreIncrement: 1 },
    cfScores: [
      { name: 'a', score: 100 },
      { name: 'b', score: 0 }
    ],
    ...overrides
  };
}

const inSyncDrift: DriftFacts = {
  status: 'in-sync',
  reason: null,
  drifted: 0,
  missing: 0,
  unmanaged: 0,
  checkedAt: '2026-07-14T00:00:00Z',
  contentCheckedAt: '2026-07-14T00:00:00Z'
};

function makeInputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    instanceId: 3,
    instanceName: 'Radarr 4K',
    arrType: 'radarr',
    detectedVersion: '5.0.0.0',
    versionSupported: true,
    drift: inSyncDrift,
    profiles: [makeProfile()],
    criteria: DEFAULT_CRITERIA.map((c) => ({ ...c })),
    nowIso: '2026-07-14T02:00:00Z',
    ...overrides
  };
}

/** Every scope's per-criterion contributions must sum EXACTLY to that scope's score. */
function assertContributionsSumToScore(unit: ScoredUnit): void {
  const sum = unit.criteria.reduce((total, c) => total + c.contribution, 0);
  assertEquals(sum, unit.score, `contributions (${sum}) must equal score (${unit.score})`);
}

Deno.test('computeHealthReport: stamps the engine version and generatedAt', () => {
  const report = computeHealthReport(makeInputs());
  assertEquals(report.engineVersion, CONFIG_HEALTH_ENGINE_VERSION);
  assertEquals(report.generatedAt, '2026-07-14T02:00:00Z');
  assertEquals(report.instanceId, 3);
  assertEquals(report.instanceName, 'Radarr 4K');
  assertEquals(report.arrType, 'radarr');
});

Deno.test('computeHealthReport: contributions sum exactly to the score for every scope', () => {
  const report = computeHealthReport(
    makeInputs({
      profiles: [
        makeProfile({ name: 'Alpha', assignedCfCount: 30 }),
        makeProfile({ name: 'Beta', assignedCfCount: 47, compatible: false }),
        makeProfile({ name: 'Gamma', hasCutoff: false, enabledQualityCount: 0 })
      ],
      drift: { ...inSyncDrift, status: 'drifted', drifted: 3, missing: 1, contentCheckedAt: '2026-07-14T00:00:00Z' }
    })
  );
  assertContributionsSumToScore(report.overall);
  for (const profile of report.profiles) {
    assertContributionsSumToScore(profile);
  }
});

Deno.test('computeHealthReport: profile order does not change the output (order-invariant)', () => {
  const base = {
    profiles: [makeProfile({ name: 'Zulu' }), makeProfile({ name: 'Alpha' }), makeProfile({ name: 'Mike' })]
  };
  const forward = computeHealthReport(makeInputs(base));
  const reversed = computeHealthReport(makeInputs({ profiles: [...base.profiles].reverse() }));
  assertEquals(forward, reversed);
  // Profiles come out name-sorted regardless of input order.
  assertEquals(
    forward.profiles.map((p) => p.name),
    ['Alpha', 'Mike', 'Zulu']
  );
});

Deno.test('computeHealthReport: a healthy config lands in the healthy band', () => {
  const report = computeHealthReport(makeInputs({ profiles: [makeProfile({ assignedCfCount: 47 })] }));
  assertEquals(report.overall.band, 'healthy');
  assert(report.overall.score >= 85, `expected healthy score, got ${report.overall.score}`);
});

Deno.test('computeHealthReport: all-null criteria yield band "unknown" and score 0', () => {
  // No profiles (completeness/coherence/compatibility null) + never-checked drift (null) => nothing scored.
  const report = computeHealthReport(
    makeInputs({
      profiles: [],
      versionSupported: null,
      detectedVersion: null,
      drift: { status: 'never-checked', reason: null, drifted: 0, missing: 0, unmanaged: 0, checkedAt: null, contentCheckedAt: null }
    })
  );
  assertEquals(report.overall.band, 'unknown');
  assertEquals(report.overall.score, 0);
  // Every enabled criterion is present but skipped (score null, contribution 0).
  for (const criterion of report.overall.criteria) {
    assertEquals(criterion.score, null);
    assertEquals(criterion.contribution, 0);
  }
});

Deno.test('computeHealthReport: a null sub-score is excluded, not treated as 0', () => {
  // Never-checked drift is null; the overall must equal the mean of the OTHER criteria, not be
  // dragged down by a phantom 0 for drift.
  const withDrift = computeHealthReport(makeInputs());
  const neverChecked = computeHealthReport(
    makeInputs({
      drift: { status: 'never-checked', reason: null, drifted: 0, missing: 0, unmanaged: 0, checkedAt: null, contentCheckedAt: null }
    })
  );
  const driftResult = neverChecked.overall.criteria.find((c) => c.id === 'drift');
  assertEquals(driftResult?.score, null);
  assertEquals(driftResult?.contribution, 0);
  // Excluding a null drift (which was 100 in the in-sync case) should not RAISE or fabricate; the
  // non-drift criteria keep their weighted mean. Score stays a valid 0..100 and >0.
  assert(neverChecked.overall.score > 0 && neverChecked.overall.score <= 100);
  assert(withDrift.overall.band === 'healthy');
});

Deno.test('computeHealthReport: disabled criteria never appear in the breakdown', () => {
  const report = computeHealthReport(makeInputs());
  // trash_alignment ships disabled by default.
  assert(!report.overall.criteria.some((c) => c.id === 'trash_alignment'));
  assert(report.overall.criteria.some((c) => c.id === 'completeness'));
});

Deno.test('computeHealthReport: drift is instance-scope only (null at profile scope)', () => {
  const report = computeHealthReport(makeInputs({ drift: { ...inSyncDrift, status: 'drifted', drifted: 5, missing: 0, contentCheckedAt: '2026-07-14T00:00:00Z' } }));
  const overallDrift = report.overall.criteria.find((c) => c.id === 'drift');
  assert(overallDrift && overallDrift.score !== null, 'drift scored at instance scope');
  for (const profile of report.profiles) {
    const profileDrift = profile.criteria.find((c) => c.id === 'drift');
    assertEquals(profileDrift?.score ?? null, null, 'drift must be null (skipped) at profile scope');
  }
});

Deno.test('computeHealthReport: fewer drifted entities never lowers the overall score (monotonic drift)', () => {
  const single = (drifted: number) =>
    computeHealthReport(
      makeInputs({
        criteria: [{ id: 'drift', enabled: true, weight: 100 } satisfies CriterionConfig],
        drift: { ...inSyncDrift, status: 'drifted', drifted, missing: 0, contentCheckedAt: '2026-07-14T00:00:00Z' }
      })
    ).overall.score;
  assert(single(1) >= single(5), 'less drift should score at least as high');
  assert(single(5) >= single(12), 'less drift should score at least as high');
});

Deno.test('computeHealthReport: more assigned custom formats never lowers completeness (monotonic)', () => {
  const single = (assigned: number) =>
    computeHealthReport(
      makeInputs({
        criteria: [{ id: 'completeness', enabled: true, weight: 100 } satisfies CriterionConfig],
        profiles: [makeProfile({ assignedCfCount: assigned })]
      })
    ).overall.score;
  assert(single(47) >= single(30), 'more assigned CFs should score at least as high');
  assert(single(30) >= single(10), 'more assigned CFs should score at least as high');
});
