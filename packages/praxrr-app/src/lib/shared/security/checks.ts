/**
 * Security Posture checks (issue #28).
 *
 * One pure scorer per check, all implementing {@link SecurityCheck}. The engine iterates
 * {@link ALL_CHECKS}; adding a check is one entry here and never touches `engine.ts`. Each scorer maps
 * facts Praxrr already knows to a 0–100 sub-score OR `null` ("cannot evaluate / not applicable" —
 * skipped, never 0), a display status, machine-facing detail, and actionable, non-shaming
 * {@link ShieldRecommendation}s that always carry a concrete fix. No I/O, no `Date`, no `Math.random`.
 *
 * Host classification ({@link classifyHost}) and transport-row building are exported because both the
 * `arr_transport` check and the engine's per-instance table derive from them.
 */

import { NARRATION_TEMPLATE_VERSION, type NarrationLine, type NarrationTone } from '$shared/narration/index.ts';
import { clamp0100 } from './policy.ts';
import type {
  CheckResult,
  CheckStatus,
  InstanceFact,
  PostureInputs,
  SecurityCheck,
  SecurityCheckId,
  ShieldBand,
  ShieldFix,
  ShieldRecommendation,
  SubScore,
  TransportRow,
  TransportTier,
} from './types.ts';

// --- weights (fixed in code; users cannot down-weight "auth is off" to fake green) ------------

const CONTROL_PLANE_AUTH_WEIGHT = 40;
const ARR_TRANSPORT_WEIGHT = 30;
const APP_KEY_AT_REST_WEIGHT = 15;
const CREDENTIAL_ROTATION_WEIGHT = 15;
/** Weight the redaction tripwire carries ONLY when it fails; it is weight 0 (excluded) when it passes. */
const LOG_REDACTION_FAIL_WEIGHT = 25;
/** Weight `proxy_trust` carries ONLY in the one live-bypass state; it is weight 0 in every other. */
const PROXY_TRUST_FAIL_WEIGHT = 25;

// --- transport score tiers --------------------------------------------------------------------

const PRIVATE_HTTP_SCORE = 65;
const PUBLIC_HTTP_SCORE = 30;
const ROTATION_PER_STALE_PENALTY = 20;
const REPO_ISSUES_URL = 'https://github.com/yandy-r/praxrr/issues';

// --- helpers ----------------------------------------------------------------------------------

function line(headline: string, detail: readonly string[], tone: NarrationTone): NarrationLine {
  return { headline, detail, tone, templateVersion: NARRATION_TEMPLATE_VERSION };
}

function rec(headline: string, detail: readonly string[], tone: NarrationTone, fix: ShieldFix): ShieldRecommendation {
  return { line: line(headline, detail, tone), fix };
}

function result(
  id: SecurityCheckId,
  label: string,
  score: SubScore,
  weight: number,
  status: CheckStatus,
  critical: boolean,
  bandCapWhenAction: ShieldBand | null,
  detail: readonly string[],
  recommendations: readonly ShieldRecommendation[]
): CheckResult {
  // `contribution` and `recoverablePoints` are placeholders; the engine overwrites them post-rollup.
  return {
    id,
    label,
    score,
    weight,
    contribution: 0,
    recoverablePoints: 0,
    status,
    critical,
    bandCapWhenAction,
    detail,
    recommendations,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// --- host classification (pure; no network, no server imports) --------------------------------

type HostClass = 'loopback' | 'private' | 'docker-alias' | 'unknown' | 'public';

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function isIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  return match.slice(1, 5).every((octet) => Number(octet) <= 255);
}

/** RFC1918 / loopback / link-local classification for an IPv4 LITERAL (caller handles `0.0.0.0`). */
function classifyIpv4(host: string): HostClass {
  const [a, b] = host.split('.').map(Number);
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 169 && b === 254) return 'private'; // link-local
  return 'public';
}

/**
 * Classify a URL host into a trust tier from Praxrr's own knowledge — NO DNS, NO probing. Unknown
 * multi-label FQDNs and non-local IPv6 are graded conservatively as `unknown` (not `public`) so
 * split-horizon DNS never triggers a false "wide open" alarm. Only a routable IPv4 literal is `public`.
 */
export function classifyHost(rawHost: string): HostClass {
  const host = stripBrackets(rawHost.trim().toLowerCase());
  if (host.length === 0) return 'unknown';
  if (host === 'localhost' || host === '0.0.0.0') return 'loopback';
  // Only `::1` is IPv6 loopback; `::` is the unspecified/wildcard address (analog of 0.0.0.0), not loopback.
  if (host === '::1') return 'loopback';
  if (isIpv4(host)) return classifyIpv4(host);
  if (host.includes(':')) {
    // IPv6 literal: unique-local (fc00::/7) and link-local (fe80::/10) are private; the rest unknown.
    if (/^f[cd]/.test(host)) return 'private';
    if (host.startsWith('fe80')) return 'private';
    return 'unknown';
  }
  if (/\.(local|lan|home|internal)$/.test(host)) return 'private';
  if (!host.includes('.')) return 'docker-alias'; // single-label host (e.g. a docker service name)
  return 'unknown';
}

/**
 * Loopback BIND detection for the auth check. The wildcard binds `0.0.0.0` and `::` bind ALL
 * interfaces and are therefore NOT loopback — only `localhost`, `::1`, and `127.0.0.0/8` are.
 * Exported so the engine's proxy-trust advisory builder shares the same "spoofable context" rule.
 */
export function isLoopbackBindHost(rawHost: string): boolean {
  const host = stripBrackets(rawHost.trim().toLowerCase());
  if (host === 'localhost' || host === '::1') return true;
  return isIpv4(host) && Number(host.split('.')[0]) === 127;
}

// --- transport rows (shared by the arr_transport check and the engine table) ------------------

interface TransportGrade {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly tier: TransportTier;
  readonly score: SubScore;
  readonly status: CheckStatus;
}

function gradeUrl(rawUrl: string): TransportGrade {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    const scheme = rawUrl.trim().toLowerCase().startsWith('https') ? 'https' : 'http';
    return { scheme, host: '(unparseable URL)', tier: 'unknown', score: null, status: 'na' };
  }

  const host = url.hostname;
  if (url.protocol === 'https:') {
    return { scheme: 'https', host, tier: 'encrypted', score: 100, status: 'pass' };
  }

  switch (classifyHost(host)) {
    case 'loopback':
      return { scheme: 'http', host, tier: 'loopback', score: 100, status: 'pass' };
    case 'docker-alias':
      return { scheme: 'http', host, tier: 'docker-alias', score: 100, status: 'pass' };
    case 'private':
      return { scheme: 'http', host, tier: 'private', score: PRIVATE_HTTP_SCORE, status: 'attention' };
    case 'unknown':
      return { scheme: 'http', host, tier: 'unknown', score: PRIVATE_HTTP_SCORE, status: 'attention' };
    case 'public':
      return { scheme: 'http', host, tier: 'public', score: PUBLIC_HTTP_SCORE, status: 'action' };
  }
}

function transportRowFor(instance: InstanceFact): TransportRow {
  const grade = gradeUrl(instance.url);
  const fix: ShieldFix =
    grade.score !== null && grade.score < 100
      ? { kind: 'instance-link', instanceId: instance.id, href: `/arr/${instance.id}`, label: 'Edit connection' }
      : { kind: 'none' };
  return {
    instanceId: instance.id,
    instanceName: instance.name,
    arrType: instance.arrType,
    scheme: grade.scheme,
    host: grade.host,
    tier: grade.tier,
    score: grade.score,
    status: grade.status,
    fix,
  };
}

/** Grade every enabled Arr connection's transport from its stored URL (never `external_url`). */
export function buildTransportRows(instances: readonly InstanceFact[]): TransportRow[] {
  return instances.map(transportRowFor);
}

// --- control_plane_auth -----------------------------------------------------------------------

const ID_AUTH: SecurityCheckId = 'control_plane_auth';
const LABEL_AUTH = 'Control-plane authentication';

const controlPlaneAuth: SecurityCheck = {
  id: ID_AUTH,
  label: LABEL_AUTH,
  weight: CONTROL_PLANE_AUTH_WEIGHT,
  score(inputs) {
    const W = CONTROL_PLANE_AUTH_WEIGHT;
    switch (inputs.authMode) {
      case 'on':
        return result(
          ID_AUTH,
          LABEL_AUTH,
          100,
          W,
          'pass',
          false,
          null,
          ['Every request requires a signed-in user or the Praxrr API key.'],
          []
        );
      case 'oidc':
        if (inputs.oidcConfigured) {
          return result(
            ID_AUTH,
            LABEL_AUTH,
            100,
            W,
            'pass',
            false,
            null,
            ['Authentication is delegated to your OIDC provider.'],
            []
          );
        }
        return result(
          ID_AUTH,
          LABEL_AUTH,
          50,
          W,
          'attention',
          false,
          null,
          [
            inputs.oidcPartiallyConfigured
              ? 'OIDC is selected but only partially configured.'
              : 'OIDC is selected but not configured yet.',
          ],
          [
            rec(
              inputs.oidcPartiallyConfigured
                ? 'OIDC is only partially configured'
                : 'OIDC is enabled but not configured',
              [
                inputs.oidcPartiallyConfigured
                  ? 'Some OIDC settings are set but others are missing, so sign-in is broken. Set OIDC_DISCOVERY_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET.'
                  : 'Set OIDC_DISCOVERY_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET so sign-in works; until then users cannot authenticate.',
              ],
              'warning',
              { kind: 'env-var', name: 'OIDC_DISCOVERY_URL', label: 'Complete the OIDC configuration' }
            ),
          ]
        );
      case 'local':
        return result(
          ID_AUTH,
          LABEL_AUTH,
          60,
          W,
          'attention',
          false,
          null,
          ['Requests from local addresses bypass authentication.'],
          [
            rec(
              'Local requests are not authenticated',
              [
                `AUTH=local lets any client on a local or loopback address reach Praxrr without signing in; anything that appears local has full control on port ${inputs.port}.`,
              ],
              'warning',
              { kind: 'env-var', name: 'AUTH', label: 'Set AUTH=on to authenticate every client' }
            ),
          ]
        );
      case 'off': {
        if (isLoopbackBindHost(inputs.bindHost)) {
          return result(
            ID_AUTH,
            LABEL_AUTH,
            55,
            W,
            'attention',
            false,
            null,
            [`Authentication is disabled; Praxrr binds only to loopback (${inputs.bindHost}).`],
            [
              rec(
                'Authentication is disabled',
                [
                  'AUTH=off authenticates no requests. Praxrr binds to loopback, so exposure depends on any proxy or port-forwarding you configured — enable AUTH, or ensure a trusted authenticating proxy fronts it.',
                ],
                'warning',
                { kind: 'env-var', name: 'AUTH', label: 'Set AUTH=on or AUTH=oidc' }
              ),
            ]
          );
        }
        return result(
          ID_AUTH,
          LABEL_AUTH,
          35,
          W,
          'action',
          true,
          'exposed',
          [`Authentication is disabled and Praxrr binds to ${inputs.bindHost}:${inputs.port}.`],
          [
            rec(
              'Praxrr accepts unauthenticated requests',
              [
                `AUTH=off authenticates no requests and relies on an unverifiable upstream proxy. If none fronts Praxrr, anyone who reaches ${inputs.bindHost}:${inputs.port} has full control of every connected Arr.`,
              ],
              'danger',
              { kind: 'env-var', name: 'AUTH', label: 'Set AUTH=on or AUTH=oidc' }
            ),
          ]
        );
      }
    }
  },
};

// --- arr_transport ----------------------------------------------------------------------------

const ID_TRANSPORT: SecurityCheckId = 'arr_transport';
const LABEL_TRANSPORT = 'Arr connection transport';

const arrTransport: SecurityCheck = {
  id: ID_TRANSPORT,
  label: LABEL_TRANSPORT,
  weight: ARR_TRANSPORT_WEIGHT,
  score(inputs) {
    const W = ARR_TRANSPORT_WEIGHT;
    const rows = buildTransportRows(inputs.instances);
    const scored = rows.map((r) => r.score).filter((s): s is number => s !== null);

    if (rows.length === 0) {
      return result(
        ID_TRANSPORT,
        LABEL_TRANSPORT,
        null,
        W,
        'na',
        false,
        null,
        ['No enabled Arr instances to evaluate.'],
        []
      );
    }
    if (scored.length === 0) {
      return result(
        ID_TRANSPORT,
        LABEL_TRANSPORT,
        null,
        W,
        'na',
        false,
        null,
        ['No Arr instance URL could be parsed.'],
        []
      );
    }

    const score = clamp0100(mean(scored));
    const plaintext = rows.filter((r) => r.score !== null && r.score < 100);
    const publicRows = rows.filter((r) => r.tier === 'public');

    let status: CheckStatus = 'pass';
    let critical = false;
    let cap: ShieldBand | null = null;
    if (publicRows.length > 0) {
      status = 'action';
      critical = true;
      cap = 'guarded';
    } else if (plaintext.length > 0) {
      status = 'attention';
    }

    const detail = [`${scored.length} enabled instance(s); ${plaintext.length} reached over plaintext http.`];
    const recommendations = plaintext.map((row) =>
      rec(
        `${row.instanceName} is reached over plaintext http`,
        [
          `Praxrr talks to ${row.instanceName} at http://${row.host}; its API key crosses the network in cleartext on every request${row.tier === 'public' ? ' over what looks like a public address' : ''}.`,
          'Point Praxrr at an https URL, or front the instance with TLS.',
        ],
        row.tier === 'public' ? 'danger' : 'warning',
        row.fix
      )
    );

    return result(ID_TRANSPORT, LABEL_TRANSPORT, score, W, status, critical, cap, detail, recommendations);
  },
};

// --- app_key_at_rest --------------------------------------------------------------------------

const ID_APP_KEY: SecurityCheckId = 'app_key_at_rest';
const LABEL_APP_KEY = 'Praxrr API key at rest';

const appKeyAtRest: SecurityCheck = {
  id: ID_APP_KEY,
  label: LABEL_APP_KEY,
  weight: APP_KEY_AT_REST_WEIGHT,
  score(inputs) {
    const W = APP_KEY_AT_REST_WEIGHT;
    // In oidc/off modes the X-Api-Key path is inert, so a plaintext key is not a live auth vector.
    if (inputs.authMode === 'oidc' || inputs.authMode === 'off') {
      return result(
        ID_APP_KEY,
        LABEL_APP_KEY,
        null,
        W,
        'na',
        false,
        null,
        ['The Praxrr API key is not an active authentication path in this mode.'],
        []
      );
    }
    if (!inputs.appApiKeyPresent) {
      return result(ID_APP_KEY, LABEL_APP_KEY, null, W, 'na', false, null, ['No Praxrr API key is configured.'], []);
    }
    if (inputs.appApiKeyStrong) {
      return result(
        ID_APP_KEY,
        LABEL_APP_KEY,
        70,
        W,
        'attention',
        false,
        null,
        ['The Praxrr API key is stored in plaintext in the app database.'],
        [
          rec(
            'Your Praxrr API key is stored in plaintext',
            [
              'Anyone who can read praxrr.db or an unencrypted backup can use it for full API access. Restrict and encrypt backups, or switch to AUTH=oidc to retire the key.',
            ],
            'warning',
            { kind: 'env-var', name: 'AUTH', label: 'Switch to AUTH=oidc to retire the API key' }
          ),
        ]
      );
    }
    return result(
      ID_APP_KEY,
      LABEL_APP_KEY,
      45,
      W,
      'action',
      false,
      null,
      ['The Praxrr API key is plaintext and shorter than 32 characters.'],
      [
        rec(
          'Your Praxrr API key is weak and stored in plaintext',
          [
            'A short key in plaintext is both easy to brute-force and exposed to any database or backup reader. Regenerate a strong key, or switch to AUTH=oidc.',
          ],
          'danger',
          { kind: 'settings-link', href: '/settings/security', label: 'Rotate the API key' }
        ),
      ]
    );
  },
};

// --- credential_rotation ----------------------------------------------------------------------

const ID_ROTATION: SecurityCheckId = 'credential_rotation';
const LABEL_ROTATION = 'Arr credential key freshness';

const credentialRotation: SecurityCheck = {
  id: ID_ROTATION,
  label: LABEL_ROTATION,
  weight: CREDENTIAL_ROTATION_WEIGHT,
  score(inputs) {
    const W = CREDENTIAL_ROTATION_WEIGHT;
    const { activeVersion, configuredVersions, instanceKeyVersions } = inputs.rotation;

    if (configuredVersions.length <= 1) {
      return result(
        ID_ROTATION,
        LABEL_ROTATION,
        null,
        W,
        'na',
        false,
        null,
        ['A single credential key version is configured — no rotation is in progress.'],
        []
      );
    }
    if (instanceKeyVersions.length === 0) {
      return result(ID_ROTATION, LABEL_ROTATION, null, W, 'na', false, null, ['No enabled instances to evaluate.'], []);
    }

    // Only rows we can actually DECRYPT (their key version is still configured) AND that sit under a
    // retired-but-present version count as stale. A row under a key that was dropped from
    // ARR_CREDENTIAL_PREVIOUS_KEYS is undecryptable — a broken/functional state (drift's concern),
    // not a re-saveable rotation lag, so it must not be scored here with "re-save" advice.
    const stale = instanceKeyVersions.filter(
      (i) => i.keyVersion !== null && i.keyVersion !== activeVersion && configuredVersions.includes(i.keyVersion)
    );
    if (stale.length === 0) {
      return result(
        ID_ROTATION,
        LABEL_ROTATION,
        100,
        W,
        'pass',
        false,
        null,
        [`All ${instanceKeyVersions.length} instance(s) are encrypted under the current key.`],
        []
      );
    }

    const score = clamp0100(100 - ROTATION_PER_STALE_PENALTY * stale.length);
    const firstStale = stale[0].instanceId;
    return result(
      ID_ROTATION,
      LABEL_ROTATION,
      score,
      W,
      'attention',
      false,
      null,
      [`${stale.length} instance(s) are still encrypted under a retired key version.`],
      [
        rec(
          `${stale.length} instance(s) use a retired credential key`,
          [
            'Re-save each affected Arr connection to re-encrypt its API key under the current master key, then you can drop the old key from ARR_CREDENTIAL_PREVIOUS_KEYS.',
          ],
          'warning',
          { kind: 'instance-link', instanceId: firstStale, href: `/arr/${firstStale}`, label: 'Re-save to re-encrypt' }
        ),
      ]
    );
  },
};

// --- log_redaction (runtime assurance / regression tripwire) ----------------------------------

const ID_REDACTION: SecurityCheckId = 'log_redaction';
const LABEL_REDACTION = 'Log redaction';

const logRedaction: SecurityCheck = {
  id: ID_REDACTION,
  label: LABEL_REDACTION,
  weight: LOG_REDACTION_FAIL_WEIGHT,
  score(inputs) {
    if (inputs.redactionVerified) {
      // Always-on protection working → excluded from the score, surfaced as an assurance.
      return result(
        ID_REDACTION,
        LABEL_REDACTION,
        null,
        0,
        'assured',
        false,
        null,
        ['A planted secret was stripped from log metadata at gather time.'],
        []
      );
    }
    return result(
      ID_REDACTION,
      LABEL_REDACTION,
      0,
      LOG_REDACTION_FAIL_WEIGHT,
      'action',
      true,
      'exposed',
      ['Log redaction self-check FAILED — a planted secret was NOT redacted.'],
      [
        rec(
          'Log redaction is not working',
          [
            'sanitizeLogMeta did not redact a planted secret — this is a logger regression. Do not share logs until it is fixed, and file a bug.',
          ],
          'danger',
          { kind: 'docs', href: REPO_ISSUES_URL, label: 'Report a logger regression' }
        ),
      ]
    );
  },
};

// --- proxy_trust (scored ONLY when an operator opened a live X-Forwarded-For bypass) --------------

const ID_PROXY_TRUST: SecurityCheckId = 'proxy_trust';
const LABEL_PROXY_TRUST = 'Trusted proxy allowlist';

/**
 * Grades the explicit `TRUSTED_PROXY` allowlist (issue #228). It carries weight in exactly ONE state:
 * an operator who trusts every peer (`overlyBroad`) while `AUTH=local` on a non-loopback bind, which
 * re-enables the spoofable X-Forwarded-For local-address bypass. That is the only state that is both
 * operator-caused AND an observably live auth-decision risk, so it is the only one scored / critical.
 * Every other state is `null` (excluded from the rollup): the missing / invalid / not-live cases are
 * surfaced as unscored advisories by the engine (Praxrr cannot observe whether a proxy is in front, so
 * it must not turn an unset default into a failing grade), and the active-and-valid good state is a
 * verified assurance. Mirrors the `log_redaction` fail-only-weight idiom.
 */
const proxyTrust: SecurityCheck = {
  id: ID_PROXY_TRUST,
  label: LABEL_PROXY_TRUST,
  weight: PROXY_TRUST_FAIL_WEIGHT,
  score(inputs) {
    const configured = inputs.trustedProxyConfigured;
    // The only context where getClientIp drives an auth decision reachable from a non-loopback iface.
    const spoofableContext = inputs.authMode === 'local' && !isLoopbackBindHost(inputs.bindHost);

    // Row 1 — overly-broad live bypass: the ONE scored, weighted, band-capping state.
    if (configured && inputs.trustedProxyOverlyBroad && spoofableContext) {
      return result(
        ID_PROXY_TRUST,
        LABEL_PROXY_TRUST,
        0,
        PROXY_TRUST_FAIL_WEIGHT,
        'action',
        true,
        'exposed',
        [
          'TRUSTED_PROXY trusts every peer (a wildcard, /0, or a supernet ≤ /7) while AUTH=local and Praxrr is bound to a non-loopback interface — it re-enables spoofable X-Forwarded-For trust and reopens the AUTH=local local-address bypass to any remote client.',
        ],
        [
          rec(
            'Overly broad TRUSTED_PROXY reopens the AUTH=local bypass',
            [
              'Any remote client can forge X-Forwarded-For to appear local and skip authentication. Narrow TRUSTED_PROXY to your reverse proxy’s exact address or CIDR, or set AUTH=on so every client authenticates.',
            ],
            'danger',
            { kind: 'env-var', name: 'TRUSTED_PROXY', label: "Narrow TRUSTED_PROXY to the proxy's address" }
          ),
        ]
      );
    }

    // Row 2 — active & valid: excluded from the score, surfaced as a positive assurance in the engine.
    if (
      configured &&
      inputs.trustedProxyValidRangeCount > 0 &&
      !inputs.trustedProxyOverlyBroad &&
      inputs.trustedProxyInvalidEntries.length === 0
    ) {
      return result(
        ID_PROXY_TRUST,
        LABEL_PROXY_TRUST,
        null,
        0,
        'assured',
        false,
        null,
        [
          `TRUSTED_PROXY names ${inputs.trustedProxyValidRangeCount} proxy range(s); forwarded client IPs are honored only from those peers, and spoofed headers from any other peer are ignored.`,
        ],
        []
      );
    }

    // Rows 3–6 — inert here: the state is either advisory-only (rows 3/4/5, built in engine.ts) or a
    // genuinely-inert direct/loopback deployment (row 6). Either way proxy_trust scores null/na and
    // shifts no denominator, so AUTH=on and default AUTH=local reports stay numerically unchanged.
    const detail = configured
      ? ['TRUSTED_PROXY is set but is not a live auth-bypass risk in this mode; see the advisories for any follow-up.']
      : [
          'TRUSTED_PROXY is not set: forwarded headers are ignored and every request is graded by its real socket peer.',
        ];
    return result(ID_PROXY_TRUST, LABEL_PROXY_TRUST, null, 0, 'na', false, null, detail, []);
  },
};

/** The check registry, in stable display order. Adding a check is one entry here. */
export const ALL_CHECKS: readonly SecurityCheck[] = [
  controlPlaneAuth,
  arrTransport,
  appKeyAtRest,
  credentialRotation,
  logRedaction,
  proxyTrust,
];
