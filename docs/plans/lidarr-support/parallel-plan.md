> [!WARNING]
> Superseded on 2026-02-15 by the first-class Lidarr initiative plan in `docs/plans/enhance-lidarr-support/parallel-plan.md` (tracked by GitHub issue #130 and umbrella #13).
>
> This document captures the legacy Sonarr-reuse rollout model and is retained for historical context only. Do not use it for current implementation planning.

# Lidarr Support Implementation Plan

Lidarr support is partially available in sync flows but blocked in media-management CRUD surfaces because route handlers and entity modules still branch on Radarr/Sonarr only. The safest strategy is to align contracts first (arr types, portable entities, validators, quality mappings), then enable Lidarr per surface (naming, media-settings, quality-definitions) across server and UI layers in parallel. Final integration work reconciles sync metadata and verifies behavior through focused Lidarr regression tests. This plan keeps tasks narrowly scoped (1-3 files) while preserving explicit dependencies where shared contracts or mapping data are required.

## Supersession Mapping (2026-02-15)

The active issue decomposition for this initiative moved to first-class Lidarr tracking:

- Critical parent: `#130`
- Active umbrella: `#13`
- Active task issues: `#132`-`#141`

Legacy issues from this plan were explicitly superseded and closed:

- `#30` -> superseded by `#135` and `#138`
- `#31` -> superseded by `#136` and `#138`
- `#32` -> superseded by `#137` and `#138`
- `#33` -> superseded by `#138` and `#139`
- `#34` -> superseded by `#140`
- `#35` -> superseded by `#140` and `#141`

## Critically Relevant Files and Documentation

- /src/lib/shared/pcd/types.ts: shared arr type and PCD typing contracts.
- /src/lib/shared/arr/capabilities.ts: arr capability metadata consumed across routes/UI.
- /src/lib/shared/pcd/portable.ts: portable entity-type source used by import/export.
- /src/lib/server/pcd/entities/validate.ts: portable/entity validation gates.
- /src/routes/api/v1/pcd/export/+server.ts: export endpoint using portable entity types.
- /src/routes/api/v1/pcd/import/+server.ts: import endpoint validating portable entity payloads.
- /src/lib/server/pcd/entities/mediaManagement/naming/read.ts: naming list/read logic.
- /src/lib/server/pcd/entities/mediaManagement/naming/create.ts: naming write logic.
- /src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts: media-settings list/read logic.
- /src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts: media-settings write logic.
- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts: quality list/read plus mapping lookup.
- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts: quality write logic.
- /src/routes/media-management/[databaseId]/naming/new/+page.server.ts: naming action validation/dispatch.
- /src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts: media-settings action validation/dispatch.
- /src/routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts: quality action validation/dispatch.
- /src/routes/media-management/[databaseId]/naming/new/+page.svelte: naming UI arr-type selection.
- /src/routes/media-management/[databaseId]/media-settings/new/+page.svelte: media-settings UI arr-type selection.
- /src/routes/media-management/[databaseId]/quality-definitions/new/+page.svelte: quality UI arr-type selection.
- /src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte: naming form behavior that requires Lidarr parity.
- /src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte: media-settings form labels/payload behavior.
- /src/routes/media-management/[databaseId]/quality-definitions/components/QualityDefinitionsForm.svelte: quality form mapping/label behavior.
- /src/routes/media-management/[databaseId]/naming/views/CardView.svelte: naming list card rendering by arr type.
- /src/routes/media-management/[databaseId]/media-settings/views/CardView.svelte: media-settings list card rendering by arr type.
- /src/routes/media-management/[databaseId]/quality-definitions/views/CardView.svelte: quality-definitions list card rendering by arr type.
- /src/lib/server/sync/mediaManagement/syncer.ts: Lidarr capability-gated sync behavior.
- /src/lib/server/db/queries/arrSync.ts: sync metadata update/query layer.
- /docs/api/v1/schemas/pcd.yaml: public portable schema and Lidarr reuse contract.

## Implementation Plan

### Phase 1: Contract and Mapping Foundation

#### Task 1.1: Align Shared Arr-Type Contracts and Docs Depends on [none]

**READ THESE BEFORE TASK**

- /src/lib/shared/pcd/types.ts
- /src/lib/shared/arr/capabilities.ts
- /docs/api/v1/schemas/pcd.yaml

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/shared/pcd/types.ts
- /src/lib/shared/arr/capabilities.ts
- /docs/api/v1/schemas/pcd.yaml

Normalize `lidarr` handling in shared type unions/capabilities and ensure schema docs describe the same runtime behavior (Lidarr reuses existing media-management entities). Explicitly target arr-type union definitions, capability metadata keys, and schema enum/description nodes so the contract diff is unambiguous. Preserve strict typing and avoid introducing fallback arr-type paths. Add non-regression acceptance checks for unchanged Radarr/Sonarr behavior in unions, capabilities, and schema enums. Expected outcome: downstream tasks can rely on one authoritative arr-type contract.

#### Task 1.2: Extend Portable Entity Handling for Lidarr Media-Management Depends on [1.1]

**READ THESE BEFORE TASK**

- /src/lib/shared/pcd/portable.ts
- /src/routes/api/v1/pcd/export/+server.ts
- /src/routes/api/v1/pcd/import/+server.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/shared/pcd/portable.ts
- /src/routes/api/v1/pcd/export/+server.ts
- /src/routes/api/v1/pcd/import/+server.ts

Update entity-type catalogs and import/export handler branching to accept Lidarr media-management payloads while retaining current Radarr/Sonarr compatibility. Enumerate the accepted Lidarr portable entity matrix explicitly (naming, media-settings, quality-definitions under reused entity model), and define deterministic error messages for unsupported/mixed payloads. Expected outcome: import/export supports Lidarr media-management presets end-to-end with explicit contract/error behavior.

#### Task 1.3: Update PCD Validation Gates for Lidarr Portable Types Depends on [1.2]

**READ THESE BEFORE TASK**

- /src/lib/server/pcd/entities/validate.ts
- /src/lib/shared/pcd/portable.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/server/pcd/entities/validate.ts

Ensure validation logic accepts the Lidarr portable media-management variants introduced in Task 1.2 and still fails fast on unsupported combinations. Task boundary: 1.2 owns portable catalogs/import/export branching, while 1.3 owns validation-only behavior and invalid-combination assertions. Keep validation messages explicit so import/export and route-level error handling remain actionable. Expected outcome: portable Lidarr inputs pass validation when valid and fail predictably when invalid.

#### Task 1.4: Prepare Lidarr Quality-Mapping Prerequisites Depends on [none]

**READ THESE BEFORE TASK**

- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts
- /src/lib/server/sync/mediaManagement/syncer.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts
- /src/lib/server/sync/mediaManagement/syncer.ts

Define and wire explicit `arr_type = 'lidarr'` quality-mapping expectations so quality lookups and sync updates are deterministic. Scope this task to mapping primitives/guards only (lookup behavior and sync-side handling), not CRUD branch implementation. Policy matrix for this task: read/list skips unmapped entries with warning metadata, and sync skips unmapped entries with logged reason. Create/update rejection rules are implemented in Task 2.7. Add concrete done criteria in code-level assertions/guards: Lidarr mapping lookup returns expected API names, read/sync policy behavior is enforced, and sync logging still reflects capability-gated behavior. Align mapping names against `/docs/api/v1/schemas/arr.yaml` to avoid API-name drift. Mapping-row population is treated as an external data dependency (seed/migration/ops-owned); code must handle absent rows with deterministic fallback behavior rather than assuming inline data writes in this task. Expected outcome: quality-definition tasks can rely on stable Lidarr mapping behavior without ambiguous schema-side assumptions.

### Phase 2: Media-Management Surface Enablement

#### Task 2.1: Add Lidarr Branching to Naming Entity Operations Depends on [1.1]

**READ THESE BEFORE TASK**

- /src/lib/server/pcd/entities/mediaManagement/naming/read.ts
- /src/lib/server/pcd/entities/mediaManagement/naming/create.ts
- /src/lib/server/pcd/entities/mediaManagement/naming/update.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/server/pcd/entities/mediaManagement/naming/read.ts
- /src/lib/server/pcd/entities/mediaManagement/naming/create.ts
- /src/lib/server/pcd/entities/mediaManagement/naming/update.ts

Enable naming list/read/write operations for Lidarr using existing duplicate-check and `writeOperation` patterns. Keep route-facing function contracts consistent so handlers can dispatch by arr type without custom branching duplication. Explicitly require Lidarr naming read/write paths to reuse Sonarr-backed table contracts (not new `lidarr_*` tables) while preserving arr-type identity in duplicate checks. Add acceptance criteria for duplicate-name behavior across arr types under shared-table reuse. Expected outcome: naming entity layer can process Lidarr config operations with deterministic duplicate handling.

#### Task 2.2: Enable Lidarr in Naming Server Routes Depends on [2.1]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/naming/+page.server.ts
- /src/routes/media-management/[databaseId]/naming/new/+page.server.ts
- /src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts
- /src/routes/media-management/[databaseId]/naming/sonarr/[name]/+page.server.ts

**Instructions**

Files to Create

- /src/routes/media-management/[databaseId]/naming/lidarr/[name]/+page.server.ts

Files to Modify

- /src/routes/media-management/[databaseId]/naming/+page.server.ts
- /src/routes/media-management/[databaseId]/naming/new/+page.server.ts

Expand server-side arr-type validation, loading, and action dispatch for Lidarr naming configs. Preserve permission checks (`canWriteToBase`) and sync-name update semantics used by existing arr types. Add pass/fail acceptance criteria for invalid `arrType`, missing config name, permission denial, and successful rename propagation to sync metadata. Expected outcome: naming server handlers support Lidarr list/create/edit workflows with deterministic error behavior.

#### Task 2.3: Enable Lidarr in Naming UI Pages Depends on [2.2]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/naming/+page.svelte
- /src/routes/media-management/[databaseId]/naming/new/+page.svelte
- /src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.svelte
- /src/routes/media-management/[databaseId]/naming/sonarr/[name]/+page.svelte

**Instructions**

Files to Create

- /src/routes/media-management/[databaseId]/naming/lidarr/[name]/+page.svelte

Files to Modify

- /src/routes/media-management/[databaseId]/naming/+page.svelte

Expose Lidarr in naming page-level routing and edit-page navigation flows while keeping page wiring aligned with updated server handlers. Follow existing Radarr/Sonarr UX patterns so Lidarr appears first-class without introducing UI-only logic branches that bypass server validation. Add explicit acceptance criteria for `lidarr/[name]` deep-link loads, unknown-arr-type handling parity, and missing-name error UX. Expected outcome: users can navigate to and load Lidarr naming pages from UI routes.

#### Task 2.4: Add Lidarr Branching to Media-Settings Entity Operations Depends on [1.1]

**READ THESE BEFORE TASK**

- /src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts
- /src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts
- /src/lib/server/pcd/entities/mediaManagement/media-settings/update.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/server/pcd/entities/mediaManagement/media-settings/read.ts
- /src/lib/server/pcd/entities/mediaManagement/media-settings/create.ts
- /src/lib/server/pcd/entities/mediaManagement/media-settings/update.ts

Add Lidarr media-settings read/write behavior while preserving current validation and capability-gated assumptions used by syncer logic. Keep helper signatures consistent with existing routes and avoid hidden fallback behavior. Explicitly require Sonarr-backed storage/query reuse for Lidarr media-settings and define collision-key behavior for same-name cross-arr configs. Add acceptance criteria for duplicate/collision behavior across arr types in shared storage paths. Expected outcome: media-settings entity layer supports Lidarr operations with predictable identity rules.

#### Task 2.5: Enable Lidarr in Media-Settings Server Routes Depends on [2.4]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/media-settings/+page.server.ts
- /src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts
- /src/routes/media-management/[databaseId]/media-settings/radarr/[name]/+page.server.ts
- /src/routes/media-management/[databaseId]/media-settings/sonarr/[name]/+page.server.ts

**Instructions**

Files to Create

- /src/routes/media-management/[databaseId]/media-settings/lidarr/[name]/+page.server.ts

Files to Modify

- /src/routes/media-management/[databaseId]/media-settings/+page.server.ts
- /src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts

Enable Lidarr media-settings list/create/edit server behavior with the same permission and error patterns used today. Ensure route handlers call entity helpers rather than embedding business rules. Add pass/fail acceptance criteria for invalid `arrType`, missing config name, permission denial, and successful sync-name metadata updates on rename. Expected outcome: media-settings server routes fully support Lidarr workflows with deterministic failure semantics.

#### Task 2.6: Enable Lidarr in Media-Settings UI Pages Depends on [2.5]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/media-settings/+page.svelte
- /src/routes/media-management/[databaseId]/media-settings/new/+page.svelte
- /src/routes/media-management/[databaseId]/media-settings/radarr/[name]/+page.svelte
- /src/routes/media-management/[databaseId]/media-settings/sonarr/[name]/+page.svelte

**Instructions**

Files to Create

- /src/routes/media-management/[databaseId]/media-settings/lidarr/[name]/+page.svelte

Files to Modify

- /src/routes/media-management/[databaseId]/media-settings/+page.svelte

Add Lidarr to media-settings page-level routing and edit-page navigation, keeping route composition aligned with Task 2.5 handlers. Reuse existing page composition patterns to avoid divergent UI behavior by arr type. Add explicit acceptance criteria for `lidarr/[name]` deep-link loads, unknown-arr-type handling parity, and missing-name error UX. Expected outcome: media-settings UI routes support Lidarr navigation and page loading.

#### Task 2.7: Add Lidarr Branching to Quality-Definitions Entity Operations Depends on [1.1, 1.4]

**READ THESE BEFORE TASK**

- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts
- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts
- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/update.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/read.ts
- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/create.ts
- /src/lib/server/pcd/entities/mediaManagement/quality-definitions/update.ts

Implement Lidarr quality-definition read/write behavior coupled to prepared mapping logic, with clear handling for unsupported or unmapped qualities. Preserve existing update semantics and duplicate constraints, and define explicit cross-arr duplicate/identity expectations for shared mappings. Explicitly require Sonarr-backed storage/query reuse and enforce entity-side policy: create/update rejects unmapped qualities with deterministic `400` responses and stable error messages. Expected outcome: quality-definition entity layer supports Lidarr-backed config operations with clear collision and mapping rules.

#### Task 2.8: Enable Lidarr in Quality-Definitions Server Routes Depends on [2.7]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/quality-definitions/+page.server.ts
- /src/routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts
- /src/routes/media-management/[databaseId]/quality-definitions/radarr/[name]/+page.server.ts
- /src/routes/media-management/[databaseId]/quality-definitions/sonarr/[name]/+page.server.ts

**Instructions**

Files to Create

- /src/routes/media-management/[databaseId]/quality-definitions/lidarr/[name]/+page.server.ts

Files to Modify

- /src/routes/media-management/[databaseId]/quality-definitions/+page.server.ts
- /src/routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts

Enable Lidarr quality-definition list/create/edit handlers with consistent validation and sync-name update behavior. Ensure server routes consume mapping-backed entity results and expose clear errors for unsupported cases. Add explicit status/message contract for unmapped or unsupported quality submissions. Expected outcome: quality-definition server handlers support Lidarr workflows with testable mapping-error behavior.

#### Task 2.9: Enable Lidarr in Quality-Definitions UI Pages Depends on [2.8]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/quality-definitions/+page.svelte
- /src/routes/media-management/[databaseId]/quality-definitions/new/+page.svelte
- /src/routes/media-management/[databaseId]/quality-definitions/radarr/[name]/+page.svelte
- /src/routes/media-management/[databaseId]/quality-definitions/sonarr/[name]/+page.svelte

**Instructions**

Files to Create

- /src/routes/media-management/[databaseId]/quality-definitions/lidarr/[name]/+page.svelte

Files to Modify

- /src/routes/media-management/[databaseId]/quality-definitions/+page.svelte

Expose Lidarr in quality-definition page-level routing and edit-page navigation and align page behavior with Task 2.8 handlers. Keep UX behavior consistent with existing arr surfaces while communicating mapping-based limitations where needed. Add explicit acceptance criteria for `lidarr/[name]` deep-link loads, unknown-arr-type handling parity, and missing-name error UX. Expected outcome: quality-definition UI routes support Lidarr page discovery and edit navigation.

#### Task 2.10: Add Lidarr Rendering to Naming List Views Depends on [2.3]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/naming/+page.svelte
- /src/routes/media-management/[databaseId]/naming/views/CardView.svelte
- /src/routes/media-management/[databaseId]/naming/views/TableView.svelte

**Instructions**

Files to Create

- None

Files to Modify

- /src/routes/media-management/[databaseId]/naming/+page.svelte
- /src/routes/media-management/[databaseId]/naming/views/CardView.svelte
- /src/routes/media-management/[databaseId]/naming/views/TableView.svelte

Add explicit Lidarr rendering and navigation behavior in naming list views so Lidarr entries are visible and route correctly to edit pages. Keep row/card behavior consistent with existing Radarr/Sonarr conventions. Add edge-case acceptance criteria for empty-state rendering, filter inclusion, and deep-link fallback behavior on unknown arr type/name. Expected outcome: naming list pages display Lidarr configs correctly in both card and table modes.

#### Task 2.11: Add Lidarr Rendering to Media-Settings List Views Depends on [2.6]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/media-settings/+page.svelte
- /src/routes/media-management/[databaseId]/media-settings/views/CardView.svelte
- /src/routes/media-management/[databaseId]/media-settings/views/TableView.svelte

**Instructions**

Files to Create

- None

Files to Modify

- /src/routes/media-management/[databaseId]/media-settings/+page.svelte
- /src/routes/media-management/[databaseId]/media-settings/views/CardView.svelte
- /src/routes/media-management/[databaseId]/media-settings/views/TableView.svelte

Add Lidarr rendering and edit-link behavior in media-settings card/table views, ensuring filters and labels behave identically to existing arr types. Add edge-case acceptance criteria for sort/filter parity and invalid route-name handling from list interactions. Expected outcome: media-settings list pages expose Lidarr entries consistently across view modes.

#### Task 2.12: Add Lidarr Rendering to Quality-Definitions List Views Depends on [2.9]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/quality-definitions/+page.svelte
- /src/routes/media-management/[databaseId]/quality-definitions/views/CardView.svelte
- /src/routes/media-management/[databaseId]/quality-definitions/views/TableView.svelte

**Instructions**

Files to Create

- None

Files to Modify

- /src/routes/media-management/[databaseId]/quality-definitions/+page.svelte
- /src/routes/media-management/[databaseId]/quality-definitions/views/CardView.svelte
- /src/routes/media-management/[databaseId]/quality-definitions/views/TableView.svelte

Add Lidarr support in quality-definition list rendering and navigation, including mapping-aware labels where applicable. Define fallback label/error presentation for missing mappings and include deep-link fallback behavior in acceptance criteria. Expected outcome: quality-definition list pages show and route Lidarr entries in both card and table layouts with deterministic fallback UI.

#### Task 2.13: Add Lidarr Support to Naming Form Components Depends on [2.3]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/naming/new/+page.svelte
- /src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte

**Instructions**

Files to Create

- None

Files to Modify

- /src/routes/media-management/[databaseId]/naming/new/+page.svelte
- /src/routes/media-management/[databaseId]/naming/components/SonarrNamingForm.svelte

Parameterize naming form behavior for `lidarr` so labels, hidden inputs, and submission payloads follow Sonarr-compatible semantics while remaining explicit about Lidarr context. Add acceptance criteria for hidden `arrType` correctness, create/edit payload parity, and validation-error rendering from server responses. Expected outcome: naming forms submit valid Lidarr payloads without relying on implicit Sonarr-only assumptions.

#### Task 2.14: Add Lidarr Support to Media-Settings Form Component Depends on [2.6]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/media-settings/new/+page.svelte
- /src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte

**Instructions**

Files to Create

- None

Files to Modify

- /src/routes/media-management/[databaseId]/media-settings/new/+page.svelte
- /src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte

Update form-level labels, modal text, and payload shape so Lidarr media-settings behavior is explicit and Sonarr-parity compliant. Add acceptance criteria for duplicate/collision submission handling, modal copy parity, and deterministic error display behavior. Expected outcome: media-settings form component handles Lidarr correctly across create/edit flows.

#### Task 2.15: Add Lidarr Support to Quality-Definitions Form Component Depends on [2.9]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/quality-definitions/new/+page.svelte
- /src/routes/media-management/[databaseId]/quality-definitions/components/QualityDefinitionsForm.svelte

**Instructions**

Files to Create

- None

Files to Modify

- /src/routes/media-management/[databaseId]/quality-definitions/new/+page.svelte
- /src/routes/media-management/[databaseId]/quality-definitions/components/QualityDefinitionsForm.svelte

Add Lidarr-aware form behavior for quality labels, unit display, and mapping-limited states so user input remains aligned with server-side validation. Use one canonical UX path: disable unmapped quality options, show inline explanatory text beneath the selector, and block submit if an unmapped value is somehow present in form state. Keep behavior consistent across create/edit flows. Expected outcome: quality-definitions form supports Lidarr with clear mapping-aware UX.

### Phase 3: Integration Hardening and Verification

#### Task 3.1: Reconcile Sync Metadata with Lidarr Media-Management Flows Depends on [1.3, 1.4, 2.2, 2.5, 2.7, 2.8]

**READ THESE BEFORE TASK**

- /src/lib/server/sync/mediaManagement/syncer.ts
- /src/lib/server/db/queries/arrSync.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/lib/server/sync/mediaManagement/syncer.ts
- /src/lib/server/db/queries/arrSync.ts

Verify sync metadata reads/writes and update flows consume newly supported Lidarr presets across naming, media-settings, and quality-definitions. Implement concrete changes in `arrSync` query/update paths for Lidarr config-name linkage and in syncer config-resolution branches so Lidarr selections resolve deterministically per section. Preserve existing capability-gated logging and maintain Radarr/Sonarr behavior parity. Add strict update-safety constraints: updates are scoped by instance + arr type, rename collisions are detected before write, and cross-instance metadata must remain isolated. Pass criteria: Lidarr config selection persists in sync metadata, rename/update flows keep metadata aligned, collision handling is deterministic, and sync execution logs expected Lidarr mapping/skip reasons.

#### Task 3.2: Add Lidarr Create/List/Edit Regression Coverage Depends on [2.10, 2.11, 2.12, 2.13, 2.14, 2.15]

**READ THESE BEFORE TASK**

- /src/routes/media-management/[databaseId]/quality-definitions/new/+page.server.ts
- /src/routes/media-management/[databaseId]/media-settings/new/+page.server.ts
- /src/routes/media-management/[databaseId]/naming/new/+page.server.ts

**Instructions**

Files to Create

- /src/tests/arr/lidarrMediaManagement.test.ts

Files to Modify

- /src/tests/base/lidarrApiParity.test.ts

Add targeted create/list/edit regression coverage for Lidarr naming/media-settings/quality-definition flows, including negative cases for mapping-gated quality inputs. Include an explicit assertion matrix with stable case IDs in fixtures/comments per surface: naming (NM-01..04), media-settings (MS-01..04), quality-definitions (QD-01..05). Each case must assert status/result, error/message content where applicable, and persisted-state expectations. Verify with concrete commands: `deno test -A src/tests/arr/lidarrMediaManagement.test.ts` and `deno test -A src/tests/base/lidarrApiParity.test.ts`. Expected outcome: automated tests detect Lidarr route/entity regressions with clear per-surface failure signals.

#### Task 3.3: Add Lidarr Sync Metadata and Mapping Regression Coverage Depends on [3.1, 3.2]

**READ THESE BEFORE TASK**

- /src/tests/jobs/lidarrSync.test.ts
- /src/lib/server/sync/mediaManagement/syncer.ts
- /src/lib/server/db/queries/arrSync.ts

**Instructions**

Files to Create

- None

Files to Modify

- /src/tests/jobs/lidarrSync.test.ts

Add explicit sync regression cases for Lidarr config-selection persistence, rename propagation to sync metadata, and mapping-missing skip behavior with expected log/reason assertions. Verify with command: `deno test -A src/tests/jobs/lidarrSync.test.ts`. Expected outcome: sync-path regressions for Lidarr media-management are caught deterministically.

## Advice

- Land Phase 1 early to reduce merge conflicts: `/src/lib/shared/pcd/portable.ts` and `/src/lib/server/pcd/entities/validate.ts` are shared choke points.
- Run entity tasks (`2.1`, `2.4`, `2.7`) in parallel once dependencies are met; then run each surface stream in parallel: server -> form/edit UI -> list views.
- Treat quality-definition mapping readiness as a hard gate; missing Lidarr mappings can look like UI bugs but originate in lookup/sync constraints.
- Keep route handlers thin and push arr-type-specific behavior into entity helpers and validators to avoid drift.
- Preserve Lidarr capability-gating semantics in syncer logs so unsupported-field behavior remains auditable after UI expansion.
