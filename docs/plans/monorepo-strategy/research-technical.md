# Technical Specifications: monorepo-strategy

## Executive Summary

The monorepo migration moves the main Praxrr application into `packages/praxrr/` while introducing `packages/praxrr-db/` and `packages/praxrr-schema/` as sibling source-of-truth packages, all within the existing `praxrr` repository. The migration leverages Deno 2.x native workspace support (already partially in use for `packages/praxrr-api`), preserves the SvelteKit + Vite build pipeline, and introduces configurable auto-link defaults to decouple the runtime from hardcoded repository URLs. The split repos (`yandy-r/praxrr-db`, `yandy-r/praxrr-schema`) continue as published consumer-facing mirrors with automated publish workflows.

## Architecture Design

### Proposed Directory Structure

```
praxrr/                           # Root of existing repository (unchanged name)
|-- packages/
|   |-- praxrr/                   # Main application (moved from root)
|   |   |-- src/
|   |   |   |-- hooks.server.ts
|   |   |   |-- lib/
|   |   |   |-- routes/
|   |   |   |-- services/parser/  # C# parser stays co-located
|   |   |   `-- tests/
|   |   |-- scripts/              # dev.ts, test.ts, e2e.ts, etc.
|   |   |-- docker/               # entrypoint.sh
|   |   |-- dist/                 # Build output (gitignored)
|   |   |-- static/
|   |   |-- deno.json             # Package-level config (tasks, imports, compilerOptions)
|   |   |-- svelte.config.js
|   |   |-- vite.config.ts
|   |   |-- tsconfig.json
|   |   |-- package.json
|   |   |-- eslint.config.js
|   |   |-- .prettierrc
|   |   |-- .prettierignore
|   |   |-- Dockerfile
|   |   |-- Dockerfile.parser
|   |   |-- compose.yml
|   |   |-- compose.dev.yml
|   |   `-- compose.arr.yml
|   |-- praxrr-db/                # PCD database source (new, sourced from yandy-r/praxrr-db)
|   |   |-- ops/                  # Base SQL operations
|   |   |-- tweaks/               # Tweak operations
|   |   |-- pcd.json              # Manifest (dependencies, version)
|   |   |-- README.md
|   |   `-- deno.json             # Minimal (name, version)
|   |-- praxrr-schema/            # PCD schema definitions (new, sourced from yandy-r/praxrr-schema)
|   |   |-- ops/
|   |   |   `-- 0.schema.sql      # The canonical schema DDL
|   |   |-- pcd.json              # Manifest
|   |   |-- README.md
|   |   `-- deno.json             # Minimal (name, version)
|   `-- praxrr-api/               # API spec package (already exists)
|       |-- deno.json
|       |-- mod.ts
|       |-- openapi.json
|       `-- types.ts
|-- docs/                         # Stays at root (repo-level docs)
|   |-- api/
|   |-- plans/
|   `-- internal-docs/
|-- .github/
|   |-- workflows/
|   |   |-- docker.yml            # Updated build context
|   |   |-- release.yml           # Updated build context
|   |   |-- publish-api.yml       # Unchanged (already uses packages/praxrr-api)
|   |   |-- publish-db.yml        # NEW: mirror to yandy-r/praxrr-db
|   |   |-- publish-schema.yml    # NEW: mirror to yandy-r/praxrr-schema
|   |   `-- compatibility.yml     # NEW: cross-package contract tests
|   `-- ISSUE_TEMPLATE/
|-- deno.json                     # Root workspace config
|-- deno.lock                     # Shared lockfile
|-- CLAUDE.md                     # Updated paths
|-- README.md                     # Updated with monorepo overview
|-- LICENSE
`-- .gitignore
```

## Relevant Files

Current files that are central to the migration:

- `/home/yandy/Projects/github.com/yandy-r/praxrr/deno.json`: Root config already has `"workspace": ["packages/praxrr-api"]`; needs expansion.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/svelte.config.js`: 18 path aliases; all use relative `./src/` prefix; must be preserved.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/vite.config.ts`: Reads `./package.json` for version; port and plugin config.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/tsconfig.json`: Extends `./dist/.svelte-kit/tsconfig.json`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/hooks.server.ts`: Hardcoded default DB URL `https://github.com/yandy-r/praxrr-db` and branch `v2`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/git/dependencies.ts`: Dependency clone/sync using manifest `pcd.json`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/manifest/manifest.ts`: Validates manifest structure; requires schema dependency.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/ops/loadOps.ts`: Resolves schema deps from `deps/` directory; flexible `*schema*` matching.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/core/manager.ts`: Orchestrates link/sync/compile lifecycle.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/generate-pcd-types.ts`: Hardcoded `SCHEMA_REPO = 'yandy-r/praxrr-schema'`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/dev.ts`: Hardcoded CWD `src/services/parser` for parser, `APP_BASE_PATH=./dist/dev`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/test.ts`: Test paths `src/tests/*`, `APP_BASE_PATH=./dist/test`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/e2e.ts`: `SPEC_DIR = 'src/tests/e2e/specs'`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/scripts/bundle-api.ts`: Paths `docs/api/v1` and `packages/praxrr-api`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/utils/config/config.ts`: `APP_BASE_PATH` resolution, all runtime paths.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-api/deno.json`: Existing workspace member; published to JSR as `@yandy-r/praxrr-api`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/docker.yml`: Build context `.` with `Dockerfile` at root.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/workflows/release.yml`: `deno install --node-modules-dir` + `vite build` + `deno compile` at root.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/Dockerfile`: `WORKDIR /build`, `COPY . .` from root context.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/Dockerfile.parser`: `COPY src/services/parser/` from root context.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/tests/e2e/env.ts`: Hardcoded `https://github.com/yandy-r/praxrr-db-v2-testing`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`: Built-in ops from migrations; no path coupling.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/src/lib/server/pcd/ops/importBaseOps.ts`: Reads from PCD `ops/` directory; no hardcoded URLs.

## Configuration Changes

### Root `deno.json` (Workspace)

The root `deno.json` becomes a minimal workspace orchestrator. It already has the `workspace` field for `praxrr-api`. The expanded configuration:

```jsonc
{
  "workspace": ["packages/praxrr", "packages/praxrr-api", "packages/praxrr-db", "packages/praxrr-schema"],
  "tasks": {
    // Root-level convenience tasks that delegate to package tasks
    "dev": "cd packages/praxrr && deno task dev",
    "build": "cd packages/praxrr && deno task build",
    "test": "cd packages/praxrr && deno task test",
    "lint": "cd packages/praxrr && deno task lint",
    "check": "cd packages/praxrr && deno task check",
    "format": "cd packages/praxrr && deno task format",
    // Cross-package tasks
    "check:all": "deno check packages/*/src/**/*.ts",
    "test:compat": "deno run -A scripts/compat-check.ts",
    "publish:api": "deno task -r packages/praxrr bundle:api && cd packages/praxrr-api && deno publish",
  },
  "fmt": {
    "exclude": ["dist/", "node_modules/"],
  },
  "lint": {
    "exclude": ["dist/", "node_modules/"],
  },
}
```

Key point: The root `deno.json` must NOT define `imports` that conflict with the app package's imports. Deno workspace resolution gives each member its own import map. The root-level import map (currently holding all `$lib/`, `$db/`, etc. aliases) moves entirely into `packages/praxrr/deno.json`.

### Package-Level `deno.json` (packages/praxrr)

This is the current root `deno.json` with minor adjustments:

- The `"workspace"` field is removed (workspace is declared at root).
- All `"imports"` stay the same since they use `./src/lib/` relative paths.
- All `"tasks"` stay the same since they use relative paths.
- `"compilerOptions"`, `"exclude"`, `"fmt"`, `"lint"`, `"allowScripts"` stay the same.

```jsonc
{
  "name": "@yandy-r/praxrr",
  "version": "2.0.0",
  "imports": {
    // All existing $lib/, $db/, etc. aliases unchanged
    "$lib/": "./src/lib/",
    "$api/": "./src/lib/api/",
    "$config": "./src/lib/server/utils/config/config.ts",
    // ... rest unchanged
  },
  "tasks": {
    // All existing tasks unchanged - relative paths still work
    "dev": "deno run -A scripts/dev.ts",
    // ... rest unchanged
  },
  // ... rest of current root deno.json
}
```

### Package-Level `deno.json` (packages/praxrr-db)

```jsonc
{
  "name": "@yandy-r/praxrr-db",
  "version": "2.0.0",
  "description": "Praxrr Config Database - curated profiles and custom formats",
}
```

### Package-Level `deno.json` (packages/praxrr-schema)

```jsonc
{
  "name": "@yandy-r/praxrr-schema",
  "version": "1.0.0",
  "description": "PCD schema definitions for Praxrr",
}
```

### SvelteKit / Vite Configuration

The `svelte.config.js` uses entirely relative paths (`./src/lib/...`). As long as it stays at `packages/praxrr/svelte.config.js` and the `src/` directory is co-located, no alias changes are needed.

The `vite.config.ts` reads `./package.json` which must move with it. No path changes needed.

The `tsconfig.json` extends `./dist/.svelte-kit/tsconfig.json` -- the `dist/` directory is created by SvelteKit at build time, so this still resolves correctly.

The `adapter` output in `svelte.config.js` is `dist/build` (relative) -- unchanged.

### Import Maps / Path Aliases

All 18 path aliases (`$lib/`, `$api/`, `$config`, `$logger/`, `$shared/`, `$stores/`, `$ui/`, `$assets/`, `$alerts/`, `$server/`, `$db/`, `$jobs/`, `$pcd/`, `$arr/`, `$http/`, `$utils/`, `$notifications/`, `$sync/`, `$cache/`, `$auth/`) use relative `./src/lib/` prefixes and are defined in both `deno.json` and `svelte.config.js`. Since these files move together with `src/`, no paths change.

### Docker Configuration

The Docker build context must change. Two strategies:

**Option A (Recommended): Keep context at repo root, update Dockerfile paths.**
This avoids issues with `.dockerignore`, workspace resolution, and `deno.lock` being at root.

```dockerfile
# In docker.yml and Dockerfile:
# context: .  (repo root, unchanged)
# file: packages/praxrr/Dockerfile

# Inside Dockerfile:
WORKDIR /build
COPY deno.json deno.lock* ./                    # Root workspace config
COPY packages/praxrr/ ./packages/praxrr/        # App package
COPY packages/praxrr-api/ ./packages/praxrr-api/ # API package (workspace member)
WORKDIR /build/packages/praxrr
RUN deno install --node-modules-dir
# ... build steps use relative paths from packages/praxrr/
```

**Option B: Set context to `packages/praxrr/`.**
Simpler Dockerfile but loses access to root `deno.lock` and sibling packages, complicating workspace resolution. Not recommended.

The `Dockerfile.parser` references `src/services/parser/` which moves to `packages/praxrr/src/services/parser/`. Update the COPY paths accordingly.

Compose files (`compose.yml`, `compose.dev.yml`, `compose.arr.yml`) move into `packages/praxrr/` and adjust `build.context` to `../..` (repo root) or use Docker Compose's `--project-directory` flag.

## Build System

### Task Commands

All tasks in `packages/praxrr/deno.json` continue to work unchanged because they use relative paths. The root `deno.json` adds convenience tasks that `cd` into the app package.

Tasks that reference `packages/praxrr-api` from the app package (like `publish:api`) need path adjustments:

- Current: `"bundle:api": "deno run -A scripts/bundle-api.ts"` (script uses `docs/api/v1` and `packages/praxrr-api` relative to CWD).
- After move: `scripts/bundle-api.ts` moves to `packages/praxrr/scripts/`. The `docs/api/v1` path becomes `../../docs/api/v1` and `packages/praxrr-api` becomes `../praxrr-api`. Either update the script or run it from root.

**Recommendation**: Move `bundle-api.ts` to root-level `scripts/` since it operates across packages.

### Deno Compile

`deno compile` works from the `packages/praxrr/` directory with the entry point `dist/build/mod.ts` (relative). The build task chain:

1. `vite build` produces `packages/praxrr/dist/build/mod.ts`
2. `deno compile ... dist/build/mod.ts` compiles from `packages/praxrr/`
3. Output goes to `packages/praxrr/dist/build/praxrr`

No functional change needed. The binary is self-contained and does not encode source paths.

### Type Generation

`scripts/generate-pcd-types.ts` currently fetches schema from GitHub (`yandy-r/praxrr-schema`). After the monorepo migration, the schema source lives locally at `packages/praxrr-schema/ops/0.schema.sql`.

Updated approach:

- Default mode: read from local `packages/praxrr-schema/ops/0.schema.sql` (no network fetch needed).
- Fallback/override: `--remote` flag fetches from GitHub (for CI or when local schema is not available).
- The `SCHEMA_REPO` constant becomes configurable or defaults to the local path.

```
// In packages/praxrr/scripts/generate-pcd-types.ts:
const LOCAL_SCHEMA = '../../packages/praxrr-schema/ops/0.schema.sql';
// or from root:
const LOCAL_SCHEMA = '../praxrr-schema/ops/0.schema.sql';
```

### Test Runner

Test paths in `scripts/test.ts` are relative (`src/tests/*`). Since this script moves with `packages/praxrr/`, the paths remain valid.

The `APP_BASE_PATH=./dist/test` remains relative to `packages/praxrr/`.

E2E tests (`scripts/e2e.ts`) reference `src/tests/e2e/specs` -- still valid after move.

## Data Models

<!-- Runtime decoupling details how data and configuration models change -->

### Runtime Decoupling

### Hardcoded References Found

1. **`src/hooks.server.ts:54`**: `repositoryUrl: 'https://github.com/yandy-r/praxrr-db'` and branch `v2` (line 55).
   - **Proposed change**: Read from env vars with current values as defaults.

2. **`src/hooks.server.ts:53`**: `name: 'Praxrr-DB'` (hardcoded default database name).
   - **Proposed change**: Make configurable via env var.

3. **`scripts/generate-pcd-types.ts:19`**: `const SCHEMA_REPO = 'yandy-r/praxrr-schema'`.
   - **Proposed change**: Default to local path, accept `--repo` flag override.

4. **`scripts/generate-pcd-types.ts:37`**: `const SCHEMA_PATH = 'ops/0.schema.sql'`.
   - **Proposed change**: Unchanged; this is the conventional path within any schema package.

5. **`src/tests/e2e/env.ts:33`**: `'https://github.com/yandy-r/praxrr-db-v2-testing'`.
   - **Proposed change**: Already overridable via `TEST_REPO_URL` env var. No change needed.

6. **`src/lib/server/pcd/git/dependencies.ts:12`**: Comment referencing `https://github.com/yandy-r/praxrr-schema`.
   - **Proposed change**: Update comment. No runtime impact.

7. **`src/lib/server/pcd/ops/loadOps.ts:33`**: Comment referencing `deps/praxrr-schema`.
   - **Proposed change**: Update comment. No runtime impact.

8. **`src/lib/server/pcd/ops/loadOps.ts:47`**: Fallback path `${pcdPath}/deps/schema/ops`.
   - **Proposed change**: Already flexible (line 39 scans for `*schema*` directory). No change needed.

### Configurable Auto-Link Defaults

New environment variables for the default database auto-link (in `hooks.server.ts`):

| Env Var                           | Purpose                                       | Default Value                          |
| --------------------------------- | --------------------------------------------- | -------------------------------------- |
| `PRAXRR_DEFAULT_DB_URL`           | Repository URL for auto-link on first startup | `https://github.com/yandy-r/praxrr-db` |
| `PRAXRR_DEFAULT_DB_BRANCH`        | Branch to clone for auto-link                 | `v2`                                   |
| `PRAXRR_DEFAULT_DB_NAME`          | Display name for auto-linked database         | `Praxrr-DB`                            |
| `PRAXRR_DEFAULT_DB_SYNC_STRATEGY` | Sync interval in minutes                      | `60`                                   |
| `PRAXRR_DEFAULT_DB_TOKEN`         | PAT for private repos (already exists)        | (none)                                 |
| `PRAXRR_DEFAULT_DB_GIT_USERNAME`  | Git author name (already exists)              | (none)                                 |
| `PRAXRR_DEFAULT_DB_GIT_EMAIL`     | Git author email (already exists)             | (none)                                 |

Implementation in `hooks.server.ts`:

```typescript
const defaultDbUrl = Deno.env.get('PRAXRR_DEFAULT_DB_URL')?.trim() || 'https://github.com/yandy-r/praxrr-db';
const defaultDbBranch = Deno.env.get('PRAXRR_DEFAULT_DB_BRANCH')?.trim() || 'v2';
const defaultDbName = Deno.env.get('PRAXRR_DEFAULT_DB_NAME')?.trim() || 'Praxrr-DB';

await pcdManager.link({
  name: defaultDbName,
  repositoryUrl: defaultDbUrl,
  branch: defaultDbBranch,
  syncStrategy: parseInt(Deno.env.get('PRAXRR_DEFAULT_DB_SYNC_STRATEGY') || '60', 10),
  autoPull: true,
  personalAccessToken: defaultDatabaseToken,
  gitUserName: hasCompleteGitIdentity ? defaultDatabaseGitUserName : undefined,
  gitUserEmail: hasCompleteGitIdentity ? defaultDatabaseGitUserEmail : undefined,
});
```

### Dependency System Changes

The PCD dependency resolution system (`dependencies.ts`) is already URL-agnostic. It reads dependency URLs from `pcd.json` manifests. No changes needed to the dependency clone/sync mechanism itself.

The monorepo's `packages/praxrr-db/pcd.json` will continue to declare:

```json
{
  "dependencies": {
    "https://github.com/yandy-r/praxrr-schema": "1.0.0"
  }
}
```

When the db package is published to the mirror repo, this manifest stays valid since the schema is also mirrored. For local development within the monorepo, the dependency is already present at `packages/praxrr-schema/` -- but the runtime PCD system clones via git, so local development still works through the existing clone mechanism.

### Manifest Validation Changes

The manifest validation (`manifest.ts:83`) requires dependencies to include a `schema` repository:

```typescript
const hasSchema = Object.keys(deps).some((url) => url.includes('schema'));
```

This is a string match on the URL containing "schema". No change needed since mirrored schema URLs will continue to contain "schema" in their name.

## CI/CD Pipeline

### Changed Package Detection

Use a path-filter approach based on changed files. Create a reusable detection step:

```yaml
# .github/workflows/detect-changes.yml (reusable workflow)
jobs:
  detect:
    runs-on: ubuntu-latest
    outputs:
      app: ${{ steps.filter.outputs.app }}
      db: ${{ steps.filter.outputs.db }}
      schema: ${{ steps.filter.outputs.schema }}
      api: ${{ steps.filter.outputs.api }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            app:
              - 'packages/praxrr/**'
            db:
              - 'packages/praxrr-db/**'
            schema:
              - 'packages/praxrr-schema/**'
            api:
              - 'packages/praxrr-api/**'
              - 'docs/api/**'
```

### Compatibility Gates

A new workflow `compatibility.yml` runs on PRs that touch `packages/praxrr-db/` or `packages/praxrr-schema/`:

1. **Schema compilation test**: Apply `packages/praxrr-schema/ops/0.schema.sql` to an in-memory SQLite database.
2. **DB ops layering test**: Run the full ops stack (schema + base ops from `packages/praxrr-db/ops/`) and verify tables are created.
3. **Type generation parity test**: Generate types from local schema, diff against committed `src/lib/shared/pcd/types.ts`.
4. **App build test**: If schema or db changed, also build the app to catch compile-time breakages.

```yaml
# .github/workflows/compatibility.yml
name: Compatibility Gates
on:
  pull_request:
    paths:
      - 'packages/praxrr-schema/**'
      - 'packages/praxrr-db/**'
jobs:
  schema-compile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
      - name: Verify schema applies cleanly
        run: |
          cd packages/praxrr
          deno run -A scripts/generate-pcd-types.ts --local=../praxrr-schema/ops/0.schema.sql
      - name: Verify types are up-to-date
        run: |
          git diff --exit-code packages/praxrr/src/lib/shared/pcd/types.ts

  ops-layering:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
      - name: Verify ops stack
        run: deno run -A scripts/compat-check.ts

  app-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
      - name: Build app
        working-directory: packages/praxrr
        run: |
          deno install --node-modules-dir
          deno task check
```

### Mirror Publish Workflow

Two new workflows mirror package contents to the external split repos.

**`publish-db.yml`**: Triggered on tags matching `db/v*` or on manual dispatch.

```yaml
name: Publish DB Mirror
on:
  push:
    tags:
      - 'db/v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version tag (e.g., v2.1.0)'
        required: true

jobs:
  mirror:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Extract version
        id: version
        run: |
          if [ "${{ github.event_name }}" = "push" ]; then
            echo "value=${GITHUB_REF_NAME#db/v}" >> $GITHUB_OUTPUT
          else
            echo "value=${{ inputs.version }}" >> $GITHUB_OUTPUT
          fi

      - name: Mirror to praxrr-db
        uses: peaceiris/actions-gh-pages@v4
        with:
          personal_token: ${{ secrets.MIRROR_PAT }}
          external_repository: yandy-r/praxrr-db
          publish_branch: v2
          publish_dir: ./packages/praxrr-db
          force_orphan: false
          commit_message: 'Mirror from praxrr monorepo v${{ steps.version.outputs.value }}'

      - name: Tag mirror
        run: |
          cd /tmp
          git clone https://x-access-token:${{ secrets.MIRROR_PAT }}@github.com/yandy-r/praxrr-db
          cd praxrr-db
          git tag "v${{ steps.version.outputs.value }}"
          git push origin "v${{ steps.version.outputs.value }}"
```

**`publish-schema.yml`**: Identical pattern, triggered on `schema/v*` tags, mirrors `packages/praxrr-schema` to `yandy-r/praxrr-schema`.

### Release Workflow

The existing `release.yml` changes its working directory to `packages/praxrr/` for the build steps:

```yaml
steps:
  - name: Checkout
    uses: actions/checkout@v4

  - name: Install dependencies
    working-directory: packages/praxrr
    run: deno install --node-modules-dir

  - name: Build SvelteKit
    working-directory: packages/praxrr
    run: deno run -A npm:vite build
    env:
      APP_BASE_PATH: ./dist/build
      # ...

  - name: Compile Deno binary
    working-directory: packages/praxrr
    run: |
      mkdir -p dist/staging
      deno compile ... dist/build/mod.ts
```

The existing Docker workflow (`docker.yml`) updates the build context:

```yaml
- name: Build and push
  uses: docker/build-push-action@v6
  with:
    context: .
    file: packages/praxrr/${{ matrix.dockerfile }}
    # ...
```

## Migration Sequence

### Phase 1: Scaffolding (Low Risk)

**Goal**: Create the monorepo directory structure without moving any code.

**Steps**:

1. Create `packages/praxrr-db/` directory with `deno.json` (name, version only).
2. Create `packages/praxrr-schema/` directory with `deno.json` (name, version only).
3. Copy the current `praxrr-db` repo contents into `packages/praxrr-db/` (ops, tweaks, pcd.json, README).
4. Copy the current `praxrr-schema` repo contents into `packages/praxrr-schema/` (ops, pcd.json, README).
5. Update root `deno.json` workspace array to include new members: `["packages/praxrr-api", "packages/praxrr-db", "packages/praxrr-schema"]`.
6. Verify: `deno task check`, `deno task test`, `deno task build` all pass (no app code moved yet).

**Rollback**: Delete the new directories, revert `deno.json` workspace change.

### Phase 2: App Move (Medium Risk)

**Goal**: Move main app code into `packages/praxrr/`.

**Steps**:

1. Create `packages/praxrr/` directory.
2. Move these files/directories into `packages/praxrr/`:
   - `src/` -> `packages/praxrr/src/`
   - `scripts/` -> `packages/praxrr/scripts/` (except `bundle-api.ts` which goes to root `scripts/`)
   - `static/` -> `packages/praxrr/static/`
   - `docker/` -> `packages/praxrr/docker/`
   - `svelte.config.js` -> `packages/praxrr/svelte.config.js`
   - `vite.config.ts` -> `packages/praxrr/vite.config.ts`
   - `tsconfig.json` -> `packages/praxrr/tsconfig.json`
   - `package.json` -> `packages/praxrr/package.json`
   - `eslint.config.js` -> `packages/praxrr/eslint.config.js`
   - `.prettierrc` -> `packages/praxrr/.prettierrc`
   - `.prettierignore` -> `packages/praxrr/.prettierignore`
   - `Dockerfile` -> `packages/praxrr/Dockerfile`
   - `Dockerfile.parser` -> `packages/praxrr/Dockerfile.parser`
   - `compose.yml` -> `packages/praxrr/compose.yml`
   - `compose.dev.yml` -> `packages/praxrr/compose.dev.yml`
   - `compose.arr.yml` -> `packages/praxrr/compose.arr.yml`
   - `playwright.config.ts` (if exists) -> `packages/praxrr/playwright.config.ts`
3. Create `packages/praxrr/deno.json` from current root `deno.json` (move `imports`, `tasks`, `compilerOptions`, `exclude`, `fmt`, `lint`, `allowScripts`; remove `workspace`).
4. Update root `deno.json` to be workspace-only config (no `imports`, minimal `tasks`, workspace includes `packages/praxrr`).
5. Update root `deno.json` workspace: `["packages/praxrr", "packages/praxrr-api", "packages/praxrr-db", "packages/praxrr-schema"]`.
6. Update `packages/praxrr/Dockerfile`: Adjust COPY paths for new context.
7. Update `packages/praxrr/Dockerfile.parser`: Adjust COPY paths.
8. Update `scripts/bundle-api.ts` (now at root): Adjust `SPEC_DIR` and `OUT_DIR` paths.
9. Update `.github/workflows/docker.yml`: Set `file: packages/praxrr/Dockerfile` (or `packages/praxrr/Dockerfile.parser`).
10. Update `.github/workflows/release.yml`: Add `working-directory: packages/praxrr` to relevant steps.
11. Update `CLAUDE.md` path aliases table and command documentation.
12. Verify: All tasks pass from `packages/praxrr/` directory. Docker build succeeds. CI dry-run passes.

**Rollback**: `git checkout` to pre-move commit. The `git mv` approach preserves history and makes rollback a simple revert.

**Important**: Use `git mv` for all file moves to preserve git history. This is a single atomic commit.

### Phase 3: Runtime Decoupling (Low Risk)

**Goal**: Make hardcoded repo references configurable.

**Steps**:

1. Add new env vars to `hooks.server.ts` for default DB auto-link (`PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`, `PRAXRR_DEFAULT_DB_NAME`).
2. Update `scripts/generate-pcd-types.ts` to default to local schema path with `--remote` fallback.
3. Update compose files to document new env vars.
4. Update `CLAUDE.md` environment variables section.
5. Verify: Fresh install auto-links with defaults. Custom PCD linking still works. Type generation works from local schema.

**Rollback**: Revert the env var additions. Safe because defaults match current hardcoded values.

### Phase 4: CI/Publish Setup (Low Risk)

**Goal**: Add CI gates and mirror publish workflows.

**Steps**:

1. Create `.github/workflows/compatibility.yml` for cross-package contract testing.
2. Create `.github/workflows/publish-db.yml` for mirroring to `yandy-r/praxrr-db`.
3. Create `.github/workflows/publish-schema.yml` for mirroring to `yandy-r/praxrr-schema`.
4. Add `MIRROR_PAT` secret to repository for push access to mirror repos.
5. Update `.github/workflows/docker.yml` for monorepo paths.
6. Update `.github/workflows/release.yml` for monorepo paths.
7. Dry-run publish workflows to verify correct file sets are mirrored.
8. Verify: CI gates block PRs with broken contracts. Mirror publish dry-run succeeds.

**Rollback**: Delete new workflow files. Existing workflows are unaffected until updated.

### Phase 5: Cutover (Low Risk)

**Goal**: Documentation, communication, and contributor onboarding.

**Steps**:

1. Update root `README.md` with monorepo structure overview.
2. Add `CONTRIBUTING.md` with monorepo-specific contributor guide.
3. Update `CLAUDE.md` with all new paths and conventions.
4. Announce on the repository discussions/wiki that monorepo layout is active.
5. Update any external documentation links.
6. Mark the issue as complete.

**Freeze Points**:

- Freeze Phase 1: After scaffolding, before any code moves. Safe to merge and test.
- Freeze Phase 2: After app move, before runtime changes. The main risk point. Hold here until all CI passes.
- Freeze Phase 3-4: These are additive and can be merged independently.

## Files to Create

- `packages/praxrr-db/deno.json`: Package manifest for db source.
- `packages/praxrr-db/ops/`: Base SQL operations (copied from external repo).
- `packages/praxrr-db/pcd.json`: PCD manifest (copied from external repo).
- `packages/praxrr-schema/deno.json`: Package manifest for schema source.
- `packages/praxrr-schema/ops/0.schema.sql`: Canonical schema DDL (copied from external repo).
- `packages/praxrr-schema/pcd.json`: PCD manifest (copied from external repo).
- `packages/praxrr/deno.json`: Package-level config (extracted from root).
- `.github/workflows/compatibility.yml`: Cross-package contract tests.
- `.github/workflows/publish-db.yml`: Mirror publish to praxrr-db.
- `.github/workflows/publish-schema.yml`: Mirror publish to praxrr-schema.
- `scripts/compat-check.ts`: Compatibility verification script (root-level, cross-package).

## Files to Modify

- `deno.json` (root): Restructure as workspace-only config; move imports/tasks to `packages/praxrr/deno.json`.
- `src/hooks.server.ts` (moves to `packages/praxrr/src/hooks.server.ts`): Add configurable auto-link env vars.
- `scripts/generate-pcd-types.ts` (moves to `packages/praxrr/scripts/generate-pcd-types.ts`): Default to local schema source.
- `scripts/bundle-api.ts` (moves to root `scripts/`): Update relative paths for `docs/api/v1` and `packages/praxrr-api`.
- `Dockerfile` (moves to `packages/praxrr/Dockerfile`): Update COPY paths for monorepo context.
- `Dockerfile.parser` (moves to `packages/praxrr/Dockerfile.parser`): Update COPY path for parser source.
- `.github/workflows/docker.yml`: Update `file:` path to `packages/praxrr/Dockerfile`.
- `.github/workflows/release.yml`: Add `working-directory: packages/praxrr` to build steps.
- `.github/workflows/publish-api.yml`: Update `bundle-api.ts` invocation path.
- `CLAUDE.md`: Update all path references, command documentation, and env var table.
- `README.md`: Add monorepo structure overview.
- `.gitignore`: Add `packages/praxrr/dist/`, `packages/praxrr/node_modules/`.

## Technical Decisions

### Decision 1: Docker Build Context

- **Options**: (A) Keep context at repo root, reference `packages/praxrr/Dockerfile` via `file:` field. (B) Set context to `packages/praxrr/`, use `../../` for root-level files.
- **Recommendation**: Option A -- keep context at repo root.
- **Rationale**: Root context gives Dockerfile access to the shared `deno.lock`, root `deno.json` workspace config, and sibling packages. Option B requires complex path gymnastics and may break if Docker build needs access to root-level files. The `COPY` statements become slightly more verbose but are explicit about what enters the build.

### Decision 2: Where `bundle-api.ts` Lives

- **Options**: (A) Keep in `packages/praxrr/scripts/` and adjust relative paths. (B) Move to root-level `scripts/` since it operates across `docs/api/v1` and `packages/praxrr-api`.
- **Recommendation**: Option B -- move to root `scripts/`.
- **Rationale**: `bundle-api.ts` reads from `docs/api/v1` (root-level) and writes to `packages/praxrr-api/` (a sibling package). It is inherently a cross-package operation that does not belong to the app package. The `publish-api.yml` workflow already runs it from the root.

### Decision 3: Shared vs. Per-Package deno.lock

- **Options**: (A) Single `deno.lock` at root (Deno workspace default). (B) Per-package lockfiles.
- **Recommendation**: Option A -- single lockfile at root.
- **Rationale**: Deno 2.x workspaces use a single lockfile by default. The `praxrr-db` and `praxrr-schema` packages have no Deno dependencies, so they add no entries. The app and API packages share a single resolution graph.

### Decision 4: Git History Preservation During App Move

- **Options**: (A) Use `git mv` for all moves (preserves `git log --follow` history). (B) Create new files and delete old ones.
- **Recommendation**: Option A -- `git mv`.
- **Rationale**: `git mv` is the standard approach for monorepo restructuring. It preserves blame history and allows `git log --follow` to trace files across the move. This is a single commit that makes rollback trivial.

### Decision 5: Mirror Publish Mechanism

- **Options**: (A) Use `git subtree split` + `git push` to maintain proper git history in mirrors. (B) Copy files via GitHub Actions (e.g., `peaceiris/actions-gh-pages` or similar). (C) Use `git-subtree` with squash merging.
- **Recommendation**: Option A -- `git subtree split` for initial setup, then incremental pushes.
- **Rationale**: Subtree split preserves commit history in the mirror repos, which is important for consumers who track changes. The initial split creates a synthetic history of all commits that touched `packages/praxrr-db/` or `packages/praxrr-schema/`. Subsequent pushes add only new commits. This is the standard monorepo-to-split-repo pattern (used by React, Angular, Symfony).

Implementation:

```bash
# One-time setup: create subtree split branch
git subtree split --prefix=packages/praxrr-db -b split/praxrr-db

# Push to mirror
git push https://github.com/yandy-r/praxrr-db split/praxrr-db:v2

# In CI, automated:
git subtree push --prefix=packages/praxrr-db https://github.com/yandy-r/praxrr-db v2
```

### Decision 6: Tag Namespace for Independent Versioning

- **Options**: (A) Prefixed tags: `app/v2.1.0`, `db/v2.1.0`, `schema/v1.1.0`. (B) Separate tag namespaces via branches. (C) Use only the existing `v*` tags for app releases, with separate workflows for db/schema.
- **Recommendation**: Option A -- prefixed tags.
- **Rationale**: Prefixed tags are explicit, unambiguous, and work well with GitHub Actions tag filters. The existing `v*` tags continue to trigger app releases (with a migration to `app/v*` in the future or keeping `v*` as the app convention). DB and schema use `db/v*` and `schema/v*` prefixes.

### Decision 7: Local Schema Access for Type Generation

- **Options**: (A) `generate-pcd-types.ts` defaults to local file, with `--remote` override. (B) Keep GitHub fetch as default, add `--local` override (current behavior already has `--local`). (C) Detect workspace and auto-resolve.
- **Recommendation**: Option A -- default to local.
- **Rationale**: In a monorepo, the schema source of truth is local. Fetching from GitHub is unnecessary overhead and introduces a dependency on network access. The `--remote` flag preserves the ability to generate types against a specific published version. The current `--local` flag already exists and proves the mechanism works.

## Architectural Patterns

- **Deno Workspace Members**: Each package under `packages/` has its own `deno.json` with `name` and `version`. The root `deno.json` lists them in `workspace`. Deno resolves imports per-member.
- **Relative Path Aliases**: All `$lib/`, `$db/`, etc. aliases use `./src/lib/` relative paths. This pattern means the aliases are position-independent -- they work wherever `deno.json` and `src/` are co-located.
- **PCD Dependency Resolution**: The manifest `pcd.json` declares dependencies by GitHub URL + version tag. The dependency system clones into `deps/` at the PCD path. This is inherently decoupled from the monorepo structure.
- **Ops Layering**: Schema, base, tweaks, and user ops are loaded from well-known relative paths within a PCD. No absolute paths or URLs are involved in ops loading.
- **Existing Workspace Precedent**: `packages/praxrr-api` already exists as a workspace member. The JSR publish workflow (`publish-api.yml`) already operates in this pattern.

## Gotchas and Edge Cases

- **`deno install --node-modules-dir` scope**: When run from `packages/praxrr/`, this installs `node_modules` at `packages/praxrr/node_modules/`. The root-level `node_modules/` becomes stale. The root `.gitignore` and `packages/praxrr/.gitignore` must both exclude `node_modules/`.
- **SvelteKit `.svelte-kit` output**: The `outDir: 'dist/.svelte-kit'` in `svelte.config.js` produces `packages/praxrr/dist/.svelte-kit/`. The `tsconfig.json` extends this path. If any CI step runs SvelteKit from the root directory instead of the app package, it will fail to find the generated config.
- **`APP_BASE_PATH` in Docker**: The Docker entrypoint sets `APP_BASE_PATH=/config`. This is runtime configuration and is unaffected by the monorepo structure.
- **Parser service CWD**: `scripts/dev.ts` uses `cwd: 'src/services/parser'` for the parser process. After move, this becomes relative to `packages/praxrr/`, which is correct since the script moves with it.
- **`deno.lock` location**: Deno workspaces resolve the lockfile from the workspace root. After the migration, running `deno install` from `packages/praxrr/` should still find/update the root `deno.lock`. Verify this behavior.
- **Prettier/ESLint config resolution**: These tools walk up the directory tree for config. Moving `.prettierrc` and `eslint.config.js` into `packages/praxrr/` means they only apply there. Root-level markdown files (like `README.md`) may need a separate `.prettierrc` at root, or the root-level `format` task must specify the config path.
- **`publish:api` task chain**: Currently `"publish:api": "deno task bundle:api && cd packages/praxrr-api && deno publish"`. After migration, `bundle-api.ts` moves to root `scripts/`. The task needs to reference the root script.
- **`deno task` CWD**: When running `deno task dev` from the repo root (via the root `deno.json` convenience task that does `cd packages/praxrr && deno task dev`), Deno resolves the task from the root config first, then the shell `cd` changes directory. This works but means the root and package task names should not conflict.

## Open Questions

1. **Mirror repo branch strategy**: Should the mirror repos (`praxrr-db`, `praxrr-schema`) maintain a `main` branch or only a `v2` branch? Currently `praxrr-db` uses `v2` as the default branch.
2. **Schema versioning cadence**: Should schema changes require a version bump in `packages/praxrr-schema/pcd.json` before they can be merged to the main branch? This would enforce explicit version gating.
3. **Dev workflow for cross-package changes**: When a developer changes the schema locally, should `generate-pcd-types.ts` auto-detect the local change, or must they explicitly pass `--local=../praxrr-schema/ops/0.schema.sql`?
4. **E2E test database**: The e2e tests use `praxrr-db-v2-testing` (a separate test repo). Should this be brought into the monorepo as well, or remain external?
5. **`praxrr-api` publish trigger**: Currently triggered on `v*.*.*` tags. After monorepo, should this be triggered on `api/v*` tags, or remain tied to app releases?
6. **Root-level Prettier/ESLint**: After moving configs into `packages/praxrr/`, should the root have its own minimal Prettier config for formatting `docs/`, `README.md`, etc.?

## Other Docs

- [Deno Workspaces documentation](https://docs.deno.com/runtime/fundamentals/workspaces/)
- [GitHub Issue #37](https://github.com/yandy-r/praxrr/issues/37) -- the task definition for this migration
- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md` -- project conventions and architecture reference
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-api/deno.json` -- existing workspace member pattern
