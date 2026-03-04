# Score Simulator

The score simulator builds on an existing three-layer evaluation pipeline: (1) C# parser microservice for .NET-fidelity title parsing and regex matching via `$lib/server/utils/arr/parser/client.ts`, (2) PCD in-memory SQLite cache for custom format conditions and quality profile score mappings accessed via `pcdManager.getCache(databaseId)`, and (3) a server-side CF evaluator at `$pcd/entities/customFormats/evaluator.ts` that resolves matches using Arr-compatible grouping logic. The primary new work is a dedicated `POST /api/v1/simulate/score` endpoint that preserves per-condition `ConditionResult[]` detail (currently discarded by entity-testing's evaluate endpoint) and computes scores server-side, plus a SvelteKit route at `/score-simulator/[databaseId]` with a split-pane playground UI following the database-redirect pattern used by entity-testing and quality-profiles.

## Relevant Files

- packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts: Reference API endpoint -- parse batch + evaluate CFs pipeline; simulator extends this with score computation and condition detail preservation
- packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts: Core CF evaluation engine -- `evaluateCustomFormat()`, `extractAllPatterns()`, `getParsedInfo()`; returns `EvaluationResult` with full `ConditionResult[]`
- packages/praxrr-app/src/lib/server/pcd/entities/customFormats/conditions/read.ts: Batch condition loading -- `getAllConditionsForEvaluation(cache)` returns all CFs with all condition data
- packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts: Score resolution queries -- `scoring()` for per-profile scores with arr_type precedence, `allCfScores()` for all profiles
- packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts: Parser singleton with `parseWithCacheBatch()`, `matchPatternsBatch()`, `isParserHealthy()`
- packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts: `ParseResult`, `MediaType`, enum types for parser responses
- packages/praxrr-app/src/lib/shared/pcd/display.ts: Shared types -- `ConditionData`, `ConditionResult`, `EvaluationResult`, `ParsedInfo`, `QualityProfileScoring`, `AllCfScoresResult`, `CustomFormatWithConditions`
- packages/praxrr-app/src/lib/shared/arr/capabilities.ts: `ArrAppType`, `ArrType` definitions and arr capability constants
- packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts: Reference page load pattern -- loads databases, cache, profiles, allCfScores, parser health
- packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.svelte: Reference client pattern -- lazy fetch evaluations, client-side score calculation, parser warning
- packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/ReleaseTable.svelte: CF match display with ExpandableTable, Score, Badge components
- packages/praxrr-app/src/routes/quality-profiles/entity-testing/+page.server.ts: Database redirect parent -- loads `pcdManager.getAll()` only
- packages/praxrr-app/src/routes/quality-profiles/entity-testing/+page.svelte: Database redirect client -- `onMount` + `localStorage` redirect to last-used database
- packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts: Alternative reference -- server-side CF evaluation returning full `ConditionResult[]` per test
- packages/praxrr-app/src/lib/server/navigation/registry.ts: Nav item registration -- add score-simulator to `NAV_REGISTRY` in `policies` group
- packages/praxrr-app/src/lib/shared/navigation/types.ts: `NavItemDef`, `NavChildDef` types for nav registration
- packages/praxrr-app/src/lib/shared/navigation/constants.ts: `NAV_GROUP_ID` with groups: overview, apps, policies, operations, settings, dev
- packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts: Disclosure section key registry -- format `route-family:page:section`
- packages/praxrr-app/src/lib/server/pcd/core/manager.ts: PCD manager -- `getAll()`, `getCache(id)`, cache lifecycle
- packages/praxrr-app/src/lib/server/pcd/database/cache.ts: `PCDCache` class with `.kb` Kysely query builder
- packages/praxrr-app/src/lib/server/pcd/index.ts: PCD public API re-exports
- packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/index.ts: Re-exports `scoring`, `allCfScores`, `select`, `general`
- docs/api/v1/openapi.yaml: Root OpenAPI spec -- add path ref, schema ref, and `Score Simulator` tag
- docs/api/v1/schemas/entity-testing.yaml: Existing schemas -- `ParsedInfo`, `MediaType`, `ReleaseInput` referenceable by simulator
- docs/api/v1/paths/entity-testing.yaml: Reference path definition structure for new simulator path
- docs/api/v1/schemas/common.yaml: Common error response schemas
- packages/praxrr-app/src/lib/api/v1.d.ts: Generated TypeScript types -- regenerate after OpenAPI changes
- packages/praxrr-app/src/lib/client/ui/navigation/tabs/Tabs.svelte: Database tab switcher component
- packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte: Expandable row table for CF condition detail
- packages/praxrr-app/src/lib/client/ui/arr/Score.svelte: Color-coded score display with sign prefix
- packages/praxrr-app/src/lib/client/ui/arr/CustomFormatBadge.svelte: CF name badge component
- packages/praxrr-app/src/lib/client/ui/badge/Badge.svelte: General badge for parsed attributes
- packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte: Toolbar pattern
- packages/praxrr-app/src/lib/client/ui/dropdown/Dropdown.svelte: Dropdown for profile selection
- packages/praxrr-app/src/lib/client/stores/dataPage.ts: `createDataPageStore` for search/filter
- packages/praxrr-app/src/lib/client/alerts/store.ts: `alertStore.add(type, message)` for notifications

## Relevant Tables

- custom_formats: CF definitions with name, description; base entity for evaluation
- custom_format_conditions: Condition metadata per CF -- type, arr_type, negate, required flags
- condition_patterns: Regex pattern conditions linked to regular_expressions table
- condition_languages: Language match conditions with except_language flag
- condition_sources: Source conditions (Bluray, WebDL, etc.)
- condition_resolutions: Resolution conditions (1080, 2160, etc.)
- condition_quality_modifiers: Quality modifier conditions (Remux, etc.) -- Radarr-only
- condition_release_types: Release type conditions -- Sonarr-only
- condition_years: Year range conditions (min_year, max_year)
- condition_sizes: Size range conditions -- not evaluable from title alone
- condition_indexer_flags: Indexer flag conditions -- not evaluable from title alone
- regular_expressions: Regex definitions with name, pattern, regex101_id
- quality_profiles: Profile definitions with minimum_custom_format_score, upgrade_until_score, upgrade_score_increment
- quality_profile_custom_formats: Score mappings -- PK (quality_profile_name, custom_format_name, arr_type); score resolution: specific arr_type > 'all' > null
- parsed_release_cache: App DB cached parser results keyed by title:type + parser_version
- pattern_match_cache: App DB cached .NET regex matches keyed by title + patterns_hash

## Relevant Patterns

**Contract-First API**: OpenAPI YAML schema and path definitions created first in `docs/api/v1/`, registered in `openapi.yaml`, types generated via `deno task generate:api-types`, then implementation follows using `satisfies` type annotations. See [docs/api/v1/schemas/entity-testing.yaml](docs/api/v1/schemas/entity-testing.yaml) and [packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts](packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts).

**Database Redirect Pattern**: Parent route loads databases via `pcdManager.getAll()`, child route at `[databaseId]` handles feature logic. Client uses `onMount` + `localStorage` to auto-redirect to last-used database. See [packages/praxrr-app/src/routes/quality-profiles/entity-testing/+page.svelte](packages/praxrr-app/src/routes/quality-profiles/entity-testing/+page.svelte).

**PCD Cache Access**: Get cache via `pcdManager.getCache(id)`, guard against null/undefined, query via `cache.kb` (Kysely typed query builder). See [packages/praxrr-app/src/lib/server/pcd/database/cache.ts](packages/praxrr-app/src/lib/server/pcd/database/cache.ts).

**Batch-First Evaluation**: Parse all titles in one batch, extract all patterns from all CFs, match all patterns in one batch, then loop evaluation per release per CF. Avoids N+1 parser calls. See [packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts](packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts).

**Parser Graceful Degradation**: Check `isParserHealthy()` first; return degraded response with `parserAvailable: false` instead of throwing. Never 500 on parser unavailability. See [packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts](packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts).

**Score Resolution Precedence**: Specific `arr_type` score > `'all'` wildcard score > null (treated as 0). Code pattern: `cfScores?.get(arrType) ?? cfScores?.get('all') ?? null`. See [packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts](packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts) lines 78-87.

**Co-located Component Organization**: Route-specific components in `components/` subdirectory with PascalCase naming, imported via relative paths. See [packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/](packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/components/).

**Nav Registration**: Add to `NAV_REGISTRY` array in `registry.ts` with `NavItemDef` shape specifying `groupId`, `order`, `arrScope`, `iconKey`. See [packages/praxrr-app/src/lib/server/navigation/registry.ts](packages/praxrr-app/src/lib/server/navigation/registry.ts).

## Relevant Docs

**docs/plans/score-simulator/feature-spec.md**: You _must_ read this when working on any score simulator implementation task. The authoritative specification with API contract, data models, file creation/modification plan, UX workflows, edge cases, and phasing strategy.

**docs/plans/score-simulator/research-technical.md**: You _must_ read this when implementing the API endpoint or data models. Contains ready-to-use TypeScript interfaces, OpenAPI YAML schemas, and technical architecture decisions.

**docs/plans/score-simulator/research-external.md**: You _must_ read this when implementing parser integration or CF evaluation. Contains parser API contract details, condition type matching table, and scoring algorithm verified from Radarr source.

**CLAUDE.md**: You _must_ read this when working on any implementation. Contains project conventions: contract-first API, Svelte 5 no runes, path aliases, Cross-Arr Semantic Validation Policy, formatting rules.

**docs/features/entity-testing.md**: You _must_ read this when implementing the API endpoint or route structure. The closest reference feature whose evaluate pipeline is directly reused.

**docs/api/v1/schemas/entity-testing.yaml**: You _must_ read this when defining OpenAPI schemas. Contains `ParsedInfo` and `MediaType` schemas the simulator must reference.

**docs/api/errors.md**: You _must_ read this when implementing error responses. Defines `{ "error": "..." }` shape and status code semantics.

**docs/architecture/data-flow.md**: You _must_ read this when understanding the evaluation pipeline. Section 4 contains the entity testing evaluation sequence diagram directly reusable for the simulator.

**docs/features/progressive-disclosure.md**: You _must_ read this when adding disclosure section keys for advanced simulator modes.

**docs/plans/score-simulator/research-ux.md**: You _must_ read this when building the simulator UI. Contains split-pane playground patterns, score visualization approaches, accessibility requirements, and responsive design breakpoints.
