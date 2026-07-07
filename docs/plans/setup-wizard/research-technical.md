# Setup Wizard — Technical Research & Specification

Status: Research draft (issue #12)
Scope: First-run guided onboarding (`/setup/` route group) for Praxrr V2.
Stack: Deno 2.x, SvelteKit (sveltekit-adapter-deno), Svelte 5 (NO runes — `onclick`, no `$state`/`$derived`), Tailwind v4, SQLite via Kysely-compiled queries. All new API under `/api/v1/*`. Contract-first (OpenAPI → generated types → implementation).

---

## Executive Summary

The wizard walks a first-run user through: **Welcome → Connect Arr instance → Link PCD database → Select quality profiles + custom formats → Preview & Sync → Done**, with a first-run vs returning detection and a "Skip wizard" escape hatch.

Key findings that shape the design:

- **Two distinct "setup" concepts already exist and must not be conflated.**
  - `/auth/setup` (existing) = local-account bootstrap (username/password). Gated by `AuthState.needsSetup` in `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts:40`, redirected in `packages/praxrr-app/src/hooks.server.ts:214`.
  - The **new wizard is a separate onboarding flow** that runs *after* auth is satisfied. It is orthogonal to account creation.
- **`setup_state` today only tracks `default_database_linked`** (singleton row, `id=1`). Migration `039_create_setup_state.ts`. Query layer: `packages/praxrr-app/src/lib/server/db/queries/setupState.ts`. Wizard needs **new columns** (`wizard_completed`, `wizard_skipped`, `wizard_current_step`, timestamps) via a **new migration** — never edit `schema.sql`.
- **There is NO `/api/v1` endpoint for creating an Arr instance or linking a PCD database.** Both flows exist only as **legacy SvelteKit form actions** (`/arr/new`, `/databases/new/custom`). Connection test is a legacy JSON route (`POST /arr/test`). The wizard is contract-first `/api/v1`, so we must introduce `/api/v1/setup/*` orchestration endpoints that **reuse the existing query/manager layer** (`arrInstancesQueries.create`, `pcdManager.link`, `BaseArrClient.testConnection`, `arrSyncQueries.saveQualityProfilesSync`) rather than duplicate business logic.
- **Sync preview already has a first-class `/api/v1` endpoint**: `POST /api/v1/sync/preview` (`packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`) returning `SyncPreviewResult` (`$sync/preview/types.ts`). The wizard reuses it verbatim.
- **Custom-format selection is not an independent choice.** `arrSyncQueries` tracks quality-profile selections **by name** per instance (`arr_sync_quality_profiles`); CFs are synced as a consequence of the chosen quality profiles (CFs are referenced/scored inside each profile in the PCD). The wizard's "Select quality profiles + custom formats" step writes **only** quality-profile selections via `arrSyncQueries.saveQualityProfilesSync`; CFs follow. (An independent per-instance CF selection table does not exist and is out of scope unless explicitly requested.)
- **Cross-Arr policy holds:** connection test is uniform (`GET system/status`) but supported types are `{radarr, sonarr, lidarr}` (chaptarr excluded from UI routes); `SyncPreviewArrType = Exclude<ArrType,'all'|'chaptarr'>`; metadata-profile sync is lidarr-only. No implicit sibling fallback — resolve by explicit `arr_type`.

---

## Architecture Design

### 2.1 Route tree

New SvelteKit route group `/setup/` with per-step subroutes. Each step is its own URL so the wizard is deep-linkable, refresh-safe, and resumable from `wizard_current_step`.

```
packages/praxrr-app/src/routes/setup/
  +layout.server.ts        # load wizard state; redirect returning/complete users away
  +layout.svelte           # wizard shell: stepper, progress, Skip button, prev/next chrome
  +page.server.ts          # redirect /setup -> /setup/welcome (or -> current step)
  welcome/
    +page.svelte           # step 1: intro + "Get started" / "Skip"
  connect-arr/
    +page.svelte           # step 2: URL + API key + type; inline validate via test-connection
    +page.server.ts        # load existing instances (resume); no writes here (writes via /api/v1)
  link-database/
    +page.svelte           # step 3: default (PRAXRR_DEFAULT_DB_URL) vs custom
    +page.server.ts        # load default-db env hint + already-linked databases
  select-profiles/
    +page.svelte           # step 4: pick quality profiles (CFs implied) from linked PCD
    +page.server.ts        # load available quality profiles/CFs for the chosen instance's arr_type
  preview-sync/
    +page.svelte           # step 5: call POST /api/v1/sync/preview; render diff; confirm sync
    +page.server.ts        # load selected instance + selections summary
  done/
    +page.svelte           # step 6: success; POST /api/v1/setup/complete already fired
```

Rationale for route-per-step over a single stateful page: matches the repo's **"Routes over modals"** convention, survives refresh, and lets `+layout.server.ts` enforce step-order guards (can't reach `select-profiles` before an instance + database exist).

### 2.2 Redirect / gating flow (`hooks.server.ts` + `+layout.server.ts`)

Ordering is critical because auth-account-setup (`/auth/setup`) and the wizard (`/setup`) are layered.

Precedence (evaluated in `hooks.server.ts` `handle`, extending the existing middleware — see `packages/praxrr-app/src/hooks.server.ts:207`):

1. **Account setup unmet** (`auth.needsSetup`): redirect to `/auth/setup` (existing behavior, unchanged).
2. **Auth required and missing** (existing behavior): redirect `/auth/login` / 401 for `/api`.
3. **Wizard gate (NEW):** once the request is authenticated (or `skipAuth` after account setup), if `wizardShouldRun()` is true and the path is not already under `/setup`, not an `/api/*` call, and not a public/asset path → `redirect(303, '/setup')` (which forwards to the resumable current step).
4. **Reverse gate (NEW):** if wizard is completed/skipped and the user navigates to `/setup/*` (non-API), `redirect(303, '/')` — mirrors the existing `/auth/setup` reverse guard at `hooks.server.ts:227`.

`wizardShouldRun()` (new helper, colocated with setup state): returns `!(state.wizard_completed || state.wizard_skipped)`.

Guardrails:
- **Do not gate `/api/*`** on the wizard — API clients (and the wizard's own fetches) must not be redirected. The wizard UI calls `/api/v1/setup/*`.
- **`AUTH=off`**: `skipAuth=true`, `needsSetup=false`. The wizard should still run for `AUTH=off` local installs (that is the primary first-run persona). Gate on `wizardShouldRun()` independent of auth mode, but **only for page navigations**, never API.
- Keep the wizard redirect *below* the account-setup and login redirects so an unauthenticated user is never bounced into the wizard.
- Public paths list (`middleware.ts:27`) must include `/setup` so the wizard shell itself is reachable during the gate; add `'/setup'` to `PUBLIC_PATHS` OR special-case it in `handle` like `/auth/setup` is (recommended: mirror the `/auth/setup` special-case block rather than widening `PUBLIC_PATHS`, to keep auth semantics intact).

### 2.3 Component structure (Svelte 5, no runes)

- `+layout.svelte` renders a **stepper** (reuse existing UI primitives from `$ui/`), a progress indicator, and a persistent **Skip wizard** button (fires `POST /api/v1/setup/skip` then navigates to `/`).
- Each step `+page.svelte` uses plain `onclick` handlers and standard `fetch` to `/api/v1/setup/*`. User feedback via `alertStore.add(type, message)` (`$stores`). Block navigation with the dirty store where a step holds unsaved input (per repo convention).
- Inline connection validation (step 2): `onclick` "Test connection" → `POST /api/v1/setup/test-connection` → render success (app + version) or error; only enable "Next / Save instance" after a green test.
- Step transitions PATCH `wizard_current_step` so refresh/resume lands on the right step.

---

## Data Models

### 3.1 Current `setup_state` (migration 039)

```sql
CREATE TABLE setup_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),      -- singleton
  default_database_linked INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Query layer: `setupStateQueries` (`.get()`, `.isDefaultDatabaseLinked()`, `.markDefaultDatabaseLinked()`).

### 3.2 New migration (proposed)

File: `packages/praxrr-app/src/lib/server/db/migrations/20260707_add_setup_wizard_state.ts`
(YYYYMMDD naming per recent convention; pick the next unused integer `version` — the last is `20260706`, so use `20260707`.)

**Registration is STATIC** (not filesystem-scanned): the runner imports each migration at the top of `migrations.ts` and lists it in `loadMigrations()` (array at `migrations.ts:301`). **Two edits required**: add the `import` and add the entry to the array. This is a schema-only migration, so no `seedBuiltInBaseOps.ts` change is needed (that guardrail applies only to PCD base-op migrations).

```ts
import type { Migration } from '../migrations.ts';

export const migration: Migration = {
  version: 20260707,
  name: 'Add setup wizard state columns',
  up: `
    ALTER TABLE setup_state ADD COLUMN wizard_completed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE setup_state ADD COLUMN wizard_skipped INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE setup_state ADD COLUMN wizard_current_step TEXT NOT NULL DEFAULT 'welcome';
    ALTER TABLE setup_state ADD COLUMN wizard_completed_at DATETIME;
  `,
  down: `
    -- SQLite pre-3.35 lacks DROP COLUMN; if unsupported in target build, rebuild table.
    ALTER TABLE setup_state DROP COLUMN wizard_completed;
    ALTER TABLE setup_state DROP COLUMN wizard_skipped;
    ALTER TABLE setup_state DROP COLUMN wizard_current_step;
    ALTER TABLE setup_state DROP COLUMN wizard_completed_at;
  `,
};
```

Column semantics:
- `wizard_completed` (0/1): user finished the wizard (reached Done, or explicitly finished after a successful sync).
- `wizard_skipped` (0/1): user chose "Skip wizard". Distinct from completed so telemetry/analytics can differentiate, and so a future "resume onboarding" prompt can target skippers.
- `wizard_current_step` (TEXT enum: `welcome|connect-arr|link-database|select-profiles|preview-sync|done`): resume point. Server-validated against the enum.
- `wizard_completed_at` (nullable): audit timestamp.

**Do not overload `default_database_linked`** — it is a startup auto-link flag with distinct semantics (see `hooks.server.ts:59`). Keep them separate.

### 3.3 Query-layer extension

Extend `setupStateQueries` (`packages/praxrr-app/src/lib/server/db/queries/setupState.ts`) — same singleton pattern:

```ts
export interface SetupState {
  id: number;
  default_database_linked: number;
  wizard_completed: number;
  wizard_skipped: number;
  wizard_current_step: WizardStep;
  wizard_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type WizardStep = 'welcome' | 'connect-arr' | 'link-database' | 'select-profiles' | 'preview-sync' | 'done';

// new methods:
//   getWizardState(): { completed, skipped, currentStep, completedAt }
//   setWizardStep(step: WizardStep): boolean         // validate against enum; UPDATE ... WHERE id=1
//   markWizardCompleted(): boolean                   // wizard_completed=1, wizard_completed_at=now
//   markWizardSkipped(): boolean                     // wizard_skipped=1
//   wizardShouldRun(): boolean                       // !(completed || skipped)
```

Fail-fast: `setWizardStep` rejects unknown step values (throws), consistent with the repo's boundary-validation stance.

### 3.4 Reused tables (no new tables beyond `setup_state` columns)

| Table | Written by | Via |
|---|---|---|
| `arr_instances` + `arr_instance_credentials` | Connect step | `arrInstancesQueries.create(input, credentialInput)` (`arrInstances.ts:181`) |
| `database_instances` + `database_instance_credentials` | Link step | `pcdManager.link(options)` (`pcd/core/manager.ts:42`) |
| `arr_sync_quality_profiles` + `arr_sync_quality_profiles_config` | Select step | `arrSyncQueries.saveQualityProfilesSync(instanceId, selections, config)` (`arrSync.ts:459`) |

---

## 4. API Design

All wizard endpoints live under `/api/v1/setup/*`. Contract-first: add these paths to `docs/api/v1/openapi.yaml`, run `deno task generate:api-types` (emits `packages/praxrr-app/src/lib/api/v1.d.ts`), then implement `+server.ts` handlers. Error body shape follows the existing preview route convention: `{ "error": string }` with appropriate status.

### 4.1 `GET /api/v1/setup/state`

Returns wizard + prerequisite state so the shell can decide the resume step and render prerequisite checkmarks.

Response `200`:
```json
{
  "wizard": {
    "completed": false,
    "skipped": false,
    "currentStep": "connect-arr",
    "completedAt": null
  },
  "prerequisites": {
    "hasArrInstance": true,
    "hasLinkedDatabase": false,
    "hasProfileSelections": false
  },
  "defaultDatabase": {
    "configured": true,
    "url": "https://github.com/yandy-r/praxrr-db",
    "alreadyLinked": false
  }
}
```
- `prerequisites` derived from `arrInstancesQueries.getAll()`, `databaseInstancesQueries.getAll()`, `arrSyncQueries.getQualityProfilesSync(instanceId)`.
- `defaultDatabase.configured=false` when `PRAXRR_DEFAULT_DB_URL=""` (intentional opt-out; do not substitute a fallback — see CLAUDE.md).

### 4.2 `PATCH /api/v1/setup/state`

Persist step progression (and nothing else — this is not where domain writes happen).

Request:
```json
{ "currentStep": "link-database" }
```
Response `200`: same shape as `GET` `wizard` block. Errors: `400 { "error": "Invalid step: <x>" }`.

### 4.3 `POST /api/v1/setup/test-connection`

Thin wrapper over `createArrClient(type, url, apiKey).testConnection()` (`factory.ts:25` + `base.ts:68`). Mirrors legacy `POST /arr/test` but under `/api/v1` and returns richer info.

Request:
```json
{ "type": "radarr", "url": "http://localhost:7878", "apiKey": "abc123" }
```
Response `200` (reachable):
```json
{ "success": true, "appName": "Radarr", "version": "5.14.0.9383" }
```
Response `200` (unreachable) or `400`:
```json
{ "success": false, "error": "Connection test failed" }
```
Validation & cross-Arr:
- `type` must be `radarr|sonarr|lidarr` (reject `chaptarr`/`all` → `400`).
- Use short timeout / no retries for fast UX (legacy uses `{ timeout: 3000, retries: 0 }`).
- **Per-arr note:** `testConnection` is uniform (`GET system/status`) across radarr/sonarr/lidarr, but the returned `appName`/`version` differ; do not infer capabilities from a sibling type. `testConnection()` currently returns only `boolean` — to surface `appName`/`version` the handler either (a) calls the underlying status fetch directly, or (b) we extend the client with a `getSystemStatus()` that returns the parsed status. **Recommendation:** add `getSystemStatus()` to `BaseArrClient` returning `{ appName, version, ... } | null` and keep `testConnection()` as the boolean convenience wrapper; the endpoint uses `getSystemStatus()`.

### 4.4 `POST /api/v1/setup/arr-instance` (create instance)

Orchestration endpoint (net-new, because no `/api/v1` instance-create exists). Reuses `arrInstancesQueries.create` + `encryptArrInstanceApiKey` (same pipeline as legacy `/arr/new`). Optionally re-runs the connection test server-side before persisting.

Request:
```json
{
  "name": "Radarr",
  "type": "radarr",
  "url": "http://localhost:7878",
  "apiKey": "abc123",
  "externalUrl": null,
  "tags": []
}
```
Response `201`:
```json
{ "id": 3, "name": "Radarr", "type": "radarr", "url": "http://localhost:7878", "enabled": true }
```
Errors:
- `400 { "error": "name is required" }` / invalid type / invalid url.
- `409 { "error": "An instance named 'Radarr' already exists" }` (case-insensitive per repo entity-name rule; use `arrInstancesQueries.nameExists`).
- `409 { "error": "An instance with this API key already exists" }` (`apiKeyExists` on fingerprint).
- `502 { "error": "Connection test failed" }` if server-side pre-persist test is enabled and fails.

Note: the real key is stored encrypted in `arr_instance_credentials`; `arr_instances.api_key` column stays `''`. Pass `credentialInput` (encrypted material + fingerprint) exactly as `/arr/new` does.

### 4.5 `POST /api/v1/setup/database` (link PCD)

Orchestration endpoint (net-new). Reuses `pcdManager.link(options)` (`manager.ts:42`) — full clone → manifest → deps → encrypt PAT → `databaseInstancesQueries.create` → `importBaseOps` → seed → compile.

Request (default DB):
```json
{ "mode": "default" }
```
Request (custom):
```json
{
  "mode": "custom",
  "name": "My PCD",
  "repositoryUrl": "https://github.com/me/my-pcd",
  "branch": "main",
  "personalAccessToken": null,
  "gitUserName": null,
  "gitUserEmail": null,
  "conflictStrategy": "override"
}
```
Response `201`:
```json
{ "id": 2, "uuid": "…", "name": "My PCD", "repositoryUrl": "…", "enabled": true }
```
Errors:
- `400 { "error": "repositoryUrl is required" }` (custom mode).
- `400 { "error": "Default database is disabled (PRAXRR_DEFAULT_DB_URL is empty)" }` when `mode=default` but env opts out.
- `400 { "error": "Git identity required when using a personal access token" }` (mirrors `/databases/new/custom` validation).
- `502 { "error": "Failed to clone or load manifest: <detail>" }` (link failure; `pcdManager.link` rolls back its own row + clone dir on failure).

`mode=default` resolves URL/branch/name from `PRAXRR_DEFAULT_DB_URL` / `PRAXRR_DEFAULT_DB_BRANCH` / `PRAXRR_DEFAULT_DB_NAME` (same resolution as `hooks.server.ts:60-73`, including local-path detection → `autoPull=false`). If already auto-linked at startup, return the existing instance instead of relinking (idempotent).

### 4.6 `POST /api/v1/setup/profiles` (select quality profiles)

Persists per-instance quality-profile selections. Reuses `arrSyncQueries.saveQualityProfilesSync` (`arrSync.ts:459`).

Request:
```json
{
  "instanceId": 3,
  "selections": [
    { "databaseId": 2, "profileName": "HD Bluray + WEB" },
    { "databaseId": 2, "profileName": "Remux + WEB 1080p" }
  ],
  "config": { "trigger": "manual", "cron": null }
}
```
Response `200`:
```json
{ "instanceId": 3, "savedCount": 2 }
```
Errors:
- `404 { "error": "Instance not found" }`.
- `400 { "error": "Unsupported instance type: chaptarr" }` (must be `SyncPreviewArrType`).
- `422 { "error": "Profile 'X' is not compatible with radarr" }` — per CLAUDE.md Arr-scoped compatibility: validate selected profiles against app-compatible quality names via `quality_api_mappings` for the target `arr_type`; **do not** rely on `arr_type='all'` scores alone, and **do not** require `enabled=1` quality rows.

**Custom formats:** not selected here — they sync as a consequence of the chosen profiles. If product later wants explicit CF opt-in, that is a net-new table + query (out of current scope; flag as Open Question).

### 4.7 Reuse: `POST /api/v1/sync/preview` (unchanged)

Preview step calls the existing endpoint (`packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`).

Request:
```json
{ "instanceId": 3, "sections": ["qualityProfiles"] }
```
Response `200`: `SyncPreviewResult` (`$sync/preview/types.ts:81`) — `summary.totalCreates/Updates/Deletes/Unchanged` + per-section `EntityChange[]`. The wizard renders the diff, then triggers the actual sync via the existing sync apply path (reuse whatever the current `arr/[id]/sync` page invokes — do not build a new sync executor).

### 4.8 `POST /api/v1/setup/complete` and `POST /api/v1/setup/skip`

- `complete`: `setupStateQueries.markWizardCompleted()`. Response `200 { "wizard": { "completed": true, … } }`.
- `skip`: `setupStateQueries.markWizardSkipped()`. Response `200 { "wizard": { "skipped": true, … } }`.

Both idempotent; safe to call repeatedly.

### 4.9 OpenAPI notes

- Add a `Setup` tag and the 8 paths above to `docs/api/v1/openapi.yaml`.
- Define reusable schemas: `WizardState`, `SetupStateResponse`, `TestConnectionRequest/Response`, `CreateArrInstanceRequest/Response`, `LinkDatabaseRequest/Response`, `SelectProfilesRequest/Response`, and a shared `ErrorResponse { error: string }` (reuse if already defined).
- Regenerate types (`deno task generate:api-types`) and import from `$api/v1.d.ts` in handlers. Run `deno task check` after.

---

## 5. System Constraints

- **Svelte 5 without runes** — `onclick` handlers, no `$state`/`$derived`. All wizard interactivity uses plain handlers + stores.
- **Startup ordering** (`hooks.server.ts`): `config.init` → `db.initialize` → `runMigrations` → … → `pcdManager.initialize` → auth middleware. The new migration slots into `runMigrations` automatically once registered. `setup_state` is read in the middleware, so the new columns must exist before the wizard gate runs — guaranteed by migration order.
- **Auth-mode matrix:** wizard must function under `AUTH=off` (primary first-run), `AUTH=local`, `AUTH=on` (after account setup), and `AUTH=oidc`. Gate on `wizardShouldRun()`, layered strictly *after* account-setup/login gates. Never gate `/api/*`.
- **Credential handling:** API keys/PATs are encrypted at rest (`arr_instance_credentials`, `database_instance_credentials`); base tables store `''` + fingerprint. Wizard endpoints must route through the same encryption helpers used by legacy routes — never persist plaintext.
- **Cross-Arr fidelity:** supported wizard types `{radarr, sonarr, lidarr}`; reject `chaptarr`/`all`. Metadata profiles are lidarr-only (not part of the wizard's quality-profile step). Resolve every read/write by explicit `arr_type`; no sibling fallback.
- **Preview limits:** `POST /api/v1/sync/preview` enforces rate limits, body-size, and a max-snapshot cap (`$sync/preview/limits.ts`); the wizard must surface `429` gracefully ("retry after previews expire").
- **File-size soft cap (~500 lines):** keep each `+server.ts` focused; extract shared setup logic (state derivation, prerequisite checks) into `$lib/server/setup/*` helpers rather than fattening handlers.
- **Non-Git local-path sources:** if a custom PCD is a local path without `.git`, git-dependent surfaces must degrade gracefully (CLAUDE.md Local-Path guardrails) — the wizard link step should not assume a Git remote.

---

## 6. Codebase Changes (files to create / modify)

### Create
- `packages/praxrr-app/src/lib/server/db/migrations/20260707_add_setup_wizard_state.ts` — wizard columns.
- `packages/praxrr-app/src/lib/server/setup/state.ts` (optional) — prerequisite derivation + `wizardShouldRun` gate helper (shared by hooks + endpoints).
- `packages/praxrr-app/src/routes/api/v1/setup/state/+server.ts` — GET + PATCH.
- `packages/praxrr-app/src/routes/api/v1/setup/test-connection/+server.ts` — POST.
- `packages/praxrr-app/src/routes/api/v1/setup/arr-instance/+server.ts` — POST.
- `packages/praxrr-app/src/routes/api/v1/setup/database/+server.ts` — POST.
- `packages/praxrr-app/src/routes/api/v1/setup/profiles/+server.ts` — POST.
- `packages/praxrr-app/src/routes/api/v1/setup/complete/+server.ts` — POST.
- `packages/praxrr-app/src/routes/api/v1/setup/skip/+server.ts` — POST.
- `packages/praxrr-app/src/routes/setup/` group: `+layout.server.ts`, `+layout.svelte`, `+page.server.ts`, and the six step folders (`welcome`, `connect-arr`, `link-database`, `select-profiles`, `preview-sync`, `done`) each with `+page.svelte` (+ `+page.server.ts` where a load is needed).
- Tests: `packages/praxrr-app/src/tests/setup/` — state query unit tests, gate-logic tests, and per-endpoint validation/cross-arr tests.

### Modify
- `packages/praxrr-app/src/lib/server/db/queries/setupState.ts` — extend `SetupState` + add wizard methods.
- `packages/praxrr-app/src/lib/server/db/migrations.ts` — `import` + register the new migration in `loadMigrations()` array.
- `packages/praxrr-app/src/hooks.server.ts` — add wizard gate + reverse gate in `handle` (after account-setup/login gates, page-nav only).
- `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts` — special-case `/setup` reachability (mirror the `/auth/setup` handling) rather than widening `PUBLIC_PATHS`.
- `docs/api/v1/openapi.yaml` — add `Setup` paths/schemas; then regenerate `packages/praxrr-app/src/lib/api/v1.d.ts`.
- (If adopting `getSystemStatus()`): `packages/praxrr-app/src/lib/server/utils/arr/base.ts` — add parsed status method used by test-connection.

### Explicitly NOT changed
- `schema.sql` (reference only; schema changes go through migrations).
- `seedBuiltInBaseOps.ts` (no PCD base-op migration involved).
- Legacy `/arr/new`, `/arr/test`, `/databases/new/custom` (left intact; wizard does not remove them).

---

## 7. Technical Decisions

**D1 — Route-per-step vs single stateful page.**
Options: (a) one `/setup` page with client-side step state; (b) route group with a subroute per step.
Recommendation: **(b)**. Matches "Routes over modals", is refresh/resume-safe via `wizard_current_step`, and enables server-side step-order guards in `+layout.server.ts`. Client-only state would lose progress on reload and complicate the gate.

**D2 — Where domain writes happen: form actions vs `/api/v1`.**
Options: (a) reuse legacy form actions (`/arr/new`, `/databases/new/custom`); (b) new `/api/v1/setup/*` orchestration endpoints reusing the query/manager layer.
Recommendation: **(b)**. The repo mandates contract-first `/api/v1` for new work; legacy actions redirect (FormData, 303) and are awkward to drive from a multi-step SPA-like wizard. The endpoints are thin — they call `arrInstancesQueries.create` / `pcdManager.link` / `arrSyncQueries.saveQualityProfilesSync` (no duplicated business logic). This also lays groundwork to later promote instance-create/db-link to first-class `/api/v1` resources.

**D3 — Setup-scoped endpoints vs generic resource endpoints.**
Options: (a) `/api/v1/setup/arr-instance` + `/api/v1/setup/database`; (b) generic `/api/v1/arr/instances` + `/api/v1/databases`.
Recommendation: **(a) now, (b) later.** Setup-scoped keeps the wizard shippable without designing the full generic CRUD contract (out of scope for #12), while the handlers already delegate to the shared query/manager layer, so promotion to generic endpoints is a later refactor, not a rewrite. Flag generic endpoints as a follow-up.

**D4 — New `setup_state` columns vs new `wizard_state` table.**
Recommendation: **extend `setup_state`.** It is already the singleton onboarding-state row read in the middleware; a second table adds a join and a second singleton to keep consistent. Keep `default_database_linked` semantically separate from wizard flags.

**D5 — Connection test return shape.**
Recommendation: add `getSystemStatus()` to `BaseArrClient` returning parsed `{ appName, version, … } | null`; keep `testConnection(): boolean` as the wrapper. Lets the wizard show "Connected to Radarr 5.x" instead of a bare boolean, with no behavior change to existing `testConnection` callers.

**D6 — Custom-format selection.**
Recommendation: **do not** build independent CF selection. CFs sync via chosen quality profiles (no per-instance CF table exists). Present CFs in the UI as read-only context ("these formats are included by the selected profiles"). Independent CF opt-in is an Open Question / future table.

**D7 — Skip semantics.**
Recommendation: track `wizard_skipped` distinctly from `wizard_completed` so a future "finish setup" nudge can target skippers, and so completion analytics stay clean. Both set the gate to off.

---

## 8. Open Questions

1. **Skip persistence scope:** Should "Skip" be permanent (never prompt again) or dismissible-until-next-launch? Current design = permanent (`wizard_skipped=1`). Confirm product intent; if "remind me later" is desired, add a `wizard_snoozed_until` column instead.
2. **Multi-instance onboarding:** Does the wizard support connecting *multiple* Arr instances in one run, or exactly one before proceeding? Current design assumes one primary instance in the happy path (schema supports many). Confirm.
3. **Independent custom-format selection:** Is per-instance CF opt-in a requirement for #12, or is "CFs follow selected profiles" acceptable for v1? (Affects whether a net-new table/query is in scope.)
4. **Sync execution in wizard:** After preview, does the wizard *apply* the sync inline, or just schedule it and hand off? Need to reuse the existing apply path from `arr/[id]/sync` — confirm which function/endpoint performs the apply (not covered by the preview endpoint).
5. **AUTH=oidc first-run:** OIDC has `needsSetup=false` (no local account). Should the wizard still gate OIDC users on first login? Current design says yes (wizard is auth-mode-independent), but confirm that OIDC installs want the guided flow.
6. **Default-DB already linked at startup:** When `PRAXRR_DEFAULT_DB_URL` auto-links on boot (`hooks.server.ts:59`), the wizard's link step should detect and present it as "already linked" rather than re-linking. Confirm UX: show as done vs allow relink/replace.
7. **Version guard on migration:** Confirm the target SQLite build supports `ALTER TABLE … DROP COLUMN` (3.35+) for the `down` path; if not, the rollback must rebuild the table. Not blocking (down is optional), but note for the migration author.

---

## Appendix — Key references (file:line)

- Startup sequence + existing setup auto-link: `packages/praxrr-app/src/hooks.server.ts:24-259` (auth middleware `:207`; account-setup gate `:214`; reverse gate `:227`; default-db resolution `:59-73`).
- Auth state / `needsSetup` / public paths: `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts:27` (PUBLIC_PATHS), `:40` (getAuthState).
- Setup state query layer: `packages/praxrr-app/src/lib/server/db/queries/setupState.ts`.
- `setup_state` schema: `packages/praxrr-app/src/lib/server/db/migrations/039_create_setup_state.ts`.
- Migration runner + registration: `packages/praxrr-app/src/lib/server/db/migrations.ts:72` (interface), `:191` (runner), `:300` (`loadMigrations`), `:377` (`runMigrations`).
- Arr connection test: `packages/praxrr-app/src/lib/server/utils/arr/base.ts:68` (`testConnection`), `factory.ts:25` (`createArrClient`); legacy route `packages/praxrr-app/src/routes/arr/test/+server.ts`.
- Arr instance create: `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts:181` (`create`), `:24` (`CreateArrInstanceInput`); legacy route `packages/praxrr-app/src/routes/arr/new/+page.server.ts`.
- PCD link: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:42` (`link`), `core/types.ts:128` (`LinkOptions`); legacy route `packages/praxrr-app/src/routes/databases/new/custom/+page.server.ts`.
- Database instance queries: `packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts:131`.
- Quality-profile selection: `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts:435` (`getQualityProfilesSync`), `:459` (`saveQualityProfilesSync`), `:16` (`ProfileSelection`), `:21` (`SyncConfig`).
- Sync preview: `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`, types `packages/praxrr-app/src/lib/server/sync/preview/types.ts:81` (`SyncPreviewResult`).
- OpenAPI contract source: `docs/api/v1/openapi.yaml` → generated `packages/praxrr-app/src/lib/api/v1.d.ts` (`deno task generate:api-types`).
