# Documentation Analysis: Health Degraded Notifications

## Executive Summary

Issue [#223](https://github.com/yandy-r/praxrr/issues/223) is an internal jobs/notifications
extension to the Config Health foundation, not a new public API feature. The implementation should
compare adjacent persisted snapshots, claim a durable per-instance degradation signature, and send
`health.degraded` only through explicitly opted-in notification services. Existing documentation
already defines the three important boundaries: snapshots are append-only evidence, notification
delivery is best effort, and job handlers isolate per-instance failures.

The documentation closeout is nevertheless part of the feature. `ROADMAP.md` currently lists #223
as an open Config Health follow-up, so implementation must record its delivery and update that
follow-up status. The issue's exact automated and manual test plan must remain executable and be
reported. No HTTP endpoint or OpenAPI schema change is designed: the event is internal, the existing
shared notification catalog drives settings selection, and the existing Config Health detail/trend
API remains the evidence surface.

## Must-Read Documents

| Document                                                                            | Why it is required                                                                   | Implementation consequence                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [Issue #223](https://github.com/yandy-r/praxrr/issues/223)                          | Source acceptance criteria, scope, dependencies, and test plan                       | Preserve opt-in behavior, dedupe, quiet unknown/improving results, and snapshot-job success on delivery failure   |
| `docs/plans/health-degraded-notifications/feature-spec.md`                          | Consolidated product, persistence, event, rendering, and failure contracts           | Treat persisted evidence, strict comparability, atomic claim, recovery re-arm, and bounded messages as one design |
| `CLAUDE.md`                                                                         | Repository architecture and required cross-Arr/contract conventions                  | Preserve explicit `radarr`/`sonarr`/`lidarr`; use the migration registry; do not invent a public contract         |
| `ROADMAP.md`                                                                        | Tracks Config Health foundation #22/#217 and follow-ups #223-#226                    | Add #223 to delivered work and remove/mark it complete in Config Health follow-up text                            |
| `docs/site/src/content/docs/app/notifications.md`                                   | Documents manager filtering, fire-and-forget delivery, provider plugins, and history | Reuse `enabled_types`, `NotificationManager`, generic content, Discord, and existing history                      |
| `docs/site/src/content/docs/app/jobs.md`                                            | Documents dispatcher/reschedule behavior and lack of a central retry policy          | Notification failure must not affect the snapshot handler result or trigger job backoff                           |
| `docs/site/src/content/docs/app/testing.md` and `scripts/test.ts`                   | Define the supported test entry points                                               | Keep `config-health` complete and add the issue-required `notifications` alias                                    |
| `docs/api/v1/paths/config-health.yaml` and `docs/api/v1/schemas/config-health.yaml` | Define current summary/detail/trend/settings evidence                                | Use the existing detail path and snapshot vocabulary; do not add an event endpoint                                |

### Issue test plan

Required automated commands:

```bash
deno task test config-health
deno task test notifications
deno task check
```

Required manual check:

- Trigger the same eligible band regression twice and confirm only the first event is delivered.

The completion report must state whether every command/check ran successfully or was explicitly
blocked. The issue also requires the related PR and any follow-up issues to be linked.

## Architecture Docs

### Primary architecture references

- `docs/site/src/content/docs/app/architecture.md` maps `$jobs/`, `$notifications/`, `$db/`, and
  shared contracts. The event crosses those internal modules but does not cross the HTTP boundary.
- `docs/site/src/content/docs/app/jobs.md` explains serialized dispatch, handler-owned rescheduling,
  and startup recovery. Its key rule here is that optional notification work cannot change the
  primary job outcome.
- `docs/site/src/content/docs/app/notifications.md` defines service filtering by `enabled_types`,
  parallel best-effort provider sends, and notification-history recording.
- `docs/architecture/data-flow.md` is useful general context for jobs and the app database, although
  it does not yet diagram Config Health snapshots or notifications.
- `docs/ARCHITECTURE.md` and `docs/architecture/overview.md` are broad repository maps; consult them
  only when module ownership or startup/migration placement is unclear.

### Source comments that carry architectural contracts

- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts`: the sweep is chunked,
  concurrency-bounded, id-ordered, and per-instance work must never throw into sibling processing.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts`: snapshot insertion is a
  bare statement-atomic write because `processBatches` is not safe for nested bare transactions.
- `packages/praxrr-app/src/lib/server/notifications/NotificationManager.ts`: manager calls filter
  enabled services by exact event ID, settle sends independently, and swallow manager/provider/
  history failures.
- `packages/praxrr-app/src/lib/server/sync/drift/persist.ts`: useful precedent for signature dedupe,
  recovery re-arming, bounded Discord evidence, and non-interference with primary persistence. Its
  post-send marking is precedent only; #223 deliberately requires an atomic claim before dispatch.
- `packages/praxrr-app/src/lib/shared/notifications/types.ts`: the shared catalog is the settings UI
  and validation source, so adding one row exposes the opt-in without a bespoke Svelte surface.

### API boundary

`docs/api/v1/openapi.yaml` currently exposes Config Health summary, detail, trends, and settings via
the path/schema files above. The planned notification consumes persisted snapshot data internally
and links to `/config-health/{instanceId}`. No OpenAPI change is designed, and generated API types
should not change unless implementation unexpectedly adds a public field or route; that would be a
scope/design change requiring explicit review.

## Reading List (required vs nice)

### Required before implementation

1. Issue #223 and `feature-spec.md` for acceptance and policy.
2. `configHealthSnapshot.ts` plus `configHealthSnapshots.ts` for the primary-operation boundary.
3. `NotificationManager.ts`, `builder.ts`, server notification `types.ts`, and shared notification
   `types.ts` for event registration, routing, provider projection, and history behavior.
4. `ROADMAP.md` for the mandatory delivery/status update.
5. `scripts/test.ts` and the Config Health/job/notification tests for executable validation scope.
6. Config Health OpenAPI path/schema files to preserve existing evidence terms and detail route.

### Nice to read or use as precedent

- `docs/site/src/content/docs/app/architecture.md`, `jobs.md`, `notifications.md`, and `testing.md`.
- `packages/praxrr-app/src/lib/server/sync/drift/persist.ts` for a closely related event flow.
- `docs/internal-docs/automation-transparency-audit.md` for job evidence and failure-transparency
  expectations.
- `research-technical.md`, `research-ux.md`, `research-security.md`, and
  `research-recommendations.md` in this plan directory for detailed rationale and rejected scope.
- Discord webhook/embed/rate-limit links in `feature-spec.md` when implementing bounded embeds.

## Documentation Gaps

1. **ROADMAP obligation:** #223 remains listed as a follow-up in the Config Health row and later
   roadmap summaries. Delivery must be added to shipped work and those references updated without
   implying #224-#226 are complete.
2. **Notification guide drift:** `app/notifications.md` describes alerts mainly as upgrade, rename,
   and test events and does not document the shared catalog as the settings source. Add
   `health.degraded`, its opt-in/dedup semantics, and its Config Health detail link after behavior is
   implemented.
3. **Job guide drift:** `app/jobs.md` omits `config-health.snapshot` and
   `config-health.cleanup` from its job/handler lists. Document the snapshot's post-insert,
   best-effort notification phase and clarify that delivery errors do not request backoff.
4. **Testing guide drift:** `app/testing.md` does not list the already-present `config-health` alias,
   while `scripts/test.ts` has no `notifications` alias even though issue #223 requires it. Update
   both code and documentation so the published commands are real.
5. **Config Health operational narrative:** OpenAPI precisely documents live and trend payloads but
   no contributor/user document explains snapshot-to-alert comparison, strict scoring-basis parity,
   recovery re-arming, or at-most-once attempts. The notifications guide is the smallest suitable
   home; avoid duplicating the full feature spec.
6. **Source comment update:** the snapshot handler comment currently ends at score-and-append. Once
   integrated, update it to name the read/insert/assess/claim/dispatch ordering and the no-throw
   secondary phase.
7. **No OpenAPI gap for this scope:** do not add a notification emission endpoint, global health
   toggle, threshold field, or event schema. The shared catalog and existing notification service
   actions are the designed settings surface.
