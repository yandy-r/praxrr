# monorepo-strategy Implementation Plan

Monorepo strategy should extend the current root-based Praxrr app with two new workspace members (`packages/praxrr-db`, `packages/praxrr-schema`) while preserving current runtime and API contracts. The implementation must decouple hardcoded default DB and schema assumptions through env/config updates, then enforce contract safety with compatibility CI gates before mirror publishing is enabled. The safest architecture keeps the main app at repo root (per feature-spec decisions) and treats db/schema mirrors as downstream artifacts published via subtree workflows. Execution is organized to keep high-parallel scaffolding and runtime tasks wide, then converge through compatibility and release-gating tasks.

## Critically Relevant Files and Documentation

- `docs/plans/monorepo-strategy/feature-spec.md`: source of business rules, acceptance criteria, and phase guidance.
- `docs/plans/monorepo-strategy/shared.md`: validated architecture context, integration seams, and core file map.
- `docs/plans/monorepo-strategy/analysis-context.md`: synthesized architecture constraints and parallelization hotspots.
- `docs/plans/monorepo-strategy/analysis-code.md`: concrete code patterns and file-level integration points.
- `docs/plans/monorepo-strategy/analysis-tasks.md`: dependency-shape recommendations for plan execution.
- `deno.json`: root workspace membership and cross-package task entry points.
- `packages/praxrr-app/src/hooks.server.ts`: auto-link defaults for initial DB wiring.
- `scripts/generate-pcd-types.ts`: schema source selection and type-generation behavior.
- `packages/praxrr-app/src/routes/databases/[id]/config/+page.svelte`: locked schema dependency configuration surface.
- `.github/workflows/release.yml`: app release pathing and gating behavior.
- `.github/workflows/docker.yml`: container build path assumptions for monorepo layout.
- `README.md`: contributor-facing monorepo and configuration contract.

## Implementation Plan

### Phase 1: Workspace Scaffolding

#### Task 1.1: Create schema package baseline Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/monorepo-strategy/feature-spec.md`
- `docs/plans/monorepo-strategy/research-technical.md`
- `packages/praxrr-api/deno.json`

**Instructions**

Files to Create

- `packages/praxrr-schema/deno.json`
- `packages/praxrr-schema/pcd.json`
- `packages/praxrr-schema/ops/0.schema.sql`

Files to Modify

- none

Create the schema workspace member with minimal Deno package metadata and canonical schema source copied from `yandy-r/praxrr-schema` at a pinned commit resolved at task start (`SCHEMA_IMPORT_REF=$(git ls-remote https://github.com/yandy-r/praxrr-schema.git refs/heads/main | cut -f1)`). Use a reproducible import sequence: `git init /tmp/praxrr-schema-src && git -C /tmp/praxrr-schema-src remote add origin https://github.com/yandy-r/praxrr-schema.git && git -C /tmp/praxrr-schema-src fetch --depth=1 origin $SCHEMA_IMPORT_REF && git -C /tmp/praxrr-schema-src show FETCH_HEAD:ops/0.schema.sql > packages/praxrr-schema/ops/0.schema.sql`; verify integrity with `git -C /tmp/praxrr-schema-src show FETCH_HEAD:ops/0.schema.sql | sha256sum` compared to `sha256sum packages/praxrr-schema/ops/0.schema.sql`. Keep SQL byte-for-byte equivalent (no reformatting or statement reordering) and preserve existing schema object names.

#### Task 1.2: Create db package baseline Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/monorepo-strategy/feature-spec.md`
- `docs/plans/monorepo-strategy/research-business.md`
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`

**Instructions**

Files to Create

- `packages/praxrr-db/deno.json`
- `packages/praxrr-db/pcd.json`
- `packages/praxrr-db/ops/001.base.sql`

Files to Modify

- none

Create the db workspace member with manifest, package metadata, and a deterministic base-op seed (`ops/001.base.sql`) so compatibility checks always have at least one ordered SQL op to apply. In `packages/praxrr-db/pcd.json`, require an explicit schema dependency entry keyed by `https://github.com/yandy-r/praxrr-schema` with initial required value `1.0.0`; future changes to this value must follow the release manifest/tag policy from Task `4.3`. Validate manifest compatibility by running `deno task check` after workspace wiring in Task `1.3`.

#### Task 1.3: Extend root workspace membership Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `deno.json`
- `docs/plans/monorepo-strategy/feature-spec.md`
- `docs/plans/monorepo-strategy/analysis-code.md`

**Instructions**

Files to Create

- none

Files to Modify

- `deno.json`

Expand the workspace array to include `packages/praxrr-db` and `packages/praxrr-schema`, keeping root lockfile behavior intact. In this task, only update workspace membership and any strictly required root task key normalization already present in `deno.json`; do not introduce placeholder publish aliases. Verify `deno task check` still resolves from repo root after workspace expansion.

### Phase 2: Runtime and Tooling Decoupling

#### Task 2.1: Parameterize default DB auto-link settings Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/hooks.server.ts`
- `docs/plans/monorepo-strategy/feature-spec.md`
- `docs/plans/monorepo-strategy/research-business.md`

**Instructions**

Files to Create

- none

Files to Modify

- `packages/praxrr-app/src/hooks.server.ts`

Replace hardcoded default DB URL/branch/name with `PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`, and `PRAXRR_DEFAULT_DB_NAME` reads, using exact defaults `https://github.com/yandy-r/praxrr-db`, `v2`, and `Praxrr-DB` when vars are unset. Implement explicit empty-URL handling that disables auto-link to satisfy business rules. Validate behavior for `unset`, `empty`, and `non-empty` env var states while keeping existing token/git identity env behavior untouched.

#### Task 2.2: Make PCD type generation local-first Depends on [1.1]

**READ THESE BEFORE TASK**

- `scripts/generate-pcd-types.ts`
- `docs/plans/monorepo-strategy/feature-spec.md`
- `docs/plans/monorepo-strategy/research-technical.md`

**Instructions**

Files to Create

- none

Files to Modify

- `scripts/generate-pcd-types.ts`

Implement deterministic source precedence for type generation: `--local=<path>` (highest), default local path `packages/praxrr-schema/ops/0.schema.sql`, then `--remote` fetch mode only when explicitly requested. If the resolved local schema file is missing, fail with a non-zero exit and actionable error instead of silent fallback. Keep generated output path and formatting stable so downstream imports remain unchanged.

#### Task 2.3: Remove hardcoded schema-lock UI references Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/databases/[id]/config/+page.svelte`
- `docs/plans/monorepo-strategy/feature-spec.md`
- `docs/plans/monorepo-strategy/analysis-code.md`

**Instructions**

Files to Create

- none

Files to Modify

- `packages/praxrr-app/src/routes/databases/[id]/config/+page.svelte`
- `packages/praxrr-app/src/lib/server/pcd/git/dependencies.ts`
- `packages/praxrr-app/src/lib/server/pcd/manifest/manifest.ts`

Replace hardcoded schema lock identity with deterministic resolution from dependency metadata using this order: exact match `https://github.com/yandy-r/praxrr-schema`, then normalized match `https://github.com/*/praxrr-schema` (normalize by lowercasing host/path and trimming trailing `/` or `.git`), then fallback `https://github.com/yandy-r/praxrr-schema` only when dependencies are absent. Apply the same resolution rule in backend dependency handling (`dependencies.ts` and manifest validation) so UI/runtime decisions stay consistent. If multiple schema-like dependencies remain after normalization, enforce a single contract: backend hard-fails with explicit error code/message and UI renders a blocking error state.

#### Task 2.4: Document env and workflow contract updates Depends on [2.1, 2.2, 2.3]

**READ THESE BEFORE TASK**

- `README.md`
- `CLAUDE.md`
- `docs/plans/monorepo-strategy/feature-spec.md`

**Instructions**

Files to Create

- none

Files to Modify

- `README.md`
- `CLAUDE.md`

Document monorepo workspace layout, new default DB env vars, and local-first schema type-generation behavior. Explicitly describe empty `PRAXRR_DEFAULT_DB_URL` semantics, mirror publish model, and contributor expectations for cross-package changes. Include a required checklist with headings `Environment Variables`, `Empty URL Behavior`, `Schema Source Precedence`, and `Mirror Governance`. Keep terminology consistent with Arr/PCD domain language used in runtime code.

### Phase 3: Compatibility Gates

#### Task 3.1: Add compatibility smoke script Depends on [1.1, 1.2, 2.2]

**READ THESE BEFORE TASK**

- `scripts/`
- `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`
- `docs/plans/monorepo-strategy/feature-spec.md`

**Instructions**

Files to Create

- `scripts/compat-check.ts`

Files to Modify

- none

Create `scripts/compat-check.ts` as a single-entry contract command (`deno run -A scripts/compat-check.ts`) with explicit checks: apply `packages/praxrr-schema/ops/0.schema.sql`, layer `packages/praxrr-db/ops/*` in lexicographic filename order, and compare regenerated `packages/praxrr-app/src/lib/shared/pcd/types.ts` for drift using `git diff --exit-code packages/praxrr-app/src/lib/shared/pcd/types.ts`. Define edge-case behavior: if `packages/praxrr-db/ops/` is missing or has zero `*.sql` files, fail with `ops_missing`; always run checks against a temporary SQLite database and remove temp artifacts on success/failure. Exit `0` only when all checks pass; otherwise exit non-zero with named failure stage (`schema_apply`, `ops_layering`, `types_drift`, `ops_missing`).

#### Task 3.2: Add compatibility CI workflow Depends on [3.1, 2.1]

**READ THESE BEFORE TASK**

- `.github/workflows/`
- `scripts/compat-check.ts`
- `docs/plans/monorepo-strategy/research-technical.md`

**Instructions**

Files to Create

- `.github/workflows/compatibility.yml`

Files to Modify

- none

Add `.github/workflows/compatibility.yml` with pull request triggers covering `packages/praxrr-schema/**`, `packages/praxrr-db/**`, `scripts/compat-check.ts`, `deno.json`, `.github/workflows/release.yml`, `.github/workflows/docker.yml`, `release-please-config.json`, and `.release-please-manifest.json`. Implement conditional execution with `dorny/paths-filter` using explicit groups: `contracts_paths` (schema/db/compat files) and `app_paths` (`src/**`, `scripts/generate-pcd-types.ts`, `deno.json`). Run matrix: if `contracts_paths=true`, run `contracts`; if `app_paths=true`, run `app-check`; if both true, run both jobs. Keep this task code-only; operational branch-protection enforcement is tracked in Task `5.1`.

#### Task 3.3: Expose compatibility task at workspace root Depends on [1.3, 3.1]

**READ THESE BEFORE TASK**

- `deno.json`
- `scripts/compat-check.ts`
- `docs/plans/monorepo-strategy/analysis-tasks.md`

**Instructions**

Files to Create

- none

Files to Modify

- `deno.json`

Add an explicit root task alias `compat:check` with command `deno run -A scripts/compat-check.ts` so local and CI invocation paths stay uniform. Keep alias names non-conflicting with existing test/check tasks and validate execution from repo root plus CI shell context.

### Phase 4: Publish and Release Automation

#### Task 4.1: Add DB mirror publish workflow Depends on [1.2]

**READ THESE BEFORE TASK**

- `.github/workflows/publish-api.yml`
- `docs/plans/monorepo-strategy/feature-spec.md`
- `docs/plans/monorepo-strategy/research-technical.md`

**Instructions**

Files to Create

- `.github/workflows/publish-db.yml`

Files to Modify

- none

Create a tag/dispatch-driven workflow targeting `yandy-r/praxrr-db`, with triggers on `db/v*` and `workflow_dispatch`. Use subtree-based publish (`git subtree split --prefix=packages/praxrr-db`) and push to mirror branch `main` using `MIRROR_PAT`; enforce `permissions: contents: write`, `concurrency: publish-db-${{ github.ref }}`, a fixed retry policy (3 attempts with exponential backoff), and clear failure logs. Include `workflow_dispatch` input `dry_run` (default `true`) that pushes to `dry-run/db/${{ github.run_id }}` when enabled. Add cleanup in the same workflow via GitHub API with strict guards: only branches matching prefix `dry-run/db/`, repo-scoped to target mirror, exclude current run branch, and delete only when branch age > 7 days; cleanup failures must warn but not fail publish.

#### Task 4.2: Add schema mirror publish workflow Depends on [1.1]

**READ THESE BEFORE TASK**

- `.github/workflows/publish-api.yml`
- `docs/plans/monorepo-strategy/feature-spec.md`
- `docs/plans/monorepo-strategy/research-technical.md`

**Instructions**

Files to Create

- `.github/workflows/publish-schema.yml`

Files to Modify

- none

Create a mirror workflow targeting `yandy-r/praxrr-schema`, with triggers on `schema/v*` and `workflow_dispatch`. Use `git subtree split --prefix=packages/praxrr-schema` and push with `MIRROR_PAT` to mirror branch `main`, enforcing `permissions: contents: write`, `concurrency: publish-schema-${{ github.ref }}`, a fixed retry policy (3 attempts with exponential backoff), and clear failure logs. Include `workflow_dispatch` input `dry_run` (default `true`) that pushes to `dry-run/schema/${{ github.run_id }}` when enabled. Add cleanup in the same workflow via GitHub API with strict guards: only branches matching prefix `dry-run/schema/`, repo-scoped to target mirror, exclude current run branch, and delete only when branch age > 7 days; cleanup failures must warn but not fail publish. Keep schema publish independent from app release flow by isolating job triggers and branch targets.

#### Task 4.3: Configure independent release manifests Depends on [4.1, 4.2]

**READ THESE BEFORE TASK**

- `docs/plans/monorepo-strategy/feature-spec.md`
- `.github/workflows/release.yml`
- `docs/plans/monorepo-strategy/analysis-context.md`

**Instructions**

Files to Create

- `release-please-config.json`
- `.release-please-manifest.json`

Files to Modify

- none

Define release-please manifests with required top-level keys: `release-type`, `separate-pull-requests`, and `packages` in `release-please-config.json`; explicit version entries for `.`, `packages/praxrr-db`, and `packages/praxrr-schema` in `.release-please-manifest.json`. For each package entry require `component`, `release-type: simple`, and `include-component-in-tag: true`, so tags map to `app/v*`, `db/v*`, and `schema/v*`. Validate with `release-please manifest-pr --dry-run --config-file release-please-config.json --manifest-file .release-please-manifest.json` plus `deno task check` before opening implementation PRs.

#### Task 4.4: Update app release workflow for monorepo gating Depends on [3.2, 3.3, 4.3]

**READ THESE BEFORE TASK**

- `.github/workflows/release.yml`
- `.github/workflows/docker.yml`
- `docs/plans/monorepo-strategy/feature-spec.md`

**Instructions**

Files to Create

- none

Files to Modify

- `.github/workflows/release.yml`

Adjust release workflow path assumptions and add an explicit `compatibility-gate` job in `release.yml` that runs `deno task compat:check`; make release jobs `needs: compatibility-gate` so releases cannot bypass contract checks. Define concrete release trigger rules: `app/v*` tags execute app release jobs, while `db/v*` and `schema/v*` must not execute app release jobs. Pass criteria: app release runs only when `compatibility-gate` succeeds and tag matches `app/v*`. Keep branch-protection documentation as a separate deliverable in Task `5.1` (not in this file task).

### Phase 5: Cutover and Operational Guardrails

#### Task 5.1: Publish cutover checklist for maintainers Depends on [2.4, 4.4]

**READ THESE BEFORE TASK**

- `docs/plans/monorepo-strategy/feature-spec.md`
- `README.md`
- `CLAUDE.md`

**Instructions**

Files to Create

- `docs/plans/monorepo-strategy/cutover-checklist.md`

Files to Modify

- none

Create a maintainer-facing cutover checklist with fixed sections `Preflight`, `Mirror Freeze`, `Secrets`, `Rollout`, `Rollback`, and `Ownership`. Cover mirror freeze, branch protection, secret prerequisites, rollout validation commands, and rollback triggers, with at least one executable verification command per section. Include explicit preflight and post-cutover verifications tied to compatibility and release workflows.

#### Task 5.2: Add final verification matrix to feature spec Depends on [3.2, 4.4, 5.1]

**READ THESE BEFORE TASK**

- `docs/plans/monorepo-strategy/feature-spec.md`
- `docs/plans/monorepo-strategy/cutover-checklist.md`
- `docs/plans/monorepo-strategy/analysis-tasks.md`

**Instructions**

Files to Create

- none

Files to Modify

- `docs/plans/monorepo-strategy/feature-spec.md`

Add a concise verification matrix mapping each success criterion to an executable check (local command or workflow outcome) and ownership. Use fixed columns: `criterion`, `check command/workflow`, `owner`, `pass signal`, and `evidence link`. This closes the plan with objective completion signals for implementation and review, aligned with the dependency graph in this plan.

## Advice

- Keep the app at repo root during this initiative; moving it to `packages/praxrr` introduces broad alias, Docker, and CI churn that is explicitly flagged as high risk in current research.
- Treat `deno.json` as a coordination hotspot; schedule dedicated merge windows for tasks `1.3` and `3.3` to avoid repetitive conflicts.
- Make compatibility checks authoritative before enabling mirror publish workflows; otherwise, broken schema/db contracts can be mirrored and become expensive to unwind.
- Do not normalize persisted repository identifiers during runtime decoupling; preserve exact values used by existing PCD/sync lookups.
- Prefer one-way mirror governance from monorepo to split repos with protected branches and token-scoped publish automation.
