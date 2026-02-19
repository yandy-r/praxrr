# Arr Library View Pagination

The library feature currently fetches full Arr datasets through `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts` and renders them in `packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`, with search/filter/column preferences already persisted in existing client state layers. Pagination must be introduced as a server-side contract extension (query params + metadata) while preserving explicit Arr-type dispatch, profile enrichment, and existing row/component behavior. The implementation touches both cache layers (`packages/praxrr-app/src/lib/server/utils/cache/cache.ts` and `packages/praxrr-app/src/lib/client/stores/libraryCache.ts`) so page-aware caching and refresh invalidation remain coherent. Existing planning docs for this feature already define expected UX behavior and acceptance criteria, so work should align to those documents and keep OpenAPI/runtime contracts in lockstep.

## Relevant Files

- `/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`: Core GET/DELETE handler where pagination params and metadata are added.
- `/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`: Library page orchestration; pagination state integrates with existing search/filter flows.
- `/packages/praxrr-app/src/routes/arr/[id]/library/components/LibraryActionBar.svelte`: Existing controls to keep aligned with page/query state.
- `/packages/praxrr-app/src/lib/client/stores/libraryCache.ts`: Client cache behavior must include page/query-aware keys.
- `/packages/praxrr-app/src/lib/server/utils/cache/cache.ts`: Server cache keys/values must remain valid for paginated responses.
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Arr instance resolution used before all library fetches.
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts`: Profile-name enrichment logic included in library responses.
- `/packages/praxrr-app/src/lib/server/utils/arr/clients/radarr.ts`: Radarr upstream data source consumed before pagination slice.
- `/packages/praxrr-app/src/lib/server/utils/arr/clients/sonarr.ts`: Sonarr upstream data source consumed before pagination slice.
- `/packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr upstream data source consumed before pagination slice.
- `/docs/api/v1/paths/arr.yaml`: API path definitions to update for pagination request contract.
- `/docs/api/v1/schemas/arr.yaml`: API schemas to update for pagination response metadata.
- `/packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts`: Backend test pattern for Arr library response/error behavior.
- `/packages/praxrr-app/src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts`: E2E pattern for library UI/API interaction validation.

## Relevant Tables

- `arr_instances`: Arr instance connection/type metadata used for library route dispatch.

## Relevant Patterns

**Page-Orchestrator Route Pattern**: Keep library state orchestration in route-level `+page.svelte` and delegate rendering/actions to child components. Example: [`/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`](/packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte).

**Arr-Type Dispatch in API Handler**: Resolve instance metadata first, then branch behavior by explicit `arr_type`/instance type to preserve cross-Arr semantics. Example: [`/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`](/packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts).

**Layered Cache Pattern**: Maintain coordinated server and client cache invalidation semantics when extending response contracts. Example: [`/packages/praxrr-app/src/lib/server/utils/cache/cache.ts`](/packages/praxrr-app/src/lib/server/utils/cache/cache.ts), [`/packages/praxrr-app/src/lib/client/stores/libraryCache.ts`](/packages/praxrr-app/src/lib/client/stores/libraryCache.ts).

**Persistent Query State Pattern**: Keep search/filter/view state persistent via existing stores and local storage mechanisms when adding pagination state. Example: [`/packages/praxrr-app/src/lib/client/stores/search.ts`](/packages/praxrr-app/src/lib/client/stores/search.ts), [`/packages/praxrr-app/src/lib/client/stores/dataPage.ts`](/packages/praxrr-app/src/lib/client/stores/dataPage.ts).

## Relevant Docs

**`/docs/plans/arr-library-view-pagination/feature-spec.md`**: You _must_ read this when implementing pagination behavior, UX expectations, and acceptance criteria.

**`/docs/plans/arr-library-view-pagination/research-technical.md`**: You _must_ read this when wiring API/query/cache changes for paginated flows.

**`/docs/plans/arr-library-view-pagination/research-ux.md`**: You _must_ read this when implementing controls, loading states, and accessibility behavior.

**`/docs/api/v1/paths/arr.yaml`**: You _must_ read this when changing `/api/v1/arr/library` query/path contract details.

**`/docs/api/v1/schemas/arr.yaml`**: You _must_ read this when changing response payload schemas and pagination metadata.

**`/docs/ARCHITECTURE.md`**: You _must_ read this when aligning pagination changes with existing frontend/backend architecture conventions.
