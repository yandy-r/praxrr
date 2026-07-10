# Business Research: Bind Sync Apply to the Reviewed Plan

## Executive Summary

Issue #234 closes a trust gap in Sync Preview. Today Praxrr shows a user a concrete desired/current
diff, but `POST /api/v1/sync/preview/{previewId}/apply` ultimately calls `executeSyncJob(instanceId,
sections, 'manual', previewId)`. The sync job then reloads the instance, saved section configuration,
desired PCD data, and live Arr state. The `previewId` provides plan-to-run correlation, but it does not
bind the run to the evidence the user reviewed. A changed PCD, changed live Arr entity, changed instance
type, changed saved selection, or preview generated from an unsaved `sectionConfigs` override can
therefore produce materially different writes without another review.

The business promise for this feature is simple: **the Apply Preview confirmation authorizes only the
reviewed plan for the reviewed instance, Arr family, and selected sections.** It does not authorize
whatever a new sync calculation happens to produce later. Praxrr may satisfy that promise by executing
an immutable reviewed plan or by re-reading every authoritative input immediately before execution and
proving that it still produces the same material plan. Given the current syncers already own the
per-Arr transforms and write behavior, immediate revalidation through the same preview generation path
is the lower-risk product model: compare a deterministic reviewed evidence contract, then enter the
normal write path only on an exact material match.

This is an optimistic concurrency boundary, not a general locking system. Existing preview TTL, stale
age warning/block behavior, section eligibility checks, and per-section claim guards remain independent
gates. Passing one gate never compensates for failing another. PCD drift and live Arr drift require
distinct typed stale reasons, no sync section may be claimed or executed after a mismatch, and recovery
always requires generating and reviewing a new preview. A materially changed input is never
automatically accepted, even if the resulting change seems small, beneficial, or still targets the
same named entity.

## User Stories

### Primary users

1. **Safety-conscious operator**
   - As an operator, I want Apply Preview to perform only the changes I reviewed, so confirmation has a
     stable meaning.
   - As an operator, I want Praxrr to name whether desired PCD evidence or live Arr evidence changed, so
     I know what invalidated my review.
   - As an operator, I want a stale preview to remain inspectable but not executable, so I can understand
     the old decision before regenerating it.

2. **User editing sync configuration**
   - As a user previewing unsaved section selections, I want Praxrr to prevent an apply that silently
     falls back to different saved selections.
   - As a user who intentionally selected one section, I want validation and execution to stay scoped to
     that exact section, without adjacent sections being added during apply.

3. **Cross-Arr operator**
   - As a user managing Radarr, Sonarr, and Lidarr, I want the reviewed `arrType` to be revalidated
     explicitly, so a changed or ambiguous instance family cannot borrow sibling-Arr semantics.
   - As a Lidarr user, I want metadata-profile eligibility to remain Lidarr-specific through preview,
     validation, and execution.

4. **Administrator or auditor**
   - As an auditor, I want rejected stale plans to prove that no write execution started, rather than
     merely reporting a warning after a fresh sync ran.
   - As a support responder, I want stable reason codes and safe messages that distinguish PCD drift,
     Arr drift, scope drift, expiration, and concurrent claims.

### Maintainer stories

- As a maintainer, I want one canonical material-plan comparison shared by route tests and runtime, so
  new fields or sections cannot silently fall outside the review boundary.
- As a maintainer, I want preview and revalidation to reuse the same explicit section registry and
  per-Arr syncers, so validation does not become a second implementation of domain semantics.
- As a maintainer, I want a regression test to fail if `executeSyncJob` is called after any authoritative
  input mismatch.

## Business Rules

### Core rules

#### BR-1: Confirmation is scoped to a reviewed-plan identity

A valid reviewed plan is identified by all of the following:

- preview ID and lifecycle state;
- target `instanceId` and instance identity;
- explicit `arrType` (`radarr`, `sonarr`, or `lidarr` only);
- ordered, eligible selected sections;
- section-specific preview configuration used to resolve desired inputs;
- material desired PCD evidence for those sections; and
- material live Arr evidence used as each entity's `current` state.

The apply request may narrow the preview to a non-empty subset of successfully previewed sections, as
the current route permits, but it may not add, rename, or silently substitute sections. Revalidation and
execution must use the same final `sectionsToApply` value.

#### BR-2: Every authoritative input is revalidated at the final pre-write boundary

If Praxrr chooses revalidation rather than direct execution of an immutable plan, it must rebuild the
selected section previews from authoritative data immediately before execution. Validation is complete
only when it covers both evidence classes:

- **Desired/PCD evidence**: saved or reviewed section selections, resolved database/TRaSH source data,
  mappings, transforms, and the exact desired portable/Arr payload material to the plan.
- **Current/Arr evidence**: the live remote entities and fields used to calculate create/update/delete/
  unchanged decisions and value changes.

Rechecking only PCD, only live Arr, only summary counts, or only timestamps is insufficient. An input
change that happens after validation but before the first write must also fail closed; therefore the
comparison belongs inside the execution boundary, after concurrency eligibility is known and before a
syncer can perform its first mutation.

#### BR-3: Material equality is semantic and deterministic

Two plans are materially equal only when their selected-section entity diffs are equal after a canonical,
domain-safe serialization. At minimum the comparison must preserve:

- section and explicit Arr type;
- entity type and stable identity/name;
- action (`create`, `update`, `delete`, `unchanged`);
- remote ID where it contributes to the current-state identity;
- field paths, change types, and canonical current/desired values; and
- section coverage outcome (successful, skipped, or failed).

Summary counts alone are not plan evidence: one deleted entity can be replaced by a different deleted
entity without changing the count. Display ordering that is contractually irrelevant may be normalized,
but entity lists or nested values whose order affects Arr behavior must retain order. Unknown or
unserializable values are an ambiguous comparison and therefore a rejection, never a match.

#### BR-4: Stale reasons are typed, closed, and evidence-specific

The apply contract must return a stable machine-readable reason plus a safe user message. Required
business distinctions include:

- `pcd_drift`: desired PCD/source/config evidence no longer matches the reviewed plan;
- `arr_drift`: live Arr evidence no longer matches the reviewed plan;
- `pcd_and_arr_drift`: both evidence classes changed, when both can be proven in one validation pass;
- `scope_drift`: target instance identity, explicit Arr type, selected section scope, or reviewed section
  configuration no longer matches;
- `preview_expired`: the preview is no longer present or exceeded its lifecycle TTL/age block;
- `preview_not_ready`: the lifecycle state cannot be applied;
- `section_claimed`: a selected section is already in progress; and
- `validation_failed`: authoritative evidence could not be read or compared safely.

The user-facing message must name the evidence class when known and always direct the user to regenerate
and review. Raw upstream response bodies are not needed to satisfy this issue and must not be promoted
into the stale reason contract.

#### BR-5: Any material drift invalidates the whole apply request

Validation is atomic at the request level. If one selected section has PCD drift and another still
matches, none of the selected sections execute. Praxrr must not auto-apply the matching subset, remove
the stale section, or recompute a new plan and continue. The user's confirmation covered the complete
selected request.

#### BR-6: A changed plan always requires a new review

No threshold of “small” drift is safe for automatic acceptance. This includes:

- unchanged action counts but different entity identities;
- the same entity/action with different field values;
- an `update` becoming a `create`, `delete`, or `unchanged`;
- a new or removed entity;
- a changed remote ID;
- a skipped or failed section becoming successful, or the reverse; and
- a config/source change that happens to yield a superficially identical summary.

If a new authoritative read yields a materially different plan, the current preview becomes failed or
otherwise non-applicable and cannot be retried. The user generates a new preview ID and reviews it.

#### BR-7: Selected sections survive unchanged through all phases

The exact ordered, deduplicated `sectionsToApply` resolved by the apply route is passed to revalidation
and execution. The default remains the successful, non-skipped preview sections. An explicit request
remains a subset of those sections. Empty, invalid, unpreviewed, failed, or skipped sections are rejected
before validation. Revalidation may not expand to every configured section through `resolveSections`.

#### BR-8: Arr dispatch is explicit and fail-closed

The instance's current type must equal the reviewed `SyncPreviewResult.arrType`. It must also pass the
existing concrete type guard; `all`, `chaptarr`, unknown values, and ambiguous mappings are invalid. The
same `arrType` is used to select the Arr client, capability/section rules, PCD mappings, transforms,
validation comparison, and execution syncer. No Radarr/Sonarr/Lidarr sibling fallback is permitted.

#### BR-9: Preview configuration is part of the reviewed evidence

`SyncPreviewTrigger.svelte` sends the current form state in `sectionConfigs`, and each syncer can use
that override during `generatePreview()`. Normal `sync()` reads saved `arrSyncQueries` state instead.
Therefore apply must not discard the override. The reviewed normalized section configuration must be
retained with the preview and used for validation/execution, or the saved configuration must be proven
equivalent before execution. If the user saves or edits configuration after preview and the effective
desired input changes, the preview is stale.

#### BR-10: TTL and age policies remain independent guards

The in-memory store's expiry and the existing 5-minute warning/30-minute hard block remain in force.
Evidence revalidation does not refresh `createdAt`/`expiresAt`, extend a preview, or make an over-age
preview safe. Conversely, a young preview is not presumed current: evidence drift can invalidate it
seconds after generation.

#### BR-11: Claim/concurrency guards remain in force and cannot create a race window

The existing preflight `getSectionsInProgress` check remains a useful user-facing early rejection, and
the per-section atomic `claimSync` remains authoritative. Apply validation must not weaken either guard.
No write may occur if a selected section cannot be claimed. Claims acquired for a request that then
fails revalidation must be released or failed without performing mutations, and the preview must not be
reported as applied.

#### BR-12: Rejection is not an apply outcome

A stale-plan rejection occurs before sync writes. It must not create successful/failed per-entity write
outcomes, must not be described as a partial sync, and must not mark the preview `applied`. If durable
history records the validation rejection, it must label it as a rejected reviewed plan, not as evidence
that entity writes were attempted. The planned `EntityChange` rows remain planning evidence only.

#### BR-13: Preview lifecycle is single-use and fail-closed

Only `ready` may enter apply. The atomic transition to `applying` prevents concurrent double apply. A
successful validated execution ends at `applied`. A material mismatch, validation error, or execution
failure ends at `failed` and the preview cannot return to `ready`. Missing/expired previews remain
non-applicable. Invalid request syntax or an already-running section may be rejected before lifecycle
transition so the still-valid preview can be retried only when no authoritative input has been shown to
be stale.

### Edge cases

- A PCD and Arr change that cancel each other out into the same final summary is still stale if the
  reviewed current/desired evidence differs.
- A remote entity changes and changes back before apply. If the authoritative material evidence now
  equals the reviewed evidence, revalidation may pass; audit timestamps alone are not the contract.
- A remote field omitted by the preview comparer is not part of the reviewed plan unless it affects the
  write payload or entity identity. If it can affect execution, it must first be added to material
  evidence rather than ignored.
- A preview created with no explicit `sections` must retain the concrete resolved section list produced
  at generation. Apply must not re-resolve from current configuration and discover more sections.
- A request narrows a four-section preview to one section. Only that section's PCD and Arr evidence is
  relevant to the requested apply; drift solely in an unselected section does not authorize expanding
  or blocking the selected section unless it changes a shared dependency used by the selected plan.
- A shared PCD dependency affects multiple selected sections. Its change may invalidate each affected
  section, but the response can report one `pcd_drift` reason with affected section detail.
- A section was successfully previewed but becomes unsupported for the same Arr type/version before
  apply. This is scope/capability drift and must reject, not convert to a successful skip.
- The Arr instance is deleted, disabled, changes URL/credentials, or changes `arr_type`. Missing or
  changed identity fails closed before writes; an `arr_type` change is `scope_drift`.
- Live Arr is unreachable, unauthorized, rate-limited, or returns incomplete data during validation.
  Praxrr cannot prove equivalence, so it returns `validation_failed`; it must not guess `arr_drift`.
- One section validation succeeds and the next throws. None execute.
- The same preview receives two apply requests. Only one can transition/claim; the other receives a
  lifecycle or claim conflict and performs no write.
- A preview contains deletes and still requires the existing exact-instance-name confirmation in the
  UI. Evidence revalidation is additive to, not a replacement for, destructive confirmation.
- A validation pass finds no material changes and the reviewed plan was all `unchanged`. Execution may
  report skipped/no work, but only after the same reviewed-plan validation succeeds.
- Canonicalization code cannot distinguish PCD drift from Arr drift. It returns the closed ambiguous
  `validation_failed` reason, not an invented evidence class.

## Workflows

### Workflow 1: Generate and review a bound preview

1. User selects an enabled Arr instance and one or more sync sections.
2. The UI submits the exact section list plus current section form state as `sectionConfigs`.
3. The create route validates the concrete `arrType` and resolves the exact sections.
4. The preview orchestrator reads desired PCD/source data and live Arr state through the explicit
   per-Arr syncer for each section.
5. Praxrr stores the displayed diff plus the normalized reviewed-plan evidence required to reproduce or
   compare it.
6. The UI shows instance, Arr family, generation age, selected section coverage, entity/field changes,
   and destructive confirmation requirements.
7. User reviews the plan. No write authorization exists until explicit apply confirmation.

### Workflow 2: Apply a still-current reviewed plan

1. User confirms Apply Preview, optionally with an explicit eligible subset of reviewed sections.
2. Route verifies preview existence, `ready` status, no generation error, request size/syntax, section
   eligibility, TTL/age, current instance identity/`arrType`, and early in-progress guards.
3. Praxrr atomically transitions the preview from `ready` to `applying`.
4. At the execution boundary, Praxrr re-reads all authoritative desired PCD/config and live Arr inputs
   for exactly `sectionsToApply` using the reviewed explicit Arr dispatch.
5. Praxrr compares the new material evidence to the reviewed evidence.
6. Only an exact match permits the normal section write path and its atomic claims.
7. The existing sync result returns confirmed entity outcomes and the correlated Sync History ID.
8. Preview transitions to `applied`; UI keeps planned changes separate from confirmed outcomes.

### Workflow 3: Recover from PCD drift

1. User confirms a preview after its selected PCD entity, mapping, source resolution, or effective section
   selection changed.
2. Revalidation identifies desired evidence mismatch before a write.
3. Apply rejects atomically with typed reason `pcd_drift` (or `pcd_and_arr_drift` if both are proven),
   affected section(s), and a safe explanation.
4. Preview becomes non-applicable; no selected section executes and no entity outcome is fabricated.
5. UI states: “Desired PCD inputs changed. Generate and review a new preview before applying.”
6. User regenerates; the new preview displays the new desired/current diff and requires fresh confirmation.

### Workflow 4: Recover from live Arr drift

1. An operator, automation, or Arr itself changes a material remote entity after preview.
2. Revalidation identifies the changed current evidence before a write.
3. Apply rejects atomically with typed reason `arr_drift`, affected section(s), and regeneration guidance.
4. UI states: “The Arr instance changed since this preview. Generate and review a new preview before
   applying.”
5. User regenerates and reviews how the new current state changes create/update/delete decisions.

### Workflow 5: Recover from ambiguous validation or concurrency

1. If authoritative evidence is unreadable or non-canonical, apply returns `validation_failed`; user can
   retry by regenerating after connectivity/auth/data issues are resolved.
2. If a selected section is already running, apply returns `section_claimed`; the preview remains
   unapplied and may be retried only while it remains within TTL and evidence still matches.
3. If the preview has expired or exceeded the hard age block, apply returns `preview_expired`; no
   revalidation attempt extends it.
4. If target scope or Arr type changed, apply returns `scope_drift`; user must reload the instance and
   generate a new preview under the current explicit Arr family.

## Domain Model and State Transitions

### Reviewed-plan concepts

| Concept            | Business meaning                                                                 | Required evidence                                                                                |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `ReviewedPlan`     | The exact scope and material desired/current state the user reviewed             | Preview ID, instance, Arr type, sections, section config, per-section evidence, diff/fingerprint |
| `DesiredEvidence`  | Authoritative inputs used to construct the target payload                        | Effective sync selection/config, PCD/TRaSH entities, mappings, transformed desired values        |
| `CurrentEvidence`  | Authoritative live Arr state used as the comparison base                         | Remote entity identity/ID and material current values                                            |
| `MaterialPlan`     | Canonical semantic operations authorized by review                               | Section, entity identity, action, field current/desired changes, coverage outcome                |
| `ValidationResult` | Proof that current authoritative inputs still match, or a closed rejection       | match or typed stale/validation reason with affected sections                                    |
| `ApplyAttempt`     | One single-use attempt to validate and, only if valid, execute the reviewed plan | Lifecycle transition, exact sections, validation result, optional confirmed write outcomes       |

### Preview lifecycle

```text
generating -> ready -> applying -> applied
     |          |         |
     v          v         v
   failed     failed    failed

ready/applying -- TTL elapsed --> expired/non-applicable
```

Business transition rules:

- `generating -> ready`: material evidence and displayed preview were produced and stored.
- `ready -> applying`: a syntactically valid, eligible, in-TTL request won the single-use transition.
- `applying -> applied`: reviewed evidence matched immediately before execution and the run succeeded or
  truthfully reported no work.
- `applying -> failed`: PCD/Arr/scope drift, ambiguous validation, or execution failure.
- `ready -> failed`: an implementation may invalidate the preview before transition if drift is proven
  during a route-level validation step, but it must still be terminal.
- `ready -> ready`: only non-material request rejection such as a transient preflight claim conflict may
  leave the preview retryable.
- No terminal state transitions back to `ready`; recovery creates a new preview.

### Staleness dimensions

Age staleness and evidence staleness are orthogonal:

| Age gate            | Evidence match         | Result                                                   |
| ------------------- | ---------------------- | -------------------------------------------------------- |
| Within limits       | Match                  | May execute after all claim guards pass                  |
| Warning age         | Match                  | May execute with existing warning, after full validation |
| Hard-block/expired  | Any                    | Reject and regenerate                                    |
| Any non-expired age | PCD/Arr/scope mismatch | Reject and regenerate                                    |
| Any non-expired age | Cannot prove match     | Reject and resolve validation problem                    |

## Existing Codebase Integration

### Current generation and evidence path

- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts` parses `instanceId`, ordered
  `sections`, and runtime-only `sectionConfigs`; validates an enabled concrete Arr instance; creates the
  in-memory snapshot; and calls `generatePreview()`.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` explicitly narrows to
  Radarr/Sonarr/Lidarr, resolves sections, creates the target Arr client, applies each optional preview
  config to a section syncer, and stores per-section results/outcomes. This is the natural shared path
  for immediate revalidation.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts` currently stores the rendered diff and
  scope but no normalized section config, desired/current evidence fingerprint, or typed stale reason.
  `SyncPreviewResult` is the primary contract extension point.
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts` supplies the single-process TTL store,
  lifecycle transition matrix, 10-minute storage TTL, 5-minute warning, and 30-minute block constants.
  The current 10-minute store expiry means the 30-minute block is normally unreachable through this
  store, but both existing policies should be preserved unless separately rationalized.

### Current apply and execution path

- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts` already validates
  lifecycle, generation errors, request size/JSON, eligible selected sections, age, and in-progress
  sections. It then transitions to `applying` and calls `executeSyncJob()` with only instance ID,
  section list, source, and preview ID. This route is the product-facing typed rejection and recovery
  boundary.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` sets section status pending, reloads the
  instance and sync configs, creates a current client, captures a best-effort fresh pre-sync preview for
  history, atomically claims each section, and calls each syncer's `sync()`. The validation-to-first-write
  boundary must be integrated here or in a dedicated reviewed-plan executor invoked here; a route-only
  check would leave an avoidable time-of-check/time-of-use gap.
- `packages/praxrr-app/src/lib/server/sync/registry.ts` and
  `packages/praxrr-app/src/lib/server/sync/mappings.ts` provide the section registry, execution order,
  explicit Arr section support, and capability dispatch that validation must reuse.
- Each syncer's `generatePreview()` and `sync()` already contains section- and Arr-specific semantics.
  Revalidation should reuse those semantics rather than compare a generic raw API dump. The override
  split is visible in `qualityProfiles/syncer.ts`, `delayProfiles/syncer.ts`,
  `mediaManagement/syncer.ts`, and `metadataProfiles/syncer.ts`: preview getters honor
  `getPreviewConfig()`, while `sync()` uses saved query state. The reviewed-plan contract must resolve
  this divergence explicitly.

### Contract and UI surfaces

- `packages/praxrr-api/openapi.json` is authoritative for portable `SyncPreviewResult`, apply request,
  success, and error schemas; generated `packages/praxrr-app/src/lib/api/v1.d.ts` must stay in lockstep.
  Typed stale reason, affected evidence/sections, and recovery guidance belong in the portable error
  contract, not only an ad hoc string.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte` submits the
  current form configuration. `SyncPreviewPanel.svelte` displays the reviewed diff, age warnings,
  destructive confirmation, apply result, and confirmed outcomes. It currently says apply “reruns” the
  sections; this must change to explain validated reviewed-plan execution and to show a clear regenerate
  action/message after typed stale rejection.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte` owns the modal, section focus, and “Save
  changes”/“Save & Sync” quick actions. Saving after preview can change authoritative selection state;
  apply must validate it rather than assuming the modal's old plan is current.

### Tests and acceptance evidence

- Extend `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`, the issue-specified
  focused suite, with injected revalidation/execution dependencies and explicit zero-execution
  assertions for PCD drift, Arr drift, combined/ambiguous drift, scope/Arr-type drift, and section
  preservation.
- Unit coverage should prove canonical comparison detects same-count/different-entity and
  same-entity/different-field cases, not only summary mismatch.
- Cross-Arr cases must cover Radarr, Sonarr, and Lidarr dispatch, including Lidarr-only metadata profile
  behavior and no sibling fallback.
- Existing TTL warning/block, section-generation failure, ineligible section, request limit, lifecycle,
  preview-ID correlation, confirmed outcome, and claim behavior remain regression gates.
- `deno task check` validates the OpenAPI/generated/runtime/UI contract integration after focused tests.

## Success Criteria

The feature is complete only when current-state evidence proves all of the following:

1. Applying a preview cannot call a mutating syncer until all selected authoritative desired PCD/config
   evidence and live Arr current evidence have been compared with the reviewed evidence.
2. Exact reviewed-plan equality is based on entity/field material evidence, not timestamps or summary
   counts alone.
3. Separate typed apply errors name PCD drift and Arr drift; ambiguous/unreadable evidence fails closed
   without misclassification.
4. Every stale/invalidated-plan response tells the user to generate and review a new preview, and the UI
   provides or clearly points to that recovery.
5. A material mismatch executes zero selected sections and produces zero confirmed write outcomes.
6. The exact eligible `sectionsToApply` and reviewed explicit `arrType` are identical across route
   resolution, revalidation, claims, execution, results, and history correlation.
7. Preview form `sectionConfigs` are retained and honored or proven equivalent to saved state; apply can
   no longer silently execute different saved selections.
8. Existing age warning, TTL/hard block, destructive confirmation, lifecycle single-use protection,
   in-progress preflight, and atomic section claims remain effective.
9. Regression tests independently mutate PCD desired state and live Arr state and prove
   `executeSyncJob`/mutating syncers are not invoked under the unchanged reviewed preview.
10. Tests also prove same counts with different entities/fields are rejected and unchanged evidence
    executes exactly the reviewed selected sections.
11. Radarr, Sonarr, and Lidarr use explicit per-Arr validation/dispatch with no sibling fallback or
    undocumented portable field.
12. OpenAPI, generated types, runtime validators/handlers, UI behavior, and focused route tests agree on
    the typed stale contract.

Issue #234's manual check should pass twice: generate a preview, mutate only desired PCD state, and see
a PCD-specific no-write rejection; then generate another preview, mutate only live Arr state, and see an
Arr-specific no-write rejection. In both cases a freshly generated preview must expose the changed plan
for a new review.

## Open Questions

1. **Execution strategy:** Should Praxrr revalidate then run the current syncers, or introduce an
   immutable executable plan consumed directly by syncers? Revalidation better fits the current code,
   but its comparison-to-write boundary must be tight enough to avoid a meaningful race.
2. **Fingerprint shape:** Should the store retain canonical desired/current evidence objects plus a
   digest, or only versioned fingerprints? Retaining canonical evidence improves diagnosis and testing;
   fingerprints reduce memory but need versioning and cannot by themselves classify PCD versus Arr
   drift unless the evidence classes are hashed separately.
3. **Preview overrides:** Is Apply Preview intended to apply unsaved form configuration directly, or
   must the UI require/save it first? Either policy is acceptable only if the preview and execution use
   the same normalized configuration and saving invalidates an older preview.
4. **Claim ordering:** Can the existing handlers expose a multi-section claim/release operation so all
   selected sections are reserved before final validation, or should a reviewed-plan executor validate
   and claim section-by-section? Request-level atomic rejection argues for reserving the whole selected
   scope before the final validation/write phase.
5. **Typed reason persistence:** Should a stale-plan rejection be durable in Sync History or remain only
   on the ephemeral preview/apply response? If persisted, it needs a distinct rejected-plan semantic so
   it is never confused with attempted entity writes.
6. **Combined drift:** Should the API report both `pcd_drift` and `arr_drift` as an array, or use a
   combined code? The business requirement is that both evidence classes be named when both are known;
   the portable schema should choose one stable representation.
7. **Affected detail:** How much stale detail should be returned—sections only, entity identities, or
   field paths? Section/entity detail aids recovery but must remain bounded and sanitized; full current
   upstream bodies should stay out of user-facing errors.
8. **Age constants:** The store currently expires snapshots after 10 minutes while the hard block is 30
   minutes. Is this deliberate policy (ephemeral eviction earlier than the documented hard block), or
   should configuration align them in a separate change without weakening issue #234?
9. **External writers:** Without an Arr transaction or revision token, a remote writer can race after
   validation. Which sections support conditional/value-guarded writes, and what is the acceptable
   fail-closed mechanism for those that do not? This decision determines whether revalidation alone can
   fully satisfy “materially changed inputs never execute.”
10. **Canonical comparison versioning:** How will older in-memory previews behave after a deploy that
    changes comparison semantics? The safest default is to reject unknown/mismatched evidence versions
    and require regeneration.
