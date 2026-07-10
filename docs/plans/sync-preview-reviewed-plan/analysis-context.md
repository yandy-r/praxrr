# Context Analysis: Sync Preview Reviewed-Plan Binding

## Executive Summary

Issue #234 must turn Sync Preview from a correlated dry run into a single-use reviewed-plan
authorization. The existing preview path already produces the correct public, read-only diff through
the explicit section registry and concrete Radarr, Sonarr, and Lidarr syncers. The integrity gap is
Apply: it currently forwards only the instance, sections, and preview ID into a fresh ordinary sync,
which rereads saved configuration, PCD/TRaSH state, and live Arr state and can therefore execute a plan
the operator did not review.

The selected design is a private, versioned binding stored beside the public preview in the existing
bounded TTL store. For every successfully reviewed section, the binding preserves the exact instance,
explicit Arr type, ordered scope, normalized transient section configuration, and separate SHA-256
fingerprints for desired PCD/config evidence, live Arr evidence, and the material plan. Apply may
narrow to a non-empty eligible subset, but it must atomically claim the preview, acquire every selected
section without resetting active work, regenerate all selected evidence through the same preview
semantics, and compare every section before the first snapshot, history row, outcome, or Arr mutation.

Any PCD, Arr, combined, scope, plan, version, or unverifiable mismatch fails closed, terminally
invalidates the claimed preview, returns a typed regenerate-required response, and performs zero
writes. A match permits existing writers to run with the exact reviewed configuration. Planned
`EntityChange` evidence remains distinct from confirmed `SyncEntityOutcome` and Sync History evidence.
No database migration, new dependency, durable plan table, sibling-Arr fallback, or replacement sync
engine is required.

## Architecture Context

The reviewed-plan lifecycle should be visibly ordered:

1. `POST /api/v1/sync/preview` validates the enabled concrete Arr instance, exact ordered sections,
   request limits, and optional transient `sectionConfigs`.
2. `generatePreview()` uses one explicitly typed Arr client and the registered concrete syncers to
   produce the existing public section results while an optional private evidence recorder captures
   execution-relevant desired/config and live Arr projections.
3. A pure binding module canonicalizes bounded projections, computes separate domain-tagged PCD, Arr,
   and plan hashes, and retains cloned normalized section configuration.
4. `SyncPreviewStore.completeGeneration()` installs the public ready snapshot and private binding in
   one mutation. Public GET continues to serialize only `SyncPreviewResult`.
5. Apply validates body, TTL/age, eligible subset, and advisory active-section state, then
   `claimReadyForApply()` atomically checks expiry, lifecycle, binding version/coverage, and performs
   `ready -> applying`.
6. `executeReviewedSyncJob()` reloads the exact enabled instance, proves the bound `arrType` and
   capabilities, acquires all selected section claims without an unconditional pending reset, and
   regenerates evidence for the exact subset with the stored configs.
7. All PCD/config, Arr, and plan evidence is compared before any write-side effect. One selected
   mismatch invalidates the entire request.
8. On a complete match, existing concrete syncers execute with the same reviewed config. Only actual
   writer results create outcomes and a correlated Sync History run.

The binding is intentionally process-local. Restart, eviction, expiry, missing evidence, or an unknown
binding version safely requires regeneration. Published Arr APIs do not provide a reliable common
conditional-write contract, so the implementation must minimize the revalidation-to-write interval,
reuse prepared/revalidated values where possible, and avoid claiming transactional protection from
external writers that upstream APIs cannot provide.

## Critical Files Reference

| File                                                                                | Planning significance                 | Required direction                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/api/v1/schemas/sync.yaml`                                                     | Source of apply wire types            | Define closed invalidation codes/evidence fields first; keep private binding data off the wire                                        |
| `docs/api/v1/paths/sync.yaml`                                                       | Apply behavior/status contract        | Replace “rerun current config” semantics with reviewed binding, exact subset, 422 invalidation, and regeneration                      |
| `docs/api/v1/openapi.yaml`                                                          | Modular schema registration           | Register any new sync schemas before generation                                                                                       |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                                           | Generated app contract                | Regenerate; never hand-edit                                                                                                           |
| `packages/praxrr-api/types.ts` and `packages/praxrr-api/openapi.json`               | Portable contract mirrors             | Regenerate/bundle and keep in lockstep with YAML/runtime                                                                              |
| `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts`                  | New pure integrity core               | Own versioned canonicalization, domain-separated hashes, binding construction, subset comparison, and typed invalidation              |
| `packages/praxrr-app/src/lib/server/sync/preview/types.ts`                          | Public preview and explicit Arr types | Add only shared internal evidence types as needed; do not expose private hashes/configs through `SyncPreviewResult`                   |
| `packages/praxrr-app/src/lib/server/sync/preview/store.ts`                          | TTL/lifecycle and binding owner       | Add private envelope plus atomic completion/claim; preserve timestamps, capacity, and terminal semantics                              |
| `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`                   | Canonical read/transform path         | Make private evidence capture optional; preserve exact section order, explicit Arr client, partial-generation behavior, and cleanup   |
| `packages/praxrr-app/src/lib/server/sync/base.ts`                                   | Config/evidence context seam          | Attach and clear reviewed config/evidence in paired `finally` cleanup                                                                 |
| `packages/praxrr-app/src/lib/server/sync/types.ts`                                  | Section registry and outcome types    | Preserve planned-versus-confirmed separation and expose only narrow reviewed execution interfaces                                     |
| `packages/praxrr-app/src/lib/server/sync/mappings.ts`                               | Section order and Arr capabilities    | Reuse exact support/version checks; never expand an apply subset or infer sibling compatibility                                       |
| `packages/praxrr-app/src/lib/server/sync/registry.ts`                               | Concrete section dispatch             | Reuse existing handlers/factories; do not create a second section registry                                                            |
| `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`                 | Quality desired/current semantics     | Capture selections, PCD/TRaSH material, namespaces, mappings, remote custom formats/profiles; preserve override-aware config parity   |
| `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`                   | Delay-profile semantics               | Capture selected PCD and per-app live target evidence; make reviewed sync use the existing preview-aware getter                       |
| `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`                 | Naming/quality/media semantics        | Capture all selected sources/mappings and live configs; make reviewed sync use the preview-aware getter                               |
| `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`                | Lidarr-only metadata semantics        | Preserve explicit Lidarr client/schema behavior and use the preview-aware config getter                                               |
| `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`                       | First-write execution choke point     | Add dedicated `executeReviewedSyncJob`; acquire all claims, revalidate all sections, then execute without the normal pending reset    |
| `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`                          | Authoritative section status claims   | Add minimal all-selected compare-and-claim/release behavior that never overwrites `in_progress` or releases unowned work              |
| `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`                     | Current target authority              | Reload enabled target and require exact bound identity/type before client or writer use                                               |
| `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`                     | Generation adapter                    | Atomically publish public result plus private binding                                                                                 |
| `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`   | HTTP claim/error adapter              | Preserve parsing/eligibility DI seam, call atomic store claim and object-based reviewed executor, map typed 404/409/422/500 responses |
| `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte` | Transient reviewed config source      | Preserve exact submitted form state and provide regeneration action                                                                   |
| `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`   | Confirmation and recovery UI          | Show validation state, terminal invalidation, read-only old diff, “Nothing was applied,” and focused accessible regeneration CTA      |
| `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`              | Existing acceptance seam              | Prove exact scope/type/config forwarding, contract mapping, lifecycle/TTL, and zero executor calls on rejected paths                  |
| `packages/praxrr-app/src/tests/base/syncPreviewReviewedPlan.test.ts`                | New pure binding suite                | Prove canonical stability, material mutations, source classification, subset behavior, and fail-closed unknown/plan-only cases        |
| `packages/praxrr-app/src/tests/pcd/snapshots/fingerprint.test.ts`                   | Local hash-test precedent             | Mirror deterministic ordering and mutation-style assertions without coupling domains                                                  |
| `packages/praxrr-app/src/tests/sync/syncEntityOutcomes.test.ts`                     | Evidence separation proof             | Ensure rejected reviews never fabricate confirmed outcomes/history                                                                    |
| `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`                      | Portable contract gate                | Prove bundled OpenAPI/types remain resolvable and aligned                                                                             |
| `docs/site/src/content/docs/app/sync-pipeline.md`                                   | Permanent architecture guide          | Document claim/revalidation/all-selected-before-any-write phase                                                                       |
| `ROADMAP.md`                                                                        | Required delivery record              | Record #234 reviewed-plan guarantee separately from #232 confirmed outcomes                                                           |

## Patterns to Follow

### Contract-first generated API

Edit modular OpenAPI YAML before runtime/UI changes, then run `deno task generate:api-types` followed by
`deno task bundle:api`. Use generated component types in route and UI code. The authoritative closed
drift taxonomy is `pcd_drift`, `arr_drift`, `pcd_and_arr_drift`, `scope_drift`, and
`unverifiable_review`; 422 is for reviewed evidence invalidation, 409 for lifecycle or section-claim
conflicts, 404 for missing/evicted previews, and 500 only for unexpected failures.

### Public snapshot, private envelope

Keep the current public `SyncPreviewResult` unchanged except for deliberate public contract work. Store
the review binding only in private `StoredPreview` state. Make `ready` without a binding
unrepresentable for newly generated previews, and fail closed for missing legacy/test binding state.

### One preparation path

Capture and regenerate evidence through `generatePreview()` and the existing concrete syncers. Keep
the evidence sink optional because drift/history/MCP callers reuse preview generation. Do not build a
second domain reader, hash raw upstream payloads, or reconstruct executable writes from display diffs.

### Explicit canonical projections

Use Deno Web Crypto SHA-256 with binding version, exact Arr type, section, and evidence class as domain
separators. Canonicalize bounded explicit projections, sort only true sets using stable semantic keys,
preserve meaningful array order, distinguish material null/absence, include write-target remote IDs,
and reject unsupported or non-finite values. Keep separate `pcdHash`, `arrHash`, and `planHash` per
section so classification remains truthful.

### Atomic compare-and-transition claims

Use a store CAS-like `ready -> applying` operation for single-use preview claims. At execution, acquire
all exact selected section claims before revalidation and never call the ordinary unconditional pending
reset. Do not partially execute or release/fail a claim not owned by the reviewed request.

### Exact reviewed context

Preserve `instanceId`, explicit `radarr | sonarr | lidarr`, ordered eligible section subset, preview ID,
expiry, and normalized transient `sectionConfigs` across store claim, revalidation, writer execution,
outcomes, and history correlation. Config names used as lookup keys must remain exact; reject empty
values but do not trim persisted identifiers.

### Planned versus confirmed evidence

`EntityChange` and plan hashes authorize an attempt only after validation. `SyncEntityOutcome` and
`syncHistoryId` exist only for actual execution. Pre-write invalidation creates no snapshot, history
row, section outcome, or fabricated partial-sync result.

### Thin adapters and dependency injection

Keep HTTP parsing/status mapping in the route, integrity logic in pure/server modules, and display logic
in Svelte. Retain the route's injectable clock/progress/executor seam and switch to an object-based
reviewed executor input so tests can assert every bound field without positional ambiguity.

## Cross-Cutting Concerns

- **Cross-Arr fidelity:** Every API read, mapping, capability check, projection, and writer remains
  explicit for Radarr, Sonarr, or Lidarr. Metadata profiles stay Lidarr-only. Type or capability drift
  is a scope failure, never a sibling fallback or a successful skip.
- **Config fidelity:** The transient form values used to generate a preview are executable reviewed
  state. Revalidation and execution must use the exact normalized stored values. Delay, media
  management, and metadata sync paths currently need to adopt their existing preview-aware getters;
  quality profiles needs parity regression coverage.
- **Concurrency:** The route's `getSectionsInProgress()` is advisory. The authoritative reviewed path
  must reserve the whole selected scope without overwriting `in_progress`, validate all sections, and
  cross the first-write boundary only after complete success.
- **TOCTOU:** Upstream Arr APIs lack a verified common conditional-write mechanism. Keep claims and
  revalidation inside the execution choke point, reuse the same client/prepared values, and add an
  immediate old-value guard where feasible. Document the residual external-writer race accurately.
- **TTL/lifecycle:** Preserve the 10-minute store TTL, 5-minute warning, 30-minute hard-age policy,
  capacity, and request/rate limits. Do not refresh `createdAt` or `expiresAt`; re-check expiry after
  claims and before the first write.
- **Security/privacy:** Keep hashes, raw evidence, configs containing sensitive material, API keys,
  URLs, credentials, and upstream bodies out of public responses and ordinary logs. Return stable safe
  codes, changed section names, evidence class, and regeneration guidance only.
- **Accessibility/recovery:** During the request use conservative “Validating reviewed preview…”
  status and disabled controls. On invalidation retain the old diff, disable Apply immediately, render
  a persistent `role="alert"` stating “Nothing was applied,” identify the evidence class in text, and
  focus a “Generate New Preview” action.
- **Documentation:** Update the sync pipeline/operator promise and `ROADMAP.md`; describe the private
  binding and zero-write guarantee without implying durable or cross-process transactional behavior.
- **Generated artifacts:** API source, generated app declarations, portable package declarations, and
  bundled OpenAPI are one change set; generated drift is a release-blocking contract failure.

## Parallelization Opportunities

The work can proceed in dependency-aware tracks after agreeing on the binding and wire enums:

1. **Contract track:** OpenAPI schemas/paths, generated artifacts, and contract tests. This can begin in
   parallel with the pure binding track once the invalidation taxonomy is fixed.
2. **Pure binding track:** `reviewBinding.ts` plus canonicalization/comparison tests. It is independent
   of database, routes, syncers, and UI and should establish the shared internal types first.
3. **Store track:** private envelope, atomic generation completion, atomic apply claim, TTL/version/
   concurrency tests. It depends only on stable binding types and can run alongside evidence work.
4. **Evidence/config track:** base/orchestrator sink plumbing first, then explicit evidence capture and
   reviewed-config parity can be divided by section syncer. Avoid concurrent edits to the shared base
   and orchestrator; converge those interfaces before splitting concrete files.
5. **Execution/claim track:** all-selected database claim behavior and `executeReviewedSyncJob()` can
   start after binding/store/evidence interfaces stabilize. It is the critical integration path and
   must merge before route acceptance work.
6. **Route/UI track:** apply-route DI/typed mapping and Svelte recovery can proceed in parallel after
   the contract and reviewed executor result shape are stable. UI fixtures can be built from generated
   invalidation types before the full executor is wired.
7. **Acceptance/docs track:** cross-Arr, config, later-section drift, TTL, duplicate apply, active claim,
   zero-write/history tests plus sync-pipeline/ROADMAP updates follow integration and can be split by
   proof surface.

Merge order should be: contract and binding types; store/evidence foundations; config parity and
all-selected claims; reviewed executor; route/UI; full acceptance/docs. Shared-file ownership is the
main conflict risk, not logical task coupling.

## Implementation Constraints

- Do not add a database migration, durable reviewed-plan table, new environment variable, Arr SDK,
  hashing package, or generic canonical-JSON dependency.
- Do not expose the binding, fingerprints, raw PCD/Arr inputs, newly computed unreviewed diff, or
  credentials through GET/apply responses.
- Do not use a client-supplied hash as authoritative evidence and do not add `ETag`/`If-Match` semantics
  unless implementing a real conditional HTTP contract.
- Do not hash only summary counts, the PCD op log, raw Arr JSON, or the display diff. Evidence must
  cover all execution-relevant transformed desired and current inputs.
- Do not globally sort arrays; preserve semantic ordering and normalize only explicitly unordered
  collections.
- Do not allow an omitted/empty reviewed section list to expand through `SYNC_SECTION_ORDER`; apply
  must use the exact non-empty eligible subset.
- Do not call `setSectionsStatusPending()` or any unconditional status reset in reviewed execution.
- Do not validate section-by-section immediately before each section writes; all selected sections
  must validate before the first selected section mutates.
- Do not route reviewed execution through an optional flag on ordinary scheduled/manual/canary sync.
  Use a dedicated reviewed entry point with all required fields.
- Do not silently fall back from transient reviewed configuration to saved configuration.
- Do not return a claimed invalidated preview to `ready`; use terminal `failed` plus typed details.
- Do not create Sync History or confirmed outcomes for a pre-write rejection.
- Preserve Svelte 5 without runes, repository formatting, alert-store conventions, and exact-name
  destructive confirmation.
- Preserve current preview limits and existing ordinary sync behavior outside the dedicated reviewed
  path.
- Treat unknown versions, missing evidence, partial regeneration, unreadable sources, ambiguous
  mappings, instance/type changes, and capability changes as fail-closed regeneration cases.

## Key Recommendations

1. Finalize one closed contract before implementation: typed PCD, Arr, combined, scope, and
   unverifiable invalidation; 422 drift/expiry; 409 lifecycle/claim; safe bounded changed sections;
   `regenerateRequired: true`.
2. Implement and test the pure versioned binding first. Make canonical preimages inspectable in tests,
   then assert mutation-specific digest and classification behavior.
3. Make the private store invariants atomic: no ready preview without a binding and no double apply
   claim. Missing or unknown bindings never fall through to ordinary execution.
4. Capture evidence beside each concrete syncer's existing reads and transformations. Treat explicit
   per-section repetition as safer than a generic “strip volatile keys” abstraction.
5. Add the minimal all-selected claim protocol before the reviewed executor. Prove an existing
   `in_progress` row is untouched and a later-section conflict or drift causes zero earlier writes.
6. Keep final revalidation inside `executeReviewedSyncJob()` after target/type/claim resolution and
   before snapshots, history, outcomes, or Arr mutations. Execute with the same bound configs and,
   where possible, the same prepared evidence values.
7. Extend route tests with zero-call spies for PCD-only, Arr-only, combined, config, scope, TTL,
   missing-binding, unverifiable, and duplicate/active-claim paths. Add explicit successful Radarr,
   Sonarr, and Lidarr dispatch/subset cases.
8. Make UI invalidation durable and accessible: retain the old review, disable reapply locally,
   state that nothing was applied, identify the evidence class, and require generation/review of a new
   preview.
9. Validate the full contract and behavior surface with focused binding/store/executor/route tests,
   `deno task generate:api-types`, `deno task bundle:api`, `deno task check`, lint/format, relevant full
   tests, and manual PCD-only then Arr-only mutation checks.
10. Update `docs/site/src/content/docs/app/sync-pipeline.md` and `ROADMAP.md` in the same change, clearly
    distinguishing reviewed intent integrity (#234) from confirmed write outcomes/history (#232).
