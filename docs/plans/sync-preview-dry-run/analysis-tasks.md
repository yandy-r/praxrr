### Executive Summary

The most effective plan shape is a wide dependency graph with a small shared foundation, then parallel section/API/UI tracks converging in final integration. Task boundaries should align with module seams (preview core, section preview hooks, API routes, docs, UI components) to keep ownership clear and merges safe. Dependencies should be explicit around shared contracts and shared files only.

### Recommended Phase Structure

#### Phase 1: Foundation Contracts

- purpose: lock preview data model, diff semantics, and core orchestration boundaries.
- suggested tasks: preview types, diff engine wrapper, section diff helpers, sync contract extensions.
- parallelization notes: diff engine and section diff helpers can run in parallel after types are agreed.

#### Phase 2: Section Preview + API Surface

- purpose: generate real section previews and expose lifecycle endpoints.
- suggested tasks: per-section preview hooks, preview store, orchestrator, OpenAPI path/schema files, route handlers.
- dependencies: route handlers depend on preview types/store/orchestrator and finalized OpenAPI contract.

#### Phase 3: UI Integration + Apply Flow

- purpose: deliver user-facing preview/review/apply interactions with staleness safeguards.
- suggested tasks: sync page/footer preview actions, diff UI components, apply confirmation path.
- integration focus: align payload usage with API contracts and preserve risk-tier confirmation behavior.

### Task Granularity Guidance

- appropriate task sizes: 1-3 files, single concern, explicit integration boundary.
- tasks to split: shared contract updates separated from section-specific implementations.
- tasks to combine: tightly-coupled route and schema changes for a single endpoint lifecycle.

### Dependency Analysis

#### Independent Tasks

- diff engine internals once preview types exist.
- preview store implementation once preview type IDs/status shape is fixed.
- UI component scaffolding using stable preview payload mocks.

#### Sequential Tasks

- OpenAPI contract -> API route implementation.
- sync contract extensions -> section preview hook implementation.
- orchestrator/store -> apply endpoint behavior.

#### Potential Bottlenecks

- `packages/praxrr-app/src/lib/server/sync/types.ts` shared by many tasks.
- `docs/api/v1/openapi.yaml` reference wiring for new path/schema documents.
- sync page integration where footer actions and preview panels converge.

### Suggested Task Template

- title format: `preview:<area>: <outcome>`.
- dependency annotation format: `Depends on [x.y, ...]` or `Depends on [none]`.
- instruction completeness checklist:
- clear files-to-create/files-to-modify lists
- explicit behavior contract and edge-case coverage
- concrete integration constraints and completion criteria
