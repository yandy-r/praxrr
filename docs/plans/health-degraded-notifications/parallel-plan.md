# Health Degraded Notifications Implementation Plan

Implement issue #223 as a post-persistence extension of the existing Config Health snapshot job.
Four file-disjoint foundation tasks establish pure degradation policy, durable atomic claim state,
deterministic predecessor lookup, and the opt-in event contract; one convergence task then wires
those contracts into the snapshot handler behind a no-throw secondary boundary. The implementation
uses a fixed five-point same-band threshold, strict persisted-basis comparability, claim-before-send
at-most-once attempts, and the existing notification manager. Work is already isolated in the
`feat/223-health-degraded-notifications` worktree; do not create another worktree.

## Critically Relevant Files and Documentation

- `docs/plans/health-degraded-notifications/feature-spec.md`: Approved issue requirements,
  architecture, schema, trigger/recovery policy, payload, and validation contract.
- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`: Sole scheduled/manual
  score-and-persist owner and final integration point.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: Append-only snapshot
  serialization/parsing and home for the predecessor lookup.
- `packages/praxrr-app/src/lib/server/db/migrations/20260714_create_config_health_tables.ts`:
  Existing snapshot/settings schema conventions and timestamp/FK policy.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`: Static migration registry; this feature uses
  `20260719` after main's `20260718` migration.
- `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`: Closest notification, signature,
  recovery, and compact embed precedent; do not copy its post-send mark race.
- `packages/praxrr-app/src/lib/server/db/queries/driftStatus.ts`: Statement-atomic latest-state query
  precedent.
- `packages/praxrr-app/src/lib/server/notifications/builder.ts`: Generic plus Discord payload builder.
- `packages/praxrr-app/src/lib/server/notifications/NotificationManager.ts`: Exact event filtering,
  parallel provider delivery, failure containment, and history recording.
- `packages/praxrr-app/src/lib/shared/notifications/types.ts`: Settings-facing event catalog source.
- `packages/praxrr-app/src/lib/shared/health/types.ts`: Engine version, band, criterion, Arr, and
  report contracts.
- `packages/praxrr-app/src/lib/shared/health/policy.ts`: Canonical health band thresholds/order
  context; degradation logic must not duplicate scoring.
- `packages/praxrr-app/src/lib/server/pcd/snapshots/fingerprint.ts`: Existing Web Crypto SHA-256 hex
  pattern for stable signatures.
- `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`: Migrated job test harness and
  existing snapshot-job assertions.
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`: Real migration/query test pattern.
- `scripts/test.ts`: Test alias registry that must expose both issue commands.
- `docs/site/src/content/docs/app/notifications.md`: User/developer notification behavior guide.
- `docs/site/src/content/docs/app/jobs.md`: Job handler and failure/reschedule guide.
- `docs/site/src/content/docs/app/testing.md`: Supported test command guide.
- `ROADMAP.md`: Config Health delivery history and #223 follow-up tracking.

## Implementation Plan

### Phase 1: Parallel Foundations

#### Task 1.1: Implement pure degradation policy and bounded event projection Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/health-degraded-notifications/feature-spec.md`
- `packages/praxrr-app/src/lib/shared/health/types.ts`
- `packages/praxrr-app/src/lib/shared/health/policy.ts`
- `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`
- `packages/praxrr-app/src/lib/server/pcd/snapshots/fingerprint.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/health/degradation.ts`
- `packages/praxrr-app/src/tests/shared/health/degradation.test.ts`

Create an I/O-free degradation module with an exported
`HEALTH_DEGRADATION_MIN_SCORE_DROP = 5` and a discriminated result for incomparable, quiet,
recovery, and degradation outcomes. Validate same instance/Arr type, non-empty matching engine
version, known bands, integer scores in `0..100`, unique canonical criterion IDs, identical scored
criterion sets, and identical weights. A worse band or same-band drop of at least five degrades; a
better band or same-band gain of at least five recovers; all other pairs preserve state.

Build the signature by SHA-256 hashing UTF-8 bytes of
`JSON.stringify(['health-degraded:v1', instanceId, engineVersion, currentBand, currentScore,
criteria.map(({ id, score }) => [id, score])])`, with criteria in `CRITERION_IDS` order and `null`
preserved. Exclude timestamps, snapshot IDs, display text, and previous values. Rank contributor context by raw
score drop, contribution drop, then canonical order. Produce transport-neutral event data and one
bounded, sanitized warning embed projection with explicit Previous, Current, Change, App, contributor,
time, and `/config-health/{instanceId}` evidence. Normalize CRLF, strip C0/C1 and bidi controls,
escape Discord Markdown, then visibly truncate. Enforce named limits: title 256, field name 256,
field value 1,024, at most 25 fields, at most three contributors, and a conservative 5,500-character
total embed budget below Discord's 6,000 limit. Never include raw JSON, profiles, URLs, provider
errors, or secrets.

Test exact threshold/band boundaries, first/unknown/malformed/cross-engine/changed-basis suppression,
recovery, non-accumulation, signature stability/sensitivity, contributor/fallback ordering, explicit
Radarr/Sonarr/Lidarr fidelity, safe truncation, and payload limits.

Validate this task with
`deno test packages/praxrr-app/src/tests/shared/health/degradation.test.ts --allow-read --allow-env`.

#### Task 1.2: Add the per-instance notification-state migration Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/health-degraded-notifications/feature-spec.md`
- `packages/praxrr-app/src/lib/server/db/migrations/20260714_create_config_health_tables.ts`
- `packages/praxrr-app/src/lib/server/db/migrations/20260717_create_webauthn_tables.ts`
- `packages/praxrr-app/src/lib/server/db/migrations/20260718_widen_quality_goal_bindings_arr_type.ts`
- `packages/praxrr-app/src/lib/server/db/migrations.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/db/migrations/20260719_create_config_health_notification_state.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/db/migrations.ts`

Create and register reversible migration `20260719` after `20260718`. The state table has an
instance PK/FK, a positive monotonic `last_snapshot_id`, nullable signature/time/notification-ID
tombstone fields with paired constraints, and bookkeeping timestamps. Also add the snapshot
predecessor index on `(arr_instance_id, id DESC)`. Snapshot IDs are ordering values, not FKs, so
retention cannot erase dedup authority.

#### Task 1.3: Add deterministic persisted-predecessor retrieval Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`
- `packages/praxrr-app/src/lib/server/db/migrations/20260714_create_config_health_tables.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`
- `packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`

Add `getPrevious(instanceId, currentSnapshotId)` using the existing row mapper and a one-row query
constrained to `arr_instance_id = ? AND id < ?`, ordered by `id DESC`. Return `undefined` for no
baseline. Add migrated-database tests proving empty state, strict instance scoping, immediate append-
order predecessor selection, overlapping-insert adjacency, and criteria/profile parsing. Do not call
`getTrend()` or infer adjacency from `generated_at`.

#### Task 1.4: Register the opt-in event contract Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/notifications/types.ts`
- `packages/praxrr-app/src/lib/shared/notifications/types.ts`
- `packages/praxrr-app/src/routes/settings/notifications/components/NotificationServiceForm.svelte`
- `packages/praxrr-app/src/routes/settings/notifications/new/+page.server.ts`
- `packages/praxrr-app/src/routes/settings/notifications/edit/[id]/+page.server.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/notifications/manager.test.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/notifications/types.ts`
- `packages/praxrr-app/src/lib/shared/notifications/types.ts`

Add `NotificationTypes.HEALTH_DEGRADED = 'health.degraded'` and the shared catalog row labeled
`Config Health Decreased` in category `Config Health`, with non-judgmental opt-in copy. Test catalog
lookup, validation, and grouping; create the new `src/tests/notifications/` directory. In the same
migrated test file, create all three routing cases: disabled/subscribed, enabled/unsubscribed, and
enabled/subscribed. Temporarily replace `DiscordNotifier.prototype.notify`, prove only the third
service sends, and restore the prototype in `finally`.
Do not edit the form/actions, add a default helper, backfill stored
`enabled_types`, or add a global health setting: the existing form initializes absent IDs to false and
the actions persist only explicitly checked IDs.

### Phase 2: Atomic Deduplication Persistence

#### Task 2.1: Implement monotonic claim, re-arm, and diagnostic state queries Depends on [1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/queries/driftStatus.ts`
- `packages/praxrr-app/src/lib/server/db/db.ts`
- `packages/praxrr-app/src/tests/db/driftQueries.test.ts`
- `packages/praxrr-app/src/lib/server/db/migrations/20260719_create_config_health_notification_state.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/db/queries/configHealthNotificationState.ts`
- `packages/praxrr-app/src/tests/db/configHealthNotificationState.test.ts`

Implement row/detail types plus `get(instanceId)`, `rearm(instanceId, currentSnapshotId)`, and
`claim(instanceId, currentSnapshotId, signature, notifiedAt)`. Both mutations are one conditional
upsert that accepts only newer snapshot IDs. Identical signatures advance the high-water mark but
do not win dispatch; recovery stores a nullable tombstone. Test schema constraints, changed and
identical claims, stale rejection, overlapping winners, re-arm, FK enforcement, and cascade.

### Phase 3: Snapshot Producer Convergence

#### Task 3.1: Integrate persisted comparison, recovery, claim, and best-effort dispatch Depends on [1.1, 1.3, 1.4, 2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`
- `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`
- `packages/praxrr-app/src/lib/server/notifications/builder.ts`
- `packages/praxrr-app/src/lib/server/notifications/NotificationManager.ts`
- `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`
- `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`

In `snapshotInstance`, score and persist the report, retain its ID, then load the immediately
preceding same-instance row using `getPrevious(instanceId, currentSnapshotId)` before entering the
separately guarded notification phase. Incomparable/quiet outcomes preserve
state; recovery synchronously writes a monotonic re-arm tombstone without emitting; degradation
atomically claims its signature and only the current-snapshot winner builds/sends `health.degraded` through the existing generic plus
Discord builder. Keep the event Arr type explicit and the detail path instance-scoped. Do not call
`DiscordNotifier` directly, scan historical pairs, open a transaction, retry delivery, or let any
assessment/state/render/manager/provider/history/logging error escape into snapshot, batch, sweep,
cursor, reschedule, or backoff behavior.

Export a narrow `snapshotInstance(instanceId, deps)` seam whose defaults call the real scorer and
builder/manager; tests inject `scoreInstance` and `sendHealthDegraded`, restore any patched manager/
notifier prototype in `finally`, and never use timing-only assertions. Extend job tests for baseline, persisted-before-
dispatch evidence, worse-band and exact-five same-band events, sub-threshold/improving/unknown/
malformed/cross-engine/changed-basis quiet paths, repeated/overlapping signature suppression,
continued worsening, meaningful recovery re-arm, explicit Radarr/Sonarr/Lidarr payloads, zero
subscribers, and secondary failures leaving the row and normal job result intact. Never use a real
webhook. Include a specifically named
`health.degraded manual harness: repeat and recovery re-arm` case that captures the event array for
the separate manual acceptance invocation in Task 4.3.

### Phase 4: Documentation, Test Entrypoints, and Completion Evidence

#### Task 4.1: Add executable Config Health and notifications test aliases Depends on [3.1]

**READ THESE BEFORE TASK**

- `scripts/test.ts`
- `docs/site/src/content/docs/app/testing.md`
- `packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`
- `packages/praxrr-app/src/tests/notifications/manager.test.ts`

**Instructions**

Files to Modify

- `scripts/test.ts`

Ensure the `config-health` alias includes every new health policy, state, snapshot query, and handler
test: `packages/praxrr-app/src/tests/shared/health/degradation.test.ts`,
`packages/praxrr-app/src/tests/db/configHealthNotificationState.test.ts`,
`packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`, and
`packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`. Add a `notifications` alias
containing `packages/praxrr-app/src/tests/notifications/manager.test.ts`,
`packages/praxrr-app/src/tests/shared/health/degradation.test.ts`, and
`packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`. Preserve existing aliases and never invoke external
webhooks. Retain every existing `config-health` entry and append only missing paths, especially the
new notification-state test.

#### Task 4.2: Document the event, job boundary, and supported test commands Depends on [4.1]

**READ THESE BEFORE TASK**

- `docs/site/src/content/docs/app/notifications.md`
- `docs/site/src/content/docs/app/jobs.md`
- `docs/site/src/content/docs/app/testing.md`
- `docs/plans/health-degraded-notifications/feature-spec.md`

**Instructions**

Files to Modify

- `docs/site/src/content/docs/app/notifications.md`
- `docs/site/src/content/docs/app/jobs.md`
- `docs/site/src/content/docs/app/testing.md`

Document the explicitly opted-in `health.degraded` event, adjacent comparable snapshot evidence,
worse-band/five-point policy, current-state claim, silent recovery re-arm, Config Health detail path,
and at-most-once best-effort delivery. Add the Config Health snapshot/cleanup job behavior and both
test aliases. Keep operational prose concise and do not add or imply an OpenAPI endpoint, retry
guarantee, configurable threshold, or completion of #224–#226.

#### Task 4.3: Update ROADMAP and run the complete issue validation Depends on [4.2]

**READ THESE BEFORE TASK**

- `ROADMAP.md`
- `docs/plans/health-degraded-notifications/feature-spec.md`
- `docs/plans/health-degraded-notifications/parallel-plan.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

**Instructions**

Files to Modify

- `ROADMAP.md`

Update the Config Health row to say `Implemented in PR #N` once the PR number exists, without calling
the branch shipped or merged; leave #224–#226 as open follow-ups. Immediately before squash merge,
add the final delivered entry/link only if that wording is objectively true at merge time, then rerun
required CI so `main` never lands a stale pending claim. Run `deno task format:modified`
and verify it changed only scoped files, then run `git diff --check`, `deno task lint:modified`,
`deno task test config-health`, `deno task test notifications`, `deno task check`,
`deno task docs:build`, and `deno task build`. Run full `deno task lint` as the repository-wide style
gate and distinguish any pre-existing unrelated failure with exact evidence.

Run Task 3.1's `health.degraded manual harness: repeat and recovery re-arm` test separately with
`deno test -A packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts --filter 'health.degraded manual harness'`
and inspect the captured-event assertions; no webhook is required. Record every automated command,
manual capture, and linked follow-up in the PR body/review evidence; formatting must not alter
unrelated files.

## Advice

- Insert first and select the predecessor with `id < currentSnapshotId`; this proves append-order
  adjacency even if two callers overlap, while notifying before persistence breaks evidence fidelity.
- Claim before dispatch and accept at-most-once attempts. Drift's notify-then-mark sequence is useful
  precedent for message shape but not sufficient concurrency control for this feature.
- Keep state through unknown, malformed, cross-engine, changed-basis, and small improvements. Clearing
  on uncertainty creates false recovery/regression alert cycles.
- Do not wrap concurrent snapshot work in `db.transaction()`. Individual insert and monotonic
  claim/re-arm statements are the safe atomic units on the shared SQLite connection.
- Treat the shared event catalog as the only settings contract. Existing create/edit behavior already
  makes a newly added ID opt-in, so UI/action changes would add scope and risk without value.
- Keep foundation owners file-disjoint. The handler task is the only convergence point and must wait
  for the policy, predecessor, event, and state-query interfaces to settle.
- The feature spec and issue define completion; do not absorb existing webhook URL/secret-storage or
  reusable checkbox accessibility findings into this PR unless implementation exposes a new regression.
