# Strategic Options for PCD Data Format

## Overview

This document synthesizes the findings from eight independent research personas, the convergence mapping, and the contradiction mapping into 5 distinct strategic options for Praxrr's PCD data format. Each option represents a different trade-off profile along the spectrum from minimal change to full transformation.

The evaluation prioritizes **outcomes** -- readability, scalability, automation, documentation generation, and ecosystem alignment -- over effort, per the stated design principle: "The effort doesn't matter as long as it's better overall and scalable."

---

## Option 1: SQL-First with Tooling Investment

### Description

Keep SQL as the sole authoring, storage, execution, and distribution format. Invest in tooling, documentation generation, and developer experience improvements around the existing SQL ops system. No format migration occurs.

### What Changes

- Add a PCD-aware SQL linter (validates entity references, constraint compatibility against the schema)
- Build CI/CD validation (GitHub Action that compiles PCD from scratch on every PR, reports errors inline)
- Create an auto-generated documentation site that reads the compiled PCD cache and renders browsable entity documentation (per-CF pages, per-QP pages, score matrices, regex references)
- Develop editor tooling: VS Code extension with PCD schema-aware auto-complete, hover documentation, and go-to-definition for entity names
- Add a TRaSH-Guides JSON import adapter (one-way: TRaSH JSON -> PCD SQL ops via the existing writer pipeline)
- Improve export formatting with richer metadata headers and structured PR templates

### What Stays the Same

- The append-only ops model
- The SQL authoring format
- The compilation pipeline (`db.exec(operation.sql)`)
- The value guard conflict detection system
- The export pipeline (SQL files in git)
- The writer pipeline (Kysely -> SQL -> validate -> store)
- All 116+ server-side files remain untouched for format concerns

### Scope of Change

- **Files affected**: 5-10 new tooling files (linter, docs generator, CI config, editor extension scaffolding), plus the TRaSH import adapter (~3-5 files)
- **Existing code changes**: Minimal -- possibly small enhancements to metadata headers in `exporter.ts` and PR template improvements
- **PCD database repo**: No changes to `packages/praxrr-db/ops/`

### Pros

- **Zero migration risk**: No format translation boundary, no new bug surface in the critical write/validate/compile path
- **Preserves all emergent properties**: Self-validation, implicit conflict detection via row counting, composability, execution identity (7-persona convergence that these are underappreciated strengths)
- **Lowest disruption**: No backwards compatibility concerns, no dual-format transition period
- **TRaSH interoperability achieved**: The import adapter solves the concrete interoperability use case without format coupling (6-persona convergence that adapter is the right approach)
- **Documentation gap addressed**: Auto-generated docs from the compiled cache deliver the same output regardless of source format (4-persona convergence)
- **CI validation solves pre-commit gap**: The "no schema validation before compilation" pain point is addressed directly

### Cons

- **Ecosystem outlier position persists**: Praxrr remains the only tool in the Arr ecosystem using SQL for both upstream data and user-facing distribution. This is a real positioning concern, not just a cosmetic one.
- **No API-first distribution**: Third-party tools cannot consume PCD data without a SQL execution environment. The distribution model stays Git-clone-and-replay.
- **No AI/LLM integration path**: SQL generation accuracy for INSERT/UPDATE with value guards is significantly lower than JSON Schema constrained decoding (~52% vs near-100% for structured output). This forecloses AI-assisted entity creation.
- **No semantic changelogs**: SQL diffs remain textual rather than semantic. "CF Z score changed from 100 to 150 in QP W" is not achievable from raw SQL diffs without building a SQL semantic diff parser.
- **Community contribution barrier unchanged**: The intersection of "media server enthusiasts who understand quality profiles" and "people who can write SQL ops with value guards" remains small. Tooling helps but does not eliminate the SQL authoring requirement.
- **Does not leverage existing portable types infrastructure**: The `portable.ts`, `serialize.ts`, `deserialize.ts` infrastructure goes unused for distribution purposes.

### Enables

- Immediate documentation improvements
- TRaSH-Guides import capability
- Better contribution review experience via CI
- Foundation for a future format migration (better tooling makes any future migration easier to validate)

### Blocks

- API-first distribution to third-party tools
- AI/LLM-assisted entity authoring
- Community-contributed PCD databases at scale
- Semantic changelog generation (without building a separate SQL semantic parser)
- Cross-tool consumption of PCD data without SQLite runtime

### Best For

This option is the right choice if:

- The primary PCD authoring workflow is UI-driven (maintainer uses the web UI, format is invisible)
- Community contribution is not a near-term strategic priority
- Internal architectural stability and code quality are the top priorities
- The project wants to preserve optionality for a future migration while solving immediate pain points now

---

## Option 2: JSON Schema Formalization + JSON/YAML Read Layer (View Layer)

### Description

Keep SQL as the authoring, storage, and execution format. Add a JSON Schema formalization of the existing `portable.ts` types and build a JSON/YAML "view" layer that auto-generates structured entity representations from the compiled PCD cache. This creates a read-only JSON/YAML projection of the PCD data without changing the write path.

### What Changes

- Formalize `portable.ts` types as published JSON Schema definitions (`pcd.schema.json`)
- Build a JSON/YAML generation pipeline that reads the compiled SQLite cache and produces per-entity JSON/YAML files
- Publish these generated files as part of CI/CD (GitHub Pages, CDN, or npm/JSR package)
- Expose a JSON API endpoint in Praxrr for programmatic entity access
- Add a `metadata/` directory alongside `ops/` for human-readable YAML entity documentation and descriptions
- Build a TRaSH-Guides JSON import adapter
- Add semantic changelog generation from structured JSON diffs between versions

### What Stays the Same

- The SQL authoring format for ops
- The append-only ops model
- The compilation pipeline
- The value guard conflict detection system
- The export pipeline (SQL files in git)
- The writer pipeline
- All entity CRUD handlers continue producing SQL

### Scope of Change

- **New files**: JSON Schema definitions (~3-5 files), JSON generation pipeline (~5-8 files), API endpoint additions (~3-5 files), metadata directory structure, CI/CD configuration
- **Modified files**: Minor additions to the compilation pipeline to trigger JSON generation after cache rebuild
- **PCD database repo**: Addition of a `metadata/` directory (optional, human-authored YAML for documentation only); auto-generated `entities/` directory produced by CI

### Pros

- **API-first distribution achieved**: Third-party tools can consume PCD data as JSON via HTTP, npm package, or CDN -- no SQLite runtime required
- **JSON Schema enables IDE validation**: Any JSON/YAML file matching the schema gets auto-complete, hover docs, and validation in VS Code and other editors
- **Semantic changelogs become possible**: Structured JSON diffs between versions produce human-readable change descriptions ("CF Z score changed from 100 to 150 in QP W")
- **AI/LLM consumption enabled**: LLMs can read and reason about PCD entities in JSON format. Schema-constrained generation of new entity suggestions becomes feasible.
- **Ecosystem alignment for distribution**: While authoring stays SQL, the distribution format aligns with ecosystem norms (JSON for machine consumption, YAML for human reading)
- **Leverages existing infrastructure**: The `portable.ts` types, `serialize.ts`, and the existing JSON `desired_state` column are the foundation -- this is formalization, not invention (4-persona convergence)
- **Documentation generation built-in**: JSON Schema tooling ecosystem (json-schema-for-humans, jsonschema2md) provides free documentation generation
- **Zero risk to write/compile/conflict path**: The critical write-validate-compile loop is completely untouched
- **TRaSH interoperability**: Import adapter plus JSON distribution covers both directions

### Cons

- **Authoring barrier unchanged**: Contributors still write SQL ops or use the UI. The "5-10x contributor pool expansion" that JSON/YAML authoring could enable does not happen.
- **Dual representation maintenance**: The JSON Schema must stay synchronized with the SQL DDL schema and the `portable.ts` types. Schema changes require updates in three places.
- **Generated JSON is a derived artifact**: The JSON files are not the source of truth -- they are projections. If the generation pipeline has bugs, the JSON could be incorrect without affecting the actual PCD state. This creates a "two truths" risk for external consumers.
- **No write-path improvement**: The contribution workflow for the PCD database repository is unchanged. PRs still contain SQL diffs.
- **Metadata directory is manual**: The `metadata/` YAML files for documentation are hand-authored and must be kept in sync with actual entity state -- a maintenance burden.

### Enables

- Third-party tool consumption of PCD data
- Semantic changelogs and release notes
- AI-assisted entity suggestion (read + recommend, not yet write)
- Published, versioned JSON Schema as an ecosystem contract
- Documentation site generation from structured data
- Foundation for Option 3 or 4 (the JSON Schema and portable types become the ingestion schema)

### Blocks

- Nothing is permanently blocked. This option preserves full optionality for future write-path changes.

### Best For

This option is the right choice if:

- External ecosystem integration and API-first distribution are strategic priorities
- The project wants to deliver immediate value to third-party consumers and documentation
- The authoring workflow is satisfactory (UI-driven or maintainer-only)
- The project wants a stepping stone that validates JSON Schema definitions before committing to write-path changes
- Risk tolerance is low but ecosystem positioning matters

---

## Option 3: Hybrid Model -- JSON/YAML Seed Authoring + SQL Incremental Operations

### Description

Introduce JSON/YAML as the authoring format for **entity definitions** (seed data, new entity creation) while retaining SQL for **incremental mutations** (updates with value guards, conditional deletes, rename chains, cross-entity batch operations). The JSON/YAML ingestion layer routes through the existing `deserialize.ts` pipeline to produce SQL ops at compile time.

This is the "conservative hybrid" that 6 personas converged on in different forms. It draws the line at the natural boundary identified by 5 personas: seed data maps to JSON/YAML; incremental operations map to SQL.

### What Changes

- **PCD database repo structure**: `entities/{cf,qp,dp,re,...}/*.yaml` for entity definitions + `ops/*.sql` for incremental migrations
- **New ingestion layer**: YAML/JSON file reader that produces `PortableEntity` objects, routed through existing `deserialize.ts` -> Kysely -> SQL ops pipeline
- **Import pipeline**: `importBaseOps.ts` extended to detect and handle both `.yaml`/`.json` entity files and `.sql` ops files
- **JSON Schema validation**: Entity YAML/JSON files validated against the formalized `portable.ts` JSON Schema before compilation
- **Export pipeline**: New entity creation exports produce YAML entity files; incremental mutation exports continue producing SQL ops files
- **Compilation pipeline**: Extended to first ingest entity files (generating SQL) then execute SQL ops in order
- **CI/CD**: Validation of YAML entity files against schema, compilation test, JSON API generation

### What Stays the Same

- SQL DDL schema (`0.schema.sql`) -- unanimous 7-persona convergence
- The append-only ops model for incremental changes
- The value guard conflict detection system (operates on SQL, unchanged)
- The in-memory SQLite cache compilation
- The user ops / base ops layer separation
- The Kysely query builder pipeline
- The Arr sync engine
- Entity CRUD handlers in the UI (continue producing SQL through Kysely)

### Scope of Change

- **New files**: YAML ingestion layer (~5-8 files), JSON Schema definitions (~3-5 files), entity-to-SQL compiler leveraging `deserialize.ts` (~3-5 files)
- **Modified files**: `importBaseOps.ts`, `loadOps.ts`, `exporter.ts`, `operations.ts` (file extension handling), compilation ordering in `cache.ts`
- **PCD database repo**: Initial seed (`0.rosettarr.sql`) decomposed into per-entity YAML files; incremental ops files remain as SQL
- **Estimated total**: ~20-30 files modified or created, leveraging existing `portable.ts` and `deserialize.ts` infrastructure

### Pros

- **Contributor-friendly entity authoring**: New custom formats, quality profiles, regex patterns, and other entities can be authored in YAML -- dramatically lowering the contribution barrier for the most common operation (creating new entities)
- **Value guards preserved**: Incremental mutations keep SQL's native conditional execution semantics. The hardest technical problem (7-persona convergence on value guards as the critical gate) is sidestepped entirely for the mutation path.
- **Leverages existing infrastructure deeply**: The `portable.ts` types define the YAML schema. The `deserialize.ts` pipeline already converts portable entities to SQL ops. The `serialize.ts` pipeline already reads entities from cache to portable JSON. This is extension, not reinvention.
- **Natural boundary**: The seed data / incremental migration distinction is a real architectural boundary confirmed by 5 personas. Seed data (entity definitions) maps naturally to documents; mutations map naturally to operations.
- **API-first distribution**: Entity YAML files plus generated JSON enable the same distribution benefits as Option 2
- **Semantic changelogs**: YAML entity diffs are semantic; SQL mutation diffs remain textual but are typically small, focused changes
- **Profilarr/Dictionarry precedent**: Profilarr uses exactly this architecture (YAML files in repo, SQL ops internally), validating the model in the same domain
- **AI/LLM entity creation**: JSON Schema constrained decoding can generate new entity YAML files with near-100% structural accuracy
- **Git diffs improve for entity definitions**: One file per entity, self-documenting structure, clear field-level diffs. Incremental SQL diffs remain readable as small, focused operations.

### Cons

- **Two formats in the repository**: The PCD database repo contains both YAML entity files and SQL ops files. Contributors must understand when to use which format. Documentation and contribution guides must explain the boundary.
- **Import pipeline bifurcation**: `importBaseOps.ts` must handle both formats, creating a long-lived dual-format system (Systems Thinker warning)
- **Export pipeline complexity**: Entity creation exports produce YAML; mutation exports produce SQL. The exporter must determine which format to use based on operation type.
- **Compilation ordering**: Entity YAML files must be compiled before SQL ops that reference those entities. The compilation pipeline gains a two-phase structure.
- **Seed data decomposition**: Converting `0.rosettarr.sql` (25,220 lines) into individual entity YAML files is a substantial one-time effort. The decomposition must produce YAML that, when compiled back to SQL and executed, produces identical cache state.
- **YAML parsing risks**: Regex patterns in condition definitions are vulnerable to YAML type coercion and quoting issues (4-persona convergence on YAML domain risks). Requires YAML 1.2 strict parsing and explicit string quoting rules.
- **Dual maintenance for schema changes**: Adding a new entity type requires updating both the JSON Schema (for YAML validation) and the SQL DDL (for cache schema). These must stay synchronized.

### Enables

- Community-contributed entity definitions in YAML
- AI/LLM-assisted entity creation
- API-first distribution of entity data
- Semantic changelogs for entity definitions
- TRaSH-Guides import (adapter produces YAML entity files)
- Foundation for Option 4 (if incremental mutations are later migrated to YAML operations)
- Third-party tool creation (consume entity YAML directly)
- Published JSON Schema as ecosystem contract

### Blocks

- Unified single-format repository (the dual-format nature is permanent unless incremental ops are also migrated)
- SQL-free contribution workflow (incremental updates still require SQL or UI)
- Full round-trip: export -> edit -> re-import for incremental changes remains SQL

### Best For

This option is the right choice if:

- Community contribution growth is a strategic priority
- The project wants the highest-value format improvement with contained risk
- The existing `portable.ts` / `deserialize.ts` infrastructure is confirmed to handle entity ingestion with modest extensions
- The project is willing to accept a dual-format repository as a permanent (not transitional) architectural choice
- Incremental mutation frequency is low relative to entity creation (the SQL mutation path serves a small but critical subset of operations)

---

## Option 4: Full Hybrid -- JSON/YAML Authoring for All Operations + SQL Compilation

### Description

Make JSON/YAML the **primary authoring and distribution format** for all PCD data -- both entity definitions and incremental mutations. SQL becomes a compile target only, generated by the system and never authored by humans. The append-only ops model is preserved, but ops are authored in JSON/YAML and compiled to SQL at ingestion time. This is the Futurist's five-layer architecture.

### What Changes

- **PCD database repo structure**: `entities/{cf,qp,dp,re,...}/*.yaml` for entity definitions + `operations/*.yaml` for incremental mutations (replacing `ops/*.sql`)
- **New JSON/YAML operation schema**: A formal schema for expressing mutations (insert, update with guards, conditional insert, delete with guards, rename, batch operations) in YAML
- **JSON/YAML-to-SQL compiler**: A new compilation layer that translates YAML operations into SQL statements with value guards, ordering, and cross-table coordination
- **Import pipeline**: Fully rewritten to parse YAML/JSON files, validate against schema, compile to SQL, store in `pcd_ops`
- **Export pipeline**: Rewritten to produce YAML operation files instead of SQL files. The exporter serializes `pcd_ops` SQL back to structured YAML operations.
- **Writer pipeline**: Extended to store both the compiled SQL (for execution) and the source YAML representation (for export/round-trip)
- **Compilation pipeline**: YAML -> JSON Schema validation -> SQL generation -> SQLite execution
- **All entity CRUD handlers**: Continue producing SQL through Kysely internally, but the export path converts to YAML
- **Migration of all 57 existing SQL ops files** to YAML operation format

### What Stays the Same

- SQL DDL schema (`0.schema.sql`)
- The in-memory SQLite cache (still compiled from SQL)
- The SQLite execution engine (SQL is still what runs)
- The Arr sync engine
- The user ops / base ops layer separation conceptually (though representation changes)

### Scope of Change

- **New files**: YAML operation schema (~3-5 files), YAML-to-SQL compiler (~10-15 files covering all entity types and operation patterns), JSON Schema definitions (~3-5 files), operation serializer for export (~5-8 files)
- **Heavily modified files**: `importBaseOps.ts`, `loadOps.ts`, `exporter.ts`, `writer.ts`, `cache.ts`, `operations.ts`, `sql.ts`, `git.ts`
- **Entity CRUD handlers**: 38 files need export-path modifications
- **Conflict resolution**: `overrideUtils.ts` rename-chain parsing rewritten for YAML (improvement over fragile SQL regex parsing)
- **Migration constants**: 6 migration files with embedded SQL constants need YAML equivalents
- **PCD database repo**: All 57 SQL files converted to YAML
- **Estimated total**: ~60-80 files modified or created; ~3,000-5,000 lines of new format-handling code replacing ~1,500 lines

### Pros

- **Unified, human-readable format**: The entire PCD repository is readable YAML. No SQL knowledge required to understand, review, or contribute any operation.
- **Maximum contributor accessibility**: The contribution barrier drops to "can edit YAML" -- nearly universal. The 5-10x contributor pool expansion becomes achievable.
- **Full AI/LLM integration**: Both entity creation and mutation operations can be generated by LLMs with JSON Schema constrained decoding. Natural language -> YAML operation pipeline becomes feasible.
- **Semantic changelogs for everything**: All operations are structured data. Every change gets a semantic description, not just entity definitions.
- **API-first distribution complete**: The entire PCD database is distributable as structured data (JSON API, npm package, CDN)
- **Eliminates fragile SQL regex parsing**: The `overrideUtils.ts:extractRenamesFromSql()` pattern (regex parsing SQL strings to extract rename chains) is replaced with structured YAML data access -- a clear improvement.
- **Profilarr architecture alignment**: Matches the proven YAML-authoring + SQL-internal pattern used by the closest comparable system.
- **Single authoring format**: No dual-format confusion. Contributors always write YAML.
- **Structured diff tooling**: Tools like `dyff`, `graphtage`, and `jd` provide semantic YAML diffing superior to line-based SQL diffs for complex operations.

### Cons

- **Value guard representation in YAML is the critical unsolved problem**: 7 personas identified this as the hardest technical challenge. The YAML operation schema must express "update field X to Y only if currently Z" -- which is semantically identical to SQL's WHERE clause but in a custom DSL. This is the single biggest risk. A prototype demonstrating faithful representation of the most complex ops (e.g., op 42 with 249 operations) is required before committing.
- **New YAML-to-SQL compiler is a critical-path component**: Bugs in this compiler silently corrupt PCD data. The current system has no such translation boundary -- SQL is both storage and execution. Adding a compiler adds a category of bugs (incorrect SQL generation) that does not currently exist.
- **Complexity doubles or triples**: The Systems Thinker estimates 3,000-5,000 lines of new code replacing ~1,500 lines. The Archaeologist estimates ~116 files and ~34,000+ lines affected for a full migration. Neither estimate is negligible.
- **YAML parsing risks for regex patterns**: PCD stores complex regex patterns. YAML's implicit type coercion, indentation sensitivity, and multi-line string handling create real risks for regex-heavy data (4-persona convergence). Requires strict YAML 1.2 parsing, explicit quoting rules, and JSON Schema validation as a safety net.
- **Export pipeline requires SQL-to-YAML reverse translation**: The writer pipeline produces SQL via Kysely. Exporting YAML operations requires either: (a) capturing Kysely's intermediate representation, (b) reverse-parsing compiled SQL, or (c) storing both SQL and YAML representations. All three add complexity.
- **Migration of 57 existing SQL ops files**: Each file must be converted to the YAML operation format and validated to produce identical compiled state. The most complex files (op 42 with 249 operations, op 39 with cross-entity batch operations) are genuinely hard to express in YAML without reinventing SQL.
- **Lost emergent properties**: Self-validation (SAVEPOINT dry-run validates the exact SQL that will be stored), composability (any valid SQL is a valid operation), and execution identity (stored format = execution format) are lost or degraded.
- **Three-language system**: SQL for schema, YAML for operations, SQL for execution -- creating a translation bridge between two SQL layers (Systems Thinker observation).

### Enables

- Maximum community contribution accessibility
- Full AI/LLM integration for both creation and mutation
- Complete API-first distribution
- Semantic changelogs for all operations
- Cross-tool ecosystem consumption
- Published operation schema as ecosystem standard
- Potential for other tools to produce Praxrr-compatible YAML operations

### Blocks

- **Universal SQL tooling**: Can no longer validate ops with `sqlite3 :memory: < schema.sql < ops.sql`. Praxrr-specific tooling required.
- **SQL power-user escape hatch**: Complex, novel operations that do not fit the YAML operation schema cannot be expressed without extending the schema. Composability is lost.

### Best For

This option is the right choice if:

- External ecosystem leadership and community growth are the top strategic priorities
- The value guard representation problem is solved by prototype (the gate-keeping technical question)
- The project is willing to accept doubled complexity for unified format benefits
- AI/LLM-assisted authoring is a near-term product feature
- The project accepts that SQL's emergent properties (self-validation, composability, execution identity) will be replaced by explicit application-level systems

---

## Option 5: Full-State Entity Documents with Operation Generation

### Description

The most transformative option. Abandon the append-only operation authoring model for the **authoring layer** and adopt a full-state entity document model. Each entity is a complete YAML document representing its current desired state. The system **generates** incremental operations by diffing the document against the current cache state. The append-only ops model is preserved internally (operations are still stored and compiled as ordered SQL ops), but the authoring interface becomes declarative rather than imperative.

This is the approach the Negative Space persona identified as the deepest architectural mismatch -- and simultaneously the approach that, if solved, delivers the most transformative outcome.

### What Changes

- **PCD database repo structure**: `entities/{cf,qp,dp,re,...}/*.yaml` -- each file is a complete entity definition (not an operation). No `ops/` directory for human authoring.
- **State-diff engine**: A new subsystem that compares YAML entity documents against the current compiled cache and generates the appropriate SQL operations (inserts, updates with value guards, deletes, renames) automatically.
- **Value guard generation**: The diff engine generates value guards by reading current field values from the cache and embedding them as WHERE clause conditions in the generated SQL. Contributors never write guards -- the system produces them.
- **Version-controlled entity state**: The git repository contains the desired state of every entity. Git history IS the operation log. Each commit represents a state transition, and the diff engine computes the operations needed to move from one state to the next.
- **Import pipeline**: Completely replaced. On import, the system loads all entity YAML files, diffs against current cache state, generates SQL ops, and stores them in `pcd_ops`.
- **Export pipeline**: Completely replaced. On export, the system serializes entity state from the cache to YAML files and commits them. The YAML files ARE the export.
- **Conflict detection**: Reimplemented. Instead of row-counting from SQL execution, conflicts are detected by comparing the current cache state against the expected state encoded in the entity document. If a field's current value does not match the document's implicit expectation (derived from the previous version of the document), a conflict is flagged.
- **User overrides**: Represented as per-entity override documents that specify field-level deviations from the base entity state.

### What Stays the Same

- SQL DDL schema (`0.schema.sql`)
- The in-memory SQLite cache (compiled from generated SQL)
- The SQLite execution engine
- The Arr sync engine
- The Kysely query builder (used internally by the diff engine to generate SQL)

### Scope of Change

- **New subsystem**: State-diff engine (~15-25 files) covering all entity types, multi-table decomposition, dependency ordering, and value guard generation
- **New conflict detection**: Declarative conflict detection based on state comparison rather than row counting (~10-15 files)
- **New override model**: Per-entity override documents replacing the current user ops layer (~5-10 files)
- **Completely rewritten**: Import pipeline, export pipeline, writer pipeline
- **Heavily modified**: Cache compilation (two-phase: generate ops from state diff, then execute), all entity CRUD handlers (produce entity state changes, not SQL ops)
- **PCD database repo**: Complete restructure -- 57 SQL files replaced by ~200-500 individual entity YAML files organized by type
- **Estimated total**: ~80-120 files created or significantly modified

### Pros

- **Ultimate readability**: Every entity is a complete, self-documenting YAML file. A quality profile file shows all its qualities, scores, languages, and tags in one place. No need to trace through 57 SQL files to understand what an entity looks like.
- **Contributors never write operations**: Adding a new custom format means creating a YAML file. Updating a score means changing a number in a YAML file. No value guards, no SQL, no understanding of the append-only model required. The contribution barrier is absolute minimum.
- **Git diffs become entity diffs**: Changing a score from 100 to 150 shows as a one-line diff in the entity YAML file. No SQL noise, no guard clauses, no WHERE conditions.
- **Merge conflicts are meaningful**: Two contributors changing different fields of the same entity can be auto-merged by git (different lines in the same YAML file). The current SQL ops model produces no merge conflicts but also no merges -- both changes create separate operations.
- **AI/LLM authoring is trivial**: An LLM generates a complete entity YAML file. The system handles the rest.
- **Eliminates the value guard authoring problem entirely**: Contributors never express value guards. The system generates them automatically by reading current state. This sidesteps the 7-persona convergence on value guards being the hardest problem -- by moving guard generation from the human to the machine.
- **Semantic changelogs are automatic**: Git diff of YAML files IS the semantic changelog.
- **Maximum API-first distribution**: Entity YAML files are directly servable as a JSON API with trivial YAML-to-JSON conversion.
- **Scalable entity model**: Adding a new entity type means adding a YAML schema and a diff handler. No new operation formats, no new SQL patterns to learn.

### Cons

- **The deepest architectural change**: This fundamentally shifts the authoring model from imperative (operations) to declarative (desired state). The append-only model is preserved internally but hidden from the authoring layer. This is a paradigm change, not a format change.
- **State-diff engine complexity**: The diff engine must handle all entity types, multi-table decomposition (custom format = 11 tables, quality profile = 7 tables), dependency ordering, and edge cases (renames, cascading deletes, conditional operations). This is the most complex new subsystem in any option.
- **Conflict detection reimplementation**: The elegant row-counting conflict detection is replaced by explicit state comparison. The new system must handle the same cases: field-level conflicts, full-list conflicts (quality profile qualities), rename-chain conflicts, and auto-alignment. This is a significant reimplementation of a critical subsystem.
- **Loss of operation granularity**: The current system records "changed field X from A to B at time T with metadata M" as individual operations. In a full-state model, the operation is implicit (derived from git diff). Fine-grained operation metadata (why was this change made? what was the rationale?) must be captured in commit messages or separate metadata, not in the operation itself.
- **Cross-entity batch operations become implicit**: Op 42 (regroup and reorder quality rankings for all profiles) is a single deliberate batch operation in the current model. In a full-state model, it becomes "many entity files changed in one commit" -- the batch intent is implicit in the commit, not explicit in the data.
- **User override model changes**: User overrides currently work as user-layer SQL ops that apply on top of base ops during compilation. In a full-state model, user overrides must be represented as per-entity deviation documents or a merge/overlay mechanism. This is a new abstraction that must handle all the same cases (field overrides, score overrides, quality ordering overrides).
- **Initial decomposition is the largest**: Converting the compiled PCD cache into ~200-500 individual entity YAML files, then validating that the state-diff engine can reproduce the cache from those files, is the largest initial effort of any option.
- **YAML parsing risks amplified**: Every entity is a YAML file. Regex patterns, special characters, numeric scores that YAML might coerce -- all are magnified across hundreds of files. Requires the strictest YAML parsing configuration.
- **Irreversibility**: Once the PCD database repo is restructured as full-state entity documents, reverting to SQL ops requires rebuilding the operation history -- which is effectively impossible. This is the most committed option.

### Enables

- The lowest possible contribution barrier
- Complete AI/LLM integration for all authoring
- Automatic semantic changelogs from git history
- Maximum API-first distribution
- Git-native collaboration (branch, merge, PR for entity changes)
- Third-party tools can produce Praxrr-compatible entity files directly
- Potential for a visual entity editor that reads/writes YAML directly

### Blocks

- **Fine-grained operation audit trail**: Individual operation metadata (rationale, author intent, dependency tracking) becomes harder to capture compared to explicit operations.
- **Complex conditional operations**: Operations like "insert this score only if the quality profile and custom format both exist" are handled implicitly by the diff engine rather than explicitly by the author. If the diff engine makes the wrong decision, the error is harder to diagnose.
- **Bisectability at the operation level**: Can no longer replay ops up to operation N. Bisectability moves to the git commit level.

### Best For

This option is the right choice if:

- The project's strategic vision is to be the community-standard configuration platform for the Arr ecosystem
- Maximum accessibility and minimum contribution barrier are non-negotiable goals
- The project is willing to invest in a state-diff engine as a core competency
- The value of eliminating human-authored value guards (by generating them automatically) outweighs the cost of building the generation system
- Git-native collaboration workflows (branch, merge, PR) for entity management are desired
- The project accepts the irreversibility of the architectural shift

---

## Comparison Matrix

| Dimension               | Option 1: SQL + Tooling  | Option 2: JSON View Layer               | Option 3: Hybrid Seed + SQL Ops           | Option 4: Full YAML Ops       | Option 5: Full-State Docs     |
| ----------------------- | ------------------------ | --------------------------------------- | ----------------------------------------- | ----------------------------- | ----------------------------- |
| **Readability**         | Unchanged (SQL)          | SQL authoring, JSON/YAML reading        | YAML for entities, SQL for mutations      | YAML for everything           | YAML for everything, simplest |
| **Scalability**         | Limited by SQL authoring | Distribution scales, authoring does not | Entity authoring scales, mutations do not | Full scaling                  | Full scaling                  |
| **Automation**          | CI validation only       | Read-side automation                    | Entity creation automation                | Full automation               | Maximum automation            |
| **Docs Generation**     | From compiled cache      | From JSON Schema + cache                | From entity YAML + cache                  | From all YAML                 | From entity YAML (direct)     |
| **Ecosystem Alignment** | Outlier                  | Distribution aligned                    | Partially aligned                         | Fully aligned                 | Fully aligned                 |
| **AI/LLM Integration**  | None                     | Read-only                               | Entity creation only                      | Full                          | Maximum                       |
| **Value Guard Safety**  | Preserved (native SQL)   | Preserved (native SQL)                  | Preserved (SQL for mutations)             | Must be expressed in YAML DSL | Auto-generated by diff engine |
| **Contributor Barrier** | High (SQL required)      | High (SQL required)                     | Low for entities, high for mutations      | Low for everything            | Lowest possible               |
| **Migration Risk**      | None                     | Very low                                | Moderate                                  | High                          | Very high                     |
| **Reversibility**       | Full                     | Full                                    | Mostly reversible                         | Partially reversible          | Irreversible                  |
| **Complexity Impact**   | +5-10 files              | +15-25 files                            | +20-30 files                              | +60-80 files                  | +80-120 files                 |
| **Dual Format**         | No                       | Read-only JSON/YAML                     | Yes (YAML + SQL)                          | No (YAML only, SQL internal)  | No (YAML only, SQL internal)  |

---

## Decision Framework

The options map to a clear spectrum driven by two strategic questions:

### Question 1: Is external ecosystem integration a strategic priority?

- **No** -> Option 1 (SQL + Tooling) or Option 2 (JSON View Layer)
- **Yes** -> Option 3, 4, or 5

### Question 2: Is community contribution growth a strategic priority?

- **No** -> Option 1 or 2
- **Yes, for entity creation** -> Option 3 (Hybrid)
- **Yes, for all operations** -> Option 4 (Full YAML Ops) or Option 5 (Full-State Docs)

### Question 3: Is the value guard problem solvable?

This is the gate-keeping technical question (7-persona convergence). It determines whether Option 4 is feasible.

- **Not solvable in YAML** -> Option 3 is the ceiling (SQL handles the hard cases)
- **Solvable via YAML DSL** -> Option 4 becomes feasible
- **Solvable via auto-generation** -> Option 5 becomes the strongest option (eliminates the problem entirely by moving guard authoring from human to machine)

### Recommended Sequencing

Options 1 through 5 are not mutually exclusive in sequence. The recommended evaluation path:

1. **Start with Option 2** (JSON Schema + View Layer) -- immediate value, zero write-path risk, validates the JSON Schema definitions
2. **Prototype Option 3** (Hybrid Seed + SQL Ops) -- convert 3-5 representative entities to YAML, route through `deserialize.ts`, validate identical compiled state
3. **Prototype the value guard problem** -- take the hardest ops file (op 42, 249 operations) and attempt YAML representation. If it works and is readable, Option 4 is feasible. If the YAML is harder to read than the SQL, Option 3 is the ceiling.
4. **Prototype the state-diff engine** (Option 5 feasibility) -- take a single entity type (custom formats) and build a diff engine that generates SQL ops from YAML state changes. If conflict detection can be reimplemented faithfully, Option 5 is feasible.
5. **Commit based on prototype results** -- the prototypes provide the concrete evidence that the contradiction mapping identifies as missing.

---

## Appendix: Confidence Assessment

| Finding                                           | Confidence    | Basis                                                                                                                                                                    |
| ------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SQL schema must stay SQL                          | Very High     | 7-persona unanimous convergence, zero dissent                                                                                                                            |
| Hybrid model is correct general direction         | High          | 6-persona convergence across opposing perspectives                                                                                                                       |
| Value guards are the critical gate                | High          | 7-persona convergence                                                                                                                                                    |
| TRaSH import should be adapter, not format driver | High          | 6-persona convergence                                                                                                                                                    |
| Existing portable types are the foundation        | Moderate-High | 4-persona convergence, verified in codebase                                                                                                                              |
| YAML has real domain risks for regex data         | Moderate      | 4-persona convergence, mitigatable                                                                                                                                       |
| Migration complexity estimates                    | Moderate      | Range from 20-30 files (Option 3) to 80-120 files (Option 5) based on 4-persona convergence on underestimation                                                           |
| Full-state model is architecturally feasible      | Low-Moderate  | Strongest theoretically but least prototyped; the Negative Space persona identified this as the deepest mismatch while the Futurist's architecture implicitly enables it |
