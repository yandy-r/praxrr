# Pattern Research: progressive-disclosure

## Architectural Patterns

**Route + Server Pairing Pattern**: Feature pages are implemented as colocated SvelteKit routes where `+page.svelte` handles UI and `+page.server.ts` handles loading/actions and validation. This keeps disclosure controls localized to the feature route and easy to keep accessible per page state.

- Example: [packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/general/+page.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/general/+page.svelte), [packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/general/+page.server.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/general/+page.server.ts)

**Domain Service/Repository Pattern for PCD entities**: Server operations are organized under entity folders with separate `read/create/update/delete` modules and an `index.ts` barrel. This is a good place to put progressive-disclosure state persistence/validation logic instead of embedding it in route files.

- Example: [packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts), [packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/general/update.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/general/update.ts), [packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/index.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/mediaManagement/media-settings/index.ts)

**API Handler + Helper Decomposition**: API endpoints split orchestration and transformation/validation concerns into helper modules (including custom error mapping). Similar structure is useful for progressive-disclosure endpoints (if any future API is added for persisting collapsed state/options presets).

- Example: [packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts), [packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/\_helpers.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/_helpers.ts)

**Explicit Toggle-Control Pattern (instead of implicit expand UI)**: Existing sensitive-input and detail disclosure patterns use explicit user actions (toggle text/buttons + state) rather than only icon-only affordances, matching your “non-developer clarity” requirement.

- Example: [packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte), [packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte)

**Expandable Row/Section Pattern for grouped disclosure**: A reusable table/slot component manages expanded section state with clear event/control boundaries, useful when advanced fields are grouped into clearly labeled sections.

- Example: [packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte), [packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/EntityTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/EntityTable.svelte)

## Code Conventions

**Naming and organization**

- SvelteKit route components use conventional filenames (`+page.svelte`, `+page.server.ts`, `+server.ts`).
- Domain modules use nested folders by feature and concern (`pcd/entities/<domain>/<subdomain>/...`) and verb-based files (`read.ts`, `update.ts`, etc.).
- Shared UI controls are component-centric and PascalCase (`MaskedApiKey.svelte`, `StickyCard.svelte`).

- Example: [packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/naming/radarr/[name]/+page.server.ts), [packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/general/update.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/general/update.ts)

**Import/export patterns**

- Alias-based imports are common (`$lib`, `$pcd`, `$db`, `$ui`, `$shared`, `$logger`, `$config`), reducing long relative paths and keeping layers obvious.
- Barrel exports via `index.ts` in service folders centralize external API for the feature.

- Example: [packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts), [packages/praxrr-app/src/lib/server/db/index.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/index.ts) (if needed for layer import style consistency)

**UI conventions**

- Components favor explicit control text over hidden gestures.
- State is explicit (local boolean flags), and disclosure state is reflected directly in rendered labels.
- Shared button and card primitives are reused instead of one-off controls.

- Example: [packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte), [packages/praxrr-app/src/lib/client/ui/card/StickyCard.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/card/StickyCard.svelte)

## Error Handling

- Server routes validate early and return explicit HTTP failures (`error()` in load paths, `fail()` in action branches). This suggests progressive-disclosure should fail fast for malformed toggle state or payloads.
- API routes return structured `json({ error })` responses with status mapping and helper-based parsing validation.
- Domain layers use typed/custom errors where needed and map them into user-facing API errors rather than silent fallback behavior.
- Logging is explicit and contextual (`logger.error/info/warn`) around failure points and state transitions.

- Example: [packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/+page.server.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/+page.server.ts), [packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/\_helpers.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/_helpers.ts), [packages/praxrr-app/src/lib/server/trashguide/types.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/trashguide/types.ts), [packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/general/update.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/general/update.ts)

## Testing Approach

- Tests are organized by domain under `src/tests/<domain>` and typically cover both route/API handlers and business logic.
- Unit tests use `Deno.test` with `@std/assert`, often invoking handlers directly.
- A `BaseTest` utility class is used for lifecycle-heavy suites, with explicit setup/teardown and structured `runTests()` execution.
- Mocking is done via controlled monkey-patching of module methods/objects with restore-on-teardown patterns in `try/finally`.
- E2E tests validate visible text/controls (important for “Show/Hide Advanced” behavior).

- Example: [packages/praxrr-app/src/tests/base/BaseTest.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/BaseTest.ts), [packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/lidarrApiParity.test.ts), [packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts), [packages/praxrr-app/src/tests/e2e/specs/2.40-api-key-masking.spec.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/e2e/specs/2.40-api-key-masking.spec.ts)

## Patterns to Follow

- Implement progressive-disclosure as explicit section-level toggles on the page (`Show Advanced` / `Hide Advanced`) with visible labels and clear state, rather than icon-only expand arrows.
- Keep advanced field grouping in a dedicated block/component (`StickyCard`/section component) and hide/show entire section with one boolean binding.
- Preserve route/server layering: page UI state in `+page.svelte`, persistence/validation in `+page.server.ts`, and entity updates in the relevant `pcd/entities/<feature>/...` module.
- Add early validation and typed error paths for toggle-driven payloads; map domain issues to explicit route/API errors with logs.
- Cover with:
  - route test for server action payload validation,
  - UI unit/integration assertion on label toggling and section visibility behavior,
  - e2e check for accessibility/text visibility (button states and focus order).
