/**
 * Pure origin parsing shared by the config singleton (`PRAXRR_TRUSTED_ORIGINS`) and the runtime
 * CSRF gate (YAN-433 / #276). No `Deno.env` access and no imports — keeps the module a leaf so
 * config and the CSRF guard can both depend on it without cycles.
 */

/**
 * Normalize an origin string (`scheme://host[:port]`) to its lowercase canonical form.
 * Invalid/unparseable input, and any non-http(s) scheme, yields `null` (fail-closed: an origin
 * that cannot be proven well-formed never widens a trust list).
 */
export function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Parse a `PRAXRR_TRUSTED_ORIGINS`-style comma-separated list into deduplicated, normalized
 * origins. Malformed entries are dropped, never thrown — a typo shrinks the allowlist instead of
 * bricking boot (same fail-closed philosophy as `parseTrustedProxy`).
 */
export function parseTrustedOrigins(value: string | null): string[] {
  if (!value) return [];
  const origins: string[] = [];
  for (const token of value.split(',')) {
    const origin = normalizeOrigin(token.trim());
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}
