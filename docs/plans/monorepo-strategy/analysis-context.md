### Executive Summary

Monorepo strategy keeps the SvelteKit/Deno app at repo root while adding `packages/praxrr-db` and `packages/praxrr-schema` as workspace members so schema, DB ops, and runtime code evolve together under shared CI/release controls. Runtime behavior remains stable by replacing hardcoded defaults with env-driven linking and local schema/type generation. The core approach is phased: scaffold packages and workspace, decouple runtime/tooling defaults, then harden compatibility and publishing pipelines.

### Architecture Context

- System Structure: Existing `/src` app plus workspace members under `/packages`, coordinated by root `deno.json`, shared scripts, and CI workflows.
- Data Flow: Startup in `src/hooks.server.ts` still drives config, migrations, PCD manager, jobs, and Arr sync; compiled cache layering remains schema -> base -> tweak -> user ops.
- Integration Points: `scripts/generate-pcd-types.ts`, `scripts/bundle-api.ts`, root workspace config, and GitHub workflows (`compatibility`, `publish-*`, `release`) are the primary seams.

### Critical Files Reference

- `deno.json`: workspace members, shared tasks, and lockfile discipline.
- `src/hooks.server.ts`: default database auto-link defaults and env-driven behavior.
- `scripts/generate-pcd-types.ts`: schema source defaults and local/remote generation behavior.
- `.github/workflows/compatibility.yml`: cross-package compatibility gate.
- `.github/workflows/publish-db.yml`: subtree mirror publish for DB package.
- `.github/workflows/publish-schema.yml`: subtree mirror publish for schema package.
- `packages/praxrr-db/ops/`: published base-op source path.
- `packages/praxrr-schema/ops/0.schema.sql`: canonical schema source path.

### Patterns to Follow

- Service/Manager Orchestration: keep lifecycle and cross-cutting workflow logic in manager modules (example: `src/lib/server/pcd/core/manager.ts`).
- Query Module Boundary: keep persistence in typed query modules, not inline SQL (example: `src/lib/server/db/queries/databaseInstances.ts`).
- Layered Ops Compilation: preserve deterministic schema -> base -> tweaks -> user order (example: `src/lib/server/pcd/ops/loadOps.ts`).
- Job-Driven Sync: run long sync operations via queue/dispatcher rather than request inline execution (example: `src/lib/server/jobs/init.ts`).

### Cross-Cutting Concerns

- Security: mirror token (`MIRROR_PAT`) scope and branch protections must prevent direct mirror drift.
- Performance: local schema/type generation removes remote fetch latency and reduces CI variability.
- Testing: compatibility workflow must include type regeneration checks, ops/compile validation, and app-level checks.

### Parallelization Opportunities

- Independent work areas: package scaffolding, runtime decoupling, CI/publish workflows.
- Coordination hotspots: shared edits in `deno.json`, `scripts/generate-pcd-types.ts`, `src/hooks.server.ts`, and release workflows.

### Implementation Constraints

- Keep application runtime rooted at repo root to avoid alias/Docker/CI breakage.
- Use one workspace lockfile (`deno.lock`) shared by all workspace members.
- Auto-link defaults must be configurable by `PRAXRR_DEFAULT_DB_*` env vars and preserve current behavior by default.
- Release/tag strategy must support independent package version streams (`app/v*`, `db/v*`, `schema/v*`).
- Mirror repos remain downstream artifacts; monorepo stays source of truth.

### Planning Recommendations

- Use phased delivery: scaffolding -> runtime decoupling -> compatibility/publishing -> cutover docs/ops.
- Assign parallel owners for package scaffolding and CI/publish automation, with explicit sync on shared files.
- Lock key architectural decisions (root app layout, mirror flow, tag conventions) before deeper implementation tasks.
