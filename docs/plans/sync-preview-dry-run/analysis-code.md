### Executive Summary

The codebase already provides most infrastructure needed for sync preview: section registry orchestration, shared Arr client factories, and transformer-heavy syncers. The core implementation work is adding a preview pathway that reuses existing fetch/transform logic but swaps write operations for diff computation and cached preview state. The highest-risk area is maintaining strict parity with current sync behavior while avoiding cross-section coupling in shared files.

### Related Components

- `packages/praxrr-app/src/lib/server/sync/base.ts`: current sync lifecycle contract and potential `generatePreview()` extension point.
- `packages/praxrr-app/src/lib/server/sync/types.ts`: shared section/result interfaces to extend for preview contracts.
- `packages/praxrr-app/src/lib/server/sync/registry.ts`: section registration/discovery.
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: multi-entity ordering and matching behavior.
- `packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`: custom format sync entrypoint and matching behavior.
- `packages/praxrr-app/src/lib/server/utils/cache/cache.ts`: reusable TTL in-memory cache pattern for preview storage.
- `packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: route-level scan/execute workflow pattern.

### Implementation Patterns

**Registry-Driven Section Dispatch**: Resolve configured sections and instantiate syncers via registry rather than hardcoded branching.

- Example: `packages/praxrr-app/src/lib/server/sync/registry.ts`
- Apply to: preview orchestrator task routing.

**Syncer Intercept Pattern**: Reuse section fetch/transform helpers and intercept before push/write.

- Example: `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`
- Apply to: section `generatePreview()` additions.

**Namespace-Safe Matching**: Perform matching with suffixed names but normalize display names for output.

- Example: `packages/praxrr-app/src/lib/server/sync/namespace.ts`
- Apply to: diff entity identity and UI payload formatting.

**TTL Snapshot Store**: Keep preview snapshots ephemeral with explicit expiry metadata.

- Example: `packages/praxrr-app/src/lib/server/utils/cache/cache.ts`
- Apply to: preview lifecycle storage.

### Integration Points

#### Files to Create

- `packages/praxrr-app/src/lib/server/sync/preview/index.ts`: preview module exports.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`: preview result and diff schemas.
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`: TTL preview storage.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`: per-instance and per-section preview coordinator.
- `packages/praxrr-app/src/lib/server/sync/preview/diff.ts`: generic deep-diff wrapper.
- `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts`: section-aware diff classification.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`: preview creation endpoint.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/+server.ts`: preview get/delete endpoint.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`: preview apply endpoint.
- `docs/api/v1/paths/sync.yaml`: preview path contracts.
- `docs/api/v1/schemas/sync.yaml`: preview schema contracts.

#### Files to Modify

- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: expose preview generation path.
- `packages/praxrr-app/src/lib/server/sync/customFormats/syncer.ts`: expose preview generation path.
- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`: add delay profile preview support.
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: add per-subsection preview support.
- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`: add Lidarr metadata preview support.
- `packages/praxrr-app/src/lib/server/sync/types.ts`: extend sync contracts for preview.
- `packages/praxrr-app/src/lib/server/sync/base.ts`: optional abstract preview hook.
- `packages/praxrr-app/src/lib/server/sync/index.ts`: export preview module.
- `docs/api/v1/openapi.yaml`: include new sync preview path/schemas.

### Conventions

- Keep section identifiers aligned with existing `SectionType` literals.
- Fail fast with explicit errors and log with sync/preview source context.
- Preserve contract-first workflow for API additions.
- Keep tasks scoped to 1-3 files where practical to reduce merge conflicts.

### Gotchas and Warnings

- Syncers currently inline significant logic; avoid duplicating behavior when adding preview hooks.
- Shared files (`sync/types.ts`, `sync/index.ts`, OpenAPI root) can become merge bottlenecks.
- Lidarr-specific condition and schema behavior must be preserved in preview parity.
- Namespace suffix handling is easy to regress if display normalization leaks into matching logic.

### Task Guidance by Area

- database: keep preview read-only and reuse existing sync config queries.
- api: define contracts first, then implement generation/get/delete/apply lifecycle.
- ui: integrate preview controls and diff rendering into existing sync page/footer flows.
