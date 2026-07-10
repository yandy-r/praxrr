/**
 * Per-criterion unit tests for Config Health (issue #22). Each criterion is exercised in isolation
 * through the ALL_CRITERIA registry, at the relevant scope, asserting the raw-signal → 0–100 (or
 * null) mapping and the null-skip contract.
 */

import { assert, assertEquals } from '@std/assert';
import {
  ALL_CRITERIA,
  type Criterion,
  type CriterionConfig,
  type CriterionId,
  type DriftFacts,
  type HealthInputs,
  type HealthScope,
  type ProfileFacts,
} from '$shared/health/index.ts';

const CONFIG: CriterionConfig = { id: 'completeness', enabled: true, weight: 100 };

function criterion(id: CriterionId): Criterion {
  const found = ALL_CRITERIA.find((c) => c.id === id);
  if (!found) throw new Error(`no criterion ${id}`);
  return found;
}

function makeProfile(overrides: Partial<ProfileFacts> = {}): ProfileFacts {
  return {
    name: 'P',
    arrType: 'radarr',
    compatible: true,
    enabledQualityCount: 5,
    hasCutoff: true,
    assignedCfCount: 47,
    totalCfCount: 47,
    recommendedCfCount: 47,
    thresholds: { minimumScore: 0, upgradeUntilScore: 10000, upgradeScoreIncrement: 1 },
    cfScores: [{ name: 'a', score: 100 }],
    ...overrides,
  };
}

function makeInputs(overrides: Partial<HealthInputs> = {}): HealthInputs {
  return {
    instanceId: 1,
    instanceName: 'I',
    arrType: 'radarr',
    detectedVersion: '5.0.0.0',
    versionSupported: true,
    drift: {
      status: 'in-sync',
      reason: null,
      drifted: 0,
      missing: 0,
      unmanaged: 0,
      checkedAt: 't',
      contentCheckedAt: 't',
    },
    profiles: [makeProfile()],
    trashRecommendedCfNames: null,
    criteria: [CONFIG],
    nowIso: 't',
    ...overrides,
  };
}

const PROFILE_SCOPE: HealthScope = { kind: 'profile', profileName: 'P' };
const INSTANCE_SCOPE: HealthScope = { kind: 'instance' };

function score(id: CriterionId, inputs: HealthInputs, scope: HealthScope) {
  return criterion(id).score(inputs, scope, { id, enabled: true, weight: 100 });
}

// --- completeness ---

Deno.test('completeness: full assignment with cutoff + qualities scores 100', () => {
  assertEquals(score('completeness', makeInputs(), PROFILE_SCOPE).score, 100);
});

Deno.test('completeness: no recommended CFs is null (nothing to measure)', () => {
  const inputs = makeInputs({
    profiles: [makeProfile({ recommendedCfCount: 0, totalCfCount: 0, assignedCfCount: 0 })],
  });
  assertEquals(score('completeness', inputs, PROFILE_SCOPE).score, null);
});

Deno.test('completeness: missing cutoff and disabled qualities apply penalties', () => {
  const penalized = score(
    'completeness',
    makeInputs({ profiles: [makeProfile({ hasCutoff: false, enabledQualityCount: 0 })] }),
    PROFILE_SCOPE
  ).score;
  assert(penalized !== null && penalized < 100, `expected penalty below 100, got ${penalized}`);
});

// --- drift ---

Deno.test('drift: in-sync scores 100', () => {
  assertEquals(score('drift', makeInputs(), INSTANCE_SCOPE).score, 100);
});

Deno.test('drift: drifted with a fresh content check is penalized per entity, unmanaged excluded', () => {
  const drift: DriftFacts = {
    status: 'drifted',
    reason: null,
    drifted: 2,
    missing: 0,
    unmanaged: 10,
    checkedAt: 't',
    contentCheckedAt: 't',
  };
  // 100 - 8*(2+0) = 84; the 10 unmanaged entities must NOT lower the score.
  assertEquals(score('drift', makeInputs({ drift }), INSTANCE_SCOPE).score, 84);
});

Deno.test('drift: drifted but stale (no fresh content check) is null, not real drift', () => {
  const drift: DriftFacts = {
    status: 'drifted',
    reason: null,
    drifted: 5,
    missing: 5,
    unmanaged: 0,
    checkedAt: 't',
    contentCheckedAt: null,
  };
  assertEquals(score('drift', makeInputs({ drift }), INSTANCE_SCOPE).score, null);
});

Deno.test('drift: environment states (unreachable/never-checked) are null, not a config defect', () => {
  for (const status of ['unreachable', 'unauthorized', 'error', 'never-checked'] as const) {
    const drift: DriftFacts = {
      status,
      reason: 'unreachable',
      drifted: 0,
      missing: 0,
      unmanaged: 0,
      checkedAt: null,
      contentCheckedAt: null,
    };
    assertEquals(score('drift', makeInputs({ drift }), INSTANCE_SCOPE).score, null, `status ${status} should be null`);
  }
});

// --- coherence ---

Deno.test('coherence: unreadable thresholds are null (skipped, not 0)', () => {
  const inputs = makeInputs({ profiles: [makeProfile({ thresholds: null })] });
  assertEquals(score('coherence', inputs, PROFILE_SCOPE).score, null);
});

Deno.test('coherence: minimum score above the upgrade target is penalized', () => {
  const inputs = makeInputs({
    profiles: [makeProfile({ thresholds: { minimumScore: 500, upgradeUntilScore: 100, upgradeScoreIncrement: 1 } })],
  });
  const result = score('coherence', inputs, PROFILE_SCOPE).score;
  assert(result !== null && result < 100, `expected coherence penalty, got ${result}`);
});

Deno.test('coherence: all-zero custom-format scores are penalized', () => {
  const inputs = makeInputs({
    profiles: [
      makeProfile({
        cfScores: [
          { name: 'a', score: 0 },
          { name: 'b', score: null },
        ],
      }),
    ],
  });
  const result = score('coherence', inputs, PROFILE_SCOPE).score;
  assert(result !== null && result < 100, `expected no-signal penalty, got ${result}`);
});

// --- compatibility ---

Deno.test('compatibility: compatible profile on a supported version scores 100', () => {
  assertEquals(score('compatibility', makeInputs(), PROFILE_SCOPE).score, 100);
});

Deno.test('compatibility: an incompatible profile is graded down (not zeroed)', () => {
  const inputs = makeInputs({ profiles: [makeProfile({ compatible: false })] });
  assertEquals(score('compatibility', inputs, PROFILE_SCOPE).score, 40);
});

Deno.test('compatibility: an unsupported version penalizes the score', () => {
  const inputs = makeInputs({ versionSupported: false });
  assertEquals(score('compatibility', inputs, PROFILE_SCOPE).score, 70);
});

Deno.test('compatibility: no profiles and unknown version is null', () => {
  const inputs = makeInputs({ profiles: [], versionSupported: null });
  assertEquals(score('compatibility', inputs, INSTANCE_SCOPE).score, null);
});

Deno.test('compatibility: unknown compatibility (null) is skipped, not scored as incompatible', () => {
  // A degraded/unreadable profile carries compatible=null and must NOT inject a real 40 sub-score.
  const inputs = makeInputs({ profiles: [makeProfile({ compatible: null })] });
  assertEquals(score('compatibility', inputs, PROFILE_SCOPE).score, null);
});

// --- trash_alignment ---

Deno.test('trash_alignment: profile scope is always null (never shames a specialized profile)', () => {
  const inputs = makeInputs({ trashRecommendedCfNames: ['CF-A'] });
  assertEquals(score('trash_alignment', inputs, PROFILE_SCOPE).score, null);
});

Deno.test('trash_alignment: null reference set is skipped (unmeasurable, not zero)', () => {
  assertEquals(score('trash_alignment', makeInputs({ trashRecommendedCfNames: null }), INSTANCE_SCOPE).score, null);
});

Deno.test('trash_alignment: empty reference set is skipped, never NaN (divide-by-zero guard)', () => {
  assertEquals(score('trash_alignment', makeInputs({ trashRecommendedCfNames: [] }), INSTANCE_SCOPE).score, null);
});

Deno.test('trash_alignment: non-null reference set with nothing assigned is a REAL 0 (explicit opt-in)', () => {
  const inputs = makeInputs({
    trashRecommendedCfNames: ['CF-A', 'CF-B'],
    profiles: [makeProfile({ cfScores: [{ name: 'CF-A', score: null }] })],
  });
  assertEquals(score('trash_alignment', inputs, INSTANCE_SCOPE).score, 0);
});

Deno.test('trash_alignment: union across MULTIPLE profiles aligns both (instance-level semantic)', () => {
  const inputs = makeInputs({
    trashRecommendedCfNames: ['CF-A', 'CF-B'],
    profiles: [
      makeProfile({ name: 'P1', cfScores: [{ name: 'CF-A', score: 100 }] }),
      makeProfile({ name: 'P2', cfScores: [{ name: 'CF-B', score: -50 }] }),
    ],
  });
  assertEquals(score('trash_alignment', inputs, INSTANCE_SCOPE).score, 100);
});

Deno.test('trash_alignment: intersection is case-insensitive', () => {
  const inputs = makeInputs({
    trashRecommendedCfNames: ['CF-Alpha'],
    profiles: [makeProfile({ cfScores: [{ name: 'cf-alpha', score: 10 }] })],
  });
  assertEquals(score('trash_alignment', inputs, INSTANCE_SCOPE).score, 100);
});

Deno.test('trash_alignment: a recommended CF assigned with score===null is reported MISSING, not aligned', () => {
  const inputs = makeInputs({
    trashRecommendedCfNames: ['CF-A', 'CF-B'],
    profiles: [
      makeProfile({
        cfScores: [
          { name: 'CF-A', score: 5 },
          { name: 'CF-B', score: null },
        ],
      }),
    ],
  });
  const r = score('trash_alignment', inputs, INSTANCE_SCOPE);
  assertEquals(r.score, 50);
  assert(r.suggestions[0].headline.startsWith('TRaSH alignment:'));
  assert(r.suggestions[0].detail.includes('CF-B'));
  assert(
    r.suggestions[0].detail.includes('Assign these custom formats in a quality profile to align with your linked TRaSH guide.')
  );
  assertEquals(r.suggestions[0].tone, 'info');
});

Deno.test('trash_alignment: all-degraded profiles (unreadable) are unmeasurable => null, not a false 0', () => {
  // Unbuilt cache / failed scoring read: degradedProfile carries thresholds=null + empty cfScores.
  // R stays populated (independent app-DB read), but the assignment surface is unreadable => skip.
  const inputs = makeInputs({
    trashRecommendedCfNames: ['CF-A', 'CF-B'],
    profiles: [makeProfile({ thresholds: null, cfScores: [] })],
  });
  assertEquals(score('trash_alignment', inputs, INSTANCE_SCOPE).score, null);
});

Deno.test('trash_alignment: no profiles (gather failure) is unmeasurable => null', () => {
  const inputs = makeInputs({ trashRecommendedCfNames: ['CF-A'], profiles: [] });
  assertEquals(score('trash_alignment', inputs, INSTANCE_SCOPE).score, null);
});

Deno.test('trash_alignment: missing-CF suggestion caps the named sample at 5 and appends the corrective action', () => {
  const names = ['CF-1', 'CF-2', 'CF-3', 'CF-4', 'CF-5', 'CF-6', 'CF-7'];
  const inputs = makeInputs({
    trashRecommendedCfNames: names,
    // Readable profile (thresholds set) that assigns none of the recommended CFs.
    profiles: [makeProfile({ cfScores: [] })],
  });
  const r = score('trash_alignment', inputs, INSTANCE_SCOPE);
  assertEquals(r.score, 0);
  assert(r.suggestions[0].headline.includes('7 opted-in'));
  // 5 named CFs (capped) + 1 corrective-action line.
  assertEquals(r.suggestions[0].detail.length, 6);
});

Deno.test('trash_alignment: fully aligned emits no suggestion (quiet path)', () => {
  const inputs = makeInputs({
    trashRecommendedCfNames: ['CF-A'],
    profiles: [makeProfile({ cfScores: [{ name: 'CF-A', score: 100 }] })],
  });
  const r = score('trash_alignment', inputs, INSTANCE_SCOPE);
  assertEquals(r.score, 100);
  assertEquals(r.suggestions.length, 0);
});
