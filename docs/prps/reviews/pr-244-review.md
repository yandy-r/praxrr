# PR Review #244 — feat(health): emit degraded notifications

**Reviewed**: 2026-07-10T01:53:09Z
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/223-health-degraded-notifications → main
**Decision**: REQUEST CHANGES

## Summary

The persisted-evidence policy, opt-in routing, rendering bounds, and failure containment are well
covered, but same-instance overlap can apply state transitions out of snapshot order. The review
also found a missing predecessor index and several schema/job/history coverage and documentation
gaps that should be closed before merge.

## Findings

### CRITICAL

None.

### HIGH

- **[F001]** `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts:101` — Overlapping work for the same instance can apply notification state out of persisted snapshot order. A degradation yields during SHA-256 assessment while a later recovery can clear first; the older degradation can then claim and send stale state after recovery. Distinct degraded states can likewise finish in reverse order. [correctness, security]
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Persist a per-instance high-water snapshot ID and make degradation claims and recovery re-arming statement-atomic monotonic transitions that reject older snapshot IDs. Add deterministic recovery/degradation and distinct-degradation overlap tests.

### MEDIUM

- **[F002]** `docs/plans/health-degraded-notifications/analysis-integration.md:48` — Several durable plan artifacts still describe the new `20260719` file as migration version `20260718` registered directly after `20260717`, and the PR body also names the superseded number. [correctness]
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Update every health-degraded plan reference and the PR body to describe migration `20260719` after main's `20260718` migration.

- **[F003]** `packages/praxrr-app/src/tests/db/configHealthNotificationState.test.ts:46` — Migration coverage verifies `NOT NULL` but not the database-level non-empty signature `CHECK`; query validation masks a missing schema constraint. [quality]
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Add a raw SQL insertion test proving SQLite rejects an empty `notified_signature` independently of the TypeScript query guard.

- **[F004]** `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts:112` — The predecessor query lacks an index matching `(arr_instance_id, id DESC)`, so SQLite uses a temporary B-tree for ordering retained history. It also parses unused `profile_scores` JSON via the broad detail mapper. [security]
  - **Status**: Fixed
  - **Category**: Performance
  - **Suggested fix**: Add the matching composite index in migration `20260719`, select only fields used by degradation assessment, and add a query-plan regression test.

- **[F005]** `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts:454` — The integration suite replaces `notificationManager.notify`, bypassing the real notification-history failure path even though history failure isolation is part of the documented contract. [correctness]
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Exercise the real manager with a mocked notifier and a throwing `notificationHistoryQueries.create`, then assert snapshot persistence, durable claim state, and non-throwing completion.

- **[F006]** `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts:410` — Post-insert failures are tested only through `snapshotInstance`; no registered-handler case verifies that sweep status, cursor/rescheduling, and backoff remain normal. [quality]
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Add a registered-handler integration case that forces a post-insert notification failure and asserts success, expected cursor/reschedule behavior, unchanged backoff state, and persisted snapshots.

### LOW

- **[F007]** `ROADMAP.md:3` — The document-level reviewed date and summary predate the #223/#244 status now recorded in the roadmap body. [quality]
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Advance the roadmap review metadata to include the #223/#244 pending-merge update without claiming the feature is shipped.

## Validation Results

| Check      | Result                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| Type check | Pass — server check and Svelte check report zero errors/warnings                        |
| Lint       | Pass — changed files pass Prettier, ESLint, and scoped whitespace checks                |
| Tests      | Pass — 1,875 unit tests pass; focused config-health and notifications aliases also pass |
| Build      | Pass — application production build and documentation build complete                    |

## Files Reviewed

- `ROADMAP.md` (Modified)
- `docs/plans/health-degraded-notifications/analysis-architecture.md` (Added)
- `docs/plans/health-degraded-notifications/analysis-docs.md` (Added)
- `docs/plans/health-degraded-notifications/analysis-integration.md` (Added)
- `docs/plans/health-degraded-notifications/analysis-patterns.md` (Added)
- `docs/plans/health-degraded-notifications/analysis-tasks.md` (Added)
- `docs/plans/health-degraded-notifications/feature-spec.md` (Added)
- `docs/plans/health-degraded-notifications/parallel-plan.md` (Added)
- `docs/plans/health-degraded-notifications/research-business.md` (Added)
- `docs/plans/health-degraded-notifications/research-external.md` (Added)
- `docs/plans/health-degraded-notifications/research-practices.md` (Added)
- `docs/plans/health-degraded-notifications/research-recommendations.md` (Added)
- `docs/plans/health-degraded-notifications/research-security.md` (Added)
- `docs/plans/health-degraded-notifications/research-technical.md` (Added)
- `docs/plans/health-degraded-notifications/research-ux.md` (Added)
- `docs/plans/health-degraded-notifications/shared.md` (Added)
- `docs/site/src/content/docs/app/jobs.md` (Modified)
- `docs/site/src/content/docs/app/notifications.md` (Modified)
- `docs/site/src/content/docs/app/testing.md` (Modified)
- `packages/praxrr-app/src/lib/server/db/migrations.ts` (Modified)
- `packages/praxrr-app/src/lib/server/db/migrations/20260719_create_config_health_notification_state.ts` (Added)
- `packages/praxrr-app/src/lib/server/db/queries/configHealthNotificationState.ts` (Added)
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` (Modified)
- `packages/praxrr-app/src/lib/server/health/degradation.ts` (Added)
- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts` (Modified)
- `packages/praxrr-app/src/lib/server/notifications/types.ts` (Modified)
- `packages/praxrr-app/src/lib/shared/notifications/types.ts` (Modified)
- `packages/praxrr-app/src/tests/db/configHealthNotificationState.test.ts` (Added)
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` (Modified)
- `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts` (Modified)
- `packages/praxrr-app/src/tests/notifications/manager.test.ts` (Added)
- `packages/praxrr-app/src/tests/shared/health/degradation.test.ts` (Added)
- `scripts/test.ts` (Modified)
