import { createHash } from 'node:crypto';
import { config } from '$config';
import { db } from '$db/db.ts';
import { oidcAllowlistStateQueries } from '$db/queries/oidcAllowlistState.ts';
import { OIDC_USER_SQL, OIDC_USER_SQL_PARAMS } from '$db/queries/users.ts';
import { logger } from '$logger/logger.ts';
import type { OidcAllowlistPolicy } from './oidcAllowlist.ts';

export interface OidcAllowlistRevocationResult {
  changed: boolean;
  deletedSessions: number;
}

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort();
}

/**
 * Hash the canonical, order-independent policy without persisting configured identities.
 *
 * Canonical form (v1): `{ v, configured, subjects, emails, emailDomains, groups, groupsClaim,
 * allowAll }` where every set is sorted, `groupsClaim` is nulled unless group entries exist
 * (a claim name can never match without entries), and `allowAll` is forced to `false` while
 * any list is configured (lists are authoritative, so the flag is inert). The fingerprint
 * therefore tracks the policy's *effective* sign-in semantics, not its raw env text.
 *
 * Bump `v` whenever `evaluateOidcAllowlist` semantics change so every deployment re-revokes
 * once against the new definition instead of trusting fingerprints hashed under old rules.
 */
export function fingerprintOidcAllowlist(policy: OidcAllowlistPolicy): string {
  const canonical = JSON.stringify({
    v: 1,
    configured: policy.configured,
    subjects: sorted(policy.subjects),
    emails: sorted(policy.emails),
    emailDomains: sorted(policy.emailDomains),
    groups: sorted(policy.groups),
    groupsClaim: policy.groups.size > 0 ? policy.groupsClaim : null,
    allowAll: policy.configured ? false : policy.allowAll,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * On OIDC startup, revoke all OIDC-user sessions when the allowlist changed since the previous
 * OIDC startup. A missing fingerprint is a change. Other auth modes leave sessions and state alone.
 */
export async function revokeOidcSessionsOnAllowlistChange(): Promise<OidcAllowlistRevocationResult> {
  if (config.authMode !== 'oidc') {
    return { changed: false, deletedSessions: 0 };
  }

  const fingerprint = fingerprintOidcAllowlist(config.oidc.allowlist);
  const result = await db.transaction((): OidcAllowlistRevocationResult => {
    if (oidcAllowlistStateQueries.getFingerprint() === fingerprint) {
      return { changed: false, deletedSessions: 0 };
    }

    const deletedSessions = db.execute(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE ${OIDC_USER_SQL})`,
      ...OIDC_USER_SQL_PARAMS
    );
    oidcAllowlistStateQueries.storeFingerprint(fingerprint);
    return { changed: true, deletedSessions };
  });

  if (result.changed) {
    await logger.info(
      `Revoked ${result.deletedSessions} OIDC session${result.deletedSessions === 1 ? '' : 's'} after allowlist policy change`,
      { source: 'Auth:Session', meta: { count: result.deletedSessions } }
    );
  }
  return result;
}
