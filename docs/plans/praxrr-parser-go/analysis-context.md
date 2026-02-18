### Executive Summary

The goal is to replace the existing C#/.NET parser microservice with a Go-based drop-in that keeps the `/parse`, `/match`, `/match/batch`, and `/health` HTTP contracts intact while improving deployment (much smaller Docker image, faster startup) and preserving parser semantics through `regexp2`. Planning must focus on establishing parity (via golden fixtures), restarting the parser logic in Go with the same DTOs/caches, and sequencing build/CI updates so the TypeScript client, caches, and tooling continue to work without change.

### Architecture Context

- System Structure: A standalone parser service (currently `src/services/parser/`) remains in front of caches and TypeScript clients; the Go rewrite described in `docs/plans/praxrr-parser-go/research-technical.md` keeps that service boundary but reimplements core parsing/matching logic in `src/services/parser-go/` with `regexp2`, the stdlib HTTP server, and the same binary name.
- Data Flow: Titles enter via parser endpoints, flow through parser orchestrators (quality, title, episode, language, release-group parsers), and then feed cached results (`src/lib/server/db/queries/parsedReleaseCache.ts`/`patternMatchCache.ts`) before reaching UI workflows such as custom-format testing and regex101 evaluation, per `docs/plans/praxrr-parser-go/feature-spec.md`.
- Integration Points: The TypeScript client (`src/lib/server/utils/arr/parser/client.ts`), spawn helper (`src/lib/server/utils/parser/spawn.ts`), config (`src/lib/server/utils/config/config.ts`), and cache invalidation in `parsedReleaseCache`/`patternMatchCache` all expect the parser to behave exactly as the current service does, which is reinforced by the architecture notes in `docs/plans/praxrr-parser-go/research-architecture.md`.

### Critical Files Reference

- `docs/plans/praxrr-parser-go/feature-spec.md`: Defines API contract fidelity, cache versioning, Docker/CI expectations, and the recommended phased task breakdown.
- `docs/plans/praxrr-parser-go/research-technical.md`: Captures regex migration risks, Go module layout, `regexp2` dependency, Dockerfile replacement, release workflow changes, and test plan requirements.
- `docs/plans/praxrr-parser-go/research-recommendations.md`: Presents the alternative of porting to TypeScript/Deno, the enormous benefit of removing the microservice, and the foundation for audit/test infrastructure planning.
- `src/lib/server/utils/arr/parser/client.ts`: Central TypeScript client whose unchanged API contract must be preserved.
- `src/lib/server/db/queries/parsedReleaseCache.ts` & `patternMatchCache.ts`: Cache layers keyed by parser version that drive many cached workflows.

### Patterns to Follow

- Pattern: Drop-in Parser API Contract. Keep the same `/parse`, `/match`, `/match/batch`, and `/health` endpoints and JSON shapes so no TypeScript caller or spawn logic must change (`docs/plans/praxrr-parser-go/shared.md`, `docs/plans/praxrr-parser-go/feature-spec.md`).
- Pattern: Version-Keyed Cache Invalidation. Always bump parser version and honor `title:type + parser_version` cache keys when returning results to avoid stale cache artifacts (`docs/plans/praxrr-parser-go/shared.md`).
- Pattern: Parser Process Abstraction. Keep binary name, ports, and health format stable under `spawn.ts` orchestration.

### Cross-Cutting Concerns

- Security: `/match` must keep regex timeout protection (100 ms) and fail-closed behavior for invalid patterns.
- Performance: Maintain expected startup/memory gains while preserving matching behavior.
- Testing: Build a golden fixture suite before parser porting; current parser-specific tests are absent.

### Parallelization Opportunities

- independent work areas:
  - Test infrastructure (fixture collection, golden snapshot capture, harness setup).
  - Parser module porting by concern (quality/title/episode/language/release-group) after shared utilities.
  - HTTP server/logging and build pipeline updates.
- coordination hotspots:
  - API contract and cache version behavior across parser + TypeScript client.
  - Release workflow and Docker task changes across multiple build files.

### Implementation Constraints

- Must preserve existing endpoint contract and response shapes exactly.
- Must support all regex features in current patterns via `github.com/dlclark/regexp2`.
- Must keep runtime expectations: binary name `praxrr-parser`, `/health` payload `{status,version}`, and `PARSER_HOST`/`PARSER_PORT` compatibility.

### Planning Recommendations

- Phase 1: Build fixture/test scaffold and capture baseline parser outputs.
- Phase 2: Port parser logic and regex behavior in modular units with parity checks.
- Phase 3: Implement server layer, integrate with existing clients/caches, validate side-by-side.
- Phase 4: Cut over build/deploy pipeline and retire .NET parser assets after parity passes.
