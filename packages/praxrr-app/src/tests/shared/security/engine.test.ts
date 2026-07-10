/**
 * Pure-engine tests for Security Posture (issue #28): determinism/order-invariance, the exact
 * contribution-sum invariant, null-exclusion (skipped != 0), band thresholds, the critical band-cap
 * (anti-false-confidence), recoverable-points ranking, and the actionability invariant (every
 * warning/danger recommendation carries a concrete fix). No DB, no mocks — the engine is pure.
 */

import { assert, assertEquals } from '@std/assert';
import {
  SECURITY_POSTURE_ENGINE_VERSION,
  computeShieldReport,
  type CookieSecureMode,
  type DnsAddressClassCounts,
  type DnsTransportEvidence,
  type InstanceFact,
  type PostureInputs,
  type SessionPosture,
  type SessionTransport,
  type ShieldFix,
} from '$shared/security/index.ts';

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
    session: { transport: 'unknown', cookieSecure: false, cookieSecureMode: 'auto' },
    trustedProxyConfigured: false,
    trustedProxyValidRangeCount: 0,
    trustedProxyInvalidEntries: [],
    trustedProxyOverlyBroad: false,
    nowIso: '2026-07-09T02:00:00.000Z',
    ...overrides,
  };
}

/** Build a session posture, computing `cookieSecure` exactly as `resolveCookieSecure(mode, transport)` does. */
function sessionPosture(transport: SessionTransport, mode: CookieSecureMode = 'auto'): SessionPosture {
  const cookieSecure =
    mode === 'on' ? true : mode === 'off' ? false : transport === 'direct-secure' || transport === 'proxy-terminated';
  return { transport, cookieSecure, cookieSecureMode: mode };
}

/** Every observable (transport × mode) posture — session state must never move a score. */
const ALL_SESSIONS: readonly SessionPosture[] = [
  sessionPosture('direct-secure', 'on'),
  sessionPosture('direct-secure', 'off'),
  sessionPosture('proxy-terminated', 'auto'),
  sessionPosture('proxy-terminated', 'off'),
  sessionPosture('insecure', 'auto'),
  sessionPosture('insecure', 'on'),
  sessionPosture('unknown', 'auto'),
  sessionPosture('unknown', 'on'),
];

const ZERO_DNS_COUNTS: DnsAddressClassCounts = {
  loopback: 0,
  private: 0,
  linkLocal: 0,
  public: 0,
  special: 0,
};

function dnsEvidence(
  overrides: Partial<Omit<DnsTransportEvidence, 'ipv4' | 'ipv6'>> = {},
  ipv4: Partial<DnsAddressClassCounts> = {},
  ipv6: Partial<DnsAddressClassCounts> = {}
): DnsTransportEvidence {
  return {
    outcome: 'resolved',
    source: 'fresh',
    ipv4: { ...ZERO_DNS_COUNTS, ...ipv4 },
    ipv6: { ...ZERO_DNS_COUNTS, ...ipv6 },
    retainedCount:
      Object.values(ipv4).reduce((sum, count) => sum + (count ?? 0), 0) +
      Object.values(ipv6).reduce((sum, count) => sum + (count ?? 0), 0),
    observedAt: '2026-07-10T00:00:00.000Z',
    incomplete: false,
    truncated: false,
    addressClassesChanged: false,
    ...overrides,
  };
}

function instance(id: number, url: string, dns?: DnsTransportEvidence): InstanceFact {
  const base = { id, name: `arr-${id}`, arrType: 'radarr' as const, url };
  return dns === undefined ? base : { ...base, dns };
}

Deno.test('computeShieldReport: stamps the engine version and generatedAt from nowIso', () => {
  const report = computeShieldReport(makeInputs());
  assertEquals(SECURITY_POSTURE_ENGINE_VERSION, '4'); // '3' proxy trust (#228) → '4' DNS transport evidence (#229)
  assertEquals(report.engineVersion, SECURITY_POSTURE_ENGINE_VERSION);
  assertEquals(report.engineVersion, '4');
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

Deno.test('computeShieldReport: DNS evidence produces the exact conservative row and check matrix', () => {
  const cases: readonly {
    label: string;
    dns: DnsTransportEvidence;
    tier: 'private' | 'public' | 'mixed' | 'unknown';
    score: 65 | 30;
    status: 'attention' | 'action';
    critical: boolean;
  }[] = [
    {
      label: 'IPv4 private-only',
      dns: dnsEvidence({}, { private: 1 }),
      tier: 'private',
      score: 65,
      status: 'attention',
      critical: false,
    },
    {
      label: 'IPv6 local-only',
      dns: dnsEvidence({}, {}, { loopback: 1, linkLocal: 1 }),
      tier: 'private',
      score: 65,
      status: 'attention',
      critical: false,
    },
    {
      label: 'public-only',
      dns: dnsEvidence({}, {}, { public: 1 }),
      tier: 'public',
      score: 30,
      status: 'action',
      critical: true,
    },
    {
      label: 'mixed local/public',
      dns: dnsEvidence({}, { private: 1, public: 1 }),
      tier: 'mixed',
      score: 30,
      status: 'action',
      critical: true,
    },
    {
      label: 'public/non-public class change',
      dns: dnsEvidence({ addressClassesChanged: true }, { private: 1 }),
      tier: 'mixed',
      score: 30,
      status: 'action',
      critical: true,
    },
    {
      label: 'partial public',
      dns: dnsEvidence({ outcome: 'partial', incomplete: true }, { public: 1 }),
      tier: 'mixed',
      score: 30,
      status: 'action',
      critical: true,
    },
    {
      label: 'special-only',
      dns: dnsEvidence({}, { special: 1 }),
      tier: 'unknown',
      score: 65,
      status: 'attention',
      critical: false,
    },
  ];

  for (const testCase of cases) {
    const report = computeShieldReport(
      makeInputs({ instances: [instance(1, 'http://arr.example.com:7878', testCase.dns)] })
    );
    const row = report.transport[0];
    const check = report.checks.find((candidate) => candidate.id === 'arr_transport');
    assertEquals(row.tier, testCase.tier, `${testCase.label} row tier`);
    assertEquals(row.score, testCase.score, `${testCase.label} row score`);
    assertEquals(row.status, testCase.status, `${testCase.label} row status`);
    assertEquals(row.dns, testCase.dns, `${testCase.label} evidence`);
    assertEquals(check?.score, testCase.score, `${testCase.label} check score`);
    assertEquals(check?.status, testCase.status, `${testCase.label} check status`);
    assertEquals(check?.critical, testCase.critical, `${testCase.label} critical`);
    assertEquals(check?.bandCapWhenAction, testCase.critical ? 'guarded' : null, `${testCase.label} cap`);
  }
});

Deno.test('computeShieldReport: DNS contributions, recoverable points, and order remain exact', () => {
  const local = computeShieldReport(
    makeInputs({
      appApiKeyPresent: false,
      instances: [instance(1, 'http://local.example.com', dnsEvidence({}, { private: 1 }))],
    })
  );
  const localCheck = local.checks.find((check) => check.id === 'arr_transport');
  assertEquals(local.score, 85);
  assertEquals(local.band, 'hardened');
  assertEquals(localCheck?.recoverablePoints, 15);
  assertEquals(
    local.checks.reduce((sum, check) => sum + check.contribution, 0),
    local.score
  );

  const publicDns = dnsEvidence({}, { public: 1 });
  const privateDns = dnsEvidence({}, {}, { private: 1 });
  const instances = [
    instance(1, 'http://public.example.com', publicDns),
    instance(2, 'http://private.example.com', privateDns),
    instance(3, 'https://secure.example.com'),
  ];
  const forward = computeShieldReport(makeInputs({ instances }));
  const reverse = computeShieldReport(makeInputs({ instances: [...instances].reverse() }));
  assertEquals(forward.score, reverse.score);
  assertEquals(
    forward.checks.map((check) => [check.id, check.score, check.contribution, check.recoverablePoints]),
    reverse.checks.map((check) => [check.id, check.score, check.contribution, check.recoverablePoints])
  );
  for (const report of [forward, reverse]) {
    assertEquals(
      report.checks.reduce((sum, check) => sum + check.contribution, 0),
      report.score
    );
  }
});

Deno.test('computeShieldReport: DNS public and mixed evidence cap a would-be hardened report at guarded', () => {
  for (const dns of [dnsEvidence({}, { public: 1 }), dnsEvidence({}, { private: 1, public: 1 })]) {
    const instances = [instance(1, 'https://secure'), instance(2, 'http://arr.example.com', dns)];
    const report = computeShieldReport(makeInputs({ appApiKeyPresent: false, instances }));
    assertEquals(report.score, 85);
    assertEquals(report.band, 'guarded');
    assertEquals(report.bandCappedBy?.checkId, 'arr_transport');
  }
});

Deno.test('computeShieldReport: established trusted URL cases ignore attached DNS and remain 100', () => {
  const hostileDns = dnsEvidence({ addressClassesChanged: true }, { public: 1, private: 1 });
  const instances = [
    instance(1, 'https://secure.example.com', hostileDns),
    instance(2, 'http://127.0.0.1:7878', hostileDns),
    instance(3, 'http://radarr:7878', hostileDns),
  ];
  const report = computeShieldReport(makeInputs({ instances }));
  const transport = report.checks.find((check) => check.id === 'arr_transport');
  assertEquals(transport?.score, 100);
  assertEquals(transport?.status, 'pass');
  for (const row of report.transport) {
    assertEquals(row.score, 100);
    assertEquals(row.dns.outcome, 'not-applicable');
    assertEquals(row.dns.source, 'none');
  }
});

Deno.test('computeShieldReport: every DNS action remains actionable and resolver evidence stays redacted', () => {
  for (const dns of [
    dnsEvidence({}, { public: 1 }),
    dnsEvidence({}, { public: 1, private: 1 }),
    dnsEvidence({ addressClassesChanged: true }, {}, { private: 1 }),
  ]) {
    const report = computeShieldReport(makeInputs({ instances: [instance(1, 'http://arr.example.com', dns)] }));
    const check = report.checks.find((candidate) => candidate.id === 'arr_transport');
    assert(check);
    assertEquals(check.status, 'action');
    assert(check.recommendations.length > 0);
    for (const recommendation of check.recommendations) {
      assert(recommendation.fix.kind !== 'none');
    }
    const serialized = JSON.stringify(report);
    assert(!serialized.includes('8.8.8.8'));
    assert(!serialized.includes('resolver error'));
  }
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

// --- session posture (issue #227): unscored advisory/assurance surface --------------------------

Deno.test(
  'computeShieldReport: pinned scores, band caps, and recoverablePoints are identical across every transport state',
  () => {
    // Session posture is appended AFTER rollup/contributions/capBand and feeds none of them, so every
    // pinned value must be byte-identical no matter which transport the report-viewer's request used.
    for (const session of ALL_SESSIONS) {
      const hardened = computeShieldReport(
        makeInputs({ session, instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'https://r' }] })
      );
      assertEquals(hardened.score, 95);
      assertEquals(hardened.band, 'hardened');

      const guarded = computeShieldReport(
        makeInputs({
          session,
          authMode: 'local',
          instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'http://10.0.0.5' }],
        })
      );
      assertEquals(guarded.score, 64);
      assertEquals(guarded.band, 'guarded');
      assertEquals(guarded.bandCappedBy, null);

      const exposed = computeShieldReport(
        makeInputs({
          session,
          authMode: 'off',
          bindHost: '127.0.0.1',
          instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'http://10.0.0.5' }],
        })
      );
      assertEquals(exposed.score, 59);
      assertEquals(exposed.band, 'exposed');

      const transportCapped = computeShieldReport(
        makeInputs({
          session,
          authMode: 'on',
          appApiKeyPresent: false,
          instances: [
            { id: 1, name: 'Secure', arrType: 'radarr', url: 'https://secure' },
            { id: 2, name: 'Exposed', arrType: 'sonarr', url: 'http://8.8.8.8' },
          ],
        })
      );
      assertEquals(transportCapped.score, 85);
      assertEquals(transportCapped.band, 'guarded');
      assertEquals(transportCapped.bandCappedBy?.checkId, 'arr_transport');

      const authCapped = computeShieldReport(
        makeInputs({
          session,
          authMode: 'off',
          bindHost: '0.0.0.0',
          instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'https://r' }],
        })
      );
      assertEquals(authCapped.band, 'exposed');
      assertEquals(authCapped.bandCappedBy?.checkId, 'control_plane_auth');

      const recoverable = computeShieldReport(
        makeInputs({ session, authMode: 'local', appApiKeyPresent: false, instances: [] })
      );
      assertEquals(recoverable.checks.find((c) => c.id === 'control_plane_auth')?.recoverablePoints, 40);

      for (const report of [hardened, guarded, exposed, transportCapped, authCapped, recoverable]) {
        const sum = report.checks.reduce((total, c) => total + c.contribution, 0);
        assertEquals(
          sum,
          report.score,
          `${session.transport}/${session.cookieSecureMode}: contributions must equal score`
        );
      }
    }
  }
);

Deno.test(
  'computeShieldReport: session posture is unscored — direct-secure(on) and unknown yield the same score/band',
  () => {
    const directSecure = computeShieldReport(makeInputs({ session: sessionPosture('direct-secure', 'on') }));
    const unknown = computeShieldReport(makeInputs({ session: sessionPosture('unknown') }));
    assertEquals(directSecure.score, unknown.score);
    assertEquals(directSecure.band, unknown.band);
  }
);

Deno.test('computeShieldReport: engineVersion is the pinned report-surface version 4 for every transport', () => {
  assertEquals(SECURITY_POSTURE_ENGINE_VERSION, '4');
  for (const session of ALL_SESSIONS) {
    assertEquals(computeShieldReport(makeInputs({ session })).engineVersion, '4');
  }
});

Deno.test('computeShieldReport: per-(transport × mode) session advisory + assurance table', () => {
  const table: readonly {
    transport: SessionTransport;
    mode: CookieSecureMode;
    expectAdvisory: boolean;
    fixKind?: ShieldFix['kind'];
    fixName?: string;
    expectSecureAssurance: boolean;
  }[] = [
    { transport: 'direct-secure', mode: 'auto', expectAdvisory: false, expectSecureAssurance: true },
    { transport: 'direct-secure', mode: 'on', expectAdvisory: false, expectSecureAssurance: true },
    {
      transport: 'direct-secure',
      mode: 'off',
      expectAdvisory: true,
      fixKind: 'env-var',
      fixName: 'PRAXRR_COOKIE_SECURE',
      expectSecureAssurance: false,
    },
    {
      transport: 'proxy-terminated',
      mode: 'auto',
      expectAdvisory: true,
      fixKind: 'env-var',
      fixName: 'PRAXRR_COOKIE_SECURE',
      expectSecureAssurance: false,
    },
    {
      transport: 'proxy-terminated',
      mode: 'on',
      expectAdvisory: true,
      fixKind: 'env-var',
      fixName: 'PRAXRR_COOKIE_SECURE',
      expectSecureAssurance: false,
    },
    {
      transport: 'proxy-terminated',
      mode: 'off',
      expectAdvisory: true,
      fixKind: 'env-var',
      fixName: 'PRAXRR_COOKIE_SECURE',
      expectSecureAssurance: false,
    },
    { transport: 'insecure', mode: 'auto', expectAdvisory: true, fixKind: 'docs', expectSecureAssurance: false },
    { transport: 'insecure', mode: 'off', expectAdvisory: true, fixKind: 'docs', expectSecureAssurance: false },
    {
      transport: 'insecure',
      mode: 'on',
      expectAdvisory: true,
      fixKind: 'env-var',
      fixName: 'PRAXRR_COOKIE_SECURE',
      expectSecureAssurance: false,
    },
    {
      transport: 'unknown',
      mode: 'auto',
      expectAdvisory: true,
      fixKind: 'env-var',
      fixName: 'PRAXRR_COOKIE_SECURE',
      expectSecureAssurance: false,
    },
    {
      transport: 'unknown',
      mode: 'off',
      expectAdvisory: true,
      fixKind: 'env-var',
      fixName: 'PRAXRR_COOKIE_SECURE',
      expectSecureAssurance: false,
    },
    {
      transport: 'unknown',
      mode: 'on',
      expectAdvisory: true,
      fixKind: 'env-var',
      fixName: 'PRAXRR_COOKIE_SECURE',
      expectSecureAssurance: false,
    },
  ];
  for (const row of table) {
    const label = `${row.transport}/${row.mode}`;
    const report = computeShieldReport(makeInputs({ session: sessionPosture(row.transport, row.mode) }));
    const advisory = report.advisories.find((a) => a.id === 'session_cookie_transport');
    if (row.expectAdvisory) {
      assert(advisory, `${label} must emit a session_cookie_transport advisory`);
      assertEquals(advisory.fix.kind, row.fixKind, `${label} fix kind`);
      if (row.fixName !== undefined) {
        assert(advisory.fix.kind === 'env-var');
        assertEquals(advisory.fix.name, row.fixName, `${label} fix name`);
      }
    } else {
      assertEquals(advisory, undefined, `${label} must NOT emit an advisory`);
    }
    const secure = report.assurances.find((a) => a.id === 'session_cookie_secure');
    if (row.expectSecureAssurance) {
      assert(secure?.verified, `${label} must affirm session_cookie_secure`);
    } else {
      assertEquals(secure, undefined, `${label} must NOT affirm session_cookie_secure`);
    }
    assert(
      report.assurances.some((a) => a.id === 'session_secret' && a.verified),
      `${label} session_secret must always be verified`
    );
    assert(
      report.assurances.some((a) => a.id === 'session_cookie_protections' && a.verified),
      `${label} session_cookie_protections must always be verified`
    );
  }
});

Deno.test(
  'computeShieldReport: proxy-terminated is trusted-termination, never a verified Secure assurance (false-safe guard)',
  () => {
    // Praxrr only observed a spoofable X-Forwarded-Proto: https and cannot verify the external TLS leg,
    // so the Secure cookie there must surface as a hedged advisory — never the confirmed-secure assurance.
    for (const mode of ['auto', 'on'] as const) {
      const report = computeShieldReport(makeInputs({ session: sessionPosture('proxy-terminated', mode) }));
      assert(
        report.advisories.some((a) => a.id === 'session_cookie_transport'),
        `proxy-terminated/${mode} must emit a hedged advisory`
      );
      assert(
        !report.assurances.some((a) => a.id === 'session_cookie_secure'),
        `proxy-terminated/${mode} must never affirm session_cookie_secure`
      );
    }
  }
);

Deno.test('computeShieldReport: every advisory carries a non-none fix (advisory actionability invariant)', () => {
  for (const session of ALL_SESSIONS) {
    const report = computeShieldReport(makeInputs({ session }));
    for (const advisory of report.advisories) {
      assert(
        advisory.fix.kind !== 'none',
        `${session.transport}/${session.cookieSecureMode} advisory ${advisory.id} must carry a fix`
      );
    }
  }
});

Deno.test('computeShieldReport: session advisory/assurance copy never carries a secret substring', () => {
  for (const session of ALL_SESSIONS) {
    const report = computeShieldReport(makeInputs({ session }));
    const serialized = JSON.stringify({ advisories: report.advisories, assurances: report.assurances }).toLowerCase();
    assert(!serialized.includes('api_key'), `${session.transport} advisory copy must not contain api_key`);
    assert(!serialized.includes('password'), `${session.transport} advisory copy must not contain password`);
    assert(!serialized.includes('deadbeef'), `${session.transport} advisory copy must not contain deadbeef`);
  }
});

// --- proxy_trust (issue #228): scored only for the operator-caused live bypass; advisories otherwise --

Deno.test('proxy_trust: unset under AUTH=on is inert (null, contributes 0) and adds no advisory', () => {
  const report = computeShieldReport(makeInputs()); // authMode 'on', TRUSTED_PROXY unset
  const check = report.checks.find((c) => c.id === 'proxy_trust');
  assertEquals(check?.score, null);
  assertEquals(check?.contribution, 0);
  assert(!report.advisories.some((a) => a.id.startsWith('proxy_trust')));
});

Deno.test('proxy_trust: AUTH=on overall score/band are numerically unchanged by adding the check', () => {
  // A healthy AUTH=on https deployment still scores exactly 95/hardened — proxy_trust is null, so the
  // rollup denominator is unshifted.
  const report = computeShieldReport(
    makeInputs({ instances: [{ id: 1, name: 'R', arrType: 'radarr', url: 'https://r' }] })
  );
  assertEquals(report.score, 95);
  assertEquals(report.band, 'hardened');
});

Deno.test(
  'proxy_trust: missing under a spoofable AUTH=local/0.0.0.0 context is an advisory, NOT a scored critical',
  () => {
    const report = computeShieldReport(makeInputs({ authMode: 'local', bindHost: '0.0.0.0' }));
    const check = report.checks.find((c) => c.id === 'proxy_trust');
    assertEquals(check?.score, null); // NOT a scored 0 — does not double-count control_plane_auth
    assertEquals(check?.status, 'na');
    assertEquals(report.bandCappedBy, null); // must not drop the band to exposed
    const advisory = report.advisories.find((a) => a.id === 'proxy_trust_missing');
    assert(advisory, 'a missing-proxy-trust advisory should inform without scoring');
    assertEquals(advisory?.fix.kind, 'env-var');
    assertEquals(report.checks.find((c) => c.id === 'control_plane_auth')?.score, 60);
  }
);

Deno.test('proxy_trust: AUTH=local + loopback bind + unset is fully inert (no advisory, no finding)', () => {
  const report = computeShieldReport(makeInputs({ authMode: 'local', bindHost: '127.0.0.1' }));
  assertEquals(report.checks.find((c) => c.id === 'proxy_trust')?.score, null);
  assert(!report.advisories.some((a) => a.id.startsWith('proxy_trust')));
});

Deno.test(
  'proxy_trust: an overly-broad allowlist under AUTH=local reopens the bypass — action/critical, band exposed',
  () => {
    const report = computeShieldReport(
      makeInputs({
        authMode: 'local',
        bindHost: '0.0.0.0',
        trustedProxyConfigured: true,
        trustedProxyValidRangeCount: 0,
        trustedProxyOverlyBroad: true,
      })
    );
    const check = report.checks.find((c) => c.id === 'proxy_trust');
    assertEquals(check?.score, 0);
    assertEquals(check?.status, 'action');
    assertEquals(check?.critical, true);
    assertEquals(check?.bandCapWhenAction, 'exposed');
    assertEquals(report.band, 'exposed');
    assert(report.topActions.some((a) => a.checkId === 'proxy_trust' && a.fix.kind === 'env-var'));
    // Pin the contributions-sum-EXACTLY invariant for the ONE state where proxy_trust is scored.
    assertEquals(
      report.checks.reduce((total, c) => total + c.contribution, 0),
      report.score,
      'contributions must sum to score even when proxy_trust carries weight'
    );
  }
);

Deno.test('proxy_trust: an active, valid, non-broad allowlist is a positive assurance, not a finding', () => {
  const report = computeShieldReport(
    makeInputs({
      authMode: 'local',
      bindHost: '0.0.0.0',
      trustedProxyConfigured: true,
      trustedProxyValidRangeCount: 1,
      trustedProxyOverlyBroad: false,
      trustedProxyInvalidEntries: [],
    })
  );
  const check = report.checks.find((c) => c.id === 'proxy_trust');
  assertEquals(check?.score, null);
  assertEquals(check?.status, 'assured');
  assert(report.assurances.some((a) => a.id === 'proxy_trust' && a.verified));
  assert(!report.advisories.some((a) => a.id.startsWith('proxy_trust')));
});

Deno.test('proxy_trust: invalid tokens surface an advisory listing them, without a scored penalty', () => {
  const report = computeShieldReport(
    makeInputs({
      authMode: 'on',
      trustedProxyConfigured: true,
      trustedProxyValidRangeCount: 1,
      trustedProxyInvalidEntries: ['junk', '999.0.0.0/8'],
    })
  );
  assertEquals(report.checks.find((c) => c.id === 'proxy_trust')?.score, null);
  const advisory = report.advisories.find((a) => a.id === 'proxy_trust_invalid');
  assert(advisory, 'invalid tokens should be surfaced as an advisory');
  assert(advisory?.detail.some((d) => d.includes('junk')));
  assertEquals(report.bandCappedBy, null);
});

Deno.test('proxy_trust: an overly-broad allowlist under AUTH=on is an unscored advisory (not a live bypass)', () => {
  const report = computeShieldReport(
    makeInputs({ authMode: 'on', trustedProxyConfigured: true, trustedProxyOverlyBroad: true })
  );
  assertEquals(report.checks.find((c) => c.id === 'proxy_trust')?.score, null);
  assert(report.advisories.some((a) => a.id === 'proxy_trust_overly_broad'));
  assertEquals(report.bandCappedBy, null);
});

Deno.test('proxy_trust: at most one proxy-trust advisory fires per report (mutual exclusivity)', () => {
  const report = computeShieldReport(
    makeInputs({
      authMode: 'local',
      bindHost: '0.0.0.0',
      trustedProxyConfigured: true,
      trustedProxyValidRangeCount: 1,
      trustedProxyOverlyBroad: true, // overly-broad + spoofable -> scored row 1, so NO advisory
      trustedProxyInvalidEntries: ['junk'],
    })
  );
  assertEquals(report.advisories.filter((a) => a.id.startsWith('proxy_trust')).length, 0);
  assertEquals(report.checks.find((c) => c.id === 'proxy_trust')?.status, 'action');
});
