# PCD Data Migration Phase 2 - Technical Specification

The converter tool reads compiled PCD cache state, serializes all entities via the existing portable
serialization layer, writes deterministic YAML/JSON files to the directory structure expected by
`reader.ts`, and verifies round-trip parity by recompiling from entity files and comparing cache
state. Non-entity seed data (tags, languages, quality API mappings) lives in the schema layer and
does not need conversion; tags referenced by entities are embedded inline in portable payloads.

## Relevant Files

- `/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: All entity serializers (cache row
  to portable type)
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: All entity deserializers
  (portable type to SQL ops via create functions)
- `/packages/praxrr-app/src/lib/server/pcd/entities/validate.ts`: Portable data shape validators per
  entity type
- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: Reads `entities/` directory,
  resolves entity types from paths, validates payloads
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: Hybrid ingestion orchestrator with
  SQL + migration source conflict detection
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: PCDCache in-memory SQLite with Kysely
  query builder
- `/packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`: Cache compile/invalidate lifecycle
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: PCDManager lifecycle orchestration
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`: All portable type definitions and entity
  type enum
- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: Display types including `ConditionData`,
  `OrderedItem`, `QualityDefinitionEntry`
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: Operation writer with value guard gate
- `/packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`: Value guard decision engine
- `/packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts`: Existing parity test for delay
  profile round-trip
- `/packages/praxrr-schema/ops/0.schema.sql`: Full PCD cache schema (26 tables)
- `/packages/praxrr-schema/ops/1.languages.sql`: Language seed data (schema layer)
- `/packages/praxrr-schema/ops/2.qualities.sql`: Quality names and quality API mappings (schema
  layer)
- `/packages/praxrr-db/ops/0.rosettarr.sql`: 1.4MB seed with hundreds of entities (the primary
  conversion target)

## Architecture Design

### Component Overview

The conversion system has three primary components that interact with existing PCD infrastructure:

1. **Converter** (`pcd/migration/converter.ts`): Queries compiled cache for all entities, serializes
   each via existing `serialize*` functions, formats as YAML, writes to disk at paths `reader.ts`
   expects.
2. **Parity Verifier** (`pcd/migration/parityVerifier.ts`): Builds two independent cache
   compilations (SQL-only vs entity-file-only), compares table-by-table row state, reports
   differences.
3. **CLI Script** (`scripts/convert-pcd-entities.ts`): Deno CLI entry point that orchestrates
   compile, convert, verify in sequence.

### Data Flow

```
SQL ops (0.rosettarr.sql) --> compile --> PCDCache (in-memory SQLite)
                                             |
                                             v
                                    [Converter enumerates entities]
                                             |
                                             v
                               serialize*(cache, name) --> PortableType
                                             |
                                             v
                                    formatYaml(portable) --> string
                                             |
                                             v
                                    writeFile(entities/<dir>/<slug>.yaml)
                                             |
                                             v
                               [Parity Verifier reads entity files back]
                                             |
                                             v
                              readMigrationEntitySources(pcdPath) --> candidates
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

### Integration with PCDManager Lifecycle

The converter does NOT integrate with the runtime PCDManager lifecycle. It is a one-time offline
tool for PCD repository authors. The existing `importBaseOps` + `readMigrationEntitySources` hybrid
pipeline already handles the runtime ingestion of entity files -- the converter only produces the
files those paths consume.

The converter must be run as a Deno script outside the app server. It:

1. Reads the PCD repository path from CLI args
2. Compiles a standalone in-memory cache from schema + SQL ops
3. Enumerates and serializes entities
4. Writes entity files
5. Optionally runs parity verification

## Data Models

### Entity Directory Structure

The directory layout must match what `reader.ts` resolves via `ENTITY_FORMAT_BY_DIR` and
`ENTITY_FORMAT_BY_MEDIA_DIR`:

```
<pcd-root>/entities/
  regular-expressions/
    <slug>.yaml                    # EntityType: regular_expression
  custom-formats/
    <slug>.yaml                    # EntityType: custom_format
  quality-profiles/
    <slug>.yaml                    # EntityType: quality_profile
  delay-profiles/
    <slug>.yaml                    # EntityType: delay_profile
  media-management/
    radarr-naming/
      <slug>.yaml                  # EntityType: radarr_naming
    sonarr-naming/
      <slug>.yaml                  # EntityType: sonarr_naming
    lidarr-naming/
      <slug>.yaml                  # EntityType: lidarr_naming
    radarr-media-settings/
      <slug>.yaml                  # EntityType: radarr_media_settings
    sonarr-media-settings/
      <slug>.yaml                  # EntityType: sonarr_media_settings
    lidarr-media-settings/
      <slug>.yaml                  # EntityType: lidarr_media_settings
    radarr-quality-definitions/
      <slug>.yaml                  # EntityType: radarr_quality_definitions
    sonarr-quality-definitions/
      <slug>.yaml                  # EntityType: sonarr_quality_definitions
    lidarr-quality-definitions/
      <slug>.yaml                  # EntityType: lidarr_quality_definitions
  metadata-profiles/
    lidarr/
      <slug>.yaml                  # EntityType: lidarr_metadata_profile
```

### Entity File Format

Each file contains the portable type payload as YAML, with an optional `migration` metadata section
at the top level. The `reader.ts` `isolatePortablePayload` function strips the `migration` key
before passing to validation and deserialization.

Example: `entities/delay-profiles/default-usenet.yaml`

```yaml
migration:
  format: yaml
  version: 1
  source: pcd-export
name: Default Usenet
preferredProtocol: prefer_usenet
usenetDelay: 0
torrentDelay: 0
bypassIfHighestQuality: true
bypassIfAboveCfScore: false
minimumCfScore: 0
```

Example: `entities/regular-expressions/amazon-prime.yaml`

```yaml
migration:
  format: yaml
  version: 1
  source: pcd-export
name: Amazon Prime
pattern: '\b(?:AMZN|(?:AMAZON)(?=\s*.(?:WEB-?DL|WEBRIP)))\b'
tags:
  - Streaming Service
description: >-
  Amazon Prime Video, or simply Prime Video, is an American subscription video on-demand
  over-the-top streaming and rental service of Amazon offered both as a stand-alone service and as
  part of Amazon's Prime subscription.
regex101Id: null
```

Example: `entities/custom-formats/dv-hdr10plus.yaml` (compound entity)

```yaml
migration:
  format: yaml
  version: 1
  source: pcd-export
name: DV HDR10+
description: null
includeInRename: false
tags:
  - HDR
conditions:
  - name: DV HDR10+
    type: release_title
    arrType: ''
    negate: false
    required: true
    patterns:
      - name: DV HDR10+
        pattern: '\b(DV|dovi)\s*HDR10\+\b'
tests: []
```

Example: `entities/quality-profiles/1080p-quality.yaml`

```yaml
migration:
  format: yaml
  version: 1
  source: pcd-export
name: 1080p Quality
description: null
tags:
  - 1080p
  - Quality Focused
language: Any
orderedItems:
  - type: group
    name: WEB-DL 1080p
    position: 1
    enabled: true
    upgradeUntil: false
    members:
      - name: WEBDL-1080p
      - name: WEBRip-1080p
  - type: quality
    name: Bluray-1080p
    position: 2
    enabled: true
    upgradeUntil: true
minimumScore: 0
upgradeUntilScore: 10000
upgradeScoreIncrement: 1
customFormatScores:
  - customFormatName: DV HDR10+
    arrType: radarr
    score: 5000
  - customFormatName: DV HDR10+
    arrType: sonarr
    score: 5000
```

### Entity Type to Serializer and Directory Mapping

| EntityType                   | Serializer Function                 | Directory Path                                 | Stable Key                        |
| ---------------------------- | ----------------------------------- | ---------------------------------------------- | --------------------------------- |
| `delay_profile`              | `serializeDelayProfile`             | `delay-profiles/`                              | `delay_profile_name`              |
| `regular_expression`         | `serializeRegularExpression`        | `regular-expressions/`                         | `regular_expression_name`         |
| `custom_format`              | `serializeCustomFormat`             | `custom-formats/`                              | `custom_format_name`              |
| `quality_profile`            | `serializeQualityProfile`           | `quality-profiles/`                            | `quality_profile_name`            |
| `radarr_naming`              | `serializeRadarrNaming`             | `media-management/radarr-naming/`              | `radarr_naming_name`              |
| `sonarr_naming`              | `serializeSonarrNaming`             | `media-management/sonarr-naming/`              | `sonarr_naming_name`              |
| `lidarr_naming`              | N/A (see gap analysis)              | `media-management/lidarr-naming/`              | `lidarr_naming_name`              |
| `radarr_media_settings`      | `serializeRadarrMediaSettings`      | `media-management/radarr-media-settings/`      | `radarr_media_settings_name`      |
| `sonarr_media_settings`      | `serializeSonarrMediaSettings`      | `media-management/sonarr-media-settings/`      | `sonarr_media_settings_name`      |
| `lidarr_media_settings`      | `serializeLidarrMediaSettings`      | `media-management/lidarr-media-settings/`      | `lidarr_media_settings_name`      |
| `radarr_quality_definitions` | `serializeRadarrQualityDefinitions` | `media-management/radarr-quality-definitions/` | `radarr_quality_definitions_name` |
| `sonarr_quality_definitions` | `serializeSonarrQualityDefinitions` | `media-management/sonarr-quality-definitions/` | `sonarr_quality_definitions_name` |
| `lidarr_quality_definitions` | `serializeLidarrQualityDefinitions` | `media-management/lidarr-quality-definitions/` | `lidarr_quality_definitions_name` |
| `lidarr_metadata_profile`    | `serializeLidarrMetadataProfile`    | `metadata-profiles/lidarr/`                    | `metadata_profile_name`           |

### Non-Entity Seed Data Strategy

Non-entity data falls into three categories:

**1. Schema-layer data (no conversion needed)**

- **Languages**: Seeded by `packages/praxrr-schema/ops/1.languages.sql`. These are part of the
  schema dependency, not the PCD data layer. Languages are referenced by name in
  `quality_profile_languages` and `condition_languages` but are never authored in the PCD base ops.
- **Qualities and quality API mappings**: Seeded by `packages/praxrr-schema/ops/2.qualities.sql`.
  Quality names are referenced by entities but not authored in PCD base ops.

**2. Tags (implicitly preserved)**

- Tags in the current SQL seed (`0.rosettarr.sql`) are `INSERT INTO tags` statements. However, tags
  are already embedded inline in every portable entity type (e.g.,
  `PortableCustomFormat.tags: string[]`, `PortableRegularExpression.tags: string[]`). The
  deserialize path creates tags automatically when creating entities. The converter does NOT need a
  separate `tags.yaml` file.
- Verification: The parity verifier must confirm that all tags from the SQL seed appear in the
  entity-file compiled cache. Any tags not referenced by any entity would be lost -- this is
  intentional. Orphan tags are pruned.

**3. Future non-entity seed files**

- `reader.ts` already has
  `KNOWN_NON_ENTITY_TOP_LEVEL_FILES = new Set(['tags.yaml', 'quality-api-mappings.yaml'])` which
  emits a reader issue noting these are "not yet mapped to portable entity import". These are
  reserved filenames for future use.
- If a PCD needs custom quality API mappings beyond the schema defaults, a
  `quality-api-mappings.yaml` format should be defined, but this is out of scope for the initial
  converter. The existing schema layer covers all standard Radarr/Sonarr/Lidarr quality mappings.

### Batch Entity Handling

The current SQL seed (`0.rosettarr.sql`) is a single monolithic file. When queried from the compiled
cache, each entity is independent -- the serializer reads one entity at a time by name. Batch SQL
statements (e.g., multi-row inserts for tags or regex) are disaggregated during serialization since
each entity becomes its own YAML file.

Entity order dependencies are handled by the directory ordering in `reader.ts`:

1. `regular-expressions/` must be processed before `custom-formats/` (CFs reference regexes via
   `condition_patterns`)
2. `custom-formats/` must be processed before `quality-profiles/` (QPs reference CFs in scoring)
3. Tags are created inline during entity deserialization

The converter must write files in this dependency order, and `reader.ts` returns sorted candidates
which are processed in order by the deserializer.

## Converter Design

### Entity Enumeration

For each entity type, the converter queries the compiled cache to list all entity names:

```typescript
interface EntityEnumerator {
  entityType: EntityType;
  listNames(cache: PCDCache): Promise<string[]>;
  serialize(cache: PCDCache, name: string): Promise<Record<string, unknown>>;
  directoryPath: string;
}
```

Enumeration queries per entity type:

| Entity Type                  | List Query                                                           |
| ---------------------------- | -------------------------------------------------------------------- |
| `delay_profile`              | `SELECT name FROM delay_profiles ORDER BY name`                      |
| `regular_expression`         | `SELECT name FROM regular_expressions ORDER BY name`                 |
| `custom_format`              | `SELECT name FROM custom_formats ORDER BY name`                      |
| `quality_profile`            | `SELECT name FROM quality_profiles ORDER BY name`                    |
| `radarr_naming`              | `SELECT name FROM radarr_naming ORDER BY name`                       |
| `sonarr_naming`              | `SELECT name FROM sonarr_naming ORDER BY name`                       |
| `lidarr_naming`              | `SELECT name FROM lidarr_naming ORDER BY name`                       |
| `radarr_media_settings`      | `SELECT name FROM radarr_media_settings ORDER BY name`               |
| `sonarr_media_settings`      | `SELECT name FROM sonarr_media_settings ORDER BY name`               |
| `lidarr_media_settings`      | `SELECT name FROM lidarr_media_settings ORDER BY name`               |
| `radarr_quality_definitions` | `SELECT DISTINCT name FROM radarr_quality_definitions ORDER BY name` |
| `sonarr_quality_definitions` | `SELECT DISTINCT name FROM sonarr_quality_definitions ORDER BY name` |
| `lidarr_quality_definitions` | `SELECT DISTINCT name FROM lidarr_quality_definitions ORDER BY name` |
| `lidarr_metadata_profile`    | `SELECT name FROM lidarr_metadata_profiles ORDER BY name`            |

### File Naming: Slug Function

Entity names must be converted to filesystem-safe filenames. The slug function:

```typescript
function entityNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric runs with single dash
    .replace(/^-+|-+$/g, ''); // Trim leading/trailing dashes
}
```

Examples:

- `"DV HDR10+"` -> `dv-hdr10`
- `"1080p Quality"` -> `1080p-quality`
- `"Amazon Prime"` -> `amazon-prime`
- `"OGG Vorbis Q5"` -> `ogg-vorbis-q5`

Collision detection: After slugging all names in a directory, if two entities produce the same slug,
append a numeric suffix (`-2`, `-3`). This should be extremely rare given the current dataset.

### YAML Formatting

The converter must produce deterministic, human-readable YAML. Key requirements:

1. **Key ordering**: Fixed key order per entity type matching the portable interface field order
   (not alphabetical). The `migration` block always comes first.
2. **String quoting**: Use the `yaml` npm package (already a dependency via `reader.ts`) with
   `stringify` options:
   - Default scalar style: plain
   - Force flow style for empty arrays: `[]`
   - Force block style for non-empty arrays
   - Quote strings that contain YAML-special characters: `{`, `}`, `[`, `]`, `:`, `#`, `&`, `*`,
     `!`, `|`, `>`, `'`, `"`, `%`, `@`, `` ` ``
3. **Regex patterns**: Patterns containing backslashes, brackets, and special chars must be
   single-quoted in YAML. The `yaml` library handles this with `defaultStringType: QUOTE_SINGLE`
   when needed.
4. **Null values**: Emit `null` explicitly rather than omitting keys, to match the portable type
   contracts where fields are typed as `T | null`.
5. **Boolean values**: Emit as `true`/`false` (YAML 1.2 style), never `yes`/`no`.
6. **Numbers**: Emit as plain scalars.

Configuration for `yaml.stringify`:

```typescript
import { stringify } from 'yaml';

function formatEntityYaml(
  portable: Record<string, unknown>,
  migration: PortableMigrationMetadata
): string {
  const document = { migration, ...portable };
  return stringify(document, {
    lineWidth: 120,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
    nullStr: 'null',
    trueStr: 'true',
    falseStr: 'false',
    sortMapEntries: false, // Preserve insertion order
  });
}
```

Note: The exact `yaml` stringify options should be tuned during implementation to produce readable
output. The `defaultStringType` for patterns should be `QUOTE_SINGLE` to handle regex backslashes
without double-escaping.

### Converter Processing Order

The converter must process entity types in dependency order to match the implicit ordering that
`reader.ts` and deserializers expect:

1. `regular_expression` (no dependencies)
2. `custom_format` (depends on: `regular_expression` via `condition_patterns`)
3. `quality_profile` (depends on: `custom_format` via `quality_profile_custom_formats`, `qualities`
   via quality items)
4. `delay_profile` (no entity dependencies)
5. `radarr_naming`, `sonarr_naming`, `lidarr_naming` (no entity dependencies)
6. `radarr_media_settings`, `sonarr_media_settings`, `lidarr_media_settings` (no entity
   dependencies)
7. `radarr_quality_definitions`, `sonarr_quality_definitions`, `lidarr_quality_definitions` (no
   entity dependencies -- quality names come from schema layer)
8. `lidarr_metadata_profile` (no entity dependencies)

This order matters for the parity verifier's deserialization pass, not for the converter itself
(which reads from a fully compiled cache).

### Converter Output Summary

After writing all files, the converter should log a summary:

```
Converter complete:
  regular-expressions: 342 files
  custom-formats: 187 files
  quality-profiles: 14 files
  delay-profiles: 1 file
  media-management: 6 files
  metadata-profiles: 1 file
  Total: 551 files written to <pcd-path>/entities/
```

## Parity Verification Design

### Verification Algorithm

```
Phase 1: Build SQL-only cache (State A)
  1. Load schema ops from deps/schema/ops/
  2. Load base SQL ops from ops/ (SQL files only)
  3. Compile in-memory cache
  4. Snapshot all entity tables

Phase 2: Build entity-file cache (State B)
  1. Load schema ops from deps/schema/ops/
  2. Read entity files via readMigrationEntitySources()
  3. For each candidate: deserialize into fresh cache
  4. Snapshot all entity tables

Phase 3: Compare
  1. For each entity table, compare row sets
  2. Report exact field-level differences
  3. Return pass/fail with detailed diff
```

### Tables to Snapshot

The parity verifier must compare all entity data tables. Schema-layer tables (languages, qualities,
quality_api_mappings) are seeded identically in both compilations and should be verified as baseline
equality.

**Entity tables** (must match exactly):

- `tags`
- `regular_expressions`
- `regular_expression_tags`
- `custom_formats`
- `custom_format_tags`
- `custom_format_conditions`
- `condition_patterns`
- `condition_languages`
- `condition_sources`
- `condition_resolutions`
- `condition_quality_modifiers`
- `condition_release_types`
- `condition_indexer_flags`
- `condition_sizes`
- `condition_years`
- `custom_format_tests`
- `quality_profiles`
- `quality_profile_tags`
- `quality_profile_languages`
- `quality_groups`
- `quality_group_members`
- `quality_profile_qualities`
- `quality_profile_custom_formats`
- `delay_profiles`
- `radarr_naming`
- `sonarr_naming`
- `lidarr_naming`
- `radarr_media_settings`
- `sonarr_media_settings`
- `lidarr_media_settings`
- `radarr_quality_definitions`
- `sonarr_quality_definitions`
- `lidarr_quality_definitions`
- `lidarr_metadata_profiles`
- `lidarr_metadata_profile_primary_types`
- `lidarr_metadata_profile_secondary_types`
- `lidarr_metadata_profile_release_statuses`

**Excluded from comparison** (auto-generated or schema-only):

- `id` columns (autoincrement IDs will differ between compilations)
- `created_at`, `updated_at` columns (timestamps will differ)

### Snapshot Strategy

For each table, the verifier:

1. Queries all rows with `SELECT * FROM <table> ORDER BY <primary_key_columns>`
2. Strips `id`, `created_at`, `updated_at` columns
3. Normalizes boolean integers (`0`/`1`) to consistent numeric representation
4. Sorts rows by natural key columns for stable comparison

### Comparison Output

```typescript
interface ParityDiff {
  table: string;
  kind: 'missing_in_b' | 'missing_in_a' | 'field_mismatch';
  naturalKey: Record<string, unknown>; // e.g., { name: 'DV HDR10+' }
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

Example output on failure:

```
PARITY FAILED: 3 differences found

  custom_format_conditions:
    MISSING_IN_B: { custom_format_name: "DV HDR10+", name: "Source Check" }

  quality_profile_custom_formats:
    FIELD_MISMATCH: { quality_profile_name: "1080p Quality", custom_format_name: "x265", arr_type: "radarr" }
      score: 15000 (A) vs 14000 (B)
```

### Parity Verifier Architecture

The verifier cannot use the full `importBaseOps` + `compile` pipeline because that requires a real
`pcd_ops` database table. Instead, it must:

1. For State A: Build a standalone PCDCache by directly loading schema SQL files + base SQL ops from
   disk, executing them in order against an in-memory SQLite (bypassing the `pcd_ops` table
   entirely).
2. For State B: Build a standalone PCDCache with schema SQL files only, then deserialize each entity
   candidate from the reader into the cache using the entity create functions.

This means the verifier needs a lightweight standalone cache builder that does not depend on
`pcd_ops` or `databaseInstancesQueries`.

```typescript
async function buildStandaloneCacheFromSql(
  schemaPath: string,
  sqlFilePaths: string[]
): Promise<PCDCacheLike> {
  // Create in-memory SQLite
  // Execute schema ops
  // Execute each SQL file in order
  // Return Kysely-wrapped handle
}

async function buildStandaloneCacheFromEntities(
  schemaPath: string,
  candidates: MigrationEntityCandidate[]
): Promise<PCDCacheLike> {
  // Create in-memory SQLite
  // Execute schema ops
  // For each candidate in order:
  //   candidate.deserialize({ databaseId: 0, cache, layer: 'base', data: candidate.portable })
  // Return Kysely-wrapped handle
}
```

## System Constraints

### Scale Requirements

- The `0.rosettarr.sql` seed contains ~25,000 lines of SQL and produces ~342 regular expressions,
  ~187 custom formats, ~14 quality profiles, plus media management and delay profile entities.
- Total output: approximately 550+ YAML files.
- Expected converter runtime: under 10 seconds on modern hardware (serialization is I/O-bound by
  file writes, not computation).

### YAML Readability

- Entity files should be individually viewable and editable by PCD authors in a text editor.
- Regex patterns must survive YAML round-trip without modification. The `yaml` library's
  `QUOTE_SINGLE` string type preserves backslashes without double-escaping.
- Multi-line descriptions should use YAML block scalar style (`>-` or `|`) for readability.

### Diffability

- Deterministic key ordering ensures `git diff` shows meaningful changes.
- One entity per file means file-level diffs correspond to entity-level changes.
- Tags arrays are sorted alphabetically by the serializer.
- `customFormatScores` arrays are sorted by `customFormatName` then `arrType`.
- `conditions` arrays maintain their database ordering (by condition name).

### Entity Relationship Preservation

- **CF conditions reference regex names**: The `condition_patterns` table uses
  `regular_expression_name` which is preserved in the portable `ConditionData.patterns[].name`
  field. The deserializer recreates this FK relationship.
- **QP references CF names**: The `quality_profile_custom_formats` table uses `custom_format_name`
  which is preserved in `PortableCustomFormatScore.customFormatName`. The deserializer recreates
  this FK.
- **QP references quality names**: Quality names come from the schema layer (`qualities` table). The
  portable `OrderedItem.name` and group member names reference these.
- **Tags**: Created inline. If a tag does not exist, the entity create function creates it.

## Codebase Analysis: Gaps and Required Changes

### Missing Serializer: `lidarr_naming`

The `serialize.ts` file has no `serializeLidarrNaming` function. The lidarr naming table schema
(`lidarr_naming`) has different columns than sonarr naming (it has `standard_track_format`,
`artist_name`, `multi_disc_track_format`, `artist_folder_format` instead of episode/series/season
formats). However, looking at the portable type: `PortableLidarrNaming = PortableSonarrNaming`. This
indicates lidarr naming currently reuses the sonarr naming portable shape.

The converter needs a `serializeLidarrNaming` function. However, this depends on whether lidarr
naming rows actually exist in the compiled cache (they are only created by built-in base ops from
recent migrations). If no lidarr naming rows exist in a given PCD, the converter simply produces no
files for that type.

**Required**: Add `serializeLidarrNaming` to `serialize.ts`. Check the actual `lidarr_naming` table
schema to determine the correct field mapping. The schema shows lidarr_naming has fields: `name`,
`rename`, `standard_track_format`, `artist_name`, `multi_disc_track_format`, `artist_folder_format`,
`replace_illegal_characters`, `colon_replacement_format`, `custom_colon_replacement_format`. This
does NOT match `PortableSonarrNaming` -- this is a potential portable type gap. The current
`PortableLidarrNaming = PortableSonarrNaming` alias may be incorrect for the actual lidarr_naming
schema. This needs investigation before the converter can handle lidarr naming.

### Missing Entity List Queries

The existing entity query modules (`index.ts` files) primarily have `getByName` functions but not
bulk `listAllNames` functions for all types. The converter needs enumeration queries.

For most entity types, a simple `SELECT name FROM <table> ORDER BY name` suffices. These queries can
be added inline to the converter rather than modifying existing entity query modules.

For quality definitions, the table uses a composite key `(name, quality_name)` so enumeration is
`SELECT DISTINCT name FROM <table> ORDER BY name`.

### `reader.ts` Metadata-profiles Path

The reader already handles `metadata-profiles/lidarr/<file>` paths (line 283-289 in reader.ts). No
changes needed.

### Validation Coverage

`validatePortableData` covers all 14 entity types. No new validators are needed for the converter --
the parity verifier will use the same validation through `readMigrationEntitySources`.

### Deserialization Coverage

`deserialize.ts` has deserializers for all 14 entity types. The `ENTITY_DESERIALIZERS` map is
complete. No gaps for the parity verifier.

## Files to Create

| File Path                                                            | Purpose                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/pcd/migration/converter.ts`      | Core converter: enumerate, serialize, format, write      |
| `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts` | Parity verification: build two caches, compare snapshots |
| `packages/praxrr-app/src/lib/server/pcd/migration/slug.ts`           | Entity name to filename slug utility                     |
| `packages/praxrr-app/src/lib/server/pcd/migration/yamlFormatter.ts`  | Deterministic YAML output formatting                     |
| `packages/praxrr-app/scripts/convert-pcd-entities.ts`                | CLI entry point for running conversion                   |
| `packages/praxrr-app/src/tests/pcd/migration/converter.test.ts`      | Unit tests for converter functions                       |
| `packages/praxrr-app/src/tests/pcd/migration/parityVerifier.test.ts` | Parity verification integration tests                    |
| `packages/praxrr-app/src/tests/pcd/migration/slug.test.ts`           | Slug function unit tests                                 |

## Files to Modify

| File Path                                                      | Change                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts` | Add `serializeLidarrNaming` function (pending schema investigation) |
| `packages/praxrr-app/deno.json`                                | Add `convert:pcd-entities` task alias                               |

## Technical Decisions

### YAML over JSON

YAML is preferred for entity files because:

1. Human-readable without tooling
2. Multi-line strings (descriptions, regex patterns) are natively supported
3. Comments can be added by PCD authors for documentation
4. Smaller file size due to no structural punctuation
5. The `reader.ts` already supports both YAML and JSON; YAML is the primary format

### One File Per Entity (Not Batched)

Each entity gets its own file for several reasons:

1. Git diffs show exactly which entity changed
2. PCD authors can add/remove/modify individual entities
3. File naming maps directly to entity names for discoverability
4. The reader already processes files individually
5. Conflict resolution in git is simpler with separate files

### Migration Metadata on Every File

Every file includes the `migration` block because:

1. `reader.ts` calls `resolveMigrationMetadata` which sets `source: entities/<relativePath>`
2. The metadata documents the file's origin and format version
3. Future schema evolution can use `version` for migration path decisions
4. `PORTABLE_MIGRATION_SOURCE_EXPORT = 'pcd-export'` is already defined for this purpose

### Tags Not Exported Separately

Tags are embedded in entity payloads, not in a standalone `tags.yaml`. This means:

- Tags that exist only as standalone rows (not referenced by any entity) will be lost during
  conversion. This is considered intentional pruning of orphan tags.
- The parity verifier must account for this: the tag table comparison should only check tags that
  are referenced by at least one entity.

### Standalone Cache for Parity Verification

The parity verifier builds its own in-memory caches rather than using the full PCDManager/compile
pipeline. This avoids:

- Dependency on the app database (`pcd_ops` table)
- Side effects from conflict resolution, history tracking, or auto-align
- Need for a running app server

## Open Questions

1. **Lidarr naming portable type mismatch**: `PortableLidarrNaming = PortableSonarrNaming` but the
   actual `lidarr_naming` schema has different columns (`standard_track_format`, `artist_name`,
   etc.). Should a new `PortableLidarrNaming` type be defined, or is the current type alias
   intentional? If lidarr naming was backfilled from the sonarr naming create path, the portable
   type may be correct at the SQL op level even though the schema differs. This needs investigation
   of the `createLidarrNaming` function in
   `packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/naming/create.ts`.

2. **Test entities and test releases**: The schema has `test_entities` and `test_releases` tables.
   These are used for quality profile testing but are not part of the portable entity types
   (`ENTITY_TYPES` does not include them). Should the converter handle these? They are not
   entity-file candidates in `reader.ts`. Current recommendation: exclude from initial converter
   scope.

3. **Built-in base ops**: The `seedBuiltInBaseOps.ts` registers several operations (lidarr media
   management defaults, quality mappings, naming defaults, metadata profiles). When converting a PCD
   that has received these seeds, should the converter serialize the resulting entities even though
   they came from built-in ops rather than the PCD's own SQL? Recommendation: yes, serialize
   everything in the cache -- the source of the data is irrelevant to the entity files.

4. **Incremental migration files**: The `packages/praxrr-db/ops/` directory has 56+ numbered SQL
   files that incrementally modify the rosettarr seed. The converter reads from the final compiled
   cache state (after all ops are applied), so incremental files do not need individual conversion.
   However, the parity verifier's State A must apply ALL SQL ops (0 through 56) to match the cache
   state. The converter should document which SQL ops were compiled.

5. **Custom format conditions with `arr_type` scoping**: Some conditions have `arr_type = 'radarr'`
   or `arr_type = 'sonarr'`. The `ConditionData` type includes `arrType: ArrType | ''`. The
   serializer already handles this via `getConditionsForEvaluation`. No special handling needed, but
   the parity verifier must compare `custom_format_conditions.arr_type` values exactly.
