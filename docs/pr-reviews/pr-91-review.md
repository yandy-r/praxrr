# PR #91 Review: feat(pcd): implement full pcd-data-migration plan (issues 79-90)

**Branch:** `feat/pcd-data-migration` -> `v2` **Feature start commit:** `986403f` **Review date:**
2026-02-23 **Scope:** Feature source code only (excludes docs/plans/, CI files) **Stats:** ~4,041
additions, ~312 deletions across 34 files

## Verification Status

- Type check (`deno task check`): **PASS** (0 errors, 0 warnings)
- Migration-specific tests (5/5): **PASS**
- Full test suite: 24 failures, all pre-existing on v2 base branch

---

## Summary

| Severity   | Count |
| ---------- | ----- |
| Critical   | 7     |
| High       | 11    |
| Medium     | 11    |
| Suggestion | 9     |

---

## Critical Issues

### C-1: `seedBuiltInBaseOpsWithOrchestration` swallows all errors silently

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:427-435`
- **Category:** Error handling
- **Agents:** error-handler

`seedBuiltInBaseOps` failures are caught and only logged. No error propagates, no result indicator
is returned. If seeding fails, cache compilation proceeds on incomplete data, and downstream sync
pushes that incomplete state to Arr instances with no user-visible indication.

```typescript
private async seedBuiltInBaseOpsWithOrchestration(databaseId: number, contextLabel = 'operation'): Promise<void> {
  try {
    await seedBuiltInBaseOps(databaseId);
  } catch (error) {
    await logger.error(`Failed to seed built-in base ops during ${contextLabel}`, {
      source: 'PCDManager',
      meta: { error: String(error), databaseId },
    });
    // ERROR: returns void -- caller has no idea seeding failed
  }
}
```

**Fix:** Propagate the error. If design intent is partial success, return a success/failure
indicator and require callers to check it.

### Validation result

- Updated `seedBuiltInBaseOpsWithOrchestration` to rethrow caught seeding failures after logging:
  - `packages/praxrr-app/src/lib/server/pcd/core/manager.ts` now throws the caught error instead of
    swallowing it, so link/sync/initialize paths can fail fast when built-in base ops seeding fails.

---

### C-2: `compileIfEnabled` returns fake zeroed stats on failure

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:438-487`
- **Category:** Error handling
- **Agents:** error-handler

When `failOnError` is `false` (default for `link` and `sync`), compilation failures return a
fabricated `CacheBuildStats` with all zeros. Callers cannot distinguish "empty database" from
"compilation crashed."

```typescript
return {
  schema: 0,
  base: 0,
  tweaks: 0,
  user: 0,
  timing: 0,
};
```

**Fix:** Return `CacheBuildStats | null` or add an `error` field. For `link` (user-initiated), throw
by default.

### Validation result

- Updated `compileIfEnabled` to default `failOnError` to `true`, so `link` and `sync` now fail fast
  on compilation errors and return the real error instead of fabricated zero stats.
  - `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:447-486`

---

### C-3: `importBaseOpsWithOrchestration` fallback catches ALL errors

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:407-424`
- **Category:** Error handling
- **Agents:** error-handler, code-reviewer

When `pcdMigrationAllowLegacyFallback` is `true`, the catch block intercepts **every** exception
(including OOM, disk I/O, permission, SQLite corruption) and retries with SQL-only mode. This
silently loses all migration entity data on ANY error.

**Fix:** Narrow the catch to migration-reader-specific errors only. Consider a typed
`MigrationReaderError` class. Default is `false` so this only fires when explicitly enabled, but the
blast radius when enabled is severe.

### Validation result

- Added a typed `MigrationReaderError` and switched import failure signaling to throw it when
  migration entity parsing yields issues, then updated orchestration to fallback only for that error
  when config allows it.
  - `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:39-74`
  - `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:403-420`

---

### C-4: Duplicate `hashContent` function risks hash divergence

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:235-241`
- **Category:** Code quality, portable contract fidelity
- **Agents:** code-reviewer

`importBaseOps.ts` has a private `hashContent()` that duplicates `buildContentHash()` from
`$db/queries/pcdOps.ts`. The writer correctly uses the shared function. If either implementation
changes, content hashes from import vs. writer paths will silently diverge, causing incorrect
"updated" vs. "unchanged" detection.

**Fix:** Delete the local `hashContent()` and import `buildContentHash` from
`$db/queries/pcdOps.ts`.

### Validation result

- Removed local `hashContent()` and now use shared `buildContentHash` from `pcdOps.ts` for both
  import and writer paths, preventing hash divergence risk.
  - `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:19`
  - `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:235-307`

---

### C-5: `extractEntityName` trims entity names, violating contract

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts:255-259`
- **Category:** Contract violation
- **Agents:** code-reviewer, error-handler

CLAUDE.md states: "Preserve exact config-name identifiers used for sync lookup keys; reject empty
values, but do not trim persisted names." The `trim()` call modifies entity names before they become
stable identity values, causing sync lookup key mismatches.

```typescript
function extractEntityName(portable: ReaderInputRecord): string | null {
  const nameValue = portable.name;
  if (typeof nameValue !== 'string') return null;
  return nameValue.trim(); // VIOLATION: trims the persisted name
}
```

Also: whitespace-only names like `"   "` produce `""` (empty string) which passes the null check but
creates entities with empty-string names.

**Fix:**

```typescript
function extractEntityName(portable: ReaderInputRecord): string | null {
  const nameValue = portable.name;
  if (typeof nameValue !== 'string') return null;
  if (nameValue.trim().length === 0) return null;
  return nameValue; // preserve original
}
```

### Validation result

- Kept persisted `portable.name` values intact while rejecting blank/whitespace-only names.
  - `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts:255-259`

---

### C-6: Incorrect Lidarr naming field mappings in export route (Cross-Arr violation)

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts:103-106`
- **Category:** Cross-Arr semantic validation, data corruption
- **Agents:** code-reviewer

`serializeLidarrNaming` maps Lidarr-specific columns into Sonarr-shaped portable fields with
semantically incorrect mappings:

```typescript
dailyEpisodeFormat: row.artist_name,       // artist_name is NOT a daily episode format
animeEpisodeFormat: row.multi_disc_track_format, // multi-disc is NOT anime episode format
seriesFolderFormat: row.artist_folder_format,     // duplicated into two fields
seasonFolderFormat: row.artist_folder_format,     // same value
multiEpisodeStyle: 'extend',                      // hardcoded, not from Lidarr data
```

An export/re-import cycle would corrupt the entity. Root cause: `PortableLidarrNaming` is aliased to
`PortableSonarrNaming` in `portable.ts:297`, violating the Cross-Arr policy.

**Fix:** Define a native `PortableLidarrNaming` type with Lidarr-correct field names.

### Validation result

- Introduced a native `PortableLidarrNaming` shape with Lidarr-native fields and removed
  `PortableSonarrNaming` aliasing.
  - `packages/praxrr-app/src/lib/shared/pcd/portable.ts:297`
- Updated validation logic to use the Lidarr-specific portable schema.
  - `packages/praxrr-app/src/lib/server/pcd/entities/validate.ts:140`
- Added Lidarr serializer that maps DB fields to the Lidarr portable naming contract.
  - `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts:56`
- Updated export route to use the new serializer and removed incorrect cross-Arr mapping.
  - `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts:62`
  - `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts:90-130`

---

### C-7: `serializeEntity` can return `undefined` silently (non-exhaustive switch)

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts:62-93`
- **Category:** Type safety, silent failure
- **Agents:** code-reviewer

No return type annotation, no `default` case, no exhaustive check. If a new `EntityType` variant is
added, the function silently returns `undefined`, and the export endpoint returns
`{ entityType, data: undefined, migration: {...} }` as a successful 200 response.

**Fix:** Add return type annotation and exhaustive `never` check in the default case.

### Validation result

- Made `serializeEntity` return a concrete record type and added an exhaustive `default` branch that
  throws for unhandled `EntityType` values.
  - `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts:62-93`

---

## High Issues

### H-1: Writer `runValueGuardGate` accesses private `db` field via unsafe cast

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:114`
- **Category:** Type safety, encapsulation
- **Agents:** code-reviewer, type-design

```typescript
const cacheDb = (cache as unknown as { db: Database | null }).db;
```

Double-cast bypasses TypeScript access control. If `PCDCache` renames `db`, this silently returns
`undefined` (not `null`), the `!cacheDb` check passes, and the value-guard gate is silently skipped.

**Fix:** Add `getRawDb(): Database | null` public accessor to `PCDCache`.

### Validation result

- Added `PCDCache#getRawDb(): Database | null` and removed unsafe cache field casts in writer.
  - `packages/praxrr-app/src/lib/server/pcd/database/cache.ts:54`
  - `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:114`

---

### H-2: Value-guard gate silently passes when cache is missing

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:100-117`
- **Category:** Error handling, silent failure
- **Agents:** error-handler, code-reviewer

When there is no cache (failed compilation) or no database handle, `runValueGuardGate` returns
`{ ok: true }`, bypassing all conflict detection. Operations that should be rejected are silently
accepted.

**Fix:** When `runValueGuardGate` is `true` (explicitly requested), missing cache should return
`{ ok: false, error: 'Value-guard validation unavailable: cache not built' }`.

### Validation result

- `runValueGuardGate` now returns `{ ok: false, error: ... }` when cache is missing or cache DB is
  unavailable.
  - `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:100-117`

---

### H-3: `importBaseOps` errors caught and swallowed at link/sync/switchBranch

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:100-107, 181-188, 248-255`
- **Category:** Error handling
- **Agents:** error-handler

In three places, `importBaseOpsWithOrchestration` failures are caught, logged, and execution
continues. Seeding and compilation proceed without base ops, producing incomplete PCD state. For
`link` (fresh setup), there is no value in creating a linked database with missing base ops.

**Fix:** Propagate errors at minimum for `link`. Return partial-success indicator for
`sync`/`switchBranch`.

### Validation result

- Link path now allows `importBaseOpsWithOrchestration` errors to fail the link operation.
- Sync now returns `success: false` when base-op import fails while still completing other
  operations.
- `switchBranch` now returns a boolean import-success indicator.
- `importBaseOpsWithOrchestration` now returns boolean and preserves fallback behavior only when
  explicitly allowed.
  - `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:240-340`

---

### H-4: `normalizeSql` produces `;` for empty SQL, bypassing empty check

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:83-86, 127`
- **Category:** Logic error
- **Agents:** code-reviewer

Empty/whitespace input produces `";"` (length 1), which passes the `sql.length === 0` check at line
127 and gets passed to `cacheDb.exec(";")`.

**Fix:**

```typescript
function normalizeSql(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed.length === 0) return '';
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
}
```

### Validation result

- Added empty-input guard in SQL normalization to return empty string before semicolon appending.
  - `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:83-86`

---

### H-5: `deriveSqlStableIdentity` silently returns null on invalid JSON

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:120-131`
- **Category:** Silent failure, data integrity
- **Agents:** error-handler

Malformed metadata JSON silently returns `null`, bypassing the `validateStableIdentityConflicts`
duplicate identity check. Two SQL files with the same entity can collide undetected when one has
malformed metadata.

**Fix:** Throw on malformed metadata JSON (per project mandate) or at minimum log a warning.

### Validation result

- `deriveSqlStableIdentity` now throws on malformed metadata JSON instead of returning `null` and
  bypassing conflict checks.
  - `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:120-131`

---

### H-6: `parseStableIdentityFromText` silently loses identity on malformed JSON

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:65-80`
- **Category:** Silent failure
- **Agents:** error-handler

The dual-format parser (JSON then key=value fallback) hides JSON.parse errors from strings that look
like JSON but are malformed (e.g., trailing commas). The fallback returns `null`, losing the
identity entirely.

**Fix:** Log when JSON.parse fails on a string starting with `{` to surface malformed-but-intended
JSON.

### Validation result

- Added warning logging for malformed JSON-like stable-identity strings while preserving fallback
  for non-JSON formats.
  - `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:65-80`

---

### H-7: Reader catch blocks discard original error information

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts:171-182, 185-196`
- **Category:** Error quality
- **Agents:** error-handler

Both `catch` blocks use unbound `catch` (no error variable), discarding permission errors, file not
found details, and parse error positions. Users see "Failed to read entity source file" with no
actionable detail.

**Fix:** Bind the error and include `String(error)` in the message.

### Validation result

- Reader now captures caught error objects and includes `String(error)` in read/parse issue
  messages.
  - `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts:171-196`

---

### H-8: `writeOperationsFromSqlOperations` broad catch converts all errors to `{ success: false }`

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:524-536`
- **Category:** Error handling
- **Agents:** error-handler

All exceptions (including OOM, database corruption, null dereference) are flattened to the same
`{ success: false }` result type as a validation failure. Callers cannot distinguish recoverable
from unrecoverable failures.

**Fix:** Rethrow unexpected errors (non-validation, non-conflict) and only return
`{ success: false }` for expected business logic failures.

### Validation result

- Replaced broad failure flattening at the function boundary with rethrowing unexpected exceptions
  after logging, while retaining `{ success: false }` returns from explicit validation/conflict
  checks.
  - `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:524-536`

---

### H-9: Duplicate stable key mappings risk contract drift

- [x] **Status:** Fixed
- **Files:** `reader.ts` (`ENTITY_STABLE_KEY_BY_TYPE`) and `importBaseOps.ts`
  (`SQL_ENTITY_STABLE_KEY_BY_ENTITY`)
- **Category:** Portable contract fidelity
- **Agents:** type-design

Both files independently map entity types to stable key column names. If one is updated without the
other, cross-source conflict detection in `validateStableIdentityConflicts` will miss true
duplicates.

**Fix:** Extract shared stable key constants into a common module. The `importBaseOps.ts` mapping
can extend the shared map with legacy keys.

### Validation result

- Added a shared stable key module and used it from both migration reader and import paths, with SQL
  legacy keys retained where needed.
  - `packages/praxrr-app/src/lib/server/pcd/stableIdentity.ts:1-14`
  - `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts:12,311`
  - `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:5,109`

---

### H-10: `PortableLidarrNaming` aliased to `PortableSonarrNaming` violates Cross-Arr policy

- [x] **Status:** Fixed
- **File:** `packages/praxrr-app/src/lib/shared/pcd/portable.ts:297`
- **Category:** Cross-Arr semantic validation
- **Agents:** code-reviewer

```typescript
export type PortableLidarrNaming = PortableSonarrNaming;
```

Root cause of C-6. Lidarr naming has `standardTrackFormat`, `artistName`, `multiDiscTrackFormat`,
`artistFolderFormat` -- none of which map to Sonarr's episode/series fields. CLAUDE.md requires
portable types "defined per Arr app and fail-fast on ambiguity."

**Fix:** Define `PortableLidarrNaming` as its own interface with Lidarr-appropriate field names.

### Validation result

- Confirmed `PortableLidarrNaming` is now defined as a Lidarr-specific interface in this branch.
  - `packages/praxrr-app/src/lib/shared/pcd/portable.ts:297-311`

---

### H-11: `pathExists` suppresses all errors, not just NotFound

- [x] **Status:** Fixed
- **Files:** `reader.ts:357-364`, `importBaseOps.ts:50-57`
- **Category:** Silent failure
- **Agents:** error-handler

```typescript
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
```

Permission errors, IO errors, and other non-NotFound failures return `false`, causing the caller to
skip existing-but-inaccessible directories with zero indication.

**Fix:** Only catch `Deno.errors.NotFound`; rethrow all other errors.

### Validation result

- Updated both `pathExists` implementations to return `false` only for missing paths, and rethrow
  other filesystem errors.
  - `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts:357-367`
  - `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:39-49`

---

## Medium Issues

### M-1: `asPortableData<T>` performs unsafe double-cast with no validation

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts:184-186`
- **Category:** Type safety
- **Agents:** error-handler, type-design

```typescript
function asPortableData<T>(data: unknown): T {
  return data as unknown as T;
}
```

Used 14 times. If incoming data does not match the expected portable type, deserialization fails
with obscure errors deep in the call chain.

**Fix:** Add JSDoc precondition documenting that `validatePortableData` must be called before this
function. Long-term: typed validation results.

---

### M-2: `ValueGuardApplyDecisionResult` is flat instead of discriminated union

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`
- **Category:** Type design
- **Agents:** type-design

11-field flat interface where many field combinations are semantically invalid (e.g.,
`decision: 'applied'` with `shouldAttemptAutoDrop: true`). Optional
`autoAlignReason`/`autoAlignRule` fields should be required for `auto_align_*` variants and absent
otherwise.

**Fix:** Refactor into a discriminated union keyed on `decision`.

---

### M-3: `ValueGuardGateResult` ambiguous ok/error pattern

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`
- **Category:** Type design
- **Agents:** type-design

When `ok` is `false`, `error` may or may not be present.

**Fix:** Make it a proper discriminated union: `{ ok: true } | { ok: false; error: string }`.

---

### M-4: `cancelOutCreate` silently skips ops with malformed metadata JSON

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:208-212, 246-254`
- **Category:** Silent failure
- **Agents:** error-handler

Multiple `catch { continue }` blocks skip operations with malformed metadata/desired_state. A delete
that should cancel out a prior create fails silently.

**Fix:** Log at debug level when metadata parsing fails.

---

### M-5: Non-conflict errors in tracked ops continue instead of throwing

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/database/cache.ts:244-268`
- **Category:** Error handling
- **Agents:** error-handler

When `evaluateValueGuardError` returns `non_conflict_error` with `shouldRecordHistory: true`, the
error is recorded and execution continues. For non-user (base/schema) ops, this should throw.

---

### M-6: Import API returns generic 400 for all deserialization errors

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts:89-101`
- **Category:** Error handling, API quality
- **Agents:** error-handler

All errors (including internal server errors) return HTTP 400, misleading clients into thinking
their payload is wrong.

**Fix:** Distinguish validation errors (400) from internal errors (500). Add server-side logging.

---

### M-7: Unvalidated `conflictStrategy` cast from database

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:120`
- **Category:** Type safety
- **Agents:** type-design

```typescript
const conflictStrategy = (instance?.conflict_strategy ?? 'override') as ConflictStrategy;
```

Database value is cast without validation. A corrupted row produces incorrect type at runtime.

**Fix:** Validate the string value before casting.

---

### M-8: `getConflictReason` parameter too loose

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`
- **Category:** Type safety
- **Agents:** type-design

Accepts `string | undefined` instead of `OperationType | undefined`. Arbitrary strings fall through
to default case returning `'guard_mismatch'`, masking upstream bugs.

---

### M-9: `MigrationEntityIdentity` and `MigrationEntityStableIdentity` are structurally identical

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`
- **Category:** Type design
- **Agents:** type-design

Both are `{ readonly key: string; readonly value: string }`. TypeScript structural typing means they
are interchangeable, undermining the semantic distinction.

**Fix:** Consider branded types or removing the internal-only `MigrationEntityIdentity`.

---

### M-10: Duplicate `ParsedMetadata` type definitions in writer.ts

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:192-197, 297-303`
- **Category:** Code quality
- **Agents:** code-reviewer

`ParsedMetadata` is defined twice -- once locally inside `cancelOutCreate` (missing
`changed_fields`) and once at module scope. These will drift over time.

**Fix:** Remove the local type and use the module-scope version.

---

### M-11: Unreachable fallback in `resolveMigrationStableIdentity`

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts:330`
- **Category:** Dead code
- **Agents:** type-design

`?? \`migration\_${entityType}\_name\``can never execute because`ENTITY_STABLE_KEY_BY_TYPE`is exhaustive over`EntityType`.

**Fix:** Replace with a `satisfies never` assertion to catch future entity type additions.

---

## Comment Issues

### Comment-1: `tag(name)` comment contradicts code behavior

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/database/cache.ts:344`
- **Category:** Inaccurate comment

Comment says "creates if not exists" but the code throws `'Tag not found'`.

**Fix:** Change to `// tag(name) - Tag lookup by name (throws if not found)`.

---

### Comment-2: `validateSql` JSDoc inaccurate

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/database/cache.ts:416-418`
- **Category:** Inaccurate comment

Says "Returns null if valid, or an error message" but actually returns a `ValidationResult` object.

---

### Comment-3: Stale "future" references

- [ ] **Status:** Open
- **Files:** `deserialize.ts:4-6`, `portable.ts:9`
- **Category:** Stale comment

References to "future import" are now stale -- this PR implements import.

---

---

## Test Coverage Gaps

### T-1: Migration reader has ZERO tests (376 lines)

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`
- **Priority:** 9/10

No test exercises `readMigrationEntitySources()` or internal functions (`resolveEntityType`,
`inferFormatFromPath`, `extractEntityName`, `isolatePortablePayload`, `listEntityFiles`).

**Recommended tests:**

- All 4 top-level dirs + media management subdirs for `resolveEntityType()`
- `.json`, `.yaml`, `.yml` accepted; `.txt`, `.xml` rejected for `inferFormatFromPath()`
- Non-string/empty/whitespace names for `extractEntityName()`
- Array/null/primitive input for `isolatePortablePayload()`
- 3-level nested directory traversal for `listEntityFiles()`

---

### T-2: Value guard gate has no direct unit tests (225 lines)

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`
- **Priority:** 8/10

Only 2 of 6 `evaluateValueGuardApply` decision outcomes are exercised indirectly.
`full_list_conflict`, both `auto_align_*`, and `ask` conflict strategy are untested.

---

### T-3: Stable identity conflict detection untested

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:149-212`
- **Priority:** 8/10

`validateStableIdentityConflicts()` has 3 check phases (SQL/SQL, migration/migration, cross-source).
None are directly tested.

---

### T-4: Writer gate SAVEPOINT edge cases untested

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:100-180`
- **Priority:** 8/10

Multi-op gate with mid-sequence failure, no-cache bypass, and empty SQL handling are untested.

---

### T-5: Entity deserialization for 13 of 14 entity types untested

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`
- **Priority:** 8/10

Only `delay_profile` is tested via cache parity. Compound types (`custom_format` with conditions,
`quality_profile` with 3-step creation) have no test coverage.

---

### T-6: Manager `sql-only` and `hybrid-no-fallback` paths untested

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- **Priority:** 7/10

Only hybrid-with-fallback is tested. Direct sql-only mode and hybrid mode with
`pcdMigrationAllowLegacyFallback=false` are untested.

---

### T-7: Portable migration metadata validation untested

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/shared/pcd/portable.ts:130-167`
- **Priority:** 6/10

`validatePortableMigrationMetadata()` with invalid inputs (missing fields, invalid format, version
below minimum, extra fields) is not tested.

---

### T-8: Export API migration metadata inclusion untested

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`
- **Priority:** 5/10

No test verifies that export response includes correct `migration.source`, `migration.format`, and
`migration.version`.

---

### T-9: `buildContentHash` shared hash function untested

- [ ] **Status:** Open
- **File:** `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts`
- **Priority:** 5/10

Deterministic output for known inputs is not verified. If hash format changes, duplicate detection
breaks silently.

---

## Strengths

1. **Cache parity test design** -- Testing that legacy SQL replay and hybrid input replay produce
   identical cache snapshots is the single highest-value test for this feature.

2. **Value guard gate extraction** -- Pure, deterministic functions with no side effects.
   Well-separated context/result types enable independent testability.

3. **Cross-Arr compliance** -- `ENTITY_STABLE_KEY_BY_TYPE` and `ENTITY_FORMAT_BY_MEDIA_DIR`
   enumerate all Arr entity types individually with no implicit sibling fallback.

4. **Stable identity conflict detection** -- Three-phase check (sql-to-sql, migration-to-migration,
   cross-source) is thorough and fail-fast.

5. **Config validation** -- `parsePCDMigrationMode` throws on invalid values rather than defaulting.

6. **Type safety** -- Zero `any` types introduced. All new code passes `deno task check`.

7. **Migration reader design** -- Side-effect-free with Result-style returns and clear error
   categorization (5 distinct error kinds).

8. **`ENTITY_STABLE_KEY_BY_TYPE: Readonly<Record<EntityType, string>>`** -- Compile-time
   exhaustiveness guarantee. Adding a new `EntityType` without updating the map is a compile error.

9. **`PORTABLE_MIGRATION_FORMATS` with `satisfies`** -- Excellent compile-time/runtime binding.

10. **In-memory operation store pattern** in tests -- Faithful simulation without real SQLite,
    keeping tests fast and isolated.
