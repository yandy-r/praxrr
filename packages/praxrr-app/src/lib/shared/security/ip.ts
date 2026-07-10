/**
 * Pure IP parsing, CIDR containment, and address classification for Security Posture.
 *
 * IPv4 is represented as an unsigned 32-bit integer and IPv6 as a 128-bit `bigint`. The parser is
 * shared with trusted-proxy matching, while classification is a separate policy layer so extracting
 * these mechanics cannot silently change the existing proxy-trust contract.
 */

import type { IpAddressClass } from './types.ts';

export interface ParsedIp {
  readonly family: 4 | 6;
  /** A v4 address is held in the low 32 bits. */
  readonly value: bigint;
}

export interface CidrRange {
  readonly family: 4 | 6;
  /** Network address, masked to `prefix` bits (a v4 range is held in the low 32 bits). */
  readonly base: bigint;
  readonly prefix: number;
  /** Original token, retained for trusted-proxy display/detail. */
  readonly raw: string;
}

const V4_BITS = 32;
const V6_BITS = 128;
const V6_FULL = (1n << 128n) - 1n;

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** Parse a decimal dotted-quad to an unsigned 32-bit integer, or `null` if malformed. */
function parseIpv4ToU32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let acc = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    acc = acc * 256 + octet;
  }
  return acc >>> 0;
}

/**
 * Parse an RFC 4291 IPv6 literal to a 128-bit integer. Supports one `::` compression and an embedded
 * IPv4 tail, and rejects zone identifiers because they are not meaningful for remote DNS/peer data.
 */
function parseIpv6ToBigInt(ip: string): bigint | null {
  if (ip.length === 0 || ip.includes('%')) return null;

  let text = ip;
  if (text.includes('.')) {
    const idx = text.lastIndexOf(':');
    if (idx === -1) return null;
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
    if (text.indexOf('::', doubleColon + 1) !== -1) return null;
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
    if (missing < 1) return null;
    groups = [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
  } else {
    groups = headGroups;
  }
  if (groups.length !== 8) return null;

  let acc = 0n;
  for (const group of groups) {
    acc = (acc << 16n) | BigInt(parseInt(group, 16));
  }
  return acc;
}

/**
 * Normalize and parse a bare IP literal. Dotted IPv4-mapped IPv6 retains the shipped trusted-proxy
 * behavior by folding to IPv4 here; pure-hex mapped IPv6 is normalized only by classification.
 */
export function parseIpLiteral(raw: string): ParsedIp | null {
  let ip = stripBrackets(raw.trim().toLowerCase());
  if (ip.length === 0) return null;

  if (ip.startsWith('::ffff:') && ip.slice(7).includes('.')) {
    ip = ip.slice(7);
  }

  if (ip.includes(':')) {
    const value = parseIpv6ToBigInt(ip);
    return value === null ? null : { family: 6, value };
  }
  if (ip.includes('.')) {
    const value = parseIpv4ToU32(ip);
    return value === null ? null : { family: 4, value: BigInt(value) };
  }
  return null;
}

function maskV4(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (V4_BITS - prefix)) >>> 0;
}

function maskV6(prefix: number): bigint {
  return prefix === 0 ? 0n : V6_FULL ^ ((1n << BigInt(V6_BITS - prefix)) - 1n);
}

/** Parse one IP or CIDR token into a masked range, or `null` when malformed. */
export function parseCidrToken(token: string): CidrRange | null {
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
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
    if (prefix > maxPrefix) return null;
  }

  const base =
    parsed.family === 4 ? BigInt((Number(parsed.value) & maskV4(prefix)) >>> 0) : parsed.value & maskV6(prefix);
  return { family: parsed.family, base, prefix, raw: token };
}

/** True when an already-parsed IP is contained by a same-family CIDR. */
export function containsParsedIp(ip: ParsedIp, range: CidrRange): boolean {
  if (ip.family !== range.family) return false;
  return ip.family === 4
    ? (Number(ip.value) & maskV4(range.prefix)) >>> 0 === Number(range.base)
    : (ip.value & maskV6(range.prefix)) === range.base;
}

function builtInRanges(label: string, cidrs: readonly string[]): readonly CidrRange[] {
  return cidrs.map((cidr) => {
    const range = parseCidrToken(cidr);
    if (range === null) throw new Error(`ip: built-in ${label} CIDR "${cidr}" must parse`);
    return range;
  });
}

// Reviewed 2026-07-10 against the IANA IPv4 and IPv6 Special-Purpose Address Registries. These are
// deliberately conservative classification subsets: special-purpose space never defaults to public.
const IPV4_LOOPBACK = builtInRanges('IPv4 loopback', ['127.0.0.0/8']);
const IPV4_PRIVATE = builtInRanges('IPv4 private', ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
const IPV4_LINK_LOCAL = builtInRanges('IPv4 link-local', ['169.254.0.0/16']);
const IPV4_SPECIAL = builtInRanges('IPv4 special', [
  '0.0.0.0/8',
  '100.64.0.0/10',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.31.196.0/24',
  '192.52.193.0/24',
  '192.88.99.0/24',
  '192.175.48.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
]);

const IPV6_LOOPBACK = builtInRanges('IPv6 loopback', ['::1/128']);
const IPV6_PRIVATE = builtInRanges('IPv6 private', ['fc00::/7']);
const IPV6_LINK_LOCAL = builtInRanges('IPv6 link-local', ['fe80::/10']);
const IPV6_SPECIAL = builtInRanges('IPv6 special', [
  '::/96',
  '64:ff9b::/96',
  '64:ff9b:1::/48',
  '100::/64',
  '100:0:0:1::/64',
  '2001::/23',
  '2001:db8::/32',
  '2002::/16',
  '2620:4f:8000::/48',
  '3fff::/20',
  '5f00::/16',
  'fec0::/10',
  'ff00::/8',
]);
const IPV6_GLOBAL_UNICAST = builtInRanges('IPv6 global unicast', ['2000::/3']);

function matchesAny(ip: ParsedIp, ranges: readonly CidrRange[]): boolean {
  return ranges.some((range) => containsParsedIp(ip, range));
}

function normalizeMappedIpv6ForClassification(ip: ParsedIp): ParsedIp {
  // IPv4-mapped IPv6 is ::ffff:0:0/96. Dotted forms were already folded by parseIpLiteral; this
  // catches pure-hex forms such as ::ffff:7f00:1 without changing trusted-proxy matching semantics.
  if (ip.family === 6 && ip.value >> 32n === 0xffffn) {
    return { family: 4, value: ip.value & 0xffffffffn };
  }
  return ip;
}

/**
 * Classify an IP literal for DNS transport evidence. Malformed and unfamiliar/special-purpose input
 * is deliberately `special`, never `public` or local assurance.
 */
export function classifyIpAddress(raw: string): IpAddressClass {
  const parsed = parseIpLiteral(raw);
  if (parsed === null) return 'special';
  const ip = normalizeMappedIpv6ForClassification(parsed);

  if (ip.family === 4) {
    if (matchesAny(ip, IPV4_LOOPBACK)) return 'loopback';
    if (matchesAny(ip, IPV4_PRIVATE)) return 'private';
    if (matchesAny(ip, IPV4_LINK_LOCAL)) return 'link-local';
    if (matchesAny(ip, IPV4_SPECIAL)) return 'special';
    return 'public';
  }

  if (matchesAny(ip, IPV6_LOOPBACK)) return 'loopback';
  if (matchesAny(ip, IPV6_PRIVATE)) return 'private';
  if (matchesAny(ip, IPV6_LINK_LOCAL)) return 'link-local';
  if (matchesAny(ip, IPV6_SPECIAL)) return 'special';
  return matchesAny(ip, IPV6_GLOBAL_UNICAST) ? 'public' : 'special';
}
