### Executive Summary

- The codebase already has a strict orchestration and validation path for PCD operations, so
  migration logic should integrate into existing modules instead of introducing parallel pipelines.
- Hybrid format handling is best implemented by extending portable serialization/deserialization and
  importing generated SQL through current writer/cache flows.
- Non-trivial risks are concentrated in value-guard fidelity, operation ordering, and contract drift
  between runtime types and OpenAPI docs.

### Related Components

- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts:35`: link/sync orchestration and sync
  trigger dispatch.
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts:51`: base-op file import and
  metadata/hash handling.
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:297`: validated op persistence and
  recompile.
- `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts:31`: layered operation loading order.
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts:37`: compilation, conflict handling,
  and op history recording.
- `/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts:33`: entity -> portable export
  mapping.
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts:57`: portable payload ->
  operation mapping.
- `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts:30`: portable import API validation
  and dispatch.
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts:17`: portable export API response
  path.

### Implementation Patterns

**Orchestrated Lifecycle Gating**: Keep migration hooks in `PCDManager` so link/import/compile/sync
operations remain centralized.

- Example: `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts:35`
- Apply to: manager wiring, migration activation controls

**Layered Compile Pipeline**: Preserve schema/base/tweaks/user operation ordering and compile
semantics.

- Example: `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts:31`
- Apply to: op generation/order resolution and import sequencing

**Validated Write Path**: Route generated SQL through `writeOperation` to keep metadata/hash/guard
behavior intact.

- Example: `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts:297`
- Apply to: migration ingestion, history consistency, conflict tracking

**Portable Bridge Reuse**: Extend portable type/schema + serializer/deserializer rather than adding
new entity models.

- Example: `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts:57`
- Apply to: API contract evolution and hybrid JSON/YAML conversion

### Integration Points

#### Files to Create

- `/packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: parse `entities/*.{json,yaml}` and
  route to deserialize/write pipeline.
- `/packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`: reusable guard verification
  utilities for migration gating.

#### Files to Modify

- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: detect and process hybrid entity
  sources.
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: expose reusable hooks for
  migration-generated op writes.
- `/packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`: enforce deterministic compile
  behavior for staged migration checks.
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: support any new portable
  metadata fields.
- `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: support version/source markers and
  strict validation.
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: surface migration-compatible
  portable export metadata.
- `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`: include metadata-driven ordering where
  needed.

### Conventions

- Naming: keep kebab/slug conventions for entity files and align entityType naming with portable
  schemas.
- Error handling: fail fast, return structured API errors, and log contextual details with existing
  logger patterns.
- Testing: prefer cache parity and operation history assertions using integration-style tests over
  broad mocks.

### Gotchas and Warnings

- Value-guard semantics cannot be degraded by format conversion.
- YAML parsing ambiguity requires strict parsing/quoting rules if YAML is supported.
- Runtime validation and executed SQL must remain equivalent.
- Portable schema/OpenAPI/runtime type drift is a high-probability regression source.

### Task Guidance by Area

- database: preserve append-only `pcd_ops`/`pcd_op_history` behavior and deterministic ordering.
- api: keep import/export contracts synchronized with `docs/api/v1/schemas/pcd.yaml` and route
  validators.
- ui: keep payload shape and error semantics consistent with API portable contract.
