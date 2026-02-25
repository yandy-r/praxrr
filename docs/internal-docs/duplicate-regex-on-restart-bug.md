# Duplicate Regular Expression on Restart Bug

The `importBaseOps` function lacks idempotency for entity re-import on server restart. When the in-memory PCD cache is compiled from existing `pcd_ops` rows before re-importing YAML entities, every entity `create` function checks the cache for duplicates and throws because the entity already exists from prior import operations persisted in `pcd_ops`.

## Relevant Files

- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts` (line 380-417): `PCDManager.initialize()` -- calls `importBaseOps` for every enabled database on every startup
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts` (line 162-233): `importBaseOps()` -- compiles cache from existing ops at line 176 before iterating candidates, then calls `candidate.deserialize()` which hits the duplicate check
- `/packages/praxrr-app/src/lib/server/pcd/entities/regularExpressions/create.ts` (line 40-52): Duplicate name check queries the in-memory cache and throws unconditionally if entity exists
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts` (line 232-240): `deserializeRegularExpression()` calls `regexQueries.create()` with no "already exists" handling
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` (line 608-639): Writer's filename-based deduplication that correctly upserts `pcd_ops` rows -- but this code is never reached because the entity create function throws first
- `/packages/praxrr-app/src/lib/server/pcd/database/compiler.ts` (line 116-144): `compile()` builds a fresh in-memory cache by replaying all persisted `pcd_ops` SQL
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts` (line 38-296): `PCDCache.build()` replays all operations into an in-memory SQLite database
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/create.ts` (line 31-43): Same duplicate check pattern exists for custom formats (all entity types share this pattern)
- `/packages/praxrr-app/src/lib/server/pcd/entities/delayProfiles/create.ts` (line 34-46): Same pattern for delay profiles
- `/packages/praxrr-app/src/hooks.server.ts` (line 51): Entry point that calls `pcdManager.initialize()` on every server start

## Architectural Patterns

- **Append-only ops with in-memory cache**: PCD operations are persisted as SQL statements in `pcd_ops` rows. The in-memory cache is rebuilt by replaying all ops in layer order (schema -> base published -> base draft -> tweaks -> user). Entity CRUD functions validate against this in-memory cache.
- **Writer deduplication by filename**: The writer at `writer.ts:608-639` has a deduplication mechanism for repo-sourced base imports. When an existing `pcd_ops` row matches the synthetic filename, it updates the row rather than creating a new one. This is the intended idempotency mechanism for re-imports.
- **Fast-path cache apply**: During repo import, the writer applies SQL directly to the in-memory cache (`rawDb.exec(sql)` at line 686) instead of doing a full recompile, avoiding O(n^2) compile overhead.
- **Entity create functions as gatekeepers**: All entity `create` functions (`regularExpressions/create.ts`, `customFormats/create.ts`, `delayProfiles/create.ts`, etc.) query the in-memory cache for case-insensitive name uniqueness and throw if a duplicate exists. This is correct for user-facing creates but blocks re-import.

## Root Cause Analysis

The execution flow on restart with an existing database:

1. `pcdManager.initialize()` is called (manager.ts:380)
2. `seedBuiltInBaseOps` runs (currently a no-op)
3. `importBaseOps(instance.id, instance.local_path)` is called (manager.ts:410)
4. Inside `importBaseOps` at line 176: `compile(pcdPath, databaseId)` is called BEFORE iterating candidates
5. `compile()` builds a new `PCDCache` by replaying ALL existing `pcd_ops` rows, including the base ops from the previous import. The in-memory SQLite database now contains all previously imported entities.
6. For each YAML entity candidate (sorted by import order, regular_expressions first):
   - `candidate.deserialize()` is called (importBaseOps.ts:194)
   - For regular expressions, this calls `deserializeRegularExpression()` (deserialize.ts:232)
   - Which calls `regexQueries.create()` (deserialize.ts:235)
   - `create()` queries the in-memory cache: `selectFrom('regular_expressions').where(lower(name) = ...)` (create.ts:40-44)
   - The entity already exists in the cache from step 5
   - `create()` throws: `A regular expression with name "126811" already exists` (create.ts:51)
7. The throw propagates up through `importBaseOps` to `pcdManager.initialize()` which catches it and logs the error seen in the bug report

**Why it works on first install**: On a clean database, there are no existing `pcd_ops` rows, so the compile at step 4 produces an empty in-memory cache. The entity create functions find no duplicates and succeed. The writer's fast-path applies the SQL to the cache, so subsequent entities in the same import batch can reference previously imported ones.

**Why the writer's deduplication is never reached**: The entity `create` function throws an error BEFORE the generated SQL ever reaches `writeOperation()`. The create function builds Kysely queries and checks the cache, but the `throw` at line 51 of create.ts prevents the `writeOperation()` call at line 91 from executing. The writer's filename-based deduplication (writer.ts:608-639) only operates on `pcd_ops` persistence, not on the entity-level uniqueness check.

## Edgecases

- This bug affects ALL entity types, not just regular expressions. The error message will reference whichever entity type comes first in the import order (`ENTITY_IMPORT_ORDER` in migrationImportUtils.ts:9-24). Regular expressions are first, so they surface the error before custom formats, quality profiles, etc. are attempted.
- The `pcdManager.initialize()` method catches the error (manager.ts:411-416) and logs it but continues, so the server still starts -- it just fails to refresh base ops from the repo, potentially leaving stale entity data in `pcd_ops`.
- The `markBaseOrphaned` call at importBaseOps.ts:220 never executes when this error occurs, so orphan cleanup is also skipped on restart.
- The same bug would manifest during `pcdManager.sync()` (manager.ts:180, 239) when pulling updates, not just on restart, since sync also calls `importBaseOps`.

## Probable Fix Approach

The deserialization layer needs to distinguish between "create new entity" and "re-import existing entity". There are several options:

1. **Skip-if-exists in deserialize**: Before calling `create()`, check if the entity already exists in the cache. If it does, compare the portable data and either skip (if unchanged) or update (if changed). This keeps the create functions strict.
2. **Upsert mode on create functions**: Add an `upsert: boolean` option to entity create functions that, when true, checks for existing entities and updates them instead of throwing. The `importBaseOps` path would set this flag.
3. **Pre-filter candidates in importBaseOps**: After compiling the cache at line 176, filter out candidates whose `pcd_ops` rows already exist (by filename). This leverages the writer's existing deduplication without ever calling deserialize for already-imported entities.
4. **Clear and re-import**: Before importing, delete all repo-sourced base ops for the database, then compile a clean cache and re-import everything. This is simpler but more expensive.

Option 3 is the most surgical and aligns with the existing writer deduplication pattern. The synthetic filename is deterministic (`entities/{candidate.relativePath}#{index}.sql`), so checking `pcdOpsQueries.getBaseByFilename` before calling `candidate.deserialize()` would skip entities that have already been imported with unchanged content.

## Other Docs

- `/docs/ARCHITECTURE.md` -- Overall architecture documentation
- `/docs/pcdReference/` -- PCD reference documentation
