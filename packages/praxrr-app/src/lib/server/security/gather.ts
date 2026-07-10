/**
 * Security Posture input gatherer (issue #28).
 *
 * The ONLY config/DB-touching code on the read path. It materializes every fact the pure engine
 * needs — the auth mode + bind, per-instance connection URLs, the app-key-at-rest posture, and the
 * credential key-ring rotation state — into a {@link PostureInputs}, plus a runtime self-verify of the
 * log-redaction sanitizer. Zero network I/O; it audits only state Praxrr already knows and NEVER
 * reads out a secret value (only presence, length, and host strings).
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
import type { InstanceFact, PostureInputs, RotationFacts, ShieldArrType } from '$shared/security/index.ts';

const SOURCE = 'SecurityPostureGather';
const STRONG_APP_KEY_MIN_LENGTH = 32;

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
export function buildPostureInputs(): PostureInputs {
  const oidc = gatherOidcState();
  const appKey = gatherAppKeyState();
  const instances = gatherInstances();
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
    // Praxrr sets its session cookie without the Secure flag today; surfaced as an advisory.
    sessionCookieSecure: false,
    trustedProxyConfigured: trustedProxy.mode !== 'unset',
    trustedProxyValidRangeCount: trustedProxy.ranges.length,
    trustedProxyInvalidEntries: trustedProxy.invalidEntries,
    trustedProxyOverlyBroad: trustedProxy.overlyBroad,
    nowIso: new Date().toISOString(),
  };
}
