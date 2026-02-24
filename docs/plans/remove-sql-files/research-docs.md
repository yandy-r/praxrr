# Documentation Research: remove-sql-files

## Overview

The SQL-to-YAML migration for PCD data ingestion is complete (Phase 1 and Phase 2 of
`pcd-data-migration`). SQL files in `packages/praxrr-db/ops/` are retained as "transitional
artifacts" per `packages/praxrr-db/README.md`. The runtime defaults to `hybrid` ingestion mode and
has a `sql-only` fallback controlled by environment variables. Removing SQL files requires updating
the runtime ingestion pipeline, configuration system, compatibility checks, type generation script,
conversion/pariquality definition as it is no longer relevant.ty tooling, and multiple documentation
layers.

---

## Architecture Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ARCHITECTURE.md`: High-level architecture
  including PCD lifecycle, ops pipeline, glossary defining "Op" as SQL operations, and compile flow.
  Sections referencing SQL operations and layers need updating.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/overview.md`: Runtime layer
  overview. References `praxrr-db ops repo` and `praxrr-schema ops repo` as package boundaries. The
  `praxrr-db` description ("Default PCD content ops repository") references SQL ops files.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/data-flow.md`: PCD
  Link/Sync/Compile flow diagram showing `import base ops` step. References to `pcd/ops/loadOps.ts`,
  `pcd/ops/writer.ts`, and `pcd/ops/importBaseOps.ts`.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/components.md`: Component map
  with PCD Lifecycle Components referencing ops loader, writer, and compiler.

---

## CLAUDE.md References

### Root `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`

Sections that reference SQL, schema, or PCD ingestion and need review after SQL removal:

- **Key Concepts > PCD**: Describes ops as "SQL operations" stored in `pcd_ops`, writer pipeline as
  "Kysely query -> SQL compile -> validate against cache -> write to pcd_ops". The core PCD concept
  documentation frames everything as SQL-first.

- **Schema Source Precedence**: References `packages/praxrr-schema/ops/0.schema.sql` as the default
  local schema path for `generate:pcd-types`. This is schema-layer SQL (DDL + seed) and is NOT part
  of the data-layer SQL removal. Important distinction.

- **Monorepo and PCD Contract Notes**: Describes `praxrr-db`/`praxrr-schema` providing "local
  package artifacts and mirrored external distribution."

- **Environment Variables**: Documents `PRAXRR_SCHEMA_LOCAL_PATH` overriding schema dependency
  resolution to "a local folder containing `ops/` + `pcd.json`."

### PCD Database CLAUDE.md `/home/yandy/Projects/github.com/yandy-r/praxrr/config/data/databases/912070c3-cae8-46f5-ba12-6e28932c390b/CLAUDE.md`

- This is the local dev PCD instance CLAUDE.md. Describes the repo as "SQL data files that target
  the Praxrr schema" with `ops/` containing numbered SQL migration files. Entire document is
  SQL-centric. References SQL migration conventions including file naming, headers, and operation
  blocks.

---

## README Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/README.md`: Already
  acknowledges YAML-first migration. States "entities/ is the canonical source for default PCD data
  at startup. SQL files in ops/ are retained as transitional artifacts during rollout and
  compatibility fallback windows." This will need updating to remove the "transitional" language
  once SQL files are actually removed.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/README.md`: Comprehensive
  schema documentation. Describes PCDs as "a sequence of SQL operations, not as final data."
  References `ops/0.schema.sql`, `ops/1.languages.sql`, `ops/2.qualities.sql`. Note: schema-layer
  SQL (DDL) is NOT being removed, only data-layer SQL in praxrr-db. However, the README's framing of
  PCD authoring as SQL-only will need updating if the PCD authoring model shifts away from SQL.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/docs/manifest.md`: Manifest
  specification for `pcd.json`. References ops directory and dependency resolution.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/docs/structure.md`:
  Canonical PCD architecture reference. Extensively documents OSQL (Operational SQL), layers, replay
  mechanics, and Change-Driven Development. Diagrams show `ops/*.sql` files as the authoring format.
  This is the most comprehensive PCD documentation and will need significant revisions to reflect
  YAML-first reality.

---

## Configuration Files

### Runtime Configuration

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/config/config.ts`:
  Defines `PCDMigrationIngestionMode = 'sql-only' | 'hybrid'` type. Environment variables:
  - `PRAXRR_PCD_MIGRATION_MODE`: defaults to `'hybrid'`, accepts `'sql-only'`
  - `PRAXRR_PCD_MIGRATION_ALLOW_LEGACY_FALLBACK`: boolean for SQL fallback on hybrid failure
  - Both need removal or simplification when SQL files are dropped.

### deno.json Task Definitions

- `/home/yandy/Projects/github.com/yandy-r/praxrr/deno.json`: Contains tasks that touch SQL:
  - `generate:pcd-types`: Uses schema SQL file (schema-layer, stays)
  - `convert:pcd-entities`: Converts SQL-compiled PCD to YAML entities (may become obsolete)
  - `verify:pcd-parity`: Compares SQL-compiled vs entity-compiled state (may become obsolete)
  - `compat:check`: Runs `scripts/compat-check.ts` which applies SQL ops files

### CI/CD Workflows

- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/compatibility.yml`: Runs
  `scripts/compat-check.ts` on PRs touching packages. The compat check applies schema SQL + DB ops
  SQL to verify contract integrity.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/publish-schema.yml`: Mirrors
  `packages/praxrr-schema` via subtree split. Schema SQL files stay.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/publish-db.yml`: Mirrors
  `packages/praxrr-db` via subtree split. After SQL removal, the mirrored content changes.

---

## Code Documentation

### PCD Ingestion Pipeline (SQL-touching files)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`:
  Core SQL ingestion logic. Contains `sql-only` vs `hybrid` mode branching. Reads `.sql` files from
  ops directory (line 417). Has SQL duplicate stable key deduplication logic. Migration entities
  suppress overlapping SQL entries.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`:
  PCD lifecycle orchestration. Contains `pcdMigrationIngestionMode` checks (lines 489-515). Calls
  `importBaseOps` with explicit `sql-only` or `hybrid` mode. Has legacy fallback logic for SQL-only
  when hybrid fails.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`:
  Builds ordered operation layers. Generates `.sql` filenames for ops (line 15).

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`:
  Operation persistence. Generates `.sql` filenames for repo import ops (line 68). Normalizes SQL
  strings.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`:
  Exports ops as SQL files with `.sql` extension (line 373). Formats SQL with headers and operation
  blocks.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`:
  In-memory SQLite cache. References `.sql` in its operation handling.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/utils/sql.ts`:
  SQL utility functions used in the PCD pipeline.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/utils/operations.ts`:
  Operation utilities referencing SQL.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/conflicts/overrideUtils.ts`:
  Override conflict resolution referencing SQL.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/utils/git.ts`:
  Git utilities for PCD repos, references `.sql` files.

### Migration/Conversion Pipeline

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`:
  Reads `entities/` YAML/JSON files. Does NOT reference SQL -- this is the YAML-only path.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/migration/converter.ts`:
  Converts compiled cache to YAML entity files.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`:
  Compares SQL-compiled vs entity-compiled state. References `sql-only` mode.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`:
  Value guard decision engine for migration.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/migration/yamlFormatter.ts`:
  YAML formatting utilities.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/migration/migrationImportUtils.ts`:
  Migration import utilities.

### Scripts

- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/compat-check.ts`: Applies schema SQL + DB
  ops SQL to an in-memory database and verifies types. Reads `.sql` files from
  `packages/praxrr-schema/ops` and `packages/praxrr-db/ops`. Will need major rework -- either
  compile from YAML entities or remove the DB ops SQL layering step entirely.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/generate-pcd-types.ts`: Generates
  TypeScript types from schema SQL. Uses `packages/praxrr-schema/ops/0.schema.sql` as default.
  Schema SQL stays -- no changes needed.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/convert-pcd-to-yaml.ts`: Converts
  SQL-compiled PCD to YAML entities. Uses `sql-only` ingestion mode explicitly (line 406). After SQL
  removal this script becomes either obsolete or needs rework for YAML-to-YAML conversion.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/verify-pcd-parity.ts`: Verifies parity
  between SQL-compiled and entity-compiled state. After SQL removal, the SQL baseline disappears so
  this script needs rework or removal.

### Test Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`:
  Tests SQL ingestion modes.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts`:
  Parity test comparing SQL vs hybrid compilation.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`:
  Tests manager hybrid fallback to SQL-only.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/pcdMigrationModeConfig.test.ts`:
  Tests config parsing of `sql-only` vs `hybrid` modes.

### Reference SQL Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/pcdReference/0.schema.sql`: Reference copy of
  schema SQL.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/pcdReference/1.initial.sql`: Reference copy
  of initial data SQL.

---

## Existing Plans/Tasks

### PCD Data Migration Phase 1

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration/shared.md`: Context
  doc for Phase 1. Describes hybrid JSON/YAML authoring layer. Lists all relevant files for the
  migration pipeline.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration/parallel-plan.md`:
  Implementation plan for Phase 1 with phased rollout strategy.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration/rollout-checklist.md`:
  Rollout verification checklist for YAML-first default.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration/runbook.md`:
  Operator runbook for staged rollout. Documents `PRAXRR_PCD_MIGRATION_MODE` and fallback controls.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration/rollout-evidence/`:
  Evidence artifacts from rollout phases.

### PCD Data Migration Phase 2

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration-2/feature-spec.md`:
  Phase 2 spec: converter tool and parity verification. Describes the SQL-to-YAML conversion as
  "big-bang migration."
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration-2/shared.md`: Phase
  2 context doc. Lists all relevant files, tables, and patterns.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration-2/research-technical.md`:
  Detailed converter architecture blueprint. Describes SQL-compiled cache vs YAML entity flow.

### PR Reviews

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/pr-reviews/pr-100-review.md`: Review of Phase
  2 migration PR. Documents critical issues found including fallback catch masking and sync trigger
  issues.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/pr-reviews/pr-91-review.md`: Earlier
  migration-related PR review.

### Tasks

- `/home/yandy/Projects/github.com/yandy-r/praxrr/tasks/todo.md`: Current task state (Lidarr YAML
  parity work completed).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/tasks/lessons.md`: Accumulated lessons. Contains
  entries about monorepo mirror workflows, PCD base-op migration registration, and local-path
  development overrides.

### Feature Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/portable-import-export.md`: Portable
  import/export feature documentation. References hybrid migration payloads and migration operator
  checks using SQL queries against `pcd_ops`.

---

## Must-Read Documents

Implementers MUST read these before starting work:

1. **`/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`** -- Project conventions, PCD
   concept definitions, environment variable documentation including schema source precedence.

2. **`/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/config/config.ts`**
   -- Runtime config defining `PCDMigrationIngestionMode`, `pcdMigrationAllowLegacyFallback`,
   environment variable parsing. This is the control plane for SQL vs hybrid behavior.

3. **`/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`**
   -- Core SQL ingestion logic with hybrid/sql-only branching. The primary file that reads `.sql`
   files from the ops directory.

4. **`/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`**
   -- PCD lifecycle orchestration with migration mode branching and legacy fallback logic.

5. **`/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/compat-check.ts`** -- Compatibility
   check that applies schema + DB ops SQL. Must be reworked to not depend on DB ops SQL files.

6. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration/runbook.md`** --
   Operator runbook documenting current SQL/hybrid runtime controls.

7. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration-2/shared.md`** --
   Phase 2 context doc with complete file inventory of migration-relevant code.

---

## Documentation Gaps

- **No explicit "SQL removal plan" document exists.** The migration plans document the SQL-to-YAML
  transition but stop at "retain SQL as transitional artifacts." The actual removal step is
  undocumented.

- **No documentation of what schema-layer SQL stays vs data-layer SQL goes.** The distinction
  between `praxrr-schema/ops/*.sql` (DDL/seed, stays) and `praxrr-db/ops/*.sql` (data ops, goes)
  needs explicit documentation.

- **The `PRAXRR_PCD_MIGRATION_MODE` env var lifecycle is undocumented.** There is no document
  describing when `sql-only` mode support would be removed or deprecated.

- **No compatibility matrix for SQL removal.** Missing documentation on which downstream consumers
  depend on the SQL files in `praxrr-db/ops/`.

- **The PCD structure documentation (`packages/praxrr-schema/docs/structure.md`) has not been
  updated** to reflect YAML-first authoring reality -- it still describes OSQL as the primary
  authoring model.

---

## Documentation Updates Needed

After SQL file removal, the following documents need updating:

### Must Update

- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`: Update PCD concept to reflect
  YAML-first model. Remove references to `PRAXRR_PCD_MIGRATION_MODE` and `sql-only` mode. Update
  writer pipeline description.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/README.md`: Remove
  "transitional artifacts" language. Update to state entities/ is the sole data source.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ARCHITECTURE.md`: Update glossary entry for
  "Op" (currently "SQL operation"). Update PCD lifecycle descriptions.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/overview.md`: Update `praxrr-db`
  package description from "ops repository" to "entities repository."

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/portable-import-export.md`: Remove
  or update hybrid migration references.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration/runbook.md`: Archive
  or mark as historical. `PRAXRR_PCD_MIGRATION_MODE` env var goes away.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/config/data/databases/912070c3-cae8-46f5-ba12-6e28932c390b/CLAUDE.md`:
  Entire document is SQL-centric for the PCD database. Needs rewrite for YAML entity model.

### Should Update

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/README.md`: Update general
  PCD description to acknowledge YAML-first data layer while keeping schema-layer SQL documentation.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/docs/structure.md`: Update
  OSQL documentation and PCD lifecycle diagrams to reflect YAML-first data authoring.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/docs/manifest.md`: Update
  manifest documentation if `ops/` directory convention changes for data PCDs.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration-2/shared.md`: Mark
  as historical or archive once SQL removal is complete.

### Consider Removing or Archiving

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/pcdReference/0.schema.sql`: Schema reference
  copy -- may still be useful as schema documentation.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/pcdReference/1.initial.sql`: Initial data
  reference copy -- becomes obsolete once SQL data files are removed.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-data-migration/rollout-evidence/`:
  Historical rollout evidence -- may be archived.
