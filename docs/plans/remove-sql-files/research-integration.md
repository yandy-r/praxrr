# Integration Research: remove-sql-files

The PCD pipeline has two parallel data ingestion paths: a legacy SQL file path and a newer YAML
entity path. The `hybrid` migration mode (default) reads YAML entities from `entities/` and SQL ops
from `ops/`, with YAML taking precedence for overlapping stable identities. The `sql-only` mode
ignores YAML entirely. This research catalogs every touchpoint where `.sql` files are referenced,
read, or generated in the PCD/Schema ingestion pipeline, excluding the runtime app SQLite database
(`praxrr.db`).

## PCD Ops Pipeline

### SQL in the Pipeline

The pipeline loads SQL at two distinct stages:

1. **Schema layer** (file-based, always SQL): `loadAllOperations()` in
   `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts` resolves the schema dependency directory
   (`{pcdPath}/deps/{schema-name}/ops`) and reads all `.sql` files via `loadOperationsFromDir()`.
   These are the `0.schema.sql`, `1.languages.sql`, `2.qualities.sql` files from `praxrr-schema`.
   This is the DDL + seed layer and is always SQL -- it defines the in-memory SQLite tables.

2. **Base layer** (DB-first, imported from SQL files): `importBaseOps()` in
   `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts` reads `.sql` files from the
   `{pcdPath}/ops/` directory on disk (line 416-425), parses metadata headers, and stores them into
   the `pcd_ops` app database table. At cache compile time, these ops are loaded from the DB, not
   from disk. The disk read only happens during import.

3. **Tweaks layer** (file-based, SQL): `loadAllOperations()` reads optional `.sql` files from
   `{pcdPath}/tweaks/` directory.

4. **User layer** (DB-only): User ops are stored and loaded entirely from the `pcd_ops` table, never
   from disk SQL files.

The critical SQL file filter is in `loadOperationsFromDir()` at
`/packages/praxrr-app/src/lib/server/pcd/utils/operations.ts:36`:

```
if (!entry.isFile || !entry.name.endsWith('.sql')) { continue; }
```

And the same filter in `importBaseOps()` at
`/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:417`:

```
if (!entry.isFile || !entry.name.endsWith('.sql')) continue;
```

### YAML in the Pipeline

YAML entity ingestion is handled by the migration reader at
`/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`. It reads `.yaml`/`.yml`/`.json` files
from `{pcdPath}/entities/` and produces `MigrationEntityCandidate` objects. These candidates are
deserialized into SQL ops via entity-specific deserializers and stored in `pcd_ops` via the writer.

In `hybrid` mode (`importBaseOps`), after SQL file import:

- YAML entities are read via `readMigrationEntitySources()`
- Stable identity conflicts are validated between SQL and YAML
- If `pcdMigrationAllowLegacyFallback` is true, SQL entries with matching YAML stable identities are
  filtered out (YAML wins)
- If `pcdMigrationAllowLegacyFallback` is false, ALL SQL entries are suppressed (only YAML entities
  are used)
- YAML candidates are deserialized via entity-specific handlers and written as synthetic SQL ops

### Migration Mode Configuration

- **`PRAXRR_PCD_MIGRATION_MODE`** env var: `'hybrid'` (default) or `'sql-only'`
- **`PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK`** env var: boolean, defaults false
- Config type: `PCDMigrationIngestionMode` at
  `/packages/praxrr-app/src/lib/server/utils/config/config.ts:6`
- Manager orchestration: `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts:488-517`

The manager's `importBaseOpsWithOrchestration()` method has a fallback path: if hybrid mode fails
with a `MigrationReaderError` and `pcdMigrationAllowLegacyFallback` is true, it retries with
`sql-only` mode.

## Schema/Type Generation

### Current Schema Sources

The type generator at `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/generate-pcd-types.ts`
reads the PCD schema SQL, creates an in-memory SQLite database, applies the schema, introspects the
tables, and generates TypeScript types to `/packages/praxrr-app/src/lib/shared/pcd/types.ts`.

Schema resolution order (local-first):

1. Explicit `--local=<path>` CLI argument
2. Default local path: `packages/praxrr-schema/ops/0.schema.sql` (line 20)
3. Remote fetch from GitHub (only with `--remote` flag):
   `https://raw.githubusercontent.com/yandy-r/praxrr-schema/{version}/ops/0.schema.sql`

The `PRAXRR_SCHEMA_REF` env var provides the default version for remote fetch.

### SQL Schema Files

| File                                         | Role                                                      |
| -------------------------------------------- | --------------------------------------------------------- |
| `packages/praxrr-schema/ops/0.schema.sql`    | DDL: all table CREATE statements (26k, the master schema) |
| `packages/praxrr-schema/ops/1.languages.sql` | Seed: 64 language INSERT statements                       |
| `packages/praxrr-schema/ops/2.qualities.sql` | Seed: quality and quality_api_mappings INSERT statements  |

These three files are the **schema dependency** that every PCD depends on. They are cloned into
`{pcdPath}/deps/praxrr-schema/ops/` at link time and read every time the cache is compiled. The type
generator reads `0.schema.sql` directly.

## PCD Cache

### How the In-Memory Cache Works

`PCDCache.build()` at `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts` creates an
in-memory SQLite database and executes all operations in layer order. It does NOT read SQL files
directly. Instead:

1. Calls `loadAllOperations(pcdPath, databaseInstanceId)` from `loadOps.ts`
2. `loadAllOperations()` loads schema ops from disk (SQL files), base/user ops from the `pcd_ops` DB
   table
3. Each `Operation` object has a `.sql` string property
4. The cache calls `this.db.exec(operation.sql)` for each operation

The schema layer is the only layer that reads SQL files directly from disk at cache compile time.
Base ops were already imported from SQL files into the database during `importBaseOps()`.

## Package Contents

### praxrr-schema

Location: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/`

| Path                  | Contents                                                                    |
| --------------------- | --------------------------------------------------------------------------- |
| `ops/0.schema.sql`    | Master DDL schema (26k)                                                     |
| `ops/1.languages.sql` | Language seed data                                                          |
| `ops/2.qualities.sql` | Quality + quality_api_mappings seed data                                    |
| `pcd.json`            | Manifest (name: "schema", version: "1.0.0")                                 |
| `deno.json`           | Package config (`@yandy-r/praxrr-schema`, exports `./mod.ts`)               |
| `mod.ts`              | Module entrypoint                                                           |
| `docs/`               | Documentation (manifest.md, structure.md)                                   |
| `scripts/`            | Validation scripts (shell scripts for languages, qualities, schema diagram) |

The schema package is **entirely SQL-based**. It has no YAML entity files. The SQL files here are
DDL + seed data, not entity ops. This is a different concern from the PCD data ops -- these define
the database structure itself.

### praxrr-db

Location: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/`

| Path        | Contents                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ops/*.sql` | ~58 legacy SQL operation files (1.4MB total, the largest being `0.rosettarr.sql` at 1.4MB)                                                       |
| `entities/` | YAML entity files organized by type (custom-formats, quality-profiles, delay-profiles, regular-expressions, media-management, metadata-profiles) |
| `pcd.json`  | Manifest (name: "Praxrr Database", version: "2.0.0", depends on praxrr-schema)                                                                   |
| `deno.json` | Package config (`@yandy-r/praxrr-db`)                                                                                                            |
| `docs/`     | Documentation                                                                                                                                    |

The `entities/` directory is the canonical YAML-first data source. The `ops/` SQL files are
"retained as transitional artifacts during rollout and compatibility fallback windows" per the
README.

## Configuration

### Environment Variables Referencing SQL/Migration Modes

| Variable                                     | Purpose                                                               | Default    |
| -------------------------------------------- | --------------------------------------------------------------------- | ---------- |
| `PRAXRR_PCD_MIGRATION_MODE`                  | Controls ingestion mode: `'hybrid'` or `'sql-only'`                   | `'hybrid'` |
| `PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK` | When true, hybrid mode falls back to sql-only on MigrationReaderError | `false`    |
| `PRAXRR_SCHEMA_REF`                          | Override schema dependency ref (tag/branch) for remote fetch          | `'main'`   |
| `PRAXRR_SCHEMA_LOCAL_PATH`                   | Override schema dependency to use a local folder                      | unset      |

### Config Type Definition

`PCDMigrationIngestionMode = 'sql-only' | 'hybrid'` at
`/packages/praxrr-app/src/lib/server/utils/config/config.ts:6`

## Internal Services

### Files That Read or Process SQL Files on Disk

| File                                                           | What it does with SQL files                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/packages/praxrr-app/src/lib/server/pcd/utils/operations.ts`  | `loadOperationsFromDir()`: reads `.sql` files from schema and tweaks directories, filters by `.sql` extension (line 36)                     |
| `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`       | `loadAllOperations()`: orchestrates loading schema (from files) + base/user (from DB); `resolveSchemaOpsPath()` finds schema dependency dir |
| `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts` | `importBaseOps()`: reads `.sql` files from `{pcdPath}/ops/` (line 416-425), parses metadata headers, stores in DB                           |
| `/packages/praxrr-app/src/lib/server/pcd/utils/git.ts`         | `getMaxOpNumber()`: scans committed `.sql` files in `ops/` via `git ls-tree` to find highest op number (line 14)                            |
| `/packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`      | `buildExportPlan()`: generates `.sql` filenames for exported ops (line 373); writes SQL files to repo clone for push                        |
| `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`        | `consumeRepoImportIdentity()`: generates `.sql` filenames for repo import ops (line 68)                                                     |
| `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`    | `PCDCache.build()`: executes `operation.sql` strings (line 105); `parseOpId()` checks for `pcd_ops:` filepath prefix                        |
| `/scripts/generate-pcd-types.ts`                               | Reads `0.schema.sql` from local path or GitHub, applies to in-memory SQLite                                                                 |
| `/scripts/compat-check.ts`                                     | Reads all `.sql` files from both schema and DB ops directories, applies to temp SQLite (lines 52-59, 80-83)                                 |
| `/scripts/validate-condition-values.ts`                        | Reads `.sql` files for condition value validation                                                                                           |

### Files That Reference SQL Filename Conventions

| File                                                                | Reference                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts:15`         | Default filename pattern: `pcd_op_{id}.sql`                   |
| `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:68`          | Repo import filename: `{prefix}#{suffix}.sql`                 |
| `/packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts:373`       | Export filename: `{opNumber}.{slug}.sql`                      |
| `/packages/praxrr-app/src/lib/server/pcd/utils/operations.ts:63-66` | Filename extraction examples: `0.schema.sql`, `1.initial.sql` |

### Files That Reference Migration Mode / Legacy Fallback

| File                                                                              | Reference                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts:488-517`                 | `importBaseOpsWithOrchestration()`: sql-only mode, hybrid mode, legacy fallback |
| `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:387,463`            | Migration mode check, legacy SQL allowance in hybrid                            |
| `/packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts:389`         | Uses `sql-only` mode for parity comparison                                      |
| `/packages/praxrr-app/src/lib/server/utils/config/config.ts:6,19-20,67-69,98-109` | Config type and parsing                                                         |
| `/packages/praxrr-app/src/tests/base/pcdMigrationModeConfig.test.ts`              | Config behavior tests                                                           |
| `/packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`      | Fallback behavior tests                                                         |
| `/packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`                    | Import behavior tests with both modes                                           |

## Relevant Files

- `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`: Orchestrates operation loading for cache
  compilation; schema layer reads SQL from disk
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: Reads SQL ops from `ops/` dir,
  parses metadata, stores in DB; hybrid/sql-only orchestration
- `/packages/praxrr-app/src/lib/server/pcd/utils/operations.ts`: `loadOperationsFromDir()` filters
  for `.sql` extension; `getBaseOpsPath()` returns `{pcdPath}/ops`
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: In-memory cache that executes SQL
  strings from loaded operations
- `/packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`: Compile orchestration, creates
  PCDCache from pcdPath
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: High-level lifecycle orchestration,
  migration mode branching, legacy fallback
- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: YAML/JSON entity reader (the
  replacement path)
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: Writes ops to DB, generates `.sql`
  filenames for repo imports
- `/packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`: Exports draft ops as `.sql` files to
  git repo
- `/packages/praxrr-app/src/lib/server/pcd/utils/git.ts`: Scans committed `.sql` files for max op
  number
- `/packages/praxrr-app/src/lib/server/pcd/git/dependencies.ts`: Clones/syncs schema dependency,
  keeps `ops/` folder
- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`: `PCDMigrationIngestionMode` type,
  `sql-only` mode
- `/scripts/generate-pcd-types.ts`: Reads `0.schema.sql` for type generation
- `/scripts/compat-check.ts`: Reads both schema and DB ops SQL files for compatibility validation
- `/packages/praxrr-schema/ops/`: Schema SQL files (DDL + seed data)
- `/packages/praxrr-db/ops/`: Legacy SQL operation files (transitional artifacts)
- `/packages/praxrr-db/entities/`: YAML entity files (canonical data source)
- `/docs/pcdReference/0.schema.sql`: Reference copy of schema SQL
- `/docs/pcdReference/1.initial.sql`: Reference copy of initial data SQL

## Architectural Patterns

- **DB-first ops storage**: Base and user ops are stored in the `pcd_ops` app DB table, not on disk.
  SQL files on disk are only read during import, not during cache compilation. This means removing
  SQL file reading from `importBaseOps()` is the key change for base ops.
- **Schema layer is always file-based SQL**: The schema dependency (`praxrr-schema`) defines DDL via
  SQL files. These create the in-memory SQLite tables. This is a different concern from data ops and
  likely needs to remain SQL (you cannot define CREATE TABLE via YAML portably).
- **Hybrid mode with identity-based dedup**: YAML entities and SQL ops are matched by stable
  identity keys. When both exist for the same entity, YAML wins in hybrid mode. This means removal
  of SQL base ops should be safe as long as all entities have YAML equivalents.
- **Exporter generates SQL files**: The export flow (`exporter.ts`) writes SQL files to the git
  repo. This is the reverse direction (app -> repo) and would need a separate consideration for YAML
  export.
- **Filename conventions carry `.sql` extension**: Multiple places generate or expect `.sql`
  extensions in filenames stored in the DB. These are naming conventions in `pcd_ops.filename`, not
  filesystem reads.

## Edgecases

- The schema layer (`praxrr-schema/ops/`) is DDL SQL and cannot be converted to YAML -- it defines
  CREATE TABLE statements, indexes, and seed data that must be executed as SQL.
- `loadOperationsFromDir()` in `utils/operations.ts` is used for both schema and tweaks layers.
  Tweaks are optional SQL files that may still be needed for user customization.
- The exporter writes `.sql` files to the PCD git repo during publish. If SQL ops are removed from
  ingestion, the exporter would still create SQL files unless changed.
- `getMaxOpNumber()` in `utils/git.ts` scans committed `.sql` files to determine the next op number
  for export. This depends on SQL files existing in the repo.
- The `compat-check.ts` script validates that schema SQL + DB ops SQL can be layered successfully.
  It reads from both `packages/praxrr-schema/ops/` and `packages/praxrr-db/ops/`. This script will
  need updating if SQL ops are removed.
- `pcd_ops.filename` values in the database already contain `.sql` extensions for historical ops.
  Changing this convention would need migration or dual-extension support.
- The `pcdMigrationAllowLegacyFallback` config allows hybrid mode to fall back to sql-only. Removing
  SQL files would break this fallback path.
- `docs/pcdReference/0.schema.sql` and `docs/pcdReference/1.initial.sql` are documentation reference
  files, not used by the runtime.
- Runtime data directories (`config/data/databases/*/ops/` and `dist/dev/data/databases/*/ops/`)
  contain cloned SQL files from linked PCD repos. These are gitignored but will still exist on disk
  for existing installations.

## Other Docs

- `/packages/praxrr-schema/README.md`: Explains the schema layer architecture and PCD layering model
- `/packages/praxrr-db/README.md`: Documents YAML-first data source policy; SQL files described as
  "transitional artifacts"
- `/packages/praxrr-schema/docs/structure.md`: Detailed schema structure documentation (90k)
- `/packages/praxrr-schema/docs/manifest.md`: PCD manifest specification (56k)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`: Project conventions including schema
  source precedence, mirror governance, and Arr cutover guardrails
