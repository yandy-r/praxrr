# Feature Spec: Health Degraded Notifications

## Executive Summary

Issue #223 adds an opt-in `health.degraded` notification when consecutive persisted Config Health
snapshots show a meaningful regression for one Arr instance. The snapshot job persists the report,
compares it with the preceding compatible snapshot, atomically claims a per-instance degraded-state
signature, and dispatches through the existing notification manager. A worse band or same-band drop
of at least five points qualifies; improving, unchanged, unknown, malformed, or incompatible results
stay quiet. The event includes previous/current evidence and bounded criterion context, while
delivery failure never affects snapshot or job success.

## External Dependencies

### APIs and Services

#### Discord Incoming Webhooks

- **Documentation**: [Discord Webhook Resource](https://docs.discord.com/developers/resources/webhook)
- **Authentication**: Bearer-like token embedded in the configured webhook URL
- **Endpoint**: `POST /api/webhooks/{webhook.id}/{webhook.token}` through Praxrr's existing notifier
- **Rate limits**: Dynamic Discord webhook buckets; the existing notifier performs no retries
- **Pricing**: No additional service or SDK required

The feature sends one bounded embed per event. It reuses the current `WebhookClient`,
`DiscordNotifier`, `NotificationManager`, generic notification payload, and per-service history.
There is no new external API, public emission endpoint, package, or notification provider.

### Libraries and SDKs

| Library | Version | Purpose                                                             | Installation |
| ------- | ------- | ------------------------------------------------------------------- | ------------ |
| None    | —       | Existing Deno, SQLite, and notification utilities cover the feature | —            |

### External Documentation

- [Discord embed limits](https://docs.discord.com/developers/resources/message#embed-limits): title,
  field, field-count, and combined-text constraints for the rich payload.
- [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits): reason to keep one
  logical event to one compact request per subscribed service.

## Business Requirements

### User Stories

**Primary User: Arr operator**

- As an operator, I want to opt a notification service into health regressions so that persistent
  scoring does not create unsolicited messages.
- As an operator, I want previous/current score and band evidence so that I can assess the change
  before opening Praxrr.
- As an operator, I want a concise contributor and detail link so that the alert suggests a useful
  next step without judging or automatically changing configuration.
- As an operator, I want unchanged degraded snapshots to remain quiet and a later recovered-then-
  degraded episode to alert again.

### Business Rules

1. **Persisted evidence first**: A notification may be evaluated only after the new snapshot is
   successfully inserted. The first snapshot establishes a baseline and never emits.
2. **Strict comparability**: Both snapshots must belong to the same non-null instance, use the same
   non-empty engine version, have known bands and finite integer scores from 0–100, and have the same
   scored criterion IDs and weights.
3. **Meaningful degradation**: A transition to a worse ordered band qualifies regardless of point
   delta. A same-band decline qualifies when `previousScore - currentScore >= 5`.
4. **No accumulated noise**: Several sub-five-point declines are not accumulated; each snapshot is
   compared only with its immediate predecessor.
5. **Quiet uncertainty**: First, unchanged, improving, sub-threshold, `unknown`, malformed,
   cross-engine, or changed-basis comparisons never emit.
6. **Durable deduplication**: The system atomically claims the current degraded-state signature per
   instance before dispatch. An unchanged signature cannot dispatch twice across overlap or restart.
7. **Recovery re-arms**: A better band or same-band gain of at least five points writes a nullable
   re-arm tombstone at the current snapshot high-water mark. Unknown, incomparable, and smaller
   gains preserve state. Recovery itself never emits, and stale overlapping work cannot overwrite it.
8. **Opt-in only**: A service receives the event only when enabled and its existing `enabled_types`
   array explicitly contains `health.degraded`. No existing row is backfilled and no historical pair
   is replayed when the event is enabled.
9. **Best effort**: Assessment, claim, rendering, manager, provider, or history failure cannot roll
   back the snapshot, fail an instance, abort siblings, alter sweep progress, or trigger job backoff.
10. **Arr fidelity**: The payload preserves the snapshot's explicit `radarr`, `sonarr`, or `lidarr`
    type. It introduces no cross-Arr fallback or inferred mapping.

### Edge Cases

| Scenario                                  | Expected Behavior              | Notes                                               |
| ----------------------------------------- | ------------------------------ | --------------------------------------------------- |
| No previous snapshot                      | Persist baseline; no event     | Avoids upgrade-time historical alerts               |
| `healthy 86` to `attention 84`            | Emit                           | Worse band overrides the five-point rule            |
| `attention 79` to `attention 74`          | Emit                           | Five-point same-band boundary                       |
| `attention 79` to `attention 75`          | No event                       | Small changes do not accumulate                     |
| Same score/band repeated                  | No event                       | No degradation edge and signature stays claimed     |
| `unknown` at either endpoint              | No event or recovery           | Unmeasurable is not worse or better                 |
| Engine version changes                    | No event or recovery           | New scoring policy establishes a boundary           |
| Criterion availability/weight changes     | No event or recovery           | Prevents settings/data availability false positives |
| Meaningful recovery, then same regression | Emit once for new episode      | Recovery writes a newer re-arm tombstone            |
| Delivery fails after claim                | Snapshot/job succeed; no retry | Intentional at-most-once attempt contract           |

### Success Criteria

- [ ] `health.degraded` is selectable per notification service and remains off until selected.
- [ ] A comparable worse-band transition emits exactly one event with persisted evidence.
- [ ] A comparable same-band decline of at least five points emits exactly one event.
- [ ] Repeated unchanged degraded snapshots and overlapping claims do not duplicate delivery.
- [ ] Improving, unchanged, unknown, malformed, cross-engine, and changed-basis results stay quiet.
- [ ] The event includes instance/app, previous/current score and band, point change, criterion
      context, observation time, and the Config Health detail path.
- [ ] Delivery and history failures do not change snapshot/job success.
- [ ] Required test aliases and type checks pass.

## Technical Specifications

### Architecture Overview

```text
config-health.snapshot
  -> score instance
  -> insert current snapshot
  -> read immediately preceding row where id < current snapshot id
  -> pure degradation assessment
       -> incomparable/quiet: stop
       -> recovery: atomically re-arm at current snapshot id
       -> degradation: build canonical current-state signature
  -> atomic claim(currentSnapshotId, signature)
       -> unchanged/already claimed: stop
       -> claimed: dispatch health.degraded best effort
  -> return normal snapshot/job result
```

The successful insert is the primary-operation boundary. The post-insert notification phase has its
own no-throw guard and performs only statement-atomic database operations; it must not introduce a
nested transaction under `processBatches`.

### Data Models

#### `config_health_notification_state`

| Field                  | Type     | Constraints                                | Description                                    |
| ---------------------- | -------- | ------------------------------------------ | ---------------------------------------------- |
| `arr_instance_id`      | INTEGER  | PK, FK `arr_instances(id)`, cascade delete | One dedup state per live instance              |
| `last_snapshot_id`     | INTEGER  | NOT NULL, positive                         | Monotonic processed-transition high-water mark |
| `notified_signature`   | TEXT     | Nullable; non-empty when present           | Opaque canonical degraded-state identity       |
| `notified_at`          | TEXT     | Nullable with signature                    | ISO-8601 UTC time of the dispatched claim      |
| `notified_snapshot_id` | INTEGER  | Nullable positive ID with signature        | Snapshot whose changed signature won dispatch  |
| `created_at`           | DATETIME | NOT NULL, default current time             | Initial state creation                         |
| `updated_at`           | DATETIME | NOT NULL, default current time             | Last accepted monotonic transition             |

The state remains independent from append-only snapshot retention, so snapshot IDs are ordering
values rather than foreign keys. Migration `20260719_create_config_health_notification_state.ts`
creates the table plus the predecessor index on `(arr_instance_id, id DESC)` and is registered after
main's migration `20260718`.

#### Atomic query contract

- `claim(instanceId, currentSnapshotId, signature, notifiedAt): boolean` uses one conditional
  `INSERT ... ON CONFLICT DO UPDATE` that rejects older snapshot IDs, advances the high-water mark,
  and returns true only when the current snapshot changed the signature and won dispatch.
- `rearm(instanceId, currentSnapshotId): boolean` writes a nullable-signature tombstone only when
  the recovery snapshot is newer than the stored high-water mark.
- `get(instanceId)` exists for tests/diagnostics, not for deciding whether a claim wins.

#### Signature contract

Canonical input version `health-degraded:v1` contains instance ID, engine version, current band,
current overall score, and every current criterion ID/score sorted by canonical criterion order,
preserving `null`. It excludes timestamps, snapshot IDs, names, labels, previous values, and display
text so resampling the same state is stable. Store a bounded canonical string or a stable SHA-256 hex
digest using platform crypto; do not use a small non-cryptographic hash for dedup authority.

### Internal Event Design

`HealthDegradedEvent` contains:

```typescript
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
  previousBand: Exclude<HealthBand, 'unknown'>;
  currentBand: Exclude<HealthBand, 'unknown'>;
  pointDrop: number;
  kind: 'band' | 'score';
  contributors: HealthDegradedCriterionContext[];
  generatedAt: string;
  detailsPath: string;
}
```

Criterion candidates must be measurable in both snapshots and have a lower current score. Rank by
raw score drop, then contribution drop, then `CRITERION_IDS` order. Generic/history text uses the top
candidate; Discord uses at most three. If none declined, show the lowest current measurable
criterion as current context, or explicitly say no single criterion change was identified.

### API Design

No new HTTP endpoint or OpenAPI schema is required. This is an internal event and the existing
notification service form/actions already derive selectable and valid event IDs from the shared
catalog.

Runtime/settings fidelity requires:

- `NotificationTypes.HEALTH_DEGRADED = 'health.degraded'` in server notification constants.
- One shared catalog row with ID `health.degraded`, label `Config Health Decreased`, category
  `Config Health`, and a concise description.

No global Config Health notification boolean, threshold field, backfill, or public event endpoint is
added. The fixed five-point policy is exported from the health degradation module.

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/health/degradation.ts`: validation, comparability, trigger and
  recovery policy, signature creation, criterion ranking, bounded notification DTO/builder.
- `packages/praxrr-app/src/lib/server/db/migrations/20260719_create_config_health_notification_state.ts`:
  forward state-table migration.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthNotificationState.ts`: monotonic atomic
  claim/re-arm transitions and diagnostic get.
- Focused pure and database tests for the degradation module and state queries.

#### Files to Modify

- `packages/praxrr-app/src/lib/server/db/migrations.ts`: register `20260719`.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: indexed, narrow
  `getPrevious(instanceId, currentSnapshotId)` lookup by append order.
- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`: score, insert, read the
  persisted predecessor, then assess/re-arm/claim/dispatch in a separate no-throw phase.
- `packages/praxrr-app/src/lib/server/notifications/types.ts`: add the server constant.
- `packages/praxrr-app/src/lib/shared/notifications/types.ts`: add the opt-in catalog entry.
- Config Health snapshot/query tests and notification catalog/manager tests.
- `scripts/test.ts`: add a `notifications` alias so the issue's command is executable and include
  all new health tests in `config-health`.
- `ROADMAP.md`: record issue #223 delivery and update the Config Health follow-up status.

#### Configuration

- Fixed `HEALTH_DEGRADATION_MIN_SCORE_DROP = 5` for the first release.
- Existing notification service `enabled_types` remains the sole subscription source.

## UX Considerations

### User Workflows

#### Primary Workflow: Opt in and investigate

1. **Select event**
   - User: Opens Settings → Notifications, creates/edits a service, and selects Config Health →
     Config Health Decreased.
   - System: Persists the explicit `health.degraded` ID; no historical event is emitted.
2. **Receive event**
   - User: Sees one compact message with instance/app and symmetric Previous/Current fields.
   - System: Shows signed point change, band change, bounded contributors, snapshot time, and detail
     path. Text conveys meaning independently of color.
3. **Review evidence**
   - User: Opens `/config-health/{instanceId}`.
   - System: Existing detail/trend surfaces provide the complete report and suggestions.

#### Error Recovery Workflow

1. **Delivery fails**: The webhook times out or rejects the request.
2. **User sees**: Existing notification history records a failed attempt where possible; the health
   snapshot and trends remain current.
3. **Recovery**: The user repairs/tests the service. Issue #223 does not replay the claimed event or
   add health-specific retries.

### UI Patterns

| Component       | Pattern                           | Notes                                                              |
| --------------- | --------------------------------- | ------------------------------------------------------------------ |
| Event picker    | Existing grouped catalog checkbox | New event is unselected unless explicitly chosen                   |
| Discord message | One warning embed                 | Previous/current parallel fields; at most three contributors       |
| Evidence        | Text plus numeric score/band      | Color is supplemental, never the only signal                       |
| Next step       | Existing detail route             | Relative path unless a validated canonical base URL already exists |

### Accessibility Requirements

- The event's visible label must be its accessible name, support keyboard activation, and provide an
  effective pointer target. A broader reusable checkbox improvement may be tracked separately if it
  would expand this issue.
- Band label, score, signed delta, and transition wording must carry the meaning without relying on
  warning color.

### Performance UX

- One logical event produces one compact request per opted-in service.
- Bound and sanitize names, labels, details, and suggestion text before rendering; stay below Discord
  title, field, field-count, and combined-text limits.
- Use the snapshot's generation time so the evidence timestamp is unambiguous.

## Recommendations

### Implementation Approach

**Recommended Strategy**: Build a small pure health-degradation module, a retention-independent
per-instance claim table, and a guarded post-insert integration in the existing snapshot handler.
Reuse the notification manager unchanged and keep the public API/settings contract limited to the
existing dynamic event catalog.

**Phasing:**

1. **Domain policy**: comparability, five-point trigger/recovery, signature, contributor ranking,
   safe bounded rendering, and pure tests.
2. **Persistence**: forward migration, monotonic conditional claim/re-arm queries, indexed predecessor lookup,
   and database tests.
3. **Integration**: event registration, post-insert orchestration, best-effort dispatch, job and
   notification tests.
4. **Closeout**: ROADMAP, aliases, full validation, manual repeated-regression check.

### Technology Decisions

| Decision     | Recommendation                                        | Rationale                                           |
| ------------ | ----------------------------------------------------- | --------------------------------------------------- |
| Threshold    | Fixed five points, plus any worse band                | Explicit, low-noise, no API/settings expansion      |
| Comparison   | Adjacent persisted snapshots with strict basis parity | Auditable and resistant to false alerts             |
| Dedup        | Atomic current-state claim before send                | Durable at-most-once attempts under overlap/restart |
| Recovery     | Better band or five-point gain                        | Symmetric re-arm without small oscillation noise    |
| Delivery     | Existing manager, no retries/outbox                   | Meets best-effort requirement and preserves scope   |
| Dependencies | None                                                  | Repository-native code is sufficient                |

### Quick Wins

- The shared catalog automatically exposes the event in create/edit settings without Svelte changes.
- `getPrevious(instanceId, currentSnapshotId)` avoids loading a trend and remains adjacent under
  overlapping inserts.
- Compact drift/canary messages provide established builder conventions.
- A `notifications` test alias makes the issue's documented test plan directly runnable.

### Future Enhancements

- Consider configurable thresholds only after observing real alert volume.
- Treat delivery retry/outbox, general Discord URL validation, webhook secret encryption/sanitized
  settings DTOs, and reusable event-picker accessibility as separate notification-infrastructure
  work unless an in-scope regression is directly exposed by this change.

## Risk Assessment

### Technical Risks

| Risk                                           | Likelihood | Impact | Mitigation                                           |
| ---------------------------------------------- | ---------- | ------ | ---------------------------------------------------- |
| Duplicate alert under overlap                  | Medium     | High   | Atomic conditional claim before dispatch             |
| False regression after scoring/settings change | Medium     | High   | Same engine, known bands, same scored IDs/weights    |
| Optional delivery fails snapshot job           | Medium     | High   | Separate guarded secondary phase                     |
| Alert lost after claim/process failure         | Low        | Medium | Accepted at-most-once trade-off; outbox out of scope |
| Payload rejected or visually misleading        | Medium     | Medium | Allowlisted, sanitized, bounded one-embed projection |
| Snapshot retention replays alerts              | Low        | High   | Dedicated state table independent of retention       |

### Integration Challenges

- Fire-and-forget tests need a deterministic seam or promise drain without using real webhooks.
- Insert the current report first, then select the greatest same-instance ID below the returned ID;
  tests must prove the compared persisted edge remains adjacent under overlapping inserts.
- Existing notification infrastructure findings must not silently broaden issue #223. Track verified
  secret/URL/accessibility gaps separately unless this feature changes their behavior.

### Security Considerations

#### Critical — Hard Stops

| Finding         | Risk | Required Mitigation                                          |
| --------------- | ---- | ------------------------------------------------------------ |
| None identified | —    | Reuse authenticated settings and existing manager boundaries |

#### Warnings — Must Address

| Finding                               | Risk                           | Mitigation                                            | Alternatives                         |
| ------------------------------------- | ------------------------------ | ----------------------------------------------------- | ------------------------------------ |
| Duplicate sends from non-atomic state | Alert storm                    | Atomic claim-before-send query                        | Transactional outbox is out of scope |
| Unbounded stored strings in Discord   | Rejection/spoofed presentation | Validate, strip controls, escape, and truncate fields | Minimal generic-only payload         |

#### Advisories — Best Practices

- Keep webhook URLs, raw provider errors, snapshot JSON, profiles, versions, paths, and secrets out of
  payloads and logs.
- Treat Discord as an external processor and disclose only the explicitly described operational
  metadata after per-service opt-in.
- Existing webhook URL validation/secret-storage gaps should be linked follow-up work rather than a
  health-specific transport fork.

## Task Breakdown Preview

### Phase 1: Pure policy and persistence

**Focus**: Make every decision deterministic and durable.

- Implement pure comparison, recovery, signature, contributor selection, and formatting tests.
- Add/register the state migration and atomic query module with database tests.
- Add deterministic predecessor lookup and overlapping-insert adjacency tests.

**Parallelization**: Pure policy and database migration/query work can proceed independently after
agreeing on the event/state interfaces.

### Phase 2: Event and job integration

**Focus**: Wire the proven policy into existing routing and snapshot ownership.
**Dependencies**: Phase 1 interfaces and persistence.

- Register the event constant/catalog entry.
- Integrate score → insert → persisted-predecessor read → assess → recover/claim → dispatch.
- Add job/manager integration tests for every acceptance boundary and delivery failure.

### Phase 3: Documentation and validation

**Focus**: Prove the issue end to end.

- Update `ROADMAP.md` and test aliases.
- Run `deno task test config-health`, `deno task test notifications`, `deno task check`, formatting,
  and focused migration/query validation.
- Manually repeat one eligible band regression and verify only the first unchanged state dispatches.

## Decisions Needed

No issue-blocking product decision remains. The design selects:

1. Fixed five-point same-band threshold.
2. Strict same-engine/same-scoring-basis comparability.
3. Atomic per-instance current-state claim before send.
4. Better-band or five-point recovery re-arming.
5. Deterministic raw-score-first contributor ranking.
6. At-most-once best-effort delivery with snapshot/job success taking precedence.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Discord and existing integration constraints.
- [research-business.md](./research-business.md): testable domain and workflow rules.
- [research-technical.md](./research-technical.md): architecture, schema, and exact integration points.
- [research-ux.md](./research-ux.md): opt-in, message, accessibility, and alert-fatigue guidance.
- [research-security.md](./research-security.md): severity-classified payload, dedup, and secret risks.
- [research-practices.md](./research-practices.md): reuse, KISS, and testability analysis.
- [research-recommendations.md](./research-recommendations.md): final decision synthesis and alternatives.
