# PCD Data Migration Phase 2: Business Logic Research

## Overview

This document researches the business logic, user stories, domain model, and conversion workflows
required to build a SQL-to-YAML converter/exporter tool. The tool reads entities from a compiled PCD
cache (populated by existing SQL ops) and writes individual YAML/JSON entity files to an `entities/`
directory, enabling PCD repositories to migrate from opaque SQL seed files to human-readable,
diffable YAML authoring. The foundation infrastructure (migration reader, portable types, serialize,
deserialize, validate) is already in place; the remaining work is orchestrating the conversion
pipeline and verifying round-trip parity.

---

## 1. User Stories

### 1.1 PCD Repository Maintainers

**As a PCD repository maintainer**, I want to convert my existing SQL seed data (`0.rosettarr.sql`
and incremental ops) into individual YAML entity files so that:

- I can review, edit, and diff entity definitions in a human-readable format instead of 25,000+
  lines of raw SQL.
- Pull requests that add or modify a single custom format touch exactly one file rather than
  appending to a monolithic SQL file.
- New contributors can understand the database structure without SQL expertise.
- Git blame shows the history of each entity individually rather than collapsed into batch commits.

### 1.2 Praxrr Developers

**As a Praxrr developer**, I want a verified conversion tool that proves round-trip parity so that:

- The migration from SQL-only to hybrid YAML/SQL is safe and reversible.
- The hybrid ingestion mode (`pcdMigrationIngestionMode: 'hybrid'`) can be promoted from
  experimental to default with confidence.
- I can validate that no data is lost or semantically changed during the format conversion.
- The existing value-guard, op-history, and conflict-detection systems remain functional after the
  format change.

### 1.3 End Users (Praxrr Application Users)

**As a Praxrr user**, I want the PCD database to continue working identically regardless of whether
the upstream repo uses SQL or YAML format so that:

- My synced quality profiles, custom formats, and media management settings are unaffected.
- User ops (local overrides) continue to apply correctly on top of the new base layer format.
- No manual intervention is required when the upstream PCD repo transitions formats.

---

## 2. Business Rules

### 2.1 Completeness

- Every entity present in the compiled cache after executing all SQL ops must have a corresponding
  YAML file in the `entities/` directory. No entity may be silently dropped.
- Entity types covered: `regular_expression`, `custom_format`, `quality_profile`, `delay_profile`,
  `radarr_naming`, `sonarr_naming`, `lidarr_naming`, `radarr_media_settings`,
  `sonarr_media_settings`, `lidarr_media_settings`, `radarr_quality_definitions`,
  `sonarr_quality_definitions`, `lidarr_quality_definitions`, `lidarr_metadata_profile`.

### 2.2 File Naming

- Entity files must use slugified kebab-case names derived from the entity name.
- The slugification function already exists in the exporter
  (`/packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`, line 91): lowercase, replace
  non-alphanumeric sequences with hyphens, strip leading/trailing hyphens, truncate to 60 chars.
- File extension must be `.yaml` (preferred) or `.json`.
- Examples: entity name `"Not Original"` becomes `entities/custom-formats/not-original.yaml`; entity
  name `"1080p Balanced Tier 1"` becomes `entities/custom-formats/1080p-balanced-tier-1.yaml`.

### 2.3 Directory Structure

The directory layout must match what the migration reader expects (defined in `ENTITY_FORMAT_BY_DIR`
and `ENTITY_FORMAT_BY_MEDIA_DIR` in `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`):

```
entities/
  tags.yaml                          # flat list of all tag names
  quality-api-mappings.yaml          # flat mapping table
  regular-expressions/
    {slugified-name}.yaml
  custom-formats/
    {slugified-name}.yaml
  quality-profiles/
    {slugified-name}.yaml
  delay-profiles/
    {slugified-name}.yaml
  media-management/
    radarr-naming/
      {slugified-name}.yaml
    sonarr-naming/
      {slugified-name}.yaml
    lidarr-naming/
      {slugified-name}.yaml
    radarr-media-settings/
      {slugified-name}.yaml
    sonarr-media-settings/
      {slugified-name}.yaml
    lidarr-media-settings/
      {slugified-name}.yaml
    radarr-quality-definitions/
      {slugified-name}.yaml
    sonarr-quality-definitions/
      {slugified-name}.yaml
    lidarr-quality-definitions/
      {slugified-name}.yaml
  metadata-profiles/
    lidarr/
      {slugified-name}.yaml
```

### 2.4 Idempotency

- Running the converter twice on the same compiled cache must produce byte-identical output files.
- This requires deterministic ordering of all list fields (tags sorted alphabetically, conditions in
  stable order, custom format scores sorted by `arrType` then `customFormatName`, quality definition
  entries in original order, ordered items by position).

### 2.5 Round-Trip Parity

The critical acceptance criterion:

```
SQL ops --> compile to cache A
              |
              v
         serialize all entities from cache A
              |
              v
         write YAML files to entities/
              |
              v
YAML files --> read via migration reader
              |
              v
         deserialize into cache B
              |
              v
         compare cache A vs cache B (must be identical)
```

Parity must hold for every table populated by entity data. Specifically:

- `tags` (row count and names)
- `regular_expressions` (all columns)
- `regular_expression_tags` (all junction rows)
- `custom_formats` (all columns)
- `custom_format_conditions` (all columns including polymorphic type data)
- `condition_patterns`, `condition_languages`, `condition_sources`, `condition_resolutions`,
  `condition_quality_modifiers`, `condition_release_types`, `condition_indexer_flags`,
  `condition_sizes`, `condition_years` (all polymorphic condition sub-tables)
- `custom_format_tags` (all junction rows)
- `custom_format_tests` (all test rows)
- `quality_profiles` (all columns)
- `quality_groups` (all groups and membership)
- `quality_group_members` (all members)
- `quality_profile_qualities` (all quality entries with position, enabled, upgrade_until)
- `quality_profile_tags` (all junction rows)
- `quality_profile_languages` (all language assignments)
- `quality_profile_custom_formats` (all score entries with arr_type scoping)
- `delay_profiles` (all columns)
- All naming tables (`radarr_naming`, `sonarr_naming`, `lidarr_naming`)
- All media settings tables (`radarr_media_settings`, `sonarr_media_settings`,
  `lidarr_media_settings`)
- All quality definition tables and their entries
- `lidarr_metadata_profiles` and child tables (`lidarr_metadata_profile_primary_types`,
  `lidarr_metadata_profile_secondary_types`, `lidarr_metadata_profile_release_statuses`)

### 2.6 Autoincrement IDs Are Not Compared

- `id` columns (autoincrement) will differ between cache A and cache B since deserialization creates
  new rows. Parity comparison must ignore autoincrement `id` values and compare on name-based keys
  and data columns only.

### 2.7 Seed Data Handling

Three data categories require special treatment because they are not one-entity-per-file:

1. **Tags**: Exported as a flat list in `entities/tags.yaml` containing all tag names. Tags are
   referenced by entities via junction tables. The reader currently flags `tags.yaml` as a "known
   non-entity top-level file" that is "not yet mapped to portable entity import" (line 81 of
   `reader.ts`). The converter must generate this file, and the reader must be extended to process
   it.

2. **Quality API Mappings**: Exported as a flat mapping file at
   `entities/quality-api-mappings.yaml`. Same reader gap as tags. Maps quality names to arr-specific
   API names. Currently seeded by `2.qualities.sql` in the schema layer.

3. **Languages**: Seeded by `1.languages.sql` in the schema layer (`packages/praxrr-schema/ops/`).
   Languages are part of the schema dependency, not the PCD data layer. They should NOT be included
   in the entities export because they are owned by `praxrr-schema`, not `praxrr-db`.

### 2.8 Schema Layer vs Data Layer Boundary

- The schema layer (`packages/praxrr-schema/ops/`) owns: DDL, languages, qualities,
  quality_api_mappings.
- The data layer (`packages/praxrr-db/ops/` and future `entities/`) owns: tags, regular expressions,
  custom formats, quality profiles, delay profiles, naming configs, media settings, quality
  definitions, metadata profiles.
- The converter must only export data-layer entities. Schema-layer seed data (languages, qualities)
  is not in scope.

### 2.9 Incremental Ops Compatibility

- Existing numbered SQL ops in `ops/` (e.g., `1.update-include-amzn-custom-format-in-renames.sql`
  through `49.*.sql` and `55-56.*.sql`) represent incremental mutations applied after the seed.
- After conversion, the `0.rosettarr.sql` seed file becomes redundant (replaced by `entities/`).
- Incremental SQL ops that modify entities already represented in YAML create a conflict:
  - During transition, both SQL ops and YAML entities must coexist. The `importBaseOps` function
    already validates stable-identity conflicts between SQL and migration sources (lines 149-212 of
    `importBaseOps.ts`).
  - After full migration, incremental ops that modify seed-layer entities should be "absorbed" into
    the YAML files (since the YAML represents the final state, not the history).
  - Incremental ops that create entirely new entities post-seed can remain as SQL or be converted to
    new YAML files.

### 2.10 Value Guards and Op History

- The conversion tool itself does not interact with value guards or op history. It operates purely
  on the compiled cache (read-only) and writes files to disk.
- Value guards and op history apply at compile time when the YAML entities are ingested back through
  the hybrid import pipeline. The existing `importBaseOps` with `hybrid` mode handles this via
  `validateStableIdentityConflicts`.
- User ops (local overrides) are not affected by the conversion. They continue to be applied as the
  `user` layer after the base layer, regardless of whether base is SQL or YAML.

---

## 3. Workflows

### 3.1 One-Time Conversion Workflow

**Purpose**: Convert an existing SQL-only PCD repository to hybrid YAML format.

**Steps**:

1. **Compile the existing SQL ops** into an in-memory cache using the standard pipeline (schema
   layer from `deps/schema/ops`, base layer from `ops/`, tweaks, user ops).

2. **Enumerate all entities** from the compiled cache by querying each entity table for names:
   - `SELECT name FROM tags ORDER BY name`
   - `SELECT name FROM regular_expressions ORDER BY name`
   - `SELECT name FROM custom_formats ORDER BY name`
   - `SELECT name FROM quality_profiles ORDER BY name`
   - `SELECT name FROM delay_profiles ORDER BY name`
   - `SELECT name FROM radarr_naming ORDER BY name`
   - `SELECT name FROM sonarr_naming ORDER BY name`
   - `SELECT name FROM lidarr_naming ORDER BY name`
   - `SELECT name FROM radarr_media_settings ORDER BY name`
   - `SELECT name FROM sonarr_media_settings ORDER BY name`
   - `SELECT name FROM lidarr_media_settings ORDER BY name`
   - `SELECT name FROM radarr_quality_definitions ORDER BY name` (via quality defs config)
   - `SELECT name FROM sonarr_quality_definitions ORDER BY name`
   - `SELECT name FROM lidarr_quality_definitions ORDER BY name`
   - `SELECT name FROM lidarr_metadata_profiles ORDER BY name`
   - `SELECT name FROM quality_api_mappings` (grouped by quality_name)

3. **Serialize each entity** to portable format using the existing `serialize.ts` functions. Each
   serializer reads the full entity graph from the cache (e.g., `serializeCustomFormat` reads the
   format row, tags, conditions with their polymorphic sub-table data, and tests).

4. **Write YAML files** to the `entities/` directory following the naming and structure conventions
   in section 2.3. Each file contains the portable format data, optionally with a `migration`
   metadata block.

5. **Write seed data files**: `entities/tags.yaml` with all tag names,
   `entities/quality-api-mappings.yaml` with all mapping rows.

6. **Verify round-trip parity** (see section 3.2).

7. **Remove or deprecate `0.rosettarr.sql`** once parity is confirmed.

8. **Absorb incremental ops** that modify seed entities into the YAML files (the YAML already
   reflects the final compiled state including all incremental mutations).

### 3.2 Verification Workflow

**Purpose**: Prove that the conversion is lossless.

**Steps**:

1. **Build Cache A** from existing SQL ops (the "before" state).

2. **Run the converter** to produce `entities/` files from Cache A.

3. **Build Cache B** from:
   - Schema layer (same as Cache A).
   - YAML entity files via the hybrid migration reader (replaces the SQL seed).
   - Any remaining incremental SQL ops that were not absorbed.

4. **Deep compare Cache A vs Cache B**:
   - For each table, query all rows ordered by primary key columns (excluding autoincrement `id`).
   - Compare row-by-row, column-by-column.
   - Report any differences with table name, row key, column name, and values A vs B.
   - Autoincrement `id` columns and timestamp columns (`created_at`, `updated_at`) are excluded from
     comparison.

5. **Success criteria**: Zero differences across all compared tables.

### 3.3 Rollback Strategy

- **Low risk**: The converter only creates files in a new `entities/` directory. It does not modify
  existing SQL files.
- **Rollback**: Delete the `entities/` directory and set `pcdMigrationIngestionMode` back to
  `sql-only`. The existing SQL ops continue to work unchanged.
- **Partial rollback**: The hybrid mode already supports coexistence of SQL ops and YAML entities.
  If specific entities have conversion issues, those entities can remain as SQL while others are
  YAML.

### 3.4 Incremental vs Big-Bang Migration

**Recommended approach: Big-bang with verification gate**.

- The converter produces all YAML files in one pass from the fully compiled cache (which includes
  all incremental ops applied). This is a "big-bang" conversion of the seed layer.
- The verification workflow (section 3.2) acts as the quality gate.
- Incremental migration (converting one entity type at a time) is unnecessarily complex because:
  - The stable-identity conflict detection in `importBaseOps` would reject entities that appear in
    both SQL and YAML sources.
  - Partial conversion requires careful tracking of which entities are in which format.
- Big-bang is safe because the conversion is purely additive (new files only) and fully reversible
  (delete new files).

---

## 4. Domain Concepts

### 4.1 Entity Type Hierarchy

```
Independent Entities (no FK dependencies on other data-layer entities):
  - tags                          # Simple name-only list
  - regular_expressions           # Pattern + description + tag refs
  - delay_profiles                # Standalone protocol/delay config

Dependent Entities (reference independent entities):
  - custom_formats                # References regular_expressions (via conditions),
                                  # references tags (via junction table)
  - quality_profiles              # References custom_formats (via scores),
                                  # references qualities (via ordered items),
                                  # references tags, languages

Arr-Scoped Media Management (standalone per arr_type):
  - radarr_naming, sonarr_naming, lidarr_naming
  - radarr_media_settings, sonarr_media_settings, lidarr_media_settings
  - radarr_quality_definitions, sonarr_quality_definitions, lidarr_quality_definitions

Metadata Profiles (Lidarr-specific):
  - lidarr_metadata_profile       # With child type/status tables
```

### 4.2 Compound Entity Structures

**Custom Format** is the most complex entity, spanning up to 11 tables:

- `custom_formats` (core row)
- `custom_format_tags` (junction to `tags`)
- `custom_format_conditions` (polymorphic condition header)
- `condition_patterns` (release_title, release_group, edition conditions)
- `condition_languages` (language conditions with except flag)
- `condition_sources` (source conditions)
- `condition_resolutions` (resolution conditions)
- `condition_quality_modifiers` (quality modifier conditions)
- `condition_release_types` (release type conditions)
- `condition_indexer_flags` (indexer flag conditions)
- `condition_sizes` (size range conditions)
- `condition_years` (year range conditions)
- `custom_format_tests` (test cases for parser validation)

The `ConditionData` interface (from `display.ts`) captures all polymorphic condition data in a
single structure with type-specific optional fields (`patterns`, `languages`, `sources`,
`resolutions`, `qualityModifiers`, `releaseTypes`, `indexerFlags`, `size`, `years`).

**Quality Profile** spans 6+ tables:

- `quality_profiles` (core row with scoring thresholds)
- `quality_profile_tags` (junction to `tags`)
- `quality_profile_languages` (language assignment)
- `quality_profile_qualities` (ordered quality/group entries with position, enabled, upgradeUntil)
- `quality_groups` + `quality_group_members` (when `orderedItems[].type === 'group'`)
- `quality_profile_custom_formats` (CF scores scoped by `arr_type`: `radarr`, `sonarr`, or `all`)

The `OrderedItem` interface captures the quality ordering with optional `members` for groups. The
`PortableCustomFormatScore` captures arr-scoped scoring.

**Lidarr Metadata Profile** has child tables:

- `lidarr_metadata_profiles` (core row)
- `lidarr_metadata_profile_primary_types` (album types)
- `lidarr_metadata_profile_secondary_types` (album sub-types)
- `lidarr_metadata_profile_release_statuses` (release statuses)

### 4.3 Junction Table Data

Junction tables map many-to-many relationships. In the portable format, these are represented as
arrays within the parent entity:

| Junction Table                   | Parent Portable Field                       | Contains                      |
| -------------------------------- | ------------------------------------------- | ----------------------------- |
| `regular_expression_tags`        | `PortableRegularExpression.tags`            | `string[]` of tag names       |
| `custom_format_tags`             | `PortableCustomFormat.tags`                 | `string[]` of tag names       |
| `quality_profile_tags`           | `PortableQualityProfile.tags`               | `string[]` of tag names       |
| `quality_profile_custom_formats` | `PortableQualityProfile.customFormatScores` | `PortableCustomFormatScore[]` |
| `quality_profile_languages`      | `PortableQualityProfile.language`           | `string \| null`              |
| `quality_group_members`          | `OrderedItem.members`                       | `QualityMember[]`             |

Tags referenced by entities may not all appear in entity junction tables. Some tags exist in the
`tags` table without any entity references. The `tags.yaml` seed file must include all tags from the
`tags` table, not just those referenced by entities.

### 4.4 Base Ops vs User Ops

- **Base ops** (`origin: 'base'`): Sourced from the PCD repository. Represent the published
  canonical state. The converter reads the final compiled state (all base ops applied) and
  serializes it.
- **User ops** (`origin: 'user'`): Local overrides made by the Praxrr user. These are NOT part of
  the conversion. User ops continue to be stored in `pcd_ops` and applied after the base layer
  during compilation.
- The converter exports only the base-layer state. User modifications are transparent to the
  conversion process.

### 4.5 The Role of `0.rosettarr.sql`

`0.rosettarr.sql` is the ~25,000-line initial seed file generated from an earlier YAML-to-SQL
conversion. It contains all INSERT statements for the initial PCD state. After conversion:

- `0.rosettarr.sql` is replaced by the `entities/` directory.
- The hybrid import mode reads entities from `entities/` and ingests them as base ops via the
  deserializer pipeline (each entity becomes SQL operations through the existing writer/create
  functions).
- Numbered incremental ops (`1.*.sql` through `49.*.sql`, `55-56.*.sql`) that modify seed entities
  are absorbed into the YAML (since the converter serializes the final compiled state). Incremental
  ops that create new entities post-seed are either converted to YAML files or remain as SQL if they
  represent truly incremental changes.

### 4.6 Dependency Ordering for Deserialization

When re-importing YAML entities, they must be deserialized in FK-safe order:

1. Tags (no dependencies)
2. Regular expressions (depend on tags via junction)
3. Custom formats (depend on regular expressions via condition patterns, depend on tags)
4. Quality profiles (depend on custom formats via scores, depend on qualities, tags, languages)
5. Delay profiles (no data-layer dependencies)
6. Media management entities (no data-layer dependencies)
7. Metadata profiles (no data-layer dependencies)

The migration reader returns candidates in alphabetical path order. The ingestion layer must
topologically sort by entity type before deserialization.

---

## 5. Existing Codebase Integration

### 5.1 Serialize Pipeline (Cache to Portable)

All serializers exist and are production-tested (used by clone and API export):

| Entity Type                  | Serializer Function                 | File               |
| ---------------------------- | ----------------------------------- | ------------------ |
| `delay_profile`              | `serializeDelayProfile`             | `serialize.ts:33`  |
| `regular_expression`         | `serializeRegularExpression`        | `serialize.ts:52`  |
| `custom_format`              | `serializeCustomFormat`             | `serialize.ts:84`  |
| `quality_profile`            | `serializeQualityProfile`           | `serialize.ts:125` |
| `radarr_naming`              | `serializeRadarrNaming`             | `serialize.ts:180` |
| `sonarr_naming`              | `serializeSonarrNaming`             | `serialize.ts:194` |
| `radarr_media_settings`      | `serializeRadarrMediaSettings`      | `serialize.ts:217` |
| `sonarr_media_settings`      | `serializeSonarrMediaSettings`      | `serialize.ts:228` |
| `lidarr_media_settings`      | `serializeLidarrMediaSettings`      | `serialize.ts:239` |
| `radarr_quality_definitions` | `serializeRadarrQualityDefinitions` | `serialize.ts:257` |
| `sonarr_quality_definitions` | `serializeSonarrQualityDefinitions` | `serialize.ts:270` |
| `lidarr_quality_definitions` | `serializeLidarrQualityDefinitions` | `serialize.ts:283` |
| `lidarr_metadata_profile`    | `serializeLidarrMetadataProfile`    | `serialize.ts:300` |

Note: `serializeLidarrNaming` is missing from `serialize.ts` but exists in the export API endpoint
(`/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`, line 95). The converter will need a
lidarr naming serializer in `serialize.ts` or must reuse the export endpoint's implementation.

### 5.2 Deserialize Pipeline (Portable to Cache)

All deserializers exist and handle the full entity creation flow:

- `deserialize.ts` provides `getEntityDeserializer(entityType)` which returns a function accepting
  `{ databaseId, cache, layer, data }`.
- Each deserializer calls the existing entity create functions (e.g., `cfQueries.create`,
  `qpQueries.create`, `qpQueries.updateQualities`, `qpQueries.updateScoring`).
- The `ENTITY_DESERIALIZERS` map covers all 14 entity types.

### 5.3 Migration Reader (YAML/JSON to Candidates)

The reader (`reader.ts`) is fully operational:

- Recursively walks the `entities/` directory.
- Infers entity type from directory path.
- Parses YAML/JSON.
- Validates portable data via `validatePortableData`.
- Returns `MigrationEntityCandidate[]` with stable identity, entity type, and deserializer ref.
- Correctly handles: `tags.yaml` and `quality-api-mappings.yaml` as "known non-entity files" (not
  yet mapped to import).

### 5.4 Hybrid Import Pipeline

`importBaseOps.ts` already handles hybrid mode:

- When `pcdMigrationIngestionMode === 'hybrid'`, it reads migration entity sources alongside SQL
  ops.
- It validates stable-identity conflicts across SQL and migration sources.
- The cross-source conflict check prevents the same entity from appearing in both SQL ops and YAML
  files (which is exactly what we need to ensure a clean transition).

### 5.5 Components to Build

| Component                     | Purpose                                                            | Depends On                          |
| ----------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| Entity enumerator             | Lists all entity names by type from compiled cache                 | Cache query API                     |
| YAML writer                   | Writes portable data as YAML files with proper directory structure | `yaml` package (stringify), slugify |
| Tags exporter                 | Exports all tags to `tags.yaml`                                    | Cache query API                     |
| Quality API mappings exporter | Exports all mappings to `quality-api-mappings.yaml`                | Cache query API                     |
| Migration metadata injector   | Adds `migration:` block to each YAML file                          | `portable.ts` constants             |
| Round-trip verifier           | Compares two compiled caches table-by-table                        | Cache query API                     |
| Converter orchestrator        | Coordinates enumerate, serialize, write, verify                    | All above                           |

### 5.6 Existing Slugify Function

The exporter (`exporter.ts`, line 91) has a `slugify` function:

```typescript
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'export-batch';
}
```

This should be extracted to a shared utility for reuse by the converter. The fallback name
`'export-batch'` should be changed to something entity-specific (e.g., `'unnamed-entity'`).

---

## 6. Success Criteria

### 6.1 Functional Criteria

- [ ] All entities in the compiled cache produce valid YAML files.
- [ ] YAML files pass validation via `validatePortableData` for their entity type.
- [ ] YAML files are parseable by the migration reader and produce valid `MigrationEntityCandidate`
      objects.
- [ ] Round-trip parity verified: SQL compile --> serialize --> YAML --> read --> deserialize -->
      compile produces identical cache state (excluding autoincrement IDs and timestamps).
- [ ] The converter is idempotent: running twice produces identical output.

### 6.2 Structural Criteria

- [ ] Directory structure matches the reader's `ENTITY_FORMAT_BY_DIR` and
      `ENTITY_FORMAT_BY_MEDIA_DIR` mappings.
- [ ] File names are slugified and unique within each directory.
- [ ] No file name collisions (two entities with names that slugify identically).
- [ ] Tags and quality API mappings are exported as separate seed files.

### 6.3 Integration Criteria

- [ ] The hybrid import pipeline (`importBaseOps` with `hybrid` mode) successfully ingests the
      generated YAML files.
- [ ] No stable-identity conflicts between remaining SQL ops and YAML entities.
- [ ] User ops continue to apply correctly on the YAML-based base layer.
- [ ] The `pcdMigrationAllowLegacyFallback` flag correctly falls back to SQL-only mode if YAML
      ingestion fails.

---

## 7. Open Questions

### 7.1 Tag and Quality API Mapping Ingestion

The migration reader currently flags `tags.yaml` and `quality-api-mappings.yaml` as known non-entity
files (line 81 of `reader.ts`). The converter will generate these files, but the reader and import
pipeline need to be extended to actually process them. Should this be done as part of this phase, or
deferred?

**Recommendation**: Must be done in this phase. Without tag ingestion, entities that reference tags
will fail FK constraints during deserialization. Tags must be imported before any entity that
references them.

### 7.2 Quality API Mappings Ownership

Quality API mappings are currently seeded by `2.qualities.sql` in the schema layer
(`praxrr-schema`). If they are exported to `entities/quality-api-mappings.yaml` in the data layer
(`praxrr-db`), there is a dual-ownership risk. Should the data layer export them, or should they
remain schema-owned?

**Recommendation**: Quality API mappings should remain schema-owned. The converter should not export
them. If the PCD data layer needs custom mappings, that is a separate concern.

### 7.3 Absorbed Incremental Ops

After conversion, incremental SQL ops (e.g.,
`6.create-add-not-original-cf-to-profiles-sonarr-side.sql`) that modified seed entities are
semantically redundant because the YAML reflects the final state. Should these ops be:

- (a) Removed from the `ops/` directory entirely?
- (b) Kept for historical reference but excluded from compilation (e.g., moved to an `archive/`
  directory)?
- (c) Left in place with the stable-identity conflict check preventing double-application?

**Recommendation**: Option (a) for a clean transition. The git history preserves the ops. Keeping
them would require special handling to avoid stable-identity conflicts. The conversion represents a
"squash" of all seed + incremental ops into the YAML format.

### 7.4 Lidarr Naming Serializer Gap

The `serialize.ts` module has serializers for `radarr_naming` and `sonarr_naming` but not
`lidarr_naming`. The export API endpoint has a custom `serializeLidarrNaming` function. Should this
be moved to `serialize.ts` for consistency?

**Recommendation**: Yes. All entity serializers should live in `serialize.ts` for the converter to
have a single, consistent entry point.

### 7.5 Converter as CLI Tool vs Runtime Feature

Should the converter be:

- (a) A standalone Deno script invoked manually (`deno task convert-to-yaml`)?
- (b) An API endpoint accessible from the Praxrr UI?
- (c) An automatic step in the PCD compile pipeline?

**Recommendation**: Option (a) for the initial implementation. This is a one-time migration tool for
PCD maintainers, not a runtime feature. It should be a script in `scripts/` that accepts a PCD path
and output directory.

---

## 8. Relevant Files

- `/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: All entity serializers (cache to
  portable format)
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: All entity deserializers
  (portable to cache via create functions)
- `/packages/praxrr-app/src/lib/server/pcd/entities/validate.ts`: Portable data validation per
  entity type
- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: YAML/JSON entity file reader with
  path-to-type resolution
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: Hybrid SQL + migration entity
  import with conflict detection
- `/packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`: Existing slugify function and SQL
  export flow
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: In-memory SQLite cache build pipeline
- `/packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`: Cache compile and swap
  orchestration
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: PCD lifecycle orchestration with hybrid
  fallback
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`: Portable type contracts and migration
  metadata
- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: ConditionData, OrderedItem,
  QualityDefinitionEntry types
- `/packages/praxrr-app/src/lib/server/pcd/entities/clone.ts`: Serialize-rename-deserialize flow
  (pattern reference)
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: API export endpoint (includes
  lidarr naming serializer)
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/list.ts`: CF entity enumeration
  pattern
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts`: QP entity enumeration
  pattern
- `/packages/praxrr-app/src/lib/server/pcd/entities/regularExpressions/read.ts`: Regex entity
  enumeration pattern
- `/packages/praxrr-db/ops/0.rosettarr.sql`: Existing SQL seed file (target for replacement)
- `/packages/praxrr-db/pcd.json`: PCD manifest
- `/packages/praxrr-schema/ops/0.schema.sql`: Schema DDL defining all tables
- `/packages/praxrr-schema/ops/1.languages.sql`: Schema-owned language seed data
- `/packages/praxrr-schema/ops/2.qualities.sql`: Schema-owned quality + API mapping seed data
- `/research/data-schema/synthesis/technical-design.md`: Technical design for hybrid system (entity
  format examples)
- `/docs/plans/pcd-data-migration/shared.md`: Phase 1 migration research context
- `/packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`: Existing hybrid
  fallback test
