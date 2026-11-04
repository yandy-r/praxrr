# Research — Drift Remediation (YAN-514 / GH #409)

Facts below are checked against the source in this worktree. They anchor [`plan.md`](./plan.md).

## Drift detection (current)

- `sync/drift/persist.ts` `checkAndPersistInstance`:
  - It is the single path for both the sweep and `POST /api/v1/drift/{id}`, and it never throws.
  - It uses a module `inFlight` Set; a busy instance returns `{kind:'in_flight'}`.
  - Read prior → `checkInstanceDrift` → `driftStatusQueries.upsert` → `publishDriftUpdated`.
  - It clears `notified_signature` on genuine recovery.
  - Notification is fire-and-forget: `notify('drift.detected')`, then `markNotified` after send.
- `shouldNotify(prior, next)` fires iff `next.status==='drifted' && prior?.notifiedSignature !== next.driftSignature`.
  It dedups purely on signature, not on prior status.
- `sync/drift/check.ts`:
  - `driftSignature` = FNV-1a hash over sorted tokens `${section}|${entityType}|${name}|${remoteId ?? 'new'}|${action}`,
    for `drift`/`missing` categories only. That token is a natural per-entity ack key.
  - `checkInstanceDrift` gates in order: heartbeat → shared preview rate window → PCD cache → version-available sections.
  - A partial section error becomes `error` with `contentCheckedAt=null`, and persist keeps the prior content.
- `DriftCategory` = `drift | missing | unmanaged | prune`. Only `drift` and `missing` alert or score.
- `drift_instance_status`: one row per instance, PK = FK `ON DELETE CASCADE`. It has `drift_signature`,
  `notified_signature`, and a `changes` JSON blob. There are no ack/snooze/remediation columns yet
  (design §11 names the `acknowledged_signature` / `snoozed_until` seam).
  `upsert` is a bare `db.execute`, deliberately, because `db.transaction` is not re-entrant under `processBatches`.
- `jobs/handlers/driftCheck.ts` is a chunked sweep (5 per chunk, concurrency 3). Cursor state lives in `drift_check_settings`.
- Routes:
  - `routes/api/v1/drift/{summary,[instanceId],settings}`.
  - `GET`/`POST` `[instanceId]`. POST refresh has its own limiter (`registerDriftRefreshAttempt`), returns 409 when in-flight and 429 with `Retry-After`.
  - `responses.ts` `toDriftDetail` groups `changes` by category.
- UI:
  - `routes/drift/[instanceId]/+page.svelte` is Svelte 5 without runes, client-fetched.
  - It has a request-id race guard and live reload on `drift.updated`.
  - It has a "Refresh now" button and no remediation action.

## Health

- `health/gather.ts` `gatherDrift` maps the stored row to `DriftFacts`.
- `shared/health/criteria.ts` drift criterion: `drifted` with fresh content → `100 - DRIFT_PER_ENTITY_PENALTY * (drifted+missing)`.
  Stale content or a non-measurable state → null (skipped).
- The suppression seam is `gatherDrift` together with the criterion.

## Reviewed-plan apply path

- `POST /api/v1/sync/preview` (`_handleSyncPreviewCreateRequest`, injectable deps):
  - Gates: instance exists, type eligible, instance enabled, store capacity, `registerPreviewCreateAttempt` (shared 6/60 s).
  - Then `generatePreview(..., {captureReviewContext, client})`, `buildSyncPreviewReviewBinding`, `previewStore.completeGeneration`.
  - A partial section failure is stored with top-level `sectionErrors`, and apply is then blocked.
- `POST /api/v1/sync/preview/{id}/apply` (`_handleSyncPreviewApplyRequest`):
  - Checks, in order: ready state, no failure, eligible sections, staleness, managed-delete admin scope for tokens, `getSectionsInProgress` 409.
  - Then `previewStore.claimReadyForApply`, then `executeReviewedSyncJob({binding, sections, previewId, expiresAt, source:'manual'})`.
  - Returns `syncHistoryId`.
- `executeReviewedSyncJob` (`jobs/handlers/arrSync.ts`):
  1. Section claim, scope and target-hash checks, version availability.
  2. Re-materialize and compare evidence; mismatch → `invalidated`.
  3. Snapshot, then the prepared-context section writes.
  4. `recordSyncHistory({... previewId, trigger: input.source})` writes the history row.
  5. Returns `syncHistoryId`.
- `sync_history` already has `preview_id`. `trigger` is `manual|schedule|system`. `trigger_event` is CHECK-limited (`on_pull|on_change`).
  It has no drift link columns.
- `SyncPreviewPanel.svelte` takes `previewState`, `instanceName`, and `focusSection`.
  It is also reused by `routes/setup/preview-sync`.
  Regenerate posts to the hard-coded `/api/v1/sync/preview`.
- Preview store: in memory, TTL 10 min, capacity `PREVIEW_MAX_SNAPSHOTS`.

## Canary

- `canary_settings.enabled` defaults to 0.
- `startRollout` is manual-only. It runs the canary via the **non-reviewed** `executeSyncJob` and gates the remaining same-`arr_type` cohort at `awaiting_confirmation`.
- Nothing in the scheduled sync path consults Canary today. "Respects Canary gating" therefore has to be defined in this feature (plan D10).
- Active rollout states: `canary_running | awaiting_confirmation | rolling_out`.
- The `routes/arr/[id]/sync/+page.server.ts` section-coverage resolver already special-cases `sync.canary.rollout` jobs.

## Jobs / events / auth / notifications

- `enqueueJob` (`jobQueueQueries.create`) does not enforce dedupe.
- `upsertScheduledJob` dedupes on the unique `dedupe_key` index and never overrides a running row. Use it for "don't stack" behavior.
- A new job type must be added to every registry:
  - `queueTypes.ts` (`JOB_TYPES` + payload map)
  - `handlers/index.ts`
  - `display.ts`
  - `evidence.ts` (`JOB_EVIDENCE_DESCRIPTORS`)
  - `transparencyAudit.ts`
  - optionally `shared/events/types.ts` `SYNC_FAMILY_JOB_TYPES`
  - `docs/api/v1/schemas/events.yaml`
- SSE: `publishDriftUpdated(UpsertDriftStatusInput)` emits `drift.updated`. The UI listens to it on both drift pages.
- CSRF: global `csrfGuard` in `hooks.server.ts`; SvelteKit's `checkOrigin` is off by design.
- Token scopes: `utils/auth/scopePolicy.ts` `requiredScopeFor`.
  - Unknown mutating routes require `admin` (fail-closed).
  - `READ_POST_ROUTES` covers dry-run POSTs (e.g. `/sync/preview`).
  - `SYNC_APPLY_ROUTES` covers apply routes.
- Notifications: types are in `server/notifications/types.ts` and `shared/notifications/types.ts` (category `Drift`). The free-form TEXT type needs no migration. Severity comes from the type suffix (`*.failed` → error).

## Migrations

- Date-versioned files live in `db/migrations/`. Register each in both the static import list and the `loadMigrations()` array of `db/migrations.ts`.
- `schema.sql` is a reference document only.
- The latest migration is `20261030_create_user_command_palette_recents.ts`.
- `ALTER TABLE … ADD COLUMN` with a CHECK is the established additive pattern (e.g. `20260720`, `20260723`).

## Release policy

- RELEASING.md "Unfinished work": anything a user can reach must be complete, or hidden behind a default-off switch.
- This PR ships the feature complete, with auto-remediation defaulting to `off` per instance, so no switch is needed.
