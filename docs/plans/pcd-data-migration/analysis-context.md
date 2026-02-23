### Executive Summary

- `pcd-data-migration` adds a hybrid JSON/YAML authoring and exchange layer on top of Praxrr’s
  existing SQL-first PCD pipeline.
- The implementation must reuse `PCDManager`, writer/compiler/cache, and portable API paths so sync
  behavior and guard semantics stay unchanged.
- Value-guard correctness and `pcd_op_history` observability are release gates and should drive
  phase sequencing.

### Architecture Context

- System Structure: `PCDManager` coordinates link/sync/import/compile; writers and queries persist
  ops in `pcd_ops`; `PCDCache` and compiler execute layers and record outcomes.
- Data Flow: Link/pull -> import base ops -> validate/write operations -> load layered ops ->
  compile cache -> expose entities through portable serialize/deserialize and API import/export.
- Integration Points: Extend lifecycle orchestration and base import logic to ingest hybrid entities
  while preserving existing auth, compilation, and sync triggers.

### Critical Files Reference

- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: lifecycle entrypoint for
  link/sync/import/compile/sync-trigger flows.
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: current base-op ingestion path
  where hybrid source detection will hook.
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: validated op persistence and
  recompilation path.
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: guard/conflict execution and
  op-history recording.
- `/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: portable export mapping.
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: portable import mapping.
- `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: portable import HTTP entrypoint.
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: portable export HTTP entrypoint.

### Patterns to Follow

- Pattern: PCD lifecycle orchestration through `PCDManager`; do not bypass existing compile/sync
  sequencing.
- Pattern: Layered compile order (schema/base/tweaks/user) via `loadOps` and cache build.
- Pattern: Validated operation writes via `writeOperation` to keep metadata/hash/guard behavior
  aligned.
- Pattern: Portable schema bridge via `portable.ts` + `serialize`/`deserialize` for hybrid format
  conversion.

### Cross-Cutting Concerns

- Security: keep credential handling within encrypted credential storage and keyring utilities.
- Performance: large op replay/caches require bounded verification and sync-trigger control.
- Testing: prioritize integration tests on `pcd_ops`/`pcd_op_history` and cache parity.

### Parallelization Opportunities

- Independent work areas: portable contract and schema updates; migration runbook updates; tooling
  for entity conversion and parity checks.
- Coordination hotspots: shared portable contract, cache/value-guard behavior, and import path
  touching `importBaseOps` + writer.

### Implementation Constraints

- SQL DDL remains SQL-first.
- Phase 3 value-guard prototype is a go/no-go gate.
- Portable contract changes must stay in lockstep with OpenAPI docs/schemas.
- Existing env/config and auth behavior must be preserved.

### Planning Recommendations

- Phase 1: finalize portable schema and serialization/deserialization contract changes.
- Phase 2: wire hybrid ingestion/export through manager/importer/writer/cache pipeline.
- Phase 3: verify guard behavior, sync/job effects, and rollout/rollback documentation.
