# Issue #227 — Session Hardening — Grounding Brief

> Shared context for all design/plan/implementation agents. Read this first. It is the single
> source of truth for the current codebase state relevant to #227. Do NOT re-explore from scratch.

## The ask (issue #227, "[Task] Security Posture | Sessions | Assess cookie and secret configuration")

A follow-up to the **shipped** Ecosystem Security Posture / Shield Check foundation (#28, PR #220).
The engine grades control-plane auth, Arr transport, key-at-rest, rotation, and log-redaction, but
does **not** yet assess whether session cookies + session-secret configuration match the deployment's
transport and auth mode.

**Acceptance Criteria (verbatim):**

1. Cookie findings distinguish **direct secure transport**, **trusted termination**, and **insecure/unknown** transport.
2. Session-secret findings detect **missing or unsafe configuration without exposing the value**.
3. Recommendations identify a **concrete configuration change** for each failing state.
4. **Unobservable states are reported as `unknown`** rather than safe or failed.
5. **Existing shield-score contribution arithmetic remains exact and versioned.**

**In scope:** observable checks for cookie transport flags + session-secret config; grade only states
Praxrr can determine from runtime config; concrete remediation text + tests; no secret value or
sensitive derivative in reports/logs.

**Out of scope:** rotating secrets automatically; probing external TLS termination; replacing the
auth/session implementation wholesale.

**Constraints:** threat-model driven; no secret material in inputs returned to clients; account for
direct HTTPS vs explicitly trusted proxy termination **without assuming either**.

## Scope boundary with sibling follow-ups (from ROADMAP.md)

The foundation's follow-ups are **three separate issues**:

- **#227 (THIS) = session hardening** — cookie Secure flag + session-secret posture.
- **#228 = explicit proxy trust** — the config knob that makes `X-Forwarded-Proto` _trusted_. **Do not build #228's trust configuration here.** #227 may _observe_ forwarded headers but must grade conservatively (a proxy-terminated state is a distinct state, NOT blindly "safe").
- **#229 = DNS-aware transport grading** — out of scope here.

## The engine architecture (all paths pure unless noted)

Path aliases: `$shared/` = `packages/praxrr-app/src/lib/shared/`, `$config` = server config singleton,
`$logger/`, `$db/`, `$utils/`, `$sync/`.

- `$shared/security/types.ts` — pure contracts. `SECURITY_POSTURE_ENGINE_VERSION = '1'` (bump on any
  check-set/threshold/formula change). `SecurityCheckId` is a **closed versioned union**
  (`control_plane_auth | arr_transport | app_key_at_rest | credential_rotation | log_redaction`) +
  `CHECK_IDS` ordered array. Key types: `PostureInputs` (already has `sessionCookieSecure: boolean`
  with doc "const false today → drives the transport advisory"), `CheckResult`, `Advisory`
  ("A real-but-unscored posture note whose exploitability Praxrr cannot observe (e.g. cookie Secure
  flag)"), `Assurance` ("always-on protection surfaced as a verified affirmation, contributes zero"),
  `ShieldFix` (`settings-link | instance-link | env-var | docs | none`), `ShieldReport`.
- `$shared/security/catalog.ts` — `CHECK_CATALOG` static id/label/description, one per check.
- `$shared/security/checks.ts` — one pure `SecurityCheck` per id; `ALL_CHECKS` registry;
  `classifyHost`, `buildTransportRows`. `log_redaction` is the precedent for "scores null (excluded)
  when healthy, only becomes a weighted failure on regression".
- `$shared/security/engine.ts` — `computeShieldReport(inputs)`: runs checks, rolls up, caps band,
  builds `transport[]`, `assurances[]` (`buildAssurances`), `advisories[]` (`buildAdvisories` — TODAY
  emits the single `session_cookie_secure` advisory when `!inputs.sessionCookieSecure`), `topActions[]`.
- `$shared/security/policy.ts` — band thresholds (85 hardened / 60 guarded), `capBand`. Re-exports
  `clamp0100`, `rollUp` from `$shared/scoring/rollup.ts` (weighted-mean, exact-integer contributions;
  residual folded into largest-weight unit — **contributions sum EXACTLY to score**).
- `$shared/security/index.ts` — barrel.

## Server read path

- `$lib/server/security/gather.ts` — `buildPostureInputs()`: the ONLY config/DB-touching code;
  degrade-never-throw. Materializes auth mode/bind/port, OIDC state, app-key presence+length,
  enabled instances, rotation facts, `redactionVerified` (runtime sanitizer self-verify). Line 124
  hardcodes `sessionCookieSecure: false` with comment "Praxrr sets its session cookie without the
  Secure flag today; surfaced as an advisory." Uses `new Date().toISOString()` for `nowIso`.
- `$lib/server/security/service.ts` — `computeShield()` = `computeShieldReport(buildPostureInputs())`.
- `$lib/server/security/responses.ts` — wire mappers → `SecurityPostureSummaryResponse`; runtime
  source of truth mirrored by `docs/api/v1/schemas/security-posture.yaml`. Keep in lockstep.

### Callers of `computeShield()` (BOTH pass no request context)

1. `routes/api/v1/security-posture/summary/+server.ts` — `GET` handler, currently `computeShield()`
   with no args. The route test passes `{}` as the event (no `event.url`/`event.request`).
2. `$lib/server/mcp/resources.ts:73` (`praxrr://security-posture` resource) and
   `$lib/server/mcp/tools.ts:182` (`get_security_posture` tool) — both `toSecuritySummary(computeShield())`.
   **No request context exists on the MCP path** → transport is genuinely `unknown` there.

=> Any request-derived transport signal MUST be optional; absence → `unknown`. This is exactly what
acceptance criterion #4 wants.

## Session cookie reality

- 4 set-sites, all identical `{ path:'/', httpOnly:true, sameSite:'lax', secure:false, expires }`:
  - `routes/auth/login/+page.server.ts:91`
  - `routes/auth/oidc/callback/+server.ts:115`
  - `routes/api/v1/auth/webauthn/authentication/verify/+server.ts:129`
  - `routes/auth/setup/+page.server.ts:87`
- Session id = `crypto.randomUUID()` stored server-side in `sessions` table (opaque, ~122-bit entropy).
  **No cookie-signing secret, no HMAC, no `SESSION_SECRET` env var exists** (verified by grep). SvelteKit
  cookies are unsigned. The only session-adjacent secrets in the app are the app API key
  (already graded by `app_key_at_rest`) and the OIDC client secret. `svelte.config.js` has a `csrf` block.

## Config surface (`$config`, `config.ts`)

Env-driven singleton. No transport/proxy/cookie/session keys today. `config.host` (default `0.0.0.0`),
`config.port` (6868), `config.authMode`. Env parsing helpers: `parseBooleanEnvWithDefault`.
`serverUrl` getter hardcodes `http://`.

**Existing precedent for reading forwarded transport:** `$lib/server/webauthn/rp.ts` reads
`x-forwarded-host` / `x-forwarded-proto` / `host` / `url.protocol` per-request (pure `deriveWebAuthnRp`

- `resolveWebAuthnRp(event)` wrapper, with `firstForwardedValue` taking the first comma token). Reuse
  this exact pattern for transport observation — do not reinvent header parsing.

## Test conventions

- `tests/shared/security/engine.test.ts` — pure-engine tests. **Pins EXACT scores** (95, 64, 59, 85,
  recoverablePoints 40, etc.) and the contribution-sum invariant, band caps, actionability invariant
  (every warning/danger rec carries a non-`none` fix), and "report never carries a secret". `makeInputs`
  helper sets `sessionCookieSecure: false`. **If new posture perturbs these scores the tests break** →
  criterion 5 demands the arithmetic stay exact, so new session posture should be UNSCORED (advisory/
  assurance, null sub-score, excluded from rollup) so the numbers hold; the version bump ('1'→'2')
  covers the "versioned" half.
- `tests/routes/securityPosture.test.ts` — migrated route tests; asserts `body.checks.map(c=>c.id)`
  equals `[...CHECK_IDS]` (auto-adapts if CHECK_IDS grows) + contribution-sum survives wire mapping +
  never returns a secret / planted sentinel. Passes `{}` as the event.
- Run tests: `deno task test security-posture` (alias). Type-check: `deno task check`.

## The core design fork the design workflow must resolve

Two idiomatic ways to add session posture, both must satisfy all 5 criteria and keep arithmetic exact:

- **(A) Advisory/assurance surface** — thread request transport into `PostureInputs`; upgrade
  `buildAdvisories` to emit transport-aware session advisories (direct-secure / proxy-terminated /
  insecure / unknown) each with a concrete `env-var` fix; add a session-secret **assurance** (honest:
  opaque server-side random tokens, nothing client-side to leak) that flips to a finding on a genuinely
  unsafe observable state. No new `SecurityCheckId` → CHECK_IDS/arithmetic/scored-tests untouched.
- **(B) First-class checks** — add `session_cookie` (+ maybe `session_secret`) to `SecurityCheckId`,
  `CHECK_CATALOG`, `ALL_CHECKS`, OpenAPI enum, mirroring `log_redaction`: score `null`/weight-0 in all
  currently-tested states so arithmetic stays exact; states ride in `status`/`detail`/`recommendations`.
  The issue's "Files: check catalog/policy" naming leans this way, at the cost of more surface.

Both introduce env `PRAXRR_COOKIE_SECURE = auto|on|off` (default `auto`) so (a) the recommendation is a
concrete config change (criterion 3) and (b) the 4 cookie set-sites actually harden (`Secure` when
transport is known-secure) — the real "session hardening" deliverable — via a shared cookie-options
helper. Trusting `X-Forwarded-Proto` only to _enable_ Secure is always safe (spoofing https→ cookie
Secure → dropped over http → loud failure, never a downgrade), so this does not depend on #228.

## Guardrails to honor

- Never emit a secret value or derivative into report/logs (tests assert this).
- Degrade-never-throw in the gatherer; on-demand compute, no persistence.
- Pure engine: no `Date`/`Math.random` in `$shared/security/**` (gatherer passes `nowIso`).
- Contract lockstep: `responses.ts` interfaces ↔ `docs/api/v1/schemas/security-posture.yaml` ↔ the
  bundled `packages/praxrr-api/openapi.json`/`types.ts` (openapi.json is prettier-gated in CI).
- Conventional commits; internal docs commits use `docs(internal): …`.
- Cross-Arr policy: session/cookie posture is Arr-agnostic (transport is app-wide), so no per-arr_type
  branching needed here, but do not introduce cross-arr shortcuts.
