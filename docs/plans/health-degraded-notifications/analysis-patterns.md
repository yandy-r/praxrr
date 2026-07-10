# Pattern & Code Analysis: Health Degraded Notifications

## Executive Summary

Issue #223 fits the existing Config Health snapshot owner and notification infrastructure without a new
route, provider, or settings model. Implement the regression rules as a pure health-domain module, store
dedup state in a dedicated one-row-per-instance table, and add a guarded post-insert phase to the current
snapshot handler. Reuse drift's compact embed and recovery concepts, but do **not** copy its post-send
`markNotified` race: this feature requires a statement-atomic claim before dispatch. Adding one catalog row
automatically exposes an opt-in checkbox; both create and edit already default a newly introduced event to
false, so the Svelte form and server action helpers need no rewrite.

## Implementation Patterns

- **Pure decision core**: Follow the deterministic, I/O-free contracts under
  `packages/praxrr-app/src/lib/shared/health/`. Put validation, comparability, band ordering, five-point
  trigger/recovery policy, signature input, contributor ranking, and bounded DTO construction in
  `packages/praxrr-app/src/lib/server/health/degradation.ts`. Accept parsed snapshot details and return a
  discriminated result such as incomparable, quiet, recovery, or degradation.

- **Persist first, side effect second**: `configHealthSnapshot.ts` currently scores and inserts inside a
  per-instance no-throw shell. Read the previous row before scoring, insert the current report, then run a
  separately guarded assessment/claim/dispatch phase. Snapshot insertion remains the primary success
  boundary; every later error is logged and swallowed.

- **Deterministic adjacent lookup**: Add `getLatest(instanceId)` to
  `db/queries/configHealthSnapshots.ts`, mapping through the existing `rowToDetail` and ordering by
  `datetime(generated_at) DESC, id DESC`. The ID tie-break is required because equal generation timestamps
  are valid. Do not load `getTrend()` and select in memory.

- **Strict basis parity**: Comparable snapshots must have the same non-empty engine version, non-null same
  instance, valid Arr type, known band, finite integer score in `[0,100]`, and the same scored criterion IDs
  with the same weights. Treat malformed JSON (currently parsed as `[]`), duplicate IDs, null scores,
  changed weights, and changed criterion sets as incomparable, not healthy or recovered.

- **Canonical health signature**: Build `health-degraded:v1` from instance ID, engine version, current band
  and score, plus every current criterion ID/score in `CRITERION_IDS` order while preserving `null`. Exclude
  timestamps, row IDs, names, labels, previous evidence, and display text. Use SHA-256 through Web Crypto;
  `pcd/snapshots/fingerprint.ts` demonstrates hex encoding. Do not reuse drift's eight-character FNV hash.

- **Statement-atomic claim**: Model the query module after raw-SQL modules such as `driftStatus.ts`:
  `INSERT ... ON CONFLICT(arr_instance_id) DO UPDATE ... WHERE notified_signature <>
excluded.notified_signature`, and return `db.execute(...) > 0`. `DatabaseManager.execute()` returns
  affected rows, so one statement both arbitrates overlaps and reports the winner. `clear()` is one DELETE;
  `get()` is diagnostics/test support only.

- **No nested transaction**: The snapshot sweep uses `processBatches(..., CONCURRENCY=3)` on one SQLite
  connection. Existing snapshot/drift queries deliberately use bare statement-atomic `db.execute` because
  nested `BEGIN` calls are not re-entrancy-safe. Claim, clear, insert, and lookup must not wrap themselves in
  `db.transaction()`.

- **Recovery re-arm**: Clear state only for a comparable better band or same-band gain of at least five.
  Preserve state across unknown, malformed, changed-basis, cross-engine, unchanged, and small-gain samples.
  Recovery is synchronous database state maintenance and emits no event.

- **Compact existing notification builder**: Follow `sync/drift/persist.ts` and
  `sync/canary/notify.ts`: `notify(NotificationTypes.HEALTH_DEGRADED).generic(...).discord(...)`, one warning
  embed, explicit App/Previous/Current/Change/Details fields, snapshot generation time, and at most three
  bounded contributor lines. Preserve the explicit `radarr|sonarr|lidarr` value and use
  `getInstanceIcon`; never infer a sibling Arr type.

- **Manager-owned subscriptions/history**: `NotificationManager.notify()` already selects enabled services,
  parses each `enabled_types`, requires an exact event ID, sends with `Promise.allSettled`, and records
  per-service success/failure history. Keep it unchanged; claim occurs even when zero services subscribe,
  matching at-most-once attempt semantics and preventing later opt-in from replaying history.

- **Catalog-driven opt-in**: Add the constant in `server/notifications/types.ts` and one row in
  `shared/notifications/types.ts`. `NotificationServiceForm.svelte` initializes every absent ID with
  `initialData.enabledTypes?.includes(type.id) || false`; this is false for new services and for existing
  rows that predate the event. The create/edit actions dynamically read catalog IDs but persist only hidden
  inputs equal to `on`. Therefore no form, action, grouping-helper, backfill, or migration change is needed
  for checkbox behavior.

- **Layered tests**: Pure table-driven tests cover all comparison boundaries, basis validation, stable
  signatures, contributor ordering, and payload caps. Migrated scratch-DB tests cover migration FK cascade,
  atomic claim winner/change/no-op/clear, and latest-row tie-breaking. Handler tests cover baseline,
  persisted-before-dispatch, recovery, duplicate claim, delivery failure isolation, sibling isolation, and
  unchanged sweep/backoff behavior.

## Existing Code Structure

- `lib/shared/health/types.ts` owns `HealthReport`, `HealthBand`, `CriterionResult`, `HealthArrType`, engine
  version, and canonical `CRITERION_IDS`; `engine.ts` emits deterministic reports.
- `lib/server/health/service.ts` is the live scoring seam; it returns a report but never persists.
- `lib/server/jobs/handlers/configHealthSnapshot.ts` owns snapshot scheduling, chunking, concurrency,
  per-instance isolation, cursor progress, and handler-level backoff.
- `lib/server/db/queries/configHealthSnapshots.ts` owns report serialization and snapshot parsing;
  `20260714_create_config_health_tables.ts` defines append-only history and its FK/retention shape.
- `lib/server/sync/drift/persist.ts` is the closest notification/dedup example, including compact rendering,
  transient-state preservation, and genuine-recovery re-arm. Its post-send signature write is specifically
  not strong enough for this feature's overlap requirement.
- `lib/server/notifications/{builder.ts,NotificationManager.ts,types.ts}` own event construction, exact
  subscription routing, provider dispatch, and history. `lib/shared/notifications/types.ts` is the UI/server
  catalog source of truth.
- Existing health tests use full migrations against a temporary SQLite file. Drift tests demonstrate pure
  predicates, real query integration, asynchronous notification draining, recovery, changed signatures,
  and sibling-safe no-throw behavior.

## Code Conventions

- Use tabs, single quotes, no trailing commas, 100-character print width, path aliases, and `.ts` suffixes
  matching nearby server modules.
- Prefer readonly domain inputs/outputs and a discriminated assessment union; keep policy constants exported
  once (`HEALTH_DEGRADATION_MIN_SCORE_DROP = 5`).
- Keep database row interfaces snake_case and parsed details camelCase, following
  `configHealthSnapshots.ts` and `driftStatus.ts`.
- Use ISO-8601 UTC TEXT for event/claim timestamps and `CURRENT_TIMESTAMP` only for bookkeeping columns.
- Bound and strip control characters from external display strings before building the embed; interpolation
  stays plain text and no raw snapshot/profile payload is sent.
- Catch/log at the narrow secondary boundary. A notification, history, assessment, signature, or state-query
  failure must not escape `snapshotInstance`, abort a `Promise.all` batch, advance job backoff, or change the
  normal job result.
- Tests use `Deno.test`, `@std/assert`, scratch bases under `/tmp/praxrr-tests`, `runMigrations()`, and cleanup
  in `finally`. Any patched mutable dependency must also be restored in `finally`.

## Integration Points

### Create

- `packages/praxrr-app/src/lib/server/health/degradation.ts`: pure policy, signature, contributors, event DTO.
- `packages/praxrr-app/src/lib/server/db/migrations/20260719_create_config_health_notification_state.ts`:
  PK/FK cascade state table with non-empty signature and timestamps.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthNotificationState.ts`: atomic claim, clear, get.
- Focused tests, preferably `src/tests/shared/health/degradation.test.ts` or `src/tests/health/degradation.test.ts`
  plus `src/tests/db/configHealthNotificationState.test.ts`; create notification manager/catalog coverage if
  no suitable notification test file exists.

### Modify

- `packages/praxrr-app/src/lib/server/db/migrations.ts`: statically import and register migration 20260719
  after 20260717.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: add deterministic `getLatest`.
- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`: previous-read, insert-ID capture,
  guarded assess/clear/claim/dispatch.
- `packages/praxrr-app/src/lib/server/notifications/types.ts`: add `HEALTH_DEGRADED`.
- `packages/praxrr-app/src/lib/shared/notifications/types.ts`: add the Config Health catalog row.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` and
  `src/tests/jobs/configHealthSnapshot.test.ts`: tie-break and integration/isolation coverage.
- `scripts/test.ts`: add `notifications` and include new health tests in `config-health`.
- `ROADMAP.md`: record issue #223 completion/follow-up state.

Do not modify `NotificationServiceForm.svelte`, notification create/edit page actions,
`groupNotificationTypesByCategory()`, or `NotificationManager` merely to expose this event; their dynamic
catalog behavior already provides explicit false-by-default opt-in.

## Gotchas and Warnings

- Claim **before** dispatch. Drift's current notify-then-mark sequence can duplicate under overlap and should
  not be copied. A delivery failure after claim is intentionally not retried.
- The first successful persisted snapshot is only a baseline. Do not query “latest” after insertion or the
  current row will compare with itself.
- `parseJsonArray()` converts malformed blobs to `[]`; an empty set must not accidentally compare equal to
  another malformed/empty set. Require a valid non-empty scored basis for a comparable edge.
- Compare immediate snapshots only; do not accumulate several sub-five-point declines or scan backward for a
  more favorable baseline.
- A worse band triggers even with a drop below five; same-band decline triggers at exactly five. Recovery is
  better-band or same-band gain at exactly five. Unknown is never ordered.
- State is independent of snapshot retention. Cleanup must not clear it, and enabling the event must not
  replay historical snapshot pairs.
- `notificationManager.notify()` swallows provider/history errors by design. Tests need a deterministic seam
  or bounded promise drain; never use a real webhook.
- Discord limits apply to the whole embed, not just contributor lines. Cap title, names, field values, line
  count, and combined text; color is supplemental to explicit band/score/delta wording.
- Do not add a public API, global health-notification boolean, configurable threshold, service backfill,
  outbox/retry system, webhook validation rewrite, or unrelated checkbox accessibility refactor in this issue.
