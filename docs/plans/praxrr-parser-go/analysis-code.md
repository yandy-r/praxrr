### Executive Summary

The parser migration stays within the existing HTTP/caching surface so the Go binary can be swapped without touching most of the frontend stack. The TypeScript client centralizes `/parse`, `/match`, `/match/batch`, health, and cache helpers while spawn/process orchestration and version-keyed caches isolate most impact to parser-local tooling and environment wiring.

### Related Components

- `/src/lib/server/utils/arr/parser/client.ts:6`: Central HTTP client and cache orchestration entry point.
- `/src/lib/server/utils/parser/spawn.ts:1`: Auto-spawn, health wait, and env wiring for parser process.
- `/src/lib/server/db/queries/parsedReleaseCache.ts:1`: Parse cache keyed by parser version.
- `/src/lib/server/db/queries/patternMatchCache.ts:1`: Pattern match cache keyed by title/pattern hash.
- `/src/services/parser/Endpoints/MatchEndpoints.cs:16`: Existing fail-closed match behavior and timeout semantics.
- `/docs/plans/praxrr-parser-go/shared.md:3`: Canonical migration constraints and critical file list.

### Implementation Patterns

**Parser client + cache relay**: `ParserClient` wraps parser endpoints; helper functions handle caching and fallback behavior.

- Example: `/src/lib/server/utils/arr/parser/client.ts:75`
- Apply to: backend integration, cache orchestration, migration stability

**Version-keyed parse cache**: Cache combines `title:type` and parser version to invalidate stale entries after parser upgrades.

- Example: `/src/lib/server/utils/arr/parser/client.ts:225`
- Apply to: cache invalidation, cutover safety

**Pattern hash cache strategy**: Batch matching uses deterministic hash of sorted patterns with cache-first lookup.

- Example: `/src/lib/server/utils/arr/parser/client.ts:357`
- Apply to: regex testing, batch evaluation flows

**Fail-closed regex semantics**: Invalid/timeout regex evaluations return deterministic false outcomes.

- Example: `/src/services/parser/Endpoints/MatchEndpoints.cs:16`
- Apply to: parser parity, safety, predictable API behavior

**Parser process abstraction**: Runtime parser process control is isolated under spawn utility and env propagation.

- Example: `/src/lib/server/utils/parser/spawn.ts:1`
- Apply to: runtime deployment, standalone mode compatibility

### Integration Points

#### Files to Create

- `/src/services/parser-go/main.go`: Go service entrypoint and app bootstrap.
- `/src/services/parser-go/server/handlers.go`: Endpoint handlers for `/parse`, `/match`, `/match/batch`, `/health`.
- `/src/services/parser-go/parser/parser.go`: Top-level parser orchestration.
- `/src/services/parser-go/parser/common.go`: Shared parser utilities and regex helpers.
- `/src/services/parser-go/models/models.go`: Request/response DTOs and enum serialization.

#### Files to Modify

- `/src/lib/server/utils/parser/spawn.ts`: Ensure binary resolution and process invocation remain correct for Go artifact.
- `/Dockerfile.parser`: Replace .NET build/runtime with Go multi-stage image.
- `/.github/workflows/docker.yml`: Switch parser build steps and artifact paths to Go.
- `/.github/workflows/release.yml`: Publish Go parser binary assets.
- `/deno.json`: Update parser tasks to build/test Go service.

### Conventions

- naming: Keep existing repo naming conventions for TS files (`camelCase.ts`) and clear package names in Go.
- error handling: Preserve existing tolerant/fail-closed behavior in client-facing parser helpers.
- testing: Add regression tests from golden fixtures before and during parser porting.

### Gotchas and Warnings

- Parser version and health behavior drive many cache and readiness paths; contract drift here has high blast radius.
- Pattern cache assumptions depend on stable match response shape.
- Spawn logic assumes binary naming/location conventions in standalone mode.
- Regex timeout behavior must remain equivalent to current endpoint semantics.

### Task Guidance by Area

- database: Keep `parsed_release_cache`, `pattern_match_cache`, and `regex101_cache` contracts stable; preserve cleanup/invalidation behavior.
- api: Maintain endpoint paths, payload shape, and fail-closed behavior expected by parser client and routes.
- ui: No direct UI changes expected; avoid introducing parser response shape changes that leak upstream.
