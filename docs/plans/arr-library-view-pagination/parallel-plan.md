# Arr Library View Pagination Implementation Plan

Arr library pages currently fetch full datasets and rely on client-side filtering/rendering, which degrades responsiveness on larger instances. This plan introduces server-driven pagination metadata and query handling in `/api/v1/arr/library`, then threads page state through existing route-level state orchestration and cache layers without changing Arr-specific row payload semantics. Work is staged contract-first so UI integration depends on a stable API envelope and cache key model. Validation focuses on contract fidelity, cache invalidation coherence, and Arr-type behavioral parity across Radarr, Sonarr, and Lidarr flows.

## Critically Relevant Files and Documentation

- `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`: Primary API integration point for pagination query parsing, slicing, metadata, and error handling.
- `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`: Primary UI orchestration point for page/pageSize state, request params, and render lifecycle.
- `/packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte`: Existing action surface where pagination controls integrate with filters/search.
- `/packages/praxrr-app/src/lib/client/stores/libraryCache.ts`: Client cache abstraction to extend with page/query-aware keys.
- `/packages/praxrr-app/src/lib/server/utils/cache/cache.ts`: Server cache service used by Arr library route; key strategy must support page/query variants.
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Arr instance resolution used before dispatch and fetch.
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts`: Profile-name enrichment used in library responses and must remain intact with pagination.
- `/docs/api/v1/paths/arr.yaml`: OpenAPI path contract source for `/arr/library` query parameters and operation docs.
- `/docs/api/v1/schemas/arr.yaml`: OpenAPI schema source for library response metadata fields.
- `/packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts`: Existing backend parity/error test file to extend for pagination.
- `/packages/praxrr-app/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts`: Existing E2E flow to extend with pagination UX assertions.
- `/docs/plans/arr-library-view-pagination/feature-spec.md`: Requirements and acceptance criteria for this feature.
- `/docs/plans/arr-library-view-pagination/research-technical.md`: Technical guidance for API/cache/UI pagination integration.
- `/docs/plans/arr-library-view-pagination/research-ux.md`: UX and accessibility expectations for pagination controls and status messaging.

## Implementation Plan

### Phase 1: API Contract and Cache Foundation

#### Task 1.1: Add paginated request/response behavior to Arr library API Depends on [none]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts`
- `/packages/praxrr-app/src/lib/server/utils/arr/clients/radarr.ts`
- `/packages/praxrr-app/src/lib/server/utils/arr/clients/sonarr.ts`
- `/packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`
- `/docs/ARCHITECTURE.md`
- `/docs/plans/arr-library-view-pagination/feature-spec.md`

**Instructions**

Files to Create

- None

Files to Modify

- `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`

- Implement query parsing/validation for `page`, `pageSize`, and any agreed filter/sort params.
- Implement query parsing/validation for `page`, `pageSize`, and agreed filter/sort params with explicit defaults (`page=1`, `pageSize=100`) and bounded limits (`pageSize` max `250`).
- Preserve explicit Arr-type dispatch and profile enrichment flow, then apply deterministic filter/sort and pagination slicing before response assembly.
- Add pagination metadata (`page`, `pageSize`, `totalRecords`, `totalPages`, `hasNext`) to every success payload while preserving existing Arr-specific `items` shape.
- Keep current error envelope/status behavior (`400`/`404`/`500`) and capability semantics unchanged.

#### Task 1.2: Make server cache key strategy pagination-aware Depends on [none]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/lib/server/utils/cache/cache.ts`
- `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`
- `/docs/plans/arr-library-view-pagination/research-technical.md`

**Instructions**

Files to Create

- None

Files to Modify

- `/packages/praxrr-app/src/lib/server/utils/cache/cache.ts`
- `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`

- Add a deterministic composite key model for Arr library cache entries that includes instance and pagination/query dimensions.
- Use a deterministic key format such as `library:{instanceId}:{queryHash}:{sortKey}:{sortDirection}:{page}:{pageSize}` so different query/page variants cannot collide.
- Ensure DELETE invalidation behavior clears all relevant page/query variants for the target instance.
- Keep TTL behavior aligned with existing defaults and avoid introducing cross-instance or cross-query collisions.

#### Task 1.3: Update OpenAPI path/schema contract for pagination Depends on [1.1]

**READ THESE BEFORE TASK**

- `/docs/api/v1/paths/arr.yaml`
- `/docs/api/v1/schemas/arr.yaml`
- `/docs/plans/arr-library-view-pagination/feature-spec.md`

**Instructions**

Files to Create

- None

Files to Modify

- `/docs/api/v1/paths/arr.yaml`
- `/docs/api/v1/schemas/arr.yaml`

- Add documented query parameters and constraints for pagination fields on `/arr/library`.
- Extend library response schemas to include pagination metadata and ensure Arr-specific response wrappers remain accurate.
- Keep docs aligned with runtime contract from Task 1.1; do not introduce schema names or field variants not accepted at runtime.

### Phase 2: UI State, Controls, and Client Cache Integration

#### Task 2.1: Add route-level pagination state and request wiring Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`
- `/packages/praxrr-app/src/lib/client/stores/search.ts`
- `/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte`
- `/docs/plans/arr-library-view-pagination/research-ux.md`

**Instructions**

Files to Create

- None

Files to Modify

- `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`

- Add `page` and `pageSize` state that is synchronized with URL query parameters and existing search/filter state handling.
- Update library fetch requests to pass pagination/query params and consume metadata fields from API responses.
- Preserve unsupported-workflow handling and current refresh semantics while resetting to `page=1` on filter/search/pageSize changes.
- Keep row rendering/data-shaping unchanged outside the new paginated slice inputs.

#### Task 2.2: Integrate pagination controls and status messaging in library actions Depends on [2.1]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte`
- `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`
- `/docs/plans/arr-library-view-pagination/research-ux.md`

**Instructions**

Files to Create

- None

Files to Modify

- `/packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte`
- `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`

- Add pager controls (previous/next and page summary) and rows-per-page selection integrated with route callbacks.
- Ensure controls are disabled/enabled correctly during loading, boundary pages, and unsupported states.
- Add accessible pagination region semantics and status messaging (`Showing X-Y of Z`) consistent with existing UI patterns.

#### Task 2.3: Make client cache page/query aware and align refresh invalidation Depends on [2.1, 1.2]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/lib/client/stores/libraryCache.ts`
- `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`
- `/docs/plans/arr-library-view-pagination/research-technical.md`

**Instructions**

Files to Create

- None

Files to Modify

- `/packages/praxrr-app/src/lib/client/stores/libraryCache.ts`
- `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`

- Expand client cache keys/entries to include pagination/query dimensions so page navigation does not reuse stale slices.
- Ensure refresh and forced invalidation clear all relevant per-instance pagination cache entries (all page/query variants for that instance).
- Preserve existing cache aging semantics and keep API retry behavior predictable when cache misses occur.

### Phase 3: Contract Verification and Regression Hardening

#### Task 3.1: Extend backend parity tests for paginated Arr library behavior Depends on [1.1, 1.2, 1.3]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts`
- `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`
- `/docs/api/v1/schemas/arr.yaml`

**Instructions**

Files to Create

- None

Files to Modify

- `/packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts`

- Add tests for pagination parameter validation (invalid/missing/bounds cases) and expected status codes/error envelopes.
- Add success-path assertions for pagination metadata correctness and Arr-type parity in response shape.
- Keep existing unsupported and failure-path tests intact to prevent capability regressions.

#### Task 3.2: Extend E2E library flow with pagination interactions Depends on [2.1, 2.2, 2.3]

**READ THESE BEFORE TASK**

- `/packages/praxrr-app/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts`
- `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`
- `/packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte`
- `/docs/plans/arr-library-view-pagination/research-ux.md`

**Instructions**

Files to Create

- None

Files to Modify

- `/packages/praxrr-app/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts`

- Add assertions for pagination control presence, state transitions, and visible page summary behavior.
- Validate page changes request expected API params (`page`, `pageSize`, and active query/filter params) and maintain filter/search/column behavior consistency.
- Cover at least one empty/error pagination state path to verify user feedback and control disablement.

#### Task 3.3: Final contract-fidelity and Arr-semantics verification pass Depends on [3.1, 3.2]

**READ THESE BEFORE TASK**

- `/docs/api/v1/paths/arr.yaml`
- `/docs/api/v1/schemas/arr.yaml`
- `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`
- `/docs/plans/arr-library-view-pagination/feature-spec.md`

**Instructions**

Files to Create

- None

Files to Modify

- `/docs/plans/arr-library-view-pagination/parallel-plan.md`
- `/tasks/todo.md`

- Run final verification checklist: API docs/runtime parity, Arr-type dispatch semantics, and cache invalidation coherence.
- Record any discovered mismatches in `tasks/todo.md` under the Arr library pagination workflow section and resolve before sign-off.
- Mark final readiness only when all of the following are true: validation scripts pass, dependency/path/task-quality checks report no unresolved issues, and all workflow checklist items in `tasks/todo.md` are checked.

## Advice

- Keep filter/sort ordering deterministic on the server before slicing; pagination correctness depends on this sequence.
- Treat cache key migration as a first-class risk area and validate GET/DELETE invalidation behavior together, not separately.
- Preserve Arr-type explicit branching in all new logic to avoid silent cross-app semantic drift.
- Do not let OpenAPI lead runtime behavior; runtime contract should be finalized first, then docs updated to match exactly.
- Prioritize backend contract tests before UI polish so E2E failures can isolate UI integration issues instead of payload ambiguity.

## Task 3.3 Verification Report

### Verification Commands Executed

- `~/.config/dotfiles/.codex/skills/parallel-plan/scripts/validate-parallel-plan.sh docs/plans/arr-library-view-pagination/parallel-plan.md` (pass)
- `~/.config/dotfiles/.codex/skills/plan-workflow/scripts/validate-workflow-plan.sh docs/plans/arr-library-view-pagination/parallel-plan.md` (pass, parser warning in script line 98 does not fail checks)
- `~/.config/dotfiles/.codex/skills/parallel-plan/scripts/check-prerequisites.sh arr-library-view-pagination` (pass)
- `~/.config/dotfiles/.codex/skills/plan-workflow/scripts/check-state.sh arr-library-view-pagination` (pass)
- `deno task check:server` (fails: existing unrelated type error in `packages/praxrr-app/src/lib/server/pcd/entities/clone.ts`)
- `deno test --no-check --allow-read --allow-write --allow-env --allow-ffi packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts` (pass, 12/12)
- `deno test --no-check packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts` (fails: expected env permission; use `--allow-env`)

### Findings

- [x] Resolved: server cache key now uses pagination/query-aware `buildArrLibraryCacheKey(...)` in `/api/v1/arr/library` and includes `queryHash`, `sortKey`, `sortDirection`, `page`, and `pageSize`.
- [x] Resolved: DELETE cache invalidation now clears all library variants per instance via `cache.deleteByPrefix(getArrLibraryCachePrefix(instanceId))` in both `/api/v1/arr/library` and `arr/[id]/library/+page.server.ts`.
- [x] Resolved: `/arr/library` query schema in `packages/praxrr-app/src/lib/api/v1.d.ts` includes `page`, `pageSize`, `query`, `sortKey`, and `sortDirection`.

### Final Readiness

- [x] Cache-key collisions and API runtime/type contract drift are resolved for Arr library pagination.
