# Contrarian Analysis: Why Migrating PCD Ingestion from SQL Ops to JSON/YAML May Be a Bad Idea

## Executive Summary

The proposal to migrate Praxrr's PCD ingestion format from SQL ops to JSON/YAML is more dangerous than it appears on the surface. After deep examination of the codebase -- the schema with 33+ interrelated tables, the append-only ops model with value guards, the four-layer compilation pipeline, the conflict detection/resolution system, and the export pipeline -- I find that the "readability" and "TRaSH alignment" benefits are real but narrow, while the hidden costs are structural and systemic. The current SQL ops format is not an accident of history; it is load-bearing infrastructure that encodes relational integrity semantics, conditional mutation logic, and ordering guarantees that JSON/YAML cannot natively express without reinventing a significant portion of what SQL already provides.

---

## 1. Relational Integrity Loss: JSON/YAML Cannot Express What the Schema Enforces

**Confidence**: High -- verified directly from `packages/praxrr-schema/ops/0.schema.sql`

The PCD schema has 33+ tables with cascading foreign keys, CHECK constraints, UNIQUE indexes, and composite primary keys. The current system uses the in-memory SQLite engine itself as the validator: when you execute `INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)`, SQLite immediately enforces:

1. The custom_format referenced by `custom_format_name` exists in `custom_formats`
2. The `(custom_format_name, condition_name)` pair exists in `custom_format_conditions`
3. The `regular_expression_name` exists in `regular_expressions`
4. The row does not violate the PRIMARY KEY uniqueness

This happens atomically, at write time, with zero application code. The database engine IS the validator.

### What JSON/YAML would require instead

A JSON/YAML representation of a custom format must somehow declare its conditions, condition type tables (patterns, languages, sources, etc.), and regex references. But JSON has no native concept of foreign key references. You would need to build:

- **A reference resolver**: When a `condition_pattern` references `regular_expression_name: "AVC"`, the system must verify that a regex named "AVC" exists -- either in the same file, a prior file, or a sibling file. This is a graph resolution problem.
- **A constraint validator**: CHECK constraints like `delay_profiles.preferred_protocol IN ('prefer_usenet', 'prefer_torrent', 'only_usenet', 'only_torrent')` and the three interlocking CHECK constraints on delay_profiles that enforce `usenet_delay IS NULL` only when `only_torrent` must be reimplemented as application-level validation.
- **A uniqueness enforcer**: Composite UNIQUE constraints like `UNIQUE(custom_format_name, name)` on `custom_format_conditions` must be checked across all loaded documents.

The critical insight: SQLite validates all of this during compilation for free. Moving to JSON/YAML means you must reimplement SQLite's constraint engine in application code, or you must still compile JSON/YAML down to SQL and execute it against SQLite anyway -- in which case the JSON/YAML layer adds indirection without adding value to the integrity story.

### Concrete failure scenario

Consider `ops/39.create-not-original-or-english-cf.sql`. This single export batch:

1. Creates a custom format in `custom_formats`
2. Adds two conditions to `custom_format_conditions` (each with different `arr_type`)
3. Adds two entries to `condition_languages` referencing those conditions
4. Adds a tag junction in `custom_format_tags`
5. Updates descriptions on three OTHER custom formats with value guards

In JSON/YAML, you would need either:

- A deeply nested document that represents all of this, with the system knowing how to decompose it into the right INSERT/UPDATE sequence, OR
- Multiple documents with explicit ordering and cross-file references

Both approaches replicate what SQL already handles through its execution model.

---

## 2. The Value Guard Problem: JSON/YAML Has No Native Conditional Mutation

**Confidence**: High -- verified across all 56 migration files in `packages/praxrr-db/ops/`

This is the most severe issue. Value guards are the foundation of Praxrr's conflict detection system. Every UPDATE operation in the PCD looks like this:

```sql
UPDATE "custom_formats"
SET "include_in_rename" = 1
WHERE "name" = 'AMZN' AND "include_in_rename" = 0;
```

The `AND "include_in_rename" = 0` clause is the value guard. If the user has already changed this field to a different value, the UPDATE affects 0 rows, and the compilation pipeline detects the conflict via `this.db!.totalChanges - beforeChanges`.

This is fundamental to the system's behavior as documented in `cache.ts`:

```typescript
const rowcount = this.db!.totalChanges - beforeChanges;
// ...
if (rowcount === 0 && isUserOp) {
  // Conflict detection: evaluate auto-align rules, record as conflicted
}
```

### Why JSON/YAML cannot express this

JSON/YAML is declarative state, not conditional operations. You can say "set field X to value Y" but you cannot natively say "set field X to value Y only if it is currently value Z." To preserve the conflict detection behavior, a JSON/YAML format would need:

**Option A: Embed old-value checks in the JSON**

```yaml
updates:
  - entity: custom_formats
    where: { name: 'AMZN' }
    set: { include_in_rename: 1 }
    guard: { include_in_rename: 0 } # <-- this is just SQL's WHERE clause in YAML
```

At this point, you have reinvented SQL's UPDATE semantics in YAML with more characters and less tooling. You get no readability benefit because the guard clause IS the complexity -- it is the thing that makes the operation conditional rather than destructive.

**Option B: Use desired-state declarations**

```yaml
custom_formats:
  AMZN:
    include_in_rename: true
```

This loses the guard entirely. If upstream changes `include_in_rename` from 0 to 0 (no-op), and then the user sets it to 1, and then upstream changes it to 0 again with a new rationale, the user's desired-state declaration would silently override the upstream change. The value guard exists precisely to detect this scenario. Without it, you are choosing between "always override" and "always align" with no ability to detect the conflict at all.

**Option C: Use from/to pairs**

```yaml
custom_formats:
  AMZN:
    include_in_rename:
      from: 0
      to: 1
```

This is functionally identical to the SQL WHERE clause but in a less standard, less tested format. The from/to pattern is already used in `desired_state` metadata for override conflict resolution (see `overrideUtils.ts`), but it is metadata about the operation, not the operation itself. Making it the primary format means you are designing a custom mutation DSL.

### The multi-statement compound guard problem

The issue gets worse with multi-statement ops. From `ops/4.merge-movie-tv-extras-cf.sql`, a single logical operation spans multiple ops:

```sql
-- Delete old condition with full value guard
DELETE FROM custom_format_conditions
WHERE custom_format_name = 'Extras'
  AND name = 'Extras'
  AND type = 'release_title'
  AND arr_type = 'all'
  AND negate = 0
  AND required = 1;

-- Insert new arr-scoped conditions
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
VALUES ('Extras', 'Movie Extras', 'release_title', 'radarr', 0, 1);
```

The DELETE has a 6-field value guard. The INSERT must only happen if the DELETE succeeded. In SQL, this is natural: the statements execute sequentially, and if the DELETE matches 0 rows (guard failure), the INSERT still succeeds but creates a partial state that is detected by `checkFullListConflict()`. In JSON/YAML, expressing "delete this row only if all these fields match, then insert this new row" requires either transaction semantics (which JSON/YAML does not have) or a compilation step that generates SQL anyway.

---

## 3. Ordering and Dependencies: The Four-Layer Problem

**Confidence**: High -- verified from `loadOps.ts`

The PCD compilation pipeline loads operations in strict layer order:

1. **Schema layer** (from dependency -- table definitions)
2. **Base layer** (published ops, then drafts, ordered by sequence number)
3. **Tweaks layer** (optional files)
4. **User ops layer** (local modifications)

Within the base layer, ops are ordered by file number (0, 1, 2, ... 56) and within each file by op ID sequence. This ordering is essential because:

- Op 52 renames regex "Extras" to "Movie Extras"
- Op 53 updates `condition_patterns` to reference the new name "Movie Extras"
- Op 54 deletes old conditions and inserts new arr-scoped ones

If op 53 runs before op 52, it will fail because "Movie Extras" does not exist yet.

### JSON/YAML ordering challenges

JSON objects are formally unordered. YAML mapping keys are formally unordered. While most parsers preserve insertion order, relying on this for correctness is fragile. You would need:

- **Explicit sequence numbering** in every document (replicating SQL file numbering)
- **Dependency declarations** between documents (a dependency graph)
- **A topological sort** at compile time

The current system gets this for free from file numbering and sequential SQL execution. Moving to JSON/YAML means building a dependency resolution system from scratch.

### The rename cascade problem

From `overrideUtils.ts`, the system already has `followRenameChain()` which parses SQL UPDATE statements to trace entity renames through base ops:

```typescript
function extractRenamesFromSql(sql: string, tableName: string, renameMap: Map<string, string>): void {
  const pattern = new RegExp(
    `update\\s+"${escaped}"\\s+set\\s+"name"\\s*=\\s*'((?:[^']|'')*)'\\s+where\\s+"name"\\s*=\\s*'((?:[^']|'')*)'`,
    'gi'
  );
}
```

This function parses raw SQL to find rename operations. In a JSON/YAML world, you would need an analogous rename-tracking mechanism. But because JSON/YAML does not naturally encode "rename X to Y," you would need a dedicated `rename` operation type -- adding yet another operation primitive to your JSON/YAML DSL.

---

## 4. Migration Complexity: 56 Incremental Migration Files Are Not Trivially Expressible

**Confidence**: High -- verified from all ops files in `packages/praxrr-db/ops/`

The 56 existing migration files (ops 0 through 56) contain sophisticated SQL patterns:

### Pattern 1: Conditional INSERT with NOT EXISTS guard (idempotency)

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

This is a guarded INSERT that only fires if the row does not already exist. JSON/YAML has no native concept of conditional insertion.

### Pattern 2: Cross-entity batch operations

`ops/42.regroup-and-reorder-quality-rankings-for-all-profiles-for-te.sql` contains 249 op IDs in a single batch, performing coordinated DELETE/INSERT cycles across `quality_profile_qualities`, `quality_group_members`, and `quality_groups` for every quality profile. A single profile's regroup involves:

1. Delete old quality group quality item reference
2. Delete old quality group members
3. Delete old quality group
4. Insert new standalone quality items with correct position/enabled/upgrade_until

This repeats for every quality profile. In JSON/YAML, you could represent the "desired final state" of quality profile qualities, but then you lose the incremental nature of the migration. You cannot express "take whatever state this profile has and restructure its quality ordering" -- you can only express "this is what the profile should look like," which means every migration becomes a full snapshot, not a delta.

### Pattern 3: Multi-entity rename chains

`ops/8.merge-upscale-cfs-and-rescore.sql` renames regular expressions, updates condition patterns to reference the new names, deletes the old CF's scores from every quality profile, deletes the old CF, restructures conditions on the surviving CF with arr-type scoping, and re-adds scores for the surviving CF to every profile. This involves:

- 2 regex renames
- 6 condition_pattern updates
- 11 quality_profile_custom_formats deletions
- 1 custom_format deletion
- 3 condition deletions and 3 condition insertions
- 11 conditional quality_profile_custom_formats insertions

Converting this to JSON/YAML means either:
(a) A massive document that encodes all 31 operations with ordering, or
(b) A "desired state" snapshot that requires diffing against current state to determine what changed -- fundamentally changing the architecture from append-only ops to state-based diffing.

---

## 5. Export Pipeline: Now You Have Two Formats

**Confidence**: High -- verified from `exporter.ts`

The export pipeline (`exporter.ts`) is a sophisticated system that:

1. Runs preflight checks (repo status, git identity, branch state)
2. Resolves selected ops including dependency groups
3. Generates a SQL file with header, op blocks, and sequential numbering
4. Clones the repo, writes the file, commits, and pushes
5. Marks draft ops as superseded

The output format is SQL:

```typescript
function formatOpBlock(op: { id: number; metadata?: string | null; sql: string }): string {
  const label = opLabel(op);
  const trimmedSql = op.sql.trim().replace(/;\s*$/, '');
  return [`-- --- BEGIN op ${op.id}${title}`, `${trimmedSql};`, `-- --- END op ${op.id}`].join('\n');
}
```

If the ingestion format changes to JSON/YAML, you face a choice:

**Option A: Export stays as SQL.** Now you have two formats: JSON/YAML for ingestion, SQL for export. The writer pipeline generates SQL from Kysely queries (`compiledQueryToSql`), so exports are naturally SQL. Users editing their PCD would write JSON/YAML, but their exported edits would be SQL. This is confusing and requires maintaining two parsers.

**Option B: Export changes to JSON/YAML.** Now you need to convert Kysely-generated SQL statements (with value guards) into JSON/YAML documents. The writer already validates against the in-memory cache using `cache.validateSql(sqlStatements)`. You would need a JSON/YAML validator too. The writer's cancel-out logic (detecting when a delete cancels a create) and supersede logic currently operate on SQL metadata -- these would need JSON/YAML equivalents.

**Option C: Dual format support.** You maintain SQL for existing ops and JSON/YAML for new ones. The `loadOps.ts` loader would need to handle both formats, the compiler would need to parse both, and the conflict detection system would need to work with both. This doubles the surface area for bugs.

All three options increase maintenance burden. The current system has one format, one parser, one validator.

---

## 6. The Compile-Time Transformation Tax: Building a JSON/YAML to SQL Compiler

**Confidence**: High -- based on architectural analysis

The proposal necessarily requires a JSON/YAML to SQL compiler. This is not a simple template system. It must handle:

### 6.1 Entity decomposition

A single "custom format" JSON document must be decomposed into INSERTs across:

- `custom_formats` (1 row)
- `custom_format_conditions` (N rows, one per condition)
- `condition_patterns` / `condition_languages` / `condition_sources` / etc. (one per condition, polymorphic dispatch by type)
- `custom_format_tags` (M rows)
- `custom_format_tests` (K rows)

The compiler must know the schema's decomposition rules and generate correct INSERT ordering (parent before child).

### 6.2 Update decomposition with guards

An update to a custom format's condition pattern must generate:

```sql
UPDATE condition_patterns
SET regular_expression_name = 'New Name'
WHERE custom_format_name = 'CF Name'
  AND condition_name = 'Cond Name'
  AND regular_expression_name = 'Old Name';
```

The compiler must determine which fields changed, generate the appropriate WHERE clause with old-value guards, and handle cascading updates across related tables.

### 6.3 Migration (delta) generation

If the JSON/YAML represents desired state, the compiler must diff it against current state to generate incremental ops. This is a fundamentally different architecture from append-only ops, requiring:

- Snapshot comparison logic per entity type
- Diff-to-ops conversion for every table
- Ordering of generated ops to respect FK constraints

### 6.4 Risk assessment

This compiler would be a new subsystem of substantial complexity. Bugs in the compiler would silently corrupt the PCD database. The current system has no compiler between the ops format and execution -- SQL is both the storage format and the execution format. Adding a compilation layer adds a category of bugs (incorrect SQL generation) that does not currently exist.

Every edge case in SQL generation (escaping single quotes in regex patterns, handling NULL vs empty string, integer vs boolean coercion for SQLite) becomes a potential bug in the compiler. The current system avoids these because Kysely (the query builder) handles SQL generation, and its output is directly stored as the operation.

---

## 7. TRaSH Alignment Is Superficial

**Confidence**: High -- verified by comparing TRaSH format against PCD schema

The TRaSH-Guides JSON format for a custom format looks like:

```json
{
  "trash_id": "unique-id",
  "trash_scores": { "default": -10000 },
  "name": "BR-DISK",
  "includeCustomFormatWhenRenaming": false,
  "specifications": [
    {
      "name": "BR-DISK",
      "implementation": "ReleaseTitleSpecification",
      "negate": false,
      "required": true,
      "fields": { "value": "<regex>" }
    }
  ]
}
```

Each TRaSH JSON file represents **one standalone custom format** with its conditions inlined. This is a flat, self-contained document.

Praxrr's schema is fundamentally different:

1. **Regular expressions are first-class entities** shared across custom formats. A regex like "AVC" is defined once in `regular_expressions` and referenced by name from `condition_patterns`. TRaSH inlines the regex value directly. Praxrr's approach enables:
   - Shared regex reuse across CFs
   - Tagging regexes independently
   - Regex101 ID linking
   - Renaming a regex without updating every CF that uses it (ON UPDATE CASCADE)

2. **Quality profile scoring is relational, not embedded.** TRaSH puts `trash_scores` in the CF file. Praxrr stores scores in `quality_profile_custom_formats` with a composite key `(quality_profile_name, custom_format_name, arr_type)`. Scores belong to the profile-CF relationship, not to the CF itself.

3. **Conditions have arr_type scoping.** A single CF can have conditions that apply only to Radarr, only to Sonarr, or both. TRaSH has separate Radarr and Sonarr directories. Praxrr unifies them with `arr_type` scoping.

4. **Quality profiles involve 6 tables.** A quality profile requires coordinated data in `quality_profiles`, `quality_groups`, `quality_group_members`, `quality_profile_qualities`, `quality_profile_languages`, `quality_profile_custom_formats`, and `quality_profile_tags`. TRaSH has no equivalent aggregate entity for quality profiles.

5. **Media management settings are Arr-specific tables.** `radarr_naming`, `sonarr_naming`, `lidarr_naming`, `radarr_media_settings`, `sonarr_media_settings`, `lidarr_media_settings`, and quality definitions per-Arr -- six tables that TRaSH does not model as JSON at all.

The alignment with TRaSH would only benefit the custom format entity, and even then, the structural differences (shared regexes, relational scoring, arr-type scoping) mean the JSON would look quite different from TRaSH's format. You would not get drop-in compatibility.

---

## 8. Additional Hidden Costs

### 8.1 The in-memory SQLite cache becomes harder to justify

The current architecture compiles SQL ops directly into an in-memory SQLite database. The cache IS the ops, just executed. If the ingestion format is JSON/YAML, you still need the SQLite cache (the entire application queries it via Kysely), so the compilation step becomes JSON/YAML -> SQL -> SQLite execution. The intermediate SQL generation step is pure overhead.

### 8.2 Conflict detection granularity degrades

The current system detects conflicts at the individual SQL statement level. A single UPDATE that affects 0 rows is a conflict signal. In JSON/YAML desired-state mode, you lose this granularity because you are comparing snapshots, not individual mutations. You cannot distinguish between "this field was changed by upstream" (genuine conflict) and "this field was already at the desired value" (no-op).

The `checkFullListConflict()` function in `fullListCheck.ts` already handles multi-statement ops by comparing full desired-state snapshots against DB state. Moving everything to desired-state comparison would lose the precision of individual statement tracking.

### 8.3 Git diff readability for ops degrades

The current SQL ops files produce readable git diffs. Each op block is marked with `-- --- BEGIN op N` and `-- --- END op N`. Reviewers can see exactly what SQL will execute. JSON/YAML diffs for deeply nested documents are notoriously harder to review, especially for quality profile quality orderings that span hundreds of lines of array items.

### 8.4 The writer pipeline's validation-before-write guarantee breaks

`writer.ts` validates SQL statements by dry-running them in a savepoint transaction against the in-memory cache:

```typescript
const cache = getCache(databaseId);
if (cache) {
  const validation = cache.validateSql(sqlStatements);
}
```

This catches FK violations, constraint errors, and uniqueness conflicts before the op is persisted. In a JSON/YAML world, you would need to:

1. Convert JSON/YAML to SQL
2. Validate the SQL
3. Store the JSON/YAML (or the SQL? both?)

Or you would need to build a JSON/YAML-level validator that reimplements SQLite's constraint checking -- the same problem from section 1.

### 8.5 The 25,000-line initial seed becomes a tooling problem

The initial seed (`0.rosettarr.sql`) is 25,220 lines. Its header says "Generated by YAML to SQL Converter." So YAML was already used as an authoring format and compiled to SQL for the initial load. This suggests the team already evaluated YAML-as-source and chose SQL-as-distribution. Switching the distribution format back to YAML would require explaining why the original decision was wrong, or acknowledging that the requirements have changed.

---

## Summary of Risks

| Risk                                              | Severity | Likelihood  | Impact                                 |
| ------------------------------------------------- | -------- | ----------- | -------------------------------------- |
| Must reimplement SQLite constraint checking       | Critical | Certain     | Every JSON/YAML write needs validation |
| Value guard semantics lost or reinvented poorly   | Critical | Certain     | Core conflict detection breaks         |
| New JSON/YAML-to-SQL compiler introduces bugs     | High     | Very Likely | Silent data corruption possible        |
| Ordering and dependency resolution complexity     | High     | Certain     | New subsystem to build and test        |
| Dual-format maintenance burden (export path)      | Medium   | Very Likely | Doubled parser/validator surface area  |
| TRaSH alignment delivers less value than expected | Medium   | Likely      | Different enough to not be drop-in     |
| Git diff readability for nested JSON/YAML         | Low      | Certain     | Reviewer UX degradation                |
| Migration of 56 existing ops files                | Medium   | Certain     | Large one-time conversion cost         |

---

## Recommendation

The contrarian position is not that JSON/YAML is inherently bad -- it is that the current SQL ops format is load-bearing in ways that are easy to underestimate. Before proceeding with any migration:

1. **Enumerate every SQL feature used in ops files** that would need a JSON/YAML equivalent (value guards, NOT EXISTS guards, multi-table batches, renames via UPDATE...SET name, cascading deletes with guard clauses).

2. **Prototype the most complex migration** (op 42, the 249-op quality profile regroup) in JSON/YAML to see if the result is actually more readable than the SQL.

3. **Define the conflict detection semantics** for JSON/YAML ops. If you cannot express "update field X only if current value is Y" natively, then JSON/YAML adds complexity without solving the hardest problem.

4. **Consider a hybrid approach**: JSON/YAML for initial seed data (which is already the case -- the seed was generated from YAML), SQL for incremental migrations. This preserves readability where it matters most (the initial entity definitions) while keeping SQL for the operations that genuinely need SQL's semantics (conditional updates, cross-table batches, rename chains).

The burden of proof should be on the migration proposal to demonstrate that the JSON/YAML format can express value guards, multi-table atomic batches, and conditional inserts with the same precision and reliability as SQL -- not just that it is "more readable" for the subset of operations that are simple inserts.

---

## Sources

- Schema definition: `packages/praxrr-schema/ops/0.schema.sql` (33+ tables, cascading FKs, CHECK constraints)
- Compilation pipeline: `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` (conflict detection via row count + full-list check)
- Layer ordering: `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts` (schema -> base -> tweaks -> user)
- Writer pipeline: `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` (SQL validation before write)
- Export pipeline: `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts` (SQL file generation + git push)
- Override conflict resolution: `packages/praxrr-app/src/lib/server/pcd/conflicts/override.ts`
- Auto-align rules: `packages/praxrr-app/src/lib/server/pcd/conflicts/autoAlign/index.ts`
- Full-list conflict check: `packages/praxrr-app/src/lib/server/pcd/conflicts/fullListCheck.ts`
- Rename chain tracking: `packages/praxrr-app/src/lib/server/pcd/conflicts/overrideUtils.ts` (SQL parsing for renames)
- Entity registry: `packages/praxrr-app/src/lib/server/pcd/entities/registry.ts`
- Serialization: `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`
- Initial seed file: `packages/praxrr-db/ops/0.rosettarr.sql` (25,220 lines, generated from YAML)
- Migration examples: `packages/praxrr-db/ops/1.*.sql` through `packages/praxrr-db/ops/56.*.sql`
- TRaSH-Guides format: [TRaSH-Guides/Guides on GitHub](https://github.com/TRaSH-Guides/Guides)
- TRaSH custom format structure: [Radarr CF collection](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/)
