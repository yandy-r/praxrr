# PR #112 Review: feat(naming): derive create-mode defaults from PCD seed data

**PR:** [#112](https://github.com/yandy-r/praxrr/pull/112) **Branch:** `feat/naming-forms-from-pcd`
-> `main` **Date:** 2026-02-25 **Reviewers:** code-reviewer, silent-failure-hunter, pr-test-analyzer,
code-simplifier

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

**Resolved in code:** `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts`
imports `Selectable` plus `RadarrNamingTable`, `SonarrNamingTable`, and `LidarrNamingTable`, and
updates all three row mappers to use strongly-typed inputs.

### C-2. `getDefaults` queries have no error handling; a corrupted/locked cache DB crashes the load function

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts:120-214`
- **Caller:** `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts:33-38`
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

**Resolved in code:** `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.server.ts`
introduces a typed `safeGetDefaults(cache, fn, label)` wrapper with per-type logging and returns `null`
on failures so broken/default resolution for one app does not prevent the create form from loading.

---

## Important Issues (6 found) -- Should fix

### I-1. Three near-identical `get*Defaults` functions (~90 lines of duplication)

- **Source:** code-reviewer, code-simplifier
- **File:** `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/read.ts:120-214`
- **Status:** [ ] Open

`getRadarrDefaults`, `getSonarrDefaults`, `getLidarrDefaults` are structurally identical, differing
only in table name, arr type fallback string, and mapper function. Each issues up to 3 sequential
queries. A single parameterized helper or a `CASE WHEN` ordering query would eliminate ~60 lines of
duplication and reduce the query count from 3 to 1.

**Option A -- Single-query with `CASE WHEN` ordering:**

```typescript
async function getDefaultRow<T>(
  cache: PCDCache,
  table: string,
  arrType: string,
  mapper: (row: Record<string, unknown>) => T
): Promise<T | null> {
  const row = await cache.kb
    .selectFrom(table)
    .selectAll()
    .orderBy(
      sql`CASE WHEN lower(name) = 'default' THEN 0
      WHEN lower(name) = ${arrType} THEN 1 ELSE 2 END`
    )
    .orderBy('created_at', 'asc')
    .orderBy('name', 'asc')
    .executeTakeFirst();
  return row ? mapper(row) : null;
}
```

**Option B -- Keep 3 queries but extract shared helper (avoids Kysely generic constraints):**

```typescript
async function getDefaults<T>(
  cache: PCDCache,
  table: string,
  arrType: string,
  mapper: (row: any) => T
): Promise<T | null> {
  const base = () =>
    cache.kb
      .selectFrom(table)
      .selectAll()
      .orderBy('created_at', 'asc')
      .orderBy('name', 'asc');

  const defaultRow = await base()
    .where(sql`lower(name)`, '=', 'default')
    .executeTakeFirst();
  if (defaultRow) return mapper(defaultRow);

  const fallbackRow = await base()
    .where(sql`lower(name)`, '=', arrType)
    .executeTakeFirst();
  if (fallbackRow) return mapper(fallbackRow);

  const row = await base().executeTakeFirst();
  return row ? mapper(row) : null;
}
```

### I-2. Warning block duplicated 3x in `+page.svelte`

- **Source:** code-reviewer, code-simplifier
- **File:** `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte:73-165`
- **Status:** [ ] Open

The amber warning block (AlertTriangle icon, message, database link) is copy-pasted identically
three times for radarr, lidarr, and sonarr. The only varying data is `{selectedLabel}`, which is
already a reactive variable.

**Fix:** Extract into a Svelte `{#snippet}` (Svelte 5 template feature, not a rune) or a separate
`NamingDefaultsWarning.svelte` component with a `label` prop. This would replace ~45 lines of
duplicated markup with a single definition and three `{@render}` calls.

### I-3. `selectedLabel` defaults to `'Lidarr'` when `selectedArrType` is null

- **Source:** code-reviewer, silent-failure-hunter
- **File:** `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/new/+page.svelte:38-39`
- **Status:** [ ] Open

```typescript
$: selectedLabel =
  selectedArrType === 'radarr'
    ? 'Radarr'
    : selectedArrType === 'sonarr'
      ? 'Sonarr'
      : 'Lidarr';
```

When `selectedArrType` is `null` (initial state), `selectedLabel` evaluates to `'Lidarr'`. While the
current template structure prevents this from rendering (the null branch shows the selection grid),
it is fragile and semantically incorrect.

**Fix:** Add explicit null/lidarr handling:

```typescript
$: selectedLabel =
  selectedArrType === 'radarr'
    ? 'Radarr'
    : selectedArrType === 'sonarr'
      ? 'Sonarr'
      : selectedArrType === 'lidarr'
        ? 'Lidarr'
        : '';
```

Or use a lookup map from the existing `arrTypeOptions` array:

```typescript
$: selectedLabel =
  arrTypeOptions.find((o) => o.value === selectedArrType)?.label ?? '';
```

### I-4. Unguarded `arrSyncQueries.updateNamingConfigName()` call in edit route handlers

- **Source:** silent-failure-hunter
- **Files:**
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts:128-133`
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/sonarr/[name]/+page.server.ts:146-151`
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/lidarr/[name]/+page.server.ts:149-154`
- **Status:** [ ] Open

After a successful naming config update, `arrSyncQueries.updateNamingConfigName()` is called without
try/catch. If this throws (DB error, `validateRenameNames` failure), the user sees a 500 even though
the primary PCD rename succeeded. The PCD state and sync config become inconsistent -- the naming
config is renamed but sync references still point at the old name.

**Fix:** Wrap in try/catch. Log the error. Allow the redirect to proceed since the primary operation
succeeded, but surface the sync propagation failure via alert or logger.

### I-5. Delete actions lack try/catch around `remove*Naming` calls

- **Source:** silent-failure-hunter
- **Files:**
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts:168-173`
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/sonarr/[name]/+page.server.ts:186-191`
  - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/lidarr/[name]/+page.server.ts:189-194`
- **Status:** [ ] Open

The `delete` action handlers call `remove*Naming` without try/catch, while the `create` and `update`
actions in the same files DO have try/catch blocks. If `writeOperation` throws (SQL compilation
failure, DB lock, cache recompilation error), the user sees a generic 500 error instead of an
actionable form error.

**Fix:** Wrap the `remove*Naming` call in try/catch matching the pattern used in create/update
actions.

### I-6. `DatabaseWithCache` type defined independently in two files

- **Source:** code-simplifier
- **Files:**
  - `packages/praxrr-app/src/routes/databases/views/CardView.svelte:11`
  - `packages/praxrr-app/src/routes/databases/views/TableView.svelte:12`
- **Status:** [ ] Open

Both files define `type DatabaseWithCache = DatabaseInstance & { cacheAvailable?: boolean }` and
CardView also uses the inline intersection at line 9. These could drift apart.

**Fix:** Define the type once in a shared location (e.g., `+page.server.ts` export or a
`databases/types.ts` file) and import from both views.

---

## Suggestions (3 found) -- Nice to have

### S-1. `colonReplacementFromDb` and `multiEpisodeStyleFromDb` silently fall back to defaults

- **Source:** silent-failure-hunter
- **File:** `packages/praxrr-app/src/lib/shared/pcd/mediaManagement.ts:37-38, 89-90`
- **Status:** [ ] Open (pre-existing, not introduced by this PR)

These conversion functions use `?? 'delete'` and `?? 'extend'` as fallbacks when the DB integer does
not map to a known enum member. This is the same class of silent fallback the PR is eliminating
elsewhere. If a newer PCD schema introduces unknown integer values, users silently get wrong settings.

**Fix (if addressed):** Throw on unknown values rather than silently defaulting.

### S-2. `OperationLayer` silent fallback to `'user'` with unchecked `as` cast

- **Source:** silent-failure-hunter
- **Files:** All action handlers (pre-existing pattern, not introduced by this PR)
- **Status:** [ ] Open

`const layer = (formData.get('layer') as OperationLayer) || 'user'` bypasses type checking. A
tampered request with `layer=admin` passes through unchecked.

**Fix (if addressed):** Validate the `layer` value explicitly, similar to `isSupportedNamingArrType`.

### S-3. `cacheAvailable` typed as optional but always set -- strict `=== false` check is fragile

- **Source:** silent-failure-hunter
- **Files:**
  - `packages/praxrr-app/src/routes/databases/views/CardView.svelte:102`
  - `packages/praxrr-app/src/routes/databases/views/TableView.svelte:84`
- **Status:** [ ] Open

The views check `{#if database.cacheAvailable === false}` but the type is `cacheAvailable?: boolean`.
If a code path ever returns a database object without `cacheAvailable` set, `undefined !== false`
means the badge silently won't show.

**Fix (if addressed):** Make `cacheAvailable` required (not optional) in the type, or change the
check to `{#if !database.cacheAvailable}`.

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

2. **Silent fallback elimination.** Converting `|| 'smart'` and `|| 'extend'` to `fail(400)`
   aligns with the CLAUDE.md principle of throwing errors early and failing fast.

3. **Graceful degradation design.** The amber warning banner when defaults are unavailable, combined
   with the `cacheAvailable` badge on the databases page, provides clear user feedback.

4. **Deterministic ordering.** `created_at ASC, name ASC` ensures reproducible default row selection.

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
