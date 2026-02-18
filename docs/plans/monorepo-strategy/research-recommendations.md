# Recommendations: monorepo-strategy

## Executive Summary

The monorepo migration should leverage the existing Deno workspace infrastructure already present in `deno.json` (which currently hosts `packages/praxrr-api`) and extend it with `packages/praxrr-db` and `packages/praxrr-schema` source directories, using `git subtree split` for mirroring to external repos. The primary risk is not technical breakage but operational complexity: SvelteKit's path alias system, the Dockerfile build context, and the hardcoded `praxrr-db`/`praxrr-schema` URLs throughout the PCD pipeline all require coordinated updates. The recommended approach is a directory-restructure-first strategy (no full app move to `packages/praxrr` initially) that introduces db/schema packages alongside the app, validates CI, then optionally moves the app later.

## Implementation Recommendations

### Recommended Approach

Use Deno workspaces for the db and schema packages while keeping the main SvelteKit app at the repository root. Moving the SvelteKit app into `packages/praxrr` carries disproportionate risk relative to value because SvelteKit, Vite, the Deno compile step, Docker builds, and 20+ path aliases all assume the app lives at the repo root. Instead, introduce `packages/praxrr-db` and `packages/praxrr-schema` as workspace members, use `git subtree split` for mirroring, and treat the root as the app package.

### Technology Choices

| Component          | Recommendation                                              | Rationale                                                                                           |
| ------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Workspace model    | Deno workspaces (extend existing)                           | Already in use for `praxrr-api`; proven with JSR publish pipeline; native bare specifier resolution |
| Mirror strategy    | `git subtree split` + push                                  | Clean history extraction per-prefix; no external tool deps; GitHub Actions-friendly; reversible     |
| CI approach        | Monolithic with path-filtered jobs                          | Single repo means single CI config; use `paths:` filters to run db/schema/app jobs selectively      |
| Version management | Independent semver per package + compatibility matrix in CI | Matches issue requirement; db and schema versions are already decoupled from app version            |

### Phasing Strategy

1. **Phase 1 - Scaffolding**: Create `packages/praxrr-db/` and `packages/praxrr-schema/` directories with `deno.json` manifests. Add them to the root workspace array. Seed with initial content (schema SQL ops, db ops structure). Validate `deno install` and workspace resolution. No changes to existing app code.

2. **Phase 2 - Runtime Decoupling** (renamed from "App Move"): Replace hardcoded `praxrr-db` and `praxrr-schema` URLs with configurable env vars (`PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`). Update `generate-pcd-types.ts` to support local workspace path resolution. Update the PCD dependency system to optionally resolve from local workspace packages. Keep the app at the repo root.

3. **Phase 3 - Contract Testing**: Add CI gates that validate schema compatibility (run `generate-pcd-types.ts` against workspace schema, diff against committed types). Add manifest validation tests. Add cross-package type-checking with `deno check`.

4. **Phase 4 - CI/Publish Pipelines**: Create `publish-db.yml` and `publish-schema.yml` workflows using `git subtree split`. Add provenance metadata. Add rollback documentation. Wire up tag-based triggers for independent package releases.

5. **Phase 5 - Cutover**: Freeze external repos. Update contributor docs. Update CLAUDE.md with new workspace conventions. Create runbook for emergency rollback. Communicate change to users.

### Quick Wins

- **Configurable default DB URL**: Add `PRAXRR_DEFAULT_DB_URL` and `PRAXRR_DEFAULT_DB_BRANCH` env vars to `hooks.server.ts` (lines 52-56). This is a standalone change that does not require any monorepo structure and directly satisfies an acceptance criterion.
- **Schema type generation from local path**: The `generate-pcd-types.ts` script already supports `--local=<path>`. Once the schema package is co-located, `deno task generate:pcd-types --local=packages/praxrr-schema/ops/0.schema.sql` works immediately.
- **Workspace extension**: The root `deno.json` already has `"workspace": ["packages/praxrr-api"]`. Adding new members is a one-line change.

## Improvement Ideas

### PCD System Improvements

- **Local dependency resolution**: The `dependencies.ts` dependency system currently only resolves deps via git clone/fetch. Adding a "workspace" resolution mode that symlinks or reads from `packages/praxrr-schema/ops/` would eliminate the external clone for the default database during development and CI, reducing startup time and network dependency.
- **Schema version contract in manifest**: The `pcd.json` dependency format uses `{ "https://github.com/yandy-r/praxrr-schema": "1.0.0" }`. With a monorepo, the schema package version could be validated against the workspace member's `deno.json` version field, catching drift automatically.
- **Unified ops loading**: `loadOps.ts` has `resolveSchemaOpsPath()` that searches for directories containing "schema" under `deps/`. This heuristic could be replaced with an explicit manifest field (`schema_ops_path`) to remove ambiguity.

### Contract Testing

- **Automated schema drift detection**: A CI step that runs `generate-pcd-types.ts --local=packages/praxrr-schema/ops/0.schema.sql` and diffs the output against the committed `src/lib/shared/pcd/types.ts` would catch any schema changes that were not propagated to types.
- **Manifest compatibility check**: Validate that the app's minimum required schema version (tracked in `pcd.json`) is satisfied by the workspace schema package version.
- **PCD compile smoke test**: A CI step that creates an in-memory PCD cache from workspace db+schema ops and validates it compiles without errors would catch cross-package breakage.

### Type Generation

- **Co-located schema enables pre-commit hooks**: With the schema SQL living in the same repo, a pre-commit hook or CI step can regenerate types and fail if there are uncommitted changes, enforcing type/schema lockstep.
- **Workspace bare specifier for schema**: If `packages/praxrr-schema` exports its schema SQL path, `generate-pcd-types.ts` could import the path via `@yandy-r/praxrr-schema/schema-path` instead of hardcoding `yandy-r/praxrr-schema`.

## Risk Assessment

### Technical Risks

| Risk                                                                    | Likelihood | Impact | Mitigation                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SvelteKit path resolution breaks after app move to `packages/praxrr`    | High       | High   | Do not move the app. Keep it at root. SvelteKit, Vite, svelte.config.js, tsconfig.json, and deno.json all assume root-level `src/`. Moving requires updating 20+ alias paths in 3 config files plus Dockerfile COPY paths. |
| Docker build context breaks                                             | Medium     | High   | If the app stays at root, `Dockerfile` COPY commands remain unchanged. For db/schema packages, they are not part of the Docker image and need no changes.                                                                  |
| `deno.lock` conflicts during workspace expansion                        | Medium     | Low    | Run `deno install --node-modules-dir` after workspace changes to regenerate cleanly. The lock file is already 2,358 lines.                                                                                                 |
| `git subtree split` produces confusing commit history in external repos | Low        | Medium | Use `--prefix` carefully. External repos get clean linear history of their subtree. Document that contributors should never push directly to external repos.                                                               |
| Deno workspace `nodeModulesDir` constraint                              | Medium     | Medium | Deno docs state `nodeModulesDir` must be identical across all workspace members. The root already uses `node_modules`. New packages must not override this setting.                                                        |
| Type generation breaks during schema package transition                 | Low        | Medium | The `--local` flag on `generate-pcd-types.ts` is already implemented. Transition can be incremental.                                                                                                                       |

### Integration Challenges

- **Hardcoded URLs in multiple layers**: The URL `https://github.com/yandy-r/praxrr-db` appears in `hooks.server.ts` (line 54), `https://github.com/yandy-r/praxrr-schema` appears in `generate-pcd-types.ts` (line 19), `loadOps.ts` (line 33 comment), and `databases/[id]/config/+page.svelte` (line 316 locked dependency UI). Each needs a different mitigation: env vars for runtime, config constants for scripts, and data migration for persisted manifest entries.
- **PCD dependency system assumes git repos**: The `dependencies.ts` module is entirely built around cloning/fetching git repos. Workspace resolution would need a new code path that checks for local paths before falling back to git operations.
- **External repo consumers**: Users who currently clone `praxrr-db` or `praxrr-schema` independently must continue to receive updates via the mirror pipeline. Any publish failure would leave external consumers on stale versions.

### Migration-Specific Risks

- **Git history preservation**: `git subtree split` does not rewrite existing history in the monorepo. External repos can be force-pushed with the split output. The main repo history remains intact.
- **CI pipeline disruption window**: Adding new workflows and path filters will require testing. Use `workflow_dispatch` triggers for manual testing before enabling automatic triggers.
- **User confusion about default database source**: If the default DB URL changes from `praxrr-db` external repo to a monorepo-published mirror, users who have forked `praxrr-db` may see unexpected behavior. The configurable env var mitigates this since the default can remain the same external URL.

## Alternative Approaches

### Option A: Deno Workspaces + Git Subtree Split (App at Root)

Keep the SvelteKit app at the repository root. Add `packages/praxrr-db` and `packages/praxrr-schema` as Deno workspace members. Use `git subtree split --prefix=packages/praxrr-db` and `git subtree split --prefix=packages/praxrr-schema` in CI to mirror to external repos.

- **Pros**: Minimal disruption to existing build/test/Docker pipelines. Leverages proven Deno workspace pattern (already used for `praxrr-api`). Atomic cross-component commits. Type generation from local schema. Independent versioning via per-package `deno.json`.
- **Cons**: The app is not under `packages/` which is inconsistent with the issue's stated goal. Root-level app means the "package" concept is implicit. Does not achieve the full "packages/praxrr" move described in the issue.
- **Effort**: Low-Medium. Primarily new files and CI workflows, minimal refactoring of existing code.

### Option B: Full App Move to `packages/praxrr`

Move the entire SvelteKit application (src/, scripts/, svelte.config.js, vite.config.ts, package.json, tsconfig.json) into `packages/praxrr/`. Root `deno.json` becomes a pure workspace coordinator.

- **Pros**: Clean separation of all packages under `packages/`. Consistent directory model. Matches the issue description exactly.
- **Cons**: Very high risk. Every path alias (20+ in `svelte.config.js`, `deno.json`, `tsconfig.json`) must be rebased. The `Dockerfile` COPY commands must be rewritten. The `sveltekit-adapter-deno` output paths change. The `deno compile` command in `build` tasks changes. The dev scripts change. Vite's `server.watch` paths change. The `.prettierrc` and ESLint configs need updating. The `dist/` output location logic changes. All CI workflows must be updated. E2E test paths change.
- **Effort**: Very High. Touches nearly every configuration file in the repo. High probability of subtle breakage that is hard to detect until runtime.

### Option C: Git Submodules (Bring db/schema into praxrr)

Use `git submodule add` to bring `praxrr-db` and `praxrr-schema` into the monorepo as submodules under `packages/`.

- **Pros**: External repos remain the source of truth. No history rewriting. Users who clone external repos are unaffected.
- **Cons**: Submodules add complexity for every contributor (must run `git submodule update --init`). CI needs explicit submodule checkout steps. Atomic cross-component commits are impossible (the main repo only pins a commit hash). Does not achieve "single repo as source of truth" goal. Submodules are widely considered an anti-pattern for tightly coupled components. Deno workspaces may not resolve through submodule boundaries cleanly.
- **Effort**: Low initial setup, but ongoing high maintenance cost and contributor friction.

### Recommendation

**Option A (Deno Workspaces + Git Subtree Split, App at Root)** is the recommended approach. It achieves the core goals of the issue (atomic changes, compatibility gates, publish pipelines, configurable defaults) with the lowest risk profile. The issue's acceptance criteria do not strictly require the app to be under `packages/praxrr` -- they require "main app relocated" with "working build/test/release pipelines." If the stakeholder insists on the full app move, it should be deferred to a later phase after db/schema packages are stable and all CI is proven.

If the full app move is eventually desired, it can be attempted as a Phase 6 after the monorepo infrastructure is battle-tested, by creating a `packages/praxrr/` directory and doing a single large refactor with comprehensive path alias updates. This is explicitly not recommended for the initial migration.

## Task Breakdown Preview

### Phase 1: Scaffolding (Estimated: 1-2 days)

- **Task group**: Create `packages/praxrr-db/` and `packages/praxrr-schema/` with `deno.json` manifests, initial ops content, `pcd.json` equivalent, README
- **Subtasks**:
  - Create `packages/praxrr-schema/deno.json` with name `@yandy-r/praxrr-schema`, version `1.0.0`
  - Create `packages/praxrr-schema/ops/0.schema.sql` (copy from external repo or generate)
  - Create `packages/praxrr-db/deno.json` with name `@yandy-r/praxrr-db`, version matching current db
  - Create `packages/praxrr-db/ops/` with base ops, `pcd.json`, tweaks
  - Add both to root `deno.json` workspace array: `["packages/praxrr-api", "packages/praxrr-db", "packages/praxrr-schema"]`
  - Validate `deno install --node-modules-dir` succeeds
  - Validate `deno task check` still passes
- **Parallel opportunities**: Schema and db package creation can happen simultaneously
- **Estimated complexity**: Low

### Phase 2: Runtime Decoupling (Estimated: 2-3 days)

- **Task group**: Make hardcoded external repo references configurable, enable local workspace resolution
- **Subtasks**:
  - Add `PRAXRR_DEFAULT_DB_URL` and `PRAXRR_DEFAULT_DB_BRANCH` env vars to `hooks.server.ts` with current values as defaults
  - Update `generate-pcd-types.ts` to default to `packages/praxrr-schema/ops/0.schema.sql` when workspace path exists
  - Update `SCHEMA_REPO` constant in `generate-pcd-types.ts` to be configurable
  - Update the locked dependency UI in `databases/[id]/config/+page.svelte` to use a configurable schema URL
  - Add env var documentation to README and CLAUDE.md
  - Add `PRAXRR_DEFAULT_DB_URL` / `PRAXRR_DEFAULT_DB_BRANCH` to compose files and Dockerfile
- **Dependencies**: Phase 1 complete (packages exist)
- **Estimated complexity**: Medium

### Phase 3: Contract Testing (Estimated: 2-3 days)

- **Task group**: CI gates for cross-package compatibility
- **Subtasks**:
  - Create `check-schema-types.yml` workflow: generate types from workspace schema, diff against committed types, fail if different
  - Create `check-pcd-compile.yml` workflow: compile a test PCD cache from workspace db+schema ops, verify no errors
  - Add manifest version compatibility check: compare app minimum_version against workspace schema version
  - Add `deno check` step that validates all workspace members type-check together
  - Create unit tests for manifest validation with workspace paths
- **Parallel opportunities**: Schema type check and PCD compile check can be developed simultaneously
- **Estimated complexity**: Medium

### Phase 4: CI/Publish Pipelines (Estimated: 3-4 days)

- **Task group**: Mirror and publish workflows for external repos
- **Subtasks**:
  - Create `publish-db.yml` workflow using `git subtree split --prefix=packages/praxrr-db`
  - Create `publish-schema.yml` workflow using `git subtree split --prefix=packages/praxrr-schema`
  - Add provenance metadata to published packages (attestation)
  - Define tag format for independent versioning (e.g., `db/v1.2.0`, `schema/v1.0.0`)
  - Add rollback documentation (re-push previous subtree split)
  - Test dry-run publish to external repos
  - Update `publish-api.yml` to align with new workspace structure if needed
- **Parallel opportunities**: db and schema publish workflows can be developed simultaneously; provenance metadata work is independent
- **Estimated complexity**: High (GitHub Actions complexity, subtree split edge cases, provenance)

### Phase 5: Cutover (Estimated: 1-2 days)

- **Task group**: Finalize migration, document, communicate
- **Subtasks**:
  - Freeze direct pushes to external `praxrr-db` and `praxrr-schema` repos
  - Add "mirror" notices to external repo READMEs
  - Update CLAUDE.md with monorepo conventions and workspace layout
  - Update contributor guide
  - Create cutover runbook with rollback instructions
  - Verify all acceptance criteria are met
  - Tag initial monorepo release
- **Dependencies**: All other phases complete
- **Estimated complexity**: Low

### Critical Path

Phase 1 (Scaffolding) -> Phase 2 (Runtime Decoupling) -> Phase 3 (Contract Testing) -> Phase 4 (CI/Publish) -> Phase 5 (Cutover)

Phases 1 and 2 are strictly sequential (phase 2 depends on packages existing). Phase 3 can begin in parallel with late Phase 2 work. Phase 4 is largely independent of Phase 3 but should wait for Phase 2. Phase 5 requires everything else.

**Minimum timeline**: 9-14 working days assuming serial execution. With parallelization of Phases 3/4, approximately 7-10 working days.

## Key Decisions Needed

- **App move or app-at-root?**: The issue explicitly states "Move main app code into `packages/praxrr`." This recommendation argues against that due to SvelteKit/Vite/Docker path complexity. If the stakeholder requires the move, the risk assessment and timeline change dramatically (add 5-7 days, high regression risk). This is the most consequential decision.
- **External repo strategy after cutover**: Should external repos (`praxrr-db`, `praxrr-schema`) become read-only mirrors, or should they remain writable with bi-directional sync? Read-only mirror (recommended) is simpler but prevents external contributions directly to those repos.
- **Tag naming convention for independent versioning**: Options include `db/v1.2.0` prefixed tags, separate tag namespaces, or release branches per package. This affects CI trigger patterns and `git subtree split` behavior.
- **Default DB URL change**: Should the default `PRAXRR_DEFAULT_DB_URL` point to the external `praxrr-db` repo (current behavior preserved) or to a monorepo-published mirror URL? Keeping the external URL as default is safest for existing users.

## Open Questions

- Does the PCD dependency system need to support both workspace resolution (for development) and git-based resolution (for production/user databases) simultaneously, or is it acceptable to always resolve via git even when in the monorepo?
- What is the current content of the external `praxrr-db` and `praxrr-schema` repositories? The initial scaffold needs to match their current state exactly.
- Are there any existing consumers of `praxrr-db` or `praxrr-schema` beyond the main app (third-party PCD authors, community forks)?
- Should the `packages/praxrr-api` publish pipeline be updated to align with the new db/schema publish pipelines, or should it remain independent?
- What is the desired behavior for the `databases/[id]/config/+page.svelte` locked schema dependency UI after the migration? Should it still show `https://github.com/yandy-r/praxrr-schema` or a workspace-relative reference?

## Relevant Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/deno.json`: Root workspace config; already has `"workspace": ["packages/praxrr-api"]`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/hooks.server.ts`: Default DB auto-link with hardcoded URL (line 54) and env var support (lines 38-40)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/git/dependencies.ts`: PCD dependency clone/sync/validate system
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/manifest/manifest.ts`: Manifest validation including schema dependency check
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/ops/loadOps.ts`: Schema ops path resolution with "schema" directory heuristic
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/core/manager.ts`: Full PCD lifecycle orchestration
- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/generate-pcd-types.ts`: Schema type generation with hardcoded `yandy-r/praxrr-schema` (line 19)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/svelte.config.js`: 20+ path aliases that assume root-level src/
- `/home/yandy/Projects/github.com/yandy-r/praxrr/vite.config.ts`: Vite config reading root package.json
- `/home/yandy/Projects/github.com/yandy-r/praxrr/Dockerfile`: Multi-stage build with COPY from root context
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/docker.yml`: Docker build CI
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/release.yml`: Release build matrix
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/publish-api.yml`: Existing JSR publish pattern for praxrr-api
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-api/deno.json`: Existing workspace member pattern to replicate
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/routes/databases/[id]/config/+page.svelte`: UI with hardcoded schema URL (line 316)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`: Built-in base op seeding (must work post-migration)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/utils/config/config.ts`: App config singleton with path management

## Sources

- [Deno Workspaces and Monorepos Documentation](https://docs.deno.com/runtime/fundamentals/workspaces/)
- [Announcing Deno 2](https://deno.com/blog/v2.0)
- [Deno 1.45: Workspace and Monorepo Support](https://deno.com/blog/v1.45)
