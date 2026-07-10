# Integration Research: Canary Remaining-Target Preview Evidence

## API Endpoints

The Canary API is mounted in `docs/api/v1/openapi.yaml` and decomposed through
`docs/api/v1/paths/canary.yaml`. Issue #239 changes the payload/policy of
existing endpoints; it does not add a route.

| Endpoint                                    | Runtime route                                                                   | Integration impact                                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/canary/rollouts`              | `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`              | The `skipped: true` single-target arm stays unchanged. The gated arm should return the persisted rollout containing required `remainingPreview` evidence, not a separate transient `GeneratePreviewResult[]`. |
| `GET /api/v1/canary/rollouts`               | same file                                                                       | Summary pagination is unchanged; no full preview JSON should be added to list rows.                                                                                                                           |
| `GET /api/v1/canary/rollouts/{id}`          | `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/+server.ts`         | `CanaryRolloutDetail` must expose the decoded evidence after redirect/reload. Null, legacy, or malformed storage must serialize as safe `unavailable`, never `[]`.                                            |
| `POST /api/v1/canary/rollouts/{id}/proceed` | `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts` | Add the preview-unavailable typed error mapping to `409`; preserve `400` invalid input, `404`, `409` wrong state, and `422` stale token. No job is enqueued unless evidence is available and exact.           |
| `POST /api/v1/canary/rollouts/{id}/abort`   | `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/abort/+server.ts`   | No evidence precondition. Abort remains state/token guarded from `awaiting_confirmation`.                                                                                                                     |
| `GET/PATCH /api/v1/canary/settings`         | `packages/praxrr-app/src/routes/api/v1/canary/settings/+server.ts`              | No contract change.                                                                                                                                                                                           |

Portable schemas live in `docs/api/v1/schemas/canary.yaml`; the safe failure
type is already defined in `docs/api/v1/schemas/sync.yaml` as
`SyncPreviewFailureReason`. Add named versioned available/unavailable schemas
and reference them from required `CanaryRolloutDetail.remainingPreview`.
`CanaryStartGated` should contain only `skipped` and the rollout rather than
duplicating evidence. After OpenAPI changes, `deno task generate:api-types`
regenerates `packages/praxrr-app/src/lib/api/v1.d.ts`; the repository also
maintains generated distribution artifacts in `packages/praxrr-api/openapi.json`
and `packages/praxrr-api/types.ts`.

## Route Organization

The SvelteKit API tree mirrors the URL hierarchy under
`packages/praxrr-app/src/routes/api/v1/canary/`. Body-size and shape checks
remain route concerns; cohort resolution, evidence validation, and state
transitions belong in the Canary service layer. Routes should map typed errors
rather than inspect messages.

The operator UI is split between:

- `packages/praxrr-app/src/routes/canary/+page.server.ts` and `+page.svelte`:
  eligible Radarr/Sonarr/Lidarr picker, settings, recent rollouts, and start
  request. On a gated result it redirects to `/canary/{id}`, so the POST-only
  preview array cannot be the authoritative UI source.
- `packages/praxrr-app/src/routes/canary/[id]/+page.server.ts` and
  `+page.svelte`: reloadable rollout detail and linked Sync History diagnostics.
  The server load already reads `canaryRolloutQueries.getById`; once evidence is
  part of the detail DTO, no second request or live regeneration is required.
  The UI must keep confirmed canary diagnostics separate from planned
  remaining-target previews, disable Proceed for unavailable evidence, and
  retain Abort.

Global authentication remains supplied by
`packages/praxrr-app/src/hooks.server.ts`; no new route middleware is required.

## Database

The exact existing tables are created by
`packages/praxrr-app/src/lib/server/db/migrations/20260715_create_canary_tables.ts`:

- `canary_rollouts`: rollout lifecycle, exact Arr scope, persisted remaining
  targets, job cursor and results, canary audit linkage, and `state_token`.
- `canary_settings`: singleton row (`id = 1`) for opt-in, batch size,
  auto-selection, default canary, and partial policy.

The feature spec proposes
`packages/praxrr-app/src/lib/server/db/migrations/20260723_add_canary_preview_evidence.ts`,
adding `remaining_preview_evidence TEXT NULL` to `canary_rollouts`. Register it
after migration 20260721 in both the imports and `loadMigrations()` array in
`packages/praxrr-app/src/lib/server/db/migrations.ts`. Existing rows
intentionally remain null and there is no historical backfill: null is read as
unavailable and is never promotable.

`packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts` is the only
rollout persistence module. Extend its raw row, detail mapper, insert/outcome
DTOs, and SQL. The evidence write should be part of the same
`recordCanaryOutcome` guarded update that changes `canary_running` to
`awaiting_confirmation`; this prevents state/evidence divergence.
`markRollingOut` must continue to atomically guard both status and exact
`state_token`. Summary queries should omit the heavy evidence blob.

`packages/praxrr-app/src/lib/server/db/schema.sql` is documented as
reference-only and currently lacks the later Canary table definitions despite
migration 20260715. The implementation should add the current
`canary_rollouts`/`canary_settings` definitions including the new evidence
column so the reference schema reflects migration state; migrations remain the
executable source of truth.

## Schema Details

The persisted/API shape is a versioned discriminated union:

```ts
type CanaryRemainingPreviewEvidence =
  | {
      version: 1;
      availability: 'available';
      generatedAt: string;
      previews: GeneratePreviewResult[];
    }
  | {
      version: 1;
      availability: 'unavailable';
      generatedAt: string;
      failure: SyncPreviewFailureReason;
      partialPreviews: GeneratePreviewResult[];
    };
```

Runtime ownership belongs in
`packages/praxrr-app/src/lib/server/sync/canary/types.ts`. The evidence decoder
must be separate from the existing `parseJsonArray()` helper, which
intentionally defaults malformed arrays to `[]`. Strict decoding must validate
version, discriminator, timestamp, safe failure code/copy shape, preview object
shape, unique instance IDs, preview `arrType`, cardinality, and exact set
equality against `CanaryRolloutDetail.remainingTargets`. Invalid JSON, null,
unsupported versions, or target mismatch return a constructed unavailable read
model using a closed safe failure; they never return available.

`GeneratePreviewResult` is defined in
`packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`, whereas the
current OpenAPI Canary schema references `SyncPreviewResult`, which contains
stored-preview fields such as `id` and expiry. The Canary OpenAPI schema must
model the actual generated/persisted shape rather than continuing that mismatch.
Every `sectionOutcomes[].failure` must also participate in aggregate
availability.

## External Services

Remaining previews continue through `generateInstancePreviews()` in
`packages/praxrr-app/src/lib/server/sync/processor.ts`, which applies bounded
concurrency and calls the preview orchestrator. The orchestrator obtains
explicit Radarr, Sonarr, or Lidarr clients through
`packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`. That
service performs URL safety checks, resolves/decrypts the instance API key,
constructs the Arr-specific client, and manages a per-operation client cache. No
new network integration is introduced.

Transport failures should be classified by
`packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`.
`classifyPreviewFailure()` maps typed/status failures to closed safe copy; raw
Arr response bodies and exception strings remain only at the sanitized logging
boundary.

Existing notification integrations in
`packages/praxrr-app/src/lib/server/sync/canary/notify.ts` remain best-effort.
Unavailable preview evidence is not a completed rollout and should not emit
`canary.promoted`; existing canary failure and terminal rollout notifications
remain unchanged.

## Internal Services

- `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts` owns start,
  canary outcome classification, remaining evidence construction, Proceed, and
  Abort. Replace `buildRemainingPreview(): GeneratePreviewResult[]` and its
  `catch { return [] }` with an evidence builder that classifies thrown errors
  and audits partial section outcomes.
- `packages/praxrr-app/src/lib/server/sync/canary/selection.ts` is the
  authoritative exact-Arr cohort resolver. Evidence must use only the persisted
  IDs it produces; it may not add sibling or newly enabled targets, and
  missing/disabled persisted targets make evidence unavailable.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` supplies
  per-instance planned diffs and typed section outcomes. It is read-only and
  remains independent of Canary persistence.
- `packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts` supplies
  `classifyPreviewFailure()` and
  `buildPreviewFailure('sectionErrors', arrType)`.
- `packages/praxrr-app/src/lib/server/jobs/queueService.ts` enqueues
  `sync.canary.rollout` only after an available-evidence check and successful
  guarded transition.
- `packages/praxrr-app/src/lib/server/jobs/handlers/canaryRollout.ts` consumes
  the persisted `remainingTargets`, batches them from `batchCursor`, calls
  `executeSyncJob`, records progress, and finishes `completed`/`failed`. Its
  execution flow does not consume preview payloads and should not change for
  this issue.
- `packages/praxrr-app/src/lib/server/db/queries/syncHistory.ts` remains the
  source of confirmed canary execution evidence. Preview failure must not alter
  `canaryStatus` or `canarySyncHistoryId`.

Typed Canary errors in
`packages/praxrr-app/src/lib/server/sync/canary/errors.ts` should gain a
preview-unavailable class/predicate for route mapping. Token generation remains
in `packages/praxrr-app/src/lib/server/sync/canary/token.ts` using
`crypto.randomUUID()`.

## Configuration

No environment variable, Deno task, application config, or deployment change is
required. `canary_settings` continues to control `enabled`,
`default_max_batch_size`, `auto_select`, `default_canary_instance_id`, and
`default_partial_policy` through
`packages/praxrr-app/src/lib/server/db/queries/canarySettings.ts`. Evidence
availability is not a configurable bypass: all API clients must satisfy the same
server-side promotion precondition.

The implementation should use existing repository commands:
`deno task generate:api-types` after contract edits, focused Canary
migration/query/coordinator/route tests, then `deno task check` and
`deno task lint`. No feature flag, retry setting, freshness setting, or new
dependency is part of issue #239.
