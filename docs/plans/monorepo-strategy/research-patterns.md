# Pattern Research: monorepo-strategy

## Architectural Patterns

**Service/manager orchestration**: High-level features center around manager-style services that orchestrate domain workflows, wrap lower-level concerns (filesystem, git, cache, background jobs), and push results into typed query modules rather than letting routes talk directly to tables. The PCD manager is the canonical example, coordinating clone/pull, manifest validation, dependency sync, cache rebuilds, and job scheduling while relying on `databaseInstancesQueries` for persistence.

- Example: `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`

**Repository/query modules**: Each persistent entity gets a dedicated query module under `packages/praxrr-app/src/lib/server/db/queries/` that exposes a cohesive API for CRUD, lookups, and helpers (e.g., `nameExists`, `getById`, `create`, `update`). Routes, managers, and jobs always consume these exports, which shields consumers from raw SQL and keeps migrations/DB semantics encapsulated.

- Example: `packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts`

**SvelteKit load/actions pattern**: Server routes follow the SvelteKit convention of exposing `load` to fetch data and `actions` (often just `default`) to mutate it, with each action handling validation, redirecting on success/failure, and logging before handing off to domain services. `fail()` is used for 4xx responses, `redirect()` for success navigation, and errors bubble through `try/catch` so higher layers can log/translate them consistently.

- Example: `packages/praxrr-app/src/routes/databases/new/+page.server.ts`

**Job queue + scheduler pipeline**: Background work is centralized in the `jobs` layer, which exposes scheduler helpers (e.g., `schedulePcdSyncForDatabase`) and wires them to a dispatcher loop. Initialization code (`initializeJobs`) recovers stuck jobs, starts dispatch, and logs progress, ensuring monorepo-wide state changes follow the same queue semantics.

- Example: `packages/praxrr-app/src/lib/server/jobs/init.ts`

## Code Conventions

Modules are grouped by runtime concern: `packages/praxrr-app/src/lib/server/` contains all server-only logic, `packages/praxrr-app/src/lib/client/` holds UI/components/stores, and `packages/praxrr-app/src/lib/shared/` holds DTOs, shared types, and constants. Files follow the existing project naming rules (`PascalCase.svelte` for components, `camelCase.ts` for utilities and query modules, `kebab-case` for directories that represent pages) and route metadata files carry the `+page.server.ts`, `+page.ts`, or `+layout.server.ts` suffixes required by SvelteKit. Imports prefer the workspace aliases defined in `deno.json` (`$lib/`, `$pcd/`, `$db/`, etc.), and aggregating modules (e.g., `packages/praxrr-app/src/lib/server/pcd/index.ts`) re-export cohesive slices so consumers can import from a single entry point while keeping internal layering separate. Action handlers use `satisfies Actions` to keep types strict instead of `any`.

## Error Handling

Error handling is explicit: domain layers throw typed errors (`PCDError` subclasses such as `ValidationError` or `DependencyError`), routes wrap service calls in `try/catch`, log failures via `logger.error(...)`, and respond with `fail()` or `redirect()` as appropriate. Logging is centralized through `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`, which enforces min-level filtering, structured metadata (`source`, `meta`), and dual console/file sinks, and the same logger is imported into every service/route to keep severity/format consistent. When hosting long-lived workflows (PCD linking, job scheduling), `try/catch` blocks also guard cleanup (filesystem removal) before rethrowing or returning a sanitized failure payload.

## Testing Approach

Tests live under `packages/praxrr-app/src/tests/` in domain folders (`arr/`, `jobs/`, `base/`) and are written with Deno’s test runner while reusing shared helpers from `BaseTest`, which supplies temp directories, lifecycle hooks (`beforeEach`, `afterEach`), and helpers for asserting filesystem state. Integration-style suites import route `load`/`actions` directly to exercise SvelteKit contracts, mock persistence by patching query module functions, and assert outcomes with `assertEquals`/`assertMatch`; e.g., the Lidarr media-management suite extends `BaseTest`, overrides `databaseInstancesQueries.getById`, and checks redirects/fail responses via helper methods so tests stay deterministic without spinning the full app stack.

- Example: `packages/praxrr-app/src/tests/base/BaseTest.ts`
- Example: `packages/praxrr-app/src/tests/arr/lidarrMediaManagement.test.ts`

## Patterns to Follow

1. Keep new monorepo-facing APIs in the service ↔ query layered model: expose actions through manager/service modules and consume typed query helpers instead of raw SQL; follow the `pcdManager` → `databaseInstancesQueries` shape when wiring new functionality.
2. Respect the workspace path aliases in `deno.json` when adding modules so downstream packages (app, schema, db) can share code without relative-path fragility; use aggregate entry points like `packages/praxrr-app/src/lib/server/pcd/index.ts` when you need to re-export a feature set.
3. Centralize observability: import `logger` for every route/service, tag logs with `source`, and wrap important operations in `try/catch` that log via `logger.error` before throwing `PCDError` subclasses or propagating sanitized `fail()` responses; reuse the existing logger configuration so monorepo tooling stays consistent.
4. Align tests with the established `BaseTest` pattern, patch query modules for deterministic results, and exercise route handlers directly so monorepo migrations can be validated without rebuilding a deployed stack.
