# Health Degraded Notifications

Config Health reports are computed by the pure `$shared/health` engine and appended by the
`config-health.snapshot` job. Issue #223 adds a post-insert, no-throw phase that reads the immediate
same-instance persisted predecessor, classifies meaningful regression or recovery, and atomically
claims per-instance notification state before using the existing notification manager. The shared
event catalog remains the only settings surface, so `health.degraded` is explicitly opt-in and no
HTTP/OpenAPI or Svelte route change is needed.

## Relevant Files

- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`: Snapshot owner and final convergence point.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: Snapshot insert/parsing and predecessor lookup.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`: Static migration registration.
- `packages/praxrr-app/src/lib/server/db/migrations/20260714_create_config_health_tables.ts`: Existing health schema conventions.
- `packages/praxrr-app/src/lib/shared/health/types.ts`: Report, band, criterion, engine, and Arr contracts.
- `packages/praxrr-app/src/lib/shared/health/policy.ts`: Existing scoring and band policy.
- `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`: Notification/recovery precedent; not atomic-claim precedent.
- `packages/praxrr-app/src/lib/server/db/queries/driftStatus.ts`: Statement-atomic mutable-state query pattern.
- `packages/praxrr-app/src/lib/server/notifications/builder.ts`: Generic plus Discord event construction.
- `packages/praxrr-app/src/lib/server/notifications/NotificationManager.ts`: Subscription routing, delivery isolation, and history.
- `packages/praxrr-app/src/lib/server/notifications/types.ts`: Server event constants.
- `packages/praxrr-app/src/lib/shared/notifications/types.ts`: Settings-facing event catalog.
- `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`: Job integration and no-throw test harness.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`: Migrated query-test pattern.
- `scripts/test.ts`: Config Health and notification test aliases.
- `ROADMAP.md`: Config Health delivery and follow-up status.

## Relevant Tables

- `config_health_snapshots`: Append-only, per-instance persisted scoring evidence.
- `config_health_settings`: Snapshot cadence, retention, criteria weights, and sweep state.
- `config_health_notification_state`: New one-row-per-instance atomic degraded-state claim.
- `notification_services`: Enabled providers and explicit `enabled_types` subscriptions.
- `notification_history`: Per-service best-effort delivery attempt history.
- `arr_instances`: Parent of snapshot and notification-state instance identity.

## Relevant Patterns

**Persist first, side effect second**: A successful snapshot insert is authoritative; all notification
work runs afterward inside a separate no-throw boundary. See
`packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`.

**Statement-atomic SQLite operations**: Concurrent `processBatches` work must not open nested
transactions. Use single insert, clear, and conditional upsert statements. See
`packages/praxrr-app/src/lib/server/db/queries/driftStatus.ts`.

**Atomic claim before dispatch**: Claim a changed current-state signature with one conditional upsert;
only the affected-row winner dispatches. Delivery failure is intentionally not retried.

**Strict persisted comparability**: Compare adjacent append-order snapshots only when instance,
engine, known bands, score ranges, scored criterion IDs, and weights match. Unknown or ambiguous data
does not alert or re-arm.

**Catalog-driven opt-in**: Register one shared event ID; existing create/edit forms initialize absent
IDs false and persist only checked IDs. See `packages/praxrr-app/src/lib/shared/notifications/types.ts`.

**Manager-owned provider behavior**: Always use `NotificationManager` for exact subscription filtering,
parallel sends, error containment, and history; never call Discord directly.

## Relevant Docs

**`docs/plans/health-degraded-notifications/feature-spec.md`**: You _must_ read this for the approved trigger, recovery, state, payload, and scope contract.

**`docs/plans/health-degraded-notifications/parallel-plan.md`**: You _must_ read this for file ownership, dependency batches, and exact validation commands.

**`CLAUDE.md`**: You _must_ read this for repository formatting, migrations, cross-Arr fidelity, and ROADMAP/PR conventions.

**`docs/site/src/content/docs/app/notifications.md`**: You _must_ read this when changing event routing or user-facing notification behavior.

**`docs/site/src/content/docs/app/jobs.md`**: You _must_ read this when changing handler failure or rescheduling behavior.

**`docs/site/src/content/docs/app/testing.md`**: Reference when adding supported test aliases and validation evidence.
