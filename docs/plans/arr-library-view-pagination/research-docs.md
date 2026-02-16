# Documentation Research: arr-library-view-pagination

## Architecture Docs

- `docs/ARCHITECTURE.md`: Frontend and backend structure conventions relevant to integrating pagination into existing route/component layers.

## API Docs

- `docs/api/v1/paths/arr.yaml`: Current `/arr/library` GET/DELETE contract and operation structure to extend with pagination params.
- `docs/api/v1/schemas/arr.yaml`: Current Arr library response schemas that need pagination metadata fields.
- `src/routes/api/v1/arr/library/+server.ts`: In-code API behavior and handler flow for request validation, caching, and response shaping.

## Development Guides

- `docs/plans/arr-library-view-pagination/feature-spec.md`: Primary requirements, UX expectations, and acceptance criteria for this feature.
- `docs/plans/arr-library-view-pagination/research-technical.md`: Existing technical decomposition for backend/frontend/cache updates.
- `docs/plans/arr-library-view-pagination/research-ux.md`: UI interaction requirements, loading behavior, and accessibility considerations.
- `docs/plans/arr-library-view-pagination/research-business.md`: Business context and constraints affecting pagination behavior.
- `docs/plans/arr-library-view-pagination/research-recommendations.md`: Implementation strategy and risk mitigation recommendations.

## README Files

- `README.md`: Project scope, development context, and high-level behavior for Arr management workflows.

## Must-Read Documents

- `docs/plans/arr-library-view-pagination/feature-spec.md`: You _must_ read this when implementing pagination behavior and acceptance criteria.
- `docs/plans/arr-library-view-pagination/research-technical.md`: You _must_ read this when updating API, page state, and cache interactions.
- `docs/plans/arr-library-view-pagination/research-ux.md`: You _must_ read this when implementing UI controls, accessibility, and loading states.
- `docs/api/v1/paths/arr.yaml`: You _must_ read this when changing `/api/v1/arr/library` request contract.
- `docs/api/v1/schemas/arr.yaml`: You _must_ read this when changing library response payload shape.
- `src/routes/api/v1/arr/library/+server.ts`: You _must_ read this when implementing server-side pagination/filtering/sorting.
- `src/routes/arr/[id]/library/+page.svelte`: You _must_ read this when integrating pagination controls with existing search/filter/column state.

## Documentation Gaps

- The OpenAPI contract currently documents non-paginated Arr library responses; pagination query params and metadata are not yet formalized.
- There is no authoritative doc describing page-aware cache key strategy across server cache and `libraryCache`.
- Existing planning docs include open UX decisions (for example filter scope and page-size persistence) that should be finalized before implementation starts.
