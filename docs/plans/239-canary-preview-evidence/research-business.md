# Business Logic Research: Canary Remaining-Preview Evidence

## Executive Summary

Issue #239 closes a transparency gap at the Canary verification gate. Today, a
successful canary can leave the rollout in `awaiting_confirmation` even when
generation of the remaining-target preview throws: the coordinator catches the
exception and returns `[]`. API consumers can then interpret "preview
unavailable" as "preview available with no changes" and promote without the
evidence the gate is meant to provide.

The business contract must make remaining-preview availability explicit. A
complete preview may legitimately contain zero mutating changes; an unavailable
or partial preview means completeness was not proven. Promotion must fail closed
in the latter state. The user must still be able to abort, with clear guidance
that abort prevents writes to remaining targets but does not roll back the
canary writes already confirmed by Sync History. Confirmed canary execution
evidence remains valid and visible independently of any later remaining-preview
failure.

Because the UI navigates from the start response to `/canary/{id}`, evidence
needed at the gate must survive that navigation. Returning availability only in
the initial POST is insufficient for the current UI flow; the detail contract
needs an authoritative durable or otherwise reloadable availability result.

## User Stories

- As an operator, I want to know whether the remaining-target preview is
  complete, empty, partial, or unavailable so that I do not mistake missing
  evidence for a safe no-op.
- As an operator, I want a safe reason and recovery action for unreachable,
  unauthorized, or partially generated previews without exposing credentials,
  raw Arr responses, or internal errors.
- As an operator, I want Proceed disabled when preview completeness is
  ambiguous, while Abort remains available.
- As an operator, I want abort copy to state that the canary already ran and
  requires the existing snapshot/rollback workflow if I want to undo it.
- As an API consumer, I want a discriminated contract that cannot encode failure
  as an empty array.
- As a multi-Arr operator, I want every preview and rollout target to remain in
  the explicitly selected Radarr, Sonarr, or Lidarr cohort, with no sibling
  fallback.

## Business Rules

1. Remaining-preview evidence is separate from rollout lifecycle status and
   canary execution outcome. `awaiting_confirmation` does not itself prove
   preview availability.
2. The gated start/detail contract must discriminate `available` from
   `unavailable`; consumers must not infer availability from array length.
3. `available` means every currently required exact target and every
   requested/configured section completed without a failure outcome. Its
   previews may contain zero creates, updates, or deletes; that is the only
   state that may be presented as "no remaining changes."
4. `unavailable` means the system could not prove complete evidence. It carries
   a closed, typed, safe reason with a pre-authored message and recovery action.
   Raw exception text, API keys, URLs, response bodies, and stack traces remain
   confined to sanitized logs.
5. Reuse the existing Sync Preview failure vocabulary where semantics match:
   unreachable transport, timeout, unauthorized API key,
   rejected/not-found/server errors, `sectionErrors` for partial section
   generation, and `internalError` as the safe catch-all.
6. A result is unavailable when the multi-target operation throws after any
   amount of work or when any returned target preview contains a non-null
   section failure. Successful partial evidence may be retained for diagnosis,
   but it never upgrades the aggregate to available.
7. If a target is disabled/deleted between cohort selection and preview, the
   system must not replace it with another instance or silently collapse the
   preview to an empty success. The evidence is unavailable (or the target-set
   change is represented explicitly) until the operator starts or retries
   against an authoritative cohort.
8. Proceed is permitted only for an `awaiting_confirmation` rollout whose
   authoritative remaining-preview state is available. The proceed decision
   remains value-guarded by the exact current `stateToken`. Unavailable evidence
   returns a typed business rejection and enqueues no job.
9. Abort remains permitted from `awaiting_confirmation`, including when preview
   is unavailable. Abort means remaining targets are never dispatched; it does
   not undo the completed canary sync.
10. Preview failure must not erase or relabel the canary's actual status, linked
    Sync History ID, section results, entity changes/outcomes, output, or error.
    These are confirmed execution evidence; remaining preview is planned
    evidence.
11. Targeting remains exact: the rollout `arrType` is authoritative, every
    preview result must match it, and preview target IDs must derive only from
    the persisted same-Arr remaining cohort. No Sonarr/Radarr/Lidarr fallback or
    inferred cross-Arr mapping is allowed.

### Edge Cases

- A complete preview with all mutation counts zero is available/no changes, not
  unavailable.
- An empty preview for a non-empty expected cohort is never evidence of no
  changes.
- A canary failure or partial-canary abort policy stops before remaining preview
  and remains a terminal canary decision, not a preview failure.
- Stale tokens, duplicate Proceed, and Proceed after Abort retain existing
  422/409 semantics and do not dispatch remaining targets.

## Workflows

### Complete Preview and Promotion

1. Resolve the canary and exact same-Arr cohort; run and persist the canary
   outcome.
2. Generate previews for every remaining target and requested section.
3. Record/return `available` with the complete target evidence, even when the
   mutation total is zero.
4. The detail UI labels the evidence as available and enables Proceed and Abort.
5. Proceed validates availability plus `stateToken`, transitions to
   `rolling_out`, and enqueues the existing resumable job.

### Preview Failure and Recovery

1. The canary succeeds, but a target is unreachable/unauthorized or a section
   fails.
2. Preserve the confirmed canary evidence and hold the rollout at
   `awaiting_confirmation`.
3. Record/return `unavailable` with the typed safe reason and recovery action;
   show no "no changes" claim and disable Proceed.
4. The operator corrects connectivity/credentials/configuration. If no in-place
   retry is delivered, guidance must say to Abort and start a new rollout; a
   future retry action must regenerate the exact same-Arr cohort and refresh the
   gate token/evidence atomically.
5. Abort remains usable and explicitly states that it does not roll back the
   canary.

## Domain Model and State Transitions

- **Canary execution evidence:** confirmed job/Sync History facts for the canary
  instance.
- **Remaining-preview evidence:** planned, read-only evidence for exact
  remaining targets.
- **Availability:** `available` with complete previews, or `unavailable` with a
  typed safe failure.
- **Verification gate:** the conjunction of `status=awaiting_confirmation`,
  available evidence, and a current state token.

```text
canary_running -> aborted                         (canary did not pass; no remaining dispatch)
canary_running -> awaiting_confirmation + available
canary_running -> awaiting_confirmation + unavailable
awaiting_confirmation + available -> rolling_out (Proceed + current token)
awaiting_confirmation + unavailable -> unchanged (Proceed rejected)
awaiting_confirmation + either -> aborted        (Abort; no rollback)
rolling_out -> completed | failed
```

## Existing Codebase Integration

- `sync/canary/coordinator.ts` currently catches remaining-preview exceptions
  and returns `[]`; it also owns the fail-closed Proceed/Abort policy.
- `sync/canary/types.ts`, Canary OpenAPI source schemas, generated API types,
  and runtime responses must share the same discriminator and required
  safe-reason fields.
- `sync/preview/failureReason.ts` already provides closed, redacted failure
  classification; partial `sectionOutcomes` from `preview/orchestrator.ts` must
  also affect aggregate availability.
- `canaryRollouts.ts` and the rollout detail API/page are the reload boundary.
  The current page uses the canary Sync History diff as a representative
  remaining preview and does not receive the POST's live preview, so it must
  render explicit availability separately from confirmed canary evidence.
- Coordinator and route tests must add unreachable, unauthorized, and
  partial-section cases, assert exact target IDs/Arr types, verify Proceed
  enqueues nothing while unavailable, and verify Abort remains successful
  without changing canary evidence.

## Success Criteria

- [ ] No preview exception or partial failure is represented as an empty
      successful preview.
- [ ] API and UI distinguish available/no changes from unavailable and show safe
      recovery guidance.
- [ ] Promotion is impossible while preview evidence is unavailable; no rollout
      job is enqueued.
- [ ] Abort remains available and clearly means "spare remaining targets," not
      rollback.
- [ ] Confirmed canary evidence survives and remains independently visible after
      preview failure.
- [ ] Unreachable, unauthorized, partial, zero-change, and stale-token tests are
      deterministic.
- [ ] Tests assert exact same-Arr target IDs and prove no sibling instance is
      previewed or dispatched.

## Open Questions

1. Should recovery be Abort-and-restart only, or should this issue add an
   in-place preview retry?
2. Should durable detail store the full bounded preview payload or only
   availability/failure plus a regenerated read model? The chosen approach must
   remain authoritative across reloads.
3. Should a mid-gate disabled/deleted target use a new `targetChanged` safe code
   or an existing closed Sync Preview code? The recovery copy should direct the
   operator to refresh the cohort.
4. When partial evidence exists, should the UI show successful target previews
   under an explicit "incomplete" banner, or hide details until a complete
   retry? Either choice must keep Proceed off.
