/**
 * Trusted-proxy allowlist parsing + peer matching (issue #228).
 *
 * PURE, client+server-safe: no `Deno.env`, no I/O, no server-only imports, no `Date`/`Math.random`.
 * The single authoritative encoding of the `loopback` / `private` CIDR sets lives here; the prefix
 * heuristics in `network.ts` (`isLocalAddress`) and `checks.ts` (`classifyHost`) stay untouched this
 * issue, guarded against drift by a cross-check test. `$shared/security/ip.ts` owns the shared real
 * bitwise CIDR math: IPv4 as an unsigned 32-bit integer, IPv6 as a 128-bit `bigint`.
 *
 * `parseTrustedProxy` NEVER throws: a malformed or empty token can only ever remove trust, never add it.
 * "Fail closed" means deny trust, not crash the process — so the Shield page can still render the
 * actionable fix for a typo'd value instead of the app failing to boot.
 */

import { containsParsedIp, parseCidrToken, parseIpLiteral, type CidrRange } from './ip.ts';

export type { CidrRange } from './ip.ts';

export type TrustedProxyMode = 'unset' | 'explicit' | 'wildcard';

export interface TrustedProxyConfig {
  /** Original env string (display only). */
  readonly raw: string | null;
  readonly mode: TrustedProxyMode;
  /** Empty when `mode === 'unset'`. */
  readonly ranges: readonly CidrRange[];
  readonly invalidEntries: readonly string[];
  /** `'*'` / `'all'`. */
  readonly wildcard: boolean;
  /** `wildcard` OR any range with `prefix <= OVERLY_BROAD_PREFIX[family]`. */
  readonly overlyBroad: boolean;
}

/**
 * The overly-broad supernet threshold, per family. A prefix AT OR BELOW this is flagged: it catches
 * `0.0.0.0/0`, the split-`/1` internet trick, `::/0`, and the `private` keyword's `fc00::/7` member,
 * while sparing legitimate operator supernets like `10.0.0.0/8` or `172.16.0.0/12`.
 */
const OVERLY_BROAD_PREFIX: Readonly<Record<4 | 6, number>> = { 4: 7, 6: 7 };

/**
 * Single authoritative CIDR encoding for the keyword expansions. `loopback` is NOT overly broad;
 * `private` IS (via its `fc00::/7` member ≤ /7). `fec0::/10` (site-local, deprecated) is intentionally
 * omitted here even though `isLocalIPv6` still matches it — the `private` set is the RFC1918 + ULA +
 * link-local canon.
 */
const LOOPBACK_CIDRS = ['127.0.0.0/8', '::1/128'] as const;
const PRIVATE_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  'fc00::/7',
  'fe80::/10',
] as const;

function expandKeyword(cidrs: readonly string[]): CidrRange[] {
  // These are compile-time-known valid; a null here is an internal invariant violation, not user input.
  return cidrs.map((cidr) => {
    const range = parseCidrToken(cidr);
    if (range === null) throw new Error(`trustedProxy: built-in CIDR "${cidr}" must parse`);
    return range;
  });
}

const LOOPBACK_RANGES = expandKeyword(LOOPBACK_CIDRS);
const PRIVATE_RANGES = expandKeyword(PRIVATE_CIDRS);

function unsetConfig(raw: string | null): TrustedProxyConfig {
  return { raw, mode: 'unset', ranges: [], invalidEntries: [], wildcard: false, overlyBroad: false };
}

// --- public API -------------------------------------------------------------------------------

/**
 * Parse a raw `TRUSTED_PROXY` value. NEVER throws. Comma- and/or whitespace-separated; each token is
 * trimmed + lower-cased; empty tokens (runs of separators, lone commas) are skipped and can never be
 * coerced into `all` / `*`. Malformed tokens are dropped into `invalidEntries` (they grant trust to
 * nobody). A value that yields zero tokens (unset, empty, whitespace, or lone separators) is
 * `mode: 'unset'`; any value with at least one real token is `explicit` (or `wildcard`), even if every
 * token was invalid — so Shield can still surface the ignored tokens.
 */
export function parseTrustedProxy(raw: string | null | undefined): TrustedProxyConfig {
  if (raw === null || raw === undefined) return unsetConfig(null);

  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return unsetConfig(raw);

  const ranges: CidrRange[] = [];
  const invalidEntries: string[] = [];
  let wildcard = false;

  for (const token of tokens) {
    if (token === '*' || token === 'all') {
      wildcard = true;
    } else if (token === 'loopback') {
      ranges.push(...LOOPBACK_RANGES);
    } else if (token === 'private') {
      ranges.push(...PRIVATE_RANGES);
    } else {
      const range = parseCidrToken(token);
      if (range === null) invalidEntries.push(token);
      else ranges.push(range);
    }
  }

  const overlyBroad = wildcard || ranges.some((range) => range.prefix <= OVERLY_BROAD_PREFIX[range.family]);
  return {
    raw,
    mode: wildcard ? 'wildcard' : 'explicit',
    ranges,
    invalidEntries,
    wildcard,
    overlyBroad,
  };
}

/**
 * True iff the direct socket peer is an approved proxy. `unset` → false (trust nobody); `wildcard` →
 * true; otherwise bitwise containment against every same-family range. An unparseable peer → false
 * (fail closed).
 */
export function isTrustedProxyPeer(peerIp: string, cfg: TrustedProxyConfig): boolean {
  if (cfg.mode === 'unset') return false;
  if (cfg.mode === 'wildcard') return true;

  const parsed = parseIpLiteral(peerIp);
  if (parsed === null) return false;

  for (const range of cfg.ranges) {
    if (containsParsedIp(parsed, range)) return true;
  }
  return false;
}
