# Engineering Practices Research: `health.degraded` Notifications

## Executive Summary

The smallest complete solution is to extend the existing config-health snapshot path rather than
introduce a second job, event bus, notification manager, or general-purpose alert framework.
`packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts` already owns the only
successful score-and-persist transition. After `scoreInstance(instanceId)` returns a measurable
report and `configHealthSnapshotsQueries.insert(report)` succeeds, it should compare that report
with the immediately previous persisted snapshot for the same instance, build a
`health.degraded` notification when a pure degradation predicate says it is meaningful, and send
through the existing `notify(...).send()` path without awaiting delivery into job success.

Keep three concerns separate:

1. `configHealthSnapshotsQueries` retrieves the prior persisted evidence efficiently.
2. A small health-domain module makes the previous/current degradation decision and selects
   actionable criterion context without database or network access.
3. The snapshot handler orchestrates persistence and best-effort notification delivery.

The existing drift implementation in
`packages/praxrr-app/src/lib/server/sync/drift/persist.ts` is useful precedent for a pure
`shouldNotify` predicate, bounded Discord detail, and failure isolation. Its durable
`notified_signature` state should **not** be copied yet: health snapshots are append-only and the
immediately previous snapshot naturally suppresses an identical repeat. A new state table would
add migration, lifecycle, cleanup, and recovery semantics that issue #223 does not require.

The event must be opt-in. Existing notification services already store explicit event IDs in
`notification_services.enabled_types`, so they will not receive a newly introduced ID. For new
services, however, the create/edit routes currently interpret an empty selection as every
registered event. Add a small default-selection policy to
`packages/praxrr-app/src/lib/shared/notifications/types.ts` so `health.degraded` is discoverable in
the form but excluded from implicit defaults.

## Existing Reusable Code

| Existing code                                                                                                                                                                            | Reuse for issue #223                                                                                                                      | Practice recommendation                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshotInstance()` in `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`                                                                                       | The single score/persist orchestration point for scheduled and manual snapshots                                                           | Extend this function after a successful insert; do not create a parallel health-alert job or duplicate scoring.                       |
| `configHealthSnapshotsQueries.insert()` and `ConfigHealthSnapshotDetail` in `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`                                     | Persisted score, band, criteria, instance name/type, and timestamps needed by the event                                                   | Add one narrowly named latest-snapshot lookup. Do not call unbounded `getTrend()` merely to read one prior row.                       |
| `HealthReport`, `HealthBand`, and `CriterionResult` from `packages/praxrr-app/src/lib/shared/health/index.ts`                                                                            | Typed current evidence and criterion context                                                                                              | Accept these domain types in the pure comparator; avoid a second notification-only copy of the health model.                          |
| `shouldNotify()` in `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`                                                                                                           | Precedent for a pure, directly unit-testable notification decision                                                                        | Mirror the pattern, not the entire drift persistence design. Health and drift have different state models.                            |
| `buildDriftNotification()` in `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`                                                                                                 | Precedent for generic fallback text, a bounded Discord embed, instance identity, details link, warning color, and non-judgmental language | Use the builder primitives and bounded-detail convention; do not reuse drift vocabulary or payload types.                             |
| `notify()`, `createEmbed`, `Colors`, and `getInstanceIcon` in `packages/praxrr-app/src/lib/server/notifications/builder.ts`                                                              | Existing transport-neutral generic payload plus Discord rendering                                                                         | Build `health.degraded` with these primitives and send through `NotificationManager`; do not call `DiscordNotifier` directly.         |
| `NotificationManager.notify()` in `packages/praxrr-app/src/lib/server/notifications/NotificationManager.ts`                                                                              | Filters enabled services by exact event ID, fans out with `Promise.allSettled`, records delivery history, and contains transport errors   | Reuse unchanged. The snapshot job should not add transport-specific retries or duplicate history writes.                              |
| `notificationTypes`, `getAllNotificationTypeIds()`, and `groupNotificationTypesByCategory()` in `packages/praxrr-app/src/lib/shared/notifications/types.ts`                              | Drives settings validation and grouped checkbox rendering                                                                                 | Register `health.degraded` here under a Health category and add explicit default-selection metadata/helper for opt-in behavior.       |
| `NotificationServiceForm.svelte` in `packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte`                                                    | Automatically renders registered event types                                                                                              | No health-specific component is needed; registry metadata should be sufficient.                                                       |
| Create/edit actions in `packages/praxrr-app/src/routes/settings/notifications/new/+page.server.ts` and `packages/praxrr-app/src/routes/settings/notifications/edit/[id]/+page.server.ts` | Validate submitted IDs and persist `enabled_types`                                                                                        | Preserve allow-list validation, but use default-enabled IDs rather than every ID when the selection is empty.                         |
| `NotificationTypes` in `packages/praxrr-app/src/lib/server/notifications/types.ts`                                                                                                       | Server-side canonical event-name constants                                                                                                | Add `HEALTH_DEGRADED` for parity with `DRIFT_DETECTED`; avoid scattering a new magic string across orchestration and tests.           |
| `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`                                                                                                                        | Existing migrated-database harness and registered-handler coverage                                                                        | Add handler integration cases here for first snapshot, degradation, repeat, improvement, unmeasurable result, and delivery isolation. |
| `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`                                                                                                                         | Existing query tests using real migrations and valid Arr-instance foreign keys                                                            | Test the new prior/latest lookup here, including deterministic `generated_at, id` ordering.                                           |
| `packages/praxrr-app/src/tests/sync/drift/persist.test.ts`                                                                                                                               | Examples of pure predicate tests and draining a fire-and-forget notification chain                                                        | Reuse the testing approach, but keep health fixtures and assertions in health/config-health test files.                               |

## Modularity Design

Recommended dependency flow:

```text
configHealthSnapshot.ts
  -> scoreInstance()
  -> configHealthSnapshotsQueries.getLatest(instanceId)
  -> configHealthSnapshotsQueries.insert(report)
  -> evaluateHealthDegradation(previous, report)
  -> buildHealthDegradedNotification(...)
  -> notify('health.degraded').send()  [best effort]
```

Use a small module such as
`packages/praxrr-app/src/lib/server/health/degradation.ts` for the pure decision and criterion
selection. It should not import `db`, `logger`, job types, or notifier implementations. Its public
surface only needs `evaluateHealthDegradation(previous, current): HealthDegradation | null`.

The orchestration should read the prior row before insertion, insert the current report, then
evaluate and send. Reading before insertion avoids ambiguous “latest two” handling, while the
successful insert remains the gate: never emit if persistence fails. The current `HealthReport`
contains exactly the values written by `insert()`, so the comparison is still derived from the
persisted transition rather than an independent live calculation.

Keep notification formatting in the same module or a feature-specific
`packages/praxrr-app/src/lib/server/notifications/definitions/health.ts`; do not create a generic
alert-template hierarchy or refactor unrelated definitions in this issue.

## Shared vs Feature-Specific

Shared changes should be limited to the notification event catalog and type constant:

- Add the `health.degraded` ID, label, category, description, and opt-in/default metadata to
  `packages/praxrr-app/src/lib/shared/notifications/types.ts`.
- Add `HEALTH_DEGRADED` to
  `packages/praxrr-app/src/lib/server/notifications/types.ts`.
- Add a registry-derived helper such as `getDefaultNotificationTypeIds()` because both create and
  edit actions need the same default policy.

Everything else is feature-specific:

- Health band ordering and meaningful score-drop policy belong with health degradation logic.
- Criterion selection and health wording belong with the health event builder.
- Prior-snapshot lookup belongs with `configHealthSnapshotsQueries`.
- Trigger timing and error isolation belong in `configHealthSnapshot.ts`.

Do not place health thresholds in the generic notification manager. `NotificationManager` should
continue answering only “which services receive this already-decided event?” It should not answer
“did health degrade?”

## KISS Assessment

The KISS implementation adds one event catalog entry, one server event constant, one latest-row
query, one pure evaluation function, one compact builder, and one orchestration call. It requires
no new package and, if dedup is defined against consecutive persisted snapshots, no migration.

Prefer a simple explicit `Record<HealthBand, number>` rank map over lexical or clever ordering.

A lower score alone should not automatically alert unless the product defines a minimum meaningful
delta. Health scores can fluctuate within a band; notifying for every one-point change conflicts
with the issue's noise constraint. The lowest-risk initial rule is:

- alert on a worse band;
- optionally alert on a same-band decrease only when it meets one named constant/policy threshold;
- never alert without a previous measurable snapshot;
- never alert when the score/band is unchanged or improving.

Do not add user-configurable thresholds, cooldowns, retry queues, acknowledgement state, recovery
events, or multiple health event variants in this issue. None is required for the stated
acceptance criteria.

## Abstraction vs Repetition

Apply the rule of three conservatively:

- Do not generalize drift's `shouldNotify()` into a universal notification-dedup abstraction.
  Drift compares content signatures and persists recovery state; health compares ordered snapshots.
  They share a shape, not semantics.
- Do not add a general event-bus interface around `notify()`. The builder and manager already form
  the project boundary.
- Do not add a general repository base class for snapshot queries. One SQL query is clearer.
- Do add `getDefaultNotificationTypeIds()` rather than repeating
  `notificationTypes.filter(...).map(...)` in both create and edit routes. The default-enabled
  policy has one source of truth and already has two consumers.
- A few repeated health fields in generic text and a Discord embed are acceptable. Extract a
  formatter only if a third transport or event needs the same formatting.

## Interface Design

The degradation evaluator should return a discriminated result (`HealthDegradation | null`) rather
than multiple booleans. That keeps the job branch simple and ensures the builder receives only an
eligible event. Its inputs should be readonly domain data, and its output should contain just the
evidence required by the event.

The user-facing payload should include:

- instance ID, name, and Arr type;
- previous and current scores;
- previous and current bands;
- a bounded list of the most actionable worsened/currently failing criterion results;
- a details path such as `/config-health/{instanceId}`;
- generated timestamp from the current report.

Generic title/message should remain transport-neutral and non-judgmental, for example “Config
health changed for `<instance>`” and “Score changed from 82 (healthy) to 68 (attention).” Discord
can add a warning-colored embed and criterion lines. Avoid language such as “bad,” “broken,” or
“unhealthy,” because the issue explicitly asks for non-judgmental wording.

`notify(...).send()` currently resolves after `NotificationManager.notify()` contains delivery
errors; the snapshot handler should still invoke it as best effort (`void ...catch(...)`) so future
manager behavior cannot accidentally make snapshot persistence fail. The handler must not mark the
job failed because Discord is unavailable.

## Testability Patterns

Test the pure evaluator exhaustively without database or webhook setup:

- no previous snapshot -> `null`;
- worse band -> degradation result with exact previous/current evidence;
- unchanged band and score -> `null`;
- improving score or band -> `null`;
- same-band score decrease below the agreed threshold -> `null`;
- same-band score decrease at/above the agreed threshold -> one result, if score-only alerts are
  included;
- actionable criteria are deterministic and bounded.

Add real-database query tests to
`packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts` for the new latest lookup. Assert
that it is instance-scoped and deterministic when timestamps tie by using the existing
`generated_at` then `id` ordering convention.

Add job-level tests to
`packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts` for observable behavior:

- first measurable snapshot persists but does not notify;
- a meaningful regression after a prior snapshot emits once;
- the next identical degraded snapshot does not emit again;
- an improving snapshot does not emit;
- `scoreInstance()` returning `null` or throwing does not emit;
- a rejected notification promise does not change the handler's success result or prevent the
  snapshot row from remaining persisted.

Avoid asserting private builder internals. Capture the built notification at the
builder/manager boundary and assert the event ID plus exact evidence fields. Follow
`packages/praxrr-app/src/tests/sync/drift/persist.test.ts` when a test must drain the
fire-and-forget promise chain, but expose an injectable send dependency in the health orchestration
if module stubbing becomes brittle. A tiny dependency parameter is preferable to sleeps or global
network mocks.

Add registry/default-policy tests near notification tests (or a focused shared test) asserting:

- `isValidNotificationType('health.degraded')` is true;
- the event appears in the Health group;
- `getDefaultNotificationTypeIds()` excludes it;
- an explicit submitted selection preserves it.

## Build vs Depend

Build this feature entirely with repository-native code:

- ordered band comparison is a few typed lines;
- score-delta comparison is basic arithmetic;
- criterion selection is array filtering/sorting/slicing;
- the existing notification manager handles transport fan-out, filtering, history, and failure
  containment;
- SQLite already persists the evidence and explicit service selections.

No external dependency is justified. A rules engine, event bus, hash library, queue package, or
notification SDK would increase supply-chain and maintenance cost without reducing meaningful
implementation complexity. If a stable degradation signature is later needed, deterministic
string construction from instance/band/score/criterion IDs is sufficient; do not add a hashing
dependency for a non-security dedup key.

## Open Questions

1. What exact same-band score decrease is “meaningful”? The issue says “band or score degradation”
   but provides no threshold. Recommend band regression as mandatory and a single named constant
   for same-band score alerts only after product confirms the delta.
2. Which criterion states count as actionable, and how should ties be ordered? Reuse the semantics
   already encoded by `CriterionResult` and health criteria policy; recommend newly failed/worsened
   criteria first, then stable catalog order.
3. Should a failed delivery be retried? Current `NotificationManager` records failures and contains
   them, while consecutive-snapshot dedup treats the event as an attempted alert. Recommend no
   feature-specific retry in #223; a general retry policy belongs in a separate notification issue.
4. Should an identical degradation re-alert after recovery? Consecutive comparison naturally does:
   recovery/improvement produces no event, and a later regression is a new transition. Recommend
   this behavior and cover it explicitly in tests.
5. Does “opt-in” mean excluded only for existing services, or also excluded from defaults for newly
   created services? Recommend both. Existing rows remain unchanged, and the new default-selection
   helper prevents implicit enrollment for new/empty configurations.
6. Should manual snapshots emit notifications? Because scheduled and manual paths both use
   `snapshotInstance()`, the smallest consistent behavior is yes. If manual runs are intended as
   silent diagnostics, that must be an explicit product rule passed into the orchestration rather
   than inferred from job source.
