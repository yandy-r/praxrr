# Recommendations: Bind Sync Apply to the Reviewed Plan

## Executive Summary

Implement issue #234 as a narrow reviewed-plan integrity layer around the existing preview and sync
paths. Preview generation should create a private, versioned binding for the exact instance, explicit
`arrType`, ordered sections, normalized `sectionConfigs`, desired PCD/config evidence, live Arr
evidence, and rendered per-section plan. Apply should atomically claim that preview, acquire the exact
selected section claims, regenerate all selected evidence through the same `generatePreview()` path,
and fail the whole request before the first mutation unless every selected section still matches.

The binding should keep separate SHA-256 hashes for PCD/config evidence, Arr evidence, and the rendered
plan. Separate hashes let the API return precise `pcd_drift`, `arr_drift`, or
`pcd_and_arr_drift` reasons; a plan-only mismatch or unreadable/ambiguous input must be classified as
`unverifiable_review`, never guessed. Hashes are server-held comparison aids, not client credentials
or substitutes for authorization.

Add a dedicated `executeReviewedSyncJob(input)` beside `executeSyncJob()` in
`packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`. Do not add reviewed behavior as an
optional flag to scheduled, canary, system, or ordinary manual syncs. The reviewed entry point must
preserve existing TTL/age rules, exact eligible section subset, explicit per-Arr capability dispatch,
preview single-use state, section claims, and the distinction between planned `EntityChange` data and
confirmed `SyncEntityOutcome` data.

The current `executeSyncJob()` cannot be reused unchanged: it calls `setSectionsStatusPending()` before
the authoritative `claimSync()`, which can overwrite an existing `in_progress` status. The reviewed
path needs an all-selected-sections claim that never resets another run, validates every selected
section before any section writes, and releases/fails only the claims acquired by this request.

This design satisfies the issue without persisting executable plans, replacing the sync engine,
adding sibling-Arr fallbacks, or building a generic workflow-authorization framework.

## Implementation Recommendations

### Approach

1. **Create one private reviewed binding.** Add
   `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts` with a versioned canonicalizer,
   domain-separated SHA-256 hashing, immutable per-section evidence, subset comparison, and a typed
   `SyncPreviewReviewInvalidatedError`. Keep the module pure: no SvelteKit, database, Arr client, job
   queue, or global-store imports.

2. **Capture evidence where domain semantics already live.** Extend `BaseSyncer` in
   `packages/praxrr-app/src/lib/server/sync/base.ts` with a preview-scoped evidence sink. Attach and
   clear it in `preview/orchestrator.ts` alongside `setPreviewConfig()`/`clearPreviewConfig()`. Record
   explicit projections in the four concrete syncers:
   - `qualityProfiles/syncer.ts`: normalized selections, PCD/TRaSH materialization, namespaces and
     quality mappings; live custom formats, quality profiles, and material capability/version data.
   - `delayProfiles/syncer.ts`: selected PCD profile/config and the explicit app-specific remote delay
     profile evidence.
   - `mediaManagement/syncer.ts`: naming, quality-definition, and media-settings selections and
     PCD/TRaSH source identity; matching live configurations and quality definitions.
   - `metadataProfiles/syncer.ts`: Lidarr-only selected PCD profile/namespace and live schema/profile
     evidence, including the existing explicit schema-null behavior.

3. **Hash material inputs, not only the display diff.** Desired evidence must include every normalized
   config, source row, mapping, namespace, and transformed value that can affect a write. Arr evidence
   must include every identity/current value used to choose or target create/update/delete operations.
   Exclude only proven volatile, execution-irrelevant fields. Use the existing semantic identity
   strategies in `preview/sectionDiffs.ts` as guidance: sort true sets, preserve meaningful array order,
   preserve remote IDs when they target a write, distinguish material null/absence, and reject
   unsupported values. Hash the final section result/outcome separately as `planHash` to catch engine
   or diff nondeterminism.

4. **Make store invariants atomic.** Extend the private `StoredPreview` in
   `preview/store.ts`; do not expose evidence through `SyncPreviewResult` or the GET route. Add:
   - `completeGeneration(id, patch, binding, nowMs)`, so a new preview cannot become `ready` without
     review evidence; and
   - `claimReadyForApply(id, sections, nowMs)`, returning a discriminated lifecycle result while
     atomically checking expiry, `ready`, binding presence, and the reviewed subset before moving to
     `applying`.

   A missing/unknown binding version fails closed. Drift moves the preview to terminal `failed` with a
   typed invalidation reason; do not add a new public lifecycle state for this issue.

5. **Validate at the first-write boundary.** In `executeReviewedSyncJob(input)`:
   - reload the enabled instance and require exact `instanceId` and
     `toSyncArrType(instance.type) === input.arrType`;
   - keep existing static/version-specific section support checks and fail on changed capability;
   - acquire all exact selected section claims without calling `setSectionsStatusPending()`;
   - re-check `expiresAt` after claims and immediately before validation/execution;
   - regenerate every selected section through `generatePreview()` with the stored normalized
     `sectionConfigs`, exact section list, explicit Arr client/type, and evidence sink;
   - compare all selected PCD, Arr, and plan hashes before the first snapshot, history row, outcome, or
     Arr mutation; and
   - only on a complete match call the existing section syncers with the same stored configs.

   Revalidation must be request-atomic: later-section drift means earlier sections perform zero writes.
   If execution performs a material re-read after validation, either reuse the revalidated prepared
   value or add an immediate old-value guard at that section's first mutation. Do not claim stronger
   external atomicity than Arr APIs provide.

6. **Honor the reviewed configuration.** Current UI/API behavior implies that transient
   `sectionConfigs` are executable reviewed state. Normalize, clone, and store them server-side, then
   make reviewed `sync()` use the same existing getters as preview:
   - quality profiles already reaches `getQualityProfilesSyncConfig()` through its batch path; protect
     that with a parity test;
   - change delay, media-management, and metadata `sync()` paths that directly call `arrSyncQueries`
     to use their existing `get*SyncConfig()` helpers;
   - attach the reviewed config only for the reviewed execution and clear it in `finally`.

7. **Keep the API contract explicit and safe.** Update `docs/api/v1/schemas/sync.yaml` and
   `docs/api/v1/paths/sync.yaml` first. Add a dedicated invalidation response containing stable
   `code`, `reason`, `changedEvidence`, `regenerateRequired: true`, and `staleWarning`; never return raw
   hashes, source values, upstream bodies, confirmed outcomes, or a `syncHistoryId` on pre-write
   rejection. Use:
   - `422` for expired/invalidated reviewed evidence, consistent with the repository's preview/from-
     state guards and the route's existing stale-block response;
   - `409` for lifecycle and active-section claim conflicts;
   - `404` for a missing/evicted preview; and
   - `500` only for unexpected internal failures.

   A standards-based `412` would require a real client `If-Match` contract and is not recommended here.
   Regenerate generated artifacts with `deno task generate:api-types` and `deno task bundle:api`.

8. **Make recovery visible in the existing UI.** In
   `routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`, exhaustively map typed reasons. On
   invalidation, immediately disable Apply, retain the reviewed diff read-only, show “Nothing was
   applied,” identify PCD, live Arr, both, or unverifiable evidence, and direct the user to generate and
   review a new preview. Restate target, human-facing Arr type, and exact sections in confirmation. Use
   the conservative status “Validating reviewed preview…” until the endpoint returns; do not imply
   writes have begun. Preserve exact-name destructive confirmation and existing `alertStore` feedback,
   with a persistent `role="alert"` recovery block as the authoritative local state.

### Technology

- Use global Web Crypto `crypto.subtle.digest('SHA-256', ...)`; add no hashing or canonical-JSON
  dependency.
- Use a closed TypeScript evidence schema and explicit per-section projections rather than generic raw
  response serialization.
- Reuse `generatePreview()`, `getSection()`, `SYNC_SECTION_ORDER`, per-Arr clients, section config
  parsers, diff helpers, TTL helpers, and existing outcome/history machinery.
- Keep the binding in the existing bounded, process-local preview store. A restart or deploy should
  continue to fail closed and require regeneration.

### Phasing

1. Contract and pure binding primitives, including canonicalization/comparison tests.
2. Evidence capture and atomic preview-store completion/claim behavior.
3. Reviewed all-section claim and `executeReviewedSyncJob()` boundary.
4. Config parity in all four syncers and explicit Radarr/Sonarr/Lidarr revalidation.
5. Apply-route typed mapping and UI invalidate/regenerate recovery.
6. Focused route, execution-boundary, cross-Arr, concurrency, and full validation tests.

### Quick Wins

- Replace the route dependency seam from positional `executeSyncJob` to object-based
  `executeReviewedSyncJob`; this makes exact scope/type/config requirements visible in tests.
- Add pure mutation-table tests for `pcd_drift`, `arr_drift`, combined drift, and plan-only mismatch
  before integrating every syncer.
- Change the three direct saved-config reads to their existing `get*SyncConfig()` helpers and add
  override parity tests.
- Replace “Apply reruns the eligible selected sections” with the reviewed validation promise and add
  a typed, persistent regeneration state.

## Improvement Ideas

The following are useful follow-ups but are explicitly out of scope for issue #234:

- Persisting confirmed per-entity outcomes or changing their model; that remains issue #232 territory.
- Durable persistence/distribution of previews and claims for multi-process deployments.
- Preview ownership by OIDC user/session/API-key principal. The current single-operator trust model
  should be documented; ownership hardening deserves a separate authorization-focused issue.
- A generalized owner-token/lease framework or crash-recovery redesign beyond the minimal safe
  reviewed claim required here.
- Conditional-write/ETag integration per Arr endpoint, if future verified upstream contracts expose
  stable preconditions.
- Durable audit events for rejected reviews. A rejection must not masquerade as a sync run or create
  confirmed outcomes.
- Aligning the 10-minute store TTL with the 30-minute hard-age constant.
- Removing/repositioning the surrounding page's “Save & Sync” action or adding Sync History deep links,
  except for minimal copy/state separation needed to avoid confusing it with Apply Preview.
- Server-streamed validation/apply phase progress, automatic regenerated-diff display, or automatic
  application of a changed plan.

## Risk Assessment

| Risk                                                              | Severity      | Mitigation / proof required                                                                                                                                               |
| ----------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revalidation and execution use different config or material reads | Critical      | Stored normalized `sectionConfigs`; common getters; same explicit client/type; reuse prepared values or immediate value guards; mutation tests prove zero writes on drift |
| A later selected section drifts after an earlier section writes   | Critical      | Claim and revalidate all selected sections before any mutation, snapshot, history row, or outcome                                                                         |
| `setSectionsStatusPending()` overwrites another `in_progress` run | Critical      | Dedicated reviewed all-section claim; never call the unconditional pending setters before claim; concurrency test asserts status is preserved                             |
| Hash schema omits a write-relevant field                          | High          | Explicit per-section, per-Arr projections derived beside actual reads/writes; plan hash; mutation coverage for identities, fields, mappings, and order                    |
| Volatile/order-only data causes false drift                       | Medium        | Sort only documented sets; preserve semantic ordering; exclude only proven non-material fields; canonical preimage tests                                                  |
| Instance or Arr family changes after preview                      | High          | Re-read enabled instance and require exact bound identity/type; explicit per-Arr clients and capability checks; no sibling fallback                                       |
| Preview expires while waiting for a claim/revalidation            | High          | Preserve `expiresAt`; re-check after claims and before crossing the first-write boundary; never extend TTL                                                                |
| Errors leak raw Arr/PCD details or secrets                        | High          | Closed typed reasons and fixed safe messages; protected redacted logs only; hashes/evidence remain private                                                                |
| Two apply requests use the same preview                           | High          | Atomic `claimReadyForApply`; terminal invalidation/applied states; concurrent apply test                                                                                  |
| External Arr writer races after validation                        | Residual high | Minimize the validation-to-write interval; use immediate per-entity old-value guards where available; document lack of general Arr conditional writes                     |
| Binding memory grows or becomes stale across deploys              | Low           | Existing capacity/TTL; hashes plus normalized configs only; version mismatch fails closed                                                                                 |

## Integration Challenges

- `generatePreview()` currently returns only the public plan. It must produce private binding evidence
  without leaking it to MCP/live-diff/drift callers that also reuse preview generation. Prefer an
  optional internal evidence context/result used by the create/apply flow, while preserving the public
  result shape for other callers.
- Section syncers mix preview-aware config getters with direct saved-config reads. Reviewed execution
  needs parity without changing ordinary sync behavior.
- Existing claims are per-table `pending -> in_progress` updates, while reviewed apply needs all-or-none
  reservation before validation. Implement the smallest transaction/helper across the selected config
  rows; avoid a schema migration unless current row states cannot support safe acquisition/release.
- `arrSyncHandler` currently performs client setup, version detection, snapshots, and history preview
  before section claims/writes. Reviewed validation must occur after safe claim/client/type resolution
  but before snapshots and history capture, which may require extracting a small shared execution
  function rather than calling the handler wholesale.
- The apply route currently performs separate `get()` and `transition()` calls. Replace them with a
  store CAS-like operation to avoid lifecycle races and expected-transition exceptions.
- The API has separate generated artifacts. Contract changes are incomplete until OpenAPI, generated
  application types, `praxrr-api` types/bundle, runtime handlers, and UI interpretation agree.
- The UI must keep an invalidated old diff visible while preventing re-apply. A transient alert alone
  is insufficient; local non-applicable state must be explicit.

## Performance/Security

- Apply adds one authoritative preview-equivalent read pass. Keep it sequential in established section
  order, reuse one explicit per-instance client/cache, bound evidence by existing preview limits, and
  fail without request-level retry loops.
- Canonicalization/hashing is linear in bounded preview evidence and is expected to be small compared
  with Arr/PCD reads. Hash normalized projections, not full upstream payloads.
- Keep authentication, body-size limits, creation rate limits, capacity cleanup, lifecycle checks,
  eligibility checks, and in-progress preflight. Hash equality is not authorization.
- Never include API keys, decrypted credentials, authorization headers, repository tokens, raw URLs,
  or raw upstream errors in evidence or client responses. If target credential identity is bound, use a
  non-secret record/version identifier.
- Log only preview ID, safe reason, instance ID, explicit Arr type, and selected sections at normal
  levels. Do not log raw evidence or field values.
- Claims and validation must be authoritative across the single-process execution choke point. Missing
  store state or an unknown binding version always requires regeneration.

## Alternative Approaches

| Approach                                                                                          | Pros                                                                                                    | Cons                                                                                                                | Effort | Recommendation                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| Private binding plus immediate authoritative revalidation through existing preview/sync semantics | Precise PCD-vs-Arr evidence; narrow change; keeps writers and per-Arr logic; preserves transient config | Requires explicit evidence capture and careful claim/write ordering; small unavoidable external Arr race            | Medium | **Choose this**                                   |
| Persist and replay an immutable executable plan/payload                                           | Strongest desired-side binding; no desired re-read                                                      | Duplicates or restructures all section writers; stored payloads can become invalid; larger security/storage surface | High   | Do not use for #234                               |
| Hash only stored `EntityChange` display diffs and regenerate them at apply                        | Simple and easy to test                                                                                 | Display diffs can omit unchanged fields still sent by writes; cannot prove exact material inputs                    | Low    | Reject                                            |
| Route-level revalidation followed by current `executeSyncJob()`                                   | Small route change                                                                                      | Leaves a large TOCTOU window, loses transient config, resets statuses, and may partially write before later drift   | Low    | Reject                                            |
| HTTP `ETag` / `If-Match` on the preview                                                           | Standards-friendly client binding                                                                       | Proves which preview the client saw, not that PCD/Arr evidence is current; adds request contract                    | Medium | Defer unless a public conditional API is required |
| Add durable shared claims/plans                                                                   | Multi-worker/restart resilience                                                                         | Migrations, cleanup, ownership, encryption, and lifecycle expansion beyond the issue                                | High   | Out-of-scope follow-up                            |

## Task Breakdown Preview

1. **Contract model** — define stale reasons/evidence classes and invalidation response in
   `docs/api/v1/schemas/sync.yaml` / `paths/sync.yaml`; depends on final reason/status decisions.
2. **Pure binding core** — implement `reviewBinding.ts` and focused canonical/comparison tests; depends
   on task 1's enums but can otherwise proceed independently.
3. **Evidence capture** — add sink plumbing in `base.ts`, `types.ts`, `orchestrator.ts`, and four
   syncers; depends on task 2.
4. **Private store binding** — add atomic completion/claim and TTL/concurrency tests in `store.ts`;
   depends on task 2.
5. **Reviewed claim/executor** — add safe all-section claims and `executeReviewedSyncJob()` in
   `arrSync.ts`, preserving exact type/sections/config/TTL and zero pre-validation side effects;
   depends on tasks 3 and 4.
6. **Config parity** — route reviewed config through all four `sync()` implementations and add parity
   tests; depends on task 3 and is required by task 5.
7. **Apply route** — switch the injected dependency, map 404/409/422/500, and terminally invalidate on
   drift; depends on tasks 1, 4, and 5.
8. **UI recovery** — typed invalidation state, read-only old diff, regenerate guidance, scope/type in
   confirmation, and accessibility assertions; depends on tasks 1 and 7.
9. **Acceptance regression suite** — PCD-only, Arr-only, both, ambiguous, config, type, subset,
   later-section, TTL, duplicate apply, active claim, and Radarr/Sonarr/Lidarr cases; depends on all
   implementation tasks.
10. **Generated contracts and validation** — run API generation/bundling, issue-focused test command,
    `deno task check`, relevant broader tests, lint/format, and manual PCD/Arr mutation checks; depends
    on tasks 1–9.

## Key Decisions Needed

1. **Execution strategy:** choose immediate authoritative revalidation through the existing preview
   semantics, followed by the existing writers with the same stored configs. Do not build payload
   replay for #234.
2. **Transient configs:** treat submitted `sectionConfigs` as executable reviewed state because that is
   what the current preview UI promises; bind and reuse them. If product intent differs, Apply must be
   disabled until saved config is proven identical, which changes UX and should be decided before code.
3. **HTTP status:** use `422` for reviewed evidence invalidation/expiry and `409` for lifecycle/claim
   conflicts. Do not introduce `412` without `If-Match`.
4. **Lifecycle:** use terminal `failed` plus typed invalidation details rather than a new public `stale`
   status.
5. **Claim implementation:** use a minimal all-selected-sections atomic claim that never rewrites
   `in_progress`. Avoid generalized leases unless transactional acquisition/release is impossible with
   current tables.
6. **Drift taxonomy:** config and desired-source changes count as desired-side/PCD drift for the user;
   exact instance/type/capability changes are `scope_drift` or `unverifiable_review`; unreadable or
   plan-only mismatches are `unverifiable_review`. Keep PCD and Arr evidence distinct in every response.
7. **Outcomes/history:** a pre-write invalidation returns no outcomes and creates no sync-history row;
   durable rejected-review audit is a follow-up.

## Open Questions

1. Which non-secret target fields beyond `instanceId`, enabled state, and exact `arrType` must be bound
   to prevent an instance row from being redirected (canonical URL, credential record/version)?
2. Can the four existing config tables participate in one transaction that safely acquires and releases
   all selected claims without an ownership column? If not, what is the smallest owner token needed?
3. For each section and Arr version, which current fields are sent back unchanged by PUT and therefore
   must be included in Arr evidence even when the displayed diff omits them?
4. Can each writer consume the already revalidated prepared desired/current values, or which exact
   writes need a final old-value guard to narrow the external Arr race?
5. Is the Lidarr metadata-schema `null` fallback stable evidence, or should inability to retrieve the
   schema always produce `unverifiable_review`?
6. Should the invalidation response include bounded changed section names in addition to evidence
   classes? This improves recovery but is not required to satisfy precise PCD-vs-Arr attribution.
7. Is the 10-minute store TTL intentionally shorter than the 30-minute hard block? Preserve both in
   this issue regardless; resolve policy alignment separately.
