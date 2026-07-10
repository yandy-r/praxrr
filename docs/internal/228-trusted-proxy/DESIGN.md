# Design: Explicit `TRUSTED_PROXY` trust contract + Shield Check surfacing (issue #228)

Status: proposed (revised after security / correctness / scope-and-compat review)
Issue: [#228](https://github.com/yandy-r/praxrr/issues/228) — Security Posture | Proxy trust | Add `TRUSTED_PROXY` assertion
Author: engineering
Scope: app-level auth / proxy trust only. No cross-Arr semantics (this is not an Arr-touching change).

---

## 1. Problem & threat model

### 1.1 The bug (verified)

`getClientIp()` in `packages/praxrr-app/src/lib/server/utils/auth/network.ts` (lines 111–136) walks a
fixed list of forwarded-IP headers (`x-forwarded-for`, `x-real-ip`, `x-client-ip`, `cf-connecting-ip`,
`fastly-client-ip`, `true-client-ip`, `x-cluster-client-ip`) and returns the **first token from
whatever peer sent the request**, with **zero validation of the direct TCP peer**. For
`x-forwarded-for` specifically it returns `value.split(',')[0].trim()` — the **leftmost**,
fully-client-controlled token (network.ts:119). Only if no such header exists does it fall back to
SvelteKit's `event.getClientAddress()` (the real socket peer), and if that throws / returns `unknown`
it defaults to `'127.0.0.1'` (network.ts:135).

`getAuthState()` in `middleware.ts:63` (the `AUTH=local` branch) feeds that value into
`isLocalAddress()` and, when it looks local, returns `skipAuth: true` — **no session, no API key
required**.

**Exploit:** a remote attacker sends any request to a Praxrr instance running `AUTH=local` with the
header `X-Forwarded-For: 127.0.0.1`. `getClientIp()` returns `127.0.0.1`, `isLocalAddress()` returns
`true`, `skipAuth` is `true`, and the attacker has full unauthenticated control of every connected Arr.
The header is entirely attacker-controlled — no proxy is required. `test-connection/+server.ts:29–31`
already carries an in-code acknowledgement of this ("`getClientIp` trusts proxy headers … and is
spoofable without a trusted-proxy allowlist").

### 1.2 Attacker & trust model

- **Attacker:** any party who can open a TCP connection to Praxrr's HTTP port (directly, via
  port-forward, or through a proxy that does not strip client headers). They fully control every
  request header, including all `X-Forwarded-*` / `X-Real-IP` variants **and any client-supplied
  leftmost `X-Forwarded-For` token that a trusted proxy then appends to.**
- **Trust question that actually matters:** _is the direct TCP peer_ (`event.getClientAddress()`) _a
  reverse proxy I explicitly approved?_ Only then may Praxrr believe the forwarded headers that proxy
  appended — and even then it must consume **the hop the proxy itself appended**, not the token the
  original client injected. Forwarded headers from an unapproved peer are attacker-controlled noise
  and must be ignored for every security decision.
- **What "trusted proxy" fixes:** it makes header trust _conditional on the socket peer_ **and**
  consumes the proxy-appended hop rather than the client-chosen leftmost token. A direct (no-proxy)
  deployment sends no forwarded headers, so it is unaffected. A proxied deployment declares its
  proxy's address; only the client IP _that proxy observed_ is honored. Everyone else is graded by
  their real socket peer, closing the `AUTH=local` bypass.

### 1.3 Non-goals

- Not a replacement for network-level controls (firewalls, rate limiting).
- No hop-count / multi-proxy-chain walking (single-proxy topology; see §2.6). For a single trusted
  proxy the correct client IP is the **rightmost** `X-Forwarded-For` token (the address that proxy
  observed as its peer); §4.1 formalizes this.
- No change to `AUTH=off` (that mode trusts an external authenticating proxy by design) or to CSRF
  trusted-origins (a separate concern — see §10).
- Forwarded-**host** / -**proto** trust for WebAuthn is deferred with explicit rationale (§5); the
  deferral is recorded on the issue, not silently narrowed.

---

## 2. The `TRUSTED_PROXY` contract

### 2.1 Env var

One variable: **`TRUSTED_PROXY`**. No companion (`TRUSTED_PROXY_HOPS` etc.). Praxrr's model is binary
per request — "is the direct peer approved?" — so a hop count adds config surface without security
value for the supported single-proxy topology.

- **Unset or empty (`TRUSTED_PROXY=""`)** → feature disabled, **trust nobody**. This is the secure
  default and preserves unchanged behavior for direct deployments (they send no forwarded headers).
  Empty-string is an explicit opt-out, mirroring the `PRAXRR_DEFAULT_DB_URL=""` convention.

Because Praxrr **cannot observe whether a reverse proxy is actually in front of it**, unset is never
treated as a _scored_ misconfiguration (§6). It is the correct value for a direct deployment and a
required value for a proxied one; Shield surfaces the ambiguity as an unscored advisory, never as a
failing grade.

### 2.2 Value grammar

Comma- and/or whitespace-separated tokens; each token is trimmed and lower-cased before parsing.

```
TRUSTED_PROXY   := WS? token (SEP token)* WS?
SEP             := (',' | WS)+
token           := ipv4 | ipv6 | ipv4-cidr | ipv6-cidr | keyword | wildcard
ipv4            := dotted-quad                      ; implicit /32
ipv6            := rfc4291-address                  ; implicit /128 ; zone-id "%..." rejected
ipv4-cidr       := ipv4 '/' 0..32
ipv6-cidr       := ipv6 '/' 0..128
keyword         := 'loopback' | 'private'          ; case-insensitive, expand to canonical CIDR sets
wildcard        := '*' | 'all'                      ; explicit "trust every peer" opt-in (overly broad)
```

- **Empty tokens are skipped, never coerced.** `SEP` is `(',' | WS)+`, so runs of separators
  (`10.0.0.0/8,, *`, a lone `,`, trailing/leading commas, tabs, newlines) collapse and produce **no**
  token — an empty string between separators can never be trimmed/case-folded into `all`, `*`, or any
  range. A lone-separator value yields zero tokens (behaves like unset). Pinned by Test A.
- IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is normalized to its IPv4 form before matching (mirrors the
  existing `::ffff:` handling in `isLocalAddress`).
- `loopback` expands to `127.0.0.0/8`, `::1/128`.
- `private` expands to `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7`,
  `fe80::/10`. These canonical CIDR sets are defined **once** in the new shared module (§3).
- IPv6 zone ids (`fe80::1%eth0`) are **rejected** (recorded as invalid) — a zone id is not meaningful
  for a remote socket-peer comparison.

### 2.3 Parse + validate semantics (fail-closed, non-throwing)

Parsing produces a structured, **non-throwing** result. Per-token failure is fail-closed by
construction: **a malformed or empty token can only ever remove trust, never add it.**

- Each token is validated independently. Valid tokens become `CidrRange`s. Any malformed token (octet
  > 255, prefix > 32/128, non-numeric prefix, malformed IPv6, zone id) is pushed to `invalidEntries`
  > and **dropped** — it grants trust to nobody.
- A wholly-invalid value yields an empty range set, which behaves **exactly like unset**: no peer is
  trusted, forwarded headers are ignored, and the `AUTH=local` bypass is denied. This is the safe
  direction.
- `*` / `all` sets `wildcard = true` and `overlyBroad = true` (trust every peer — legacy behavior,
  explicitly opted into and loudly flagged by Shield).
- **`overlyBroad`** (see §3.2 for the exact rule) is set when the config is a wildcard **or** contains
  a range whose prefix is at or below the supernet threshold (**IPv4 ≤ /7, IPv6 ≤ /7**). This catches
  `0.0.0.0/0`, the split-`/1` internet trick (`0.0.0.0/1` + `128.0.0.0/1`), `::/0`, and the `private`
  keyword (via its `fc00::/7` member), while sparing legitimate operator supernets like `10.0.0.0/8`
  or `172.16.0.0/12`. `loopback` is **not** overly broad.

**Why non-throwing (deliberate departure from `parsePositiveIntEnv`, which throws):** the issue mandates
_both_ "fail closed on malformed" _and_ "Shield reports invalid config with an actionable fix". Throwing
at `Config` construction aborts `config.init()` → boot, so the Shield page could never render the fix,
and a typo in a hardening variable would brick a running deployment. "Fail closed" here means **deny
trust**, not **crash the process**. The invalid tokens are preserved (`invalidEntries`) precisely so the
Shield surfacing can name them.

### 2.4 Parsed `Config` surface

```ts
// config.ts
public readonly trustedProxy: TrustedProxyConfig;   // never null; unset => { mode: 'unset', ... }
```

Parsed once in the constructor via a private static helper that reads the env var and delegates to the
pure parser:

```ts
private static parseTrustedProxyEnv(): TrustedProxyConfig {
  return parseTrustedProxy(Deno.env.get('TRUSTED_PROXY') ?? null);
}
```

Both consumers read the same object: the request path calls `isTrustedProxyPeer()` (§4); the gatherer
reads `mode` / `overlyBroad` / `invalidEntries` / range count (§6). `raw` is carried for display.

`config.ts` today imports nothing (verified — it reads only `Deno.env`), so adding `trustedProxy` and
importing the pure `$shared/security` parser introduces **no circular dependency** (the shared module
imports neither `config` nor `network`).

### 2.5 Example values

| `TRUSTED_PROXY` value     | Parsed result                                                       | Effect                                                              |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| _(unset)_ / `""`          | `mode: 'unset'`, 0 ranges                                           | Disabled. Forwarded headers ignored. Direct deploys unchanged.      |
| `172.18.0.2`              | `mode: 'explicit'`, `172.18.0.2/32`                                 | Trust exactly the one docker-network proxy IP.                      |
| `10.0.0.0/8, ::1`         | `mode: 'explicit'`, two ranges, `overlyBroad: false`                | Trust a private supernet + IPv6 loopback proxy.                     |
| `loopback`                | `mode: 'explicit'`, `127.0.0.0/8` + `::1/128`, `overlyBroad: false` | Trust only a same-host reverse proxy.                               |
| `private`                 | `mode: 'explicit'`, RFC1918 + ULA + link-local, `overlyBroad: true` | Trust any private-network peer — broad, flagged.                    |
| `10.0.0.0/8, 999.0.0.0/8` | `mode: 'explicit'`, one range, `invalidEntries: ['999.0.0.0/8']`    | Valid part trusted; junk dropped + surfaced by Shield.              |
| `0.0.0.0/1, 128.0.0.0/1`  | `mode: 'explicit'`, two ranges, `overlyBroad: true`                 | Whole-internet split trick — caught by the ≤ /7 rule.               |
| `*`                       | `mode: 'wildcard'`, `overlyBroad: true`                             | Legacy "trust everyone" — restores the spoofable behavior, flagged. |

### 2.6 Rejected alternatives

- **Hop count** — rejected (§2.1): unnecessary for the supported topology, easy to misconfigure.
- **Throw on malformed** — rejected (§2.3): breaks boot + hides the misconfiguration from the surface
  asked to report it.
- **Trust from header presence** — explicitly forbidden by the issue and by this design: trust is
  keyed on the _direct socket peer_, never on the existence of an `X-Forwarded-*` header.
- **Honor the leftmost `X-Forwarded-For` token on the trusted path** — rejected (§4.1): every proxy
  this design documents (nginx `$proxy_add_x_forwarded_for`, Traefik, Caddy) _appends_, so the
  leftmost token is still attacker-chosen and would re-open the bypass.
- **`/0`-only as the overly-broad rule** — rejected (§2.3): missed the split-`/1` internet trick and
  the `private` keyword. Replaced by the prefix-threshold rule.

---

## 3. Shared trusted-proxy module

### 3.1 Location & purity

New pure module: **`packages/praxrr-app/src/lib/shared/security/trustedProxy.ts`**, colocated with
`classifyHost` in `$shared/security` and re-exported from `packages/praxrr-app/src/lib/shared/security/index.ts`.

Constraints: **no `Deno.env`, no I/O, no server-only imports** (config/logger/db). This keeps it
client+server safe (preserving the `$shared` boundary that `index.ts` guarantees), unit-testable
without a DB, and importable by both `config.ts` (server) and `gather.ts` (server).

### 3.2 Public API

```ts
export type TrustedProxyMode = 'unset' | 'explicit' | 'wildcard';

export interface CidrRange {
  readonly family: 4 | 6;
  readonly base: bigint; // network address, masked to `prefix` bits
  readonly prefix: number; // 0..32 (v4) or 0..128 (v6)
  readonly raw: string; // original token, for display/detail
}

export interface TrustedProxyConfig {
  readonly raw: string | null; // original env string (display only)
  readonly mode: TrustedProxyMode;
  readonly ranges: readonly CidrRange[]; // empty when mode === 'unset'
  readonly invalidEntries: readonly string[];
  readonly wildcard: boolean; // '*' / 'all'
  readonly overlyBroad: boolean; // wildcard OR any range with prefix <= threshold
}

/** Parse a raw TRUSTED_PROXY value. Never throws. Malformed/empty tokens are dropped into invalidEntries. */
export function parseTrustedProxy(
  raw: string | null | undefined
): TrustedProxyConfig;

/** True iff the direct socket peer is an approved proxy. false for mode 'unset'; true for 'wildcard'. */
export function isTrustedProxyPeer(
  peerIp: string,
  cfg: TrustedProxyConfig
): boolean;
```

**`overlyBroad` rule (single source of truth):** `wildcard === true` OR any resulting `CidrRange` has
`prefix <= OVERLY_BROAD_PREFIX[family]`, where `OVERLY_BROAD_PREFIX = { 4: 7, 6: 7 }`. Rationale:
prefixes at or above `/8` include the legitimate RFC1918 supernets an operator may reasonably use for
a docker/LAN proxy pool; below `/8` you are trusting multiple `/8`s ≈ the whole internet. The `/1`
internet-split trick and the `private` keyword's `fc00::/7` member both trip it; `loopback`
(`127.0.0.0/8`, `::1/128`) and explicit `10.0.0.0/8` do not.

`isTrustedProxyPeer`:

- `mode === 'unset'` → `false` (trust nobody).
- `mode === 'wildcard'` → `true`.
- otherwise: normalize `peerIp` (strip `::ffff:` → v4, strip brackets), convert to a 32-bit (v4) or
  128-bit (v6) integer, and test bitwise containment against every `CidrRange` of the matching family.
  An unparseable peer → `false` (fail closed).

### 3.3 Relationship to existing IP logic (no duplication, drift-guarded)

- `isLocalAddress` / `isLocalIPv4` / `isLocalIPv6` (`network.ts`) and `classifyHost` / `classifyIpv4`
  (`checks.ts`) are **prefix heuristics** (`a === 10`, `startsWith('fe80')`). They classify _fixed
  RFC1918/loopback ranges_; they cannot test an **arbitrary user-supplied CIDR** (e.g. `172.18.0.0/16`).
  So they are not reusable for `TRUSTED_PROXY` matching — the new module must own real bitwise CIDR
  arithmetic (u32 for v4, `bigint` for v6).
- To avoid a _third_ copy of the RFC1918/loopback constants, the `loopback` / `private` keyword
  expansions in this module are the **single authoritative CIDR encoding**. The heuristic classifiers
  in `network.ts` / `checks.ts` are left untouched in this issue (scope discipline), with a code
  comment noting the future consolidation opportunity.
- **Drift guard (new test, §8.1 A):** a cross-check test asserts the module's `private` / `loopback`
  keyword expansions stay in lockstep with `isLocalAddress`. For a fixed sample of RFC1918/loopback
  addresses (`10.0.0.5`, `172.20.1.1`, `192.168.1.1`, `169.254.0.1`, `127.0.0.1`, `::1`, `fe80::1`,
  `fc00::1`), `isTrustedProxyPeer(ip, parseTrustedProxy('private loopback'))` MUST equal
  `isLocalAddress(ip)`. This catches future divergence between the trust allowlist and the
  local-bypass classifier that the scope decision to leave the duplicate constants in place would
  otherwise let rot silently.
- The module reuses the `::ffff:` IPv4-mapped normalization idea from `isLocalAddress` (not the code —
  it is a two-line normalization inlined where the integer conversion happens).

---

## 4. Request-path enforcement

### 4.1 Gated `getClientIp` (trusted-hop-aware, fail-closed)

`getClientIp` becomes conditional on the direct peer **and** consumes the proxy-appended hop rather
than the client-chosen leftmost token. Signature:

```ts
export function getClientIp(
  event: { getClientAddress: () => string; request: Request },
  trustedProxy: TrustedProxyConfig = config.trustedProxy
): string;
```

The default param `config.trustedProxy` is evaluated **per call** (JS evaluates default params at
invocation time, not module load), and `config.init()` runs in `hooks.server.ts` before the first
request, so the singleton is always initialized on the request path. Unit tests inject an explicit
`TrustedProxyConfig`.

New behavior:

1. **Resolve the direct peer** via `event.getClientAddress()`. If it throws, or returns falsy /
   `'unknown'`, return the fail-closed sentinel **`'unknown'`** immediately (see step 4). _Never_
   default an unresolvable peer to `'127.0.0.1'`.
2. **If `isTrustedProxyPeer(directPeer, trustedProxy)` is `false`** → ignore **all** forwarded headers
   and return `directPeer` (the real socket peer). This is the security fix: a forged
   `X-Forwarded-For: 127.0.0.1` from an untrusted peer no longer produces `skipAuth`.
3. **If the direct peer is trusted** → read the forwarded headers, but derive the client IP from the
   **hop the trusted proxy appended**:
   - For `x-forwarded-for` (append-semantics — nginx `$proxy_add_x_forwarded_for`, Traefik, Caddy all
     _append_ the observed client), take the **rightmost** non-empty token: the address the trusted
     proxy itself observed as its peer. `X-Forwarded-For: 127.0.0.1, 203.0.113.9` → `203.0.113.9`, not
     `127.0.0.1`. (Single-proxy topology; a right-to-left walk skipping trusted entries generalizes to
     chains — noted as a future refinement, not needed here.)
   - For the single-value replace-semantics headers (`x-real-ip`, `cf-connecting-ip`,
     `true-client-ip`, `fastly-client-ip`, `x-client-ip`, `x-cluster-client-ip`), the trusted proxy
     overwrites them, so the value is taken as-is (if it somehow carries a comma, the rightmost token
     is taken for safety). `x-forwarded-for` is checked first in `IP_HEADERS`, so for the mainstream
     nginx/Traefik/Caddy single-proxy deployment the append-aware XFF path is authoritative.
4. **Fail-closed sentinel.** When the direct peer is unresolvable (step 1), return `'unknown'`.
   `isLocalAddress('unknown')` is **`false`** (verified against network.ts:73–89: not `::1`, not
   `fe80`/`fc`/`fd`/`fec`), so an unresolvable peer **denies** the `AUTH=local` bypass instead of
   granting it — the opposite of today's `'127.0.0.1'` default, whose whole failure mode was granting
   the bypass.

`network.ts` gains `import { config } from '$config'` and
`import { isTrustedProxyPeer, type TrustedProxyConfig } from '$shared/security/index.ts'`. The default
param keeps callers unchanged and lets unit tests inject an explicit config.

### 4.2 Per-call-site handling — inventory is authoritative

`getClientIp` has **13 invocations across 9 files** (verified with
`grep -rn 'getClientIp(' packages/praxrr-app/src` minus the `network.ts` definition/export). The trust
gate is correct for _all_ of them — a forwarded IP from an untrusted peer is attacker-controlled and
worthless for logging, rate-limiting, or auth alike — so **no call site changes its call** (they
inherit the default-param behavior). No security decision reads `event.getClientAddress()` directly
outside `getClientIp` (verified — the only other reference is a test stub in
`tests/routes/setupWizard.test.ts`), so gating `getClientIp` is a complete choke point. The
implementation checklist re-runs the grep to keep this table authoritative.

| File:line(s)                                                       | Use of the IP                                   | Effect of the gate                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `auth/middleware.ts:63`                                            | `AUTH=local` bypass decision (`isLocalAddress`) | **Security fix.** Untrusted peer → real peer IP → no spoofed local bypass.                             |
| `auth/middleware.ts:97`                                            | `AUTH=on` API-key audit log                     | Log now shows the real peer for untrusted senders (more accurate).                                     |
| `hooks.server.ts:243`                                              | Request audit log                               | Same — accurate peer.                                                                                  |
| `routes/auth/login/+page.server.ts:45,59,70`                       | Login rate-limit + audit                        | Rate-limit key is now the real peer; attacker can't rotate it via spoofed XFF. Improvement.            |
| `routes/auth/setup/+page.server.ts:66`                             | Setup audit log                                 | Accurate peer.                                                                                         |
| `routes/auth/oidc/login/+server.ts:16`                             | OIDC audit log                                  | Accurate peer.                                                                                         |
| `routes/auth/oidc/callback/+server.ts:35,58,94`                    | OIDC callback audit                             | Accurate peer.                                                                                         |
| `routes/api/v1/auth/webauthn/authentication/verify/+server.ts:117` | WebAuthn audit log                              | Accurate peer.                                                                                         |
| `routes/api/v1/setup/test-connection/+server.ts:32`                | Setup rate-limit                                | Rate-limit key is now the real peer; remove the stale spoofability comment (the allowlist now exists). |

Note: sites that proxied deployments legitimately rely on for the _real client_ IP behind a proxy keep
working — once `TRUSTED_PROXY` names the proxy, the proxy-appended hop is honored again for exactly
those peers.

### 4.3 Backward-compat behavior change (explicit)

- **Direct deployments (no proxy):** unchanged. No forwarded headers are sent, so gated and ungated
  `getClientIp` return the same socket peer. `TRUSTED_PROXY` unset is the intended state.
- **Proxied `AUTH=local` deployments (security-relevant break):** **behavior changes.** Today an unset
  `TRUSTED_PROXY` still honors `X-Forwarded-For`, so the proxy's forwarded client IP drives the local
  bypass. After this change, unset → no proxy trusted → forwarded headers ignored → those requests are
  graded by the proxy's socket IP and **must authenticate** unless the operator sets `TRUSTED_PROXY`
  to the proxy's IP/CIDR. This is the security fix (a proxied deployment is not a "direct" deployment)
  and is **effectively breaking for that one config** — called out in release notes and docs (§10).
- **Proxied `AUTH=on` deployments (availability / observability change):** even though `AUTH=on` never
  used `getClientIp` for an auth _bypass_, an `AUTH=on` deployment behind a proxy that leaves
  `TRUSTED_PROXY` unset now sees every request's client IP collapse to the **single proxy socket IP**.
  Consequences: the login rate-limit (`routes/auth/login`) and API-key audit log bucket all real users
  under one IP — one abuser can rate-limit-lock everyone, and audit logs lose the real client. This is
  not a security regression (it fails toward _more_ limiting, not less), but proxied `AUTH=on`
  deployments **should also set `TRUSTED_PROXY`** to restore per-client rate-limiting and accurate
  audit. Documented in §10.
- **`*` / `all`** restores the legacy trust-everything behavior explicitly and is flagged by Shield as
  overly broad.

### 4.4 Adapter caveat (known assumption)

The whole gate is circular if `event.getClientAddress()` returns an XFF-derived value instead of the
real socket peer. `svelte.config.js` uses `sveltekit-adapter-deno` with **no** address/XFF override
today, so `getClientAddress()` is the real peer. This is enforced by convention, not a runtime guard:
add a one-line comment in `network.ts` warning that enabling any such adapter option (or a
PROXY-protocol front end that rewrites the peer) would silently defeat `TRUSTED_PROXY`. Tracked as a
known assumption; no code guard now.

---

## 5. WebAuthn / forwarded-host & forwarded-proto decision

**Decision: leave WebAuthn's forwarded-host / forwarded-proto handling as-is in this issue; do not gate
it here. Record the deferral on issue #228 so the acceptance criteria are not silently narrowed.**

Issue #228 names `X-Forwarded-Host` / `X-Forwarded-Proto` in its header list, and they _are_ consumed
at `lib/server/webauthn/rp.ts:54,71,95,97` (`forwardedHost ?? host ?? urlHost` for RP-id;
`forwardedProto ?? urlProtocol` for origin), via `firstForwardedValue` (leftmost token). Rationale for
deferring:

- That path is reachable only under `AUTH=on`, where a forged host cannot _grant_ access — a
  mismatched RP-id / origin makes the passkey ceremony **fail** (fail-closed), it does not bypass
  anything the way the `AUTH=local` `getClientIp` path does.
- Operators already have explicit, non-spoofable overrides (`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`) for
  reverse-proxy setups — the correct hardening surface for host trust, orthogonal to peer trust.
- Folding forwarded-_host_ trust into `TRUSTED_PROXY` (a forwarded-_peer_ contract) in the same change
  would widen scope past issue #228 and conflate two different trust axes.

**Action (required, not optional):** post a comment on issue #228 recording that #228 ships the
forwarded-**peer** (`getClientIp`) gate now and defers forwarded-**host** / **-proto** trust to a
follow-up, with the fail-closed rationale above, so the AC header list is explicitly (not silently)
scoped. Also noted in ROADMAP (§10). A future issue can make `rp.ts` consult the same parser before
trusting `X-Forwarded-Host` for RP-id derivation.

---

## 6. Shield Check surfacing

### 6.1 Vehicle: one scored check `proxy_trust` (scored ONLY when trust is configured) + advisories

The design uses **two** Shield vehicles, matched to what Praxrr can actually observe:

- A **scored check** `proxy_trust` that carries weight in exactly **one** state — an operator who
  explicitly opened a live bypass (`overlyBroad` trust under `AUTH=local` on a non-loopback bind). This
  is the only state that is both _operator-caused_ and _observably a live auth-decision risk_, so it is
  the only one that earns a score / `critical` / `bandCapWhenAction`. It mirrors the `log_redaction`
  idiom: **weight is applied only when the check reports a real, live finding**; in every other state
  it scores `null` (excluded from the rollup, no denominator shift). The active-and-valid good state
  additionally emits a positive **assurance**.
- **Advisories** (unscored, `Advisory` — the vehicle whose contract is literally "a real-but-unscored
  posture note whose exploitability Praxrr cannot observe", precedent: `session_cookie_secure`) for the
  states Praxrr _cannot_ grade because it cannot see whether a proxy is present, or that are not auth
  bypasses in the current mode: **missing under a spoofable context**, **invalid tokens**, and
  **overly-broad without a spoofable context**. Each advisory carries a concrete `fix`, satisfying AC#4
  ("reports missing / invalid / overly-broad … with an actionable fix") **without** a false failing
  grade.

**Why not a scored critical for "missing"?** (Resolves the security/correctness/scope must-fix.) With
the §4 gate in place, an unset `TRUSTED_PROXY` means forwarded headers are **ignored** — a genuinely
direct `AUTH=local` deployment has **no live XFF bypass** left. The residual "`AUTH=local` trusts
local/LAN socket peers" is already scored by `control_plane_auth` (`local` → 60 / attention /
`critical: false`, checks.ts:274–294); a second scored critical for the same fact would **double-count**
it and escalate the default `AUTH=local` + `0.0.0.0` deployment from `guarded` to `exposed` for leaving
a hardening var at its own recommended value — and point the fix at `TRUSTED_PROXY`, which does nothing
for a no-proxy deployment and contradicts §2.1 / §4.3. Praxrr cannot observe whether a proxy is in
front, so it cannot know unset is "wrong"; an unscored, even-handed advisory is the only honest
vehicle.

**Numeric-invariance consequence (compat win):** because `proxy_trust` scores `null` whenever trust is
unset (and in every non-`overlyBroad` state), **`AUTH=on` deployments are always numerically unchanged**
(they never reach the one weighted state, which requires `AUTH=local`), and the **default `AUTH=local`
deployments are also numerically unchanged** (unset → `null` → contributes 0, no band cap). The engine
version still bumps (§6.5) because the _check set_ grew, but no existing scored config shifts — so the
pinned band-threshold / recoverablePoints / contributions-sum tests need **no isolation churn** (a
correction to the prior draft; see §8.1 D).

Weight constant: `PROXY_TRUST_FAIL_WEIGHT = 25` (parallels `LOG_REDACTION_FAIL_WEIGHT`), applied
**only** in the single live-bypass state. Weight parity with `log_redaction`'s fail state is justified
because both are live-bypass-class findings; the attention/informational states carry **no** weight
(they are advisories), which resolves the weight-calibration inconsistency the reviewers flagged
(invalid/overly-broad-but-not-live no longer drag a 25 weight heavier than `app_key_at_rest`).

### 6.2 States → vehicle & grading

Let `spoofableContext = authMode === 'local' && !isLoopbackBindHost(bindHost)` (the only context where
`getClientIp` drives an auth decision reachable from a non-loopback interface). `configured = mode !==
'unset'`. Precedence top-down; the first matching row wins.

| #   | State                               | Condition                                                                                           | Vehicle                  | score / status / weight | critical / cap     |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------- | ------------------ |
| 1   | **Overly-broad live bypass**        | `configured && overlyBroad && spoofableContext`                                                     | scored check             | `0` / `action` / 25     | `true` / `exposed` |
| 2   | **Active & valid**                  | `configured && ranges > 0 && !overlyBroad && invalidEntries empty`                                  | scored check + assurance | `null` / `assured` / 0  | `false` / —        |
| 3   | **Overly-broad, not a live bypass** | `configured && overlyBroad && !spoofableContext`                                                    | advisory                 | _(unscored)_            | —                  |
| 4   | **Invalid tokens**                  | `configured && invalidEntries.length > 0` (and not row 1)                                           | advisory                 | _(unscored)_            | —                  |
| 5   | **Missing under spoofable context** | `!configured && spoofableContext`                                                                   | advisory                 | _(unscored)_            | —                  |
| 6   | **Inert**                           | everything else (unset & not spoofable; or a fully-valid non-broad config already covered by row 2) | scored check             | `null` / `na` / 0       | `false` / —        |

The scored check therefore emits a real finding only in row 1, an assurance-linked `null` in row 2, and
an inert `null` (`na`) otherwise. Rows 3–5 are emitted by `buildAdvisories` (§6.4). A `configured`
value can trigger **both** a scored `na` from the check **and** an advisory (e.g. an invalid config
under `AUTH=on`: check is `na`, advisory row 4 fires) — the two vehicles are independent, exactly like
`session_cookie_secure` (advisory) coexisting with the scored checks.

Detail / fix copy requirements:

- **Row 1 (overly-broad live bypass):** detail names both hazards — it re-enables spoofable trust and,
  under `AUTH=local`, reopens the `X-Forwarded-For` bypass. Fix: `env-var TRUSTED_PROXY` (narrow it to
  the proxy's exact address); detail also mentions `AUTH=on` as the alternative.
- **Row 3 (overly-broad, not live):** advisory copy — "`TRUSTED_PROXY` trusts every peer (`*`, `/0`,
  or a supernet ≤ /7); forwarded IPs used for logging / rate-limiting are spoofable. Not an auth
  bypass in this mode — narrow it to the proxy's address." Fix: `env-var TRUSTED_PROXY`.
- **Row 4 (invalid):** advisory copy — "N `TRUSTED_PROXY` token(s) were ignored: `[…]`. The peers they
  named are **not** trusted, so a legitimately-proxied `AUTH=local` deployment will stop bypassing auth
  for real local users until the value is fixed." Fix: `env-var TRUSTED_PROXY`. (Raw ignored tokens are
  safe to echo — they are not secrets.)
- **Row 5 (missing under spoofable context):** advisory copy must distinguish the two cases Praxrr
  cannot tell apart — "If a reverse proxy fronts Praxrr under `AUTH=local`, set `TRUSTED_PROXY` to its
  address so real client IPs are honored. If this is a direct / LAN deployment, no action is needed
  here. To remove the local-address bypass entirely, set `AUTH=on` or bind to loopback
  (`HOST=127.0.0.1`). This is informational, not scored — Praxrr cannot observe whether a proxy is in
  front of it." Fix: `env-var TRUSTED_PROXY` (with a `docHref`); the multi-option remediation is what
  makes it actionable for the no-proxy operator (AC#4).

Note on the overly-broad rule: the prefix-threshold (§3.2, ≤ /7 + wildcard) is a conservative but
principled cut that catches the `/1`-split trick and the `private` keyword while sparing legit
`/8`–`/16` supernets. A broad-but-not-≤-/7 _explicit_ supernet under `spoofableContext` remains a
documented residual amplifier (an operator deliberately trusting, e.g., a whole `/8` shared network);
the row-5 / row-3 advisory copy tells operators to name the proxy's exact address. Further tightening
is a future refinement.

### 6.3 `PostureInputs` delta (4 fields)

Added to `PostureInputs` (`types.ts`), materialized by `gather.ts`:

```ts
readonly trustedProxyConfigured: boolean;         // cfg.mode !== 'unset'
readonly trustedProxyValidRangeCount: number;     // cfg.ranges.length
readonly trustedProxyInvalidEntries: readonly string[]; // cfg.invalidEntries (raw tokens; safe, not secrets)
readonly trustedProxyOverlyBroad: boolean;        // cfg.overlyBroad
```

The scorer and the advisory builder also read existing `authMode` + `bindHost` (via
`isLoopbackBindHost`, already in `checks.ts`). No new input is needed for the "spoofable context"
condition.

### 6.4 `gather.ts` + `engine.ts` additions

`buildPostureInputs()` reads the already-parsed `config.trustedProxy` (parsing happened once at
`Config` construction; the gatherer does **not** re-parse and never throws — degrade-never-throw):

```ts
const tp = config.trustedProxy;
// ...
trustedProxyConfigured: tp.mode !== 'unset',
trustedProxyValidRangeCount: tp.ranges.length,
trustedProxyInvalidEntries: tp.invalidEntries,
trustedProxyOverlyBroad: tp.overlyBroad,
```

`engine.ts`:

- `buildAssurances()` gains a conditional push for row 2 (active & valid): an `Assurance { id:
'proxy_trust', label: 'Trusted proxy allowlist', verified: true, note: '…' }`.
- `buildAdvisories()` gains the row 3 / row 4 / row 5 pushes (mirroring the existing
  `session_cookie_secure` advisory), each with an id (`proxy_trust_overly_broad`,
  `proxy_trust_invalid`, `proxy_trust_missing`), label, detail, and `env-var` fix. Rows are
  mutually exclusive by the §6.2 precedence, so at most one proxy-trust advisory fires per report.

### 6.5 Engine version bump

`SECURITY_POSTURE_ENGINE_VERSION` **must bump `'1'` → `'2'`** (`types.ts:22`): the check set grows by
one member (`proxy_trust`), a breaking change per the type contract. The route test asserts
`body.engineVersion === SECURITY_POSTURE_ENGINE_VERSION` against the _imported_ constant
(securityPosture.test.ts:68), so it auto-follows the bump — no literal to update there.

### 6.6 Contract-lockstep checklist

- [ ] `types.ts`: add `'proxy_trust'` to `SecurityCheckId` union + `CHECK_IDS` (end of array, stable
      display order); add the 4 `PostureInputs` fields; bump `SECURITY_POSTURE_ENGINE_VERSION` `'1'`→`'2'`.
- [ ] `checks.ts`: add the `proxyTrust` scorer + `PROXY_TRUST_FAIL_WEIGHT` (applied only in row 1);
      append to `ALL_CHECKS` in `CHECK_IDS` order. Row 2 → `null`/`assured`; rows 3–6 → `null`/`na`.
- [ ] `catalog.ts`: add the `CHECK_CATALOG` entry (id/label/description) in matching order.
- [ ] `gather.ts`: populate the 4 fields (degrade-never-throw).
- [ ] `engine.ts`: row-2 `proxy_trust` assurance in `buildAssurances`; rows 3/4/5 advisories in
      `buildAdvisories`.
- [ ] `docs/api/v1/schemas/security-posture.yaml`: add `proxy_trust` to the `SecurityCheckId` enum
      (lines 10–17). **This is the only OpenAPI edit** — the `ShieldReport` JSON shape is otherwise
      unchanged (advisory ids are free-form strings; assurance ids are free-form strings; new array
      _elements_, not new fields).
- [ ] Regenerate the gated bundle: `deno task bundle:api` then `prettier --write
packages/praxrr-api/openapi.json` (the `openapi.json` mirror IS prettier-gated in CI).
- [ ] `v1.d.ts`: **do not** commit a full regen (≈3300 lines of non-gated tool churn per repo memory).
      Hand-graft the single `proxy_trust` enum member if needed; routes type against
      `SecurityPostureSummaryResponse` directly, so runtime stays in lockstep without it.
- [ ] `responses.ts`: **no change** — `WireCheck` / `WireTopAction` / `SecurityBandCap` are already
      generic over `SecurityCheckId`; advisory/assurance ids are free-form strings.
- [ ] Client: **no `SecurityCheckId`-keyed change** — `shieldStatus.ts` records are keyed by
      `CheckStatus`/`ShieldBand`, and `security-posture/+page.svelte` renders checks via
      `CHECK_CATALOG` and advisories via the generic `advisories[]` list (the `session_cookie_secure`
      precedent), so `proxy_trust` + its advisories auto-render. **Spot-check during implementation**
      that the advisory list section renders the new proxy-trust advisories with their `fix` link (a
      quick manual verify, since the two client files were not deep-read here).

---

## 7. File-by-file change list

### Add

- `packages/praxrr-app/src/lib/shared/security/trustedProxy.ts` — pure parser + CIDR matcher (§3).
- `packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts` — table-driven unit tests +
  drift guard (§8).
- `packages/praxrr-app/src/tests/base/trustedProxyConfig.test.ts` — `Config` env-parse tests (§8).
- `packages/praxrr-app/src/tests/base/networkTrust.test.ts` — `getClientIp` gating tests (§8).
- `docs/internal/228-trusted-proxy/DESIGN.md` — this document.

### Modify

- `packages/praxrr-app/src/lib/shared/security/index.ts` — re-export `trustedProxy.ts` API.
- `packages/praxrr-app/src/lib/server/utils/config/config.ts` — `trustedProxy` field +
  `parseTrustedProxyEnv()` helper.
- `packages/praxrr-app/src/lib/server/utils/auth/network.ts` — gate `getClientIp` on the direct peer
  (rightmost-hop XFF, fail-closed `'unknown'` sentinel); import config + `isTrustedProxyPeer`; adapter
  caveat comment.
- `packages/praxrr-app/src/routes/api/v1/setup/test-connection/+server.ts` — update the stale
  spoofability comment (allowlist now exists).
- `packages/praxrr-app/src/lib/shared/security/types.ts` — `SecurityCheckId` + `CHECK_IDS` + 4
  `PostureInputs` fields + engine-version bump.
- `packages/praxrr-app/src/lib/shared/security/checks.ts` — `proxyTrust` scorer + weight + `ALL_CHECKS`.
- `packages/praxrr-app/src/lib/shared/security/catalog.ts` — `CHECK_CATALOG` entry.
- `packages/praxrr-app/src/lib/server/security/gather.ts` — populate 4 fields.
- `packages/praxrr-app/src/lib/shared/security/engine.ts` — row-2 assurance + rows 3/4/5 advisories.
- `docs/api/v1/schemas/security-posture.yaml` — enum member.
- `packages/praxrr-api/openapi.json` — regenerated + prettier-formatted (do not hand-edit).
- `scripts/test.ts` — add a `trusted-proxy` alias.
- Test builders that construct `PostureInputs` literals: extend with the 4 new defaults
  (`false`/`0`/`[]`/`false`) — `tests/shared/security/engine.test.ts` (`makeInputs`) and
  `tests/shared/security/checks.test.ts` input builder. **This is the only existing-engine-test
  churn** (no band-threshold / recoverablePoints isolation is needed — see §8.1 D).
- `tests/routes/securityPosture.test.ts` — update the "All five checks" comment to six (the assertion
  itself uses `[...CHECK_IDS]` and auto-follows) + assert `proxy_trust` present with `score: null`.
- `README.md`, `docs/site/src/content/docs/guides/configuration.md`,
  `docs/site/src/content/docs/getting-started/docker.md`,
  `packages/praxrr-app/src/lib/server/utils/auth/README.md` — docs (§10).
- `ROADMAP.md` — Recently Shipped row + #28 follow-up annotations (§10).

---

## 8. Test plan

### 8.1 New test cases

**A. Pure module — `tests/shared/security/trustedProxy.test.ts`** (no env, table-driven, mirrors
`checks.test.ts`):

- IPv4 literal → `/32`; IPv6 literal → `/128`.
- IPv4 CIDR + IPv6 CIDR parse; prefix boundaries `/0`, `/7`, `/8`, `/32`, `/128`.
- `loopback` / `private` keyword expansion to the canonical CIDR sets; `loopback` → `overlyBroad:
false`, `private` → `overlyBroad: true` (via `fc00::/7`).
- `*` / `all` → `mode: 'wildcard'`, `overlyBroad: true`.
- `0.0.0.0/0`, `::/0`, and the split trick `0.0.0.0/1, 128.0.0.0/1` → `overlyBroad: true`;
  `10.0.0.0/8` / `172.16.0.0/12` alone → `overlyBroad: false` (spared).
- **Empty/whitespace token handling:** `'10.0.0.0/8,, *'`, a lone `','`, `'  '`, and
  `'\t10.0.0.0/8\n'` — assert empty tokens are skipped, never appear in `ranges`/`invalidEntries`, and
  can never be coerced into `all`/`*`; a lone-separator value → `mode: 'unset'`-equivalent (0 ranges).
- Malformed tokens (`999.0.0.0/8`, `10.0.0.0/33`, `fe80::1%eth0`, `garbage`) → `invalidEntries`,
  dropped, do **not** appear in `ranges`.
- Wholly-invalid value behaves like unset (empty ranges, no trust).
- IPv4-mapped normalization: peer `::ffff:10.0.0.5` matches range `10.0.0.0/8`.
- `isTrustedProxyPeer`: `unset` → false for any peer; `wildcard` → true; containment true/false at
  boundaries; unparseable peer → false.
- **Drift guard (§3.3):** for the sample set `{10.0.0.5, 172.20.1.1, 192.168.1.1, 169.254.0.1,
127.0.0.1, ::1, fe80::1, fc00::1}`, `isTrustedProxyPeer(ip, parseTrustedProxy('private loopback'))
=== isLocalAddress(ip)` (imports `isLocalAddress` from `network.ts`). Pins the two RFC1918/loopback
  encodings against silent divergence.

**B. Config parse — `tests/base/trustedProxyConfig.test.ts`** (mirrors `pullOnStartupConfig.test.ts`:
save/clear/restore env; cache-busting dynamic import
`../../lib/server/utils/config/config.ts?t=${Date.now()}_${Math.random()}` to force a fresh `Config`):

- Unset → `config.trustedProxy.mode === 'unset'`.
- `TRUSTED_PROXY=""` → `mode === 'unset'` (explicit opt-out).
- `TRUSTED_PROXY='172.18.0.2'` → one `/32` range, `mode: 'explicit'`, `overlyBroad: false`.
- `TRUSTED_PROXY='10.0.0.0/8, junk'` → one range + `invalidEntries: ['junk']`, **no throw**
  (asserts the non-throwing contract vs `parsePositiveIntEnv`).
- `TRUSTED_PROXY='*'` → `mode: 'wildcard'`, `overlyBroad: true`.
- Add `TRUSTED_PROXY` to the saved-key list.

**C. Request path — `tests/base/networkTrust.test.ts`** (pure `getClientIp`, no DB; build a `Request`
with forged headers + a stub `getClientAddress`, pass an explicit `TrustedProxyConfig`):

- **Untrusted peer + `X-Forwarded-For: 127.0.0.1` + unset config → returns the direct peer
  (`203.0.113.9`), NOT the spoofed header.** The regression test for the base bypass.
- **Trusted peer + append-form `X-Forwarded-For: 127.0.0.1, 203.0.113.9` → returns `203.0.113.9`
  (rightmost), NOT `127.0.0.1`.** The regression guard for the residual leftmost-XFF spoof (§4.1 step 3) — the exact single-proxy append case for nginx/Traefik/Caddy.
- Trusted peer (config `203.0.113.9/32`) + `X-Forwarded-For: 10.0.0.5` (single value) → returns
  `10.0.0.5`.
- Trusted peer + `X-Real-IP: 10.0.0.5` (no XFF) → returns `10.0.0.5` (replace-semantics header).
- Wildcard config → forwarded header honored from any peer (rightmost hop for XFF).
- No forwarded headers → direct peer returned regardless of config (direct-deploy invariance).
- **Fail-closed sentinel:** `getClientAddress()` that throws → returns `'unknown'`, and
  `isLocalAddress('unknown') === false` (asserted) → under `AUTH=local` this denies the bypass. Same
  for `getClientAddress()` returning `'unknown'`. The regression guard for §4.1 step 4 — an
  unresolvable peer must NOT resolve to a local-bypass address.

**D. Engine — extend `tests/shared/security/engine.test.ts`** (extend `makeInputs` with the 4
defaults `false`/`0`/`[]`/`false`):

- **Numeric invariance (pinned regression):** an `AUTH=on` default report (the existing 95/hardened
  case) is **byte-identical** after adding `proxy_trust` — assert `report.score === 95`, `report.band
=== 'hardened'`, and the `proxy_trust` check is present with `score === null` and `contribution ===
0`. This is the explicit "AUTH=on unchanged" guard the compat claim rests on.
- Overly-broad under `local` + non-loopback bind → `proxy_trust` `action`/critical,
  `bandCappedBy.checkId === 'proxy_trust'`, fix `env-var TRUSTED_PROXY` (row 1).
- Active & valid under `local` + non-loopback → `proxy_trust` `null`/`assured` + verified `proxy_trust`
  assurance present (row 2).
- Overly-broad under `AUTH=on` → `proxy_trust` `null`/`na`, `proxy_trust_overly_broad` advisory present,
  score unchanged (row 3).
- Invalid entries under any mode → `proxy_trust` `null`/`na`, `proxy_trust_invalid` advisory lists the
  ignored tokens, score unchanged (row 4).
- Missing under `local` + non-loopback (default `0.0.0.0` bind) → `proxy_trust` `null`/`na`,
  `proxy_trust_missing` advisory present with the multi-option fix, **score/band unchanged vs today**
  (row 5). Explicitly assert the default `AUTH=local` report is NOT dropped to `exposed`.
- `local` + loopback bind `127.0.0.1` + unset → `proxy_trust` `na`, no advisory (row 6, inert).
- Extend the actionability-invariant list with the row-1 input.
- **No isolation of the existing pinned local-mode cases is required** — because `proxy_trust` is `null`
  in every unset state, the band-thresholds `guarded` case (local, `0.0.0.0`, unset), the
  `recoverablePoints` case (local, `[]`, unset), and the contributions-sum case (local, `https://r`,
  unset) all keep their prior score/band/contribution. This corrects the prior draft, which assumed a
  scored missing-state would force those tests to be rewritten.

**E. Checks — extend `tests/shared/security/checks.test.ts`**: per-scorer `proxy_trust` branch tests
for row 1 (weighted action), row 2 (`assured`/null), and rows 3–6 (`na`/null), asserting weight is 25
only in row 1 and 0 elsewhere.

**F. Route — extend `tests/routes/securityPosture.test.ts`**:

- Update the "All five checks" comment to six; the `checks.map(id) === [...CHECK_IDS]` assertion and
  the `engineVersion` assertion already use imported constants and auto-follow.
- Assert `checks[]` contains `proxy_trust` (score `null` under default `AUTH=on`) — verifies the
  OpenAPI enum + wire lockstep. Env-driven `proxy_trust` _states_ are impractical here (config is a
  construction-time singleton, per §8.1 B), so state coverage lives in D/E.

### 8.2 Commands

```
# targeted suites (deno isn't on PATH in non-interactive shells — prepend ~/.deno/bin if needed)
deno task test security-posture
deno task test trusted-proxy        # after adding the alias (below)
deno task test packages/praxrr-app/src/tests/base/trustedProxyConfig.test.ts,packages/praxrr-app/src/tests/base/networkTrust.test.ts
deno task test packages/praxrr-app/src/tests/base/pullOnStartupConfig.test.ts

# full gates before "done"
deno task check      # check:server (deno check) + check:client (svelte-check) — type-checks the engine
deno task lint       # prettier --check . && eslint .
deno task format     # prettier --write . (run to satisfy the openapi.json + docs prettier gates)
```

New `scripts/test.ts` alias (near the `security-posture` / `config-health` entries):

```ts
'trusted-proxy':
  'packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts,' +
  'packages/praxrr-app/src/tests/base/trustedProxyConfig.test.ts,' +
  'packages/praxrr-app/src/tests/base/networkTrust.test.ts,' +
  'packages/praxrr-app/src/tests/routes/securityPosture.test.ts',
```

Note: `deno lint`/`.ts` prettier and `deno test` are **not** CI-gated (per repo memory) — run them
locally; a missed engine/route test update will NOT fail CI, so run the `security-posture` and
`trusted-proxy` suites locally before "done". `packages/praxrr-api/openapi.json` **is** prettier-gated,
so the regenerated bundle must be `prettier --write`.

---

## 9. Acceptance-criteria traceability

Issue #228 acceptance criteria → design element:

| #   | Acceptance criterion                                                                             | Satisfied by                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Disabled by default; direct deployments unchanged when `TRUSTED_PROXY` unset.**                | §2.1 (`unset` ⇒ `mode: 'unset'`, trust nobody) + §4.3 (direct deploys send no forwarded headers ⇒ identical result) + §6.1 (unset ⇒ `proxy_trust` `null` ⇒ score numerically unchanged, no false grade drop). Tests C "no forwarded headers" + "unset", D "numeric invariance" + "missing not dropped to exposed".                                                                                                                                                                       |
| 2   | **Fail closed on malformed values; never infer trust from header presence alone.**               | §2.3 (per-token drop; empty tokens skipped; wholly-invalid ⇒ behaves like unset) + §4.1 (trust keyed on the _direct socket peer_; forwarded headers ignored for untrusted peers; unresolvable peer ⇒ `'unknown'` sentinel that denies the bypass; trusted path consumes the proxy-appended rightmost hop, not the client-chosen leftmost token). Tests A (malformed/empty → invalidEntries/skipped), B (non-throwing), C (spoofed leftmost + append-form ignored, fail-closed sentinel). |
| 3   | **IPv4/IPv6/CIDR semantics defined explicitly.**                                                 | §2.2 grammar + §3.2 `CidrRange` bitwise containment (u32 / bigint), IPv4-mapped normalization, zone-id rejection, explicit `overlyBroad` prefix rule. Test A boundaries incl. `/7`,`/8`.                                                                                                                                                                                                                                                                                                 |
| 4   | **Shield Check reports missing / invalid / overly-broad / active trust with an actionable fix.** | §6.2 rows 1–5 (missing → advisory with multi-option fix; invalid → advisory naming dropped tokens; overly-broad → scored critical when a live bypass, else advisory; active → assurance) + §6.6 lockstep. Every state carries an `env-var`/`docs` fix that is actionable for both proxy and no-proxy operators. Tests D/E/F.                                                                                                                                                             |
| 5   | **Spoofed forwarded headers from untrusted peers must NOT affect security decisions.**           | §4.1 gate: untrusted peer ⇒ forwarded headers ignored ⇒ real peer used for the `AUTH=local` decision at `middleware.ts:63`; **and** trusted peer ⇒ leftmost client-injected XFF token no longer honored (rightmost proxy-appended hop used) ⇒ the mainstream single-proxy append case is also closed. Test C "untrusted peer + forged XFF returns direct peer" + "trusted peer + append-form XFF returns rightmost, not 127.0.0.1".                                                      |

---

## 10. ROADMAP.md edit and docs updates

### ROADMAP.md (mirror how #243/#244 were recorded)

- Add a new row at the **top** of the `## Recently Shipped` table:
  `| YYYY-MM-DD | [#NNN](…/pull/NNN) | Security Posture — explicit proxy trust: TRUSTED_PROXY allowlist (IPv4/IPv6/CIDR + loopback/private/wildcard tokens), fail-closed non-throwing parse, getClientIp gated on the direct peer (rightmost proxy-appended XFF hop, fail-closed 'unknown' sentinel) to close the AUTH=local X-Forwarded-For bypass, plus a proxy_trust Shield check + missing/invalid/overly-broad advisories. | [#228](…/issues/228) |`
- Annotate the #28 follow-up mentions (roadmap table ~line 186, narrative ~line 212) with "explicit
  proxy trust [#228] shipped in #NNN" (as #221/#222 were annotated for #243/#242).
- Update the `Reviewed:` header (line 3) to note #228 proxy-trust shipped.
- The #28 checklist item (~line 330) stays `[x]`; append "#228 shipped in #NNN".
- Add a one-line follow-up note: "future — extend TRUSTED_PROXY to gate X-Forwarded-Host / -Proto for
  WebAuthn RP-id / origin derivation (§5 deferral, recorded on #228)".

### Issue #228 (required scope note)

- Post a comment on #228 recording that this change ships the forwarded-**peer** (`getClientIp`) gate
  and **defers** forwarded-**host** / **-proto** trust (WebAuthn RP-id / origin) to a follow-up, with
  the fail-closed rationale (§5). This keeps the AC header list explicitly scoped, not silently
  narrowed.

### Docs (one change, all canonical surfaces)

- `README.md` — add a `TRUSTED_PROXY` row to the Environment Variables table + a note in the
  Authentication section that **proxied `AUTH=local` deployments must now set it** (auth break), and
  that **proxied `AUTH=on` deployments should also set it** to restore per-client rate-limiting and
  accurate audit logs (§4.3).
- `docs/site/src/content/docs/guides/configuration.md` — new `## Trusted proxy` subsection: grammar,
  unset=disabled, fail-closed-on-malformed, rightmost-hop XFF semantics, `*`/supernet=overly-broad
  (flagged), `private`=broad, `loopback`=narrow, nginx / traefik / caddy behind-proxy examples, and
  the `AUTH=on` rate-limit/audit note.
- `docs/site/src/content/docs/getting-started/docker.md` — a behind-proxy `TRUSTED_PROXY` example.
- `packages/praxrr-app/src/lib/server/utils/auth/README.md` — document the `getClientIp` trust gate,
  the rightmost-hop XFF rule, the fail-closed `'unknown'` sentinel, and the `AUTH=local` flow change.
- **Keep separate from CSRF trusted-origins:** the docs must not imply the wildcard CSRF
  `trustedOrigins` dev note makes wildcard `TRUSTED_PROXY` safe — they are different trust axes.

### Release notes

Call out the breaking change for **proxied `AUTH=local`** deployments (§4.3): they must set
`TRUSTED_PROXY` to their reverse-proxy IP/CIDR or the local bypass stops working (intended). Note the
**proxied `AUTH=on`** rate-limit/audit change (set `TRUSTED_PROXY` to restore per-client behavior).
Truly direct deployments are unaffected.
</content>
</invoke>
