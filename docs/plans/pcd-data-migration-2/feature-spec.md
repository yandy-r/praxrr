# Feature Spec: PCD Data Migration Phase 2 — SQL to YAML Entity Conversion

## Executive Summary

This feature builds a converter tool and parity verification system that transforms existing
SQL-based PCD operations (the 1.4MB `0.rosettarr.sql` seed and 56+ incremental migration files) into
individual, human-readable YAML entity files organized in the directory structure the hybrid
migration reader already expects. The existing foundation infrastructure — migration reader
(`reader.ts`), portable types (`portable.ts`), serialize/deserialize pipeline, value guard gates,
and hybrid ingestion mode in `importBaseOps` — is fully operational; the remaining work is the
actual extraction (compile cache → serialize all ~760 entities → write YAML files) and round-trip
parity proof (YAML → re-import → compile → diff against SQL-compiled cache). The primary risks are
the missing `serializeLidarrNaming` function (currently inlined in the export API route with a
non-obvious Sonarr-to-Lidarr field mapping), entity creation ordering during re-import (FK
constraints require type-based dependency sorting), and orphan tag handling (tags embedded in entity
payloads, not exported as standalone seed data).

## External Dependencies

### APIs and Services

No external APIs are required. This feature is entirely internal tooling.

### Libraries and SDKs

| Library              | Version          | Purpose                                 | Installation                         |
| -------------------- | ---------------- | --------------------------------------- | ------------------------------------ |
| `yaml` (npm)         | Already imported | YAML parse/stringify for entity files   | Already a dependency via `reader.ts` |
| `@std/assert` (Deno) | Already imported | Test assertions for parity verification | Already a dependency                 |

### External Documentation

- [yaml npm package stringify API](https://eemeli.org/yaml/#yaml-stringify): YAML `stringify()`
  options for deterministic output formatting, scalar quoting, and key ordering.
- [TRaSH Guides config structure](https://trash-guides.info/): Reference for config-as-code
  directory layout conventions in the Arr ecosystem.
- [Recyclarr config schema](https://recyclarr.dev/wiki/yaml/config-reference/): Reference for YAML
  entity file format patterns.

## Business Requirements

### User Stories

**Primary User: PCD Repository Maintainer**

- As a PCD maintainer, I want to convert my SQL seed data into individual YAML entity files so that
  I can review, edit, and diff entity definitions in a human-readable format instead of 25,000+
  lines of raw SQL.
- As a PCD maintainer, I want PRs that modify a single custom format to touch exactly one file
  rather than appending to a monolithic SQL file.
- As a PCD maintainer, I want the converter to be idempotent so that running it twice produces
  byte-identical output.

**Secondary User: Praxrr Developer**

- As a developer, I want a verified parity proof so that the migration from SQL-only to hybrid YAML
  is demonstrably lossless.
- As a developer, I want the parity verifier to run in CI so that regressions in the YAML output are
  caught automatically.

**End User: Praxrr Application User**

- As a user, I want the PCD to continue working identically regardless of whether the upstream repo
  uses SQL or YAML so that my synced profiles and overrides are unaffected.

### Business Rules

1. **Completeness**: Every entity in the compiled cache must have a corresponding YAML file. All 14
   entity types must be covered: `regular_expression`, `custom_format`, `quality_profile`,
   `delay_profile`, `radarr_naming`, `sonarr_naming`, `lidarr_naming`, `radarr_media_settings`,
   `sonarr_media_settings`, `lidarr_media_settings`, `radarr_quality_definitions`,
   `sonarr_quality_definitions`, `lidarr_quality_definitions`, `lidarr_metadata_profile`.
   - Validation: parity verifier confirms zero missing entities.

2. **Idempotency**: Running the converter twice on the same compiled cache must produce
   byte-identical output.
   - Validation: deterministic YAML formatting with sorted lists and stable key ordering.

3. **Round-trip parity**: SQL compile → serialize → YAML → read → deserialize → compile must produce
   identical cache state (excluding autoincrement IDs and timestamps).
   - Validation: parity verifier compares 37 entity tables row-by-row.

4. **Directory structure conformance**: Output must match `reader.ts` `ENTITY_FORMAT_BY_DIR` and
   `ENTITY_FORMAT_BY_MEDIA_DIR` mappings exactly.
   - Exception: `tags.yaml` and `quality-api-mappings.yaml` are recognized non-entity files.

5. **Schema/data layer boundary**: Languages, qualities, and quality_api_mappings remain
   schema-layer SQL (`praxrr-schema`). The converter exports only PCD data-layer entities.

6. **Big-bang migration**: The converter serializes the final compiled state (all SQL ops applied).
   Incremental ops are "absorbed" into YAML files. The stable-identity conflict detection in
   `importBaseOps` prevents dual-source operation, making incremental conversion unnecessarily
   complex.

### Edge Cases

| Scenario                              | Expected Behavior                                         | Notes                                 |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------- |
| Entity name produces duplicate slug   | Append numeric suffix (`-2`, `-3`)                        | Extremely rare given current dataset  |
| Regex pattern with YAML-special chars | `yaml` library auto-quotes; converter verifies round-trip | Built-in round-trip verification step |
| Orphan tags (no entity references)    | Lost during conversion (intentional pruning)              | Parity verifier accounts for this     |
| Entity with null description          | Emit `null` explicitly in YAML                            | Matches portable type contract        |
| Empty conditions/tests arrays         | Emit `[]` in YAML                                         | Flow style for readability            |
| Quality profile with 100+ CF scores   | Single YAML file (~200-300 lines)                         | Within parser limits                  |
| Lidarr naming entities (if absent)    | No files produced for that type                           | Converter handles empty entity lists  |

### Success Criteria

- [ ] All entities produce valid, parseable YAML files
- [ ] YAML files pass `validatePortableData` for their entity type
- [ ] Round-trip parity: zero differences across 37 entity tables
- [ ] Converter is idempotent (identical output on repeat runs)
- [ ] No stable-identity conflicts between remaining SQL ops and YAML entities
- [ ] Hybrid import pipeline successfully ingests generated YAML files
- [ ] User ops continue to apply correctly on YAML-based base layer

## Technical Specifications

### Architecture Overview

```
SQL ops (0.rosettarr.sql + 1-56.*.sql)
        |
        v
  compile --> PCDCache (in-memory SQLite)
                  |
                  v
         [Converter enumerates entities by type]
                  |
                  v
         serialize*(cache, name) --> PortableType
                  |
                  v
         formatYaml(portable, migration) --> string
                  |
                  v
         writeFile(entities/<dir>/<slug>.yaml)
                  |
                  v
  [Parity Verifier reads entity files back]
                  |
                  v
         readMigrationEntitySources() --> candidates
                  |
                  v
         deserialize*(cache, portable) --> SQL ops
                  |
                  v
         compile --> PCDCache B
                  |
                  v
         compareSnapshot(A, B) --> ParityReport
```

### Data Models

#### Entity File Format

Each YAML file contains the portable type payload with an optional `migration` metadata block:

```yaml
migration:
  format: yaml
  version: 1
  source: pcd-export
name: Entity Name
# ... entity-type-specific fields matching portable type ...
```

#### Entity Directory Structure

```
<pcd-root>/entities/
  regular-expressions/<slug>.yaml
  custom-formats/<slug>.yaml
  quality-profiles/<slug>.yaml
  delay-profiles/<slug>.yaml
  media-management/
    radarr-naming/<slug>.yaml
    sonarr-naming/<slug>.yaml
    lidarr-naming/<slug>.yaml
    radarr-media-settings/<slug>.yaml
    sonarr-media-settings/<slug>.yaml
    lidarr-media-settings/<slug>.yaml
    radarr-quality-definitions/<slug>.yaml
    sonarr-quality-definitions/<slug>.yaml
    lidarr-quality-definitions/<slug>.yaml
  metadata-profiles/
    lidarr/<slug>.yaml
```

#### Entity Type to Serializer/Directory Mapping

| EntityType                   | Serializer                          | Directory                                      | Stable Key                        |
| ---------------------------- | ----------------------------------- | ---------------------------------------------- | --------------------------------- |
| `delay_profile`              | `serializeDelayProfile`             | `delay-profiles/`                              | `delay_profile_name`              |
| `regular_expression`         | `serializeRegularExpression`        | `regular-expressions/`                         | `regular_expression_name`         |
| `custom_format`              | `serializeCustomFormat`             | `custom-formats/`                              | `custom_format_name`              |
| `quality_profile`            | `serializeQualityProfile`           | `quality-profiles/`                            | `quality_profile_name`            |
| `radarr_naming`              | `serializeRadarrNaming`             | `media-management/radarr-naming/`              | `radarr_naming_name`              |
| `sonarr_naming`              | `serializeSonarrNaming`             | `media-management/sonarr-naming/`              | `sonarr_naming_name`              |
| `lidarr_naming`              | **Missing — must add**              | `media-management/lidarr-naming/`              | `lidarr_naming_name`              |
| `radarr_media_settings`      | `serializeRadarrMediaSettings`      | `media-management/radarr-media-settings/`      | `radarr_media_settings_name`      |
| `sonarr_media_settings`      | `serializeSonarrMediaSettings`      | `media-management/sonarr-media-settings/`      | `sonarr_media_settings_name`      |
| `lidarr_media_settings`      | `serializeLidarrMediaSettings`      | `media-management/lidarr-media-settings/`      | `lidarr_media_settings_name`      |
| `radarr_quality_definitions` | `serializeRadarrQualityDefinitions` | `media-management/radarr-quality-definitions/` | `radarr_quality_definitions_name` |
| `sonarr_quality_definitions` | `serializeSonarrQualityDefinitions` | `media-management/sonarr-quality-definitions/` | `sonarr_quality_definitions_name` |
| `lidarr_quality_definitions` | `serializeLidarrQualityDefinitions` | `media-management/lidarr-quality-definitions/` | `lidarr_quality_definitions_name` |
| `lidarr_metadata_profile`    | `serializeLidarrMetadataProfile`    | `metadata-profiles/lidarr/`                    | `metadata_profile_name`           |

#### Parity Comparison Model

```typescript
interface ParityDiff {
  table: string;
  kind: 'missing_in_b' | 'missing_in_a' | 'field_mismatch';
  naturalKey: Record<string, unknown>;
  field?: string;
  valueA?: unknown;
  valueB?: unknown;
}

interface ParityReport {
  pass: boolean;
  tablesCompared: number;
  totalRowsA: number;
  totalRowsB: number;
  diffs: ParityDiff[];
}
```

**37 tables compared** (excluding autoincrement `id`, `created_at`, `updated_at` columns): `tags`,
`regular_expressions`, `regular_expression_tags`, `custom_formats`, `custom_format_tags`,
`custom_format_conditions`, `condition_patterns`, `condition_languages`, `condition_sources`,
`condition_resolutions`, `condition_quality_modifiers`, `condition_release_types`,
`condition_indexer_flags`, `condition_sizes`, `condition_years`, `custom_format_tests`,
`quality_profiles`, `quality_profile_tags`, `quality_profile_languages`, `quality_groups`,
`quality_group_members`, `quality_profile_qualities`, `quality_profile_custom_formats`,
`delay_profiles`, `radarr_naming`, `sonarr_naming`, `lidarr_naming`, `radarr_media_settings`,
`sonarr_media_settings`, `lidarr_media_settings`, `radarr_quality_definitions`,
`sonarr_quality_definitions`, `lidarr_quality_definitions`, `lidarr_metadata_profiles`,
`lidarr_metadata_profile_primary_types`, `lidarr_metadata_profile_secondary_types`,
`lidarr_metadata_profile_release_statuses`.

### System Integration

#### Files to Create

| File                                                                 | Purpose                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/pcd/migration/converter.ts`      | Core converter: enumerate, serialize, format, write              |
| `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts` | Build two caches, compare snapshots table-by-table               |
| `packages/praxrr-app/src/lib/server/pcd/migration/slug.ts`           | Entity name → filename slug utility (extract from `exporter.ts`) |
| `packages/praxrr-app/src/lib/server/pcd/migration/yamlFormatter.ts`  | Deterministic YAML output with proper quoting/ordering           |
| `scripts/convert-pcd-to-yaml.ts`                                     | CLI entry point: `deno task convert:pcd-entities`                |
| `scripts/verify-pcd-parity.ts`                                       | CLI entry point: `deno task verify:pcd-parity`                   |
| `packages/praxrr-app/src/tests/pcd/migration/converter.test.ts`      | Unit tests for converter                                         |
| `packages/praxrr-app/src/tests/pcd/migration/parityVerifier.test.ts` | Parity verification tests                                        |
| `packages/praxrr-app/src/tests/pcd/migration/slug.test.ts`           | Slug function tests                                              |

#### Files to Modify

| File                                                           | Change                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts` | Add `serializeLidarrNaming` (move from export route)               |
| `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`  | Refactor to use shared `serializeLidarrNaming` from `serialize.ts` |
| `deno.json`                                                    | Add `convert:pcd-entities` and `verify:pcd-parity` task aliases    |

#### Configuration

- `--pcd-path`: Path to cloned PCD repository (required for converter)
- `--output-dir`: Output directory for entity files (default: `<pcd-path>/entities/`)
- `--format`: Output format `yaml` or `json` (default: `yaml`)
- `--entity-type`: Optional filter to convert one entity type at a time
- `--strict`: Exit non-zero on parity mismatch (for CI)
- `--dry-run`: Preview conversion without writing files

## UX Considerations

### User Workflows

#### Primary Workflow: One-Time Conversion

1. **Run converter**: `deno task convert:pcd-entities --pcd-path ./packages/praxrr-db`
   - System: Compiles SQL ops, enumerates entities, writes YAML files with progress reporting
2. **Review output**: Inspect generated YAML files in `entities/` directory
   - System: Summary shows counts per entity type
3. **Verify parity**: `deno task verify:pcd-parity --pcd-path ./packages/praxrr-db`
   - System: Compiles both SQL and YAML sources, reports row-by-row diff
4. **Commit**: Replace `ops/0.rosettarr.sql` with `entities/` directory

#### Error Recovery Workflow

1. **Error occurs**: Entity serialization failure for specific entity
2. **User sees**: Entity name, type, and error message with file path context
3. **Recovery**: Fix underlying serialization issue, re-run converter (other entities unaffected)

### CLI UX Patterns

- **Progress**: Per-entity-type progress (`Converting custom-formats: 187/187`)
- **Summary**: Final table with counts (converted, skipped, failed per type)
- **Dry-run**: `--dry-run` lists what would be generated without writing
- **Verbose**: `--verbose` shows individual file paths; quiet mode shows summary only
- **Exit codes**: 0 = success, 1 = conversion errors, 2 = parity failures

### YAML Authoring Experience

- Deterministic key ordering matching portable type field order
- `null` values explicit (not omitted)
- Sorted tag arrays for diffability
- Single-quoted regex patterns to avoid backslash double-escaping
- Block scalar style for multi-line descriptions (`>-`)
- Flow style for empty arrays (`[]`)

## Recommendations

### Implementation Approach

**Recommended Strategy**: Full conversion tool (Option A) — compile cache, serialize all entities,
write YAML in one pass. Big-bang migration with parity verification as the quality gate.

**Why not incremental**: The stable-identity conflict detection in `importBaseOps` explicitly throws
when the same entity appears in both SQL and YAML sources. Partial conversion would require complex
tracking of which entities are in which format. Big-bang is safe because the conversion is purely
additive (new files) and fully reversible (delete `entities/`).

**Why not dual-source**: `validateStableIdentityConflicts` prevents it by design. Modifying that
check would weaken a safety invariant.

**Phasing:**

1. **Phase A — Serialization consolidation**: Move `serializeLidarrNaming` to `serialize.ts`,
   extract shared slug utility, add entity enumeration queries
2. **Phase B — Converter tool**: Build `scripts/convert-pcd-to-yaml.ts` with CLI args, YAML
   formatter, and per-type conversion
3. **Phase C — Parity verification**: Build `scripts/verify-pcd-parity.ts` with standalone cache
   compilation and table-by-table comparison
4. **Phase D — Non-entity seed data**: Extend reader for `tags.yaml` if needed (tags may be
   sufficient as inline arrays in entity payloads)
5. **Phase E — Integration testing**: Full round-trip tests, user ops on YAML base layer, sync
   trigger verification

### Technology Decisions

| Decision        | Recommendation                                      | Rationale                                                                         |
| --------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Output format   | YAML (default) with `--format=json` option          | Human-readable; reader supports both; matches Arr ecosystem conventions           |
| CLI framework   | Raw `Deno.args` parsing                             | Matches existing `generate-pcd-types.ts` pattern; no extra dependency             |
| Converter input | `--pcd-path` (self-contained)                       | Tooling independence from running server                                          |
| Entity ordering | Type-based dependency sorting at import time        | Reader extracts `entityType`; predefined `ENTITY_CREATION_ORDER` constant         |
| Tag handling    | Inline in entity payloads (no separate `tags.yaml`) | Tags are already embedded in portable types; orphan tags are intentionally pruned |

### Quick Wins

- Extract `slugify` from `exporter.ts` to shared utility — reusable by converter and other tools
- Move `serializeLidarrNaming` to `serialize.ts` — fixes a gap regardless of converter work

### Future Enhancements

- JSON Schema for YAML entity files (IDE autocompletion)
- YAML comments via `yaml` Document API (entity metadata, field documentation)
- CI GitHub Action for parity check on PRs touching `packages/praxrr-db/ops/`
- Converter `--entity-type` filter for per-type debugging

## Risk Assessment

### Technical Risks

| Risk                                                        | Likelihood | Impact | Mitigation                                                                 |
| ----------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------- |
| Missing `serializeLidarrNaming` serializer                  | Confirmed  | High   | Move from export route to `serialize.ts` before converter work             |
| Regex YAML quoting failures                                 | Medium     | High   | Built-in round-trip verification: parse → stringify → re-parse → compare   |
| Entity creation ordering (FK violations)                    | High       | High   | Type-based dependency sorting in import pipeline (`ENTITY_CREATION_ORDER`) |
| `PortableLidarrNaming = PortableSonarrNaming` type mismatch | Medium     | Medium | Investigate `createLidarrNaming` field mapping before converting           |
| Orphan tags lost during conversion                          | Confirmed  | Low    | Intentional pruning; parity verifier accounts for tag subset               |
| Content hash change triggers full orphan+recreate cycle     | Confirmed  | Low    | Expected behavior; parity verifier confirms final state matches            |

### Integration Challenges

- **Parity verifier needs standalone cache builder**: Cannot use full `PCDManager/compile` pipeline
  (depends on `pcd_ops` table and app state). Must build lightweight in-memory caches directly from
  SQL/entity files.
- **`importBaseOps` does not yet persist migration entities**: Current hybrid path validates
  conflicts but does not write YAML-sourced entities to `pcd_ops`. Phase D integration requires
  adding deserialization + persistence step.

### Security Considerations

- No external API calls or user input parsing. Converter reads local SQL files and writes local YAML
  files.
- YAML parsing uses the existing `yaml` library already trusted in the codebase.

## Task Breakdown Preview

### Phase A: Serialization Consolidation

**Focus**: Fix gaps and extract shared utilities before building the converter **Tasks**:

- Move `serializeLidarrNaming` and `serializeLidarrQualityDefinitions` from export route to
  `serialize.ts`
- Extract `slugify` to `packages/praxrr-app/src/lib/server/pcd/migration/slug.ts`
- Add entity name enumeration queries (list all names per type from cache)
- Investigate `PortableLidarrNaming` type alias vs actual schema columns **Parallelization**: Slug
  extraction and serializer consolidation can run in parallel

### Phase B: Converter Tool

**Focus**: Build the core conversion script **Dependencies**: Phase A must complete first **Tasks**:

- Create `converter.ts` with entity enumeration, serialization, YAML formatting
- Create `yamlFormatter.ts` with deterministic output options
- Create `scripts/convert-pcd-to-yaml.ts` CLI entry point
- Add `deno task convert:pcd-entities` to `deno.json`
- Unit tests for converter and slug functions

### Phase C: Parity Verification

**Focus**: Prove round-trip equivalence **Dependencies**: Phase B must complete first (needs
converter output) **Tasks**:

- Create `parityVerifier.ts` with standalone cache builder and table-by-table comparison
- Create `scripts/verify-pcd-parity.ts` CLI entry point
- Add `deno task verify:pcd-parity` to `deno.json`
- Integration tests: compile SQL → convert → compile YAML → diff

### Phase D: Non-Entity Seed Data and Reader Integration

**Focus**: Handle tags and extend reader if needed **Dependencies**: Phases B and C **Tasks**:

- Determine if inline tag arrays are sufficient or if `tags.yaml` is needed
- If needed: define `PortableTagsSeed` type, extend reader, wire into import pipeline
- Add entity type dependency ordering to import pipeline (`ENTITY_CREATION_ORDER`)

### Phase E: Full Integration Testing

**Focus**: End-to-end validation in the PCDManager lifecycle **Dependencies**: All previous phases
**Tasks**:

- Test full link/sync/compile with YAML-sourced PCD
- Test user ops on YAML base layer
- Test sync triggers after hybrid import
- Runbook and documentation updates

## Decisions Needed

1. **Tag handling strategy**
   - Options: (A) Tags inline in entity payloads only (orphans pruned), (B) Separate `tags.yaml`
     seed file
   - Impact: Option A is simpler but loses orphan tags. Option B requires extending the reader.
   - Recommendation: Option A. Orphan tags serve no purpose without entity references.

2. **Incremental ops handling after conversion**
   - Options: (A) Remove all `ops/*.sql` after conversion (YAML represents final state), (B) Archive
     to `ops/archive/`, (C) Keep in place
   - Impact: Option A is cleanest. Options B/C risk stable-identity conflicts.
   - Recommendation: Option A. Git history preserves the ops.

3. **Lidarr naming portable type**
   - Options: (A) Keep `PortableLidarrNaming = PortableSonarrNaming` alias with field mapping, (B)
     Define proper `PortableLidarrNaming` with Lidarr-specific fields
   - Impact: Option A matches current export route behavior. Option B is more correct but requires
     updating deserializer.
   - Recommendation: Investigate `createLidarrNaming` first, then decide.

4. **Converter location**
   - Options: (A) `scripts/convert-pcd-to-yaml.ts` (standalone script), (B) API endpoint, (C)
     PCDManager method
   - Impact: Option A is simplest for a one-time tool.
   - Recommendation: Option A.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): YAML libraries, config-as-code patterns,
  round-trip fidelity analysis
- [research-business.md](./research-business.md): User stories, business rules, workflows, domain
  model, entity relationships
- [research-technical.md](./research-technical.md): Architecture, data models, converter design,
  parity verification, gap analysis
- [research-ux.md](./research-ux.md): CLI UX patterns, error handling, competitive analysis, YAML
  authoring experience
- [research-recommendations.md](./research-recommendations.md): Implementation approach, risk
  assessment, task breakdown, alternative approaches
