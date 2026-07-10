# Reference implementations — issue #228 (`TRUSTED_PROXY`)

Production-quality sketches the implementer adapts. Style matches `.prettierrc`
(2-space indent, single quotes, semicolons, 120-char width, `trailingComma: es5`).
Engine/shared modules are **pure**: no `Deno.env`, no I/O, no `Date` / `Math.random`.

Authoritative design: `docs/internal/228-trusted-proxy/DESIGN.md`. Section refs below (§) point there.

---

## 1. Full pure module — `packages/praxrr-app/src/lib/shared/security/trustedProxy.ts`

Owns the real bitwise CIDR arithmetic (§3.3): IPv4 in `u32`, IPv6 in `bigint`. No
duplication of the `isLocalAddress` heuristics — the `loopback` / `private` keyword
expansions here are the single authoritative CIDR encoding, and the drift-guard test
(§3.3 / §8.1 A) pins them against `isLocalAddress`.

```ts
/**
 * Trusted-proxy allowlist parsing + peer matching (issue #228).
 *
 * PURE, client+server-safe: no `Deno.env`, no I/O, no server-only imports, no `Date`/`Math.random`.
 * The single authoritative encoding of the `loopback` / `private` CIDR sets lives here (§3.3); the
 * prefix heuristics in `network.ts` (`isLocalAddress`) and `checks.ts` (`classifyHost`) stay untouched
 * this issue, guarded against drift by a cross-check test. This module owns REAL bitwise CIDR math:
 * IPv4 as an unsigned 32-bit integer, IPv6 as a 128-bit `bigint`.
 *
 * `parseTrustedProxy` NEVER throws: a malformed or empty token can only ever remove trust, never add
 * it (§2.3). "Fail closed" means deny trust, not crash the process — so the Shield page can still
 * render the actionable fix for a typo'd value instead of the app failing to boot.
 */

export type TrustedProxyMode = 'unset' | 'explicit' | 'wildcard';

export interface CidrRange {
  readonly family: 4 | 6;
  readonly base: bigint; // network address, masked to `prefix` bits (v4 held in the low 32 bits)
  readonly prefix: number; // 0..32 (v4) or 0..128 (v6)
  readonly raw: string; // original token (or expanded CIDR for a keyword), for display/detail
}

export interface TrustedProxyConfig {
  readonly raw: string | null; // original env string (display only)
  readonly mode: TrustedProxyMode;
  readonly ranges: readonly CidrRange[]; // empty when mode === 'unset'
  readonly invalidEntries: readonly string[];
  readonly wildcard: boolean; // '*' / 'all'
  readonly overlyBroad: boolean; // wildcard OR any range with prefix <= threshold
}

const V4_BITS = 32;
const V6_BITS = 128;
const V6_FULL = (1n << 128n) - 1n;

/**
 * The overly-broad supernet threshold, per family (§3.2). A prefix AT OR BELOW this is flagged: it
 * catches `0.0.0.0/0`, the split-`/1` internet trick, `::/0`, and the `private` keyword's `fc00::/7`
 * member, while sparing legitimate operator supernets like `10.0.0.0/8` or `172.16.0.0/12`.
 */
const OVERLY_BROAD_PREFIX: Readonly<Record<4 | 6, number>> = { 4: 7, 6: 7 };

/**
 * Single authoritative CIDR encoding for the keyword expansions (§2.2 / §3.3). `loopback` is NOT
 * overly broad; `private` IS (via `fc00::/7` ≤ /7). NOTE: `fec0::/10` (site-local, deprecated) is
 * intentionally omitted here even though `isLocalIPv6` still matches it — the drift-guard sample set
 * excludes it, and the design's `private` set is the RFC1918 + ULA + link-local canon.
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
 * DECIMAL (leading zeros accepted, mirroring `isLocalIPv4`'s `parseInt(p, 10)` so the drift guard
 * stays in lockstep — this module must not diverge into octal interpretation). Rejects wrong arity,
 * non-digit octets, and octets > 255. Built with `* 256 + octet` (all within Number's safe range)
 * rather than `<<` so no intermediate ever goes negative.
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

  const isHextet = (g: string) => /^[0-9a-f]{1,4}$/.test(g);
  if (!headGroups.every(isHextet) || !tailGroups.every(isHextet)) return null;

  let groups: string[];
  if (doubleColon !== -1) {
    const missing = 8 - (headGroups.length + tailGroups.length);
    if (missing < 1) return null; // '::' must stand in for at least one group
    groups = [
      ...headGroups,
      ...Array<string>(missing).fill('0'),
      ...tailGroups,
    ];
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
  readonly value: bigint; // v4 held in the low 32 bits
}

/**
 * Normalize + parse a bare IP literal (no prefix) into a family-tagged integer. Strips brackets and
 * folds an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) down to its IPv4 form BEFORE matching so a
 * mapped peer tests against v4 ranges (mirrors the `::ffff:` handling in `isLocalAddress`).
 */
function parseIpLiteral(raw: string): ParsedIp | null {
  let ip = stripBrackets(raw.trim().toLowerCase());
  if (ip.length === 0) return null;

  // IPv4-mapped IPv6 → its IPv4 form (only the dotted-quad form; the hex form stays v6).
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
 * IPv4 netmask as an unsigned 32-bit integer. `prefix === 0` is SPECIAL-CASED to 0: JS shift counts
 * are taken mod 32, so `0xffffffff << 32` evaluates to `0xffffffff` (a no-op), NOT 0 — a naive
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
    parsed.family === 4
      ? BigInt((Number(parsed.value) & maskV4(prefix)) >>> 0)
      : parsed.value & maskV6(prefix);
  return { family: parsed.family, base, prefix, raw: token };
}

function expandKeyword(cidrs: readonly string[]): CidrRange[] {
  // These are compile-time-known valid; a null here is an internal invariant violation, not user input.
  return cidrs.map((cidr) => {
    const range = parseCidrToken(cidr);
    if (range === null)
      throw new Error(`trustedProxy: built-in CIDR "${cidr}" must parse`);
    return range;
  });
}

const LOOPBACK_RANGES = expandKeyword(LOOPBACK_CIDRS);
const PRIVATE_RANGES = expandKeyword(PRIVATE_CIDRS);

function unsetConfig(raw: string | null): TrustedProxyConfig {
  return {
    raw,
    mode: 'unset',
    ranges: [],
    invalidEntries: [],
    wildcard: false,
    overlyBroad: false,
  };
}

// --- public API -------------------------------------------------------------------------------

/**
 * Parse a raw `TRUSTED_PROXY` value (§2.2). NEVER throws. Comma- and/or whitespace-separated; each
 * token is trimmed + lower-cased; empty tokens (runs of separators, lone commas) are skipped and can
 * never be coerced into `all` / `*`. Malformed tokens are dropped into `invalidEntries` (they grant
 * trust to nobody). A value that yields zero tokens (unset, empty, whitespace, or lone separators) is
 * `mode: 'unset'`; any value with at least one real token is `explicit` (or `wildcard`), even if every
 * token was invalid — so Shield can still surface the ignored tokens.
 */
export function parseTrustedProxy(
  raw: string | null | undefined
): TrustedProxyConfig {
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

  const overlyBroad =
    wildcard ||
    ranges.some((range) => range.prefix <= OVERLY_BROAD_PREFIX[range.family]);
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
export function isTrustedProxyPeer(
  peerIp: string,
  cfg: TrustedProxyConfig
): boolean {
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
```

Barrel re-export — `packages/praxrr-app/src/lib/shared/security/index.ts`:

```ts
export {
  parseTrustedProxy,
  isTrustedProxyPeer,
  type CidrRange,
  type TrustedProxyConfig,
  type TrustedProxyMode,
} from './trustedProxy.ts';
```

---

## 2. `proxyTrust` scorer — additions to `packages/praxrr-app/src/lib/shared/security/checks.ts`

Implements the §6.2 states table (rows 1–6, precedence top-down) with the existing
`result()` / `rec()` helpers and the `isLoopbackBindHost` helper already in this file.
Weight is applied **only** in row 1. The scorer emits a real (weighted) finding only in
row 1, an assurance-linked `null` in row 2, and an inert `null` (`na`) otherwise; rows 3–5's
advisories are built in `engine.ts` (§3 below).

```ts
// --- weight (near LOG_REDACTION_FAIL_WEIGHT) ---------------------------------------------------

/** Weight `proxy_trust` carries ONLY in the row-1 live-bypass state; it is weight 0 in every other. */
const PROXY_TRUST_FAIL_WEIGHT = 25;

// --- proxy_trust (scored ONLY when an operator opened a live bypass) ---------------------------

const ID_PROXY_TRUST: SecurityCheckId = 'proxy_trust';
const LABEL_PROXY_TRUST = 'Trusted proxy allowlist';

const proxyTrust: SecurityCheck = {
  id: ID_PROXY_TRUST,
  label: LABEL_PROXY_TRUST,
  weight: PROXY_TRUST_FAIL_WEIGHT,
  score(inputs) {
    const configured = inputs.trustedProxyConfigured;
    // The only context where `getClientIp` drives an auth decision reachable from a non-loopback iface.
    const spoofableContext =
      inputs.authMode === 'local' && !isLoopbackBindHost(inputs.bindHost);

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
            {
              kind: 'env-var',
              name: 'TRUSTED_PROXY',
              label: "Narrow TRUSTED_PROXY to the proxy's address",
            }
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
    // genuinely-inert direct/loopback deployment (row 6). Either way `proxy_trust` scores null/na and
    // shifts no denominator, so AUTH=on and default AUTH=local reports stay numerically unchanged.
    const detail = configured
      ? [
          'TRUSTED_PROXY is set but is not a live auth-bypass risk in this mode; see the advisories for any follow-up.',
        ]
      : [
          'TRUSTED_PROXY is not set: forwarded headers are ignored and every request is graded by its real socket peer.',
        ];
    return result(
      ID_PROXY_TRUST,
      LABEL_PROXY_TRUST,
      null,
      0,
      'na',
      false,
      null,
      detail,
      []
    );
  },
};
```

Registration + helper export (same file):

```ts
// Make isLoopbackBindHost reusable by engine.ts's advisory builder (add `export`):
export function isLoopbackBindHost(rawHost: string): boolean {
  /* … unchanged body … */
}

/** The check registry, in stable display order. Adding a check is one entry here. */
export const ALL_CHECKS: readonly SecurityCheck[] = [
  controlPlaneAuth,
  arrTransport,
  appKeyAtRest,
  credentialRotation,
  logRedaction,
  proxyTrust,
];
```

---

## 3. `engine.ts` — row-2 assurance + rows 3/4/5 advisories

Import `isLoopbackBindHost` from `./checks.ts`, then mirror the `session_cookie_secure`
advisory shape. The three advisory states are mutually exclusive by the §6.2 precedence,
so a single resolver emits **at most one** proxy-trust advisory per report.

```ts
// engine.ts import line — add isLoopbackBindHost:
import {
  ALL_CHECKS,
  buildTransportRows,
  isLoopbackBindHost,
} from './checks.ts';
```

`buildAssurances` — append the row-2 push (same active-and-valid condition as the scorer):

```ts
function buildAssurances(inputs: PostureInputs): Assurance[] {
  const assurances: Assurance[] = [
    {
      id: 'log_redaction',
      label: 'Log redaction',
      verified: inputs.redactionVerified,
      note: inputs.redactionVerified
        ? 'Secrets are stripped from log metadata before every write (runtime-verified).'
        : 'Log redaction self-check failed — see the finding above.',
    },
    {
      id: 'arr_credentials_encrypted',
      label: 'Arr credentials encrypted at rest',
      verified: true,
      note: 'Arr API keys are stored AES-256-GCM encrypted, not in plaintext (issue #9).',
    },
  ];

  // Row 2 (active & valid): an explicit, non-broad, fully-valid allowlist is a verified good state.
  if (
    inputs.trustedProxyConfigured &&
    inputs.trustedProxyValidRangeCount > 0 &&
    !inputs.trustedProxyOverlyBroad &&
    inputs.trustedProxyInvalidEntries.length === 0
  ) {
    assurances.push({
      id: 'proxy_trust',
      label: 'Trusted proxy allowlist',
      verified: true,
      note: 'TRUSTED_PROXY names an explicit proxy allowlist; forwarded client IPs are trusted only from those peers, and a spoofed X-Forwarded-For from any other peer is ignored.',
    });
  }

  return assurances;
}
```

`buildAdvisories` — append the single mutually-exclusive proxy-trust advisory (rows 3/4/5):

```ts
/**
 * Rows 3/4/5 of the proxy-trust states table (§6.2), resolved in precedence order. Rows 1 (scored)
 * and 2 (assurance) are handled elsewhere, so this returns `null` for them and for the inert row 6.
 * At most one advisory ever fires per report.
 */
function buildProxyTrustAdvisory(inputs: PostureInputs): Advisory | null {
  const configured = inputs.trustedProxyConfigured;
  const spoofableContext =
    inputs.authMode === 'local' && !isLoopbackBindHost(inputs.bindHost);
  const overlyBroad = inputs.trustedProxyOverlyBroad;
  const invalid = inputs.trustedProxyInvalidEntries;

  // Row 1 (scored) and row 2 (assurance) — not advisories.
  if (configured && overlyBroad && spoofableContext) return null;
  if (
    configured &&
    inputs.trustedProxyValidRangeCount > 0 &&
    !overlyBroad &&
    invalid.length === 0
  )
    return null;

  // Row 3 — overly-broad, but not a live bypass in this mode.
  if (configured && overlyBroad && !spoofableContext) {
    return {
      id: 'proxy_trust_overly_broad',
      label: 'TRUSTED_PROXY trusts every peer',
      detail: [
        'TRUSTED_PROXY trusts every peer (`*`, `/0`, or a supernet ≤ /7); forwarded IPs used for logging and rate-limiting are spoofable.',
        "This is not an auth bypass in the current mode — narrow it to the proxy's exact address. This is informational, not scored.",
      ],
      fix: {
        kind: 'env-var',
        name: 'TRUSTED_PROXY',
        label: "Narrow TRUSTED_PROXY to the proxy's address",
      },
    };
  }

  // Row 4 — some tokens were dropped as invalid.
  if (configured && invalid.length > 0) {
    return {
      id: 'proxy_trust_invalid',
      label: 'TRUSTED_PROXY has ignored tokens',
      detail: [
        `${invalid.length} TRUSTED_PROXY token(s) were ignored: ${invalid.join(', ')}.`,
        'The peers they named are NOT trusted, so a legitimately-proxied AUTH=local deployment will stop bypassing auth for real local users until the value is fixed.',
      ],
      fix: {
        kind: 'env-var',
        name: 'TRUSTED_PROXY',
        label: 'Fix the ignored TRUSTED_PROXY token(s)',
      },
    };
  }

  // Row 5 — missing under a spoofable context (Praxrr cannot tell proxy-fronted from direct/LAN).
  if (!configured && spoofableContext) {
    return {
      id: 'proxy_trust_missing',
      label: 'TRUSTED_PROXY is not set',
      detail: [
        'If a reverse proxy fronts Praxrr under AUTH=local, set TRUSTED_PROXY to its address so real client IPs are honored.',
        'If this is a direct / LAN deployment, no action is needed here. To remove the local-address bypass entirely, set AUTH=on or bind to loopback (HOST=127.0.0.1).',
        'This is informational, not scored — Praxrr cannot observe whether a proxy is in front of it.',
      ],
      fix: {
        kind: 'env-var',
        name: 'TRUSTED_PROXY',
        docHref: 'https://github.com/yandy-r/praxrr',
        label: 'Set TRUSTED_PROXY to your reverse proxy address',
      },
    };
  }

  // Row 6 — inert (unset & not spoofable, or already covered by rows 1/2).
  return null;
}

/** Real posture notes whose exploitability Praxrr cannot observe, so they inform without a score. */
function buildAdvisories(inputs: PostureInputs): Advisory[] {
  const advisories: Advisory[] = [];
  if (!inputs.sessionCookieSecure) {
    advisories.push({
      id: 'session_cookie_secure',
      label: 'Session cookie is not marked Secure',
      detail: [
        'Praxrr sets its session cookie without the Secure flag, so if Praxrr is ever reached over plain http the session cookie can be captured on the wire.',
        'Serve Praxrr behind an HTTPS reverse proxy. This is informational, not scored — Praxrr cannot observe the scheme it is actually served over.',
      ],
      fix: {
        kind: 'docs',
        href: 'https://github.com/yandy-r/praxrr',
        label: 'Serve Praxrr behind HTTPS',
      },
    });
  }

  const proxyTrustAdvisory = buildProxyTrustAdvisory(inputs);
  if (proxyTrustAdvisory) advisories.push(proxyTrustAdvisory);

  return advisories;
}
```

---

## 4. Supporting edits (needed for §2/§3 to compile)

`types.ts` — union member, `CHECK_IDS`, engine-version bump, and the 4 `PostureInputs` fields:

```ts
export const SECURITY_POSTURE_ENGINE_VERSION = '2'; // was '1' — the check set grew by proxy_trust

export type SecurityCheckId =
  | 'control_plane_auth'
  | 'arr_transport'
  | 'app_key_at_rest'
  | 'credential_rotation'
  | 'log_redaction'
  | 'proxy_trust';

export const CHECK_IDS: readonly SecurityCheckId[] = [
  'control_plane_auth',
  'arr_transport',
  'app_key_at_rest',
  'credential_rotation',
  'log_redaction',
  'proxy_trust',
] as const;

// …inside PostureInputs (after sessionCookieSecure), before nowIso:
  /** `cfg.mode !== 'unset'` — an operator supplied a non-empty TRUSTED_PROXY value. */
  readonly trustedProxyConfigured: boolean;
  /** `cfg.ranges.length` — number of valid CIDR ranges parsed. */
  readonly trustedProxyValidRangeCount: number;
  /** `cfg.invalidEntries` — raw ignored tokens (safe to echo; not secrets). */
  readonly trustedProxyInvalidEntries: readonly string[];
  /** `cfg.overlyBroad` — wildcard OR any range with prefix ≤ /7. */
  readonly trustedProxyOverlyBroad: boolean;
```

`catalog.ts` — `CHECK_CATALOG` entry appended in matching order:

```ts
  {
    id: 'proxy_trust',
    label: 'Trusted proxy allowlist',
    description:
      'Whether forwarded client IPs (X-Forwarded-For) are trusted only from an explicit TRUSTED_PROXY allowlist, so a spoofed header from an untrusted peer cannot drive an AUTH=local bypass.',
  },
```

`gather.ts` — populate the 4 fields from the already-parsed `config.trustedProxy` (degrade-never-throw; no re-parse):

```ts
  const tp = config.trustedProxy;
  // …inside the returned PostureInputs literal:
    trustedProxyConfigured: tp.mode !== 'unset',
    trustedProxyValidRangeCount: tp.ranges.length,
    trustedProxyInvalidEntries: tp.invalidEntries,
    trustedProxyOverlyBroad: tp.overlyBroad,
```

`config.ts` — field + parse helper (imports the pure parser; `config.ts` imports nothing today, so no cycle):

```ts
import { parseTrustedProxy, type TrustedProxyConfig } from '$shared/security/index.ts';

// …class field:
  public readonly trustedProxy: TrustedProxyConfig; // never null; unset => { mode: 'unset', … }

// …in the constructor:
  this.trustedProxy = Config.parseTrustedProxyEnv();

// …static helper:
  private static parseTrustedProxyEnv(): TrustedProxyConfig {
    return parseTrustedProxy(Deno.env.get('TRUSTED_PROXY') ?? null);
  }
```

Existing `PostureInputs` builders in tests extend with the 4 defaults
(`trustedProxyConfigured: false, trustedProxyValidRangeCount: 0, trustedProxyInvalidEntries: [], trustedProxyOverlyBroad: false`).

```

```
