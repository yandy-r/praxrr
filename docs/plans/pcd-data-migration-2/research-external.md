# External API Research: pcd-data-migration-2

## Executive Summary

The PCD data migration conversion tooling needs three primary capabilities: (1) reading compiled
entity state from the in-memory SQLite cache via the existing Kysely-backed serialization layer, (2)
writing deterministic YAML files using the `yaml` npm package (v2.8.x, already a project dependency)
with `sortMapEntries` and controlled string quoting, and (3) verifying round-trip parity by
re-importing produced entity files through the existing migration reader/deserializer pipeline and
comparing compiled cache snapshots via content hashing. No new external dependencies are required
beyond what the project already uses; the `yaml` package, `crypto.subtle` Web API, and Deno
filesystem primitives cover all needs.

---

## Primary APIs

### 1. SQLite In-Memory Cache (Kysely via @soapbox/kysely-deno-sqlite)

- **Documentation**: [Kysely docs](https://kysely.dev/docs/getting-started) |
  [@soapbox/kysely-deno-sqlite JSR](https://jsr.io/@soapbox/kysely-deno-sqlite)
- **Authentication**: N/A (in-process, no network)
- **Already used by**: `$pcd/database/cache.ts`, all entity read/write modules
- **Key Query Patterns**:
  - `selectFrom('table').selectAll().execute()` for bulk entity enumeration
  - `selectFrom('table').select([...columns]).where('name', '=', name).executeTakeFirst()` for
    single entity reads
  - Join queries for junction tables (tags, conditions, scores, quality groups)
- **Introspection**: Standard SQLite PRAGMAs work through the raw query interface:
  - `PRAGMA table_list` (SQLite 3.37+) lists all tables with schema info
  - `PRAGMA table_info('table_name')` returns column metadata (cid, name, type, notnull, dflt_value,
    pk)
  - `SELECT name FROM sqlite_master WHERE type='table'` as fallback for older versions
- **Constraints**: All queries execute synchronously against the in-memory database; no I/O latency.
  The compiled cache is read-only for extraction purposes.

**Confidence**: High -- the project already uses this exact stack in `serialize.ts` for entity
export.

### 2. YAML Serialization (yaml npm package v2.8.x)

- **Documentation**: [eemeli.org/yaml](https://eemeli.org/yaml/) |
  [npm: yaml](https://www.npmjs.com/package/yaml) |
  [GitHub options docs](https://github.com/eemeli/yaml/blob/main/docs/03_options.md)
- **Authentication**: N/A (library)
- **Already used by**: `$pcd/migration/reader.ts` (parse side)
- **Key Stringify Options for Deterministic Output**:

  | Option                  | Type                               | Default   | Recommended                       |
  | ----------------------- | ---------------------------------- | --------- | --------------------------------- |
  | `sortMapEntries`        | `boolean \| (a, b) => number`      | `false`   | `true`                            |
  | `indent`                | `number`                           | `2`       | `2` (match project convention)    |
  | `lineWidth`             | `number`                           | `80`      | `100` (match project print width) |
  | `singleQuote`           | `boolean \| null`                  | `null`    | `true` (match project style)      |
  | `defaultStringType`     | enum                               | `'PLAIN'` | `'PLAIN'`                         |
  | `blockQuote`            | `boolean \| 'folded' \| 'literal'` | `true`    | `true`                            |
  | `nullStr`               | `string`                           | `'null'`  | `'null'`                          |
  | `collectionStyle`       | `'any' \| 'block' \| 'flow'`       | `'any'`   | `'block'`                         |
  | `flowCollectionPadding` | `boolean`                          | `true`    | `true`                            |

- **Schema**: Uses YAML 1.2 Core schema by default, which only recognizes `true`/`false` as booleans
  (not `yes`/`no`/`on`/`off`). This is critical for type safety.
- **Version requirement**: TypeScript 5.9+ for included typings (project uses Deno 2.x which
  includes TS 5.x).

**Confidence**: High -- the yaml package is already a dependency (v2.8.2 in package.json); stringify
options are well-documented and stable.

### 3. Web Crypto API (SHA-256 Content Hashing)

- **Documentation**:
  [MDN SubtleCrypto.digest()](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
  | [Deno hashing examples](https://docs.deno.com/examples/hashing/)
- **Authentication**: N/A (Web standard API)
- **Already used by**: `importBaseOps.ts` (content hash generation for ops)
- **Key Method**: `crypto.subtle.digest('SHA-256', data)` returns an `ArrayBuffer`
- **Pattern** (already in codebase):

  ```typescript
  async function hashContent(content: string): Promise<string> {
    const data = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  ```

- **Parity verification use**: Hash the serialized YAML output of each entity, hash the
  re-serialized output after round-trip import, compare hex strings.

**Confidence**: High -- identical pattern already used in `importBaseOps.ts` for content hashing.

### 4. Deno File System APIs

- **Documentation**: [Deno File System API](https://docs.deno.com/api/deno/file-system) |
  [Writing files](https://docs.deno.com/examples/writing_files/) |
  [Rename/Move](https://docs.deno.com/examples/moving_renaming_files/)
- **Authentication**: Requires `--allow-read` and `--allow-write` Deno permissions
- **Key APIs**:
  - `Deno.mkdir(path, { recursive: true })` -- create entity directories
  - `Deno.writeTextFile(path, content)` -- write YAML/JSON files
  - `Deno.rename(oldPath, newPath)` -- atomic swap for safe writes
  - `Deno.readDir(path)` -- enumerate directory entries (used by migration reader)
  - `Deno.stat(path)` -- check path existence
  - `Deno.makeTempFile({ dir, prefix, suffix })` -- create temp files for atomic writes
- **Atomic write pattern**:

  ```typescript
  async function atomicWriteTextFile(targetPath: string, content: string): Promise<void> {
    const dir = dirname(targetPath);
    const tempPath = await Deno.makeTempFile({ dir, suffix: '.tmp' });
    try {
      await Deno.writeTextFile(tempPath, content);
      await Deno.rename(tempPath, targetPath);
    } catch (error) {
      try {
        await Deno.remove(tempPath);
      } catch {
        /* cleanup best-effort */
      }
      throw error;
    }
  }
  ```

- **Important**: `Deno.writeTextFile` does NOT acquire a file lock, so the atomic rename pattern is
  recommended for safety during batch writes.

**Confidence**: High -- all APIs are stable Deno built-ins already used throughout the project.

---

## Libraries and SDKs

### Recommended Libraries (Already in Project)

| Library                       | Version     | Purpose                        | Status                 |
| ----------------------------- | ----------- | ------------------------------ | ---------------------- |
| `yaml` (npm)                  | 2.8.2       | YAML parse + stringify         | In `package.json`      |
| `kysely`                      | (workspace) | Type-safe SQL query builder    | In `deno.json` imports |
| `@soapbox/kysely-deno-sqlite` | (workspace) | Kysely dialect for Deno SQLite | In `deno.json` imports |
| `@jsr/db__sqlite`             | (workspace) | Native SQLite FFI for Deno     | In `deno.json` imports |
| `@std/assert`                 | (Deno std)  | Test assertions                | In test files          |
| `crypto.subtle`               | (Web API)   | SHA-256 hashing                | Built-in               |

**No new dependencies are needed.** The project already has everything required.

**Confidence**: High -- verified against `package.json` and existing import patterns.

### Alternative Options Evaluated

#### YAML Libraries

| Library                | Pros                                                               | Cons                                                   | Recommendation           |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------ |
| `yaml` (eemeli) v2.8   | Already used, YAML 1.2, TS typings, `sortMapEntries`, rich options | Min TS 5.9                                             | **Use (already chosen)** |
| `js-yaml` v4           | Faster parsing, `sortKeys` option, widespread                      | No YAML 1.2 comments/blank lines, less control         | Skip (already have yaml) |
| `@std/yaml` (Deno std) | Zero deps, Deno-native                                             | Less stringify control, no `sortMapEntries` equivalent | Skip                     |

**Confidence**: High -- `yaml` package is the correct choice given its existing presence and
superior stringify options.

#### JSON Schema Validators

| Library                | Pros                                                                | Cons                                               | Recommendation     |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------- | ------------------ |
| Hand-rolled validators | Already in `validate.ts`, zero deps, matches portable types exactly | More code to maintain                              | **Continue using** |
| Zod                    | TS-first, auto type inference                                       | New dependency, redundant with existing validators | Skip               |
| Ajv                    | Fastest, JSON Schema standard                                       | Heavy dependency, overkill for portable types      | Skip               |

The project's hand-rolled validation in `validate.ts` is well-structured and covers all entity
types. Adding Zod or Ajv would introduce dependency weight for no net benefit.

**Confidence**: High -- the existing validation approach is sufficient and battle-tested.

#### File Hash Comparison

| Approach               | Pros                                | Cons            | Recommendation           |
| ---------------------- | ----------------------------------- | --------------- | ------------------------ |
| `crypto.subtle.digest` | Already used, Web standard, no deps | Async only      | **Use**                  |
| `@std/crypto`          | Streaming support for large files   | Extra import    | Consider for large files |
| Byte comparison        | Simpler for small files             | No summary hash | Skip for parity checks   |

**Confidence**: High -- `crypto.subtle` is the natural choice given existing usage.

---

## Integration Patterns

### Recommended Approach: Cache-to-Entity-File Pipeline

The conversion pipeline should follow this data flow:

```
Compiled SQLite Cache
       |
       v
  serialize.ts (existing)
  [reads entities via Kysely queries]
       |
       v
  Portable JSON objects
  (PortableCustomFormat, PortableQualityProfile, etc.)
       |
       v
  YAML stringify with deterministic options
  (sortMapEntries: true, singleQuote: true, etc.)
       |
       v
  Entity YAML files in entities/ directory
  (one file per entity, organized by type)
       |
       v
  Parity verification:
    - Re-read via migration reader (existing)
    - Deserialize into fresh cache (existing)
    - Compare cache snapshots (SHA-256)
```

**Key insight**: The serialization layer (`serialize.ts`) and deserialization layer
(`deserialize.ts`) already exist and are tested. The conversion tool only needs to:

1. Enumerate all entities from the compiled cache
2. Call the appropriate `serialize*` function for each
3. Write the portable object as YAML
4. Verify round-trip fidelity

**Confidence**: High -- this reuses all existing infrastructure.

### Entity Enumeration Pattern

To list all entities of each type from the compiled cache, use bulk queries:

```typescript
// Example: enumerate all custom formats
const allFormats = await cache.kb
  .selectFrom('custom_formats')
  .select(['name'])
  .orderBy('name')
  .execute();

// Then serialize each one
for (const format of allFormats) {
  const portable = await serializeCustomFormat(cache, format.name);
  // ... write to YAML
}
```

Entity enumeration queries needed per type:

| Entity Type                  | Table                        | Name Column | Order By   |
| ---------------------------- | ---------------------------- | ----------- | ---------- |
| `custom_format`              | `custom_formats`             | `name`      | `name ASC` |
| `quality_profile`            | `quality_profiles`           | `name`      | `name ASC` |
| `regular_expression`         | `regular_expressions`        | `name`      | `name ASC` |
| `delay_profile`              | `delay_profiles`             | `name`      | `name ASC` |
| `radarr_naming`              | `radarr_naming`              | `name`      | `name ASC` |
| `sonarr_naming`              | `sonarr_naming`              | `name`      | `name ASC` |
| `lidarr_naming`              | `lidarr_naming`              | `name`      | `name ASC` |
| `radarr_media_settings`      | `radarr_media_settings`      | `name`      | `name ASC` |
| `sonarr_media_settings`      | `sonarr_media_settings`      | `name`      | `name ASC` |
| `lidarr_media_settings`      | `lidarr_media_settings`      | `name`      | `name ASC` |
| `radarr_quality_definitions` | `radarr_quality_definitions` | `name`      | `name ASC` |
| `sonarr_quality_definitions` | `sonarr_quality_definitions` | `name`      | `name ASC` |
| `lidarr_quality_definitions` | `lidarr_quality_definitions` | `name`      | `name ASC` |
| `lidarr_metadata_profile`    | `lidarr_metadata_profiles`   | `name`      | `name ASC` |

**Confidence**: High -- these tables are defined in the PCD schema and used throughout entity CRUD.

### Directory Layout Convention

The migration reader (`reader.ts`) already defines the expected directory structure for entity
files. The writer must produce files that match this structure exactly:

```
entities/
  custom-formats/
    {slug}.yaml
  quality-profiles/
    {slug}.yaml
  regular-expressions/
    {slug}.yaml
  delay-profiles/
    {slug}.yaml
  media-management/
    radarr-naming/
      {slug}.yaml
    sonarr-naming/
      {slug}.yaml
    lidarr-naming/
      {slug}.yaml
    radarr-media-settings/
      {slug}.yaml
    sonarr-media-settings/
      {slug}.yaml
    lidarr-media-settings/
      {slug}.yaml
    radarr-quality-definitions/
      {slug}.yaml
    sonarr-quality-definitions/
      {slug}.yaml
    lidarr-quality-definitions/
      {slug}.yaml
  metadata-profiles/
    lidarr/
      {slug}.yaml
```

This layout is already enforced by the reader's `ENTITY_FORMAT_BY_DIR` and
`ENTITY_FORMAT_BY_MEDIA_DIR` constants (see `reader.ts` lines 45-62).

**Confidence**: High -- the reader already defines and enforces this structure.

### Filename Slug Generation

Entity names must be converted to filesystem-safe slugs for filenames:

```typescript
function toEntitySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-'); // collapse consecutive hyphens
}
// "HD Bluray (Tier 1)" -> "hd-bluray-tier-1"
// "AMZN" -> "amzn"
// "DV (WEBDL)" -> "dv-webdl"
```

No external library needed; a simple regex-based function suffices. This aligns with TRaSH Guides'
convention where "JSON file names are always written in lowercase, with spaces replaced by dashes."

**Confidence**: High -- simple, deterministic transformation with no edge cases that would require a
library.

### Deterministic YAML Output Configuration

The recommended stringify options for diffable, git-friendly output:

```typescript
import { stringify } from 'yaml';

const YAML_STRINGIFY_OPTIONS = {
  sortMapEntries: true, // alphabetical key ordering
  indent: 2, // 2-space indentation
  lineWidth: 100, // match project print width
  singleQuote: true, // match project formatting convention
  defaultStringType: 'PLAIN' as const,
  blockQuote: true, // use block quotes for multi-line strings
  collectionStyle: 'block' as const, // force block style (no flow)
  nullStr: 'null',
  flowCollectionPadding: true,
} as const;

function serializeToYaml(data: Record<string, unknown>): string {
  return stringify(data, YAML_STRINGIFY_OPTIONS);
}
```

**Key rationale**:

- `sortMapEntries: true` ensures identical key ordering across runs (critical for git diffs)
- `collectionStyle: 'block'` prevents flow-style `{key: value}` inline maps
- `singleQuote: true` matches project Prettier configuration
- `lineWidth: 100` matches project's 100-char print width
- `blockQuote: true` enables readable multi-line strings for regex patterns

**Confidence**: High -- these options are documented and tested in the yaml package.

### Similar Tool Patterns (TRaSH Guides / Recyclarr / Configarr)

#### TRaSH Guides Repository Structure

- **Source**: [TRaSH-Guides/Guides](https://github.com/TRaSH-Guides/Guides) |
  [Creating a TRaSH Guides Repository](https://recyclarr.dev/reference/settings/resource-providers/trash-guides-structure/)
- **Pattern**: One JSON file per custom format in `docs/json/{arr_type}/cf/` directories
- **Naming**: Lowercase, hyphens for spaces, `.json` extension
- **Metadata**: `metadata.json` at repo root defines resource paths
- **Key difference from Praxrr**: TRaSH uses flat JSON per CF; Praxrr uses YAML with nested
  conditions, tags, and tests per entity

#### Recyclarr Configuration

- **Source**: [Recyclarr File Structure](https://recyclarr.dev/wiki/file-structure/) |
  [Config Reference](https://recyclarr.dev/wiki/yaml/config-reference/)
- **Pattern**: YAML config files in `configs/` directory, non-recursive
- **Include system**: Reusable templates in `includes/` directory
- **Key difference**: Recyclarr config files describe desired state for sync; Praxrr entity files
  are the canonical data source

#### Configarr

- **Source**: [Configarr Configuration](https://configarr.de/docs/configuration/config-file/)
- **Pattern**: Single YAML file with nested instance/entity hierarchy
- **Key difference**: Configarr is a single-file config; Praxrr uses file-per-entity for better git
  diff visibility

**Confidence**: Medium -- these tools solve similar problems but with different architectural
constraints. The file-per-entity pattern from TRaSH Guides is the closest match to Praxrr's needs.

### Parity Verification Strategy

The verification flow uses a "compile-compare" approach:

```
Step 1: SQL ops -> compile -> Cache A (reference)
Step 2: Cache A -> serialize all entities -> YAML files
Step 3: YAML files -> migration reader -> deserialize -> Cache B (verification)
Step 4: Compare Cache A vs Cache B
```

**Comparison method**: For each entity table, execute a deterministic `SELECT * ORDER BY` query on
both caches, serialize results to JSON with sorted keys, and compare SHA-256 hashes.

```typescript
async function snapshotTable(cache: PCDCache, table: string): Promise<string> {
  const rows = cache.query(`SELECT * FROM ${table} ORDER BY name`);
  // Exclude auto-generated columns (id, created_at, updated_at)
  const normalized = rows.map((row) => {
    const { id, created_at, updated_at, ...rest } = row;
    return rest;
  });
  return JSON.stringify(normalized, Object.keys(normalized[0] ?? {}).sort());
}
```

The existing `cacheParity.test.ts` demonstrates this pattern for delay profiles. The full migration
tool needs to extend it to all entity types.

**Confidence**: High -- the parity test pattern is already proven in the codebase.

### Tags and Auxiliary Data

The migration reader already identifies `tags.yaml` and `quality-api-mappings.yaml` as "known
non-entity top-level files" that are not yet mapped to entity import (`reader.ts` line 81). The
conversion tool should:

1. Extract all tags from the `tags` table
2. Write a `tags.yaml` file in the entities root
3. Extract quality API mappings if present
4. Write a `quality-api-mappings.yaml` file

These files are critical for complete round-trip fidelity since entities reference tags by name.

**Confidence**: Medium -- the reader acknowledges these files but does not yet import them; the
writer should generate them, but import support may need to be added for full parity.

---

## Constraints and Gotchas

### 1. YAML Boolean/Number Type Coercion

**Impact**: HIGH -- regex patterns like `"3D"`, entity names like `"true"`, or numeric-looking
strings could be misinterpreted during YAML round-trip.

**Details**: The `yaml` package uses YAML 1.2 Core schema by default, which only treats
`true`/`false`/`True`/`False`/`TRUE`/`FALSE` as booleans and standard numeric formats as numbers.
This is safer than YAML 1.1 (which treats `yes`/`no`/`on`/`off` as booleans).

**Workaround**: The yaml package will automatically quote strings that look like booleans or numbers
when using `stringify()`. Verification: ensure round-trip `parse(stringify(obj))` produces identical
types for all entity data. Specific attention needed for:

- Entity names that are purely numeric (e.g., regex name `"126811"`)
- Boolean-like strings (unlikely in current data but possible)
- Version-like strings (e.g., `"1.0"`)

**Confidence**: High -- the yaml package handles this correctly by default in YAML 1.2 mode.

### 2. Regex Pattern Quoting in YAML

**Impact**: HIGH -- the PCD contains complex regex patterns with characters that are
YAML-significant (`:`, `#`, `{`, `}`, `[`, `]`, etc.).

**Details**: Example patterns from the seed data:

```
(?<=^|[\s.-])126811\b
(?<=\b[12]\d{3}\b).*\b((bluray|bd)?3d|sbs|half[ .-]ou|half[ .-]sbs)\b
```

These contain `[`, `]`, `|`, `?`, `(`, `)` which are YAML-significant in flow contexts.

**Workaround**: The `yaml` package automatically quotes strings containing YAML-special characters.
With `collectionStyle: 'block'` and `blockQuote: true`, long patterns will use block scalar style
(literal `|` or folded `>`), which preserves content verbatim. Single-line patterns will be
auto-quoted with single or double quotes as needed.

**Verification**: The round-trip test must specifically check that regex patterns survive YAML
serialization/deserialization unchanged.

**Confidence**: High -- the yaml library handles auto-quoting correctly; block style eliminates most
quoting concerns for multi-line content.

### 3. SQLite Integer Booleans vs JSON Booleans

**Impact**: MEDIUM -- SQLite stores booleans as integers (0/1), but portable types use `boolean`.

**Details**: The existing `serialize.ts` already handles this conversion:

```typescript
includeInRename: format.include_in_rename === 1,  // integer to boolean
```

**Workaround**: No additional work needed; the serialization layer already converts. The YAML output
will contain `true`/`false` which parse back correctly. However, the parity comparison must account
for this: Cache A has integers, Cache B (after round-trip) also has integers because the
deserializer writes via the same create functions.

**Confidence**: High -- already handled by existing serialize/deserialize functions.

### 4. NULL vs Empty String Handling

**Impact**: MEDIUM -- SQLite distinguishes NULL from empty string, and the portable types use `null`
for absent optional fields.

**Details**: Fields like `description`, `regex101Id`, and `customColonReplacementFormat` can be
either `null` or a string. The serializers already normalize this:

```typescript
description: regex.description || null,  // empty string -> null
```

**Workaround**: The YAML `null` keyword maps correctly to JavaScript `null` via the yaml parser. The
stringify will output `null` for null values (configurable via `nullStr`). Must verify that the
deserializer does not treat `null` differently from omitted keys.

**Confidence**: High -- existing serialize/deserialize pair handles this.

### 5. Entity Ordering Dependencies

**Impact**: MEDIUM -- some entities reference others by name (e.g., custom format scores reference
custom format names, quality profiles reference quality names).

**Details**: During re-import for parity verification, entities must be created in dependency order:

1. Tags (referenced by regex, CF, QP)
2. Regular expressions (referenced by CF conditions via `condition_patterns`)
3. Custom formats (referenced by QP scores)
4. Quality profiles (references CFs)
5. Delay profiles (standalone)
6. Media management entities (standalone)
7. Metadata profiles (standalone)

**Workaround**: The migration reader sorts files by path (`sortedPaths` in `reader.ts` line 114),
and the directory structure naturally creates a usable order. However, the conversion tool's parity
verification may need explicit ordering in the deserialize loop.

**Confidence**: Medium -- ordering is implicitly handled by directory structure but may need
explicit enforcement for parity testing.

### 6. Large Batch Conversion Performance

**Impact**: LOW -- the current seed file is ~1.4MB with hundreds of entities.

**Details**: Estimated entity counts from the seed:

- ~70+ tags
- ~100+ regular expressions
- ~80+ custom formats (each with multiple conditions)
- ~10+ quality profiles (each with dozens of quality items and CF scores)
- ~5+ delay profiles
- ~10+ media management entities

Total: ~280+ entities, each requiring 1-5 Kysely queries for serialization.

**Workaround**: All queries run against the in-memory SQLite database, so I/O is not a bottleneck.
File writes are the main I/O cost. At ~280 files, total write time should be under 1 second. No
parallelization needed.

The `yaml.stringify()` call is CPU-bound but benchmarks show it handles thousands of documents per
second for objects of this size.

**Confidence**: High -- in-memory SQLite + small entity count means performance is not a concern.

### 7. Migration Metadata Envelope

**Impact**: LOW -- each entity file should include migration metadata for the reader.

**Details**: The reader's `isolatePortablePayload` function strips the `migration` key from parsed
objects (reader.ts lines 303-316). The writer should include it for completeness:

```yaml
migration:
  format: yaml
  version: 1
  source: pcd-export
name: 'HD Bluray (Tier 1)'
# ... rest of entity data
```

The reader constructs migration metadata from file path and format when the `migration` key is
absent (`resolveMigrationMetadata` at line 318), so including it is optional but recommended for
explicit provenance.

**Confidence**: High -- the reader handles both cases (with and without migration metadata).

### 8. Duplicate Entity Name Collision in Slugs

**Impact**: LOW -- two entities with different names could produce the same slug.

**Details**: Example: `"WEB-DL (1080p)"` and `"WEB-DL 1080p"` would both slug to `web-dl-1080p`.
Current PCD data does not have such collisions, but the converter should detect and fail on slug
collisions within a single entity type directory.

**Workaround**: Build a `Set<string>` of slugs per entity type and throw if a duplicate is detected.
This is a fail-fast safeguard.

**Confidence**: High -- simple detection with negligible runtime cost.

---

## Code Examples

### Basic Entity File Writer

```typescript
import { stringify } from 'yaml';
import type { PCDCache } from '$pcd/index.ts';
import type { EntityType } from '$shared/pcd/portable.ts';
import {
  serializeCustomFormat,
  serializeQualityProfile,
  serializeRegularExpression,
  serializeDelayProfile,
  serializeRadarrNaming,
  serializeSonarrNaming,
  serializeRadarrMediaSettings,
  serializeSonarrMediaSettings,
  serializeRadarrQualityDefinitions,
  serializeSonarrQualityDefinitions,
} from '$pcd/entities/serialize.ts';

const YAML_OPTIONS = {
  sortMapEntries: true,
  indent: 2,
  lineWidth: 100,
  singleQuote: true,
  collectionStyle: 'block' as const,
  blockQuote: true,
  nullStr: 'null',
};

function toEntitySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

interface EntityDirMapping {
  entityType: EntityType;
  dir: string;
  listQuery: string;
  serializer: (cache: PCDCache, name: string) => Promise<Record<string, unknown>>;
}

const ENTITY_MAPPINGS: EntityDirMapping[] = [
  {
    entityType: 'regular_expression',
    dir: 'regular-expressions',
    listQuery: 'SELECT name FROM regular_expressions ORDER BY name',
    serializer: serializeRegularExpression,
  },
  {
    entityType: 'custom_format',
    dir: 'custom-formats',
    listQuery: 'SELECT name FROM custom_formats ORDER BY name',
    serializer: serializeCustomFormat,
  },
  {
    entityType: 'quality_profile',
    dir: 'quality-profiles',
    listQuery: 'SELECT name FROM quality_profiles ORDER BY name',
    serializer: serializeQualityProfile,
  },
  {
    entityType: 'delay_profile',
    dir: 'delay-profiles',
    listQuery: 'SELECT name FROM delay_profiles ORDER BY name',
    serializer: serializeDelayProfile,
  },
  // ... media management mappings follow the same pattern
  // with nested dirs: media-management/radarr-naming/, etc.
];

async function writeEntityFiles(cache: PCDCache, outputDir: string): Promise<void> {
  for (const mapping of ENTITY_MAPPINGS) {
    const names = cache.query<{ name: string }>(mapping.listQuery);
    if (names.length === 0) continue;

    const dirPath = `${outputDir}/${mapping.dir}`;
    await Deno.mkdir(dirPath, { recursive: true });

    const slugs = new Set<string>();
    for (const { name } of names) {
      const slug = toEntitySlug(name);
      if (slugs.has(slug)) {
        throw new Error(`Slug collision for ${mapping.entityType}: "${name}" -> "${slug}"`);
      }
      slugs.add(slug);

      const portable = await mapping.serializer(cache, name);
      const yamlContent = stringify(portable, YAML_OPTIONS);
      const filePath = `${dirPath}/${slug}.yaml`;
      await Deno.writeTextFile(filePath, yamlContent);
    }
  }
}
```

### Parity Verification Sketch

```typescript
import { compile } from '$pcd/database/compiler.ts';
import { getCache } from '$pcd/database/registry.ts';
import { readMigrationEntitySources } from '$pcd/migration/reader.ts';

async function hashTableSnapshot(
  cache: PCDCache,
  table: string,
  orderBy: string = 'name'
): Promise<string> {
  const rows = cache.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
  const normalized = rows.map((row: Record<string, unknown>) => {
    const { id, created_at, updated_at, ...rest } = row;
    return rest;
  });
  const json = JSON.stringify(normalized, null, 0);
  const data = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface ParityResult {
  table: string;
  referenceHash: string;
  verificationHash: string;
  match: boolean;
}

async function verifyParity(
  referenceCache: PCDCache,
  verificationCache: PCDCache,
  tables: string[]
): Promise<ParityResult[]> {
  const results: ParityResult[] = [];

  for (const table of tables) {
    const refHash = await hashTableSnapshot(referenceCache, table);
    const verHash = await hashTableSnapshot(verificationCache, table);
    results.push({
      table,
      referenceHash: refHash,
      verificationHash: verHash,
      match: refHash === verHash,
    });
  }

  return results;
}
```

---

## Comparable Tool Analysis

### TRaSH Guides (File-per-Entity JSON)

- **Repository**: [TRaSH-Guides/Guides](https://github.com/TRaSH-Guides/Guides)
- **Pattern**: One JSON file per custom format in `docs/json/radarr/cf/`
- **Metadata**: `metadata.json` at root defines resource paths
- **Naming**: Lowercase kebab-case filenames
- **Scoring**: Embedded in `trash_scores` object within each CF file
- **Relevance**: Closest prior art for file-per-entity config layout in the Arr ecosystem

### Recyclarr (YAML Config Sync)

- **Repository**: [recyclarr/recyclarr](https://github.com/recyclarr/recyclarr)
- **Documentation**: [recyclarr.dev](https://recyclarr.dev/)
- **Pattern**: YAML config files referencing TRaSH Guide IDs
- **Include system**: Template files in `includes/` directory
- **Key lesson**: Recyclarr's `configs/` directory is non-recursive; Praxrr's `entities/` directory
  IS recursive (the reader walks subdirectories)

### Configarr (Single-File YAML Config)

- **Repository**: [raydak-labs/configarr](https://github.com/raydak-labs/configarr)
- **Documentation**: [configarr.de](https://configarr.de/)
- **Pattern**: Single YAML file with full entity definitions inline
- **Key lesson**: Demonstrates that YAML can express complete CF specifications including conditions
  and scoring, validating Praxrr's portable YAML approach

### Buildarr (Declarative Arr Config)

- **Repository**: [buildarr/buildarr](https://github.com/buildarr/buildarr)
- **Documentation**: [buildarr.github.io](https://buildarr.github.io/configuration/)
- **Pattern**: Python-based, YAML config declaring desired Arr state
- **Key lesson**: Splits config into instance-scoped YAML files, similar to Praxrr's per-entity
  approach

---

## Open Questions

1. **Tags import path**: The migration reader identifies `tags.yaml` as a known non-entity file but
   does not import it. Should the conversion tool generate this file, and should a reader extension
   be added for it? Tags are referenced by name in entity files, so they are a prerequisite for
   clean re-import.

2. **Quality API mappings**: Similar to tags -- the reader acknowledges `quality-api-mappings.yaml`
   but does not import it. This file maps quality names to Arr API identifiers and may be needed for
   full parity.

3. **Migration metadata inclusion**: Should entity files include the `migration` envelope (format,
   version, source) or rely on the reader's path-based inference? Including it adds explicit
   provenance but increases file size.

4. **Condition type polymorphism**: Custom format conditions use a polymorphic `type` field that
   determines which sub-table to join. The existing `serializeCustomFormat` already handles this via
   `getConditionsForEvaluation`, but the round-trip verification must confirm that condition
   ordering and type-specific fields survive.

5. **Batch vs incremental**: Should the conversion tool always regenerate all entity files from
   scratch, or support incremental updates (only write changed entities)? Incremental is more
   complex but better for git diffs during development.

6. **User ops exclusion**: The conversion targets base/repo data (the canonical seed). Should user
   ops (local overrides) be excluded from conversion, or should there be a mode to export user ops
   as separate entity files?

---

## Search Queries Executed

1. `yaml npm package TypeScript serialization options sorted keys deterministic output`
2. `Recyclarr config as code YAML structure file per entity directory layout`
3. `TRaSH Guides Recyclarr YAML custom format quality profile structure`
4. `Deno TypeScript atomic file write rename pattern directory creation`
5. `SQL to YAML round trip fidelity type coercion boolean integer string quoting edge cases`
6. `YAML quoting regex patterns special characters serialization best practices`
7. `Deno SQLite introspection query table names column metadata`
8. `JSON schema validation TypeScript Deno ajv zod runtime validation`
9. `config as code file per entity convention directory structure devops patterns`
10. `Notifiarr TRaSH Guides custom format JSON structure radarr sonarr config files`
11. `SHA-256 content hash Deno crypto.subtle digest file comparison parity verification`
12. `SQLite PRAGMA table_info table_list introspection all rows dump`
13. `TRaSH Guides GitHub JSON custom format file structure docs/json directory layout`
14. `Configarr YAML structure config file entity layout custom formats quality profiles`
15. `relational data to document format flattening SQL joins entity serialization patterns`
16. `deterministic YAML output sorted keys stable ordering diffable config files git`
17. `yaml npm package sortMapEntries stringify options TypeScript example`
18. `YAML 1.2 boolean yes no true false parsing quirks type coercion prevention`
19. `Deno.writeTextFile atomic write temporary file rename filesystem patterns`
20. `file slug generation from entity name filesystem safe kebab case TypeScript`
21. `Kysely TypeScript SQLite select all rows from table batch query`

---

## Uncertainties and Gaps

- **Tag import round-trip**: The reader does not currently import `tags.yaml`, so parity
  verification cannot include tags unless a tag reader/importer is added. The serialization of
  entities that reference tags will produce correct YAML, but re-importing those entities will fail
  if the referenced tags do not exist in the verification cache.

- **Quality API mapping import**: Same gap as tags -- the reader identifies but does not process
  `quality-api-mappings.yaml`.

- **Lidarr entity tables**: Lidarr entities (naming, media settings, quality definitions) use
  transitional shared-table contracts. The conversion must verify that Lidarr entity serialization
  produces correct YAML even when the underlying storage uses Sonarr/Radarr table structures.

- **Condition ordering stability**: Custom format conditions have an implicit ordering that affects
  evaluation. The serializer must preserve this ordering, and the YAML output must maintain it
  through the sorted-keys stringify (arrays are not reordered by `sortMapEntries`, only map keys).

---

## Sources

- [yaml npm package](https://www.npmjs.com/package/yaml)
- [yaml documentation (eemeli.org)](https://eemeli.org/yaml/)
- [yaml stringify options](https://github.com/eemeli/yaml/blob/main/docs/03_options.md)
- [Deno File System API](https://docs.deno.com/api/deno/file-system)
- [Deno writing files](https://docs.deno.com/examples/writing_files/)
- [Deno rename/move](https://docs.deno.com/examples/moving_renaming_files/)
- [Deno hashing examples](https://docs.deno.com/examples/hashing/)
- [MDN SubtleCrypto.digest()](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
- [Kysely documentation](https://kysely.dev/)
- [@soapbox/kysely-deno-sqlite JSR](https://jsr.io/@soapbox/kysely-deno-sqlite)
- [@db/sqlite JSR](https://jsr.io/@db/sqlite)
- [SQLite PRAGMA reference](https://sqlite.org/pragma.html)
- [Recyclarr File Structure](https://recyclarr.dev/wiki/file-structure/)
- [Recyclarr Config Reference](https://recyclarr.dev/wiki/yaml/config-reference/)
- [Recyclarr Custom Formats](https://recyclarr.dev/reference/configuration/custom-formats/)
- [Creating a TRaSH Guides Repository](https://recyclarr.dev/reference/settings/resource-providers/trash-guides-structure/)
- [TRaSH-Guides/Guides GitHub](https://github.com/TRaSH-Guides/Guides)
- [Configarr Configuration](https://configarr.de/docs/configuration/config-file/)
- [Configarr GitHub](https://github.com/raydak-labs/configarr)
- [YAML 1.2 boolean specification](https://yaml.org/type/bool.html)
- [YAML type coercion issues (Hacker News)](https://news.ycombinator.com/item?id=34352033)
- [YAML escaping special characters (GeeksforGeeks)](https://www.geeksforgeeks.org/devops/how-to-escape-the-special-character-in-yaml-with-examples/)
- [Regex in YAML (freeCodeCamp)](https://www.freecodecamp.org/news/how-to-use-regular-expressions-in-yaml-file/)
- [YAML strings quoting guide](https://blogs.perl.org/users/tinita/2018/03/strings-in-yaml---to-quote-or-not-to-quote.html)
- [yq Sort Keys operator](https://mikefarah.gitbook.io/yq/operators/sort-keys)
- [sanitize-filename-ts npm](https://www.npmjs.com/package/sanitize-filename-ts)
- [Deno writeTextFile lock discussion](https://github.com/denoland/deno/discussions/26692)
