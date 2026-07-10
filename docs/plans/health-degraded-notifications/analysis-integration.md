# Integration Analysis: Health Degraded Notifications

## Executive Summary

Issue #223 fits into the existing Config Health snapshot job and notification infrastructure without
adding a public API. For each eligible Arr instance, the handler must read the latest persisted
snapshot before scoring, persist the new report, then run comparison, recovery/claim, notification
building, and dispatch as a post-insert best-effort phase. The insert is the primary operation: once
it succeeds, no assessment, state, rendering, manager, Discord, or history failure may make the
instance fail, abort sibling work, change sweep progress, or trigger job backoff.

Durable deduplication belongs in a new per-instance state table, not in append-only snapshot history
or process memory. A single conditional SQLite upsert claims a changed degraded signature before
dispatch, giving an at-most-once _attempt_ across overlapping sweeps and restarts. A meaningful
comparable recovery deletes the state row and re-arms the same later regression. Claim-before-send
means a failed delivery is intentionally not replayed.

## API Endpoints

No new endpoint or OpenAPI schema is needed. `health.degraded` is an internal event emitted by the
scheduled/manual snapshot handler. Existing Config Health endpoints remain the evidence surfaces:
the notification links to `/config-health/{instanceId}`, while summary, detail, trends, and settings
contracts do not change.

Notification settings already derive both the event picker and accepted form keys from
`$shared/notifications/types.ts`:

- Add one catalog row: ID `health.degraded`, label `Config Health Decreased`, category
  `Config Health`, and a concise description.
- `NotificationServiceForm.svelte` groups that row and initializes it to false unless the stored
  `enabled_types` already contains the ID.
- Create/edit actions call `getAllNotificationTypeIds()` and persist only checked catalog IDs.
  Therefore no route code, global health toggle, threshold field, backfill, or replay endpoint is
  required.
- Add `NotificationTypes.HEALTH_DEGRADED = 'health.degraded'` on the server so producer and manager
  use the same stable identifier.

The subscription contract remains strict opt-in: a service must have `enabled = 1` and a valid JSON
`enabled_types` array explicitly containing `health.degraded`. Existing rows are unchanged by the
catalog addition and consequently remain unsubscribed.

## Database

### Exact table and migration integration

Create
`packages/praxrr-app/src/lib/server/db/migrations/20260719_create_config_health_notification_state.ts`
with version `20260718`, register its static import and array entry immediately after `20260717` in
`migrations.ts`, and provide the reversible schema:

```sql
CREATE TABLE config_health_notification_state (
  arr_instance_id   INTEGER PRIMARY KEY,
  notified_signature TEXT NOT NULL CHECK (length(notified_signature) > 0),
  notified_at       TEXT NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (arr_instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE
);
```

`down` drops the table. The primary key is the only required index. Cascade deletion is correct
because this is live-instance control state, unlike `config_health_snapshots`, whose nullable FK and
denormalized name preserve historical evidence after instance deletion. The table deliberately has
no FK to a snapshot, so retention cannot erase the dedup authority.

### Exact query integration

Add `db/queries/configHealthNotificationState.ts` with these statement-atomic operations:

- `claim(instanceId, signature, notifiedAt): boolean`: reject/guard empty signatures, then execute
  `INSERT ... ON CONFLICT(arr_instance_id) DO UPDATE SET notified_signature = excluded.notified_signature,
notified_at = excluded.notified_at, updated_at = CURRENT_TIMESTAMP WHERE
config_health_notification_state.notified_signature <> excluded.notified_signature`. Return
  `db.execute(...) > 0`. The affected-row result is the dispatch gate; never implement this as
  read-then-write.
- `clear(instanceId): boolean`: one `DELETE ... WHERE arr_instance_id = ?`; use only after a
  meaningful comparable recovery.
- `get(instanceId)`: diagnostic/test read only, never the authority for winning a claim.

Extend `configHealthSnapshotsQueries` with `getLatest(instanceId)`, selecting one row ordered by
`datetime(generated_at) DESC, id DESC`. The ID tie-break is required when timestamps match. Parse via
the existing `rowToDetail` path. Read this row before scoring/insertion so the comparison is between
the newly persisted snapshot and its immediate predecessor rather than itself.

Do not add a transaction around previous-read, snapshot insert, claim, or dispatch. The snapshot
handler runs concurrently under `processBatches`, the shared DB manager uses one SQLite connection,
and nested bare transactions are not re-entrancy-safe. The snapshot insert, conditional claim, and
clear are each individually statement-atomic. The claim is the concurrency authority even if two
workers observe the same predecessor.

## External Services

Discord remains the only provider. The existing `DiscordNotifier` sends through the singleton
`WebhookClient` to the configured incoming webhook URL with a 10-second timeout and zero retries.
The feature adds no SDK, credential, provider, or transport behavior.

Build one bounded warning embed for each logical event, so one opted-in Discord service normally
receives one webhook request. Reuse `notify()`, `createEmbed()`, `Colors.WARNING`, and
`getInstanceIcon()`. Include explicit instance/app, previous and current score/band, signed point
change, at most three contributor summaries, observation time, and the relative detail path. Keep
text meaningful without color; strip controls, escape/sanitize display text, and truncate titles,
field names/values, contributor detail, and combined embed content to Discord limits. Never include
webhook URLs, provider errors, raw snapshot JSON, or secrets.

The transport/history failure contract is unchanged: notifier failures are logged and converted to
failed per-service history records where possible; history insertion failure is also swallowed.
There is no health-specific retry or outbox. Because the signature was claimed first, any process or
delivery failure after claim is an accepted lost notification attempt, not grounds for replay.

## Internal Services

Add a pure `server/health/degradation.ts` module that owns the fixed
`HEALTH_DEGRADATION_MIN_SCORE_DROP = 5`, strict comparability, trigger/recovery classification,
canonical signature, contributor ranking, bounded DTO, and notification projection.

Comparability must require the same non-null instance, the same non-empty engine version, known
bands, finite integer scores in `0..100`, and identical scored criterion IDs and weights. Criterion
JSON parsing already fails closed to an empty array; the degradation module must additionally reject
duplicates, missing/extra scored criteria, malformed values, or differing scoring bases. Preserve
the persisted explicit `radarr`, `sonarr`, or `lidarr` value; do not infer a sibling Arr type or add a
cross-Arr fallback.

Classification is adjacent-snapshot only: any worse ordered band or a same-band drop of at least
five emits; a better band or same-band gain of at least five clears state; first, unchanged,
improving below threshold, declining below threshold, unknown, cross-engine, malformed, and
changed-basis pairs neither emit nor clear. Small declines do not accumulate.

The signature must be stable for the current degraded state and include version marker
`health-degraded:v1`, instance ID, engine version, current band/score, and every current criterion
ID/score in `CRITERION_IDS` order while preserving `null`. Exclude timestamps, snapshot IDs, names,
labels, previous values, and display text. Use a bounded canonical string or SHA-256 hex digest, not
a small non-cryptographic hash.

`NotificationManager` itself needs no behavior change. It reads enabled services, safely ignores
malformed `enabled_types`, filters by exact event type, dispatches services with
`Promise.allSettled`, isolates per-provider failures, and records generic title/message in
`notification_history`. A deterministic injection or promise-drain seam may be added around the
health producer for tests, but production routing should remain through the manager.

## Integration Points

1. In `snapshotInstance(instanceId)`, read `previous = getLatest(instanceId)` before calling
   `scoreInstance(instanceId)`.
2. If scoring returns a report, insert it and retain the returned ID. A zero/invalid ID must not be
   used to construct an event.
3. After successful insertion, enter a dedicated no-throw post-insert block. Assess the exact
   previous/current pair; any error is logged with bounded metadata and returns normally.
4. On meaningful recovery, call `clear(instanceId)` and stop. On quiet/incomparable outcomes, stop
   without modifying state.
5. On degradation, compute the current-state signature and call atomic `claim`. Only an affected
   row may proceed to event construction and dispatch.
6. Build the canonical event from persisted evidence, including both snapshot IDs, and dispatch via
   the existing builder/manager. Awaiting a caught send is preferable for deterministic job tests;
   if fire-and-forget is retained, every promise must have a swallowing catch and tests need a drain
   seam. In either form, delivery cannot escape the post-insert guard.
7. Preserve `snapshotInstance`'s never-throw guarantee because each `processBatches` batch uses
   `Promise.all`; one instance must not abort siblings. Notification failures must not advance
   `error_count`, set `backoff_until`, alter cursor/terminal scheduling, or change job status.
8. Add focused tests for pure policy/signature/render bounds; migration FK/cascade and atomic
   claim/clear/get behavior; `getLatest` ordering; snapshot read-before-insert and baseline behavior;
   opt-in routing; overlapping/repeated claims; recovery re-arm; Arr fidelity; and manager/provider/
   history failure isolation.
9. Update `scripts/test.ts`: include all new degradation, state-query, snapshot, and integration
   tests in `config-health`, and add a `notifications` alias covering the notification catalog,
   manager, Discord/rendering, and health-event integration tests. Required gates are
   `deno task test config-health`, `deno task test notifications`, and `deno task check`.

The acceptance invariant is: persisted snapshots and sweep completion are authoritative; alerting
is opt-in, comparison-safe, atomically deduplicated, Arr-specific, bounded, and fully failure-isolated.
