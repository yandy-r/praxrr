### Executive Summary

- Build a deterministic converter that compiles the existing SQL-only PCD cache into the reader’s
  portable YAML entity layout, then verify parity by re-importing those files to prove no semantic
  drift as described in `docs/plans/pcd-data-migration-2/feature-spec.md`.
- Leverage the existing serializer/reader/deserializer stack (`serialize.ts`, `reader.ts`,
  `deserialize.ts`) and seed-built cache/compiler (`pcdManager`, `PCDCache`, `compiler.ts`) so
  runtime behavior stays untouched while conversion and parity tooling live under `pcd/migration`.
- Deliver CLI automation (`deno task convert:pcd-entities`, `deno task verify:pcd-parity`) plus
  slug/YAML helpers, serializers, and tests so maintainers can rerun the migration with confidence
  and CI can guard against regressions.

### Architecture Context

- System Structure: The converter enumerates every entity type from the compiled cache, reuses
  `serialize*` helpers (plus the missing `serializeLidarrNaming` gap), formats each portable payload
  via deterministic YAML, and writes files into the directories `reader.ts` expects
  (`ENTITY_FORMAT_BY_DIR`/`ENTITY_FORMAT_BY_MEDIA_DIR`). Parity verification uses standalone cache
  builders (schema + SQL vs. schema + YAML) to compare 37 entity tables row-for-row.
- Data Flow: SQL ops -> compile -> cache -> serializers -> YAML files -> `reader.ts` ->
  deserializers -> compile -> parity diff. The migration metadata block documents provenance, and
  slug collisions append suffixes to keep filenames unique while preserving stable keys.
- Integration Points: Converter output plugs into the existing hybrid `importBaseOps` lifecycle via
  `reader.ts`/`validatePortableData`, while `serialize.ts`/`deserialize.ts` remain the shared
  contract boundaries. CLI scripts live outside the runtime but depend on the same schema files
  (`packages/praxrr-schema/ops/`) and database tables (`packages/praxrr-db/ops/0.rosettarr.sql`).

### Critical Files Reference

- `docs/plans/pcd-data-migration-2/feature-spec.md`: Defines scope, UX, CLI UX, YAML formatting
  rules, and phased task breakdown; it is the authoritative requirements doc for conversion, parity,
  CLI UX, and success criteria.
- `docs/plans/pcd-data-migration-2/research-technical.md`: Captures detailed converter/parity
  architecture, entity ordering, slug strategy, snapshot/comparison tables, and open questions that
  drive script/package design.
- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: Source-of-truth serializers; needs
  new `serializeLidarrNaming` and any shared slug helpers used by the converter/export route
  refactor.
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: Reader validation/ordering
  expectations dictate directory layout, known non-entity files, and entity candidates consumed by
  parity verification.
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: Hybrid ingestion workflow where the
  generated YAML base layer must play nicely via existing conflict guards and entity ordering.

### Patterns to Follow

- Lifecycle Orchestrator: Keep conversion/parity tooling decoupled from runtime `PCDManager` but
  reuse its cache lifecycle (`packages/praxrr-app/src/lib/server/pcd/core/manager.ts`) for
  reference.
- Repository Query Modules: Avoid ad-hoc SQL in scripts; reuse query modules for cache enumeration
  where feasible (`packages/praxrr-app/src/lib/server/db/queries/*`).
- Portable Serialization Boundary: Lean on the shared `serialize.ts`/`deserialize.ts` contracts (and
  `validate.ts`) instead of re-implementing field mappings to ensure parity.
- Reader-Validated Migration Ingestion: Follow the `reader.ts` validation flow when generating
  files: paths, metadata blocks, and entity order must match its expectations.

### Cross-Cutting Concerns

- Testing: Parity verification must snapshot 37 tables while ignoring auto-generated columns (`id`,
  timestamps). Unit tests for converter, slug, and parity helpers (plus integration tests that
  compile SQL and YAML caches) must prove determinism and round-trip equality.
- Performance/Determinism: Converter must sort lists, fix key order, and emit deterministic YAML
  (nulls, quoting, array styles) so repeated runs produce byte-identical output; YAML formatting
  must scale to ~550 files within ~10 seconds.
- Security: Tooling only reads local SQL and writes local files; reliance on the already-approved
  `yaml` dependency keeps the attack surface unchanged.

### Parallelization Opportunities

- Serializer cleanup (move `serializeLidarrNaming`, shared slug helpers) can proceed independently
  from CLI script creation.
- YAML formatting and slug utilities (deterministic output + collision handling) are reusable by
  both converter and parity tooling and can be built in parallel.
- CLI scripting (`scripts/convert-pcd-entities.ts` and `scripts/verify-pcd-parity.ts`) bundle
  dependencies but can be developed alongside converter/parity core logic.
- Tests (converter/parity/slug) and `deno.json` task wiring can be tackled after the core logic of
  each component is stable.

### Implementation Constraints

- Idempotency requirement: converter output must be byte-identical on reruns, so slug collisions,
  YAML ordering, and serializer determinism are non-optional.
- Directory structure: output must match `reader.ts`’s `ENTITY_FORMAT_BY_*` maps with media- and
  metadata-scoped subfolders plus `migration` metadata per file.
- Parity rule: SQL compile must compare against a pure entity-file compile for the 37 tables; the
  verifier must strip auto columns and normalize booleans before diffing, failing `--strict` runs on
  mismatches.
- CLI contract: `--pcd-path` required, optional `--output-dir`, `--format` (yaml/json),
  `--entity-type`, `--strict`, `--dry-run`, and `--verbose` modes per UX spec.

### Planning Recommendations

1. Phase A (serialization/slug consolidation + schema queries) lays the foundation: complete shared
   serializers, slug utility, and enumeration helpers before touching scripts.
2. Phase B (converter implementation and formatter + tests) depends on Phase A; build deterministic
   YAML formatting, entity enumeration, slug collision handling, and CLI wiring/new `deno` tasks.
3. Phase C (parity verification tooling and tests) sits atop Phases A/B: standalone cache builders,
   diff algorithms, and CLI integration while also capturing tables and snapshot normalization
   rules.
4. Later phases (non-entity data, reader integration, documentation) can branch off once
   converter/parity are stable; document `tags` handling and confirm no orphan-tag requirements
   surfaced.
5. Coordinate tasks where shared utilities are needed (e.g., serializer moves impact both export
   route and converter), but unit tests and CLI scripts can proceed independently once interfaces
   stabilize.
