# Setup Wizard (#12) — Business Analysis (plan-ready rows)

Distilled from `docs/plans/setup-wizard/feature-spec.md` and `research-business.md`, verified against
the codebase (evidence cited inline). Discovery-table format for the `ycc:prp-plan` synthesizer.

## User Story

**As a first-run operator, I want** a guided linear flow that carries me from a fresh install
(admin account created, nothing else configured) through connecting an Arr instance, linking a PCD
database, selecting quality profiles/custom formats, and previewing my first sync — **so that** I
never have to discover the correct order of `/arr/new` → `/databases/new` → `/arr/[id]/sync` myself,
the wizard never intercepts me again once setup is complete, and I can skip or resume it at any
point without losing data or duplicating what I already created.

## Problem → Solution

**Problem:** A brand-new Praxrr deployment drops the operator onto an empty dashboard with no guided
path, forcing manual discovery of a multi-route setup sequence — the primary driver of the 80%+
initial-configuration abandonment rate. **Solution:** A route-based `/setup/*` wizard that is a thin
orchestration/gating layer over already-production-tested primitives (instance create, PCD link,
profile save, sync preview/apply from #7), gated on a dedicated `wizard_completed` flag, guarded on
every setup endpoint, and hardened against SSRF and unauthenticated access.

## Codebase Evidence (current behavior verified)

- **`default_database_linked` is unusable as a completion proxy.** `setupState.ts` exposes only
  `default_database_linked` (`setupState.ts:8`) via `isDefaultDatabaseLinked()`
  (`setupState.ts:32-34`) / `markDefaultDatabaseLinked()` (`setupState.ts:39-44`). At boot,
  `hooks.server.ts:59` runs the auto-link once and calls `markDefaultDatabaseLinked()` on the
  **empty-URL opt-out path** (`hooks.server.ts:95`), the **success path** (`hooks.server.ts:113`),
  AND the **failure/catch path** (`hooks.server.ts:121`) — so the flag is `1` after first boot
  regardless of outcome. A dedicated `wizard_completed` column (does not exist today) is mandatory.
- **Existing gate ordering in `handle`.** `hooks.server.ts:207` `handle` runs: `getAuthState`
  (`:208`) → account-setup gate `auth.needsSetup → /auth/setup` (`:214-219`) → skipAuth early-return
  (`:222-224`) → reverse gate for `/auth/setup` after user exists (`:227-229`) → public-path check
  (`:232-234`) → unauthenticated `401` for `/api/*` else redirect `/auth/login` (`:237-250`). **No
  wizard gate exists.** The new page-nav wizard gate + reverse gate must slot in after the
  login/auth resolution and must exclude `/api/*` (the API branch at `:238` already special-cases
  `/api`).
- **Public-path allow-list.** `middleware.ts:27` `PUBLIC_PATHS = ['/auth/login', '/auth/setup',
  '/auth/oidc', '/api/v1/health']`; `isPublicPath` (`middleware.ts:32-34`). `/setup` reachability
  must be special-cased like `/auth/setup` **without** widening `PUBLIC_PATHS` (security C1) —
  authorization must not come from public-path placement.
- **`AUTH=off` returns `needsSetup:false` + `skipAuth:true`** (`middleware.ts:44-51`); `AUTH=on`
  default sets `needsSetup = !hasLocalUsers` (`middleware.ts:119`). The wizard gate must key on the
  `wizard_completed` flag independent of auth mode (security W6), and account for the `skipAuth`
  early-return at `hooks.server.ts:222-224`.

## Acceptance Criteria rows

| #   | Criterion | Testable? |
| --- | --- | --- |
| AC1 | First-run detection keys on a NEW `setup_state.wizard_completed` column (default 0); `wizardShouldRun()` returns true iff `wizard_completed=0` AND `wizard_dismissed_at IS NULL` AND (no `arr_instances` row OR no `database_instances` row). It NEVER reads `default_database_linked`. | Yes — unit test `wizardShouldRun()` / `getSetupProgress()` across {no entities, instance-only, instance+db, completed, dismissed}; grep asserts no `default_database_linked` / `isDefaultDatabaseLinked` reference in wizard gate code. |
| AC2 | The wizard page-nav gate runs in `hooks.server.ts` handle strictly AFTER the account-setup gate (`auth.needsSetup → /auth/setup`) and the login/auth resolution — never before or instead of it; an unconfigured, authenticated user hitting a non-`/setup` page is redirected to the current wizard step. | Yes — unit test asserts `auth.needsSetup` still short-circuits to `/auth/setup` unchanged, and the wizard redirect only fires once `needsSetup=false` and user is authenticated. |
| AC3 | The wizard gate NEVER intercepts any request whose path starts with `/api/` (or `/api/v1/`); API requests pass through the gate untouched regardless of wizard state. | Yes — unit test drives `/api/v1/...` paths through `handle` while wizard incomplete and asserts no redirect (no 3xx) is issued by the wizard gate. |
| AC4 | A reverse gate redirects users who have completed OR dismissed the wizard away from any `/setup/*` page to `/` (mirroring the existing `/auth/setup → /` block at `hooks.server.ts:227-229`); direct navigation to `/setup/*` by a done/skipped user is a no-op redirect. | Yes — unit test: given `wizard_completed=1` (and separately `wizard_dismissed_at` set), request to `/setup/welcome` returns redirect to `/`. |
| AC5 | "Skip wizard" persists durably by setting `setup_state.wizard_dismissed_at` (nullable timestamp, new column); after skip, the wizard does not re-appear on subsequent loads/sessions, and skip alters nothing already configured (env-reconciled instances, auto-linked DB stay intact). | Yes — unit test `markWizardDismissed()` sets timestamp; `wizardShouldRun()` returns false afterward; assert no writes to `arr_instances`/`database_instances` during skip. |
| AC6 | Skip is reversible: an authenticated user can re-enter the wizard from Settings ("Re-run onboarding"), which clears/overrides the dismissed state so `/setup/*` becomes reachable again. | Yes — unit/integration test: after re-run action, `wizardShouldRun()` (or reverse-gate) permits `/setup/*` again. |
| AC7 | Resume: on wizard entry the current step is resolved server-side from persisted state (`wizard_current_step` validated against enum `welcome\|connect-arr\|link-database\|select-profiles\|preview-sync\|done`) plus entity preconditions; a user who closed the tab mid-flow returns to the first incomplete step without re-entering the Arr URL/API key and without creating duplicate instances/databases. | Yes — unit test step-resolution: {no instance→connect-arr, instance only→link-database, instance+db→select-profiles, profiles saved→preview-sync}; `setWizardStep()` fails fast on unknown enum value. |
| AC8 | Env-preseeded state short-circuits steps: if `reconcileEnvInstances()` created an instance, the connect step shows it as already connected (read-only for `source:'env'`); if `PRAXRR_DEFAULT_DB_URL` auto-linked a DB at boot, the link step detects the existing `database_instances` row and presents "already linked" rather than re-prompting. | Yes — integration test with a seeded `source:'env'` instance / existing `database_instances` row asserts the respective step reports "already done" and does not prompt to add a duplicate. |
| AC9 | `PRAXRR_DEFAULT_DB_URL=""` (intentional opt-out) does NOT suppress the link step: the DB step still offers a default suggestion + custom option; no fallback URL is substituted, and `defaultDatabase.configured=false` is surfaced in `GET /api/v1/setup/state`. | Yes — unit test the state endpoint / step logic with env var set to empty string; assert link step still renders an offer and no hardcoded fallback URL is injected. |
| AC10 | No parallel reimplementation: the wizard reuses `arrInstancesQueries.create` (connect), `pcdManager.link` (link), `arrSyncQueries.saveQualityProfilesSync` (profiles), and `POST /api/v1/sync/preview` + its `/apply` path (preview/sync — #7). No new connection-test/instance-create/PCD-link/profile-list/sync-preview logic is authored. | Yes — code-review/grep assertion that `/setup` routes and `/api/v1/setup/*` handlers import the existing query/manager layers and #7 endpoints; no duplicate diff/preview/executor introduced. |
| AC11 | Arr-scoped profile compatibility: the select-profiles step validates profiles against app-compatible quality names via `quality_api_mappings` for the target `arr_type`; it does NOT rely on `arr_type='all'` scores and does NOT require `enabled=1` (CLAUDE.md guardrails). | Yes — unit test per-`arr_type` compatibility filter: zero-compatible case yields explicit empty state (not blank list); an all-disabled-qualities profile still evaluated against app-compatible names. |
| AC12 | **[CRITICAL C1]** Every `/api/v1/setup/*` handler calls, as its FIRST statement, a server-side guard that (a) requires auth per the active AUTH mode and (b) asserts setup is still in progress; unauthenticated callers and post-complete callers are rejected. Authorization is never derived from `PUBLIC_PATHS` placement. | Yes — per-endpoint tests: anonymous request → 401/403; request after `wizard_completed=1` → rejected; assert the guard is invoked before any handler body logic (auth-mode matrix on/local/off/oidc). |
| AC13 | **[CRITICAL C3]** `POST /api/v1/setup/test-connection` calls `assertSafeArrUrl(url)` BEFORE any outbound `fetch`, rejecting cloud-metadata (`169.254.169.254`, `fd00:ec2::254`), link-local, and `0.0.0.0`; permits only `http`/`https`; uses `redirect:'manual'`; and is IP-keyed rate-limited. Deny-list (not allow-list) so LAN Arr hosts remain reachable. | Yes — unit test `assertSafeArrUrl()` rejection set {metadata IPv4/IPv6, link-local, `0.0.0.0`, non-http scheme} and acceptance of RFC1918/localhost Arr URLs; endpoint test asserts guard runs before fetch and rate limit engages. |
| AC14 | **[CRITICAL C4]** The wizard link-database step accepts git URLs only; local-path / `file://` PCD linking is NOT exposed in the wizard (kept in the authenticated Databases UI). Non-git / local-path sources degrade gracefully and never return 500. | Yes — endpoint/UI test: `repositoryUrl` that is a local path or `file://` is rejected by the wizard step (git-URL-only); non-git source path returns a graceful error, not 500. |
| AC15 | Setup endpoints reject non-`radarr\|sonarr\|lidarr` `type` values (400) and return sanitized failure reasons only (`unreachable\|unauthorized\|invalid_response\|timeout`); raw `error.message`/`stderr`/PAT-bearing URLs are never returned to the client (W1/W4/W5). | Yes — unit test type allow-listing (reject `chaptarr`/`all`) and response-shape assertion that no raw error string / `https://<token>@` authority leaks to the client. |

## Cross-Arr / Portable Contract notes (plan must honor)

- AC11 enforces CLAUDE.md Cross-Arr Semantic Validation: resolve compatibility by explicit `arr_type`
  via `quality_api_mappings`; no sibling-app fallback; no `arr_type='all'` reliance; no `enabled=1`
  requirement.
- AC14 honors Local-Path Source Guardrails (non-git sources degrade, never 500) while the security
  recommendation narrows the *wizard* surface to git-URL-only.
