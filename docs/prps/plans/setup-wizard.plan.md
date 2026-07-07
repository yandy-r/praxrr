# Plan: Setup Wizard (First-Run Guided Onboarding)

## Summary

A route-based (`/setup/`) first-run wizard that guides a new Praxrr operator through Welcome → Connect Arr
instance → Link PCD database → Select quality profiles → Preview & Sync (reusing #7) → Done. It is a thin
orchestration/presentation layer over existing, HEAD-verified primitives (`arrInstancesQueries.create`,
`pcdManager.link`, `arrSyncQueries.saveQualityProfilesSync`, `POST /api/v1/sync/preview`); the real work is
gating, dedicated wizard state, and closing pre-existing CRITICAL security gaps (auth guard, SSRF, path
traversal) that the wizard makes first-touch.

## User Story

As a first-time Praxrr operator, I want a guided step-by-step setup that connects my first Arr instance,
links a config database, and previews my first sync, so that I reach a working configuration without
discovering the correct order of `/arr/new` → `/databases/new` → `/arr/[id]/sync` on my own.

## Problem → Solution

Today a first-run user lands on a mostly-empty dashboard and must self-assemble the setup sequence (80%+
abandon at initial config) → a `/setup/` guided wizard, gated by a dedicated `wizard_completed` flag,
sequences the existing primitives with inline validation, a dry-run preview, and a durable "Skip" escape.

## Metadata

- **Complexity**: Large (≈30 files)
- **Source PRD**: N/A (from `docs/plans/setup-wizard/feature-spec.md` + 7 research-*.md)
- **PRD Phase**: N/A
- **Estimated Files**: ~30 (create ~22, modify ~8)
- **GitHub Issue**: #12 (Closes #12); depends on #7 (done)

## Batches

Tasks grouped by dependency for parallel execution. Tasks within a batch run concurrently (no two touch
the same file); batches run in order.

| Batch | Tasks              | Depends On | Parallel Width |
| ----- | ------------------ | ---------- | -------------- |
| B1    | 1.1, 1.2, 1.3, 1.4 | —          | 4              |
| B2    | 2.1, 2.2           | B1         | 2              |
| B3    | 3.1                | B2         | 1              |
| B4    | 4.1, 4.2, 4.3, 4.4 | B3 (+B1)   | 4              |
| B5    | 5.1, 5.2, 5.3      | B4         | 3              |
| B6    | 6.1, 6.2           | B5         | 2              |
| B7    | 7.1                | B6         | 1              |

- **Total tasks**: 17
- **Total batches**: 7
- **Max parallel width**: 4
- **Critical path**: 1.1 → 2.2 → 3.1 → 4.4 → 5.1 → 6.1 → 7.1

---

## UX Design

### Before

```
First run → land on mostly-empty dashboard (/)
  User must self-discover, in the right order:
    /arr/new            (add instance: type, URL, API key, Test Connection)
    /databases/new/*    (link PCD: custom vs trash-guide)
    /arr/[id]/sync      (select quality profiles → preview → apply)
  No guidance; 80%+ abandon at initial config.
```

### After

```
First run → redirected to /setup (resumes at wizard_current_step)
  [Step 1/6] welcome         plain-language intro · "Get started" · de-emphasized "Skip"
  [Step 2/6] connect-arr     embed InstanceForm(mode=create) · inline Test Connection (idle→testing→ok/fail)
  [Step 3/6] link-database   default Praxrr-DB pre-selected · custom (git URL) behind disclosure · detect already-linked
  [Step 4/6] select-profiles arr_type-scoped quality profiles (compat via quality_api_mappings)
  [Step 5/6] preview-sync    dry-run diff (reuse #7) → explicit confirm  (or deep-link /arr/[id]/sync per D1)
  [Step 6/6] done            success + next steps · marks wizard_completed
  Persistent "Skip wizard" → wizard_dismissed_at → dashboard banner "Finish setup"
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| First-run landing | empty dashboard | redirect to `/setup` (page-nav only, never `/api/*`) | reverse-gate sends done/skipped users back to `/` |
| Connection test | `/arr/test`, raw error | idle→testing→success/fail with distinct "unreachable" vs "key rejected" copy | ARIA live region announces result |
| Add instance | `/arr/new` form | same `InstanceForm.svelte` embedded (`mode="create"`) | no duplicate form; `form.error`/`form.success` unchanged |
| Link DB | `/databases/new/*` | default pre-selected; git-URL-only custom behind disclosure | local-path linking NOT offered (security C4) |
| Preview/sync | `/arr/[id]/sync` | reuse `SyncPreviewPanel` / deep-link (D1) | no new preview format or executor |
| Skip | none | one click → `wizard_dismissed_at`, reversible from Settings | frictionless (no confirm) |
| Accessibility | n/a | focus to step heading on nav; per-step title "… — Step X of 6" | no wizard session timeout |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | `packages/praxrr-app/src/lib/server/db/queries/setupState.ts` | all | Singleton raw-SQL query layer to extend (not Kysely) |
| P0 | `packages/praxrr-app/src/lib/server/db/migrations/039_create_setup_state.ts` | all | Migration shape to mirror for the ALTER |
| P0 | `packages/praxrr-app/src/lib/server/db/migrations.ts` | 60-75, 300-372 | Static import + `loadMigrations()` registration (two-line edit) |
| P0 | `packages/praxrr-app/src/hooks.server.ts` | 207-259 | Gate order; wizard gate slots at skipAuth branch (223) AND auth tail (258) |
| P0 | `packages/praxrr-app/src/lib/server/utils/auth/middleware.ts` | 27-124 | `PUBLIC_PATHS` (do not widen), `getAuthState()` AUTH-mode matrix |
| P0 | `packages/praxrr-app/src/routes/auth/setup/+page.server.ts` | 11-28 | `load`+`action` double-guard model for setup-in-progress |
| P0 | `packages/praxrr-app/src/routes/arr/test/+server.ts` | 1-56 | SSRF hole (line 41) + raw-error leak (53) to harden |
| P1 | `packages/praxrr-app/src/lib/server/utils/arr/base.ts` | 60-90 | `testConnection()`; add `getSystemStatus()` here |
| P1 | `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts` | 200-235 | `/api/v1` handler shape (RequestHandler, body guard, ErrorResponse) |
| P1 | `packages/praxrr-app/src/routes/arr/new/+page.server.ts` | 15-176 | Form action pattern (fail/redirect, dedupe, `arrInstancesQueries.create`) |
| P1 | `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte` | 30-60 | Props for `mode="create"` embed |
| P1 | `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts` | 61-159 | arr_type compat filter via `quality_api_mappings` |
| P1 | `packages/praxrr-app/src/lib/server/utils/auth/network.ts` | 25-136 | `isLocalAddress`, metadata IPs, `getClientIp` for SSRF+rate-limit |
| P1 | `packages/praxrr-app/src/routes/api/v1/section-preferences/_helpers.ts` | 58-83 | Rate-limit token-bucket to extract |
| P2 | `packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts` | 1-45 | Route-handler unit-test + query-patch pattern |
| P2 | `packages/praxrr-app/src/tests/base/BaseTest.ts` | 130-250 | Test harness (`installPatch`, `test()`, tempDir) |
| P2 | `scripts/test.ts` | all | Add `setup-wizard` alias |
| P2 | `docs/plans/setup-wizard/feature-spec.md` | all | Full design context + decisions D1–D6 |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Radarr/Sonarr/Lidarr status API | radarr.video/docs/api, sonarr.tv/docs/api, lidarr.audio/docs/api | `GET /api/vN/system/status` + `X-Api-Key`; Lidarr `v1`, Radarr/Sonarr `v3`; returns `appName`, `version` |
| No new SaaS/library | — | Zero new dependencies; all primitives in-repo |

---

## Patterns to Mirror

Code patterns discovered in the codebase (HEAD-verified). Follow these exactly.

### NAMING_CONVENTION

```ts
// SOURCE: db/queries/setupState.ts:6,17 — singleton query object + colocated interface
export interface SetupState { id: number; default_database_linked: number; /* +new cols */ }
export const setupStateQueries = { get(): SetupState { /* db.queryFirst */ } };
// Migrations: YYYYMMDD_verb_noun.ts, `version: <YYYYMMDD>` (next = 20260707). Aliases: $db/ $api/ $sync/ $arr/ $ui/ $auth/.
// Svelte 5 NO runes: onclick handlers, no $state/$derived; forms use dirty store + form.error/form.success.
```

### Prettier (verified from `.prettierrc` — CLAUDE.md's "tabs/100w" note is STALE)

```json
{ "tabWidth": 2, "useTabs": false, "printWidth": 120, "singleQuote": true, "trailingComma": "es5", "semi": true }
```

### ERROR_HANDLING

```ts
// SOURCE: routes/arr/new/+page.server.ts:16 — form action: parse → fail-fast → query → redirect
if (!name || !type || !url || !apiKey) return fail(400, { error: '…required', values: { name, type, url } });
if (!VALID_TYPES.includes(type)) return fail(400, { error: 'Invalid arr type', values: { name, type, url } });
// SOURCE: routes/api/v1/sync/preview/+server.ts:211 — JSON handler: body guard → 404 typed ErrorResponse
const instance = arrInstancesQueries.getById(id);
if (!instance) return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
```

### AUTH_GUARD (model for the per-handler C1 guard — NOT `PUBLIC_PATHS`)

```ts
// SOURCE: routes/auth/setup/+page.server.ts:14,26 — double-check in BOTH load and action (race protection)
export const load: ServerLoad = () => { if (usersQueries.existsLocal()) throw redirect(303, '/'); return {}; };
// Wizard: assertSetupInProgress() as FIRST statement of every /api/v1/setup/* handler → throw 403 (not redirect) once wizard_completed=1.
// AUTH-mode matrix — middleware.ts:44-124: off→needsSetup:false,skipAuth:true; local+LAN→skipAuth:true; oidc→needsSetup:false; on→!hasLocalUsers.
```

### GATING_PATTERN (hooks.server.ts — wizard gate slots in TWO places, W6)

```ts
// SOURCE: hooks.server.ts:214,222,227,258
if (auth.needsSetup) { if (pathname === '/auth/setup') return resolve(event); throw redirect(303, '/auth/setup'); } // [1]
if (auth.skipAuth) { /* CALL resolveWizardRedirect() HERE (223) before */ return resolve(event); }               // [2] W6
if (event.url.pathname === '/auth/setup') { throw redirect(303, '/'); }                                            // [3] reverse-gate model
/* CALL resolveWizardRedirect() before the final */ return resolve(event);                                        // [4] auth tail (258)
// resolveWizardRedirect returns null when: pathname startsWith '/api' | isPublicPath | startsWith '/setup' | not a page GET.
```

### MIGRATION_PATTERN (object + static two-file registration)

```ts
// SOURCE: db/migrations/039_create_setup_state.ts:10 & migrations.ts:70,367
export const migration: Migration = { version: 20260707, name: 'Add setup wizard state', up: `ALTER TABLE setup_state ADD COLUMN …`, down: `…` };
// migrations.ts: import { migration as migration20260707AddSetupWizardState } from './migrations/20260707_add_setup_wizard_state.ts';
// migrations.ts loadMigrations() array (append; runner sorts by version): migration20260707AddSetupWizardState,
```

### REPOSITORY_PATTERN (reuse targets — verified signatures)

```ts
// arrInstancesQueries.create(input, credentialInput?): number     — db/queries/arrInstances.ts:181 (encrypt + insert in tx)
// pcdManager.link(options: LinkOptions): Promise<DatabaseInstance> — pcd/core/manager.ts:42 (LinkOptions @ core/types.ts:128)
// arrSyncQueries.saveQualityProfilesSync(instanceId, selections, config): void — db/queries/arrSync.ts:459
// base.ts:68 testConnection(): Promise<boolean> — discards appName/version; ADD getSystemStatus(): Promise<{appName,version}|null>
```

### RATE_LIMIT (extract → `$utils/rateLimit.ts`, IP-keyed for W2)

```ts
// SOURCE: routes/api/v1/section-preferences/_helpers.ts:58-83 — token bucket (WINDOW_MS=30_000, MAX=8)
// Extract; swap stateKey from `${userId}:${sectionKey}` to getClientIp(event) (network.ts:111) for pre-auth setup endpoints.
```

### TEST_STRUCTURE

```ts
// SOURCE: tests/routes/uiPreferencesApi.test.ts:1-6 — import handler directly, patch *Queries, @std/assert
/// <reference path="../../app.d.ts" />
import { GET, PATCH } from '../../routes/api/v1/ui-preferences/+server.ts';
// Cross-cutting logic tests: tests/base/*.test.ts extending BaseTest (installPatch auto-restores). Runner: scripts/test.ts (deno test --allow-*).
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `db/migrations/20260707_add_setup_wizard_state.ts` | CREATE | ALTER `setup_state` +3 cols (`wizard_completed`, `wizard_dismissed_at`, `wizard_current_step`) |
| `db/migrations.ts` | UPDATE | Static import (after ~L70) + `loadMigrations()` array entry (after ~L367) |
| `db/queries/setupState.ts` | UPDATE | Extend `SetupState` + `getWizardState/setWizardStep(fail-fast enum)/markWizardCompleted/markWizardDismissed/wizardShouldRun` (raw-SQL style) |
| `lib/server/setup/progress.ts` | CREATE | `getSetupProgress()` + `resolveWizardRedirect(event)` + `assertSetupInProgress()` — single gate source |
| `hooks.server.ts` | UPDATE | Call `resolveWizardRedirect` before resolve at skipAuth branch (L223) AND auth tail (L258); page-nav only |
| `lib/server/utils/arr/base.ts` | UPDATE | Add `getSystemStatus(): Promise<{appName,version}\|null>`; keep boolean `testConnection` wrapper |
| `lib/server/utils/arr/urlSafety.ts` | CREATE | `assertSafeArrUrl(url)` deny-list (metadata/link-local/`0.0.0.0`; http(s) only) |
| `lib/server/utils/http/client.ts` | UPDATE | Add `redirect: 'manual'` to `fetch` in `request()` (block redirect-based SSRF bypass) |
| `lib/server/utils/rateLimit.ts` | CREATE | Extract IP-keyed token bucket from section-preferences `_helpers.ts` |
| `routes/arr/test/+server.ts` | UPDATE | Call `assertSafeArrUrl` before `createArrClient` (L41); sanitized reason enum (replace raw error L53) |
| `routes/api/v1/setup/state/+server.ts` | CREATE | GET (wizard+prereqs+defaultDb) + PATCH (persist currentStep); self-guard first statement |
| `routes/api/v1/setup/test-connection/+server.ts` | CREATE | Guarded + IP-rate-limited; `assertSafeArrUrl` → `getSystemStatus`; sanitized enum |
| `routes/api/v1/setup/complete/+server.ts` | CREATE | POST → `markWizardCompleted()` (idempotent) |
| `routes/api/v1/setup/skip/+server.ts` | CREATE | POST → `markWizardDismissed()` (idempotent) |
| `routes/setup/+layout.server.ts` | CREATE | Resolve current step; reverse-gate done/skipped → `/` |
| `routes/setup/+layout.svelte` | CREATE | Stepper chrome + Skip button (reuse `$ui/*`, not `$ui/navigation/tabs`) |
| `routes/setup/+page.server.ts` | CREATE | Index → redirect to `wizard_current_step` |
| `routes/setup/welcome/+page.svelte` | CREATE | Step 1 intro |
| `routes/setup/done/+page.svelte` | CREATE | Step 6 success + next steps |
| `routes/setup/connect-arr/+page.{svelte,server.ts}` | CREATE | Embed `InstanceForm mode="create"`; call test-connection; `arrInstancesQueries.create` |
| `routes/setup/link-database/+page.{svelte,server.ts}` | CREATE | Default vs custom (git-URL-only); detect already-linked; `pcdManager.link` |
| `routes/setup/select-profiles/+page.{svelte,server.ts}` | CREATE | arr_type compat filter; `arrSyncQueries.saveQualityProfilesSync` |
| `routes/setup/preview-sync/+page.{svelte,server.ts}` | CREATE | `POST /api/v1/sync/preview` + apply (or deep-link `/arr/[id]/sync` per D1); mark completed |
| `docs/api/v1/openapi.yaml` | UPDATE | Add `Setup` tag + 4 paths/schemas (contract-first) |
| `src/lib/api/v1.d.ts` | REGEN | `deno task generate:api-types` after openapi edit |
| `scripts/test.ts` | UPDATE | Add `setup-wizard` alias |
| `packages/praxrr-app/src/tests/routes/setupWizard.test.ts` | CREATE | Route/API unit tests |
| `packages/praxrr-app/src/tests/base/setupProgress.test.ts` | CREATE | Progress + gate + guard + SSRF unit tests |
| `packages/praxrr-app/src/tests/e2e/specs/N.NN-setup-wizard.spec.ts` | CREATE | One Playwright happy-path funnel |

> All route paths are under `packages/praxrr-app/src/`.

## NOT Building

- **No generic wizard framework** — one wizard; route-per-step + thin `+layout.svelte` indicator, not a step registry/pluggable-validator engine.
- **No duplicate InstanceForm** — embed existing `arr/components/InstanceForm.svelte` (and DB form) `mode="create"`; a "simplified" copy would drift from capability flags.
- **No independent custom-format / quality-profile selection surface** — do not re-embed `QualityProfiles.svelte`; CFs follow chosen profiles (read-only context). Per D1, profiles+preview may deep-link `/arr/[id]/sync`.
- **No local-path PCD linking in the wizard** — git-URL (`https://`) only (security C4); local-path stays in the authenticated Databases UI.
- **No generic `/api/v1` instance/DB CRUD promotion** — reuse existing query/manager layers; `/api/v1/setup/*` stays thin (state + connection test). No new sync executor/preview format (reuse #7).
- **No app-wide CSRF/HOST-bind rewrite in this PR** — C2's `csrf.trustedOrigins`-narrowing + bind changes are app-wide and pre-existing; this PR mitigates the wizard surface via the per-handler auth+setup-in-progress guard (C1) and optional local-IP restriction, and flags full C2/W3 hardening as a follow-up (see Risks/Notes).
- **No new `setup_state` flags beyond the 3 specified**; never repurpose `default_database_linked`.
- **No new dependency.**

---

## Step-by-Step Tasks

### Task 1.1: Migration — extend `setup_state` — Depends on [none]

- **BATCH**: B1
- **ACTION**: Create `db/migrations/20260707_add_setup_wizard_state.ts`.
- **IMPLEMENT**: `export const migration: Migration = { version: 20260707, name: 'Add setup wizard state', up, down }`. `up`: three `ALTER TABLE setup_state ADD COLUMN` — `wizard_completed INTEGER NOT NULL DEFAULT 0`, `wizard_dismissed_at TEXT`, `wizard_current_step TEXT NOT NULL DEFAULT 'welcome'`. `down`: drop the three columns.
- **MIRROR**: MIGRATION_PATTERN; `039_create_setup_state.ts`.
- **GOTCHA**: Version must be `20260707` (next after `20260706`); runner sorts by numeric `version`. Do NOT edit `schema.sql`. SQLite `DROP COLUMN` needs 3.35+ — acceptable for `down`.
- **VALIDATE**: `deno task check:server`; migration file parses.

### Task 1.2: SSRF guard + harden `/arr/test` — Depends on [none]

- **BATCH**: B1
- **ACTION**: Create `lib/server/utils/arr/urlSafety.ts` (`assertSafeArrUrl`); add `redirect: 'manual'` in `http/client.ts` `request()`; call `assertSafeArrUrl` in `routes/arr/test/+server.ts` before `createArrClient` (L41) and replace raw `error.message` (L53) with a sanitized reason.
- **IMPLEMENT**: `assertSafeArrUrl(url)` — parse URL; allow only `http:`/`https:`; reject host `0.0.0.0`, `169.254.169.254`, `fd00:ec2::254`, and link-local ranges. **Narrow deny-list** — RFC1918/loopback must be ACCEPTED (self-hosted Arr lives on LAN). Throw a typed error on rejection.
- **MIRROR**: `$auth/network.ts:25-136` metadata-IP constants; `arr/test/+server.ts` VALID_TYPES allow-list.
- **GOTCHA**: `parseOptionalAbsoluteHttpUrl` checks scheme only — NOT a substitute. Keep `/arr/test` behavior identical for valid hosts.
- **VALIDATE**: unit test rejects metadata/link-local/`0.0.0.0`/non-http, accepts `10.x`/`127.0.0.1`/`localhost`.

### Task 1.3: `getSystemStatus()` on BaseArrClient — Depends on [none]

- **BATCH**: B1
- **ACTION**: Add `getSystemStatus(): Promise<{ appName: string; version: string } | null>` to `lib/server/utils/arr/base.ts` reusing the `GET /api/${apiVersion}/system/status` call; keep `testConnection(): Promise<boolean>` as a thin wrapper over it.
- **MIRROR**: existing `testConnection` at `base.ts:68`.
- **GOTCHA**: Don't change `testConnection`'s boolean contract (existing callers). Lidarr uses `v1`, Radarr/Sonarr `v3` — reuse the client's existing `apiVersion`.
- **VALIDATE**: `deno task check:server`.

### Task 1.4: Extract IP-keyed rate limiter — Depends on [none]

- **BATCH**: B1
- **ACTION**: Create `lib/server/utils/rateLimit.ts` extracting the token-bucket from `section-preferences/_helpers.ts`, keyed by a caller-supplied string (IP for setup endpoints), with a `resetForTests()` export.
- **IMPLEMENT**: `registerAttempt(key, opts?): boolean` (window + max), prune-on-check; default WINDOW_MS/MAX mirroring the source (30_000 / 8) but caller-overridable.
- **MIRROR**: RATE_LIMIT; `section-preferences/_helpers.ts:58-83`.
- **GOTCHA**: Keep it pure/in-memory (per-process) like the source; don't over-engineer a shared store.
- **VALIDATE**: unit test: N allowed, N+1 throttled within window.

### Task 2.1: Register migration — Depends on [1.1]

- **BATCH**: B2
- **ACTION**: In `db/migrations.ts`, add the `import { migration as migration20260707AddSetupWizardState } from './migrations/20260707_add_setup_wizard_state.ts';` and append it to the `loadMigrations()` array.
- **MIRROR**: MIGRATION_PATTERN (two-line edit).
- **GOTCHA**: Static registration — filesystem is NOT scanned. Not a PCD base-op migration, so `seedBuiltInBaseOps.ts` is untouched.
- **VALIDATE**: `deno task check:server`; boot a fresh DB (test harness) → columns exist.

### Task 2.2: Extend `setupStateQueries` — Depends on [1.1]

- **BATCH**: B2
- **ACTION**: In `db/queries/setupState.ts`, extend the `SetupState` interface with the 3 columns and add `getWizardState()`, `setWizardStep(step)`, `markWizardCompleted()`, `markWizardDismissed()`, `wizardShouldRun()`.
- **IMPLEMENT**: Mirror the existing raw-SQL singleton style (`db.queryFirst`/`db.execute … WHERE id = 1`, `updated_at = CURRENT_TIMESTAMP`). `setWizardStep` validates the step against the enum and throws on unknown (mirror the `throw` in `get()`). `wizardShouldRun()` = `!(completed || dismissed_at)`.
- **MIRROR**: REPOSITORY_PATTERN / NAMING_CONVENTION; `setupState.ts:17-45`.
- **GOTCHA**: This file is **raw SQL, not Kysely** — do not introduce Kysely here (reconciles security AC A3: "no raw string SQL" applies to PCD-entity layer, not this singleton; keep parameterless static SQL). Fail-fast on unknown enum values.
- **VALIDATE**: `deno task check:server`; unit test transitions (welcome→…→done; completed/dismissed flags; unknown step throws).

### Task 3.1: Setup progress + gate helper + guard — Depends on [2.2]

- **BATCH**: B3
- **ACTION**: Create `lib/server/setup/progress.ts` with `getSetupProgress()`, `resolveWizardRedirect(event)`, and `assertSetupInProgress()`.
- **IMPLEMENT**: `getSetupProgress(): { hasArrInstance, hasDatabase, hasProfileSelections }` (sync; from `arrInstancesQueries.getAll()`, `databaseInstancesQueries.getAll()`, `arrSyncQueries`). `resolveWizardRedirect(event): string | null` — returns `null` when `pathname.startsWith('/api')`, `isPublicPath(pathname)`, `pathname.startsWith('/setup')`, or not a page GET; returns `/setup` (forward) when `wizardShouldRun()`, or `/` (reverse) when done/dismissed and under `/setup`. `assertSetupInProgress()` — throws 403 once `wizard_completed` (used by API handlers).
- **MIRROR**: AUTH_GUARD; GATING_PATTERN; `getAuthState` matrix.
- **GOTCHA**: Gate on `wizard_completed`/`dismissed` flag independent of auth mode (W6), NOT on `existsLocal()`. Never redirect `/api/*`.
- **VALIDATE**: unit test each branch (api/public/setup exclusions; forward/reverse; guard 403).

### Task 4.1: hooks.server.ts dual gate — Depends on [3.1]

- **BATCH**: B4
- **ACTION**: Call `resolveWizardRedirect(event)` in `hooks.server.ts` before the `return resolve(event)` inside the `auth.skipAuth` branch (~L223) AND before the final authenticated `return resolve(event)` (~L258); if it returns a path, `throw redirect(303, path)`.
- **MIRROR**: GATING_PATTERN.
- **GOTCHA**: Must be AFTER the `needsSetup` (account-setup) gate and login/API-401 gate. Both call sites required or `AUTH=off`/`local+LAN` installs never see the wizard (W6). Page-nav only.
- **VALIDATE**: auth-mode matrix test (on/local/off/oidc): first-run redirects to `/setup`, completed does not, `/api/*` never redirected.

### Task 4.2: `/setup` layout scaffold + welcome/done — Depends on [3.1]

- **BATCH**: B4
- **ACTION**: Create `routes/setup/+layout.server.ts`, `+layout.svelte`, `+page.server.ts`, `welcome/+page.svelte`, `done/+page.svelte`.
- **IMPLEMENT**: `+layout.server.ts` loads wizard state + progress, reverse-gates done/dismissed → `/`. `+page.server.ts` redirects `/setup` → `/setup/${wizard_current_step}`. `+layout.svelte` renders a 6-step stepper (Step X of 6), a persistent Skip button (POST `/api/v1/setup/skip` → `/`), and per-step heading with progress. `done` fires nothing new (completion set in preview step) and links onward.
- **MIRROR**: `routes/auth/setup/+page.server.ts` load-guard; `$ui/*` primitives; NAMING_CONVENTION (no runes).
- **GOTCHA**: Do NOT use `$ui/navigation/tabs` (section nav). Focus to step heading on nav; ARIA live region for async. No session timeout.
- **VALIDATE**: `deno task check:client` (svelte-check); manual: `/setup` resumes at current step.

### Task 4.3: `/api/v1/setup/state|complete|skip` — Depends on [3.1]

- **BATCH**: B4
- **ACTION**: Create `routes/api/v1/setup/state/+server.ts` (GET+PATCH), `complete/+server.ts` (POST), `skip/+server.ts` (POST).
- **IMPLEMENT**: Every handler's FIRST statement calls `assertSetupInProgress()` (+ auth check per mode). GET returns `{ wizard, prerequisites, defaultDatabase }`; PATCH persists `currentStep` via `setWizardStep` (400 on invalid). `complete`→`markWizardCompleted()`, `skip`→`markWizardDismissed()`, both idempotent 200. `defaultDatabase.configured=false` when `PRAXRR_DEFAULT_DB_URL=""`.
- **MIRROR**: ERROR_HANDLING (`/api/v1` handler shape, typed `ErrorResponse`).
- **GOTCHA**: No `Access-Control-Allow-Origin` header (A1). Authorize via the guard, not `PUBLIC_PATHS` (C1).
- **VALIDATE**: unit test: 403 anonymous once completed; PATCH invalid step → 400; idempotent complete/skip; no CORS header.

### Task 4.4: `/api/v1/setup/test-connection` — Depends on [3.1, 1.2, 1.3, 1.4]

- **BATCH**: B4
- **ACTION**: Create `routes/api/v1/setup/test-connection/+server.ts`.
- **IMPLEMENT**: Guard first; IP-rate-limit via `rateLimit.ts` + `getClientIp`; validate `type ∈ {radarr,sonarr,lidarr}`; `assertSafeArrUrl(url)`; `createArrClient(...).getSystemStatus()`; return `{ success:true, appName, version }` or `{ success:false, reason }` (sanitized enum), never raw error.
- **MIRROR**: ERROR_HANDLING; RATE_LIMIT; `arr/test/+server.ts` structure.
- **GOTCHA**: SSRF guard before client build (C3). Sanitized reason only (W1). Reject `chaptarr`/`all`.
- **VALIDATE**: unit test: SSRF target → rejected; bad type → 400; throttled after N; sanitized reason on failure.

### Task 5.1: connect-arr step — Depends on [4.2, 4.4]

- **BATCH**: B5
- **ACTION**: Create `routes/setup/connect-arr/+page.svelte` + `+page.server.ts`.
- **IMPLEMENT**: Embed `InstanceForm` (`mode="create"`); wire inline "Test connection" to `POST /api/v1/setup/test-connection` with idle/testing/success/fail states (distinct unreachable vs key-rejected copy); action reuses `arrInstancesQueries.create` (mirror `arr/new` dedupe + encryption); on success PATCH step → `link-database` and redirect. If env-reconciled instance already exists, present as connected and allow advancing.
- **MIRROR**: `arr/new/+page.server.ts`; InstanceForm props; dirty store.
- **GOTCHA**: Reuse `encryptArrInstanceApiKey`; never echo the key. Advance only on green test.
- **VALIDATE**: `deno task check`; manual click-through connect.

### Task 5.2: link-database step — Depends on [4.2]

- **BATCH**: B5
- **ACTION**: Create `routes/setup/link-database/+page.svelte` + `+page.server.ts`.
- **IMPLEMENT**: Load already-linked DBs (`databaseInstancesQueries.getAll()`) + default-DB env hint; if a DB is already linked (e.g. startup auto-link), show "already linked" and allow advancing. Offer default `Praxrr-DB` vs custom (git `https://` URL) behind a disclosure; action reuses `pcdManager.link` with rollback-on-failure; reject `repositoryUrl` with `@`-authority (W5); on success PATCH step → `select-profiles`.
- **MIRROR**: `databases/new/custom/+page.server.ts`; DB `InstanceForm`.
- **GOTCHA**: Git-URL-only — do NOT offer local-path (C4). Degrade gracefully for non-git; sanitized errors only (W1/W4).
- **VALIDATE**: `deno task check`; manual: default link + already-linked detection.

### Task 5.3: select-profiles step — Depends on [4.2]

- **BATCH**: B5
- **ACTION**: Create `routes/setup/select-profiles/+page.svelte` + `+page.server.ts`.
- **IMPLEMENT**: Load arr_type-compatible quality profiles for the connected instance (mirror `qualityProfiles/list.ts:61-159` — filter by `quality_api_mappings` for `arr_type`, no `arr_type='all'` reliance, no `enabled=1` gate); action reuses `arrSyncQueries.saveQualityProfilesSync`; explicit empty state when zero compatible; allow zero selection; PATCH step → `preview-sync`.
- **MIRROR**: REPOSITORY_PATTERN; `qualityProfiles/list.ts`.
- **GOTCHA**: Cross-Arr policy — resolve strictly by `arr_type`, fail-fast on ambiguity. CFs are read-only context, not a new table.
- **VALIDATE**: unit test: per-`arr_type` compat filtering; manual selection persists.

### Task 6.1: preview-sync step + completion — Depends on [5.1, 5.3]

- **BATCH**: B6
- **ACTION**: Create `routes/setup/preview-sync/+page.svelte` + `+page.server.ts`.
- **IMPLEMENT**: Call `POST /api/v1/sync/preview` (#7) and render the diff (reuse `SyncPreviewPanel`, or per D1 deep-link `/arr/[id]/sync` with a return marker); explicit confirm applies via the existing `/[previewId]/apply` path; distinguish empty-preview ("already in sync") from failed-preview; surface 429 gracefully; terminal action `POST /api/v1/setup/complete` → `markWizardCompleted()` → `/setup/done`.
- **MIRROR**: `routes/arr/[id]/sync` preview usage; sync/preview types.
- **GOTCHA**: `SyncPreviewTrigger.svelte` reads `$page.params.id` — if embedding, pass `instanceId` explicitly; otherwise deep-link. No new executor/preview format.
- **VALIDATE**: `deno task check`; manual full funnel to Done.

### Task 6.2: OpenAPI contract + regenerate types — Depends on [4.3, 4.4]

- **BATCH**: B6
- **ACTION**: Add a `Setup` tag + the 4 setup paths/schemas to `docs/api/v1/openapi.yaml`; run `deno task generate:api-types`; import generated types in the setup handlers.
- **IMPLEMENT**: Schemas `WizardState`, `SetupStateResponse`, `TestConnectionRequest/Response`; reuse shared `ErrorResponse`. Regenerate `src/lib/api/v1.d.ts`; commit it.
- **MIRROR**: existing `/api/v1/sync/preview` OpenAPI entries.
- **GOTCHA**: Contract-first — spec before handler finalization; regenerate types, then `deno task check`.
- **VALIDATE**: `deno task generate:api-types` clean; `deno task check`; `deno task lint` (openapi formatting).

### Task 7.1: Tests + alias + e2e — Depends on [6.1, 6.2]

- **BATCH**: B7
- **ACTION**: Create `tests/routes/setupWizard.test.ts`, `tests/base/setupProgress.test.ts`, one `tests/e2e/specs/N.NN-setup-wizard.spec.ts`; add `setup-wizard` alias to `scripts/test.ts`.
- **IMPLEMENT**: Unit — `getSetupProgress`, wizard transitions, `resolveWizardRedirect` matrix + `/api` exclusion, `assertSetupInProgress` 403, `assertSafeArrUrl` reject/accept cases, per-`arr_type` compat, no-CORS, rate-limit throttle, auth-mode matrix (on/local/off/oidc). E2E — one happy-path funnel.
- **MIRROR**: TEST_STRUCTURE; `uiPreferencesApi.test.ts`; `BaseTest.ts`.
- **GOTCHA**: Route tests import handlers in-process and patch `*Queries` (no browser). E2e requires a running server (`deno task test:e2e`).
- **VALIDATE**: `deno task test setup-wizard` green; `deno task test` no regressions.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `getSetupProgress` | no instance | `{hasArrInstance:false,…}` | Yes |
| `getSetupProgress` | instance + DB | `{hasArrInstance:true,hasDatabase:true}` | No |
| `setWizardStep` | unknown enum | throws | Yes |
| wizard flags | complete/dismiss | `wizardShouldRun()` false | No |
| `resolveWizardRedirect` | `/api/v1/foo` | `null` (never redirect) | Yes |
| `resolveWizardRedirect` | `/` first-run | `/setup` | No |
| `resolveWizardRedirect` | `/setup/*` done | `/` (reverse) | Yes |
| `assertSetupInProgress` | `wizard_completed=1` | throws 403 | Yes |
| `assertSafeArrUrl` | `http://169.254.169.254` | reject | Yes |
| `assertSafeArrUrl` | `http://10.0.0.5:7878` | accept | Yes |
| `assertSafeArrUrl` | `ftp://x` / `0.0.0.0` | reject | Yes |
| auth-mode matrix | off/local/oidc/on | wizard gates on flag, not `existsLocal` | Yes |
| test-connection | over rate limit | throttled | Yes |
| select-profiles | `arr_type` compat | only compatible names | Yes |
| setup endpoints | any | no `Access-Control-Allow-Origin` | Yes |

### Edge Cases Checklist

- [ ] Empty input (no instance / no DB / zero profiles selected)
- [ ] Invalid enum step (rejected)
- [ ] SSRF targets (metadata/link-local/`0.0.0.0`) rejected; LAN accepted
- [ ] `AUTH=off`/`local`/`oidc`/`on` all gate correctly
- [ ] `/api/*` never redirected by the wizard gate
- [ ] `PRAXRR_DEFAULT_DB_URL=""` (opt-out) still offers linking
- [ ] Already-linked default DB detected (no re-prompt)
- [ ] Rate-limit throttle on test-connection/link
- [ ] Non-git / `@`-authority repo URL rejected

---

## Validation Commands

### Static Analysis

```bash
deno task check
```

EXPECT: Zero type errors (server `deno check` + client `svelte-check`).

### Lint / Format

```bash
deno task lint
```

EXPECT: Prettier + ESLint clean (2-space, single-quote, semi, es5, 120w).

### Unit Tests

```bash
deno task test setup-wizard
```

EXPECT: All setup-wizard unit tests pass.

### Full Test Suite

```bash
deno task test
```

EXPECT: No regressions.

### Contract / Types

```bash
deno task generate:api-types
```

EXPECT: `src/lib/api/v1.d.ts` regenerates cleanly; no drift after commit.

### Browser Validation

```bash
deno task dev:noauth   # AUTH=off first-run
```

EXPECT: fresh DB → `/` redirects to `/setup/welcome`; full funnel to Done; Skip → dashboard banner.

### E2E

```bash
deno task test:e2e
```

EXPECT: setup-wizard happy-path spec passes.

### Manual Validation

- [ ] Fresh DB boots, migration applies, `/setup` reachable and resumes at current step
- [ ] Bad API key vs unreachable URL show distinct inline errors
- [ ] Completed/skipped user hitting `/setup/*` is bounced to `/`
- [ ] Keyboard-only + one screen-reader pass on the funnel

---

## Acceptance Criteria

- [ ] All tasks completed; all validation commands pass
- [ ] Migration `20260707` statically registered; applies on a fresh DB
- [ ] First-run gating keys on `wizard_completed`/`dismissed`, never `default_database_linked`
- [ ] Wizard gate runs after account-setup/login gates, in both skipAuth + auth-tail spots, and **never** redirects `/api/*`
- [ ] Every `/api/v1/setup/*` handler calls the auth+setup-in-progress guard as first statement (403 anonymous once complete); no authorization via `PUBLIC_PATHS`
- [ ] `assertSafeArrUrl` rejects metadata/link-local/`0.0.0.0`/non-http, accepts RFC1918/loopback; used in both `/arr/test` and setup test-connection; `redirect:'manual'` set
- [ ] Wizard link step is git-URL-only (no local-path); `@`-authority URL rejected
- [ ] test-connection/link IP-rate-limited; client sees sanitized reason enum only (no raw error/stderr/token)
- [ ] No `Access-Control-Allow-Origin` on setup endpoints
- [ ] Reuses `InstanceForm`, `arrInstancesQueries.create`, `pcdManager.link`, `arrSyncQueries.saveQualityProfilesSync`, `POST /api/v1/sync/preview` — no duplication
- [ ] OpenAPI updated + types regenerated + committed
- [ ] Tests written and passing; one Playwright happy-path; `Closes #12`

## Completion Checklist

- [ ] Code follows discovered patterns (raw-SQL singleton, form-action, `/api/v1` handler shapes)
- [ ] Error handling matches codebase style (fail/redirect, typed `ErrorResponse`, sanitized enums)
- [ ] Logging follows conventions (never log secrets/tokens/keys)
- [ ] Tests follow `BaseTest`/route-handler patterns; `setup-wizard` alias added
- [ ] No hardcoded values; `PRAXRR_DEFAULT_DB_URL` resolution honored (empty = opt-out)
- [ ] `deno task check` + `deno task lint` clean; `graphify update .` run after changes
- [ ] No unnecessary scope additions (see NOT Building)
- [ ] Migration verified on fresh DB; auth-mode matrix verified
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| C1 — unauthenticated `/api/v1/setup/*` | High | Critical | Per-handler auth+setup-in-progress guard as first statement; never `PUBLIC_PATHS` |
| C3 — SSRF via connection test | High | Critical | `assertSafeArrUrl` deny-list + `redirect:'manual'`, shared with `/arr/test` |
| C4 — local-path traversal on PCD link | Med | Critical | Git-URL-only in wizard; local-path stays in authenticated Databases UI |
| W6 — wizard never fires under `AUTH=off` | Med | High | Gate on `wizard_completed` flag; call `resolveWizardRedirect` in BOTH skipAuth + auth-tail |
| Half-wired gate strands first-run users | Med | High | B1–B3 (state+gate) land test-covered before step batches; unbuilt steps simply resolve forward |
| Migration version collision | Low | Med | `20260707` verified next-unused; runner sorts by version |
| C2/W3 — app-wide CSRF/HOST hardening deferred | Med | Med | This PR adds per-handler guard (+ optional local-IP restriction); full `csrf.trustedOrigins` narrowing tracked as follow-up (app-wide, out of scope) |
| Client/server step drift | Low | Med | Server-authoritative current step; client store holds transient form state only |

## Notes

- **Phasing keeps `main` green**: B1–B4 deliver a wizard you can enter/skip/complete with placeholder steps; step batches (B5–B6) layer behind the resolver, which forwards past unbuilt steps.
- **Two design tensions resolved** (feature-spec D1/D2): embed `InstanceForm` for connect/link; deep-link `/arr/[id]/sync` acceptable for profiles+preview to avoid duplicating ~1500 lines of coupled sync UI. `/api/v1/setup/*` stays thin; domain writes reuse the query/manager layer.
- **HEAD-verified corrections from research**: `setupState.ts` is raw SQL (not Kysely) — mirror it; `parseOptionalAbsoluteHttpUrl` is scheme-only (not an SSRF guard); the wizard gate needs TWO call sites (skipAuth branch + auth tail); Prettier is 2-space/single-quote/semi/es5/120w (CLAUDE.md's note is stale).
- **Contract-first**: OpenAPI edit → `generate:api-types` → handler import → `deno task check`.
- **Security scope**: C1/C3/C4/W1/W2/W6 are in-scope and mandatory. C2/W3 (per-boot setup token, `csrf.trustedOrigins` off `'*'`, HOST bind) are app-wide/pre-existing — mitigated at the wizard surface via the guard (and optional local-IP restriction), full hardening flagged as a follow-up issue.
- Research backstops: `docs/prps/plans/.prp-research/setup-wizard/*.md`; full design: `docs/plans/setup-wizard/`.
