# Systems Thinker: PCD Data Format Migration Analysis

## Persona: Systems Thinker

Analyzing interconnections, feedback loops, and emergent properties of a potential migration from SQL ops to JSON/YAML as the PCD ingestion data format.

---

## 1. Feedback Loop Mapping

### 1.1 Current System Feedback Loops

The PCD system contains five interlocking feedback loops, all of which currently operate in a single language (SQL):

**Loop A: The Write-Validate-Compile Loop (Tight, Fast)**

```
UI Edit -> Kysely Query -> compiledQueryToSql() -> validateSql() via SAVEPOINT -> pcd_ops INSERT -> compile() -> cache rebuild
                                                        ^                                                              |
                                                        |______________ validation reads current cache state __________|
```

This is the system's primary correctness loop. The writer (`ops/writer.ts`) converts Kysely queries to SQL strings, validates them against the current in-memory SQLite cache using SAVEPOINT dry-runs, and only persists them if validation passes. The compiled cache is then rebuilt, making the validated state immediately available.

**Key coupling point**: The validation step (`cache.validateSql()`) runs the _exact same SQL_ that will be stored. There is no translation, no interpretation, no serialization boundary. The SQL IS the validation.

**Confidence**: High -- verified directly from `cache.ts` lines 457-514 and `writer.ts` lines 297-319.

**Loop B: The Export-Import-Compile Loop (Distributed, Slow)**

```
User A UI -> writeOperation() -> pcd_ops (draft) -> exportDraftOps() -> SQL file in ops/ -> git push
                                                                                               |
User B:  importBaseOps() <- git pull <- ops/*.sql file <---------------------------------------+
              |
              v
         pcd_ops INSERT -> compile() -> cache
```

This is the distributed collaboration loop. Users make changes locally (stored as ops), export them as SQL files to a git repository, and other users import those files. The SQL file format serves as the **serialization contract** between users.

**Key coupling point**: `importBaseOps.ts` reads `.sql` files, strips metadata headers (`-- @operation`, `-- @entity`, etc.), and stores the raw SQL + parsed metadata in `pcd_ops`. The file format IS the API contract.

**Confidence**: High -- verified from `importBaseOps.ts` and `exporter.ts`.

**Loop C: The Conflict Detection Loop (Emergent, SQL-Native)**

```
User op SQL (with WHERE guards) -> db.exec(operation.sql) -> totalChanges == 0?
                                                                  |
                                                          yes: CONFLICT DETECTED
                                                                  |
                                                          conflictStrategy check
                                                                  |
                                         override -> drop + regenerate op
                                         align -> auto-drop op
                                         ask -> mark conflicted_pending
```

This loop is the most architecturally significant. Value guards are embedded directly in SQL WHERE clauses:

```sql
update "custom_formats" set "include_in_rename" = 1 where "name" = 'AMZN' and "include_in_rename" = 0;
```

The `and "include_in_rename" = 0` clause is the value guard. If someone upstream already changed this value, the UPDATE affects zero rows, and SQLite's `totalChanges` counter tells the system a conflict occurred -- without any application-level diffing logic.

**Key coupling point**: Conflict detection is a side effect of SQL execution itself. It requires no separate conflict-detection system, no diff algorithm, no schema-aware comparison logic.

**Confidence**: High -- verified from `cache.ts` lines 106-165, `update.ts` value guard pattern, and sample ops like `1.update-include-amzn-custom-format-in-renames.sql`.

**Loop D: The Supersession Loop (Optimization)**

```
New user op (update entity X field Y) -> supersedePriorUserOps()
                                              |
                                     find prior ops targeting same entity + fields
                                              |
                                     mark prior op state = 'superseded'
```

This loop prevents op accumulation. When a user makes multiple edits to the same field, only the latest op survives. The matching logic uses `metadata.entity`, `metadata.stableKey`, and `metadata.changedFields`.

**Coupling**: This loop operates on metadata (JSON) not on the SQL itself. It is already format-agnostic in principle.

**Loop E: The Auto-Align Loop (Policy-Driven)**

```
compile() -> rowcount == 0 for user op -> evaluateAutoAlign()
                                               |
                                    check desiredState against current cache
                                               |
                                    if current == desired: drop op (aligned)
```

This loop detects when upstream changes have already achieved what the user's op intended. It reads `desired_state` (JSON) and compares it to the current cache state using entity-specific rules (`defaultFieldGuardRule`, `qualityProfileScoringRowRule`, etc.).

**Coupling**: This loop reads the cache via raw SQL queries (`resolveCurrentRow()`) but the comparison logic operates on JSON desired state. It is partially format-agnostic.

### 1.2 Where SQL-as-Format Creates Coupling

The coupling is deepest in three areas:

1. **Validation = Execution**: The `validateSql()` SAVEPOINT pattern means the format (SQL) and the validator (SQLite engine) are the same thing. This is not coupling in the pejorative sense -- it is architectural simplicity that eliminates an entire class of bugs (the validator cannot disagree with the executor because they are the same system).

2. **Value Guards as Data**: The WHERE clauses in UPDATE/DELETE statements encode both "what to change" AND "what the expected current state is." This conflation is deliberate. In JSON/YAML, these would need to be separate fields (`expected` vs `new`), requiring explicit diffing logic.

3. **Schema DDL**: The `0.schema.sql` file defines 33+ CREATE TABLE statements with CHECK constraints, FOREIGN KEY declarations, and UNIQUE indexes. These constraints are enforced by SQLite at compile time. There is no JSON equivalent that provides the same level of structural enforcement.

### 1.3 Where JSON/YAML Would Create New Coupling

A format change would create these new coupling points:

1. **Translation layer coupling**: A JSON/YAML -> SQL compiler becomes a critical-path component that must be kept in sync with both the schema and all entity-specific write logic. Every new entity type, every schema change, every new constraint requires updating the translator.

2. **Dual-representation coupling**: The `pcd_ops.sql` column stores SQL strings. If ingestion becomes JSON but internal storage remains SQL, the system has two representations of the same intent. If internal storage also becomes JSON, the in-memory SQLite cache needs a JSON -> SQL compiler in the compile path.

3. **Test coupling**: Currently, an ops file can be validated by running it against the schema in any SQLite tool. JSON/YAML files would require Praxrr-specific tooling to validate.

### 1.4 Second-Order Effects of Format Change

- **Community tooling disruption**: Anyone who hand-edits SQL ops files (e.g., for custom databases) would need to learn a new format.
- **Debugging regression**: Currently, you can copy any ops file and run it in `sqlite3` to see exactly what it does. JSON/YAML removes this capability.
- **Export pipeline complexity**: The exporter (`exporter.ts`) currently concatenates SQL blocks with comment headers. JSON export would need a structured serializer that handles the same metadata.
- **Import pipeline bifurcation**: If both formats need to be supported during transition, `importBaseOps.ts` must detect and handle both, creating a long-lived compatibility shim.

---

## 2. Interface Boundary Map

### 2.1 Current Interfaces

The system has five clean interface boundaries, all speaking SQL:

```
[1] Files (*.sql) ---read---> [2] pcd_ops table (sql TEXT column)
[2] pcd_ops table ---load---> [3] Operation[] (sql: string)
[3] Operation[]   ---exec---> [4] In-memory SQLite cache
[4] Cache         ---query--> [5] Entity read/list functions
[5] Entities      ---sync---> [6] Arr API payloads
```

Additionally:

```
[7] UI edit -> Kysely query -> compiledQueryToSql() -> [2] pcd_ops
[8] pcd_ops -> formatOpBlock() -> SQL file -> git -> [1] Files (on another user's machine)
```

### 2.2 Interfaces That Would Need to Change

**Interface [1] -> [2]: File Ingestion**

Currently: `importBaseOps.ts` reads `.sql` files, strips metadata comments, stores raw SQL in `pcd_ops.sql`.

With JSON/YAML: A new parser would read JSON/YAML files, extract operation intent (table, action, values, guards), and either:

- (a) Compile to SQL and store SQL in `pcd_ops.sql` (translation at ingestion), or
- (b) Store JSON/YAML as-is in a new column (deferred translation)

Option (a) is simpler but creates a unidirectional translation (JSON -> SQL) that makes round-tripping harder.
Option (b) requires the compile pipeline ([3] -> [4]) to also understand JSON/YAML.

**Interface [3] -> [4]: Compile Pipeline**

Currently: `cache.build()` calls `this.db.exec(operation.sql)` -- one line of code per operation.

With JSON/YAML (option b): Each operation needs a JSON/YAML -> SQL compiler that understands all 33+ tables, their columns, types, constraints, and relationships. This is essentially rebuilding Kysely's query builder in reverse.

**Interface [7]: Write Pipeline**

Currently: `writeOperation()` takes `CompiledQuery[]`, calls `compiledQueryToSql()`, validates, stores SQL.

With JSON/YAML: The write pipeline would need to produce JSON/YAML instead of (or in addition to) SQL. Since Kysely produces SQL, this means either:

- Capturing Kysely's intermediate representation before SQL compilation, or
- Reverse-parsing the compiled SQL back to structured data (fragile), or
- Replacing Kysely with a custom query builder that outputs JSON/YAML

**Interface [8]: Export Pipeline**

Currently: `formatOpBlock()` wraps SQL in comment-delimited blocks, writes to `.sql` file.

With JSON/YAML: The exporter would need to serialize pcd_ops to JSON/YAML format, which means either reading the stored JSON directly (if option b) or reverse-parsing stored SQL (if option a).

### 2.3 Interfaces That Would NOT Change

- **Interface [4] -> [5]**: Cache queries (Kysely `kb` accessor) remain unchanged -- the cache is still SQLite.
- **Interface [5] -> [6]**: Arr sync payloads remain unchanged -- they read from the cache, not from ops.
- **Schema layer**: `0.schema.sql` would still need to be SQL (see Section 4).

---

## 3. The Export Loop Problem

### 3.1 The Bidirectional Format Problem

The current data flow is circular and homogeneous:

```
SQL file (repo) --> importBaseOps --> pcd_ops (SQL) --> compile --> cache
                                          ^
                                          |
UI edit --> Kysely --> SQL string --> pcd_ops (SQL) --> exportDraftOps --> SQL file (repo)
```

Every arrow handles the same format (SQL). Now consider a JSON/YAML migration:

**Scenario A: Ingestion only (JSON/YAML in, SQL out)**

```
JSON file (repo) --> importBaseOps (JSON parser) --> pcd_ops (SQL) --> compile --> cache
                                                         ^
                                                         |
UI edit --> Kysely --> SQL string --> pcd_ops (SQL) --> exportDraftOps --> ???
```

The export pipeline still produces SQL (because pcd_ops stores SQL). But the repo expects JSON. So either:

1. Export also converts SQL -> JSON (bidirectional translation), or
2. The repo has two formats (JSON for base ops, SQL for exported ops)

Both are problematic. Option 1 requires a SQL parser that can reconstruct structured intent from arbitrary SQL. Option 2 means `importBaseOps` must handle both formats permanently.

**Scenario B: Full migration (JSON/YAML everywhere)**

```
JSON file (repo) --> importBaseOps (JSON parser) --> pcd_ops (JSON) --> compile (JSON->SQL) --> cache
                                                         ^
                                                         |
UI edit --> ??? --> JSON string --> pcd_ops (JSON) --> exportDraftOps --> JSON file (repo)
```

This requires replacing Kysely's SQL output with a JSON-native representation. The `compiledQueryToSql()` function (currently 43 lines in `sql.ts`) would be replaced by a JSON schema compiler that must handle INSERT, UPDATE (with guards), and DELETE for every table. The complexity transfers from "format the SQL" (trivial) to "define and maintain a JSON operation schema" (significant).

### 3.2 The Version Compatibility Problem

Currently, ops files are immutable once published. Old SQL files work with new schemas because SQLite handles forward-compatible SQL. A JSON/YAML format would need explicit versioning:

- What JSON schema version does this file use?
- Can a newer Praxrr version read an older JSON format?
- Can an older Praxrr version read a newer JSON format?

SQL has none of these problems because it has a 50-year-old specification and SQLite maintains strict backwards compatibility.

---

## 4. Schema Evolution

### 4.1 Current Schema Handling

The schema is defined in `packages/praxrr-schema/ops/0.schema.sql` as standard SQL DDL:

```sql
CREATE TABLE quality_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    upgrade_score_increment INTEGER NOT NULL DEFAULT 1 CHECK (upgrade_score_increment > 0),
    ...
);
```

Key features that are native to SQL DDL:

- FOREIGN KEY constraints with CASCADE rules
- CHECK constraints with arbitrary expressions
- DEFAULT values
- UNIQUE constraints (including multi-column)
- AUTOINCREMENT sequences
- INDEX definitions

### 4.2 JSON Schema as Alternative

Converting to JSON Schema would look something like:

```json
{
  "quality_profiles": {
    "columns": {
      "id": { "type": "integer", "primaryKey": true, "autoIncrement": true },
      "name": { "type": "string", "maxLength": 100, "unique": true, "required": true },
      "upgrade_score_increment": {
        "type": "integer", "required": true, "default": 1,
        "check": "upgrade_score_increment > 0"
      }
    },
    "foreignKeys": [...],
    "indexes": [...]
  }
}
```

Problems:

1. **The CHECK constraint problem**: `CHECK (upgrade_score_increment > 0)` is a SQL expression. In JSON Schema, you either embed SQL strings (defeating the purpose) or invent a constraint DSL (adding a new language to learn).
2. **The CASCADE problem**: `ON DELETE CASCADE ON UPDATE CASCADE` is inherently relational. JSON Schema has no equivalent concept.
3. **The migration problem**: Schema evolution in SQL is `ALTER TABLE ADD COLUMN...`. In JSON Schema, you modify the JSON and need a diff engine to compute what changed and generate the appropriate ALTER statements.
4. **The runtime gap**: Even with a JSON schema, you still need to generate `CREATE TABLE` SQL for the in-memory SQLite cache. So the JSON schema becomes an intermediate representation that adds a compilation step.

### 4.3 The Hybrid Reality

In practice, the schema layer would almost certainly remain SQL. This means:

- Schema: SQL (native to SQLite)
- Data: JSON/YAML (new format)
- Runtime: SQL (SQLite cache)

This creates a three-language system: SQL for schema, JSON/YAML for data, SQL for execution. The data layer becomes a translation bridge between two SQL layers.

---

## 5. Emergent Properties Analysis

### 5.1 Emergent Properties of the Current SQL System

**Property 1: Composability**

Any SQL that targets PCD tables is a valid operation. The system does not care about the shape of the SQL -- it only cares that it executes without error. This means:

- Complex multi-table operations (e.g., creating a custom format with conditions, tags, and test cases) can be a single op
- Operations from different entity types can be batched
- Future entity types automatically work without system changes
- Hand-crafted SQL for edge cases (data migrations, bulk updates) works without special handling

A JSON/YAML system would need explicit support for each operation type. Unknown operation shapes would be rejected.

**Property 2: Self-Validating Operations**

The current system validates ops by executing them in a SAVEPOINT and rolling back. This means:

- Every constraint (FK, UNIQUE, CHECK, NOT NULL) is tested
- Cross-table consistency is verified (e.g., a quality profile score referencing a non-existent custom format fails)
- The validation is always correct because it uses the same engine as production

A JSON/YAML system would need a separate validation layer that must replicate all constraint logic. This is a classic source of drift between validator and executor.

**Property 3: Implicit Conflict Detection**

Value guards in WHERE clauses provide conflict detection as a side effect of normal SQL execution. The system counts affected rows -- if an UPDATE with a guard affects 0 rows, the guard failed, meaning the expected state has changed.

This is not an accident; it is an emergent property of combining SQL's declarative WHERE semantics with SQLite's change tracking. A JSON/YAML system would need to implement explicit optimistic concurrency control, likely with version numbers or explicit diff comparison.

**Property 4: Universal Tooling**

SQL ops files can be:

- Inspected with any text editor
- Validated with any SQLite client (`sqlite3 :memory: < schema.sql < ops.sql`)
- Diffed with standard git tools
- Understood by any developer who knows SQL

This is an emergent property of using a universal standard format.

### 5.2 Emergent Properties a JSON/YAML System Would Have

**Property 5: Structural Readability**

JSON/YAML is more self-documenting for data mutations. Compare:

```sql
INSERT INTO quality_profile_custom_formats (quality_profile_name, custom_format_name, arr_type, score)
VALUES ('1080p Quality', 'AMZN', 'all', 15000);
```

vs:

```yaml
- table: quality_profile_custom_formats
  action: insert
  values:
    quality_profile_name: 1080p Quality
    custom_format_name: AMZN
    arr_type: all
    score: 15000
```

The YAML version names the columns alongside values. However, this advantage is marginal -- the SQL version is equally readable to anyone familiar with SQL.

**Property 6: Programmatic Manipulation**

JSON/YAML is easier to parse and transform programmatically. Building tools that read, filter, or modify operations is simpler with structured data than with SQL parsing. This could enable:

- UI-based operation editors
- Automated operation rewriting
- Operation dependency analysis

However, the current system already has most of this via the `metadata` and `desired_state` JSON columns in `pcd_ops`. The structured data lives alongside the SQL, not instead of it.

**Property 7: Schema-Awareness**

A JSON/YAML format would force explicit declaration of table and column names, which could enable compile-time type checking of operations against the schema. Currently, typos in SQL column names are only caught at execution time.

### 5.3 Properties That Would Be Lost

1. **Composability** -- JSON/YAML operations must conform to a predefined structure. Novel operation shapes require schema updates.
2. **Self-validation** -- Validation would require a separate system that could diverge from the executor.
3. **Implicit conflict detection** -- Value guards would become explicit data fields requiring application-level diffing.
4. **Universal tooling** -- Ops files would only be testable with Praxrr-specific tools.
5. **Execution identity** -- The stored format would no longer be the execution format, creating a potential for translation bugs.

---

## 6. Complexity Budget Analysis

### 6.1 Where Complexity Currently Lives

| Component           | Complexity | Notes                                                       |
| ------------------- | ---------- | ----------------------------------------------------------- |
| Schema definition   | **Low**    | Standard SQL DDL, 1 file                                    |
| Base ops files      | **Low**    | Standard SQL DML, readable                                  |
| Import pipeline     | **Low**    | Read file, strip comments, store SQL (~127 lines)           |
| Write pipeline      | **Medium** | Kysely -> SQL -> validate -> store (~394 lines)             |
| Compile pipeline    | **Low**    | Load ops, `db.exec(sql)` for each (~82 lines in loadOps)    |
| Conflict detection  | **Low**    | Side effect of SQL execution (rowcount check)               |
| Override resolution | **Medium** | Entity-specific regeneration (~177 lines + entity handlers) |
| Export pipeline     | **Medium** | Build SQL file, git clone, push (~682 lines)                |
| Auto-align          | **Medium** | JSON desired-state comparison (~80 lines + rules)           |
| SQL utilities       | **Low**    | `compiledQueryToSql()` is 43 lines                          |

**Total estimated lines in format-sensitive code**: ~1,500 lines

### 6.2 Where Complexity Would Move

| Component                 | Change        | New Complexity | Notes                                           |
| ------------------------- | ------------- | -------------- | ----------------------------------------------- |
| Schema definition         | **No change** | Low            | Must remain SQL                                 |
| JSON/YAML op parser       | **New**       | High           | Must handle all entity types, nested structures |
| JSON/YAML -> SQL compiler | **New**       | High           | Must generate correct SQL for 33+ tables        |
| Import pipeline           | **Increased** | Medium         | Parse JSON/YAML instead of plain text           |
| Write pipeline            | **Increased** | High           | Must produce JSON/YAML instead of SQL           |
| Compile pipeline          | **Increased** | Medium         | JSON/YAML -> SQL translation before exec        |
| Conflict detection        | **Replaced**  | High           | Explicit optimistic concurrency needed          |
| Override resolution       | **Similar**   | Medium         | Already uses desiredState JSON                  |
| Export pipeline           | **Increased** | High           | SQL -> JSON/YAML serialization                  |
| JSON operation schema     | **New**       | High           | Must define, version, validate operation format |
| Migration tooling         | **New**       | Medium         | Convert existing SQL ops to new format          |
| Validation layer          | **New**       | High           | Replicate SQLite constraint checking            |

**Estimated new complexity**: 3,000-5,000 lines of new code, replacing ~1,500 lines

### 6.3 Net Complexity Assessment

The migration would approximately **double to triple** the amount of format-sensitive code, while:

- Adding two new critical-path components (parser, compiler)
- Requiring a new versioned schema for operations
- Creating a validation layer that must stay in sync with SQLite constraints
- Introducing a translation boundary where bugs can hide

The complexity does not decrease anywhere -- it only increases or remains the same.

---

## 7. The "Two Languages" Problem

### 7.1 Current State: One Language

The current system speaks SQL from end to end:

```
Author SQL -> Store SQL -> Validate SQL -> Execute SQL -> Query SQL
```

There is one data language (SQL), one execution engine (SQLite), and one type system (SQLite column types). Every developer and every tool in the ecosystem understands the same language.

### 7.2 Proposed State: Two+ Languages

```
Author JSON/YAML -> Store JSON/YAML -> Translate to SQL -> Validate SQL -> Execute SQL -> Query SQL
                         |                    ^
                         |                    |
                    (new format)        (translation gap)
```

The translation gap is the critical risk. Systemic risks include:

**Risk 1: Semantic Drift**

The JSON/YAML operation schema must express exactly the same semantics as the SQL it generates. As the PCD schema evolves (new tables, new constraints, new column types), the JSON operation schema must evolve in lockstep. If they drift, operations that are valid JSON may produce invalid SQL, or vice versa.

Example: Adding a CHECK constraint to a column. In SQL, the constraint is enforced automatically. In JSON, the validator must be explicitly updated to enforce the same constraint.

**Risk 2: Leaky Abstraction**

JSON/YAML operations would inevitably need to express SQL concepts (JOINs for multi-table ops, subqueries for conditional inserts, expressions for computed values). The "simpler" format would gradually accumulate SQL-like features, becoming a poorly-specified SQL dialect.

The `WHERE NOT EXISTS` pattern used for idempotent inserts (visible in the rosettarr seed) is a SQL feature that has no natural JSON/YAML equivalent:

```sql
INSERT INTO tags (name) SELECT 'HDR' WHERE NOT EXISTS (SELECT 1 FROM tags WHERE name = 'HDR');
```

How would this be expressed in JSON? Either as embedded SQL (defeating the purpose) or as a special `ifNotExists` flag (growing the DSL).

**Risk 3: Error Message Degradation**

Currently, when an operation fails, the error message comes from SQLite:

- "FOREIGN KEY constraint failed" -- immediately tells you what went wrong
- "UNIQUE constraint failed: custom_formats.name" -- names the exact column

With a translation layer, errors could come from:

1. The JSON/YAML parser (syntax error)
2. The operation schema validator (semantic error)
3. The SQL compiler (translation error)
4. SQLite (execution error)

Each layer adds indirection between the user's intent and the error, making debugging harder.

**Risk 4: Testing Surface Expansion**

Currently, testing a new entity type requires verifying that:

1. Kysely generates correct SQL
2. The SQL executes correctly in SQLite

With JSON/YAML, testing also requires:

1. The JSON schema correctly describes the entity
2. The JSON -> SQL compiler generates correct SQL for this entity
3. Round-tripping (SQL -> JSON -> SQL) produces equivalent results
4. Validation rules match SQLite constraints for this entity

The test matrix roughly triples.

### 7.3 The Existing "Second Language"

It is worth noting that the system already has a second language: **JSON**, used for:

- `metadata` column in `pcd_ops` (operation tracking)
- `desired_state` column in `pcd_ops` (conflict resolution)
- `pcd.json` manifest
- Portable entity types (`portable.ts`)

However, this JSON is **metadata about operations**, not **the operations themselves**. The distinction matters: metadata JSON can be wrong without corrupting data (operations degrade gracefully to less-informed conflict resolution). If the operation format itself were JSON and the translator had a bug, data corruption would result.

---

## 8. Systemic Verdict

### 8.1 The Core Insight

The PCD system's architecture derives significant value from SQL being simultaneously:

1. The **authoring** format (what humans and Kysely produce)
2. The **storage** format (what pcd_ops holds)
3. The **validation** format (what SAVEPOINT dry-runs execute)
4. The **execution** format (what compile() runs)
5. The **distribution** format (what ops files contain)

This five-way identity is not a limitation to be overcome -- it is an architectural strength that eliminates four translation boundaries where bugs, drift, and complexity would otherwise accumulate.

### 8.2 What Problem Would Migration Solve?

The case for JSON/YAML rests primarily on:

- **Readability for non-SQL users**: Valid but addressable with better documentation and tooling
- **Programmatic manipulation**: Already partially addressed by metadata/desired_state JSON columns
- **Schema-aware validation**: Already provided by SQLite itself
- **Ecosystem compatibility**: Most configuration tools use JSON/YAML, but Praxrr's domain (database operations) is inherently SQL-shaped

### 8.3 What Problems Would Migration Create?

1. **Doubled complexity** with no reduction elsewhere
2. **Translation boundary** as a new bug surface
3. **Lost emergent properties** (composability, self-validation, implicit conflict detection)
4. **Export loop bifurcation** (the round-trip problem)
5. **Schema evolution friction** (maintaining JSON op schema alongside SQL DDL)
6. **Testing surface tripling**
7. **Universal tooling loss** (can no longer validate with sqlite3)

### 8.4 Recommendation

From a systems perspective, the SQL ops format is a **load-bearing architectural decision**, not an incidental choice. The feedback loops, interface boundaries, and emergent properties of the system are all optimized for a single-language pipeline. Introducing a second data language at the file boundary would propagate complexity changes through every subsystem, with the transformation cost concentrated in the most critical paths (write, validate, compile, export).

If readability and accessibility are the driving concerns, the higher-leverage intervention is to improve the **metadata and tooling layer** around SQL ops (better UI for authoring, better diffing tools, richer metadata) rather than to replace the underlying format.

---

## Sources

All findings derived from direct analysis of the Praxrr codebase:

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/database/cache.ts` -- Cache build, SAVEPOINT validation, conflict detection
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/database/compiler.ts` -- Compile pipeline, auto-override resolution
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` -- Write pipeline, supersession logic
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts` -- Export pipeline, git integration
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts` -- Import pipeline, file parsing
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts` -- Operation loading, layer ordering
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/utils/sql.ts` -- SQL compilation utilities
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/core/types.ts` -- Operation types, write options
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts` -- Entity serialization
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts` -- Entity deserialization
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/general/update.ts` -- Value guard pattern
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/conflicts/override.ts` -- Conflict resolution
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/conflicts/autoAlign/index.ts` -- Auto-align evaluation
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/conflicts/autoAlign/rules/defaultFieldGuard.ts` -- Field guard alignment rule
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/pcd/portable.ts` -- Portable entity types
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/ops/0.schema.sql` -- PCD schema DDL
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/ops/0.rosettarr.sql` -- Initial seed data
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/ops/1.update-include-amzn-custom-format-in-renames.sql` -- Update op with value guard
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/ops/10.delete-remux-quality-match-cf.sql` -- Multi-entity delete op
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations/041_create_pcd_ops.ts` -- pcd_ops table schema
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/manifest/manifest.ts` -- PCD manifest handling
