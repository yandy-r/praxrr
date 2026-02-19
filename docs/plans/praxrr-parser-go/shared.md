# Praxrr Parser Go

`praxrr-parser-go` is a drop-in parser service migration that keeps the existing HTTP contract while replacing the current .NET parser implementation with a Go service centered on `regexp2` parity. The integration surface is already stable in the SvelteKit backend through `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`, parser process management in `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`, and cache layers in `packages/praxrr-app/src/lib/server/db/queries/*cache*.ts`. Feature work should preserve endpoint behavior (`/parse`, `/match`, `/match/batch`, `/health`), version-based cache invalidation, and existing `PARSER_HOST`/`PARSER_PORT` configuration plumbing. The technical approach is to keep transport and orchestration unchanged, swap parser internals and build/deploy artifacts, and validate parity against existing parser semantics.

## Relevant Files

- /packages/praxrr-parser/Program.cs: Current parser app bootstrap and endpoint registration baseline.
- /packages/praxrr-parser/Endpoints/ParseEndpoints.cs: Existing `/parse` contract and request validation behavior.
- /packages/praxrr-parser/Endpoints/MatchEndpoints.cs: Existing `/match` and `/match/batch` timeout and result semantics.
- /packages/praxrr-parser/Endpoints/HealthEndpoints.cs: Health payload shape consumed by clients and health checks.
- /packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts: Main TypeScript parser client and API contract dependency.
- /packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts: Cache-backed parser orchestration and consumer-facing parser helpers.
- /packages/praxrr-app/src/lib/server/utils/parser/spawn.ts: Binary auto-spawn and parser environment wiring in non-Docker runtime.
- /packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts: Parse-result cache keyed by parser version.
- /packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts: Pattern-match cache keyed by title and pattern hash.
- /packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts: Parser-backed regex test evaluation and cache integration path.
- /packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts: Parser usage in custom-format batch evaluation flow.
- /docs/plans/praxrr-parser-go/research-technical.md: Current implementation-specific architecture and migration details.

## Relevant Tables

- `parsed_release_cache`: Cached parse output with parser-version invalidation.
- `pattern_match_cache`: Cached pattern match maps for batch evaluation reuse.
- `regex101_cache`: Cached regex101 payloads augmented by parser match behavior.

## Relevant Patterns

**Drop-in Parser API Contract**: Keep endpoint paths and JSON shapes identical so existing consumers do not change. See [`packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`](packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts).

**Version-Keyed Cache Invalidation**: Parse cache rows are invalidated through parser version changes during migration cutover. See [`packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`](packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts).

**Parser Process Abstraction**: Runtime parser process management is isolated behind a spawn utility that should remain stable while implementation changes underneath. See [`packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`](packages/praxrr-app/src/lib/server/utils/parser/spawn.ts).

**Fail-Closed Match Semantics**: Pattern compile/timeouts resolve to deterministic false-style match outcomes instead of crashing higher-level flows. See [`packages/praxrr-parser/Endpoints/MatchEndpoints.cs`](packages/praxrr-parser/Endpoints/MatchEndpoints.cs).

## Relevant Docs

**`docs/ARCHITECTURE.md`**: You _must_ read this when working on parser placement, service boundaries, and runtime architecture.

**`docs/api/v1/openapi.yaml`**: You _must_ read this when working on parser endpoint and payload contract fidelity.

**`docs/plans/praxrr-parser-go/feature-spec.md`**: You _must_ read this when working on migration scope, parity constraints, and non-functional targets.

**`docs/plans/praxrr-parser-go/research-technical.md`**: You _must_ read this when working on Go package layout, regex strategy, and build/deploy updates.

**`docs/plans/praxrr-parser-go/research-recommendations.md`**: You _must_ read this when sequencing implementation phases and handling key migration risks.
