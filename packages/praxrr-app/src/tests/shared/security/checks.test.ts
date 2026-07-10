/**
 * Pure per-check tests for Security Posture (issue #28): the host-classification / transport table,
 * and each scorer's exact sub-score, status, critical flag, and band-cap across the deployment
 * states that vary a self-hosted install. No DB, no mocks — the checks are pure.
 */

import { assert, assertEquals } from '@std/assert';
import {
  ALL_CHECKS,
  buildTransportRows,
  classifyHost,
  type CheckResult,
  type InstanceFact,
  type PostureInputs,
  type SecurityCheckId,
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
    instances: [],
    rotation: { activeVersion: '1', configuredVersions: ['1'], instanceKeyVersions: [] },
    redactionVerified: true,
    session: { transport: 'unknown', cookieSecure: false, cookieSecureMode: 'auto' },
    trustedProxyConfigured: false,
    trustedProxyValidRangeCount: 0,
    trustedProxyInvalidEntries: [],
    trustedProxyOverlyBroad: false,
    nowIso: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

function runCheck(id: SecurityCheckId, inputs: PostureInputs): CheckResult {
  const check = ALL_CHECKS.find((c) => c.id === id);
  assert(check, `check ${id} must be registered`);
  return check.score(inputs);
}

function instance(id: number, url: string): InstanceFact {
  return { id, name: `arr-${id}`, arrType: 'radarr', url };
}

// --- classifyHost -----------------------------------------------------------------------------

Deno.test('classifyHost: loopback / private / docker-alias / unknown / public', () => {
  assertEquals(classifyHost('127.0.0.1'), 'loopback');
  assertEquals(classifyHost('localhost'), 'loopback');
  assertEquals(classifyHost('::1'), 'loopback');
  assertEquals(classifyHost('[::1]'), 'loopback');
  assertEquals(classifyHost('0.0.0.0'), 'loopback');
  assertEquals(classifyHost('::'), 'unknown'); // the IPv6 wildcard is NOT loopback
  assertEquals(classifyHost('10.0.0.5'), 'private');
  assertEquals(classifyHost('192.168.1.10'), 'private');
  assertEquals(classifyHost('172.16.4.4'), 'private');
  assertEquals(classifyHost('172.32.0.1'), 'public'); // just outside the /12
  assertEquals(classifyHost('169.254.1.1'), 'private');
  assertEquals(classifyHost('fd00::1'), 'private');
  assertEquals(classifyHost('fe80::1'), 'private');
  assertEquals(classifyHost('media.local'), 'private');
  assertEquals(classifyHost('nas.internal'), 'private');
  assertEquals(classifyHost('radarr'), 'docker-alias');
  assertEquals(classifyHost('example.com'), 'unknown'); // conservative: never "public" for an FQDN
  assertEquals(classifyHost('8.8.8.8'), 'public');
});

// --- transport rows ---------------------------------------------------------------------------

Deno.test('buildTransportRows: grades scheme + host into a tier/score/status', () => {
  const rows = buildTransportRows([
    instance(1, 'https://radarr.example.com'),
    instance(2, 'http://127.0.0.1:7878'),
    instance(3, 'http://[::1]:8989'),
    instance(4, 'http://localhost:7878'),
    instance(5, 'http://radarr:7878'),
    instance(6, 'http://10.0.0.5:7878'),
    instance(7, 'http://example.com:7878'),
    instance(8, 'http://8.8.8.8:7878'),
    instance(9, 'not a url'),
  ]);
  const by = new Map(rows.map((r) => [r.instanceId, r]));

  assertEquals(by.get(1)?.tier, 'encrypted');
  assertEquals(by.get(1)?.score, 100);
  assertEquals(by.get(2)?.tier, 'loopback');
  assertEquals(by.get(2)?.score, 100);
  assertEquals(by.get(3)?.tier, 'loopback');
  assertEquals(by.get(4)?.tier, 'loopback');
  assertEquals(by.get(5)?.tier, 'docker-alias');
  assertEquals(by.get(5)?.score, 100);
  assertEquals(by.get(6)?.tier, 'private');
  assertEquals(by.get(6)?.score, 65);
  assertEquals(by.get(7)?.tier, 'unknown');
  assertEquals(by.get(7)?.score, 65);
  assertEquals(by.get(8)?.tier, 'public');
  assertEquals(by.get(8)?.score, 30);
  assertEquals(by.get(8)?.status, 'action');
  assertEquals(by.get(9)?.score, null);
  assertEquals(by.get(9)?.status, 'na');
  // A row never carries anything but a host (never an API key or a full URL with credentials).
  for (const row of rows) assert(!row.host.includes('@'));
});

// --- control_plane_auth -----------------------------------------------------------------------

Deno.test('control_plane_auth: scores every mode and never returns null', () => {
  assertEquals(runCheck('control_plane_auth', makeInputs({ authMode: 'on' })).score, 100);
  assertEquals(runCheck('control_plane_auth', makeInputs({ authMode: 'oidc', oidcConfigured: true })).score, 100);
  assertEquals(runCheck('control_plane_auth', makeInputs({ authMode: 'oidc', oidcConfigured: false })).score, 50);
  assertEquals(runCheck('control_plane_auth', makeInputs({ authMode: 'local' })).score, 60);

  const offPublic = runCheck('control_plane_auth', makeInputs({ authMode: 'off', bindHost: '0.0.0.0' }));
  assertEquals(offPublic.score, 35);
  assertEquals(offPublic.status, 'action');
  assert(offPublic.critical);
  assertEquals(offPublic.bandCapWhenAction, 'exposed');

  const offLoop = runCheck('control_plane_auth', makeInputs({ authMode: 'off', bindHost: '127.0.0.1' }));
  assertEquals(offLoop.score, 55);
  assertEquals(offLoop.status, 'attention');
  assertEquals(offLoop.bandCapWhenAction, null);
  assertEquals(runCheck('control_plane_auth', makeInputs({ authMode: 'off', bindHost: 'localhost' })).score, 55);
  assertEquals(runCheck('control_plane_auth', makeInputs({ authMode: 'off', bindHost: '::1' })).score, 55);

  // The IPv6 wildcard '::' binds ALL interfaces (the analog of 0.0.0.0) — NOT loopback-mitigated.
  const offWildcardV6 = runCheck('control_plane_auth', makeInputs({ authMode: 'off', bindHost: '::' }));
  assertEquals(offWildcardV6.score, 35);
  assertEquals(offWildcardV6.status, 'action');
  assertEquals(offWildcardV6.bandCapWhenAction, 'exposed');

  for (const authMode of ['on', 'local', 'off', 'oidc'] as const) {
    assert(runCheck('control_plane_auth', makeInputs({ authMode })).score !== null, `${authMode} must score`);
  }
});

// --- arr_transport ----------------------------------------------------------------------------

Deno.test('arr_transport: mean of scored rows; public http is a capping action; empty is null', () => {
  assertEquals(runCheck('arr_transport', makeInputs({ instances: [] })).score, null);
  assertEquals(runCheck('arr_transport', makeInputs({ instances: [instance(1, 'not a url')] })).score, null);

  const allHttps = runCheck(
    'arr_transport',
    makeInputs({ instances: [instance(1, 'https://a'), instance(2, 'https://b')] })
  );
  assertEquals(allHttps.score, 100);
  assertEquals(allHttps.status, 'pass');

  const mixed = runCheck(
    'arr_transport',
    makeInputs({ instances: [instance(1, 'https://a'), instance(2, 'http://10.0.0.5')] })
  );
  assertEquals(mixed.score, 83); // mean(100, 65) = 82.5 → 83
  assertEquals(mixed.status, 'attention');
  assertEquals(mixed.bandCapWhenAction, null);

  const withPublic = runCheck(
    'arr_transport',
    makeInputs({ instances: [instance(1, 'https://a'), instance(2, 'http://8.8.8.8')] })
  );
  assertEquals(withPublic.status, 'action');
  assert(withPublic.critical);
  assertEquals(withPublic.bandCapWhenAction, 'guarded');
  assertEquals(withPublic.recommendations.length, 1);
});

// --- app_key_at_rest --------------------------------------------------------------------------

Deno.test('app_key_at_rest: only a live vector under on/local with a key set', () => {
  assertEquals(
    runCheck('app_key_at_rest', makeInputs({ authMode: 'on', appApiKeyPresent: true, appApiKeyStrong: true })).score,
    70
  );
  assertEquals(
    runCheck('app_key_at_rest', makeInputs({ authMode: 'local', appApiKeyPresent: true, appApiKeyStrong: true })).score,
    70
  );
  const weak = runCheck(
    'app_key_at_rest',
    makeInputs({ authMode: 'on', appApiKeyPresent: true, appApiKeyStrong: false })
  );
  assertEquals(weak.score, 45);
  assertEquals(weak.status, 'action');
  assertEquals(runCheck('app_key_at_rest', makeInputs({ authMode: 'on', appApiKeyPresent: false })).score, null);
  assertEquals(runCheck('app_key_at_rest', makeInputs({ authMode: 'oidc', appApiKeyPresent: true })).score, null);
  assertEquals(runCheck('app_key_at_rest', makeInputs({ authMode: 'off', appApiKeyPresent: true })).score, null);
});

// --- credential_rotation ----------------------------------------------------------------------

Deno.test('credential_rotation: null without rotation; penalizes stale rows; null keyVersion is not stale', () => {
  assertEquals(runCheck('credential_rotation', makeInputs()).score, null); // single version
  assertEquals(
    runCheck(
      'credential_rotation',
      makeInputs({ rotation: { activeVersion: '2', configuredVersions: ['1', '2'], instanceKeyVersions: [] } })
    ).score,
    null
  );
  const allCurrent = runCheck(
    'credential_rotation',
    makeInputs({
      rotation: {
        activeVersion: '2',
        configuredVersions: ['1', '2'],
        instanceKeyVersions: [{ instanceId: 1, keyVersion: '2' }],
      },
    })
  );
  assertEquals(allCurrent.score, 100);
  const twoStale = runCheck(
    'credential_rotation',
    makeInputs({
      rotation: {
        activeVersion: '2',
        configuredVersions: ['1', '2'],
        instanceKeyVersions: [
          { instanceId: 1, keyVersion: '1' },
          { instanceId: 2, keyVersion: '1' },
        ],
      },
    })
  );
  assertEquals(twoStale.score, 60); // 100 - 20*2
  assertEquals(twoStale.status, 'attention');
  const unreadable = runCheck(
    'credential_rotation',
    makeInputs({
      rotation: {
        activeVersion: '2',
        configuredVersions: ['1', '2'],
        instanceKeyVersions: [{ instanceId: 1, keyVersion: null }],
      },
    })
  );
  assertEquals(unreadable.score, 100); // null keyVersion is not counted as stale

  // A row under a key REMOVED from the ring (not in configuredVersions) is undecryptable — not
  // stale (drift's concern), so it must not be penalized here with unactionable "re-save" advice.
  const removedKey = runCheck(
    'credential_rotation',
    makeInputs({
      rotation: {
        activeVersion: '2',
        configuredVersions: ['2', '3'],
        instanceKeyVersions: [{ instanceId: 1, keyVersion: '1' }],
      },
    })
  );
  assertEquals(removedKey.score, 100);
});

// --- log_redaction ----------------------------------------------------------------------------

Deno.test('log_redaction: null+assured when verified; a critical weighted failure when broken', () => {
  const ok = runCheck('log_redaction', makeInputs({ redactionVerified: true }));
  assertEquals(ok.score, null);
  assertEquals(ok.status, 'assured');
  assertEquals(ok.weight, 0);

  const broken = runCheck('log_redaction', makeInputs({ redactionVerified: false }));
  assertEquals(broken.score, 0);
  assertEquals(broken.status, 'action');
  assert(broken.critical);
  assertEquals(broken.bandCapWhenAction, 'exposed');
  assertEquals(broken.weight, 25);
});

// --- proxy_trust (issue #228) -----------------------------------------------------------------

Deno.test('proxy_trust: unset is inert (null/na, weight 0) regardless of mode', () => {
  for (const authMode of ['on', 'local', 'off', 'oidc'] as const) {
    const check = runCheck('proxy_trust', makeInputs({ authMode }));
    assertEquals(check.score, null, `unset should be null under AUTH=${authMode}`);
    assertEquals(check.status, 'na');
    assertEquals(check.weight, 0);
    assertEquals(check.critical, false);
  }
});

Deno.test('proxy_trust: overly-broad under AUTH=local + non-loopback is the one scored/weighted/critical state', () => {
  const check = runCheck(
    'proxy_trust',
    makeInputs({ authMode: 'local', bindHost: '0.0.0.0', trustedProxyConfigured: true, trustedProxyOverlyBroad: true })
  );
  assertEquals(check.score, 0);
  assertEquals(check.status, 'action');
  assertEquals(check.weight, 25);
  assert(check.critical);
  assertEquals(check.bandCapWhenAction, 'exposed');
  assertEquals(check.recommendations[0]?.fix.kind, 'env-var');
});

Deno.test(
  'proxy_trust: overly-broad is NOT scored when the context is not spoofable (AUTH=on, or loopback bind)',
  () => {
    const onMode = runCheck(
      'proxy_trust',
      makeInputs({ authMode: 'on', trustedProxyConfigured: true, trustedProxyOverlyBroad: true })
    );
    assertEquals(onMode.score, null);
    assertEquals(onMode.status, 'na');

    const loopbackBind = runCheck(
      'proxy_trust',
      makeInputs({
        authMode: 'local',
        bindHost: '127.0.0.1',
        trustedProxyConfigured: true,
        trustedProxyOverlyBroad: true,
      })
    );
    assertEquals(loopbackBind.score, null);
  }
);

Deno.test('proxy_trust: active, valid, non-broad, no-invalid config is assured (null, weight 0)', () => {
  const check = runCheck(
    'proxy_trust',
    makeInputs({
      authMode: 'local',
      trustedProxyConfigured: true,
      trustedProxyValidRangeCount: 2,
      trustedProxyOverlyBroad: false,
      trustedProxyInvalidEntries: [],
    })
  );
  assertEquals(check.score, null);
  assertEquals(check.status, 'assured');
  assertEquals(check.weight, 0);
});

Deno.test('proxy_trust: a config with invalid tokens is inert at the check level (surfaced as an advisory)', () => {
  const check = runCheck(
    'proxy_trust',
    makeInputs({ authMode: 'on', trustedProxyConfigured: true, trustedProxyInvalidEntries: ['junk'] })
  );
  assertEquals(check.score, null);
  assertEquals(check.status, 'na');
  assertEquals(check.critical, false);
});
