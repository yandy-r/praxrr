# External API Research: monorepo-strategy

## Executive Summary

Deno 2.x has native workspace support that directly addresses the monorepo consolidation goal,
providing member discovery, shared import maps, cross-package bare specifier resolution, and
per-member configuration inheritance. For mirroring subdirectories to `yandy-r/praxrr-db` and
`yandy-r/praxrr-schema`, `git subtree split` (or the faster `splitsh-lite`) combined with a
GitHub Actions pipeline is the most battle-tested approach. Independent versioning across
packages is best managed with Google's `release-please` using its manifest-based monorepo mode
and a `simple` release type for Deno packages that do not publish to npm. The migration itself
can preserve full git history using `git-filter-repo --to-subdirectory-filter` for the incoming
repos and `git merge --allow-unrelated-histories` into the existing `praxrr` repository.

---

## Primary APIs

<!-- Deno Monorepo Tooling -->

### Deno Workspaces

- **Documentation**: <https://docs.deno.com/runtime/fundamentals/workspaces/>
- **CLI Reference**: <https://docs.deno.com/runtime/reference/cli/task/>

#### Configuration

Root `deno.json` declares workspace members via a `workspace` array. Members can be explicit
paths or glob patterns:

```jsonc
{
  "workspace": ["./packages/praxrr", "./packages/praxrr-db", "./packages/praxrr-schema"],
  // OR with globs:
  // "workspace": ["packages/*"]
}
```

Each member directory contains its own `deno.json` (or `package.json` for npm-hybrid members).
Members must declare `name`, `version`, and `exports` to participate in bare-specifier resolution:

```jsonc
// packages/praxrr-schema/deno.json
{
  "name": "@yandy-r/praxrr-schema",
  "version": "1.0.0",
  "exports": "./mod.ts",
}
```

Multiple entry points are supported:

```jsonc
{
  "name": "@yandy-r/praxrr-schema",
  "exports": {
    ".": "./mod.ts",
    "./pcd": "./pcd.ts",
  },
}
```

**Confidence**: High -- Verified against official Deno documentation (docs.deno.com), currently
stable in Deno 2.x since the 1.45 workspace release.

#### Capabilities

| Capability                          | Status                                                 |
| ----------------------------------- | ------------------------------------------------------ |
| Shared import maps                  | Supported (root `imports` inherited by members)        |
| Per-member import overrides         | Supported (member `imports` take priority)             |
| Bare specifier cross-member imports | Supported (via `name`/`exports` in member `deno.json`) |
| Shared compiler options             | Supported (root `compilerOptions` inherited)           |
| Per-member lint/fmt rules           | Supported (member overrides root)                      |
| Selective task execution            | Supported (`--filter`, `--cwd`, `--recursive`)         |
| `deno check` across workspace       | Supported (runs in all members from root)              |
| `deno test` across workspace        | Supported (runs in all members from root)              |
| `deno publish` multi-package        | Supported (auto-resolves publish order)                |
| Hybrid npm + Deno members           | Supported (members can use `package.json`)             |
| Glob patterns for member discovery  | Supported (`packages/*`)                               |

#### Limitations

1. **No built-in task dependency graph.** `deno task -r <name>` runs the named task in all
   members in parallel, but there is no way to declare that package A's build must complete
   before package B's build starts. Workaround: chain tasks in a shell script or use sequential
   `deno task --filter` calls.

2. **Fuzzy matching on `--recursive`.** `deno task -r lint` will also match `lint:watch` or
   `linting` in members, which can trigger unwanted tasks. See
   [denoland/deno#27401](https://github.com/denoland/deno/issues/27401).

3. **`--filter` requires `name` property.** The filter flag matches against the `name` field in
   each member's `deno.json`. Members without a `name` field are invisible to `--filter`. See
   [denoland/deno#27713](https://github.com/denoland/deno/issues/27713).

4. **No parallel long-running tasks.** Unlike Turborepo, `deno task -r dev` does not keep
   multiple long-running processes alive in parallel. See
   [denoland/deno#27586](https://github.com/denoland/deno/issues/27586).

5. **Workspace-only config options.** `importMap`, `scopes`, `nodeModulesDir`, `vendor`, `lock`,
   `unstable`, and `workspace` can only be set at the root level, not in members.

6. **Member-only config options.** `name`, `version`, and `exports` can only be set in members,
   not at the root.

**Confidence**: High -- Limitations sourced from official documentation and verified GitHub issues.

### Import Maps and Path Resolution

The root `deno.json` `imports` field acts as a shared import map for the entire workspace.
Members inherit these mappings automatically. A member can override any mapping by specifying its
own `imports`:

```jsonc
// Root deno.json
{
  "workspace": ["packages/*"],
  "imports": {
    "chalk": "npm:chalk@5",
    "@std/assert": "jsr:@std/assert@^1.0.0",
  },
}
```

```jsonc
// packages/praxrr-db/deno.json -- overrides chalk version for this member only
{
  "name": "@yandy-r/praxrr-db",
  "version": "1.0.0",
  "exports": "./mod.ts",
  "imports": {
    "chalk": "npm:chalk@4",
  },
}
```

Cross-member imports use bare specifiers resolved from the member's `name` and `exports` fields:

```ts
// In packages/praxrr/src/foo.ts
import { PcdSchema } from '@yandy-r/praxrr-schema';
import { PcdOps } from '@yandy-r/praxrr-schema/pcd';
```

**Current praxrr context.** The existing root `deno.json` already uses workspace-compatible
path aliases (`$lib/`, `$db/`, etc.) in `imports`. These would remain in the root config and be
inherited by the main app member. The db and schema members would define their own minimal
imports.

**Confidence**: High -- Documented behavior, consistent across Deno 2.x releases.

### Task Orchestration

| Flag              | Behavior                                            |
| ----------------- | --------------------------------------------------- |
| `--cwd <DIR>`     | Run task in a specific directory                    |
| `-f, --filter`    | Run task only in members matching the filter string |
| `-r, --recursive` | Run task across all workspace members in parallel   |

Examples:

```bash
# Run tests in all members
deno task -r test

# Run tests only in the schema package
deno task -f "@yandy-r/praxrr-schema" test

# Run build in a specific directory
deno task --cwd packages/praxrr-db build

# Type-check all members from root
deno check
```

For orchestrating complex builds that need sequencing, a root-level shell script or `deno run`
orchestrator is needed:

```jsonc
// Root deno.json
{
  "tasks": {
    "build:all": "deno task --cwd packages/praxrr-schema build && deno task --cwd packages/praxrr-db build && deno task --cwd packages/praxrr build",
  },
}
```

**Confidence**: High -- CLI flags verified in
[Deno task reference](https://docs.deno.com/runtime/reference/cli/task/) and community
discussions.

---

## Git Subtree / Split Strategies

### Recommended Approach: `git subtree split` + GitHub Actions

- **Documentation**: `man git-subtree` or
  <https://manpages.ubuntu.com/manpages/trusty/man1/git-subtree.1.html>
- **Reference implementation**: <https://arcsoft.uvic.ca/log/2025-09-02-git-subtree-for-repo-mirroring/>

#### How It Works

`git subtree split --prefix=<path>` rewrites the commit history for a subdirectory into a
standalone branch. Every commit that touched files under `<path>` gets a new hash with the
prefix directory stripped from file paths. The result is a clean, self-contained history
suitable for pushing to a separate repository.

```
Monorepo commits:   A -- B -- C -- D -- E -- F
                    (all touch various dirs)

After split --prefix=packages/praxrr-db:
Split branch:       A' -- C' -- E'
                    (only commits that modified packages/praxrr-db, with paths at root)
```

#### Key Commands

```bash
# One-time setup: add mirror remotes
git remote add praxrr-db-mirror git@github.com:yandy-r/praxrr-db.git
git remote add praxrr-schema-mirror git@github.com:yandy-r/praxrr-schema.git

# Split and push (db)
git subtree split --prefix=packages/praxrr-db -b split/praxrr-db
git push praxrr-db-mirror split/praxrr-db:main

# Split and push (schema)
git subtree split --prefix=packages/praxrr-schema -b split/praxrr-schema
git push praxrr-schema-mirror split/praxrr-schema:main

# Clean up local split branches
git branch -D split/praxrr-db split/praxrr-schema
```

#### Limitations

1. **Performance degrades with history size.** On repositories with 30,000+ commits, a full
   split can take 12+ minutes. Subsequent incremental splits are faster if you reuse the same
   branch name, but `git subtree` does not natively cache split state between invocations.

2. **One-way only.** This strategy assumes the monorepo is the source of truth. Changes pushed
   directly to `praxrr-db` or `praxrr-schema` mirror repos will not flow back automatically.
   For the stated goal (unidirectional mirror), this is acceptable.

3. **Tag mirroring requires extra work.** Tags from the monorepo are not automatically
   rewritten. You must create tags on the split branch manually or via CI.

4. **Alpine Linux requires explicit install.** `apk add git-subtree` is needed; Ubuntu and
   macOS include it with standard Git.

**Confidence**: High -- `git subtree` is a long-standing Git contrib tool, widely used in
production monorepos (Symfony, Laravel). The ARCsoft 2025 reference validates the CI pipeline
pattern.

### Alternative: splitsh-lite

- **Repository**: <https://github.com/splitsh/lite>
- **GitHub Action**: <https://github.com/acrobat/subtree-splitter>

splitsh-lite is a Go reimplementation of `git subtree split` with persistent caching. Key
differences:

| Feature               | `git subtree split` | `splitsh-lite`                 |
| --------------------- | ------------------- | ------------------------------ |
| **Performance**       | Slow on first run   | Fast with incremental caching  |
| **SHA compatibility** | Reference impl      | Generates identical SHAs       |
| **Installation**      | Built into Git      | Requires Go + libgit2 compile  |
| **CI integration**    | Native              | Via `acrobat/subtree-splitter` |
| **Caching**           | No persistent cache | Persistent cache between runs  |

Usage:

```bash
splitsh-lite --prefix=packages/praxrr-db --target=refs/heads/split/praxrr-db
git push praxrr-db-mirror split/praxrr-db:main
```

**Recommendation.** Start with plain `git subtree split` in CI. The praxrr repository has a
modest commit count; performance should not be a problem. Switch to splitsh-lite only if CI
split times exceed an acceptable threshold (e.g., > 2 minutes).

**Confidence**: High -- splitsh-lite is used by Symfony and other major PHP monorepos. SHA
compatibility with `git subtree split` is documented and tested.

### Alternative: git-filter-repo

- **Repository**: <https://github.com/newren/git-filter-repo>

`git-filter-repo` is the Git-recommended replacement for `git filter-branch`. It rewrites
history in a single optimized pass. Use case here is primarily for the initial migration (moving
existing repos into subdirectories), not for ongoing splits. See the Migration Tools section.

**Confidence**: High -- Endorsed by the Git project itself as the replacement for
`git filter-branch`.

### Not Recommended: git submodules

Git submodules are not suitable for this use case because:

- They create friction for contributors (extra clone steps, detached HEAD state).
- They do not support atomic cross-component commits.
- They add complexity to CI/CD pipelines.
- The stated goal is consolidation, which submodules work against.

**Confidence**: High -- Well-established anti-pattern for the stated goals.

---

## CI/CD Pipeline Patterns

### GitHub Actions for Monorepo

#### Changed Package Detection: dorny/paths-filter

- **Repository**: <https://github.com/dorny/paths-filter>
- **Marketplace**: <https://github.com/marketplace/actions/paths-filter>

The `dorny/paths-filter` action is the most widely used solution for detecting which packages
changed in a push or PR. It supports picomatch glob patterns, outputs boolean flags per filter,
and can list matching files.

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: read
    outputs:
      app: ${{ steps.filter.outputs.app }}
      db: ${{ steps.filter.outputs.db }}
      schema: ${{ steps.filter.outputs.schema }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            app:
              - 'packages/praxrr/**'
              - 'src/**'
            db:
              - 'packages/praxrr-db/**'
            schema:
              - 'packages/praxrr-schema/**'
```

**Confidence**: High -- dorny/paths-filter has 6,000+ GitHub stars and is actively maintained.

#### Selective CI

Gate downstream jobs on the change detection outputs:

```yaml
test-app:
  needs: changes
  if: ${{ needs.changes.outputs.app == 'true' }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: denoland/setup-deno@v2
    - run: deno task --cwd packages/praxrr test

test-db:
  needs: changes
  if: ${{ needs.changes.outputs.db == 'true' }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: denoland/setup-deno@v2
    - run: deno task --cwd packages/praxrr-db test

test-schema:
  needs: changes
  if: ${{ needs.changes.outputs.schema == 'true' }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: denoland/setup-deno@v2
    - run: deno task --cwd packages/praxrr-schema test
```

Alternatively, use the `changes` output with `fromJSON()` to dynamically generate a matrix:

```yaml
test:
  needs: changes
  if: ${{ needs.changes.outputs.changes != '[]' }}
  strategy:
    matrix:
      package: ${{ fromJSON(needs.changes.outputs.changes) }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: denoland/setup-deno@v2
    - run: deno task --cwd packages/${{ matrix.package }} test
```

**Confidence**: High -- Standard GitHub Actions pattern used across many monorepo projects.

### Publish/Mirror Pipeline

#### Option A: Native `git subtree split` in workflow

```yaml
name: Mirror Subtrees
on:
  push:
    branches: [main, v2]
    paths:
      - 'packages/praxrr-db/**'
      - 'packages/praxrr-schema/**'

jobs:
  mirror:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - prefix: packages/praxrr-db
            target: yandy-r/praxrr-db
            branch: main
          - prefix: packages/praxrr-schema
            target: yandy-r/praxrr-schema
            branch: main
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # Full history required for subtree split

      - name: Split subtree
        run: |
          git subtree split --prefix=${{ matrix.prefix }} -b split-branch

      - name: Push to mirror
        run: |
          git remote add mirror https://x-access-token:${{ secrets.MIRROR_PAT }}@github.com/${{ matrix.target }}.git
          git push mirror split-branch:${{ matrix.branch }} --force
```

#### Option B: nxtlvlsoftware/git-subtree-action

```yaml
name: Mirror Subtrees
on:
  push:
    branches: [main, v2]

jobs:
  sync:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - path: packages/praxrr-db
            repo: yandy-r/praxrr-db
          - path: packages/praxrr-schema
            repo: yandy-r/praxrr-schema
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: nxtlvlsoftware/git-subtree-action@v1.1
        with:
          repo: ${{ matrix.repo }}
          path: ${{ matrix.path }}
          deploy_key: ${{ secrets.SUBTREE_DEPLOY_KEY }}
          force: true
```

#### Option C: acrobat/subtree-splitter (uses splitsh-lite)

```yaml
name: Mirror Subtrees
on:
  push:
    branches: [main, v2]
    paths: ['packages/praxrr-db/**', 'packages/praxrr-schema/**']
  create:
    tags: ['praxrr-db/*', 'praxrr-schema/*']

jobs:
  split:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: frankdejonge/use-github-token@1.0.2
        with:
          authentication: 'username:${{ secrets.MIRROR_PAT }}'
          user_name: 'praxrr-bot'
          user_email: 'bot@praxrr.dev'

      - uses: acrobat/subtree-splitter@v1
        with:
          config-path: .github/subtree-splitter-config.json
```

With config file `.github/subtree-splitter-config.json`:

```json
{
  "subtree-splits": [
    {
      "name": "praxrr-db",
      "directory": "packages/praxrr-db",
      "target": "git@github.com:yandy-r/praxrr-db.git"
    },
    {
      "name": "praxrr-schema",
      "directory": "packages/praxrr-schema",
      "target": "git@github.com:yandy-r/praxrr-schema.git"
    }
  ]
}
```

#### Tag Mirroring

To mirror version tags to split repos, extend the workflow to create tags on the split branch:

```yaml
- name: Mirror tags
  if: startsWith(github.ref, 'refs/tags/')
  run: |
    TAG_NAME=${GITHUB_REF#refs/tags/}
    # Only mirror tags for this package (e.g., praxrr-db/v1.2.3)
    if [[ "$TAG_NAME" == "${{ matrix.prefix }}/"* ]]; then
      CLEAN_TAG=${TAG_NAME#${{ matrix.prefix }}/}
      git tag "$CLEAN_TAG" split-branch
      git push mirror "$CLEAN_TAG"
    fi
```

**Recommendation.** Option A (native `git subtree split`) is simplest and has zero external
dependencies beyond Git itself. Start here. Graduate to Option C (splitsh-lite via
acrobat/subtree-splitter) if split performance becomes a bottleneck.

**Confidence**: High -- All three options are production-tested. Option A is the most portable.

### Provenance and Rollback

- **Provenance metadata.** Each split commit retains its original author, date, and message.
  The SHA changes because the tree is rewritten, but the mapping is deterministic (same input
  always produces same output SHAs).

- **Rollback.** Since mirror repos are force-pushed from splits, rollback means re-running the
  split from an earlier monorepo commit. The monorepo is the authoritative source; mirror repos
  are always reproducible.

- **Audit trail.** The monorepo commit log is the single source of truth. Mirror repo commits
  can be traced back to their monorepo origin by matching author/date/message.

**Confidence**: Medium -- Provenance is inherent to the deterministic split process. Rollback
procedures depend on implementation choices.

---

## Integration Patterns

<!-- Migration Tools -->

### History-Preserving Migration with git-filter-repo

- **Tool**: git-filter-repo
- **Repository**: <https://github.com/newren/git-filter-repo>
- **Install**: `pip install git-filter-repo` or `brew install git-filter-repo`
- **Reference**: <https://developers.netlify.com/guides/migrating-git-from-multirepo-to-monorepo-without-losing-history/>

#### Process

**Step 1: Clone `praxrr-db` to a temporary location.**

```bash
git clone git@github.com:yandy-r/praxrr-db.git /tmp/praxrr-db-import
cd /tmp/praxrr-db-import
```

**Step 2: Rewrite history to place all files under `packages/praxrr-db/`.**

```bash
git filter-repo --to-subdirectory-filter packages/praxrr-db
```

This rewrites every commit so that all files appear as if they always existed under
`packages/praxrr-db/`.

**Step 3: Fix cross-repo issue references (optional but recommended).**

```bash
git filter-repo --commit-callback '
import re
msg = commit.message.decode("utf-8")
newmsg = re.sub(r"\(#(?=\d+\))", "(yandy-r/praxrr-db#", msg)
commit.message = newmsg.encode("utf-8")
'
```

**Step 4: Merge into praxrr monorepo.**

```bash
cd /path/to/praxrr
git checkout -b integrate-praxrr-db
git remote add temp-db /tmp/praxrr-db-import
git fetch temp-db
git merge temp-db/main --allow-unrelated-histories -m "Integrate praxrr-db repository"
git remote remove temp-db
```

**Step 5: Repeat for `praxrr-schema`.**

```bash
git clone git@github.com:yandy-r/praxrr-schema.git /tmp/praxrr-schema-import
cd /tmp/praxrr-schema-import
git filter-repo --to-subdirectory-filter packages/praxrr-schema
git filter-repo --commit-callback '
import re
msg = commit.message.decode("utf-8")
newmsg = re.sub(r"\(#(?=\d+\))", "(yandy-r/praxrr-schema#", msg)
commit.message = newmsg.encode("utf-8")
'
cd /path/to/praxrr
git remote add temp-schema /tmp/praxrr-schema-import
git fetch temp-schema
git merge temp-schema/main --allow-unrelated-histories -m "Integrate praxrr-schema repository"
git remote remove temp-schema
```

**Step 6: Create PR with merge commit (NOT squash).**

Critical: If you squash the PR, all imported history is lost. The PR must be merged with a merge
commit to preserve the full history from both repos.

#### Risks

1. **Open PRs on source repos.** Any open PRs on `praxrr-db` or `praxrr-schema` at the time of
   migration will become orphaned. Best to merge or close them first.

2. **GitHub issue references.** Commit messages referencing `#123` will point to the wrong repo
   after import. The `--commit-callback` step mitigates this by prefixing references.

3. **Branch protection.** You may need to temporarily allow merge commits if your branch
   protection only allows squash merges.

4. **Git blame continuity.** `git log --follow` and `git blame` will follow renames through the
   filter-repo rewrite, but some Git GUIs may not.

**Confidence**: High -- git-filter-repo is the Git-endorsed tool for history rewriting. The
Netlify guide (2025) validates the end-to-end process.

### In-Place Restructuring (Moving App Code to packages/praxrr)

For the existing app code that needs to move from `src/` to `packages/praxrr/src/`, there are
two approaches:

#### Approach A: Simple `git mv` (recommended)

```bash
mkdir -p packages/praxrr
git mv src packages/praxrr/src
git mv svelte.config.js packages/praxrr/
git mv vite.config.ts packages/praxrr/
git mv tsconfig.json packages/praxrr/
git mv package.json packages/praxrr/
git mv eslint.config.js packages/praxrr/
# ... move other app-specific files
git commit -m "refactor: move app code to packages/praxrr"
```

Pros:

- Simple, understandable, single commit.
- `git log --follow` tracks renames through the move.
- No history rewriting required.

Cons:

- `git log packages/praxrr/src/lib/server/db/db.ts` without `--follow` only shows post-move commits.

#### Approach B: git-filter-repo rewrite (preserve full path history)

```bash
git filter-repo --path-rename src/:packages/praxrr/src/
```

Pros:

- Every historical commit shows files at their new location.
- `git log` and `git blame` work without `--follow`.

Cons:

- Rewrites all commit SHAs (force-push required).
- Breaks existing PRs, branch references, and GitHub links.
- Much higher risk for an in-place migration.

**Recommendation.** Use Approach A (`git mv`). The benefits of SHA-stable history far outweigh
the minor inconvenience of needing `--follow` for pre-move blame.

**Confidence**: High -- Both approaches are well-documented. Approach A is the standard
practice for in-place monorepo transitions.

---

## Version Management

### Independent Versioning with release-please

- **Repository**: <https://github.com/googleapis/release-please>
- **Action**: <https://github.com/googleapis/release-please-action>
- **Manifest docs**: <https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md>

release-please is Google's tool for automating version bumps, changelogs, and GitHub releases
based on Conventional Commits. It supports monorepos with independent versioning per package
via a manifest configuration.

#### Configuration

**`release-please-config.json`** (root of repo):

```json
{
  "separate-pull-requests": true,
  "include-component-in-tag": true,
  "tag-separator": "/",
  "packages": {
    "packages/praxrr": {
      "release-type": "simple",
      "component": "praxrr",
      "package-name": "praxrr",
      "changelog-path": "CHANGELOG.md"
    },
    "packages/praxrr-db": {
      "release-type": "simple",
      "component": "praxrr-db",
      "package-name": "praxrr-db",
      "changelog-path": "CHANGELOG.md"
    },
    "packages/praxrr-schema": {
      "release-type": "simple",
      "component": "praxrr-schema",
      "package-name": "praxrr-schema",
      "changelog-path": "CHANGELOG.md"
    }
  }
}
```

**`.release-please-manifest.json`** (root of repo, tracks current versions):

```json
{
  "packages/praxrr": "0.2.0",
  "packages/praxrr-db": "1.0.0",
  "packages/praxrr-schema": "1.0.0"
}
```

Key configuration options:

| Option                     | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `separate-pull-requests`   | One release PR per package (not a combined PR)     |
| `include-component-in-tag` | Tags like `praxrr/v0.3.0` instead of `v0.3.0`      |
| `tag-separator`            | Separator between component and version in tag     |
| `release-type: simple`     | Generic strategy; bumps a `version.txt` file       |
| `component`                | Package identifier used in tags and release titles |
| `exclude-paths`            | Ignore commits in specified paths for this package |

The `simple` release type is appropriate for Deno packages that are not published to npm. It
creates a `version.txt` file with the version number. For packages that publish to JSR via
`deno.json`, you can use `extra-files` to also update the `version` field in `deno.json`:

```json
{
  "packages": {
    "packages/praxrr-schema": {
      "release-type": "simple",
      "component": "praxrr-schema",
      "extra-files": [
        {
          "type": "json",
          "path": "deno.json",
          "jsonpath": "$.version"
        }
      ]
    }
  }
}
```

#### GitHub Actions Workflow

```yaml
name: Release Please
on:
  push:
    branches: [main, v2]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      releases_created: ${{ steps.release.outputs.releases_created }}
      praxrr--release_created: ${{ steps.release.outputs['packages/praxrr--release_created'] }}
      praxrr-db--release_created: ${{ steps.release.outputs['packages/praxrr-db--release_created'] }}
      praxrr-schema--release_created: ${{ steps.release.outputs['packages/praxrr-schema--release_created'] }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

  # Trigger mirror after db or schema release
  mirror-subtrees:
    needs: release-please
    if: |
      needs.release-please.outputs['praxrr-db--release_created'] == 'true' ||
      needs.release-please.outputs['praxrr-schema--release_created'] == 'true'
    uses: ./.github/workflows/mirror-subtrees.yml
    secrets: inherit
```

**Confidence**: High -- release-please is widely used and well-documented. The `simple` release
type and `extra-files` JSON path updater are stable features.

#### Why Not Changesets?

[Changesets](https://github.com/changesets/changesets) is an alternative version management
tool popular in the npm ecosystem. However:

1. It is heavily npm/Node.js oriented; the CLI and automation assume `package.json` and npm
   registries.
2. It requires `npx changeset` commands that add workflow friction for a Deno project.
3. release-please is language-agnostic (the `simple` release type works for any runtime) and
   integrates purely through Conventional Commits and GitHub Actions.

**Confidence**: Medium -- Changesets could technically work via npm compatibility in Deno, but
release-please is a better fit for a non-npm project.

### Compatibility Gates

#### Strategy: Semver Ranges + Contract Tests

Each package declares its minimum compatible version of sibling packages. The schema package is
the foundation; the db package depends on schema; the app depends on both.

```
praxrr-schema v1.x  <--  praxrr-db v1.x  <--  praxrr v0.x
```

**Gate 1: Import-time type checking.** Because Deno workspace members import each other via bare
specifiers, `deno check` at the root will catch any type incompatibilities across packages at
development time. This is the primary compatibility gate.

**Gate 2: CI matrix testing.** When schema changes, CI should also run db and app tests:

```yaml
test-dependents:
  needs: changes
  if: ${{ needs.changes.outputs.schema == 'true' }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: denoland/setup-deno@v2
    - run: deno check # Type-checks all members
    - run: deno task -r test # Runs tests in all members
```

**Gate 3: Version compatibility assertions.** For published packages consumed externally, assert
compatibility in tests:

```ts
// packages/praxrr-db/tests/compat.test.ts
import { assertEquals } from '@std/assert';
import { SCHEMA_VERSION } from '@yandy-r/praxrr-schema';

Deno.test('schema version compatibility', () => {
  const [major] = SCHEMA_VERSION.split('.').map(Number);
  assertEquals(major, 1, 'praxrr-db requires praxrr-schema v1.x');
});
```

**Confidence**: Medium -- The type-checking gate is inherent to Deno workspaces. The CI matrix
and version assertions are recommended patterns but require implementation.

---

## Constraints and Gotchas

### Constraint 1: SvelteKit + Deno Workspace Interaction

**Impact**: SvelteKit uses Vite for bundling, which has its own module resolution that may not
fully respect Deno workspace bare specifiers.

**Workaround**: SvelteKit's `svelte.config.js` already defines path aliases via
`kit.alias`. These must be kept in sync with the root `deno.json` `imports`. The app member's
`package.json` (needed for SvelteKit/Vite) can use npm workspace protocol for cross-member
dependencies if needed.

**Confidence**: Medium -- Known tension between Deno workspace resolution and Vite bundler
resolution. The existing project already manages this with dual config.

### Constraint 2: `fetch-depth: 0` Required in CI

**Impact**: Subtree split operations require full git history. CI runners using shallow clones
(the default) will fail.

**Workaround**: Always use `fetch-depth: 0` in checkout steps for mirror/split workflows. This
increases clone time but is unavoidable.

**Confidence**: High -- Well-documented requirement.

### Constraint 3: Force-Push to Mirror Repos

**Impact**: Mirror repos receive force-pushes from subtree splits. Any manual commits made
directly to mirror repos will be overwritten.

**Workaround**: Mark mirror repos as read-only (add branch protection that only allows the CI
bot to push). Add a prominent notice in mirror repo READMEs indicating the source of truth is
the monorepo.

**Confidence**: High -- Standard practice for mirrored monorepo packages.

### Constraint 4: Conventional Commits Required for release-please

**Impact**: release-please determines version bumps from commit messages following the
Conventional Commits specification (`feat:`, `fix:`, `BREAKING CHANGE:`, etc.).

**Workaround**: The praxrr project already uses conventional commits per the CLAUDE.md
conventions. Enforce with a commit-msg hook or CI check (e.g.,
`commitlint`).

**Confidence**: High -- Already aligned with project conventions.

### Constraint 5: Deno Task Fuzzy Matching

**Impact**: `deno task -r lint` may match `lint:fix` or `lint:watch` in members, triggering
unintended tasks.

**Workaround**: Use distinct, non-overlapping task names across members. Prefer explicit
`--filter` over `--recursive` for tasks with common name prefixes.

**Confidence**: High -- Documented bug in
[denoland/deno#27401](https://github.com/denoland/deno/issues/27401).

---

## Code Examples

### Deno Workspace Configuration (Complete)

```jsonc
// Root deno.json
{
  "workspace": ["packages/*"],
  "imports": {
    // Shared dependencies across all members
    "@std/assert": "jsr:@std/assert@^1.0.0",
    "@std/yaml": "jsr:@std/yaml@^1.0.10",
  },
  "tasks": {
    "build:all": "deno task -f '@yandy-r/praxrr-schema' build && deno task -f '@yandy-r/praxrr-db' build && deno task -f '@yandy-r/praxrr' build",
    "test:all": "deno task -r test",
    "check:all": "deno check",
    "lint:all": "deno task -r lint",
  },
  "compilerOptions": {
    "strict": true,
  },
  "fmt": {
    "exclude": ["dist/", "node_modules/"],
    "indentWidth": 2,
    "useTabs": false,
  },
  "lint": {
    "exclude": ["dist/", "node_modules/"],
  },
}
```

```jsonc
// packages/praxrr/deno.json
{
  "name": "@yandy-r/praxrr",
  "version": "0.2.0",
  "exports": "./src/lib/index.ts",
  "imports": {
    // App-specific path aliases
    "$lib/": "./src/lib/",
    "$api/": "./src/lib/api/",
    "$config": "./src/lib/server/utils/config/config.ts",
    "$logger/": "./src/lib/server/utils/logger/",
    "$shared/": "./src/lib/shared/",
    "$stores/": "./src/lib/client/stores/",
    "$ui/": "./src/lib/client/ui/",
    "$db/": "./src/lib/server/db/",
    "$pcd/": "./src/lib/server/pcd/",
    "$arr/": "./src/lib/server/utils/arr/",
    "$sync/": "./src/lib/server/sync/",
    "$jobs/": "./src/lib/server/jobs/",
    "$http/": "./src/lib/server/utils/http/",
    "$utils/": "./src/lib/server/utils/",
    "$notifications/": "./src/lib/server/notifications/",
    "$cache/": "./src/lib/server/utils/cache/",
    "$auth/": "./src/lib/server/utils/auth/",
    // App-specific dependencies
    "@soapbox/kysely-deno-sqlite": "jsr:@soapbox/kysely-deno-sqlite@^2.2.0",
    "marked": "npm:marked@^15.0.6",
    "croner": "npm:croner@^9.1.0",
    "@felix/bcrypt": "jsr:@felix/bcrypt@^1.0.8",
  },
  "tasks": {
    "dev": "deno run -A scripts/dev.ts",
    "build": "deno run -A npm:vite build",
    "test": "deno test src/tests",
    "check": "deno check src/lib/server/**/*.ts",
    "lint": "eslint .",
  },
  "compilerOptions": {
    "lib": ["deno.window", "dom"],
  },
}
```

```jsonc
// packages/praxrr-db/deno.json
{
  "name": "@yandy-r/praxrr-db",
  "version": "1.0.0",
  "exports": "./mod.ts",
  "tasks": {
    "test": "deno test",
    "check": "deno check mod.ts",
    "lint": "deno lint",
  },
}
```

```jsonc
// packages/praxrr-schema/deno.json
{
  "name": "@yandy-r/praxrr-schema",
  "version": "1.0.0",
  "exports": {
    ".": "./mod.ts",
    "./pcd": "./pcd.ts",
  },
  "tasks": {
    "test": "deno test",
    "check": "deno check mod.ts",
    "lint": "deno lint",
  },
}
```

### Git Subtree Split Commands

```bash
# === INITIAL MIGRATION: Import existing repos into monorepo ===

# Step 1: Import praxrr-db with full history
git clone git@github.com:yandy-r/praxrr-db.git /tmp/praxrr-db-import
cd /tmp/praxrr-db-import
git filter-repo --to-subdirectory-filter packages/praxrr-db

cd /path/to/praxrr
git checkout -b feat/integrate-praxrr-db
git remote add temp-db /tmp/praxrr-db-import
git fetch temp-db
git merge temp-db/main --allow-unrelated-histories \
  -m "feat: integrate praxrr-db repository into monorepo"
git remote remove temp-db

# Step 2: Import praxrr-schema with full history
git clone git@github.com:yandy-r/praxrr-schema.git /tmp/praxrr-schema-import
cd /tmp/praxrr-schema-import
git filter-repo --to-subdirectory-filter packages/praxrr-schema

cd /path/to/praxrr
git remote add temp-schema /tmp/praxrr-schema-import
git fetch temp-schema
git merge temp-schema/main --allow-unrelated-histories \
  -m "feat: integrate praxrr-schema repository into monorepo"
git remote remove temp-schema

# Step 3: Move app code into packages/praxrr
mkdir -p packages/praxrr
git mv src packages/praxrr/src
git mv svelte.config.js packages/praxrr/
git mv vite.config.ts packages/praxrr/
git mv tsconfig.json packages/praxrr/
git mv package.json packages/praxrr/
git mv eslint.config.js packages/praxrr/
git commit -m "refactor: move app code to packages/praxrr"

# === ONGOING: Mirror splits to separate repos ===

# One-time remote setup
git remote add praxrr-db-mirror git@github.com:yandy-r/praxrr-db.git
git remote add praxrr-schema-mirror git@github.com:yandy-r/praxrr-schema.git

# Split and push
git subtree split --prefix=packages/praxrr-db -b split/praxrr-db
git push praxrr-db-mirror split/praxrr-db:main --force

git subtree split --prefix=packages/praxrr-schema -b split/praxrr-schema
git push praxrr-schema-mirror split/praxrr-schema:main --force

# Cleanup
git branch -D split/praxrr-db split/praxrr-schema
```

### GitHub Actions Workflow: Full Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main, v2]
  push:
    branches: [main, v2]

jobs:
  # Detect which packages changed
  changes:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: read
    outputs:
      app: ${{ steps.filter.outputs.app }}
      db: ${{ steps.filter.outputs.db }}
      schema: ${{ steps.filter.outputs.schema }}
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

  # Test changed packages
  test-app:
    needs: changes
    if: ${{ needs.changes.outputs.app == 'true' || needs.changes.outputs.schema == 'true' || needs.changes.outputs.db == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
      - run: deno check
      - run: deno task -f "@yandy-r/praxrr" test

  test-db:
    needs: changes
    if: ${{ needs.changes.outputs.db == 'true' || needs.changes.outputs.schema == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
      - run: deno task -f "@yandy-r/praxrr-db" test

  test-schema:
    needs: changes
    if: ${{ needs.changes.outputs.schema == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
      - run: deno task -f "@yandy-r/praxrr-schema" test

---
# .github/workflows/mirror-subtrees.yml
name: Mirror Subtrees
on:
  push:
    branches: [main, v2]
    paths:
      - 'packages/praxrr-db/**'
      - 'packages/praxrr-schema/**'
  workflow_call:
    secrets:
      MIRROR_PAT:
        required: true

jobs:
  mirror:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - prefix: packages/praxrr-db
            target: yandy-r/praxrr-db
          - prefix: packages/praxrr-schema
            target: yandy-r/praxrr-schema
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Split and push subtree
        run: |
          git subtree split --prefix=${{ matrix.prefix }} -b split-branch
          git remote add mirror https://x-access-token:${{ secrets.MIRROR_PAT }}@github.com/${{ matrix.target }}.git
          git push mirror split-branch:main --force

---
# .github/workflows/release.yml
name: Release Please
on:
  push:
    branches: [main, v2]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

---

## Open Questions

1. **Should `packages/praxrr-api` (the existing JSR-published API types package) be treated as
   a fourth workspace member with its own mirror repo, or folded into one of the other
   packages?** It currently has its own `deno.json` with `name` and `version` and is published
   to JSR.

2. **What is the desired state for the external `praxrr-db` and `praxrr-schema` repos after
   migration?** Options: (a) archive them and point users to the monorepo, (b) keep them as
   active read-only mirrors, (c) keep them active with two-way sync. The research assumes
   option (b).

3. **Should the root `deno.json` retain app-level path aliases (`$lib/`, `$db/`, etc.) or
   should those move entirely into `packages/praxrr/deno.json`?** Moving them to the member
   keeps the root clean but requires SvelteKit/Vite alias config to also move.

4. **Is there a need to support users cloning only `praxrr-db` or `praxrr-schema` for
   standalone use without the monorepo?** If yes, each package must be self-contained with no
   cross-package imports. If no, packages can freely import from siblings.

5. **What version should the monorepo start at for each package?** The manifest file needs
   initial versions. Should `praxrr-db` and `praxrr-schema` retain their current version
   numbers from the standalone repos?

6. **How should the C# parser service (`src/services/parser/`) be handled in the monorepo
   layout?** It currently lives inside `src/` which would move under `packages/praxrr/`. Should
   it become its own workspace member, or stay nested under the app package?

---

## Uncertainties and Gaps

1. **Vite + Deno workspace bare specifier resolution.** While Deno natively resolves workspace
   member imports, Vite's bundler uses its own resolution algorithm. There may be configuration
   needed in `vite.config.ts` to bridge the gap. This needs hands-on testing during migration.
   **Confidence**: Low -- no documented examples of SvelteKit + Deno workspace bare specifiers
   working through Vite bundling.

2. **release-please `simple` type with `deno.json` version updates.** The `extra-files` JSON
   path updater should work for bumping `version` in `deno.json`, but this specific combination
   (Deno workspace + release-please simple + deno.json version) has limited community
   precedent. **Confidence**: Medium -- the mechanism is documented but not widely validated in
   Deno projects.

3. **Subtree split performance at scale.** The current praxrr repo has a modest commit history.
   After merging two additional repo histories, the total commit count will increase. The impact
   on split performance is unknown until tested. **Confidence**: Medium -- unlikely to be a
   problem at current scale, but should be monitored.

4. **Cross-platform Deno compile after restructuring.** The build tasks that compile Deno
   binaries (`deno compile`) reference paths that will change. These need careful updating and
   testing across Linux and Windows targets. **Confidence**: Medium -- mechanical changes, but
   easy to miss edge cases.

---

## Search Queries Executed

1. `Deno 2 workspaces monorepo configuration deno.json 2025 2026`
2. `git subtree split push mirror subdirectory separate repository 2025`
3. `splitsh-lite alternative git subtree split monorepo publish separate repos`
4. `GitHub Actions monorepo detect changed packages selective CI workflow 2025`
5. `GitHub Actions mirror push subdirectory to separate repository workflow subtree split`
6. `git filter-repo move repositories into monorepo preserve history 2025`
7. `release-please monorepo independent versioning 2025`
8. `release-please-config.json monorepo example packages independent versioning configuration`
9. `Deno workspace task orchestration run tasks across packages selective member 2025`
10. `Deno workspace import map path aliases across members bare specifier resolution`
11. `changesets monorepo independent versioning alternative release-please Deno`
12. `semver compatibility gates contract testing monorepo cross-package dependency`
13. `git subtree add existing repository into subdirectory preserve commits in-place migration`
14. `Deno 2 workspace SvelteKit monorepo configuration example`
15. `GitHub Actions subtree split publish mirror workflow example yaml 2024 2025`
16. `Deno workspace limitations caveats known issues task recursive filter 2025`
17. `git subtree split performance large repository incremental caching issues`
18. `Deno publish JSR workspace member version management deno.json`
19. `release-please Deno runtime non-node package release strategy custom release type`
20. `release-please release-type simple custom version file monorepo non-npm`

---

## Sources

### Deno Documentation

- [Workspaces and monorepos](https://docs.deno.com/runtime/fundamentals/workspaces/)
- [deno task CLI reference](https://docs.deno.com/runtime/reference/cli/task/)
- [deno publish CLI reference](https://docs.deno.com/runtime/reference/cli/publish/)
- [Modules and dependencies](https://docs.deno.com/runtime/fundamentals/modules/)
- [deno.json and package.json](https://docs.deno.com/runtime/fundamentals/configuration/)
- [Deno 1.45: Workspace and Monorepo Support](https://deno.com/blog/v1.45)
- [Announcing Deno 2](https://deno.com/blog/v2.0)

### Deno GitHub Issues (Workspace Limitations)

- [#27401: recursive task fuzzy matching](https://github.com/denoland/deno/issues/27401)
- [#27713: --filter requires name property](https://github.com/denoland/deno/issues/27713)
- [#27586: long running tasks in parallel](https://github.com/denoland/deno/issues/27586)
- [#25883: run task of project in workspace](https://github.com/denoland/deno/discussions/25883)
- [#24991: workspace --filter or -r](https://github.com/denoland/deno/issues/24991)

### Git Tools

- [Git Subtree Tutorial (Atlassian)](https://www.atlassian.com/git/tutorials/git-subtree)
- [Git Subtree for Repository Mirroring (ARCsoft, 2025)](https://arcsoft.uvic.ca/log/2025-09-02-git-subtree-for-repo-mirroring/)
- [splitsh-lite](https://github.com/splitsh/lite)
- [git-filter-repo](https://github.com/newren/git-filter-repo)

### GitHub Actions

- [dorny/paths-filter](https://github.com/dorny/paths-filter)
- [nxtlvlsoftware/git-subtree-action](https://github.com/NxtLvLSoftware/git-subtree-action)
- [acrobat/subtree-splitter](https://github.com/acrobat/subtree-splitter)
- [Subtree Split as a Service](https://www.subtreesplit.com/)

### Migration Guides

- [Migrating Git from multirepo to monorepo (Netlify, 2025)](https://developers.netlify.com/guides/migrating-git-from-multirepo-to-monorepo-without-losing-history/)
- [Merging Multiple Repositories into a Monorepo (Medium)](https://medium.com/@andrejkurocenko/merging-multiple-repositories-into-a-monorepo-using-git-subtree-without-losing-history-0c019046498e)
- [Merging multiple repositories into a monorepo (Jamie Tanna)](https://www.jvt.me/posts/2018/06/01/git-subtree-monorepo/)

### Version Management

- [release-please](https://github.com/googleapis/release-please)
- [release-please-action](https://github.com/googleapis/release-please-action)
- [release-please manifest-releaser docs](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [release-please monorepo example](https://github.com/amarjanica/release-please-monorepo-example)
- [Changesets](https://github.com/changesets/changesets)
- [Streamlining Development through Monorepo with Independent Release Cycles (Microsoft ISE)](https://devblogs.microsoft.com/ise/streamlining-development-through-monorepo-with-independent-release-cycles/)
- [Release management strategies in a monorepo (Graphite)](https://www.graphite.com/guides/release-management-strategies-in-a-monorepo)
