# Integration Research: praxrr-parser-go

## API Endpoints

### Existing Related Endpoints

- POST `/parse`: Runs quality, language, release-group parsers, then dispatches to either movie (`TitleParser`) or series (`EpisodeParser`) logic; defined in `packages/praxrr-parser/Endpoints/ParseEndpoints.cs` and wired by `packages/praxrr-parser/Program.cs`.
- POST `/match`: Validates `text` and `patterns`, compiles each pattern with `RegexOptions.IgnoreCase` + 100 ms timeout, and returns `{ results: Record<pattern, boolean> }`; implementation lives in `packages/praxrr-parser/Endpoints/MatchEndpoints.cs`.
- POST `/match/batch`: Pre-compiles patterns (`RegexOptions.Compiled`) and evaluates them in parallel via `Parallel.ForEach`, mirroring the single-match endpoint’s timeout/error handling before returning nested results; see `MatchEndpoints.cs`.
- GET `/health`: Returns `{ status: "healthy", version }` for health checks; mapped in `packages/praxrr-parser/Endpoints/HealthEndpoints.cs` and invoked from `parseWithCacheBatch` plus Docker healthchecks described in `compose.dev.yml`.

### Route Organization

The parser is a minimal ASP.NET Core app (`packages/praxrr-parser/Program.cs`) that loads `appsettings.json`, initializes logging, and mounts endpoint handlers from `packages/praxrr-parser/Endpoints/{Parse,Match,Health}Endpoints.cs`. Each endpoint is a single handler with no additional middleware beyond the defaults provided by `WebApplication`. Client services in the SvelteKit app talk to these endpoints via `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` and the higher-level wrappers in `packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts`.

## Database

### Relevant Tables

- `parsed_release_cache`: caches `/parse` responses keyed by `"{title}:{type}"` plus the parser version; see migration `packages/praxrr-app/src/lib/server/db/migrations/021_create_parsed_release_cache.ts`.
- `pattern_match_cache`: stores `/match/batch` results keyed by `title` and `patterns_hash` to avoid recomputation; defined in `packages/praxrr-app/src/lib/server/db/migrations/023_create_pattern_match_cache.ts`.
- `regex101_cache`: persists regex101 responses so the UI can reuse the parser-augmented data without refetching; defined in `packages/praxrr-app/src/lib/server/db/migrations/017_create_regex101_cache.ts`.

### Schema Details

- `parsed_release_cache`: columns `cache_key` (PK, `<title>:<type>`), `parser_version` (invalidates stale rows), `parsed_result` (JSON string of `ParseResult`), `created_at`. Indexes on `parser_version` and `created_at` support cleanup queries. Accessed via `packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts` for `get`, `set`, `deleteOldVersions`, and stats used by `parseWithCache*`.
- `pattern_match_cache`: columns `title`, `patterns_hash`, `match_results` (JSON `{ pattern: boolean }`), `created_at`; composite PK `(title, patterns_hash)` ensures multiple pattern snapshots don’t collide. Indexes on `patterns_hash` and `created_at` back queries in `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`, which supplies `getBatch`, cached inserts (`setBatch`), and cleanup helpers.
- `regex101_cache`: columns `regex101_id` (PK), `response` (cached JSON), `fetched_at`. Queries in `packages/praxrr-app/src/lib/server/db/queries/regex101Cache.ts` are used by `packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts` to short-circuit external fetches.

## External Services

- `regex101.com`: The endpoint `packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts` fetches regex data (via `https://regex101.com/api/regex/{id}`), reruns each unit test through `/match` so results reflect the parser’s `.NET` regex engine, and caches the augmented response.
- GitHub Container Registry (`ghcr.io/yandy-r/praxrr-parser:v2`): Referenced in `compose.yml`/`Dockerfile.parser` for production deployments; the parser rewrite must continue exposing port 5000 with the same `/health` path so compose health checks and `services.parser.depends_on.condition: service_healthy` keep working.
- Local parser binary (spawned by `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`): Auto-spawns the `praxrr-parser` binary when not running in Docker, reads its `/health` endpoint, and supplies `PARSER_HOST`/`PARSER_PORT` to the running app—this process communicates over HTTP just like the Dockerized parser.

## Internal Services

- `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: Calls `parseWithCacheBatch` + `matchPatternsBatch` before evaluating custom formats via `packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`; depends on parser endpoints and the caches above.
- Custom format / quality-profile testing pages: `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts` and `packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts` call `parse()`/`isParserHealthy()` from `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`.
- Regex101 API: `packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts` performs remote fetch and uses the parser’s `/match` endpoint to compute actual/pass for unit tests.
- Parser client + caches: `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` orchestrates HTTP calls (via `BaseHttpClient`), caching logic, parser version storage, parser health detection, and integrating with `parsed_release_cache`/`pattern_match_cache`. All higher-level services rely on these exports.

## Configuration

- Environment variables `PARSER_HOST` and `PARSER_PORT` are consumed by `packages/praxrr-app/src/lib/server/utils/config/config.ts` to build `parserUrl` (`http://{PARSER_HOST}:{PARSER_PORT}`), the same values set by the parser spawner (`packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`) or Docker compose.
- The spawned parser process (currently the .NET binary) expects `ASPNETCORE_URLS`/`ASPNETCORE_ENVIRONMENT`; the Go rewrite must continue listening on the same host/port so `spawn.ts` can set `PARSER_HOST`/`PARSER_PORT` without further changes.
- Docker compose files (`compose.dev.yml` and `compose.yml`) rely on the parser exposing `/health` on port 5000 and set `PARSER_HOST=parser`, `PARSER_PORT=5000` for the main app’s environment.
