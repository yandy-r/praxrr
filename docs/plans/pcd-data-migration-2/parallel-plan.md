# pcd-data-migration-2 Implementation Plan

This feature converts SQL-compiled PCD state into deterministic `entities/*` YAML files and proves
round-trip parity by recompiling from those files and diffing cache state. The implementation must
reuse the existing portable serialization/deserialization boundary so API export/import and hybrid
`importBaseOps` behavior stay aligned without duplicating field mappings. Work is structured to
unlock parallel delivery across serializer cleanup, deterministic formatting, converter/parity core
modules, and CLI/test integration while enforcing strict dependency annotations. The plan
prioritizes deterministic output, strict conflict detection, and table-level parity verification
across all covered entity families.

## Critically Relevant Files and Documentation

- `docs/plans/pcd-data-migration-2/shared.md`: canonical context for scope, tables, lifecycle
  boundaries, and required docs.
- `docs/plans/pcd-data-migration-2/feature-spec.md`: acceptance criteria, CLI expectations, and
  parity/idempotency constraints.
- `docs/plans/pcd-data-migration-2/research-technical.md`: technical blueprint for converter/parity
  architecture and entity ordering.
- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: source-of-truth entity
  serializers, including required Lidarr naming extraction.
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: current portable export path that
  must stay contract-aligned.
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: directory/type mapping and
  validation rules for migration files.
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: hybrid ingestion flow and
  stable-identity conflict guardrails.
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: cache lifecycle and in-memory compile
  substrate used by converter/parity tools.
- `packages/praxrr-db/ops/0.rosettarr.sql`: canonical SQL seed source converted to portable
  entities.
- `deno.json`: task wiring for converter/parity CLI entry points.

## Implementation Plan

### Phase 1: Serialization and Determinism Foundations

#### Task 1.1: Extract Shared Lidarr Naming Serializer Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`
- `docs/plans/pcd-data-migration-2/research-technical.md`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`

Move Lidarr naming mapping logic out of the export route and into `serialize.ts` as a first-class
shared serializer. Keep field mapping Arr-specific and fail-fast on missing Lidarr fields rather
than applying fallback assumptions. Update export route usage to call the shared serializer so
converter and API exports share one contract boundary.

#### Task 1.2: Add Reusable Slug Utility for Migration Paths Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`
- `docs/plans/pcd-data-migration-2/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pcd/migration/slug.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`

Implement a shared `entityNameToSlug` helper in `pcd/migration` and update exporter usage to consume
it. Preserve deterministic normalization rules and collision-suffix behavior required by migration
file generation. Keep the helper pure so converter and parity modules can import it without runtime
side effects.

#### Task 1.3: Implement Deterministic YAML Formatting Helper Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`
- `docs/plans/pcd-data-migration-2/feature-spec.md`
- `docs/plans/pcd-data-migration-2/research-ux.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pcd/migration/yamlFormatter.ts`

Files to Modify

- None

Create a formatter that emits deterministic YAML with stable key ordering, explicit null handling,
and consistent scalar/list styles suitable for byte-identical reruns. Include support for migration
metadata block insertion (`format`, `version`, `source`) without mutating portable payload
semantics. Keep formatting defaults strict and avoid optional fallback output modes in this
foundational helper.

#### Task 1.4: Add Entity Enumeration Helpers with Stable Ordering Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`
- `docs/plans/pcd-data-migration-2/research-technical.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pcd/migration/enumerateEntities.ts`

Files to Modify

- None

Add cache-query helpers that enumerate each supported entity family in deterministic order
(name-sorted, dependency-aware family sequence). Return strongly typed descriptors needed by
converter/parity workflows, including entity type, source table family, and stable key identity.
Ensure ordering matches reader import expectations to minimize false parity diffs.

### Phase 2: Converter and CLI Delivery

#### Task 2.1: Implement Cache-to-Entity Converter Core Depends on [1.1, 1.2, 1.3, 1.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`
- `docs/plans/pcd-data-migration-2/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pcd/migration/converter.ts`

Files to Modify

- None

Implement converter orchestration that compiles/enumerates source state, serializes each entity via
shared serializers, formats payloads with `yamlFormatter`, and maps output paths to the reader
directory contract. Define and implement
`convertCompiledCacheToEntities(options: ConvertOptions): Promise<ConvertReport>` with
`ConvertOptions` fields `cache`, `outputDir`, `format`, `overwrite`, `entityTypes`, and
`includeMigrationMetadata`. Enforce write policy explicitly: fail if `outputDir` exists and
`overwrite=false`; if `overwrite=true`, only replace files under managed entity directories and
never delete unknown files. Surface strict typed errors with an explicit taxonomy
(`ConverterConfigError`, `ConverterSerializationError`, `ConverterWriteError`) so CLI handling is
deterministic.

#### Task 2.2: Add Converter CLI Entry and Task Wiring Depends on [2.1]

**READ THESE BEFORE TASK**

- `scripts/generate-pcd-types.ts`
- `deno.json`
- `docs/plans/pcd-data-migration-2/feature-spec.md`

**Instructions**

Files to Create

- `scripts/convert-pcd-to-yaml.ts`

Files to Modify

- `deno.json`

Create CLI argument parsing for `--pcd-path` (required), `--output-dir` (default
`<pcd-path>/entities`), `--format` (`yaml|json`, default `yaml`), `--entity-type` (repeatable),
`--overwrite` (default `false`), `--dry-run` (default `false`), `--strict` (default `false`), and
`--verbose` (default `false`), then delegate conversion to `converter.ts`. Add a
`deno task convert:pcd-entities` entry with these defaults documented in command help. Enforce exit
semantics: `0` success, `2` usage/validation error, `3` overwrite or path-conflict error, `1`
unexpected internal error.

#### Task 2.3: Add Converter Determinism and Layout Tests Depends on [2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts`
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`
- `docs/plans/pcd-data-migration-2/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/pcd/migration/converter.test.ts`

Files to Modify

- None

Add focused tests that verify deterministic output ordering, valid directory placement, and
parseability through `reader.ts` expectations. Include idempotency checks that run conversion twice
against the same source and assert byte-identical file outputs. Keep fixtures minimal and
table-focused to avoid brittle snapshot noise.

### Phase 3: Parity Verification and Integration Hardening

#### Task 3.1: Implement SQL-vs-Entity Parity Verifier Core Depends on [2.1, 1.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`
- `docs/plans/pcd-data-migration-2/research-technical.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`

Files to Modify

- None

Build parity verification that compiles two isolated caches (SQL source and generated entity
source), snapshots the required comparison tables, normalizes non-deterministic columns, and
produces actionable diffs. Use this explicit allowlist only: `tags`, `regular_expressions`,
`regular_expression_tags`, `custom_formats`, `custom_format_conditions`, `condition_patterns`,
`condition_languages`, `condition_sources`, `condition_resolutions`, `condition_quality_modifiers`,
`condition_release_types`, `condition_indexer_flags`, `condition_sizes`, `condition_years`,
`custom_format_tags`, `custom_format_tests`, `quality_profiles`, `quality_groups`,
`quality_group_members`, `quality_profile_qualities`, `quality_profile_tags`,
`quality_profile_languages`, `quality_profile_custom_formats`, `delay_profiles`, `radarr_naming`,
`sonarr_naming`, `lidarr_naming`, `radarr_media_settings`, `sonarr_media_settings`,
`lidarr_media_settings`, `radarr_quality_definitions`, `sonarr_quality_definitions`,
`lidarr_quality_definitions`, `lidarr_metadata_profiles`, `lidarr_metadata_profile_primary_types`,
`lidarr_metadata_profile_secondary_types`, `lidarr_metadata_profile_release_statuses`. Apply this
normalization matrix: drop `id`/`created_at`/`updated_at` for all tables when present; normalize
booleans to `0|1`; normalize numeric-like strings to canonical numeric types; sort rows by stable
keys (`name` for root entity tables, table-specific composite keys for join tables, and `position`
where ordering is semantic). Fail fast if any allowlisted table is missing from either snapshot.
Keep result models machine-readable for CI and human-readable for local debugging.

#### Task 3.2: Add Parity CLI Entry and Task Wiring Depends on [2.2, 3.1]

**READ THESE BEFORE TASK**

- `scripts/convert-pcd-to-yaml.ts`
- `deno.json`
- `docs/plans/pcd-data-migration-2/feature-spec.md`

**Instructions**

Files to Create

- `scripts/verify-pcd-parity.ts`

Files to Modify

- `deno.json`

Implement parity CLI execution with strict exit behavior for CI and concise diff summaries for local
use. Support `--pcd-path` (required), `--entities-dir` (default `<pcd-path>/entities`), `--strict`
(default `true` for this command), `--format` (`text|json`, default `text`), and `--verbose`
(default `false`). Add `deno task verify:pcd-parity` and ensure it can run independently after
conversion output exists. Reuse shared argument parsing conventions from the converter CLI and
enforce exit semantics: `0` parity pass, `2` parity mismatch, `3` usage/validation error, `1`
unexpected internal error.

#### Task 3.3: Add End-to-End Migration Parity Tests Depends on [2.3, 3.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts`
- `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`
- `docs/plans/pcd-data-migration-2/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/pcd/migration/parityVerifier.test.ts`

Files to Modify

- `packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts`

Add integration-focused tests that execute conversion -> reader ingestion -> parity comparison and
assert no semantic drift across supported entity families. Extend existing migration parity coverage
to assert table-level reporting, mismatch diagnostics, and strict-mode failure paths. Keep test
setup deterministic and scoped to representative fixtures so CI runtime remains bounded.

## Advice

- Treat `serialize.ts` as the single contract source and avoid adding converter-only mapping
  branches; every duplicated mapping becomes a parity risk.
- Keep slug and YAML formatting helpers pure and deterministic before writing converter/parity
  logic, because these utilities are the highest fan-out dependency.
- Do not expand scope into `tags.yaml` or `quality-api-mappings.yaml` ingestion during this feature
  unless explicitly re-scoped, since current reader behavior marks those as non-entity files.
- Build parity output models first (table, key, column, expected, actual) so both CLI UX and tests
  consume one stable diagnostics format.
- Prefer wide execution in Phase 1 and Phase 3: independent helper/test work can proceed in parallel
  while converter core remains the central gated dependency.
