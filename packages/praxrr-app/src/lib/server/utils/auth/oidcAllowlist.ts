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

import { domainToUnicode } from 'node:url';

export interface OidcAllowlistPolicy {
  /** Exact `sub` claim matches (case-sensitive). */
  readonly subjects: ReadonlySet<string>;
  /** Exact `email` matches, stored as `<ascii-lowercased local>@<punycode domain>` (honored only when `email_verified` is true). */
  readonly emails: ReadonlySet<string>;
  /** Exact email-domain matches (`@domain` entries), stored in lowercase punycode (ASCII) form. */
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
 * Lowercase ONLY `A-Z`. `String.prototype.toLowerCase` applies Unicode case mapping, which folds
 * characters such as U+212A KELVIN SIGN to ASCII `k` and so would let a different identity collide
 * with an allowlisted one. Local parts and entries therefore use this ASCII-only fold.
 */
function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

const NON_ASCII = /[^\u0020-\u007e]/;
/** Characters that would change how `new URL('http://' + domain)` splits the host from the rest. */
const URL_DELIMITERS = /[\s/\\?#:@%[\]]/;

/**
 * Convert an email domain to its lowercase ASCII (punycode) form with the WHATWG URL host parser
 * (UTS #46), so `bücher.example` and `xn--bcher-kva.example` compare equal. Returns `null` when
 * the domain cannot be represented safely: URL delimiters, a parse failure, a changed label
 * count (e.g. ideographic full stops), or a non-ASCII label that the mapping rewrote. Every
 * non-ASCII input label must already be NFC (U+212A KELVIN SIGN, for one, is not: NFC rewrites it
 * to `K`), and the output label decoded back to Unicode must equal the input label after
 * ASCII-only lowercasing; otherwise the spelling is a different string (fullwidth forms, soft
 * hyphens, a KELVIN SIGN, a fullwidth `xn--` prefix) and is never treated as equal to the
 * existing domain. Consequence: non-ASCII uppercase labels (`BÜCHER.example`) and decomposed
 * spellings are rejected — spell IDN labels in lowercase NFC or punycode.
 */
function toAsciiDomain(domain: string): string | null {
  if (domain.length === 0 || URL_DELIMITERS.test(domain)) return null;
  let hostname: string;
  try {
    hostname = new URL(`http://${domain}`).hostname;
  } catch {
    return null;
  }
  const inputLabels = domain.split('.');
  const outputLabels = hostname.split('.');
  if (inputLabels.length !== outputLabels.length) return null;
  for (let i = 0; i < inputLabels.length; i++) {
    if (!NON_ASCII.test(inputLabels[i])) continue;
    if (!outputLabels[i].startsWith('xn--')) return null;
    const label = inputLabels[i];
    if (label.normalize('NFC') !== label || domainToUnicode(outputLabels[i]) !== asciiLowercase(label)) {
      return null;
    }
  }
  return hostname;
}

/** Normalize `local@domain`: ASCII-lowercased local part, punycode domain; `null` when unrepresentable. */
function normalizeEmail(local: string, domain: string): string | null {
  const asciiDomain = toAsciiDomain(domain);
  return asciiDomain === null ? null : `${asciiLowercase(local)}@${asciiDomain}`;
}

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
    if (entry.startsWith('@')) {
      const rawDomain = entry.slice(1);
      // A `@domain` entry must name a real domain (contain a dot); anything else grants nothing.
      const domain = rawDomain.includes('.') && !/\s/.test(rawDomain) ? toAsciiDomain(rawDomain) : null;
      if (domain !== null && domain.includes('.')) {
        emailDomains.add(domain);
      } else {
        invalidEntries.push(entry);
      }
    } else {
      const parts = entry.split('@');
      const normalized =
        parts.length === 2 && parts[0].length > 0 && parts[1].includes('.') && !/\s/.test(entry)
          ? normalizeEmail(parts[0], parts[1])
          : null;
      if (normalized !== null) {
        emails.add(normalized);
      } else {
        invalidEntries.push(entry);
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
 * (no suffix or subdomain matching). Local parts are compared after an ASCII-only lowercase
 * (no Unicode case folding); domains are compared in lowercase punycode form.
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
      const at = email.lastIndexOf('@');
      const domain = at >= 0 ? toAsciiDomain(email.slice(at + 1)) : null;
      if (domain !== null) {
        if (policy.emails.has(`${asciiLowercase(email.slice(0, at))}@${domain}`)) {
          return { allowed: true, matchedBy: 'email' };
        }
        if (policy.emailDomains.has(domain)) {
          return { allowed: true, matchedBy: 'email-domain' };
        }
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
