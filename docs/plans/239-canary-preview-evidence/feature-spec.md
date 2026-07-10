# Feature Spec: Canary Remaining-Target Preview Evidence

## Executive Summary

Issue #239 makes the Canary verification gate truthful when previewing remaining
targets fails. The current coordinator converts any thrown preview failure to an
empty array, so API consumers and the UI cannot distinguish a complete no-change
preview from unavailable evidence. The implementation will persist a versioned
`available`/`unavailable` evidence union on each rollout, reuse the existing
safe Sync Preview failure classifier, expose the same contract through
start/detail APIs, and require available exact-target evidence before Proceed
can enqueue work. Confirmed canary execution evidence, exact Arr scoping,
state-token guards, and Abort-without-rollback behavior remain unchanged.

## External Dependencies

### APIs and Services

No new service is required. Preview generation continues to use Praxrr's
existing Radarr, Sonarr, and Lidarr clients for the explicitly selected
`arrType` cohort.

### Libraries and SDKs

No dependency is added. Native TypeScript discriminated unions, SQLite JSON
text, Svelte conditional rendering, and the existing OpenAPI generation pipeline
cover the feature.

### External Documentation

- [OpenAPI Specification 3.1.1 - Discriminator Object](https://spec.openapis.org/oas/v3.1.1.html#discriminator-object):
  portable `oneOf` contract guidance.
- [OpenAPI Specification 3.1.1 - Schema Object](https://spec.openapis.org/oas/v3.1.1.html#schema-object):
  required properties and constant discriminator values.

## Business Requirements

### User Stories

**Primary user: Praxrr operator**

- As an operator, I want to know whether all remaining targets were previewed so
  that missing evidence never looks like a safe no-op.
- As an operator, I want a safe reason and recovery action for unreachable,
  unauthorized, and partial preview failures so that I can recover without
  seeing secrets or raw Arr errors.
- As an operator, I want Proceed blocked when evidence is ambiguous while Abort
  remains available so that no remaining instance is mutated without review.
- As an operator, I want the completed canary's actual evidence to remain
  visible independently of planned remaining-target evidence.

**Secondary user: API consumer**

- As an API consumer, I want a required discriminator so that array length is
  never used to infer evidence availability.
- As an API consumer, I want exact same-Arr target identity in the evidence so
  that sibling Arr applications cannot be inferred or substituted.

### Business Rules

1. **Explicit availability**: remaining-preview evidence is either `available`
   or `unavailable`; exceptions, missing data, or malformed data never become an
   empty success.
2. **Complete means exact**: `available` requires one preview for every
   persisted remaining target, no extra/duplicate target, matching `arrType`,
   and no failed section outcome.
3. **Zero changes are valid**: a complete preview whose summaries contain zero
   mutations is `available` and may be described as no changes.
4. **Partial is unavailable**: any target or section failure makes the aggregate
   unavailable. Successful pieces may be retained for diagnosis but cannot
   authorize promotion.
5. **Safe evidence only**: unavailable evidence carries the closed
   `SyncPreviewFailureReason` `{ code, message, recoveryAction }`; raw exception
   text, response bodies, URLs, keys, and stacks never cross the logger
   boundary.
6. **Server-authoritative promotion**: Proceed requires `awaiting_confirmation`,
   a current `stateToken`, and persisted available evidence whose target set
   equals `remainingTargets`; otherwise no job is enqueued.
7. **Abort is independent**: Abort remains available for any
   `awaiting_confirmation` rollout. It prevents remaining-target dispatch and
   does not roll back the canary.
8. **Confirmed evidence is preserved**: preview failure does not erase or
   relabel `canaryStatus`, `canarySyncHistoryId`, canary section/entity
   outcomes, output, or error.
9. **Exact Arr scope**: evidence and promotion resolve only the rollout's
   explicit `radarr`, `sonarr`, or `lidarr` targets. No sibling fallback or
   inferred mapping is allowed.
10. **Legacy/corrupt data fails closed**: null, unsupported-version, invalid
    JSON, invalid failure code, target mismatch, or invalid preview content is
    exposed as unavailable and cannot proceed.

### Edge Cases

| Scenario                                                        | Expected behavior                    | Notes                                       |
| --------------------------------------------------------------- | ------------------------------------ | ------------------------------------------- |
| Complete preview with zero mutations                            | `available`; UI says no changes      | Proceed and Abort remain enabled            |
| Batch throws with HTTP status 0                                 | `unavailable` / `unreachable`        | Safe recovery copy only                     |
| Batch throws with HTTP 401/403                                  | `unavailable` / `unauthorized`       | No API key or response body leaks           |
| Returned preview has a failed section                           | `unavailable` / `sectionErrors`      | Returned successful data is diagnostic only |
| Persisted target is missing, disabled, duplicated, or wrong Arr | `unavailable`                        | Never silently drop or substitute it        |
| Legacy row has null evidence                                    | `unavailable` / safe internal reason | Abort is still possible                     |
| Canary fails or partial-abort policy fires                      | Existing terminal abort behavior     | Remaining preview is not generated          |
| Stale Proceed token                                             | Existing 422 response                | Availability does not weaken token guard    |
| Proceed after Abort or wrong lifecycle state                    | Existing 409 response                | No enqueue                                  |

### Success Criteria

- [ ] No exception or partial failure is represented as an empty successful
      preview.
- [ ] Start/detail API and UI distinguish available-with-changes,
      available-with-no-changes, and unavailable.
- [ ] Unavailable evidence includes a typed safe reason and actionable recovery
      copy.
- [ ] Proceed cannot enqueue while evidence is absent, corrupt, partial,
      unavailable, cross-Arr, or target-mismatched.
- [ ] Abort remains usable and explicitly does not imply rollback.
- [ ] Confirmed canary execution evidence remains independently visible.
- [ ] Tests cover unreachable, unauthorized, partial-section, zero-change,
      exact-target, same-Arr, stale-token, and abort behavior.

## Technical Specifications

### Architecture Overview

```text
POST /api/v1/canary/rollouts
  -> resolveCanary(exact arrType cohort)
  -> persist canary_running row
  -> execute/classify canary and retain Sync History evidence
  -> buildRemainingPreviewEvidence(exact persisted targets)
       -> available: complete previews + generatedAt
       -> unavailable: safe failure + optional diagnostic previews
  -> guarded recordCanaryOutcome(status + token + evidence)
  -> start response / detail GET expose the same persisted evidence

Detail UI
  -> confirmed canary execution panel
  -> planned remaining-target evidence panel
  -> Proceed enabled only for available evidence
  -> Abort enabled for every awaiting-confirmation gate

POST /proceed
  -> re-read rollout
  -> validate status + available evidence + exact target set
  -> value-guarded stateToken transition
  -> enqueue existing resumable rollout job
```

### Data Models

#### `canary_rollouts`

| Field                        | Type   | Constraints   | Description                                                                                     |
| ---------------------------- | ------ | ------------- | ----------------------------------------------------------------------------------------------- |
| `remaining_preview_evidence` | `TEXT` | nullable JSON | Versioned available/unavailable snapshot; null for legacy/in-progress rows and never promotable |

Migration `20260723_add_canary_preview_evidence.ts` adds the column and is
registered after `20260721`. The reference `schema.sql` is updated for parity.
Existing rows remain null; historical lifecycle facts are not rewritten.

#### `CanaryRemainingPreviewEvidence`

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

The persisted decoder validates version, discriminator, safe failure shape,
preview identity, explicit `arrType`, duplicate IDs, cardinality, and exact
equality with `remainingTargets`. Any invalid condition returns a safe
unavailable read model and never an available default.

### API Design

#### `POST /api/v1/canary/rollouts`

The `skipped: true` arm is unchanged. The gated arm returns the rollout, whose
`remainingPreview` field is the persisted discriminated evidence; a separate
transient raw array is removed.

```json
{
  "skipped": false,
  "rollout": {
    "id": 42,
    "arrType": "radarr",
    "status": "awaiting_confirmation",
    "remainingPreview": {
      "version": 1,
      "availability": "available",
      "generatedAt": "2026-07-10T12:00:00.000Z",
      "previews": []
    }
  }
}
```

Unavailable example:

```json
{
  "version": 1,
  "availability": "unavailable",
  "generatedAt": "2026-07-10T12:00:00.000Z",
  "failure": {
    "code": "unauthorized",
    "message": "The Radarr instance rejected the API key.",
    "recoveryAction": "Update the API key for this instance in its settings, then regenerate the preview."
  },
  "partialPreviews": []
}
```

#### `GET /api/v1/canary/rollouts/{id}`

Returns `CanaryRolloutDetail` including required `remainingPreview`. Legacy/null
or malformed stored evidence is serialized as safe unavailable evidence, not
omitted or `[]`.

#### `POST /api/v1/canary/rollouts/{id}/proceed`

| Status | Condition                                                      | Response                   |
| ------ | -------------------------------------------------------------- | -------------------------- |
| 200    | Available exact-target evidence and current token              | Updated rollout            |
| 400    | Invalid ID/body/token shape                                    | Existing error envelope    |
| 404    | Unknown rollout                                                | Existing error envelope    |
| 409    | Wrong lifecycle state or remaining preview unavailable/invalid | Safe error; no enqueue     |
| 422    | Stale state token                                              | Existing stale-token error |

The server never trusts a client availability flag. Abort behavior and status
codes remain unchanged.

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/db/migrations/20260723_add_canary_preview_evidence.ts`:
  nullable evidence column.

#### Files to Modify

- `packages/praxrr-app/src/lib/server/sync/canary/types.ts`: evidence union and
  rollout/start contracts.
- `packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`:
  build/classify/persist evidence and fail-closed Proceed policy.
- `packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`: strict JSON
  round-trip and atomic outcome/evidence write.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`: register
  migration 20260723.
- `packages/praxrr-app/src/lib/server/db/schema.sql`: reference schema parity.
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/+server.ts`: updated
  gated response documentation/contract.
- `packages/praxrr-app/src/routes/api/v1/canary/rollouts/[id]/proceed/+server.ts`:
  safe unavailable mapping while preserving stale/wrong-state mappings.
- `packages/praxrr-app/src/routes/canary/[id]/+page.svelte`: distinct planned
  evidence states and disabled Proceed/enabled Abort behavior.
- `docs/api/v1/schemas/canary.yaml`, `docs/api/v1/paths/canary.yaml`, and
  `docs/api/v1/openapi.yaml`: portable schema and component wiring.
- Generated API artifacts under `packages/praxrr-api/` and
  `packages/praxrr-app/src/lib/api/v1.d.ts` via repo generators.
- `packages/praxrr-app/src/tests/db/canaryMigration.test.ts`,
  `packages/praxrr-app/src/tests/db/canaryQueries.test.ts`,
  `packages/praxrr-app/src/tests/sync/canaryCoordinator.test.ts`, and
  `packages/praxrr-app/src/tests/routes/canary.test.ts`: migration, persistence,
  policy, route, and UI-source coverage.
- `ROADMAP.md`: mark issue #239 implemented by the resulting PR.

### Configuration

No configuration or environment variable changes.

## UX Considerations

### User Workflows

#### Primary Workflow: Complete Preview

1. Operator starts a rollout and the canary runs.
2. Detail page shows confirmed canary diagnostics separately from planned
   remaining-target evidence.
3. Available evidence shows exact target names, generation time, and planned
   changes.
4. A complete zero-mutation result says `Available - No changes`; it never says
   unavailable.
5. Proceed and Abort are enabled; Proceed confirmation retains target count.

#### Error Recovery Workflow

1. Preview generation throws or returns a failed section.
2. Detail page shows `Remaining preview unavailable`, safe message, and a
   labeled recovery action.
3. Proceed remains visible but disabled with persistent explanatory text and
   `aria-describedby`.
4. Abort remains enabled. Its confirmation says remaining instances are
   untouched and the canary is not rolled back.
5. Because in-place retry is out of scope, recovery copy directs the operator to
   abort, correct the issue, and start a new rollout.

### UI Patterns

| State                     | Pattern                                             | Action state                    |
| ------------------------- | --------------------------------------------------- | ------------------------------- |
| Available with changes    | Positive status plus planned-change summaries/diffs | Proceed + Abort enabled         |
| Available with no changes | Complete/no-changes status, target list, timestamp  | Proceed + Abort enabled         |
| Unavailable               | Danger panel with safe failure and recovery         | Proceed disabled; Abort enabled |
| Partial diagnostics       | Explicit incomplete label; never called reviewed    | Proceed disabled; Abort enabled |

### Accessibility Requirements

- Use text/icons in addition to color for availability.
- Use native disabled behavior plus visible explanatory text linked by
  `aria-describedby`.
- Keep target names in a semantic list and expandable details keyboard-operable.
- Use `role="alert"` only for new request failures; loaded evidence uses
  ordinary status semantics.
- Preserve focus after failed actions or refresh.

### Performance UX

- Detail loads persisted evidence; it does not regenerate through GET.
- Render summary counts before optional per-target details for larger cohorts.
- Never flash an empty state while evidence is loading.

## Recommendations

### Implementation Approach

**Recommended strategy:** persist one authoritative, canary-specific evidence
snapshot and enforce it server-side. Keep the wrapper/policy local to Canary
while reusing Sync Preview failure classification and generated contract
tooling.

**Phasing:**

1. **Foundation:** types, migration, strict persistence decoder, OpenAPI
   contract.
2. **Policy:** coordinator evidence builder, atomic outcome/evidence recording,
   fail-closed Proceed.
3. **Surface and verification:** detail UI, route contracts, focused tests,
   generated types, ROADMAP.

### Technology Decisions

| Decision           | Recommendation                       | Rationale                                             |
| ------------------ | ------------------------------------ | ----------------------------------------------------- |
| Evidence lifetime  | Persist versioned JSON on rollout    | Survives redirect/reload and is the reviewed evidence |
| Failure vocabulary | Reuse `SyncPreviewFailureReason`     | Closed, safe, already portable                        |
| Promotion policy   | Available exact-target evidence only | Makes the gate enforceable for all clients            |
| Recovery           | Abort/correct/restart in this issue  | Avoids expanding scope into retry/token rotation      |
| Dependencies       | Add none                             | Existing primitives are sufficient                    |

### Quick Wins

- Replace the broad `catch { return [] }` with typed classification.
- Remove UI wording that calls the canary's historical diff a remaining-target
  preview.
- Reuse existing failure copy and 409 state-error route handling.

### Future Enhancements

- In-place preview retry with atomic evidence replacement and token rotation.
- Explicit `targetChanged` failure code if existing safe copy proves
  insufficient.
- Freshness/expiry policy and optional Proceed-time regeneration.

## Risk Assessment

### Technical Risks

| Risk                                    | Likelihood | Impact | Mitigation                                                |
| --------------------------------------- | ---------- | ------ | --------------------------------------------------------- |
| Legacy/corrupt JSON defaults to success | Medium     | High   | Strict fail-closed decoder; null never promotable         |
| Partial section failures look empty     | Medium     | High   | Inspect every `sectionOutcome.failure`                    |
| Target drift silently shrinks scope     | Medium     | High   | Exact persisted target-set equality; no substitution      |
| Status and evidence diverge             | Low        | High   | Persist in the same guarded outcome transition            |
| Full preview payload increases DB size  | Medium     | Medium | Reuse bounded preview payload; retention is separate      |
| Generated and runtime contracts drift   | Medium     | High   | Update OpenAPI first, regenerate types, test exact shapes |

### Integration Challenges

- Existing canary OpenAPI references `SyncPreviewResult` while runtime returns
  `GeneratePreviewResult`; define a Canary schema matching the actual persisted
  runtime shape.
- Existing array JSON parsing intentionally falls back to `[]`; evidence parsing
  must use a separate strict decoder.
- UI currently renders canary Sync History changes as remaining preview; keep
  actual and planned evidence as separate panels.

### Security Considerations

#### Critical - Hard Stops

| Finding                                        | Risk                     | Required mitigation                                     |
| ---------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| Ambiguous preview authorizes fleet writes      | Promotion without review | Server-side available/exact-target evidence gate        |
| Silent target dropping changes protected scope | Unreviewed cohort        | Treat missing/disabled/wrong-Arr targets as unavailable |

#### Warnings - Must Address

| Finding                                  | Risk                           | Mitigation                                                            | Alternatives                             |
| ---------------------------------------- | ------------------------------ | --------------------------------------------------------------------- | ---------------------------------------- |
| Partial sections masquerade as no change | False safety claim             | Aggregate section failures                                            | None compatible with acceptance criteria |
| Raw Arr errors leak secrets              | Credential/internal exposure   | Persist only closed safe reasons; raw data in sanitized metadata only | Generic internal reason                  |
| Async state race                         | Proceed after Abort/stale view | Preserve final atomic status/token guard                              | Proceed-time regeneration deferred       |

#### Advisories - Best Practices

- Exhaustively switch on the discriminator; malformed/unknown versions become
  unavailable.
- Add secret-shaped regression fixtures and assert they never reach
  API/persistence/UI.
- Keep a static logger message and put raw errors only in sanitized metadata.

## Task Breakdown Preview

### Phase 1: Contract and Persistence

**Focus:** create the durable source of truth.

- Define evidence types and strict validation helpers.
- Add/register migration and query round-trip support.
- Update OpenAPI schema and generated contract artifacts.

**Parallelization:** OpenAPI schema work can begin after the TypeScript shape is
agreed while migration/query tests proceed independently.

### Phase 2: Coordinator and Gate Policy

**Focus:** build safe evidence and enforce it.

- Refactor remaining preview generation to produce the union.
- Persist evidence with the canary outcome.
- Reject unavailable/invalid evidence before transition/enqueue.
- Add unreachable, unauthorized, partial, zero-change, and exact-target tests.

**Dependencies:** Phase 1 evidence types and persistence contract.

### Phase 3: API, UI, Documentation, and Validation

**Focus:** make states visible and prove acceptance criteria.

- Update route/detail UI behavior and route tests.
- Update ROADMAP and API documentation.
- Run focused issue tests, migration/query tests, generated-type checks,
  `deno task check`, and broader relevant validation.
- Run `graphify update .` after code changes.

## Decisions Needed

No user decision is required before planning. The design resolves the open
choices as follows:

1. **Persistence:** store full, versioned evidence so the detail page and
   Proceed enforce the same reviewed snapshot.
2. **Failure detail:** retain an aggregate safe reason and optional diagnostic
   previews; partial evidence is never promotable.
3. **Recovery:** use Abort/correct/restart; in-place retry is a follow-up.
4. **Target changes:** use the existing safe catch-all for this issue while
   enforcing unavailable; add a new code only if implementation proves current
   recovery copy misleading.
5. **Legacy rows:** expose unavailable and allow Abort; do not rewrite
   historical rollout facts.

## Research References

- [research-external.md](./research-external.md): OpenAPI and existing contract
  reuse.
- [research-business.md](./research-business.md): business rules and state
  transitions.
- [research-technical.md](./research-technical.md): persistence and architecture
  details.
- [research-ux.md](./research-ux.md): exact visual and accessibility states.
- [research-security.md](./research-security.md): severity-classified safety
  findings.
- [research-practices.md](./research-practices.md): KISS, reuse, and test seams.
- [research-recommendations.md](./research-recommendations.md): scoped
  implementation strategy and risks.
