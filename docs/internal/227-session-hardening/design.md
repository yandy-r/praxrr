# Issue #227 — Session Hardening — Design

> Status: design complete, ready to implement. Scope: session cookie transport posture + session-secret posture on the shipped Ecosystem Security Posture / Shield Check engine (#28, PR #220). Companion to #228 (proxy trust) and #229 (DNS-aware grading), both explicitly out of scope here.

## 1. Overview

The Shield Check engine grades control-plane auth, Arr transport, key-at-rest, credential rotation, and log redaction, but does **not** yet assess whether the session cookie's `Secure` flag and the session-secret configuration match the deployment's transport and auth mode. Today `PostureInputs.sessionCookieSecure` is a hardcoded `false` (`gather.ts:124`) that drives a single static `session_cookie_secure` advisory (`engine.ts:47`).

This change replaces that static boolean with a **request-derived, honest, unscored session posture** on the engine's existing advisory/assurance surface, and ships the real hardening deliverable: a `PRAXRR_COOKIE_SECURE=auto|on|off` config knob plus a shared cookie-options helper adopted by all four session-cookie set-sites, so the cookie is actually marked `Secure` when the request transport is observed to be secure.

Nothing scored changes. `SecurityCheckId`, `CHECK_IDS`, the rollup, every weight, every contribution, and every pinned score (95/64/59/85, `recoverablePoints` 40) stay byte-identical by construction. The `SECURITY_POSTURE_ENGINE_VERSION` constant bumps `'1'→'2'` to version the report-surface change.

## 2. Chosen approach + rationale

**Chosen: the advisory/assurance surface (Option A base), hardened with the threat-model-purist's honesty discipline (Option C). No new `SecurityCheckId`.**

Session posture lands entirely in `buildAdvisories()` and `buildAssurances()`, which are appended to the report **after** `rollUp` / `contributions` / `recoverablePoints` / `capBand` and never feed any of them (verified in `engine.ts:86–121`). This makes criterion 5's arithmetic exactness true _by construction_, not by careful bookkeeping.

### Why not Option B (first-class checks)

`session_cookie` as a first-class check is defensible, but `session_secret` as a first-class check is **dead surface**: this codebase has no cookie-signing secret, so the check can never produce a finding and can never score — it would be a permanent, versioned member of the closed `SecurityCheckId` union + the OpenAPI enum + a UI card with zero scoring logic and no failure branch. Its cited "mirror `log_redaction`" justification is false: `log_redaction` has a real regression path (score 0, weight 25, status `action`, caps the band); `session_secret` cannot regress. Promoting it is surface theater. Option B also forces an OpenAPI `SecurityCheckId` enum growth and a prettier-gated `openapi.json` regen for zero signal.

The advisory/assurance surface expresses the same four transport states through `Advisory.detail` and `Assurance.verified/note` with **no structural wire change** (advisory/assurance `id` fields are free strings; the `env-var` fix kind already exists), and it is the exact home the `Advisory` type's own doc-comment names: _"A real-but-unscored posture note whose exploitability Praxrr cannot observe (e.g. cookie Secure flag)."_

### Why not pure Option A (the critique's high finding)

Option A as originally proposed emitted a `verified:true` `session_cookie_secure` assurance for the **proxy-terminated** state ("known-encrypted edge"). Praxrr only observed a spoofable `X-Forwarded-Proto: https` header and cannot verify the external TLS leg (explicitly out of scope per the brief). Asserting `verified:true` there is a **false-safe** — the exact failure criterion 4 forbids, and it trespasses on #228's reserved boundary ("proxy-terminated is a distinct state, NOT blindly safe"). **This design grades proxy-terminated as a distinct, hedged, _non-verified_ advisory** and reserves the `verified:true` `session_cookie_secure` assurance for `direct-secure` only (where `url.protocol === 'https:'` and Praxrr itself serves TLS).

### Honesty discipline adopted from Option C, with its theater removed

- Keep the honest, static `session_secret` **assurance** (no invented `SESSION_SECRET`).
- **Drop** Option C's CSPRNG self-verify tripwire: `crypto.randomUUID()` is a platform CSPRNG that cannot regress via application code, so the tripwire has near-zero signal, and the claim that it "validates the same id-generation path `sessionsQueries.create` uses" is an overstatement (it exercises the primitive in isolation). No entropy probe is added.
- Flag `svelte.config.js`'s `csrf.trustedOrigins:['*']` as an out-of-scope, build-time, runtime-unobservable fact and **do not** assert SvelteKit's origin check is on; the `SameSite=Lax` claim is the honest, narrower one.

## 3. "session-secret" interpretation

This codebase has **no cookie-signing secret**: session ids are opaque server-side `crypto.randomUUID()` tokens (~122-bit) stored in the `sessions` table, and SvelteKit cookies are unsigned (verified by the brief's grep; no `SESSION_SECRET`, no HMAC key). The only session-adjacent secrets are the app API key (already graded by `app_key_at_rest`) and the OIDC client secret (graded via OIDC state).

Therefore:

- **We do not invent a session-secret env var.** Inventing one to "grade" would be the theater the issue warns against and the out-of-scope "replace the session implementation wholesale."
- Criterion 2 ("Session-secret findings detect missing or unsafe configuration **without exposing the value**") is satisfied honestly in two parts:
  1. A construction-verified `session_secret` **assurance** (`verified:true`) states the secretless model: _sessions use opaque, server-side, randomly-generated identifiers; the cookie carries no signing secret, so there is no session secret to be missing, weak, or leaked._ This surfaces the assessment **without exposing any value, because there is no value** — no session id, no derivative, only fixed prose.
  2. The genuinely observable **unsafe session configuration** — `PRAXRR_COOKIE_SECURE=on` over plaintext HTTP (Secure cookie dropped → login breaks), or `=off` despite HTTPS — is detected by the `session_cookie_transport` advisory (§5), which names the concrete env-var change to make.

## 4. Data model changes

### 4.1 `$shared/security/types.ts` (pure contracts)

Add three pure types:

```ts
/** How the request that triggered this report reached Praxrr (never probed; observed only). */
export type SessionTransport =
  'direct-secure' | 'proxy-terminated' | 'insecure' | 'unknown';

/** PRAXRR_COOKIE_SECURE intent: mark the session cookie Secure automatically / always / never. */
export type CookieSecureMode = 'auto' | 'on' | 'off';

/** Request-derived session posture. Unscored — drives advisories/assurances only. */
export interface SessionPosture {
  readonly transport: SessionTransport;
  /** Whether THIS request's session cookie would carry Secure (resolved from mode + transport). */
  readonly cookieSecure: boolean;
  /** Configured intent, so an advisory can name the concrete env-var change. */
  readonly cookieSecureMode: CookieSecureMode;
}
```

Replace the lone boolean on `PostureInputs` (line 179–180) — **replace, not layer beside**, per the no-dead-code rule:

```ts
// removed:
// readonly sessionCookieSecure: boolean;
// added:
/** Request-derived session posture (unscored; drives the session advisory/assurance surface). */
readonly session: SessionPosture;
```

`SecurityCheckId` and `CHECK_IDS` are **untouched** — the defining property of this design.

### 4.2 Version constant + docstring (`types.ts:17–22`)

```ts
/**
 * Stamped onto every ShieldReport. Bump whenever the check set, band thresholds, per-check score
 * formula, OR the unscored advisory/assurance report surface changes, so a client can tell a report
 * was produced by a different engine generation. Declared here ONCE.
 */
export const SECURITY_POSTURE_ENGINE_VERSION = '2';
```

The docstring is widened to authorize report-surface bumps, resolving the contract inconsistency a reviewer would otherwise (correctly) raise: today the docstring ties bumps to check-set/threshold/formula changes, none of which occur here. Both `engine.test.ts:38` and `securityPosture.test.ts:68` assert against the **constant**, and the OpenAPI schema types `engineVersion` as bare `type: string` with no `example` pin, so the bump requires no hardcoded-string test or schema edits.

## 5. Engine / advisory / assurance changes (`$shared/security/engine.ts`)

The `Advisory` shape is `{ id, label, detail: string[], fix: ShieldFix }` — **no structured tone/severity field** (confirmed against `types.ts:131–137`). Severity is conveyed through fixed-literal `detail` wording. Every emitted advisory carries a **non-`none`** fix (extends the actionability invariant to advisories).

`resolveCookieSecure(mode, transport)`: `on → true`, `off → false`, `auto → transport ∈ { 'direct-secure', 'proxy-terminated' }`. The gatherer sets `session.cookieSecure` to this value; the engine only reads `session`.

### 5.1 `buildAdvisories(inputs)` — keyed on `inputs.session`

Emits **at most one** `session_cookie_transport` advisory (id kept generic, not per-state, so UI keyed on it is stable). All `detail` strings are **fixed literals** — no host, no header value, and none of the scanned substrings (`password`, `api_key`, `deadbeef…`) ever appear. Every wording is scoped to _"for a request arriving over this transport"_, never a blanket "your session cookie is Secure" (the report reflects the report-viewer's transport, which can differ from a login request's).

| transport          | cookieSecure         | severity (in detail)   | emitted item                                                                                                                                                                                                                                                           | fix                                                                                                                           |
| ------------------ | -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `direct-secure`    | `true` (auto/on)     | —                      | **no advisory**; `session_cookie_secure` **assurance** (`verified:true`)                                                                                                                                                                                               | —                                                                                                                             |
| `direct-secure`    | `false` (mode `off`) | warning                | advisory: "PRAXRR_COOKIE_SECURE=off disables Secure even though this request arrived over direct HTTPS; the session cookie is sent without Secure."                                                                                                                    | `env-var` `PRAXRR_COOKIE_SECURE`, label "Set PRAXRR_COOKIE_SECURE=auto to mark the session cookie Secure over HTTPS"          |
| `proxy-terminated` | `true` (auto/on)     | informational (hedged) | advisory: "For a request arriving via a proxy reporting X-Forwarded-Proto: https, the session cookie is sent Secure. Praxrr cannot verify the proxy terminates TLS externally (see #228), so this is reported as trusted-termination, not confirmed-secure."           | `env-var` `PRAXRR_COOKIE_SECURE`, label "Set PRAXRR_COOKIE_SECURE=on to pin Secure if this proxy is trusted"                  |
| `proxy-terminated` | `false` (mode `off`) | warning                | advisory: "PRAXRR_COOKIE_SECURE=off while a proxy reports HTTPS; the session cookie is sent without Secure."                                                                                                                                                           | `env-var` `PRAXRR_COOKIE_SECURE`, label "Set PRAXRR_COOKIE_SECURE=auto or on"                                                 |
| `insecure`         | `false` (auto/off)   | warning                | advisory: "For a request arriving over plaintext HTTP, the session cookie is not marked Secure and crosses this observed ingress hop unprotected. Praxrr grades only this ingress hop; it cannot observe any upstream edge."                                           | `docs` (HTTPS deploy guide), label "Serve Praxrr behind HTTPS (PRAXRR_COOKIE_SECURE=auto then marks it Secure automatically)" |
| `insecure`         | `true` (mode `on`)   | warning (misconfig)    | advisory: "PRAXRR_COOKIE_SECURE=on but this request arrived over plaintext HTTP — browsers drop the Secure cookie, so login fails here. Set PRAXRR_COOKIE_SECURE=auto, or serve Praxrr behind HTTPS."                                                                  | `env-var` `PRAXRR_COOKIE_SECURE`, label "Set PRAXRR_COOKIE_SECURE=auto"                                                       |
| `unknown`          | `false` (auto/off)   | informational          | advisory: "Request transport could not be observed in this context (e.g. the MCP resource/tool path, which carries no HTTP request). The session cookie is treated as not Secure and never assumed safe. If Praxrr is served over HTTPS, set PRAXRR_COOKIE_SECURE=on." | `env-var` `PRAXRR_COOKIE_SECURE`, label "Set PRAXRR_COOKIE_SECURE=on if Praxrr is served over HTTPS"                          |
| `unknown`          | `true` (mode `on`)   | informational          | advisory: "PRAXRR_COOKIE_SECURE=on; transport is not observable in this context. If any request path is plaintext HTTP, the Secure cookie is dropped there and login fails."                                                                                           | `env-var` `PRAXRR_COOKIE_SECURE`, label "Set PRAXRR_COOKIE_SECURE=auto"                                                       |

The `insecure` non-misconfig fix is `docs` (not `env-var`), because forcing `=on` over real HTTP would break login; the honest concrete change is deploying TLS, mirroring the `arr_transport` plaintext precedent. The misconfig branch (`on` over HTTP) correctly recommends `=auto`.

### 5.2 `buildAssurances(inputs)` — three affirmations

Appended to the existing `log_redaction` and `arr_credentials_encrypted` assurances (the `verified:true` hardcoded pattern at `engine.ts:36–40` is the template):

1. **`session_secret`** — `verified:true`, note: _"Session identifiers are opaque, server-side, randomly generated tokens; the cookie carries no signing secret, so there is no session secret to be missing, weak, or leaked."_ Fixed literal; no value.
2. **`session_cookie_protections`** — `verified:true` (construction), note: _"The session cookie is HttpOnly (mitigates XSS token theft) and SameSite=Lax (mitigates cross-site request forgery)."_ Deliberately does **not** claim SvelteKit's origin check is enabled (`trustedOrigins:['*']` weakens it and is not runtime-observable).
3. **`session_cookie_secure`** — emitted **only** when `inputs.session.transport === 'direct-secure' && inputs.session.cookieSecure === true`, `verified:true`, note: _"For a request served over direct HTTPS, the session cookie is marked Secure."_ This is the sole state where Praxrr itself observed TLS and can honestly affirm it.

### 5.3 Arithmetic exactness (no special care needed)

`buildAdvisories`/`buildAssurances` never enter `weighted`, `rollup`, `contributions`, `recoverablePoints`, `totalScoredWeight`, or `capBand`. `checks[]`, `score`, `band`, `bandCappedBy`, `transport[]`, `topActions[]`, and every pinned value are unchanged. No edit to `checks.ts`, `catalog.ts`, or `policy.ts`.

## 6. New config, shared cookie helper, and the 4 set-site edits

### 6.1 `PRAXRR_COOKIE_SECURE` (`config.ts`)

New public field `cookieSecureMode: CookieSecureMode`, parsed in the constructor exactly like `authMode` (`config.ts:63–64`):

```ts
const cookieSecure = (Deno.env.get('PRAXRR_COOKIE_SECURE') || 'auto')
  .trim()
  .toLowerCase();
this.cookieSecureMode = (
  ['auto', 'on', 'off'].includes(cookieSecure) ? cookieSecure : 'auto'
) as CookieSecureMode;
```

Semantics:

- `on` — always set `Secure` (HTTPS-only deployments, including a TLS-terminating proxy that omits `X-Forwarded-Proto`).
- `off` — never set `Secure` (plain-http LAN / dev escape hatch, so a mis-detected proxy never breaks login).
- `auto` (default) — set `Secure` only when observed transport is `direct-secure` or `proxy-terminated`.

Invalid/empty → `auto` (fail-safe default). Optional: one-time `warn` on an unrecognized value.

**No `SESSION_SECRET` env var is introduced** (§3).

### 6.2 Shared helper — `$lib/server/utils/auth/sessionCookie.ts`

Single source of truth for cookie hardening, so the advisory can never disagree with what the cookie actually does:

```ts
export const SESSION_COOKIE_HTTPONLY = true;
export const SESSION_COOKIE_SAMESITE = 'lax' as const;

/** { request, url }-shaped context — accepts a RequestEvent or a minimal slice. */
export type CookieRequestContext = { request?: Request; url?: URL };

export function sessionCookieOptions(
  ctx: CookieRequestContext | undefined,
  expires: Date
) {
  const secure = resolveCookieSecure(
    config.cookieSecureMode,
    resolveSessionTransport(ctx)
  );
  return {
    path: '/',
    httpOnly: SESSION_COOKIE_HTTPONLY,
    sameSite: SESSION_COOKIE_SAMESITE,
    secure,
    expires,
  };
}
```

`resolveSessionTransport` and `resolveCookieSecure` come from the transport module (§7). The helper accepts a minimal `{ request, url }` slice rather than the full `RequestEvent`, keeping the login form-action call site clean.

### 6.3 The four set-site edits (all already have `event` in scope)

Each replaces the identical inline literal `{ path:'/', httpOnly:true, sameSite:'lax', secure:false, expires }` with `sessionCookieOptions(event, expires)`:

- `routes/auth/login/+page.server.ts:91` — `default: async (event)` (line 31).
- `routes/auth/oidc/callback/+server.ts:115` — `GET: async (event)` (line 18).
- `routes/auth/setup/+page.server.ts:87` — `default: async (event)` (line 22).
- `routes/api/v1/auth/webauthn/authentication/verify/+server.ts:129` — `POST: async (event)` (line 29).

`routes/auth/logout/+server.ts` (`cookies.delete('session',{path:'/'})`) is unchanged — deletion matches on name+path, unaffected by `Secure`.

After this change, hardening (`Secure` on a known-secure edge under `auto`/`on`) applies uniformly across all four, and no copy-pasted cookie literal remains to drift — the concrete "session hardening" deliverable.

## 7. Gatherer + request-transport threading (`$lib/server/security/`)

### 7.1 New module `$lib/server/security/sessionTransport.ts`

Mirrors `webauthn/rp.ts`'s pure-core + event-wrapper split (do not reinvent header parsing):

```ts
/** Request-derived signals needed to classify transport without a live event (unit-testable). */
export interface SessionTransportInfo {
  readonly urlProtocol: string | null; // event.url?.protocol
  readonly forwardedProto: string | null; // first comma token of x-forwarded-proto
}

/** Pure classification. */
export function observeSessionTransport(
  info: SessionTransportInfo
): SessionTransport {
  if (info.urlProtocol === 'https:') return 'direct-secure';
  if (info.forwardedProto === 'https') return 'proxy-terminated';
  if (info.urlProtocol === 'http:') return 'insecure';
  return 'unknown';
}

/** Event wrapper — FULLY optional-chained so a `{}` event yields 'unknown' and never throws. */
export function resolveSessionTransport(ctx?: {
  request?: Request;
  url?: URL;
}): SessionTransport {
  return observeSessionTransport({
    urlProtocol: ctx?.url?.protocol ?? null,
    forwardedProto: firstForwardedValue(
      ctx?.request?.headers?.get('x-forwarded-proto') ?? null
    ),
  });
}

/** on→true, off→false, auto→transport is direct-secure|proxy-terminated. Pure. */
export function resolveCookieSecure(
  mode: CookieSecureMode,
  transport: SessionTransport
): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return transport === 'direct-secure' || transport === 'proxy-terminated';
}
```

All pure: no `Date`, no `Math.random`, no DB. Every event access is optional-chained (`ctx?.url?.protocol`, `ctx?.request?.headers?.get`), so the route test's `{}` event and the MCP no-event path both resolve to `unknown` and can never `TypeError` → the GET catch can never turn this into a 500.

**Header signals only.** `resolveSessionTransport` reads **only** `x-forwarded-proto` (first comma token) and `url.protocol`. It never threads the raw `event`/`headers`/`Cookie` into `PostureInputs`, so the session id never enters the report.

**DRY note (recommended):** extract `rp.ts`'s private `firstForwardedValue` (lines 83–87) into a shared `$http`/`$utils` helper imported by both `rp.ts` and `sessionTransport.ts`, rather than copying the parser.

### 7.2 `gather.ts`

`buildPostureInputs(event?: { request?: Request; url?: URL })`:

```ts
const transport = resolveSessionTransport(event);
const cookieSecureMode = config.cookieSecureMode;
const cookieSecure = resolveCookieSecure(cookieSecureMode, transport);
// ...
session: { transport, cookieSecure, cookieSecureMode },   // replaces sessionCookieSecure: false
nowIso: new Date().toISOString(),                          // impure boundary stays here
```

Delete the hardcoded `sessionCookieSecure: false` line + comment (lines 123–124). Degrade-never-throw is preserved (the header read is optional-chained and cannot 500).

### 7.3 `service.ts`

```ts
export function computeShield(event?: { request?: Request; url?: URL }) {
  return computeShieldReport(buildPostureInputs(event));
}
```

Optional param keeps both MCP callers compiling unchanged.

## 8. Route + MCP wiring

- **`routes/api/v1/security-posture/summary/+server.ts`** — change `GET: async () =>` (line 18) to `GET: async (event) =>` and `computeShield()` to `computeShield(event)`. A browser viewing the report over http/https/behind-a-proxy is graded by its own transport; the route test's `{}` event yields `unknown`.
- **MCP** — `$lib/server/mcp/resources.ts:73` and `$lib/server/mcp/tools.ts:182` keep calling `computeShield()` with **no event**. There is genuinely no HTTP request context on the MCP path, so `transport` is honestly `unknown` (criterion 4). **No change to those files.**

## 9. Wire / OpenAPI / UI changes

**Structural wire impact: zero.**

- `responses.ts` — `WireAdvisory` = `{ id, label, detail, fix }`, `WireAssurance` = `{ id, label, verified, note }`, mapped generically (`responses.ts:163–168`, `193–194`). New advisory/assurance ids are free strings; the `env-var` fix kind already exists in the `ShieldFix`/wire enum. **No mapper edit.**
- `docs/api/v1/schemas/security-posture.yaml` — advisory/assurance `id` are `type: string` (not enums); `engineVersion` is bare `type: string` with no `example` pin. **No structural schema edit and no `openapi.json`/`types.ts` regen required** — a deliberate minimalist win (no `v1.d.ts` drift, no contract-lockstep churn).
- **Optional doc polish:** refresh the `SecurityAdvisory`/`SecurityAssurance` human descriptions to mention session posture. _If_ the YAML is touched, run `prettier --write` on `packages/praxrr-api/openapi.json` (prettier-gated in CI). Not required for correctness.
- **UI:** the `/security-posture` page iterates `advisories[]`/`assurances[]` and renders `fix` by kind; the richer advisory copy and the two/three new assurances render automatically. `{#if summary.advisories.length > 0}` already guards the panel. No client hardcoding to change.
- **Docs:** add `PRAXRR_COOKIE_SECURE=auto|on|off` to the env-var docs (CLAUDE.md env section / README).

## 10. Acceptance-criteria traceability

| #   | Criterion                                                                                                  | How it is met                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Cookie findings distinguish **direct secure transport**, **trusted termination**, and **insecure/unknown** | `SessionTransport` has exactly four buckets. `direct-secure` → `session_cookie_secure` **verified assurance**; `proxy-terminated` → distinct **hedged, non-verified** advisory ("trusted-termination, not confirmed-secure"); `insecure` and `unknown` → their own advisories. All four are distinguishable in the report (§5).                                                                                          |
| 2   | Session-secret findings detect **missing/unsafe config without exposing the value**                        | `session_secret` assurance affirms the secretless model with fixed prose and **no value to expose** (§3); the genuinely observable unsafe config (`PRAXRR_COOKIE_SECURE=on` over HTTP; `=off` over HTTPS) is detected by the `session_cookie_transport` advisory with a concrete env-var fix.                                                                                                                            |
| 3   | Recommendations identify a **concrete configuration change** per failing state                             | Every failing/attention advisory carries a non-`none` fix: `env-var PRAXRR_COOKIE_SECURE` for flag-vs-transport mismatches, `docs` (serve behind HTTPS) for genuinely insecure transport — and the same env var actually hardens the cookie via `sessionCookieOptions` (§6).                                                                                                                                             |
| 4   | **Unobservable states reported as `unknown`**, not safe or failed                                          | No request context (MCP resource/tool; route test `{}` event) → fully optional-chained `resolveSessionTransport` returns `unknown` → an advisory that explicitly says transport could not be observed and is "never assumed safe", with **no** `verified` affirmation. `proxy-terminated` is likewise never `verified` (§5.1).                                                                                           |
| 5   | **Shield-score arithmetic exact and versioned**                                                            | Session posture lives only in `advisories[]`/`assurances[]`, excluded from `weighted`/`rollup`/`contributions`/`recoverablePoints`/`capBand`; no `SecurityCheckId`/weight/threshold/formula change → 95/64/59/85, `recoverablePoints` 40, the contribution-sum invariant, and all band caps are byte-identical. `SECURITY_POSTURE_ENGINE_VERSION` bumps `'1'→'2'` (docstring widened to authorize report-surface bumps). |

## 11. Test plan

### Unit — pure engine (`tests/shared/security/engine.test.ts`)

- Update `makeInputs` (line ~30): swap `sessionCookieSecure: false` → `session: { transport: 'unknown', cookieSecure: false, cookieSecureMode: 'auto' }`.
- **Regression:** re-assert pinned scores (95/64/59/85), `recoverablePoints` 40, the contribution-sum invariant, and band caps are unchanged across all transport states; assert `report.engineVersion === SECURITY_POSTURE_ENGINE_VERSION` (i.e. `'2'`). Add a case proving `computeShieldReport({...direct-secure, mode:'on'}).score === computeShieldReport({...unknown}).score` (arithmetic exactness across transports).
- **Per-state advisory/assurance table:** for each `(transport × mode)` assert the emitted `session_cookie_transport` advisory (or its absence) and its `fix.kind`/`fix.name`; assert `direct-secure + cookieSecure` → `session_cookie_secure` assurance `verified:true` and **no** advisory; assert `proxy-terminated + cookieSecure` → advisory present and **no** `session_cookie_secure` assurance (false-safe guard); assert `session_secret` and `session_cookie_protections` assurances are always present and `verified:true`.
- **Extended actionability invariant:** every `advisory.fix.kind !== 'none'` (advisories aren't in `checks[]`, so the existing check-scoped invariant misses them).
- Keep the "report never carries a secret" test green; assert none of the new strings contain `password`/`api_key`/`deadbeef…`.

### Unit — `checks.test.ts`

- Update its `makeInputs` (line ~30) to the same `session: {…}` shape (checks don't read `session`, but the `PostureInputs` type requires it; **omitting this fails `deno check`**).

### Unit — transport + cookie helper (new files)

- `tests/server/security/sessionTransport.test.ts`: `observeSessionTransport` truth table (`https:`→`direct-secure`; `http:` + `x-forwarded-proto: https`→`proxy-terminated`; `http:` no forwarded→`insecure`; empty→`unknown`; comma-chained `x-forwarded-proto` takes the first token). `resolveCookieSecure` full `mode × transport` truth table. `resolveSessionTransport(undefined)` and `resolveSessionTransport({})` both return `unknown` and never throw.
- `tests/server/utils/auth/sessionCookie.test.ts`: `sessionCookieOptions` returns `secure:true` for `on` and for `auto` over `direct-secure`/`proxy-terminated`; `secure:false` for `auto` over `insecure`/`unknown` and for `off`; otherwise the canonical `{ path:'/', httpOnly:true, sameSite:'lax', expires }`.

### Route (`tests/routes/securityPosture.test.ts`)

- Existing `{}`-event assertions pass unchanged: `body.checks.map(id) === [...CHECK_IDS]` (still 5), contribution-sum survives wire mapping, no secret/planted sentinel.
- Add: `{}` event → `advisories` contains a `session_cookie_transport` item reporting transport `unknown`; `assurances` contains `session_secret` (`verified`); `engineVersion === '2'`.
- Add: a synthetic event with `url.protocol === 'https:'` → the transport advisory is absent and `session_cookie_secure` assurance is present (`direct-secure`).

### Config

- `PRAXRR_COOKIE_SECURE` parse: `auto`/`on`/`off` map through; invalid/empty → `auto`.

### Commands / manual

- `deno task test security-posture`; `deno task check`. If OpenAPI descriptions are touched, `prettier --write packages/praxrr-api/openapi.json`.
- Manual: login over plain-http LAN (default `auto`) → cookie **not** Secure, session works; behind a TLS proxy sending `x-forwarded-proto: https` → cookie Secure, session works; `PRAXRR_COOKIE_SECURE=on` over http → `/security-posture` shows the `session_cookie_transport` advisory with the `=auto` fix and the login cookie is dropped as predicted.

## 12. Non-goals (explicit)

- **#228 (explicit proxy trust) is NOT built here.** No trusted-proxy list, no `TRUST_PROXY`, no IP allowlist. `X-Forwarded-Proto` is honored **only to _enable_ `Secure`**, which is safe-by-construction (a spoofed `https` header over real http makes the browser drop the Secure cookie → loud, self-correcting login failure, never a silent downgrade), so the cookie behavior does not depend on #228. On the **grading** side, `proxy-terminated` is a distinct, conservatively-graded, **non-verified** state — never blindly "safe."
- **#229 (DNS-aware transport grading)** — out of scope.
- **Probing external TLS termination** — out of scope; the external leg past a proxy is unobservable and never asserted.
- **Rotating secrets automatically / inventing a `SESSION_SECRET` / replacing the auth/session implementation** — out of scope; the secretless model is reported honestly, not changed.
- **`svelte.config.js` `csrf.trustedOrigins:['*']`** — a genuine app-wide CSRF weakening, but a build-time constant not readable from `$config`, so it is unobservable at runtime and deliberately **not** asserted as protected (the `SameSite=Lax` assurance is the honest, narrower claim). Flagged as a separate follow-up, not addressed here.

## 13. File-by-file change list

| File                                                                                              | Change                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$shared/security/types.ts`                                                                       | Add `SessionTransport`, `CookieSecureMode`, `SessionPosture`; replace `PostureInputs.sessionCookieSecure` with `session: SessionPosture`; bump `SECURITY_POSTURE_ENGINE_VERSION` `'1'→'2'` and widen its docstring. `SecurityCheckId`/`CHECK_IDS` untouched.                     |
| `$shared/security/engine.ts`                                                                      | `buildAdvisories`: transport-aware `session_cookie_transport` logic keyed on `inputs.session` (§5.1). `buildAssurances`: add `session_secret`, `session_cookie_protections`, and conditional `session_cookie_secure` (direct-secure only). No rollup/contribution/policy change. |
| `$lib/server/security/sessionTransport.ts`                                                        | **New.** Pure `observeSessionTransport`, optional-chained `resolveSessionTransport(ctx?)`, pure `resolveCookieSecure(mode, transport)`, plus `SessionTransportInfo`.                                                                                                             |
| `$lib/server/utils/auth/sessionCookie.ts`                                                         | **New.** `SESSION_COOKIE_HTTPONLY`, `SESSION_COOKIE_SAMESITE`, `sessionCookieOptions(ctx, expires)` (single source of truth for cookie hardening).                                                                                                                               |
| `$lib/server/security/gather.ts`                                                                  | `buildPostureInputs(event?)`; compute `transport`/`cookieSecureMode`/`cookieSecure`; set `session:{…}`; delete hardcoded `sessionCookieSecure:false` (lines 123–124).                                                                                                            |
| `$lib/server/security/service.ts`                                                                 | `computeShield(event?)` forwards to `buildPostureInputs(event)`.                                                                                                                                                                                                                 |
| `routes/api/v1/security-posture/summary/+server.ts`                                               | `GET: async (event)` → `computeShield(event)`.                                                                                                                                                                                                                                   |
| `routes/auth/login/+page.server.ts:91`                                                            | Inline cookie literal → `sessionCookieOptions(event, expires)`.                                                                                                                                                                                                                  |
| `routes/auth/oidc/callback/+server.ts:115`                                                        | Same.                                                                                                                                                                                                                                                                            |
| `routes/auth/setup/+page.server.ts:87`                                                            | Same.                                                                                                                                                                                                                                                                            |
| `routes/api/v1/auth/webauthn/authentication/verify/+server.ts:129`                                | Same (`event.cookies.set(... sessionCookieOptions(event, expires))`).                                                                                                                                                                                                            |
| `config.ts`                                                                                       | Add `cookieSecureMode: CookieSecureMode`, parsed `PRAXRR_COOKIE_SECURE` (auto/on/off, default auto).                                                                                                                                                                             |
| `webauthn/rp.ts` + `$http`/`$utils`                                                               | _(Recommended, DRY)_ extract `firstForwardedValue` into a shared helper imported by `rp.ts` and `sessionTransport.ts`.                                                                                                                                                           |
| `mcp/resources.ts`, `mcp/tools.ts`                                                                | **No change** — no event → `unknown` (criterion 4).                                                                                                                                                                                                                              |
| `responses.ts`, `security-posture.yaml`, `openapi.json`, `types.ts` (api)                         | **No structural change.** Optional doc-description polish → then `prettier --write openapi.json`.                                                                                                                                                                                |
| `tests/shared/security/engine.test.ts`, `checks.test.ts`                                          | Update both `makeInputs` to `session:{…}`; add advisory/assurance/actionability/exactness cases (§11).                                                                                                                                                                           |
| `tests/routes/securityPosture.test.ts`                                                            | Add `{}`→unknown and synthetic-https cases; assert `engineVersion === '2'` (§11).                                                                                                                                                                                                |
| `tests/server/security/sessionTransport.test.ts`, `tests/server/utils/auth/sessionCookie.test.ts` | **New.** Pure truth tables (§11).                                                                                                                                                                                                                                                |
| CLAUDE.md env section / README                                                                    | Document `PRAXRR_COOKIE_SECURE`.                                                                                                                                                                                                                                                 |
