# PCD Data Migration Phase 2: Research and Recommendations

## Executive Summary

The foundation for hybrid YAML/JSON entity ingestion is solid: the migration reader
(`migration/reader.ts`) parses entity source documents, the portable type system covers all 14
entity types, and `importBaseOps` already wires hybrid ingestion with stable-identity conflict
detection. The primary gaps are: (1) no converter tool exists to extract compiled cache state into
YAML/JSON files, (2) Lidarr naming serialization lives only in the export route rather than in the
shared `serialize.ts` module, (3) non-entity seed data (tags, languages, qualities,
quality_api_mappings) has no portable type or reader mapping, and (4) there is no parity
verification system to prove SQL-compiled and YAML-compiled caches produce identical state. The
recommended approach is a Deno script converter tool that reads compiled cache, serializes all
entities via the existing pipeline, writes YAML files to the expected directory structure, then a
separate parity verifier that compiles both sources and diffs the resulting cache tables.

## Relevant Files

- `/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: Entity-to-portable serializers
  for 13 of 14 entity types (missing `serializeLidarrNaming`)
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: Portable-to-SQL deserializers
  for all 14 entity types
- `/packages/praxrr-app/src/lib/server/pcd/entities/validate.ts`: Portable data shape validators for
  all entity types
- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: YAML/JSON entity file reader with
  directory-to-entityType resolution
- `/packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`: Value-guard gate for
  conflict decisions
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: Hybrid-aware base op import with
  stable-identity conflict detection
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: In-memory SQLite cache with
  query/validate APIs
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: PCDManager lifecycle orchestration
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`: All portable entity type definitions and
  migration metadata
- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: ConditionData, OrderedItem,
  QualityDefinitionEntry types used by portable entities
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: Export route with inline
  `serializeLidarrNaming` and `serializeLidarrQualityDefinitions`
- `/packages/praxrr-schema/ops/0.schema.sql`: Schema defining all PCD tables including non-entity
  tables
- `/packages/praxrr-schema/ops/1.languages.sql`: Language seed data (schema-level, not PCD-level)
- `/packages/praxrr-schema/ops/2.qualities.sql`: Quality and quality_api_mappings seed data
  (schema-level)
- `/packages/praxrr-db/ops/0.rosettarr.sql`: 25,220-line seed file (~7,057 INSERT statements, ~253
  custom formats, ~484 regular expressions, ~11 quality profiles)
- `/scripts/generate-pcd-types.ts`: Reference Deno script pattern for tooling (CLI args, file I/O,
  SQLite introspection)
- `/packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`: Test pattern for
  monkey-patching PCDManager internals

## 1. Implementation Recommendations

### 1.1 Converter Tool Architecture

**Recommended approach**: Build as `scripts/convert-pcd-to-yaml.ts`, invoked via
`deno task convert:pcd-entities`.

**Why a Deno script**: The existing `scripts/generate-pcd-types.ts` establishes the pattern for
standalone Deno tooling scripts. The converter needs to:

1. Read a compiled PCD cache (requires in-memory SQLite + Kysely)
2. Enumerate all entities by type from cache tables
3. Serialize each entity via the existing `serialize.ts` functions
4. Write YAML/JSON files to the directory structure the reader expects

**Key design decisions**:

- The converter must compile the cache itself (cannot rely on the running server's cache) by loading
  schema, base ops, and optionally tweaks layers. This means it needs the same `loadAllOperations`
  and `PCDCache.build()` machinery, or a lightweight variant.
- Alternative: Accept a `--database-id` flag and connect to the running app's SQLite database to
  read `pcd_ops`, then replay them into an in-memory cache. This is more accurate but couples the
  tool to a running instance.
- Simpler alternative: Accept a `--pcd-path` argument pointing to a cloned PCD repository, compile
  its ops into an in-memory cache, then serialize. This is self-contained and testable.

**YAML library**: The `yaml` npm package is already used by `reader.ts`
(`import { parse as parseYaml } from 'yaml'`). For writing, the same package provides `stringify()`.
The package also supports comments via its `Document` API, enabling inline documentation in output
files.

**File structure convention** (matching what `reader.ts` expects):

```
entities/
  regular-expressions/
    {kebab-name}.yaml
  custom-formats/
    {kebab-name}.yaml
  quality-profiles/
    {kebab-name}.yaml
  delay-profiles/
    {kebab-name}.yaml
  media-management/
    radarr-naming/
      {kebab-name}.yaml
    sonarr-naming/
      {kebab-name}.yaml
    lidarr-naming/
      {kebab-name}.yaml
    radarr-media-settings/
      {kebab-name}.yaml
    sonarr-media-settings/
      {kebab-name}.yaml
    lidarr-media-settings/
      {kebab-name}.yaml
    radarr-quality-definitions/
      {kebab-name}.yaml
    sonarr-quality-definitions/
      {kebab-name}.yaml
    lidarr-quality-definitions/
      {kebab-name}.yaml
  metadata-profiles/
    lidarr/
      {kebab-name}.yaml
```

### 1.2 Technology Choices

| Concern           | Recommendation                      | Rationale                                                                               |
| ----------------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| YAML library      | `yaml` (npm, already imported)      | Already a dependency; supports `stringify()` with comment injection via `Document` API  |
| Output format     | YAML primary, JSON optional flag    | YAML is more human-readable for config data; the reader already supports both           |
| File naming       | kebab-case derived from entity name | Matches reader's directory resolution; `"My Entity Name"` becomes `my-entity-name.yaml` |
| CLI framework     | Raw `Deno.args` parsing             | Matches `generate-pcd-types.ts` pattern; no extra dependency                            |
| Cache compilation | Direct `PCDCache` instantiation     | Reuse existing cache build machinery rather than reimplementing                         |

### 1.3 Phasing Strategy

**Phase A: Converter tool** (build and validate output)

1. Create `scripts/convert-pcd-to-yaml.ts` with CLI args for PCD path and output directory
2. Move `serializeLidarrNaming` from export route into `serialize.ts` (fixing the gap)
3. Implement entity enumeration from cache (list all names per entity type)
4. Implement YAML file writing with migration metadata headers
5. Add `deno task convert:pcd-entities` to `deno.json`

**Phase B: Parity verification** (prove equivalence)

1. Create `scripts/verify-pcd-parity.ts` that compiles SQL-only cache and YAML-only cache
2. Diff all table contents between the two caches row-by-row
3. Report mismatches with actionable context (table, row, column, expected vs actual)
4. Integrate as `deno task verify:pcd-parity`

**Phase C: Non-entity seed data** (tags, languages, qualities, quality_api_mappings)

1. Define portable types for seed data collections
2. Extend reader with top-level seed file parsing (`tags.yaml`, `quality-api-mappings.yaml`)
3. Add serializers for seed data extraction from cache
4. Wire seed data into `importBaseOps` hybrid path

**Phase D: PCDManager lifecycle integration**

1. Extend `importBaseOps` to actually persist YAML-sourced entities (currently it validates
   conflicts but does not write migration entities to `pcd_ops`)
2. Add entity deserialization step after conflict validation
3. Integrate parity verification as an optional post-compile check

## 2. Improvement Ideas

### 2.1 Deno Task Command

Yes, implement as `deno task convert:pcd-entities`. The task definition pattern in `deno.json`
already includes `generate:api-types` and `generate:pcd-types`. Suggested task entries:

```json
"convert:pcd-entities": "deno run -A scripts/convert-pcd-to-yaml.ts",
"verify:pcd-parity": "deno run -A scripts/verify-pcd-parity.ts"
```

### 2.2 CI Parity Verification

The parity verification tool should be designed CI-friendly from the start:

- Accept a `--strict` flag that exits with non-zero code on any mismatch
- Output machine-parseable JSON summary alongside human-readable report
- Can run as a GitHub Actions step on PRs that touch `packages/praxrr-db/ops/`
- Should be fast: compiling ~7,000 ops into in-memory SQLite takes <1 second based on cache build
  timing patterns observed in tests

### 2.3 YAML Comments for Documentation

The `yaml` package's `Document` API supports per-node comments. Recommended uses:

- File-level comment with entity type, generation timestamp, and schema version
- Field-level comments for non-obvious fields (e.g., `colonReplacementFormat` enum values)
- Condition-level comments showing the regex pattern name for `release_title` conditions

This is a nice-to-have that can be deferred to a polish pass after parity is proven.

### 2.4 Dual JSON and YAML Output

Support both via a `--format=yaml|json` CLI flag, defaulting to YAML. The reader already handles
both formats transparently. JSON output is useful for programmatic consumption and testing; YAML for
human authoring. The converter should produce one format at a time, not both simultaneously, to
avoid ambiguity in the reader's file discovery.

## 3. Risk Assessment

### 3.1 Serialization Gaps (HIGH RISK)

**`serializeLidarrNaming` is not in `serialize.ts`**. It is inlined in the export route
(`+server.ts:95-112`) with a non-obvious field mapping:

- `standardEpisodeFormat` maps to `standard_track_format`
- `dailyEpisodeFormat` maps to `artist_name`
- `animeEpisodeFormat` maps to `multi_disc_track_format`
- `seriesFolderFormat` maps to `artist_folder_format`
- `seasonFolderFormat` maps to `artist_folder_format` (same source as series)
- `multiEpisodeStyle` is hardcoded to `'extend'`

This is a semantic mismatch where Lidarr naming fields are mapped through the Sonarr portable type
(`PortableLidarrNaming = PortableSonarrNaming`). The converter must replicate this exact mapping, or
it will produce YAML that the reader validates but the deserializer misinterprets.

**Mitigation**: Move `serializeLidarrNaming` into `serialize.ts` as a first step, ensuring the
converter and export route share the same code path.

**`serializeLidarrQualityDefinitions` is also inlined** in the export route. Same mitigation applies
(though the mapping is simpler -- just name + entries).

### 3.2 Regex Pattern YAML Quoting (MEDIUM RISK)

Many regex patterns contain YAML-special characters: `{`, `}`, `:`, `#`, `[`, `]`, single quotes,
double quotes. Example from the seed data: patterns like `(?i)\b(DV|DoVi|Dolby\s*Vision)\b` are
safe, but patterns with literal braces or colons may break.

The `yaml` `stringify()` function handles quoting automatically for scalar values, but edge cases
exist:

- Patterns starting with `{` or `[` may be interpreted as flow mappings/sequences
- Patterns containing `#` after whitespace may be truncated as comments
- Multi-line patterns need block scalar syntax

**Mitigation**: After generating YAML, immediately re-parse it and compare the parsed pattern string
to the original. This round-trip test catches all quoting issues. Build this into the converter as
an automatic verification step.

### 3.3 Junction Table Data Loss (MEDIUM RISK)

Entities with junction table data require careful serialization:

- **Custom format tags** (`custom_format_tags`): Serialized as `tags: string[]` -- covered
- **Regular expression tags** (`regular_expression_tags`): Serialized as `tags: string[]` -- covered
- **Quality profile tags** (`quality_profile_tags`): Serialized as `tags: string[]` -- covered
- **Quality profile languages** (`quality_profile_languages`): Serialized as `language: string` --
  covered
- **Quality profile custom format scores** (`quality_profile_custom_formats`): Serialized as
  `customFormatScores[]` with `customFormatName`, `arrType`, `score` -- covered
- **Quality profile qualities** (`quality_profile_qualities`): Serialized as `orderedItems[]` --
  covered
- **Custom format conditions** (`custom_format_conditions` + `condition_*` sub-tables): Serialized
  via `cfQueries.getConditionsForEvaluation()` which returns `ConditionData[]` -- covered
- **Custom format tests** (`custom_format_tests`): Serialized as `tests[]` -- covered
- **Lidarr metadata profile types/statuses**: Serialized as `primaryTypes[]`, `secondaryTypes[]`,
  `releaseStatuses[]` -- covered

**No obvious data loss gaps** for currently supported entity types. The risk is in future entity
types or new junction tables being added without corresponding serializer updates.

### 3.4 Large Entity Handling (LOW RISK)

The largest entities are quality profiles with up to ~1,390 CF score assignments across all profiles
(~126 per profile average). YAML files for these will be ~200-300 lines each. This is well within
YAML parser limits. The `yaml` library handles this without issues.

The `0.rosettarr.sql` file is 25,220 lines, but individual entity YAML files will be much smaller.
The converter processes entities one at a time and writes them individually.

### 3.5 Entity Creation Order (HIGH RISK)

The reader sorts files alphabetically (`filePaths.sort((a, b) => a.localeCompare(b))` in
`reader.ts:114`). Entity creation order matters due to foreign key constraints:

1. **Tags** must exist before entities that reference them (regex, CFs, QPs)
2. **Regular expressions** must exist before custom format conditions that reference patterns
3. **Custom formats** must exist before quality profile CF scores reference them
4. **Qualities** must exist before quality profile qualities reference them
5. **Languages** must exist before quality profile languages reference them

The current SQL ops handle this via numeric ordering (`0.rosettarr.sql` inserts in dependency
order). The YAML entity files are read by directory type, but the reader returns a flat candidate
list sorted alphabetically. The `importBaseOps` function must ensure deserialization happens in
dependency order.

**Mitigation**: The converter should either:

- Encode ordering in filenames (e.g., `001-entity-name.yaml`)
- Or the import pipeline must sort candidates by entity type dependency order before deserialization

The reader's `resolveEntityType` returns an `entityType` that can be used to sort by a predefined
dependency order. Recommend adding an `ENTITY_CREATION_ORDER` constant.

### 3.6 Non-Entity Seed Data (HIGH RISK)

Four tables have no portable type, no serializer, and no reader mapping:

| Table                  | Row Count (seed) | Current Source                                              | Portable Type Exists |
| ---------------------- | ---------------- | ----------------------------------------------------------- | -------------------- |
| `tags`                 | 57               | `0.rosettarr.sql`                                           | No                   |
| `languages`            | ~64              | `packages/praxrr-schema/ops/1.languages.sql` (schema layer) | No                   |
| `qualities`            | ~67              | `packages/praxrr-schema/ops/2.qualities.sql` (schema layer) | No                   |
| `quality_api_mappings` | ~130             | `packages/praxrr-schema/ops/2.qualities.sql` (schema layer) | No                   |

**Languages and qualities are schema-layer data**, seeded by the schema package, not by PCD
repositories. They should NOT be included in PCD entity conversion.

**Tags** are PCD-level data. They are referenced by FK from entities but inserted as standalone
rows. The reader already recognizes `tags.yaml` as a known non-entity file
(`KNOWN_NON_ENTITY_TOP_LEVEL_FILES`). A portable type and reader path are needed.

**Quality API mappings** are also listed in `KNOWN_NON_ENTITY_TOP_LEVEL_FILES` as
`quality-api-mappings.yaml`. These map canonical quality names to Arr-specific API names and are
PCD-level configuration. They need a portable type and reader path.

**Mitigation**: Define simple portable types:

```typescript
interface PortableTagsSeed {
  tags: string[];
}

interface PortableQualityApiMappingSeed {
  mappings: Array<{
    qualityName: string;
    arrType: string;
    apiName: string;
  }>;
}
```

### 3.7 Value Guard Behavior After Format Change (MEDIUM RISK)

Value guards operate on SQL operations in `pcd_ops`. When switching from SQL-sourced ops to
YAML-sourced entities, the content hashes will change (different SQL generated by deserializers vs
hand-written SQL). This means:

- All existing base ops will be marked as orphaned on first import after conversion
- All YAML-derived entities will be created as new ops
- User ops that reference old SQL content hashes will see conflicts

The `importBaseOps` function uses `contentHash` to detect changes and `markBaseOrphaned` for
cleanup. The transition from SQL to YAML will trigger a full orphan + recreate cycle.

**Mitigation**: This is expected and acceptable behavior. The parity verifier should confirm that
post-transition compiled cache state matches pre-transition state. User ops are evaluated by their
SQL effect (rowcount, FK constraints), not by content hash comparison, so they should continue
working.

### 3.8 `ConditionData` Nested Polymorphism (MEDIUM RISK)

`ConditionData` in `display.ts` uses optional fields for polymorphic condition types:

```typescript
patterns?: { name: string; pattern: string }[];
languages?: { name: string; except: boolean }[];
sources?: string[];
resolutions?: string[];
qualityModifiers?: string[];
releaseTypes?: string[];
indexerFlags?: string[];
size?: { minBytes: number | null; maxBytes: number | null };
years?: { minYear: number | null; maxYear: number | null };
```

YAML serialization of these optional fields requires careful handling:

- Only the relevant field for each condition type should be present
- Empty arrays vs absent fields must be distinguished
- The `pattern` field within `patterns` array items may contain YAML-special characters

The existing serializer (`cfQueries.getConditionsForEvaluation`) returns this structure correctly.
The risk is in the YAML round-trip losing type information (e.g., `null` vs `undefined` vs absent
key).

## 4. Alternative Approaches

### Option A: Full Conversion Tool (Recommended)

**Compile cache -> serialize all entities -> write YAML files**

- Build as `scripts/convert-pcd-to-yaml.ts`
- Accept `--pcd-path` pointing to a cloned PCD repository
- Compile the repository's ops into an in-memory cache
- Enumerate all entity names per type from cache tables
- Serialize each entity using `serialize.ts` functions
- Write YAML files to `{pcd-path}/entities/` directory

**Pros**:

- Complete, deterministic conversion in one pass
- Uses existing, tested serialization code
- Output matches reader's expected directory structure exactly
- Easy to verify: compile YAML output and diff against SQL-compiled cache

**Cons**:

- Must compile the full cache to read it (depends on schema + base ops)
- Does not handle non-entity seed data without additional work
- Large one-time output (~253 CFs + ~484 regexes + ~11 QPs + media management = ~760 files)

**Trade-off summary**: Most reliable approach. The compilation step is fast (<1s) and the
serialization pipeline is proven. The file count is manageable.

### Option B: Incremental Conversion

**Convert entity-by-entity with verification at each step**

- Convert one entity type at a time (e.g., all delay profiles first)
- After each type, run parity verification for that type only
- Progressively replace SQL ops with YAML files
- Keep SQL ops for unconverted types

**Pros**:

- Lower blast radius per step
- Can catch per-type serialization issues early
- Allows phased delivery with incremental confidence

**Cons**:

- Requires the import pipeline to support mixed SQL + YAML for the same entity types during
  transition (it already does via hybrid mode, but only for cross-source conflicts, not same-entity
  coexistence)
- More complex orchestration: which types are converted, which are still SQL
- Risk of inconsistent state if conversion is interrupted mid-type
- Stable-identity conflict detection will flag entities that exist in both SQL and YAML

**Trade-off summary**: Safer but slower. Useful if the parity verifier reveals issues that need
per-type debugging, but adds operational complexity.

### Option C: Dual-Source Approach (Not Recommended)

**Keep SQL ops and YAML side-by-side during transition**

- Generate YAML files but do not remove SQL ops
- Both are loaded during import; the hybrid conflict detector resolves duplicates
- Eventually remove SQL ops after full parity is proven

**Pros**:

- Zero-risk transition: SQL ops remain authoritative until explicitly removed
- Can compare SQL and YAML compilation results continuously

**Cons**:

- `importBaseOps` throws on cross-source stable-identity conflicts (by design -- see
  `validateStableIdentityConflicts` at line 149-211 of `importBaseOps.ts`). Both sources defining
  the same entity is an error, not a graceful override.
- Would require changing the conflict detection logic to allow intentional duplicates, which
  undermines the safety guarantees it was built to provide
- Confusing for operators: which source is authoritative?
- Double the storage and maintenance burden

**Trade-off summary**: The stable-identity conflict detection explicitly prevents this approach.
Modifying it would weaken a safety invariant. Not recommended.

### Recommendation

**Option A (Full Conversion Tool)** is the recommended approach. It is the simplest, most reliable,
and aligns with the existing tooling patterns. The parity verifier (separate from the converter)
provides the safety net. If per-type debugging is needed, the converter can be run with a
`--entity-type` filter to convert one type at a time while the parity verifier checks just that
type.

## 5. Task Breakdown Preview

### Phase A: Converter Tool (2-3 tasks, parallelizable after A.1)

**A.1: Consolidate serialization gaps** (prerequisite)

- Move `serializeLidarrNaming` from export route to `serialize.ts`
- Move `serializeLidarrQualityDefinitions` from export route to `serialize.ts`
- Update export route to use shared functions
- Add entity name enumeration queries (list all names per entity type from cache)
- Depends on: nothing

**A.2: Build converter script** (main deliverable)

- Create `scripts/convert-pcd-to-yaml.ts`
- CLI: `--pcd-path`, `--output-dir`, `--format=yaml|json`, `--entity-type` filter
- Compile PCD cache from ops
- Enumerate and serialize all entities
- Write files with migration metadata and YAML round-trip verification
- Add `deno task convert:pcd-entities` to `deno.json`
- Depends on: A.1

**A.3: Non-entity seed data converter** (can parallel with A.2 after types defined)

- Define `PortableTagsSeed` and `PortableQualityApiMappingSeed` types in `portable.ts`
- Add seed data serialization from cache (simple table reads)
- Write `tags.yaml` and `quality-api-mappings.yaml` to entities root
- Depends on: A.1 (for cache enumeration pattern)

### Phase B: Parity Verification (2 tasks, parallelizable)

**B.1: Build parity verification script**

- Create `scripts/verify-pcd-parity.ts`
- Compile SQL-only cache and YAML-only cache from same PCD source
- Diff all table contents (ordered by primary key) row-by-row
- Report mismatches with table, row, column, expected vs actual
- Support `--strict` flag for CI exit code
- Add `deno task verify:pcd-parity` to `deno.json`
- Depends on: A.2 (needs converter output to verify)

**B.2: Add parity test coverage**

- Create `tests/pcd/migration/converterParity.test.ts`
- Test: compile reference SQL, convert, compile YAML, diff
- Test: round-trip YAML parse/stringify preserves all field values
- Test: regex patterns with YAML-special characters survive round-trip
- Test: large quality profiles with 100+ CF scores serialize correctly
- Depends on: A.2, B.1

### Phase C: Non-Entity Seed Data Integration (2 tasks)

**C.1: Extend reader for seed data files**

- Add reader support for `tags.yaml` (map to new seed handler)
- Add reader support for `quality-api-mappings.yaml`
- Define validation for seed data portable types
- Remove from `KNOWN_NON_ENTITY_TOP_LEVEL_FILES` and add proper handlers
- Depends on: A.3 (for type definitions)

**C.2: Wire seed data into import pipeline**

- Extend `importBaseOps` to handle seed data candidates
- Seed data must be imported before entities (tags before CFs, etc.)
- Add ordering guarantee: seed files processed before entity directories
- Depends on: C.1

### Phase D: PCDManager Integration (2 tasks)

**D.1: Entity deserialization in hybrid import path**

- Currently `importBaseOps` validates migration candidates but does not persist them
- Add deserialization step: for each validated migration candidate, call its `deserialize` function
  to generate SQL, then persist the SQL via the existing writer path
- Maintain content hash and metadata for each generated op
- Depends on: B.1 (parity must be proven first)

**D.2: Integration testing and lifecycle verification**

- Test: full link/sync/compile cycle with hybrid PCD source
- Test: user ops applied on top of YAML-sourced base ops
- Test: value guard behavior matches SQL-only baseline
- Test: sync triggers fire correctly after hybrid import
- Depends on: D.1

### Dependency Graph

```
A.1 ──> A.2 ──> B.1 ──> D.1 ──> D.2
  │       │       │
  └──> A.3 ──> C.1 ──> C.2
          │
          └──> B.2
```

### What Can Be Parallelized

- **A.2 and A.3** can run in parallel after A.1 completes
- **B.1 and B.2** can start design in parallel with A.2 (test scaffolding)
- **C.1** can start after A.3 type definitions are merged
- **D.1 and D.2** are sequential and must wait for parity verification

## 6. Key Decisions Needed

1. **Converter input**: Should the converter accept a `--pcd-path` (self-contained, compile from
   files) or a `--database-id` (connect to running instance)? Recommendation: `--pcd-path` for
   tooling independence.

2. **Output format default**: YAML or JSON? Recommendation: YAML for human readability, with
   `--format=json` flag for programmatic use.

3. **Seed data scope**: Should tags and quality_api_mappings be converted to YAML as PCD-level data,
   or remain as SQL? Recommendation: Convert tags (PCD-level), but leave
   languages/qualities/quality_api_mappings as schema-layer SQL since they come from
   `praxrr-schema`, not from PCD repositories.

4. **Entity ordering strategy**: Filename-based ordering (numeric prefixes) or type-based dependency
   sorting at import time? Recommendation: Type-based dependency sorting in the import pipeline,
   since the reader already extracts `entityType` which can be mapped to a dependency order.

5. **Transition strategy**: Big-bang conversion (replace all SQL ops with YAML in one PR) or gradual
   (convert one entity type per PR)? Recommendation: Big-bang conversion with parity verification as
   the quality gate. The stable-identity conflict detection prevents dual-source operation anyway.

6. **Quality API mappings ownership**: These live in `praxrr-schema` (schema layer) but are also
   referenced by PCD entities. Should PCD repositories be allowed to override them? Recommendation:
   No -- keep quality_api_mappings as schema-level seed data. PCD repositories should not redefine
   how quality names map to Arr APIs.

## 7. Open Questions

1. **Lidarr naming field mapping accuracy**: The current `serializeLidarrNaming` in the export route
   maps Sonarr-shaped portable fields to Lidarr-specific database columns (e.g.,
   `dailyEpisodeFormat` -> `artist_name`). Is this mapping correct and intentional, or is it a
   transitional workaround that should be replaced with a Lidarr-specific portable type?

2. **`custom_format_tests` in seed data**: The seed file (`0.rosettarr.sql`) has 0 custom format
   test INSERT statements. Are tests currently authored elsewhere, or is this a gap in the seed
   data? The serializer includes test serialization, so the converter will produce empty `tests: []`
   arrays unless tests exist in the cache.

3. **Incremental ops after conversion**: After converting `0.rosettarr.sql` to YAML entities, the
   incremental SQL ops (`1.*.sql` through `49.*.sql`) still modify entities created by the seed
   file. How should these be handled? Options: (a) compile seed + all incremental ops, then convert
   the final state to YAML (recommended), (b) convert seed only and keep incremental ops as SQL.

4. **Schema-layer seed data in hybrid mode**: Languages and qualities are seeded by `praxrr-schema`
   in the schema layer, which runs before base ops. If tags move to YAML in the base layer, they
   will still be created after schema-layer data. Is this ordering sufficient, or do tags need to be
   in the schema layer too?

5. **Multi-PCD parity**: If multiple PCD repositories exist, should the parity verifier run against
   all of them, or just the default (`praxrr-db`)? The converter should be PCD-agnostic, but the CI
   integration needs to know which repositories to test.

6. **`importBaseOps` migration entity persistence**: The current hybrid path in `importBaseOps`
   validates migration candidates and checks for stable-identity conflicts, but does not actually
   persist migration-sourced entities to `pcd_ops`. Is the intent to add persistence in Phase 2, or
   is there a different ingestion path planned for YAML entities?
