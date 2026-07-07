# Setup Wizard — Business Logic & Requirements Research

GitHub Issue: #12 (parent: #6) · Depends on: #7 (Sync Preview, already implemented) · Pairs with: #11, #29

## Executive Summary

Praxrr already has **three separate, non-overlapping "setup" concepts** in the codebase today. The new
`/setup/` wizard is a **fourth**, additive layer that must sit on top of them without duplicating or
colliding with any of them:

1. **`/auth/setup`** (existing route) — one-time creation of the local admin account. Gated by
   `AuthState.needsSetup` in `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`, which is
   `true` only when `usersQueries.existsLocal()` is `false`. This is pure authentication bootstrap and has
   **nothing to do** with Arr instances, PCD databases, or profiles. `hooks.server.ts` redirects here before
   anything else can be reached.
2. **`setup_state` singleton row + `PRAXRR_DEFAULT_DB_URL` auto-link** (existing, silent) — on every boot,
   `hooks.server.ts` checks `setupStateQueries.isDefaultDatabaseLinked()`; if false, it attempts to
   auto-link the default PCD repo via `pcdManager.link()` and marks `default_database_linked = 1`
   **regardless of success or failure** (fire-and-forget, never retried). This happens before the request
   handler runs, so by the time any user loads a page in their browser, this flag is already `1`.
3. **`reconcileEnvInstances()`** (existing, silent) — also runs in `hooks.server.ts` before the request
   handler, auto-registering Arr instances declared via environment variables (`source: 'env'` in
   `arr_instances`). A deployment can therefore already have Arr instances connected before any human ever
   sees the UI.
4. **The proposed `/setup/` wizard (issue #12)** — an interactive, human-facing flow: Welcome → Connect Arr
   instance → Link PCD database → Select profiles/formats → Preview & Sync → Done. This is a UI/UX layer,
   not a data-bootstrap layer. Its "first-run" signal must be **derived from actual entity state**
   (`arrInstancesQueries.getAll()`, `pcdManager.getAll()`), not from `setup_state.default_database_linked`,
   because that flag is already true after the first boot on every deployment and says nothing about
   whether a _human_ has connected anything.

The good news: nearly every piece of business logic the wizard needs already exists and is production-tested
— Arr connection validation (`/arr/test`), instance creation (`arrInstancesQueries.create` via `/arr/new`),
PCD linking (`pcdManager.link()` via `/databases/new/custom`), profile selection and sync preview/apply
(`/arr/[id]/sync` route, `sync/preview/*` module — issue #7 is already built). The wizard's job is
**orchestration and sequencing** of these existing primitives behind a guided, step-based UI — not
reimplementing them.

## User Stories

### 1. First-run new user (empty install)

- **As** someone who just deployed Praxrr for the first time (no admin account, no Arr instances, no PCD
  linked),
- **I want** a guided, linear flow that gets me from "nothing configured" to "my first sync previewed and
  applied"
- **so that** I don't have to discover on my own that I need to visit `/arr/new`, then `/databases/new`,
  then `/arr/[id]/sync` in the right order with the right inputs.
- Acceptance: after account creation (`/auth/setup`), the user lands in `/setup/welcome` (or is redirected
  there) instead of a mostly-empty dashboard.

### 2. Returning user (partially or fully configured)

- **As** a user who already has at least one Arr instance and a linked PCD (via prior manual setup, env-var
  reconciliation, or a completed wizard run),
- **I want** the wizard to never intercept my normal navigation again
- **so that** routine use of the app isn't interrupted by onboarding screens.
- Acceptance: wizard route redirects to `/` (or a chosen dashboard) if "setup complete" is already true;
  visiting `/setup/*` directly as a returning user is a no-op redirect, mirroring how `/auth/setup`
  redirects existing users to `/` today (see `+page.server.ts` load in `routes/auth/setup/`).

### 3. Power user who wants to skip

- **As** an experienced Radarr/Sonarr admin who already knows the tool (or is scripting/automating setup via
  env vars and API),
- **I want** a visible "Skip wizard" action from step one
- **so that** I can go straight to manual configuration (`/arr/new`, `/databases/new`) without being forced
  through guided steps.
- Acceptance: skipping persists a durable "wizard dismissed" state so the user is not re-prompted on next
  login; skip does not delete or alter anything already configured (e.g., env-reconciled instances stay
  intact).

### 4. Interrupted / partially-completed wizard user

- **As** a user who connected an Arr instance in the wizard but closed the tab before finishing profile
  selection,
- **I want** to resume roughly where I left off (or at minimum not be forced to re-enter the Arr URL/API key)
- **so that** the 80%+ abandonment problem this feature targets isn't just relocated one step later.
- Acceptance: wizard state (current step, and already-created instance/PCD IDs) survives a page reload;
  navigating back to `/setup/` mid-flow resumes at the correct step because that step's precondition
  (instance exists, PCD linked) is already satisfied.

## Business Rules

### When is the wizard shown?

- Shown only **after** auth setup is resolved (`needsSetup` is false, or `AUTH=off`/`local` bypass applies)
  — the wizard is a post-authentication concept. It must not run before or instead of `/auth/setup`.
- Shown when "setup incomplete" for the _current deployment_, not per-user — Praxrr's app DB is a shared
  singleton store (mirrors the `setup_state` singleton-by-design pattern), so wizard completion is a
  deployment-wide flag, not a per-account preference. Any authenticated user landing on an incomplete
  deployment sees the wizard (or is capable of resuming it); this matches the existing single-admin-account
  assumption baked into `/auth/setup`.
- **Not** driven by `setup_state.default_database_linked`. That field is already `1` on essentially every
  boot (success or failure) because of the auto-link fire-and-forget behavior in `hooks.server.ts:58-129`.
  Reusing it would mean the wizard almost never appears, defeating the feature.

### First-run detection semantics (the key design decision)

Recommend introducing an explicit **"setup complete"** signal, computed as a small set of checks against
real state rather than a single boolean flag written once:

- At least one `arr_instances` row exists (any `source`, `ui` or `env`) — `arrInstancesQueries.getAll().length > 0`.
- At least one `database_instances` row exists — `pcdManager.getAll().length > 0` (or
  `databaseInstancesQueries.getAll()`).
- These two together answer "has _any_ connection been made," which is the real prerequisite for a useful
  dashboard. Profile selection and sync are the wizard's later steps but are not required to consider setup
  "done" — a user can finish the wizard, decline to sync immediately, and still be a "configured" user.
- A separate, explicit **"wizard dismissed" / "wizard completed"** flag is still needed to support the
  "Skip wizard" story cleanly and to avoid re-showing the wizard to a power user who connected everything
  manually via `/arr/new` + `/databases/new` outside the wizard (their state would already satisfy the
  entity-existence check above, so no extra flag is strictly required for _them_ — the entity check alone
  naturally suppresses the wizard once they've done manual setup).
- Net rule: **show wizard if** `arr_instances` is empty **or** `database_instances` is empty **and** the
  user has not explicitly skipped. Once both collections are non-empty, treat setup as complete regardless
  of _how_ they became non-empty (wizard, manual routes, or env reconciliation).

### What counts as "setup complete"?

- Minimum bar: ≥1 Arr instance connected AND ≥1 PCD database linked. This is the same bar implied by issue
  #12's own design considerations ("check app DB for existing instances/PCDs").
  Profile/format selection and the first sync are valuable but should not block "complete" — a user who
  exits after linking a database but before selecting profiles has still made real progress and should not
  be shown the wizard from scratch again; they should resume, not restart.

### Resume / abandon behavior

- Because completion is derived from entity existence (not a single opaque flag), resuming is naturally
  supported: on wizard entry, compute which step's precondition is unmet and start there.
  - No Arr instance → start at "Connect Instance."
  - Arr instance exists, no PCD → start at "Link Database."
  - Both exist, no profile-selection saved for that instance (`arrSyncQueries.getFullSyncData(id)` empty) →
    start at "Select Profiles."
  - Profiles selected but never synced → start at "Preview & Sync."
- Abandonment (closing the tab) leaves whatever was already persisted (instance row, database row) intact;
  nothing needs an explicit rollback because each step's underlying action (`arrInstancesQueries.create`,
  `pcdManager.link`) is already transactional and atomic on its own.

### Skip persistence

- Needs a new, explicit, durable flag (the `setup_state` table is the natural home — it is already the
  "one-time setup operations" singleton per its own migration comment in
  `packages/praxrr-app/src/lib/server/db/migrations/039_create_setup_state.ts`). Add a column such as
  `wizard_dismissed_at` (nullable timestamp) rather than reusing `default_database_linked`.
- Skip must be reachable from the very first screen (per issue #12's explicit "Skip wizard" requirement),
  and should not be reversible-by-accident — but should be re-enterable manually (e.g., a "Run setup wizard
  again" link in Settings) since users may skip prematurely and want it back.

### Edge cases

- **Env-reconciled instances already present**: if `reconcileEnvInstances()` created instance(s) before the
  human ever loads the UI, the "Connect Instance" step should detect this and either skip straight past it
  or show the env instance as already connected (read-only, since env-sourced instances are managed via
  `updateEnvInstanceByApiKey`/`updateEnvInstanceById`, not general edit) rather than prompting to add another.
- **Default DB auto-link succeeded silently**: if `PRAXRR_DEFAULT_DB_URL` auto-linked successfully at boot,
  the "Link Database" step should detect the existing `database_instances` row and skip straight to profile
  selection, presenting the auto-linked DB as the source rather than asking the user to link one again.
- **Default DB auto-link was disabled** (`PRAXRR_DEFAULT_DB_URL=""`): per CLAUDE.md, this is an intentional
  opt-out; the wizard must still offer to link a database (default suggestion or custom) rather than
  treating the opt-out as "nothing to do here."
- **Multiple admins hitting `/setup/` concurrently**: given the single-admin-account assumption of
  `/auth/setup`, this is a low-probability race; still, entity-existence checks (not a step counter) make
  concurrent progress safe — two users can't corrupt "current step" because there isn't a single mutable
  step field, just derived state.

## Workflows

### Primary flow (happy path)

1. **Welcome** (`/setup` or `/setup/welcome`) — static explainer. Actions: "Get Started," "Skip wizard."
2. **Connect Instance** (`/setup/instance`) — form: name, type (radarr/sonarr/lidarr), URL, API key.
   - Inline validation reuses `POST /arr/test` (existing endpoint in
     `packages/praxrr-app/src/routes/arr/test/+server.ts`) — 3s timeout, no retries, for fast feedback,
     exactly as the manual `/arr/new` form presumably already leverages.
   - On submit, reuses `arrInstancesQueries.create()` (via the same validation/dedup/encryption path as
     `routes/arr/new/+page.server.ts`: name uniqueness, API-key-fingerprint dedup across all credential key
     versions, `encryptArrInstanceApiKey`).
   - If an env-sourced instance already exists, this step is skipped/pre-filled (see Edge Cases above).
3. **Link Database** (`/setup/database`) — choice between "Use default Praxrr-DB" (pre-fills
   `PRAXRR_DEFAULT_DB_URL`/branch/name if configured, or the hardcoded `https://github.com/yandy-r/praxrr-db`
   fallback) and "Custom repository" (name + URL, reusing the same non-GitHub-URL detection redirect used by
   `/databases/new/custom` for youtube/twitter/reddit URLs — the wizard should route those the same way, not
   silently accept them).
   - On submit, reuses `pcdManager.link()` exactly as `routes/databases/new/custom/+page.server.ts` does,
     including its rollback-on-failure behavior (removes the cloned directory and instance row if seeding/
     compiling the cache fails).
   - If auto-link already succeeded at boot, this step is skipped (see Edge Cases above).
4. **Select Profiles** (`/setup/profiles`) — reuse the quality-profile listing already scoped by `arr_type`
   (`qualityProfileQueries.list(cache, typedArrType)` as done in `routes/arr/[id]/sync/+page.server.ts`), and
   the same `arrSyncQueries.saveQualityProfilesSync()` persistence action. Per CLAUDE.md's cross-Arr
   guardrails, this must filter by the target instance's `arr_type` exactly as the existing sync page does
   — no shortcuts.
5. **Preview & Sync** (`/setup/sync`) — reuses the sync-preview module wholesale: `POST /api/v1/sync/preview`
   to generate, `GET /api/v1/sync/preview/[previewId]` to poll status/summary, `POST
/api/v1/sync/preview/[previewId]/apply` to confirm. The existing `SyncPreviewPanel.svelte` /
   `SyncPreviewTrigger.svelte` components from `routes/arr/[id]/sync/components/` are candidates to embed or
   adapt directly rather than rebuilding preview UI.
6. **Done** (`/setup/done`) — success state; marks setup as complete (in practice, a no-op beyond what steps
   2–4 already persisted) and links to the dashboard / next steps (progressive-disclosure surfaces per
   issue #11).

### Error recovery

- **Bad API key / unreachable Arr instance (step 2)**: `/arr/test` already returns
  `{ success: false, error }` with a 400 (auth/network failure) or 500 (unexpected) status and a message —
  the wizard step should surface that message inline and let the user retry without losing the
  name/type/URL fields already typed. Do not advance to step 3 until `success: true`.
- **PCD clone failure (step 3)**: `pcdManager.link()` throws (see `manager.ts` — catches failures during
  seeding/compiling and attempts to roll back the cloned directory and instance row, logging a warning if
  cleanup itself fails). The wizard must catch this the same way `routes/databases/new/custom/+page.server.ts`
  does — `fail(500, { error: message, values })` — and keep the user on the same step with their input
  preserved, not silently proceed as if linking succeeded.
- **Non-Git URL entered (YouTube/Twitter/Reddit) for step 3**: match the existing `/databases/new/custom`
  redirect-to-`/databases/bruh` UX rather than attempting (and failing) a git clone — or, for the wizard's
  simpler surface, show the equivalent inline warning without leaving the wizard shell.
- **No profiles selected (step 4)**: allow proceeding with zero selections (matches existing
  `saveQualityProfilesSync` accepting an empty array), but the Preview & Sync step should then show "no
  changes to preview" rather than erroring — this is a legitimate state for a user who wants to configure
  Arr connectivity now and choose profiles later from the normal `/arr/[id]/sync` page.
- **Sync preview generation failure (step 5)**: the preview store already models `PREVIEW_STATUS_FAILED` /
  `PREVIEW_STATUS_EXPIRED` (`sync/preview/store.ts`, surfaced via `getSyncPreviewRouteState` in the existing
  sync page) — the wizard's step 5 should reuse that same status mapping rather than inventing new states.
- **User abandons mid-wizard**: no special cleanup needed (see Resume/Abandon Business Rule above) — nothing
  is left in a half-committed state because each underlying action is already atomic.

## Domain Model

- **Arr instance** (`arr_instances` table / `arrInstancesQueries`): a connection to one Radarr, Sonarr, or
  Lidarr installation — `name`, `type`, `url`, encrypted `api_key` (+ `api_key_fingerprint` for dedup),
  `enabled`, `source` (`'ui'` = manually added, `'env'` = reconciled from environment variables).
- **PCD database** (`database_instances` table / `databaseInstancesQueries` / `pcdManager`): a linked Git (or
  local-path) repository of curated quality profiles, custom formats, and related entities, cloned to
  `local_path` and compiled into an in-memory SQLite cache (`pcdManager.getCache(id)`) for fast reads.
- **Quality profile**: a named entity inside a PCD's compiled cache, scoped to an `arr_type`
  (`qualityProfileQueries.list(cache, arrType)`); what the wizard's "Select Profiles" step lets the user pick
  per Arr instance.
- **Custom format**: sibling entity type to quality profiles within the same PCD cache, also arr-type scoped;
  issue #12 groups it with quality profiles in the "Select Profiles" step, but they are distinct entity
  types with their own list/read modules under `pcd/entities/`.
- **Sync (preview + apply)**: the process of reconciling a chosen instance's live Arr state against the
  PCD-derived desired state. `sync/preview/*` computes a diff (creates/updates/deletes with field-level
  changes) without touching the live instance; `apply` executes it. This is issue #7's feature, already
  implemented and reusable as-is.
- **Setup state**: currently a single `setup_state` row tracking only `default_database_linked` (an
  internal, silent, boot-time concern). The wizard needs its own, additive notion of "setup complete" /
  "wizard dismissed," derived primarily from entity existence rather than a mutable flag (see Business Rules).

## Existing Codebase Integration

| Wizard need                           | Existing implementation to reuse (not duplicate)                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-run vs returning-user detection | `arrInstancesQueries.getAll()` (`db/queries/arrInstances.ts:235`), `pcdManager.getAll()` / `databaseInstancesQueries.getAll()` (`db/queries/databaseInstances.ts:222`) — **not** `setupStateQueries.isDefaultDatabaseLinked()`, which is already `true` on nearly every boot per `hooks.server.ts:58-129`                                                                                                                               |
| Skip persistence                      | Extend `setup_state` (`db/queries/setupState.ts`, migration `039_create_setup_state.ts`) with a new column (e.g. `wizard_dismissed_at`) rather than repurposing `default_database_linked`                                                                                                                                                                                                                                               |
| Auth gating / route precedence        | `hooks.server.ts:207-259` `handle` — the wizard's redirect must be layered _after_ the existing `auth.needsSetup` → `/auth/setup` redirect, not instead of it                                                                                                                                                                                                                                                                           |
| Arr connection inline validation      | `POST /arr/test` (`routes/arr/test/+server.ts`) — `createArrClient(...).testConnection()`, 3s timeout, 0 retries                                                                                                                                                                                                                                                                                                                        |
| Arr instance creation                 | `arrInstancesQueries.create()` + encryption/dedup pipeline exactly as `routes/arr/new/+page.server.ts` (name uniqueness via `nameExists`, API-key-fingerprint dedup via `getAllArrCredentialKeyVersions` + `arrInstanceCredentialsQueries.getByAnyFingerprint`, `encryptArrInstanceApiKey`)                                                                                                                                             |
| Env-reconciled instances              | `reconcileEnvInstances()` (`utils/arr/envInstances.ts`), invoked at boot in `hooks.server.ts:131-151` — wizard must check for `source: 'env'` rows before prompting to add a new instance                                                                                                                                                                                                                                               |
| PCD database linking                  | `pcdManager.link()` (`pcd/core/manager.ts:42`) exactly as `routes/databases/new/custom/+page.server.ts` uses it, including its non-Git-URL redirect pattern (`/databases/bruh`) and rollback-on-failure behavior                                                                                                                                                                                                                        |
| Default DB auto-link awareness        | `hooks.server.ts:58-129` (`PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`, `PRAXRR_DEFAULT_DB_NAME`, local-path detection) — wizard's "Link Database" step should detect an already-auto-linked default DB and skip straight past linking                                                                                                                                                                                           |
| Profile/format selection              | `qualityProfileQueries.list(cache, arrType)` + `arrSyncQueries.saveQualityProfilesSync()` exactly as `routes/arr/[id]/sync/+page.server.ts` (`saveQualityProfiles` action) — including arr-type scoping per CLAUDE.md's Cross-Arr Semantic Validation Policy                                                                                                                                                                            |
| Sync preview & apply                  | `sync/preview/*` module (`store.ts`, `orchestrator.ts`, `diff.ts`, `types.ts`) + `POST /api/v1/sync/preview`, `GET /api/v1/sync/preview/[previewId]`, `POST /api/v1/sync/preview/[previewId]/apply` — issue #7 is already implemented; the wizard's "Preview & Sync" step should call these APIs and reuse `SyncPreviewPanel.svelte`/`SyncPreviewTrigger.svelte` from `routes/arr/[id]/sync/components/` rather than rebuild preview UI |
| Startup sequence integration          | `hooks.server.ts` full ordering: `config.init()` → `db.initialize()` → `runMigrations()` → `logSettings.load()` → `pcdManager.initialize()` → `trashGuideManager.initialize()` → auto-link default DB → `reconcileEnvInstances()` → `initializeJobs()` → auth middleware. The wizard is purely a post-startup, request-time UI concern; it does not belong in this sequence itself.                                                     |

## Success Criteria

- A brand-new deployment (no admin account, no Arr instance, no PCD) takes a user from `/auth/setup` through
  a completed first sync using only the guided flow, with zero required visits to `/arr/new`,
  `/databases/new`, or `/arr/[id]/sync` directly.
- A deployment with env-reconciled Arr instances and/or a successfully auto-linked default DB does **not**
  force the user to redundantly re-enter information the system already has.
- Skipping the wizard is a single explicit action, persists across sessions, and is reversible from Settings.
- No new parallel implementation of Arr connection testing, instance creation, PCD linking, profile listing,
  or sync preview/apply exists outside what's cataloged in the table above — the wizard is composition, not
  reimplementation.
- Abandoning the wizard at any step and returning later resumes at the correct step without data loss or
  duplicate instance/database creation.

## Open Questions

1. **Wizard "complete"/"dismissed" schema**: does this belong as new columns on `setup_state` (natural fit
   given its stated purpose as the one-time-setup singleton), or does issue #12 anticipate a dedicated table
   if multi-admin / per-user dismissal is ever needed? Current `setup_state` is a strict singleton (`id=1`
   CHECK constraint), which matches Praxrr's single-admin-account model but should be confirmed as
   intentional for this feature too.
2. **Route naming collision risk**: issue #12 specifies `/setup/` as the route group, while `/auth/setup`
   already exists for account creation. These are different paths so there's no literal collision, but the
   naming similarity is likely to confuse contributors and support requests — worth flagging in the plan
   phase whether `/setup/` should be renamed (e.g. `/onboarding/`) for clarity, or whether documentation
   alone is sufficient.
3. **Custom formats in "Select Profiles" step**: issue #12's step 4 bundles "quality profiles and custom
   formats" into one step, but the existing `/arr/[id]/sync` page treats quality profiles, delay profiles,
   media management, and metadata profiles as separate sub-sections with independent save actions. Does the
   wizard's step 4 need its own simplified combined UI, or should it embed the existing
   `QualityProfiles.svelte` component (and a custom-formats equivalent, if one exists as a standalone
   sync surface) as-is?
4. **Multi-instance wizard runs**: if a user connects a second Arr instance later (outside the wizard, via
   `/arr/new`), should the wizard ever reappear for that specific instance's profile selection, or is the
   wizard strictly a whole-deployment, once-only experience and subsequent instances are always configured
   manually via `/arr/[id]/sync`? The "setup complete" entity-existence check in this research assumes the
   latter (whole-deployment, once-only).
5. **Local-path PCD sources in the wizard**: per CLAUDE.md's Local-Path Source Guardrails, local-path PCD
   sources aren't necessarily Git repos and some Git-dependent surfaces (changes/commits) must degrade
   gracefully. Should the wizard's "Link Database" step expose the local-path/`file://` option at all for a
   first-run user, or is that an advanced/dev-only path reserved for the full `/databases/new` flow?
