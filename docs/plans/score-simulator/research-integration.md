# Integration Research: Score Simulator

The score simulator requires composing four existing subsystems: parser client, CF evaluator, PCD cache, and scoring queries. All core building blocks exist and are production-tested. The primary integration work is (1) a new API endpoint that orchestrates these services for batch simulation and (2) score resolution logic that applies arr_type precedence rules from `quality_profile_custom_formats`.

## API Endpoints

### Existing Related Endpoints

- **POST /api/v1/entity-testing/evaluate** - Parses release titles and evaluates them against all CFs in a database. Returns `{ parserAvailable, evaluations[] }` where each evaluation contains `cfMatches: Record<cfName, boolean>`. This is the closest existing endpoint to what the score simulator needs; it does CF matching but does NOT resolve scores.
- **GET /api/v1/health** - Health check including parser status. Uses `isParserHealthy()`.
- **POST /api/v1/sync/preview** - Generates sync preview (different domain but similar orchestration pattern).
- **GET /api/v1/pcd/[databaseId]/snapshots** - PCD entity access pattern with databaseId param.

### Route Organization

API v1 routes live under `/packages/praxrr-app/src/routes/api/v1/`. Each directory gets a `+server.ts` with exported `GET`/`POST`/etc. handlers typed via `RequestHandler`. The evaluate endpoint demonstrates the pattern:

1. Parse request body with OpenAPI-generated types from `$api/v1.d.ts`
2. Validate input, throw `error(400, ...)` for bad requests
3. Get PCD cache via `pcdManager.getCache(databaseId)`
4. Call service functions (parser, evaluator, scoring)
5. Return `json(...)` with `satisfies` type annotation against OpenAPI schema type

Auth middleware is applied globally in `hooks.server.ts` -- API routes under `/api/` are covered by the same auth middleware as page routes. No per-route middleware beyond what SvelteKit provides.

### OpenAPI Contract

New endpoints must be defined in `packages/praxrr-api/openapi.json` first, then types generated via `deno task generate:api-types` into `packages/praxrr-app/src/lib/api/v1.d.ts`. Existing schemas to reference/extend:

- `EvaluateRequest` - `{ databaseId?: number, releases: ReleaseInput[] }`
- `EvaluateResponse` - `{ parserAvailable: boolean, evaluations: ReleaseEvaluation[] }`
- `ReleaseEvaluation` - `{ releaseId, title, parsed?, cfMatches }`
- `MediaType` - `"movie" | "series"`

## Database

### PCD Cache Tables (In-Memory SQLite)

These tables live in the in-memory PCD cache (`PCDCache`), not the app database.

#### Core Tables for Score Simulation

| Table                            | Description                             | Key Columns                                                                              |
| -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `custom_formats`                 | CF definitions                          | `id`, `name`, `description`, `include_in_rename`                                         |
| `custom_format_conditions`       | Condition metadata per CF               | `custom_format_name`, `name`, `type`, `arr_type`, `negate`, `required`                   |
| `condition_patterns`             | Regex pattern conditions                | `custom_format_name`, `condition_name`, `regular_expression_name`                        |
| `condition_languages`            | Language conditions                     | `custom_format_name`, `condition_name`, `language_name`, `except_language`               |
| `condition_sources`              | Source conditions (Bluray, WebDL, etc.) | `custom_format_name`, `condition_name`, `source`                                         |
| `condition_resolutions`          | Resolution conditions                   | `custom_format_name`, `condition_name`, `resolution`                                     |
| `condition_quality_modifiers`    | Quality modifier conditions             | `custom_format_name`, `condition_name`, `quality_modifier`                               |
| `condition_release_types`        | Release type conditions                 | `custom_format_name`, `condition_name`, `release_type`                                   |
| `condition_years`                | Year range conditions                   | `custom_format_name`, `condition_name`, `min_year`, `max_year`                           |
| `condition_sizes`                | Size range conditions                   | `custom_format_name`, `condition_name`, `min_bytes`, `max_bytes`                         |
| `condition_indexer_flags`        | Indexer flag conditions                 | `custom_format_name`, `condition_name`, `flag`                                           |
| `quality_profiles`               | Profile definitions                     | `name`, `minimum_custom_format_score`, `upgrade_until_score`, `upgrade_score_increment`  |
| `quality_profile_custom_formats` | **Score mappings**                      | PK: `(quality_profile_name, custom_format_name, arr_type)`, `score: INTEGER`             |
| `custom_format_tags`             | CF tag assignments                      | `custom_format_name`, `tag_name`                                                         |
| `regular_expressions`            | Regex definitions                       | `name`, `pattern`, `regex101_id`, `description`                                          |
| `test_entities`                  | Test movies/series for profile testing  | `type`, `tmdb_id`, `title`, `year`, `poster_path`                                        |
| `test_releases`                  | Test releases attached to entities      | `entity_type`, `entity_tmdb_id`, `title`, `size_bytes`, `languages`, `indexers`, `flags` |

#### Score Resolution Schema Detail

```sql
CREATE TABLE quality_profile_custom_formats (
    quality_profile_name VARCHAR(100) NOT NULL,
    custom_format_name VARCHAR(100) NOT NULL,
    arr_type VARCHAR(20) NOT NULL,  -- 'radarr', 'sonarr', 'all'
    score INTEGER NOT NULL,
    PRIMARY KEY (quality_profile_name, custom_format_name, arr_type),
    FOREIGN KEY (quality_profile_name) REFERENCES quality_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (custom_format_name) REFERENCES custom_formats(name) ON DELETE CASCADE ON UPDATE CASCADE
);
```

**Score resolution precedence** (implemented in `scoring/read.ts` lines 78-87):

1. Look for specific `arr_type` score (e.g., `radarr`)
2. Fall back to `arr_type = 'all'` score
3. If neither exists, score is `null` (effectively 0)

Code pattern:

```typescript
const allScore = cfScores?.get('all') ?? null;
for (const arrType of arrTypes) {
  const specificScore = cfScores?.get(arrType);
  formatScores[arrType] =
    specificScore !== undefined ? specificScore : allScore;
}
```

### App Database Tables (SQLite File)

| Table                  | Description               | Key Columns                                                        |
| ---------------------- | ------------------------- | ------------------------------------------------------------------ |
| `parsed_release_cache` | Cached parser results     | `cache_key` (title:type), `parser_version`, `parsed_result` (JSON) |
| `pattern_match_cache`  | Cached .NET regex matches | `title`, `patterns_hash` (SHA-256 prefix), `match_results` (JSON)  |

These are in the app DB (`praxrr.db`), not the PCD cache, and are accessed via sync queries (not Kysely).

## External Services

### Parser Microservice

**Location**: C# .NET 8+ service in `packages/praxrr-parser/`

**Base URL**: Configured via `config.parserUrl` (from `PARSER_HOST`/`PARSER_PORT` env vars, default `http://localhost:5000`)

**Client**: Singleton `ParserClient` extending `BaseHttpClient` with 30s timeout, 2 retries, 500ms retry delay.

#### Parser API Contract

| Endpoint       | Method | Request                                      | Response                                               |
| -------------- | ------ | -------------------------------------------- | ------------------------------------------------------ |
| `/health`      | GET    | -                                            | `{ status: string, version: string }`                  |
| `/parse`       | POST   | `{ title: string, type: "movie"\|"series" }` | `ParseResponse` (see below)                            |
| `/match`       | POST   | `{ text: string, patterns: string[] }`       | `{ results: Record<string, boolean> }`                 |
| `/match/batch` | POST   | `{ texts: string[], patterns: string[] }`    | `{ results: Record<string, Record<string, boolean>> }` |

**ParseResponse fields**: `title`, `type`, `source` (string enum), `resolution` (numeric), `modifier` (string enum), `revision` (object), `languages` (string[]), `releaseGroup`, `movieTitles`, `year`, `edition`, `imdbId`, `tmdbId`, `hardcodedSubs`, `releaseHash`, `episode` (nullable object with series-specific fields including `releaseType`).

#### Health Check Pattern

```typescript
export async function isParserHealthy(): Promise<boolean> {
  try {
    await getClient().health();
    return true;
  } catch {
    return false;
  }
}
```

Parser version is cached per session (`cachedParserVersion`). Call `clearParserVersionCache()` on parser restart.

#### Batch Processing Flow

For the score simulator, the recommended flow matches the existing evaluate endpoint:

1. **Parse titles**: `parseWithCacheBatch(items)` - handles cache hits/misses, parallel parsing of uncached items
2. **Extract patterns**: `extractAllPatterns(customFormats)` - collects all regex patterns from all CFs
3. **Match patterns**: `matchPatternsBatch(texts, patterns)` - .NET regex matching with caching (keyed by SHA-256 hash of patterns)
4. **Evaluate CFs**: Loop `evaluateCustomFormat()` per release per CF

Cache key format: `${title}:${type}` (e.g., `"Movie.Title.2024.1080p.BluRay.REMUX:movie"`)

## Internal Services

### PCD Cache Manager

**Access pattern**: `pcdManager.getCache(databaseId)` returns `PCDCache | undefined`

The `PCDCache` class wraps an in-memory SQLite database with Kysely typed query builder. Access the query builder via `cache.kb` (typed as `Kysely<PCDDatabase>`).

```typescript
// File: packages/praxrr-app/src/lib/server/pcd/database/cache.ts
class PCDCache {
  get kb(): Kysely<PCDDatabase>; // Kysely query builder
  isBuilt(): boolean;
  getRawDb(): Database | null; // Raw SQLite handle
  query<T>(sql: string, ...params): T[];
  queryOne<T>(sql: string, ...params): T | undefined;
  validateSql(sqlStatements: string[]): ValidationResult;
}
```

**Registry**: `packages/praxrr-app/src/lib/server/pcd/database/registry.ts` - simple `Map<number, PCDCache>`. `getCache(id)` returns undefined if cache not built/linked.

### CF Evaluation Pipeline

**File**: `packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`

#### `evaluateCustomFormat(conditions, parsed, title, patternMatches?)`

```typescript
export function evaluateCustomFormat(
  conditions: ConditionData[],
  parsed: ParseResult,
  title: string,
  patternMatches?: Map<string, boolean>
): EvaluationResult;
```

**Returns**: `{ matches: boolean, conditions: ConditionResult[] }`

**Matching logic** (mirrors Radarr/Sonarr):

- Conditions grouped by type (release_title, resolution, source, etc.)
- Between types: AND (every type must pass)
- Within a type: OR (any condition satisfies) UNLESS `required` flag is set, then AND
- `negate` inverts the match result before the passes check

**Condition types supported**: `release_title`, `language`, `source`, `resolution`, `quality_modifier`, `release_type`, `year`, `edition`, `release_group`, `indexer_flag` (N/A - no indexer data), `size` (N/A - no file data)

#### `extractAllPatterns(customFormats)`

```typescript
export function extractAllPatterns(
  customFormats: CustomFormatWithConditions[]
): string[];
```

Collects all unique regex patterns from pattern-based conditions across all CFs. Used as input to `matchPatternsBatch()`.

#### `getAllConditionsForEvaluation(cache)`

```typescript
// File: packages/praxrr-app/src/lib/server/pcd/entities/customFormats/conditions/read.ts
export async function getAllConditionsForEvaluation(
  cache: PCDCache
): Promise<CustomFormatWithConditions[]>;
```

Fetches ALL custom formats with ALL their conditions in optimized batch queries (10 parallel queries). Returns array of `{ name: string, conditions: ConditionData[] }`. Each condition includes type-specific data (patterns, languages, sources, etc.) assembled from the normalized condition tables.

#### `getParsedInfo(parsed)`

```typescript
export function getParsedInfo(parsed: ParseResult): ParsedInfo;
```

Converts internal `ParseResult` enums to human-readable string representation for frontend display.

### Scoring Queries

**File**: `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`

#### `scoring(cache, databaseId, profileName)`

```typescript
export async function scoring(
  cache: PCDCache,
  databaseId: number,
  profileName: string
): Promise<QualityProfileScoring>;
```

Returns scoring data for a SINGLE profile: all CFs with per-arr-type scores, profile settings (minimum_custom_format_score, upgrade_until_score, upgrade_score_increment), and tags.

#### `allCfScores(cache)`

```typescript
export async function allCfScores(cache: PCDCache): Promise<AllCfScoresResult>;
```

Returns scores for ALL profiles and ALL CFs. Structure: `{ customFormats: [{name}], profiles: [{ profileName, scores: { cfName: { radarr: number|null, sonarr: number|null } } }] }`.

**This is the function the score simulator should use** for fetching score mappings, as it provides all data needed to calculate total scores per profile per arr_type.

### Arr Type System

**File**: `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`

```typescript
export const ARR_APP_TYPES = ['radarr', 'sonarr', 'lidarr'] as const;
export type ArrAppType = 'radarr' | 'sonarr' | 'lidarr';
export type ArrType = ArrAppType | 'all'; // includes wildcard
```

Score resolution must handle `'all'` as a wildcard: a score with `arr_type='all'` applies to every app unless overridden by a specific `arr_type` score.

### Test Entities System

**File**: `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/entityTests/read.ts`

The PCD schema includes `test_entities` and `test_releases` tables designed for quality profile testing. These store pre-defined movies/series with test release titles that can be used as input to the score simulator. The `list(cache)` function returns all entities with their releases, including parsed JSON arrays for `languages`, `indexers`, and `flags`.

## Relevant Files

- `/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: Existing evaluate endpoint (reference implementation for simulator endpoint)
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`: CF evaluation engine with condition matching logic
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/conditions/read.ts`: Batch condition loading queries (`getAllConditionsForEvaluation`)
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: Parser client with caching (`parseWithCacheBatch`, `matchPatternsBatch`)
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`: Parser type definitions (ParseResult, enums)
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`: Score resolution queries (`scoring`, `allCfScores`)
- `/packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/entityTests/read.ts`: Test entity/release queries
- `/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`: PCDCache class (in-memory SQLite with Kysely)
- `/packages/praxrr-app/src/lib/server/pcd/database/registry.ts`: Cache registry (Map<id, PCDCache>)
- `/packages/praxrr-app/src/lib/server/pcd/core/manager.ts`: PCDManager with `getCache(id)` method
- `/packages/praxrr-app/src/lib/shared/pcd/display.ts`: Shared display types (ConditionData, EvaluationResult, QualityProfileScoring, etc.)
- `/packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: Arr type system and capabilities
- `/packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`: App DB cache for parsed releases
- `/packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`: App DB cache for pattern matches
- `/packages/praxrr-schema/ops/0.schema.sql`: Full PCD schema definition
- `/packages/praxrr-api/openapi.json`: OpenAPI spec (must be updated for new endpoints)
- `/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts`: Existing CF testing page (reference for server-side evaluation flow)
- `/packages/praxrr-app/src/lib/server/pcd/index.ts`: PCD public API re-exports

## Architectural Patterns

- **Contract-first API**: Define OpenAPI spec first in `packages/praxrr-api/openapi.json`, generate types via `deno task generate:api-types`, then implement. The evaluate endpoint uses `satisfies EvaluateResponse` for type safety.
- **PCD cache as query target**: All PCD entity data comes from in-memory SQLite via `cache.kb` (Kysely). Never query the app DB for PCD entity data.
- **Two-layer caching for parser**: Parse results cached in app DB keyed by `title:type` + parser version. Pattern matches cached by `title` + SHA-256 hash of patterns. Both auto-invalidate when parser version or patterns change.
- **Batch-first evaluation**: The evaluate endpoint demonstrates the pattern -- parse all titles in one batch, extract all patterns, match all in one batch, then loop evaluation. This avoids N+1 parser calls.
- **Score precedence**: Specific `arr_type` score > `'all'` wildcard score > `null` (0). Implemented consistently in both `scoring()` and `allCfScores()`.
- **Singleton services**: Parser client, PCD manager, and cache registry are all singletons initialized at startup.

## Gotchas and Edge Cases

- **`indexer_flag` and `size` conditions always return false**: The evaluator returns `{ matched: false, actual: 'N/A' }` for these because there is no indexer/file data available from title parsing alone. The score simulator will similarly miss these conditions.
- **`.NET regex vs JS regex**: Pattern conditions use`.NET regex`via the parser's`/match/batch` endpoint. The evaluator has a JS regex fallback but it may not work for .NET-specific patterns. Always prefer parser-based matching when parser is available.
- **`edition` and `release_group` pattern matching**: Unlike `release_title` patterns (matched against full title via parser), `edition` and `release_group` patterns are matched against the PARSED field value using JS regex, not the full title. The parser's pattern match endpoint is only used for `release_title` type conditions.
- **`allCfScores` returns all profiles**: No filtering by arr_type. The caller must apply arr_type filtering when calculating totals per profile.
- **Score type is `number | null`**: A null score means no score is configured for that CF/profile/arrType combo. Treat as 0 for total calculation.
- **`pcdManager.getCache()` can return undefined**: Always check. Returns undefined if database not linked, cache build failed, or database was disabled due to build error.
- **Parser unavailability degrades gracefully**: `parseWithCacheBatch` returns all nulls if parser is down. `matchPatternsBatch` returns partial results from cache if available, null otherwise. The evaluate endpoint returns `parserAvailable: false` in the response.
- **Cache key format**: `"${title}:${type}"` -- if title contains `:`, this could theoretically collide, but in practice release titles don't end with `:movie` or `:series`.
- **`test_releases` has JSON string columns**: `languages`, `indexers`, `flags` are stored as JSON strings in SQLite, parsed at read time via `JSON.parse()`.

## Configuration

- **`PARSER_HOST`** / **`PARSER_PORT`**: Parser microservice location (default `localhost:5000`)
- **`AUTH`**: Auth mode (`on`|`local`|`off`|`oidc`) -- affects all routes including API
- **`config.parserUrl`**: Computed from PARSER_HOST/PORT, used by parser client singleton

## Other Docs

- `/docs/plans/score-simulator/feature-spec.md`: Feature specification
- `/docs/plans/score-simulator/research-technical.md`: Technical research
- `/docs/plans/score-simulator/research-business.md`: Business context research
- `/docs/plans/score-simulator/research-ux.md`: UX research
- `/docs/plans/score-simulator/research-recommendations.md`: Implementation recommendations
- `/docs/plans/score-simulator/research-external.md`: External tool comparison
- `/packages/praxrr-schema/docs/structure.md`: PCD schema documentation
