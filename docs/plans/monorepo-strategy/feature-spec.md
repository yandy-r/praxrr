# Feature Spec: Monorepo Strategy

## Executive Summary

Consolidates `praxrr`, `praxrr-db`, and `praxrr-schema` into a monorepo-in-place model using Deno
2.x workspaces, enabling atomic cross-component commits and CI-enforced compatibility gates. New
packages (`packages/praxrr-db`, `packages/praxrr-schema`) join the existing `packages/praxrr-api`
workspace member; `git subtree split` mirrors them to external consumer repos. Hardcoded repository
URLs are replaced with configurable environment variables. Research recommends keeping the SvelteKit
app at the repository root (not moved to `packages/praxrr`) due to 20+ path alias and CI breakage
risk.

## External Dependencies

### APIs and Services

#### Deno Workspaces

- **Documentation**: https://docs.deno.com/runtime/fundamentals/workspaces/
- **CLI Reference**: https://docs.deno.com/runtime/reference/cli/task/
- **Key Capabilities**: Shared import maps, bare specifier cross-member imports, per-member config
  inheritance, selective task execution (`--filter`, `--cwd`, `--recursive`), workspace-scoped
  `deno check` and `deno test`
- **Limitations**:
  - No built-in task dependency graph
    ([denoland/deno#27586](https://github.com/denoland/deno/issues/27586))
  - Fuzzy matching on `--recursive` task names
    ([denoland/deno#27401](https://github.com/denoland/deno/issues/27401))
  - `--filter` requires `name` property in member `deno.json`
    ([denoland/deno#27713](https://github.com/denoland/deno/issues/27713))
  - `importMap`, `scopes`, `nodeModulesDir`, `vendor`, `lock`, `workspace` are root-only settings

#### Git Subtree Split

- **Documentation**: `man git-subtree`,
  [Atlassian tutorial](https://www.atlassian.com/git/tutorials/git-subtree)
- **Purpose**: Extract subdirectory history into standalone branch for mirroring to external repos
- **Key Commands**: `git subtree split --prefix=packages/praxrr-db -b split-branch` then
  `git push mirror split-branch:main --force`
- **Limitations**: Performance degrades with 30k+ commits; no persistent cache (use splitsh-lite if
  needed); one-way only (monorepo is source of truth)

#### dorny/paths-filter (GitHub Action)

- **Repository**: https://github.com/dorny/paths-filter (6,000+ stars)
- **Purpose**: Detect which packages changed in a PR/push for selective CI
- **Usage**: Outputs boolean flags per filter pattern, supports picomatch globs

#### release-please (Google)

- **Repository**: https://github.com/googleapis/release-please
- **Action**: https://github.com/googleapis/release-please-action
- **Manifest docs**:
  https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md
- **Purpose**: Automated version bumps, changelogs, and GitHub releases from Conventional Commits
- **Configuration**: `simple` release type for Deno packages, `separate-pull-requests`,
  `include-component-in-tag` with `/` separator

### Libraries and SDKs

| Library               | Version | Purpose                        | Installation                  |
| --------------------- | ------- | ------------------------------ | ----------------------------- |
| git-filter-repo       | latest  | History-preserving repo import | `pip install git-filter-repo` |
| splitsh-lite          | latest  | Fast subtree split (optional)  | Go + libgit2 compile          |
| dorny/paths-filter    | v3      | CI change detection            | GitHub Actions marketplace    |
| release-please-action | v4      | Automated releases             | GitHub Actions marketplace    |

### External Documentation

- [Deno Workspaces and Monorepos](https://docs.deno.com/runtime/fundamentals/workspaces/): Core
  workspace configuration
- [Deno 1.45 Blog Post](https://deno.com/blog/v1.45): Workspace feature introduction
- [Apollo Git Subtree Mirroring](https://www.apollographql.com/blog/how-apollo-manages-swift-packages-in-a-monorepo-with-git-subtrees):
  Production subtree mirror pattern
- [Netlify Multirepo to Monorepo Guide](https://developers.netlify.com/guides/migrating-git-from-multirepo-to-monorepo-without-losing-history/):
  History-preserving migration
- [GitHub Actions Monorepo Required Checks](https://github.com/orgs/community/discussions/26251):
  Aggregation job pattern

## Business Requirements

### User Stories

**Primary User: Maintainer**

- As a maintainer, I want to make schema changes and corresponding app changes in a single commit so
  that I avoid cross-repo version-pinning races.
- As a maintainer, I want CI to automatically validate that app code is compatible with the current
  schema and DB ops so that I catch contract breakage before merging.
- As a maintainer, I want a single release workflow that can independently version app, db, and
  schema from one repository so that releases do not require coordinating PRs across three repos.
- As a maintainer, I want the type generation pipeline to read schema SQL from a local path within
  the monorepo so that I do not need to push schema changes to GitHub before regenerating types.
- As a maintainer, I want a publish/mirror pipeline that pushes db and schema packages to their
  public repos so that external consumers still have stable distribution channels.

**Primary User: Contributor**

- As a contributor, I want to clone a single repository and have the entire project buildable
  without fetching external schema repos so that onboarding is simpler.
- As a contributor, I want to iterate on schema DDL and see the effects in the app's PCD type system
  within a single PR so that review cycles are faster.

**Secondary User: End User (Custom PCD)**

- As an end user with a custom PCD, I want to continue linking my own PCD repository via URL and
  branch so that the monorepo transition does not affect my workflow.
- As an end user, I want the default auto-linked database to continue working on fresh installs so
  that I can use Praxrr without manual PCD setup.
- As an end user, I want to configure the default database URL and branch via environment variables
  so that I can point to a different default DB (e.g., a fork or mirror).

### Business Rules

1. **PCD Manifest Contract (Preserved)**: The `pcd.json` manifest format is unchanged. Dependencies
   use `Record<string, string>` where keys are repository URLs and values are version tags. At least
   one dependency key must contain the substring `"schema"` (enforced by `manifest.ts:82-86`).
   - Validation: Manifest validation in `manifest.ts` is a string match on URL containing "schema"
     -- no URL format or reachability validation.
   - Exception: Manifests with empty `dependencies` skip schema check.

2. **Auto-Link Defaults (Configurable)**: The default database URL and branch become configurable
   via `PRAXRR_DEFAULT_DB_URL` and `PRAXRR_DEFAULT_DB_BRANCH` environment variables, defaulting to
   current hardcoded values (`https://github.com/yandy-r/praxrr-db` and `v2`).
   - Validation: Empty `PRAXRR_DEFAULT_DB_URL` disables auto-link.
   - Exception: Existing `PRAXRR_DEFAULT_DB_TOKEN`, `PRAXRR_DEFAULT_DB_GIT_USERNAME`,
     `PRAXRR_DEFAULT_DB_GIT_EMAIL` env vars continue to work unchanged.

3. **Ops Layering Order (Preserved)**: Schema -> Base (published) -> Base (drafts) -> Tweaks ->
   User. The `loadOps.ts` resolver already handles flexible schema directory naming (scans for
   `*schema*` in `deps/`). No changes needed.

4. **Mirror Repos as Read-Only**: After cutover, `yandy-r/praxrr-db` and `yandy-r/praxrr-schema`
   become CI-published mirrors. Direct pushes are blocked via branch protection. README redirects to
   the monorepo.

5. **Independent Versioning**: App, db, and schema maintain separate version numbers and release
   cycles. Prefixed tags (`db/v*`, `schema/v*`) trigger package-specific workflows.

### Edge Cases

| Scenario                                   | Expected Behavior                       | Notes                                                    |
| ------------------------------------------ | --------------------------------------- | -------------------------------------------------------- |
| Empty `PRAXRR_DEFAULT_DB_URL`              | Skip auto-link entirely                 | Prevents auto-link for users who don't want a default DB |
| Custom PCD with schema dependency URL      | Still works via git clone               | PCD dependency system is URL-agnostic                    |
| Schema directory named differently in deps | `loadOps.ts` scans for `*schema*`       | Already flexible (line 39)                               |
| Auto-link failure on startup               | Marks as linked, does not retry         | Existing behavior preserved                              |
| Mirror publish failure                     | External repos stay on previous version | Monorepo is source of truth; re-run workflow to fix      |

### Success Criteria

- [ ] `packages/praxrr-db` and `packages/praxrr-schema` exist as Deno workspace members with
      `deno.json` manifests
- [ ] `deno task generate:pcd-types` generates types from `packages/praxrr-schema/ops/0.schema.sql`
      without GitHub API
- [ ] Auto-link default DB URL and branch are configurable via `PRAXRR_DEFAULT_DB_URL` and
      `PRAXRR_DEFAULT_DB_BRANCH`
- [ ] CI gate validates app + schema + db compatibility on every PR touching any package
- [ ] Mirror pipeline pushes `packages/praxrr-db` to `yandy-r/praxrr-db` and
      `packages/praxrr-schema` to `yandy-r/praxrr-schema`
- [ ] Custom PCD linking via any git URL continues to work identically
- [ ] All existing tests pass (`deno task test`, `deno task check`, `deno task test:e2e`)
- [ ] Independent versioning with prefixed tags (`db/v*`, `schema/v*`)
- [ ] No breaking changes to `pcd.json` manifest contract
- [ ] Build pipelines (`deno task build`, Docker, release) work correctly

### Final Verification Matrix

| criterion                                      | check command/workflow                                                                                                                                                                                         | owner                                                                  | pass signal                                                                                           | evidence link                                                                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Workspace members added with package manifests | `test -f packages/praxrr-db/deno.json && test -f packages/praxrr-schema/deno.json && jq -e '.workspace                                                                                                         | contains(["packages/praxrr-db", "packages/praxrr-schema"])' deno.json` | Monorepo lead (`Task 1.3`)                                                                            | Command exits 0; both package manifests exist                                                                                                                                                    | [`deno.json`](../../deno.json), [`parallel-plan.md`](parallel-plan.md) |
| Types generated from local schema file         | `deno task generate:pcd-types --local=packages/praxrr-schema/ops/0.schema.sql`                                                                                                                                 | Tooling lead (`Task 2.2`)                                              | Exit code 0; local schema file used without remote fetch fallback                                     | [`scripts/generate-pcd-types.ts`](../../scripts/generate-pcd-types.ts), [`scripts/compat-check.ts`](../../scripts/compat-check.ts)                                                               |
| Configurable default DB auto-link env vars     | `rg -n PRAXRR_DEFAULT_DB_URL src/hooks.server.ts && rg -n PRAXRR_DEFAULT_DB_BRANCH src/hooks.server.ts && rg -n PRAXRR_DEFAULT_DB_NAME src/hooks.server.ts`                                                    | Runtime lead (`Task 2.1`)                                              | `src/hooks.server.ts` references all three vars and handles empty `PRAXRR_DEFAULT_DB_URL` as disabled | [`src/hooks.server.ts`](../../src/hooks.server.ts), [`README.md`](../../README.md)                                                                                                               |
| CI compatibility gate for changed packages     | `gh workflow run "Compatibility Gates" --ref main; gh run list --workflow "Compatibility Gates" --limit 5 --json conclusion`                                                                                   | CI owner (`Task 3.2`, `Task 5.1`)                                      | Compatibility workflow runs for relevant package/app path changes and reports green check results     | [Compatibility workflow](https://github.com/yandy-r/praxrr/actions/workflows/compatibility.yml), [Cutover preflight](cutover-checklist.md#preflight)                                             |
| Mirror publish for db/schema packages          | `gh workflow run publish-db.yml --ref main; gh workflow run publish-schema.yml --ref main`                                                                                                                     | Release lead (`Task 4.1`, `Task 4.2`)                                  | Both mirror workflows trigger and succeed in dry-run before any release-tag publish                   | [DB mirror workflow](https://github.com/yandy-r/praxrr/actions/workflows/publish-db.yml), [Schema mirror workflow](https://github.com/yandy-r/praxrr/actions/workflows/publish-schema.yml)       |
| Custom PCD URL linking unchanged               | `deno test` (or scoped PCD integration subset including git-url fixtures)                                                                                                                                      | App lead (`Task 2.3`)                                                  | Custom git URL linking paths remain green in integration coverage                                     | [`src/lib/server/pcd/git/dependencies.ts`](../../src/lib/server/pcd/git/dependencies.ts), [`src/lib/server/pcd/manifest/manifest.ts`](../../src/lib/server/pcd/manifest/manifest.ts)             |
| Existing tests remain green                    | `deno task test && deno task check && deno task test:e2e`                                                                                                                                                      | QA owner (`Task 5`)                                                    | All command groups exit 0                                                                             | [`analysis-tasks.md`](analysis-tasks.md), [`cutover-checklist.md`](cutover-checklist.md)                                                                                                         |
| Independent `db/v*` and `schema/v*` versioning | `test -f release-please-config.json && test -f .release-please-manifest.json && jq -e '.packages["."] and .packages["packages/praxrr-db"] and .packages["packages/praxrr-schema"]' release-please-config.json` | Release lead (`Task 4.3`)                                              | Release config defines component-level version entries for app, db, and schema packages               | [`release-please-config.json`](../../release-please-config.json), [`.release-please-manifest.json`](../../.release-please-manifest.json)                                                         |
| `pcd.json` manifest contract preserved         | `deno task check`                                                                                                                                                                                              | Data model owner (`Task 2.3`)                                          | Type-check and contract tests still pass with unchanged manifest dependency semantics                 | [`src/lib/server/pcd/manifest/manifest.ts`](../../src/lib/server/pcd/manifest/manifest.ts), [`src/lib/server/pcd/manifest/manifest.test.ts`](../../src/lib/server/pcd/manifest/manifest.test.ts) |
| Build/release pipelines still succeed          | `deno task build && deno task lint && rg -n compatibility-gate .github/workflows/release.yml`                                                                                                                  | Release owner (`Task 4.4`, `Task 5.1`)                                 | Root build succeeds and release workflow enforces compatibility gate for `app/v*` tags only           | [Release workflow](../../.github/workflows/release.yml), [cutover checklist rollout](cutover-checklist.md#rollout)                                                                               |

## Technical Specifications

### Architecture Overview

```text
praxrr/                              # Repository root
|-- src/                             # SvelteKit app (stays at root)
|   |-- hooks.server.ts              # Startup + auto-link (configurable env vars)
|   |-- lib/server/pcd/              # PCD system
|   |-- routes/                      # SvelteKit routes + API
|   `-- tests/                       # App tests
|-- packages/
|   |-- praxrr-api/                  # API spec (existing workspace member)
|   |-- praxrr-db/                   # PCD database source (NEW)
|   |   |-- ops/                     # Base SQL operations
|   |   |-- tweaks/                  # Tweak operations
|   |   |-- pcd.json                 # Manifest
|   |   `-- deno.json                # Package config
|   `-- praxrr-schema/               # PCD schema definitions (NEW)
|       |-- ops/0.schema.sql         # Canonical schema DDL
|       |-- pcd.json                 # Manifest
|       `-- deno.json                # Package config
|-- scripts/
|   `-- bundle-api.ts                # Cross-package script (stays at root)
|-- .github/workflows/
|   |-- ci.yml                       # Path-filtered CI with aggregation gate
|   |-- compatibility.yml            # Cross-package contract tests (NEW)
|   |-- publish-db.yml               # Mirror to yandy-r/praxrr-db (NEW)
|   |-- publish-schema.yml           # Mirror to yandy-r/praxrr-schema (NEW)
|   |-- docker.yml                   # Docker build (unchanged context)
|   |-- release.yml                  # App release (unchanged)
|   `-- publish-api.yml              # JSR publish (unchanged)
|-- deno.json                        # Root workspace config
|-- deno.lock                        # Shared lockfile
`-- CLAUDE.md                        # Updated with workspace layout
```

### Data Models

#### New Environment Variables

| Env Var                    | Purpose                                       | Default Value                          |
| -------------------------- | --------------------------------------------- | -------------------------------------- |
| `PRAXRR_DEFAULT_DB_URL`    | Repository URL for auto-link on first startup | `https://github.com/yandy-r/praxrr-db` |
| `PRAXRR_DEFAULT_DB_BRANCH` | Branch to clone for auto-link                 | `v2`                                   |
| `PRAXRR_DEFAULT_DB_NAME`   | Display name for auto-linked database         | `Praxrr-DB`                            |

#### Hardcoded References to Decouple

| File                                            | Line | Reference                                    | Proposed Change                                            |
| ----------------------------------------------- | ---- | -------------------------------------------- | ---------------------------------------------------------- |
| `src/hooks.server.ts`                           | 54   | `'https://github.com/yandy-r/praxrr-db'`     | Read from `PRAXRR_DEFAULT_DB_URL` env var                  |
| `src/hooks.server.ts`                           | 55   | `'v2'`                                       | Read from `PRAXRR_DEFAULT_DB_BRANCH` env var               |
| `scripts/generate-pcd-types.ts`                 | 19   | `'yandy-r/praxrr-schema'`                    | Default to local `packages/praxrr-schema/ops/0.schema.sql` |
| `src/routes/databases/[id]/config/+page.svelte` | 316  | `'https://github.com/yandy-r/praxrr-schema'` | Use configurable schema URL                                |
| `src/lib/shared/pcd/types.ts`                   | 6    | Generated comment with schema URL            | Cosmetic, auto-regenerated                                 |

#### Package Manifests

```jsonc
// packages/praxrr-schema/deno.json
{
  "name": "@yandy-r/praxrr-schema",
  "version": "1.0.0",
  "exports": "./mod.ts",
}
```

```jsonc
// packages/praxrr-db/deno.json
{
  "name": "@yandy-r/praxrr-db",
  "version": "2.0.0",
}
```

#### Root Workspace Config Update

```jsonc
// deno.json (root) - add new members to existing workspace array
{
  "workspace": ["packages/praxrr-api", "packages/praxrr-db", "packages/praxrr-schema"],
}
```

### API Design

No new API endpoints. The existing `/api/v1/*` endpoints are unaffected. The PCD linking flow
(`pcdManager.link()`) continues to accept any git URL.

### System Integration

#### Files to Create

- `packages/praxrr-db/deno.json`: Package manifest (name, version)
- `packages/praxrr-db/ops/`: Base SQL operations (imported from external repo with history)
- `packages/praxrr-db/pcd.json`: PCD manifest (copied from external repo)
- `packages/praxrr-db/README.md`: Package documentation
- `packages/praxrr-schema/deno.json`: Package manifest (name, version, exports)
- `packages/praxrr-schema/ops/0.schema.sql`: Canonical schema DDL (imported from external repo with
  history)
- `packages/praxrr-schema/pcd.json`: PCD manifest (copied from external repo)
- `packages/praxrr-schema/README.md`: Package documentation
- `.github/workflows/compatibility.yml`: Cross-package contract tests
- `.github/workflows/publish-db.yml`: Mirror publish to `yandy-r/praxrr-db`
- `.github/workflows/publish-schema.yml`: Mirror publish to `yandy-r/praxrr-schema`
- `release-please-config.json`: Release-please manifest configuration
- `.release-please-manifest.json`: Version tracking

#### Files to Modify

- `deno.json` (root): Expand workspace array to include `praxrr-db` and `praxrr-schema`
- `src/hooks.server.ts`: Replace hardcoded auto-link URL/branch with configurable env vars
- `scripts/generate-pcd-types.ts`: Default to local schema path with `--remote` fallback
- `src/routes/databases/[id]/config/+page.svelte`: Make locked schema dependency URL configurable
- `CLAUDE.md`: Update env vars section, add workspace layout documentation
- `README.md`: Add monorepo structure overview

#### Configuration

- `MIRROR_PAT` GitHub secret: Personal access token for push access to mirror repos
- Branch protection on `yandy-r/praxrr-db` and `yandy-r/praxrr-schema`: Allow only CI bot pushes

## UX Considerations

### User Workflows

#### Primary Workflow: Cross-Package Atomic Change

1. **Edit Schema**: Modify `packages/praxrr-schema/ops/0.schema.sql`
   - System: LSP provides SQL syntax support
2. **Regenerate Types**: Run `deno task generate:pcd-types --local`
   - System: Reads local schema, writes updated `src/lib/shared/pcd/types.ts`
3. **Add DB Ops**: Create/edit SQL files in `packages/praxrr-db/ops/`
   - System: No validation at this step (validated in CI)
4. **Update App Code**: Modify handlers in `src/lib/server/pcd/`
   - System: TypeScript catches type mismatches immediately
5. **Run Tests**: `deno task test` + `deno task check`
   - System: Validates app, schema, and ops compatibility
6. **Commit**: Single commit with `feat: add support for [feature]`
   - System: CI runs path-filtered jobs, aggregation gate reports pass/fail

#### Error Recovery Workflow

1. **Error Occurs**: CI `validate-pcd-compat` job fails
2. **User Sees**: Job name indicates which package broke, test output identifies the incompatibility
3. **Recovery**: Fix the schema/ops/app code, push updated commit, CI re-runs

### UI Patterns

| Component        | Pattern                                     | Notes                                                              |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| CI Status        | Single `ci/gate` required check             | Aggregation job pattern; individual package jobs are informational |
| Job Naming       | `ci / test-app`, `ci / validate-pcd-compat` | Package name in job for at-a-glance diagnosis                      |
| Migration Notice | Archive external repos with redirect README | Standard open-source migration pattern                             |

### Accessibility Requirements

- No end-user-facing UI changes. The monorepo transition is a developer/maintainer experience change
  only.

### Performance UX

- **Loading States**: No change to app loading behavior
- **Type Generation**: Faster with local schema (no GitHub API fetch)
- **CI**: Path-filtered jobs skip unchanged packages, reducing CI time for single-package changes

## Recommendations

### Implementation Approach

**Recommended Strategy**: Keep the SvelteKit app at the repository root. Add `packages/praxrr-db`
and `packages/praxrr-schema` as workspace members alongside the existing `packages/praxrr-api`. Use
`git subtree split` for automated mirroring. This achieves the core goals (atomic commits,
compatibility gates, publish pipelines, configurable defaults) with lowest risk.

**Phasing:**

1. **Phase 1 - Scaffolding**: Create package directories, `deno.json` manifests, import content from
   external repos with history preservation via `git filter-repo`
2. **Phase 2 - Runtime Decoupling**: Configurable auto-link env vars, local schema type generation
   default, update generate-pcd-types.ts
3. **Phase 3 - Contract Testing**: CI gates for schema-types freshness, PCD compilation smoke test,
   cross-package type checking
4. **Phase 4 - CI/Publish Pipelines**: Mirror publish workflows via `git subtree split`,
   release-please configuration, provenance metadata
5. **Phase 5 - Cutover**: Freeze external repos, archive READMEs, update contributor docs,
   CLAUDE.md, tag initial monorepo release

### Technology Decisions

| Decision             | Recommendation                                                                          | Rationale                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| App location         | Keep at repo root                                                                       | Moving to `packages/praxrr` would break 20+ path aliases, Dockerfile, all CI workflows. Risk far outweighs benefit. |
| Workspace model      | Deno native workspaces                                                                  | Already in use for `praxrr-api`; native bare specifier resolution; no Nx/Turborepo overhead                         |
| Mirror strategy      | `git subtree split` + GitHub Actions                                                    | Clean history, no external deps, battle-tested (Symfony, Apollo). Upgrade to `splitsh-lite` if perf degrades.       |
| Version management   | release-please with `simple` type                                                       | Language-agnostic, Conventional Commits-based, manifest mode for independent versioning                             |
| CI approach          | `dorny/paths-filter` + aggregation gate                                                 | Selective job execution + single required status check solves GitHub Actions monorepo problem                       |
| History preservation | `git filter-repo --to-subdirectory-filter` for import, `git mv` for any future app move | SHA-stable history outweighs `--follow` inconvenience                                                               |
| Lockfile             | Single `deno.lock` at root                                                              | Deno workspace default; db/schema packages have no Deno deps                                                        |

### Quick Wins

- **Configurable default DB URL**: Add `PRAXRR_DEFAULT_DB_URL` / `PRAXRR_DEFAULT_DB_BRANCH` to
  `hooks.server.ts` -- standalone change, no monorepo structure required
- **Local schema type generation**:
  `deno task generate:pcd-types --local=packages/praxrr-schema/ops/0.schema.sql` works immediately
  once schema package is co-located
- **Workspace extension**: Adding new members to root `deno.json` workspace array is a one-line
  change

### Future Enhancements

- **Full app move to `packages/praxrr`**: Can be attempted as Phase 6 after monorepo infrastructure
  is stable, if desired. Requires 20+ path alias updates, Dockerfile rewrite, CI refactoring.
- **Local PCD dependency resolution**: Add workspace-aware resolution mode to `dependencies.ts` that
  reads from `packages/praxrr-schema/ops/` instead of git clone
- **Pre-commit type freshness hook**: Regenerate types and fail if uncommitted changes exist
- **Comprehensive validation task**: Root `deno task ok` (inspired by deno-std) that runs lint +
  format + type check + test + PCD compat + types freshness

## Risk Assessment

### Technical Risks

| Risk                                             | Likelihood | Impact | Mitigation                                                                                   |
| ------------------------------------------------ | ---------- | ------ | -------------------------------------------------------------------------------------------- |
| SvelteKit path resolution breaks after app move  | High       | High   | Do not move app. Keep at root. Defer to optional Phase 6.                                    |
| Docker build context breaks                      | Medium     | High   | App at root means Dockerfile COPY unchanged. db/schema packages not in Docker image.         |
| `deno.lock` conflicts during workspace expansion | Medium     | Low    | Run `deno install --node-modules-dir` after workspace changes to regenerate cleanly.         |
| Subtree split produces confusing mirror history  | Low        | Medium | External repos get clean linear history. Document that direct pushes to mirrors are blocked. |
| Vite + Deno workspace bare specifier mismatch    | Medium     | Medium | SvelteKit uses its own alias config. App at root avoids cross-member import complexity.      |
| Type generation breaks during transition         | Low        | Medium | `--local` flag already exists and is tested. Transition is incremental.                      |

### Integration Challenges

- **Hardcoded URLs in multiple layers**: Different mitigation per layer -- env vars for runtime,
  config constants for scripts, data migration for persisted manifest entries
- **PCD dependency system assumes git repos**: Workspace resolution would need a new code path;
  recommended to defer and continue using git-based resolution even for default DB
- **External repo consumers**: Mirror publish failure leaves external consumers on stale versions.
  Workflow alerting and manual re-run mitigate this.

### Security Considerations

- **`MIRROR_PAT` secret**: Must have write access only to `yandy-r/praxrr-db` and
  `yandy-r/praxrr-schema`. Use a fine-grained PAT scoped to those repos.
- **Force-push to mirrors**: Branch protection on mirror repos should only allow the CI bot.

## Task Breakdown Preview

### Phase 1: Scaffolding

**Focus**: Create monorepo directory structure and import external repo contents with history.
**Tasks**:

- Import `praxrr-schema` repo into `packages/praxrr-schema/` via
  `git filter-repo --to-subdirectory-filter`
- Import `praxrr-db` repo into `packages/praxrr-db/` via `git filter-repo --to-subdirectory-filter`
- Create `deno.json` manifests for both packages
- Expand root `deno.json` workspace array
- Validate `deno install`, `deno task check`, `deno task test` all pass **Parallelization**: Schema
  and db package creation/import can happen simultaneously

### Phase 2: Runtime Decoupling

**Focus**: Make hardcoded references configurable, enable local schema type generation.
**Dependencies**: Phase 1 complete **Tasks**:

- Add `PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`, `PRAXRR_DEFAULT_DB_NAME` env vars to
  `hooks.server.ts`
- Update `generate-pcd-types.ts` to default to local schema path
- Update locked schema dependency in database config UI
- Document new env vars in CLAUDE.md, README, compose files

### Phase 3: Contract Testing

**Focus**: CI gates for cross-package compatibility. **Dependencies**: Phase 2 complete **Tasks**:

- Create compatibility workflow: generate types from local schema, diff against committed types
- Add PCD compile smoke test: compile cache from workspace db+schema ops
- Add `deno check` step for all workspace members **Parallelization**: Type freshness check and PCD
  compile check can be developed simultaneously

### Phase 4: CI/Publish Pipelines

**Focus**: Mirror publishing and independent versioning. **Dependencies**: Phase 2 complete (can
overlap with Phase 3) **Tasks**:

- Create `publish-db.yml` and `publish-schema.yml` workflows with `git subtree split`
- Configure release-please manifest for independent versioning
- Define tag format: `db/v*`, `schema/v*`
- Dry-run publish to external repos **Parallelization**: db and schema publish workflows developed
  simultaneously

### Phase 5: Cutover

**Focus**: Documentation, communication, and contributor onboarding. **Dependencies**: All other
phases complete **Tasks**:

- Freeze direct pushes to external repos, add "mirror" READMEs
- Update CLAUDE.md with workspace conventions
- Update root README with directory map
- Add per-package READMEs
- Create CONTRIBUTING.md with monorepo guidance

## Decisions Needed

Before proceeding to implementation planning, clarify:

1. **App Location (Critical)**
   - Options: (A) Keep app at repo root, add db/schema to packages/ (recommended). (B) Move app to
     `packages/praxrr` as Issue #37 specifies.
   - Impact: Option B adds 5-7 days, touches every config file, high regression risk. Option A
     achieves all core acceptance criteria with minimal disruption.
   - Recommendation: Option A. Defer app move to optional Phase 6 after infrastructure is proven.

2. **External Repo Strategy After Cutover**
   - Options: (A) Read-only mirrors with CI publish. (B) Writable with bidirectional sync.
   - Impact: Option B adds significant complexity (merge conflict resolution, sync races).
   - Recommendation: Option A (read-only mirrors).

3. **Tag Naming Convention**
   - Options: (A) Prefixed tags: `db/v2.1.0`, `schema/v1.1.0`. (B) Keep `v*` for app, separate
     namespaces for packages.
   - Impact: Affects CI trigger patterns and release-please configuration.
   - Recommendation: Option A (prefixed tags with `/` separator).

4. **History Import Method**
   - Options: (A) `git filter-repo --to-subdirectory-filter` + merge (preserves full history). (B)
     Copy files without history.
   - Impact: Option A preserves git blame/log across the import. Option B is simpler but loses
     history.
   - Recommendation: Option A for schema and db repos.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Deno workspace tooling, git subtree strategies,
  CI/CD patterns, migration tools, version management
- [research-business.md](./research-business.md): PCD manifest contract, ops layering, hardcoded
  coupling points, user stories
- [research-technical.md](./research-technical.md): Directory structure, configuration changes,
  build system updates, 5-phase migration sequence
- [research-ux.md](./research-ux.md): Developer workflows, CI feedback patterns, migration
  communication, competitive analysis
- [research-recommendations.md](./research-recommendations.md): Alternative approaches, risk
  assessment, phasing strategy, task breakdown
