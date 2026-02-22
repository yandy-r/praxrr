# Risk Assessment: PCD Data Format Migration

## Overview

This document synthesizes risks identified across eight persona research findings (Historian, Contrarian, Analogist, Systems Thinker, Journalist, Archaeologist, Futurist, Negative Space), the convergence mapping, and the contradiction mapping into a structured risk assessment. Risks are organized by category and evaluated for likelihood, impact, and mitigation options.

### Strategic Options Referenced

- **Option A (Status Quo)**: Keep SQL ops as the sole format. Invest in tooling.
- **Option B (Full Migration)**: Replace SQL ops with JSON/YAML throughout the ingestion, storage, and distribution layers.
- **Option C (Conservative Hybrid)**: JSON/YAML for seed data and import/export exchange; SQL for incremental ops.
- **Option D (Moderate Hybrid)**: JSON/YAML as the primary authoring format; SQL generated at compile time. The Futurist's phased model.
- **Option E (Minimal Hybrid)**: SQL stays everywhere; add JSON/YAML metadata/documentation layer only.

---

## Category 1: Technical Risks

### R-001: Value Guard Semantics Lost or Degraded

- **Category**: Technical
- **Description**: The value guard pattern (WHERE clauses encoding expected-current-state as preconditions for mutations) is the foundation of Praxrr's conflict detection system. JSON/YAML has no native construct for conditional mutations ("set X to Y only if currently Z"). Any representation in JSON/YAML either reinvents SQL UPDATE semantics in a less expressive syntax, uses desired-state declarations that lose guard granularity, or requires a custom operation DSL. If value guards are not faithfully represented, conflict detection degrades from statement-level precision to snapshot-level comparison, losing the ability to distinguish genuine conflicts from no-ops.
- **Likelihood**: High (for Options B and D; guards must be addressed in any non-SQL authoring path)
- **Impact**: Critical -- conflict detection is the core architectural invariant enabling multi-user collaboration and the user ops / base ops layered model
- **Affected Options**: B (certain), D (high unless compile-time generation handles all guard patterns), C (low -- SQL retained for incremental ops)
- **Evidence**: Contrarian Section 2 (three guard encoding options, all insufficient); Systems Thinker Loop C analysis; Convergence 3 (7 personas agree this is the hardest problem); Archaeologist Section 2g-2i
- **Mitigation**: In Option D, value guards are generated at compile time by the existing Kysely/writer pipeline, not authored in JSON/YAML. The JSON/YAML layer handles entity definitions (seed data); incremental mutations flow through the UI/writer pipeline which produces SQL natively. For Option C, guards stay in SQL entirely. For any option, prototype the three most complex ops files (e.g., op 42 with 249 operations) as JSON/YAML and verify that compiled SQL produces identical row-change behavior.
- **Residual Risk**: Medium. Even in Option D, edge cases in guard generation for complex multi-table mutations may produce subtly different conflict detection behavior. Requires extensive regression testing against the full ops corpus.

---

### R-002: JSON/YAML-to-SQL Compiler Introduces Silent Data Corruption

- **Category**: Technical
- **Description**: Any format migration requires a compiler that transforms JSON/YAML entity definitions into correct SQL INSERT/UPDATE/DELETE statements targeting 33+ interrelated tables. This compiler must handle entity decomposition (a custom format spans up to 11 tables), correct write ordering (parent before child), foreign key references, and SQL escaping. Bugs in this compiler would silently corrupt the PCD cache because the corruption manifests as incorrect data in the in-memory SQLite database, not as execution errors.
- **Likelihood**: High (for Options B and D; any new compiler is a significant bug surface)
- **Impact**: Critical -- silent data corruption propagates through sync to production Arr instances
- **Affected Options**: B (certain -- full compiler required), D (high -- partial compiler required for YAML ingestion layer), C (low -- limited to seed data conversion)
- **Evidence**: Contrarian Section 6 (6.1-6.4 compiler complexity analysis); Systems Thinker Section 7 (Risk 1: Semantic Drift, Risk 3: Error Message Degradation); Archaeologist Section 2f (CTE patterns rated "VERY HARD" for JSON/YAML expression)
- **Mitigation**: In Option D, route JSON/YAML through the existing `deserialize.ts` -> Kysely -> `compiledQueryToSql()` pipeline rather than building a new compiler. The portable types infrastructure (`portable.ts`, `serialize.ts`, `deserialize.ts`) already handles multi-table decomposition for UI-driven writes. The JSON/YAML ingestion layer would feed into this proven pipeline. Add a comprehensive test suite that compiles the full PCD from both SQL and JSON/YAML paths and asserts row-by-row equivalence.
- **Residual Risk**: Medium. The `deserialize.ts` pipeline may not cover all SQL patterns used in existing ops files (e.g., CTE-based batch operations, multi-table EXISTS guards). Extending it requires careful per-pattern validation.

---

### R-003: Relational Constraint Validation Must Be Reimplemented

- **Category**: Technical
- **Description**: The current system uses SQLite itself as the validator -- foreign keys, CHECK constraints, UNIQUE indexes, and NOT NULL constraints are enforced atomically at write time with zero application code. JSON Schema cannot express referential integrity (foreign keys), multi-column constraints, or cross-entity validation. Any JSON/YAML ingestion layer must either compile to SQL for validation (preserving the current guarantee) or build an application-level validator that replicates SQLite's constraint engine.
- **Likelihood**: High (for Option B); Medium (for Options C and D where SQL validation is preserved)
- **Impact**: High -- constraint violations that slip through validation lead to invalid PCD state
- **Affected Options**: B (certain -- must reimplement), D (medium -- mitigated by compiling to SQL for validation), C (low)
- **Evidence**: Contrarian Section 1 (detailed constraint analysis); Systems Thinker Section 5.2 (Self-Validating Operations emergent property); Journalist Section 6 (JSON Schema vs SQL DDL comparison table showing "Not supported" for FK and multi-column constraints); Convergence 2 (7 personas agree schema must stay SQL)
- **Mitigation**: Preserve the SAVEPOINT-based validation pattern. JSON/YAML entities are compiled to SQL, then validated by executing the SQL in a SAVEPOINT transaction against the in-memory cache, then rolled back. This is the existing `cache.validateSql()` pattern. JSON Schema provides structural validation (field types, enums, required fields) as a fast first-pass check; SQLite provides relational validation as the authoritative second pass.
- **Residual Risk**: Low if SAVEPOINT validation is preserved. The risk exists only if someone proposes removing or bypassing the SQL validation step.

---

### R-004: Ordering and Dependency Resolution for Append-Only Operations

- **Category**: Technical
- **Description**: PCD operations must execute in strict order. JSON objects and YAML mappings are formally unordered. Files within a directory have no inherent ordering beyond filename convention. Multi-operation batches where operation N depends on operation N-1 (e.g., rename followed by reference update) require explicit sequencing. The current system gets this from file numbering and sequential SQL execution.
- **Likelihood**: Medium (mitigated by file naming conventions and explicit sequence metadata)
- **Impact**: High -- out-of-order execution causes foreign key violations, missing references, and incorrect state
- **Affected Options**: B (high), D (medium), C (medium for seed data conversion)
- **Evidence**: Contrarian Section 3 (four-layer ordering problem); Archaeologist Section 3a (layer loading order); Systems Thinker Loop B (Export-Import-Compile distributed ordering)
- **Mitigation**: Retain numeric file ordering convention (already in place). For JSON/YAML entity files representing seed data, ordering is less critical because entities are self-contained definitions processed through the deserializer which handles write ordering internally. For incremental operations, retain SQL format where ordering is inherent. Add CI validation that compiles the full PCD from scratch and verifies ordering.
- **Residual Risk**: Low for Options C and D. Medium for Option B where all operations become JSON/YAML documents.

---

### R-005: YAML-Specific Parsing Risks for PCD Data

- **Category**: Technical
- **Description**: YAML has well-documented pitfalls including implicit type coercion (the Norway problem where `NO` becomes `false`), sexagesimal number parsing (`22:22` becomes `1342`), indentation sensitivity causing silent semantic changes, and 63 different ways to represent multi-line strings. PCD data contains regex patterns with special characters, numeric scores, and entity names that could trigger these pitfalls.
- **Likelihood**: Medium (mitigable with strict parser configuration)
- **Impact**: Medium -- silent data corruption in entity definitions, particularly regex patterns
- **Affected Options**: B, C, D (any option using YAML)
- **Evidence**: Historian Section 6.1 (Norway problem, sexagesimal); Journalist Section 7 (seven YAML pitfall categories); Analogist (Home Assistant, Recyclarr silent parsing errors); Convergence 10 (4 personas flag YAML risks)
- **Mitigation**: Enforce YAML 1.2 parsing (not 1.1). Require explicit string quoting for values that could be misinterpreted. Use JSON Schema as a validation safety net after parsing. Consider JSON as the primary machine-readable format and YAML as an optional human-friendly alternative. For regex patterns specifically, require a designated string format (e.g., literal block scalars or explicit quoting).
- **Residual Risk**: Low with strict parser configuration. Residual risk from contributors using different editors or tools that default to YAML 1.1 behavior.

---

### R-006: Performance Degradation from Compilation Overhead

- **Category**: Technical
- **Description**: The current system executes raw SQL against an in-memory SQLite database via `this.db.exec(operation.sql)` -- a direct C-level operation with zero transformation overhead. A JSON/YAML-based system adds parsing (in JavaScript/TypeScript), transformation to SQL, and then execution. The PCD cache is rebuilt on every write operation, on startup, and on pull. Added latency directly impacts user experience.
- **Likelihood**: Low (compilation overhead is likely small relative to SQLite execution)
- **Impact**: Medium -- noticeable if compilation adds >500ms to cache rebuild, especially on startup with 44,000+ lines of data
- **Affected Options**: B (highest overhead -- all ops go through transformation), D (medium -- seed data transformation at import time), C (low -- limited transformation)
- **Evidence**: Negative Space Section 5 (performance considerations unmeasured); Systems Thinker Section 6.2 (complexity budget doubles)
- **Mitigation**: Benchmark the transformation pipeline before committing. In Option D, the JSON/YAML-to-SQL transformation happens at import time (when files are loaded into `pcd_ops`), not at every cache rebuild. Once stored as SQL in `pcd_ops`, the rebuild path remains unchanged. This amortizes the transformation cost.
- **Residual Risk**: Low if transformation is amortized at import time rather than repeated at every rebuild.

---

## Category 2: Architectural Risks

### R-007: Event-Sourced Architecture vs. Full-State Format Mismatch

- **Category**: Architectural
- **Description**: The PCD system is fundamentally event-sourced: SQL ops files are an append-only log of state changes, and the compiled cache is a materialized view. JSON/YAML naturally represents full state ("here is the current configuration"), not incremental deltas ("change X from A to B"). Adopting a full-state document model would require diffing against current state to determine mutations, fundamentally changing the architecture from append-only ops to state-based diffing. This loses auditability, bisectability, and the compositional properties of the current model.
- **Likelihood**: High (for Option B if full-state documents are adopted); Low (for Options C and D which preserve append-only semantics)
- **Impact**: Critical -- architectural model change affects every subsystem
- **Affected Options**: B (if designed as full-state documents), D (low risk if JSON/YAML represents operations, not state)
- **Evidence**: Negative Space Section 6.1 (rated "Critical" severity); Contrarian Section 4 (append-only vs. state-based diffing); Convergence 8 (6 personas agree event-sourced architecture must be preserved); Contradiction 6 (deepest architectural disagreement)
- **Mitigation**: Any JSON/YAML format must represent operations (deltas), not full entity state. For seed data (initial creation), full-state is acceptable because it IS the first operation. For incremental changes, preserve the operation-as-event model. The Futurist's hybrid explicitly preserves the append-only model internally.
- **Residual Risk**: Low if the design explicitly requires append-only semantics. Medium if future contributors pressure toward a simpler full-state model.

---

### R-008: Bidirectional Export Pipeline Complexity

- **Category**: Architectural
- **Description**: PCD is a distributed system where users export changes to a shared git repository and others import them. If the ingestion format changes, the export pipeline must also change. The current exporter generates SQL files from `pcd_ops` SQL content. Three problematic scenarios exist: (A) export stays SQL while ingestion becomes JSON/YAML (two formats in the repo); (B) export changes to JSON/YAML (requires SQL-to-JSON reverse transformation); (C) dual format support (doubles the parser/validator surface). All three options increase maintenance burden.
- **Likelihood**: High (the export pipeline MUST be addressed in any migration)
- **Impact**: High -- broken export pipeline means users cannot share changes, a complete workflow breakdown
- **Affected Options**: B (certain -- full rewrite required), D (high -- export must produce YAML/JSON for the repo), C (medium -- limited to exchange format)
- **Evidence**: Contrarian Section 5 (three export options, all problematic); Systems Thinker Section 3 (bidirectional format problem mapped in detail); Archaeologist Section 5c-5d (export pipeline generates SQL files, filenames hardcoded as `.sql`)
- **Mitigation**: In Option D, adopt Scenario A at the boundary: the ingestion layer accepts JSON/YAML, translates to SQL at import time, and stores SQL in `pcd_ops`. The export layer continues to work with SQL from `pcd_ops`. A separate conversion step generates JSON/YAML representations for the repository from the `desired_state` JSON metadata (which already captures operation intent). In Option C, export format does not change.
- **Residual Risk**: Medium. The SQL-to-JSON/YAML export conversion depends on whether `desired_state` metadata captures enough semantic information for faithful reconstruction. Edge cases in complex multi-table operations may lose fidelity.

---

### R-009: Loss of "Validation = Execution" Identity

- **Category**: Architectural
- **Description**: The current architecture has a unique strength: the stored format (SQL) IS the execution format. There is no translation boundary between what is stored in `pcd_ops` and what is executed against the SQLite cache. The SAVEPOINT-based validation runs the exact same SQL that will be executed in production. Introducing a JSON/YAML authoring layer creates a translation boundary where the stored format (JSON/YAML) differs from the execution format (SQL), introducing a category of bugs (incorrect translation) that does not currently exist.
- **Likelihood**: Medium (mitigated if SQL remains the internal storage format)
- **Impact**: High -- translation bugs are a new failure mode that affects every operation
- **Affected Options**: B (certain -- SQL execution identity is broken), D (medium -- depends on where translation occurs), C (low)
- **Evidence**: Systems Thinker Section 8.1 (five-way identity is an architectural strength); Contrarian Section 6.4 (compiler bugs silently corrupt PCD); Convergence 9 (5 personas identify underappreciated SQL strengths)
- **Mitigation**: In Options C and D, keep SQL as the internal storage format in `pcd_ops.sql`. Translation from JSON/YAML to SQL happens at ingestion time (when files are imported from the repository), not at execution time. Once stored as SQL, the validation and execution paths remain unchanged. This preserves the "Validation = Execution" identity for all operations after ingestion.
- **Residual Risk**: Low if SQL remains the internal storage and execution format. The translation risk is confined to the ingestion boundary, which can be validated by comparing JSON/YAML-derived SQL against reference SQL.

---

### R-010: Composability Loss -- Unknown Operation Shapes Rejected

- **Category**: Architectural
- **Description**: The current SQL format has unlimited composability: any SQL that targets PCD tables is a valid operation. Multi-table batches, hand-crafted data migrations, conditional logic with CTEs, and arbitrary SQL constructs all work without system changes. A JSON/YAML operation schema must predefine supported operation shapes. Unknown or novel operation patterns would be rejected unless the schema is extended.
- **Likelihood**: Medium (affects future extensibility more than current operations)
- **Impact**: Medium -- limits ability to perform ad-hoc data corrections and novel migrations
- **Affected Options**: B (certain), D (medium -- raw SQL escape hatch could be preserved)
- **Evidence**: Systems Thinker Section 5.1 (Composability emergent property); Analogist Prisma lesson (escape hatches are essential); Archaeologist Section 2f (CTE patterns, multi-table EXISTS checks)
- **Mitigation**: In Option D, preserve a raw SQL escape hatch for operations that cannot be expressed in JSON/YAML. The hybrid model explicitly supports SQL for incremental migrations. In Option C, SQL composability is fully retained for all incremental operations.
- **Residual Risk**: Low if a SQL escape hatch is maintained. The risk is cultural -- over time, contributors may lose familiarity with SQL operations if JSON/YAML becomes the norm.

---

## Category 3: Migration Risks

### R-011: Migration Scope Severely Underestimated

- **Category**: Migration
- **Description**: The Archaeologist estimates approximately 116 files and 34,000+ lines affected. The Systems Thinker estimates 3,000-5,000 lines of new code replacing approximately 1,500 lines. These estimates are for a full migration (Option B). Even a moderate hybrid (Option D) requires changes to the import pipeline, export pipeline, praxrr-db repository structure, and all 57 SQL ops files. The Futurist presents the migration as "incremental evolution," but this understates the engineering effort required.
- **Likelihood**: High (every migration in software history takes longer than estimated)
- **Impact**: High -- multi-month engineering investment diverts resources from feature development
- **Affected Options**: B (approximately 116 files, 34,000+ lines), D (subset, estimated 20-40 files), C (approximately 10-15 files), E (approximately 5-10 files)
- **Evidence**: Archaeologist Section 11 (quantified migration impact); Systems Thinker Section 6 (complexity budget analysis); Convergence 12 (4 personas converge on underestimation); Contradiction 12 (dramatic discrepancy in complexity estimates)
- **Mitigation**: Phase the migration strictly. Start with Option E (metadata layer, lowest risk). Progress to Option C (exchange format) only after proving value. Option D only after Option C is stable. Define explicit go/no-go criteria at each phase boundary. Budget for 2-3x the estimated effort.
- **Residual Risk**: Medium. Even phased, each phase has its own integration costs. The total cost of all phases exceeds the cost of any single phase due to compatibility shims during transitions.

---

### R-012: Converting 57 Existing SQL Ops Files

- **Category**: Migration
- **Description**: The PCD repository contains 57 SQL files totaling approximately 44,869 lines, including a 25,220-line initial seed. Converting these to JSON/YAML is not a simple format translation -- it requires parsing SQL INSERT/UPDATE/DELETE statements, resolving cross-entity references, handling SQL-specific constructs (WHERE NOT EXISTS, CTEs, multi-table JOINs), preserving value guards, and maintaining operation ordering. This is a non-trivial compiler project in itself.
- **Likelihood**: High (for Options B and D if existing ops must be converted)
- **Impact**: Medium -- one-time cost, but errors in conversion produce incorrect PCD state
- **Affected Options**: B (all 57 files must convert), D (seed file conversion most valuable; incremental ops could remain SQL), C (selective conversion only)
- **Evidence**: Negative Space Section 4.1-4.2 (migration of 44,869 lines); Archaeologist Section 2 (SQL feature catalog with difficulty ratings); Contrarian Section 4 (56 migration files with complex patterns)
- **Mitigation**: For Option D, convert only the initial seed file (`0.rosettarr.sql`) to JSON/YAML entity files. Keep the 56 incremental ops files as SQL -- they represent historical migrations that do not need to be re-represented. New ops going forward would be authored in JSON/YAML (for entity definitions) or SQL (for complex incremental mutations). This reduces the conversion from 57 files to 1 file.
- **Residual Risk**: Low if incremental ops remain SQL. The seed file conversion is tractable because it consists primarily of simple INSERT statements.

---

### R-013: Testing Burden -- Proving Identical Runtime State

- **Category**: Migration
- **Description**: Any format migration requires proving that the new format produces exactly the same compiled PCD state as the current SQL. This means compiling from SQL and from JSON/YAML, then comparing every table, row, and column between the two resulting databases. This must be done for the initial seed AND for every incremental migration applied in sequence. The testing matrix roughly triples for any component that participates in the translation.
- **Likelihood**: High (testing is essential and cannot be skipped)
- **Impact**: Medium -- significant effort, but bounded and automatable
- **Affected Options**: B (full test matrix), D (reduced -- only converted entities need testing), C (minimal)
- **Evidence**: Negative Space Section 4.3 (testing burden scoped); Systems Thinker Section 7 (test matrix triples); Contrarian Section 6.4 (SQL generation edge cases)
- **Mitigation**: Build an automated equivalence test that compiles the PCD from SQL ops into a reference SQLite database, compiles from JSON/YAML through the new pipeline into a test database, and performs a row-by-row comparison. Run this on every CI build. For the seed file specifically, this is a one-time validation effort.
- **Residual Risk**: Low once the automated test harness is built. Ongoing risk from new operations that exercise untested code paths in the translation layer.

---

### R-014: Backwards Compatibility During Transition

- **Category**: Migration
- **Description**: The PCD repository (`praxrr-db`) is distributed to users. If the format changes, there must be a migration path. Old Praxrr versions must continue to work with existing SQL repos. New versions must handle both formats during a transition period. The import pipeline, export pipeline, compiler, and cache builder all need dual-format support, creating a long-lived compatibility shim.
- **Likelihood**: High (backward compatibility is required for any distributed format change)
- **Impact**: Medium -- compatibility code increases maintenance burden during transition
- **Affected Options**: B (long transition with full dual-format support), D (medium transition), C (minimal -- SQL remains primary)
- **Evidence**: Systems Thinker Section 1.4 (import pipeline bifurcation); Historian Section 4.1 (Docker Compose format versioning confusion); Negative Space Section 4.4 (backwards compatibility during transition)
- **Mitigation**: Use the `pcd.json` manifest to indicate format version. Support both formats during transition. Set a clear deprecation timeline for the old format (e.g., 2 major versions). For Option C, the "exchange format" is additive -- existing SQL ingestion continues to work, JSON/YAML is an additional input path.
- **Residual Risk**: Medium during the transition period. Low after deprecation of the old format.

---

## Category 4: Ecosystem Risks

### R-015: TRaSH-Guides Alignment Is Superficial

- **Category**: Ecosystem
- **Description**: TRaSH-Guides alignment is frequently cited as a primary benefit of migration, but the structural differences between TRaSH JSON and Praxrr's PCD schema are significant. The Contrarian identified five specific divergences: (1) TRaSH inlines regex patterns while Praxrr shares them as first-class entities; (2) TRaSH embeds scores in CFs while Praxrr stores them relationally per-profile; (3) TRaSH uses separate directories per Arr while Praxrr uses `arr_type` scoping; (4) TRaSH has no equivalent for multi-table quality profiles; (5) TRaSH has no equivalent for Arr-specific media management settings. Even with JSON/YAML adoption, Praxrr's format would look substantially different from TRaSH's.
- **Likelihood**: High (structural differences are concrete and verified)
- **Impact**: Medium -- reduces the perceived benefit of migration, but does not create a new problem
- **Affected Options**: B, C, D (any option motivated by TRaSH alignment)
- **Evidence**: Contrarian Section 7 (five structural differences); Convergence 5 (6 personas agree TRaSH import should be an adapter); Contradiction 3 (alignment is real but limited)
- **Mitigation**: Decouple TRaSH interoperability from the format migration decision. Build a one-way TRaSH-JSON-to-PCD import adapter regardless of format choice. This adapter can work with either SQL or JSON/YAML internal format. Evaluate the format migration on its own merits (contributor experience, API distribution, documentation generation) without counting TRaSH alignment as a primary benefit.
- **Residual Risk**: Low. The adapter approach achieves interoperability without format coupling.

---

### R-016: TRaSH-Guides Format Instability Creates Coupling Risk

- **Category**: Ecosystem
- **Description**: TRaSH-Guides made significant breaking changes in February 2026, affecting CF group semantics and quality profile ordering. Configarr needed a `compatibilityTrashGuide20260219Enabled` flag. If Praxrr's format or import pipeline is tightly coupled to TRaSH's JSON structure, every TRaSH breaking change requires a Praxrr update.
- **Likelihood**: Medium (TRaSH has demonstrated willingness to make breaking changes)
- **Impact**: Medium -- maintenance burden for ongoing adaptation
- **Affected Options**: Any option that includes a TRaSH import adapter
- **Evidence**: Historian Section 3.1 (February 2026 changes); Journalist Section 1 (Configarr compatibility flag); Futurist Section 1 (TRaSH format evolves independently)
- **Mitigation**: Design the TRaSH import adapter with a versioned mapping layer. Isolate TRaSH-specific format knowledge in a single adapter module. Use the `trash_id` as the stable foreign key for entity correlation. Do not embed TRaSH-specific concepts in core PCD data structures.
- **Residual Risk**: Low -- adapter maintenance is bounded and isolated.

---

### R-017: Ecosystem Misalignment Limits External Adoption

- **Category**: Ecosystem
- **Description**: Praxrr is the only tool in the Arr ecosystem that uses SQL for both upstream data and user configuration. Every other tool uses JSON for data interchange and YAML for user configuration. This creates friction for potential third-party integrations, API consumers, and community tools that expect structured data formats. If the ecosystem converges further on JSON/YAML (which the trajectory suggests), the friction increases over time.
- **Likelihood**: Medium (depends on whether Praxrr pursues external ecosystem integration)
- **Impact**: Medium -- limits community growth and third-party tool development
- **Affected Options**: A (status quo -- this risk materializes)
- **Evidence**: Historian Section 3.3 (ecosystem comparison table); Journalist ecosystem comparison matrix; Futurist Section 8 (ecosystem convergence analysis); Contradiction 7 (tooling vs. format change resolves on strategic direction)
- **Mitigation**: Even under Option A (status quo), add a JSON API distribution layer that serves PCD entity data in JSON format from the compiled cache. This provides ecosystem-compatible output without changing the authoring format. Options C, D, and E all reduce this risk to varying degrees.
- **Residual Risk**: Low if a JSON API layer is added. The remaining risk is contributor perception -- potential contributors may be discouraged by SQL ops even if they never need to write them.

---

## Category 5: Operational Risks

### R-018: Dual-Format Maintenance Burden

- **Category**: Operational
- **Description**: Every system that uses multiple formats reports challenges: keeping formats in sync, confusion about which format to use, dual maintenance burden, and edge cases where one format cannot express what the other can. The Analogist documents this across dbt (SQL+YAML), Recyclarr (JSON+YAML), Terraform (HCL+JSON), and Home Assistant (YAML+UI). If Praxrr adopts a hybrid model, this burden is real and ongoing.
- **Likelihood**: High (for any hybrid option during transition); Medium (for a stable hybrid with clear format boundaries)
- **Impact**: Medium -- increased maintenance cost, contributor confusion
- **Affected Options**: B (during transition), C (ongoing -- two format zones), D (ongoing -- JSON/YAML authoring + SQL runtime)
- **Evidence**: Analogist Pattern 4 (hybrid maintenance burden across 4 systems); Systems Thinker Section 7 (two-language problem); Contradiction 4 (four incompatible hybrid proposals)
- **Mitigation**: Draw clear, documented boundaries between formats. In Option D: "Schema = SQL DDL. Entity definitions = YAML. Incremental migrations = SQL. Runtime cache = SQL." Make the boundary a design invariant, not a sliding scale. Minimize the overlap zone where both formats could be used.
- **Residual Risk**: Medium. Hybrid systems inherently have higher cognitive overhead than single-format systems. Clear documentation and tooling reduce but do not eliminate this.

---

### R-019: Loss of Universal SQL Tooling for Validation and Debugging

- **Category**: Operational
- **Description**: SQL ops files can be validated by running them in any SQLite client (`sqlite3 :memory: < schema.sql < ops.sql`). Developers can copy any ops file and run it locally to see exactly what it does. This universal tooling compatibility is lost when the authoring format becomes JSON/YAML, because JSON/YAML ops files require Praxrr-specific tooling to validate and execute.
- **Likelihood**: High (inherent to any format change away from SQL)
- **Impact**: Low -- affects development and debugging workflows but does not affect production
- **Affected Options**: B (loss is complete), D (partial -- SQL ops still exist internally), C (minimal -- SQL remains primary)
- **Evidence**: Systems Thinker Section 5.1 (Universal Tooling emergent property); Contrarian Section 8.3 (debugging regression); Convergence 9 (SQL has underappreciated strengths)
- **Mitigation**: Build a CLI tool that compiles JSON/YAML entities to SQL and validates them against the schema, providing a Praxrr-specific equivalent to the `sqlite3` workflow. In Option D, generated SQL ops are still available for inspection and can be run in standard SQLite tools.
- **Residual Risk**: Low -- the CLI tool provides equivalent functionality, though with higher tooling dependency.

---

### R-020: Git Diff and Code Review Degradation for Complex Operations

- **Category**: Operational
- **Description**: SQL ops diffs are clear for incremental operations: each operation is a small, self-contained change with BEGIN/END markers. JSON/YAML diffs for deeply nested documents are harder to review. Changing one field in a complex entity (e.g., a custom format with 10 conditions) could result in a large diff that obscures the actual change. Two contributors changing different fields of the same entity produce Git merge conflicts in JSON/YAML (same file modified) but compose cleanly in SQL ops (separate operations).
- **Likelihood**: Medium (depends on entity complexity and contribution patterns)
- **Impact**: Low -- affects code review experience but does not affect correctness
- **Affected Options**: B (worst -- all operations become document diffs), D (mixed -- entity definition diffs are document-level, incremental ops remain SQL), C (minimal)
- **Evidence**: Contrarian Section 8.3 (git diff readability); Negative Space Section 6.4 (incremental update problem, merge conflicts); Contradiction 13 (SQL vs JSON/YAML diff readability)
- **Mitigation**: For entity definition files, use one-file-per-entity structure to minimize diff scope. For incremental operations, retain SQL to preserve the self-contained operation diff format. Use structured diff tools (dyff, graphtage) for JSON/YAML review when needed.
- **Residual Risk**: Low -- the one-file-per-entity pattern and SQL retention for incremental ops addresses the worst cases.

---

### R-021: Hand-Written SQL Generation Code Must Be Rewritten

- **Category**: Operational
- **Description**: The custom format conditions update handler (`entities/customFormats/conditions/update.ts`) contains approximately 200 lines of hand-crafted SQL string generation for 10 condition types, bypassing Kysely entirely. Multiple entity handlers similarly construct raw SQL strings. These must all be updated to produce the new format or to continue working alongside it.
- **Likelihood**: High (these files must change in any non-trivial migration)
- **Impact**: Medium -- bounded engineering work, but the raw SQL patterns are complex and error-prone to rewrite
- **Affected Options**: B (all handlers must change), D (handlers continue producing SQL through Kysely/raw-SQL; no change needed if SQL remains internal), C (no change)
- **Evidence**: Archaeologist Section 2k, 5e (hand-written SQL in conditions handler); Archaeologist Section 10c (dual write path complexity)
- **Mitigation**: In Options C and D, the entity CRUD handlers continue to produce SQL through the existing Kysely and raw-SQL paths. The JSON/YAML ingestion layer is a separate input path that feeds into the same downstream pipeline. No handler rewrite is needed unless Option B (full migration) is chosen.
- **Residual Risk**: Low for Options C and D. High for Option B where all handlers must be modified.

---

## Category 6: Status Quo Risks (NOT Changing)

### R-022: Contributor Pool Remains Artificially Small

- **Category**: Ecosystem (Status Quo)
- **Description**: The intersection of "media server enthusiasts who understand quality profiles" and "people who can write SQL operations with value guards and foreign key awareness" is small. If community contribution to PCD databases is a strategic goal, the SQL authoring barrier limits the contributor pool. The Futurist estimates a potential 5-10x expansion with JSON/YAML authoring.
- **Likelihood**: Medium (depends on whether community contribution is a strategic priority)
- **Impact**: Medium -- slower PCD database growth, higher maintainer burden
- **Affected Options**: A (status quo -- this risk persists)
- **Evidence**: Futurist Section 2 (contributor barrier analysis); Historian Section 1.1 (Ansible's YAML accessibility drove adoption); Contradiction 5 (who is the actual user?)
- **Mitigation**: Under Option A, invest in the web UI as the primary contribution path (which already exists and is format-invisible). Add guided contribution workflows, PR templates, and documentation generation. Under Options C and D, JSON/YAML entity authoring lowers the barrier for new entity contributions while retaining SQL for complex operations.
- **Residual Risk**: Medium. The UI mitigates the barrier for most use cases, but file-based contributions to the shared PCD repository remain SQL-only under Option A.

---

### R-023: API Distribution and Third-Party Consumption Blocked

- **Category**: Ecosystem (Status Quo)
- **Description**: The current SQL ops format requires a SQLite execution environment to consume PCD data. Third-party tools, LLM agents, and API consumers cannot easily read or use PCD entity definitions without running the full compilation pipeline. This limits Praxrr's potential as an ecosystem hub and prevents programmatic access to PCD data.
- **Likelihood**: Medium (relevant if external consumption is a goal)
- **Impact**: Medium -- missed opportunity for ecosystem positioning
- **Affected Options**: A (status quo -- this risk persists)
- **Evidence**: Futurist Section 3 (API-first distribution vision); Futurist Section 6 (AI/LLM integration opportunities); Historian Section 5 (compile-time transformation enables multi-target output)
- **Mitigation**: Even under Option A, add a JSON API layer that serves compiled PCD entity data from the in-memory cache. This provides machine-readable access without changing the authoring format. The `serialize.ts` portable entity serialization already produces the JSON needed.
- **Residual Risk**: Low if a JSON API layer is added. The remaining risk is that the API layer becomes a maintenance burden if the underlying PCD schema changes frequently.

---

### R-024: Documentation Generation Remains Manual

- **Category**: Operational (Status Quo)
- **Description**: The current SQL format does not lend itself to automatic documentation generation. Entity descriptions, scoring rationale, and condition explanations are either embedded in SQL comments or in the `desired_state` JSON metadata. There is no rendered, browsable documentation for PCD entities. This gap makes it harder for users to understand what their PCD configuration does.
- **Likelihood**: High (documentation gap exists today)
- **Impact**: Low-to-Medium -- affects user understanding and adoption, but not system correctness
- **Affected Options**: A (status quo -- this gap persists)
- **Evidence**: Futurist Section 4 (documentation generation pipeline); Negative Space Section 2.2 (documentation solvable without format change); Convergence 6 (docs generation is independent)
- **Mitigation**: Under any option, build an auto-generated documentation site from the compiled PCD cache. The compiled cache contains all entity data needed for rich documentation. This is achievable without a format migration (as the Negative Space persona argues). JSON/YAML adoption would make documentation generation slightly easier due to structured diff tools, but the core capability is format-independent.
- **Residual Risk**: Low -- documentation generation from the compiled cache is a bounded engineering task.

---

### R-025: Debt Accumulation in SQL Regex Parsing

- **Category**: Technical (Status Quo)
- **Description**: The override conflict resolution system (`overrideUtils.ts`) parses raw SQL strings using regex to extract rename mappings (`extractRenamesFromSql()`). This fragile SQL parsing is a maintenance liability that becomes harder to maintain as ops grow more complex. Under the status quo, this technical debt accumulates.
- **Likelihood**: Medium (the current regex parsing works but is brittle)
- **Impact**: Low -- affects maintainability, not correctness (unless a new SQL pattern breaks the regex)
- **Affected Options**: A (status quo -- debt accumulates)
- **Evidence**: Archaeologist Section 5b (SQL regex parsing in override resolution); Systems Thinker Loop D (Supersession loop operates on metadata, not SQL)
- **Mitigation**: Under Option A, refactor to use the structured `metadata` and `desired_state` JSON columns (which already capture operation intent) instead of parsing raw SQL. This eliminates the fragile regex parsing without changing the ops format. Under Options C and D, the JSON/YAML ingestion layer produces structured metadata natively.
- **Residual Risk**: Low -- metadata-based resolution is already partially implemented in the auto-align system.

---

## Risk Summary Matrix

| Risk ID | Category         | Description (Short)                    | Likelihood | Impact     | Worst Affected Option  |
| ------- | ---------------- | -------------------------------------- | ---------- | ---------- | ---------------------- |
| R-001   | Technical        | Value guard semantics loss             | High       | Critical   | B                      |
| R-002   | Technical        | Compiler introduces data corruption    | High       | Critical   | B                      |
| R-003   | Technical        | Relational constraint reimplementation | High       | High       | B                      |
| R-004   | Technical        | Operation ordering breaks              | Medium     | High       | B                      |
| R-005   | Technical        | YAML parsing pitfalls                  | Medium     | Medium     | B, C, D                |
| R-006   | Technical        | Performance degradation                | Low        | Medium     | B                      |
| R-007   | Architectural    | Event-sourced vs. full-state mismatch  | High       | Critical   | B                      |
| R-008   | Architectural    | Export pipeline complexity             | High       | High       | B, D                   |
| R-009   | Architectural    | Validation-execution identity loss     | Medium     | High       | B                      |
| R-010   | Architectural    | Composability loss                     | Medium     | Medium     | B                      |
| R-011   | Migration        | Scope underestimation                  | High       | High       | B                      |
| R-012   | Migration        | 57 ops file conversion                 | High       | Medium     | B                      |
| R-013   | Migration        | Testing burden for equivalence         | High       | Medium     | B, D                   |
| R-014   | Migration        | Backwards compatibility                | High       | Medium     | B, D                   |
| R-015   | Ecosystem        | TRaSH alignment is superficial         | High       | Medium     | B, C, D                |
| R-016   | Ecosystem        | TRaSH format instability               | Medium     | Medium     | All with TRaSH adapter |
| R-017   | Ecosystem        | Ecosystem misalignment (status quo)    | Medium     | Medium     | A                      |
| R-018   | Operational      | Dual-format maintenance burden         | High       | Medium     | B, C, D                |
| R-019   | Operational      | Loss of universal SQL tooling          | High       | Low        | B                      |
| R-020   | Operational      | Git diff degradation                   | Medium     | Low        | B, D                   |
| R-021   | Operational      | Hand-written SQL rewrite               | High       | Medium     | B                      |
| R-022   | Ecosystem (SQ)   | Small contributor pool                 | Medium     | Medium     | A                      |
| R-023   | Ecosystem (SQ)   | API distribution blocked               | Medium     | Medium     | A                      |
| R-024   | Operational (SQ) | Documentation gap                      | High       | Low-Medium | A                      |
| R-025   | Technical (SQ)   | SQL regex parsing debt                 | Medium     | Low        | A                      |

---

## Risk Profile by Strategic Option

### Option A: Status Quo (Keep SQL, Invest in Tooling)

**Critical risks**: None
**High risks**: None
**Active risks**: R-017, R-022, R-023, R-024, R-025 (all ecosystem/operational gaps)
**Risk profile**: Lowest overall risk. The accumulated status quo risks (R-022 through R-025) are real but individually manageable through targeted tooling investments (JSON API layer, documentation generator, metadata-based conflict resolution). The strategic risk is stagnation -- if community contribution and ecosystem integration become priorities, Option A requires revisiting.

### Option B: Full Migration (Replace SQL with JSON/YAML)

**Critical risks**: R-001, R-002, R-007
**High risks**: R-003, R-004, R-008, R-009, R-011, R-012, R-013, R-014, R-018, R-019, R-021
**Active risks**: Nearly all migration and technical risks
**Risk profile**: Highest overall risk. Three critical risks (value guards, compiler corruption, architecture mismatch) each have the potential to derail the project. The migration scope (116 files, 34,000+ lines) is the largest engineering investment with the most uncertain outcome. No persona recommends this option unqualified.

### Option C: Conservative Hybrid (JSON/YAML for Seed/Exchange, SQL for Ops)

**Critical risks**: None
**High risks**: None (R-001 and R-007 are avoided because SQL is retained for incremental ops)
**Medium risks**: R-005, R-012 (limited to seed conversion), R-015, R-018
**Active risks**: Limited set of manageable risks
**Risk profile**: Low-to-medium overall risk. The highest risks from full migration are avoided because SQL is retained for all incremental operations. The main cost is the seed file conversion (R-012) and ongoing dual-format maintenance (R-018), both of which are bounded.

### Option D: Moderate Hybrid (JSON/YAML Authoring, SQL Compilation)

**Critical risks**: None (if value guards are generated at compile time, not authored in JSON/YAML)
**High risks**: R-002 (mitigated by using existing deserialize pipeline), R-008 (export pipeline must adapt)
**Medium risks**: R-005, R-009, R-011 (reduced scope), R-013, R-014, R-018, R-020
**Active risks**: Moderate set of risks, all with identified mitigations
**Risk profile**: Medium overall risk. The key risk is the export pipeline (R-008), which has no clean solution. The compiler risk (R-002) is substantially mitigated by routing through the existing `deserialize.ts` pipeline. This option delivers the most strategic value (contributor access, API distribution, documentation) at manageable risk if phased carefully.

### Option E: Minimal Hybrid (SQL Stays, Add JSON/YAML Metadata Layer)

**Critical risks**: None
**High risks**: None
**Medium risks**: R-018 (mild -- metadata layer is additive)
**Active risks**: Minimal
**Risk profile**: Lowest migration risk. Addresses R-024 (documentation gap) directly. Does not address R-022 (contributor pool) or R-023 (API distribution) directly, but can be combined with a JSON API layer from the compiled cache to address R-023. Best as a Phase 1 that proves value before progressing.

---

## Recommended Risk Mitigation Sequence

1. **Immediate (any option)**: Build automated PCD equivalence testing infrastructure. Add JSON API layer serving from compiled cache. These reduce status quo risks and provide the testing foundation for any future migration.

2. **Phase 1**: Implement Option E (metadata layer). Lowest risk, proves the multi-format tooling, addresses documentation gap.

3. **Phase 2**: Implement Option C (JSON/YAML exchange format for seed data + TRaSH import adapter). Convert the initial seed file. Keep all incremental ops as SQL. This tests the ingestion pipeline with real data at bounded risk.

4. **Phase 3 (conditional)**: Evaluate whether to progress to Option D based on Phase 2 outcomes. The go/no-go criteria should be: (a) the ingestion pipeline handles all seed data patterns correctly, (b) the export pipeline has a viable design for JSON/YAML output, (c) community contribution demand justifies the additional complexity.

5. **Never recommended**: Option B (full migration) without completing Phases 1-3. The critical risks (R-001, R-002, R-007) are too severe for a single-phase migration.

---

## Key Decision Dependencies

| Decision                               | Required Information                                                  | Resolution Path                                                       |
| -------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Is migration worth the effort?         | Contributor demographics and pain point data                          | Survey potential contributors; measure UI vs. file-based change ratio |
| Which hybrid model?                    | Strategic priority: internal quality vs. external growth              | Product strategy decision by maintainer(s)                            |
| Can value guards work in JSON/YAML?    | Prototype of complex ops in new format                                | Build prototype with op 42 (249 operations)                           |
| Is `deserialize.ts` extensible enough? | Audit of current pipeline coverage                                    | Map all SQL patterns in ops files against deserializer capabilities   |
| Is export pipeline tractable?          | Whether `desired_state` JSON supports faithful SQL-to-JSON conversion | Analyze `desired_state` completeness for 5 most complex ops files     |
| Why was YAML originally abandoned?     | Institutional knowledge                                               | Ask original maintainer(s)                                            |
