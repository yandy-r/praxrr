# Archaeologist Findings: PCD SQL Ops Format Migration Analysis

## Executive Summary

After deep examination of the codebase, a migration from SQL ops to JSON/YAML would be a **major architectural undertaking** touching nearly every server-side subsystem. The SQL format is not just a data serialization choice -- it is deeply woven into the system's execution model, conflict detection, export pipeline, and validation mechanics. The current architecture treats SQL as both the storage format AND the execution format, eliminating a translation layer. Any alternative format would need to introduce that translation layer while preserving complex semantics including value guards, idempotent upserts, cross-table cascades, and custom SQLite functions.

---

## 1. SQL Ops Format: Structural Anatomy

### File Locations and Volumes

- **Schema layer**: `packages/praxrr-schema/ops/` -- 3 files (schema DDL, languages seed, qualities seed)
- **Base ops layer**: `packages/praxrr-db/ops/` -- 57 files (0.rosettarr.sql through 56.seed-lidarr-quality-definitions.sql)
- **Ops range**: The initial seed (`0.rosettarr.sql`) is 25,220 lines and 1.4MB. Incremental ops range from 300 bytes to 147KB.

### Metadata Header Format

Every ops file begins with SQL comment-based metadata headers:

```sql
-- @operation: export
-- @entity: batch
-- @name: Human readable description
-- @exportedAt: 2026-01-31T00:22:56.654Z
-- @opIds: 436
```

These are parsed by `importBaseOps.ts` using a regex: `^--\s*@([a-zA-Z_]+)\s*:\s*(.*)$`. The parser strips these lines and stores the metadata as JSON separately from the cleaned SQL. Required fields are `operation`, `entity`, and `name`.

### Operation Block Markers

Within batch exports, individual operations are wrapped:

```sql
-- --- BEGIN op 52 ( update regular_expression "Movie Extras" )
<SQL statements>
-- --- END op 52
```

These markers are used by the exporter (`exporter.ts`) when building export files from draft ops but are NOT parsed during import/compilation -- they are purely for human readability and traceability. The entire file content (minus metadata headers) is executed as a single SQL script via `this.db.exec(operation.sql)`.

---

## 2. Complete SQL Feature Catalog

### 2a. Simple INSERTs (Trivial for JSON/YAML)

Used extensively in the initial seed for core entities:

```sql
INSERT INTO tags (name) VALUES ('1080p');
INSERT INTO regular_expressions (name, pattern, description) VALUES ('AVC', '[xh][ ._-]?264|\bAVC(\b|\d)', 'An open source encoder...');
INSERT INTO custom_formats (name, description, include_in_rename) VALUES ('DV', '', 0);
```

**JSON/YAML equivalent difficulty: TRIVIAL.** These map directly to entity objects with field names and values.

### 2b. Multi-value INSERTs (Trivial for JSON/YAML)

Schema layer uses compact multi-value inserts:

```sql
INSERT INTO languages (name) VALUES
('Unknown'), ('English'), ('French'), ...;
```

**JSON/YAML equivalent difficulty: TRIVIAL.** Simple array of strings.

### 2c. INSERT with SELECT subquery for idempotent upserts (MODERATE)

Heavily used throughout incremental ops for conditional inserts:

```sql
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT '1080p Balanced', 'Extras', 'sonarr', -999999
WHERE NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats
  WHERE quality_profile_name = '1080p Balanced'
    AND custom_format_name = 'Extras'
    AND arr_type = 'sonarr'
);
```

**JSON/YAML equivalent difficulty: MODERATE.** Could be expressed as `"if_not_exists": true` on an insert, but the exact semantics (check specific columns) would need formal specification. Some ops check only a subset of columns for existence while inserting with more columns.

### 2d. INSERT with multi-table EXISTS checks (HARD)

Lidarr seed ops use complex existence guards:

```sql
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
SELECT 'Lidarr - Lossless (Praxrr)', 'Lidarr - FLAC (Praxrr)', 'lidarr', 50000
WHERE EXISTS (
  SELECT 1 FROM quality_profiles qp WHERE qp.name = 'Lidarr - Lossless (Praxrr)'
)
AND EXISTS (
  SELECT 1 FROM custom_formats cf WHERE cf.name = 'Lidarr - FLAC (Praxrr)'
)
AND NOT EXISTS (
  SELECT 1 FROM quality_profile_custom_formats qpf
  WHERE qpf.quality_profile_name = 'Lidarr - Lossless (Praxrr)'
    AND qpf.custom_format_name = 'Lidarr - FLAC (Praxrr)'
    AND qpf.arr_type = 'lidarr'
);
```

**JSON/YAML equivalent difficulty: HARD.** The multi-table existence checking is relational logic that doesn't map cleanly to a declarative document format. Would need either a DSL or explicit precondition syntax.

### 2e. INSERT with FROM clause joining multiple tables (HARD)

```sql
INSERT INTO custom_format_tags (custom_format_name, tag_name)
SELECT cf.name, t.name
FROM custom_formats cf, tags t
WHERE cf.name = 'Lidarr - FLAC (Praxrr)' AND t.name = 'Audio'
AND NOT EXISTS (...);
```

**JSON/YAML equivalent difficulty: HARD.** The cross-table JOIN is used for referential safety -- ensuring both entities exist before linking. JSON/YAML would need either: (a) trust the foreign keys to fail at execution, or (b) a separate validation layer.

### 2f. INSERT with CTE (Common Table Expression) (VERY HARD)

```sql
WITH flac_conditions (custom_format_name, name, type, negate, required) AS (
  VALUES
    ('Lidarr - FLAC (Praxrr)', 'FLAC', 'release_title', 0, 1),
    ('Lidarr - FLAC (Praxrr)', 'Not AAC', 'release_title', 1, 1)
)
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
SELECT seed.custom_format_name, seed.name, seed.type, 'lidarr', seed.negate, seed.required
FROM flac_conditions seed
WHERE EXISTS (...) AND NOT EXISTS (...);
```

**JSON/YAML equivalent difficulty: VERY HARD.** CTEs are used for batch inserts with shared guards. The CTE itself could be expressed as an array, but the combined CTE + conditional SELECT + EXISTS guard is deeply relational.

### 2g. UPDATEs with value guards (MODERATE)

The core conflict detection mechanism:

```sql
UPDATE "custom_formats" SET "include_in_rename" = 1
WHERE "name" = 'AMZN' AND "include_in_rename" = 0;
```

The WHERE clause includes BOTH the identity condition (`name = 'AMZN'`) AND the guard condition (`include_in_rename = 0`). If upstream changed the value, the guard fails (0 rows affected), triggering conflict detection.

**JSON/YAML equivalent difficulty: MODERATE.** Could be expressed as `{"where": {"name": "AMZN"}, "guard": {"include_in_rename": 0}, "set": {"include_in_rename": 1}}`, but the elegance of SQL's WHERE clause combining identity + guard is hard to match.

### 2h. UPDATE for renames with CASCADE effects (MODERATE)

```sql
UPDATE "regular_expressions" SET "name" = 'Movie Extras' WHERE "name" = 'Extras';
UPDATE "condition_patterns" SET "regular_expression_name" = 'Movie Extras'
WHERE "custom_format_name" = 'Extras' AND "condition_name" = 'Extras'
AND "regular_expression_name" = 'Extras';
```

Due to `ON UPDATE CASCADE` foreign keys, the first UPDATE propagates name changes automatically. But the second UPDATE is still issued explicitly for guarded changes to junction tables.

**JSON/YAML equivalent difficulty: MODERATE.** Renames are conceptually simple but the cascade semantics are implicit in the SQL schema.

### 2i. DELETE statements with value guards (MODERATE)

```sql
DELETE FROM "quality_profile_custom_formats"
WHERE "quality_profile_name" = '1080p Balanced'
  AND "custom_format_name" = 'Remux (Source)'
  AND "arr_type" = 'sonarr'
  AND "score" = -999999;
```

The `score = -999999` is a guard value -- if upstream changed the score, this delete won't match.

**JSON/YAML equivalent difficulty: MODERATE.** Same pattern as update guards.

### 2j. CASCADE deletes via parent entity (TRIVIAL)

```sql
DELETE FROM "custom_formats" WHERE "name" = 'TV Extras';
```

Due to `ON DELETE CASCADE` foreign keys, this removes the custom format AND all its conditions, condition values, profile scores, tags, and tests.

**JSON/YAML equivalent difficulty: TRIVIAL** if the system handles cascades, but the cascade behavior is defined in the SQL schema, not the ops file.

### 2k. Raw SQL in condition update handler (CRITICAL)

In `entities/customFormats/conditions/update.ts`, SQL is generated as raw strings with manual escaping:

```typescript
sqls.push(
  `INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
   VALUES ('${esc(formatName)}', '${esc(conditionName)}', '${esc(pattern.name)}')`
);
```

This bypasses Kysely's query builder entirely for ~200 lines of hand-crafted SQL generation across 10 condition types.

**JSON/YAML equivalent difficulty: MODERATE** for the data itself, but CRITICAL for the migration effort since this code builds SQL strings directly.

### 2l. Custom SQLite Functions (UNIQUE TO SQL)

The PCDCache registers helper functions:

```typescript
this.db.function('qp', (name: string) => {
  const result = this.db!.prepare(
    'SELECT id FROM quality_profiles WHERE name = ?'
  ).get(name);
  return result.id;
});
// Also: cf(), dp(), mp(), tag()
```

While these exist in the schema, I did not find them used in any current ops files. They appear to be reserved for potential future use or were used in an earlier iteration.

### 2m. INSERT with SELECT FROM qualities (MODERATE)

Quality API mappings use self-referencing inserts:

```sql
INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
SELECT name, 'radarr', name FROM qualities WHERE name IN (...);

INSERT INTO quality_api_mappings (quality_name, arr_type, api_name)
SELECT name, 'sonarr', 'Bluray-1080p Remux' FROM qualities WHERE name = 'Remux-1080p';
```

The second variant maps a quality name to a DIFFERENT api_name, which is a relational operation.

**JSON/YAML equivalent difficulty: MODERATE.** The self-join pattern could be expressed declaratively, but the name remapping needs explicit representation.

---

## 3. SQL Parsing Pipeline (Complete Trace)

### 3a. File Discovery and Loading

**Entry point**: `loadAllOperations()` in `ops/loadOps.ts`

Four-layer loading order:

1. **Schema layer** (files): `{pcdPath}/deps/schema/ops/` -- loaded via `loadOperationsFromDir()`
2. **Base layer** (DB): Published base ops, then draft base ops with sequence offset of 3,000,000,000
3. **Tweaks layer** (files): `{pcdPath}/tweaks/` -- optional
4. **User ops layer** (DB): Published user ops

File loading (`utils/operations.ts`):

- Reads `.sql` files from directory
- Extracts numeric order from filename prefix (e.g., `0.schema.sql` -> 0)
- Returns `Operation[]` with `{ filename, filepath, sql, order, layer }`

DB loading (`ops/loadOps.ts`):

- Queries `pcd_ops` table via `pcdOpsQueries.listByDatabaseAndOrigin()`
- Returns `Operation[]` with filepath as `pcd_ops:{id}` (synthetic path for DB-sourced ops)

### 3b. Metadata Extraction (Import Time Only)

**Location**: `importBaseOps.ts:parseMetadata()`

```typescript
const match = line.match(/^--\s*@([a-zA-Z_]+)\s*:\s*(.*)$/);
```

This regex extracts key-value pairs from SQL comment lines starting with `@`. The metadata is stripped from the SQL content and stored separately as a JSON string in the `pcd_ops.metadata` column. The cleaned SQL is what gets executed.

Required metadata fields: `operation`, `entity`, `name`. Optional: `previousName`, `summary`, `title`, `changed_fields`, `stable_key`, `group_id`, `generated`, `depends_on`.

### 3c. Execution

**Location**: `database/cache.ts:build()`

```typescript
this.db.exec(operation.sql);
```

The cleaned SQL is passed directly to SQLite's `exec()` method. This means:

- Multiple statements in a single op are executed sequentially
- No parameterized queries -- all values are baked into the SQL string
- Row change counting via `this.db.totalChanges` for conflict detection
- Zero rows changed on a user op triggers conflict detection logic

### 3d. Validation

**Location**: `database/cache.ts:validateSql()`

Before writing, new operations are validated by executing them inside a SQLite SAVEPOINT:

```typescript
this.db!.exec('SAVEPOINT validation_check');
for (const sql of sqlStatements) {
  this.db!.exec(sql);
}
this.db!.exec('ROLLBACK TO SAVEPOINT validation_check');
```

This is a "try it and see" approach that relies on SQLite itself for validation. Any JSON/YAML format would need to either: (a) compile to SQL for validation, or (b) implement equivalent constraint checking in application code.

---

## 4. Entity Relationship Map (Write Order Requirements)

### Independent Entities (No FK Dependencies)

| Entity              | Table                 | Notes                                       |
| ------------------- | --------------------- | ------------------------------------------- |
| Tags                | `tags`                | Simple name-only inserts                    |
| Languages           | `languages`           | Schema-layer seed                           |
| Regular Expressions | `regular_expressions` | May have tags via `regular_expression_tags` |
| Qualities           | `qualities`           | Schema-layer seed                           |

### First-Level Dependents

| Entity               | Tables Written                                                                                                                                                                    | Depends On                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Custom Format        | `custom_formats`, `custom_format_tags`, `custom_format_conditions`, `condition_*` (9 tables)                                                                                      | tags, regular_expressions (for pattern conditions) |
| Quality Profile      | `quality_profiles`, `quality_groups`, `quality_group_members`, `quality_profile_qualities`, `quality_profile_languages`, `quality_profile_custom_formats`, `quality_profile_tags` | custom_formats, qualities, languages, tags         |
| Delay Profile        | `delay_profiles`                                                                                                                                                                  | None (tags were removed)                           |
| Quality API Mappings | `quality_api_mappings`                                                                                                                                                            | qualities                                          |

### Second-Level Dependents

| Entity                    | Tables Written                                                                | Depends On                          |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| Custom Format Conditions  | `custom_format_conditions`, `condition_patterns`, `condition_languages`, etc. | custom_formats, regular_expressions |
| Quality Profile Scores    | `quality_profile_custom_formats`                                              | quality_profiles, custom_formats    |
| Quality Profile Qualities | `quality_profile_qualities`, `quality_groups`, `quality_group_members`        | quality_profiles, qualities         |

### JSON/YAML Implication

A custom format with conditions requires writes to up to **11 tables** in correct order:

1. `custom_formats` (parent)
2. `custom_format_tags` (junction)
3. `custom_format_conditions` (children)
4. `condition_patterns` / `condition_languages` / `condition_sources` / `condition_resolutions` / `condition_quality_modifiers` / `condition_release_types` / `condition_indexer_flags` / `condition_sizes` / `condition_years` (polymorphic type-specific data)

A quality profile requires writes to up to **7 tables**:

1. `quality_profiles`
2. `quality_groups`
3. `quality_group_members`
4. `quality_profile_qualities`
5. `quality_profile_languages`
6. `quality_profile_custom_formats`
7. `quality_profile_tags`

---

## 5. Hidden Dependencies on SQL Format

### 5a. Conflict Detection Relies on SQL Execution Semantics

The entire conflict detection system (`database/cache.ts` lines 109-229) depends on counting affected rows from SQL execution:

```typescript
const beforeChanges = trackHistory ? this.db!.totalChanges : 0;
this.db.exec(operation.sql);
const rowcount = this.db!.totalChanges - beforeChanges;
if (rowcount === 0 && isUserOp) {
  // Conflict detected -- guard failed
}
```

JSON/YAML ops would need either:

- Compile to SQL and use the same counting mechanism
- Implement custom conflict detection that replicates value-guard semantics

### 5b. SQL Regex Parsing in Override Conflict Resolution

`conflicts/overrideUtils.ts:extractRenamesFromSql()` parses SQL strings to extract rename mappings:

```typescript
const pattern = new RegExp(
  `update\\s+"${escaped}"\\s+set\\s+"name"\\s*=\\s*'((?:[^']|'')*)'\\s+where\\s+"name"\\s*=\\s*'((?:[^']|'')*)'`,
  'gi'
);
```

This directly parses stored SQL to follow rename chains through batch ops. A JSON/YAML format would eliminate this fragile regex parsing -- a clear improvement.

### 5c. Export Pipeline Generates SQL Files

The exporter (`ops/exporter.ts`) constructs SQL files for git push:

```typescript
const header = buildHeader(trimmedMessage, opIdList, exportedAt);
const body = ops.map((op) => formatOpBlock(op)).join('\n\n');
const fileContent = `${header}\n\n${body}\n`;
```

And filenames are hardcoded as `.sql`:

```typescript
const filename = `${opNumber}.${slugify(trimmedMessage)}.sql`;
```

### 5d. Writer Pipeline (Kysely -> SQL -> DB)

The write pipeline in `ops/writer.ts` follows this flow:

1. Entity CRUD handler builds Kysely `CompiledQuery` objects
2. `compiledQueryToSql()` converts them to raw SQL strings (replacing `?` with inline values)
3. SQL is validated against the cache via `SAVEPOINT` execution
4. SQL string is stored in `pcd_ops.sql` column
5. On next compile, the SQL string is executed via `db.exec()`

This means Kysely is used as a **query builder** but the output is always SQL strings. The system never uses Kysely's execution engine.

### 5e. Hand-Written SQL Generation

`entities/customFormats/conditions/update.ts` contains ~200 lines of hand-crafted SQL string generation for 10 condition types, bypassing Kysely entirely:

```typescript
sqls.push(
  `INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
   VALUES ('${esc(formatName)}', '${esc(conditionName)}', '${esc(pattern.name)}')`
);
```

These would all need to be rewritten for a JSON/YAML format.

### 5f. Built-In Base Ops in Migrations

`ops/seedBuiltInBaseOps.ts` imports SQL strings from migration files:

```typescript
import {
  LIDARR_MEDIA_MANAGEMENT_OP_SQL,
  LIDARR_MEDIA_MANAGEMENT_OP_METADATA,
} from '$db/migrations/20260215_add_lidarr_media_management_entities.ts';
```

These migrations define SQL as exported constants. A format change would require updating both the migration files and the seeding mechanism.

### 5g. File Extension Hardcoding

Multiple locations check for `.sql` extension:

- `utils/operations.ts`: `!entry.name.endsWith('.sql')`
- `ops/importBaseOps.ts`: `!entry.name.endsWith('.sql')`
- `utils/git.ts`: `!filename.endsWith('.sql')`
- `ops/exporter.ts`: generates `.sql` filenames

---

## 6. Write/Export Pipeline Analysis

### UI Edit to SQL Op Flow

1. **User makes edit** in Svelte UI
2. **API route** calls entity CRUD handler (e.g., `customFormats/create.ts`)
3. **CRUD handler** builds Kysely queries or raw SQL strings
4. **`writeOperation()`** receives `CompiledQuery[]` plus metadata
5. **`compiledQueryToSql()`** converts queries to SQL strings
6. **Validation**: SQL executed in SAVEPOINT against current cache
7. **Storage**: SQL string + metadata JSON stored in `pcd_ops` table
8. **Recompile**: Full cache rebuild to reflect new state

### Export to Git Flow

1. **User selects draft ops** to export
2. **`buildExportPlan()`** collects draft ops, calculates next op number
3. **`formatOpBlock()`** wraps each op's SQL with BEGIN/END markers
4. **`buildHeader()`** generates metadata comment headers
5. **File written** to clone of PCD repo as `{N}.{slug}.sql`
6. **Git commit + push** to remote
7. **Draft ops** marked as superseded, new published base op created

### Reverse Pipeline (Export -> Import)

When another user pulls the repo:

1. **`importBaseOps()`** reads `.sql` files from `ops/` directory
2. **`parseMetadata()`** extracts metadata headers, strips them from SQL
3. **Cleaned SQL + metadata JSON** stored in `pcd_ops` table
4. **Cache compilation** executes all ops in sequence

---

## 7. Schema Generation Pipeline Assessment

### Current Approach (`scripts/generate-pcd-types.ts`)

1. Loads `0.schema.sql` from local workspace or GitHub
2. Creates in-memory SQLite database and executes the SQL
3. Uses SQLite introspection (`PRAGMA table_info`, `PRAGMA foreign_key_list`) to discover tables and columns
4. Parses `CHECK` constraints from CREATE TABLE SQL using regex
5. Generates TypeScript interfaces with semantic type mapping (boolean detection, enum extraction)

### JSON Schema Alternative Assessment

**Advantages:**

- JSON Schema could serve as a single source of truth for both validation and type generation
- Better tooling ecosystem for JSON Schema validation
- Could eliminate the SQLite introspection step

**Disadvantages:**

- The current approach is elegant: the SQL schema IS the contract, and types are generated by running it
- JSON Schema cannot express relational constraints (foreign keys, composite unique indexes, partial unique indexes)
- The `CHECK` constraint parsing works well for the enum-like columns
- A JSON Schema would need a SEPARATE mapping to SQL DDL for the actual SQLite database creation

**Assessment: The current approach is actually superior** for this use case because the SQL schema is the authoritative definition for an SQLite database. Generating types from the schema ensures perfect alignment. A JSON Schema layer would be an additional abstraction that could drift from the actual database schema.

---

## 8. Difficulty Assessment by Category

### Trivial to Express in JSON/YAML

- Simple entity creation (INSERT INTO ... VALUES ...)
- Entity deletion (DELETE FROM ... WHERE name = ...)
- Simple field updates without guards
- Metadata headers (already stored as JSON internally)

### Moderate to Express in JSON/YAML

- Updates with single-table value guards
- Conditional inserts (WHERE NOT EXISTS on same table)
- Rename operations
- Delete with value guards

### Hard to Express in JSON/YAML

- Multi-table existence guards (EXISTS + NOT EXISTS across different tables)
- INSERT ... SELECT FROM with JOINs
- CTE-based batch operations
- The implicit cascade semantics (ON DELETE CASCADE, ON UPDATE CASCADE)

### Cannot Express in JSON/YAML Without a Custom DSL

- Arbitrary SQL logic (future extensibility)
- The current conflict detection mechanism (row counting)
- SAVEPOINT-based validation

---

## 9. Files That Would Need Modification

### Core Pipeline Files (Must Change)

| File                            | Lines | Impact                                    |
| ------------------------------- | ----- | ----------------------------------------- |
| `pcd/ops/loadOps.ts`            | 81    | Must load JSON/YAML instead of SQL        |
| `pcd/ops/importBaseOps.ts`      | 127   | Must parse new format + convert to SQL    |
| `pcd/ops/writer.ts`             | 394   | Must output JSON/YAML instead of SQL      |
| `pcd/ops/exporter.ts`           | 682   | Must generate new format files for git    |
| `pcd/ops/seedBuiltInBaseOps.ts` | 127   | Must store new format                     |
| `pcd/ops/draftChanges.ts`       | 890   | Mostly metadata-driven, moderate changes  |
| `pcd/database/cache.ts`         | 543   | Must compile JSON/YAML to SQL before exec |
| `pcd/utils/operations.ts`       | 162   | File extension, loading logic             |
| `pcd/utils/sql.ts`              | 64    | May become unnecessary or transform layer |
| `pcd/utils/git.ts`              | 24    | File extension                            |

### Entity CRUD Handlers (Must Change)

38 files across `pcd/entities/` that call `writeOperation()` with `CompiledQuery[]`. Each would need to output the new format instead of SQL queries.

### Conflict Resolution (Must Change)

| File                             | Lines | Impact                                              |
| -------------------------------- | ----- | --------------------------------------------------- |
| `pcd/conflicts/overrideUtils.ts` | 254   | SQL regex parsing must change                       |
| `pcd/conflicts/override.ts`      | ~200+ | Re-executes ops, depends on SQL                     |
| `pcd/conflicts/autoAlign/`       | ~300+ | Reads metadata + desired state (less SQL-dependent) |

### Migration Files (Must Change)

6 migration files in `$db/migrations/` export SQL constants for built-in base ops.

### Schema Generation (No Change Needed)

`scripts/generate-pcd-types.ts` works from the SQL schema, not the ops format. It would be unaffected.

### PCD Database Repo (Must Change)

All 57 SQL files in `packages/praxrr-db/ops/` would need conversion to the new format.

---

## 10. Critical Observations

### 10a. The System Already Stores JSON Metadata

The `pcd_ops` table already stores:

- `sql` -- the raw SQL string
- `metadata` -- JSON string with operation/entity/name/etc.
- `desired_state` -- JSON string with before/after values
- `content_hash` -- SHA-256 of sql + metadata

The metadata and desired_state columns already capture the INTENT of each operation in JSON. The SQL column captures the EXECUTION. A JSON/YAML format would essentially need to merge these two representations.

### 10b. The Initial Seed Was Generated from YAML

The comment at the top of `0.rosettarr.sql`:

```sql
-- Generated by YAML to SQL Converter
-- Generated at: 2026-01-31T00:15:41.102Z
```

This proves that a YAML -> SQL pipeline has already existed. However, the YAML source is NOT part of the repository, suggesting it was a one-time conversion tool.

### 10c. Dual Write Path Complexity

Entity CRUD handlers use two different SQL generation approaches:

1. **Kysely query builder** (most handlers): `db.insertInto('custom_formats').values({...}).compile()`
2. **Raw SQL strings** (conditions handler): Template literal SQL with manual escaping

A migration would need to handle both paths.

### 10d. The "Desired State" Pattern Is Proto-JSON-Ops

The `desired_state` JSON already captures what a JSON op format would need:

```json
{
  "name": { "from": "Old Name", "to": "New Name" },
  "include_in_rename": { "from": false, "to": true },
  "conditions": {
    "added": [{ "name": "FLAC", "base": {...}, "values": {...} }],
    "removed": [...],
    "updated": [...]
  }
}
```

This is essentially a diff format. However, it currently serves only for UI display and conflict detection -- it is NOT used for SQL generation. The SQL is the source of truth for execution.

### 10e. File-Based and DB-Based Ops Coexist

The system loads ops from BOTH files (schema, tweaks) and database (base, user). A format migration would need to handle both storage backends.

---

## 11. Quantified Migration Impact

| Category                | File Count     | Estimated LOC Affected           |
| ----------------------- | -------------- | -------------------------------- |
| Core pipeline           | 10 files       | ~3,000 lines                     |
| Entity CRUD handlers    | 38 files       | ~5,000 lines                     |
| Conflict resolution     | 5+ files       | ~800 lines                       |
| Migration constants     | 6 files        | ~300 lines                       |
| PCD database conversion | 57 SQL files   | ~25,000+ lines of SQL to convert |
| Test updates            | Unknown        | Likely significant               |
| **Total**               | **~116 files** | **~34,000+ lines**               |

---

## 12. Hidden Architectural Assumptions

1. **SQL IS the execution format**: The system never interprets ops -- it executes them. Any new format creates an interpretation layer.
2. **Row counting IS conflict detection**: No application-level diffing exists for detecting guard failures.
3. **SAVEPOINT IS validation**: No schema-level validation exists outside SQLite itself.
4. **Append-only ops are idempotent by design**: The `WHERE NOT EXISTS` and value guard patterns make replaying safe. JSON/YAML ops would need equivalent semantics.
5. **The export format IS the import format**: The same SQL that gets exported to git is what gets imported. There is no separate "wire format" vs "storage format".
6. **Foreign key cascades are implicit behavior**: Deleting a custom format silently cascades to conditions, patterns, scores, tags, and tests. This behavior is in the schema, not the ops, but ops rely on it.
