# Practices Research — Setup Wizard (#12)

Discovery-only. All paths absolute-relative to repo root. Snippets ≤5 lines.

## NAMING_CONVENTION

| Concern | Convention (MIRROR source) | Evidence |
| --- | --- | --- |
| Migration file name | `NNN_verb_noun.ts` (legacy int prefix) **now** `YYYYMMDD_verb_noun.ts` for all new migrations | `packages/.../db/migrations/20260706_create_user_complexity_tiers.ts`; setup wizard → `20260707_add_setup_wizard_state.ts` |
| Migration `version` field | Integer; for dated files the version **equals the date** `YYYYMMDD` | `20260706_create_user_complexity_tiers.ts:8` → `version: 20260706,` — next unused: `version: 20260707` |
| Migration object shape | `export const migration: Migration = { version, name, up, down }`; `up`/`down` are raw SQL template strings (tab-indented) | `039_create_setup_state.ts:10-28` |
| Migration registration | Static `import { migration as migrationYYYYMMDD... }` + append to the array in `loadMigrations()` (array is `.sort((a,b)=>a.version-b.version)`, so append anywhere) | `migrations.ts:70` (import), `migrations.ts:301-368` (array), `migrations.ts:371` (sort) |
| Query module file | `camelCase.ts` per table under `db/queries/` (e.g. `setupState.ts`, `arrInstances.ts`) | `db/queries/` listing |
| Query export symbol | `export const <thing>Queries = { method(): T {...} }` object literal, methods use `db.queryFirst`/`db.execute` | `setupState.ts:17` → `export const setupStateQueries = {` |
| Query type interface | `export interface <PascalTable>` colocated in same file | `setupState.ts:6` → `export interface SetupState {` |
| Route folder | Route-per-concern folders under `src/routes/<feature>/`; nested `+page.server.ts` (load/actions) + `+page.svelte`; params as `[id]` | `routes/arr/new/`, `routes/databases/new/{custom,trash-guide}/`, `routes/auth/setup/{+page.server.ts,+page.svelte}` |
| API route | `src/routes/api/v1/<name>/+server.ts` exporting `GET`/`PATCH`/`POST` | `routes/api/v1/ui-preferences/+server.ts` |
| Path aliases | `$db/`, `$api/`, `$sync/`, `$arr/`, `$ui/`, `$shared/`, `$logger/`, `$auth/` (see CLAUDE.md table) — use `$db/queries/x.ts` not relative | test imports `$db/queries/user_interface_preferences.ts` (`uiPreferencesApi.test.ts:5`) |
| Svelte 5 NO-runes | `onclick` handlers, no `$state`/`$derived`; forms use `dirty` store + `form.error`/`form.success` from actions | CLAUDE.md Conventions; dirty store below |

### Prettier (verified from `.prettierrc`, NOT CLAUDE.md — CLAUDE.md note is STALE)

```json
{ "tabWidth": 2, "useTabs": false, "printWidth": 120,
  "singleQuote": true, "trailingComma": "es5", "semi": true,
  "overrides": [{ "files": ["*.md","*.markdown"], "options": { "printWidth": 80 } }] }
```

**2-space, spaces (not tabs), semicolons, single quotes, es5 trailing commas, 120 print width.** CLAUDE.md's "Tabs / no trailing commas / 100 char" is wrong — match `.prettierrc`. (Matches project memory `prettier-config-vs-claudemd`.)

## TEST_STRUCTURE

| Aspect | Convention (MIRROR source) | Evidence |
| --- | --- | --- |
| Route/query tests location | `packages/praxrr-app/src/tests/routes/*.test.ts` — import handlers directly, test `load`/`actions`/`GET`/`PATCH` in-process (no browser) | `tests/routes/uiPreferencesApi.test.ts`, `complexityTiersApi.test.ts`, `trashGuideSources.test.ts` |
| Base/unit tests location | `packages/praxrr-app/src/tests/base/*.test.ts` for cross-cutting server logic | `tests/base/` (e.g. `syncPreviewRouteHardening.test.ts`, `envInstances.test.ts`) |
| Ambient types header | Route tests need SvelteKit ambient types via triple-slash ref | `uiPreferencesApi.test.ts:1-2` → `/// <reference path="../../app.d.ts" />` |
| Direct handler import | Import route handler + query module, patch queries with in-memory store | `uiPreferencesApi.test.ts:5-6` `import { GET, PATCH } from '../../routes/api/v1/ui-preferences/+server.ts'` |
| Dependency patching | Local `patchTarget(target,key,replacement,restores)` + `restoreAll` OR `BaseTest.installPatch` (auto-restored) | `uiPreferencesApi.test.ts:26-43`; `BaseTest.ts:135-146` |
| BaseTest harness | `class X extends BaseTest`; register via `this.test(name, fn)` (wraps `Deno.test`, gives `context.tempDir`, auto teardown + patch restore) | `BaseTest.ts:216-246`; helpers: `installPatch` (L135), `assertPayloadNoLeak` (L158), `waitFor` (L177) |
| Assertions | `@std/assert` (`assertEquals`, `assertExists`) | `uiPreferencesApi.test.ts:4` |
| Test runner + perms | `scripts/test.ts` runs `deno test <paths> --allow-net --allow-read --allow-write --allow-env --allow-ffi --allow-run`, sets `APP_BASE_PATH=<repo>/dist/test` | `scripts/test.ts` (env + Deno.Command) |
| Alias map | `aliases: Record<string,string>` in `scripts/test.ts` — key → single file, comma-list, or directory | `scripts/test.ts` aliases block |

### Add `setup-wizard` alias (MIRROR the comma-list form)

In `scripts/test.ts` `aliases` object, add (dir + route test, comma-joined like `complexity`/`phase3`):

```ts
'setup-wizard':
  'packages/praxrr-app/src/tests/routes/setupWizard.test.ts,packages/praxrr-app/src/tests/base/setupProgress.test.ts',
```

Then `deno task test setup-wizard` resolves via `aliases[target] ?? target`.

### E2E (Playwright)

- Specs: `packages/praxrr-app/src/tests/e2e/specs/*.spec.ts` (+ `helpers/`, `env.ts`). Numbered `N.NN-<slug>.spec.ts`.
- Run: `deno task test:e2e` → `deno run -A scripts/e2e.ts` (`deno.json:89`); `:headed`/`:debug`/`:reset` variants. Requires running server.
- Add ONE happy-path funnel spec (per spec: unit-first, one e2e).

## NOT Building (avoid over-engineering)

- **No generic wizard framework** — no step registry / pluggable-validator engine. One wizard; use route-per-step under `/setup/*` + a thin `+layout.svelte` step indicator (research-practices KISS L86-91).
- **No duplicate InstanceForm** — import `routes/arr/components/InstanceForm.svelte` and `routes/databases/components/InstanceForm.svelte` verbatim with `mode="create"`; do NOT hand-roll a "simplified" instance form (would drift from capability flags). (KISS L92-96)
- **No independent custom-format / quality-profile selection table** — do NOT re-embed `QualityProfiles.svelte` (~300-600 lines, wired to sibling `?/save*` actions). Deep-link to real `/arr/[id]/sync` for profiles+preview. (KISS L97-106; feature-spec D1). CFs are read-only context, not a new per-instance CF table (feature-spec Tech Decisions).
- **No local-path PCD linking in the wizard** — git-URL-only (security C4); local-path stays in authenticated Databases UI. (feature-spec C4)
- **No promotion to generic `/api/v1` instance/db CRUD** — reuse existing query/manager layers (`arrInstancesQueries.create`, `pcdManager.link`, `arrSyncQueries.saveQualityProfilesSync`); `/api/v1/setup/*` is thin (state + connection test only, D2). No new sync executor/preview format — reuse `POST /api/v1/sync/preview` (#7). (feature-spec API Design)
- **No new `setup_state` speculative flags beyond the 3 spec'd** (`wizard_completed`, `wizard_dismissed_at`, `wizard_current_step`); do NOT repurpose `default_database_linked`. (feature-spec R3)
- **No new dependency** — every primitive (forms, dirty, alerts, modals, sync preview) exists in-repo. (research-practices Build vs Depend)

## Reusable utilities to use

| Utility | Location | Reuse in wizard |
| --- | --- | --- |
| Arr `InstanceForm.svelte` | `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte` | Connect-Arr step, `mode="create"`; owns test-connection, capability warnings, secret reveal, dirty init |
| DB `InstanceForm.svelte` | `packages/praxrr-app/src/routes/databases/components/InstanceForm.svelte` | Link-DB step, `mode="create"` (git URL only) |
| `arrInstancesQueries` | `$db/queries/arrInstances.ts` (`arrInstances.ts:177`) | `.create()` (write), `.getAll()`/`.getEnabled()` → `hasArrInstance` prereq |
| `databaseInstancesQueries` | `$db/queries/databaseInstances.ts` | `.getAll()` → `hasLinkedDatabase` prereq; `.create()` via `pcdManager.link` |
| `setupStateQueries` (extend) | `$db/queries/setupState.ts` | Add `getWizardState/setWizardStep/markWizardCompleted/markWizardDismissed/wizardShouldRun`; existing `get()` uses `db.queryFirst`, mutators `db.execute(... updated_at=CURRENT_TIMESTAMP ...)` (`setupState.ts:22,40`) |
| dirty store | `$stores/dirty.ts` (`$lib/client/stores/dirty.ts`) | `initCreate` (L67), `update` (L76), `isDirty` (L46), `clear()` (L93) on unmount, `confirmNavigation()` (L104) |
| `alertStore.add` | `$alerts/store` | All wizard success/error feedback (no separate wizard alert UI) |
| `$ui/*` primitives | `$ui/form/FormInput`, `$ui/dropdown/DropdownSelect`, `$ui/button/Button`, `$ui/modal/{Modal,DirtyModal}`, `$ui/form/DisclosureSection`, `$ui/card/StickyCard`, `$ui/badge/Badge` | Only primitives needed for steps 1-2; do NOT add new form atoms. NOT `$ui/navigation/tabs` (section nav, not a stepper) |
| Rate-limit pattern (MIRROR, per-key window) | `$sync/preview/limits.ts` | Mirror `registerPreviewCreateAttempt(key, nowMs): boolean` + prune-window into IP-keyed `$utils/rateLimit.ts` for `test-connection` (W2). Constants pattern L1-3; window map L10; check L17-29; `resetForTests()` L31 |
| Encryption helpers (AES-GCM) | `$utils/encryption/arr-credentials.ts` | `encryptArrInstanceApiKey()` (L89) / `decryptArrInstanceApiKey()` (L120) — reuse for every secret; DB creds have parallel helper. No new crypto (advisory A4) |
| `getSetupProgress()` single-source (NEW, small) | create `$server/setup/progress.ts` | Pure sync `{ hasArrInstance, hasDatabase }` from `arrInstancesQueries.getAll()` / `databaseInstancesQueries.getAll()`; ONE consumer pattern shared by `hooks.server.ts` gate + `/setup/+layout.server.ts` (research-practices Interface Design) |
| Sync preview reuse (#7) | `$sync/preview/{orchestrator,types}.ts`, `POST /api/v1/sync/preview` + `/[previewId]/apply`, `routes/arr/[id]/sync/components/SyncPreviewPanel.svelte` | Preview-sync step; do NOT reimplement. Caveat: `SyncPreviewTrigger.svelte` reads `$page.params.id` → deep-link into `/arr/[id]/sync` (research-practices reuse table) |
| Action return shape | `arr/new/+page.server.ts` / `databases/new/*/+page.server.ts` | Wizard `+page.server.ts` actions return `fail(400,{error,values})` / `redirect(...)` so embedded `InstanceForm` `form.error`/`form.success` works unmodified |

## Key facts for the plan

- Latest applied migration: `version: 20260706`. **Next unused integer/file: `20260707_add_setup_wizard_state.ts`, `version: 20260707`.**
- `loadMigrations()` sorts by version, so the import + array entry can be appended at the end (`migrations.ts:301-371`).
- `setup_state` today has only `id, default_database_linked, created_at, updated_at` (`setupState.ts:6-11`; migration `039_create_setup_state.ts`). Singleton `id=1 CHECK`.
- No `routes/setup/` exists yet; `routes/auth/setup/` is the structural template (full-screen no-nav first-run route).
- Route tests import handlers in-process and patch the `*Queries` object — new `getSetupProgress()` + `setupStateQueries` wizard methods are the cheapest unit-test surface.
