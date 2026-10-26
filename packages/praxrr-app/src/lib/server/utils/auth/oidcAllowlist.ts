/**
 * OIDC sign-in allowlist (YAN-436): restrict which OIDC identities may sign in.
 *
 * PURE: no `Deno.env`, no I/O, no server-only imports — parsed once at Config construction.
 * Mirrors the trusted-proxy parsing idiom: `parseOidcAllowlist` NEVER throws; a malformed
 * entry can only ever REMOVE access (it grants nothing) and is recorded in `invalidEntries`
 * so Shield Check can surface the typo with an actionable fix instead of bricking boot.
 *
 * Fail-closed: with no list configured and no explicit opt-out (`OIDC_ALLOW_ALL_USERS`),
 * `evaluateOidcAllowlist` denies every identity — a missing allowlist never silently
 * becomes "allow everyone".
 */

export interface OidcAllowlistPolicy {
  /** Exact `sub` claim matches (case-sensitive). */
  readonly subjects: ReadonlySet<string>;
  /** Lowercased exact `email` matches (honored only when `email_verified` is true). */
  readonly emails: ReadonlySet<string>;
  /** Lowercased exact email-domain matches (`@domain` entries). */
  readonly emailDomains: ReadonlySet<string>;
  /** Exact, case-sensitive group names read from the configured groups claim. */
  readonly groups: ReadonlySet<string>;
  /** Which ID-token claim groups are read from (default `groups`). */
  readonly groupsClaim: string;
  /** `OIDC_ALLOW_ALL_USERS` opt-out; effective ONLY when no list is configured. */
  readonly allowAll: boolean;
  /** Raw entries ignored as malformed (safe to echo — not secrets). */
  readonly invalidEntries: readonly string[];
  /** Any non-empty configured entry, including an entry rejected as malformed. */
  readonly configured: boolean;
  /** Number of valid entries that can match an identity. */
  readonly usableEntryCount: number;
}

export type OidcAllowlistDecision =
  | {
      readonly allowed: true;
      readonly matchedBy: 'subject' | 'email' | 'email-domain' | 'group' | 'allow-all';
    }
  | {
      readonly allowed: false;
      readonly reason: 'not-configured' | 'no-match';
    };

const TRUTHY = ['1', 'true', 'yes', 'on'];

/**
 * Split a comma- and/or newline-separated env value into trimmed, non-empty entries.
 * Spaces are NOT separators: IdP group names commonly contain them (`Praxrr Admins`).
 */
function splitEntries(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[,\r\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Parse the OIDC allowlist env values. NEVER throws: malformed email/domain entries
 * grant nothing and land in `invalidEntries`, while keeping the restrictive policy configured.
 */
export function parseOidcAllowlist(env: {
  subjects?: string | null;
  emails?: string | null;
  groups?: string | null;
  groupsClaim?: string | null;
  allowAll?: string | null;
}): OidcAllowlistPolicy {
  const subjects = new Set(splitEntries(env.subjects));
  const groups = new Set(splitEntries(env.groups));
  const emails = new Set<string>();
  const emailDomains = new Set<string>();
  const invalidEntries: string[] = [];

  const emailEntries = splitEntries(env.emails);
  for (const entry of emailEntries) {
    const normalized = entry.toLowerCase();
    if (normalized.startsWith('@')) {
      const domain = normalized.slice(1);
      // A `@domain` entry must name a real domain (contain a dot); anything else grants nothing.
      if (domain.includes('.') && !domain.includes('@') && !/\s/.test(domain)) {
        emailDomains.add(domain);
      } else {
        invalidEntries.push(normalized);
      }
    } else {
      const parts = normalized.split('@');
      if (parts.length === 2 && parts[0].length > 0 && parts[1].includes('.') && !/\s/.test(normalized)) {
        emails.add(normalized);
      } else {
        invalidEntries.push(normalized);
      }
    }
  }

  const groupsClaim = (env.groupsClaim ?? '').trim() || 'groups';
  const allowAll = TRUTHY.includes((env.allowAll ?? '').trim().toLowerCase());

  return {
    subjects,
    emails,
    emailDomains,
    groups,
    groupsClaim,
    allowAll,
    invalidEntries,
    configured: subjects.size > 0 || emailEntries.length > 0 || groups.size > 0,
    usableEntryCount: subjects.size + emails.size + emailDomains.size + groups.size,
  };
}

/**
 * Decide whether an authenticated identity may sign in. Lists are authoritative: when any
 * list is configured, the entries alone decide and `allowAll` is ignored. Emails are
 * matched only when the provider marks them verified (`email_verified === true`, or the
 * string `'true'` some providers send); domains match the part after the LAST `@` exactly
 * (no suffix or subdomain matching).
 */
export function evaluateOidcAllowlist(
  claims: Record<string, unknown> & { sub: string },
  policy: OidcAllowlistPolicy
): OidcAllowlistDecision {
  if (policy.configured) {
    if (policy.subjects.has(claims.sub)) {
      return { allowed: true, matchedBy: 'subject' };
    }

    const email = claims.email;
    if (typeof email === 'string' && (claims.email_verified === true || claims.email_verified === 'true')) {
      const normalized = email.toLowerCase();
      if (policy.emails.has(normalized)) {
        return { allowed: true, matchedBy: 'email' };
      }
      const at = normalized.lastIndexOf('@');
      if (at >= 0 && policy.emailDomains.has(normalized.slice(at + 1))) {
        return { allowed: true, matchedBy: 'email-domain' };
      }
    }

    const claim = claims[policy.groupsClaim];
    const claimGroups =
      typeof claim === 'string'
        ? [claim]
        : Array.isArray(claim)
          ? claim.filter((group): group is string => typeof group === 'string')
          : [];
    if (claimGroups.some((group) => policy.groups.has(group))) {
      return { allowed: true, matchedBy: 'group' };
    }

    return { allowed: false, reason: 'no-match' };
  }

  if (policy.allowAll) {
    return { allowed: true, matchedBy: 'allow-all' };
  }
  return { allowed: false, reason: 'not-configured' };
}
