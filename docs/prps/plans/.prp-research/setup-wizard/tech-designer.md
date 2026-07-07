# Tech Designer — Setup Wizard (issue #12)

Verification of the drafted `feature-spec.md` / `research-technical.md` against the live codebase, with
exact `file:line` + ≤5-line snippets, Patterns-to-Mirror, an exhaustive Files-to-Change list, and an
ordered/parallelizable task draft. All facts below were read from HEAD; spec claims that did not match
source are flagged **CORRECTION**.

---

## Patterns to Mirror

### REPOSITORY_PATTERN — singleton query layer (mirror for wizard state methods)

Source of truth: `packages/praxrr-app/src/lib/server/db/queries/setupState.ts:17-45`. Exported object
literal, raw SQL via `db.queryFirst` / `db.execute`, singleton row `id = 1`, fail-fast getter.

```ts
// setupState.ts:17
export const setupStateQueries = {
  get(): SetupState {
    const state = db.queryFirst<SetupState>('SELECT * FROM setup_state WHERE id = 1');
    if (!state) throw new Error('Setup state not found - database may not be initialized');
    return state;
  },
  markDefaultDatabaseLinked(): boolean {
    const affected = db.execute('UPDATE setup_state SET default_database_linked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1');
    return affected > 0;
  },
};
```

New wizard methods extend this same object (do NOT add a new file / new table): `getWizardState()`,
`setWizardStep(step)` (fail-fast on unknown enum — mirror the `throw` in `get()`),
`markWizardCompleted()`, `markWizardDismissed()`, `wizardShouldRun()`. Extend the `SetupState`
interface at `setupState.ts:6-11` with the three new columns.

> **CORRECTION vs spec §"A3: keep new queries on Kysely builder":** the `setupState.ts` layer is **raw
> SQL** (`db.queryFirst`/`db.execute`), not Kysely. Mirror the existing raw-SQL style in this file for
> consistency; the "Kysely builder" advisory applies to the PCD entity layer (e.g. `qualityProfiles/list.ts`),
> not to `setupState.ts`. Flag for the security reviewer that A3 does not fit this file.

### SERVICE_PATTERN — SvelteKit form action / API handler (mirror for setup endpoints + step actions)

Source of truth: `packages/praxrr-app/src/routes/arr/new/+page.server.ts:15-176`. Parse → validate (fail
fast with `fail(status, {error, values})`) → dedupe check → call query layer → `redirect(303, …)`.

```ts
// arr/new/+page.server.ts:16
default: async ({ request }) => {
  const formData = await request.formData();
  const name = formData.get('name')?.toString().trim();
  if (!name || !type || !url || !apiKey) return fail(400, { error: '…required', values: { name, type, url } });
  if (!VALID_TYPES.includes(type)) return fail(400, { error: 'Invalid arr type', values: { name, type, url } });
  const insertedId = arrInstancesQueries.create({ name, type, url, apiKey, tags, enabled }, { ciphertext, nonce, keyVersion, fingerprint });
  redirect(303, `/arr/${id}/settings`);
}
```

For the JSON `/api/v1/setup/*` handlers, mirror instead the API-handler shape at
`routes/api/v1/sync/preview/+server.ts:211-232`: `RequestHandler`, body-size guard, `parseCreateRequest`
throw→`json({error}, {status:400})`, 404 on missing instance, typed `ErrorResponse`.

```ts
// api/v1/sync/preview/+server.ts:211
export const POST: RequestHandler = async ({ request }) => {
  const requestBody = await parseRequestBody(request);        // size + JSON guard
  if (!requestBody.ok) return requestBody.response;
  const instance = arrInstancesQueries.getById(requestPayload.instanceId);
  if (!instance) return json({ error: 'Instance not found' } satisfies ErrorResponse, { status: 404 });
};
```

### MIGRATION_PATTERN — object + static registration (two-file edit)

Migration object: `db/migrations/20260706_create_user_complexity_tiers.ts:7-35` (latest on disk).
`{ version:number, name, up, down }`, optional `afterUp?()` for data migrations. Template at
`db/migrations/_template.ts`.

```ts
// 20260706_create_user_complexity_tiers.ts:7
export const migration: Migration = {
  version: 20260706,
  name: 'Create user complexity tiers table',
  up: `CREATE TABLE …;`,
  down: `DROP TABLE IF EXISTS …;`,
};
```

Registration is **static, not filesystem-scanned** — a two-line edit in
`db/migrations.ts`: add the import (after line 70) and the array entry in `loadMigrations()` (after line
367). Exact edit shape:

```ts
// migrations.ts:70 (add import, keep append-only order)
import { migration as migration20260707AddSetupWizardState } from './migrations/20260707_add_setup_wizard_state.ts';
// migrations.ts:367 (add to loadMigrations() array, last element)
    migration20260707AddSetupWizardState,
```

Next unused version = **20260707** (latest is 20260706; today 2026-07-07). Runner sorts by `version`
(`migrations.ts:195,371`), so append order is cosmetic but keep it last for readability.

### GATING_PATTERN — `hooks.server.ts` handle() (where the wizard gate slots)

`packages/praxrr-app/src/hooks.server.ts:207-259`. Existing gate order and the **exact** lines the
wizard gate must slot against:

```ts
// hooks.server.ts:214  [1] account-setup gate (hard) — wizard goes strictly AFTER this
  if (auth.needsSetup) { if (pathname === '/auth/setup') return resolve(event); throw redirect(303, '/auth/setup'); }
// hooks.server.ts:222  [2] skipAuth early return (AUTH=off / AUTH=local+LAN) — W6: wizard MUST run here too
  if (auth.skipAuth) { return resolve(event); }
// hooks.server.ts:227  [3] reverse gate for /auth/setup after user exists (pattern to copy for /setup)
  if (event.url.pathname === '/auth/setup') { throw redirect(303, '/'); }
// hooks.server.ts:258  authenticated tail return — wizard gate also slots BEFORE this
  return resolve(event);
```

**Insertion design (load-bearing):** because `skipAuth` returns early at **line 222** and W6 requires the
wizard to run under `AUTH=off`, a single gate before line 258 is insufficient. Add a shared helper
`resolveWizardRedirect(event)` (in `$server/setup/progress.ts`) and call it in **two** spots:
1. inside the `auth.skipAuth` branch, **before** the `return resolve(event)` at line 223; and
2. **before** the final `return resolve(event)` at line 258 (authenticated path).
The helper must early-return `null` (no redirect) when: `pathname.startsWith('/api')`, `isPublicPath(pathname)`,
`pathname.startsWith('/setup')` (avoid redirect loop), or the request is not a page GET. Reverse gate =
same helper returns `/` when wizard done/dismissed and `pathname.startsWith('/setup')`.

### PUBLIC_PATHS — do NOT widen (security C1)

`$auth/middleware.ts:27`. `/setup` must stay auth-required; reachability is granted by the redirect gate,
not a public-path exemption.

```ts
// middleware.ts:27
const PUBLIC_PATHS = ['/auth/login', '/auth/setup', '/auth/oidc', '/api/v1/health'];
```

Leave this array unchanged. `/api/v1/setup/*` handlers self-guard (require auth + assert in-progress) as
their first statement — never rely on PUBLIC_PATHS placement for authz.

### Reuse targets — verified signatures

| Target | file:line | Verified signature / note |
| --- | --- | --- |
| Instance create | `db/queries/arrInstances.ts:181` | `create(input: CreateArrInstanceInput, credentialInput?: ArrInstanceCredentialWriteInput): number` — encrypts + inserts `arr_instances` + `arr_instance_credentials` in one tx |
| PCD link | `pcd/core/manager.ts:42` | `async link(options: LinkOptions): Promise<DatabaseInstance>`; `LinkOptions` type at `pcd/core/types.ts:128-139` (`repositoryUrl, name, branch?, syncStrategy?, autoPull?, personalAccessToken?, gitUserName?, gitUserEmail?, conflictStrategy?`) |
| Profile save | `db/queries/arrSync.ts:459` | `saveQualityProfilesSync(instanceId: number, selections: ProfileSelection[], config: SyncConfig): void` — clears + reinserts `arr_sync_quality_profiles`, upserts config |
| Sync preview | `routes/api/v1/sync/preview/+server.ts:211` | `POST` reused unchanged; apply via `…/[previewId]/apply/+server.ts`. Do not build a new executor |
| Connection test | `utils/arr/base.ts:68` | `testConnection(): Promise<boolean>` — calls `/api/${apiVersion}/system/status`, **discards** `appName/version`. Add `getSystemStatus(): Promise<{appName,version}|null>` and keep the boolean wrapper |
| Instance form | `routes/arr/components/InstanceForm.svelte:32-39` | `mode: 'create'|'edit'`, props `instance, initialType, canEditCoreConnectionFields, hasStoredApiKey, apiKeyMasked, form` |
| Profile compatibility | `pcd/entities/qualityProfiles/list.ts:61-159` | Arr-scoped filter: query `quality_api_mappings WHERE arr_type = ?`, build `compatibleProfileNames` set, `profiles.filter(p => compatibleProfileNames.has(p.name))`. Mirror for select-profiles step (no `arr_type='all'` reliance, no `enabled=1` gate) |
| DB presence | `db/queries/databaseInstances.ts:222` `getAll()`, `:356` `nameExists()` | prerequisite derivation for `getSetupProgress()` |
| Account-setup precedent | `routes/auth/setup/+page.server.ts:11-19` | `load` redirects home if `usersQueries.existsLocal()`; action creates user + session. Copy the load-guard shape for `/setup/+layout.server.ts` |

### Security surfaces verified (must be closed by this work)

- **C3 SSRF**: `routes/arr/test/+server.ts:41` builds `createArrClient(type, url, apiKey, {timeout:3000, retries:0})` and `client.testConnection()` with **no host validation**. `parseOptionalAbsoluteHttpUrl` (`utils/validation/url.ts:8-25`) only checks scheme (`http:`/`https:`), **not host** — insufficient for SSRF. New `assertSafeArrUrl()` (`$arr/urlSafety.ts`) must deny cloud-metadata/link-local/`0.0.0.0`, http(s) only, and be called in **both** `/arr/test` and the new `/api/v1/setup/test-connection`.
- **W1 error leak**: `routes/arr/test/+server.ts:53` returns raw `error.message`. New endpoint must return a sanitized reason enum.

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `packages/praxrr-app/src/lib/server/db/migrations/20260707_add_setup_wizard_state.ts` | **Create** | Add `wizard_completed INTEGER NOT NULL DEFAULT 0`, `wizard_dismissed_at TEXT`, `wizard_current_step TEXT NOT NULL DEFAULT 'welcome'` to `setup_state` (extend singleton; not `schema.sql`). Mirror `_template.ts` + `039_create_setup_state.ts` |
| `packages/praxrr-app/src/lib/server/db/migrations.ts` | **Modify** | Static register: import after line 70; array entry after line 367 in `loadMigrations()` |
| `packages/praxrr-app/src/lib/server/db/queries/setupState.ts` | **Modify** | Extend `SetupState` interface + add `getWizardState / setWizardStep(fail-fast enum) / markWizardCompleted / markWizardDismissed / wizardShouldRun`. Mirror existing raw-SQL singleton style |
| `packages/praxrr-app/src/lib/server/setup/progress.ts` | **Create** | Pure sync `getSetupProgress(): {hasArrInstance, hasDatabase, hasProfileSelections}` from `arrInstancesQueries.getAll` / `databaseInstancesQueries.getAll` / `arrSyncQueries`; plus `resolveWizardRedirect(event)` gate helper (single source used by hooks + layout) |
| `packages/praxrr-app/src/hooks.server.ts` | **Modify** | Call `resolveWizardRedirect` before `return resolve(event)` at line 223 (skipAuth branch, W6) AND line 258 (authenticated tail); page-nav only, never `/api/*` or public paths |
| `packages/praxrr-app/src/lib/server/utils/arr/base.ts` | **Modify** | Add `getSystemStatus(): Promise<{appName,version}|null>` reusing the `system/status` GET at line 70; keep `testConnection(): boolean` as thin wrapper |
| `packages/praxrr-app/src/lib/server/utils/arr/urlSafety.ts` | **Create** | `assertSafeArrUrl(url)` — deny cloud-metadata (`169.254.169.254`, `fd00:ec2::254`), link-local, `0.0.0.0`; http(s) only; narrow deny-list (LAN Arr is legit) |
| `packages/praxrr-app/src/routes/arr/test/+server.ts` | **Modify** | Call `assertSafeArrUrl(url)` before `createArrClient` (line 41); replace raw `error.message` (line 53) with sanitized reason (W1) |
| `packages/praxrr-app/src/routes/api/v1/setup/state/+server.ts` | **Create** | `GET` (wizard+prereqs+defaultDb) and `PATCH` (persist `currentStep` only). Self-guard first statement |
| `packages/praxrr-app/src/routes/api/v1/setup/test-connection/+server.ts` | **Create** | Guarded + rate-limited; `assertSafeArrUrl` → `getSystemStatus`; sanitized reason enum |
| `packages/praxrr-app/src/routes/api/v1/setup/complete/+server.ts` | **Create** | `POST` → `markWizardCompleted()`, idempotent |
| `packages/praxrr-app/src/routes/api/v1/setup/skip/+server.ts` | **Create** | `POST` → `markWizardDismissed()`, idempotent |
| `packages/praxrr-app/src/routes/setup/+layout.server.ts` | **Create** | Resolve current step from persisted state; reverse-gate done/skipped → `/`. Mirror `auth/setup` load-guard |
| `packages/praxrr-app/src/routes/setup/+layout.svelte` | **Create** | Stepper chrome + Skip; reuse `$ui/*`, no `$ui/navigation/tabs` |
| `packages/praxrr-app/src/routes/setup/+page.server.ts` | **Create** | Index → redirect to `wizard_current_step` |
| `packages/praxrr-app/src/routes/setup/{welcome,connect-arr,link-database,select-profiles,preview-sync,done}/+page.svelte` (+ `+page.server.ts` where a load/action is needed) | **Create** | Step UIs. connect-arr embeds `InstanceForm.svelte mode="create"`; per D1 preview-sync may deep-link `/arr/[id]/sync` |
| `docs/api/v1/openapi.yaml` | **Modify** | Add `Setup` tag + the 4 setup paths/schemas (contract-first) |
| `packages/praxrr-app/src/lib/api/v1.d.ts` | **Regenerate** | `deno task generate:api-types` after openapi edit; then `deno task check` |
| `scripts/test.ts` | **Modify** | Add `setup-wizard` alias to the `aliases` object (line 11) |
| `packages/praxrr-app/src/tests/setup-wizard/*.test.ts` | **Create** | Unit tests (extend `BaseTest.ts`): progress, wizard transitions, gate matrix, `assertSafeArrUrl` rejections, per-`arr_type` compatibility, no-CORS |
| **NOT changed** | — | `schema.sql` (reference), `seedBuiltInBaseOps.ts` (no PCD base-op migration — verified it is a no-op stub, `pcd/ops/seedBuiltInBaseOps.ts:8-20`), legacy `/arr/new`, `/databases/new/custom`, `PUBLIC_PATHS` array |

---

## Step-by-Step Tasks

Ordered by phase; `Depends-on` enables parallel batching. Batch = tasks with no unmet dependency.

| Task | ACTION | IMPLEMENT | Depends-on |
| --- | --- | --- | --- |
| **T1** Migration | Create `20260707_add_setup_wizard_state.ts` | Mirror `039_create_setup_state.ts`; `ALTER TABLE setup_state ADD COLUMN` ×3 (`wizard_completed`, `wizard_dismissed_at`, `wizard_current_step` with `CHECK` on enum), `version:20260707`, `down` drops columns | — |
| **T2** Register migration | Modify `migrations.ts` | Add import after line 70 + array entry after line 367 (exact shape in MIGRATION_PATTERN) | T1 |
| **T3** Query layer | Modify `setupState.ts` | Extend `SetupState` interface + 5 wizard methods; `setWizardStep` throws on unknown enum (mirror `get()` throw) | T1 |
| **T4** Progress + gate helper | Create `$server/setup/progress.ts` | `getSetupProgress()` from existing `getAll`; `resolveWizardRedirect(event)` (excludes `/api`, public, `/setup`; forward + reverse) | T3 |
| **T5** hooks gate | Modify `hooks.server.ts` | Call `resolveWizardRedirect` before resolve at line 223 (skipAuth) and 258 (auth tail); page-nav only | T4 |
| **T6** Setup layout scaffold | Create `routes/setup/+layout.server.ts` + `+layout.svelte` + `+page.server.ts` | Resolve step, reverse-gate, stepper chrome + Skip; mirror `auth/setup` load-guard | T3 |
| **T7** welcome + done steps | Create `welcome/`, `done/` `+page.svelte` | Placeholder vertical slice; Skip action wired | T6 |
| **T8** state/complete/skip API | Create `api/v1/setup/state`, `complete`, `skip` `+server.ts` | Self-guard first statement; GET returns wizard+prereqs+defaultDb; PATCH persists step; complete/skip idempotent 200 | T3, T4 |
| **T9** openapi + types | Modify `openapi.yaml`; regenerate `v1.d.ts` | Add `Setup` tag + 4 paths; `deno task generate:api-types`; `deno task check` | T8, T11 |
| **T10** SSRF guard | Create `$arr/urlSafety.ts`; modify `arr/test/+server.ts` | `assertSafeArrUrl` deny-list; call before `createArrClient` (line 41); sanitize error (line 53) | — (parallel w/ P0) |
| **T11** system status + test-connection | Modify `base.ts` (`getSystemStatus`); create `api/v1/setup/test-connection/+server.ts` | Reuse `system/status` GET; guarded + IP-rate-limited; `assertSafeArrUrl` → `getSystemStatus`; sanitized reason enum | T10, T4 |
| **T12** connect-arr step | Create `setup/connect-arr/+page.{svelte,server.ts}` | Embed `InstanceForm mode="create"`; call `test-connection`; advance on green; `arrInstancesQueries.create` | T11, T6 |
| **T13** link-database step | Create `setup/link-database/+page.{svelte,server.ts}` | Default `Praxrr-DB` vs custom disclosure; detect already-linked (`databaseInstancesQueries.getAll`); `pcdManager.link`; non-git graceful; git-URL-only (C4) | T6 |
| **T14** select-profiles step | Create `setup/select-profiles/+page.{svelte,server.ts}` | Mirror `qualityProfiles/list.ts:61-159` compat filter per `arr_type`; `arrSyncQueries.saveQualityProfilesSync` | T6 |
| **T15** preview-sync step | Create `setup/preview-sync/+page.{svelte,server.ts}` | Call `POST /api/v1/sync/preview` (#7) + existing apply; deep-link `/arr/[id]/sync` per D1; terminal → `markWizardCompleted()` | T11, T12, T14 |
| **T16** tests | Create `tests/setup-wizard/*`; modify `scripts/test.ts` alias | Extend `BaseTest.ts`; progress/transitions/gate-matrix(on/local/off/oidc)/`assertSafeArrUrl`/compat/no-CORS; one Playwright happy-path | T5, T8, T11, T14 |

**Batching / critical path:**
- Batch A (parallel): T1, T10.
- Batch B: T2, T3 (after T1).
- Batch C (parallel after T3): T4, T6, T8.
- Batch D (parallel): T5 (after T4), T7 (after T6), T11 (after T10+T4).
- Batch E (parallel after T6/T11): T12, T13, T14.
- Batch F: T15 (after T11+T12+T14), T9 (after T8+T11), T16 (after gating + steps).
- Critical path: **T1 → T3 → T4 → T11 → T12/T14 → T15**. P2 (T13) and P3 (T14) parallelize once P0 (T1–T8) lands.

---

## Open verification flags for the synthesizer

1. **W6 gate placement** — the single-gate assumption in the draft is wrong; the wizard gate must be
   applied in **both** the `skipAuth` branch (line 223) and the authenticated tail (line 258) or
   `AUTH=off`/`AUTH=local+LAN` installs never see the wizard. Captured in T4/T5.
2. **setupState is raw SQL, not Kysely** — advisory A3 ("keep new queries on Kysely builder") does not
   apply to this file; mirror the existing raw-SQL singleton style.
3. **`parseOptionalAbsoluteHttpUrl` is not an SSRF guard** — it validates scheme only, no host; a new
   `assertSafeArrUrl` is genuinely required (do not assume the existing util covers C3).
4. **Migration numbering is mixed** (`NNN` legacy up to 050, then `YYYYMMDD`); next version is the
   date-form `20260707`. Runner sorts by numeric `version`, so `20260707 > 050` holds.
