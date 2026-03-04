# Pattern Research: score-simulator

This document catalogs the codebase patterns, conventions, and architectural decisions relevant to implementing the score-simulator feature. All patterns are drawn from existing feature implementations, primarily entity-testing and quality-profile scoring -- the two closest analogs.

## Architectural Patterns

### Contract-First API Design

The project uses OpenAPI 3.1 with a `$ref`-based modular structure. New API features must define their schema and path YAML first, then generate TypeScript types before implementing.

- Schema definitions: `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/entity-testing.yaml`
- Path definitions: `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/entity-testing.yaml`
- Root spec with `$ref` aggregation: `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml`
- Generated types consumed via: `import type { components } from '$api/v1.d.ts'`
- Type extraction pattern: `type EvaluateRequest = components['schemas']['EvaluateRequest']`
- Generation command: `deno task generate:api-types`

For score-simulator, create `docs/api/v1/schemas/score-simulator.yaml` and `docs/api/v1/paths/score-simulator.yaml`, add the path to `openapi.yaml`, then regenerate types.

### API Endpoint Structure (`+server.ts`)

API endpoints follow this pattern:

- Import `json`, `error` from `@sveltejs/kit`
- Import `RequestHandler` from `./$types`
- Extract typed request body using OpenAPI-generated types with `satisfies` for return types
- Validate input early, throw `error(400, ...)` for bad requests
- Access PCD cache via `pcdManager.getCache(databaseId)`
- Return `json(...)` with typed response

Reference: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`

```
export const POST: RequestHandler = async ({ request }) => {
  const body: EvaluateRequest = await request.json();
  // validate
  if (!releases || ...) throw error(400, 'message');
  // get cache
  const cache = pcdManager.getCache(databaseId);
  if (!cache) throw error(404, 'Database not found or cache not available');
  // business logic
  return json({ ... } satisfies EvaluateResponse);
};
```

### Database Redirect Page Pattern

Features with `[databaseId]` sub-routes use a parent redirect page at the base route. The parent loads all databases, then the Svelte component redirects to the last-used database or the first available.

- Parent page server: loads `pcdManager.getAll()` only
- Parent page svelte: uses `onMount` + `localStorage` to redirect
- Child page server: validates `databaseId`, loads cache and feature data

Reference parent: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/+page.svelte`
Reference parent server: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/+page.server.ts`
Reference child server: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts`

### Co-located Component Organization

Route-specific components live in a `components/` subdirectory alongside the `+page.svelte`. They are imported with relative paths.

```
routes/quality-profiles/entity-testing/[databaseId]/
  +page.server.ts
  +page.svelte
  components/
    AddEntityModal.svelte
    EntityTable.svelte
    ReleaseTable.svelte
    ReleaseModal.svelte
    ImportReleasesModal.svelte
```

Another pattern separates table variants with a `views/` directory:

```
routes/quality-profiles/[databaseId]/[id]/scoring/
  +page.server.ts
  +page.svelte
  components/
    ScoringTable.svelte
    ScoringTableDesktop.svelte
    ScoringTableMobile.svelte
```

Reference: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/`

### PCD Cache Access Pattern

The PCD cache is the in-memory compiled SQLite database for each linked database. Access pattern:

1. Get the cache: `const cache = pcdManager.getCache(databaseId)`
2. Guard against null: `if (!cache) throw error(500, 'Database cache not available')`
3. Query via Kysely: `cache.kb.selectFrom('table').select([...]).execute()`

The cache exposes `.kb` (a `Kysely<PCDDatabase>` instance) for type-safe queries against the PCD schema.

- PCD Manager: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- PCDCache class: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- PCD public API: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/index.ts`

### Parser Service Integration

The parser is an external C# microservice. Client code must always check health before use and handle the unavailable case gracefully.

- Health check: `isParserHealthy()` returns boolean
- Batch parsing: `parseWithCacheBatch(items)` -- uses cache for performance
- Pattern matching: `matchPatternsBatch(titles, patterns)` -- regex evaluated by parser
- Import from: `$lib/server/utils/arr/parser/index.ts`

Reference: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`

### Custom Format Evaluation

The evaluator provides the building blocks needed for score simulation:

- `getAllConditionsForEvaluation(cache)` -- get all CFs with their conditions
- `evaluateCustomFormat(conditions, parsed, title, patternMatches)` -- evaluate one CF
- `extractAllPatterns(customFormats)` -- get regex patterns for batch matching
- `getParsedInfo(parsed)` -- convert parse result to display-friendly format

Reference: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`

### Scoring Data Access

Quality profile scoring queries provide the score lookup data:

- `scoring(cache, databaseId, profileName)` -- per-profile scoring with CF scores by arr type
- `allCfScores(cache)` -- all profiles' CF scores (used by entity testing)
- Returns `QualityProfileScoring` / `AllCfScoresResult` from `$shared/pcd/display.ts`
- Scores are keyed by arr_type (`radarr`, `sonarr`, `lidarr`, `all`)
- Fallback logic: specific arr_type score overrides `all` score

Reference: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`

### Navigation Registration

Nav items are registered in a centralized registry. Score-simulator could be added as a child of Quality Profiles or as its own nav item under "policies".

- Registry: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/navigation/registry.ts`
- Types: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/navigation/types.ts`
- Entity Testing is registered as a child of Quality Profiles: `buildChild('policies.quality_profiles.testing', 'Testing', '/quality-profiles/entity-testing', 0)`

## Code Conventions

### Naming and File Structure

- **Routes**: kebab-case directory names matching URL segments (`/score-simulator/[databaseId]`)
- **Components**: PascalCase `.svelte` files (`ScoringTable.svelte`, `ReleaseModal.svelte`)
- **Server modules**: camelCase function exports, descriptive names (`scoring`, `allCfScores`, `evaluateCustomFormat`)
- **Types**: PascalCase interfaces in `$shared/pcd/display.ts` or OpenAPI-generated `$api/v1.d.ts`
- **Imports**: use path aliases (`$pcd/`, `$shared/`, `$api/`, `$ui/`, `$lib/`)
- **File extensions**: `.ts` extensions are included in imports (e.g., `'$pcd/index.ts'`)

### Svelte 5 Component Conventions

- Use `export let data: PageData` for page data (not runes)
- Use `export let propName` for component props
- Use `$:` reactive declarations (not `$state` / `$derived`)
- Use `createEventDispatcher` for component-to-parent communication
- Use `onMount` for browser-only initialization
- Use `browser` from `$app/environment` for SSR guards
- Tabs indentation in `.svelte` files, spaces in `.ts` files

### Client-Side API Calls

- Use native `fetch` with full API path (`/api/v1/...`)
- Set `Content-Type: application/json` header
- Check `response.ok` before parsing
- Handle errors with `alertStore.add('error', message)`
- Trigger Svelte reactivity by reassigning (e.g., `evaluations = evaluations`)

### Formatting Rules

- Tabs for indentation
- Single quotes
- No trailing commas
- 100 character print width
- Prettier + prettier-plugin-svelte + prettier-plugin-tailwindcss

## Error Handling

### Server-Side (API Endpoints)

- **Validation errors**: `throw error(400, 'descriptive message')` from `@sveltejs/kit`
- **Not found**: `throw error(404, 'message')`
- **Cache unavailable**: `throw error(500, 'Database cache not available')`
- **Form actions**: use `return fail(400, { error: 'message' })` instead of `throw error()`
- **Parser unavailable**: return degraded response (e.g., `parserAvailable: false`) instead of throwing

### Server-Side (Page Load Functions)

- Validate `params` existence first: `if (!databaseId) throw error(400, 'Missing database ID')`
- Parse and validate numeric IDs: `const id = parseInt(databaseId, 10); if (isNaN(id)) throw error(400, 'Invalid database ID')`
- Validate database exists: `const db = databases.find(...); if (!db) throw error(404, 'Database not found')`
- Validate cache: `const cache = pcdManager.getCache(id); if (!cache) throw error(500, 'Database cache not available')`

### Client-Side

- Use `alertStore.add(type, message)` for user-facing notifications
- `alertStore.add('warning', 'Parser service unavailable', 0)` -- duration 0 means persistent
- Try/catch around fetch calls with error alerts
- Console.error for developer-facing errors

## Testing Approach

### Unit Tests

- Use Deno's built-in test runner with `Deno.test('name', () => { ... })`
- Assert with `@std/assert` (`assertEquals`, etc.)
- Located in `packages/praxrr-app/src/tests/` organized by feature area
- BaseTest class available for tests needing temp dirs and file utilities
- Run with `deno task test` or specific aliases from `scripts/test.ts`

Reference test: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/arr/resolveArrTargets.test.ts`

### E2E Tests

- Playwright-based, in `packages/praxrr-app/src/tests/e2e/specs/`
- Named with numbered prefixes for ordering (e.g., `2.35-qp-scoring-cf-score-same-row-conflict.spec.ts`)
- Helpers in `packages/praxrr-app/src/tests/e2e/helpers/`

### Score-Simulator Testing Strategy

For the score-simulator, focus on:

1. **Unit tests** for the scoring calculation logic (pure functions that compute total scores from CF matches and profile scores)
2. **Unit tests** for edge cases: missing parser, empty releases, profiles with no CF scores, `all` vs specific arr_type score fallback
3. **Integration consideration**: the API endpoint orchestrates parser + PCD cache, so test the components individually

## Patterns to Follow

### Route Structure for score-simulator

```
packages/praxrr-app/src/routes/score-simulator/
  +page.server.ts          # Load databases list, redirect logic
  +page.svelte             # Redirect to last-used database
  [databaseId]/
    +page.server.ts        # Load quality profiles, CF data, parser health
    +page.svelte           # Main simulator page
    components/
      ReleaseInput.svelte
      SimulationResults.svelte
      ProfileComparison.svelte
      ScoreBreakdown.svelte
```

### API Route for score-simulator

```
packages/praxrr-app/src/routes/api/v1/simulate/
  score/
    +server.ts             # POST handler for score simulation
```

### OpenAPI Schema Files

```
docs/api/v1/schemas/score-simulator.yaml
docs/api/v1/paths/score-simulator.yaml
```

### Key Data Flow

1. Page load: fetch databases, quality profiles, parser health status
2. User inputs release title(s) and selects media type
3. Client POSTs to `/api/v1/simulate/score` with `{ databaseId, releases }`
4. Server: parse titles via parser service, evaluate CFs, compute scores per profile
5. Server returns: parsed info, CF matches, score breakdowns per profile
6. Client renders results with profile comparison and score breakdown

### Important Reuse Opportunities

- `parseWithCacheBatch` for title parsing (already cached)
- `getAllConditionsForEvaluation` + `evaluateCustomFormat` for CF matching
- `allCfScores` or per-profile `scoring` queries for score data
- `extractAllPatterns` + `matchPatternsBatch` for regex matching
- `isParserHealthy` for parser availability check
- Existing UI components: `Tabs`, `ActionsBar`, `SearchAction`, `InfoModal`, `EmptyState`

### Arr-Type Awareness

Score calculations must be arr-type-aware. The entity-testing page demonstrates the pattern:

```typescript
const arrType = entityType === 'movie' ? 'radarr' : 'sonarr';
// Look up score for the specific arr type
const score = profileScores.scores[cfName]?.[arrType] ?? null;
```

Scores have a fallback chain: specific arr_type score -> `all` score -> null. This logic lives in the scoring read queries and should be replicated or reused in the simulator.

## Relevant Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: Closest API endpoint analog -- parse + evaluate pattern
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts`: Page load with parser check, cache access, scoring data
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.svelte`: Client-side fetch, score calculation, parser warning
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/EntityTable.svelte`: Co-located component with typed props and event dispatch
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.server.ts`: Scoring page load with profile validation
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/scoring/+page.svelte`: Scoring UI with dirty tracking, search store
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`: CF evaluation logic (reuse directly)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`: Scoring queries (reuse directly)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: Parser client with caching
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/navigation/registry.ts`: Where to register nav item
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml`: OpenAPI root spec
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/entity-testing.yaml`: Schema reference for contract-first design
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/pcd/display.ts`: Shared display types for scoring data

## Edgecases

- Parser unavailable: must return a degraded response (`parserAvailable: false`) and show a warning banner; never throw 500 for parser downtime
- Arr-type score fallback: `all` scores serve as defaults when no arr-type-specific score exists; the code must replicate the fallback chain in `scoring/read.ts`
- Lidarr does not have the same scoring semantics as Radarr/Sonarr -- per the Cross-Arr Semantic Validation Policy, verify behavior per arr_type before reusing handlers
- Empty CF conditions: CFs with zero conditions do not match (`cfMatches[cf.name] = false`)
- Database cache can be null if a database failed compilation -- always guard
- Score values can be `null` (CF not scored for that arr type) vs `0` (explicitly scored as zero) -- these are semantically different
- localStorage keys for database persistence must be unique per feature (e.g., `scoreSimulatorDatabase`)

## Other Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/feature-spec.md`: Feature specification
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-architecture.md`: Architecture research
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-business.md`: Business research
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-technical.md`: Technical research
- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`: Project conventions and guidelines
