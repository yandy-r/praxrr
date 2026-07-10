# Task Analysis: Health Degraded Notifications

## Executive Summary

Implement issue #223 in the established feature worktree as nine tasks across parallel foundations,
atomic persistence, producer integration, and closeout. Each task owns 1–3 files. Read the immediate
predecessor, persist the current snapshot, then run assessment, clear/claim, render, and manager
dispatch in a separate no-throw phase. A conditional SQLite claim is the durable at-most-once gate;
meaningful comparable recovery silently re-arms the next episode.

No endpoint/OpenAPI, Svelte, provider, dependency, retry/outbox, global toggle, configurable
threshold, backfill, cross-Arr fallback, or worktree setup belongs in scope.

## Recommended Phase Structure

### Phase 1 — Batch A: parallel foundations

#### T1 — Pure policy and projection

**Files (2):** `server/health/degradation.ts` (new),
`tests/shared/health/degradation.test.ts` (new), both under `packages/praxrr-app/src/`.

Implement the five-point policy, strict adjacent comparability, recovery/quiet outcomes,
`health-degraded:v1` SHA-256 signature, contributor ranking, Arr-faithful DTO, and bounded/sanitized
generic/Discord projection. Test threshold and band edges, malformed/unknown/changed bases, recovery,
signature stability, ranking/fallback, control stripping, and embed limits.

#### T2 — State schema

**Files (2):** `packages/praxrr-app/src/lib/server/db/migrations/20260719_create_config_health_notification_state.ts`
(new), `packages/praxrr-app/src/lib/server/db/migrations.ts`.

Register reversible migration `20260719` after `20260717`: instance PK/FK cascade, non-empty
signature, claim/bookkeeping times, no snapshot FK or extra index.

#### T3 — Latest persisted snapshot

**Files (2):** `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`,
`packages/praxrr-app/src/tests/db/configHealthSnapshots.test.ts`.

Add `getLatest(instanceId)` through `rowToDetail`, ordered by generated time then ID descending.
Test empty baseline, instance scope, timestamp order, equal-time tie-break, and parsing fidelity.

#### T4 — Opt-in event contract

**Files (3):** `packages/praxrr-app/src/lib/server/notifications/types.ts`,
`packages/praxrr-app/src/lib/shared/notifications/types.ts`,
`packages/praxrr-app/src/tests/notifications/catalog.test.ts` (new).

Add server constant `health.degraded` and catalog row `Config Health Decreased` / `Config Health`;
test catalog helpers. Existing catalog-driven settings remain false until explicitly selected.

### Phase 2 — Batch B1: atomic persistence

#### T5 — Notification-state queries

**Depends on:** T2. **Files (2):**
`packages/praxrr-app/src/lib/server/db/queries/configHealthNotificationState.ts` (new),
`packages/praxrr-app/src/tests/db/configHealthNotificationState.test.ts` (new).

Implement empty-signature rejection plus `claim`, `clear`, and diagnostic `get`. Claim must be one
conditional `INSERT ... ON CONFLICT DO UPDATE ... WHERE`; affected rows gate dispatch. Test the real
migration, first/changed/same/overlapping claims, timestamps, clear/get, FK, and instance cascade.

### Phase 3 — Batch B2: convergence

#### T6 — Snapshot producer integration

**Depends on:** T1, T3, T4, T5. **Files (2):**
`packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`,
`packages/praxrr-app/src/tests/jobs/configHealthSnapshot.test.ts`.

Read latest before scoring, retain the inserted ID, then assess, recover/claim, build, and await the
existing manager inside a post-insert no-throw guard; update the handler contract comment. Never call
Discord or open a transaction directly. Test baseline, eligible edges/evidence, repeated/overlap
dedup, recovery re-arm, all quiet/incomparable paths, strict opt-in, Radarr/Sonarr/Lidarr fidelity,
and isolation of assessment/state/render/manager/provider/history failures without real webhooks.

### Phase 4 — Batch C: closeout

#### T7 — Test aliases

**Depends on:** T1, T4, T5, T6. **Files (1):** `scripts/test.ts`.

Include every new health test in `config-health`; add `notifications` for catalog, projection,
integration, and relevant manager behavior.

#### T8 — Guides

**Depends on:** T6, T7. **Files (3):** `docs/site/src/content/docs/app/notifications.md`,
`docs/site/src/content/docs/app/jobs.md`, `docs/site/src/content/docs/app/testing.md`.

Document opt-in adjacent-evidence alerts, threshold/band policy, claim/recovery semantics, detail
path, best-effort failure isolation, Config Health jobs, and both supported test aliases. Do not add
API documentation or duplicate the feature spec.

#### T9 — ROADMAP and validation

**Depends on:** T7, T8. **Files (1):** `ROADMAP.md`.

Mark #223 delivered in the Config Health row/notes/checklist without closing #224–#226. Run every
issue command:

```bash
deno task test config-health
deno task test notifications
deno task check
```

Then run `deno task format` and `deno task lint`. Manually trigger the same eligible band regression
twice (only the first delivers), then verify meaningful recovery re-arms it. Report blockers and
link the PR/follow-ups.

## Task Granularity

- T1 owns deterministic policy/projection; T2 schema; T5 mutable state; T3 predecessor lookup.
- T4 owns the settings-facing contract; T6 is the sole cross-layer convergence and failure suite.
- T7 owns runner paths; T8 three aligned guides; T9 roadmap truth and completion evidence.
- Every task has 1–3 files, and parallel owners are file-disjoint, including tests.

## Dependency Analysis

```text
T1 ───────────────┐
T2 -> T5 ─────────┤
T3 ───────────────┼-> T6 -> T7 -> T8 -> T9
T4 ───────────────┘    \-----> T7 -------> T9
```

Batch A is T1–T4; T5 starts after T2; T6 waits for T1/T3/T4/T5; T7, T8, T9 close sequentially.
Every edge points foundation -> integration -> closeout, so no cycle exists.

## File-to-Task Mapping

| Task | Production/docs          | Test/runner             |
| ---- | ------------------------ | ----------------------- |
| T1   | degradation module       | degradation test        |
| T2   | migration + registry     | T5 real-chain test      |
| T3   | snapshot query           | snapshot query test     |
| T4   | event constant + catalog | catalog test            |
| T5   | state query              | state DB test           |
| T6   | snapshot handler         | snapshot job test       |
| T7   | test runner              | both aliases            |
| T8   | three app guides         | docs review             |
| T9   | ROADMAP                  | commands + manual check |
