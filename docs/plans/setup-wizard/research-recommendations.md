# Setup Wizard (#12) — Research Recommendations

> Guided first-run onboarding for Praxrr: `/setup/` route-based flow — Welcome →
> Connect Arr → Link PCD DB → Select profiles/custom formats → Preview & Sync
> (reuse #7) → Done. Detect first-run vs returning; "Skip wizard" escape hatch.
> Depends on #7 (done). Pairs with #11 (progressive disclosure), related #29.

## Executive Summary

Praxrr already ships every hard part of this feature as a reusable primitive. The
wizard is primarily a **thin orchestration/presentation layer** over existing,
tested modules — not new backend capability. The three onboarding steps map almost
one-to-one to code that already exists:

| Wizard step | Reused primitive | Location |
| --- | --- | --- |
| Connect Arr | `InstanceForm.svelte` + `POST /arr/test` + `arrInstancesQueries.create` | `routes/arr/components/InstanceForm.svelte`, `routes/arr/test/+server.ts`, `db/queries/arrInstances.ts` |
| Link PCD DB | `pcdManager.link(...)` (already driven by startup auto-link) | `hooks.server.ts:102`, `pcd/index.ts` |
| Select profiles/CFs | quality-profiles / custom-formats read paths | `routes/quality-profiles/**`, `routes/custom-formats/**` |
| Preview & Sync | `POST /api/v1/sync/preview` (#7, hardened) | `routes/api/v1/sync/preview/+server.ts` |

The real work is **wiring, gating, and state**, and there are two load-bearing
decisions that must be made before any code is written:

1. **Naming collision (CRITICAL to disambiguate).** `/auth/setup` already exists and
   means "create the first admin account." The new wizard is a *different* concept:
   post-auth guided onboarding. They must not be conflated. Recommended route:
   `/setup/` (or `/onboarding/`), sequenced strictly **after** `/auth/setup`.
2. **First-run detection cannot reuse `default_database_linked`.** The startup
   auto-link (`hooks.server.ts:59-129`) sets `default_database_linked = 1` **even on
   failure** (line 121), so that flag is a poor proxy for "user finished onboarding."
   A dedicated completion flag is required.

The two CRITICAL security concerns — **auth gating** and **SSRF on connection test /
DB link** — are both real and both already partially latent in the codebase (the
existing `/arr/test` route has no SSRF guard). The wizard does not *introduce* them,
but it makes them the first surface a brand-new operator touches, so they should be
addressed as part of this work, not deferred.

Recommended shape: **route-based steps** (one SvelteKit route per step under
`/setup/`) with **server-authoritative step resolution** (server decides the current
step from persisted state; client store holds only transient form state). Ship a
**thin vertical slice first** (Welcome → Connect Arr → Done, gated + flagged), then
layer DB-link, profile-select, and preview/sync steps behind that spine.

---

## Implementation Recommendations

### Technical approach

**Route topology (mirror existing `routes/arr/[id]/*` sectioned layout):**

```
routes/setup/
  +layout.server.ts   # gate: resolve current step from setup state; redirect stragglers
  +layout.svelte      # shared stepper chrome (progress rail, skip button)
  +page.server.ts     # index → redirect to first incomplete step
  welcome/+page.svelte
  connect/+page.server.ts + +page.svelte   # reuse InstanceForm + /arr/test
  database/+page.server.ts + +page.svelte  # reuse pcdManager.link
  profiles/+page.server.ts + +page.svelte  # reuse QP/CF read paths + selection
  preview/+page.server.ts + +page.svelte   # reuse POST /api/v1/sync/preview + preview UI
  done/+page.svelte
```

Rationale: the app already organizes multi-step flows as nested routes
(`arr/[id]/sync`, `arr/[id]/settings`, `quality-profiles/[databaseId]/[id]/{general,qualities,scoring}`).
A route-based wizard is idiomatic here, gives free back/forward + deep-linkable
resume, and lets each step reuse SvelteKit `load`/actions exactly like the standalone
pages do. It also honors the repo convention **"Routes over modals."**

**State model — add an explicit onboarding flag.** Extend the `setup_state`
singleton (currently only `id`, `default_database_linked`, timestamps) via a
migration in `db/migrations/*.ts` (per CLAUDE.md, migrations — not `schema.sql`):

```
ALTER TABLE setup_state ADD COLUMN wizard_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE setup_state ADD COLUMN wizard_dismissed_at TEXT;   -- "skip" audit trail
```

Then extend `setupStateQueries` with `isWizardComplete()`, `markWizardComplete()`,
`markWizardDismissed()`. **Do not overload `default_database_linked`** for this — it
is set on startup regardless of user action. Also register any accompanying
built-in base-op change in `pcd/ops/seedBuiltInBaseOps.ts` if the wizard seeds
default profiles (per CLAUDE.md "Arr Cutover Guardrails").

**Server-authoritative current step.** `routes/setup/+layout.server.ts` computes the
first-incomplete step from persisted facts (has ≥1 enabled Arr instance? has ≥1
linked DB? wizard_completed?) and redirects there. The client store (`$stores/`)
holds only in-flight form values and optimistic UI, never the source of truth. This
survives refresh, avoids a client/server drift class of bugs, and makes "resume"
free.

**First-run trigger.** Add a lightweight nudge (banner or redirect) when
`wizard_completed = 0` AND no enabled Arr instance exists — *not* a hard redirect from
`/` that traps returning users. Prefer a dismissable top-of-app banner ("Finish
setup") over a forced redirect, so power users are never locked out. The hard gate
already exists for admin-account creation (`hooks.server.ts:213-219`); do **not** add
a second hard gate for onboarding.

### Phasing — thinnest first slice

Sequence chosen so `main` is always green and each phase is independently mergeable.

- **Phase 0 — State + gating spine (no user-visible flow yet).**
  Migration for `wizard_completed`/`wizard_dismissed_at`, `setupStateQueries`
  extensions, `routes/setup/+layout.server.ts` gate that resolves current step,
  `/setup/welcome` and `/setup/done` placeholder pages, "Skip wizard" action.
  Tests: gate redirects, completion flag transitions, auth-mode matrix. **This is the
  thinnest end-to-end slice** — a wizard you can enter, skip, and complete with no
  real steps. De-risks the two critical decisions (naming, detection) before any
  reuse wiring.
- **Phase 1 — Connect Arr step.** `/setup/connect` reusing `InstanceForm` +
  `/arr/test` inline validation + `arrInstancesQueries.create`. Advancing requires ≥1
  validated instance. Highest-value single step; unblocks preview later.
- **Phase 2 — Link PCD DB step.** `/setup/database` reusing `pcdManager.link`. Offer
  "Use default (`PRAXRR_DEFAULT_DB_URL`)" (already auto-linked on startup, so often a
  no-op confirm) vs "Custom repo." Must degrade gracefully for local-path/non-git
  sources (CLAUDE.md "Local-Path Source Guardrails").
- **Phase 3 — Select profiles + custom formats.** `/setup/profiles` reusing QP/CF
  read paths. Enforce Arr-scoped compatibility from `quality_api_mappings` for the
  target `arr_type` (CLAUDE.md guardrail — do not rely on `arr_type='all'` scores or
  `enabled=1`). This is the step with the most Arr-specific validation nuance.
- **Phase 4 — Preview & Sync.** `/setup/preview` reusing `POST /api/v1/sync/preview`
  (already rate-limited, body-limited, capacity-limited) and the existing preview
  render components from `arr/[id]/sync`. Terminal action marks
  `wizard_completed = 1` → `/setup/done`.
- **Phase 5 — Polish.** Resume affordance, re-run entry from settings, funnel
  instrumentation (see Improvement Ideas). Optional / non-blocking.

Each phase = one PR, each behind the Phase 0 spine, so partial merges never expose a
half-built flow to first-run users (steps not yet built are simply skipped by the
step resolver).

### Quick wins

- **Reuse `InstanceForm.svelte` verbatim** — it already supports `mode="create"` and
  surfaces `form` action data (`routes/arr/new/+page.svelte:17`). The connect step is
  mostly a wrapper.
- **Default-DB step is often a confirmation, not a form** — startup already
  auto-links `PRAXRR_DEFAULT_DB_URL`; detect the existing linked DB and let the user
  click through.
- **Preview step is a straight fetch** — `POST /api/v1/sync/preview` returns a fully
  populated diff; the render components already exist under `arr/[id]/sync`.
- **Stepper chrome from existing primitives** — `card/`, `badge/`, `button/`,
  `navigation/` under `$ui/` cover the progress rail; no new component library
  needed. Match the `/auth/setup` visual shell (logo + split layout) for continuity.
- **Alerts + dirty tracking already conventionalized** — use `alertStore.add(...)`
  and the dirty store per repo conventions instead of bespoke feedback.

---

## Improvement Ideas

- **Resume wizard.** Free with server-authoritative step resolution — landing on
  `/setup/` always routes to the first incomplete step. Add a "Continue setup" banner
  on `/` when `wizard_completed = 0`.
- **Re-run from Settings.** A "Re-run onboarding" entry under `settings/` that clears
  `wizard_completed` (and routes to `/setup/`) for users who skipped and want the
  guided path back. Cheap; high UX payoff.
- **Funnel drop-off telemetry.** Emit structured `logger.info` events per step
  transition (`source: 'SetupWizard'`, `meta: { step, action }`) — the logger already
  supports structured meta. Aggregatable from logs without adding a telemetry SaaS.
  Keep it privacy-safe (step names only, no URLs/keys).
- **Multi-instance onboarding.** Allow "Add another instance" loop in the connect
  step (Radarr + Sonarr + Lidarr in one pass) before advancing. Backend already
  supports N instances; only the step UX needs an "add another" affordance.
- **Env-preseeded fast path.** If `reconcileEnvInstances()` (`hooks.server.ts:132`)
  already created instances from env, the connect step can show them as
  pre-populated and let the user confirm rather than re-enter.
- **Health-gated "Sync now."** Reuse `/api/v1/health` to block the final sync CTA
  until the instance is reachable, avoiding a confusing failed first sync.
- **Progressive disclosure hook (#11).** Structure step content so advanced options
  (custom repo, per-section sync config) are collapsed by default — the wizard is the
  natural first consumer of #11's disclosure primitives.

---

## Risk Assessment

| # | Risk | Severity | Likelihood | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | **Auth gating of `/setup/`** — if added to `PUBLIC_PATHS` (like `/auth/setup` is), the wizard's server actions (Arr test, DB link, sync) become an **unauthenticated** attack surface. | **CRITICAL** | Med | Do **not** add `/setup/` to `PUBLIC_PATHS` (`auth/middleware.ts:27`). Gate it behind `auth.user \|\| auth.skipAuth`. For `AUTH=oidc`/`AUTH=on`, require a session; for `AUTH=off`/`local`, `skipAuth` already covers it. Add an explicit auth-mode matrix test. |
| R2 | **SSRF via connection test + DB link.** `/arr/test` (`routes/arr/test/+server.ts`) and `pcdManager.link` take an arbitrary user URL and make **server-side** requests. No SSRF guard exists today. First-run users pointing at `http://169.254.169.254/` or internal hosts. | **CRITICAL** | Med | Add URL validation before the outbound request: reject link-local (169.254/16, fd00::/8), loopback-by-name tricks, and cloud metadata IPs; consider DNS-rebinding protection. Note: this hardens an **existing** hole, so scope it deliberately. Keep behind auth (R1) as defense-in-depth. |
| R3 | **First-run detection race / wrong signal.** `default_database_linked` is set on startup **even on link failure** (`hooks.server.ts:121`); reusing it as "onboarding done" mislabels users. Startup auto-link runs at module load, concurrent with early requests. | High | High | Add dedicated `wizard_completed` flag (never inferred from DB-link state). Compute "current step" from user-owned facts (enabled Arr instances, linked DBs) + the flag, not from startup side effects. |
| R4 | **Naming/route collision** with existing `/auth/setup` (admin account). Conflation breaks both flows. | High | Med | Use a distinct namespace (`/setup/` or `/onboarding/`); document that `/auth/setup` = account creation, `/setup/` = onboarding; sequence onboarding strictly after account creation in the gate. |
| R5 | **Duplicating vs reusing forms.** Re-implementing the Arr/DB/profile forms inside the wizard causes drift with the canonical routes. | Med | High | Reuse `InstanceForm.svelte`, the QP/CF read paths, and `POST /api/v1/sync/preview` directly. Wizard steps are wrappers, not forks. |
| R6 | **Arr-semantic drift in profile step.** Assuming Sonarr/Radarr/Lidarr share profile/quality semantics violates the Cross-Arr policy; `arr_type='all'` scores can make incompatible profiles appear valid. | High | Med | Resolve compatibility per `arr_type` via `quality_api_mappings`; do not require `enabled=1`; fail fast on ambiguous mappings (CLAUDE.md Cross-Arr + Cutover guardrails). |
| R7 | **Hard-redirect traps returning users.** A blanket redirect from `/` while `wizard_completed=0` locks power users who intentionally skipped. | Med | Med | Prefer dismissable banner + `wizard_dismissed_at`; only the admin-account gate stays a hard redirect. |
| R8 | **Local-path / non-git DB source.** DB step assuming a git repo breaks for local-path sources. | Med | Med | Degrade gracefully; never 500 on non-git sources (CLAUDE.md "Local-Path Source Guardrails"). |
| R9 | **Sync from wizard on unreachable instance** yields a confusing first failure. | Low | Med | Health-gate the final CTA; surface preview errors (the preview API already reports per-section errors). |
| R10 | **Preview store capacity/rate limits** (429s) during rapid wizard retries. | Low | Low | Already mitigated server-side (`preview/limits.ts`); surface 429 as a friendly "retry shortly" message. |

**Integration challenges:** the wizard touches auth middleware, the DB migration
chain, the PCD manager, and the sync preview subsystem simultaneously — so Phase 0
(gating + state) must land and be test-covered before the reuse phases, or a
half-wired gate could strand first-run users. **Performance:** negligible new load;
the only server-side cost is the preview generation, which is already bounded.

---

## Alternative Approaches

### A1 — Route-based steps vs single-page stepper

| | Route-based (one route per step) | Single-page client stepper |
| --- | --- | --- |
| Pros | Idiomatic here (mirrors `arr/[id]/*`); free back/fwd + deep-link resume; each step reuses `load`/actions like standalone pages; honors "Routes over modals" | Fewer files; no per-step navigation; simplest client state |
| Cons | More route files; shared chrome via `+layout` | Reinvents nav/back; resume needs manual client persistence; drifts from repo conventions; large single component (~500-line cap pressure) |
| Effort | Med | Low-Med |

**Recommendation: route-based.** It matches existing patterns, gives resume/deep-link
for free, and keeps each step small and independently testable.

### A2 — Server-driven current step vs client store

| | Server-authoritative (recommended) | Client store owns step |
| --- | --- | --- |
| Pros | Single source of truth; survives refresh; resume free; no drift; testable in `+layout.server.ts` | Snappier transitions; no server round-trip per step |
| Cons | Round-trip per step (cheap) | Refresh/close loses progress unless persisted; client/server drift risk; harder to test |
| Effort | Med | Med |

**Recommendation: server-authoritative step resolution; client store for transient
form state only.** Best resume behavior and lowest bug surface.

### A3 — Dedicated `wizard_completed` flag vs inferring completion

| | Explicit flag (recommended) | Infer from instances/DB presence |
| --- | --- | --- |
| Pros | Unambiguous; supports skip/dismiss + re-run; no coupling to startup side effects | No migration |
| Cons | One migration + query extensions | `default_database_linked` set on startup regardless (R3); can't distinguish "skipped" from "not started" |
| Effort | Low | Low |

**Recommendation: explicit flag.** The migration is trivial and it eliminates R3.

### A4 — New `/setup/` namespace vs extending `/auth/setup`

**Recommendation: new `/setup/` (or `/onboarding/`) namespace.** Extending
`/auth/setup` overloads account-creation semantics and its public-path exemption
(R1/R4). Keep the two concepts and their auth treatment separate.

---

## Task Breakdown Preview (for PRP planning)

| Phase | Scope | Depends on | Complexity | Notes |
| --- | --- | --- | --- | --- |
| **P0** | Migration (`wizard_completed`, `wizard_dismissed_at`) + `setupStateQueries` extensions | — | S | Migration in `db/migrations/*.ts`; register base-op change in `seedBuiltInBaseOps.ts` if seeding defaults |
| **P0** | `routes/setup/` spine: `+layout.server.ts` gate, step resolver, welcome/done, Skip action | P0 migration | M | Auth-mode matrix test is mandatory here (R1) |
| **P0** | Auth gating decision + `PUBLIC_PATHS` review + first-run banner (not hard redirect) | P0 spine | M | **CRITICAL** — R1/R7 |
| **P1** | `/setup/connect` reusing `InstanceForm` + `/arr/test` + `arrInstancesQueries.create` | P0 | M | Highest value step |
| **P1** | SSRF hardening for `/arr/test` (and shared with DB link) | P1 connect | M | **CRITICAL** — R2; hardens existing hole |
| **P2** | `/setup/database` reusing `pcdManager.link`; default-vs-custom; non-git graceful | P0 | M | R8 local-path guardrail |
| **P3** | `/setup/profiles` reusing QP/CF read paths; Arr-scoped compatibility via `quality_api_mappings` | P2 (DB linked) | M-L | R6 Cross-Arr policy — most nuanced step |
| **P4** | `/setup/preview` reusing `POST /api/v1/sync/preview` + existing preview render; terminal marks `wizard_completed` | P1 + P3 | M | Reuses hardened #7 endpoint |
| **P5** | Resume banner, re-run from settings, funnel telemetry, multi-instance loop | P4 | S-M | Non-blocking polish |

**Critical path:** P0 (state+gate+auth) → P1 (connect + SSRF) → P4 (preview/sync).
P2 and P3 can proceed in parallel once P0 lands. P5 is optional.

**Test surface (per phase):** gate redirect + auth-mode matrix (P0); connection
validation success/failure + SSRF rejection (P1); non-git graceful degradation (P2);
per-`arr_type` compatibility filtering (P3); preview happy-path + 429/error surfacing
(P4). Prefer unit tests over e2e where possible (repo convention); one Playwright
happy-path e2e for the full funnel.

---

## Key Decisions Needed

1. **Route namespace:** `/setup/` vs `/onboarding/` (recommend `/setup/`, distinct
   from `/auth/setup`). — *affects R4, all routing.*
2. **First-run trigger UX:** dismissable banner (recommended) vs soft redirect from
   `/`. — *affects R7.*
3. **SSRF scope:** harden `/arr/test` + DB link now (recommended, since the wizard
   fronts them) vs track as a separate security issue. — *affects R2, timeline.*
4. **Profile-selection depth:** curated shortlist vs full QP/CF picker in-wizard.
   Recommend a curated default set with "customize later," to keep the funnel short.
5. **Skip semantics:** does "Skip wizard" set `wizard_completed = 1` (never nag again)
   or only `wizard_dismissed_at` (nag-with-dismiss)? Recommend `wizard_dismissed_at`
   + banner so users can return.

## Open Questions

- Should the wizard **auto-run the first sync**, or only preview and leave the actual
  sync to the user's explicit click? (Recommend preview-then-explicit-sync — safer
  first impression; R9.)
- For `AUTH=off`/reverse-proxy deployments, is a guided wizard desirable at all, or
  should it be suppressed since these are typically headless/automated installs?
- Does #11 (progressive disclosure) land before or after this? If before, the profile
  step should consume its primitives; if after, structure the step so it can adopt
  them without a rewrite.
- Should env-preseeded instances (`reconcileEnvInstances`) **short-circuit** the
  connect step entirely, or always show a confirm screen?
- Is there an existing analytics/telemetry sink, or is structured logging the only
  funnel-measurement channel available today?
```