/**
 * Pure-engine tests for Security Posture (issue #28): determinism/order-invariance, the exact
 * contribution-sum invariant, null-exclusion (skipped != 0), band thresholds, the critical band-cap
 * (anti-false-confidence), recoverable-points ranking, and the actionability invariant (every
 * warning/danger recommendation carries a concrete fix). No DB, no mocks — the engine is pure.
 */

import { assert, assertEquals } from '@std/assert';
import { SECURITY_POSTURE_ENGINE_VERSION, computeShieldReport, type PostureInputs } from '$shared/security/index.ts';

function makeInputs(overrides: Partial<PostureInputs> = {}): PostureInputs {
  return {
    authMode: 'on',
    bindHost: '0.0.0.0',
    port: 6868,
    oidcConfigured: false,
    oidcPartiallyConfigured: false,
    appApiKeyPresent: true,
    appApiKeyStrong: true,
    instances: [
      { id: 1, name: 'Radarr', arrType: 'radarr', url: 'http://radarr:7878' },
      { id: 2, name: 'Sonarr', arrType: 'sonarr', url: 'http://sonarr:8989' },
    ],
    rotation: {
      activeVersion: '1',
      configuredVersions: ['1'],
      instanceKeyVersions: [{ instanceId: 1, keyVersion: '1' }],
    },
    redactionVerified: true,
    sessionCookieSecure: false,
    nowIso: '2026-07-09T02:00:00.000Z',
    ...overrides,
  };
}

Deno.test('computeShieldReport: stamps the engine version and generatedAt from nowIso', () => {
  const report = computeShieldReport(makeInputs());
  assertEquals(report.engineVersion, SECURITY_POSTURE_ENGINE_VERSION);
  assertEquals(report.generatedAt, '2026-07-09T02:00:00.000Z');
});

Deno.test('computeShieldReport: identical input yields deep-equal output (deterministic, no Date/random)', () => {
  assertEquals(computeShieldReport(makeInputs()), computeShieldReport(makeInputs()));
});

Deno.test('computeShieldReport: instance order does not change the score (order-invariant)', () => {
  const a = makeInputs();
  const b = makeInputs({ instances: [...a.instances].reverse() });
  assertEquals(computeShieldReport(a).score, computeShieldReport(b).score);
});

Deno.test('computeShieldReport: per-check contributions sum EXACTLY to the score', () => {
  const cases = [
    makeInputs(),
    makeInputs({
      authMode: 'off',
      bindHost: '0.0.0.0',
      instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'http://8.8.8.8' }],
    }),
    makeInputs({ authMode: 'oidc', oidcConfigured: false, redactionVerified: false }),
    makeInputs({ authMode: 'local', instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'https://r' }] }),
  ];
  for (const inputs of cases) {
    const report = computeShieldReport(inputs);
    const sum = report.checks.reduce((total, c) => total + c.contribution, 0);
    assertEquals(sum, report.score, `contributions (${sum}) must equal score (${report.score})`);
  }
});

Deno.test('computeShieldReport: a null sub-score is excluded, never treated as 0', () => {
  // A healthy 'on' deployment with https instances: rotation & app-key nuances aside, adding a
  // null-scoring check (redaction assured, single-key rotation) must not drag the score down.
  const report = computeShieldReport(
    makeInputs({ instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'https://r' }] })
  );
  // auth 100 + transport 100 + app_key 70 (rotation & redaction null) → (100*40+100*30+70*15)/85 = 95.
  assertEquals(report.score, 95);
  assertEquals(report.band, 'hardened');
  for (const c of report.checks) {
    if (c.score === null) assertEquals(c.contribution, 0, `${c.id} null must contribute 0`);
  }
});

Deno.test('computeShieldReport: band thresholds at 85 (hardened) and 60 (guarded)', () => {
  const hardened = computeShieldReport(
    makeInputs({ instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'https://r' }] })
  );
  assert(hardened.score >= 85);
  assertEquals(hardened.band, 'hardened');

  // local(60) + private-http(65) + app_key(70), no action check → 64 → guarded (pins the >=60 boundary).
  const guarded = computeShieldReport(
    makeInputs({ authMode: 'local', instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'http://10.0.0.5' }] })
  );
  assert(guarded.score >= 60 && guarded.score < 85, `expected a guarded-range score, got ${guarded.score}`);
  assertEquals(guarded.band, 'guarded');
  assertEquals(guarded.bandCappedBy, null); // numeric band, not a cap

  // off+loopback(55) + private-http(65), app_key null → 59 → exposed (just below 60, no action cap).
  const exposed = computeShieldReport(
    makeInputs({
      authMode: 'off',
      bindHost: '127.0.0.1',
      instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'http://10.0.0.5' }],
    })
  );
  assert(exposed.score < 60, `expected a sub-60 score, got ${exposed.score}`);
  assertEquals(exposed.band, 'exposed');
});

Deno.test('computeShieldReport: recoverablePoints = round((100 - score) * weight / Σ scored weights)', () => {
  // Only control_plane_auth scores: local=60 (weight 40); no app key (null), no instances (transport null),
  // single-key rotation (null), redaction assured (null). Σ scored weight = 40 → round((100-60)*40/40) = 40.
  const report = computeShieldReport(makeInputs({ authMode: 'local', appApiKeyPresent: false, instances: [] }));
  const auth = report.checks.find((c) => c.id === 'control_plane_auth');
  assertEquals(auth?.score, 60);
  assertEquals(auth?.recoverablePoints, 40);
});

Deno.test('computeShieldReport: AUTH=off on a public bind is capped to exposed despite a high average', () => {
  // Otherwise-perfect: https instances, strong key — but the front door is wide open.
  const report = computeShieldReport(
    makeInputs({
      authMode: 'off',
      bindHost: '0.0.0.0',
      instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'https://r' }],
    })
  );
  assertEquals(report.band, 'exposed');
  assertEquals(report.bandCappedBy?.checkId, 'control_plane_auth');
});

Deno.test('computeShieldReport: a public-http instance caps a would-be-hardened band down to guarded', () => {
  // No app key set (app_key null) + auth 100 + transport mean(https 100, public-http 30)=65 →
  // (100*40 + 65*30)/70 = 85 which is numerically 'hardened', but the public-http action caps it.
  const report = computeShieldReport(
    makeInputs({
      authMode: 'on',
      appApiKeyPresent: false,
      instances: [
        { id: 1, name: 'Secure', arrType: 'radarr', url: 'https://secure' },
        { id: 2, name: 'Exposed', arrType: 'sonarr', url: 'http://8.8.8.8' },
      ],
    })
  );
  assert(report.score >= 85, `expected a would-be-hardened numeric score, got ${report.score}`);
  assertEquals(report.band, 'guarded');
  assertEquals(report.bandCappedBy?.checkId, 'arr_transport');
});

Deno.test('computeShieldReport: a broken log-redaction self-check drags and caps the score', () => {
  const ok = computeShieldReport(
    makeInputs({ redactionVerified: true, instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'https://r' }] })
  );
  const broken = computeShieldReport(
    makeInputs({ redactionVerified: false, instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'https://r' }] })
  );
  assert(broken.score < ok.score, 'a redaction failure must lower the score');
  assertEquals(broken.band, 'exposed');
  assertEquals(broken.bandCappedBy?.checkId, 'log_redaction');
  assert(broken.assurances.some((a) => a.id === 'log_redaction' && !a.verified));
});

Deno.test('computeShieldReport: topActions are ranked by recoverable points and carry fixes', () => {
  const report = computeShieldReport(
    makeInputs({
      authMode: 'off',
      bindHost: '0.0.0.0',
      instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'http://8.8.8.8' }],
    })
  );
  assert(report.topActions.length >= 1);
  for (let i = 1; i < report.topActions.length; i += 1) {
    assert(report.topActions[i - 1].recoverablePoints >= report.topActions[i].recoverablePoints, 'sorted desc');
  }
  for (const action of report.topActions) assert(action.fix.kind !== 'none', 'every top action carries a fix');
});

Deno.test('computeShieldReport: actionability invariant — no warning/danger recommendation lacks a fix', () => {
  const cases = [
    makeInputs({ authMode: 'off', bindHost: '0.0.0.0' }),
    makeInputs({ authMode: 'local' }),
    makeInputs({ authMode: 'oidc', oidcConfigured: false }),
    makeInputs({ authMode: 'on', appApiKeyStrong: false }),
    makeInputs({ instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'http://8.8.8.8' }] }),
    makeInputs({ redactionVerified: false }),
    makeInputs({
      authMode: 'on',
      rotation: {
        activeVersion: '2',
        configuredVersions: ['1', '2'],
        instanceKeyVersions: [{ instanceId: 1, keyVersion: '1' }],
      },
    }),
  ];
  for (const inputs of cases) {
    const report = computeShieldReport(inputs);
    for (const check of report.checks) {
      for (const recommendation of check.recommendations) {
        if (recommendation.line.tone === 'warning' || recommendation.line.tone === 'danger') {
          assert(
            recommendation.fix.kind !== 'none',
            `${check.id} ${recommendation.line.tone} recommendation must carry a fix`
          );
        }
      }
    }
  }
});

Deno.test('computeShieldReport: the report never carries a secret value, only host strings and booleans', () => {
  const report = computeShieldReport(makeInputs());
  const serialized = JSON.stringify(report);
  assert(!serialized.includes('api_key'));
  assert(!serialized.toLowerCase().includes('password'));
});

Deno.test('computeShieldReport: an unparseable instance URL degrades that row without throwing', () => {
  const report = computeShieldReport(
    makeInputs({ instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'not a url' }] })
  );
  const row = report.transport.find((r) => r.instanceId === 1);
  assertEquals(row?.score, null);
  assertEquals(row?.status, 'na');
});
