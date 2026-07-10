# Technical Specifications: Health Degraded Notifications

## Executive Summary

Issue #223 should extend the existing config-health snapshot write path, not create a second scorer or scheduler. For each successfully scored instance, read the latest persisted snapshot, insert the new snapshot, compare those two durable results, and emit `health.degraded` only when both are comparable and either the health band worsens or the score falls by at least five points. The event carries the instance, previous/current score and band, and the strongest criterion-level evidence.

Deduplication needs durable state independent of snapshot retention. A small one-row-per-instance `config_health_notification_state` table should hold the last emitted signature, mirroring `drift_instance_status.notified_signature`. The signature represents the current degraded state, so identical degraded results do not repeat; a meaningful recovery clears the row so a later recurrence can alert again. Notification delivery remains best-effort and outside snapshot persistence: errors are logged and swallowed, and can never change the snapshot job result.

Opt-in already exists at the correct scope. Adding `health.degraded` to the shared notification catalog makes it an unchecked checkbox for every existing/new notification service, while `NotificationManager` continues to enforce each service's `enabled_types`. No global health-notification boolean and no new public endpoint are needed.

## Architecture Design

### Data Flow

```text
config-health.snapshot job
  -> scoreInstance(instanceId)
  -> configHealthSnapshotsQueries.getLatest(instanceId)       (previous durable result)
  -> configHealthSnapshotsQueries.insert(report)               (current becomes durable first)
  -> assessHealthDegradation(previous, current)
       -> suppress: first snapshot, unknown band, engine mismatch,
                    unchanged/improving result, or score drop < 5 in same band
       -> eligible: worse band OR same/any band with score drop >= 5
       -> rank criterion context by largest comparable score decrease
       -> compute stable degraded-state signature
  -> configHealthNotificationStateQueries.get(instanceId)
       -> same signature: suppress duplicate
       -> new signature: emit health.degraded through NotificationManager
       -> meaningful recovery: clear notification state
  -> return snapshot success regardless of notification outcome
```

The comparison must occur in the same per-instance helper that owns the insert. Both scheduled and manual `config-health.snapshot` jobs then use identical behavior. The current dispatcher serializes jobs, and a sweep includes an instance only once, so no new in-memory lock is required. Database writes remain individual statement-atomic operations; do not introduce `db.transaction()` around concurrent `processBatches` work because the shared SQLite connection is not re-entrant for nested `BEGIN` calls.

### Degradation Semantics

Create `packages/praxrr-app/src/lib/server/health/degradation.ts` with pure comparison/signature/template helpers and the following fixed policy:

- Comparable means: both snapshots exist, both have the same `engine_version`, both bands are not `unknown`, and both scores are finite integers in `[0, 100]`.
- Band order is `healthy < attention < needs-review`; `unknown` has no order and never alerts or clears state.
- Meaningful degradation is a worse band, regardless of numeric delta, or `previousScore - currentScore >= 5`.
- Meaningful recovery is a better band or `currentScore - previousScore >= 5`. Recovery clears dedup state but emits nothing.
- A first snapshot, equal result, sub-five-point same-band movement, improving result, unknown result, or engine-version boundary emits nothing.
- The five-point threshold is a named exported constant (`HEALTH_DEGRADATION_MIN_SCORE_DROP = 5`), not user-configurable in this issue. It avoids one-point churn without adding API/settings complexity.

Criterion context is derived only from persisted `criteria_scores`. Match criteria by `id`, keep pairs where both scores are numeric and current is lower, sort by descending drop then canonical criterion id, and include at most three. Each context item carries the current persisted `detail` plus the first current suggestion headline. If the overall score degraded but no individual criterion score decreased (for example, weighting changed), include the lowest current measurable criterion as fallback context and label it as current context rather than inventing a delta.

The stable signature is an FNV-1a token, matching the existing drift signature approach, over a canonical sorted payload:

```text
health-degraded:v1|engineVersion|instanceId|currentBand|currentScore|
criterionId=currentCriterionScore ... (all current criteria, sorted by id; null preserved)
```

Do not include snapshot ids, timestamps, instance name, previous score, or display text: those would make identical state produce a different signature. A changed score, band, engine generation, or criterion score changes the signature.

### Delivery Isolation

After snapshot insertion and eligibility/dedup checks, build the notification and call the existing fluent builder with `NotificationTypes.HEALTH_DEGRADED`. Use `.generic(...)` so notification history has meaningful title/message and `.discord(...)` for richer evidence. Start the send as strict best-effort work and attach both success and failure handlers:

```ts
void emitHealthDegraded(event)
  .then(() => configHealthNotificationStateQueries.markNotified(...))
  .catch((error) => logNotificationFailure(error))
```

`NotificationManager.notify()` already catches provider and history failures, so normal delivery failures resolve and advance the signature after the emit attempt, as drift does. The outer catch protects against unexpected builder/template failures. Neither path throws into `snapshotInstance`; snapshot insertion remains the success boundary. A process crash between emit and state update can cause at-least-once delivery on a later identical eligible transition; eliminating that narrow window would require an outbox and is outside this issue.

## Data Models

### Existing Snapshot Model Changes

No columns are added to `config_health_snapshots`. Add `getLatest(instanceId)` ordered by `datetime(generated_at) DESC, id DESC`; the existing `idx_config_health_snapshots_instance (arr_instance_id, generated_at DESC)` supports the lookup, with `id` as deterministic tie-breaker. Add `getById(id)` only if the implementation chooses to re-read the inserted row; it is not required because the inserted `HealthReport` plus returned id is sufficient.

### New Notification State Table

Migration `20260719_create_config_health_notification_state.ts`:

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

Constraints and indexes:

- `arr_instance_id` is both PK and FK, enforcing one dedup row per live Arr instance and automatic cleanup on instance deletion.
- `notified_signature` is non-empty; its format is opaque to SQLite.
- `notified_at` is ISO-8601 UTC text, matching scheduling/dedup timestamps elsewhere.
- The primary key is the only required index. No signature index is needed because every lookup is instance-scoped.

Query module `configHealthNotificationState.ts` exposes exact operations:

- `get(instanceId): ConfigHealthNotificationState | undefined`
- `markNotified(instanceId, signature, notifiedAt): void` using `INSERT ... ON CONFLICT(arr_instance_id) DO UPDATE`
- `clear(instanceId): boolean`

### Migration Decision

Use a new latest-state table rather than adding a signature to append-only snapshots. Snapshot age/count pruning must not accidentally erase dedup state, and copying signature state into every snapshot would mix event-delivery state with immutable scoring history. No migration of existing rows is needed: all instances begin unarmed, their first post-upgrade snapshot establishes a comparison baseline, and no first-snapshot notification is sent. Register migration 20260719 in `migrations.ts`; do not edit reference `schema.sql` as a schema source.

### Internal Event Payload

`HealthDegradedEvent` is an internal typed builder input, not a new public API schema:

```ts
interface HealthDegradedEvent {
  type: 'health.degraded';
  signature: string;
  instanceId: number;
  instanceName: string;
  arrType: HealthArrType;
  engineVersion: string;
  previousSnapshotId: number;
  currentSnapshotId: number;
  previousScore: number;
  currentScore: number;
  scoreDelta: number; // current - previous; negative for degradation
  previousBand: Exclude<HealthBand, 'unknown'>;
  currentBand: Exclude<HealthBand, 'unknown'>;
  criteria: HealthDegradedCriterionContext[]; // max 3
  generatedAt: string;
  detailsPath: string; // /config-health/{instanceId}
}
```

Each criterion context has `id`, `label`, `previousScore: number | null`, `currentScore: number`, `scoreDelta: number | null`, `detail: string[]`, and `suggestion: string | null`.

## API Design

No new HTTP endpoint or OpenAPI schema is required. `health.degraded` is an internal notification event, and notification subscriptions are already persisted per service in `notification_services.enabled_types`. The existing new/edit server actions derive valid fields from `getAllNotificationTypeIds()`, and the shared Svelte form renders `groupNotificationTypesByCategory()`, so one catalog entry updates validation and UI together.

Runtime/settings fidelity requires exactly two registrations with the same literal:

- `NotificationTypes.HEALTH_DEGRADED = 'health.degraded'` in server notification types.
- `{ id: 'health.degraded', label: 'Health Degraded', category: 'Config Health', description: 'Notification when an Arr instance has a meaningful configuration-health regression' }` in the shared notification catalog.

The checkbox remains false unless a user selects it for a service; existing `enabled_types` JSON is not backfilled. Do not add `notificationEnabled` to `ConfigHealthSettingsResponse` or `ConfigHealthSettingsUpdateRequest`: a global boolean would conflict with the existing per-service routing contract and would require unnecessary OpenAPI, generated type, runtime validator, and UI changes. The event's generic message should be non-judgmental, for example: `Configuration health changed from 88 (Healthy) to 76 (Attention) on Radarr A.` The Discord embed adds previous/current fields, up to three criterion lines, and `/config-health/{instanceId}`.

## System Constraints

- Snapshot evidence is authoritative; never compare a live report with a prior in-memory report.
- Persist current snapshot before any notification decision or delivery attempt.
- Never compare across `CONFIG_HEALTH_ENGINE_VERSION` values.
- `unknown` is unmeasurable, not zero; it cannot alert or re-arm dedup state.
- Keep Arr identity explicit (`arrType`, instance id/name); no cross-Arr semantic fallback is introduced.
- Notification text stays non-judgmental and uses health terminology (`needs review`, not failure/error).
- `NotificationManager` remains the only service router so `enabled_types`, parallel provider dispatch, and `notification_history` behavior remain intact.
- Delivery failures, malformed service config, history-write failures, and template failures must be logged but must not alter the health snapshot job's status or backoff counters.
- Snapshot and state writes use statement-atomic queries; no nested transaction under `processBatches`.
- Cap Discord context at three criteria and use generic content for provider-neutral history.

## Codebase Changes

### Create

- `packages/praxrr-app/src/lib/server/db/migrations/20260719_create_config_health_notification_state.ts` — state table migration and down migration.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthNotificationState.ts` — get/upsert/clear operations.
- `packages/praxrr-app/src/lib/server/health/degradation.ts` — pure comparability, band ordering, five-point policy, criterion extraction, stable signature, event/template construction.
- `packages/praxrr-app/src/tests/shared/health/degradation.test.ts` — policy, unknown/version suppression, signature stability/sensitivity, context ranking.
- `packages/praxrr-app/src/tests/db/configHealthNotificationState.test.ts` — migration constraints, upsert, clear, and instance-delete cascade.

### Modify

- `packages/praxrr-app/src/lib/server/db/migrations.ts` — import/register migration 20260719.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` — add deterministic `getLatest(instanceId)`.
- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts` — read previous, insert current, assess/clear/dedup/emit; keep all notification failures outside job failure handling.
- `packages/praxrr-app/src/lib/server/notifications/types.ts` — add `HEALTH_DEGRADED` constant.
- `packages/praxrr-app/src/lib/shared/notifications/types.ts` — add the opt-in `Config Health` catalog entry.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` — latest-row ordering/tie-break coverage.
- `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts` — persisted comparison integration, one emit for identical degradation, no emit for improvement/unknown/version mismatch, changed-signature re-emit, recovery re-arm, and notifier rejection leaving the job successful.
- `scripts/test.ts` — ensure the `config-health` alias includes all new health tests; add a `notifications` alias if the issue's documented `deno task test notifications` command is retained.

No changes are needed to `NotificationManager.ts`, notification service queries, notification settings Svelte components/actions, config-health OpenAPI YAML, generated `v1.d.ts`, or config-health settings response mappers. Their existing dynamic catalogs and free-form `enabled_types` storage already support the event.

## Technical Decisions

1. **Dedicated state table over snapshot columns.** Keeps immutable score history separate from mutable delivery state and survives retention pruning.
2. **Persisted adjacent-snapshot comparison.** Makes every alert auditable and prevents live/in-memory divergence; first observation is baseline-only.
3. **Band downgrade or five-point score drop.** A fixed named threshold is the smallest meaningful-noise policy and avoids expanding the settings contract.
4. **Current-state signature.** Excluding time and snapshot ids makes dedup stable; including all current criterion scores detects materially different degraded states.
5. **Recovery re-arms only on meaningful comparable improvement.** Unknown/transient observations preserve state, preventing alert churn; a real recovery allows a later recurrence to alert.
6. **Manager path, not direct notifier calls.** Preserves per-service opt-in and notification history without replacing existing infrastructure.
7. **No public API expansion.** The existing notification catalog is the settings contract for this event; duplicating it in config-health settings would create two sources of truth.
8. **Best-effort at-least-once emit.** Snapshot persistence wins over delivery. A full transactional outbox is disproportionate to this issue.

## Open Questions

- Should product copy call the lowest band `Needs Review` everywhere in notifications, matching the UI label, or preserve the stored token `needs-review` in technical history metadata? Recommendation: human label in copy, stored token only in structured logs.
- The repository currently has no `notifications` test alias despite issue #223 listing `deno task test notifications`. Recommendation: add the alias and point it at notification manager/catalog tests plus the new health notification integration test rather than changing the issue's test plan.
- A future issue may make the five-point threshold configurable. If pursued, it must be added contract-first to the config-health OpenAPI settings schemas, generated types, route validation, DB constraints/query normalization, and settings UI together; do not partially expose it in this change.
