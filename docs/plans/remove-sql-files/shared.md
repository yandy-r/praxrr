# Remove SQL Files from PCD Ingestion

The PCD ingestion pipeline currently supports dual-path base-op ingestion: legacy SQL files from
`ops/*.sql` directories and YAML entity files from `entities/` directories. A completed SQL-to-YAML
migration made the SQL files redundant, but they remain as backwards-compatibility fallback
controlled by `PRAXRR_PCD_MIGRATION_MODE` (`hybrid`/`sql-only`) and
`PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK` environment variables. Removing SQL file dependencies
means collapsing the dual-path into YAML-only for entity data ingestion, removing the migration mode
config flags, cleaning up fallback orchestration in the manager, eliminating parity verification
tooling, and deleting the 58 legacy SQL ops files in `packages/praxrr-db/ops/`. The schema-layer SQL
files in `packages/praxrr-schema/ops/` (DDL + seed data) are a fundamentally different concern --
they define database structure and MUST be preserved.

## Relevant Files

### Core Ingestion Pipeline (primary modification targets)

- packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts: Central import orchestrator with
  dual-path SQL/YAML logic, `parseMetadata()` for SQL comment annotations, stable identity conflict
  detection, and hybrid suppression filtering -- the primary file to simplify
- packages/praxrr-app/src/lib/server/pcd/core/manager.ts: `importBaseOpsWithOrchestration()` at line
  488 implements sql-only/hybrid mode dispatch and MigrationReaderError legacy fallback catch
- packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts: Loads operations for cache compilation;
  schema layer reads SQL from files via `loadOperationsFromDir()` (line 70), tweaks layer also uses
  it (line 82)
- packages/praxrr-app/src/lib/server/pcd/utils/operations.ts: Contains `loadOperationsFromDir()`
  filtering for `.sql` extension (line 36) and `getBaseOpsPath()` returning `${pcdPath}/ops`
- packages/praxrr-app/src/lib/server/pcd/database/cache.ts: In-memory SQLite cache;
  `registerHelperFunctions()` registers `qp()`, `cf()`, `dp()`, `mp()`, `tag()` lookup functions
  used only by legacy SQL ops
- packages/praxrr-app/src/lib/server/utils/config/config.ts: Defines `PCDMigrationIngestionMode`
  type, `pcdMigrationIngestionMode` and `pcdMigrationAllowLegacyFallback` config properties, and env
  var parsing

### YAML/Entity Loading (the path to keep)

- packages/praxrr-app/src/lib/server/pcd/migration/reader.ts: YAML/JSON entity reader using
  `@std/yaml` -- reads from `entities/` directories, the replacement ingestion path
- packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts: Deserializes portable entities
  into Kysely queries compiled to SQL ops for `pcd_ops`
- packages/praxrr-app/src/lib/server/pcd/entities/validate.ts: Validates portable entity data shapes
  before deserialization
- packages/praxrr-app/src/lib/server/pcd/migration/migrationImportUtils.ts: `ENTITY_IMPORT_ORDER`
  and `sortMigrationCandidatesByImportOrder()` for YAML import ordering

### Export Pipeline (writes SQL files to repos -- separate concern)

- packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts: Exports draft ops as
  `{opNumber}.{slug}.sql` files to PCD repos for git push
- packages/praxrr-app/src/lib/server/pcd/ops/writer.ts: Writes ops to `pcd_ops` table; generates
  `.sql`-suffixed filenames for repo import context (line 68)
- packages/praxrr-app/src/lib/server/pcd/utils/git.ts: `getMaxOpNumber()` scans committed
  `ops/*.sql` files via `git ls-tree` for export numbering

### Parity/Conversion Tooling (removal candidates)

- packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts: Compares SQL-only vs YAML
  compilation snapshots -- becomes unnecessary after SQL removal
- scripts/convert-pcd-to-yaml.ts: Converts SQL-compiled PCD to YAML entities using explicit
  `sql-only` mode -- becomes obsolete
- scripts/verify-pcd-parity.ts: Verifies parity between SQL-compiled and entity-compiled state --
  becomes obsolete
- scripts/compat-check.ts: Reads SQL files from both schema and DB ops directories to verify
  contract integrity -- needs rework to use YAML entities

### Stable Identity System

- packages/praxrr-app/src/lib/server/pcd/stableIdentity.ts: `SQL_ENTITY_STABLE_KEY_BY_ENTITY`
  extends `PORTABLE_ENTITY_STABLE_KEY_BY_TYPE` with legacy `batch` and `metadata_profile` entries

### Schema Package (KEEP -- not removal targets)

- packages/praxrr-schema/ops/0.schema.sql: PCD schema DDL (CREATE TABLE statements) -- foundational
  schema used by type generation and cache build
- packages/praxrr-schema/ops/1.languages.sql: Language seed INSERT statements
- packages/praxrr-schema/ops/2.qualities.sql: Quality and quality_api_mappings seed INSERT
  statements
- scripts/generate-pcd-types.ts: Reads `0.schema.sql` to generate TypeScript types -- depends on
  schema SQL (stays)

### Schema Validation Scripts (KEEP)

- packages/praxrr-schema/scripts/validateLanguages.sh: Validates languages against Radarr/Sonarr
  source, reads `ops/1.languages.sql`
- packages/praxrr-schema/scripts/validateQualities.sh: Validates qualities against Radarr/Sonarr
  source, reads `ops/2.qualities.sql`
- packages/praxrr-schema/scripts/generate-schema-diagram.sh: Generates ER diagram from
  `ops/0.schema.sql`

### PCD Database Package (SQL files to delete)

- packages/praxrr-db/ops/\*.sql: 58 legacy SQL operation files (~1.4MB total) -- the primary
  deletion targets
- packages/praxrr-db/entities/: YAML entity files organized by type -- the canonical replacement
  data source
- packages/praxrr-db/README.md: Describes SQL files as "transitional artifacts" -- needs updating

### Git/Dependency System

- packages/praxrr-app/src/lib/server/pcd/git/dependencies.ts: Clones schema dependency repos, keeps
  only `.git`, `ops/`, and `pcd.json` -- hardcoded `ops/` assumption

### Test Files

- packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts: Tests SQL parsing, stable identity,
  hybrid/sql-only logic -- needs major rework
- packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts: Tests
  hybrid-to-sql-only fallback -- remove entirely
- packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts: Tests SQL vs entity parity --
  remove or rework
- packages/praxrr-app/src/tests/pcd/migration/parityVerifier.test.ts: Tests parity verifier --
  remove with parityVerifier.ts
- packages/praxrr-app/src/tests/base/pcdMigrationModeConfig.test.ts: Tests sql-only/hybrid config
  parsing -- remove entirely
- packages/praxrr-app/src/tests/pcd/migration/reader.test.ts: Tests YAML/JSON reader exclusively --
  keep as-is

### Documentation Reference Files

- docs/pcdReference/0.schema.sql: Reference copy of schema DDL -- may keep for documentation
- docs/pcdReference/1.initial.sql: Reference copy of initial SQL import -- remove (obsolete)

### CI/CD Workflows

- .github/workflows/compatibility.yml: Runs `scripts/compat-check.ts` on PRs -- needs rework
- .github/workflows/publish-db.yml: Mirrors `packages/praxrr-db` via subtree split -- mirrored
  content changes after SQL deletion

## Relevant Tables

- pcd_ops: Stores imported base/user ops as SQL text strings. Migration entities are deserialized
  into SQL ops stored here. The `filename` column contains `.sql`-suffixed values for historical
  ops. Runtime storage -- NOT being removed.

## Relevant Patterns

**Dual-Path Ingestion with Priority Cascade**: `importBaseOps()` reads SQL from `ops/` AND YAML
entities from `entities/`. In hybrid mode, YAML entities suppress overlapping SQL entries by
matching stable identity keys. The `effectiveSqlEntries` filtering implements the cascade. See
[packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts](packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts)
lines 414-473.

**DB-First Operation Storage**: All ops (from SQL files or YAML entities) are stored as SQL strings
in the `pcd_ops` table. The cache builder replays these SQL strings against in-memory SQLite. Only
the file-level SQL reading changes; runtime SQL string storage remains. See
[packages/praxrr-app/src/lib/server/pcd/database/cache.ts](packages/praxrr-app/src/lib/server/pcd/database/cache.ts).

**Config-Driven Mode Selection**: `config.pcdMigrationIngestionMode` (`'sql-only'` | `'hybrid'`)
controls which path runs. `config.pcdMigrationAllowLegacyFallback` controls whether hybrid failures
fall back to sql-only. Both flags become unnecessary after SQL removal. See
[packages/praxrr-app/src/lib/server/utils/config/config.ts](packages/praxrr-app/src/lib/server/utils/config/config.ts).

**Schema Layer Always File-Based SQL**: Schema ops (`0.schema.sql`, `1.languages.sql`,
`2.qualities.sql`) are always loaded from files via `loadOperationsFromDir()`. This is NOT part of
the entity data pipeline and must be preserved. See
[packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts](packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts)
line 70.

**SQL Annotation Metadata in Comment Headers**: Legacy SQL ops files contain metadata as comment
annotations (`-- @operation:`, `-- @entity:`, `-- @name:`, `-- @stable_key:`). The `parseMetadata()`
function extracts these. YAML entities carry metadata as structured fields in the portable format,
making this parsing unnecessary. See
[packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts](packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts)
lines 295-313.

**Helper SQL Functions for Legacy Ops**: `PCDCache.registerHelperFunctions()` registers `qp()`,
`cf()`, `dp()`, `mp()`, `tag()` as SQLite user-defined functions used in hand-written SQL ops.
Existing `pcd_ops` rows may still reference these functions, so they should be preserved for
backward compatibility. See
[packages/praxrr-app/src/lib/server/pcd/database/cache.ts](packages/praxrr-app/src/lib/server/pcd/database/cache.ts).

**Export Flow Writes SQL Files**: The exporter creates numbered `.sql` files in `ops/` when
publishing draft changes. This is a separate concern from ingestion and may be addressed
independently. See
[packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts](packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts).

## Relevant Docs

**CLAUDE.md**: You _must_ read this when working on PCD system changes. Contains PCD concept
definitions, environment variable documentation, schema source precedence, and cross-Arr validation
policy.

**packages/praxrr-db/README.md**: You _must_ read this when understanding current SQL file status.
Describes YAML-first data source policy and SQL files as "transitional artifacts."

**docs/plans/pcd-data-migration-2/shared.md**: You _must_ read this when understanding the migration
history. Phase 2 context doc with complete file inventory of migration-relevant code.

**docs/plans/pcd-data-migration/runbook.md**: You _must_ read this when understanding current
runtime controls. Documents `PRAXRR_PCD_MIGRATION_MODE` and fallback controls.

**docs/ARCHITECTURE.md**: You _must_ read this when understanding PCD lifecycle and ops pipeline.
Contains glossary defining "Op" as SQL operations and compile flow documentation.

**packages/praxrr-schema/docs/structure.md**: Reference for PCD schema architecture, OSQL concepts,
and layer replay mechanics.

**docs/architecture/data-flow.md**: Reference for PCD Link/Sync/Compile flow diagrams.

## Key Edge Cases

- **Schema DDL has no YAML equivalent**: `0.schema.sql` contains CREATE TABLE statements, not entity
  data. It must remain SQL.
- **Helper function backward compatibility**: Existing `pcd_ops` rows may contain `qp()`, `cf()`
  etc. calls from legacy imports. Removing `registerHelperFunctions()` would break cache compilation
  for databases with such legacy ops.
- **Export pipeline creates SQL files**: The exporter writes `.sql` files for git export. If the
  `ops/` directory is no longer read during import, exported ops need special handling or the export
  format needs to change.
- **`getMaxOpNumber()` scans committed `.sql` files**: Removing SQL files from repos could break
  export numbering for repos with committed SQL history.
- **Sequence bands assume SQL/YAML coexistence**: `UNPREFIXED_SEQUENCE_BASE` (2 billion) and
  `YAML_SEQUENCE_BASE` (4 billion) in `importBaseOps.ts` were designed for dual-source sequencing.
- **Tweaks layer also reads SQL**: `loadOperationsFromDir()` is used for both schema and tweaks
  layers. Tweaks may need preserved SQL file reading.
- **Parity verifier and conversion scripts become obsolete**: `parityVerifier.ts`,
  `convert-pcd-to-yaml.ts`, and `verify-pcd-parity.ts` all depend on SQL-only mode existing.
- **`compat-check.ts` reads DB ops SQL files**: The CI compatibility check needs rework to validate
  using YAML entities instead.
- **`pcd_ops.filename` values**: Historical ops in the database contain `.sql`-suffixed filenames.
  This is naming convention only, not filesystem reads.
