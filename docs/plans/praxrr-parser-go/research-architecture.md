# Architecture Research: praxrr-parser-go

## System Overview

The existing parser lives in `/src/services/parser` as a minimal ASP.NET Core 8 HTTP microservice (endpoints defined in `Endpoints/*.cs`, models in `Models/*.cs`, shared parsing logic in `Parsers/*`, and logging in `Logging/*`), while the SvelteKit frontend consumes it through the TypeScript client at `/src/lib/server/utils/arr/parser`. The Go rewrite described in `docs/plans/praxrr-parser-go/research-technical.md` aims to preserve the same `/parse`, `/match`, `/match/batch`, and `/health` contracts, reimplementing regex-heavy logic and request/response models in Go while keeping the HTTP signature and caching behavior intact.

## Relevant Components

- `/src/services/parser`: Current .NET parser service (endpoints, models, regex parsers, logging) that the Go version must replace feature-for-feature.
- `/src/lib/server/utils/arr/parser/client.ts`: TypeScript HTTP client mirroring the parser API; all new Go code must stay binary-compatible so these calls continue to work without change.
- `/src/lib/server/utils/parser/spawn.ts`: Parser binary auto-spawner used at startup (`hooks.server.ts` pulls it in), so the Go binary will need the same name and signaling for `PARSER_HOST`/`PARSER_PORT`.
- `/src/lib/server/db/queries/parsedReleaseCache.ts` & `/src/lib/server/db/queries/patternMatchCache.ts`: Cache layers that key on parser version, so the Go parser must bump its version string and honor the same keys when returning parse/match responses.
- `/docs/plans/praxrr-parser-go/research-technical.md`: Research/spec file that outlines the Go module layout, regex/library decisions (`regexp2`), build/distribution changes (Dockerfile, GitHub workflows, `deno.json` tasks), and keeps the new architecture aligned with the existing service expectations.

## Data Flow

Titles enter via `POST /parse` or `/match` and are routed through the parser’s orchestrator (currently in `Parsers/*`, proposed Go packages `parser/title.go`, etc.) that normalize strings, apply regex matchers, and construct `ParseResponse`/`MatchResponse` DTOs; these responses propagate back to the SvelteKit UI through `src/lib/server/utils/arr/parser/client.ts`, which in turn feeds UI pages like `quality-profiles/entity-testing` and custom format testing that rely on cached results stored by the SQLite queries in `src/lib/server/db/queries/parsedReleaseCache.ts` and `patternMatchCache.ts`. Health and version information emitted by `/health` is also consumed by the same client (e.g., `src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts`) and is tied to deployment tooling (Docker compose, release workflows) via `PARSER_HOST`/`PARSER_PORT` configuration in `src/lib/server/utils/config/config.ts`.

## Integration Points

New Go code will plug into the same HTTP contract as the .NET service so that `/src/lib/server/utils/arr/parser/client.ts`, `/src/lib/server/utils/parser/spawn.ts`, and the cache invalidation logic in `src/lib/server/db/queries/*` continue to work unchanged; deployment hooks (Dockerfile, `compose.dev.yml`, `compose.yml`, and `/deno.json` tasks described in `docs/plans/praxrr-parser-go/research-technical.md`) will just point to the new Go binary and the existing `praxrr-parser` release artifact. GitHub workflows (`.github/workflows/docker.yml` and `release.yml`) will need to build the Go binary (per the documented matrix changes) but keep the rest of the integration untouched.

## Key Dependencies

`github.com/dlclark/regexp2` (required to mirror .NET regex features such as lookbehinds, named groups, inline modifiers, and timeouts), Go standard library components like `net/http` (server/mux), `encoding/json` (serialization), `log/slog` (structured logging) as outlined in the research doc, and `encoding/json`/`runtime` utilities for batch/match orchestration; existing TypeScript utilities rely on the equivalent Go behavior via `/src/lib/server/utils/arr/parser` and the caches at `/src/lib/server/db/queries/parsedReleaseCache.ts` and `patternMatchCache.ts`.
