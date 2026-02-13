# Lidarr Support Implementation Plan

Profilarr should add Lidarr as a first-class Arr type by extending existing onboarding, client-factory, API-route, and section-sync seams rather than introducing a separate pipeline. The highest-risk work is contract drift across OpenAPI schemas, generated types, shared unions, and runtime allowlists, so schema-first updates and regeneration must gate downstream changes. Delivery should be phased: foundation/type parity and capability metadata first, then core library/releases/sync functionality, and finally operational parity (rename/upgrades) plus regression hardening. All tasks below map to issue `#1`-`#5` and roll up to umbrella issue `#6`, with dependencies shaped to maximize safe parallel work.

## Critically Relevant Files and Documentation

- `docs/plans/lidarr-support/shared.md`: canonical shared-context output and required architectural references.
- `docs/plans/lidarr-support/feature-spec.md`: scope, acceptance criteria, phased recommendations, and edge cases.
- `docs/plans/lidarr-support/research-technical.md`: code seams, type-system risks, and high-confidence file impact.
- `docs/plans/lidarr-support/research-business.md`: business rules and required user-visible outcomes.
- `docs/plans/lidarr-support/research-external.md`: Lidarr API v1 endpoint/auth constraints.
- `docs/plans/lidarr-support/research-ux.md`: capability-gated UX/accessibility expectations.
- `docs/plans/lidarr-support/github-issue-drafts.md`: required issue mapping to `#1`-`#5` with umbrella `#6`.
- `docs/api/v1/schemas/arr.yaml`: source of `ArrType` and Arr API contracts.
- `docs/api/v1/schemas/pcd.yaml`: source of `EntityType` enums affecting media-management compatibility.
- `src/lib/api/v1.d.ts`: generated API types that must match schema updates.
- `src/lib/shared/pcd/types.ts`: shared Arr/PCD unions used across server and UI.
- `src/routes/arr/new/+page.server.ts`: onboarding validation and instance creation flow.
- `src/routes/arr/test/+server.ts`: Arr connection test endpoint and allowlist checks.
- `src/routes/arr/components/InstanceForm.svelte`: instance type selection and onboarding UX.
- `src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr API v1 client implementation surface.
- `src/routes/api/v1/arr/library/+server.ts`: library aggregation branch and cache/error behavior.
- `src/routes/api/v1/arr/releases/+server.ts`: release search branch and response envelope.
- `src/lib/server/jobs/handlers/arrSync.ts`: section-based sync orchestration.
- `src/lib/server/sync/mappings.ts`: sync Arr type and section mapping rules.
- `src/lib/server/sync/mediaManagement/syncer.ts`: media-management sync execution behavior.
- `src/lib/server/jobs/handlers/arrRename.ts`: current rename type constraints.
- `src/routes/arr/[id]/upgrades/+page.server.ts`: current upgrades constraints and gating behavior.
- `src/routes/custom-formats/[databaseId]/[id]/conditions/components/ConditionCard.svelte`: binary app-target control that must scale beyond two Arr apps.

## Implementation Plan

### Phase 1: Type Contracts and Onboarding Foundation

#### Task 1.1: Extend Arr OpenAPI type contracts for Lidarr (Issue #1) Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/feature-spec.md`
- `docs/plans/lidarr-support/research-technical.md`
- `docs/api/v1/schemas/arr.yaml`

**Instructions**

Files to Create

- None.

Files to Modify

- `docs/api/v1/schemas/arr.yaml`

Update `ArrType` and any Arr route schemas that currently assume only Radarr/Sonarr so `lidarr` is contract-valid everywhere onboarding/library/releases rely on schema enums. Keep contract semantics backward-compatible for existing types and avoid introducing speculative Lidarr-only payload fields that are not yet consumed by server routes. Explicitly note any unchanged surfaces that remain capability-gated for later phases.

#### Task 1.2: Encode PCD entity strategy for Lidarr media-management (Issue #2) Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/feature-spec.md`
- `docs/plans/lidarr-support/research-business.md`
- `docs/api/v1/schemas/pcd.yaml`

**Instructions**

Files to Create

- None.

Files to Modify

- `docs/api/v1/schemas/pcd.yaml`

Adopt the v1 strategy `reuse existing media-management entities` and encode it directly in schema enums by adding `lidarr` to the relevant `arr_type`/`ArrType` values in `pcd.yaml` (without introducing new `lidarr_*` entities in this phase). Include explicit notes that unsupported Lidarr-only fields remain capability-gated so downstream sync behavior is deterministic.

#### Task 1.3: Regenerate generated API typings from updated schemas (Issue #1) Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `docs/api/v1/schemas/arr.yaml`
- `docs/api/v1/schemas/pcd.yaml`
- `src/lib/api/v1.d.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/lib/api/v1.d.ts`

Regenerate API typings so schema updates become compile-time truth for server/UI code by running `deno task bundle:api && deno task generate:api-types`. Ensure output includes `lidarr` in relevant unions, confirm the diff is generated-only (no manual edits), and treat this as a hard gate before shared/runtime union edits.

#### Task 1.4: Align shared/runtime Arr unions and sync type constraints (Issue #1, #2) Depends on [1.3]

**READ THESE BEFORE TASK**

- `src/lib/api/v1.d.ts`
- `src/lib/shared/pcd/types.ts`
- `src/lib/server/sync/mappings.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/lib/shared/pcd/types.ts`
- `src/lib/server/sync/mappings.ts`

Update shared unions and sync mapping types to match regenerated contracts, with exhaustive handling for `lidarr` where behavior exists and explicit capability gating where it does not. Preserve current Radarr/Sonarr behavior and avoid fallback casts (`any`/unsafe narrowing). This task defines the type-safe foundation for all route/client/sync changes.

#### Task 1.5: Enable Lidarr in onboarding and connection validation endpoints (Issue #1) Depends on [1.4]

**READ THESE BEFORE TASK**

- `src/routes/arr/new/+page.server.ts`
- `src/routes/arr/test/+server.ts`
- `src/lib/server/utils/arr/factory.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/routes/arr/new/+page.server.ts`
- `src/routes/arr/test/+server.ts`

Extend allowlists and validation flow so Lidarr instances can be created and tested through existing APIs while preserving current error envelope and logging conventions. Keep timeout/retry behavior aligned with existing paths and ensure unsupported-type failures become unreachable for legitimate `lidarr` requests.

#### Task 1.6: Introduce centralized Arr capability metadata (Issue #4) Depends on [1.4]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/research-ux.md`
- `src/lib/shared/pcd/types.ts`
- `src/lib/shared/pcd/display.ts`

**Instructions**

Files to Create

- `src/lib/shared/arr/capabilities.ts`

Files to Modify

- `src/lib/shared/pcd/display.ts`

Create a single metadata/capability source for Arr apps (`radarr`, `sonarr`, `lidarr`) to drive labels/icons/supported-feature gates consistently across backend and UI. Keep the shape minimal and composable (feature flags per workflow surface) so future app additions do not reintroduce hardcoded binary controls.

#### Task 1.7: Update instance onboarding UI to consume capability metadata (Issue #4) Depends on [1.5, 1.6]

**READ THESE BEFORE TASK**

- `src/routes/arr/components/InstanceForm.svelte`
- `src/lib/shared/arr/capabilities.ts`
- `docs/plans/lidarr-support/research-ux.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/routes/arr/components/InstanceForm.svelte`

Replace hardcoded Radarr/Sonarr assumptions in the instance form with capability-driven app options and copy, including explicit messaging for unsupported downstream features where relevant. Preserve existing keyboard flow, test-before-save behavior, and validation feedback UX.

### Phase 2: Core Lidarr API and Sync Delivery

#### Task 2.1: Implement Lidarr client methods required by routes and sync (Issue #2, #3) Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/research-external.md`
- `src/lib/server/utils/arr/clients/lidarr.ts`
- `src/lib/server/utils/arr/types.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/lib/server/utils/arr/clients/lidarr.ts`
- `src/lib/server/utils/arr/types.ts`

Implement explicit Lidarr v1 methods required by downstream tasks: `getArtists()`, `getAlbums(artistIds?: number[])`, `getLibrary(profilarrProfileNames?: Set<string>)`, `getReleases(albumId: number)`, and any type-safe helpers needed for profile joins in `types.ts`. Reuse base-client request/error patterns, keep method naming consistent with existing Arr clients, and define return contracts so library/releases/sync routes avoid ad-hoc shape transformations.

#### Task 2.2: Add Lidarr branch to Arr library API route (Issue #3) Depends on [1.5, 2.1]

**READ THESE BEFORE TASK**

- `src/routes/api/v1/arr/library/+server.ts`
- `src/lib/server/utils/arr/clients/lidarr.ts`
- `docs/api/v1/schemas/arr.yaml`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/routes/api/v1/arr/library/+server.ts`

Wire `lidarr` into library aggregation with the same response contract, cache behavior, and error envelopes used by existing Arr branches. Ensure profile attribution semantics remain consistent and unsupported fallback branches are not triggered for valid Lidarr instances.

#### Task 2.3: Add Lidarr branch to Arr releases API route (Issue #3) Depends on [1.5, 2.1]

**READ THESE BEFORE TASK**

- `src/routes/api/v1/arr/releases/+server.ts`
- `src/lib/server/utils/arr/clients/lidarr.ts`
- `docs/api/v1/schemas/arr.yaml`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/routes/api/v1/arr/releases/+server.ts`

Add `lidarr` release-search support while preserving existing query validation, grouped release response behavior, and standardized 4xx/5xx error payloads. Keep per-type logic isolated so Radarr/Sonarr execution paths stay unchanged.

#### Task 2.4: Extend sync orchestration mappings for Lidarr (Issue #2) Depends on [1.4, 2.1]

**READ THESE BEFORE TASK**

- `src/lib/server/jobs/handlers/arrSync.ts`
- `src/lib/server/sync/mappings.ts`
- `docs/plans/lidarr-support/research-technical.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/lib/server/jobs/handlers/arrSync.ts`
- `src/lib/server/sync/mappings.ts`

Ensure section-based sync orchestration can schedule and execute Lidarr-compatible sections without creating a separate job pipeline. Use explicit capability checks where sections are intentionally unsupported and preserve existing section status/job-history behavior.

#### Task 2.5: Implement media-management sync behavior for reused entity strategy (Issue #2) Depends on [1.2, 2.4]

**READ THESE BEFORE TASK**

- `docs/api/v1/schemas/pcd.yaml`
- `src/lib/server/sync/mediaManagement/syncer.ts`
- `docs/plans/lidarr-support/research-business.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/lib/server/sync/mediaManagement/syncer.ts`

Apply the Phase 1 `reuse existing entities` strategy so Lidarr maps to the shared media-management entity shapes and skips unsupported fields with explicit capability reasons. Avoid silent partial writes and ensure unsupported-field outcomes are deterministic, logged, and testable.

#### Task 2.6: Render Lidarr library data in Arr instance page (Issue #4) Depends on [1.6, 2.2]

**READ THESE BEFORE TASK**

- `src/routes/arr/[id]/library/+page.svelte`
- `src/routes/api/v1/arr/library/+server.ts`
- `src/lib/shared/arr/capabilities.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/routes/arr/[id]/library/+page.svelte`

Update library UI rendering so Lidarr payloads display with the same profile confidence cues and loading/empty-state semantics as existing apps. If a capability is unavailable, show explicit user-facing context instead of surfacing backend-only unsupported errors.

#### Task 2.7: Generalize Arr list views beyond dual-app assumptions (Issue #4) Depends on [1.6]

**READ THESE BEFORE TASK**

- `src/routes/arr/views/CardView.svelte`
- `src/routes/arr/views/TableView.svelte`
- `src/lib/shared/arr/capabilities.ts`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/routes/arr/views/CardView.svelte`
- `src/routes/arr/views/TableView.svelte`

Replace hardcoded two-app presentation logic with capability/metadata-driven rendering so Lidarr appears consistently in overview surfaces. Keep existing sort/filter/interaction behavior intact while updating app label/icon affordances.

### Phase 3: Operational Parity and Validation Hardening

#### Task 3.1: Resolve rename behavior for Lidarr (Issue #5) Depends on [1.6, 2.4]

**READ THESE BEFORE TASK**

- `src/routes/arr/[id]/rename/+page.server.ts`
- `src/lib/server/jobs/handlers/arrRename.ts`
- `docs/plans/lidarr-support/feature-spec.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/routes/arr/[id]/rename/+page.server.ts`
- `src/lib/server/jobs/handlers/arrRename.ts`

Lock v1 scope to `rename is capability-gated for Lidarr` and enforce that decision in both page and handler paths. Return explicit unsupported responses/messages (not generic runtime failures), keep Radarr/Sonarr rename behavior unchanged, and include acceptance checks that Lidarr cannot queue rename jobs.

#### Task 3.2: Resolve upgrades behavior for Lidarr (Issue #5) Depends on [1.6]

**READ THESE BEFORE TASK**

- `src/routes/arr/[id]/upgrades/+page.server.ts`
- `src/lib/server/jobs/handlers/arrUpgrade.ts`
- `docs/plans/lidarr-support/feature-spec.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/routes/arr/[id]/upgrades/+page.server.ts`
- `src/lib/server/jobs/handlers/arrUpgrade.ts`

Lock v1 scope to `upgrades are capability-gated for Lidarr` and make page + handler behavior consistent with that decision. Preserve existing Radarr upgrades behavior, ensure Lidarr sees explicit unsupported messaging, and add acceptance checks that unsupported requests do not enqueue upgrade work.

#### Task 3.3: Generalize custom-format condition app targeting (Issue #4) Depends on [1.6]

**READ THESE BEFORE TASK**

- `src/routes/custom-formats/[databaseId]/[id]/conditions/components/ConditionCard.svelte`
- `src/lib/shared/arr/capabilities.ts`
- `docs/plans/lidarr-support/research-ux.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `src/routes/custom-formats/[databaseId]/[id]/conditions/components/ConditionCard.svelte`
- `src/lib/shared/arr/capabilities.ts`
- `src/lib/shared/pcd/types.ts`

Refactor binary Radarr/Sonarr condition targeting into scalable app selection driven by shared metadata so Lidarr can be expressed without bespoke UI forks. Update shared type validation alongside the UI component so condition payload typing remains exhaustive for `lidarr`. Maintain accessibility expectations for keyboard operation and non-color-only distinctions.

#### Task 3.4: Add server regression tests for Lidarr onboarding and APIs (Issue #1, #3) Depends on [1.7, 2.2, 2.3]

**READ THESE BEFORE TASK**

- `src/tests/example.test.ts`
- `src/routes/arr/new/+page.server.ts`
- `src/routes/api/v1/arr/releases/+server.ts`

**Instructions**

Files to Create

- `src/tests/base/lidarrOnboarding.test.ts`
- `src/tests/base/lidarrApiParity.test.ts`

Files to Modify

- None.

Add focused server tests covering onboarding allowlists and library/releases parity behavior for Lidarr, including error-envelope assertions and regressions for existing Arr types. Keep fixtures minimal and deterministic so failures pinpoint contract drift quickly.

#### Task 3.5: Add sync/operations regression tests for mixed Arr deployments (Issue #2, #5) Depends on [2.5, 3.1, 3.2]

**READ THESE BEFORE TASK**

- `src/tests/jobs`
- `src/lib/server/jobs/handlers/arrSync.ts`
- `src/lib/server/jobs/handlers/arrRename.ts`

**Instructions**

Files to Create

- `src/tests/jobs/lidarrSync.test.ts`
- `src/tests/upgrades/lidarrCapabilityGates.test.ts`

Files to Modify

- None.

Add regression coverage for Lidarr sync behavior and rename/upgrades capability decisions in mixed Arr environments to prevent Radarr/Sonarr regressions. Tests should assert explicit unsupported-state behavior where parity is deferred.

#### Task 3.6: Add E2E Lidarr core-flow coverage (Issue #4) Depends on [3.3, 3.4, 3.5]

**READ THESE BEFORE TASK**

- `src/tests/e2e/specs`
- `docs/plans/lidarr-support/feature-spec.md`
- `docs/plans/lidarr-support/research-ux.md`

**Instructions**

Files to Create

- `src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts`

Files to Modify

- None.

Add one end-to-end scenario covering add/test/configure/inspect flow for Lidarr with explicit unsupported messaging checks (rename/upgrades gated in v1). Keep spec naming aligned with existing numeric E2E prefix patterns and include mixed-arr assertions where practical.

#### Task 3.7: Update issue rollup documentation for #1-#5 under #6 (Issue #6) Depends on [3.4, 3.5, 3.6]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/github-issue-drafts.md`
- `docs/plans/lidarr-support/feature-spec.md`
- `docs/plans/lidarr-support/shared.md`

**Instructions**

Files to Create

- None.

Files to Modify

- `docs/plans/lidarr-support/github-issue-drafts.md`

Record final task-to-issue mapping and completion notes for issues `#1`-`#5` with rollup status for umbrella `#6`. Keep updates factual and aligned with delivered scope decisions (v1 rename/upgrades capability-gated for Lidarr).

## Advice

- Treat `docs/api/v1/schemas/arr.yaml`, `docs/api/v1/schemas/pcd.yaml`, and `src/lib/api/v1.d.ts` as a strict contract chain; parallel edits are fine, but regeneration must be serialized before downstream type work.
- `src/lib/server/sync/mappings.ts` is touched in both foundation and core phases; split ownership by task dependency to avoid merge conflicts and broken section routing.
- Capability metadata should be introduced once and consumed everywhere (`InstanceForm`, list views, condition controls, rename/upgrades pages) to prevent subtle divergence between UI messaging and backend behavior.
- Keep Lidarr API v1 differences localized inside `src/lib/server/utils/arr/clients/lidarr.ts`; route handlers should remain thin and consistent with current Radarr/Sonarr patterns.
- Final readiness should be judged by mixed-environment regressions (Radarr + Sonarr + Lidarr) rather than Lidarr-only success, because the highest product risk is regression of existing Arr workflows.
