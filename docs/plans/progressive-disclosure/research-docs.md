# Documentation Research: progressive-disclosure

## Architecture Docs

- [docs/ARCHITECTURE.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ARCHITECTURE.md): High-level architecture, boundaries between UI, API, and sync/persistence layers.
- [docs/architecture/components.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/components.md): Component model and composition patterns relevant to building reusable UI behavior.
- [docs/architecture/data-flow.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/data-flow.md): Data loading and propagation flows, useful for designing “load on expand” behavior.
- [docs/features/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/README.md): Feature documentation structure and conventions used for feature-facing implementation notes.
- [tasks/todo.md](/home/yandy/Projects/github.com/yandy-r/praxrr/tasks/todo.md): Current feature task backlog including progressive-disclosure-related rollout notes (Issue 11 references and related items).

## API Docs

- [docs/api/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/README.md): API doc organization and expectations for endpoints affected by UI behavior changes.
- [docs/api/endpoints.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md): Endpoint index and behavior notes useful for deciding where expanded-state operations belong.
- [packages/praxrr-app/src/routes/api/v1/arr/library/episodes/+server.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/arr/library/episodes/+server.ts): Server route comments and implementation pattern for “expand/fetch related detail” style responses.
- [packages/praxrr-app/src/lib/server/pcd/ops/compile.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/ops/compile.ts): Inline code comments around operation compilation and payload shape assumptions that can affect “advanced fields” presentation and persistence semantics.

## Development Guides

- [docs/DEVELOPMENT.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/DEVELOPMENT.md): Repository conventions, coding standards, and implementation workflow.
- [docs/features/entity-testing.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/entity-testing.md): Testing-oriented feature doc style useful for progressive-disclosure behavior validation.
- [docs/features/portable-import-export.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/portable-import-export.md): Data-shape and compatibility guidance that matters when hiding/revealing advanced options.
- [packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte): In-component commentary and event contracts for expandable rows and lazy section loading.
- [packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/%5Bid%5D/library/+page.svelte): Runtime pattern of row-level detail expansion tied to explicit user interaction.
- [packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/EntityTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/%5BdatabaseId%5D/components/EntityTable.svelte): Existing table UX for optional details and expanded content patterns.
- [packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/ReleaseTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/%5BdatabaseId%5D/components/ReleaseTable.svelte): Companion implementation notes for nested/conditional rendering patterns.
- [packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/%5BdatabaseId%5D/+page.svelte): Page-level orchestration around conditional data loading and complex form controls.

## README Files

- [README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/README.md): Project overview, user-facing entry points, and navigation cues for feature behavior alignment.
- [docs/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/README.md): Guide to docs structure and where feature-specific documentation is expected.
- [docs/api/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/README.md): API documentation conventions for maintainers.
- [docs/features/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/README.md): Feature documentation template and expected content format.
- [packages/praxrr-api/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-api/README.md): API package intent and integration behavior useful for endpoint-level changes.
- [packages/praxrr-db/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/README.md): Persistence expectations when exposing new preference/state toggles.
- [packages/praxrr-schema/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/README.md): Contract and schema ownership context for new user-preference fields.
- [packages/praxrr-app/src/lib/server/utils/arr/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/README.md): Arr integration docs that gate advanced option behavior across app families.
- [packages/praxrr-app/src/lib/server/utils/auth/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/README.md): Auth/session behavior relevant if show/hide state is persisted.

## Must-Read Documents

- [tasks/todo.md](/home/yandy/Projects/github.com/yandy-r/praxrr/tasks/todo.md): Mandatory because it contains direct progressive-disclosure planning context for issue #11 and adjacent implementation tasks.
- [docs/ARCHITECTURE.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ARCHITECTURE.md): Mandatory for deciding whether disclosure logic belongs in server state, route state, or component state.
- [docs/DEVELOPMENT.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/DEVELOPMENT.md): Mandatory for style/architecture constraints while touching UI and docs.
- [docs/api/README.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/README.md) + [docs/api/endpoints.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md): Mandatory for any API contract changes needed by advanced section toggles.
- [packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte): Mandatory for implementation reuse and consistency of expandable UX mechanics.
- [packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/%5Bid%5D/library/+page.svelte): Mandatory for event-driven expand interaction and fetch-on-expand data loading behavior.

Nice-to-have:

- [docs/features/entity-testing.md](/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/entity-testing.md), [packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/EntityTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/%5BdatabaseId%5D/components/EntityTable.svelte), [packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/ReleaseTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/%5BdatabaseId%5D/components/ReleaseTable.svelte): Useful for concrete examples of conditional rendering patterns in feature UIs.

## Documentation Gaps

- No dedicated progressive-disclosure or “show/hide advanced fields” feature spec exists in `docs/`.
- No explicit user-level design doc for preference persistence of disclosure state (e.g., per-page/per-section defaults, reset behavior, and cross-route consistency).
- No centralized API contract in docs for preference endpoints tied to UI disclosure state; existing docs focus on general endpoints but not this feature.
- Search did not surface a dedicated component-level style guide for explicit “Advanced” labeling, animation timing, and accessibility guidance (focus management/aria-expanded patterns).
- External references for progressive-disclosure UX patterns are present in research artifacts, but not linked into the main docs index; implementers may miss them unless they inspect `research/` notes.
