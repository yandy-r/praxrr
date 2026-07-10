/**
 * Trusted-proxy allowlist parsing + peer matching (issue #228).
 *
 * PURE, client+server-safe: no `Deno.env`, no I/O, no server-only imports, no `Date`/`Math.random`.
 * The single authoritative encoding of the `loopback` / `private` CIDR sets lives here; the prefix
 * heuristics in `network.ts` (`isLocalAddress`) and `checks.ts` (`classifyHost`) stay untouched this
 * issue, guarded against drift by a cross-check test. This module owns REAL bitwise CIDR math: IPv4 as
 * an unsigned 32-bit integer, IPv6 as a 128-bit `bigint`.
 *
 * `parseTrustedProxy` NEVER throws: a malformed or empty token can only ever remove trust, never add it.
 * "Fail closed" means deny trust, not crash the process — so the Shield page can still render the
 * actionable fix for a typo'd value instead of the app failing to boot.
 */

export type TrustedProxyMode = 'unset' | 'explicit' | 'wildcard';

export interface CidrRange {
  readonly family: 4 | 6;
  /** Network address, masked to `prefix` bits (a v4 range is held in the low 32 bits). */
  readonly base: bigint;
  readonly prefix: number; // 0..32 (v4) or 0..128 (v6)
  /** Original token (or the expanded CIDR for a keyword), for display/detail. */
  readonly raw: string;
}

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

const V4_BITS = 32;
const V6_BITS = 128;
const V6_FULL = (1n << 128n) - 1n;

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

// --- integer conversion -----------------------------------------------------------------------

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * Parse a dotted-quad to an unsigned 32-bit integer, or `null` if malformed. Octets are parsed as
 * DECIMAL (leading zeros accepted, mirroring `isLocalIPv4`'s `parseInt(p, 10)` so the drift guard stays
 * in lockstep — this module must not diverge into octal interpretation). Rejects wrong arity, non-digit
 * octets, and octets > 255. Built with `* 256 + octet` (all within Number's safe range) rather than
 * `<<` so no intermediate ever goes negative.
 */
function parseIpv4ToU32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null; // rejects '', signs, non-digits, > 3 digits
    const octet = Number(part);
    if (octet > 255) return null;
    acc = acc * 256 + octet;
  }
  return acc >>> 0; // final coercion to unsigned 32-bit
}

/**
 * Parse an RFC 4291 IPv6 literal to a 128-bit `bigint`, or `null` if malformed. Handles `::`
 * zero-compression (at most one) and an embedded IPv4 tail (`::ffff:a.b.c.d`, `64:ff9b::1.2.3.4`).
 * Rejects a zone id (`%eth0`) and any address that does not resolve to exactly 8 hextets.
 */
function parseIpv6ToBigInt(ip: string): bigint | null {
  if (ip.length === 0 || ip.includes('%')) return null; // zone ids are meaningless for a remote peer

  // Fold an embedded IPv4 tail into two hextets before the general parse.
  let text = ip;
  if (text.includes('.')) {
    const idx = text.lastIndexOf(':');
    if (idx === -1) return null; // a bare IPv4 is not an IPv6 address
    const u32 = parseIpv4ToU32(text.slice(idx + 1));
    if (u32 === null) return null;
    const hi = ((u32 >>> 16) & 0xffff).toString(16);
    const lo = (u32 & 0xffff).toString(16);
    text = `${text.slice(0, idx + 1)}${hi}:${lo}`;
  }

  const doubleColon = text.indexOf('::');
  let headGroups: string[];
  let tailGroups: string[];
  if (doubleColon !== -1) {
    if (text.indexOf('::', doubleColon + 1) !== -1) return null; // only one '::' allowed
    const head = text.slice(0, doubleColon);
    const tail = text.slice(doubleColon + 2);
    headGroups = head.length > 0 ? head.split(':') : [];
    tailGroups = tail.length > 0 ? tail.split(':') : [];
  } else {
    headGroups = text.split(':');
    tailGroups = [];
  }

  const isHextet = (group: string) => /^[0-9a-f]{1,4}$/.test(group);
  if (!headGroups.every(isHextet) || !tailGroups.every(isHextet)) return null;

  let groups: string[];
  if (doubleColon !== -1) {
    const missing = 8 - (headGroups.length + tailGroups.length);
    if (missing < 1) return null; // '::' must stand in for at least one group
    groups = [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
  } else {
    groups = headGroups;
  }
  if (groups.length !== 8) return null; // rejects < 8 (no '::') and > 8 hextets

  let acc = 0n;
  for (const group of groups) {
    acc = (acc << 16n) | BigInt(parseInt(group, 16));
  }
  return acc;
}

interface ParsedIp {
  readonly family: 4 | 6;
  /** A v4 address is held in the low 32 bits. */
  readonly value: bigint;
}

/**
 * Normalize + parse a bare IP literal (no prefix) into a family-tagged integer. Strips brackets and
 * folds an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) down to its IPv4 form BEFORE matching so a mapped
 * peer tests against v4 ranges (mirrors the `::ffff:` handling in `isLocalAddress`).
 */
function parseIpLiteral(raw: string): ParsedIp | null {
  let ip = stripBrackets(raw.trim().toLowerCase());
  if (ip.length === 0) return null;

  // IPv4-mapped IPv6 → its IPv4 form (only the dotted-quad form; the pure-hex form stays v6).
  if (ip.startsWith('::ffff:') && ip.slice(7).includes('.')) {
    ip = ip.slice(7);
  }

  if (ip.includes(':')) {
    const value = parseIpv6ToBigInt(ip);
    return value === null ? null : { family: 6, value };
  }
  if (ip.includes('.')) {
    const value = parseIpv4ToU32(ip);
    return value === null ? null : { family: 4, value: BigInt(value >>> 0) };
  }
  return null;
}

// --- masks + containment ----------------------------------------------------------------------

/**
 * IPv4 netmask as an unsigned 32-bit integer. `prefix === 0` is SPECIAL-CASED to 0: JS shift counts are
 * taken mod 32, so `0xffffffff << 32` evaluates to `0xffffffff` (a no-op), NOT 0 — a naive
 * `0xffffffff << (32 - prefix)` would make a `/0` range match NOTHING instead of everything. The
 * trailing `>>> 0` re-coerces the (otherwise sign-extended) shift result to unsigned.
 */
function maskV4(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** IPv6 netmask as a `bigint`: the top `prefix` bits set. `prefix === 0` yields `0n` (match all). */
function maskV6(prefix: number): bigint {
  return prefix === 0 ? 0n : V6_FULL ^ ((1n << BigInt(V6_BITS - prefix)) - 1n);
}

function containsV4(base: number, prefix: number, peer: number): boolean {
  return (peer & maskV4(prefix)) >>> 0 === base;
}

function containsV6(base: bigint, prefix: number, peer: bigint): boolean {
  return (peer & maskV6(prefix)) === base;
}

// --- token parsing ----------------------------------------------------------------------------

/**
 * Parse a single `ip` / `ip/prefix` token into a `CidrRange`, or `null` if malformed. A bare literal
 * takes the implicit host prefix (`/32` v4, `/128` v6). Rejects a non-numeric / empty / out-of-range
 * prefix. The stored `base` is masked to `prefix` bits so containment is a single compare.
 */
function parseCidrToken(token: string): CidrRange | null {
  const slash = token.indexOf('/');
  const addr = slash === -1 ? token : token.slice(0, slash);
  const prefixText = slash === -1 ? null : token.slice(slash + 1);

  const parsed = parseIpLiteral(addr);
  if (parsed === null) return null;

  const maxPrefix = parsed.family === 4 ? V4_BITS : V6_BITS;
  let prefix: number;
  if (prefixText === null) {
    prefix = maxPrefix;
  } else {
    if (!/^\d{1,3}$/.test(prefixText)) return null; // empty / non-numeric / absurdly long
    prefix = Number(prefixText);
    if (prefix > maxPrefix) return null; // e.g. /33, /129
  }

  const base =
    parsed.family === 4 ? BigInt((Number(parsed.value) & maskV4(prefix)) >>> 0) : parsed.value & maskV6(prefix);
  return { family: parsed.family, base, prefix, raw: token };
}

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
    if (range.family !== parsed.family) continue;
    const matched =
      parsed.family === 4
        ? containsV4(Number(range.base), range.prefix, Number(parsed.value))
        : containsV6(range.base, range.prefix, parsed.value);
    if (matched) return true;
  }
  return false;
}
