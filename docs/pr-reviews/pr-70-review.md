# PR #70 Review: feat(pull): implement pull-on-startup Arr sync selection recovery

**Branch:** `feat/pull-on-startup` -> `dev` **Scope:** 71 files, +11,476 / -1,121 lines **Review
Date:** 2026-02-21 **Reviewed By:** 5 specialized agents (code-reviewer, silent-failure-hunter,
pr-test-analyzer, type-design-analyzer, comment-analyzer)

---

## Critical Issues

### C1. Startup pull run results never persisted to DB -- API always returns 404

- **Status:** [x] Fixed
- **Files:** `orchestrator.ts`, `arrPullStartup.ts`
- **Agents:** code-reviewer, silent-failure-hunter

The migration creates `startup_pull_runs` and `startup_pull_instance_outcomes` tables. The query
module defines `insertRun()`/`insertInstanceOutcome()`. The API endpoint queries these tables.
However, neither the orchestrator nor the job handler ever calls the insert methods. The
orchestrator builds a `StartupPullRunSummary` in memory and the job handler serializes it to job run
history, but the dedicated startup pull tables remain permanently empty.

**Impact:** `GET /api/v1/system/startup-pull/latest` always returns 404. The observability surface
is broken.

**Fix:** After `buildRunSummary()` in `orchestrator.ts` (or in the job handler), persist the summary
and per-instance outcomes by calling `startupPullQueries.insertRun()` and
`startupPullQueries.insertInstanceOutcome()`.

**Resolution:** Added persistence calls in `arrPullStartup.ts` after `runStartupPull()` returns.
Calls `startupPullQueries.insertRun()` and iterates instances to call
`startupPullQueries.insertInstanceOutcome()`. Wrapped in try/catch so persistence failures don't
affect the job's success/failure status. Field mapping converts snake_case summary fields to
camelCase DB inputs.

---

### C2. All instance processing errors downgraded to `warn`, stack traces lost

- **Status:** [x] Fixed
- **Files:** `orchestrator.ts:124-131`
- **Agent:** silent-failure-hunter

In `processInstance`, the catch block logs at `logger.warn` and returns a failure result.
Programming errors (type errors, null dereferences) are indistinguishable from expected failures
(network timeouts, auth failures). Stack traces are not included in logged metadata.

**Fix:** Use `logger.error` for unexpected errors, include stack traces in metadata. Consider
distinguishing expected failures (HttpError) from unexpected ones.

**Resolution:** Changed `logger.warn` to `logger.error` in `orchestrator.ts`. Added
`stack: error instanceof Error ? error.stack : undefined` to error meta in both `orchestrator.ts`
and `arrPullStartup.ts` catch blocks.

---

### C3. Non-null assertions on potentially problematic values in `applySelections.ts`

- **Status:** [x] Fixed (combined with H4)
- **Files:** `applySelections.ts:55,87,113,165`
- **Agents:** silent-failure-hunter, type-design-analyzer

`matchedEntityName!` assertions are used after filtering for `status === 'matched'`, but the flat
`StartupPullMatchResult` type doesn't carry this guarantee. Empty strings would also pass the
`!= null` filter and be written to sync config tables.

**Fix:** Add an `assertMatchedEntityName` helper that validates non-null and non-empty, or convert
`StartupPullMatchResult` to a discriminated union (see H4).

**Resolution:** Converted `StartupPullMatchResult` to a discriminated union on `status` (see H4).
`getMatchedBySection` now uses a type guard (`m is StartupPullMatchedResult`) so all 6 `!` non-null
assertions in `applySelections.ts` were removed. TypeScript infers `matchedEntityName: string` from
the narrowed type.

---

## High Priority Issues

### H1. Error classification discards stack traces; programming errors misclassified

- **Status:** [x] Fixed
- **Files:** `handlers/radarr.ts`, `handlers/sonarr.ts`, `handlers/lidarr.ts` (catch blocks in
  `collectRemoteSectionSnapshots`)
- **Agent:** silent-failure-hunter

Each adapter's `classifyXxxFetchError` catches all errors and classifies non-HttpError throws as
`kind: 'unknown'`. A `TypeError` from a programming bug gets the same treatment as a network
failure. Stack traces are discarded.

**Fix:** Log the full error with stack trace at the catch site before classifying. Distinguish
programming errors from network errors.

**Resolution:** Added `logger.errorWithTrace(...)` in the `collectRemoteSectionSnapshots` catch
blocks for Radarr, Sonarr, and Lidarr to preserve stack traces in logs. Updated each
`classifyXxxFetchError` to route non-HTTP `Error` values through a network-vs-programming
classification helper (`isLikelyNetworkError`) so programming defects are no longer treated as
transport failures.

---

### H2. Fallback `databaseId` produces invalid value on empty input

- **Status:** [ ] Open
- **Files:** `handlers/radarr.ts:472`, `handlers/sonarr.ts:456`, `handlers/lidarr.ts:474`
- **Agent:** silent-failure-hunter

```typescript
const fallbackDatabaseId = input.databaseIds[0] ?? 0;
```

If `databaseIds` is empty, `fallbackDatabaseId` becomes `0` (invalid). The orchestrator guards
against this, but adapters don't.

**Fix:** Assert non-empty at adapter entry:

```typescript
if (input.databaseIds.length === 0) {
  throw new Error('Cannot match startup resources with no database IDs');
}
```

---

### H3. Lidarr client force-cast through `unknown` bypasses compile-time safety

- **Status:** [ ] Open
- **Files:** `handlers/lidarr.ts:309`
- **Agents:** silent-failure-hunter, type-design-analyzer

```typescript
const lidarrClient = client as unknown as LidarrStartupClient;
```

If `BaseArrClient` is refactored and `getMetadataProfiles()` changes, no compile error occurs. The
runtime error would be caught and misclassified as a network failure.

**Fix:** Have `LidarrStartupClient` extend `BaseArrClient`, or add a runtime check for
`getMetadataProfiles` before calling it.

---

### H4. `StartupPullMatchResult` should be a discriminated union

- **Status:** [x] Fixed (combined with C3)
- **Files:** `types.ts:57-69`
- **Agent:** type-design-analyzer

The flat interface with optional fields forces ~12 manual construction sites and non-null assertions
downstream. The `status` field is a natural discriminant.

**Fix:** Define `StartupPullMatchedResult`, `StartupPullConflictedResult`,
`StartupPullNoMatchResult` with a shared base, then union them. Add factory functions as the only
construction path.

**Resolution:** Split into `StartupPullMatchedResult` (status: `'matched'`, required entity fields)
and `StartupPullUnmatchedResult` (status: `'no_match' | 'conflicted'`, no entity fields). Updated
all ~12 construction sites across `matching.ts`, `profileMatching.ts`, `mediaManagement.ts`, and 4
handler files. Narrowed `makeStartupMatchNoMatchResult` return type to `StartupPullUnmatchedResult`.
Simplified redundant null checks in 7 files. Updated test fixtures to construct correct union
variant.

---

### H5. `snake_case` counter fields in TypeScript interfaces

- **Status:** [ ] Open
- **Files:** `queueTypes.ts:37-58`
- **Agent:** type-design-analyzer

`skipped_default`, `skipped_no_match` break the codebase's camelCase convention. The DB query record
types already use `skippedDefault`.

**Fix:** Rename to camelCase (`skippedDefault`, `skippedNoMatch`). Update all references.

---

## Medium Priority Issues

### M1. Significant code duplication across Arr handlers

- **Status:** [ ] Open
- **Files:** `handlers/radarr.ts`, `handlers/sonarr.ts`, `handlers/lidarr.ts`
- **Agents:** code-reviewer, comment-analyzer

These functions are copied identically across all three files:

- `classifyXxxFetchError()` (only error message prefix differs)
- `getDelayProfileName()` (3 identical copies)
- `sortStartupCandidates()` (3 identical copies)
- `incrementCountersFromMatchResult()` (3 identical copies)
- `buildUnsupportedSectionResult()` (only `arrType` literal differs)

**Fix:** Move to `handlers/shared.ts`. Create a generic
`classifyStartupFetchError(arrLabel: string, error: unknown)` parameterized by Arr name.

---

### M2. `matchRadarrStartupResources`/`matchSonarrStartupResources` declared `async` with no `await`

- **Status:** [ ] Open
- **Files:** `handlers/radarr.ts:~463`, `handlers/sonarr.ts:~392`, `handlers/lidarr.ts:~435`
- **Agent:** code-reviewer

Unnecessary `async` wraps return values in `Promise` with no benefit.

**Fix:** Remove `async` keyword and `Promise` wrapper from return types.

---

### M3. Lidarr `metadataProfiles` section missing `continue` statement

- **Status:** [ ] Open
- **Files:** `handlers/lidarr.ts:577-594`
- **Agent:** silent-failure-hunter

Every other section handler ends with `continue;`. The last section (`metadataProfiles`) omits it.
Currently harmless since it's last, but adding a new section would cause fall-through.

**Fix:** Add `continue;` after the `metadataProfiles` block.

---

### M4. DB `status` field cast without validation

- **Status:** [ ] Open
- **Files:** `db/queries/startupPull.ts:127`
- **Agents:** silent-failure-hunter, type-design-analyzer

`row.status as JobRunStatus` bypasses runtime validation. Also, `StartupPullRunRecord.status` is
typed as `string` instead of `StartupPullRunStatus`, and
`InsertStartupPullInstanceOutcomeInput.arrType` is `string` instead of `ArrAppType`.

**Fix:** Add runtime validation for status. Type `status` fields as
`StartupPullRunStatus`/`JobRunStatus`. Type `arrType` as `ArrAppType`.

---

### M5. API endpoint exposes raw error messages

- **Status:** [ ] Open
- **Files:** `routes/api/v1/system/startup-pull/latest/+server.ts:50-57`
- **Agent:** silent-failure-hunter

The catch block returns `error.message` directly to the client, potentially leaking SQLite
internals.

**Fix:** Return a generic user-facing message for unexpected errors. Log the full error with stack
trace for debugging.

---

### M6. `matchStartupEntityBatch` fabricates fallback values for empty requests

- **Status:** [ ] Open
- **Files:** `matching.ts:163-166`
- **Agent:** silent-failure-hunter

Falls back to `'qualityProfiles'` and `'radarr'` when `requests` is empty. Should throw instead.

**Fix:**
`if (requests.length === 0) throw new Error('matchStartupEntityBatch called with empty requests');`

---

### M7. Migration SQL comment accuracy concern

- **Status:** [ ] Open (needs verification)
- **Files:** `db/migrations/20260224_normalize_naming_character_replacement_defaults.ts:33-34`
- **Agent:** comment-analyzer

The Lidarr naming migration's `WHERE` clause includes `'sonarr'` in
`lower(name) IN ('default', 'lidarr', 'sonarr')`. Either needs a comment explaining this cross-Arr
name (legacy onboarding seeded Lidarr rows from Sonarr templates) or it's a bug.

**Fix:** Verify intent. If intentional, add a comment explaining why. If a bug, remove `'sonarr'`
from the predicate.

---

### M8. Mixed indentation in `types.ts`

- **Status:** [ ] Open
- **Files:** `pull/startup/types.ts:48-55`
- **Agent:** code-reviewer

Lines 1-46 use 2-space indentation; lines 48-55 use tabs.

**Fix:** Run `deno task format` on this file.

---

### M9. Silent PCD cache skip in candidate collection

- **Status:** [ ] Open
- **Files:** `handlers/radarr.ts:417-419`, `handlers/sonarr.ts:391`, `handlers/lidarr.ts:419`
- **Agent:** silent-failure-hunter

When a database has no PCD cache, candidate collection silently skips with no log. Users see "no
match" with no explanation.

**Fix:** Log a warning when cache is missing:

```typescript
if (!cache) {
    await logger.warn(`PCD cache not available for database ${databaseId}, skipping`, { ... });
    continue;
}
```

---

### M10. `StartupPullArrType` imported as value instead of type

- **Status:** [ ] Open
- **Files:** `handlers/radarr.ts:15`, `mediaManagement.ts:22`, `handlers/lidarr.ts:34`,
  `profileMatching.ts:7`
- **Agent:** code-reviewer

`StartupPullArrType` is a type alias imported without the `type` keyword while sibling imports use
`type`.

**Fix:** Add `type` keyword: `type StartupPullArrType,`

---

## Test Coverage Gaps

### T1. API endpoint has zero tests (Criticality: 8/10)

- **Status:** [ ] Open
- **Files:** `routes/api/v1/system/startup-pull/latest/+server.ts`

The GET handler's three code paths (200, 404, 500) are completely untested.

**Tests needed:**

- Returns 404 with `{ error: "No startup pull runs found" }` when no runs exist
- Returns 200 with all expected JSON fields properly mapped when a run exists
- Returns 500 with error message when query layer throws

---

### T2. Sync processor startup pull guard untested (Criticality: 8/10)

- **Status:** [ ] Open
- **Files:** `sync/processor.ts:39-50,393-403`

`markInstanceStartupPullActive`/`markInstanceStartupPullComplete` and the `triggerSyncs` guard have
no direct tests.

**Tests needed:**

- `markInstanceStartupPullActive` adds instance ID to active set
- `markInstanceStartupPullComplete` removes it
- `triggerSyncs` skips instances in active set
- Cleanup called even when processing throws (finally guarantee)

---

### T3. Per-Arr adapter handlers lack isolated unit tests (Criticality: 7/10)

- **Status:** [ ] Open
- **Files:** `handlers/radarr.ts`, `handlers/sonarr.ts`, `handlers/lidarr.ts`,
  `handlers/lidarrMetadata.ts`

~600 lines per handler with error classification, section gating, and counter incrementing are only
tested indirectly.

**Tests needed:**

- `classifyXxxFetchError` maps HttpError status codes correctly
- `matchXxxStartupResources` produces correct counter increments
- Lidarr uniquely handles `metadataProfiles`
- Adapter refuses non-matching arr_type via `assertStartupArrType`

---

### T4. Fingerprint cross-format equivalence tests incomplete (Criticality: 6/10)

- **Status:** [ ] Open
- **Files:** `mediaManagement.ts`

Only delay profile and Sonarr naming fingerprints are tested. Missing: Radarr/Lidarr naming, media
settings, quality definitions.

**Tests needed:**

- `normalizeNamingTemplate` edge cases (mixed-case, special characters)
- Radarr/Lidarr naming fingerprint equivalence
- Media settings fingerprint equivalence
- Quality definitions fingerprint equivalence

---

### T5. DB queries (`startupPull.ts`) have no tests (Criticality: 5/10)

- **Status:** [ ] Open
- **Files:** `db/queries/startupPull.ts`

273 lines of SQL-backed queries with field-mapping logic are untested. `runRowToRecord` and
`outcomeRowToRecord` contain field name translations where typos would cause silent data loss.

---

### T6. Orchestrator timeout and batch concurrency untested (Criticality: 5/10)

- **Status:** [ ] Open
- **Files:** `orchestrator.ts`

`withTimeout` and `processBatches` have no direct tests.

**Tests needed:**

- `withTimeout` rejects after specified ms
- `withTimeout` resolves normally when promise completes before timeout
- `processBatches` respects concurrency limit

---

## Comment Improvements

### D1. Add module-level doc comments to key files

- **Status:** [ ] Open
- **Agent:** comment-analyzer

Files with zero comments that need module-level or function-level documentation:

| File                         | Suggested Comment                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `matching.ts`                | Two-phase match strategy: exact name first, fingerprint fallback. Multiple matches produce 'conflicted'.         |
| `fingerprints.ts`            | Deterministic metadata fingerprinting: normalization pipeline (scalar -> recursive structure -> canonical JSON). |
| `profileMatching.ts:113-128` | Why Radarr/Sonarr use `id === 1` for default delay profile vs Lidarr's field-based heuristic.                    |
| `profileMatching.ts:130-184` | Namespace suffix stripping for managed profile matching.                                                         |
| `mediaManagement.ts:136-137` | `NAMING_TOKEN_REGEX` purpose and character class rationale.                                                      |
| `mediaManagement.ts:88-98`   | `PROPER_REPACKS_TO_ARR`/`FROM_ARR` asymmetric naming bridge.                                                     |
| `orchestrator.ts:29`         | `DEFAULT_CONCURRENCY = 2` rationale.                                                                             |
| `handlers/radarr.ts:164-171` | `getDelayProfileName` cast pattern (ArrDelayProfile omits `name` but some versions include it).                  |
| `handlers/lidarr.ts:309`     | Double-cast to `LidarrStartupClient` rationale.                                                                  |

---

### D2. Remove redundant section banners and obvious JSDoc

- **Status:** [ ] Open
- **Files:** `db/queries/startupPull.ts`

Section banners (`// ========== Row Types ==========`) and JSDoc that restates function names
(`/** Insert a startup pull run record */`) add noise without value.

---

### D3. Add duplication rationale comment to handlers

- **Status:** [ ] Open
- **Files:** `handlers/shared.ts` or each handler

Add a note explaining whether the handler duplication is intentional per Cross-Arr policy or is a
candidate for shared extraction.

---

## Strengths

- Zero `any` types across all new code
- Proper Cross-Arr isolation with `assertStartupArrType` guards
- 143 tests with shared fixtures and per-Arr-type iteration
- Clean module architecture (types, matching, fingerprinting, default filtering, profile matching,
  apply-selections)
- Good discriminated unions in `defaultCatalogs.ts` and per-handler fetch results
- Idempotent writes via `selectionsEqual` comparison
- Belt-and-suspenders gating (env var checked in both hooks and job handler)
- 1,144-line fixture library with scenario builders
- Naming normalization migration registered in both migrations list and `seedBuiltInBaseOps.ts`
- Conventional commit format throughout

---

## Suggested Fix Order

1. ~~**C1** -- Wire run persistence (blocks API functionality)~~ **DONE**
2. ~~**C2** -- Fix error logging severity and add stack traces~~ **DONE**
3. ~~**C3 + H4** -- Convert `StartupPullMatchResult` to discriminated union (eliminates non-null
   assertions)~~ **DONE**
4. ~~**H1** -- Log stack traces in startup snapshot collection and distinguish programming errors
   from network failures~~ **DONE**
5. **M7** -- Verify migration SQL intent (data-touching)
6. **M1** -- Extract shared handler utilities
7. **H2** -- Add databaseId assertion in adapters
8. **M5** -- Sanitize API error responses
9. **H5** -- Normalize counter field naming to camelCase
10. **M4** -- Add DB status validation
11. **M8 + M10** -- Formatting and import cleanup
12. **T1 + T2** -- Add critical missing tests
13. **D1** -- Add key comments
