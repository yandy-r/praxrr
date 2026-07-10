# Architecture Research: Canary Remaining-Target Preview Evidence

## System Overview

Issue #239 changes the Canary verification gate from an implicit, transient
preview into explicit, durable evidence. The existing canary system is a
two-phase state machine. `startRollout()` runs one canary synchronously and
either aborts or persists `awaiting_confirmation`; `proceedRollout()` advances
the rollout to `rolling_out` and enqueues the existing batched job, while
`abortRollout()` terminates it without touching remaining targets. Status and
`state_token` guards already protect lifecycle transitions.

The defect sits between canary completion and the verification gate.
`buildRemainingPreview()` catches any remaining-preview exception and returns
`[]`, and it silently filters persisted targets that are no longer enabled. The
raw array exists only in the start response. The list page then redirects to
`/canary/{id}`, whose loader reads the rollout and linked canary Sync History
record, so the detail page cannot recover the remaining-target preview after
navigation or refresh. It currently presents the canary’s historical change set
as a representative remaining preview.

The feature architecture separates two evidence domains:

- Confirmed canary execution evidence remains in `sync_history`, linked by
  `canary_sync_history_id`.
- Planned remaining-target evidence becomes a versioned
  `available`/`unavailable` snapshot persisted on `canary_rollouts`.

Only an available snapshot whose preview IDs exactly equal the persisted
same-Arr `remaining_targets` set may authorize Proceed. Null, corrupt, partial,
missing-target, or cross-Arr evidence fails closed. Abort remains independent
and available.

## Relevant Components

| Component                                                                           | Current responsibility                                                                        | Issue #239 responsibility                                                                                                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`                     | Resolve rollout phases, run/classify canary, build transient remaining preview, proceed/abort | Build typed evidence, preserve exact cohort, persist it with outcome, and reject Proceed unless evidence is available and exact                        |
| `packages/praxrr-app/src/lib/server/sync/canary/types.ts`                           | Canary lifecycle, row, detail, target, and start-result contracts                             | Define the versioned evidence union and add it to row/detail/gated-start contracts                                                                     |
| `packages/praxrr-app/src/lib/server/sync/canary/selection.ts`                       | Resolve canary and remaining targets within explicit `arrType`                                | Remains authoritative for initial same-Arr cohort selection; no policy change                                                                          |
| `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`                   | Generate per-instance section previews and capture section failures                           | Supplies `GeneratePreviewResult`; section failures must make aggregate canary evidence unavailable                                                     |
| `packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`                  | Map typed/status errors to safe `SyncPreviewFailureReason` copy                               | Reused for unreachable, timeout, unauthorized, rejected, server, and internal failures; `buildPreviewFailure('sectionErrors')` covers partial sections |
| `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`                   | Serialize rollout JSON, project detail, and guard transitions                                 | Strictly decode evidence, persist it with canary outcome, and expose a fail-closed detail model                                                        |
| `packages/praxrr-app/src/lib/server/db/migrations/20260715_create_canary_tables.ts` | Defines current rollout/settings tables                                                       | Baseline extended by a new migration adding nullable evidence JSON text                                                                                |
| `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`                  | Start/list HTTP boundary                                                                      | Return the persisted discriminated evidence instead of a transient raw array                                                                           |
| `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/+server.ts`             | Return rollout detail                                                                         | Expose the same durable evidence after redirect/reload                                                                                                 |
| `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts`     | Map proceed lifecycle/token errors                                                            | Map unavailable evidence to a safe conflict without enqueueing                                                                                         |
| `packages/praxrr-app/src/routes/canary/[id]/+page.server.ts`                        | Load rollout plus linked canary diagnostics                                                   | Continue loading confirmed evidence and add persisted planned evidence through rollout detail                                                          |
| `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`                           | Render canary detail and verification actions                                                 | Render changes/no-changes/unavailable distinctly; disable Proceed for unavailable evidence and retain Abort                                            |
| `docs/api/v1/schemas/canary.yaml` and `docs/api/v1/paths/canary.yaml`               | Portable Canary contract                                                                      | Define required discriminated schemas and conflict behavior before type regeneration                                                                   |

## Data Flow

1. `POST /api/v1/canary/rollouts` validates the request and calls
   `startRollout()`.
2. `resolveCanary()` returns an explicit `radarr`, `sonarr`, or `lidarr` canary
   plus remaining cohort. `canaryRolloutQueries.insert()` persists that exact
   target list in `canary_running`.
3. `executeSyncJob()` runs the canary. The coordinator classifies the run using
   a bounded `sync_history` lookup and existing conservative fallback.
4. A failed, skipped, or policy-aborted partial canary follows the existing
   terminal abort path; no remaining preview is needed.
5. For a passing canary, a new evidence builder resolves every persisted
   remaining target without silently dropping or substituting IDs and invokes
   existing preview generation.
6. A complete target set with no section failures becomes
   `{ version: 1, availability: 'available', generatedAt, previews }`. Zero
   mutations remain available. A thrown error, section failure, target mismatch,
   or incomplete result becomes `unavailable` with closed safe failure data and
   optional diagnostic partial previews.
7. The query layer persists canary outcome, next token, gate status, and
   evidence in one guarded transition from `canary_running`. This prevents an
   `awaiting_confirmation` row from being created without authoritative
   evidence.
8. Start and detail APIs serialize the persisted snapshot. The detail page
   displays planned evidence separately from the linked, confirmed canary Sync
   History data.
9. Proceed re-reads the rollout, validates `awaiting_confirmation`, available
   evidence, exact target identity/Arr scope, and the caller’s current token.
   Only then does the guarded update run and the existing `sync.canary.rollout`
   job enqueue. Abort continues to require only gate status plus token.

## Integration Points

Persistence requires a new migration, expected as
`packages/praxrr-app/src/lib/server/db/migrations/20260722_add_canary_preview_evidence.ts`,
registration in `packages/praxrr-app/src/lib/server/db/migrations.ts`, and
parity in `packages/praxrr-app/src/lib/server/db/schema.sql`. The new nullable
`remaining_preview_evidence TEXT` keeps legacy rows readable; strict decoding
maps null or invalid content to unavailable rather than success.

Contract changes originate in Canary TypeScript types and OpenAPI source, then
flow to `packages/praxrr-api/openapi.json` and
`packages/praxrr-app/src/lib/api/v1.d.ts` through the repository generators.
Runtime and portable schemas must use the same discriminator, safe failure
vocabulary, and required properties.

Verification integrates with
`packages/praxrr-app/src/tests/db/canaryMigration.test.ts`,
`packages/praxrr-app/src/tests/db/canaryQueries.test.ts`,
`packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts`, and
`packages/praxrr-app/src/tests/routes/canary.test.ts`. Tests must cover
zero-change availability, unreachable/unauthorized errors, partial sections,
malformed evidence, exact same-Arr IDs, no enqueue on unavailable evidence,
stale tokens, and Abort retention.

## Key Dependencies

- `executeSyncJob()` in
  `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` remains the
  canary mutation primitive.
- `generateInstancePreviews()` in
  `packages/praxrr-app/src/lib/server/sync/processor.ts` and preview
  orchestration supply read-only planned results.
- `classifyPreviewFailure()` and `buildPreviewFailure()` provide the only
  transported failure copy; raw Arr errors remain at the sanitized logger
  boundary.
- `arrInstancesQueries.getEnabled()` supports exact target revalidation, but
  missing/disabled targets must produce unavailable evidence instead of being
  filtered out.
- `canaryRolloutQueries.markRollingOut()` and `abort()` provide the existing
  atomic status/token value guards.
- `enqueueJob()` in `packages/praxrr-app/src/lib/server/jobs/queueService.ts`
  remains downstream of successful promotion validation.
- SQLite JSON text, native TypeScript unions, Svelte conditional rendering, and
  existing OpenAPI generation are sufficient; no new library, service,
  configuration, selection policy, batching policy, or sibling-Arr fallback is
  required.
