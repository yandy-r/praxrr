# UX Research: monorepo-strategy

## Executive Summary

The monorepo transition is primarily a developer/maintainer experience change. The critical DX wins
are atomic cross-package commits (eliminating the three-PR coordination dance), local type
generation from schema (removing the GitHub API dependency), and single-clone onboarding. Deno 2.x
native workspace support provides the foundational tooling without requiring Nx/Turborepo overhead.
The key UX risks are CI feedback clarity for cross-package failures, contributor disorientation
during the transition period, and maintaining the external PCD consumer workflow through mirror
publishing. The recommended approach is to keep the SvelteKit app at the repository root (not nested
in `packages/`), add `packages/praxrr-db` and `packages/praxrr-schema` as workspace members
alongside the existing `packages/praxrr-api`, and use path-filtered GitHub Actions with an
aggregation job for CI gating.

**Confidence**: High -- based on Deno workspace documentation, real-world monorepo patterns from
Graphite/Apollo/Svelte/deno-std, and GitHub Actions monorepo CI patterns from multiple authoritative
sources.

## User Workflows

<!-- Developer workflows (primary users of a monorepo are developers) -->

### Primary Flow: Daily Development

#### 1. Clone/Setup

**Best Practice**: One-command setup that builds everything from a single clone.

The monorepo should support `git clone` followed by a single `deno task dev` to boot the full
development environment. This is Graphite's "north star" pattern: one command boots everything
([source](https://graphite.com/blog/how-we-organize-our-monorepo-to-ship-fast)). Since Deno
workspaces automatically resolve inter-package imports via bare specifiers (`@scope/package`), no
separate install or link step is needed for workspace members
([source](https://docs.deno.com/runtime/fundamentals/workspaces/)).

**Confidence**: High -- Deno workspace documentation confirms automatic import resolution across
members.

**Praxrr-specific considerations**:

- Contributors currently need to clone only `praxrr` for the app, but schema changes require
  separate clone of `praxrr-schema` and manual type generation. After the transition, the single
  clone gives access to everything.
- The existing `deno task dev` (which starts both parser and Vite dev server) should continue
  working unchanged if the app stays at the repository root.
- No new package manager or build orchestrator is needed. Deno's native workspace support handles
  dependency resolution, task running, and type checking across members.

#### 2. Navigate

**Best Practice**: IDE-native navigation with minimal configuration overhead.

Deno's language server (since v1.45) automatically detects `deno.json` files in subdirectories and
creates separate scopes for type checking and module resolution per workspace member
([source](https://deno.com/blog/v1.45)). This means VSCode with the Deno extension already provides:

- Correct import resolution across workspace members
- Per-member type checking environments
- Go-to-definition across package boundaries

**Confidence**: High -- confirmed by Deno workspace documentation and VSCode Deno extension
behavior.

**Additional navigation aids**:

- A `.vscode/settings.json` committed to the repo should enable `deno.enable: true` for the
  workspace, and extension recommendations via `.vscode/extensions.json` should include the Deno
  extension
  ([source](https://medium.com/rewrite-tech/visual-studio-code-tips-for-monorepo-development-with-multi-root-workspaces-and-extension-6b69420ecd12)).
- Package READMEs serve as in-IDE documentation when a developer opens a package directory. Each
  `packages/*/README.md` should include: purpose, owned files, key exports, and how to run tests
  ([source](https://www.tweag.io/blog/2023-04-04-python-monorepo-1/)).

#### 3. Develop

**Best Practice**: Cross-package changes should feel like single-package changes.

The key workflow improvement is making schema-to-app changes atomic:

**Before (current)**: Edit schema in `praxrr-schema` repo -> push -> run
`deno task generate:pcd-types --version=tag` -> edit app code -> commit app changes. Three repos,
three PRs, version coordination required.

**After (proposed)**: Edit `packages/praxrr-schema/ops/0.schema.sql` -> run
`deno task generate:pcd-types --local` -> edit app code -> commit everything in one PR. Single repo,
single PR, atomic guarantee.

Deno workspace members can reference each other via bare specifiers. For example, if
`packages/praxrr-schema` defines `"name": "@praxrr/schema"` in its `deno.json`, the app code and
`packages/praxrr-db` can import from `@praxrr/schema` without file paths
([source](https://docs.deno.com/runtime/fundamentals/workspaces/)).

**Confidence**: High -- the `--local` flag for type generation already exists in the codebase per
the business research document.

#### 4. Test

**Best Practice**: Run only affected tests, with a way to run everything.

Deno workspace commands automatically respect member boundaries
([source](https://docs.deno.com/runtime/fundamentals/workspaces/)):

| Command                                    | Scope                                                   |
| ------------------------------------------ | ------------------------------------------------------- |
| `deno test` (from root)                    | Runs tests across all members                           |
| `deno task --filter "@praxrr/schema" test` | Runs tests for a specific member                        |
| `deno test packages/praxrr-db/`            | Runs tests scoped to a directory                        |
| `deno task test` (existing)                | Continues to run app tests via the root task definition |

The existing test aliases (`deno task test filters`, `deno task test upgrades`, etc.) should
continue working since they are defined in the root `deno.json` and operate on app-level test paths.

**Confidence**: High -- Deno workspace task filtering is documented with `--filter` and
`--recursive` flags.

#### 5. Commit

**Best Practice**: Conventional commits with package scopes.

The project already uses conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`). For
monorepo changes, the scope should indicate which package is affected
([source](https://www.adaltas.com/en/2021/02/02/js-monorepos-commits-changelog/)):

| Change Type          | Commit Example                                                         |
| -------------------- | ---------------------------------------------------------------------- |
| App-only change      | `feat(app): add Lidarr metadata profile support`                       |
| Schema change        | `feat(schema): add lidarr_metadata_profiles table`                     |
| DB ops change        | `feat(db): add default Lidarr metadata profile ops`                    |
| Cross-package change | `feat: add Lidarr metadata profile support` (no scope = cross-cutting) |

The Angular convention (widely adopted for monorepos) recommends that scopes match package names
([source](https://www.conventionalcommits.org/en/about/)). When a commit touches multiple packages,
either omit the scope or use the primary affected package.

**Confidence**: Medium -- this is a convention choice, not a tooling requirement. The pattern is
well-established but the exact scope names (`app`/`schema`/`db` vs full package names) are a
project-level decision.

### Alternative Flows

#### Single-Package Change

The simplest case. A developer edits files within one package directory, runs that package's tests,
and commits with the appropriate scope. No cross-package validation needed beyond CI.

Example: Adding a new base op to `packages/praxrr-db/ops/`:

1. Create/edit the SQL file in `packages/praxrr-db/ops/`
2. Run `deno test packages/praxrr-db/` (if DB has its own tests)
3. Commit: `feat(db): add custom format for DV HDR10Plus`
4. CI validates the op compiles correctly against the current schema

#### Cross-Package Atomic Change

The primary workflow improvement. Example: Adding a new PCD table that requires schema DDL, base
ops, and app code changes.

1. Edit `packages/praxrr-schema/ops/0.schema.sql` -- add the new table DDL
2. Run `deno task generate:pcd-types --local` -- regenerate TypeScript types from local schema
3. Edit `packages/praxrr-db/ops/` -- add base ops that populate the new table
4. Edit `src/lib/server/pcd/` (app code) -- add handlers for the new entity
5. Run `deno task test` -- verify everything compiles and tests pass
6. Commit: `feat: add support for delay profiles`
7. CI validates all three packages together in a single PR

**Confidence**: High -- this is the primary motivation for the monorepo transition, and the workflow
maps directly to the existing `--local` type generation capability.

## Contributor Onboarding

### Documentation Structure

#### Root README

The root README should serve as the entry point for all contributors. Best practice from the
deno-std and Svelte monorepos: the root README provides a high-level project overview, quick-start
commands, and a directory map pointing to each package
([source](https://www.aviator.co/blog/monorepo-a-hands-on-guide-for-managing-repositories-and-microservices/)).

**Recommended root README additions**:

```
## Repository Structure

packages/
  praxrr-api/    # OpenAPI spec + generated TypeScript types (published to JSR)
  praxrr-db/     # Default PCD database (base ops + tweaks)
  praxrr-schema/ # PCD schema DDL (table definitions)
src/               # Main SvelteKit application
  lib/
    server/        # Server-side: PCD system, DB, sync, jobs
    client/        # Client-side: UI components, stores
    shared/        # Shared types and utilities
  routes/          # SvelteKit routes (pages + API)
  services/        # Parser microservice (C#)
```

**Confidence**: High -- this pattern is standard across all surveyed monorepos (deno-std, Svelte,
Graphite).

#### Per-Package READMEs

Each package directory should contain a README that answers
([source](https://www.tweag.io/blog/2023-04-04-python-monorepo-1/),
[source](https://www.aviator.co/blog/monorepo-a-hands-on-guide-for-managing-repositories-and-microservices/)):

1. **What is this?** -- One-paragraph purpose statement
2. **Who owns this?** -- Maintainer contacts or CODEOWNERS reference
3. **How do I develop on it?** -- Local dev commands
4. **How does it relate to other packages?** -- Dependency direction
5. **How is it released?** -- Independent versioning and publish strategy

Example for `packages/praxrr-schema/README.md`:

```
# @praxrr/schema

PCD schema definitions -- DDL-only SQL files that define the table structure
for all Praxrr Config Database instances.

## Relationship to Other Packages
- Consumed by: `@praxrr/db` (as a dependency in pcd.json)
- Consumed by: The main app (via type generation from schema SQL)
- Does NOT depend on any other workspace member

## Development
- Edit `ops/0.schema.sql` to modify table definitions
- Run `deno task generate:pcd-types --local` from the repo root to regenerate types
- Run `deno test` from the repo root to verify app compatibility

## Release
Published independently to `yandy-r/praxrr-schema` via mirror workflow.
Version tags: `schema-v*.*.*`
```

**Confidence**: High -- per-package READMEs are universally recommended across monorepo literature.

#### CONTRIBUTING.md Updates

The existing CONTRIBUTING.md (or creation of one) should address monorepo-specific guidance:

- **Which package should I change?** -- Decision tree for where to put schema changes, op changes,
  and app code changes.
- **How do I make cross-package changes?** -- Step-by-step guide matching the "Cross-Package Atomic
  Change" flow above.
- **How do I test my changes?** -- Package-scoped and full test commands.
- **Commit conventions** -- Scope naming per package.

**Confidence**: Medium -- the project does not appear to have a CONTRIBUTING.md yet, so this is a
new document rather than an update.

#### Architecture Decision Records

For the monorepo transition itself, an ADR documenting the "why" is valuable for future contributors
who encounter the structure and wonder about the rationale. The business research document
(`research-business.md`) already captures this context. Converting it to a concise ADR format
(Context -> Decision -> Consequences) in `docs/` would serve this purpose.

**Confidence**: Medium -- ADRs are a best practice but not universally adopted. The existing
`docs/plans/` structure may serve a similar role.

### Navigation Aids

| Aid                          | How to Implement                                                           | Benefit                                 |
| ---------------------------- | -------------------------------------------------------------------------- | --------------------------------------- |
| Root directory map in README | Markdown tree with one-line descriptions                                   | First thing a contributor sees          |
| Per-package README           | Template with purpose, dev commands, dependencies                          | In-IDE context when exploring a package |
| `.vscode/extensions.json`    | Recommend Deno extension, Svelte extension                                 | Correct IDE behavior from first open    |
| `.vscode/settings.json`      | Enable Deno, set format-on-save, configure paths                           | Consistent DX across contributors       |
| `CLAUDE.md` updates          | Update path alias table, add package descriptions                          | AI-assisted development context         |
| `CODEOWNERS` file            | Map `packages/praxrr-db/**` and `packages/praxrr-schema/**` to maintainers | GitHub review routing                   |

**Confidence**: High -- these are standard patterns with no project-specific risk.

### Common Pitfalls for New Contributors

| Pitfall                                           | Prevention                                                                                                    | Source                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Editing the wrong package                         | Clear directory map + per-package READMEs explaining scope                                                    | [Aviator guide](https://www.aviator.co/blog/monorepo-a-hands-on-guide-for-managing-repositories-and-microservices/) |
| Running tests from wrong directory                | Document root-level commands that work everywhere                                                             | [Deno workspaces docs](https://docs.deno.com/runtime/fundamentals/workspaces/)                                      |
| Not regenerating types after schema change        | CI gate that compares generated types to committed types                                                      | Praxrr-specific                                                                                                     |
| Assuming packages are independent apps            | README stating that `praxrr-db` and `praxrr-schema` are data packages, not runnable apps                      | Praxrr-specific                                                                                                     |
| Committing to the wrong branch of a mirrored repo | Archive or mark read-only the external `praxrr-db`/`praxrr-schema` repos with README pointing to the monorepo | [Graphite migration guide](https://graphite.com/guides/migrating-to-monorepo-a-step-by-step-guide)                  |

**Confidence**: High -- these pitfalls are consistently reported in monorepo migration literature.

## Configuration UX

### Auto-Link Default Database

#### Current UX

On first startup, the app automatically links `https://github.com/yandy-r/praxrr-db` at branch `v2`
as the default PCD database. The URL and branch are hardcoded in `src/hooks.server.ts`. Three env
vars exist for optional git credentials (`PRAXRR_DEFAULT_DB_TOKEN`,
`PRAXRR_DEFAULT_DB_GIT_USERNAME`, `PRAXRR_DEFAULT_DB_GIT_EMAIL`), but URL and branch are not
configurable.

#### Proposed UX

Add two new environment variables that follow the existing naming convention:

| Variable                   | Default                                | Purpose                                          |
| -------------------------- | -------------------------------------- | ------------------------------------------------ |
| `PRAXRR_DEFAULT_DB_URL`    | `https://github.com/yandy-r/praxrr-db` | Git URL for the default auto-linked PCD database |
| `PRAXRR_DEFAULT_DB_BRANCH` | `v2`                                   | Branch/tag to checkout for the default database  |

This follows the "sensible defaults with override" pattern used across frameworks like Spring Boot,
ASP.NET Core, and FastAPI
([source](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/?view=aspnetcore-7.0),
[source](https://fastapi.tiangolo.com/advanced/settings/)):

1. **Default works out of the box** -- Users who install Praxrr get the canonical database
   automatically, identical to current behavior.
2. **Override via env var** -- Users who want a fork, mirror, or custom default database set the env
   var. No code change needed.
3. **Full customization via UI** -- Users can always add additional databases via the
   `/databases/new` UI route, regardless of the default.

**Confidence**: High -- the naming convention matches existing `PRAXRR_DEFAULT_DB_*` env vars, and
the pattern is a well-established industry standard.

#### Env Variable Design Principles

Based on industry patterns for configuration UX
([source](https://algocademy.com/blog/how-to-use-environment-variables-and-configuration-files-in-software-development/)):

1. **Prefix consistency**: All Praxrr-specific env vars use the `PRAXRR_` prefix. The new vars
   (`PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`) follow the existing `PRAXRR_DEFAULT_DB_*`
   pattern.
2. **Self-documenting names**: `URL` and `BRANCH` are unambiguous. Avoid abbreviations like `REPO`
   (could mean repository name vs URL).
3. **No env var for "disable auto-link"**: If a user does not want any default database, they can
   set `PRAXRR_DEFAULT_DB_URL` to an empty string. The auto-link code should check for non-empty
   value before proceeding.
4. **Docker and docker-compose friendly**: Env vars are the standard mechanism for container
   configuration. Document them in the Dockerfile, docker-compose.yml, and README.

### Best Practices from Industry

| Practice                                       | Application to Praxrr                                                                                   | Source                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Defaults should work without configuration     | Default URL continues to point to the published `praxrr-db` mirror                                      | Spring Boot pattern                                                                                        |
| Env vars override file config, not the reverse | Hardcoded defaults in code are lowest priority, env vars override                                       | [ASP.NET Core config hierarchy](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/) |
| Document all env vars in one place             | Add `PRAXRR_DEFAULT_DB_URL` and `PRAXRR_DEFAULT_DB_BRANCH` to the env var table in CLAUDE.md and README | Standard practice                                                                                          |
| Validate env var values at startup             | Log a warning if `PRAXRR_DEFAULT_DB_URL` is set but not a valid git URL                                 | Fail-fast principle                                                                                        |
| Support empty value as "disable"               | `PRAXRR_DEFAULT_DB_URL=""` should skip auto-link                                                        | Docker convention                                                                                          |

**Confidence**: High -- these patterns are universally applied in configuration management.

## Performance UX

<!-- CI/CD Feedback patterns -->

### Cross-Package Compatibility

The critical CI gate for the monorepo is validating that the app, schema, and DB ops are compatible
with each other on every PR. This is what eliminates the cross-repo version coordination problem.

#### Status Checks Strategy

**Recommended approach**: Path-filtered workflows with an aggregation job
([source](https://github.com/orgs/community/discussions/26251),
[source](https://oneuptime.com/blog/post/2026-01-26-monorepos-github-actions/view)).

The challenge with GitHub Actions in monorepos is that required status checks must correspond to
specific job names, but path-filtered workflows may not run at all if their paths are not touched.
The solution involves:

1. **A detection job** that uses `dorny/paths-filter` to determine which packages changed
   ([source](https://github.com/dorny/paths-filter)).
2. **Conditional package jobs** that run only when their package (or a dependency) is modified.
3. **An aggregation job** that always runs and reports a single pass/fail status. This is the only
   required status check in branch protection
   ([source](https://github.com/orgs/community/discussions/26251)).

Example workflow structure:

```yaml
jobs:
  detect-changes:
    outputs:
      app: ${{ steps.filter.outputs.app }}
      schema: ${{ steps.filter.outputs.schema }}
      db: ${{ steps.filter.outputs.db }}
    steps:
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            app:
              - 'src/**'
              - 'deno.json'
              - 'svelte.config.js'
            schema:
              - 'packages/praxrr-schema/**'
            db:
              - 'packages/praxrr-db/**'

  test-app:
    needs: detect-changes
    if: needs.detect-changes.outputs.app == 'true' || needs.detect-changes.outputs.schema == 'true'
    # App tests also run when schema changes (types may be affected)

  test-schema:
    needs: detect-changes
    if: needs.detect-changes.outputs.schema == 'true'

  validate-pcd-compat:
    needs: detect-changes
    if: needs.detect-changes.outputs.schema == 'true' || needs.detect-changes.outputs.db == 'true'
    # Validates schema + db ops compile together

  ci-gate:
    needs: [test-app, test-schema, validate-pcd-compat]
    if: always()
    # Aggregation job: checks all needed jobs passed or were skipped
```

**Confidence**: High -- this pattern is documented across multiple GitHub community discussions and
CI guides as the standard approach for monorepo required checks.

#### Error Messages: Making Failures Actionable

When a cross-package compatibility check fails, the developer needs to know:

1. **Which package broke** -- The job name should include the package (e.g., `test-app`,
   `validate-pcd-compat`)
2. **What specifically failed** -- The test output should identify the incompatibility (e.g.,
   "Column `lidarr_metadata_profiles.name` referenced in base op but not defined in schema")
3. **What to do about it** -- Link to the cross-package development workflow documentation

**Recommended job naming convention**:

- `ci / detect-changes` -- Change detection
- `ci / test-app` -- App unit tests and type checking
- `ci / test-schema` -- Schema validation
- `ci / validate-pcd-compat` -- Cross-package PCD compilation test
- `ci / check-types-generated` -- Verify generated types match local schema
- `ci / gate` -- Aggregation (the single required check)

**Confidence**: High -- clear job naming is a straightforward improvement with no technical risk.

#### Matrix Builds vs Serial Pipeline

| Approach                                     | Pros                                                      | Cons                                                            | Recommendation                                       |
| -------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| **Matrix build** (`strategy.matrix.package`) | Parallel execution, clear per-package status in GitHub UI | More complex YAML, harder to express cross-package dependencies | Use for independent package tests                    |
| **Serial pipeline** (job dependencies)       | Simple, clear dependency chain                            | Slower, one failure blocks everything                           | Use for validation that depends on multiple packages |
| **Hybrid** (matrix + aggregation)            | Best of both: parallel where possible, gated at the end   | Moderate YAML complexity                                        | Recommended approach                                 |

For Praxrr specifically, the hybrid approach works well because:

- `test-app` and `test-schema` can run in parallel (independent)
- `validate-pcd-compat` needs schema and db to be available but can run in parallel with `test-app`
- `ci-gate` aggregates all results

**Confidence**: High -- the hybrid approach is the most commonly recommended pattern for
small-to-medium monorepos.

### PR Feedback Patterns

| Pattern                                      | How It Helps Developers                                                      | Implementation                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Single required check** (`ci/gate`)        | Developers see one green/red check, not a matrix of conditional jobs         | Aggregation job in CI                                                        |
| **Job names include package**                | "Which thing broke?" is answered at a glance                                 | Descriptive job `name:` in workflow YAML                                     |
| **Cross-package compat as a separate check** | Distinguishes "my app code has a bug" from "schema and ops are incompatible" | Dedicated `validate-pcd-compat` job                                          |
| **Generated-types freshness check**          | Catches stale type generation before review                                  | Job that runs `generate:pcd-types --local` and diffs against committed types |
| **Comment on PR with affected packages**     | Reviewer immediately knows the blast radius                                  | GitHub Action that posts detected changes as a PR comment                    |

**Confidence**: High -- these patterns are standard GitHub Actions best practices for monorepos.

## Migration UX

### Communication Strategy

#### Pre-Migration Announcement

Before beginning the migration, communicate the plan to existing contributors
([source](https://graphite.com/guides/migrating-to-monorepo-a-step-by-step-guide)):

1. **GitHub Discussion or Issue**: Create an issue from a template (per project conventions)
   explaining what is changing, why, and the timeline. Link to the business research document for
   detailed rationale.
2. **README banner**: Add a temporary note to `praxrr-db` and `praxrr-schema` READMEs: "This
   repository is being consolidated into the [praxrr monorepo](link). See [issue #N] for details."
3. **Timing**: Execute the migration when there are no open PRs against the affected repos
   ([source](https://graphite.com/guides/migrating-to-monorepo-a-step-by-step-guide)).

**Confidence**: High -- timing around open PRs is a universally recommended practice for repo
restructuring.

#### During Migration

1. **Merge all in-flight PRs** or communicate a freeze window.
2. **Execute the structural change** in a single PR to the monorepo.
3. **Archive external repos** immediately after the merge, with README pointers to the new
   locations.

#### Post-Migration Announcement

1. **Update the archived repos' READMEs** with clear redirect:

   ```
   # praxrr-db (Archived)

   This repository has been consolidated into the
   [praxrr monorepo](https://github.com/yandy-r/praxrr).

   The database package now lives at `packages/praxrr-db/` in the monorepo.

   The mirror at this URL continues to receive updates
   for external PCD consumers.
   ```

2. **Release notes**: Include the monorepo transition in the next app release changelog.
3. **Discord/community**: If there is a community channel, post about the change with a link to the
   migration guide.

**Confidence**: High -- archiving repos with redirect READMEs is a standard, low-risk communication
strategy.

### Migration Guide

A migration guide should be published alongside the structural change. Target audience: existing
contributors who have local clones of the separate repos.

**Contents**:

1. **What changed**: `praxrr-db` and `praxrr-schema` now live inside `packages/` in the main
   `praxrr` repo.
2. **What you need to do**:
   - `git pull` on your existing `praxrr` clone to get the new structure.
   - Delete your local clones of `praxrr-db` and `praxrr-schema` (they are now inside the monorepo).
   - For schema changes: edit `packages/praxrr-schema/ops/0.schema.sql` directly.
   - For DB ops: edit files in `packages/praxrr-db/ops/` directly.
   - For type generation: `deno task generate:pcd-types --local` (no need to push schema first).
3. **What did NOT change**:
   - `deno task dev`, `deno task test`, `deno task build` -- all work the same.
   - Custom PCD linking via URL -- works the same.
   - The `pcd.json` manifest contract -- unchanged.
   - The mirror repos at `yandy-r/praxrr-db` and `yandy-r/praxrr-schema` -- still receive updates.
4. **New commit conventions**: Scoped commits per package (optional, recommended).

**Confidence**: High -- this follows the Graphite/Opaque migration guide patterns.

### Changelog Format

Use the existing conventional commit format. The transition itself should be documented as:

```
chore: consolidate praxrr-db and praxrr-schema into monorepo

BREAKING CHANGE: None. External PCD consumers are unaffected.
Schema and DB packages now live in packages/ within the main repository.
Mirror publishing to yandy-r/praxrr-db and yandy-r/praxrr-schema continues.
```

For ongoing changelog generation, conventional commits with package scopes naturally produce grouped
changelogs. Tools like Changesets ([source](https://github.com/changesets/changesets)) can generate
per-package changelogs, but given the small number of packages (3-4), manual changelog entries in
release notes are likely sufficient.

**Confidence**: Medium -- changelog tooling is a nice-to-have, not a requirement for this size
monorepo.

### Minimizing Disruption

| Strategy                            | Implementation                                                                                                     | Risk Reduction                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **Keep app at repo root**           | Do not move SvelteKit app into `packages/praxrr`                                                                   | Avoids updating every path alias, Dockerfile, CI workflow, and build script |
| **Phase the migration**             | Phase 1: add env var overrides. Phase 2: add packages + type gen from local. Phase 3: CI gates + mirror publishing | Each phase is independently shippable and rollback-safe                     |
| **Preserve external URLs**          | Mirror `packages/praxrr-db` to `yandy-r/praxrr-db` via CI                                                          | End users who depend on the external repo are unaffected                    |
| **No breaking changes to pcd.json** | The manifest contract stays the same                                                                               | Custom PCD repos continue working                                           |
| **Run both workflows temporarily**  | During transition, keep the existing CI and add new monorepo CI                                                    | Can compare results before removing the old pipeline                        |

**Confidence**: High -- phased migration is the lowest-risk approach and is recommended by all
migration guides surveyed.

## Competitive Analysis

### Deno Standard Library (deno-std)

**Repository**: [github.com/denoland/std](https://github.com/denoland/std)

**Approach**: 44+ workspace members in a single `deno.json` with a flat package structure
(`./assert`, `./async`, `./bytes`, etc.). Root `deno.json` defines strict shared compiler options
(`strict: true`, `exactOptionalPropertyTypes: true`), shared imports, and comprehensive tasks
(`test`, `lint`, `ok`). Each package has its own `deno.json` with `name` and `version` for
independent publishing to JSR.

**Strengths**:

- Flat structure (no `packages/` nesting) keeps paths short and navigation simple.
- Single `deno publish` command handles dependency-ordered publishing across all 44 packages.
- Strict shared TypeScript config enforces quality across all packages.
- Comprehensive root-level tasks (`ok` task runs lint + format + browser compat in one command).

**Relevant patterns for Praxrr**:

- Use `workspace: ["packages/*"]` glob pattern instead of listing each member explicitly, matching
  deno-std's approach to scalability.
- Define strict compiler options in the root `deno.json` that all packages inherit.
- Create a comprehensive validation task (like deno-std's `ok` task) that runs all checks.

**Confidence**: High -- deno-std is the canonical Deno workspace example, maintained by the Deno
team.

### Svelte Framework Monorepo

**Repository**: [github.com/sveltejs/svelte](https://github.com/sveltejs/svelte)

**Approach**: pnpm workspace with a deliberately minimal structure. The `packages/svelte/` directory
contains the sole published package. `playgrounds/sandbox/` provides a local development
environment. Root coordinates builds via pnpm's `-r` (recursive) and `--filter` flags
([source](https://deepwiki.com/sveltejs/svelte/1.1-project-structure)).

**Strengths**:

- Minimal package count keeps the monorepo comprehensible.
- The playground pattern provides a local testing environment without polluting the main package.
- Workspace protocol (`workspace:*`) ensures development always uses local packages.
- Build coordination via `pnpm build` runs builds in dependency order.

**Relevant patterns for Praxrr**:

- Keep the package count small (app root + 3 packages is similar to Svelte's focused approach).
- The "playground" concept could map to Praxrr's E2E test environment.
- Use workspace protocol for inter-package dependencies (Deno's equivalent: bare specifier imports
  via `name` field).

**Confidence**: High -- Svelte is a well-documented monorepo in the same ecosystem (Vite/SvelteKit).

### Graphite

**Repository**: Proprietary, but well-documented patterns
([source](https://graphite.com/blog/how-we-organize-our-monorepo-to-ship-fast))

**Approach**: `libs/` (shared libraries, public and private) + `apps/` (applications). Turborepo for
task orchestration. One-command setup (`yarn server-stg`). TypeScript everywhere with Zod for
runtime validation.

**Strengths**:

- "One-command setup" philosophy minimizes onboarding friction.
- Library-first architecture treats shared code as first-class citizens.
- 10x+ build speedups via Turborepo's dependency graph and caching.
- Functional style (pure functions over classes) makes cross-package refactoring safer.

**Relevant patterns for Praxrr**:

- Optimize for one-command setup (`deno task dev` should work from a fresh clone).
- Treat `packages/praxrr-schema` and `packages/praxrr-db` as data libraries, not applications.
- The "staging database" pattern (developers work against shared data) is analogous to how Praxrr's
  auto-linked default database works during development.

**Confidence**: Medium -- Graphite's patterns are well-documented but come from a larger engineering
organization than Praxrr's likely contributor base.

### Apollo GraphQL (Git Subtree Mirror)

**Repository**: [github.com/apollographql](https://github.com/apollographql)

**Approach**: Uses git subtrees to maintain monorepo development while publishing individual
packages to separate repositories. GitHub Actions workflow triggers on main branch merges, splits
changed subtrees, and pushes to remote repositories
([source](https://www.apollographql.com/blog/how-apollo-manages-swift-packages-in-a-monorepo-with-git-subtrees)).

**Strengths**:

- Single PRs capture cross-package changes (development efficiency).
- Independent versioning per package (distribution flexibility).
- Users receive focused packages, not the entire monorepo.
- Automated split-push avoids manual mirror management.

**Relevant patterns for Praxrr**:

- The subtree split-push pattern is directly applicable for mirroring `packages/praxrr-db` to
  `yandy-r/praxrr-db` and `packages/praxrr-schema` to `yandy-r/praxrr-schema`.
- Conditional push (only when changes are detected) avoids unnecessary mirror updates.
- The pattern preserves external consumers' workflows while centralizing development.

**Confidence**: High -- Apollo's pattern directly maps to Praxrr's requirement for maintaining
external PCD consumer repos.

## Recommendations

### Must Have

1. **Keep SvelteKit app at repo root** -- Moving the app into `packages/praxrr` would require
   updating every path alias (20+), every CI workflow, the Dockerfile, the build scripts, and the
   Deno compile entry point. The risk-to-benefit ratio is unfavorable. All surveyed monorepos
   (Svelte, deno-std, Graphite) have either a primary app at root or very few packages. The
   app-at-root pattern works with the existing `packages/praxrr-api` precedent.
   - **Confidence**: High -- business research also flagged this as highest-risk phase.

2. **Add `PRAXRR_DEFAULT_DB_URL` and `PRAXRR_DEFAULT_DB_BRANCH` env vars** -- Decouple the auto-link
   default from hardcoded values. This is independently valuable and should ship before the
   structural monorepo change.
   - **Confidence**: High -- minimal code change, follows existing naming convention.

3. **Per-package READMEs** -- Each `packages/*/README.md` must document purpose, development
   commands, dependency direction, and release strategy.
   - **Confidence**: High -- universally recommended, low effort.

4. **CI aggregation job pattern** -- Use `dorny/paths-filter` for change detection and a single
   `ci/gate` aggregation job as the required status check. Do not require individual package job
   names in branch protection.
   - **Confidence**: High -- well-documented solution to the GitHub Actions monorepo status check
     problem.

5. **Mirror publishing workflow** -- Automated git subtree split-push to `yandy-r/praxrr-db` and
   `yandy-r/praxrr-schema` on merge to main. This preserves the external consumer workflow and the
   auto-link default URL.
   - **Confidence**: High -- Apollo's proven pattern maps directly to this use case.

### Should Have

6. **Cross-package PCD compatibility CI gate** -- A dedicated job that compiles the PCD cache from
   `packages/praxrr-schema` + `packages/praxrr-db` ops and verifies success. This catches schema-ops
   incompatibility before merge.
   - **Confidence**: High -- straightforward to implement using existing PCD compilation logic.

7. **Generated-types freshness check** -- CI job that runs `deno task generate:pcd-types --local`
   and diffs against committed types. Catches stale type generation.
   - **Confidence**: High -- the `--local` flag already exists.

8. **Migration communication** -- GitHub issue announcement, archive external repos with redirect
   READMEs, update CLAUDE.md with new structure.
   - **Confidence**: High -- standard open-source migration practice.

9. **Update root README directory map** -- Add the `packages/` directory to the repository structure
   documentation.
   - **Confidence**: High -- minimal effort, high onboarding value.

10. **Conventional commit scopes per package** -- Document recommended scopes (`app`, `schema`,
    `db`, `api`) in CONTRIBUTING.md or CLAUDE.md.
    - **Confidence**: Medium -- convention rather than enforcement.

### Nice to Have

11. **VSCode workspace configuration** -- `.vscode/settings.json` with Deno enabled,
    `.vscode/extensions.json` recommending the Deno and Svelte extensions.
    - **Confidence**: High -- low effort, improves IDE experience.

12. **CODEOWNERS file** -- Map `packages/praxrr-db/**` and `packages/praxrr-schema/**` to specific
    reviewers.
    - **Confidence**: Medium -- useful if the contributor base grows.

13. **PR comment with affected packages** -- GitHub Action that posts which packages were affected
    by a PR's changes.
    - **Confidence**: Medium -- nice DX improvement but not critical for a small monorepo.

14. **Comprehensive validation task** -- A root `deno task ok` (inspired by deno-std) that runs all
    checks: lint, format, type check, test, PCD compat, types freshness.
    - **Confidence**: High -- simple to implement, high value for pre-push verification.

## Open Questions

1. **App relocation**: Should the SvelteKit app ever move to `packages/praxrr`? The research
   strongly suggests keeping it at root for now. If the repo grows significantly (5+ packages), this
   decision should be revisited. The migration cost is high (20+ path aliases, all CI, Dockerfile,
   build scripts) and the benefit is low while package count is small.

2. **Workspace glob vs explicit members**: Should the root `deno.json` use
   `"workspace": ["packages/*"]` (glob) or
   `"workspace": ["packages/praxrr-api", "packages/praxrr-db", "packages/praxrr-schema"]`
   (explicit)? Glob is more scalable but less self-documenting. With only 3 packages, explicit
   listing is clearer and matches the project's preference for explicitness.

3. **Mirror frequency**: Should mirror publishing happen on every merge to main, or only on tagged
   releases? On every merge keeps mirrors fresh and avoids drift. On tags only keeps mirrors stable.
   Recommendation: on every merge to main, since the external repos currently track the `v2` branch
   (not tags).

4. **Schema versioning in monorepo**: When the schema lives in-repo, should the type generator
   default to `--local` mode? This would be a workflow change for developers who are used to
   specifying `--version`. Recommendation: default to `--local` when the local file exists, with
   `--version` as an override for specific published versions.

5. **Commit scope enforcement**: Should a commitlint hook enforce package scopes, or should scopes
   be recommended but not required? For a small contributor base, recommendation over enforcement is
   likely sufficient to avoid friction.

## Sources

### Deno Workspaces

- [Deno Workspaces and Monorepos Documentation](https://docs.deno.com/runtime/fundamentals/workspaces/)
- [Deno 1.45: Workspace and Monorepo Support](https://deno.com/blog/v1.45)
- [Deno Standard Library deno.json](https://github.com/denoland/std/blob/main/deno.json)
- [Deno Task CLI Reference](https://docs.deno.com/runtime/reference/cli/task/)

### Monorepo Best Practices

- [Graphite: How We Organize Our Monorepo to Ship Fast](https://graphite.com/blog/how-we-organize-our-monorepo-to-ship-fast)
- [Monorepo Tools](https://monorepo.tools/)
- [Aviator: Monorepo Hands-On Guide](https://www.aviator.co/blog/monorepo-a-hands-on-guide-for-managing-repositories-and-microservices/)
- [Feature-Sliced Design: Monorepo Architecture Guide for 2025](https://feature-sliced.design/blog/frontend-monorepo-explained)
- [CircleCI: Benefits and Challenges of Monorepo Development](https://circleci.com/blog/monorepo-dev-practices/)

### Svelte Monorepo

- [Svelte Monorepo Structure (DeepWiki)](https://deepwiki.com/sveltejs/svelte/1.1-project-structure)
- [Svelte.dev Workspace Configuration (DeepWiki)](https://deepwiki.com/sveltejs/svelte.dev/2.1-workspace-configuration)
- [SvelteKit in Production: Monorepo Excellence](https://oestechnology.co.uk/posts/sveltekit-monorepo-excellence)

### CI/CD Patterns

- [GitHub Actions and Required Checks in a Monorepo](https://github.com/orgs/community/discussions/26251)
- [dorny/paths-filter](https://github.com/dorny/paths-filter)
- [OneUptime: How to Handle Monorepos with GitHub Actions](https://oneuptime.com/blog/post/2026-01-26-monorepos-github-actions/view)
- [Buildkite: Monorepo CI Best Practices](https://buildkite.com/resources/blog/monorepo-ci-best-practices/)
- [Mergify: Monorepo CI for GitHub Actions](https://mergify.com/blog/monorepo-ci-for-github-actions-run-exactly-the-tests-you-need-nothing-more)

### Git Subtree Mirror Publishing

- [Apollo: Managing Swift Packages in a Monorepo with Git Subtrees](https://www.apollographql.com/blog/how-apollo-manages-swift-packages-in-a-monorepo-with-git-subtrees)
- [ARCsoft: Using Git Subtree for Repository Mirroring](https://arcsoft.uvic.ca/log/2025-09-02-git-subtree-for-repo-mirroring/)
- [Atlassian: Git Subtree Alternative to Git Submodule](https://www.atlassian.com/git/tutorials/git-subtree)

### Migration Patterns

- [Graphite: Migrating to Monorepo Step-by-Step Guide](https://graphite.com/guides/migrating-to-monorepo-a-step-by-step-guide)
- [Opaque: Our Migration to Monorepo Part 1](https://opaque.co/our-migration-to-monorepo-part-1)
- [Adaltas: Merging Git Repositories Preserving History](https://www.adaltas.com/en/2021/05/21/js-monorepos-merging-git-repositories/)

### IDE and Developer Tooling

- [VSCode Multi-Root Workspaces for Monorepo Development](https://medium.com/rewrite-tech/visual-studio-code-tips-for-monorepo-development-with-multi-root-workspaces-and-extension-6b69420ecd12)
- [Monorepo Workspace VSCode Extension](https://github.com/folke/vscode-monorepo-workspace)

### Conventional Commits and Changelogs

- [Adaltas: Commit Enforcement and Changelog Generation for Monorepos](https://www.adaltas.com/en/2021/02/02/js-monorepos-commits-changelog/)
- [Conventional Commits Specification](https://www.conventionalcommits.org/en/about/)
- [Changesets: Monorepo Versioning and Changelogs](https://github.com/changesets/changesets)

### Configuration Patterns

- [ASP.NET Core Configuration](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/)
- [FastAPI Settings and Environment Variables](https://fastapi.tiangolo.com/advanced/settings/)
- [Spotify: Solving Documentation for Monoliths and Monorepos](https://engineering.atspotify.com/2019/10/solving-documentation-for-monoliths-and-monorepos)

### Contributor Onboarding

- [Tweag: Python Monorepo Structure and Tooling](https://www.tweag.io/blog/2023-04-04-python-monorepo-1/)
- [Daily.dev: Open Source Contributor Onboarding](https://daily.dev/blog/open-source-contributor-onboarding-10-tips)

## Search Queries Executed

1. `monorepo developer experience best practices 2025 2026`
2. `Deno monorepo workspace strategy TypeScript 2025`
3. `monorepo contributor onboarding documentation patterns open source`
4. `monorepo CI/CD cross-package compatibility feedback PR checks`
5. `monorepo migration guide communication strategy open source project restructuring`
6. `Deno standard library monorepo structure workspace organization pattern`
7. `sveltejs svelte repository monorepo packages workspace structure pnpm`
8. `monorepo IDE navigation developer experience VSCode multi-root workspace patterns`
9. `monorepo conventional commits scope package naming pattern changelog generation`
10. `environment variable default configuration pattern "default with override" developer experience`
11. `GitHub Actions monorepo affected packages matrix build status checks per package`
12. `SvelteKit monorepo workspace structure organization packages`
13. `"deno workspace" "deno task" run specific member package command cross-package testing`
14. `Fresh framework Deno monorepo workspace deno.json structure packages`
15. `monorepo README per-package documentation structure self-documenting codebase`
16. `git subtree mirror workflow monorepo publish separate repositories automation`
17. `lightweight monorepo affected packages detection GitHub Actions without Nx Turborepo path filter`
18. `monorepo changelog migration announcement open source project deprecating separate repos`
19. `github deno-std deno.json workspace members structure`

## Uncertainties and Gaps

1. **Deno workspace task orchestration maturity**: Deno's `--filter` and `--recursive` flags for
   task running are relatively new (introduced in Deno 1.45/2.x). Edge cases around task dependency
   ordering across workspace members are not well-documented yet. Testing this with the actual
   Praxrr setup will be needed.

2. **Git subtree split performance**: For repositories with large histories, `git subtree split` can
   be slow. The `--rejoin` flag (used by Apollo) creates checkpoints to avoid full history
   traversal, but performance with Praxrr's specific history depth is unknown.

3. **Deno compile with workspace members**: The `deno compile` step in the release workflow builds a
   standalone binary. How workspace member resolution works during compilation (vs. runtime) needs
   validation. The app at repo root avoids this concern, but if any workspace member is imported by
   the app, the compile step must resolve it correctly.

4. **Mirror repository branch strategy**: The current auto-link defaults to the `v2` branch of
   `praxrr-db`. The mirror publishing workflow needs to push to this specific branch (not `main`).
   The exact git subtree push configuration for branch targeting needs testing.

5. **E2E test default repo**: `src/tests/e2e/env.ts` references `praxrr-db-v2-testing`, not the main
   `praxrr-db`. The monorepo transition should not change E2E test behavior, but the relationship
   between the testing repo and the monorepo packages needs clarification.
