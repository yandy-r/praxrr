# Business Logic Research: monorepo-strategy

## Executive Summary

The three-repo model (`praxrr`, `praxrr-db`, `praxrr-schema`) forces multi-repo coordination for any
change touching the schema-DB-app boundary, which is the most active development surface. Moving to
a monorepo-in-place model inside the existing `praxrr` repository enables atomic cross-component
commits, stronger compatibility gates via CI, and lower maintainer friction while preserving the
external consumer workflow for custom PCD databases. The key technical challenge is decoupling
hardcoded repo URL assumptions in the auto-link flow, dependency resolution, type generation
pipeline, and UI dependency editor without breaking the user-facing `pcd.json` manifest contract.

## User Stories

### Primary User: Maintainer

- As a maintainer, I want to make schema changes and corresponding app changes in a single commit so
  that I avoid cross-repo version-pinning races.
- As a maintainer, I want CI to automatically validate that app code is compatible with the current
  schema and DB ops so that I catch contract breakage before merging.
- As a maintainer, I want a single release workflow that can independently version app, db, and
  schema but from one repository so that releases do not require coordinating PRs across three
  repos.
- As a maintainer, I want the type generation pipeline to read schema SQL from a local path within
  the monorepo so that I do not need to push schema changes to GitHub before regenerating types.
- As a maintainer, I want a publish/mirror pipeline that pushes db and schema packages to their
  public repos so that external consumers still have stable distribution channels.

### Primary User: Contributor

- As a contributor, I want to clone a single repository and have the entire project buildable
  without fetching external schema repos so that the onboarding experience is simpler.
- As a contributor, I want to iterate on schema DDL and see the effects in the app's PCD type system
  within a single PR so that review cycles are faster.
- As a contributor, I want clear package boundaries within the monorepo so that I understand which
  code belongs to the app, db, and schema packages.

### Secondary User: End User (Custom PCD)

- As an end user with a custom PCD, I want to continue linking my own PCD repository via URL and
  branch so that the monorepo transition does not affect my workflow.
- As an end user, I want the default auto-linked database to continue working on fresh installs so
  that I can use Praxrr without any manual PCD setup.
- As an end user, I want to be able to configure the default database URL and branch via environment
  variables so that I can point to a different default DB if needed (e.g., a fork or mirror).

## Business Rules

### PCD Manifest Contract

The `pcd.json` manifest is the contract between the app and any PCD repository. Key rules enforced
by `src/lib/server/pcd/manifest/manifest.ts`:

- **Required fields**: `name`, `version`, `description`, `praxrr.minimum_version`.
- **Dependencies must include schema**: If `dependencies` is present and non-empty, at least one key
  must contain the substring `"schema"` (line 82-86 in `manifest.ts`). This is a loose check -- it
  does not enforce a specific URL.
- **Valid `arr_types`**: Must be from the set
  `['radarr', 'sonarr', 'readarr', 'lidarr', 'prowlarr', 'whisparr']`.
- **Optional fields**: `authors`, `license`, `repository`, `tags`, `links`.
- **Dependencies format**: `Record<string, string>` where keys are repository URLs and values are
  version tags.

The current canonical `praxrr-db` manifest uses the full GitHub URL as the dependency key:

```json
{
  "dependencies": {
    "https://github.com/yandy-r/praxrr-schema": "1.0.0"
  }
}
```

This means dependency resolution in `dependencies.ts` extracts the repo name from the URL for local
cloning. The monorepo must preserve this contract or provide a migration path.

### Schema Compatibility

- Schema versions are git tags/branches in `praxrr-schema`. The `pcd.json` dependency value (e.g.,
  `"1.0.0"`) is used as a git ref for checkout.
- The type generator (`scripts/generate-pcd-types.ts`) fetches schema SQL from
  `https://raw.githubusercontent.com/yandy-r/praxrr-schema/{version}/ops/0.schema.sql` by default,
  but supports `--local` for local files and `--version` for specific branches.
- Schema DDL is the first layer applied during cache compilation (layer order: schema -> base ->
  tweaks -> user).
- The `loadOps.ts` resolver already handles both `deps/schema` and `deps/praxrr-schema` directory
  names (line 39 in `loadOps.ts`), providing flexibility.

### Auto-Link Defaults

The auto-link mechanism in `src/hooks.server.ts` (lines 37-78) runs once on first startup:

1. Checks `setup_state.default_database_linked` flag (singleton row in `setup_state` table).
2. If not linked, calls `pcdManager.link()` with **hardcoded** values:
   - `repositoryUrl`: `'https://github.com/yandy-r/praxrr-db'`
   - `branch`: `'v2'`
   - `name`: `'Praxrr-DB'`
   - `syncStrategy`: `60` (minutes)
   - `autoPull`: `true`
3. Reads three env vars for optional configuration:
   - `PRAXRR_DEFAULT_DB_TOKEN` -- personal access token for private repos
   - `PRAXRR_DEFAULT_DB_GIT_USERNAME` -- git author name
   - `PRAXRR_DEFAULT_DB_GIT_EMAIL` -- git author email
4. **Currently missing**: env vars for URL and branch override. The URL and branch are hardcoded.
5. On failure, marks as linked anyway to prevent retry loops.

### Ops Layering

Ops are loaded in strict order by `src/lib/server/pcd/ops/loadOps.ts`:

1. **Schema layer** -- SQL files from `deps/{schema-dir}/ops/`, loaded from filesystem
2. **Base layer (published)** -- from `pcd_ops` table where `origin='base'` and `state='published'`
3. **Base layer (drafts)** -- from `pcd_ops` table where `origin='base'` and `state='draft'`, offset
   by `DRAFT_SEQUENCE_BASE` (3 billion)
4. **Tweaks layer** -- SQL files from `{pcdPath}/tweaks/` directory
5. **User layer** -- from `pcd_ops` table where `origin='user'` and `state='published'`

Base ops are imported from repo files into the `pcd_ops` DB table via `importBaseOps()`. Built-in
base ops (app-level migrations like Lidarr support) are seeded via `seedBuiltInBaseOps()`. Both run
on link, sync, branch switch, and startup initialization.

### Edge Cases

- **Dependency directory naming**: `loadOps.ts` resolves schema path by scanning `deps/` for any
  directory containing `"schema"` in its name (line 39). This means `deps/schema`,
  `deps/praxrr-schema`, and `deps/my-custom-schema` all work. This flexibility is intentional for
  fork support.
- **Orphaned base ops**: When a repo file is removed upstream, `importBaseOps()` marks the
  corresponding DB row as `orphaned` using `markBaseOrphaned()` with a timestamp comparison.
- **Failure tolerance**: Auto-link failure does not crash startup. The `setup_state` flag is set
  regardless to prevent infinite retry.
- **Built-in base ops vs repo ops**: `seedBuiltInBaseOps()` checks for existing ops by filename
  before inserting, so repo-published ops always take precedence over built-in ones.
- **Schema dependency is mandatory validation**: The manifest validator enforces that `dependencies`
  must contain a key with `"schema"` in it, but does not validate the URL format or reachability.
- **UI locks schema dependency**: The database config page
  (`src/routes/databases/[id]/config/+page.svelte`, line 316) uses a `lockedFirst` prop that
  hardcodes `https://github.com/yandy-r/praxrr-schema` as the locked dependency key.

## Workflows

### Current: Cross-Component Change (Schema + DB + App)

Step-by-step for a change that requires schema DDL changes, new base ops, and app code changes:

1. Make schema DDL change in `praxrr-schema` repo, commit, tag a new version (e.g., `1.1.0`).
2. Push the tag to `yandy-r/praxrr-schema`.
3. In `praxrr-db` repo, update `pcd.json` dependencies to point to the new schema version.
4. Add new base ops in `praxrr-db/ops/` that rely on the new schema.
5. Commit and push `praxrr-db`.
6. In `praxrr` app repo:
   - Run `deno task generate:pcd-types --version=1.1.0` to regenerate types from the new schema.
   - Update app code that uses the new types/tables.
   - If built-in base ops are needed, add migration + seed registration.
   - Commit and push.
7. All three repos must have compatible versions for the system to work end-to-end.

**Pain points**: Three separate PRs, version coordination, no atomic guarantee, type generation
depends on pushed schema.

### Current: Custom PCD Linking

1. User navigates to `/databases/new` in the UI.
2. Enters repository URL, name, branch, and optional settings (PAT, sync interval, etc.).
3. Server calls `pcdManager.link()` which: a. Generates UUID, creates local clone path. b. Clones
   the repository via git. c. Validates `pcd.json` manifest. d. Processes dependencies (clones
   schema at pinned version into `deps/`). e. Inserts `database_instances` row. f. Imports base ops
   from repo files. g. Seeds built-in base ops. h. Compiles PCD cache (replays all ops into
   in-memory SQLite).
4. Database appears in the UI, syncs on interval if configured.

This workflow is URL-agnostic -- any valid git URL works. The monorepo must not break this.

### Current: Release Workflow

- **App (`praxrr`)**: Tag `v*.*.*` triggers `release.yml` (multi-platform Deno compile + parser
  build + GitHub Release) and `docker.yml` (Docker images). `publish-api.yml` publishes the API spec
  to JSR.
- **DB (`praxrr-db`)**: Released independently via tags. Users get updates via `pcdManager.sync()`
  which does `git pull`.
- **Schema (`praxrr-schema`)**: Released via tags. Consumed by DB repos via `pcd.json` dependency
  pinning and by the type generator via raw GitHub URL.
- **API spec**: Published to JSR as `@yandy-r/praxrr-api` from `packages/praxrr-api/`.

### Proposed: Monorepo Workflow

After transition:

1. **Cross-component change**: Single PR in `praxrr` touches
   `packages/praxrr-schema/ops/0.schema.sql`, `packages/praxrr-db/ops/*.sql`, and app code. Types
   can be regenerated from local path (`--local`). One atomic commit/merge.
2. **CI gates**: On PR, CI validates: (a) app tests pass, (b) type generation from local schema
   matches committed types, (c) PCD cache compiles with current db ops against current schema.
3. **Release**: App version, DB version, and schema version remain independent. Tags like `v2.1.0`
   (app), `db-v2.1.35` (db), `schema-v1.1.0` (schema) can trigger selective publish workflows.
4. **Publish/mirror**: CI pushes `packages/praxrr-db` and `packages/praxrr-schema` contents to
   `yandy-r/praxrr-db` and `yandy-r/praxrr-schema` repos via git subtree push or a mirror action.
5. **Custom PCD linking**: Unchanged -- users still link any git URL. The default auto-link URL
   becomes configurable via env vars (`PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`),
   defaulting to the mirrored `yandy-r/praxrr-db` repo.

## Domain Model

### Key Entities

- **PCD (Praxrr Config Database)**: A git repository containing configuration as SQL operations,
  with a `pcd.json` manifest, `ops/` directory for base ops, optional `tweaks/` directory, and
  `deps/` for dependencies.
- **Schema**: The DDL-only layer defining PCD table structure. Lives in a separate package/repo.
  Applied first during cache compilation.
- **Base Ops**: Published SQL operations that define the canonical configuration state. Stored in
  `pcd_ops` table with `origin='base'`.
- **User Ops**: Local overrides that persist across syncs. Stored in `pcd_ops` table with
  `origin='user'`. Never exported.
- **Built-in Base Ops**: App-level migrations seeded into `pcd_ops` (source='local') for new
  features like Lidarr support.
- **PCD Cache**: In-memory SQLite database built by replaying all ops in layer order. Used for
  reads, validation, and sync payload generation.
- **Database Instance**: App DB record (`database_instances` table) tracking a linked PCD with its
  git URL, local clone path, sync settings, and access credentials.

### Dependency Graph

```
praxrr (app)
  |
  |-- runtime: clones & manages PCD repos at {basePath}/data/databases/{uuid}/
  |-- type generation: fetches schema SQL from praxrr-schema repo
  |-- built-in ops: seeds app-level migrations into pcd_ops
  |
  v
praxrr-db (PCD repo)
  |
  |-- pcd.json dependencies: {"https://github.com/yandy-r/praxrr-schema": "1.0.0"}
  |-- ops/: base operation SQL files
  |-- tweaks/: optional tweak SQL files
  |
  v
praxrr-schema (schema repo)
  |
  |-- ops/0.schema.sql: DDL defining all PCD tables
  |-- pcd.json: manifest for the schema package itself
```

### Coupling Points

- **`src/hooks.server.ts:54`**: Hardcoded `repositoryUrl: 'https://github.com/yandy-r/praxrr-db'`
  and `branch: 'v2'` for auto-link default.
- **`scripts/generate-pcd-types.ts:19`**: Hardcoded `SCHEMA_REPO = 'yandy-r/praxrr-schema'` for type
  generation.
- **`src/routes/databases/[id]/config/+page.svelte:316`**: Hardcoded
  `key: 'https://github.com/yandy-r/praxrr-schema'` as locked dependency in UI.
- **`src/lib/server/pcd/git/dependencies.ts`**: Extracts repo name from URL for local clone path
  (`getRepoName()`). URL-format-dependent.
- **`src/lib/server/pcd/ops/loadOps.ts:33-47`**: Resolves schema ops path by scanning `deps/` for
  directories containing `"schema"`. Already flexible.
- **`src/lib/server/pcd/manifest/manifest.ts:82-86`**: Validates that dependencies contain a key
  with `"schema"` substring. Already flexible.
- **`src/lib/shared/pcd/types.ts:6`**: Generated header references
  `https://github.com/yandy-r/praxrr-schema`. Cosmetic only.

## Existing Codebase Integration

### Hardcoded References

| File                                            | Line         | Reference                                           | Impact                       |
| ----------------------------------------------- | ------------ | --------------------------------------------------- | ---------------------------- |
| `src/hooks.server.ts`                           | 54           | `'https://github.com/yandy-r/praxrr-db'`            | Auto-link default DB URL     |
| `src/hooks.server.ts`                           | 55           | `'v2'`                                              | Auto-link default branch     |
| `scripts/generate-pcd-types.ts`                 | 19           | `'yandy-r/praxrr-schema'`                           | GitHub raw URL for type gen  |
| `scripts/generate-pcd-types.ts`                 | 37           | `'ops/0.schema.sql'`                                | Schema file path within repo |
| `src/routes/databases/[id]/config/+page.svelte` | 316          | `'https://github.com/yandy-r/praxrr-schema'`        | Locked dependency key in UI  |
| `src/tests/e2e/env.ts`                          | 33           | `'https://github.com/yandy-r/praxrr-db-v2-testing'` | E2E test default repo        |
| `src/lib/server/pcd/git/dependencies.ts`        | 12           | Comment referencing `yandy-r/praxrr-schema`         | Documentation only           |
| `src/lib/shared/pcd/types.ts`                   | 6            | Generated comment with schema URL                   | Cosmetic, regenerated        |
| `README.md`                                     | 27           | Link to `praxrr-db` repo                            | Documentation                |
| `docs/ARCHITECTURE.md`                          | 252, 266-277 | Multiple references to both repos                   | Documentation                |

### Config/Env Variables

| Variable                         | Current Usage                  | Default        | Proposed Change                                         |
| -------------------------------- | ------------------------------ | -------------- | ------------------------------------------------------- |
| `PRAXRR_DEFAULT_DB_TOKEN`        | PAT for auto-link default DB   | undefined      | Keep as-is                                              |
| `PRAXRR_DEFAULT_DB_GIT_USERNAME` | Git author for auto-link       | undefined      | Keep as-is                                              |
| `PRAXRR_DEFAULT_DB_GIT_EMAIL`    | Git author for auto-link       | undefined      | Keep as-is                                              |
| `PRAXRR_DEFAULT_DB_URL`          | **Does not exist yet**         | N/A            | New: defaults to `https://github.com/yandy-r/praxrr-db` |
| `PRAXRR_DEFAULT_DB_BRANCH`       | **Does not exist yet**         | N/A            | New: defaults to `v2`                                   |
| `PRAXRR_SCHEMA_TOKEN`            | Auth for type gen GitHub fetch | undefined      | May become less critical if generating from local       |
| `GITHUB_TOKEN` / `GH_TOKEN`      | Fallback auth for type gen     | undefined      | Same as above                                           |
| `APP_BASE_PATH`                  | Base path for all data dirs    | exec directory | Needs adjustment if app moves to `packages/praxrr`      |

### Build Pipeline Dependencies

| Script/Task                         | Dependency on External Repo                                            | Path                                |
| ----------------------------------- | ---------------------------------------------------------------------- | ----------------------------------- |
| `deno task generate:pcd-types`      | Fetches `0.schema.sql` from `yandy-r/praxrr-schema` via GitHub raw URL | `scripts/generate-pcd-types.ts`     |
| `deno task bundle:api`              | Reads local `docs/api/v1/`, writes to `packages/praxrr-api/`           | `scripts/bundle-api.ts`             |
| `.github/workflows/publish-api.yml` | Publishes from `packages/praxrr-api/` to JSR                           | `.github/workflows/publish-api.yml` |
| `.github/workflows/docker.yml`      | Builds from repo root context                                          | `.github/workflows/docker.yml`      |
| `.github/workflows/release.yml`     | Builds from repo root, compiles Deno binary from `dist/build/mod.ts`   | `.github/workflows/release.yml`     |
| `Dockerfile`                        | Build context is repo root                                             | `Dockerfile`                        |
| `deno.json` workspace               | Already includes `packages/praxrr-api`                                 | `deno.json`                         |

### Existing Monorepo Infrastructure

The repo already has partial monorepo infrastructure:

- `deno.json` declares a `workspace` with `packages/praxrr-api` (line 2).
- `packages/praxrr-api/` contains a published JSR package with its own `deno.json`.
- The `publish-api.yml` workflow operates within `packages/praxrr-api/`.
- The `bundle:api` task generates output from source into the package directory.

This provides a proven pattern for adding `packages/praxrr-db` and `packages/praxrr-schema`.

## Success Criteria

- [ ] App code relocates to `packages/praxrr` with all build/test/dev/release pipelines working
      identically.
- [ ] `deno task generate:pcd-types` can generate types from
      `packages/praxrr-schema/ops/0.schema.sql` without hitting GitHub API.
- [ ] Auto-link default DB URL and branch are configurable via `PRAXRR_DEFAULT_DB_URL` and
      `PRAXRR_DEFAULT_DB_BRANCH` env vars.
- [ ] CI gate validates app + schema + db compatibility on every PR touching any of the three
      packages.
- [ ] Publish/mirror pipeline can push `packages/praxrr-db` contents to `yandy-r/praxrr-db` and
      `packages/praxrr-schema` to `yandy-r/praxrr-schema`.
- [ ] User linking a custom PCD via any git URL continues to work identically.
- [ ] E2E tests pass against the new directory structure.
- [ ] Independent versioning: app, db, and schema have separate version numbers and release cycles.
- [ ] No breaking changes to the `pcd.json` manifest contract.

## Open Questions

- **App relocation granularity**: Should `packages/praxrr` contain the entire SvelteKit app
  (including routes, lib, tests), or should only server/shared code move while the SvelteKit project
  root stays at repo root? Moving the entire app requires updating every path alias, Dockerfile, CI
  workflow, and build script.
- **Mirror strategy**: Git subtree push, GitHub Actions mirror workflow, or a combination? Subtree
  push preserves history but has merge complexity. Mirror workflow is simpler but loses commit
  granularity.
- **Schema versioning in monorepo**: When schema lives in-repo, does the type generator default to
  reading the local file, or does it continue fetching from GitHub (with local as override)? The
  `--local` flag already exists.
- **Dependency key format**: When `praxrr-db` lives inside the monorepo, does its `pcd.json` still
  use `https://github.com/yandy-r/praxrr-schema` as the dependency key (for external consumers), or
  does it change to a monorepo-local reference? This affects the mirrored copy.
- **UI locked dependency**: The config page UI hardcodes the schema dependency URL. Should this
  become configurable per database instance, or should it remain as a default that can be
  overridden?
- **Test fixtures**: Multiple test files create `deps/schema/ops/` directories with inline schema
  SQL. Should these reference the monorepo schema package instead?
- **Phase ordering risk**: Moving app code to `packages/praxrr` is the highest-risk phase. Should
  this be deferred until after the lower-risk env var and type-gen decoupling phases?

## Relevant Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/hooks.server.ts`: Startup sequence and
  auto-link default DB logic (primary hardcoded coupling)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/core/manager.ts`: PCD lifecycle
  orchestration (link, sync, unlink, initialize)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/git/dependencies.ts`:
  Dependency clone/sync/version resolution via git
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/manifest/manifest.ts`: pcd.json
  read/validate/write and contract enforcement
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/ops/loadOps.ts`: Schema path
  resolution and ops layer loading
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/ops/importBaseOps.ts`:
  Repo-to-DB base ops import pipeline
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`:
  Built-in (app-level) base ops seeding
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/database/compiler.ts`: PCD
  cache compile/invalidate with conflict resolution
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/database/cache.ts`: In-memory
  SQLite cache build and query API
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/utils/operations.ts`: Path
  helpers and operation loading from filesystem
- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/generate-pcd-types.ts`:
  Schema-to-TypeScript type generation (hardcoded GitHub URL)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/utils/config/config.ts`: App
  configuration singleton (base path, all data paths)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/db/queries/setupState.ts`: Setup
  state tracking (default_database_linked flag)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/db/queries/databaseInstances.ts`:
  Database instance CRUD (stores linked PCD metadata)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/routes/databases/[id]/config/+page.svelte`: DB
  config UI with hardcoded schema dependency lock
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/routes/databases/new/+page.server.ts`: Link
  new database server action
- `/home/yandy/Projects/github.com/yandy-r/praxrr/deno.json`: Workspace config, path aliases, task
  definitions
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-api/deno.json`: Existing monorepo
  package precedent
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/docker.yml`: Docker CI (builds
  from repo root)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/release.yml`: Release CI
  (multi-platform compile)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/publish-api.yml`: API spec
  publish to JSR (operates in packages/praxrr-api)
