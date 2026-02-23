### Executive Summary

Recommend organizing the work into three tight phases so serialization/serializer prep, converter
implementation, and parity/integration verification can all be tackled in parallel-plan-friendly
batches. Each phase pairs clear responsibilities with handoff points, keeping shared assets like
serializers and YAML formatting deterministic before downstream tooling or tests rely on them. This
structure lets reviewers chunk work per phase while ensuring dependencies (e.g., shared
slug/serializer helpers) are resolved before conversion or parity tasks begin.

### Recommended Phase Structure

#### Phase 1: Serialization Foundation

- purpose: stabilize the portable boundary (serializers, slug/YAML helpers, enumeration queries) so
  downstream tooling can reuse shared logic without duplicating mappings.
- suggested tasks: extract `serializeLidarrNaming`, move slug logic into `pcd/migration/slug.ts`,
  add deterministic YAML formatting helper, add entity name enumeration helpers, wire up any missing
  portable metadata (migration block, stable keys).
- parallelization notes: serializer + slug extraction can run alongside YAML formatter and
  enumeration-query work; they touch different files but share the portable contract, so coordinate
  via shared spec doc/PR.

#### Phase 2: Converter Implementation

- purpose: convert the fully compiled SQL cache into deterministic YAML entity files, emitting one
  file per entity and covering all 14 entity types plus ordering metadata.
- suggested tasks: build `pcd/migration/converter.ts` using Phase 1 helpers, add CLI entry
  `scripts/convert-pcd-entities.ts`, add `deno task convert:pcd-entities`, code unit tests for
  converter utilities (slug/ordering/formatting), add CLI flag parsing (pcd path/output
  dir/format/entity filter/strict/dry run).
- dependencies: Phase 2 depends on Phase 1 artifacts (serializers, slug, formatter); converter tests
  can start once serializer helpers exist, while CLI wiring waits for task alias and converter
  exports.

#### Phase 3: Parity & Integration Verification

- purpose: prove round-trip parity and validate the hybrid import path remains stable when the new
  YAML files become canonical.
- suggested tasks: build `pcd/migration/parityVerifier.ts` that spins up two caches (SQL vs
  entities), compares the 37 tables, surfaces diffs, add `scripts/verify-pcd-parity.ts`, add
  `deno task verify:pcd-parity`, wire CI/test harness to run parity check, extend integration tests
  verifying reader/import pipeline accepts generated YAML.
- integration focus: tie converter output to parity verifier via shared directory layout, ensure CLI
  can run both conversion and verification consecutively (optionally from a single script), and run
  import-base pipeline against YAML output to prove hybrid ingestion still works.

### Task Granularity Guidance

- appropriate task sizes: keep tasks focused (e.g., "implement slug helper" or "add YAML formatter
  options") so they can be owned by one engineer; multi-file conversions (converter/parity) can be
  split into enumeration, serialization, formatting, and CLI wiring subtasks.
- tasks to split: converter implementation into "enumeration + serialization", "file writing + slug
  collision handling", and "CLI/task integration + dry-run/flags"; parity verifier into "cache
  snapshot utility", "row comparison + report", and "CLI integration + CI hook".
- tasks to combine: serializer additions and slug helper extraction can be bundled into a single
  "serializer portability cleanup" task since they work on the same portable contracts; YAML
  formatter and ordering helpers can be done together because they both shape deterministic output.

### Dependency Analysis

#### Independent Tasks

- Serializer refactors (e.g., `serializeLidarrNaming`, slug helper) because they only touch portable
  contracts.
- YAML formatter and slug collision handling (once serializer helpers exist) since they can be
  proved via unit tests without waiting on converter CLI.
- Parity table comparison report generation can be implemented ahead of wiring the CLI once the
  cache snapshot helpers exist.

#### Sequential Tasks

- Converter CLI + task alias depends on serializer + slug + formatter helpers from Phase 1.
- Parity verifier depends on converter output structure (directories/filenames) and on standalone
  cache builders that mirror the converter’s expectations.
- Integration tests that run `convert` + `verify` sequentially should wait until CLI tasks are
  stable.

#### Potential Bottlenecks

- Shared serializer/portable logic (`serialize.ts`, portable types) will block both converter and
  parity tasks; keep changes minimal and use feature branches to avoid conflicts.
- Schema/table definitions (`packages/praxrr-schema/ops/`) are referenced by both converter and
  verifier; coordinate on versioned copies to avoid drift.
- Services that build caches (`PCDCache`/compiler) are reused by conversion, parity, and existing
  APIs; ensure new standalone builders reuse helper code to prevent divergence.

### Suggested Task Template

- title format: `pcd-data-migration-2: <short descriptor>` (e.g.,
  `pcd-data-migration-2: add lidarr serializer helper`).
- dependency annotation format: include a "Depends on:" line in the task description listing
  required phase artifacts (e.g., "Depends on: serializer helper PR, slug helper branch").
- instruction completeness checklist: `[ ] purpose clarified`, `[ ] files/modules listed`,
  `[ ] blockers/dependencies noted`, `[ ] verification steps described (tests/commands)`.
