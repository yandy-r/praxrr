# Architecture Analysis: Health Degraded Notifications

## Executive Summary

Implement `health.degraded` as a post-persistence extension of the existing
`config-health.snapshot` job. For each instance, read the latest persisted snapshot, compute and
insert the new report, then run a separately guarded degradation phase that compares the adjacent
persisted pair, clears state on meaningful recovery, or atomically claims a new degraded-state
signature before dispatching through `NotificationManager`.

The durable state must live in a dedicated per-instance table, not in append-only snapshots or
process memory. This makes deduplication survive restart and retention pruning, while the conditional
SQLite upsert prevents overlapping workers from dispatching the same signature twice. The comparison,
signature, contributor selection, and payload projection belong in one deterministic health-domain
module; database ownership remains in query modules and provider routing remains unchanged. This
worktree is already established; no worktree or branch setup is needed.

## Architecture Context

### System structure

- **Scoring domain:** `$shared/health` defines `HealthReport`, `HealthBand`, `CriterionResult`,
  `CRITERION_IDS`, engine versioning, weights, and band thresholds. Degradation logic consumes these
  persisted shapes but does not alter scoring.
- **Snapshot ownership:** `configHealthSnapshot.ts` is the only scheduled/manual job path that writes
  `config_health_snapshots`; `scoreInstance()` remains read/compute-only.
- **Persistence:** `configHealthSnapshotsQueries` owns immutable history. A new
  `configHealthNotificationState` query module owns mutable claim state using single-statement SQL.
- **Notification routing:** the fluent builder creates generic and Discord projections;
  `NotificationManager` selects enabled services whose parsed `enabled_types` explicitly contains
  the event ID, dispatches providers with `Promise.allSettled`, and writes per-service history.
- **Settings UI:** create/edit actions and `NotificationServiceForm.svelte` derive available event IDs
  from the shared catalog, so adding one catalog row exposes the opt-in without route or component
  changes.

### Data flow

```text
config-health.snapshot
  -> getLatest(instanceId)                         previous persisted evidence
  -> scoreInstance(instanceId)
  -> insert(report)                                primary success boundary
  -> guarded post-insert phase
       -> assess(previous, current)
          -> incomparable / quiet                  preserve notification state
          -> meaningful recovery                   clear(instanceId)
          -> meaningful degradation
               -> build stable current-state signature
               -> claim(instanceId, signature)     one conditional UPSERT
               -> claimed only: build event + dispatch health.degraded
  -> return the existing per-instance/sweep result regardless of secondary failure
```

`getLatest()` must run before insertion and order by `datetime(generated_at) DESC, id DESC`; the ID
tie-break makes equal generation timestamps deterministic. Assessment runs only after `insert()`
succeeds. The first snapshot is baseline-only.

Comparability is intentionally stricter than matching instance IDs: both rows must refer to the same
non-null instance, have the same non-empty engine version, known bands, finite integer scores in
`0..100`, and identical scored criterion ID/weight sets. JSON parse fallbacks currently produce empty
arrays, so the domain module must validate parsed criteria rather than trusting storage casts.

Band order is `healthy` -> `attention` -> `needs-review`; `unknown` is never ordered. A worse band or
same-band drop of at least `HEALTH_DEGRADATION_MIN_SCORE_DROP = 5` degrades. A better band or same-band
gain of at least five clears state. All other outcomes preserve state and emit nothing.

### Integration points

- Add `NotificationTypes.HEALTH_DEGRADED` and use that constant at dispatch.
- Add the `health.degraded` row to the shared notification catalog. Existing create/edit filtering
  keeps it off until a user explicitly selects it; do not backfill `enabled_types`.
- Build one bounded warning embed plus meaningful generic title/message so notification history is
  useful. Generic text uses the top contributor; Discord includes at most three and links to
  `/config-health/{instanceId}`.
- Keep `NotificationManager`, `DiscordNotifier`, notification service queries, settings routes/UI,
  OpenAPI, and generated API types unchanged.

## Critical Files Reference

| File                                                                                                   | Required responsibility                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/health/degradation.ts`                                             | New deterministic validation, comparability, trigger/recovery policy, canonical signature, contributor ranking, `HealthDegradedEvent`, and bounded generic/Discord projection helpers. |
| `packages/praxrr-app/src/lib/server/db/migrations/20260719_create_config_health_notification_state.ts` | New one-row-per-instance state table with PK/FK cascade, non-empty signature, claim timestamp, and bookkeeping timestamps.                                                             |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`                                                  | Import and register migration `20260719` after `20260717`.                                                                                                                             |
| `packages/praxrr-app/src/lib/server/db/queries/configHealthNotificationState.ts`                       | New `claim`, `clear`, and diagnostic `get`; `claim` is one conditional `INSERT ... ON CONFLICT DO UPDATE ... WHERE` and returns `db.execute(...) > 0`.                                 |
| `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`                               | Add instance-scoped deterministic `getLatest()` using descending generated time plus ID.                                                                                               |
| `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`                             | Own previous-read -> score -> insert -> guarded assessment -> clear/claim -> dispatch ordering while preserving the never-throw per-instance contract.                                 |
| `packages/praxrr-app/src/lib/server/notifications/types.ts`                                            | Add the server event constant.                                                                                                                                                         |
| `packages/praxrr-app/src/lib/shared/notifications/types.ts`                                            | Add label `Config Health Decreased`, category `Config Health`, and concise opt-in description.                                                                                         |
| `packages/praxrr-app/src/tests/shared/health/degradation.test.ts`                                      | New exhaustive pure policy, malformed input, signature stability/sensitivity, ranking, and payload-bound tests.                                                                        |
| `packages/praxrr-app/src/tests/db/configHealthNotificationState.test.ts`                               | New migration, insert/update/no-op claim, clear, and instance-cascade coverage.                                                                                                        |
| `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`                                       | Extend with latest-row scoping, descending order, and equal-time ID tie-break tests.                                                                                                   |
| `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`                                      | Extend with baseline, eligible edges, suppression, recovery re-arm, repeat/overlap dedup, explicit Arr type, and delivery-failure isolation.                                           |
| `scripts/test.ts`                                                                                      | Include new tests in `config-health`; add a `notifications` alias covering catalog/manager or focused notification integration tests.                                                  |
| `ROADMAP.md`                                                                                           | Record issue #223 delivery without changing runtime contracts.                                                                                                                         |

## Cross-Cutting Concerns

### Atomicity and concurrency

- Do not wrap `snapshotInstance()` or the claim path in `db.transaction()`. `processBatches()` runs
  three instance processors through `Promise.all` on the shared SQLite connection, where nested
  `BEGIN` calls are not re-entrant.
- Snapshot insert, recovery delete, and conditional claim are independently statement-atomic.
- Claim occurs before dispatch. A successful claim followed by process/provider failure intentionally
  loses that attempt; this is the specified at-most-once contract, not a retry/outbox workflow.
- State identity excludes timestamps, snapshot IDs, labels, names, and display text. Include versioned
  prefix, instance ID, engine version, current band/score, and every current criterion ID/score in
  `CRITERION_IDS` order, preserving `null`; use canonical text or SHA-256, never a small hash.

### Failure isolation and observability

- Keep scoring/insertion in the existing outer per-instance guard. Place all assessment, state, render,
  manager, provider, history, and secondary logging work in a post-insert no-throw guard so none can
  fail siblings, sweep progress, scheduling, or job backoff.
- Preserve meaningful generic title/message because history reads those fields. Do not add health-
  specific history storage or retry state.
- Test through an injected or replaceable dispatch seam; avoid real webhooks and avoid timing-only
  fire-and-forget assertions.

### Contract and domain fidelity

- Preserve the snapshot's explicit `radarr`, `sonarr`, or `lidarr` in the event. Do not infer an Arr
  type or reuse sibling semantics.
- The scoring engine version and exact scored criterion weights form the comparison basis. Engine or
  criterion availability/config changes are quiet boundaries and do not clear a prior claim.
- No public HTTP/OpenAPI contract changes are required. The shared notification catalog is the sole
  settings-facing contract for event selection.

### Payload safety and UX

- Bound and sanitize instance names, labels, details, and suggestion text; strip control characters
  and remain below Discord title, field, field-count, and total embed limits.
- Carry previous/current score and human-readable band, signed delta, degradation kind, observed time,
  and details path in text. Warning color is supplemental.
- Rank measurable declined criteria by raw score drop, then contribution drop, then `CRITERION_IDS`.
  If none declined, use the lowest current measurable criterion or explicit no-single-criterion copy.
- Never include webhook URLs, provider errors, raw snapshot JSON, profiles, or secrets in payloads.

## Parallelization Opportunities

1. **Batch A — independent foundations:**
   - Implement and test `degradation.ts`.
   - Implement migration/state queries and database tests.
   - Add `getLatest()` and its focused tests.
   - Add notification constant/catalog entry and catalog tests.
2. **Batch B — integration after Batch A interfaces settle:** update the snapshot handler and job
   tests using the final assessment result, event, and query contracts.
3. **Batch C — closeout after integration:** update aliases and roadmap, then run focused suites,
   type checks, formatting checks, and the full relevant regression set.

Keep concurrent implementors file-disjoint. The handler integration depends on both the domain and
state-query contracts; migration registration and shared test aliases should have one owner to avoid
merge contention.

## Implementation Constraints

- Work only in the already-created feature worktree; no new worktree setup is required.
- Preserve Svelte 5/no-runes and repository formatting conventions; no Svelte change is expected.
- Persist the current snapshot before assessment, and never notify from live reports without the
  corresponding successful row.
- Compare only the immediate deterministic predecessor; do not accumulate sub-five-point drops and
  do not replay historical pairs when a service opts in.
- Unknown, malformed, cross-engine, changed-basis, unchanged, improving-below-recovery-threshold, and
  degrading-below-trigger-threshold pairs are quiet and preserve claim state.
- Recovery is silent and only meaningful comparable improvement clears state.
- `config_health_notification_state` uses `arr_instance_id` as its sole required index and cascades on
  instance deletion; it remains independent of snapshot retention.
- The manager remains the service router. Do not call `DiscordNotifier` directly or bypass explicit
  `enabled_types` filtering and per-service history.
- Do not add thresholds, global enablement, backfill, retries, an outbox, endpoint/schema changes, new
  providers, packages, or cross-Arr fallbacks.
- Required validation should include `deno task test config-health`, `deno task test notifications`,
  `deno task check`, and formatting/lint checks appropriate to the touched files.
