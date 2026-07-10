# Technical Research: Canary Remaining-Target Preview Evidence

## Executive Summary

The current canary gate is not safe enough to authorize promotion. After the
canary sync succeeds, `startRollout()` generates remaining-instance previews in
memory. `buildRemainingPreview()` silently drops targets that are no longer
enabled and converts every thrown preview error to `[]`. Consequently, the API
cannot distinguish “all targets were previewed and no changes exist” from “the
preview could not be generated,” while the detail page reached after redirect
does not receive that array at all. It instead displays the canary sync-history
delta as a representative preview. A refresh therefore loses the only
remaining-target evidence and may present an unavailable preview as a harmless
empty diff.

Recommendation: persist a discriminated, typed evidence object on the rollout
before exposing the verification gate. Evidence is `available` only when every
persisted remaining target, and no other target, has a successful preview. An
empty change set is valid available evidence. Any unreachable, unauthorized,
missing, disabled, type-mismatched, or otherwise failed target produces
`unavailable` evidence with safe `SyncPreviewFailureReason` values. Proceed must
re-read the durable evidence in the same guarded database transition and fail
closed unless it is available; abort remains allowed.

## Architecture Design

The flow begins in `POST /api/v1/canary/rollouts`, which validates `arrType`,
canary ID, sections, batch size, and partial policy, then calls `startRollout()`
in `sync/canary/coordinator.ts`. `resolveCanary()` selects one canary and a
same-`arr_type` remaining cohort. The coordinator inserts a `canary_rollouts`
row, runs `executeSyncJob()` inline, classifies the result from bounded
`sync_history`, and records either `aborted` or `awaiting_confirmation`.

For a passing canary, `buildRemainingPreview()` currently re-reads enabled
instances, filters to the rollout Arr type, silently removes missing targets,
and calls `generateInstancePreviews()`. Its broad catch returns an empty array.
The start route serializes this transient `remainingPreview`, but
`/canary/+page.svelte` immediately redirects to `/canary/{id}`. The detail
loader reads only the rollout and linked canary diagnostics. The detail UI
consequently renders `diagnostics.changes` from the canary run, not
remaining-target previews.

The corrected flow should resolve and persist the exact remaining cohort first,
generate one preview result per persisted target, classify failures safely,
persist one immutable evidence snapshot, and only then leave the rollout at
`awaiting_confirmation`. The detail API and Svelte page read that evidence after
redirects and refreshes. `proceedRollout()` authorizes promotion from persisted
state, not from a client assertion or ephemeral POST response.

## Data Models

Add migration `20260722_add_canary_preview_evidence.ts`, register it after
migration 20260721, and add a nullable `remaining_preview_evidence TEXT` column
to `canary_rollouts`. Null is required for legacy rows and for the interval
while a newly created row is still `canary_running`; null must never authorize
proceed.

Use a closed, versioned JSON contract:

```ts
type CanaryRemainingPreviewEvidence =
  | {
      version: 1;
      status: 'available';
      generatedAt: string;
      targets: CanaryTargetPreview[];
    }
  | {
      version: 1;
      status: 'unavailable';
      generatedAt: string;
      targets: CanaryTargetPreview[];
      failures: Array<{
        instanceId: number;
        instanceName: string;
        reason: SyncPreviewFailureReason;
      }>;
    };
```

`CanaryTargetPreview` should contain the target identity plus the existing
`GeneratePreviewResult` payload (or its public DTO). Preserve target names as
rollout-time denormalized evidence. The available branch may contain previews
whose changes arrays are empty: that explicitly means “preview succeeded; no
changes.” The unavailable branch may retain successful previews from a partial
attempt for diagnosis, but it cannot authorize rollout.

Parsing must be fail closed. Malformed JSON, an unknown version/status,
duplicate IDs, or a target-ID set different from `remaining_targets` maps to
unavailable/null behavior, never to an empty available result. Persistence
should occur through a guarded query that records canary outcome and evidence
consistently, or through a second update guarded by `status = 'canary_running'`
before transitioning to `awaiting_confirmation`. Avoid a crash window that
leaves an awaiting row without evidence.

## API Shapes

Replace `remainingPreview: SyncPreviewResult[]` in `CanaryStartGated` with
`remainingPreviewEvidence: CanaryRemainingPreviewEvidence`, and add the same
required field to `CanaryRolloutDetail` (nullable only if compatibility with
legacy rows is necessary). Generated `packages/praxrr-api/openapi.json` and
application API types must be regenerated after updating
`docs/api/v1/schemas/canary.yaml` and path descriptions.

The unavailable failure shape must reference the existing sync-preview failure
schema or mirror its closed `code`, `message`, and `recoveryAction` fields.
Never transport raw exception messages, URLs, API keys, or Arr response bodies.
`classifyPreviewFailure(error, arrType)` already provides the required safe
mapping for HTTP 0/unreachable, 401/403 unauthorized, timeouts, rejected
requests, server errors, and internal failures.

Proceed should return a typed conflict response when evidence is
absent/unavailable (409 fits invalid rollout state; 422 is already reserved for
stale tokens). The GET detail response must always expose enough durable
evidence for the UI to explain why Proceed is disabled.

## Constraints and Safety Policy

- The evidence target IDs must exactly equal the persisted `remainingTargets`
  IDs, with no silent filtering or sibling-Arr fallback.
- Revalidate that every target is enabled and resolves to `rollout.arrType`;
  disappearance or type drift makes evidence unavailable.
- Generate targets independently so one failure does not erase successful
  evidence or obscure which target failed.
- Available-with-zero-changes is promotable because the read succeeded for every
  target; unavailable and partial evidence are not.
- `proceedRollout()` must check evidence server-side immediately before the
  value-guarded `awaiting_confirmation -> rolling_out` update. UI disabling is
  supplementary.
- `abortRollout()` remains valid for unavailable evidence so operators can
  safely terminate the staged rollout.

## Exact Code Paths

- `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`: replace
  `buildRemainingPreview()`, persist evidence, and enforce proceed
  authorization.
- `packages/praxrr-app/src/lib/server/sync/canary/types.ts`: add evidence unions
  and extend row/detail/start contracts.
- `packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts`: reuse
  `classifyPreviewFailure`; do not create message-based classification.
- `packages/praxrr-app/src/lib/server/db/migrations/20260722_add_canary_preview_evidence.ts`
  and `db/migrations.ts`: add/register the column.
- `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`: serialize,
  parse, validate, project, persist, and guard evidence.
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`,
  `[id]/+server.ts`, and `[id]/proceed/+server.ts`: return the contract and map
  fail-closed promotion errors.
- `packages/praxrr-app/src/routes/canary/[id]/+page.server.ts` and
  `+page.svelte`: render per-target evidence; show explicit no-changes versus
  unavailable states; disable Proceed only for unavailable evidence while
  retaining Abort.
- `docs/api/v1/schemas/canary.yaml`, `docs/api/v1/paths/canary.yaml`, generated
  OpenAPI/API types: keep portable and runtime contracts aligned.
- Extend `tests/sync/canaryCoordinator.test.ts`,
  `tests/db/canaryMigration.test.ts`, `tests/db/canaryQueries.test.ts`,
  `tests/routes/canary.test.ts`, and detail-page source/behavior tests.

## Options and Recommendation

Keeping previews response-only is the smallest change but fails across redirect,
refresh, another operator session, and server restart. Regenerating previews on
each detail GET is durable only in appearance: it makes a read endpoint
network-dependent and lets evidence drift after the gate token was issued.
Persisting a single evidence snapshot is the recommended option because the
operator sees the same facts that `proceedRollout()` evaluates.

Tests should cover all-zero-change success, unreachable and unauthorized single
targets, a partial cohort with one success and one failure, malformed legacy
evidence, exact target-ID mismatch, proceed rejection without consuming the
gate, and abort success from every unavailable case.

## Open Questions

Should operators have an explicit “regenerate preview” action? If added, it must
recompute the complete cohort, persist a new evidence snapshot, and rotate
`stateToken` so an older view cannot proceed. Also decide whether legacy
awaiting-confirmation rows should be automatically marked unavailable or require
abort/restart; they must not be grandfathered into promotion.
