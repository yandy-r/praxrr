# pcd-data-migration-2

PCD migration phase 2 sits at the boundary between the existing SQL-first cache compiler and the
portable entity import/export pipeline. The feature reuses the current cache lifecycle
(`pcdManager` + `PCDCache` + compiler) to compile canonical SQL state, then converts that state into
reader-compatible `entities/*` files via shared serializers and deterministic file formatting. Those
generated files must round-trip through `reader.ts` and deserializers without semantic drift, so
parity verification compares SQL-built and migration-built cache tables. The implementation fits
cleanly into `pcd/migration` helpers and script entry points while preserving runtime hybrid
ingestion behavior in `importBaseOps` and existing API import/export routes.

## Relevant Files

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: PCD lifecycle orchestration and compile
  triggers.
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: in-memory SQLite cache builder and op
  execution.
- `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`: compile wrapper and cache registry
  swaps.
- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: source-of-truth entity serializers
  for conversion output.
- `packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: portable entity deserializers
  for round-trip verification.
- `packages/praxrr-app/src/lib/server/pcd/entities/validate.ts`: runtime payload validation for
  migration files.
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: reads and validates `entities/`
  YAML/JSON files.
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: hybrid SQL + migration ingestion
  and conflict checks.
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: current portable export behavior
  and serializer usage.
- `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: current portable import flow and
  entity guardrails.
- `packages/praxrr-schema/ops/0.schema.sql`: schema contract for all parity-compared tables.
- `packages/praxrr-db/ops/0.rosettarr.sql`: primary SQL seed being converted to YAML entities.
- `docs/plans/pcd-data-migration-2/feature-spec.md`: feature scope, constraints, and acceptance
  criteria.
- `docs/plans/pcd-data-migration-2/research-technical.md`: detailed converter and parity
  architecture blueprint.

## Relevant Tables

- `database_instances`: linked PCD repository metadata for compile/import context.
- `pcd_ops`: base/user operation storage with source, hash, and ordering metadata.
- `pcd_op_history`: compile application/conflict history for behavioral comparison.
- `tags`: reusable labels referenced by regexes, custom formats, and quality profiles.
- `regular_expressions`: regex entity definitions exported as standalone migration files.
- `custom_formats`: core custom format rows with dependent condition/test tables.
- `custom_format_conditions`: typed condition roots that branch into condition subtype tables.
- `quality_profiles`: profile definitions with dependent quality, language, tag, and scoring tables.
- `quality_profile_custom_formats`: arr-scoped custom format scores used in parity checks.
- `quality_profile_qualities`: ordered quality/group selections per profile.
- `delay_profiles`: protocol delay entities included in conversion output.
- `radarr_naming`: Radarr naming templates serialized/deserialized in migration paths.
- `sonarr_naming`: Sonarr naming templates serialized/deserialized in migration paths.
- `lidarr_naming`: Lidarr naming templates with transitional mapping behavior.
- `radarr_media_settings`: Radarr media management defaults in migration set.
- `sonarr_media_settings`: Sonarr media management defaults in migration set.
- `lidarr_media_settings`: Lidarr media management defaults in migration set.
- `radarr_quality_definitions`: Radarr quality definitions used by profile compatibility logic.
- `sonarr_quality_definitions`: Sonarr quality definitions used by profile compatibility logic.
- `lidarr_quality_definitions`: Lidarr quality definitions used by profile compatibility logic.
- `lidarr_metadata_profiles`: Lidarr metadata profile roots with child type/status tables.

## Relevant Patterns

**Lifecycle Orchestrator**: Use `PCDManager` as the coordination pattern for linking, importing,
compiling, and downstream sync triggers. Example:
`packages/praxrr-app/src/lib/server/pcd/core/manager.ts`.

**Repository Query Modules**: Keep SQL access in query modules and avoid inline route/service SQL
for migration features. Example:
`packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts`.

**Portable Serialization Boundary**: Reuse `serialize.ts`/`deserialize.ts` and portable contracts
instead of duplicating field mappings in scripts or routes. Example:
`packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`.

**Reader-Validated Migration Ingestion**: Generated entity files must conform to reader directory
and validation rules before deserialization/import. Example:
`packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`.

## Relevant Docs

**`docs/plans/pcd-data-migration-2/feature-spec.md`**: You _must_ read this when working on scope,
requirements, acceptance criteria, and migration constraints.

**`docs/plans/pcd-data-migration-2/research-technical.md`**: You _must_ read this when working on
converter architecture, parity design, table coverage, and integration points.

**`docs/features/portable-import-export.md`**: You _must_ read this when working on portable entity
contracts and API behavior compatibility.

**`docs/api/endpoints.md`**: You _must_ read this when working on API-adjacent migration behavior
and import/export endpoint expectations.

**`docs/ARCHITECTURE.md`**: You _must_ read this when working on cross-layer changes touching PCD
lifecycle, cache compilation, or sync flows.
