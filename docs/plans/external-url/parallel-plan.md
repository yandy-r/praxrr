# External URL Implementation Plan

This feature separates browser navigation targets from backend Arr connectivity by introducing optional `external_url` metadata on each Arr instance. The database/query contract must expand first so create/update/load paths can carry the new field without changing canonical API behavior. Form actions and UI surfaces then adopt a shared resolver (`external_url || url`) for all "Open in" links while keeping every server-side Arr client on `url`. The plan prioritizes low-risk sequencing: schema and query foundations, settings/action plumbing, link-surface rollout, and targeted regressions to prove compatibility for existing instances.

## Critically Relevant Files and Documentation

- /packages/praxrr-app/src/lib/server/db/schema.sql: Source-of-truth schema where `arr_instances` gains `external_url`.
- /packages/praxrr-app/src/lib/server/db/migrations.ts: Migration registry that must include new migration module.
- /packages/praxrr-app/src/lib/server/db/migrations/001_create_arr_instances.ts: Existing table baseline for migration compatibility.
- /packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts: Central CRUD/type contract for Arr instance data.
- /packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte: Shared create/edit form and hidden save payload source.
- /packages/praxrr-app/src/routes/arr/new/+page.server.ts: Create action parsing/validation/persistence path.
- /packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts: Update action parsing/validation/persistence path.
- /packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts: Instance loader that propagates new field to child routes.
- /packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte: Library row/action-bar Open-in URL generation.
- /packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte: Toolbar Open-in action entry point.
- /packages/praxrr-app/src/routes/arr/views/CardView.svelte: Arr card view Open-in button currently uses `instance.url`.
- /packages/praxrr-app/src/routes/arr/views/TableView.svelte: Arr table view Open-in button currently uses `instance.url`.
- /packages/praxrr-app/src/routes/arr/test/+server.ts: Connection test endpoint that must stay on canonical `url`.
- /packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts: Backend library fetch path that must stay on canonical `url`.
- /packages/praxrr-app/src/lib/server/utils/arr/factory.ts: Canonical Arr client creation layer.
- /packages/praxrr-app/src/tests/base/lidarrOnboarding.test.ts: Existing create/edit onboarding tests suitable for action coverage extension.
- /packages/praxrr-app/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts: E2E flow covering Arr setup/library interactions.
- /docs/plans/external-url/feature-spec.md: Requirements and success criteria for fallback behavior.
- /docs/plans/external-url/shared.md: Consolidated architecture/pattern context for this plan.

## Implementation Plan

### Phase 1: Data Contract Foundation

#### Task 1.1: Add `external_url` migration and schema documentation Depends on [none]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/db/schema.sql
- /packages/praxrr-app/src/lib/server/db/migrations.ts
- /packages/praxrr-app/src/lib/server/db/migrations/001_create_arr_instances.ts
- /docs/plans/external-url/feature-spec.md

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/db/migrations/20260216_add_arr_instance_external_url.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/db/migrations.ts
- /packages/praxrr-app/src/lib/server/db/schema.sql

Create a forward-only migration that adds nullable `external_url` to `arr_instances` with no destructive transforms and no default rewrite requirements for existing rows. Register the migration in `migrations.ts` and update the schema doc block to include the new column in the table definition. Keep naming and ordering conventions aligned with adjacent migration files and preserve existing comments explaining table purpose.

#### Task 1.2: Extend Arr instance query contract for `external_url` persistence Depends on [1.1]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts
- /packages/praxrr-app/src/routes/arr/new/+page.server.ts
- /packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/shared/arr/instanceUrl.ts

Files to Modify

- /packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts

Update `ArrInstance`, `CreateArrInstanceInput`, and `UpdateArrInstanceInput` to carry `external_url`/`externalUrl` with strict nullable typing. Ensure `create` and `update` SQL statements persist the field and normalize blank/whitespace values to `NULL` consistently. Add a small shared helper in `/packages/praxrr-app/src/lib/shared/arr/instanceUrl.ts` for browser URL resolution (`external_url?.trim() || url`) so UI surfaces can reuse one implementation in later phases.

#### Task 1.3: Add focused persistence tests for create/update/clear semantics Depends on [1.2]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/tests/base/lidarrOnboarding.test.ts
- /packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts
- /packages/praxrr-app/src/routes/arr/new/+page.server.ts
- /packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/base/arrExternalUrlPersistence.test.ts

Files to Modify

- /packages/praxrr-app/src/tests/base/lidarrOnboarding.test.ts

Add unit-style coverage proving `external_url` is optional on create, stored when provided, and cleared back to `NULL` when removed. Validate action behavior for invalid optional URL input and confirm canonical `url` remains required. Keep tests scoped to persistence and action contracts; do not couple them to UI rendering.

### Phase 2: Form and Action Plumbing

#### Task 2.1: Add optional `External URL` field to instance form and hidden payload Depends on [1.2]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte
- /packages/praxrr-app/src/lib/client/stores/dirty.ts
- /docs/plans/external-url/research-ux.md

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/client/validation/arrUrls.ts

Files to Modify

- /packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte

Add a visible optional `External URL` input with helper copy clarifying browser-only semantics. Wire field state into `initEdit` and dirty tracking for both create and edit flows, and add a hidden `external_url` input in the save form so enhanced submission includes the value. Add lightweight client validation helper usage (format-only) for immediate feedback while keeping server validation authoritative.
Use explicit copy aligned to UX research: label `External URL (optional)` and helper text `Used for Open in links. API calls still use URL.` so operators understand Docker/internal-network behavior immediately.

#### Task 2.2: Parse, validate, and persist `external_url` in create/update actions Depends on [1.2]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/routes/arr/new/+page.server.ts
- /packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts
- /packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts
- /packages/praxrr-app/src/routes/arr/test/+server.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/utils/validation/url.ts

Files to Modify

- /packages/praxrr-app/src/routes/arr/new/+page.server.ts
- /packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts

Extend both actions to parse `external_url`, trim input, enforce optional absolute `http(s)` validation, and pass normalized values to query helpers. Keep existing duplicate-name/API-key validation and redirect/fail behavior intact. Explicitly preserve `/arr/test` and all backend Arr client calls on canonical `url` by avoiding any substitution with `external_url` in server communication flows.

#### Task 2.3: Verify layout propagation and action-to-UI state refresh Depends on [2.1, 2.2]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts
- /packages/praxrr-app/src/routes/arr/[id]/settings/+page.svelte
- /packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/base/arrExternalUrlLayoutPropagation.test.ts

Files to Modify

- /packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts

Keep layout load behavior simple while confirming typed instance payload includes `external_url` after updates. Add targeted test coverage showing settings updates are reflected in subsequent page loads without manual reconfiguration. Avoid adding caching layers here; rely on standard SvelteKit load invalidation and action lifecycle.
In tests, assert refresh via action completion plus route invalidation (`invalidateAll`/post-action load rerun semantics) so the behavior is explicit and not browser-cache dependent.

### Phase 3: Open-In Surface Rollout and Verification

#### Task 3.1: Apply shared browser URL resolver to library toolbar and row links Depends on [2.3]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte
- /packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte
- /docs/plans/external-url/feature-spec.md
- /docs/plans/external-url/research-technical.md

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/arr/libraryExternalUrlResolver.test.ts

Files to Modify

- /packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte
- /packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte

Replace ad hoc `instance.url` usage with shared resolver output for action bar "Open in" and per-row movie/series/artist links. Preserve existing Arr-type-specific path builders and trailing slash normalization behavior. Add focused tests that assert fallback to `url` when `external_url` is absent and override behavior when present.

#### Task 3.2: Apply shared resolver to Arr landing card/table Open-in buttons Depends on [2.3]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/routes/arr/views/CardView.svelte
- /packages/praxrr-app/src/routes/arr/views/TableView.svelte
- /packages/praxrr-app/src/routes/arr/+page.svelte
- /docs/plans/external-url/research-recommendations.md

**Instructions**

Files to Create

- /packages/praxrr-app/src/tests/arr/arrListExternalUrlResolver.test.ts

Files to Modify

- /packages/praxrr-app/src/routes/arr/views/CardView.svelte
- /packages/praxrr-app/src/routes/arr/views/TableView.svelte

Switch list and card Open-in actions to shared resolver logic for consistency with library behavior. Ensure displayed metadata remains coherent (do not accidentally replace canonical URL fields used for diagnostics unless intentionally designed). Keep interaction behavior (`window.open` target and security flags) unchanged.

#### Task 3.3: Final regression sweep, documentation alignment, and release readiness Depends on [3.1, 3.2]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts
- /docs/plans/external-url/feature-spec.md
- /docs/plans/external-url/shared.md
- /README.md

**Instructions**

Files to Create

- /docs/plans/external-url/release-notes.md

Files to Modify

- /packages/praxrr-app/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts
- /docs/plans/external-url/feature-spec.md

Extend E2E flow coverage to include adding/updating/clearing external URL and validating Open-in fallback outcomes. Add concise release notes describing dual-URL semantics and operational guidance for Docker users. Reconcile final implementation behavior back into `feature-spec.md` acceptance criteria and checklists so planning artifacts remain accurate for future maintenance.
Publish release guidance in both `/docs/plans/external-url/release-notes.md` and the next user-facing changelog surface chosen by maintainers, and ensure the new E2E assertions are part of CI-required checks for this feature branch.

## Advice

- Keep a strict boundary: only UI navigation uses `external_url`; every server-side Arr API call must continue to use canonical `url`.
- Introduce and reuse one shared resolver utility early; duplicated fallback expressions across components will drift.
- Normalize empty `external_url` to `NULL` in query/action layers to avoid three-state bugs (`NULL` vs empty string vs value).
- Land migration and query typing before UI work to keep TypeScript guidance strong and avoid temporary `any`/unsafe casts.
- Prioritize regression tests around add/edit/clear transitions; this feature’s main risk is behavior drift across surfaces, not algorithmic complexity.
