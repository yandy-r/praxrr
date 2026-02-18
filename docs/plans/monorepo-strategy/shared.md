# monorepo-strategy

Praxrr is a SvelteKit + Deno application centered in `src/`, with runtime orchestration in `src/hooks.server.ts` that initializes config, SQLite state, PCD caches, and background jobs before routes execute. Monorepo strategy work extends the existing Deno workspace (`packages/praxrr-api`) by introducing `packages/praxrr-db` and `packages/praxrr-schema` while keeping runtime contracts stable across PCD linking, cache compilation, and Arr sync flows. The key integration seam is the PCD stack (`src/lib/server/pcd/**`) plus generation/build scripts (`scripts/generate-pcd-types.ts`, `scripts/bundle-api.ts`) that bridge schema, ops, and API types. CI and release workflows under `.github/workflows/` must enforce compatibility and mirror publishing so schema/DB packages remain externally consumable.

## Relevant Files

- /deno.json: Workspace root; add/coordinate package members and shared tasks.
- /src/hooks.server.ts: Startup wiring and default database auto-link behavior.
- /src/lib/server/pcd/core/manager.ts: PCD lifecycle orchestration across clone/sync/compile.
- /src/lib/server/pcd/git/dependencies.ts: Dependency clone and schema repo resolution logic.
- /src/lib/server/pcd/manifest/manifest.ts: `pcd.json` validation contract and schema dependency rule.
- /src/lib/server/pcd/ops/loadOps.ts: Schema/base/tweak/user ops layering and schema path resolution.
- /src/lib/server/pcd/ops/importBaseOps.ts: Imports repo ops into persisted `pcd_ops` records.
- /src/lib/server/pcd/ops/seedBuiltInBaseOps.ts: Seeds built-in base ops required for compatibility.
- /src/lib/server/db/schema.sql: Canonical app database schema for migration/table impact.
- /src/lib/server/db/migrations.ts: Migration runner used during startup and upgrades.
- /src/lib/server/db/queries/databaseInstances.ts: Database instance persistence used by PCD manager/routes.
- /src/lib/server/sync/processor.ts: Arr sync execution from compiled PCD/cache data.
- /src/lib/server/jobs/init.ts: Background job bootstrap and dispatcher startup.
- /scripts/generate-pcd-types.ts: Schema SQL to TypeScript generation path.
- /scripts/bundle-api.ts: OpenAPI packaging path that touches workspace package output.
- /.github/workflows/release.yml: Release pipeline impacted by path/workspace changes.
- /docs/api/v1/openapi.yaml: API contract source impacted by packaging and release flow.

## Relevant Tables

- `database_instances`: Linked database metadata (`repository_url`, `local_path`, sync settings).
- `pcd_ops`: Base/user operation records and ordering used for cache compilation.
- `pcd_op_history`: Per-op apply history and conflict tracking.
- `setup_state`: Startup default-link gate (`default_database_linked`).
- `arr_instances`: Arr server connection metadata used by sync jobs.
- `arr_sync_quality_profiles`: Quality profile sync configuration and status.
- `arr_sync_delay_profiles`: Delay profile sync configuration and status.
- `arr_sync_media_management`: Media management sync configuration and status.
- `arr_sync_metadata_profiles`: Metadata profile sync configuration and status.
- `arr_database_namespaces`: Namespace mapping per `(instance_id, database_id)`.
- `job_queue`: Scheduled and deduped background job execution queue.
- `job_run_history`: Historical execution results for scheduled jobs.

## Relevant Patterns

**Service/Manager Orchestration**: Keep cross-cutting workflows in manager/service modules, not in routes. Example: [`src/lib/server/pcd/core/manager.ts`](src/lib/server/pcd/core/manager.ts).

**Query Module Boundary**: Use typed query modules for persistence access instead of inline SQL in handlers. Example: [`src/lib/server/db/queries/databaseInstances.ts`](src/lib/server/db/queries/databaseInstances.ts).

**SvelteKit Route Contract**: Keep server route behavior in `load`/`actions` or `+server.ts`, using typed responses and route-layer validation. Example: [`src/routes/databases/new/+page.server.ts`](src/routes/databases/new/+page.server.ts).

**Layered Ops Compilation**: Preserve deterministic schema -> base -> tweaks -> user operation ordering. Example: [`src/lib/server/pcd/ops/loadOps.ts`](src/lib/server/pcd/ops/loadOps.ts).

**Job-Driven Sync Execution**: Trigger long-running sync work through queue/scheduler paths, not inline request execution. Example: [`src/lib/server/jobs/init.ts`](src/lib/server/jobs/init.ts).

## Relevant Docs

**`docs/plans/monorepo-strategy/feature-spec.md`**: You _must_ read this when working on migration goals, acceptance criteria, and cutover rules.

**`docs/plans/monorepo-strategy/research-technical.md`**: You _must_ read this when working on workspace layout, config paths, CI, Docker, and release flow changes.

**`docs/plans/monorepo-strategy/research-recommendations.md`**: You _must_ read this when working on phased rollout strategy and risk mitigations.

**`docs/plans/monorepo-strategy/research-business.md`**: You _must_ read this when working on manifest/ops business rules and default-link behavior.

**`docs/plans/monorepo-strategy/research-ux.md`**: You _must_ read this when working on contributor workflow, onboarding docs, and operational communication.

**`docs/api/v1/openapi.yaml`**: You _must_ read this when working on API contract impacts from package/workspace changes.
