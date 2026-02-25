# PR #112 Review: feat(naming): derive create-mode defaults from PCD seed data

**PR:** [#112](https://github.com/yandy-r/praxrr/pull/112) **Branch:** `feat/naming-forms-from-pcd`
-> `main` **Date:** 2026-02-25 **Reviewers:** code-reviewer, silent-failure-hunter,
pr-test-analyzer, code-simplifier

## Summary

Derives naming form create-mode defaults from PCD seed data instead of hardcoded values. When
creating a new naming config, the form is pre-populated from the first row in the PCD cache for that
Arr type using a 3-tier fallback (name='default' -> name=arr_type -> oldest row). If PCD data is
unavailable, the form shows an explicit warning instead of silently rendering wrong defaults. Also
replaces `|| 'smart'` and `|| 'extend'` silent fallbacks with explicit `fail(400)` validation across
all create and edit route handlers.

**Scope:** 21 files changed, 512 additions, 301 deletions, 4 commits. Functional changes span ~14
files; remaining changes are formatting normalization.

**Closes:** #71

---

## Critical Issues (2 found) -- Must fix before merge

### C-1. Row mappers use `Record<string, any>` -- violates "NEVER use `any` type" rule

- **Source:** code-reviewer, code-simplifier
- **File:** `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts:55-103`
- **Status:** [x] Fixed

All three row mapper functions (`mapRadarrRow`, `mapSonarrRow`, `mapLidarrRow`) use
`Record<string, any>` with `// deno-lint-ignore no-explicit-any`. The CLAUDE.md global instructions
explicitly state: "NEVER use `any` type, use proper types. Look up types rather than guessing."

Kysely's `selectAll()` already returns properly typed rows. The project defines table types
(`RadarrNamingTable`, `SonarrNamingTable`, `LidarrNamingTable`) in `$shared/pcd/types.ts`, and
Kysely's `Selectable<T>` unwraps `Generated<T>` wrappers.

**Fix:** Import `Selectable` from `kysely` and type the row parameters properly:

```typescript
import type { Selectable } from 'kysely';

function mapRadarrRow(row: Selectable<RadarrNamingTable>): RadarrNamingRow { ... }
function mapSonarrRow(row: Selectable<SonarrNamingTable>): SonarrNamingRow { ... }
function mapLidarrRow(row: Selectable<LidarrNamingTable>): LidarrNamingRow { ... }
```

This also eliminates the `row.name!` non-null assertions since `name` is typed as `string` (not
`Generated<string>`) in the table types.

**Resolved in code:**
`packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts` imports
`Selectable` plus `RadarrNamingTable`, `SonarrNamingTable`, and `LidarrNamingTable`, and updates all
three row mappers to use strongly-typed inputs.

### C-2. `getDefaults` queries have no error handling; a corrupted/locked cache DB crashes the load function

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts:120-214`
- **Caller:**
  `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts:33-38`
- **Status:** [x] Fixed

The three `get*Defaults` functions perform up to 3 sequential Kysely queries each with no try/catch.
They are called inside `Promise.all` in the load function, which also has no try/catch. If the
SQLite cache is corrupted, the table doesn't exist (schema mismatch), or the `sql` template for
`lower(name)` produces an invalid query, the user sees a raw 500 error page instead of the designed
graceful degradation (amber warning banner).

**Fix:** Wrap each `getDefaults` call so a failure for one arr type does not block the others:

```typescript
if (cache) {
  const safeGetDefaults = async <T>(
    fn: (cache: PCDCache) => Promise<T | null>,
    label: string
  ): Promise<T | null> => {
    try {
      return await fn(cache);
    } catch (err) {
      await logger.error(`Failed to load ${label} naming defaults from cache`, {
        source: 'naming-new',
        meta: {
          databaseId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return null;
    }
  };

  [radarrDefaults, sonarrDefaults, lidarrDefaults] = await Promise.all([
    safeGetDefaults(getRadarrDefaults, 'radarr'),
    safeGetDefaults(getSonarrDefaults, 'sonarr'),
    safeGetDefaults(getLidarrDefaults, 'lidarr'),
  ]);
}
```

This preserves the existing UI contract: null defaults show the warning banner.

**Resolved in code:**
`packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts` introduces
a typed `safeGetDefaults(cache, fn, label)` wrapper with per-type logging and returns `null` on
failures so broken/default resolution for one app does not prevent the create form from loading.

---

## Important Issues (6 found) -- Should fix

### I-1. Three near-identical `get*Defaults` functions (~90 lines of duplication)

- **Source:** code-reviewer, code-simplifier
- **File:** `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts:120-214`
- **Status:** [x] Fixed

`getRadarrDefaults`, `getSonarrDefaults`, `getLidarrDefaults` are structurally identical, differing
only in table name, arr type fallback string, and mapper function. Each issues up to 3 sequential
queries. A single parameterized helper or a `CASE WHEN` ordering query would eliminate ~60 lines of
duplication and reduce the query count from 3 to 1.

**Resolved in code (2026-02-25):**

- Added shared helper `getDefaultNamingRow(cache, table, arrType)` in
  `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`.
- Helper now uses one query with deterministic priority ordering: `lower(name)='default'` ->
  `lower(name)=arrType` -> remaining rows by `created_at ASC, name ASC`.
- `getRadarrDefaults`, `getSonarrDefaults`, and `getLidarrDefaults` now delegate to the helper.

### I-2. Warning block duplicated 3x in `+page.svelte`

- **Source:** code-reviewer, code-simplifier
- **File:**
  `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte:73-165`
- **Status:** [x] Fixed

The amber warning block (AlertTriangle icon, message, database link) is copy-pasted identically
three times for radarr, lidarr, and sonarr. The only varying data is `{selectedLabel}`, which is
already a reactive variable.

**Resolved in code (2026-02-25):**

- Added local Svelte snippet `{#snippet missingDefaultsWarning(label)}` in
  `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte`.
- Replaced all three duplicated warning blocks with
  `{@render missingDefaultsWarning(selectedLabel)}`.
- Kept warning copy, icon, styles, and `/databases` link behavior unchanged.

### I-3. `selectedLabel` defaults to `'Lidarr'` when `selectedArrType` is null

- **Source:** code-reviewer, silent-failure-hunter
- **File:**
  `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte:38-39`
- **Status:** [x] Fixed

```typescript
$: selectedLabel =
  selectedArrType === 'radarr' ? 'Radarr' : selectedArrType === 'sonarr' ? 'Sonarr' : 'Lidarr';
```

When `selectedArrType` is `null` (initial state), `selectedLabel` evaluates to `'Lidarr'`. While the
current template structure prevents this from rendering (the null branch shows the selection grid),
it is fragile and semantically incorrect.

**Resolved in code (2026-02-25):** `selectedLabel` now resolves via lookup from `arrTypeOptions`
with a safe fallback:
`arrTypeOptions.find((option) => option.value === selectedArrType)?.label ?? ''`.

### I-4. Unguarded `arrSyncQueries.updateNamingConfigName()` call in edit route handlers

- **Source:** silent-failure-hunter
- **Files:**
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts:128-133`
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/sonarr/[name]/+page.server.ts:146-151`
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/lidarr/[name]/+page.server.ts:149-154`
- **Status:** [ ] Open
- **Status:** [x] Fixed

After a successful naming config update, `arrSyncQueries.updateNamingConfigName()` is called without
try/catch. If this throws (DB error, `validateRenameNames` failure), the user sees a 500 even though
the primary PCD rename succeeded. The PCD state and sync config become inconsistent -- the naming
config is renamed but sync references still point at the old name.

**Resolved in code (2026-02-25):** Wrapped all three update handlers in `try/catch` around
`arrSyncQueries.updateNamingConfigName(...)` and added `logger.error(...)` on failure. The action
now still redirects after the naming rename is persisted.

### I-5. Delete actions lack try/catch around `remove*Naming` calls

- **Source:** silent-failure-hunter
- **Files:**
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts:168-173`
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/sonarr/[name]/+page.server.ts:186-191`
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/lidarr/[name]/+page.server.ts:189-194`
- **Status:** [x] Fixed

The `delete` action handlers call `remove*Naming` without try/catch, while the `create` and `update`
actions in the same files DO have try/catch blocks. If `writeOperation` throws (SQL compilation
failure, DB lock, cache recompilation error), the user sees a generic 500 error instead of an
actionable form error.

**Resolved in code (2026-02-25):** Wrapped `remove*Naming` calls in all three delete handlers with
`try/catch`, added `logger.error(...)`, and return `fail(500)` on thrown removal errors.

### I-6. `DatabaseWithCache` type defined independently in two files

- **Source:** code-simplifier
- **Files:**
  - `packages/praxrr-app/src/routes/databases/views/CardView.svelte:11`
  - `packages/praxrr-app/src/routes/databases/views/TableView.svelte:12`
- **Status:** [x] Fixed

Both files define `type DatabaseWithCache = DatabaseInstance & { cacheAvailable?: boolean }` and
CardView also uses the inline intersection at line 9. These could drift apart.

**Resolved in code (2026-02-25):** Added shared `DatabaseWithCache` export to
`packages/praxrr-app/src/routes/databases/types.ts` and updated both views to import it.

---

## Suggestions (3 found) -- Nice to have

### S-1. `colonReplacementFromDb` and `multiEpisodeStyleFromDb` silently fall back to defaults

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/shared/pcd/mediaManagement.ts:37-38, 89-90`
- **Status:** [x] Fixed

These conversion functions use `?? 'delete'` and `?? 'extend'` as fallbacks when the DB integer does
not map to a known enum member. This is the same class of silent fallback the PR is eliminating
elsewhere. If a newer PCD schema introduces unknown integer values, users silently get wrong
settings.

**Resolved in code (2026-02-25):**

- `colonReplacementFromDb` and `multiEpisodeStyleFromDb` now throw explicit errors on unknown
  integer values instead of defaulting to `'delete'` or `'extend'`.

### S-2. `OperationLayer` silent fallback to `'user'` with unchecked `as` cast

- **Source:** silent-failure-hunter
- **Files:** All action handlers (pre-existing pattern, not introduced by this PR)
- **Status:** [x] Fixed

`const layer = (formData.get('layer') as OperationLayer) || 'user'` bypasses type checking. A
tampered request with `layer=admin` passes through unchecked.

**Resolved in code (2026-02-25):**

- Added `parseOperationLayer` to `pcd` shared exports and migrated action handlers across
  naming/media-management/custom-formats/quality-profiles/regular-expressions/delay-profiles to
  validate and reject invalid `layer` values with `fail(400)`.
- Updated API v1 PCD import endpoints (`api/v1/pcd/import`,
  `api/v1/pcd/[databaseId]/lidarr-metadata-profiles`,
  `api/v1/pcd/[databaseId]/lidarr-metadata-profiles/[id]`) to consume the same parser and remove
  unchecked casts.

### S-3. `cacheAvailable` typed as optional but always set -- strict `=== false` check is fragile

- **Source:** silent-failure-hunter
- **Files:**
  - `packages/praxrr-app/src/routes/databases/views/CardView.svelte:102`
  - `packages/praxrr-app/src/routes/databases/views/TableView.svelte:84`
- **Status:** [x] Fixed

The views check `{#if database.cacheAvailable === false}` but the type is
`cacheAvailable?: boolean`. If a code path ever returns a database object without `cacheAvailable`
set, `undefined !== false` means the badge silently won't show.

**Resolved in code (2026-02-25):**

- Made `cacheAvailable` required in `DatabaseWithCache` and changed both views to check
  `{#if !database.cacheAvailable}`.

---

## Test Coverage Gaps (5 found)

### T-1. 3-tier default resolution logic has zero test coverage (Criticality: 9/10)

The core feature -- `getRadarrDefaults`/`getSonarrDefaults`/`getLidarrDefaults` with their 3-tier
fallback chain -- has no tests. Specific scenarios needed (per arr type):

- Tier 1: returns row named 'default' (case-insensitive: 'Default', 'DEFAULT')
- Tier 2: falls through to arr_type name when no 'default' row exists
- Tier 3: falls through to oldest row when neither name matches
- Tier 4: returns null when table is empty
- Tiebreaker: deterministic ordering when two rows share `created_at`

### T-2. `fail(400)` validation for missing required fields not tested as negative cases (Criticality: 8/10)

The behavioral change from silent `|| 'smart'` fallback to `fail(400)` rejection has no negative
test. The existing test updates provide valid values to keep passing, but no test verifies the
omission path. Needed:

- Radarr create/edit without `colonReplacementFormat` -> `fail(400)`
- Sonarr create/edit without `colonReplacementFormat` -> `fail(400)`
- Sonarr create/edit without `multiEpisodeStyle` -> `fail(400)`
- Lidarr create/edit without `colonReplacementFormat` -> `fail(400)`

### T-3. Load function cache-unavailable path untested (Criticality: 6/10)

No test verifies the load function returns null defaults when `pcdManager.getCache()` returns
undefined.

### T-4. Deterministic ordering tiebreaker behavior untested (Criticality: 5/10)

The `orderBy('created_at', 'asc').orderBy('name', 'asc')` secondary sort was added per commit
`f4eea703` but has no test proving it works. Can be combined with T-1 tests.

### T-5. Existing test changes are reactive, not proactive

The 5 updated test payloads in `lidarrMediaManagement.test.ts` add `colonReplacementFormat: 'smart'`
to prevent breakage under the new required-field validation. This is correct but only covers the
happy path. The formatting-only changes in `managerImportOrchestration.test.ts` and
`importBaseOps.test.ts` add no coverage value.

---

## Strengths

1. **Correct architectural direction.** Replacing hardcoded defaults with PCD-derived data makes the
   config database the single source of truth for form pre-population.

2. **Silent fallback elimination.** Converting `|| 'smart'` and `|| 'extend'` to `fail(400)` aligns
   with the CLAUDE.md principle of throwing errors early and failing fast.

3. **Graceful degradation design.** The amber warning banner when defaults are unavailable, combined
   with the `cacheAvailable` badge on the databases page, provides clear user feedback.

4. **Deterministic ordering.** `created_at ASC, name ASC` ensures reproducible default row
   selection.

5. **Form component simplification.** Making `initialData` required (removing null checks and
   hardcoded defaults objects) enforces the contract that the parent must supply valid data.

6. **Parallel default loading.** Using `Promise.all` for the three default queries in the load
   function is the correct approach for independent async operations.

---

## Recommended Action

1. Fix C-1 and C-2 (critical: type safety, error handling)
2. Address I-1 through I-5 (DRY violations, unguarded calls)
3. Add tests for T-1 and T-2 at minimum (core feature + behavioral contract change)
4. Consider S-1 through S-3 as follow-up improvements

## Validation Results (2026-02-25)

- `deno task test packages/praxrr-app/src/tests/arr/namingDefaultsSelection.test.ts`: pass (15/15)
- `deno task test packages/praxrr-app/src/tests/arr/lidarrMediaManagement.test.ts`: pass (23/23)
- `deno task test packages/praxrr-app/src/tests/arr/lidarrFirstClassRouteAndSyncCutover.test.ts`:
  pass (5/5)
- `deno task test`: failed with 3 existing unrelated suite failures:
  - `packages/praxrr-app/src/tests/base/arrCredentialEncryption.test.ts`
  - `packages/praxrr-app/src/tests/pcd/migration/yamlFormatter.test.ts` (2 failing tests)
