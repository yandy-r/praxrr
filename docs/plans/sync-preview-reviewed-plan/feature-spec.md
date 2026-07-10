# Feature Spec: Sync Preview Reviewed-Plan Binding

## Executive Summary

Issue #234 makes Sync Preview confirmation authorize only the instance, Arr family, sections,
configuration, desired PCD state, and live Arr state the operator reviewed. Praxrr will keep a private,
versioned binding in the TTL preview store, then re-materialize separate PCD and Arr evidence at the
execution boundary before any write. A mismatch fails closed with a typed reason naming PCD, Arr, both,
scope, or unverifiable evidence and directs regeneration. The change reuses existing per-Arr syncers,
preview diffs, lifecycle and claim guards, generated contracts, outcome/history correlation, and UI
without adding dependencies or sibling-Arr fallbacks.

## External Dependencies

### APIs and Services

#### Praxrr Sync Preview API

- **Documentation**: `docs/api/v1/paths/sync.yaml`, `docs/api/v1/schemas/sync.yaml`
- **Authentication**: Existing Praxrr session/API-key middleware; no new auth surface.
- **Key Endpoints**:
  - `POST /api/v1/sync/preview`: Creates the reviewed preview and private binding.
  - `GET /api/v1/sync/preview/{previewId}`: Returns the public reviewed diff, never private evidence.
  - `POST /api/v1/sync/preview/{previewId}/apply`: Claims and revalidates the reviewed plan.
- **Rate Limits**: Existing per-instance create limit, body limit, capacity, and TTL remain unchanged.
- **Pricing**: Local/self-hosted; no paid service.

#### Arr APIs

- **Documentation**:
  - [Radarr API](https://radarr.video/docs/api/)
  - [Sonarr API](https://sonarr.tv/docs/api/)
  - [Lidarr API](https://lidarr.audio/docs/api/)
- **Authentication**: Existing `X-Api-Key` header through explicit Arr clients.
- **Key Endpoints**: Existing configuration reads/writes for custom formats, quality profiles, delay
  profiles, naming/media management, quality definitions, and Lidarr metadata profiles.
- **Rate Limits**: No universal limit is advertised in the published OpenAPI contracts.
- **Pricing**: Self-hosted; no API pricing.
- **Concurrency constraint**: Published contracts do not guarantee `ETag`/`If-Match` on these resources;
  Praxrr must re-read material state immediately and fail closed rather than assume cross-Arr parity.

### Libraries and SDKs

| Library    | Version         | Purpose                              | Installation |
| ---------- | --------------- | ------------------------------------ | ------------ |
| Web Crypto | Deno 2 built-in | SHA-256 review-evidence fingerprints | None         |

No Arr SDK, stable-stringify library, or hashing dependency will be added. Explicit bounded projections
are safer than generic serialization for this internal integrity boundary.

### External Documentation

- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html): Conflict and conditional request semantics.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html): Canonical JSON design guidance.
- [Deno SubtleCrypto.digest](https://docs.deno.com/api/web/~/SubtleCrypto.digest): Built-in SHA-256.

## Business Requirements

### User Stories

**Primary User: Arr operator**

- As an operator, I want Apply to execute only the plan I reviewed so confirmation is meaningful.
- As an operator, I want to know whether PCD or live Arr evidence changed so I can recover safely.
- As an operator, I want exact section selection and Arr type preserved through validation and execution.

**Secondary User: Maintainer/auditor**

- As a maintainer, I want one typed, deterministic binding contract shared by preview and apply.
- As an auditor, I want a stale-plan rejection to prove no Arr write or confirmed outcome occurred.

### Business Rules

1. **Exact reviewed scope**: Bind instance ID, explicit `arrType`, ordered successful sections, effective
   section configuration, desired evidence, live Arr evidence, and material plan.
   - Validation: Apply may select only a non-empty subset of successfully reviewed sections.
   - Exception: Drift solely in an unselected section does not block the selected subset.
2. **Immediate authoritative revalidation**: Rebuild all selected evidence after the execution claim and
   before the first write; validate all sections before any section mutates.
3. **Separate evidence classes**: Desired/config/PCD and live Arr fingerprints remain independent so a
   response can name `pcd`, `arr`, or `both`.
4. **Deterministic material equality**: Bind entity identity, action, remote ID where material, field
   changes, normalized current/desired values, mappings, and section outcome—not summary counts alone.
5. **Fail closed**: Unknown binding versions, unreadable inputs, ambiguous mappings, scope changes, or
   comparison failures perform zero writes and require regeneration.
6. **Config fidelity**: Transient `sectionConfigs` used to generate the preview are reviewed executable
   state and must be retained, normalized, revalidated, and reused.
7. **Explicit Arr semantics**: Revalidation and execution dispatch by the exact stored `arrType`; no
   sibling-app fallback is permitted.
8. **Independent guards**: TTL, lifecycle, body/eligibility validation, and section claims remain
   mandatory even when evidence matches.
9. **Single use**: Only `ready` can be atomically claimed for apply; drift terminally invalidates it.
10. **Evidence/outcome separation**: Rejected review evidence creates no entity outcomes or Sync History
    run; only actual writes can confirm outcomes.

### Edge Cases

| Scenario                                   | Expected Behavior                       | Notes                              |
| ------------------------------------------ | --------------------------------------- | ---------------------------------- |
| PCD changes, Arr does not                  | `pcd_drift`, 422, zero writes           | Old diff remains read-only.        |
| Arr changes, PCD does not                  | `arr_drift`, 422, zero writes           | Name live Arr evidence.            |
| Both change                                | `pcd_and_arr_drift`, 422, zero writes   | Report both after full validation. |
| Inputs cannot be read/compared             | `unverifiable_review`, 422, zero writes | Never infer equality.              |
| Instance type/capability changes           | `scope_drift`, 422, zero writes         | Explicit Arr guard.                |
| One of several sections drifts             | Invalidate entire selected apply        | No partial execution.              |
| Preview expires while waiting              | Preserve expiry/stale rejection         | Never extend timestamps.           |
| Concurrent apply/sync claims section       | 409 conflict                            | Preserve the active claim.         |
| Same summary, different entities/fields    | Treat as drift                          | Summary equality is insufficient.  |
| Transient config differs from saved config | Use bound transient config or reject    | Never silently fall back.          |

### Success Criteria

- [ ] Apply revalidates every authoritative desired PCD/config and live Arr input for exact selected
      sections immediately before any write.
- [ ] Typed safe invalidation distinguishes PCD, Arr, both, scope, and unverifiable evidence.
- [ ] Exact section subset, instance ID, and explicit `arrType` reach validation and execution unchanged.
- [ ] PCD-only, Arr-only, combined, config, scope, TTL, and concurrent mutations execute zero writes.
- [ ] The UI says nothing was applied and directs regeneration/review.
- [ ] OpenAPI, runtime types/validators, handlers, and generated artifacts remain in lockstep.
- [ ] Focused issue tests and `deno task check` pass.

## Technical Specifications

### Architecture Overview

```text
POST preview
  -> generatePreview(exact sections + effective configs + evidence sink)
  -> public EntityChange diff + private versioned review binding
  -> SyncPreviewStore.completeGeneration(...)

POST apply
  -> parse exact eligible subset + TTL/lifecycle preflight
  -> SyncPreviewStore.claimReadyForApply(...)  [atomic ready -> applying]
  -> executeReviewedSyncJob(binding, exact subset)
       -> reload exact enabled instance + verify arrType/capability
       -> claim every selected section without overwriting active work
       -> regenerate all selected private PCD/Arr/plan evidence
       -> compare all selected evidence before any mutation
       -> mismatch: release/fail claims, terminal invalidation, zero writes
       -> match: run existing syncers with the same effective configs
  -> actual outcomes + Sync History correlation (only after execution)
```

### Data Models

#### Private `SyncPreviewReviewBinding`

| Field          | Type                                    | Constraints              | Description                  |
| -------------- | --------------------------------------- | ------------------------ | ---------------------------- |
| version        | `1`                                     | Closed literal           | Fails closed when unknown.   |
| instanceId     | `number`                                | Positive integer         | Exact reviewed instance.     |
| arrType        | `radarr\|sonarr\|lidarr`                | Explicit                 | No sibling fallback.         |
| sections       | `readonly SectionType[]`                | Ordered, unique          | Successfully reviewed scope. |
| sectionConfigs | `Partial<Record<SectionType, unknown>>` | Cloned/normalized        | Effective reviewed config.   |
| evidence       | `readonly SectionReviewEvidence[]`      | One per reviewed section | Private fingerprints.        |

#### Private `SectionReviewEvidence`

| Field    | Type          | Constraints | Description                              |
| -------- | ------------- | ----------- | ---------------------------------------- |
| section  | `SectionType` | Explicit    | Domain separator.                        |
| pcdHash  | `string`      | SHA-256 hex | Desired/config/materialization evidence. |
| arrHash  | `string`      | SHA-256 hex | Relevant current Arr evidence.           |
| planHash | `string`      | SHA-256 hex | Material plan/outcome determinism guard. |

The binding stays in the bounded in-memory preview store. No database migration is required; process
restart continues to invalidate previews safely.

### API Design

#### `POST /api/v1/sync/preview/{previewId}/apply`

**Purpose**: Apply an exact eligible subset only after reviewed evidence still matches.
**Authentication**: Existing route protection.

**Request:**

```json
{ "sections": ["qualityProfiles"] }
```

**Response (200):** Existing `SyncPreviewApplyResponse`, including actual outcomes/history only after
execution.

**Invalidation response (422):**

```json
{
  "error": "Reviewed sync preview is stale because live Arr configuration changed. Generate and review a new preview.",
  "code": "arr_drift",
  "changedEvidence": ["arr"],
  "changedSections": ["qualityProfiles"],
  "regenerateRequired": true,
  "staleWarning": null
}
```

| Status | Condition                             | Response                            |
| ------ | ------------------------------------- | ----------------------------------- |
| 404    | Missing/evicted preview               | Existing safe not-found error.      |
| 409    | Lifecycle or active-section conflict  | Safe retry/conflict response.       |
| 422    | TTL or reviewed evidence invalidation | Typed regenerate-required response. |
| 500    | Unexpected internal failure           | Sanitized generic error.            |

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts`: Canonical projections,
  fingerprints, comparison, and typed invalidation.
- Focused tests for the pure binding and reviewed executor, using the existing test layout.

#### Files to Modify

- `docs/api/v1/schemas/sync.yaml`, `docs/api/v1/paths/sync.yaml`: Contract-first invalidation schema.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`: Internal evidence/binding contracts.
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`: Private binding and atomic completion/claim.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`: Optional private evidence capture.
- `packages/praxrr-app/src/lib/server/sync/base.ts` and four concrete syncers: Exact evidence/config parity.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: Reviewed execution boundary and safe claims.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`: Persist private binding at completion.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`: Claim and reviewed execute.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`: Typed recovery state.
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`: Acceptance regressions.
- `ROADMAP.md`: Record issue #234 delivery and reviewed-plan guarantee.

#### Configuration

No new environment variables. Preserve preview TTL, capacity, rate limit, and request-size settings.

## UX Considerations

### User Workflows

#### Primary Workflow: Validate and Apply

1. User reviews the concrete diff, target Arr type, and selected sections.
2. Apply changes to “Validating reviewed preview…” and is disabled against duplicate submission.
3. The server either confirms the evidence and executes or rejects before any write.
4. Success continues to show actual outcomes separately from planned changes.

#### Error Recovery Workflow

1. Server returns a typed invalidation.
2. The old reviewed diff remains visible but non-applicable with `role="alert"` recovery text.
3. The panel states “Nothing was applied,” names PCD/live Arr/both/unverifiable evidence, and offers
   “Generate a new preview.”
4. The operator reviews the newly generated diff before a new Apply is possible.

### UI Patterns

| Component      | Pattern                         | Notes                                            |
| -------------- | ------------------------------- | ------------------------------------------------ |
| Apply button   | Existing disabled/loading state | Say validation, not execution, until matched.    |
| Recovery block | Persistent local alert          | Authoritative state; do not rely on toast alone. |
| Alert store    | Existing `alertStore.add`       | Supplemental safe feedback.                      |
| Old diff       | Read-only retained evidence     | No retry of invalidated preview.                 |

### Accessibility Requirements

- Recovery text uses `role="alert"` and receives a visible heading/action.
- Focus moves to the recovery region after invalidation without trapping keyboard users.
- Evidence class is conveyed in text, not color alone.
- Loading/disabled state retains a clear accessible name.

### Performance UX

- **Loading States**: One bounded “Validating reviewed preview…” state before writes.
- **Optimistic Updates**: None; never imply apply success before authoritative validation/execution.
- **Error Feedback**: Immediate typed recovery after response; preserve the old diff for context.

## Recommendations

### Implementation Approach

**Recommended Strategy**: Private versioned binding plus immediate authoritative revalidation through
the existing preview semantics, followed by existing writers using the same bound configuration.

**Phasing:**

1. **Foundation**: OpenAPI reason taxonomy, pure binding/fingerprint core, store atomics.
2. **Execution**: Evidence capture, config parity, all-section reviewed execution claim/revalidation.
3. **Recovery and proof**: Apply mapping, UI invalidation state, cross-Arr/concurrency regressions.

### Technology Decisions

| Decision          | Recommendation                               | Rationale                                                |
| ----------------- | -------------------------------------------- | -------------------------------------------------------- |
| Execution model   | Revalidate, then reuse existing writers      | Narrower than payload replay and preserves domain logic. |
| Transient configs | Bind and execute reviewed values             | Matches current preview UI promise.                      |
| Drift status      | 422 invalidation; 409 lifecycle/claim        | Preserves established route semantics.                   |
| Lifecycle         | Terminal `failed` with typed details         | No public state expansion required.                      |
| Fingerprinting    | Built-in SHA-256 + explicit projections      | Deterministic and dependency-free.                       |
| Claims            | Minimal all-selected claim, no pending reset | Prevents partial/racy validation.                        |

### Quick Wins

- Replace the apply dependency seam with an object-based `executeReviewedSyncJob` input.
- Add pure PCD/Arr/both comparison mutation tests before wiring every syncer.
- Route all reviewed sync paths through existing preview-aware config getters.

### Future Enhancements

- Durable multi-process preview claims, principal ownership, rejected-review audit events, generalized
  leases, and upstream conditional writes are follow-ups, not part of #234.

## Risk Assessment

### Technical Risks

| Risk                                             | Likelihood | Impact   | Mitigation                                                                       |
| ------------------------------------------------ | ---------- | -------- | -------------------------------------------------------------------------------- |
| Evidence projection omits a write-relevant field | Medium     | High     | Explicit per-section projections beside reads/writes; plan hash; mutation tests. |
| Later section drifts after earlier write         | Medium     | Critical | Claim and validate all selected sections before any mutation.                    |
| Existing pending reset overwrites active work    | Medium     | Critical | Dedicated claim path; concurrency regression.                                    |
| Revalidation and execution use different config  | Medium     | Critical | Store/reuse exact normalized `sectionConfigs`; config parity tests.              |
| External writer races after revalidation         | Low        | High     | Minimize interval and use immediate old-value guard where available.             |
| Volatile/order-only data causes false drift      | Medium     | Medium   | Sort only true sets; preserve semantic order; bounded projections.               |

### Integration Challenges

- `generatePreview()` is reused by drift/history/MCP callers; private evidence must remain optional and
  never leak into public results.
- Reviewed execution needs all selected claims before validation while ordinary sync behavior remains
  unchanged.
- OpenAPI, generated app types, packaged API artifacts, handler, and UI must change together.

### Security Considerations

#### Critical — Hard Stops

| Finding                                 | Risk                                     | Required Mitigation                                    |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| Apply is not bound to reviewed evidence | Unreviewed writes                        | Private binding plus pre-write revalidation.           |
| Existing claim reset can race           | Concurrent writes after stale validation | Never reset active state; acquire exact claims safely. |

#### Warnings — Must Address

| Finding                                | Risk                          | Mitigation                                               | Alternatives                            |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------- | --------------------------------------- |
| Raw evidence/errors leak configuration | Information disclosure        | Stable safe codes/messages; protected logs only.         | Return only class and bounded sections. |
| Instance/type rebinding                | Cross-Arr semantic corruption | Reload exact enabled instance and compare explicit type. | None; fail closed.                      |

#### Advisories — Best Practices

- Keep binding versioned and private; unknown versions require regeneration.
- Do not claim full external atomicity without upstream conditional-write support.

## Task Breakdown Preview

### Phase 1: Contract and Binding Foundation

**Focus**: Typed contract, canonical evidence, and atomic preview lifecycle.
**Tasks**:

- Define OpenAPI invalidation types and regenerate portable types.
- Add pure review-binding core and tests.
- Add private store completion/claim operations and tests.
  **Parallelization**: Contract and pure binding tests can begin independently, then converge in store wiring.

### Phase 2: Evidence and Reviewed Execution

**Focus**: Capture exact evidence and validate all selected sections before writes.
**Dependencies**: Phase 1 binding types.
**Tasks**:

- Add evidence capture to orchestrator/base/concrete syncers.
- Preserve reviewed section configuration in preview and sync paths.
- Add safe all-section claims and `executeReviewedSyncJob`.

### Phase 3: Route, UI, and Acceptance Proof

**Focus**: Typed recovery and regression coverage.
**Dependencies**: Phase 2 reviewed execution.
**Tasks**:

- Switch apply route to atomic claim/reviewed execution.
- Implement persistent UI invalidation/recovery.
- Cover PCD/Arr/both/config/scope/TTL/concurrency and all explicit Arr types.
- Update `ROADMAP.md`; run focused tests, check, lint, and full relevant suite.

## Decisions Needed

The workflow adopts these decisions for planning and implementation:

1. Immediate authoritative revalidation is preferred over executable payload replay.
2. Transient `sectionConfigs` are executable reviewed state and will be bound/reused.
3. Evidence invalidation uses 422; lifecycle/active-claim conflict uses 409.
4. Drift ends the preview in existing terminal `failed` state with typed details.
5. Config/source changes classify as PCD-side drift; target/type/capability changes are scope drift;
   unreadable or plan-only ambiguity is unverifiable review.
6. Pre-write invalidation creates no outcomes and no Sync History run.

## Research References

- [research-external.md](./research-external.md): Standards and external API constraints.
- [research-business.md](./research-business.md): Business rules and state transitions.
- [research-technical.md](./research-technical.md): Architecture and exact integration seams.
- [research-ux.md](./research-ux.md): Recovery, accessibility, and UI state.
- [research-security.md](./research-security.md): TOCTOU, claims, and safe error analysis.
- [research-practices.md](./research-practices.md): Reuse, KISS, and testability guidance.
- [research-recommendations.md](./research-recommendations.md): Consolidated approach and risks.
