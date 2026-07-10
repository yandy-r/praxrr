# Recommendations: Health Degraded Notifications

## Executive Summary

Implement issue #223 as a small extension of the persisted Config Health snapshot path and the
existing notification manager. Add `health.degraded` to the per-service event catalog, leave it
unchecked by default, and evaluate degradation only after the current snapshot is durable.

Use one fixed rule for the first release: notify on any worse-band transition, or on a **5-point
drop within the same band**. Compare only adjacent, strictly comparable snapshots for the same
instance. Claim a per-instance degraded-state signature atomically before dispatch; this provides
durable at-most-once episode deduplication across restarts and concurrent runs. Clear that state only
after a meaningful comparable recovery: a better band or a 5-point score gain. Unknown,
incomparable, and small improvements neither notify nor re-arm the episode.

Keep the message compact and factual: instance/app, previous and current score/band, signed change,
one primary contributor, and a Config Health detail path. Discord may show at most three ranked
contributors in one bounded embed. Notification evaluation, claim, rendering, and delivery are a
best-effort secondary effect; none may fail the snapshot item, batch, sweep, or scheduling state.

## Implementation Recommendations

### Trigger policy

- Export `HEALTH_DEGRADATION_MIN_SCORE_DROP = 5` from a pure health-degradation module. Do not add a
  setting or API field in this issue.
- A worse-band transition is meaningful even when the numeric drop is less than five points.
- A same-band transition is meaningful only when `previousScore - currentScore >= 5`.
- Compare the new snapshot only with its immediately preceding persisted snapshot. Do not accumulate
  several sub-threshold drops; accumulation makes alert timing dependent on retention and cadence.
- Improving, unchanged, `unknown`, malformed, or incomparable pairs never emit.

Five points is large enough to avoid one-point rollup churn, small relative to the 0–100 scale, and
easy to explain and test. A configurable threshold would add OpenAPI, validation, persistence, and UI
surface without evidence that users need different values yet.

### Comparability policy

A pair is comparable only when all of the following hold:

- both rows have the same non-null `arr_instance_id`, and it is the instance being processed;
- the previous row is selected deterministically by `datetime(generated_at) DESC, id DESC` before the
  current insert;
- both `engine_version` values are non-empty and equal;
- both bands are allowlisted measurable bands: `healthy`, `attention`, or `needs-review`;
- both overall scores are finite integers in `0..100`;
- criterion IDs are valid and unique; and
- the scored basis is identical: the same criterion IDs have numeric scores and the persisted weight
  for every criterion is unchanged.

Any failed check establishes a comparison boundary. The current row remains a valid persisted
baseline, but the pair emits nothing. Notification construction must consume persisted criterion
evidence only; it must not rescore or query mutable Arr/PCD state.

### Durable deduplication

Add a dedicated one-row-per-instance `config_health_notification_state` table rather than changing
append-only snapshots or relying on notification history. Store `arr_instance_id` as PK/FK,
`notified_signature`, `notified_at`, and bookkeeping timestamps. The state survives snapshot pruning
and cascades when a live instance is deleted.

The signature should represent the **current degraded state**, not a delivery or snapshot edge:

```text
health-degraded:v1 | instanceId | engineVersion | currentBand | currentScore |
sorted criterionId=currentScore (including null)
```

Exclude timestamps, snapshot IDs, names, labels, and previous values so the same degraded state does
not re-alert merely because it was sampled again. Include all criterion scores so materially changed
evidence produces a new signature.

Expose a single statement-atomic `claim(instanceId, signature, notifiedAt): boolean` implemented as
`INSERT ... ON CONFLICT DO UPDATE ... WHERE notified_signature <> excluded.notified_signature`.
Dispatch only when the statement affected a row. Claim **before** send. This intentionally chooses
at-most-once attempts: a crash or webhook failure after the claim may lose one alert, but retries and
overlapping runs cannot create a storm. Do not use a read-then-write check, in-memory set, snapshot
retention, or per-service notification history as the authority.

### Recovery semantics

- Clear notification state after a comparable better-band transition, regardless of point gain.
- Also clear after a comparable same-band gain of at least five points.
- Preserve state through sub-five-point improvements, unchanged results, `unknown`, malformed data,
  engine-version boundaries, and scored-basis changes.
- Recovery emits no notification. Once cleared, a later meaningful degradation may emit even if its
  signature matches a previously reported state.
- Continued worsening by another meaningful edge may emit once for its new current-state signature;
  this is new evidence, not repeat noise.

This symmetric five-point re-arm rule prevents 70 → 74 → 70 oscillation from repeatedly alerting,
while 70 → 75 → 70 represents a meaningful recovery and recurrence.

### Criterion ranking and message content

- Match criteria by ID using only the two persisted arrays.
- Primary candidates have numeric scores in both snapshots and `current < previous`.
- Sort by raw score drop descending, contribution drop descending, then canonical `CRITERION_IDS`
  order. Raw score change is primary because contribution can move when weights or availability move.
- Use the top candidate in generic/history text and at most the top three in the Discord embed.
- For each candidate, show label, previous/current score, signed delta, and at most the first current
  suggestion headline. Describe them as “contributors,” never proven causes.
- If no criterion declined, use the lowest current measurable criterion that has a suggestion,
  tie-breaking by contribution and canonical order. Label it “Current context,” not a contributor.
- If no safe context exists, state that no single criterion change was identified and link to detail.

Render `Healthy`, `Attention`, and `Needs review` in user copy while retaining canonical tokens in
structured data. Use `Config health decreased on {instanceName}` and the catalog label
`Config Health Decreased`. Build one warning embed, cap it below Discord limits, strip control/bidi
characters, escape user-controlled Markdown, and visibly truncate long values.

### Opt-in and failure isolation

- Register the exact ID once in server constants and once in the shared `Config Health` catalog.
  Existing and new service rows remain unchanged and therefore opted out.
- Do not add a global Config Health notification setting, backfill `enabled_types`, scan historical
  pairs when enabled, or add a public emission endpoint.
- Structure `snapshotInstance` as: read previous → score → insert current → enter a separate guarded
  notification phase. The successful insert remains the item success boundary.
- Catch assessment, state-claim, rendering, manager lookup, delivery, and history errors in the
  secondary phase. Log bounded IDs and reason codes; never raw snapshots, provider bodies, or secrets.
- Fire the already-claimed notification through `NotificationManager` without awaiting it into job
  success. Provider failures remain visible through existing notification history where possible.
- A claim failure suppresses dispatch and logs; it must not trigger snapshot backoff. Never roll back
  a snapshot or clear a claim because delivery failed.

## Technology Choices

- **Pure TypeScript policy module:** deterministic comparison, recovery, signature input, ranking,
  validation, and message DTOs are unit-testable without DB or network access.
- **SQLite latest-state table:** fits existing Kysely/raw-query conventions, supports a single atomic
  conditional upsert, and remains independent of retention.
- **Existing `NotificationManager` and builder:** preserve service enablement, event filtering,
  `Promise.allSettled` fan-out, Discord support, and history. Add no dependency or SDK.
- **Single Discord embed:** avoids the notifier's one-second inter-embed delay and reduces payload and
  rate-limit risk.
- **Relative detail path:** use `/config-health/{instanceId}` unless Praxrr already has a validated
  canonical public base URL; do not infer one from request headers in a background job.

## Phasing

1. **Domain policy:** implement and exhaustively test comparability, five-point trigger/recovery,
   signature canonicalization, criterion ranking, and bounded rendering.
2. **Persistence:** add/register the forward migration and atomic claim/get/clear query module; test
   uniqueness, conditional claims, restart durability, and instance-delete cascade.
3. **Integration:** add deterministic latest-snapshot lookup, insert-first orchestration, guarded
   claim-before-send, event constant/catalog entry, generic content, and one Discord embed.
4. **Hardening and validation:** test opt-in filtering, malformed persisted JSON, concurrency, delivery
   rejection, unknown/version/basis boundaries, and snapshot-job success; run `config-health`, a new
   `notifications` test alias, and `deno task check`.

## Quick Wins

- Adding the shared catalog entry automatically exposes the unchecked per-service option; no Svelte
  route or form change is required for basic opt-in.
- Reuse the compact drift/canary embed conventions and existing notification history.
- Add `getLatest(instanceId)` instead of loading a full trend.
- Add a `notifications` alias in `scripts/test.ts` so issue #223's documented test plan is executable.

## Improvement Ideas

- Render notification type descriptions and improve the reusable event-picker checkbox's accessible
  name, keyboard behavior, and target size in a focused UI follow-up.
- Sanitize notification-list DTOs so database `config` and webhook tokens never reach page data; this
  existing secret-exposure finding should be fixed before release if confirmed by a regression test.
- Add shared Discord URL validation and secret encryption as notification-infrastructure work, not a
  health-only transport fork.
- Later collect alert-volume evidence before considering configurable thresholds, retries, recovery
  notifications, absolute links, or acknowledgements.

## Risk Assessment

| Risk                                          | Level  | Mitigation                                                                                                                        |
| --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate storms from concurrent/retried work | High   | Atomic conditional claim before send; unique per-instance row                                                                     |
| False regression after policy/settings change | High   | Engine, known-band, score, scored-set, and weight comparability                                                                   |
| Snapshot job failure due to optional delivery | High   | Separate no-throw secondary phase; never await into job outcome                                                                   |
| Webhook secret exposed by settings loader     | High   | Explicit sanitized DTO and regression test before release                                                                         |
| Discord rejection/spoofed presentation        | Medium | One allowlisted, escaped, bounded embed; no raw JSON/errors                                                                       |
| Lost alert after claim or process crash       | Medium | Accepted at-most-once trade-off; outbox deferred                                                                                  |
| Alert fatigue from oscillation                | Medium | Five-point trigger and symmetric recovery re-arm                                                                                  |
| Operational metadata disclosed to Discord     | Medium | Explicit opt-in and minimal payload; omit profiles/paths/versions                                                                 |
| Signature collision                           | Low    | Prefer a stable SHA-256 hex digest if readily available; otherwise store the canonical string, not a small non-cryptographic hash |

## Alternative Approaches with pros/cons/effort

| Approach                                       | Pros                                                        | Cons                                                                 | Effort               |
| ---------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- | -------------------- |
| Per-instance current-state claim (recommended) | Durable, atomic, retention-safe, supports recovery episodes | At-most-once can lose an alert after claim                           | Medium               |
| Unique snapshot-edge ledger                    | Excellent audit trail and exact retry dedup                 | Can re-alert after tiny recovery; grows indefinitely; needs pruning  | Medium               |
| Signature column on snapshots                  | Event evidence colocated                                    | Mixes mutable delivery with immutable history; pruning replays state | Medium               |
| Notification-history dedup                     | No new table                                                | Per-service, delivery-oriented, races, breaks prospective semantics  | Low but incorrect    |
| In-memory set                                  | Trivial                                                     | Lost on restart and ineffective across overlap                       | Low but unacceptable |
| Transactional outbox                           | Recoverable delivery and clear audit                        | Requires worker/retry/idempotency redesign beyond issue scope        | High                 |
| Band changes only                              | Very low noise and simple                                   | Misses meaningful within-band regressions required by the goal       | Low                  |
| Configurable threshold now                     | Flexible                                                    | Expands API/DB/UI/testing with no usage evidence                     | High                 |

## Task Breakdown Preview

1. Add pure degradation policy/types and focused unit tests.
2. Add notification-state migration and atomic query tests.
3. Add deterministic latest-snapshot query and tie-break tests.
4. Add server event constant, shared catalog entry, and bounded health notification builder.
5. Integrate persisted comparison and claim-before-send into `snapshotInstance` behind a no-throw
   boundary.
6. Add job/manager integration tests for first baseline, band drop, five-point same-band drop,
   duplicate suppression, continued worsening, meaningful recovery, unknown/version/basis mismatch,
   disabled service, concurrent claim, and delivery failure.
7. Add the notifications test alias, run issue commands, and manually repeat one band regression.

## Key Decisions Needed

All issue-blocking decisions can be resolved now:

- **Threshold:** fixed five points for same-band decline; any worse band alerts.
- **Comparability:** adjacent persisted snapshots, same instance/engine/scored set/weights, valid known
  bands and scores.
- **Dedup:** per-instance current-state signature, claimed atomically before send.
- **Recovery:** better band or five-point same-band gain clears; uncertainty and tiny gains preserve.
- **Ranking:** raw criterion score drop, contribution drop, canonical order; one generic/top three rich.
- **Failure contract:** at-most-once best effort; snapshot persistence and job outcome always win.

## Open Questions

- Confirm whether the existing notification-list webhook-secret exposure is fixed in #223 or must be
  a release-blocking linked issue.
- Confirm the supported Discord webhook hostnames before enforcing a shared dispatch-time allowlist;
  strict validation may affect proxy-compatible existing installations.
- Decide whether to use a SHA-256 signature or store the bounded canonical signature directly. Avoid
  FNV-1a for an atomic dedup authority because collision behavior is unnecessary risk.
- Confirm whether the reusable checkbox accessibility fix belongs in this issue or a linked follow-up;
  it does not block the event catalog integration itself.
