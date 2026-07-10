# Issue #227 — Session Hardening — Implementation Plan

> Derived from `docs/internal/227-session-hardening/design.md`. This plan resolves every `mustFix` and every non-empty gap/conflict/risk from the adversarial validation while staying faithful to the design. Key corrections applied: (1) Batch J's new test dirs are registered in `scripts/test.ts` and the config parse is made unit-testable; (2) the whole-graph `deno task check` gate is deferred to the atomic `A+F+G` completion point, with targeted single-file checks used earlier; (3) a pure `parseCookieSecureMode` helper + test covers `PRAXRR_COOKIE_SECURE` parsing; (4) the CI mechanism is corrected — `deno check` excludes `tests/**`, so `makeInputs` staleness is caught by `deno test`, not `deno check`; (5) Batch B references the correct **two** `rp.ts` call-sites.

## 1. Scope recap

Replace the hardcoded `PostureInputs.sessionCookieSecure: false` with a request-derived, honest, **unscored** `SessionPosture`, and ship the real hardening deliverable: a `PRAXRR_COOKIE_SECURE=auto|on|off` knob plus a single shared cookie-options helper adopted by all four session-cookie set-sites. Nothing scored changes (95/64/59/85, `recoverablePoints` 40, all weights/caps byte-identical); `SECURITY_POSTURE_ENGINE_VERSION` bumps `'1'→'2'`.

## 2. Batch table

| id    | title                                                                             | dependsOn  | files                                                                                                                                                                                                                                                                            | parallelizable-with |
| ----- | --------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **A** | Shared contracts: session types + engine-version bump                             | —          | `packages/praxrr-app/src/lib/shared/security/types.ts`                                                                                                                                                                                                                           | B (and M if run)    |
| **B** | DRY: extract `firstForwardedValue` into a shared `$http` helper                   | —          | `packages/praxrr-app/src/lib/server/utils/http/forwardedHeader.ts`, `packages/praxrr-app/src/lib/server/webauthn/rp.ts`                                                                                                                                                          | A (and M if run)    |
| **C** | Config: `PRAXRR_COOKIE_SECURE` knob + pure parse helper                           | A          | `packages/praxrr-app/src/lib/server/utils/config/config.ts`                                                                                                                                                                                                                      | D, F, I             |
| **D** | New pure session-transport module                                                 | A, B       | `packages/praxrr-app/src/lib/server/security/sessionTransport.ts`                                                                                                                                                                                                                | C, F, I             |
| **F** | Engine: transport-aware advisory + three assurances                               | A          | `packages/praxrr-app/src/lib/shared/security/engine.ts`                                                                                                                                                                                                                          | C, D, I             |
| **I** | Update pure engine + checks tests                                                 | A, F       | `packages/praxrr-app/src/tests/shared/security/engine.test.ts`, `packages/praxrr-app/src/tests/shared/security/checks.test.ts`                                                                                                                                                   | C, D, F             |
| **E** | New shared session-cookie options helper                                          | C, D       | `packages/praxrr-app/src/lib/server/utils/auth/sessionCookie.ts`                                                                                                                                                                                                                 | G, L                |
| **G** | Gatherer, service, and summary route event threading                              | A, C, D, F | `packages/praxrr-app/src/lib/server/security/gather.ts`, `packages/praxrr-app/src/lib/server/security/service.ts`, `packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts`                                                                                   | E, L                |
| **L** | Document `PRAXRR_COOKIE_SECURE`                                                   | C          | `CLAUDE.md`, `README.md`                                                                                                                                                                                                                                                         | E, G                |
| **H** | Adopt `sessionCookieOptions` at all four cookie set-sites                         | E          | `packages/praxrr-app/src/routes/auth/login/+page.server.ts`, `packages/praxrr-app/src/routes/auth/oidc/callback/+server.ts`, `packages/praxrr-app/src/routes/auth/setup/+page.server.ts`, `packages/praxrr-app/src/routes/api/v1/auth/webauthn/authentication/verify/+server.ts` | J, K                |
| **J** | New pure unit tests (transport, cookie helper, config parse) + register test dirs | C, D, E    | `packages/praxrr-app/src/tests/server/security/sessionTransport.test.ts`, `packages/praxrr-app/src/tests/server/utils/auth/sessionCookie.test.ts`, `packages/praxrr-app/src/tests/server/utils/config/cookieSecureMode.test.ts`, `scripts/test.ts`                               | H, K                |
| **K** | Extend the security-posture route test                                            | G          | `packages/praxrr-app/src/tests/routes/securityPosture.test.ts`                                                                                                                                                                                                                   | H, J                |
| **M** | _(Optional, skipped by default)_ OpenAPI description polish                       | —          | `docs/api/v1/schemas/security-posture.yaml`, `packages/praxrr-api/openapi.json`                                                                                                                                                                                                  | A, B                |

File ownership is fully disjoint within every wave; no file appears in two batches. All five `sessionCookieSecure` references (types.ts→A, engine.ts→F, gather.ts→G, engine.test.ts + checks.test.ts→I) are each owned exactly once and are all downstream of A.

## 3. Per-batch work steps + verify

### Batch A — Shared contracts

**Work**

1. Add `SessionTransport`, `CookieSecureMode`, and `interface SessionPosture { transport; cookieSecure; cookieSecureMode }` with the doc-comments from design §4.1.
2. In `PostureInputs` (lines 179–180) **REPLACE** `readonly sessionCookieSecure: boolean` with `readonly session: SessionPosture` (remove, do not layer beside — no-dead-code rule).
3. Leave `SecurityCheckId` (30–31) and `CHECK_IDS` (34–40) untouched.
4. Bump `SECURITY_POSTURE_ENGINE_VERSION` (line 22) `'1'→'2'` and widen its docstring to authorize report-surface bumps (design §4.2).

**Verify**

- Grep: `session: SessionPosture` present, `sessionCookieSecure` absent from `types.ts`.
- Grep: `SECURITY_POSTURE_ENGINE_VERSION = '2'`; `SecurityCheckId`/`CHECK_IDS` unchanged in `git diff`.
- Targeted `deno check packages/praxrr-app/src/lib/shared/security/types.ts` passes (`types.ts` still imports only `type NarrationLine`; checking a file follows its imports, not its importers, so this is green before F/G land).
- **Do NOT run whole-graph `deno task check` here** — it globs all of `lib/server`, where `gather.ts` still references the removed field until G (see §4).

### Batch B — DRY `firstForwardedValue`

**Work**

1. Create `forwardedHeader.ts` exporting `firstForwardedValue(headerValue: string | null): string | null`, moving `rp.ts` lines 83–87 verbatim.
2. In `rp.ts` delete the private `firstForwardedValue` (lines 83–87) and import it from `$http/forwardedHeader.ts`. There are exactly **two** call-sites (lines 95 and 97 — `x-forwarded-host` and `x-forwarded-proto`); both keep working unchanged. (Correction: the draft said "three call-sites" — there is no third.)
3. This lets `sessionTransport.ts` (Batch D) reuse the one parser instead of copying it (design §7.1 DRY note).

**Verify**

- Targeted `deno check packages/praxrr-app/src/lib/server/webauthn/rp.ts` passes.
- `deno test packages/praxrr-app/src/tests/... ` for webauthn RP tests green (run whatever existing rp test dir/file covers `rp.ts`).
- Grep: exactly one `function firstForwardedValue` definition repo-wide (in `forwardedHeader.ts`).

### Batch C — Config knob + pure parse helper

**Work**

1. Add `public readonly cookieSecureMode: CookieSecureMode` with a **type-only** import from `$shared/security/types.ts` (`import type { CookieSecureMode }` — no runtime cycle).
2. Add an exported pure helper so the parse is unit-testable without `Deno.env` mutation (resolves the missing config test cleanly and satisfies fail-fast-at-boundaries):
   ```ts
   export function parseCookieSecureMode(
     raw: string | undefined
   ): CookieSecureMode {
     const v = (raw ?? 'auto').trim().toLowerCase();
     return (
       ['auto', 'on', 'off'].includes(v) ? v : 'auto'
     ) as CookieSecureMode;
   }
   ```
3. In the constructor, mirror the `authMode` pattern (lines 63–64): `this.cookieSecureMode = parseCookieSecureMode(Deno.env.get('PRAXRR_COOKIE_SECURE'))`. Invalid/empty/unset → `auto` (fail-safe).
4. Introduce **no** `SESSION_SECRET` env var (design §3).

**Verify**

- Targeted `deno check packages/praxrr-app/src/lib/server/utils/config/config.ts` passes (type-only import, no cycle).
- Parse-behavior proven by Batch J's `cookieSecureMode.test.ts` (`auto`/`on`/`off`/`AUTO`/`" on "` map; `garbage`/`""`/`undefined`→`auto`).
- **Do NOT run whole-graph `deno task check` here** (gather.ts still stale until G).

### Batch D — Pure session-transport module

**Work**

1. Create `SessionTransportInfo`, pure `observeSessionTransport(info)` per design §7.1: `urlProtocol==='https:'`→`direct-secure`; `forwardedProto==='https'`→`proxy-terminated`; `urlProtocol==='http:'`→`insecure`; else `unknown`.
2. `resolveSessionTransport(ctx?)` fully optional-chained (`ctx?.url?.protocol ?? null`, `ctx?.request?.headers?.get('x-forwarded-proto') ?? null`) using `firstForwardedValue` from `$http/forwardedHeader.ts`; `undefined`/`{}` → `unknown`, never throws.
3. `resolveCookieSecure(mode, transport)`: `on`→`true`, `off`→`false`, `auto`→`transport ∈ {direct-secure, proxy-terminated}`. No `Date`/`Math.random`/DB.
4. Reads only `x-forwarded-proto` (first comma token) + `url.protocol`; never threads raw headers/`Cookie` into anything downstream.

**Verify**

- Targeted `deno check packages/praxrr-app/src/lib/server/security/sessionTransport.ts` passes (imports `forwardedHeader.ts` + `type` from `types.ts`, both consistent).
- Grep: no `Date`, `Math.random`, or `db` import in this file.
- Truth-table behavior proven by Batch J.
- **Do NOT run whole-graph `deno task check` here.**

### Batch F — Engine advisory/assurance

**Work**

1. Rewrite `buildAdvisories(inputs)` (lines 44–59) keyed on `inputs.session`: emit **at most one** `session_cookie_transport` advisory per the 7-row table (design §5.1); fixed-literal `detail`; every emitted advisory has a **non-`none`** fix; **no** advisory for `direct-secure + cookieSecure===true`. No host/header/secret substrings (`password`/`api_key`/`deadbeef…` must never appear).
2. Extend `buildAssurances` (lines 25–42): append `session_secret` (`verified:true`, secretless-model prose), `session_cookie_protections` (`verified:true`, HttpOnly + SameSite=Lax, **no** origin-check claim), and `session_cookie_secure` **only** when `transport==='direct-secure' && cookieSecure===true`.
3. Do **not** touch `computeShieldReport` rollup (86–122), `checks.ts`, `catalog.ts`, or `policy.ts`.

**Verify**

- Targeted `deno check packages/praxrr-app/src/lib/shared/security/engine.ts` passes (engine reads `inputs.session`; type consistent after A).
- Grep new literals: no `password`/`api_key`/`deadbeef`.
- Behavior/score-invariance proven by Batch I.
- **Do NOT run whole-graph `deno task check` here** (gather.ts still stale until G).

### Batch I — Pure engine + checks tests

> Note (corrected CI mechanism): `tsconfig.json` excludes `packages/praxrr-app/src/tests/**` and `check:server` globs only `lib/server`, so **`deno check` never type-checks these files**. A stale `makeInputs` is caught by **`deno test`**, not `deno check`. Both `makeInputs` are still updated here so the type requirement is satisfied when the tests compile under `deno test`.

**Work**

1. Both `makeInputs` (line ~30 each): swap `sessionCookieSecure: false` → `session: { transport: 'unknown', cookieSecure: false, cookieSecureMode: 'auto' }` (`checks.ts` doesn't read `session`, but the `PostureInputs` type requires it).
2. `engine.test`: re-assert pinned scores 95/64/59/85, `recoverablePoints` 40, contribution-sum invariant, and band caps unchanged **across all transport states**; add `computeShieldReport({…direct-secure, mode:'on'}).score === computeShieldReport({…unknown}).score`; assert `report.engineVersion === SECURITY_POSTURE_ENGINE_VERSION` (now `'2'`).
3. Add per-`(transport × mode)` advisory/assurance assertions: `direct-secure + cookieSecure` → `session_cookie_secure` verified & no advisory; `proxy-terminated + cookieSecure` → advisory present & **no** `session_cookie_secure` (false-safe guard); `session_secret` + `session_cookie_protections` always `verified:true`; each emitted advisory's `fix.kind`/`fix.name` matches §5.1.
4. Add the advisory actionability invariant (`advisory.fix.kind !== 'none'` for every advisory); keep the "report never carries a secret" test green; assert new strings lack `password`/`api_key`/`deadbeef`.

**Verify**

- **Scoped** `deno test packages/praxrr-app/src/tests/shared/security/engine.test.ts packages/praxrr-app/src/tests/shared/security/checks.test.ts` green. (Run the scoped paths, **not** the full `security-posture` alias — the alias includes `securityPosture.test.ts`, which imports the route → `gather.ts` and will not compile until G lands.)
- Pinned-score assertions prove criterion 5.

### Batch E — Shared session-cookie options helper

**Work**

1. Export `SESSION_COOKIE_HTTPONLY = true`, `SESSION_COOKIE_SAMESITE = 'lax' as const`, and `type CookieRequestContext = { request?: Request; url?: URL }`.
2. `sessionCookieOptions(ctx: CookieRequestContext | undefined, expires: Date)` → `{ path:'/', httpOnly, sameSite, secure, expires }` where `secure = resolveCookieSecure(config.cookieSecureMode, resolveSessionTransport(ctx))`; import from `$lib/server/security/sessionTransport.ts` and `$config`.
3. Single source of truth so the advisory can never disagree with the cookie.

**Verify**

- Whole-graph `deno task check` passes **at this point only if G has also landed** (see §4). If E completes before G within the wave, run targeted `deno check packages/praxrr-app/src/lib/server/utils/auth/sessionCookie.ts`; assert the whole-graph gate at the wave-3 boundary.
- Behavior proven by Batch J (secure true/false matrix + canonical fields).

### Batch G — Gatherer, service, summary route (atomic compile unit with A+F)

**Work**

1. `gather.ts`: `buildPostureInputs(event?: { request?: Request; url?: URL })`; import `resolveSessionTransport`/`resolveCookieSecure`; compute `transport`/`cookieSecureMode`/`cookieSecure`; replace the deleted `sessionCookieSecure: false` (lines 123–124 + comment) with `session: { transport, cookieSecure, cookieSecureMode }`; keep `nowIso: new Date().toISOString()`; degrade-never-throw preserved (header read is optional-chained).
2. `service.ts`: `computeShield(event?)` forwarding `buildPostureInputs(event)`; MCP no-arg callers still compile.
3. `summary/+server.ts`: `GET: async ()` (line 18) → `async (event)`; `computeShield()` (line 20) → `computeShield(event)`.
4. Do **not** touch `mcp/resources.ts` or `mcp/tools.ts` (no event → honest `unknown`).

**Verify**

- **Whole-graph `deno task check` passes here for the first time** — A+F+G are the atomic compile unit; after G repairs `gather.ts`, no stale `sessionCookieSecure` reference survives anywhere in `lib/server` or `$shared`.
- `deno test packages/praxrr-app/src/tests/routes/securityPosture.test.ts` type-checks the summary `+server.ts` (routes are excluded from `deno check`; `deno test <dir>` compiles them). Existing `{}` cases still pass.
- MCP callers compile unchanged.

### Batch L — Docs

**Work**

1. Add `PRAXRR_COOKIE_SECURE=auto|on|off` (default `auto`) to the Environment Variables sections of `CLAUDE.md` and `README.md` with `auto`/`on`/`off` semantics (design §6.1).
2. Run `prettier --write` (docs/shell style bundle) on both; the `*.md` `printWidth:80` override rewraps content and README's env addition lands in a markdown table that prettier realigns. Docs prettier is CI-gated.

**Verify**

- `lint-docs`/docs prettier gate reports `CLAUDE.md` and `README.md` clean.
- Both env tables include the new knob.

### Batch H — Adopt the helper at four set-sites

**Work**

1. Replace the inline `{ path:'/', httpOnly:true, sameSite:'lax', secure:false, expires }` literal with `sessionCookieOptions(event, expires)` from `$auth/sessionCookie.ts`. `event` is confirmed in scope at each site: login `+page.server.ts:91` (`default: async (event)` @31), oidc `callback/+server.ts:115` (`GET: async (event)` @18), setup `+page.server.ts:87` (`default: async (event)` @22), webauthn `verify/+server.ts:129` (`POST: async (event)` @29, uses `event.cookies.set`).
2. Leave `logout/+server.ts` `cookies.delete('session',{path:'/'})` unchanged (deletion is `Secure`-independent).

**Verify**

- Whole-graph `deno task check` passes; grep: **no remaining `secure:false` cookie literal** in these four routes (this grep is the standing regression guard against a site drifting back to a hardcoded literal).
- `deno test` over the auth route test dirs type-checks these files.
- Manual: plain-http default `auto` → cookie **not** `Secure`; proxy `x-forwarded-proto: https` → `Secure`.

### Batch J — New pure unit tests + register test dirs (resolves the alias gap and config-parse gap)

**Work**

1. `sessionTransport.test.ts`: `observeSessionTransport` truth table (`https:`→`direct-secure`; `http:`+`xfp https`→`proxy-terminated`; `http:`+none→`insecure`; empty→`unknown`; comma-chained `x-forwarded-proto` takes the first token); `resolveCookieSecure` full `mode × transport`; `resolveSessionTransport(undefined)` and `({})` → `unknown`, never throw.
2. `sessionCookie.test.ts`: `sessionCookieOptions` → `secure:true` for `on` and for `auto` over `direct-secure`/`proxy-terminated`; `secure:false` for `auto` over `insecure`/`unknown` and for `off`; canonical `{ path:'/', httpOnly:true, sameSite:'lax', expires }` otherwise.
3. `cookieSecureMode.test.ts`: import `parseCookieSecureMode` from `$config` and assert `auto`/`on`/`off`/`AUTO`/`" on "` → mapped mode; `garbage`/`""`/`undefined` → `auto` (the fail-safe fallback required by design §11 "Config").
4. **Register the new dirs in `scripts/test.ts`**: extend the `security-posture` alias (lines 37–38) to append `packages/praxrr-app/src/tests/server/security`, `packages/praxrr-app/src/tests/server/utils/auth`, and `packages/praxrr-app/src/tests/server/utils/config`. Without this, `deno task test security-posture` — the command the plan cites to prove criteria 1 and 4 — silently would not run these files.

**Verify**

- `deno task test security-posture` now executes all three new files and stays green.
- Proves criteria 1 (four transport buckets) and 4 (unobservable → `unknown`, never throws), plus the `PRAXRR_COOKIE_SECURE` parse fail-safe.

### Batch K — Extend route test

**Work**

1. Keep existing `{}` assertions (`checks.map(id) === [...CHECK_IDS]` = 5; contribution-sum survives wire mapping; no secret/sentinel).
2. Add: `{}` event → `advisories` has `session_cookie_transport` reporting transport `unknown`; `assurances` has `session_secret` (`verified`); `engineVersion === '2'`.
3. Add a synthetic event with `url.protocol === 'https:'` (extend `summaryEvent()` to accept an override; a minimal `{ url: new URL(...), request: new Request(...) }` cast to the handler's event type is acceptable — the handler only reads `event.url`/`event.request`) → transport advisory absent and `session_cookie_secure` assurance present.

**Verify**

- `deno task test security-posture` green; this run also type-checks the summary `+server.ts` (routes excluded from `deno check`, covered by `deno test <dir>`).

### Batch M — _(Optional, skipped by default)_

Skip by default: advisory/assurance `id` are `type: string` (not enums), `engineVersion` is bare `type: string` with no `example`, and the `env-var`/`docs` fix kinds already exist — so `openapi.json` stays byte-identical and its prettier gate stays green with zero action. If chosen: refresh only the `SecurityAdvisory`/`SecurityAssurance` **description** text in the YAML, then `deno task bundle:api` + `prettier --write packages/praxrr-api/openapi.json`; do not alter enums/required/types.

## 4. Execution order

`deno task check` (whole-graph `check:server`) **cannot pass** between the moment Batch A renames `PostureInputs.sessionCookieSecure→session` and the moment Batch G repairs `gather.ts` — `check:server` globs all of `lib/server` and follows imports into `$shared/engine.ts`. **A + F + G are one atomic compile unit.** Earlier batches use targeted single-file `deno check <file>` (which follows a file's imports, not its importers) and scoped `deno test`; the whole-graph gate is asserted only at the wave-3 boundary (once G lands) and after.

- **Wave 1 (parallel, disjoint):** **A**, **B** (+ **M** only if explicitly chosen). Gate: targeted `deno check` per file; RP tests for B.
- **Wave 2 (parallel, disjoint; all depend on Wave 1):** **C**, **D**, **F**, **I**. Gate: targeted `deno check` per non-test file (A/C/D/F); scoped `deno test .../shared/security/{engine,checks}.test.ts` for I. **No whole-graph `deno task check` yet.**
- **Wave 3 (parallel, disjoint):** **E** [C,D], **G** [A,C,D,F], **L** [C]. At the **end of this wave**, run the whole-graph `deno task check` for the first time — it now passes (gather repaired; `sessionCookie.ts` exists but is not yet imported, which compiles). Docs prettier gate for L.
- **Wave 4 (parallel, disjoint):** **H** [E], **J** [C,D,E], **K** [G]. Then final `deno task check` + `deno task build` (build compiles the full SvelteKit route graph including H's edited routes) + `deno task test security-posture`.

> `G:[A,C,D,F]` lists F even though `gather.ts` does not import `engine.ts`; this is intentional conservatism so the first whole-graph check runs only after the entire atomic unit exists. Harmless.

## 5. CI-gate checklist

- [ ] **`deno task check` (app-check / `check:server`)** — globs `lib/server/**/*.ts` and follows imports into `$shared`; **excludes `packages/praxrr-app/src/tests/**`** (per `tsconfig.json`) and does not type-check route files. Asserted **only at the Wave-3 boundary (after G) and in Wave 4** — never mid-sequence between A and G. Covers `types.ts`, `engine.ts`, `gather.ts`, `service.ts`, `config.ts`, `sessionTransport.ts`, `sessionCookie.ts`, `forwardedHeader.ts`, `rp.ts`.
- [ ] **Route type-check** — the summary `+server.ts` and the four auth set-site routes are type-checked when their test dirs run under `deno test` (Batch K imports the summary route; Batch H's routes via their auth route tests) and by `deno task build`. Routes are excluded from `deno check`.
- [ ] **Test type-check + execution** — `makeInputs` staleness and every new test file are validated by **`deno test`** (not `deno check`, which excludes `tests/**`). `deno task test security-posture` runs Batches I, K, and — after Batch J's alias extension — J's three new files.
- [ ] **`prettier` docs / `lint-docs`** — only `CLAUDE.md` and `README.md` are edited (Batch L); both are `prettier --write` through the docs/shell bundle honoring the `*.md printWidth:80` override, run before commit.
- [ ] **`deno task build`** — after Wave 4, compiles the full SvelteKit app graph (event-threaded service + cookie helper + adopted set-sites).
- [ ] **`openapi.json` prettier gate** — untouched by default (no structural schema change) → green with no action. Only Batch M (opt-in) runs `deno task bundle:api` + `prettier --write packages/praxrr-api/openapi.json`.

## 6. Acceptance-criteria traceability

| #   | Criterion                                                                            | How met                                                                                                                                                                                                                                                                                                     | Proven by                                                                                              |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Cookie findings distinguish direct-secure / trusted-termination / insecure / unknown | Four `SessionTransport` buckets (A) produced by `observeSessionTransport` (D), rendered by `buildAdvisories`/`buildAssurances` (F): `direct-secure`→verified `session_cookie_secure` assurance; `proxy-terminated`→distinct hedged non-verified advisory; `insecure`/`unknown`→own advisories               | I (per-state table) + **J (transport truth table, now in-alias)** + K (route https vs `{}`)            |
| 2   | Session-secret detected without exposing a value                                     | Fixed-prose `session_secret` assurance affirms the secretless model — no value exists to leak (design §3); genuinely unsafe observable config (`=on` over HTTP, `=off` over HTTPS) surfaces via `session_cookie_transport` advisory with concrete env-var fix                                               | I assurance/advisory assertions + never-carries-a-secret test kept green                               |
| 3   | Concrete config change per failing state                                             | Every emitted advisory carries a non-`none` fix (`env-var PRAXRR_COOKIE_SECURE` for flag/transport mismatch, `docs` HTTPS-deploy for genuinely insecure transport); the same env var actually hardens the cookie via `sessionCookieOptions` at all four set-sites (C/E/H)                                   | I advisory actionability invariant + H no-`secure:false`-literal grep                                  |
| 4   | Unobservable → `unknown`, never safe/failed                                          | Fully optional-chained `resolveSessionTransport` (D) returns `unknown` for `undefined`/`{}` and the MCP no-event path (mcp files untouched, G); yields an advisory that says transport could not be observed and is never assumed safe; `proxy-terminated` is likewise never `verified`                     | **J (never-throws, now in-alias)** + K (`{}` event) + I (false-safe guard)                             |
| 5   | Arithmetic exact and versioned                                                       | Session posture lives only in `advisories[]`/`assurances[]`, appended after rollup/contributions/recoverablePoints/capBand and feeding none of them (F leaves `computeShieldReport`/`checks.ts`/`catalog.ts`/`policy.ts` untouched); `SecurityCheckId`/`CHECK_IDS`/weights unchanged (A); version `'1'→'2'` | I re-asserting 95/64/59/85, `recoverablePoints` 40, contribution-sum, band caps, `engineVersion==='2'` |

## 7. Test matrix

| Test file                                            | Batch | Runs under `security-posture` alias?                            | Covers                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/shared/security/engine.test.ts`               | I     | Yes (existing glob `tests/shared/security`)                     | Pinned scores/recoverablePoints/contribution-sum/band caps unchanged across transports; score-equality across transports; `engineVersion==='2'`; per-`(transport×mode)` advisory/assurance table; false-safe guard; actionability invariant; no-secret |
| `tests/shared/security/checks.test.ts`               | I     | Yes                                                             | Updated `makeInputs` shape; existing check assertions unaffected                                                                                                                                                                                       |
| `tests/server/security/sessionTransport.test.ts`     | J     | **Yes — after J adds `tests/server/security` to the alias**     | `observeSessionTransport` truth table incl. comma-token; `resolveCookieSecure` full `mode×transport`; `resolveSessionTransport(undefined/{})`→`unknown`, never throws                                                                                  |
| `tests/server/utils/auth/sessionCookie.test.ts`      | J     | **Yes — after J adds `tests/server/utils/auth` to the alias**   | `secure` true/false matrix; canonical field set                                                                                                                                                                                                        |
| `tests/server/utils/config/cookieSecureMode.test.ts` | J     | **Yes — after J adds `tests/server/utils/config` to the alias** | `parseCookieSecureMode` `auto`/`on`/`off`/case/whitespace pass-through; invalid/empty/undefined → `auto` fail-safe                                                                                                                                     |
| `tests/routes/securityPosture.test.ts`               | K     | Yes (existing glob)                                             | `{}`→`unknown` advisory + `session_secret` verified + `engineVersion==='2'`; synthetic-https → advisory absent + `session_cookie_secure` present; existing `CHECK_IDS`/contribution-sum/no-secret                                                      |

Set-site regression coverage (Batch H): the four routes are type-checked (route test dirs + build) and the underlying helper is unit-tested (J); the standing regression guard against a future site reverting to a hardcoded literal is the Batch-H grep asserting no `secure:false` cookie literal remains. `deno test` is not a branch-protection merge gate (repo has none), so these proofs run locally/CI-non-gating — acceptable and acknowledged.

## 8. Notes on scope decisions (resolved open questions)

- **DRY `firstForwardedValue` (Batch B):** adopted (design-recommended). Keeps a single parser shared by `rp.ts` and `sessionTransport.ts`; corrected to the actual two `rp.ts` call-sites.
- **OpenAPI polish (Batch M):** skipped by default — confirmed `openapi.json` stays byte-identical, prettier gate green, no `v1.d.ts` drift. Do it only if descriptions must mention session posture, in which case the bundle+prettier step becomes mandatory.
- **`ROADMAP.md`:** intentionally not edited — design §13 omits it and ROADMAP carries #227 only as an unchecked follow-up bullet under #28. No batch owns it, by design.
- **`summaryEvent()` override (Batch K):** a minimal `{ url, request }` slice cast to the handler event type is accepted (handler reads only `event.url`/`event.request`); no full `RequestEvent` stub needed.

## 9. Definition of Done

- [ ] Batch A: `PostureInputs.session` replaces `sessionCookieSecure`; `SecurityCheckId`/`CHECK_IDS` unchanged; `SECURITY_POSTURE_ENGINE_VERSION === '2'` with widened docstring.
- [ ] Batch B: single `firstForwardedValue` in `$http/forwardedHeader.ts`; `rp.ts` two call-sites intact; RP tests green.
- [ ] Batch C: `cookieSecureMode` field + exported pure `parseCookieSecureMode`; no `SESSION_SECRET`; type-only import (no cycle).
- [ ] Batch D: pure `observeSessionTransport`/`resolveSessionTransport`/`resolveCookieSecure`; no `Date`/`Math.random`/DB.
- [ ] Batch F: 7-row transport advisory table + three assurances (`session_cookie_secure` only for `direct-secure`); rollup/checks/catalog/policy untouched; no secret substrings.
- [ ] Batch I: both `makeInputs` updated; pinned scores + `recoverablePoints` 40 + contribution-sum + band caps unchanged across transports; `engineVersion==='2'`; per-state + actionability + false-safe assertions; scoped `deno test` green.
- [ ] Batch E: `sessionCookieOptions` single source of truth.
- [ ] Batch G: `gather.ts` sets `session:{…}` (hardcoded `false` line + comment deleted); `computeShield(event?)`; summary route threads `event`; MCP files untouched; **whole-graph `deno task check` green for the first time**.
- [ ] Batch L: `PRAXRR_COOKIE_SECURE` documented in `CLAUDE.md` + `README.md`; docs prettier gate clean.
- [ ] Batch H: all four set-sites use `sessionCookieOptions(event, expires)`; no `secure:false` literal remains; logout untouched.
- [ ] Batch J: three new pure test files green; `scripts/test.ts` `security-posture` alias extended with `tests/server/security`, `tests/server/utils/auth`, `tests/server/utils/config`.
- [ ] Batch K: route test asserts `{}`→`unknown`, synthetic-https, `engineVersion==='2'`.
- [ ] `deno task check` green; `deno task build` green; `deno task test security-posture` green (**including Batch J's three files via the extended alias**); docs prettier gate green; `openapi.json` untouched (or Batch M bundle+prettier if opted in).
- [ ] All five acceptance criteria proven by automated tests reachable under the documented `deno task test security-posture` command.
