# Code Analysis: Sync Preview Reviewed-Plan Binding

## Executive Summary

Issue #234 must replace Apply's current "review one diff, then run a fresh normal sync" behavior with
a private, versioned binding that is re-materialized and compared before the first write. The safest
seam is the existing preview orchestrator: it already dispatches exact sections through the concrete
Arr-specific syncers and produces material `EntityChange` plans. Extend that path to capture separate
PCD/config, live Arr, and plan evidence; keep the evidence beside the private store entry; and add a
dedicated reviewed executor that claims every selected section, regenerates all selected evidence,
then either releases the claims with a typed invalidation or invokes the writers with the exact bound
configuration.

Three existing hazards make a route-only comparison insufficient. First, `get()` and `transition()`
are separate store operations, so concurrent Apply calls can observe the same ready snapshot. Second,
`executeSyncJob()` resets every requested section to `pending` before claiming it, which can overwrite
an `in_progress` status. Third, delay, media-management, and metadata writers reload saved config even
though preview generation may have used transient `sectionConfigs`. All three must be corrected at the
execution boundary for the reviewed-plan guarantee to be real.

## Existing Code Structure

### Related Components

- Preview creation parses ordered sections and untyped config overrides, creates a public
  `generating` snapshot, calls `generatePreview()`, then updates the snapshot to `ready`
  (`routes/api/v1/sync/preview/+server.ts:27-117`, `263-307`). This is the point at which the private
  binding must be installed atomically with the ready result.
- `generatePreview()` preserves explicitly requested order, creates one Arr client, dispatches via the
  section registry, applies `setPreviewConfig()`, and clears it after each read-only preview
  (`sync/preview/orchestrator.ts:72-96`, `193-282`). It already provides the single domain path needed
  for initial evidence and revalidation.
- `SyncPreviewStore` currently stores only the public `SyncPreviewResult`; `get()` returns it directly,
  and `transition()` delegates to a separate update operation (`sync/preview/store.ts:81-98`,
  `166-236`). No private binding or atomic ready-to-applying claim exists.
- Apply derives eligible sections from successful section outcomes, performs a non-atomic in-progress
  precheck, transitions the preview, then calls the ordinary executor with only instance, sections,
  source, and preview ID (`sync/preview/[previewId]/apply/+server.ts:76-90`, `159-221`).
- `executeSyncJob()` first calls `setSectionsStatusPending()` (`jobs/handlers/arrSync.ts:84-134`); the
  handler later repeats `setStatusPending()` immediately before `claimSync()`
  (`jobs/handlers/arrSync.ts:512-526`). This defeats the route's earlier concurrency check.
- Section claims are conditional `pending -> in_progress` statements in four different tables
  (`db/queries/arrSync.ts:954-994`). They are individually atomic, but not an all-selected claim.
- Snapshots, history change capture, and history record construction begin before section writes
  (`jobs/handlers/arrSync.ts:334-370`, `434-447`). Reviewed invalidation must happen before these steps,
  not merely before `syncer.sync()`.
- Public preview types intentionally contain only lifecycle, section outcomes, diffs, and summary
  (`sync/preview/types.ts:8-106`). Private evidence should not be added to this DTO.

### File Organization

- Preview lifecycle and comparison logic belong under
  `packages/praxrr-app/src/lib/server/sync/preview/`.
- Execution coordination belongs in `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`, with
  low-level conditional status operations in `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`.
- Section-specific material projections stay beside the reads/writes in the four concrete syncers.
- API response taxonomy is source-controlled in `docs/api/v1/{schemas,paths}/sync.yaml`; generated app
  types and the portable `praxrr-api` bundle are outputs, not independent contracts.
- Route regressions currently live in
  `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`; pure binding and executor tests
  should be separate focused files under `src/tests/sync/preview/` or the established `src/tests/base/`
  area.

## Implementation Patterns

1. **Private public-envelope split.** Extend `StoredPreview`, not `SyncPreviewResult`, with a cloned
   `SyncPreviewReviewBinding`. Add an atomic completion method that installs the binding and public
   ready snapshot together, plus `claimReadyForApply(id, sections, nowMs)` that checks expiry, status,
   binding version, and selected coverage before synchronously changing `ready -> applying`. `get()`
   must continue to return only the public snapshot.
2. **Deterministic versioned hashing.** Follow the existing Web Crypto implementation
   (`pcd/snapshots/fingerprint.ts:45-50`) but hash explicit JSON-safe projections with a version/domain
   prefix. Canonicalize object keys; sort only collections that are semantically sets; preserve ordered
   arrays and reviewed section order. The current diff engine shows the relevant precedent: object keys
   are sorted, keyed arrays use explicit strategies, and unkeyed arrays remain index-sensitive
   (`sync/preview/diff.ts:159-233`; `sync/preview/sectionDiffs.ts:12-99`).
3. **Three independent evidence classes.** For each section capture:
   - PCD/config material, including exact effective `sectionConfigs`, selected database IDs and exact
     config/profile names, desired transformed payloads, mappings, namespaces, and fallback selections;
   - live Arr material actually consulted by the preview, including remote IDs and all write-relevant
     current fields;
   - the complete section plan (`EntityChange` identity, action, remote ID, ordered fields/current/
     desired values and section outcome), never summary counts alone.
4. **One materialization path.** Add an optional evidence collector/context to `BaseSyncer` and
   `GeneratePreviewInput`; populate it from the same local values used to build each section diff.
   Do not implement independent route-level PCD or Arr readers. The orchestrator already guarantees
   explicit `radarr|sonarr|lidarr` narrowing (`orchestrator.ts:64-69`, `193-223`) and registry dispatch.
5. **All-selected claim before any side effect.** Add a dedicated reviewed execution entry point with
   an object input containing binding, exact selected sections, source, and preview ID. It must reload
   the enabled instance, compare exact `arrType`, validate capability/version, synchronously claim all
   selected section rows without resetting active work, then re-materialize all sections. Use a short
   synchronous SQLite transaction for the multi-table compare/update; never hold the repository's
   shared DB transaction across Arr/PCD awaits (`db/db.ts:168-227`). Preserve enough prior status state
   to release claims without losing pre-existing pending work when validation fails.
6. **Validate-all, then write.** Only after all hashes match may the executor cross into snapshot,
   history, or writer code. A mismatch across one or more sections invalidates the entire selected
   apply, releases all claims, records no `SyncEntityOutcome` and no `sync_history` row, and returns the
   aggregate `pcd_drift`, `arr_drift`, `pcd_and_arr_drift`, `scope_drift`, or
   `unverifiable_review` result.
7. **Exact writer config parity.** Quality profiles already resolves config through
   `getQualityProfilesSyncConfig()` in its shared fetch path (`qualityProfiles/syncer.ts:467`,
   `817-825`). Change delay, media-management, and metadata `sync()` to use their existing preview-aware
   getters instead of direct DB reads (`delayProfiles/syncer.ts:235-256`,
   `mediaManagement/syncer.ts:633-639,761-763`, `metadataProfiles/syncer.ts:410-413,535-542`). The
   reviewed executor must set and clear the bound config around the writer just as the orchestrator
   does around preview generation.
8. **Planned versus confirmed evidence.** Keep `EntityChange` as authorization/planned evidence and
   emit `SyncEntityOutcome` only from actual write results; this distinction is compiler-enforced in
   `sync/types.ts:14-80` and persisted by the current handler only after execution.

## Integration Points

### Files to Create

- `packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts`: binding version, canonical
  projection/hash helpers, section comparison, drift aggregation, and typed reviewed-plan error.
- A focused pure test file for canonicalization/version rejection and PCD-only, Arr-only, combined,
  config, plan, scope, ordering, and unverifiable mutations.
- A focused reviewed-executor test file proving all-section claim/rollback behavior and that snapshots,
  history, outcomes, and writers remain untouched on rejection.

### Files to Modify

- `docs/api/v1/schemas/sync.yaml`, `docs/api/v1/paths/sync.yaml`: define the regenerate-required 422
  response and update Apply semantics from "current saved config" to reviewed revalidation.
- `packages/praxrr-app/src/lib/server/sync/preview/{types,store,orchestrator}.ts` and
  `sync/base.ts`: internal binding/evidence contracts, private lifecycle atomics, and capture context.
- The four concrete syncers: capture exact desired/current inputs; make all writer config reads honor
  bound overrides.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: multi-section guarded claim/release query
  helpers that preserve Lidarr-only metadata scoping.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: reviewed executor and a shared
  post-validation write phase; leave normal scheduled/manual execution behavior intact.
- Preview create/apply routes: install the binding, use atomic store claim, map typed failures, and
  inject the reviewed executor/clock for tests.
- `SyncPreviewPanel.svelte`: retain the old diff read-only, disable Apply after invalidation, focus a
  persistent `role="alert"`, state that nothing was applied, and expose regeneration.
- `syncPreviewRouteHardening.test.ts` and syncer tests: adapt injected dependency shape and prove exact
  instance/Arr type/section/config threading and zero execution on every invalidation.
- Generated contract mirrors: `packages/praxrr-app/src/lib/api/v1.d.ts`,
  `packages/praxrr-api/openapi.json`, and `packages/praxrr-api/mod.ts` via repository tasks.
- `docs/site/src/content/docs/app/sync-pipeline.md` and `ROADMAP.md`: document the validation barrier
  and issue #234 delivery without conflating it with #232 confirmed outcomes.

## Code Conventions

### Naming

- Reuse `SyncPreview*` for public/API contracts and `SyncPreviewReviewBinding` /
  `SectionReviewEvidence` for private contracts. Keep section literals camelCase and Arr values exact
  lowercase literals.
- Preserve exact persisted config/profile names. Validation may reject whitespace-only names, but must
  not trim the identifier used for lookup or hashing (`db/queries/arrSync.ts:180-202`).
- Prefer discriminated result unions for expected claim/invalidation outcomes; reserve exceptions for
  truly unexpected failures.

### Error Handling

- Expected drift is a safe 422 with a stable code, changed evidence class, changed sections,
  `regenerateRequired: true`, and no raw PCD/Arr payload or hash material.
- Lifecycle/active-claim conflicts remain 409; missing/expired store entries remain 404 or the existing
  TTL behavior. Unknown binding versions and comparison/read failures fail closed as
  `unverifiable_review`.
- Keep protected diagnostic detail in logs and user messages sanitized. Never convert validation
  rejection into a confirmed failure outcome or Sync History run.

### Testing

- Use injected dependencies and clocks as established by
  `syncPreviewRouteHardening.test.ts:89-99,101-176`; avoid live Arr or timing dependence.
- Mutation tests must change a material entity/field while preserving summary counts, reorder a
  semantic sequence, mutate config names without trimming, and mutate only an unselected section.
- Cover Radarr, Sonarr, and Lidarr explicitly, including rejection of metadata profiles outside Lidarr
  and no sibling fallback. Assert exact selected section order and exact instance ID/Arr type.
- For every rejection assert writer call count, snapshot call count, history insert count, and outcomes
  are all zero; also assert all acquired claims are released to their prior states.

## Dependencies and Services

- No new package is required. Use Deno Web Crypto `crypto.subtle.digest('SHA-256', ...)` and existing
  Arr clients, PCD caches/entities, section registry, SQLite manager, logger, and preview store.
- Contract regeneration uses `deno task generate:api-types` and `deno task bundle:api`; portable parity
  is guarded by `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`.
- Relevant validation is the issue-focused route/binding/executor suite, existing syncer and outcome
  regressions, `deno task check`, `deno task lint`, and `deno task test`; run `graphify update .` after
  source changes per project policy.

## Gotchas and Warnings

- Hashing only the public diff is insufficient: current/desired values omitted by ignored-field or
  comparable projections may still affect a later write. Evidence must be captured beside the actual
  read/transformation/write payload construction.
- Do not hash volatile transport or server-generated fields unless a writer depends on them; doing so
  creates false drift. Conversely, remote IDs, mappings, namespaces, schema-derived defaults, and
  fallback selection decisions are material when they control update/create behavior.
- Metadata preview can fall back to local schema values when the Lidarr schema read fails
  (`metadataProfiles/syncer.ts:347-375`), while sync independently retries the schema
  (`464-490`). That fallback decision/material must be bound or treated as unverifiable; otherwise the
  writer can construct a different payload from the reviewed preview.
- A transient override can make a section previewable even when `handler.hasConfig()` is false
  (`orchestrator.ts:228-245`). Reviewed execution must not later skip that section because saved config
  is absent.
- The normal handler currently captures snapshots and history diffs before claims/writes. Reusing it
  wholesale before validation violates the zero-side-effect acceptance criterion; factor a
  post-validation execution phase instead.
- `SyncPreviewStore.updateResult()` throws on an invalid transition rather than returning null
  (`store.ts:124-139`); the new atomic API should return an explicit conflict result so concurrent Apply
  cannot escape as an unhandled 500.
- The store TTL is ten minutes (`store.ts:10`), while the legacy hard-age block is thirty minutes.
  Preserve TTL behavior and avoid treating the unreachable age threshold as the primary integrity
  guard.
- Namespace allocation such as metadata's `getOrCreate()` can itself mutate local state during preview
  (`metadataProfiles/syncer.ts:343-345`). Do not allow apply-time revalidation to choose a new namespace;
  bind its resolved value and ensure validation remains before any new persistent side effect.

## Task-Specific Guidance

Implement in dependency order: (1) pure binding/canonicalization types and tests; (2) private store
completion/claim atomics; (3) section evidence capture plus writer config parity; (4) all-section
claim/release and reviewed executor; (5) Apply contract/route mapping; (6) persistent UI recovery; (7)
generated artifacts, documentation, and full validation. Treat the first snapshot/history/outcome/Arr
write as a hard boundary and structure the reviewed executor so every scope, config, PCD, Arr, and plan
comparison is visibly complete before crossing it.

The final acceptance proof should demonstrate the same selected subset and exact explicit `arrType`
from preview binding through revalidation and write dispatch; PCD-only, Arr-only, combined, config,
scope, TTL, and concurrent-claim mutations must all reject with zero writes; an unselected-section-only
mutation must not block the selected subset; and a matching review must still produce only real
post-write `SyncEntityOutcome`/Sync History evidence.
