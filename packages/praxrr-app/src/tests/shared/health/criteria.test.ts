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
import type { DriftInstanceStatusDetail } from '$db/queries/driftStatus.ts';
import { toDriftFacts } from '$lib/server/health/gather.ts';
import { driftEntityKey } from '$sync/drift/check.ts';
import { driftContentSignature, entityAcksFor } from '$sync/drift/suppression.ts';
import type { DriftEntityChange } from '$sync/drift/types.ts';

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
      prune: 0,
      checkedAt: 't',
      contentCheckedAt: 't',
      suppression: null,
      snoozedUntil: null,
      acknowledged: 0,
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

Deno.test('drift: in-sync with pending removals still scores 100 and reports the pending count', () => {
  const drift: DriftFacts = {
    status: 'in-sync',
    reason: null,
    drifted: 0,
    missing: 0,
    unmanaged: 0,
    prune: 3,
    checkedAt: 't',
    contentCheckedAt: 't',
    suppression: null,
    snoozedUntil: null,
    acknowledged: 0,
  };
  const result = score('drift', makeInputs({ drift }), INSTANCE_SCOPE);
  assertEquals(result.score, 100);
  assertEquals(result.detail, ['Live configuration matches the desired state (3 pending removal)']);
});

Deno.test('drift: drifted with a fresh content check is penalized per entity, unmanaged excluded', () => {
  const drift: DriftFacts = {
    status: 'drifted',
    reason: null,
    drifted: 2,
    missing: 0,
    unmanaged: 10,
    prune: 10,
    checkedAt: 't',
    contentCheckedAt: 't',
    suppression: null,
    snoozedUntil: null,
    acknowledged: 0,
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
    prune: 0,
    checkedAt: 't',
    contentCheckedAt: null,
    suppression: null,
    snoozedUntil: null,
    acknowledged: 0,
  };
  assertEquals(score('drift', makeInputs({ drift }), INSTANCE_SCOPE).score, null);
});
// --- drift suppression (YAN-514): ack/snooze mute the penalty until signature change / expiry ---

const NOW_MS = Date.parse('2026-11-03T12:00:00.000Z');

function driftEntity(name: string, action: 'update' | 'create', fields: DriftEntityChange['fields'] = []) {
  return {
    section: 'qualityProfiles' as const,
    entityType: 'qualityProfile',
    name,
    action,
    category: action === 'create' ? ('missing' as const) : ('drift' as const),
    remoteId: action === 'create' ? null : 1,
    fields,
  };
}

const DRIFT_CHANGES: DriftEntityChange[] = [
  driftEntity('A', 'update'),
  driftEntity('B', 'update'),
  driftEntity('C', 'create'),
];

/** Content-fingerprinted acks for the named entities as currently stored. */
function ackAt(names: readonly string[]) {
  return entityAcksFor(
    DRIFT_CHANGES,
    DRIFT_CHANGES.filter((change) => names.includes(change.name)).map(driftEntityKey)
  );
}

/** Stored row with two drifted entities (A, B) and one missing (C); 3 alerting changes. */
function storedDriftRow(overrides: Partial<DriftInstanceStatusDetail> = {}): DriftInstanceStatusDetail {
  return {
    arrInstanceId: 1,
    arrType: 'radarr',
    status: 'drifted',
    reason: null,
    counts: { drifted: 2, missing: 1, unmanaged: 0, prune: 0 },
    driftSignature: 'sig-a',
    notifiedSignature: null,
    detectedVersion: '5.0.0',
    changes: DRIFT_CHANGES,
    checkedAt: 't',
    contentCheckedAt: 't',
    durationMs: 1,
    driftDetectedAt: 't',
    acknowledgedSignature: null,
    acknowledgedAt: null,
    acknowledgedEntities: [],
    snoozedUntil: null,
    lastRemediation: { trigger: null, status: null, signature: null, at: null, syncHistoryId: null },
    lastAutoAttemptSignature: null,
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  };
}

function driftScore(row: DriftInstanceStatusDetail, nowMs = NOW_MS) {
  return score('drift', makeInputs({ drift: toDriftFacts(row, nowMs) }), INSTANCE_SCOPE);
}

Deno.test('drift suppression: unsuppressed drift takes the full per-entity penalty', () => {
  // 100 - 8 * (2 + 1) = 76
  assertEquals(driftScore(storedDriftRow()).score, 76);
});

Deno.test('drift suppression: an acknowledged signature scores 100 with an acknowledged note', () => {
  const result = driftScore(
    storedDriftRow({ acknowledgedSignature: driftContentSignature(DRIFT_CHANGES), acknowledgedAt: 't' })
  );
  assertEquals(result.score, 100);
  assertEquals(result.suggestions, []);
  assert(result.detail[0].includes('acknowledged'));
});

Deno.test('drift suppression: an ack of a different (stale) signature does not suppress', () => {
  assertEquals(driftScore(storedDriftRow({ acknowledgedSignature: 'sig-old', acknowledgedAt: 't' })).score, 76);
});

Deno.test('drift suppression: an active snooze scores 100 and names the expiry', () => {
  const until = new Date(NOW_MS + 60_000).toISOString();
  const result = driftScore(storedDriftRow({ snoozedUntil: until }));
  assertEquals(result.score, 100);
  assertEquals(result.detail, [`Drift snoozed until ${until}`]);
});

Deno.test('drift suppression: an expired snooze takes the full penalty again', () => {
  const expired = new Date(NOW_MS).toISOString(); // until == now → no longer active
  assertEquals(driftScore(storedDriftRow({ snoozedUntil: expired })).score, 76);
});

Deno.test('drift suppression: a partial entity ack penalizes only the effective count', () => {
  const result = driftScore(storedDriftRow({ acknowledgedEntities: ackAt(['A']), acknowledgedAt: 't' }));
  // A acked → 1 drifted + 1 missing effective: 100 - 8 * 2 = 84.
  assertEquals(result.score, 84);
  assert(result.detail[0].includes('1 acknowledged'));
});

Deno.test('drift suppression: acking every alerting entity is a whole-instance acknowledgement', () => {
  const facts = toDriftFacts(storedDriftRow({ acknowledgedEntities: ackAt(['A', 'B', 'C']) }), NOW_MS);
  assertEquals(facts.suppression, 'acknowledged');
  assertEquals([facts.drifted, facts.missing], [0, 0]);
  assertEquals(driftScore(storedDriftRow({ acknowledgedEntities: ackAt(['A', 'B', 'C']) })).score, 100);
});

Deno.test('drift suppression: an acked entity whose fields change again is penalized (content-aware ack)', () => {
  const edited = DRIFT_CHANGES.map((change) =>
    change.name === 'A'
      ? driftEntity('A', 'update', [{ field: 'cutoff', type: 'changed', current: 1, desired: 2 }])
      : change
  );
  // Acked at the original content of A; A then drifts further (same key, new fields).
  const result = driftScore(
    storedDriftRow({ changes: edited, acknowledgedEntities: ackAt(['A']), acknowledgedAt: 't' })
  );
  assertEquals(result.score, 76);
  // The instance ack over the original content no longer covers the edited drift either.
  const instance = driftScore(
    storedDriftRow({
      changes: edited,
      acknowledgedSignature: driftContentSignature(DRIFT_CHANGES),
      acknowledgedAt: 't',
    })
  );
  assertEquals(instance.score, 76);
});

Deno.test('drift: environment states (unreachable/never-checked) are null, not a config defect', () => {
  for (const status of ['unreachable', 'unauthorized', 'error', 'never-checked'] as const) {
    const drift: DriftFacts = {
      status,
      reason: 'unreachable',
      drifted: 0,
      missing: 0,
      unmanaged: 0,
      prune: 0,
      checkedAt: null,
      contentCheckedAt: null,
      suppression: null,
      snoozedUntil: null,
      acknowledged: 0,
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
    r.suggestions[0].detail.includes(
      'Assign these custom formats in a quality profile to align with your linked TRaSH guide.'
    )
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
