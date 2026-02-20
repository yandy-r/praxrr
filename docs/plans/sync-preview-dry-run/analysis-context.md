### Executive Summary

Sync preview introduces a plan/apply workflow for Arr sync so users can inspect create/update/delete effects before any write occurs. The architecture reuses existing section fetch+transform paths, then diffs desired payloads against live Arr GET state and stores results in a short-lived in-memory preview store. The strongest precedent is the existing cleanup scan/execute two-phase workflow, which maps directly to preview/apply.

### Architecture Context

- System Structure: API preview endpoints call a preview orchestrator, section syncers generate desired state, a diff engine computes entity and field changes, and a TTL store serves retrieval/apply lifecycle.
- Data Flow: request -> validate instance/sections -> build Arr client -> run section preview generation -> diff desired vs remote -> aggregate summary -> cache preview snapshot.
- Integration Points: sync registry/section handlers, namespace suffix utilities, Arr client factory, sync types/interfaces, OpenAPI docs, and sync UI route/components.

### Critical Files Reference

- `packages/praxrr-app/src/lib/server/sync/processor.ts`: orchestration pattern and concurrency handling to mirror.
- `packages/praxrr-app/src/lib/server/sync/registry.ts`: configured section discovery and handler instantiation.
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: highest-complexity sync path to parallel with preview logic.
- `packages/praxrr-app/src/lib/server/sync/customFormats/transformer.ts`: pure transformer reuse for preview parity.
- `packages/praxrr-app/src/lib/server/sync/cleanup.ts`: scan/execute pattern precedent for preview/apply.
- `packages/praxrr-app/src/lib/server/sync/namespace.ts`: suffixed-name matching and display stripping rules.
- `docs/plans/sync-preview-dry-run/feature-spec.md`: source-of-truth for contracts, lifecycle, and UX expectations.

### Patterns to Follow

- Section Registry Pattern: run preview per section using the same registry and `hasConfig()` gating used by sync.
- Scan-Then-Execute Pattern: keep preview generation read-only and separate from apply execution.
- Namespace Isolation Pattern: match on suffixed names, display stripped names.
- Contract-First Pattern: define OpenAPI paths/schemas before route implementation.
- TTL Cache Pattern: in-memory map with expiration timestamps for ephemeral preview state.

### Cross-Cutting Concerns

- Security: preview must be GET-only against Arr APIs and must not expose secrets.
- Performance: preserve bounded per-instance concurrency and avoid expensive recomputation for cached previews.
- Testing: verify diff correctness, staleness thresholds, and preview/execute parity to prevent behavior drift.

### Parallelization Opportunities

- Preview type model + diff engine can proceed in parallel with section-specific preview hooks.
- OpenAPI schema work can proceed in parallel with preview store/orchestrator implementation.
- UI preview rendering can be built against stable preview contracts while backend routes are finalized.
- Section preview logic can be split by section family with coordination only at shared types/store/orchestrator boundaries.

### Implementation Constraints

- No writes during preview: no Arr POST/PUT/DELETE and no sync status DB mutations.
- Must preserve Arr-specific semantics and section support validation.
- Preview snapshots are ephemeral and require staleness handling.
- Apply must validate preview state/age and then run existing sync execution flow.

### Planning Recommendations

- Phase 1: establish preview types/diff core and quality profile/custom format preview generation.
- Phase 2: add preview store/orchestrator and preview API endpoints with staleness/apply lifecycle.
- Phase 3: integrate sync-page UI, summary + field diff rendering, and apply confirmations aligned to risk level.
