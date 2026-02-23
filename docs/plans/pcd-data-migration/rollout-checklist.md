# PCD Data Migration Rollout Checklist (Task 3.4)

## Scope and objective

This checklist is the final go/no-go gate for enabling hybrid JSON/YAML
migration inputs in PCD flows. Rollout is limited to the migration features
delivered by tasks `2.1`, `2.2`, `2.3`, and `2.4` plus validation tasks `3.1`,
`3.2`, and `3.3`.

## Deterministic go/no-go rules

### Hard no-go (any one blocks rollout)

- Schema/API/runtime contract mismatch between:
  - `docs/api/v1/schemas/pcd.yaml`
  - `docs/api/v1/paths/pcd.yaml`
  - `packages/praxrr-app/src/lib/shared/pcd/portable.ts`
- Missing or invalid migration metadata contract:
  - `PortableMigrationMetadata` not present with required
    `format/version/source`
  - `import`/`export` request/response schemas missing `migration` field
    compatibility
- `pcd_op_history` contains `error` rows caused by the migration window, or
  `conflicted`/`conflicted_pending` above allowed thresholds (see Rollout
  gates).
- New migration metadata or hybrid imports fail to route through existing
  writer/cache/sync flow and bypass guard history (`pcd_op_history` has no rows
  for migration-triggered ops after a successful import attempt).
- Any sustained `pcd.sync` or `arr.sync` failures not attributable to upstream
  Arr/API issues during the validation window.
- Required sign-off artifacts are missing.

### Proceed conditions (all must be true)

- Import and export schemas are semantically aligned and strict for migration
  metadata.
- Cache parity and value-guard regression tests pass for equivalent SQL and
  hybrid imports.
- Sync trigger regressions validate one-time enqueue behavior and bounded queue
  growth.
- Runbook preflight and checkpoint monitoring are in place and verified.

## Sign-off criteria

- **Platform owner sign-off:** code-path change evidence (Task 2.x) reviewed.
- **Runtime owner sign-off:** guard parity and sync regression evidence
  collected.
- **Release owner sign-off:** migration checklist and rollback artifacts
  published in ticket/issue.
- **Consumer-facing sign-off:** API contract references verified (schemas +
  routes) and backward-compatible behavior confirmed.

## Validation gates

### Gate 1 — Schema and contract lockstep

- Execute contract diff checks and capture output:
  - `rg -n "PortableMigrationMetadata|migration" docs/api/v1/schemas/pcd.yaml docs/api/v1/paths/pcd.yaml`
  - Confirm `ImportRequest`/`ExportResponse` and portable schema references
    include migration metadata as intended.
- Confirm runtime contract parity:
  - `rg -n "PortableMigrationMetadata|migration" packages/praxrr-app/src/lib/shared/pcd/portable.ts`
- Confirm generated portable type outputs remain in sync:
  - `deno task generate:pcd-types`
  - Capture regenerated file diff (expected no unintended contract drift).
- Gate outcome:
  - `PASS` if all three sources contain equivalent migration fields and no
    extra/unknown-metadata keys are accepted.

### Gate 2 — Guard/parity correctness

- Run cache parity regression test for legacy SQL vs hybrid migration inputs:
  - `deno task test packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts`
- Run conflict negative-path and history expectations:
  - `deno task test packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts --filter guard`
- Run sync-trigger coverage:
  - `deno task test packages/praxrr-app/src/tests/jobs/hybridSyncTrigger.test.ts`
- Validate gate evidence in database after staged import:
  - `SELECT h.batch_id, h.status, COUNT(*) FROM pcd_op_history h WHERE h.applied_at >= datetime('now', '-30 minutes') GROUP BY h.batch_id, h.status;`
  - expect dominant `applied`/`skipped` and no unexpected `error` rows.
- Gate outcome:
  - `PASS` only if parity and negative-path assertions are green and history
    states match expected statuses.

### Gate 3 — Sync/queue behavior

- Validate queue/job health for the rollout window:
  - `SELECT job_type, status, COUNT(*) FROM job_queue WHERE created_at >= datetime('now', '-30 minutes') AND job_type IN ('pcd.sync', 'arr.sync', 'arr.sync.qualityProfiles', 'arr.sync.delayProfiles', 'arr.sync.mediaManagement', 'arr.sync.metadataProfiles') GROUP BY job_type, status;`
  - `SELECT job_type, status, COUNT(*) FROM job_run_history WHERE started_at >= datetime('now', '-30 minutes') AND job_type IN ('pcd.sync', 'arr.sync', 'arr.sync.qualityProfiles', 'arr.sync.delayProfiles', 'arr.sync.mediaManagement', 'arr.sync.metadataProfiles') GROUP BY job_type, status;`
- Confirm no duplicate enqueue for single writes and that sync-pending
  transitions occur after hybrid writes.
- Gate outcome:
  - `PASS` when sync trigger counts are bounded and match legacy import
    behavior.

### Gate 4 — Operator rollback readiness

- Confirm runbook checks are available and executable from
  `docs/plans/pcd-data-migration/runbook.md`:
  - preflight backup/restore commands
  - checkpoints A/B/C SQL snippets
  - rollback command artifacts.
- Confirm evidence bundle includes:
  - backup artifact path/timestamp
  - migration batch IDs used during validation
  - `pcd_op_history` sample rows for migration batch
  - sync queue/job histograms at the same timestamps
  - sign-off record for each required approver

## Explicit rollout blockers

- Any of the following in the pilot/staging window: `error` in `pcd_op_history`,
  unexpected `conflicted_pending` count, repeated startup disable events, or
  recurring Arr sync failures.
- Contract drift across OpenAPI/schema/runtime.
- Failed deterministic rollback drill or absent backup/recovery evidence.

## Ready for production if all gates are `PASS`

Rollout decision is `GO` only when all gates pass and all sign-offs are
captured. Any single `FAIL` in gates or blockers is `NO-GO`.
