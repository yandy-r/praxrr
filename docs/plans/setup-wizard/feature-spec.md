# Feature Spec: Setup Wizard (First-Run Guided Onboarding)

> GitHub issue #12 (parent #6) · Depends on #7 (Sync Preview — **done**) · Pairs with #11 (Progressive Disclosure) · Related #29 (Progressive Complexity)

## Executive Summary

A route-based (`/setup/`) guided first-run experience that walks a new Praxrr operator from an
empty install to a previewed first sync: **Welcome → Connect Arr instance → Link PCD database →
Select quality profiles/custom formats → Preview & Sync (reusing #7) → Done**. Research found that
**no Arr-ecosystem config tool ships a first-run wizard**, so this is a genuine differentiator that
directly targets the 80%+ initial-configuration abandonment rate. Technically the feature is a
**thin orchestration/presentation layer** over primitives that already exist and are production-tested
(instance creation, PCD linking, profile selection, sync preview/apply) — the real work is **gating,
state, and secure wiring**, not new backend capability. Two decisions are load-bearing and must be
settled before coding: (1) first-run completion must use a **dedicated `wizard_completed` flag**, never
the existing `default_database_linked` (which is set on every boot regardless of success), and (2) the
wizard fronts two **pre-existing CRITICAL security gaps** — an unauthenticated-reachable surface and an
SSRF-capable connection test — that must be closed as part of this work.

## External Dependencies

### APIs and Services

This feature introduces **no new external SaaS APIs**. It orchestrates existing internal flows plus the
already-integrated **Servarr connection test**.

#### Servarr status endpoint (connectivity validation — existing integration)

- **Documentation**: Radarr <https://radarr.video/docs/api/>, Sonarr <https://sonarr.tv/docs/api/>, Lidarr <https://lidarr.audio/docs/api/>
- **Authentication**: `X-Api-Key: <apiKey>` header
- **Key Endpoint**: `GET /api/v3/system/status` (Lidarr uses `/api/v1`) → returns `appName`, `version`
- **Reused via**: `createArrClient(type, url, apiKey).testConnection()` (`$utils/arr/base.ts`, `factory.ts`); legacy route `POST /arr/test` (`routes/arr/test/+server.ts`), timeout 3s, 0 retries
- **Cross-Arr note**: uniform status call across `radarr|sonarr|lidarr`; reject `chaptarr`/`all`. Do not infer capabilities from a sibling type.

### Libraries and SDKs

| Library | Version | Purpose | Installation |
| ------- | ------- | ------- | ------------ |
| — | — | **No new dependencies.** All UI/form/dirty/alert/modal/sync-preview primitives already exist in-repo. | — |

### External Documentation (prior art, cited in research-ux.md)

- Home Assistant onboarding flow — closest self-hosted wizard analog; lesson: keep `/setup/` re-runnable, don't make it one-time-only.
- Nextcloud `firstrunwizard`, Directus/n8n admin-gated first-run + env-preseed — precedent for env-var escape hatch (`PRAXRR_DEFAULT_DB_URL`).
- WAI multi-page forms, Baymard inline validation, skeleton-vs-spinner guidance — see `research-ux.md` Sources.

## Business Requirements

### User Stories

**Primary — First-run new user (empty install)**
- As a first-time operator, I want a guided linear flow from "nothing configured" to "first sync previewed & applied" so I don't have to discover the correct order of `/arr/new` → `/databases/new` → `/arr/[id]/sync` myself.

**Secondary — Returning user**
- As a user who already has ≥1 Arr instance and a linked PCD, I want the wizard to never intercept normal navigation again.

**Secondary — Power user**
- As an experienced admin (or someone scripting via env vars), I want a visible "Skip wizard" from step one that persists across sessions and alters nothing already configured.

**Secondary — Interrupted user**
- As a user who closed the tab mid-flow, I want to resume at the correct step without re-entering the Arr URL/API key or duplicating instances/databases.

### Business Rules

1. **Wizard runs only after account setup.** It is layered strictly *after* the existing `/auth/setup` (admin-account) gate — never before or instead of it.
2. **Completion is deployment-wide, not per-user** (matches the `setup_state` singleton and single-admin assumption).
3. **First-run signal = dedicated flag + entity presence, never `default_database_linked`.** Show the wizard when `wizard_completed = 0` AND `wizard_dismissed_at IS NULL` AND (no enabled Arr instance OR no linked DB). `default_database_linked` is set on every boot regardless of link success (`hooks.server.ts` auto-link), so it is unusable as a completion proxy.
4. **"Setup complete" bar** = ≥1 Arr instance connected AND ≥1 PCD linked. Profile selection and first sync are valuable but do not block "complete" — a user who links a DB but defers profiles should resume, not restart.
5. **Skip is durable and reversible.** Sets `wizard_dismissed_at`; re-enterable from Settings ("Re-run onboarding").
6. **Env-preseeded state short-circuits steps.** If `reconcileEnvInstances()` created instances, or `PRAXRR_DEFAULT_DB_URL` auto-linked at boot, the relevant step detects existing state and presents "already done" rather than re-prompting.
7. **`PRAXRR_DEFAULT_DB_URL=""`** is an intentional opt-out — the DB step must still offer to link (default suggestion or custom), not treat empty as "nothing to do."
8. **Arr-scoped profile compatibility** — validate selected profiles against app-compatible quality names via `quality_api_mappings` for the target `arr_type`; do NOT rely on `arr_type='all'` scores and do NOT require `enabled=1` (CLAUDE.md guardrails).

### Edge Cases

| Scenario | Expected Behavior | Notes |
| -------- | ----------------- | ----- |
| Env-reconciled instance already present | Connect step shows it as connected (read-only for `source:'env'`) or skips forward | Don't prompt to add a duplicate |
| Default DB auto-linked at boot | Link step detects existing `database_instances` row, shows "already linked", advances | Idempotent |
| `PRAXRR_DEFAULT_DB_URL=""` | Link step still offers default suggestion + custom | No fallback URL substitution |
| Local-path / non-git PCD source | Degrade gracefully; never 500 | CLAUDE.md Local-Path guardrails; **security recommends git-URL-only in wizard** (see C4) |
| Zero compatible profiles for `arr_type` | Explicit empty state ("no Sonarr-compatible profiles yet"), not a blank list | 84% abandon unexplained blank states |
| Preview shows zero changes | Terminal success state ("Nothing to sync — already matches"), visually distinct from failed preview | — |
| User deletes only instance after "completing" | Re-entry into wizard on next load unless a dismiss/complete flag is set | Argues for explicit flag over pure inference |

### Success Criteria

- [ ] A brand-new deployment goes from `/auth/setup` through a previewed first sync using only the guided flow (zero required manual visits to `/arr/new`, `/databases/new`, `/arr/[id]/sync`).
- [ ] Env-reconciled instances / auto-linked default DB are not redundantly re-requested.
- [ ] "Skip wizard" is one explicit action, persists across sessions, reversible from Settings.
- [ ] No new parallel implementation of connection testing, instance creation, PCD linking, profile listing, or sync preview/apply — the wizard is composition.
- [ ] Abandoning at any step and returning resumes at the correct step with no data loss or duplicate creation.
- [ ] `/setup/*` and any setup API surface are unreachable by unauthenticated callers once setup is complete; the connection test rejects SSRF targets (metadata/link-local).

## Technical Specifications

### Architecture Overview

```
Browser (/setup/* route group, Svelte 5 no-runes)
  │  onclick handlers + fetch
  ▼
hooks.server.ts handle():                    routes/setup/+layout.server.ts
  [1] auth.needsSetup → /auth/setup   ──────▶  resolve current step from persisted state
  [2] auth required → /auth/login              (getSetupProgress + wizard flags) → redirect
  [3] NEW wizard gate (page-nav only,          to first incomplete step
      never /api/*, after [1]/[2])
  [4] NEW reverse gate (done/skipped
      user hitting /setup/* → /)
      │
      ▼
Reused server primitives (NO duplication):
  arrInstancesQueries.create ·  pcdManager.link ·  arrSyncQueries.saveQualityProfilesSync
  createArrClient().testConnection ·  POST /api/v1/sync/preview (#7) + apply
      │
      ▼
setup_state (singleton) + arr_instances + database_instances + arr_sync_quality_profiles
```

### Data Models

#### `setup_state` (extend existing singleton — migration, NOT `schema.sql`)

Current columns: `id (PK, CHECK id=1)`, `default_database_linked`, `created_at`, `updated_at`.

New migration `packages/praxrr-app/src/lib/server/db/migrations/<YYYYMMDD>_add_setup_wizard_state.ts`
(pick next unused integer `version`; **statically register** it: add the `import` and the entry in
`loadMigrations()` in `migrations.ts` — the runner is not filesystem-scanned):

| Field | Type | Constraints | Description |
| ----- | ---- | ----------- | ----------- |
| `wizard_completed` | INTEGER | NOT NULL DEFAULT 0 | User finished the flow |
| `wizard_dismissed_at` | TEXT (datetime) | nullable | "Skip wizard" audit trail; distinct from completed |
| `wizard_current_step` | TEXT | NOT NULL DEFAULT 'welcome' | Resume point; server-validated against enum |

Enum: `welcome | connect-arr | link-database | select-profiles | preview-sync | done`.

**Do not overload `default_database_linked`** (distinct startup-auto-link semantics). No new tables:
instances/databases/profile-selections all reuse existing tables via existing query layers.

Extend `setupStateQueries` (`db/queries/setupState.ts`) with: `getWizardState()`, `setWizardStep(step)`
(fail-fast on unknown enum), `markWizardCompleted()`, `markWizardDismissed()`, `wizardShouldRun()`.

#### Reused tables (written via existing query layers)

| Table | Written by | Via |
| ----- | ---------- | --- |
| `arr_instances` + `arr_instance_credentials` | Connect step | `arrInstancesQueries.create(input, credentialInput)` |
| `database_instances` + `database_instance_credentials` | Link step | `pcdManager.link(options)` |
| `arr_sync_quality_profiles` (+ config) | Select step | `arrSyncQueries.saveQualityProfilesSync(instanceId, selections, config)` |

### API Design

**Decision D2 (see Decisions Needed): thin wizard-state endpoints + reuse for domain writes.** The two
research tracks converged on: keep a small set of `/api/v1/setup/*` endpoints for **wizard state and the
connection test**, and **reuse existing routes/query layers** for the heavy domain writes (instance
create, DB link, profile save, sync preview/apply) rather than duplicating their logic. Whether the
connect/database/profile steps *embed existing forms/components* or *deep-link into the canonical routes*
is Decision D1.

Every `/api/v1/setup/*` handler MUST, as its first statement, call a server-side guard that (a) requires
auth per the active AUTH mode and (b) asserts setup is still in progress — never rely on `PUBLIC_PATHS`
placement for authorization (security C1).

#### `GET /api/v1/setup/state`
**Purpose**: wizard + prerequisite state for the shell (resume step, prerequisite checkmarks, default-DB hint).
**Auth**: required (session per AUTH mode).
**Response (200)**:
```json
{
  "wizard": { "completed": false, "dismissedAt": null, "currentStep": "connect-arr" },
  "prerequisites": { "hasArrInstance": true, "hasLinkedDatabase": false, "hasProfileSelections": false },
  "defaultDatabase": { "configured": true, "url": "https://github.com/yandy-r/praxrr-db", "alreadyLinked": false }
}
```
`prerequisites` derived from `arrInstancesQueries.getAll()` / `databaseInstancesQueries.getAll()` / `arrSyncQueries`. `defaultDatabase.configured=false` when `PRAXRR_DEFAULT_DB_URL=""`.

#### `PATCH /api/v1/setup/state`
**Purpose**: persist step progression only (no domain writes here).
**Request**: `{ "currentStep": "link-database" }` → **200** wizard block. **Errors**: `400 { "error": "Invalid step: <x>" }`.

#### `POST /api/v1/setup/test-connection`
**Purpose**: inline connectivity validation. Wraps `createArrClient(...).getSystemStatus()`.
**Request**: `{ "type": "radarr", "url": "http://localhost:7878", "apiKey": "abc123" }`
**Response (200 reachable)**: `{ "success": true, "appName": "Radarr", "version": "5.14.0.9383" }`
**Response (failure)**: `{ "success": false, "reason": "unreachable|unauthorized|invalid_response|timeout" }` (sanitized enum; log full error server-side).
**Rules**: reject non-`radarr|sonarr|lidarr` (400); **call `assertSafeArrUrl(url)` before any outbound request** (security C3 — block cloud-metadata `169.254.169.254`/`fd00:ec2::254` + link-local + `0.0.0.0`, `http`/`https` only, `redirect:'manual'`); IP-keyed rate limit (security W2).

#### `POST /api/v1/setup/complete` / `POST /api/v1/setup/skip`
`complete` → `markWizardCompleted()`; `skip` → `markWizardDismissed()`. Both idempotent, **200** wizard block.

#### Reused (unchanged): `POST /api/v1/sync/preview` (#7)
Preview step calls the existing endpoint → `SyncPreviewResult` (`$sync/preview/types.ts`); apply via the existing `/api/v1/sync/preview/[previewId]/apply` path. **Do not build a new sync executor or preview format.**

> Contract-first: add a `Setup` tag + these paths/schemas to `docs/api/v1/openapi.yaml`, run `deno task generate:api-types`, import from `$api/v1.d.ts`, then `deno task check`.

### System Integration

#### Files to Create
- `db/migrations/<YYYYMMDD>_add_setup_wizard_state.ts` — wizard columns.
- `$server/setup/progress.ts` — `getSetupProgress()` (pure, sync): `{ hasArrInstance, hasDatabase }` from existing queries; single source of truth used by `hooks.server.ts` gate + `+layout.server.ts`. Plus `wizardShouldRun` gate helper.
- `routes/api/v1/setup/state/+server.ts` (GET+PATCH), `.../test-connection/+server.ts`, `.../complete/+server.ts`, `.../skip/+server.ts`.
- `routes/setup/`: `+layout.server.ts`, `+layout.svelte` (stepper chrome + Skip), `+page.server.ts` (index→current step), and step folders `welcome/ connect-arr/ link-database/ select-profiles/ preview-sync/ done/` each with `+page.svelte` (+ `+page.server.ts` where a load/action is needed).
- Tests under `packages/praxrr-app/src/tests/` (see Test Strategy).

#### Files to Modify
- `db/queries/setupState.ts` — extend `SetupState` + wizard methods.
- `db/migrations.ts` — import + register new migration in `loadMigrations()`.
- `hooks.server.ts` — add wizard gate + reverse gate in `handle` (after account-setup/login gates; page-nav only; never `/api/*`).
- `$auth/middleware.ts` — special-case `/setup` reachability like `/auth/setup` (do not widen `PUBLIC_PATHS`).
- `docs/api/v1/openapi.yaml` → regenerate `$api/v1.d.ts`.
- `$utils/arr/base.ts` — add `getSystemStatus()` returning parsed `{ appName, version } | null` (keep `testConnection(): boolean` wrapper). Add shared `assertSafeArrUrl()` (new small `$arr/urlSafety.ts`) and call it in **both** the new endpoint and the existing `/arr/test` route.

#### Explicitly NOT changed
- `schema.sql` (reference only), `seedBuiltInBaseOps.ts` (no PCD base-op migration), legacy `/arr/new`, `/arr/test`, `/databases/new/custom` (left intact).

## UX Considerations

### User Workflows

#### Primary Workflow: Guided first-run
1. **Welcome** — plain-language explainer; primary "Get started", de-emphasized-but-visible "Skip wizard".
2. **Connect Arr instance** — name/type/URL/API key; explicit "Test connection" with idle→testing→success/fail states; advance only on green.
3. **Link PCD database** — default `Praxrr-DB` pre-selected; custom source behind collapsed disclosure; detect already-linked default and show as done.
4. **Select profiles/custom formats** — pre-check a recommended baseline (if PCD defines one) rather than a blank multi-select; filter strictly by target `arr_type`.
5. **Preview & Sync** — dry-run diff of exactly what will change (reuse #7 render components); explicit confirm; treat as dry run, not "Are you sure?".
6. **Done** — success + next steps.

#### Error Recovery
- **Connection test fail** — distinguish "unreachable" (URL field) vs "reachable but key rejected" (API-key field) with specific copy; retry without losing typed fields; block forward progress until success.
- **PCD clone fail** — catch like `databases/new/custom` (`fail(500,{error,values})`), stay on step, preserve input; non-git/local-path failures get distinct copy.
- **No profiles selected** — allow proceeding; preview then shows "no changes".
- **Preview compute fail vs zero-change** — visually distinct states.

### UI Patterns

| Component | Pattern | Notes |
| --------- | ------- | ----- |
| Progress | Horizontal 6-step stepper (desktop) → "Step X of 6" counter (mobile, existing Tailwind breakpoint) | Consistent placement all steps; do NOT use `$ui/navigation/tabs` (section nav, not a stepper) |
| Forms | Reuse `$ui/form/*`, `Button`, `Modal`, dirty store, `alertStore.add` | No new form atoms |
| Connection test | Inline spinner (<2s), not skeleton | Debounce typing-triggered retest 500ms–1s |
| PCD clone / preview | Labeled indeterminate / staged microcopy if >~3s | "Cloning Praxrr-DB…", "Comparing profiles…" |
| Preview diff | Mobile-safe (stacked cards / scroll affordance) | Tables break responsive |

### Accessibility Requirements
- Per-step page title/heading includes progress ("Connect Arr Instance — Step 2 of 6").
- Focus moves to new step's heading/first field on every Next/Back; transitions require explicit activation, never a focus event.
- Async validation announced via ARIA live region; errors move focus to first invalid field with specific message.
- No wizard session timeout (state persisted server-side); respect reduced motion. Manual keyboard + one screen-reader pass before shipping.

### Performance UX
- **Loading**: spinner for <2s test; labeled/determinate for clone & preview >~3s.
- **Optimistic vs pessimistic**: all steps pessimistic — don't advance until server confirms; don't show "Done" until sync completed/queued.

## Recommendations

### Implementation Approach
**Route-based steps + server-authoritative current-step resolution; client store holds transient form state only.** Ship a **thin vertical slice first** (gate + state + Welcome/Done + Skip), then layer real steps behind it so `main` is always green and partial merges never expose a half-built flow (unbuilt steps are simply skipped by the resolver).

**Phasing**
1. **Phase 0 — State + gating spine**: migration, `setupStateQueries` extensions, `getSetupProgress()`, `hooks.server.ts` gate + reverse gate, `/setup/welcome` + `/setup/done` placeholders, Skip action, auth-mode matrix tests. (De-risks naming + detection decisions.)
2. **Phase 1 — Connect Arr** + **SSRF hardening** (`assertSafeArrUrl`, shared with `/arr/test`) + `getSystemStatus()`.
3. **Phase 2 — Link PCD DB** (default vs custom; non-git graceful).
4. **Phase 3 — Select profiles/CFs** (Arr-scoped compatibility via `quality_api_mappings`).
5. **Phase 4 — Preview & Sync** (reuse #7; terminal marks `wizard_completed`).
6. **Phase 5 — Polish** (resume banner, re-run from Settings, funnel logging). Non-blocking.

Critical path: P0 → P1 → P4. P2 and P3 parallelizable once P0 lands.

### Technology Decisions
| Decision | Recommendation | Rationale |
| -------- | -------------- | --------- |
| Route topology | Route-per-step under `/setup/` | Matches "Routes over modals"; free back/fwd + deep-link resume; small testable steps |
| Step source of truth | Server-authoritative | Survives refresh; resume free; no client/server drift |
| Completion signal | Dedicated `wizard_completed` flag | `default_database_linked` set on every boot regardless (R3) |
| Namespace | `/setup/` distinct from `/auth/setup` | Avoid overloading account-creation semantics/public-path exemption |
| Connection test shape | Add `getSystemStatus()`, keep boolean `testConnection` | Show "Connected to Radarr 5.x", no behavior change to existing callers |
| Custom-format selection | Not independent; follows chosen profiles | No per-instance CF table exists; present CFs as read-only context |

### Quick Wins
- Reuse `InstanceForm.svelte` (`mode="create"`) — connect step is mostly a wrapper.
- Default-DB step is often a confirmation (already auto-linked at startup).
- Preview step is a straight fetch to `POST /api/v1/sync/preview` + existing render components.

### Future Enhancements
- "Connect another instance" re-entry (addresses Home Assistant one-time-only gap); multi-instance loop; funnel telemetry via structured `logger.info`; re-run onboarding from Settings.

## Risk Assessment

### Technical Risks
| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| First-run detection uses wrong signal (`default_database_linked`) | High | High | Dedicated `wizard_completed` flag; derive step from user-owned facts + flag |
| Duplicating vs reusing existing forms/logic | High | Med | Reuse `InstanceForm`, query layers, `POST /api/v1/sync/preview`; steps are wrappers |
| Arr-semantic drift in profile step | Med | High | Per-`arr_type` compatibility via `quality_api_mappings`; no `arr_type='all'` reliance; no `enabled=1` requirement |
| Hard redirect traps returning/power users | Med | Med | Reverse gate + dismissable "Finish setup" affordance; only account-creation stays a hard gate |
| Half-wired gate strands first-run users | Med | High | Phase 0 (gate+state) lands test-covered before reuse phases |
| Local-path/non-git PCD source 500s | Med | Med | Degrade gracefully (CLAUDE.md); security recommends git-URL-only in wizard |

### Integration Challenges
- Touches auth middleware + migration chain + PCD manager + sync-preview simultaneously → Phase 0 must land first, fully tested.

### Security Considerations
*(Full detail + IDs in `research-security.md`.)*

#### Critical — Hard Stops
| Finding | Risk | Required Mitigation |
| ------- | ---- | ------------------- |
| C1 — new `/api/v1/setup/*` endpoints unauthenticated if worked around via `PUBLIC_PATHS` | Anonymous caller drives setup / reaches endpoints post-complete | Per-handler guard: require auth (per AUTH mode) + assert setup-in-progress; never authorize via `PUBLIC_PATHS` |
| C2 — no anti-hijack binding on first-run (CSRF disabled app-wide, bind `0.0.0.0`) | Race-to-setup: attacker points Praxrr at malicious Arr/PCD before admin finishes | Setup token per boot on POSTs and/or restrict `/auth/setup`+`/api/v1/setup/*` to local IPs while `needsSetup`; narrow `csrf.trustedOrigins` off `'*'` |
| C3 — connection test `fetch()`es user URL with no host validation (SSRF) | Probe `127.0.0.1`/`169.254.169.254` (IMDS)/RFC1918; port-scan oracle | `assertSafeArrUrl()` before client build (deny cloud-metadata + link-local + `0.0.0.0`; `http/https` only; `redirect:'manual'`); IP-keyed rate limit. **Narrow deny-list, not allow-list** (self-hosted Arr legitimately on LAN) |
| C4 — local-path PCD linking has no root confinement (arbitrary dir read) | Pre-auth arbitrary-directory read/exfiltration | Do **not** expose local-path linking in the wizard (git-URL-only); keep local-path in authenticated Databases UI with root confinement |

#### Warnings — Must Address
| Finding | Risk | Mitigation |
| ------- | ---- | ---------- |
| W1 — raw `error.message`/`stderr` returned to client | Internal detail / token leak | Sanitized reason enum to client; full detail server-side only |
| W2 — no rate limit on test/link endpoints | Port-scan / git-clone DoS | Reuse `checkWriteRateLimit`-style token bucket, IP-keyed (extract to `$utils/rateLimit.ts`) |
| W4/W5 — PAT echoed in clone error / credentials-in-URL | Token disclosure/plaintext storage | Strip `https://<token>@` from errors; reject `repositoryUrl` with `@` authority |
| W6 — `AUTH=off` makes `needsSetup=false`, so wizard never triggers if keyed to `existsLocal()` | Wizard never runs (or over-runs) under `AUTH=off` | Gate wizard on `wizard_completed` flag independent of auth mode |

#### Advisories — Best Practices
- A1: assert no `Access-Control-Allow-Origin` on setup endpoints (test guard). A3: keep new queries on Kysely builder (no raw SQL). A4: reuse existing AES-GCM credential encryption helpers for every secret.

## Task Breakdown Preview

### Phase 0: State + Gating Spine
**Focus**: enter/skip/complete a wizard with no real steps; de-risk naming + detection + auth gating.
**Tasks**: migration + `setupStateQueries` extensions; `getSetupProgress()`; `hooks.server.ts` gate + reverse gate; `/setup` layout + welcome/done placeholders; Skip action; `GET/PATCH /api/v1/setup/state`, `complete`, `skip`.
**Parallelization**: migration+queries independent of layout scaffold; API handlers after queries.

### Phase 1: Connect Arr + SSRF Hardening
**Focus**: highest-value step + close CRITICAL C3.
**Dependencies**: Phase 0.
**Tasks**: `assertSafeArrUrl()` + `getSystemStatus()`; `POST /api/v1/setup/test-connection` (guarded, rate-limited); `/setup/connect-arr` (embed or deep-link per D1) reusing `arrInstancesQueries.create`.

### Phase 2: Link PCD DB  ·  Phase 3: Select Profiles (parallel after P0)
**Focus**: DB link (default/custom, non-git graceful); profile selection with per-`arr_type` compatibility.
**Tasks**: `/setup/link-database` reusing `pcdManager.link`; `/setup/select-profiles` reusing `arrSyncQueries.saveQualityProfilesSync` + `quality_api_mappings` compatibility.

### Phase 4: Preview & Sync
**Focus**: reuse #7; terminal marks completion.
**Dependencies**: Phase 1 + Phase 3.
**Tasks**: `/setup/preview-sync` calling `POST /api/v1/sync/preview` + existing render/apply; mark `wizard_completed`; `/setup/done`.

### Phase 5: Polish (non-blocking)
Resume banner on `/`, re-run from Settings, funnel logging, multi-instance loop.

## Decisions Needed

1. **D1 — Embed existing forms/components in `/setup/*` vs deep-link into canonical routes (`/arr/new`, `/databases/new/*`, `/arr/[id]/sync`).**
   - Options: (a) embed `InstanceForm.svelte`/DB form + reuse sync components in-wizard; (b) deep-link forward into the real routes with `?returnTo=/setup/...`.
   - Impact: (a) tighter guided feel but must handle component route-coupling (e.g. `SyncPreviewTrigger` reads `$page.params.id`); (b) least code, but a less "wizard-like" feel and requires `returnTo` plumbing on existing routes.
   - **Recommendation**: embed the two `InstanceForm` variants (steps 2–3, low coupling) and, for profiles+preview (steps 4–5, ~1500 lines of coupled sync UI), **deep-link into `/arr/[id]/sync`** to avoid a second maintenance surface. Confirm.

2. **D2 — Domain writes via new `/api/v1/setup/*` orchestration endpoints vs reuse of legacy form actions.**
   - **Recommendation**: thin `/api/v1/setup/*` for wizard state + connection test; reuse existing query/manager layer (or existing routes per D1) for instance/DB/profile writes. No duplicated business logic.

3. **D3 — Skip semantics**: `wizard_completed=1` (never nag) vs `wizard_dismissed_at` + dismissable banner (nag-with-dismiss). **Recommendation**: `wizard_dismissed_at` + banner (reversible).

4. **D4 — First-run trigger**: dismissable "Finish setup" banner on `/` vs soft redirect into `/setup`. **Recommendation**: reverse-gate `/setup` for done/skipped users; use a banner nudge, not a hard redirect from `/`, so power users aren't trapped.

5. **D5 — `AUTH=off`/reverse-proxy deployments**: run the guided wizard or suppress it? Affects gating condition. **Recommendation**: gate on `wizard_completed` independent of auth mode (so it runs), but confirm headless/automated installs want it.

6. **D6 — Recommended baseline profiles**: does the PCD schema define a "recommended" set for Step 4 pre-selection, or is that new PCD metadata? Confirm with schema owners; if absent, Step 4 ships without pre-check.

## Test Strategy (repo conventions: unit-first, one e2e happy-path)

- **Unit** (`packages/praxrr-app/src/tests/`, extend `BaseTest.ts`; add `setup-wizard` alias in `scripts/test.ts`): `getSetupProgress()` (none/instance-only/instance+db); `setupStateQueries` wizard transitions; `hooks.server.ts` gate (allowed paths while incomplete, no redirect once complete, never interferes with `auth.needsSetup`, never gates `/api/*`); auth-mode matrix (on/local/off/oidc); `assertSafeArrUrl()` rejection cases (metadata/link-local/`0.0.0.0`/non-http); endpoint validation + `arr_type` allow-listing; per-`arr_type` profile compatibility; no CORS header on setup endpoints.
- **E2E** (`deno task test:e2e`, Playwright): one happy-path click-through of the full funnel.

## Research References

- [research-external.md](./research-external.md): Servarr connectivity API, SvelteKit stepper patterns (no-runes), accessibility
- [research-business.md](./research-business.md): user stories, first-run detection, resume/skip rules, existing-code integration map
- [research-technical.md](./research-technical.md): architecture, migration, `/api/v1/setup/*` contracts, file-by-file changes, technical decisions D1–D7
- [research-ux.md](./research-ux.md): workflows, stepper/accessibility, error state machine, competitive analysis
- [research-security.md](./research-security.md): severity-leveled findings C1–C4/W1–W6/A1–A4 (auth gating, SSRF, path traversal, CSRF race)
- [research-practices.md](./research-practices.md): reusable-code map, KISS (embed vs deep-link), modularity, testability
- [research-recommendations.md](./research-recommendations.md): phasing, risk table R1–R10, alternatives A1–A4, task breakdown
