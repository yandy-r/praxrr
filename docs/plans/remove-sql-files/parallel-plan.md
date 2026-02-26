# remove-sql-files Implementation Plan

This change removes legacy base-op SQL file ingestion from `packages/praxrr-db/ops/*.sql` and
completes the YAML-first cutover for base data ingestion. The runtime strategy is to collapse
`sql-only`/`hybrid` branches into a single YAML entity import path while preserving schema-layer SQL
loading and `pcd_ops` SQL replay semantics. The plan isolates high-conflict runtime files first,
then parallelizes tooling/export adjustments, and finally deletes SQL artifacts plus outdated docs
once no runtime/script references remain. Success criteria are: no references to migration-mode env
vars, no runtime reads from `packages/praxrr-db/ops/`, and passing PCD checks/tests with schema SQL
still intact.

## Critically Relevant Files and Documentation

- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: dual-path SQL/YAML ingestion logic
  to collapse.
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: migration mode/fallback orchestration
  wrapper.
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`: migration mode config contract and
  env parsing.
- `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`: schema/tweaks layer loading that must
  stay SQL-based.
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: helper function compatibility for
  existing SQL in `pcd_ops`.
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`: canonical YAML entity read path.
- `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`: SQL/hybrid tests to rewrite for
  YAML-only behavior.
- `packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`: fallback tests to
  remove/replace.
- `packages/praxrr-app/src/tests/base/pcdMigrationModeConfig.test.ts`: config-mode tests to
  remove/replace.
- `scripts/compat-check.ts`: compatibility gate currently tied to SQL ops files.
- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`: SQL export generation behavior and repo
  coupling.
- `packages/praxrr-app/src/lib/server/pcd/utils/git.ts`: op number scanning from `ops/*.sql`.
- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: `.sql` filename conventions in repo import
  context.
- `packages/praxrr-db/ops/*.sql`: legacy SQL artifacts targeted for deletion.
- `packages/praxrr-db/README.md`: transitional SQL language to update.
- `docs/plans/remove-sql-files/shared.md`: baseline constraints and target scope.
- `docs/plans/pcd-data-migration/runbook.md`: migration-mode behavior that becomes historical.

## Implementation Plan

### Phase 1: Runtime YAML-Only Cutover

#### Task 1.1: Remove migration-mode configuration contract Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/config/config.ts`
- `packages/praxrr-app/src/tests/base/pcdMigrationModeConfig.test.ts`
- `docs/plans/remove-sql-files/shared.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/utils/config/config.ts`
- `packages/praxrr-app/src/tests/base/pcdMigrationModeConfig.test.ts`

Remove `PCDMigrationIngestionMode`, `pcdMigrationIngestionMode`, and
`pcdMigrationAllowLegacyFallback` from runtime config and env parsing. Replace mode-specific config
assertions with coverage for remaining config behavior in this test file (or remove obsolete cases).
Acceptance criteria: no exported config members or environment parsing paths reference
SQL-only/hybrid mode semantics.

#### Task 1.2: Collapse base import to YAML-only entities Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts`
- `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`
- `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`

Remove SQL directory scanning, SQL metadata parsing helpers, and SQL-vs-YAML suppression logic from
`importBaseOps`. Keep YAML candidate deserialization, stable sequencing behavior required for YAML
entries, and orphan-marking semantics. Rewrite tests to validate YAML-only import behavior, conflict
handling within entity sources, and deterministic ordering without SQL fallback branches.

#### Task 1.3: Simplify manager orchestration to single import path Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- `packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- `packages/praxrr-app/src/tests/pcd/migration/managerHybridFallback.test.ts`

Delete `sql-only`/`hybrid` branch orchestration and `MigrationReaderError` fallback behavior, then
wire manager import flow directly to the YAML-only `importBaseOps` contract. Replace
fallback-specific test coverage with assertions that import failures surface directly and that
successful import still flows into compile/sync orchestration.

#### Task 1.4: Add explicit boundary tests for schema SQL and cache helper retention Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`
- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`

Add concrete assertions that schema/tweaks SQL layer loading remains active and that legacy helper
UDF registration (`qp`, `cf`, `dp`, `mp`, `tag`) is preserved. Acceptance criteria: tests fail if
schema SQL loading is removed or helper registration is dropped while this feature is in scope.

### Phase 2: Tooling and Export Realignment

#### Task 2.1: Remove SQL-vs-YAML parity verifier surfaces Depends on [1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`
- `packages/praxrr-app/src/tests/pcd/migration/parityVerifier.test.ts`
- `scripts/verify-pcd-parity.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/migration/parityVerifier.ts`
- `packages/praxrr-app/src/tests/pcd/migration/parityVerifier.test.ts`
- `scripts/verify-pcd-parity.ts`

Fully remove parity verifier code paths and tests that require SQL-only baseline comparison. Update
script behavior so deprecated parity commands fail fast with explicit migration-complete messaging
or are removed from invocation surfaces. Acceptance criteria: no runtime or script path performs
SQL-vs-YAML parity builds.

#### Task 2.2: Replace SQL-file compatibility checks with YAML-aware validation Depends on [1.2]

**READ THESE BEFORE TASK**

- `scripts/compat-check.ts`
- `.github/workflows/compatibility.yml`
- `packages/praxrr-db/entities/`

**Instructions**

Files to Create

- None.

Files to Modify

- `scripts/compat-check.ts`
- `.github/workflows/compatibility.yml`

Rework compatibility checks so they no longer read `packages/praxrr-db/ops/*.sql`. Validate these
concrete invariants instead: schema ops load successfully, YAML entities deserialize for all
supported types, and resulting operation writes compile without cache errors. Update workflow
command wiring to run only the new YAML-aware check contract.

#### Task 2.3: Lock export/git behavior as export-only SQL history Depends on [1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`
- `packages/praxrr-app/src/lib/server/pcd/utils/git.ts`
- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`
- `packages/praxrr-app/src/lib/server/pcd/utils/git.ts`
- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`

Implement explicit transition contract: exporter `.sql` artifacts are retained for export history
only, not as import sources. Preserve deterministic filename identity for `pcd_ops.filename`, keep
numbering deterministic for repos with existing SQL export history, and add guardrails/comments that
import flow must not depend on `ops/` reads.

### Phase 3: Artifact Deletion and Documentation Alignment

#### Task 3.1: Delete legacy `packages/praxrr-db/ops/*.sql` artifacts Depends on [2.1, 2.2, 2.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-db/ops/`
- `docs/plans/remove-sql-files/shared.md`
- `scripts/compat-check.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- None (delete `packages/praxrr-db/ops/*.sql` files).

Delete the legacy SQL ops files after runtime and compatibility tooling no longer reference them.
Acceptance criteria: repository has no `packages/praxrr-db/ops/*.sql` files and updated checks from
task 2.2 pass without SQL artifacts.

#### Task 3.2: Update package/workflow references after SQL artifact deletion Depends on [3.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-db/README.md`
- `.github/workflows/publish-db.yml`
- `packages/praxrr-db/entities/`

**Instructions**

Files to Create

- None.

Files to Modify

- `packages/praxrr-db/README.md`
- `.github/workflows/publish-db.yml`

Update package documentation/workflow assumptions to reflect entities-only base data and no `ops/`
payload in `praxrr-db`. Ensure publish workflow behavior remains valid after deletions and does not
include stale ops-path checks.

#### Task 3.3: Update runtime and migration documentation for YAML-only ingestion Depends on [1.3, 3.1]

**READ THESE BEFORE TASK**

- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/plans/pcd-data-migration/runbook.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/plans/pcd-data-migration/runbook.md`

Remove references to migration-mode env vars and SQL fallback controls, and document the final
YAML-only ingestion model with explicit schema SQL exception. Mark old runbook sections as
historical and add current operator guidance for post-cutover verification.

#### Task 3.4: Final command surface cleanup for deprecated migration scripts Depends on [2.1, 2.2]

**READ THESE BEFORE TASK**

- `deno.json`
- `scripts/convert-pcd-to-yaml.ts`
- `scripts/verify-pcd-parity.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `deno.json`
- `scripts/convert-pcd-to-yaml.ts`
- `scripts/verify-pcd-parity.ts`

Remove or re-scope task commands and transitional scripts that depended on SQL-only baselines.
Ensure command names, descriptions, and failure messaging align with migration-complete architecture
and do not imply SQL parity fallback paths.

## Advice

- Keep schema SQL (`packages/praxrr-schema/ops/*.sql`) explicitly out of scope for deletion; this
  feature is only about removing data-layer SQL ingestion.
- Treat `importBaseOps.ts` as the highest merge-conflict hotspot and land its contract early to
  unblock downstream tasks.
- Resolve exporter behavior before deleting SQL artifacts; unresolved filename/numbering policy can
  create hidden drift in repo history semantics.
- Preserve cache helper UDF registration until you have explicit migration evidence that no
  historical `pcd_ops` rows depend on them.
- Run verification after each phase instead of only at the end; failures in phase 2 are
  significantly harder to debug once SQL files are deleted.
