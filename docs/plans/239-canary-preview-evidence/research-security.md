# Security Research: Canary Remaining-Preview Evidence

## Executive Summary

Issue #239 is a safety-control defect at a privileged mutation gate. Today,
`buildRemainingPreview()` catches any exception and returns `[]`, while
`proceedRollout()` authorizes promotion from only
`status === 'awaiting_confirmation'` plus a valid `stateToken`. Thus an empty,
complete preview and an unavailable preview are indistinguishable, and an
authenticated operator or API client can dispatch writes to the fleet without
the evidence the gate promises.

The fix should introduce authoritative, discriminated preview evidence:
`available` with complete per-target results, or `unavailable` with a typed,
safe `SyncPreviewFailureReason`. Promotion must fail closed unless availability
is proven server-side for the persisted exact target cohort; Abort must remain
usable. Reuse `classifyPreviewFailure()` and pre-authored recovery copy. Raw
exception messages, Arr responses, URLs, API keys, and stacks must never enter
API, database, or UI evidence; they may appear only as sanitized logger
metadata. No new dependency is required.

## Threat Surface and Trust Boundaries

- **Authorization:** Canary routes are protected by the global authentication
  hook, including `AUTH=off`/trusted-proxy and local-network bypass modes. There
  is no canary-specific role check, so every authenticated/bypassed principal
  has fleet-write authority. This issue should not weaken that boundary;
  deployments using bypass modes must treat their proxy/network as privileged.
- **Data:** `remaining_targets`, `arr_type`, `sections`, preview availability,
  failure reason, and `state_token` cross SQLite, API, and UI boundaries.
  Client-supplied availability is untrusted.
- **Inputs:** Start validates Arr type, section vocabulary, integer fields, and
  an 8 KiB body limit; Proceed validates ID/body/token shape. Semantic
  eligibility must still be revalidated server-side.
- **Infrastructure:** Preview generation reaches operator-configured Arr
  endpoints with bounded concurrency. Unreachable, slow, unauthorized, and
  changing targets are normal failure modes, not evidence of an empty plan.

## Dependency Security

Existing HTTP error types, preview classifier, logger sanitizer, SQLite guarded
updates, and generated OpenAPI types are sufficient. Adding a validation/state
library would add supply-chain surface without solving the authority problem.

## Findings

### CRITICAL

**C-1 — Promotion is ambiguous and fails open.** An exception, a target disabled
between selection and preview, and a genuinely empty result all collapse to
`[]`. Proceed does not inspect preview evidence and still enqueues
`sync.canary.rollout`.

**Mitigation:** Define a closed union such as
`{ availability: 'available', previews } | {
availability: 'unavailable', failure, partialPreviews }`.
“Available” requires cardinality and exact ID equality with the authoritative
eligible subset, matching `arrType` on every result, and no section failure.
Zero mutations remain available; missing results never do. Persist sufficient
evidence or regenerate it during Proceed. Before enqueue, re-fetch the rollout,
verify availability server-side, then perform the existing status/token guarded
transition. On failure, leave the row awaiting confirmation and enqueue nothing.

**C-2 — Target drift can silently reduce the protected scope.** The coordinator
intersects persisted targets with `getEnabled()` and drops missing/disabled IDs.
This is safe from writing to an invalid target but unsafe as promotion evidence:
a non-empty expected cohort can become an empty “success.”

**Mitigation:** Treat any missing, disabled, duplicated, extra, or wrong-Arr
target as unavailable, or explicitly persist a reviewed cohort revision and
require an operator restart. Never substitute a newly enabled instance. Assert
exact target-ID sets and explicit `radarr`/`sonarr`/`lidarr` equality in tests
and at the promotion boundary.

### WARNING

**W-1 — Partial section failures can masquerade as usable previews.**
`generatePreview()` normally captures section exceptions inside
`sectionOutcomes` and returns status `ready`; the outer catch is therefore
insufficient.

**Mitigation:** Aggregate every target outcome. Any non-null section failure
makes the whole gate unavailable, using
`buildPreviewFailure('sectionErrors', arrType)` while retaining successful
pieces only as clearly non-authoritative diagnostics. Do not calculate “no
changes” from the zeroed summary of failed sections.

**W-2 — Secret and internal-error leakage is possible if raw errors become
evidence.** Arr transport errors may contain API-key query parameters, URLs,
response bodies, resource names, or stack traces. The current classifier
correctly ignores messages and raw `HttpError.response`; logger metadata is
sanitized, but logger message strings themselves are not passed through
`sanitizeLogMeta`.

**Mitigation:** Transport and persist only the closed
`{ code, message, recoveryAction }` returned by
`classifyPreviewFailure()`/`buildPreviewFailure()`. Log the raw error only under
a metadata field; keep static log messages and closed identifiers in metadata.
Never interpolate thrown text, response bodies, URLs, tokens, or user-controlled
instance names into the log message. Add regression tests with API keys in query
strings, Authorization values, and hostile response text, asserting absence from
API, persisted evidence, UI data, and emitted sanitized logs.

**W-3 — Asynchronous revalidation can introduce a proceed/abort race.** If
Proceed regenerates a preview, the token/state may change while network work is
in flight.

**Mitigation:** Check state/token before generation for fast rejection, then
rely on a final atomic
`WHERE id = ? AND status = 'awaiting_confirmation' AND state_token = ?`
transition after successful evidence. Enqueue only after that transition
succeeds. Abort keeps the existing guarded path and must remain available
regardless of preview state.

### ADVISORY

**A-1 — Durable evidence parsing should not default corrupt data to success.**
Existing JSON helpers return `[]` on malformed stored arrays. Reusing that
behavior for availability would recreate the ambiguity after restart.

**Mitigation:** Parse preview evidence with a fail-closed decoder: invalid
discriminator, JSON, failure code, target ID, or Arr type becomes
`unavailable/internalError`, is logged sanitarily, and cannot authorize Proceed.
Keep OpenAPI, runtime types, migration/query DTOs, and generated types in
lockstep.

**A-2 — Availability can amplify endpoint load.** Promotion-time regeneration
adds Arr requests and can be repeatedly triggered by an authorized client.

**Mitigation:** Preserve bounded concurrency and transport timeouts; consider a
per-rollout in-flight guard or rate limit. Do not cache failure as success. Any
cache must bind evidence to target IDs, sections, Arr type, and a short
freshness window.

## Secure Coding and Verification Guidance

Use exhaustive discriminator switches and constructors so impossible
combinations cannot be created. Keep classification type/status-based, never
substring-based. Tests should cover unreachable, timeout, unauthorized, mixed
section failure, zero-change success, corrupt stored evidence, missing target,
cross-Arr injection, stale token, concurrent Abort/Proceed, no enqueue on
failure, and preservation of confirmed canary Sync History. UI tests must prove
Proceed is absent or disabled for unavailable evidence while Abort and explicit
non-rollback recovery guidance remain.

## Tradeoffs

Persisting full previews gives reloadable auditability but increases SQLite size
and stores entity configuration details longer. Persisting only typed
availability/failure is smaller but requires regeneration and careful race
handling. Regeneration at Proceed provides freshness but increases latency and
Arr load. In all designs, safety takes precedence: stale or incomplete evidence
blocks promotion rather than being treated as empty.

## Open Questions

1. Should complete evidence be persisted, or regenerated at every Proceed with
   only failure state persisted for the detail page?
2. Should target-set drift use a new closed `targetChanged` code, or
   conservative `internalError` copy instructing Abort and restart?
3. Should partial successful previews be shown, and if so how will the UI mark
   them as non-authoritative without encouraging promotion?
4. Does the product require role-based authorization for canary mutation routes
   beyond this issue, especially under `AUTH=local` and trusted-proxy
   deployments?
