# PR #146 Review: feat(pcd): add state snapshot system with pre-risk hooks and CRUD API

**Branch:** `feat/pcd-state-snapshot` -> `main`
**Reviewed:** 2026-03-01
**Stats:** 45 files changed, 5208 additions, 424 deletions, 13 commits
**Tests:** All 763 pass

---

## Critical Issues (must fix before merge)

### 1. `trigger` is a SQLite reserved keyword used as unquoted column name

**Files:**

- `packages/praxrr-app/src/lib/server/db/migrations/20260228_create_pcd_snapshots.ts:16`
- `packages/praxrr-app/src/lib/server/db/queries/pcdSnapshots.ts:50`
- `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts:180`

`trigger` is a SQLite reserved keyword. While SQLite is permissive and tests pass, certain query patterns (JOIN...ON, expression contexts) could produce confusing parse errors. The column name appears unquoted in migration DDL, INSERT/SELECT queries, and WHERE clauses.

**Fix:** Rename column to `trigger_type` or `snapshot_trigger`. Project is pre-production per CLAUDE.md, so breaking changes are acceptable. Alternatively, quote with double-quotes (`"trigger"`) in all SQL.
**Status:** Fixed (2026-03-01). Kept `trigger` and fixed all SQL usage by quoting it (`"trigger"`) in migration DDL, snapshot INSERT, and deduplication query.

### 2. `trigger` column is nullable in migration but non-nullable in TypeScript

**Files:**

- `packages/praxrr-app/src/lib/server/db/migrations/20260228_create_pcd_snapshots.ts:16` -- `TEXT CHECK(...)` without `NOT NULL`
- `packages/praxrr-app/src/lib/server/pcd/snapshots/types.ts` -- `PcdSnapshotRow.trigger: SnapshotTrigger` (non-nullable)

The DB schema technically allows NULL for trigger, but the TypeScript type lies about it. Every code path provides a trigger value today, but this is a latent type-safety hole.

**Fix:** Add `NOT NULL` to the trigger column in the migration (preferred), or change `PcdSnapshotRow.trigger` to `SnapshotTrigger | null`.
**Status:** Fixed (2026-03-01). Added `NOT NULL` on `pcd_snapshots.trigger` in migration.

### 3. API route catch blocks return 500 with zero server-side logging

**Files:**

- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/+server.ts:103-106,163-166`
- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/+server.ts:94-97,133-136`

All four API catch blocks return HTTP 500 with raw `err.message` exposed to clients but no `logger.error` call. Programming bugs (TypeError, ReferenceError), DB failures, and schema errors are invisible to operators.

**Fix:** Add `logger.error` in all catch blocks. Use a generic message for the client response; do not expose raw error messages.
**Status:** Fixed (2026-03-01). Added `logger.error` calls to all four snapshot route catch blocks and replaced raw client-facing error messages with generic responses.

### 4. Double-swallowed errors: redundant try/catch around a function that cannot throw

**Files:**

- `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts:218-286` (inner catch)
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:273-288` (outer catch -- dead code)
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:174-185,245-256` (outer catch -- dead code)

`createAutoSnapshot` already catches everything internally and returns `null`. The outer catch blocks in callers are dead code that will never execute. This confuses maintainers and fragments diagnostic context across two non-overlapping catch blocks.

**Fix:** Remove the outer try/catch in `arrSync.ts` and `manager.ts` since `createAutoSnapshot` guarantees null-on-failure. If caller context is needed in logs, pass it via the input type.
**Status:** Fixed (2026-03-01). Removed snapshot-specific outer `try/catch` blocks around `createAutoSnapshot` in both `arrSync.ts` and `pcd/core/manager.ts`.

### 5. Pre-pull snapshot errors logged as `warn` with no stack trace

**Files:**

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:180-185,251-256`

Both catch blocks use `logger.warn` with `String(snapshotError)`, discarding the stack trace entirely. Failing to create a safety checkpoint before a destructive pull is an error-level condition, not a warning. `String()` coercion produces `[object Object]` for many error types.

**Fix:** Use `logger.error`. Include `error.message` and `error.stack` when the error is an `Error` instance.
**Status:** Fixed (2026-03-01). Pre-pull snapshot catch wrappers were removed in `manager.ts`; snapshot creation failures now log from `snapshotService` as `logger.error` with `error.message` and stack metadata.

---

## Important Issues (should fix)

### 6. `JSON.parse` of `target_instance_ids` has no error handling

**File:** `packages/praxrr-app/src/lib/server/db/queries/pcdSnapshots.ts:33`

`toDetail()` calls `JSON.parse(row.target_instance_ids)` without try/catch or type validation. Corrupted JSON would throw a SyntaxError that propagates differently depending on context -- swallowed in auto snapshots (but the snapshot is already persisted), or 500 in list/detail routes.

**Fix:** Wrap in try/catch with a safe default. Add `Array.isArray()` guard after parse.
**Status:** Open

### 7. Duplicated `isNotGitRepositoryError` function across two files

**Files:**

- `packages/praxrr-app/src/routes/api/databases/[id]/changes/+server.ts:9-12`
- `packages/praxrr-app/src/routes/api/databases/[id]/commits/+server.ts:6-9`

Identical function defined independently. Also uses fragile substring matching on English-language git error messages. Non-English git locales would bypass the check and produce 500 errors.

**Fix:** Extract to a shared utility in `$utils/git/`. Consider checking error class in addition to message string.
**Status:** Open

### 8. `collectSnapshotDatabaseIds` can throw errors masked as snapshot failures

**File:** `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts:180-211`

This function calls multiple query functions that can throw on schema drift or DB corruption. Those errors get caught by the outer snapshot try/catch and logged as "Pre-sync snapshot failed" -- completely masking what is actually a broken sync configuration.

**Fix:** Add defensive null checks within `collectSnapshotDatabaseIds` for each section's selections.
**Status:** Open

### 9. Pruning failures logged as `warn` instead of `error`

**File:** `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts:260-273`

Persistent pruning failures (SQLite lock contention, corruption, disk-full) cause auto snapshots to accumulate without bound. The `logger.warn` with `String(pruneError)` loses the stack trace and provides no alerting escalation.

**Fix:** Use `logger.error`. Include stack trace. Consider a health check for persistent pruning failures.
**Status:** Open

### 10. `parseCreatedAtUtc` silently returns NaN for unparseable timestamps

**File:** `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts:150-156`

If `created_at` is unparseable, `getTime()` returns `NaN`. The dedup comparison `NaN <= 60` evaluates to `false`, meaning deduplication always fails for corrupted timestamps, generating excessive snapshots.

**Fix:** Add `Number.isNaN()` check after parsing. Throw or log an error for unparseable values.
**Status:** Open

### 11. `isDuplicate` function parameter typed as `string` instead of `SnapshotTrigger`

**File:** `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts:166`

The `trigger` parameter is typed as `string` rather than `SnapshotTrigger` (or `Exclude<SnapshotTrigger, 'manual'>`). This is wider than necessary since only auto snapshots are deduplicated.

**Fix:** Narrow to `Exclude<SnapshotTrigger, 'manual'>`.
**Status:** Open

### 12. `computeStateHash` JSDoc omits that fingerprint includes row `id` (auto-increment PK)

**File:** `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts:62-71`

The JSDoc says "build a canonical record including deterministic fields" but does not mention that `pcd_ops.id` is included. The fingerprint is sensitive to row identity, not just logical content -- backup restores or compaction would break deduplication silently.

**Fix:** Update JSDoc to note PK inclusion and its implications. Also note that `state` is always `'published'` in this context.
**Status:** Open

### 13. `state_hash_v1` label in OpenAPI schema is not implemented

**File:** `docs/api/v1/schemas/pcd-snapshots.yaml:58`

The `cacheStateHash` description references `(state_hash_v1)` as a version label, but no such version constant exists in the code. This implies a versioning contract that does not exist.

**Fix:** Remove `(state_hash_v1)` label, or add a version constant in the code.
**Status:** Open

---

## Suggestions (nice to have)

### 14. `CreateSnapshotInput` at query layer is too permissive

**File:** `packages/praxrr-app/src/lib/server/db/queries/pcdSnapshots.ts:10-20`

Accepts any `SnapshotType` with any `SnapshotTrigger`. Nothing prevents `{ type: 'manual', trigger: 'pull' }` at the query layer.

**Suggestion:** Make it a discriminated union encoding the type-trigger cross-constraint.
**Status:** Open

### 15. No API route tests -- zero coverage for 308 lines of route code

**Files:**

- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/+server.ts` (170 lines)
- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/+server.ts` (138 lines)

Ownership enforcement, parameter validation, pagination, POST body parsing, and `opsWrittenSince` computation are untested. The project already has route-level test patterns (see `localPathGitFallbackRoutes.test.ts`).

### 16. Pre-risk hook integrations (pre-pull and pre-sync) are untested

**Files:**

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts` (pre-pull hook)
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` (pre-sync hook, `collectSnapshotDatabaseIds`)

No tests verify that `collectSnapshotDatabaseIds` correctly aggregates/deduplicates IDs, that snapshot failures don't abort sync/pull, or that remote-source snapshots are only taken when updates are available.

### 17. No test for auto snapshot error swallowing (non-blocking guarantee)

**File:** `packages/praxrr-app/src/tests/pcd/snapshots/service.test.ts`

No test verifies that `createAutoSnapshot` returns `null` without throwing when an internal error occurs. This is the core non-blocking contract.

### 18. `isRestorable` is hardcoded to `false` with no documentation

**Files:**

- `packages/praxrr-app/src/lib/server/pcd/snapshots/types.ts:92-100`
- `docs/api/v1/paths/pcd-snapshots.yaml:119-121`

The type and OpenAPI docs imply restore functionality exists. Neither documents that `isRestorable` is always `false` pending Issue #16.

**Suggestion:** Add a doc comment noting MVP limitation.
**Status:** Open

### 19. `opsWrittenSince` is an approximation, not an exact count

**Files:**

- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/+server.ts:78-82`
- `docs/api/v1/schemas/pcd-snapshots.yaml:79`

The computation is `currentMaxId - snapshot.opsSequenceMaxId` which is an ID-gap approximation. Op deletions cause overcounting; restores cause undercounting. The OpenAPI schema says "Number of ops written" implying exactness.

**Suggestion:** Update OpenAPI description to "Approximate number of ops written" or use `COUNT(*)` with `WHERE id > snapshot.opsSequenceMaxId`.
**Status:** Open

### 20. No description length limit on manual snapshots

**File:** `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/+server.ts`

The POST route trims whitespace but does not enforce a max length. A multi-megabyte description would be persisted without complaint.

**Suggestion:** Add a max length check (e.g., 500-1000 chars).
**Status:** Open

### 21. `listByDatabase` returns anonymous structural type instead of `PcdSnapshotListResponse`

**File:** `packages/praxrr-app/src/lib/server/db/queries/pcdSnapshots.ts`

The return type is structurally identical to `PcdSnapshotListResponse` but not referenced by name. If the response type gains a field, the query method won't fail to compile.

**Suggestion:** Use explicit `PcdSnapshotListResponse` return type.
**Status:** Open

### 22. `computeOpsMetadata` JSDoc is misleading about MAX(id) scope

**File:** `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts:114-117`

JSDoc says "max pcd_ops id" without clarifying this includes ALL states (not just published), while the counts are limited to published ops only.

**Suggestion:** Rewrite to "Returns the maximum pcd_ops row ID (across all states) and counts of published ops by origin."
**Status:** Open

### 23. Move `opsWrittenSince`/`isRestorable` computation to service layer

**File:** `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/[snapshotId]/+server.ts:72-78`

The "full detail" enrichment lives in the route handler, not the service. Internal consumers needing these values would have to duplicate the computation.

**Suggestion:** Add `getFullDetail(snapshotId, databaseId)` to the service.
**Status:** Open

### 24. Redundant section-separator comments

**File:** `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts`

Comments like `// Compute ops metadata` immediately before `computeOpsMetadata()` calls are "what" comments that mirror the function name. The function names are descriptive enough.

**Suggestion:** Remove or replace with "why" comments where needed.
**Status:** Open

---

## Strengths

- **Zero `any` types.** Strict typing throughout all layers. `Exclude<SnapshotTrigger, 'manual'>` on `CreateAutoSnapshotInput.trigger` is excellent compile-time business rule encoding.
- **Clean API design.** RESTful with proper status codes (201/204/404). Input validation is thorough with parameterized queries preventing SQL injection.
- **Contract-first.** OpenAPI spec, generated `v1.d.ts`, and hand-written types all agree on enum values and field shapes.
- **Well-separated auto vs manual behavior.** Auto snapshots use best-effort (catch-log-return-null); manual snapshots propagate errors. The `createManualSnapshot` correctly does NOT catch errors.
- **Proper transactional pruning.** `pruneAutoSnapshots` uses `beginTransaction`/`commit`/`rollback` correctly.
- **Local-path guardrails.** Changes/commits routes properly degrade for non-git sources with `gitUnavailable: true`. Directly addresses CLAUDE.md requirements.
- **`importBaseOps` fix is correct.** Removal of early `hasBaseEntityByStableIdentity` guard before repo-op-index check fixes the ordering that could orphan base ops.
- **Deduplication design is thoughtful.** UTC timestamp handling via `parseCreatedAtUtc`, configurable dedup window, deterministic fingerprinting.
- **Migration properly registered.** Correct import and array entry in `migrations.ts`.
- **Input types are well-separated.** `CreateAutoSnapshotInput` and `CreateManualSnapshotInput` expose only what callers need, hiding internal concerns.
- **Comprehensive test coverage for core service logic.** Deduplication, creation flow, manual vs auto differences, and timestamp parsing are well-tested with meaningful assertions.

---

## Recommended Action

1. Fix critical issues 1-5 (reserved keyword, nullable mismatch, no logging, dead code, error severity)
2. Address important issues 6-13 (error handling hardening, deduplication, types, docs)
3. Consider suggestions 14-24 for follow-up or pre-merge polish
4. Re-run `deno task test` and `deno task check` after fixes
