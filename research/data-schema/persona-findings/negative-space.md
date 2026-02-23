# Negative Space Analysis: PCD Data Format Migration

## Role

NEGATIVE SPACE persona -- identifying what is NOT being discussed, what is missing from the framing, and what assumptions remain unexamined.

---

## 1. The Unasked Question: Is JSON or YAML Actually the Right Target?

The framing presents a binary choice -- "SQL ops files or JSON/YAML" -- but this is a false dichotomy. There are at least eight alternative paths that the current discussion does not consider.

### 1.1 TOML

TOML has explicit syntax (`key = value` with `[sections]`), no indentation footguns, native comment support, and is used by Cargo (Rust), pyproject.toml (Python), and Hugo. It is simpler than YAML and avoids YAML's notorious type-inference bugs (the `Norway problem` where `NO` becomes `false`). However, TOML becomes verbose for deeply nested data -- and PCD entities ARE deeply nested (quality profiles contain quality groups which contain quality members which reference quality names which map to Arr API names). TOML would require extensive `[[array.of.tables]]` nesting that becomes harder to read than the SQL it replaces.

**Confidence**: Medium. TOML is a reasonable format for flat configuration but likely a poor fit for PCD's relational, deeply nested entity graph.

### 1.2 CUE

CUE is a configuration language with built-in validation, type checking, and constraint enforcement. It can import/export JSON, YAML, TOML, and Protocol Buffers. Its key differentiator is that schema and data live together -- a CUE file is simultaneously a schema definition and a data instance. CUE could potentially eliminate the separate schema validation step entirely. However, CUE has a steep learning curve, limited editor support outside VS Code, and would add a Go toolchain dependency to a Deno/TypeScript project.

**Confidence**: Low. CUE is technically elegant but adoption risk is high for a project with this user base.

### 1.3 Pkl (Apple)

Pkl is type-safe, has IDE support, generates code, and can output to JSON/YAML/properties. It was released February 2024, has seen continued development (releases through December 2025), and is being adopted in some infrastructure tooling (Formae). However, Pkl adds a JVM or native binary dependency, the ecosystem is nascent, and it is primarily driven by Apple -- if Apple loses interest, the community may not sustain it.

**Confidence**: Low. Too early in its lifecycle and too niche for a project targeting the Arr ecosystem's user base.

### 1.4 Dhall

Dhall is a typed configuration language that guarantees termination and produces reproducible output. It has been adopted by some projects (e.g., Spago for PureScript) but is also being deprecated in those same projects in favor of simpler formats. Dhall requires Haskell tooling or a separate binary. Its adoption curve has stalled.

**Confidence**: Low. Dhall is moving in the wrong direction in terms of adoption.

### 1.5 KCL (Kubernetes Configuration Language)

KCL is specifically designed for Kubernetes and cloud-native configuration. It has strong validation and schema features but is deeply tied to the cloud-native ecosystem. PCD is not a cloud-native configuration problem -- it is a media management domain model.

**Confidence**: Low. Wrong problem domain.

### 1.6 A Custom DSL Purpose-Built for Praxrr's Domain

This is the option nobody is discussing. Praxrr already has a domain-specific vocabulary: custom formats, quality profiles, conditions, quality groups, quality profile qualities, etc. A custom DSL could look like:

```
custom_format "AMZN" {
  description = "Amazon Prime Video"
  include_in_rename = true
  tags = ["Streaming Service"]

  condition "AMZN" {
    type = release_title
    regex = "Amazon Prime"
    required = true
    arr_type = all
  }
}
```

This would be maximally readable for the domain. But the cost is enormous: you are building and maintaining a parser, a language specification, editor plugins, and documentation for a language that only one project uses.

**Confidence**: Medium. This is the "best UX" option but the "worst maintenance" option.

### 1.7 Protocol Buffers for Schema + JSON for Data

Protobuf could define the PCD schema with strong typing, and JSON could be the data layer. This gives you generated types in any language, schema evolution with backwards compatibility guarantees, and excellent tooling. However, Protobuf adds a build step, requires the `protoc` compiler, and the binary format is not human-readable (though the `.proto` files are).

**Confidence**: Medium. Over-engineered for this problem unless PCD is intended to be consumed by a wider ecosystem of tools.

### 1.8 SQLite .db Files as the Interchange Format

This is the option hiding in plain sight. Instead of shipping `.sql` text files that get replayed into an in-memory SQLite database, why not ship the compiled `.db` file directly? The SQLite file format is recommended by the US Library of Congress for long-term preservation, is readable by any SQLite tool, supports atomic transactions, and eliminates the compilation step entirely. The PCD cache already IS an in-memory SQLite database -- the current system just builds it from SQL text every time.

**Confidence**: Medium-High. This removes the compilation step, eliminates parse errors, and uses a format that SQLite itself endorses as an application file format. The major trade-off is that binary `.db` files are not human-readable in a text editor and do not diff well in Git. This makes code review and Git-based collaboration significantly harder.

---

## 2. The Unstated Assumption: The Problem is the FORMAT

The proposal assumes the format is the bottleneck. But is it? Let me dissect the actual pain points.

### 2.1 Pain Point: "No good editor support for SQL ops"

This is a tooling problem, not a format problem. SQL has extensive editor support (syntax highlighting, auto-complete, linting) in every major editor. What is actually missing is **domain-aware** tooling -- an editor that understands that this SQL targets the PCD schema, that `custom_format_name` must reference an existing row in `custom_formats`, and that `arr_type` must be one of `'radarr' | 'sonarr' | 'all'`.

Could this be solved without changing the format? YES. A SQLite Language Server Protocol (LSP) extension that loads the PCD schema and provides auto-complete, validation, and hover documentation would address this entirely. Such tools exist (e.g., `sql-language-server`, `sqls`).

**Confidence**: High that this is an addressable tooling gap, not a format problem.

### 2.2 Pain Point: "SQL doesn't self-document well"

The current SQL ops DO contain documentation -- the `0.rosettarr.sql` file has section comments, the `regular_expressions` table has a `description` column, and the exported ops have metadata headers. What is missing is a **rendered, browsable documentation layer** that makes this information accessible to non-SQL readers.

Could this be solved without changing the format? YES. An auto-generated documentation site (or even JSON API) that reads the compiled PCD cache and renders entity documentation would provide this without changing the authoring format. The compiled cache already contains all the data needed to produce this.

**Confidence**: High that a docs-generation layer could solve this independently.

### 2.3 Pain Point: "The contribution barrier is too high"

Understanding the PCD ops system -- append-only operations, value guards, layer compilation, conflict resolution -- is inherently complex regardless of format. Changing from SQL to JSON/YAML does not reduce the conceptual complexity of "write an operation that changes field X from A to B only if it is currently A." It just changes the syntax of expressing that operation.

The real contribution barrier may be the lack of a guided workflow for contributors. A web-based editing UI (which Praxrr already provides via its SvelteKit frontend) is the actual solution to contribution accessibility -- not a format change.

**Confidence**: High. The contribution barrier is architectural, not syntactic.

### 2.4 Pain Point: "No schema validation before compilation"

The current system validates at compile time -- the `PCDCache.build()` method catches SQL errors and the writer validates against the current cache state before writing. What is missing is **pre-commit** or **authoring-time** validation.

Could this be solved without changing the format? YES. A CI linting step that compiles the PCD from scratch and reports errors would provide this. The compilation step already validates referential integrity, constraint violations, and syntax errors. Making this a pre-commit hook or GitHub Action is a tooling change, not a format change.

**Confidence**: High.

---

## 3. Who is the Actual User? (Persona Gap)

The framing does not specify who authors PCD data. Different users have radically different needs.

### 3.1 The Praxrr Maintainer (Primary Author)

Currently, the maintainer authors PCD data through the Praxrr web UI, which generates SQL ops via the writer pipeline (Kysely query -> SQL compile -> validate -> write to `pcd_ops` -> recompile cache). The maintainer never manually writes SQL. The UI generates it. For this user, the format of the stored ops is irrelevant -- they interact through the UI.

If the only author is the maintainer using the UI, changing the storage format provides zero benefit to the authoring experience.

### 3.2 Community Contributors

Contributors would fork the PCD repository, make changes, and submit pull requests. For them, the format matters for readability during code review. But the export pipeline (`exporter.ts`) already produces well-structured SQL with metadata headers, operation blocks, and clear labels. The review experience could be improved with better GitHub rendering (a custom diff viewer, PR template improvements) without changing the underlying format.

### 3.3 End Users via the UI

End users make changes through the Praxrr UI, which stores them as user-layer ops in the app database. These users never see the ops format. A format change provides zero benefit to them.

### 3.4 Automated Pipelines

If the goal is to consume TRaSH-Guides data or other external sources, the need is for an **import adapter**, not a format change. The `0.rosettarr.sql` file was already "Generated by YAML to SQL Converter" -- meaning a YAML-to-SQL adapter already existed at some point. This could be rebuilt as a TRaSH-JSON-to-SQL-ops importer without changing the storage format.

### 3.5 The Missing Persona Analysis

Nobody has asked: "What percentage of PCD changes come from each user type?" If 95% of changes come through the UI and 5% come from manual editing, optimizing the raw file format for human readability is solving the 5% case at the cost of re-engineering the 95% case.

**Confidence**: High that the persona analysis is missing and critical to the decision.

---

## 4. The Migration Itself: Unaddressed Complexity

### 4.1 Migrating 44,869 Lines of Existing SQL (52 files)

The current PCD repository contains 52 SQL files totaling 44,869 lines. The initial seed alone (`0.rosettarr.sql`) is 25,220 lines. Converting this to JSON/YAML is not just a format translation -- it requires:

- Parsing all SQL INSERT/UPDATE/DELETE statements
- Resolving cross-entity references (e.g., `custom_format_name` foreign keys)
- Handling SQL-specific constructs like `WHERE NOT EXISTS` idempotency guards
- Preserving value guards (`AND include_in_rename = 0` in UPDATE WHERE clauses)
- Maintaining operation ordering semantics

This is a non-trivial compiler project.

### 4.2 The 57 Incremental Migrations Cannot Be Trivially Represented

The incremental ops (files 1-56) contain SQL-specific constructs that have no direct JSON/YAML equivalent:

- **Value guards**: `UPDATE ... SET include_in_rename = 1 WHERE name = 'AMZN' AND include_in_rename = 0` -- the `AND include_in_rename = 0` is a conditional update that only applies if the current value matches. In JSON, you would need a separate "precondition" construct.

- **Complex deletes with multi-column WHERE clauses**: `DELETE FROM quality_profile_qualities WHERE quality_profile_name = '1080p Balanced' AND quality_group_name = '1080p Balanced' AND quality_name IS NULL AND position = 3 AND enabled = 1 AND upgrade_until = 1` -- this is a delete that only removes the row if ALL fields match. JSON/YAML has no native concept of a conditional delete.

- **Cross-entity cascades**: Renaming a custom format triggers cascading updates to quality profile scores. The current system handles this with grouped operations and dependency tracking. In JSON/YAML, you would need an explicit orchestration layer.

### 4.3 Testing Burden: Proving Identical Runtime State

Migrating the format requires proving that the new format produces the exact same compiled state as the current SQL. This means:

- Compiling the PCD from SQL ops into a SQLite database
- Compiling the PCD from JSON/YAML through a new pipeline into a SQLite database
- Comparing every table, row, and column between the two databases
- Doing this for the initial seed AND for every incremental migration applied in sequence

This is a significant testing effort that nobody has scoped.

### 4.4 Backwards Compatibility During Transition

The PCD repository (`praxrr-db`) is distributed to users. If the format changes, there must be a migration path:

- Old Praxrr versions must continue to work with existing SQL repos
- New Praxrr versions must handle both SQL and JSON/YAML repos (or the new format only)
- The `pcd.json` manifest must indicate the format version
- The import pipeline, export pipeline, compiler, and cache builder all need dual-format support

### 4.5 The Export Pipeline

The exporter (`exporter.ts`) currently writes SQL files to the PCD repo, commits, and pushes. If the storage format changes to JSON/YAML, the entire export pipeline must be rewritten. This includes:

- The `formatOpBlock()` function that generates SQL operation blocks
- The `buildHeader()` function that generates metadata headers
- The `buildExportPlan()` function that assembles the export file
- The Git commit workflow that stages and pushes files

This is the most overlooked migration cost because the export pipeline is the primary way PCD data gets into the repository.

**Confidence**: High that migration complexity is severely underestimated.

---

## 5. Performance Considerations: Unmeasured

### 5.1 Parse Time

The current system executes raw SQL against an in-memory SQLite database using `this.db.exec(operation.sql)`. This is extremely fast because SQLite's SQL parser is written in C and has been optimized for 25+ years.

A JSON/YAML-based system would need to:

1. Parse the JSON/YAML file (in JavaScript/TypeScript, which is orders of magnitude slower than C)
2. Transform the parsed data into SQL statements
3. Execute those SQL statements against SQLite

Step 2 is the hidden cost. The current system has zero transformation overhead.

### 5.2 Memory Usage

44,869 lines of SQL text is approximately 2-3 MB. The equivalent JSON/YAML would likely be 3-5 MB due to structural overhead (quotes, braces, keys). This is negligible for a single PCD but could matter if multiple PCDs are loaded simultaneously.

### 5.3 Compilation Overhead

The JSON/YAML -> SQL transformation adds a compilation step that does not currently exist. The question is: how fast does this need to be? The PCD cache is rebuilt on every write operation, on startup, and on pull. If the transformation adds 500ms to each rebuild, that directly impacts the user experience.

Nobody has benchmarked this.

**Confidence**: Medium. Performance is unlikely to be a blocker but has not been measured.

---

## 6. The Versioning Dimension: The Deepest Architectural Gap

This is the most critical missing piece in the entire discussion.

### 6.1 Append-Only Operations vs. Full-State Documents

The PCD system is fundamentally an **event-sourced** system. The SQL ops files are an append-only log of state changes. The compiled cache is a materialized view derived from replaying those events. This is a deliberate architectural choice that provides:

- **Auditability**: Every change is recorded with metadata, timestamps, and operation IDs
- **Conflict detection**: Value guards detect when an upstream change conflicts with a user override
- **Layered composition**: Schema ops + base ops + tweaks + user ops compose into a final state
- **Bisectability**: You can replay ops up to any point to see the state at that time

JSON/YAML typically represents **full state** -- "here is the current configuration." This is a fundamentally different model.

### 6.2 Value Guards Have No JSON/YAML Equivalent

The SQL statement:

```sql
UPDATE custom_formats SET include_in_rename = 1
WHERE name = 'AMZN' AND include_in_rename = 0
```

This says: "Set include_in_rename to 1, BUT ONLY IF it is currently 0." If an upstream change already set it to 1, this operation correctly produces zero affected rows, which the conflict detection system picks up.

In JSON/YAML full-state representation, how do you express this? You would need:

```yaml
operation: update
entity: custom_format
target: { name: 'AMZN' }
precondition: { include_in_rename: 0 }
set: { include_in_rename: 1 }
```

At this point, you are inventing a custom operation format in JSON/YAML that is semantically identical to SQL but less expressive. You have traded SQL syntax for JSON syntax while preserving all the conceptual complexity.

### 6.3 The Layer Composition Problem

The PCD system compiles four layers in order: schema -> base -> tweaks -> user. Each layer is a sequence of operations. In a full-state JSON/YAML model, how do you compose layers? You would need:

- A merge strategy for overlapping keys
- A precedence system for conflicting values
- A way to delete or override specific fields from a lower layer

This is equivalent to rebuilding the entire PCD compilation engine, but for JSON/YAML merging instead of SQL replay. The complexity does not disappear -- it moves.

### 6.4 The Incremental Update Problem

The current system exports individual operations: "change X from A to B." In a full-state JSON model, an update means replacing the entire entity document. This creates two problems:

1. **Larger diffs**: Changing one field in a custom format with 10 conditions and 5 tests means the entire document is replaced in the diff, hiding the actual change.

2. **Merge conflicts**: Two contributors changing different fields of the same entity will produce a Git merge conflict in JSON/YAML because both modified the same file/document. With SQL ops, these are separate operations that compose cleanly.

**Confidence**: High that the versioning model mismatch is the single biggest risk in this migration.

---

## 7. What If We Are Solving the Wrong Problem?

### 7.1 A JSON/YAML VIEW (Read-Only, Auto-Generated)

Instead of changing the authoring format, generate a JSON/YAML representation FROM the compiled cache for consumption purposes:

- API consumers get a JSON API (which Praxrr already exposes)
- Documentation generators get structured JSON
- TRaSH-Guides compatibility gets a translation layer
- The authoring format stays as SQL ops with all its operational semantics

This is a "have your cake and eat it too" approach. The cost is building and maintaining the JSON generation layer, which is far cheaper than migrating the entire authoring pipeline.

### 7.2 A JSON/YAML IMPORT Path (For TRaSH-Guides Specifically)

If TRaSH-Guides alignment is a primary goal, build a TRaSH-JSON-to-PCD-ops importer. This is a one-directional adapter that:

1. Reads TRaSH-Guides JSON files
2. Diffs them against the current PCD cache
3. Generates appropriate SQL ops (inserts, updates, deletes with value guards)
4. Writes those ops through the existing writer pipeline

This solves the TRaSH-Guides interoperability goal without changing the internal format.

### 7.3 Better SQL Tooling

Invest in:

- A PCD-aware SQL linter (validates entity references, constraint compatibility)
- A GitHub Action that compiles the PCD on PR and reports errors
- Improved export formatting (the current format is already well-structured)
- Editor snippets/templates for common operation patterns

### 7.4 The Hybrid Approach Nobody Proposed

Keep SQL as the operational format (for the writer, compiler, conflict detection, and export pipeline) but add a JSON/YAML "manifest" layer for entity metadata and documentation:

```
ops/
  0.rosettarr.sql          # SQL ops (unchanged)
  1.update-amzn.sql         # SQL ops (unchanged)
metadata/
  custom-formats/
    AMZN.yaml               # Human-readable description, tags, docs
  quality-profiles/
    1080p-quality.yaml       # Human-readable overview, strategy description
```

This gives you human-readable documentation without sacrificing the operational semantics of SQL ops.

**Confidence**: High that one of these alternatives would deliver more value at lower cost than a full format migration.

---

## 8. Summary: The Gaps in the Current Framing

| Gap                                                                               | Severity | Impact                                                                             |
| --------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| Alternative formats not evaluated (TOML, CUE, Pkl, Dhall, SQLite .db, custom DSL) | Medium   | May miss a better-fit option                                                       |
| Problem may be tooling, not format                                                | High     | Solving the wrong problem wastes engineering effort                                |
| No persona analysis of who authors PCD data                                       | High     | May optimize for the wrong user                                                    |
| Migration complexity severely underestimated                                      | High     | 44K+ lines of SQL with value guards, cascading operations, and layered composition |
| Performance impact unmeasured                                                     | Low      | Unlikely to be a blocker but creates unknown risk                                  |
| Append-only vs. full-state model mismatch                                         | Critical | The core architectural conflict that the entire proposal must address              |
| "Wrong problem" alternatives not considered                                       | High     | A JSON view + import adapter may deliver 80% of the value at 20% of the cost       |

---

## 9. Uncertainties and Gaps in This Analysis

- I do not have access to the original YAML source that generated `0.rosettarr.sql`. Understanding why YAML was abandoned as the authoring format and SQL adopted would be critical context.
- I have not measured actual compilation performance for the current SQL replay.
- I do not have contributor metrics -- how many people besides the maintainer have ever authored PCD data.
- The TRaSH-Guides alignment goal needs more specificity: is it data compatibility, format compatibility, or contribution workflow compatibility?
- I have not evaluated how well the Praxrr UI's existing editing capabilities cover the use cases that would motivate a format change.

---

## 10. Search Queries Executed

1. "TOML vs YAML vs JSON configuration format comparison 2025 advantages disadvantages"
2. "CUE language configuration validation schema 2025"
3. "Pkl Apple configuration language adoption 2025 2026"
4. "SQLite as data interchange format distribution format advantages"
5. "TRaSH-Guides custom format JSON schema structure recyclarr"
6. "append-only operations log vs full state representation configuration management tradeoffs"
7. "Dhall configuration language adoption status 2025"

---

## Sources

- [TOML vs YAML vs JSON: Complete Comparison](https://jsontoyamlconverter.com/yaml-vs-json/toml/)
- [Configuration Format Comparison - 0hlov3s Blog](https://schoenwald.aero/posts/2025-05-03_configuration-format-comparison/)
- [CUE Language](https://cuelang.org/)
- [How CUE Enables Configuration](https://cuelang.org/docs/concept/how-cue-enables-configuration/)
- [Pkl: Apple's New Configuration Language](https://www.trevorlasn.com/blog/pkl-apple-new-configuration-language)
- [Apple Pkl GitHub Releases](https://github.com/apple/pkl/releases)
- [SQLite As An Application File Format](https://www.sqlite.org/appfileformat.html)
- [Benefits of SQLite As A File Format](https://www.sqlite.org/aff_short.html)
- [Creating a Trash Guides Repository - Recyclarr](https://recyclarr.dev/reference/settings/resource-providers/trash-guides-structure/)
- [The Write-Ahead Log - Architecture Weekly](https://www.architecture-weekly.com/p/the-write-ahead-log-a-foundation)
- [Append-Only Logs - Medium](https://medium.com/@komalshehzadi/append-only-logs-the-immutable-diary-of-data-58c36a871c7c)
- [The Log: What Every Software Engineer Should Know - LinkedIn Engineering](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)
- [Dhall Configuration Language](https://dhall-lang.org/)
- [Why Buildpacks Use TOML - Heroku Blog](https://blog.heroku.com/why-buildpacks-use-toml)
- [Martin Ueding - JSON vs YAML vs TOML](https://martin-ueding.de/posts/json-vs-yaml-vs-toml/)
