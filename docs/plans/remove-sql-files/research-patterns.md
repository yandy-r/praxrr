# Pattern Research: remove-sql-files

The PCD ingestion pipeline currently supports two parallel paths for base-op ingestion: legacy SQL
files (read from `ops/*.sql` in PCD repos) and YAML/JSON entity files (read from `entities/` in PCD
repos). A configuration flag `pcdMigrationIngestionMode` (`'sql-only'` | `'hybrid'`) controls which
path runs. In hybrid mode, YAML entities take precedence and suppress overlapping SQL entries by
stable identity. A secondary flag `pcdMigrationAllowLegacyFallback` controls whether hybrid failures
fall back to SQL-only mode. Removing SQL file support means collapsing the dual-path into YAML-only
for entity data, while preserving the SQL-based schema layer and the runtime SQL operation storage
(pcd_ops table).

**Important distinction**: "SQL files" in this context means the `.sql` files inside PCD repository
`ops/` directories that define base entities via raw INSERT/UPDATE/DELETE statements. This does NOT
include: the PCD schema (`0.schema.sql`), the runtime `pcd_ops` table (which stores compiled SQL
from both paths), or the Kysely-generated SQL used by entity writers.

## Relevant Files

### Core Ingestion Pipeline

- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: Central import orchestrator.
  Contains the `importBaseOps()` function with dual-path logic (SQL file reading + YAML migration
  reader). Lines 386-599 are the main import flow. Contains `parseMetadata()` for SQL annotation
  comments, `validateStableIdentityConflicts()` for cross-source dedup, and the
  `effectiveSqlEntries` filtering logic.
- `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`: Loads operations for cache compilation.
  Line 70 loads schema ops from files (keep). Lines 74-77 load base/user ops from DB (keep). Line 82
  loads tweaks from files (keep). The `resolveSchemaOpsPath()` helper handles schema dependency
  resolution.
- `/packages/praxrr-app/src/lib/server/pcd/utils/operations.ts`: Contains `loadOperationsFromDir()`
  which reads `.sql` files from a directory. Used by `loadOps.ts` for schema and tweaks layers. Also
  contains `getBaseOpsPath()` which returns `${pcdPath}/ops` - used by `importBaseOps.ts`.
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: `PCDCache.build()` executes all
  operations including SQL strings from the `pcd_ops` table. The `registerHelperFunctions()` method
  registers `qp()`, `cf()`, `dp()`, `mp()`, `tag()` SQL lookup functions used only by legacy SQL
  ops.
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: `importBaseOpsWithOrchestration()` at
  line 488 implements the `sql-only`/`hybrid` mode dispatch and the legacy fallback catch.

### YAML/Entity Loading (the path to keep)

- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: The YAML/JSON entity reader. Uses
  `@std/yaml` (`parseYaml`). Reads files from `${pcdPath}/entities/`, resolves entity types from
  directory structure, validates portable data shape, and returns `MigrationEntityCandidate[]`.
- `/packages/praxrr-app/src/lib/server/pcd/entities/validate.ts`: Validates portable entity data
  shape before deserialization. Pure type-checking (no SQL involved).
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: Dispatches portable entity data
  to create functions per entity type. These create functions generate Kysely queries that become
  SQL ops in `pcd_ops`.
- `/packages/praxrr-app/src/lib/server/pcd/migration/migrationImportUtils.ts`: `ENTITY_IMPORT_ORDER`
  and `sortMigrationCandidatesByImportOrder()` define entity ordering for YAML import.

### Configuration

- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Lines 19-20 define
  `pcdMigrationIngestionMode` and `pcdMigrationAllowLegacyFallback`. Line 67-70 parse from env vars
  `PRAXRR_PCD_MIGRATION_MODE` and `PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK`. Default mode is
  `'hybrid'` (line 101).
- `/packages/praxrr-app/src/lib/server/pcd/core/types.ts`: `Operation` interface (line 30-36) has
  `sql: string` and `layer: 'schema' | 'base' | 'tweaks' | 'user'` fields. The `sql` field is used
  for operations loaded from DB, not files directly.

### Export Pipeline (writes SQL files to repo)

- `/packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`: Exports draft ops as SQL files to PCD
  repos. `buildExportPlan()` generates `.sql` filenames (line 373) and SQL file content with
  metadata comment headers. Writes to `ops/` directory in repo clone.
- `/packages/praxrr-app/src/lib/server/pcd/ops/draftChanges.ts`: Lists draft entity changes from
  `pcd_ops` table for export preview UI.
- `/packages/praxrr-app/src/lib/server/pcd/utils/git.ts`: `getMaxOpNumber()` scans committed
  `ops/*.sql` files via `git ls-tree` to determine next op number for exports.

### Writer Pipeline (SQL string generation from entities)

- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: Writes operations to `pcd_ops` table.
  `writeOperation()` converts Kysely compiled queries to SQL strings via `compiledQueryToSql()`.
  `writeOperationsFromSql()` handles migration entity import writes. The
  `withRepoImportWriteContext()` generates filenames with `.sql` suffix (line 68).
- `/packages/praxrr-app/src/lib/server/pcd/utils/sql.ts`: `compiledQueryToSql()` converts Kysely
  `CompiledQuery` to raw SQL strings with parameter substitution.

### Schema System

- `/packages/praxrr-schema/ops/0.schema.sql`: The PCD schema DDL (CREATE TABLE statements). This is
  NOT entity data and must be preserved.
- `/packages/praxrr-schema/ops/1.languages.sql`: Schema seed data (INSERT for languages table). Must
  be preserved.
- `/packages/praxrr-schema/ops/2.qualities.sql`: Schema seed data (INSERT for qualities table). Must
  be preserved.
- `/packages/praxrr-schema/pcd.json`: Schema manifest metadata.
- `/scripts/generate-pcd-types.ts`: Generates TypeScript types from `0.schema.sql`. Loads the SQL
  schema into in-memory SQLite and introspects table structure. Uses local file by default
  (`packages/praxrr-schema/ops/0.schema.sql`).

### Seed System

- `/packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`: Currently a no-op stub
  (returns `{ created: 0, skipped: 0 }`). No SQL file references.

### Stable Identity System

- `/packages/praxrr-app/src/lib/server/pcd/stableIdentity.ts`: Maps entity types to stable key
  column names. `SQL_ENTITY_STABLE_KEY_BY_ENTITY` extends `PORTABLE_ENTITY_STABLE_KEY_BY_TYPE` with
  legacy `batch` and `metadata_profile` entries.

### PCD Database Content (praxrr-db)

- `/packages/praxrr-db/ops/*.sql`: 56+ legacy SQL base-op files (numbered 1-56). These are the SQL
  files that would no longer be read in YAML-only mode.
- `/packages/praxrr-db/entities/**/*.yaml`: YAML entity files organized by type (custom-formats,
  quality-profiles, delay-profiles, regular-expressions, media-management, metadata-profiles). These
  are the replacement data source.
- `/packages/praxrr-db/pcd.json`: PCD manifest.

### Test Files

- `/packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`: Tests for stable identity conflict
  validation, metadata parsing from SQL comments, and hybrid suppression. Creates temp `.sql` files
  for testing. Many test helpers construct mock SQL entries.
- `/packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`: Tests the `sql-only`
  / `hybrid` fallback behavior in manager. Creates temp `ops/*.sql` files. Tests both `sql-only`
  mode and hybrid-with-fallback paths.
- `/packages/praxrr-app/src/tests/pcd/migration/reader.test.ts`: Tests for the YAML reader. No SQL
  file dependencies.
- `/packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts`: Compares SQL-only cache vs
  entity-based cache for parity verification. References `0.schema.sql` and creates mock SQL ops.
- `/packages/praxrr-app/src/tests/pcd/migration/parityVerifier.test.ts`: Tests for the parity
  verifier which compares SQL-only vs YAML builds.
- `/packages/praxrr-app/src/tests/base/pcdMigrationModeConfig.test.ts`: Tests config parsing for
  `pcdMigrationIngestionMode` and `pcdMigrationAllowLegacyFallback`.

## Architectural Patterns

### Dual-Path Ingestion with Priority Cascade

- **Pattern**: `importBaseOps()` reads SQL files from `ops/` AND YAML entities from `entities/`. In
  hybrid mode, YAML entities suppress overlapping SQL entries by matching stable identity keys. The
  `effectiveSqlEntries` filtering (line 464-473 in `importBaseOps.ts`) implements the priority
  cascade.
- **Removal impact**: The entire `effectiveSqlEntries` filtering logic, SQL entry collection loop
  (lines 414-452), and `parseMetadata()` function for SQL annotation comments become dead code.

### DB-First Operation Storage

- **Pattern**: All ops (from SQL files or YAML entities) are stored as SQL strings in the `pcd_ops`
  table. The cache builder (`PCDCache.build()`) replays these SQL strings against an in-memory
  SQLite database. YAML entities get converted to SQL via Kysely query builders ->
  `compiledQueryToSql()` -> stored in `pcd_ops.sql`.
- **Removal impact**: The `pcd_ops` table and SQL string storage remain. Only the file-level SQL
  reading changes.

### Schema Layer Remains File-Based

- **Pattern**: Schema operations (`0.schema.sql`, `1.languages.sql`, `2.qualities.sql`) are always
  loaded from files via `loadOperationsFromDir()` in `loadOps.ts` line 70. This is NOT part of the
  entity import and must be preserved.
- **Removal impact**: None. The schema layer is separate from base entity ops.

### Config-Driven Mode Selection

- **Pattern**: `config.pcdMigrationIngestionMode` (`'sql-only'` | `'hybrid'`) controls which path
  runs. `config.pcdMigrationAllowLegacyFallback` controls whether hybrid failures fall back to
  SQL-only. The manager's `importBaseOpsWithOrchestration()` implements the dispatch.
- **Removal impact**: Both config flags become unnecessary. The mode concept itself can be removed.

### SQL Annotation Metadata in Comment Headers

- **Pattern**: SQL ops files contain metadata as comment annotations (e.g., `-- @operation: create`,
  `-- @entity: custom_format`, `-- @name: My Format`,
  `-- @stable_key: custom_format_name=My Format`). The `parseMetadata()` function in
  `importBaseOps.ts` (lines 295-313) extracts these.
- **Removal impact**: `parseMetadata()` for SQL comment annotations becomes dead code. YAML entities
  carry metadata as structured fields in the portable format.

### Helper SQL Functions for Legacy Ops

- **Pattern**: `PCDCache.registerHelperFunctions()` registers `qp()`, `cf()`, `dp()`, `mp()`,
  `tag()` as SQLite user-defined functions. These are used in hand-written SQL ops like
  `INSERT INTO quality_profile_custom_formats (quality_profile_id, ...) VALUES (qp('Profile Name'), cf('Format Name'), ...)`.
- **Removal impact**: These helper functions are only needed by legacy SQL ops. Once SQL ops files
  are no longer read, these functions may not be called by any remaining ops. However, user-authored
  base ops stored in `pcd_ops` may still use them if created via the export flow (which writes SQL
  files with these functions). **Edge case**: Existing published base ops in `pcd_ops` may contain
  calls to these helper functions. Removing the functions would break cache compilation for
  databases with such legacy ops. **Recommendation**: Keep the helper functions registered for
  backward compatibility with existing `pcd_ops` data.

### Export Flow Writes SQL Files

- **Pattern**: The exporter (`exporter.ts`) creates numbered `.sql` files in `ops/` when publishing
  draft changes to the PCD repository. It clones the repo, writes files, commits, and pushes. The
  `getMaxOpNumber()` utility scans committed `.sql` files to determine the next number.
- **Removal impact**: The export flow currently writes SQL files. If the goal is YAML-only
  ingestion, the export format should eventually move to YAML. However, this may be a separate
  concern since exported ops are synthetic batch files, not entity definitions.

## Fallback/Dual-Path Patterns

### Manager Orchestration (`importBaseOpsWithOrchestration`)

Located in `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts` lines 488-518:

1. If `migrationMode === 'sql-only'`: calls `importBaseOps()` with
   `pcdMigrationIngestionMode: 'sql-only'`
2. If hybrid: calls `importBaseOps()` with migration mode, catches errors
3. On error: if `pcdMigrationAllowLegacyFallback` is true AND error is `MigrationReaderError`, falls
   back to `sql-only`
4. Otherwise: rethrows

### Import Base Ops Dual Path (`importBaseOps`)

Located in `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts` lines 381-599:

1. Reads `basePath` (`${pcdPath}/ops`) for `.sql` files
2. If `isHybridIngestion`: also reads migration entity sources from `${pcdPath}/entities/`
3. Validates no duplicate stable identities within each source
4. Builds `migrationIdentitySet` from YAML entities
5. Filters SQL entries: if not `allowLegacySqlInHybrid`, drops ALL SQL entries; otherwise drops SQL
   entries whose stable identity overlaps with a migration entity
6. Imports remaining SQL entries directly to `pcd_ops`
7. Imports migration entities via `withRepoImportWriteContext` + `candidate.deserialize()`

### Parity Verifier (`parityVerifier.ts`)

Located in `/packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts` lines 386-401:

- `buildSqlOnlySnapshot()` imports with `pcdMigrationIngestionMode: 'sql-only'` and snapshots the
  cache
- `buildEntitySnapshot()` reads YAML entities directly and deserializes them
- Compares the two snapshots for parity
- This entire verifier becomes unnecessary once SQL path is removed

## Schema Patterns

### PCD Schema Definition

The PCD schema is defined in SQL (`/packages/praxrr-schema/ops/0.schema.sql`) and loaded as
file-based operations during cache compilation. This is NOT part of the entity data pipeline:

1. `loadOps.ts` line 70: `loadOperationsFromDir(schemaPath, 'schema')` reads `deps/*/ops/*.sql`
2. Schema ops include `0.schema.sql` (DDL), `1.languages.sql` (seed), `2.qualities.sql` (seed)
3. The `generate:pcd-types` script reads `0.schema.sql`, creates in-memory SQLite, introspects,
   generates TypeScript types

### Type Generation

`/scripts/generate-pcd-types.ts` uses local-first resolution:

1. Explicit `--local=<path>` first
2. Default local `packages/praxrr-schema/ops/0.schema.sql` second
3. Remote fetch only with `--remote` flag

### Portable Entity Types

`/packages/praxrr-app/src/lib/shared/pcd/portable.ts` defines the structured type system for YAML
entities: `PortableDelayProfile`, `PortableRegularExpression`, `PortableCustomFormat`,
`PortableQualityProfile`, and media management variants. These are the target format.

## Testing Approach

### Test Files That Reference SQL

1. **`importBaseOps.test.ts`**: Creates temp `.sql` files, tests `parseMetadata()` for SQL comment
   annotations, tests `validateStableIdentityConflicts()` with mock SQL entries, tests hybrid
   suppression with mock SQL + YAML entries. All SQL-related tests would be removed or rewritten.

2. **`managerHybridFallback.test.ts`**: Three test cases:
   - Hybrid fallback to sql-only on parse failure (line 9)
   - sql-only mode without fallback (line 90)
   - Hybrid mode with fallback disabled rethrows (line 170) All three test the fallback mechanism
     and would be removed.

3. **`cacheParity.test.ts`**: References `0.schema.sql` for schema loading (keep), creates mock SQL
   ops for cache building (keep - these test runtime SQL execution, not file-based SQL loading).

4. **`parityVerifier.test.ts`**: Tests SQL-only vs YAML parity comparison. The parity verifier
   itself becomes unnecessary.

5. **`pcdMigrationModeConfig.test.ts`**: Tests config parsing for migration mode and fallback flags.
   Would be removed along with the config flags.

6. **`reader.test.ts`**: Tests YAML/JSON reader exclusively. No SQL file references. Keep as-is.

### Test Patterns

- Tests use `__testOnly_*` exported functions for unit testing private logic
- Temp directories created with `Deno.makeTempDir()` for file-based tests
- Mock patching via `patch()` helper that saves/restores original values
- Tests call `importBaseOps()` directly with explicit mode parameters

## Patterns to Follow for Removal

### 1. Remove Config Flags First

Remove `pcdMigrationIngestionMode` and `pcdMigrationAllowLegacyFallback` from:

- `/packages/praxrr-app/src/lib/server/utils/config/config.ts` (definition + parsing)
- Environment variable handling (`PRAXRR_PCD_MIGRATION_MODE`,
  `PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK`)
- `/packages/praxrr-app/src/tests/base/pcdMigrationModeConfig.test.ts` (remove tests)

### 2. Simplify Manager Orchestration

In `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`:

- Replace `importBaseOpsWithOrchestration()` with direct `importBaseOps()` call (no mode dispatch,
  no fallback catch)
- Remove `MigrationReaderError` import if no longer needed in manager

### 3. Collapse importBaseOps to YAML-Only

In `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`:

- Remove `ImportBaseOpsOptions` type (no more mode parameter)
- Remove `PCDMigrationIngestionMode` import
- Remove SQL file reading loop (lines 414-452: `Deno.readDir(basePath)`, `.sql` filtering,
  `parseMetadata()`)
- Remove `BaseImportSqlEntry` type, `SourceType`, `SourceConflictRef`
- Remove `parseMetadata()` function for SQL annotation comments
- Remove `deriveSqlStableIdentity()` and related identity parsing for SQL ops
- Remove `validateStableIdentityConflicts()` (no cross-source conflicts when only one source)
- Remove `effectiveSqlEntries` filtering logic
- Remove `isHybridIngestion` / `allowLegacySqlInHybrid` branching
- Keep migration entity reading and import as the sole path
- Keep orphan marking (`markBaseOrphaned`)

### 4. Remove Parity Verifier

The parity verifier (`/packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`) and its
tests exist to verify SQL-YAML equivalence. Once SQL is removed, the verifier has no purpose:

- Remove `/packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`
- Remove `/packages/praxrr-app/src/tests/pcd/migration/parityVerifier.test.ts`
- Remove `/packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts` (if solely testing
  parity)

### 5. Preserve These SQL-Related Components

- **Schema loading** (`loadOperationsFromDir()` for schema layer): Schema ops are SQL files by
  design and must remain
- **`pcd_ops` table**: Runtime storage of compiled SQL operations (both from YAML deserialization
  and user edits)
- **`compiledQueryToSql()`**: Used by entity writers to convert Kysely queries to SQL for `pcd_ops`
- **`PCDCache.registerHelperFunctions()`**: Keep `qp()`, `cf()`, `dp()`, `mp()`, `tag()` for
  backward compatibility with existing `pcd_ops` data
- **`PCDCache.validateSql()`**: Used by writer pipeline for validation
- **Export pipeline** (`exporter.ts`, `getMaxOpNumber()`): Writes SQL files for repo export; may be
  addressed separately
- **`loadOperationsFromDir()` for tweaks layer**: Tweaks may still use SQL files

### 6. Update/Remove Test Files

- Remove SQL-specific tests in `importBaseOps.test.ts` (parseMetadata, SQL entry creation, hybrid
  suppression)
- Remove `managerHybridFallback.test.ts` entirely
- Remove `pcdMigrationModeConfig.test.ts` entirely
- Keep and verify `reader.test.ts` still passes
- Add/update tests verifying YAML-only import path works correctly

### 7. Consider the Export Flow

The exporter currently writes `.sql` files to the PCD repo `ops/` directory. This creates new SQL
files that would be read back on next import. Options:

- **Short-term**: The export flow can remain as-is since exported ops are batch SQL files (not
  entity definitions). They would need special handling during YAML-only import.
- **Long-term**: Migrate the export flow to write YAML entity files instead of SQL batch files.
- **Key question**: Will the `ops/` directory still be read at all after removal? If not, exports
  need a new target format.

### 8. Address the `ops/` Path Usage

`getBaseOpsPath()` returns `${pcdPath}/ops` and is used in `importBaseOps.ts`. After removal:

- If SQL files in `ops/` are no longer read at import time, this path helper may become unused in
  the import context
- The exporter still writes to `ops/`, so the path itself may still be needed
- Consider whether to keep `ops/` reading for backward compatibility during a transition period

## Edge Cases

- Existing `pcd_ops` rows may contain SQL using helper functions (`qp()`, `cf()`, etc.) from legacy
  imports or exports. Removing helper function registration would break cache compilation for these
  databases.
- The `UNPREFIXED_SEQUENCE_BASE` (2 billion) and `YAML_SEQUENCE_BASE` (4 billion) sequence bands in
  `importBaseOps.ts` assume coexistence of SQL and YAML ops. After removal, only the YAML sequence
  band is needed.
- The `MIGRATION_OP_FILENAME_PREFIX = 'entities/'` in `importBaseOps.ts` is used to distinguish
  YAML-sourced ops from SQL-sourced ops in the `pcd_ops` table. After removal, all base ops would
  have this prefix.
- The export flow creates filenames like `${opNumber}.${slug}.sql` and uses `-- @operation: export`
  / `-- @entity: batch` metadata headers. These batch export ops are not the same as
  entity-definition SQL ops - they are aggregated change batches. The import pipeline reads them
  back via the SQL file path.
- User-created base ops via the export pipeline are stored with `source: 'repo'` in `pcd_ops`. After
  YAML-only import, re-imports would skip these since they lack YAML entity sources, potentially
  orphaning legitimate exported ops.
- The `convert-pcd-to-yaml.ts` script (`/scripts/convert-pcd-to-yaml.ts`) loads SQL ops to build a
  cache, then serializes entities to YAML. This script was used for the initial SQL-to-YAML
  migration and may be removable after the transition is complete.

## Other Docs

- `/docs/plans/pcd-data-migration-2/research-business.md`: Previous research on the SQL-to-YAML
  migration plan, including hybrid ingestion mode details and rollback strategy
- `/docs/pr-reviews/pr-91-review.md`: Review notes on `pcdMigrationAllowLegacyFallback` behavior
- `/docs/pr-reviews/pr-100-review.md`: Review notes on hybrid fallback error handling refinement
- `/packages/praxrr-schema/docs/structure.md`: Schema structure documentation
- `/packages/praxrr-schema/docs/manifest.md`: PCD manifest format documentation
