# Business Logic Research: Health Degraded Notifications

## Executive Summary

Issue #223 adds a prospective, opt-in `health.degraded` notification to the Config Health
foundation shipped in PR #217. The notification should turn an observed change between two
persisted snapshots for the same Arr instance into a concise explanation: which instance changed,
the previous and current score and band, and which scored criterion provides the most useful
current context. It must not rescore historical state, infer a regression from a live report alone,
or change Arr configuration.

The business-safe comparison is an edge between the newly persisted snapshot and its immediately
preceding comparable snapshot. A lower health band is always meaningful. A score-only decline is
meaningful only when it meets an explicit minimum-point threshold; this avoids alerts for small
within-band movement. Comparisons are suppressed when either endpoint is `unknown`, when the engine
version or scored-criterion basis differs, or when the score improved or stayed unchanged.
Idempotency is attached to the snapshot edge, while unchanged degraded snapshots naturally produce
no new edge. A later recovery establishes a new baseline, so a subsequent regression can notify
again.

Opt-in behavior fits the existing notification-service model: `health.degraded` is an available
event type, disabled for every service until the user selects it. Notification delivery remains
best-effort and outside the success contract of the snapshot write/job. A webhook or notification
history failure must not roll back the snapshot, fail the instance, abort sibling instances, or
change the sweep result.

## User Stories

### Arr Operator

- As an operator, I want to opt a notification service into Config Health regressions so that I can
  monitor configuration changes without enabling unrelated events.
- As an operator, I want the alert to identify the instance and show the previous and current score
  and band so that I can judge the size of the change without opening Praxrr first.
- As an operator, I want one criterion and its current suggestion included so that the alert points
  to evidence I can review rather than characterizing the configuration.
- As an operator, I want repeated snapshots of the same unchanged state to remain quiet so that a
  persistent condition does not create recurring alerts at every snapshot interval.
- As an operator, I want a new alert if the instance improves and later degrades again so that a new
  regression is not hidden by an older notification.
- As an operator, I want delivery failures recorded through the existing notification history while
  Config Health snapshot collection continues normally.

### Praxrr Administrator

- As an administrator, I want existing notification services to remain opted out after upgrade so
  that adding this event cannot unexpectedly increase outbound messages.
- As an administrator, I want notification settings changes to apply prospectively so that enabling
  the event does not backfill historical regressions.
- As an administrator, I want the same behavior for Radarr, Sonarr, and Lidarr while preserving each
  snapshot's explicit `arr_type` and without substituting sibling-app semantics.

## Business Rules

### Eligibility and Comparison

1. A degradation evaluation occurs only after a new Config Health snapshot has been persisted
   successfully. The persisted row, not an uncommitted live report, is the current evidence.
2. The previous evidence is the most recent earlier snapshot for the same non-null
   `arr_instance_id`, ordered by `generated_at` and then `id`. Snapshots from another instance are
   never eligible.
3. The first snapshot for an instance establishes a baseline and never emits `health.degraded`.
4. Both snapshots must have the same `engine_version`. An engine-version change establishes a new
   baseline because criterion formulas or band thresholds may have changed.
5. Both snapshots must have a measurable overall result: their bands must be `healthy`, `attention`,
   or `needs-review`. If either band is `unknown`, no degradation event is emitted.
6. The set of scored criteria must be comparable. A criterion is scored when its persisted score is
   numeric rather than `null`. If the scored criterion IDs or their persisted weights differ between
   the two snapshots, the new snapshot establishes a baseline and does not alert. This prevents a
   missing signal or settings change from being presented as observed deterioration.
7. Health band order is `healthy` (best), then `attention`, then `needs-review`. `unknown` has no
   position in this order.
8. A transition to a worse band is meaningful regardless of point delta. A transition to the same
   band is meaningful only when `previous_score - current_score` is at least the configured
   minimum score-drop threshold.
9. A higher score, equal score, better band, or equal band with a sub-threshold score decline does
   not emit. A later eligible snapshot is still compared with its immediate predecessor; suppressed
   small declines are not accumulated across multiple snapshots.
10. Profile-only changes do not independently emit in issue #223. Profile scores remain supporting
    evidence inside the snapshot, while notification eligibility is based on the instance-level
    `overall_score` and `band` named in the issue.

### Actionable Criterion Selection

1. Criterion context is derived only from the two persisted `criteria_scores` arrays. The
   notification path does not rerun the health engine or query current Arr/PCD state.
2. Prefer criteria that are numeric in both snapshots and whose current score is lower. Rank them by
   largest score decline, then largest contribution decline, then canonical criterion order for a
   deterministic tie-break.
3. The selected context contains criterion ID and label, previous/current criterion scores, and the
   first current suggestion headline and detail when present. Persisted criterion `detail` may be
   used when no suggestion is available.
4. If overall health declines but no individual criterion score declines (for example, a rollup
   change within otherwise comparable data), include the current lowest-scoring criterion with a
   suggestion. If none exists, report that no single criterion explanation is available and link to
   Config Health detail; do not invent a cause.
5. Context language describes observable facts. Use terms such as "decreased," "changed," and
   "review" rather than assigning blame or labeling a user's configuration as bad.

### Event and Message Contract

1. Event type is exactly `health.degraded` and appears in a Config Health notification category.
2. The logical event payload contains:
   - instance ID, persisted instance name, and explicit `arr_type`;
   - engine version and current observation timestamp;
   - previous snapshot ID, score, band, and generation timestamp;
   - current snapshot ID, score, band, and generation timestamp;
   - degradation kind (`band` or `score`) and point drop;
   - selected criterion context, when available; and
   - detail route `/config-health/{instanceId}`.
3. The generic title should be `Config health decreased on {instanceName}`. The generic message
   should state `{previousScore} ({previousBand}) -> {currentScore} ({currentBand})`, followed by the
   selected criterion label and suggestion when available.
4. A rich notification should expose Instance/App, Previous, Current, Change, Criterion, and Details
   as bounded fields. It must not include secrets, webhook configuration, raw errors, or unbounded
   snapshot JSON.
5. Band identifiers may be rendered as user-facing `Healthy`, `Attention`, `Needs review`, and
   `Unknown`; payload values retain the canonical stored identifiers.

### Opt-In and Deduplication

1. `health.degraded` is disabled by default. Existing service rows remain unchanged, and new
   services do not select it automatically.
2. A service receives the event only when the service itself is enabled and its `enabled_types` JSON
   contains `health.degraded`, following the existing `NotificationManager` filter.
3. Enabling the event is prospective. It does not scan or emit from historical snapshot pairs.
4. One degradation edge may be emitted at most once. The idempotency identity is the instance plus
   previous snapshot ID plus current snapshot ID (or an equivalent persisted unique signature).
5. Reprocessing the same current snapshot or the same job continuation must not emit again.
6. A new snapshot with the same score and band as the degraded snapshot is not a degradation and
   must not emit.
7. Improvement or recovery does not emit, but it advances the comparison baseline. If the instance
   later crosses another eligible degradation edge, that new edge may emit even when its score and
   band match an older degradation.
8. Deduplication is global to the logical event, not per notification service. Adding a service or
   toggling an event after an edge was evaluated does not replay the edge.

### Failure Isolation

1. Snapshot persistence is the primary operation; notification dispatch is a best-effort secondary
   effect.
2. Notification construction, service lookup, webhook delivery, notification-history recording, or
   dedupe-state update failure must not delete or roll back a persisted snapshot.
3. Such a failure must not throw out of `snapshotInstance`, fail `config-health.snapshot`, stop a
   `processBatches` batch, alter sweep progress, or trigger snapshot-job backoff.
4. Delivery attempts continue to use existing notification-history success/failure records.
   Snapshot-job output must not claim that delivery succeeded.
5. The business contract is at-most-once event dispatch per snapshot edge, not guaranteed webhook
   delivery. Automatic redelivery is outside issue #223 and could duplicate successful deliveries to
   other services.

## Workflows

### Eligible Band Regression

1. The snapshot job scores an enabled, sync-capable instance.
2. It persists the current report.
3. The system loads the immediately preceding comparable snapshot for that instance.
4. Previous `healthy` score 88 and current `attention` score 82 form a worse-band transition.
5. The system selects the most relevant worsened criterion from persisted criterion evidence.
6. It records the event edge for deduplication and dispatches `health.degraded` to opted-in services.
7. The snapshot job continues without waiting on a successful external delivery.

### Eligible Same-Band Score Regression

1. Previous and current snapshots are both `attention` and have the same engine and scoring basis.
2. The score drop meets the configured threshold, for example 78 to 68 with a 10-point threshold.
3. One `health.degraded` event is dispatched with degradation kind `score`.
4. A subsequent snapshot at 68/`attention` produces no event because there is no new decline.

### Suppressed Comparison

1. The current snapshot is persisted normally.
2. The system finds no previous snapshot, an `unknown` endpoint, a different engine version, a
   different scored-criterion basis, an improvement, or a sub-threshold same-band decline.
3. No event is dispatched and no failure is reported.
4. The current snapshot becomes the predecessor for the next snapshot.

### Recovery Followed by a New Regression

1. A meaningful 90/`healthy` to 70/`attention` transition dispatches once.
2. Repeated 70/`attention` snapshots remain quiet.
3. A later 88/`healthy` snapshot is an improvement and remains quiet.
4. A subsequent 70/`attention` snapshot is a new persisted edge and dispatches once.

### Delivery Failure

1. A meaningful degradation is detected and the event is handed to the notification manager.
2. One or more notifiers reject or time out; existing notification history records failed attempts
   where possible.
3. The persisted health snapshot remains available in trends.
4. The instance item, batch, and sweep retain their normal success semantics; no job backoff is
   introduced by notification delivery.

## Domain Model

### Existing Entities

- **Config Health Snapshot**: Append-only persisted observation for one instance, including overall
  score/band, engine version, full overall criterion results, profile summaries, and timestamps.
- **Health Band**: `healthy`, `attention`, `needs-review`, or `unknown`. Only the first three are
  ordered for degradation comparisons.
- **Criterion Result**: Persisted criterion ID, label, nullable score, weight, contribution, details,
  and non-judgmental suggestions.
- **Arr Instance**: The current FK owner of a snapshot. The snapshot also denormalizes instance name
  and `arr_type`; comparison remains keyed by the non-null instance ID.
- **Notification Service**: An enabled/disabled outbound service with an `enabled_types` event list.
- **Notification History**: Per-service delivery-attempt record with success/failed status.

### New Logical Concepts

- **Comparable Snapshot Pair**: Consecutive snapshots for one instance with the same engine version,
  known bands, and the same scored-criterion basis.
- **Degradation Edge**: A comparable pair where the band worsens or a same-band score decline reaches
  the configured threshold.
- **Degradation Kind**: `band` when the ordered band worsens; otherwise `score`.
- **Actionable Criterion Context**: Deterministically selected persisted criterion evidence used to
  explain what changed and what the user can review.
- **Event Identity**: Durable identity for one degradation edge, based on instance and snapshot pair,
  used to make evaluation idempotent.
- **Minimum Score-Drop Threshold**: Integer number of points required for a same-band decline. Band
  regressions do not use this threshold.

### State Transitions

```text
no baseline -> measurable baseline                     : no event
baseline -> improving or unchanged                     : no event, advance baseline
baseline -> unknown/unmeasurable/incomparable           : no event, establish new baseline
baseline -> meaningful degradation                     : emit once, advance baseline
notified degradation -> repeated unchanged degradation : no event
notified degradation -> recovery -> new degradation    : emit the new edge once
```

## Existing Codebase Integration

- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts` is the owner of the
  score-persist workflow. Its `snapshotInstance` isolation already prevents one scoring/persistence
  failure from aborting a batch; degradation evaluation belongs after a successful insert and must
  preserve that no-throw boundary.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` already serializes the
  overall criterion results needed for comparison and actionable context. It currently exposes
  insert and full trend reads; the notification flow needs a bounded predecessor lookup and durable
  idempotency operation rather than loading an entire trend.
- `packages/praxrr-app/src/lib/shared/health/types.ts`, `policy.ts`, and `engine.ts` define the closed
  band values, 85/60 thresholds, engine version, nullable criterion scores, exact contribution
  rollup, and persisted suggestions. Notifications should consume these contracts and must not
  duplicate scoring formulas.
- `packages/praxrr-app/src/lib/server/db/migrations/20260714_create_config_health_tables.ts` creates
  append-only snapshots but contains no notification threshold or event identity. Any durable
  threshold/dedupe addition requires a forward migration; the shipped migration must not be edited.
- `packages/praxrr-app/src/lib/shared/notifications/types.ts` is the settings catalog used to render
  grouped event checkboxes and to collect submitted type IDs. Adding `health.degraded` there makes it
  independently selectable and leaves it false unless selected.
- `packages/praxrr-app/src/lib/server/notifications/types.ts` provides server constants. A
  `HEALTH_DEGRADED` constant avoids string drift across detection, tests, and templates.
- `packages/praxrr-app/src/lib/server/notifications/builder.ts` and `NotificationManager.ts` already
  provide generic/Discord payloads, per-service opt-in filtering, parallel best-effort delivery, and
  notification-history recording. The new flow should reuse them rather than introduce a second
  manager.
- `packages/praxrr-app/src/lib/server/sync/drift/persist.ts` is the closest dedupe and message pattern:
  it compares prior/current persisted state, builds bounded generic/Discord content, tracks a
  notified signature, and prevents delivery failure from affecting the primary workflow. Config
  Health differs by comparing append-only snapshot edges and by allowing recovery to create a new
  eligible edge.
- `packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte`
  dynamically renders the shared catalog, so no health-specific checkbox logic should be needed.
- `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`,
  `tests/db/configHealthSnapshots.test.ts`, and `tests/sync/drift/persist.test.ts` provide the relevant
  job-isolation, snapshot-ordering, and dedupe/recovery test patterns.

## Success Criteria

- [ ] `health.degraded` appears as a Config Health event and is unselected for existing and newly
      created notification services until explicitly enabled.
- [ ] A first snapshot never emits.
- [ ] A comparable worse-band transition emits exactly one logical event, even when the point drop is
      below the same-band threshold.
- [ ] A comparable same-band decline emits exactly once when it meets the configured point threshold.
- [ ] A same-band decline below the threshold does not emit, and small declines are not accumulated.
- [ ] Improving, unchanged, `unknown`, cross-engine, and changed-measurement-basis pairs do not emit.
- [ ] Reprocessing the same snapshot edge and repeated unchanged degraded snapshots do not emit
      duplicates.
- [ ] Recovery followed by a later regression emits one new event.
- [ ] The event exposes instance identity, explicit Arr type, previous/current score and band,
      timestamps, point drop, deterministic criterion context, and a Config Health detail link.
- [ ] Generic and Discord-facing text uses non-judgmental, bounded language and does not expose raw
      errors or secrets.
- [ ] Notification construction, lookup, history, or webhook failure cannot fail or back off the
      Config Health snapshot job, abort a sibling instance, or remove the persisted snapshot.
- [ ] Behavior is covered for Radarr, Sonarr, and Lidarr using explicit stored `arr_type` values.
- [ ] `deno task test config-health`, `deno task test notifications`, and `deno task check` pass.

## Open Questions

1. **Same-band threshold value and ownership**: What should the default minimum score drop be? A
   10-point default is straightforward and testable, but product confirmation is required. Should it
   be a Config Health singleton setting or a fixed policy constant for issue #223?
2. **Measurement-basis identity**: Should comparability require equal criterion IDs and weights as
   recommended, or only equal engine version and non-null overall bands? The stricter rule avoids
   alerts caused by settings or measurement availability changes.
3. **Dedupe storage**: Should event identity live on the current snapshot, in a dedicated event table,
   or in per-instance notification state? It must survive restart and support a later identical
   regression after recovery.
4. **Attempt versus delivery semantics**: The existing `NotificationManager.notify()` resolves after
   `Promise.allSettled`, even when individual services fail. Should dedupe mean one dispatch attempt
   per edge, as recommended, or should failed services be retried by a separate delivery mechanism?
5. **Criterion ranking**: Should actionable context rank raw criterion score decline (recommended for
   user clarity) or weighted contribution decline (closer to the overall-score arithmetic)?
6. **Profile context**: Issue #223 names instance-level score/band evidence. Should a future event
   identify the most-degraded profile as secondary context, or remain instance-only for the first
   release?
7. **No subscribers**: Should an eligible edge be recorded as evaluated when no service currently
   opts into `health.degraded`? Recording it preserves prospective-only behavior; not recording it
   could create a delayed alert after configuration changes.
