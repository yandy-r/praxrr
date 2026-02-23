# pcd-data-migration

PCD data migration sits on top of Praxrr’s existing SQL-first operation pipeline: repository/base
ops are imported into `pcd_ops`, compiled by the in-memory cache, and then synced downstream through
existing job flows. The core control plane is `PCDManager`, which already coordinates linking,
importing, compiling, and sync triggers, while entity imports/exports run through portable
serializers and deserializers. The current research direction keeps DDL and runtime compilation
SQL-native while adding a hybrid JSON/YAML authoring and exchange layer, so migration logic must
plug into existing writer/cache/value-guard paths rather than bypassing them. The highest-risk gate
is value-guard correctness, so every phase should preserve `pcd_op_history` visibility and
deterministic conflict handling.

## Relevant Files

- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: Orchestrates link/sync/import/compile
  and sync triggers.
- `/packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: Imports repository base SQL ops
  into `pcd_ops`.
- `/packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: Validates, writes, and recompiles
  operations with metadata.
- `/packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`: Builds ordered schema/base/tweak/user
  operation layers.
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: Executes layered SQL and records
  apply/conflict outcomes.
- `/packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`: Rebuilds and atomically swaps
  compiled cache instances.
- `/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`: Exports cache-backed entities to
  portable payloads.
- `/packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`: Converts portable payloads into
  SQL operations.
- `/packages/praxrr-app/src/lib/shared/pcd/portable.ts`: Portable schema contract for import/export
  and migration formats.
- `/packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`: API export entrypoint for portable
  entities.
- `/packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`: API import entrypoint with
  layer/write validation.
- `/packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts`: Data-access layer for operation
  persistence.
- `/packages/praxrr-app/src/lib/server/sync/processor.ts`: Queues follow-up sync jobs after PCD
  changes.
- `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: Builds Arr clients with
  decrypted credentials.
- `/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Defines migration-relevant
  runtime/env configuration.

## Relevant Tables

- `pcd_ops`: Source-of-truth append-only operations with metadata and sequencing.
- `pcd_op_history`: Operation application/conflict outcomes for guard observability.
- `database_instances`: Linked PCD repository instances and sync settings.
- `database_instance_credentials`: Encrypted Git credentials for PCD repositories.
- `arr_instances`: Arr target instances and connection metadata.
- `arr_instance_credentials`: Encrypted Arr API keys.
- `arr_sync_quality_profiles`: Sync configuration for quality profile pushes.
- `arr_sync_delay_profiles`: Sync configuration for delay profile pushes.
- `arr_sync_media_management`: Sync configuration for media-management pushes.
- `job_queue`: Queued sync/pull jobs triggered by PCD state changes.
- `job_run_history`: Job execution history for operational debugging.

## Relevant Patterns

**PCD Lifecycle Orchestration**: Keep migration orchestration inside `PCDManager` so
link/sync/compile behavior remains centralized. See
[`packages/praxrr-app/src/lib/server/pcd/core/manager.ts`](packages/praxrr-app/src/lib/server/pcd/core/manager.ts).

**Layered Compile Pipeline**: Preserve schema/base/tweak/user ordering before cache execution to
avoid semantic drift. See
[`packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`](packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts).

**Validated Operation Writes**: Route new writes through the writer path to keep metadata, hashing,
and recompilation guarantees. See
[`packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`](packages/praxrr-app/src/lib/server/pcd/ops/writer.ts).

**Portable Bridge Reuse**: Use serializer/deserializer + portable schema for JSON/YAML exchange
instead of parallel models. See
[`packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`](packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts)
and
[`packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts`](packages/praxrr-app/src/lib/server/pcd/entities/deserialize.ts).

**Value-Guard First Validation**: Treat guard behavior and op-history visibility as a hard rollout
gate. See
[`packages/praxrr-app/src/lib/server/pcd/database/cache.ts`](packages/praxrr-app/src/lib/server/pcd/database/cache.ts).

## Relevant Docs

**`research/data-schema/report.md`**: You _must_ read this when defining the phased hybrid migration
strategy and value-guard gate.

**`research/data-schema/synthesis/technical-design.md`**: You _must_ read this when implementing
YAML/entity generation and migration verification mechanics.

**`research/data-schema/synthesis/decision-framework.md`**: You _must_ read this when prioritizing
options and confirming phased sequencing rationale.

**`research/data-schema/synthesis/risk-assessment.md`**: You _must_ read this when defining
mitigations for value-guard fidelity and migration blast radius.

**`docs/ARCHITECTURE.md`**: You _must_ read this when touching PCD pipeline layering, ops history,
and compile semantics.

**`docs/features/portable-import-export.md`**: You _must_ read this when evolving import/export
behavior used by migration flows.

**`docs/api/v1/paths/pcd.yaml`**: You _must_ read this when changing import/export endpoint
contracts.

**`docs/api/v1/schemas/pcd.yaml`**: You _must_ read this when adjusting portable entity payload
schemas.

**`docs/plans/enhance-lidarr-support/migration-runbook.md`**: You _must_ read this when designing
migration runbooks, verification, and rollback.
