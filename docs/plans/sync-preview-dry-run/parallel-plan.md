# Sync Preview Dry Run Implementation Plan

Sync preview adds a Terraform-style plan workflow to Praxrr sync by reusing existing section fetch/transform logic and replacing write steps with deterministic diff generation. The backend work centers on a preview core (types, diff engine, TTL store, orchestrator), section-specific preview hooks, and contract-first API routes for create/get/delete/apply preview lifecycle. The frontend then consumes the preview payload to present per-instance summaries and field-level diffs with explicit destructive-action safeguards. The plan maximizes safe parallelism by isolating shared contracts first, splitting section work by syncer family, and converging through orchestrator and API integration.

## Critically Relevant Files and Documentation

- `docs/plans/sync-preview-dry-run/shared.md`: authoritative architecture and file map for this feature.
- `docs/plans/sync-preview-dry-run/feature-spec.md`: preview data model, endpoint contracts, and UX requirements.
- `packages/praxrr-app/src/lib/server/sync/base.ts`: existing sync lifecycle and extension point constraints.
- `packages/praxrr-app/src/lib/server/sync/types.ts`: shared sync contracts to extend with preview shapes.
- `packages/praxrr-app/src/lib/server/sync/registry.ts`: section registration and has-config routing logic.
- `packages/praxrr-app/src/lib/server/sync/namespace.ts`: suffix matching and display normalization rules.
- `packages/praxrr-app/src/lib/server/sync/cleanup.ts`: scan/execute pattern precedent for preview/apply.
- `packages/praxrr-app/src/lib/server/utils/cache/cache.ts`: TTL in-memory caching pattern.
- `packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: route-level two-phase execution precedent.
- `docs/api/v1/openapi.yaml`: root OpenAPI document that must include preview paths/schemas.

## Implementation Plan

### Phase 1: Preview Core Foundation

#### Task 1.1: Define preview contracts and shared sync interfaces Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/sync-preview-dry-run/feature-spec.md`
- `packages/praxrr-app/src/lib/server/sync/types.ts`
- `packages/praxrr-app/src/lib/server/sync/base.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/types.ts`
- `packages/praxrr-app/src/lib/server/sync/base.ts`

Define `SyncPreviewResult`, section preview payload types, entity/field change types, and preview status lifecycle fields exactly once in preview module types. Extend sync section interfaces so each syncer can expose preview generation without changing existing sync execution behavior. Keep contracts Arr-type aware and encode read-only guarantees so later tasks cannot accidentally route writes through preview code.

#### Task 1.2: Build preview module exports and TTL preview store Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/cache/cache.ts`
- `packages/praxrr-app/src/lib/server/sync/index.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/sync/preview/index.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/index.ts`

Create an in-memory TTL preview store with explicit `createdAt`/`expiresAt` semantics and CRUD operations for preview snapshots. Export preview module entrypoints from sync barrels so API and orchestrator tasks can import stable symbols. Keep expiration cleanup deterministic and avoid database persistence.

#### Task 1.3: Implement preview diff primitives and section diff helpers Depends on [1.1]

**READ THESE BEFORE TASK**

- `docs/plans/sync-preview-dry-run/research-technical.md`
- `packages/praxrr-app/src/lib/server/sync/namespace.ts`
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/sync/preview/diff.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/namespace.ts`

Wrap deep diff generation into preview-friendly change records and provide section-aware comparators that normalize namespace display while matching suffixed names. Define explicit invariants in code comments/tests: array comparison key strategy, ignored volatile fields, null-vs-missing semantics, and namespace match precedence rules. Include at least one acceptance example per invariant in task output notes so all section hooks emit consistent change records.

### Phase 2: Section Preview Generation and Orchestration

#### Task 2.1: Add quality profile and custom format preview hooks Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`
- `packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`
- `packages/praxrr-app/src/lib/server/sync/customFormats/transformer.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`
- `packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/transformer.ts`

Refactor section internals so preview reuses the same fetch/transform path as sync and only diverges before Arr write calls. Generate preview entities for custom formats and quality profiles with field-level changes and section summaries. Preserve multi-database namespace handling and existing ordering semantics (custom formats before quality profile references).

#### Task 2.2: Add delay and media management preview hooks Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`

Introduce preview generation for delay profiles and media management subsections, preserving each section’s Arr-specific constraints and support checks. Explicitly define unsupported-arr behavior and missing singleton-config behavior per subsection: fail fast for unsupported section/arr combinations, no-op with warning for absent optional config, and structured error for required config gaps. Ensure all preview remote-state reads remain GET-only and map singleton configs cleanly into entity-change records.

#### Task 2.3: Add metadata profile preview hooks for Lidarr paths Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`
- `docs/plans/sync-preview-dry-run/research-business.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`

Add preview support for metadata profile sync with the same schema normalization and fallback behavior as execution. Ensure Lidarr-only support is explicit and fails fast for unsupported Arr types. Emit preview changes using shared preview contracts and diff conventions.

#### Task 2.4: Implement preview orchestrator core and concurrency semantics Depends on [2.1, 2.2, 2.3, 1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/processor.ts`
- `packages/praxrr-app/src/lib/server/sync/registry.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/processor.ts`

Build preview orchestration flow for instance validation, section dispatch, bounded concurrency, and partial-failure accumulation. Document acceptance criteria in task output: max concurrency honored, per-section failure does not corrupt successful section payloads, and snapshot creation timestamps are deterministic.

#### Task 2.5: Wire registry/store integration and preview snapshot persistence Depends on [2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/sync/registry.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`
- `packages/praxrr-app/src/lib/server/sync/index.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/registry.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`
- `packages/praxrr-app/src/lib/server/sync/index.ts`

Integrate orchestrator output with registry-driven section resolution and stable preview snapshot persistence APIs. Enforce status transition constants (`generating -> ready|failed -> applying -> applied|failed`) and explicit stale/expired state derivation. Keep persistence semantics isolated so API tasks consume a narrow store interface.

### Phase 3: API Contracts and User-Facing Preview Flow

#### Task 3.1: Add OpenAPI preview paths and schemas Depends on [1.1]

**READ THESE BEFORE TASK**

- `docs/api/v1/openapi.yaml`
- `docs/api/v1/paths/arr.yaml`
- `docs/api/v1/schemas/arr.yaml`

**Instructions**

Files to Create

- `docs/api/v1/paths/sync.yaml`
- `docs/api/v1/schemas/sync.yaml`

Files to Modify

- `docs/api/v1/openapi.yaml`

Define preview generation, retrieval, deletion, and apply operations plus all preview schema objects. Mirror existing spec style and naming conventions while keeping response objects aligned with `preview/types.ts`. Ensure operation descriptions explicitly call out preview read-only semantics and staleness behavior.

#### Task 3.2: Implement preview create/get/delete API lifecycle routes Depends on [2.5, 3.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/+server.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`

Implement POST generate, GET status, and DELETE discard routes with consistent auth/error/logging behavior and store interactions. Keep status transition checks explicit and return structured responses matching OpenAPI objects. Preserve strict read-only behavior for preview generation.

#### Task 3.3: Implement preview apply route and sync-conflict guardrails Depends on [2.5, 3.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/+server.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `docs/plans/sync-preview-dry-run/feature-spec.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`

Implement apply execution with explicit staleness policy constants, sync-in-progress conflict checks, and status transition validation against preview snapshots. Include a status-transition matrix in code comments and ensure apply delegates to existing sync pathways for parity. Return warning vs block outcomes according to staleness thresholds.

#### Task 3.4: Add sync page preview trigger and server data wiring Depends on [3.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncFooter.svelte`
- `docs/plans/sync-preview-dry-run/research-ux.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte`

Files to Modify

- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncFooter.svelte`

Wire preview actions into existing sync page server data and footer controls without regressing current sync operations. Add trigger states for idle/generating/error/ready and ensure the route receives preview identifiers and summary counts. Keep messaging explicit that preview is read-only until apply confirmation.

#### Task 3.5: Build preview diff panel and entity-level UI rendering Depends on [3.3, 3.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`
- `docs/plans/sync-preview-dry-run/feature-spec.md`
- `docs/plans/sync-preview-dry-run/research-ux.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte`

Files to Modify

- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`

Render preview summaries and field-level diffs with explicit create/update/delete/unchanged indicators and section grouping by instance. Provide staleness messaging and apply affordances with stronger confirmation when deletes are present. Keep component boundaries focused so panel logic can evolve independently from footer controls.

## Advice

- Keep preview and sync behavior coupled through shared helper functions, not duplicated branch logic; parity drift is the biggest long-term risk.
- Coordinate edits to shared choke-point files (`sync/types.ts`, `sync/index.ts`, `registry.ts`, `openapi.yaml`) early to avoid serial merge conflicts.
- Preserve Arr-specific behavior in every section preview path; do not infer cross-Arr equivalence from similar payload shapes.
- Treat staleness as a first-class contract concern across store, API, and UI so apply safety guarantees are consistent.
- Favor additive module boundaries (`sync/preview/*`) and narrow task scopes to maintain high parallel execution capacity.
