# Implementation Plan: `TRUSTED_PROXY` trust contract + Shield surfacing (issue #228)

Authoritative source: `docs/internal/228-trusted-proxy/DESIGN.md` (approved). This plan turns that
design into **ordered batches** that keep type-checking green incrementally. Each batch lists the exact
files, the specific change, a **verification gate** (the exact command(s) to run before moving on), and
a **rollback-safety** note.

## Conventions for every batch

- **Formatting:** match `.prettierrc` — 2-space indent, single quotes, semicolons, 120-char width. The
  "tabs" note in `CLAUDE.md` is wrong for this repo (per repo memory); do not use tabs.
- **Engine purity:** `trustedProxy.ts`, `types.ts`, `checks.ts`, `catalog.ts`, `engine.ts` are PURE —
  no `Deno.env`, no I/O, no `Date`/`Math.random`, no server-only imports (`$config`/`$logger`/`$db`).
- **Deno on PATH:** deno is not on PATH in non-interactive shells; prepend `~/.deno/bin` if `deno`
  is not found (`export PATH="$HOME/.deno/bin:$PATH"`). All commands below assume repo root
  (`/home/yandy/Projects/github.com/yandy-r/praxrr/.claude/worktrees/trusted-proxy-228`).
- **CI gating reality (repo memory):** `deno test` and `.ts` prettier/`deno lint` are NOT CI-gated —
  run them locally; a missed engine/route test update will NOT fail CI. `packages/praxrr-api/openapi.json`
  IS prettier-gated, so the regenerated bundle must be `prettier --write`. Run the targeted suites
  locally before calling anything "done".
- **Per-batch gate meaning:** the gate command must pass (green) before starting the next batch. Type
  gates use `deno task test <file>` because `deno test` type-checks the file and its import graph
  (routes are excluded from `deno check` but a `deno test <dir>` type-checks them, per repo memory).

---

## Batch 0 — Baseline capture (no edits)

**Depends on:** nothing.

**Purpose:** record a known-green starting point and re-confirm the design's call-site inventory so the
"no call site changes" claim (DESIGN §4.2) is authoritative at implementation time.

**Actions (read-only):**

- Re-run the call-site grep and confirm it still returns 13 invocations across 9 files:
  `grep -rn 'getClientIp(' packages/praxrr-app/src` (minus the `network.ts` definition/export).
- Confirm no security decision reads `event.getClientAddress()` outside `getClientIp`:
  `grep -rn 'getClientAddress' packages/praxrr-app/src` (expect only `network.ts` + the
  `tests/routes/setupWizard.test.ts` stub).

**Verification gate:**

```
deno task test security-posture
```

Green = the existing security-posture suite passes before any change (the numeric-invariance baseline).

**Rollback safety:** none needed — read-only.

---

## Batch 1 — Pure shared module `trustedProxy.ts` + re-export + unit test

**Depends on:** Batch 0. This is the leaf of the dependency graph (imports nothing from the repo except
`network.ts`'s `isLocalAddress` **in the test only**, not in the module).

### Files

1. **ADD** `packages/praxrr-app/src/lib/shared/security/trustedProxy.ts` — the pure parser + CIDR
   matcher (DESIGN §3.2). Exact public surface:
   - `export type TrustedProxyMode = 'unset' | 'explicit' | 'wildcard';`
   - `export interface CidrRange { readonly family: 4 | 6; readonly base: bigint; readonly prefix: number; readonly raw: string; }`
   - `export interface TrustedProxyConfig { readonly raw: string | null; readonly mode: TrustedProxyMode; readonly ranges: readonly CidrRange[]; readonly invalidEntries: readonly string[]; readonly wildcard: boolean; readonly overlyBroad: boolean; }`
   - `export function parseTrustedProxy(raw: string | null | undefined): TrustedProxyConfig;` — never throws.
   - `export function isTrustedProxyPeer(peerIp: string, cfg: TrustedProxyConfig): boolean;`
   - Internal constant `const OVERLY_BROAD_PREFIX = { 4: 7, 6: 7 } as const;` — the **single source of
     truth** for the overly-broad rule (§3.2). `overlyBroad = wildcard || any range prefix <= OVERLY_BROAD_PREFIX[family]`.
   - Keyword expansions defined ONCE here: `loopback` → `127.0.0.0/8`, `::1/128`; `private` →
     `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7`, `fe80::/10`.
   - Tokenizer: split on `SEP := (',' | WS)+`; trim + lower-case each token; **skip empty tokens**
     (never coerce to `all`/`*`). Per-token validation: valid → `CidrRange`; malformed (octet > 255,
     prefix out of range, non-numeric prefix, malformed IPv6, zone id `%...`) → push raw to
     `invalidEntries`, drop. `*`/`all` → `wildcard = true`.
   - IP → integer: v4 as `bigint` masked to `prefix` bits (u32 range); v6 as `bigint` (128-bit),
     RFC4291 `::` expansion; IPv4-mapped `::ffff:a.b.c.d` normalized to v4 before matching; strip
     `[...]` brackets; reject zone ids.
   - `isTrustedProxyPeer`: `unset` → `false`; `wildcard` → `true`; else normalize peer, convert to the
     matching-family integer, bitwise-contain against every same-family `CidrRange`; unparseable peer
     → `false` (fail closed).
   - Doc comment at top mirroring the `checks.ts` header style; note purity constraints explicitly.

2. **MODIFY** `packages/praxrr-app/src/lib/shared/security/index.ts` — add one line after the existing
   `export * from './types.ts';` block (keep the barrel's ordering):

   ```ts
   export {
     parseTrustedProxy,
     isTrustedProxyPeer,
     type TrustedProxyConfig,
     type TrustedProxyMode,
     type CidrRange,
   } from './trustedProxy.ts';
   ```

3. **ADD** `packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts` — table-driven, mirrors
   `checks.test.ts` style (`@std/assert`, `Deno.test`). Cover DESIGN §8.1 A in full:
   - v4 literal → `/32`; v6 literal → `/128`.
   - v4/v6 CIDR parse; prefix boundaries `/0`, `/7`, `/8`, `/32`, `/128`.
   - `loopback`/`private` keyword expansion; `loopback` → `overlyBroad: false`, `private` →
     `overlyBroad: true` (via `fc00::/7`).
   - `*`/`all` → `mode: 'wildcard'`, `overlyBroad: true`.
   - `0.0.0.0/0`, `::/0`, split trick `0.0.0.0/1, 128.0.0.0/1` → `overlyBroad: true`; `10.0.0.0/8` /
     `172.16.0.0/12` alone → `overlyBroad: false`.
   - Empty/whitespace token handling: `'10.0.0.0/8,, *'`, lone `','`, `'  '`, `'\t10.0.0.0/8\n'` —
     empty tokens skipped, never in `ranges`/`invalidEntries`, never coerced to `all`/`*`;
     lone-separator → 0 ranges (unset-equivalent).
   - Malformed (`999.0.0.0/8`, `10.0.0.0/33`, `fe80::1%eth0`, `garbage`) → `invalidEntries`, dropped.
   - Wholly-invalid value behaves like unset (empty ranges).
   - IPv4-mapped normalization: peer `::ffff:10.0.0.5` matches range `10.0.0.0/8`.
   - `isTrustedProxyPeer`: `unset` → false for any peer; `wildcard` → true; containment true/false at
     boundaries; unparseable peer → false.
   - **Drift guard (§3.3):** import `isLocalAddress` from
     `../../../lib/server/utils/auth/network.ts`; for `{10.0.0.5, 172.20.1.1, 192.168.1.1, 169.254.0.1,
127.0.0.1, ::1, fe80::1, fc00::1}`, assert
     `isTrustedProxyPeer(ip, parseTrustedProxy('private loopback')) === isLocalAddress(ip)`.

**Verification gate:**

```
deno task test packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts
```

Green = all table cases + the drift guard pass; the module type-checks in isolation (no `$config`/
`$logger`/`$db` import crept in).

**Rollback safety:** fully additive except the one-line barrel export. Reverting the three files
restores the pre-batch state; nothing else imports `trustedProxy.ts` yet, so no consumer breaks.

---

## Batch 2 — Config wiring (`config.ts` field + `parseTrustedProxyEnv`) + config parse test

**Depends on:** Batch 1 (imports `parseTrustedProxy` + `TrustedProxyConfig` from `$shared/security`).

### Files

1. **MODIFY** `packages/praxrr-app/src/lib/server/utils/config/config.ts`:
   - Add import at top (config currently imports nothing — verified; no cycle since the shared module
     imports neither config nor network):
     ```ts
     import {
       parseTrustedProxy,
       type TrustedProxyConfig,
     } from '$shared/security/index.ts';
     ```
   - Add the public field to the `Config` class (near the other `public readonly` declarations):
     ```ts
     public readonly trustedProxy: TrustedProxyConfig;
     ```
   - Assign it in the constructor (after the WebAuthn block):
     ```ts
     this.trustedProxy = Config.parseTrustedProxyEnv();
     ```
   - Add the private static helper (alongside `parsePositiveIntEnv`):
     ```ts
     private static parseTrustedProxyEnv(): TrustedProxyConfig {
       return parseTrustedProxy(Deno.env.get('TRUSTED_PROXY') ?? null);
     }
     ```

2. **ADD** `packages/praxrr-app/src/tests/base/trustedProxyConfig.test.ts` — mirror
   `pullOnStartupConfig.test.ts`: `EnvRestore` save/clear/restore helper over the key list
   `['TRUSTED_PROXY']`, and the cache-busting dynamic import
   `await import(\`../../lib/server/utils/config/config.ts?t=${Date.now()}_${Math.random()}\`)`to force a
fresh`Config`. Cases (DESIGN §8.1 B):
   - Unset → `config.trustedProxy.mode === 'unset'`.
   - `TRUSTED_PROXY=''` → `mode === 'unset'` (explicit opt-out).
   - `TRUSTED_PROXY='172.18.0.2'` → one `/32` range, `mode: 'explicit'`, `overlyBroad: false`.
   - `TRUSTED_PROXY='10.0.0.0/8, junk'` → one range + `invalidEntries: ['junk']`, **no throw**
     (assert the non-throwing contract vs `parsePositiveIntEnv`).
   - `TRUSTED_PROXY='*'` → `mode: 'wildcard'`, `overlyBroad: true`.

**Verification gate:**

```
deno task test packages/praxrr-app/src/tests/base/trustedProxyConfig.test.ts
```

Green = the singleton carries a parsed `trustedProxy` per env; the malformed case does not throw at
`Config` construction.

**Rollback safety:** additive field + helper + one import. If reverted, no other module reads
`config.trustedProxy` yet (network/gather changes land in later batches), so removal is clean.

---

## Batch 3 — Request-path gate (`network.ts getClientIp`) + test-connection comment + network test

**Depends on:** Batch 1 (`isTrustedProxyPeer`) and Batch 2 (`config.trustedProxy` default param).

### Files

1. **MODIFY** `packages/praxrr-app/src/lib/server/utils/auth/network.ts`:
   - Add imports:
     ```ts
     import { config } from '$config';
     import {
       isTrustedProxyPeer,
       type TrustedProxyConfig,
     } from '$shared/security/index.ts';
     ```
   - Rewrite `getClientIp` with the new signature + default param (evaluated per call):
     ```ts
     export function getClientIp(
       event: { getClientAddress: () => string; request: Request },
       trustedProxy: TrustedProxyConfig = config.trustedProxy
     ): string;
     ```
   - New algorithm (DESIGN §4.1):
     1. Resolve the direct peer via `event.getClientAddress()` inside try/catch; if it throws, or is
        falsy / `'unknown'`, return the sentinel `'unknown'` (do NOT default to `'127.0.0.1'`).
     2. If `!isTrustedProxyPeer(directPeer, trustedProxy)` → return `directPeer` (ignore all forwarded
        headers).
     3. Trusted peer → read `IP_HEADERS`: for `x-forwarded-for`, take the **rightmost** non-empty token
        (the proxy-appended hop); for the single-value replace-semantics headers, take the value as-is
        (rightmost token if it somehow carries a comma). `x-forwarded-for` stays first in `IP_HEADERS`.
     4. If a trusted peer sent no usable forwarded header, return `directPeer`.
   - Add the **adapter caveat comment** (DESIGN §4.4): a one-line warning that enabling any
     `sveltekit-adapter-deno` address/XFF override (or a PROXY-protocol front end that rewrites the
     peer) would silently defeat `TRUSTED_PROXY`, since the gate trusts `getClientAddress()` as the real
     socket peer.
   - Leave `isLocalAddress`/`isLocalIPv4`/`isLocalIPv6` untouched; add the scope-discipline comment
     noting the future consolidation with the `trustedProxy.ts` keyword CIDRs (DESIGN §3.3).

2. **MODIFY** `packages/praxrr-app/src/routes/api/v1/setup/test-connection/+server.ts` — replace the
   stale spoofability comment (lines ~29–31) with one noting the trust gate now exists: the rate-limit
   key is the real socket peer unless the direct peer is an approved `TRUSTED_PROXY`. No behavior change
   (it inherits the default-param gate).

3. **ADD** `packages/praxrr-app/src/tests/base/networkTrust.test.ts` — pure `getClientIp`, no DB; build
   a `Request` with forged headers + a stub `getClientAddress`, pass an explicit `TrustedProxyConfig`
   (constructed via `parseTrustedProxy(...)`). Cases (DESIGN §8.1 C):
   - Untrusted peer + `X-Forwarded-For: 127.0.0.1` + unset config → returns direct peer `203.0.113.9`,
     NOT the spoofed header. (Base-bypass regression.)
   - Trusted peer (`203.0.113.9/32`) + append-form `X-Forwarded-For: 127.0.0.1, 203.0.113.9` → returns
     `203.0.113.9` (rightmost), NOT `127.0.0.1`. (Residual leftmost-XFF spoof regression.)
   - Trusted peer + `X-Forwarded-For: 10.0.0.5` (single value) → `10.0.0.5`.
   - Trusted peer + `X-Real-IP: 10.0.0.5` (no XFF) → `10.0.0.5` (replace-semantics header).
   - Wildcard config → forwarded header honored from any peer (rightmost hop for XFF).
   - No forwarded headers → direct peer regardless of config (direct-deploy invariance).
   - Fail-closed sentinel: `getClientAddress()` that throws → `'unknown'`, and assert
     `isLocalAddress('unknown') === false`; same for `getClientAddress()` returning `'unknown'`.

**Verification gate:**

```
deno task test packages/praxrr-app/src/tests/base/networkTrust.test.ts,packages/praxrr-app/src/tests/base/trustedProxyConfig.test.ts
deno task test setup-wizard
```

Green = the gate returns the real peer for untrusted senders, the rightmost hop for trusted ones, and
`'unknown'` on unresolvable peers; the existing `setup-wizard` suite (the only other
`getClientAddress` reference) still passes.

**Rollback safety:** `getClientIp` keeps a backward-compatible single-arg call shape (default param), so
all 13 call sites are unchanged and revert cleanly. Reverting `network.ts` + the comment restores the
prior (vulnerable) behavior without touching callers.

---

## Batch 4 — Shield types (`types.ts`)

**Depends on:** Batch 0 (pure; independent of Batches 1–3, but sequenced here so the Shield chain 4→8
builds in order). Splitting types first lets `checks.ts`/`catalog.ts`/`gather.ts`/`engine.ts` type-check
against the grown contract.

### Files

1. **MODIFY** `packages/praxrr-app/src/lib/shared/security/types.ts`:
   - Add `'proxy_trust'` to the `SecurityCheckId` union (line ~30–31).
   - Append `'proxy_trust'` to the `CHECK_IDS` array (end, stable display order).
   - Add the 4 `PostureInputs` fields (DESIGN §6.3):
     ```ts
     readonly trustedProxyConfigured: boolean;
     readonly trustedProxyValidRangeCount: number;
     readonly trustedProxyInvalidEntries: readonly string[];
     readonly trustedProxyOverlyBroad: boolean;
     ```
   - Bump `SECURITY_POSTURE_ENGINE_VERSION` from `'1'` to `'2'` (line 22).

**Verification gate:**

```
deno task test packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts
```

(A cheap type-graph smoke that still compiles.) NOTE: `security-posture` and the two Shield-test builders
will be RED until Batch 7 adds the 4 defaults to `makeInputs`. Do not run `security-posture` as this
batch's gate — its green returns in Batch 8. Type-check the engine chain instead with:

```
deno check packages/praxrr-app/src/lib/shared/security/types.ts
```

Green = `types.ts` compiles with the grown union/array/interface and bumped version.

**Rollback safety:** additive union member, array element, 4 optional-looking (but required) fields, and
a version string. The 4 required fields will make every `PostureInputs` literal a compile error until
Batch 7 — this is intentional and localized to test builders (they are the only literals per DESIGN
§7). Reverting `types.ts` restores the `'1'`-version 5-check contract.

---

## Batch 5 — Shield `checks.ts` scorer + weight + `ALL_CHECKS`; `catalog.ts` entry

**Depends on:** Batch 4 (the `'proxy_trust'` id + `PostureInputs` fields must exist).

### Files

1. **MODIFY** `packages/praxrr-app/src/lib/shared/security/checks.ts`:
   - Add weight constant near the others: `const PROXY_TRUST_FAIL_WEIGHT = 25;` (parallels
     `LOG_REDACTION_FAIL_WEIGHT`; applied ONLY in row 1).
   - Add `const ID_PROXY: SecurityCheckId = 'proxy_trust';` + `const LABEL_PROXY = 'Trusted proxy allowlist';`.
   - Reuse the existing module-private `isLoopbackBindHost` for `spoofableContext`.
   - Implement the `proxyTrust: SecurityCheck` scorer following the §6.2 precedence table (first match
     wins). Compute `spoofableContext = inputs.authMode === 'local' && !isLoopbackBindHost(inputs.bindHost)`
     and `configured = inputs.trustedProxyConfigured`:
     - **Row 1** (`configured && trustedProxyOverlyBroad && spoofableContext`): `result(ID_PROXY,
LABEL_PROXY, 0, PROXY_TRUST_FAIL_WEIGHT, 'action', true, 'exposed', detail, [rec(...)])` — detail
       names both hazards (re-enables spoofable trust; reopens the XFF bypass under `AUTH=local`); fix
       `{ kind: 'env-var', name: 'TRUSTED_PROXY', label: 'Narrow TRUSTED_PROXY to the proxy address' }`.
     - **Row 2** (`configured && ranges > 0 && !overlyBroad && invalidEntries empty`): `result(...,
null, 0, 'assured', false, null, ...)` — the assurance push lives in `engine.ts` (Batch 6).
     - **Rows 3–6** (everything else): `result(..., null, 0, 'na', false, null, ...)`.
   - Append `proxyTrust` to `ALL_CHECKS` (end, in `CHECK_IDS` order).
   - Keep purity: no `Deno.env`, no `Date`.

2. **MODIFY** `packages/praxrr-app/src/lib/shared/security/catalog.ts` — append the `CHECK_CATALOG`
   entry in matching order:
   ```ts
   {
     id: 'proxy_trust',
     label: 'Trusted proxy allowlist',
     description:
       'Whether forwarded client IPs are trusted only from an explicitly approved reverse-proxy peer (TRUSTED_PROXY).',
   },
   ```

**Verification gate:**

```
deno check packages/praxrr-app/src/lib/shared/security/checks.ts packages/praxrr-app/src/lib/shared/security/catalog.ts
```

Green = both compile against the Batch-4 contract; `ALL_CHECKS` and `CHECK_CATALOG` both have 6 entries
in `CHECK_IDS` order. (Suite green returns in Batch 8.)

**Rollback safety:** additive scorer + one registry entry + one catalog entry. No existing scorer is
modified, so the 5 existing checks keep identical output. Reverting both files drops `proxy_trust`
cleanly (but leaves `CHECK_IDS` referencing it — revert in tandem with Batch 4 if abandoning).

---

## Batch 6 — `gather.ts` population + `engine.ts` assurance/advisories

**Depends on:** Batch 2 (`config.trustedProxy`), Batch 4 (fields), Batch 5 (the scorer's row semantics
that the assurance/advisory copy must match).

### Files

1. **MODIFY** `packages/praxrr-app/src/lib/server/security/gather.ts` — in `buildPostureInputs()`, read
   the already-parsed `config.trustedProxy` (do NOT re-parse; degrade-never-throw) and add the 4 fields
   to the returned object:

   ```ts
   const tp = config.trustedProxy;
   // ... in the returned literal:
   trustedProxyConfigured: tp.mode !== 'unset',
   trustedProxyValidRangeCount: tp.ranges.length,
   trustedProxyInvalidEntries: tp.invalidEntries,
   trustedProxyOverlyBroad: tp.overlyBroad,
   ```

2. **MODIFY** `packages/praxrr-app/src/lib/shared/security/engine.ts`:
   - `buildAssurances(inputs)`: conditionally push the row-2 assurance when
     `inputs.trustedProxyConfigured && inputs.trustedProxyValidRangeCount > 0 &&
!inputs.trustedProxyOverlyBroad && inputs.trustedProxyInvalidEntries.length === 0`:
     `{ id: 'proxy_trust', label: 'Trusted proxy allowlist', verified: true, note: '…' }`.
   - `buildAdvisories(inputs)`: add rows 3/4/5 (mirroring the `session_cookie_secure` push), mutually
     exclusive by the §6.2 precedence (compute `spoofableContext` locally the same way; import
     `isLoopbackBindHost` is module-private to `checks.ts`, so replicate the loopback-bind test inline OR
     export a shared helper — prefer inlining the 2-line check to avoid widening `checks.ts` exports,
     matching the existing engine self-containment):
     - **Row 3** `proxy_trust_overly_broad` — `configured && overlyBroad && !spoofableContext`.
     - **Row 4** `proxy_trust_invalid` — `configured && invalidEntries.length > 0` (and not row 1);
       detail lists the ignored tokens.
     - **Row 5** `proxy_trust_missing` — `!configured && spoofableContext`; multi-option fix copy
       (set `TRUSTED_PROXY`, or `AUTH=on`, or bind loopback).
     - Each advisory: `id`, `label`, `detail`, and `fix: { kind: 'env-var', name: 'TRUSTED_PROXY',
docHref: '…', label: '…' }`. At most one proxy-trust advisory fires per report.

**Verification gate:**

```
deno check packages/praxrr-app/src/lib/server/security/gather.ts packages/praxrr-app/src/lib/shared/security/engine.ts
```

Green = both compile; the `PostureInputs` literal in `gather.ts` now satisfies the 4 required fields.

**Rollback safety:** additive object fields + conditional pushes. Existing assurances/advisories are
untouched, so an `AUTH=on` default report gains no new assurance/advisory (row conditions all false).
Reverting both files removes the proxy-trust surfacing without affecting the 5 legacy checks.

---

## Batch 7 — Extend test input builders with the 4 defaults (unblocks the suite)

**Depends on:** Batch 4 (the fields are required, making every existing `PostureInputs` literal a
compile error until this batch). This is the ONLY existing-engine-test churn (DESIGN §8.1 D — no
band-threshold / recoverablePoints isolation is needed because `proxy_trust` scores `null` in every
unset state).

### Files

1. **MODIFY** `packages/praxrr-app/src/tests/shared/security/engine.test.ts` — extend `makeInputs`
   defaults (lines ~11–34) with:

   ```ts
   trustedProxyConfigured: false,
   trustedProxyValidRangeCount: 0,
   trustedProxyInvalidEntries: [],
   trustedProxyOverlyBroad: false,
   ```

2. **MODIFY** `packages/praxrr-app/src/tests/shared/security/checks.test.ts` — extend its `makeInputs`
   builder (lines ~18–34) with the same 4 defaults.

**Verification gate:**

```
deno task test packages/praxrr-app/src/tests/shared/security/engine.test.ts,packages/praxrr-app/src/tests/shared/security/checks.test.ts
```

Green = the two Shield suites compile and pass again (default `AUTH=on` report byte-identical: score 95,
band hardened, `proxy_trust` present with `score: null, contribution: 0`).

**Rollback safety:** test-only, additive defaults. Reverting restores 5-field literals (which then fail
against the Batch-4 contract — revert only in tandem with Batch 4).

---

## Batch 8 — Engine / checks / route test additions

**Depends on:** Batches 4–7 (contract + scorer + surfacing + builders all in place).

### Files

1. **MODIFY** `packages/praxrr-app/src/tests/shared/security/engine.test.ts` — add cases (DESIGN §8.1 D):
   - **Numeric invariance (pinned):** the existing 95/hardened `AUTH=on` report is byte-identical after
     adding `proxy_trust` — assert `score === 95`, `band === 'hardened'`, `proxy_trust` present with
     `score === null` and `contribution === 0`.
   - Overly-broad under `local` + non-loopback bind → `proxy_trust` `action`/critical,
     `bandCappedBy.checkId === 'proxy_trust'`, fix `env-var TRUSTED_PROXY` (row 1).
   - Active & valid under `local` + non-loopback → `proxy_trust` `null`/`assured` + verified
     `proxy_trust` assurance present (row 2).
   - Overly-broad under `AUTH=on` → `proxy_trust` `null`/`na`, `proxy_trust_overly_broad` advisory
     present, score unchanged (row 3).
   - Invalid entries under any mode → `proxy_trust` `null`/`na`, `proxy_trust_invalid` advisory lists
     the ignored tokens, score unchanged (row 4).
   - Missing under `local` + non-loopback (default `0.0.0.0` bind) → `proxy_trust` `null`/`na`,
     `proxy_trust_missing` advisory with multi-option fix, **score/band unchanged vs today**; explicitly
     assert the default `AUTH=local` report is NOT dropped to `exposed` (row 5).
   - `local` + loopback bind `127.0.0.1` + unset → `proxy_trust` `na`, no advisory (row 6, inert).
   - Extend the actionability-invariant list with the row-1 input.

2. **MODIFY** `packages/praxrr-app/src/tests/shared/security/checks.test.ts` — per-scorer `proxy_trust`
   branch tests for row 1 (weighted action, weight 25), row 2 (`assured`/null), rows 3–6 (`na`/null),
   asserting weight is 25 only in row 1 and 0 elsewhere (DESIGN §8.1 E).

3. **MODIFY** `packages/praxrr-app/src/tests/routes/securityPosture.test.ts` — update the "All five
   checks" comment (line ~72) to six; the `checks.map(id) === [...CHECK_IDS]` and `engineVersion`
   assertions use imported constants and auto-follow. Add: `checks[]` contains `proxy_trust` with
   `score: null` under default `AUTH=on` (verifies the OpenAPI enum + wire lockstep) (DESIGN §8.1 F).

**Verification gate:**

```
deno task test security-posture
```

Green = the full security-posture suite passes with the new `proxy_trust` states and the route lockstep
assertion.

**Rollback safety:** test-only additions. Reverting drops the new coverage but leaves the runtime intact.

---

## Batch 9 — Contract: OpenAPI enum + bundle regen + prettier

**Depends on:** Batch 4 (the `'proxy_trust'` id must exist in `types.ts` so the generated types match).

### Files

1. **MODIFY** `docs/api/v1/schemas/security-posture.yaml` — add `- proxy_trust` to the `SecurityCheckId`
   enum (lines 10–17, after `log_redaction`). **This is the only OpenAPI edit** — `ShieldReport` shape is
   otherwise unchanged (advisory/assurance ids are free-form strings; new array elements, not fields).

2. **REGENERATE** the gated bundle (do NOT hand-edit `openapi.json`):

   ```
   deno task bundle:api
   prettier --write packages/praxrr-api/openapi.json
   ```

   (Consult the `praxrr-commands` skill if the exact task name differs; `bundle:api` regenerates
   `openapi.json` + `types.ts` deterministically.)

3. **`v1.d.ts`:** do NOT commit a full regen (~3300 lines of non-gated tool churn per repo memory).
   Routes type against `SecurityPostureSummaryResponse` directly, so runtime stays in lockstep without
   it. If a `proxy_trust` enum member is needed in `v1.d.ts`, hand-graft only that single member.

4. **NO CHANGE** to `responses.ts` (`WireCheck`/`WireTopAction`/`SecurityBandCap` are generic over
   `SecurityCheckId`) and NO `SecurityCheckId`-keyed client change (`shieldStatus.ts` is keyed by
   `CheckStatus`/`ShieldBand`; `security-posture/+page.svelte` renders via `CHECK_CATALOG` + the generic
   `advisories[]`). **Spot-check** during implementation that the advisory list section renders the new
   proxy-trust advisories with their `fix` link.

**Verification gate:**

```
git diff --stat packages/praxrr-api/openapi.json docs/api/v1/schemas/security-posture.yaml
prettier --check packages/praxrr-api/openapi.json
deno task test security-posture
```

Green = the enum diff is scoped to `proxy_trust`; `openapi.json` passes the prettier gate; the route
test still passes against the regenerated wire types.

**Rollback safety:** the YAML edit is one line; the JSON is regenerated (never hand-edited), so a revert

- re-`bundle:api` restores the prior bundle deterministically. Keep the diff scoped — verify no
  unrelated schema churn slipped into `openapi.json` before staging.

---

## Batch 10 — Test alias + docs + ROADMAP + issue scope note

**Depends on:** all test files exist (Batches 1–3, 8) so the alias resolves to real paths.

### Files

1. **MODIFY** `scripts/test.ts` — add the alias near the `security-posture` / `config-health` entries:

   ```ts
   'trusted-proxy':
     'packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts,' +
     'packages/praxrr-app/src/tests/base/trustedProxyConfig.test.ts,' +
     'packages/praxrr-app/src/tests/base/networkTrust.test.ts,' +
     'packages/praxrr-app/src/tests/routes/securityPosture.test.ts',
   ```

2. **MODIFY** docs (DESIGN §10):
   - `README.md` — `TRUSTED_PROXY` row in the Environment Variables table + Authentication-section note
     that proxied `AUTH=local` deployments MUST now set it (auth break), and proxied `AUTH=on` should
     also set it to restore per-client rate-limiting + accurate audit.
   - `docs/site/src/content/docs/guides/configuration.md` — new `## Trusted proxy` subsection: grammar,
     unset=disabled, fail-closed-on-malformed, rightmost-hop XFF, `*`/supernet=overly-broad,
     `private`=broad, `loopback`=narrow, nginx/traefik/caddy examples, `AUTH=on` rate-limit/audit note.
     Keep it separate from CSRF trusted-origins (different trust axis).
   - `docs/site/src/content/docs/getting-started/docker.md` — a behind-proxy `TRUSTED_PROXY` example.
   - `packages/praxrr-app/src/lib/server/utils/auth/README.md` — document the `getClientIp` trust gate,
     rightmost-hop XFF rule, fail-closed `'unknown'` sentinel, `AUTH=local` flow change.

3. **MODIFY** `ROADMAP.md` — Recently Shipped row at top; annotate the #28 follow-up mentions; update the
   `Reviewed:` header; keep the #28 checklist item `[x]` with "#228 shipped in #NNN"; add the
   forwarded-host/-proto follow-up note (DESIGN §10, §5 deferral).

4. **Issue #228 scope comment (required, not code):** post the comment recording that #228 ships the
   forwarded-**peer** (`getClientIp`) gate and **defers** forwarded-**host**/`-proto` trust (WebAuthn
   RP-id/origin) with the fail-closed rationale (DESIGN §5). Do this at PR time.

**Verification gate:**

```
deno task test trusted-proxy
prettier --check "**/*.md"
```

Green = the alias resolves and runs the 4 target suites; the docs pass the markdown prettier gate (docs

- shell are CI-gated per repo memory — the `*.md` printWidth:80 override rewraps code fences, so run
  `prettier --write` on touched docs before committing).

**Rollback safety:** alias + docs + roadmap are additive/non-runtime. Reverting affects no behavior.

---

## Risk register (top 5)

| #   | Risk                                                                                                                                           | Mitigation                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`config.ts` ↔ `network.ts` import cycle** via `$config` in `network.ts` and `$shared/security` in `config.ts`.                               | The shared module imports neither `config` nor `network` (Batch 1 gate enforces isolation). `config.ts` imports only the pure `$shared/security` parser; `network.ts` imports `$config` (already the pattern in `middleware.ts`). Verify with `deno check` in Batch 3. |
| 2   | **Required `PostureInputs` fields break every literal** the moment Batch 4 lands, and CI does not gate `deno test`, so the breakage is silent. | Fields are added in Batch 4 but the suite is intentionally left RED until Batch 7 fixes the two builders (the only literals, per DESIGN §7). Batch 8's `deno task test security-posture` is the hard re-green gate; do not skip it.                                    |
| 3   | **`overlyBroad` rule mis-encoded** (misses the `/1`-split trick or over-flags `10.0.0.0/8`), silently re-opening or over-restricting trust.    | `OVERLY_BROAD_PREFIX = {4:7,6:7}` is the single source of truth in `trustedProxy.ts`; Batch 1's table test pins `/7`,`/8`, the split trick, `private`, `loopback`, and explicit `/8` boundaries.                                                                       |
| 4   | **Rightmost-hop XFF regression** — an implementation that keeps the leftmost token re-opens the residual spoof for trusted-peer deployments.   | Batch 3's `networkTrust.test.ts` includes the exact append-form case (`127.0.0.1, 203.0.113.9` → `203.0.113.9`) as a dedicated regression guard; `x-forwarded-for` stays first in `IP_HEADERS`.                                                                        |
| 5   | **`openapi.json` prettier gate** fails CI if the regenerated bundle is not formatted, or unrelated schema churn slips in.                      | Batch 9 runs `prettier --write packages/praxrr-api/openapi.json` after `bundle:api` and `git diff --stat` to confirm the diff is scoped to `proxy_trust`; never hand-edit `openapi.json`.                                                                              |

---

## Final verification (run in order — DESIGN §8.2)

Run from repo root with `~/.deno/bin` on PATH. All must be green before "done":

```
# 1. Targeted Shield suite — proxy_trust states, numeric invariance, route lockstep
deno task test security-posture

# 2. New trusted-proxy alias — pure module + config parse + network gate + route
deno task test trusted-proxy

# 3. Full type-check — check:server (deno check) + check:client (svelte-check); type-checks the engine
deno task check

# 4. Lint — prettier --check . && eslint .
deno task lint

# 5. Format — prettier --write . (satisfies the openapi.json + docs prettier gates)
deno task format
```

**What green looks like:**

- **(1)** All security-posture tests pass; `proxy_trust` present with `score: null` under default
  `AUTH=on`; the 95/hardened baseline is byte-identical; row 1 caps to `exposed` under `local`+non-loopback.
- **(2)** All four suites in the alias pass: table-driven parser + drift guard; config parse (incl.
  non-throwing malformed); network gate (untrusted→direct peer, trusted→rightmost hop, unresolvable→`'unknown'`);
  route `proxy_trust` presence.
- **(3)** `deno task check` reports no type errors — the grown `SecurityCheckId`/`CHECK_IDS`/`PostureInputs`
  contract and the bumped engine version compile across server + client.
- **(4)** `deno task lint` clean — no prettier diff, no eslint errors.
- **(5)** `deno task format` produces no further changes to already-formatted files (idempotent); the
  `openapi.json` mirror and touched `*.md` docs are prettier-clean.

If any step goes red, STOP and re-plan at the failing batch rather than pushing forward.
