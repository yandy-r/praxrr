/**
 * Security Posture input gatherer (issue #28).
 *
 * The ONLY config/DB-touching code on the read path. It materializes every fact the pure engine
 * needs — the auth mode + bind, per-instance connection URLs, the app-key-at-rest posture, and the
 * credential key-ring rotation state — into a {@link PostureInputs}, plus a runtime self-verify of the
 * log-redaction sanitizer and bounded DNS evidence for eligible stored Arr URLs. It NEVER reads out
 * a secret value (only presence, length, and host strings).
 *
 * Degrade-never-throw: any reader failure (uninitialized DB, missing key ring) narrows the affected
 * fact to its inert/`null` state so one bad read can never 500 the summary route.
 */

import { config } from '$config';
import { logger } from '$logger/logger.ts';
import { sanitizeLogMeta } from '$logger/sanitizer.ts';
import { arrInstancesQueries } from '$db/queries/arrInstances.ts';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials.ts';
import { authSettingsQueries } from '$db/queries/authSettings.ts';
import { getActiveArrCredentialKeyVersion, getAllArrCredentialKeyVersions } from '$utils/encryption/keys.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import { resolveCookieSecure, resolveSessionTransport } from './sessionTransport.ts';
import { getDnsTransportResolver, type DnsTransportResolver } from './dnsTransport.ts';
import {
  classifyHost,
  type DnsOutcome,
  type DnsTransportEvidence,
  type InstanceFact,
  type PostureInputs,
  type RotationFacts,
  type SessionRequestContext,
  type ShieldArrType,
} from '$shared/security/index.ts';

const SOURCE = 'SecurityPostureGather';
const STRONG_APP_KEY_MIN_LENGTH = 32;
const DNS_REPORT_DEADLINE_MS = 2_000;
const MAX_DNS_CANDIDATES = 32;

export interface SecurityPostureDependencies {
  readonly resolver: DnsTransportResolver;
  readonly now: () => number;
}

function resolveDependencies(dependencies: Partial<SecurityPostureDependencies>): SecurityPostureDependencies {
  return {
    resolver: dependencies.resolver ?? getDnsTransportResolver(),
    now: dependencies.now ?? Date.now,
  };
}

function closedDnsEvidence(outcome: DnsOutcome): DnsTransportEvidence {
  return {
    outcome,
    source: 'none',
    ipv4: { loopback: 0, private: 0, linkLocal: 0, public: 0, special: 0 },
    ipv6: { loopback: 0, private: 0, linkLocal: 0, public: 0, special: 0 },
    retainedCount: 0,
    observedAt: null,
    incomplete: true,
    truncated: false,
    addressClassesChanged: false,
  };
}

/** OIDC is only as strong as its configuration; distinguish fully-, partially-, and un-configured. */
function gatherOidcState(): { configured: boolean; partiallyConfigured: boolean } {
  const present = [config.oidc.discoveryUrl, config.oidc.clientId, config.oidc.clientSecret].filter(
    (value) => value !== null && value.trim().length > 0
  ).length;
  return { configured: present === 3, partiallyConfigured: present > 0 && present < 3 };
}

/** Presence + length of the app API key ONLY — the value itself is never carried into the engine. */
function gatherAppKeyState(): { present: boolean; strong: boolean } {
  try {
    const key = authSettingsQueries.getApiKey();
    if (!key || key.length === 0) return { present: false, strong: false };
    return { present: true, strong: key.length >= STRONG_APP_KEY_MIN_LENGTH };
  } catch {
    // Auth settings unreadable (uninitialized DB): treat as "no key" rather than throwing.
    return { present: false, strong: false };
  }
}

/** Enabled, sync-capable Arr instances as connection facts (id/name/type/url only — never the key). */
function gatherInstances(): InstanceFact[] {
  try {
    return arrInstancesQueries
      .getEnabled()
      .filter((instance) => isSyncPreviewArrType(instance.type))
      .map((instance) => ({
        id: instance.id,
        name: instance.name,
        arrType: instance.type as ShieldArrType,
        url: instance.url,
      }));
  } catch (error) {
    void logger.warn('Security posture: instance read failed; scoring without instances', {
      source: SOURCE,
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return [];
  }
}

/** Return the normalized DNS key only for stored URLs eligible for report-only resolution. */
function dnsCandidateHostname(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:') return null;
    const lower = url.hostname.toLowerCase();
    const hostname = lower.endsWith('.') ? lower.slice(0, -1) : lower;
    if (!hostname.includes('.') || classifyHost(hostname) !== 'unknown') return null;
    return hostname;
  } catch {
    return null;
  }
}

/** Resolve each unique eligible hostname once, then project closed evidence to every matching row. */
async function gatherDnsEvidence(
  instances: readonly InstanceFact[],
  dependencies: SecurityPostureDependencies,
  deadlineAt: number
): Promise<InstanceFact[]> {
  const hostnames = instances.map((instance) => dnsCandidateHostname(instance.url));
  const uniqueHostnames = [...new Set(hostnames.filter((hostname): hostname is string => hostname !== null))];
  const selected = uniqueHostnames.slice(0, MAX_DNS_CANDIDATES);
  const evidenceByHostname = new Map<string, DnsTransportEvidence>();

  for (const hostname of uniqueHostnames.slice(MAX_DNS_CANDIDATES)) {
    evidenceByHostname.set(hostname, closedDnsEvidence('budget-exceeded'));
  }

  async function observe(hostname: string): Promise<readonly [string, DnsTransportEvidence]> {
    try {
      return [hostname, await dependencies.resolver.observe(hostname, { deadlineAt })];
    } catch {
      return [hostname, closedDnsEvidence('failed')];
    }
  }

  const observations = await Promise.all(selected.map(observe));
  for (const [hostname, evidence] of observations) evidenceByHostname.set(hostname, evidence);

  return instances.map((instance, index) => {
    const hostname = hostnames[index];
    if (hostname === null) return instance;
    return { ...instance, dns: evidenceByHostname.get(hostname) ?? closedDnsEvidence('failed') };
  });
}

/** Key-ring + per-instance key-version facts. A missing key ring degrades to "no rotation in play". */
function gatherRotation(instances: readonly InstanceFact[]): RotationFacts {
  try {
    const activeVersion = getActiveArrCredentialKeyVersion();
    const configuredVersions = getAllArrCredentialKeyVersions();
    const instanceKeyVersions = instances.map((instance) => {
      let keyVersion: string | null = null;
      try {
        keyVersion = arrInstanceCredentialsQueries.getByInstanceId(instance.id)?.key_version ?? null;
      } catch {
        keyVersion = null;
      }
      return { instanceId: instance.id, keyVersion };
    });
    return { activeVersion, configuredVersions, instanceKeyVersions };
  } catch {
    // No key ring configured (which cannot happen once the app has booted): report no rotation.
    return { activeVersion: '', configuredVersions: [], instanceKeyVersions: [] };
  }
}

/**
 * Runtime self-verify of the always-on log sanitizer: plant realistically-shaped secrets (a 32-hex
 * *arr-style key and an `sk-` token — exactly the value patterns that protect real credentials) and
 * confirm they do not survive {@link sanitizeLogMeta}. A `false` here means a logger regression.
 */
function verifyLogRedaction(): boolean {
  const hexSecret = 'deadbeefdeadbeefdeadbeefdeadbeef'; // 32 hex — the shape of an Arr API key
  const skSecret = 'sk-ABCDEFGHIJKLMNOPQRSTUVWX'; // sk- token shape
  try {
    const sanitized = sanitizeLogMeta({ apiKey: hexSecret, headers: { authorization: skSecret } });
    const serialized = JSON.stringify(sanitized);
    return !serialized.includes(hexSecret) && !serialized.includes(skSecret);
  } catch {
    return false;
  }
}

/** Build the fully-materialized {@link PostureInputs} for the current deployment. Never throws. */
export async function buildPostureInputs(
  event?: SessionRequestContext,
  dependencyOverrides: Partial<SecurityPostureDependencies> = {}
): Promise<PostureInputs> {
  const dependencies = resolveDependencies(dependencyOverrides);
  const startedAt = dependencies.now();
  const oidc = gatherOidcState();
  const appKey = gatherAppKeyState();
  const instances = await gatherDnsEvidence(gatherInstances(), dependencies, startedAt + DNS_REPORT_DEADLINE_MS);

  const transport = resolveSessionTransport(event);
  const cookieSecureMode = config.cookieSecureMode;
  const cookieSecure = resolveCookieSecure(cookieSecureMode, transport);
  // Already parsed once at Config construction (fail-closed, non-throwing); never re-parsed here.
  const trustedProxy = config.trustedProxy;

  return {
    authMode: config.authMode,
    bindHost: config.host,
    port: config.port,
    oidcConfigured: oidc.configured,
    oidcPartiallyConfigured: oidc.partiallyConfigured,
    appApiKeyPresent: appKey.present,
    appApiKeyStrong: appKey.strong,
    instances,
    rotation: gatherRotation(instances),
    redactionVerified: verifyLogRedaction(),
    session: { transport, cookieSecure, cookieSecureMode },
    trustedProxyConfigured: trustedProxy.mode !== 'unset',
    trustedProxyValidRangeCount: trustedProxy.ranges.length,
    trustedProxyInvalidEntries: trustedProxy.invalidEntries,
    trustedProxyOverlyBroad: trustedProxy.overlyBroad,
    nowIso: new Date(dependencies.now()).toISOString(),
  };
}
