### Executive Summary

The codebase already has strong orchestration boundaries (manager/query/job modules) that support monorepo expansion without route-level rewrites. The main code impact is replacing hardcoded defaults and remote schema assumptions with workspace-local, env-configurable behavior while preserving existing PCD and sync contracts. CI/release automation must become workspace-aware to keep generated artifacts and package mirrors consistent.

### Related Components

- `packages/praxrr-app/src/hooks.server.ts`: startup link defaults and one-time auto-link behavior.
- `scripts/generate-pcd-types.ts`: schema source resolution and generated type workflow.
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: database link/clone/compile orchestration contract.
- `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`: deterministic operation layering contract.
- `packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts`: typed persistence boundary.
- `.github/workflows/release.yml`: release pipeline assumptions and workspace pathing.

### Implementation Patterns

**Manager-Orchestrated Lifecycle**

- Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts:31`
- Apply to: link/startup orchestration, cache compile, sync kickoff.

**Typed Query Access**

- Example: `packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts:5`
- Apply to: database metadata persistence and migration-adjacent changes.

**Deterministic Ops Layering**

- Example: `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts:31`
- Apply to: schema/base/tweak/user merge behavior and compatibility checks.

**Queued Background Processing**

- Example: `packages/praxrr-app/src/lib/server/jobs/init.ts:6`
- Apply to: sync execution and long-running workflows.

**Scripted Build Artifact Generation**

- Example: `scripts/generate-pcd-types.ts:19`
- Apply to: schema type generation and CI drift detection.

### Integration Points

#### Files to Create

- `packages/praxrr-db/deno.json`: package metadata/tasks for DB package.
- `packages/praxrr-db/pcd.json`: DB package PCD manifest.
- `packages/praxrr-db/README.md`: DB package usage and mirror guidance.
- `packages/praxrr-schema/deno.json`: package metadata/tasks for schema package.
- `packages/praxrr-schema/pcd.json`: schema package PCD manifest.
- `packages/praxrr-schema/ops/0.schema.sql`: canonical schema DDL.
- `.github/workflows/compatibility.yml`: cross-package compatibility gate.
- `.github/workflows/publish-db.yml`: DB mirror publish workflow.
- `.github/workflows/publish-schema.yml`: schema mirror publish workflow.
- `release-please-config.json`: multi-package release configuration.
- `.release-please-manifest.json`: release-please version manifest.

#### Files to Modify

- `deno.json`: workspace entries and top-level cross-package tasks.
- `packages/praxrr-app/src/hooks.server.ts`: env-driven default DB URL/branch/name behavior.
- `scripts/generate-pcd-types.ts`: local schema default with remote override path.
- `packages/praxrr-app/src/routes/databases/[id]/config/+page.svelte`: configurable locked schema dependency references.
- `README.md`: contributor workflow and monorepo structure docs.
- `CLAUDE.md`: internal workflow and environment variable documentation.

### Conventions

- Naming: keep package-scoped, conventional naming in CI/release metadata.
- Error handling: fail fast in runtime orchestration; log context-rich failures.
- Testing: require `deno task check` and targeted compatibility checks around schema/type drift.

### Gotchas and Warnings

- There is tension between “move app into `packages/praxrr`” vs keeping app at root; planning should settle this before structural edits.
- Empty/default env handling in auto-link code can accidentally trigger broken links if not explicitly guarded.
- Type generation still using remote fetch defaults will keep CI/network coupling until local-first defaults are in place.
- Root `deno.lock` must remain shared; splitting lockfiles creates dependency drift risk.
- Workflow gating order matters: compatibility checks should be in place before publish/release automation is enforced.

### Task Guidance by Area

- database: treat `packages/praxrr-db` as source for base ops while preserving existing import/seed flows.
- api: keep OpenAPI bundle and package build scripts workspace-aware.
- ui: only adjust schema lock/config references necessary for monorepo defaults; keep existing link UX flow stable.
