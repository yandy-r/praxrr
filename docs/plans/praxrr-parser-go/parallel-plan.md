# Praxrr Parser Go Implementation Plan

The work replaces `packages/praxrr-parser` (.NET) with a Go parser service while preserving the exact HTTP and JSON contract consumed by existing TypeScript callers. The safest approach is parity-first: build fixture-driven regression coverage from current parser outputs, then port parser modules in independent slices using `regexp2`, and only then cut over runtime/build pipelines. Integration must preserve cache semantics (`parser_version`, pattern hash) and standalone spawn assumptions (`praxrr-parser` binary plus `/health`). The plan therefore separates foundation, parser implementation, and cutover so high-risk compatibility concerns are validated before deployment changes.

## Critically Relevant Files and Documentation

- /packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts: Parser HTTP contract and cache orchestration behavior.
- /packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts: Shared parser helper exports used across server routes.
- /packages/praxrr-app/src/lib/server/utils/parser/spawn.ts: Parser process discovery, startup, and health readiness.
- /packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts: Version-keyed parse cache behavior.
- /packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts: Pattern hash cache behavior for batch matching.
- /packages/praxrr-parser/Program.cs: Existing parser bootstrap and endpoint registration baseline.
- /packages/praxrr-parser/Endpoints/ParseEndpoints.cs: Existing `/parse` request/response semantics.
- /packages/praxrr-parser/Endpoints/MatchEndpoints.cs: Existing `/match` and `/match/batch` fail-closed semantics.
- /packages/praxrr-parser/Endpoints/HealthEndpoints.cs: Existing health response contract.
- /Dockerfile.parser: Parser container build definition to migrate from .NET to Go.
- /docs/api/v1/openapi.yaml: Canonical parser endpoint contract reference.
- /docs/plans/praxrr-parser-go/feature-spec.md: Migration constraints, risks, and expected outcomes.
- /docs/plans/praxrr-parser-go/research-technical.md: Go architecture details and regex inventory context.

## Implementation Plan

### Phase 1: Parity Foundation and Go Skeleton

#### Task 1.1: Build parser fixture corpus and golden outputs Depends on [none]

**READ THESE BEFORE TASK**

- /docs/plans/praxrr-parser-go/feature-spec.md
- /packages/praxrr-parser/Endpoints/ParseEndpoints.cs
- /packages/praxrr-parser/Endpoints/MatchEndpoints.cs

**Instructions**

Files to Create

- /packages/praxrr-parser-go/testdata/fixtures.json
- /packages/praxrr-parser-go/testdata/golden-parse.json
- /packages/praxrr-parser-go/testdata/golden-match.json

Files to Modify

- (none)

Create a representative fixture set (movies, episodes, anime, edge cases) and capture baseline outputs from the current parser for both parse and match behavior. Record fixture generation assumptions and edge-case categories so later tasks can enforce parity and avoid undocumented drift.

#### Task 1.2: Scaffold Go parser module and base models Depends on [none]

**READ THESE BEFORE TASK**

- /docs/plans/praxrr-parser-go/research-technical.md
- /packages/praxrr-parser/Models/Requests.cs
- /packages/praxrr-parser/Models/Responses.cs

**Instructions**

Files to Create

- /packages/praxrr-parser-go/go.mod
- /packages/praxrr-parser-go/main.go
- /packages/praxrr-parser-go/models/models.go

Files to Modify

- (none)

Initialize the Go module with required dependencies (`regexp2`) and create DTOs that match existing JSON contract field names and nullable behavior. Keep `main.go` minimal but wired for future server/bootstrap injection; update fixtures only if model-shape validation reveals missing required cases.

#### Task 1.3: Implement parity test harness for golden validation Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- /packages/praxrr-parser-go/testdata/golden-parse.json
- /packages/praxrr-parser-go/testdata/golden-match.json
- /packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts

**Instructions**

Files to Create

- /packages/praxrr-parser-go/internal/testutil/golden.go
- /packages/praxrr-parser-go/parser/parity_test.go

Files to Modify

- /packages/praxrr-parser-go/go.mod

Build reusable test helpers that load fixtures and compare Go parser results against golden snapshots. Enforce strict comparison for endpoint payload shape and fail-closed match semantics so later parser-port tasks can validate compatibility continuously.

#### Task 1.4: Port shared parser utilities and regex helpers Depends on [1.2, 1.3]

**READ THESE BEFORE TASK**

- /packages/praxrr-parser/Parsers/ParserCommon.cs
- /packages/praxrr-parser/Parsers/Common/ParserCommon.cs
- /packages/praxrr-parser/Models/Types.cs
- /docs/plans/praxrr-parser-go/research-technical.md

**Instructions**

Files to Create

- /packages/praxrr-parser-go/parser/common.go
- /packages/praxrr-parser-go/parser/types.go

Files to Modify

- /packages/praxrr-parser-go/models/models.go

Implement shared parsing primitives (normalization, revision parsing, helper regex wrappers) before domain parser ports. Ensure helper behavior aligns with existing edge-case handling and leaves clear extension points for title, episode, quality, language, and release-group modules.

### Phase 2: Core Parser and HTTP Surface

Tasks `2.1` through `2.4` are intentionally parallel once `1.4` is complete.

#### Task 2.1: Port quality parser with parity checks Depends on [1.4]

**READ THESE BEFORE TASK**

- /packages/praxrr-parser/Parsers/QualityParser.cs
- /packages/praxrr-parser-go/parser/common.go
- /packages/praxrr-parser-go/parser/parity_test.go

**Instructions**

Files to Create

- /packages/praxrr-parser-go/parser/quality.go
- /packages/praxrr-parser-go/parser/quality_test.go

Files to Modify

- /packages/praxrr-parser-go/parser/parity_test.go

Port quality source/resolution/modifier extraction using `regexp2` and verify all quality-focused fixtures pass. Keep field mapping and enum serialization identical to existing parser outputs.

#### Task 2.2: Port language and release-group parsers Depends on [1.4]

**READ THESE BEFORE TASK**

- /packages/praxrr-parser/Parsers/LanguageParser.cs
- /packages/praxrr-parser/Parsers/ReleaseGroupParser.cs
- /packages/praxrr-parser-go/parser/parity_test.go

**Instructions**

Files to Create

- /packages/praxrr-parser-go/parser/language.go
- /packages/praxrr-parser-go/parser/releasegroup.go

Files to Modify

- /packages/praxrr-parser-go/parser/parity_test.go

Implement language and release-group detection with equivalent regex behavior, including known special cases. Expand parity fixtures for multilingual and bracketed release naming edge cases where needed.
Minimum required edge-case classes:

- multilingual token combinations (`DL`, `ML`, dual-language tags)
- bracket/brace wrapped release-group names
- conflicting language indicators that must resolve to `Unknown` or `Original`
- titles with no explicit release group

#### Task 2.3: Port movie title parser Depends on [1.4]

**READ THESE BEFORE TASK**

- /packages/praxrr-parser/Parsers/TitleParser.cs
- /packages/praxrr-parser-go/parser/common.go
- /packages/praxrr-parser-go/parser/parity_test.go

**Instructions**

Files to Create

- /packages/praxrr-parser-go/parser/title.go
- /packages/praxrr-parser-go/parser/title_test.go

Files to Modify

- /packages/praxrr-parser-go/parser/parity_test.go

Port movie parsing logic (title candidates, year, edition, IDs, hash handling) with the same precedence and normalization rules as .NET. Update parity tests with title-centric fixtures to catch subtle regex-precedence regressions.

#### Task 2.4: Port episode parser Depends on [1.4]

**READ THESE BEFORE TASK**

- /packages/praxrr-parser/Parsers/EpisodeParser.cs
- /packages/praxrr-parser-go/parser/common.go
- /packages/praxrr-parser-go/parser/parity_test.go

**Instructions**

Files to Create

- /packages/praxrr-parser-go/parser/episode.go
- /packages/praxrr-parser-go/parser/episode_test.go

Files to Modify

- /packages/praxrr-parser-go/parser/parity_test.go

Port series parsing logic (season/episode/range/daily/date parsing and release type inference) with strict parity for ambiguous date behavior and daily patterns. Ensure edge-case fixtures around separators and lookaround-heavy regexes are covered.

#### Task 2.5: Compose parse orchestrator and match engine Depends on [2.1, 2.2, 2.3, 2.4]

**READ THESE BEFORE TASK**

- /packages/praxrr-parser/Endpoints/ParseEndpoints.cs
- /packages/praxrr-parser/Endpoints/MatchEndpoints.cs
- /packages/praxrr-parser-go/models/models.go

**Instructions**

Files to Create

- /packages/praxrr-parser-go/parser/parser.go
- /packages/praxrr-parser-go/parser/match.go

Files to Modify

- /packages/praxrr-parser-go/models/models.go

Wire domain parsers into unified parse and match orchestration. Preserve timeout behavior, invalid-pattern handling, and response shaping expected by current client-side callers and cache layers.

#### Task 2.6: Implement HTTP handlers and service routing Depends on [2.5]

**READ THESE BEFORE TASK**

- /packages/praxrr-parser/Program.cs
- /packages/praxrr-parser/Endpoints/HealthEndpoints.cs
- /packages/praxrr-parser-go/main.go

**Instructions**

Files to Create

- /packages/praxrr-parser-go/server/handlers.go
- /packages/praxrr-parser-go/server/router.go

Files to Modify

- /packages/praxrr-parser-go/main.go

Expose `/parse`, `/match`, `/match/batch`, and `/health` with existing request/response semantics and consistent status/error behavior. Keep version reporting and health payload contract identical to avoid downstream compatibility breaks.

### Phase 3: Runtime and Delivery Cutover

Tasks `3.1`, `3.2`, and `3.3` are intentionally parallel once `2.6` is complete.

#### Task 3.1: Align parser runtime integration in server utilities Depends on [2.6]

**READ THESE BEFORE TASK**

- /packages/praxrr-app/src/lib/server/utils/parser/spawn.ts
- /packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts
- /packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts

**Instructions**

Files to Create

- /packages/praxrr-app/src/lib/server/utils/arr/parser/goParityNotes.md

Files to Modify

- /packages/praxrr-app/src/lib/server/utils/parser/spawn.ts
- /packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts

Adjust runtime integration only where needed for Go binary packaging while preserving API behavior and cache flow. Document any unavoidable contract-adjacent differences and keep `PARSER_HOST`/`PARSER_PORT` behavior unchanged.

#### Task 3.2: Migrate parser container build and compose wiring Depends on [2.6]

**READ THESE BEFORE TASK**

- /Dockerfile.parser
- /compose.dev.yml
- /compose.yml

**Instructions**

Files to Create

- /packages/praxrr-parser-go/Dockerfile

Files to Modify

- /Dockerfile.parser
- /compose.dev.yml

Switch parser image build to Go multi-stage output and ensure compose health checks still target equivalent endpoints. Keep development and production runtime topology unchanged from caller perspective.
`/compose.yml` is validation-only in this task: verify no production service-name, parser-port, or health-check contract changes are required; if any are required, create a follow-up task instead of expanding this one.

#### Task 3.3: Update CI and release pipeline for Go parser artifacts Depends on [2.6]

**READ THESE BEFORE TASK**

- /.github/workflows/docker.yml
- /.github/workflows/release.yml
- /deno.json

**Instructions**

Files to Create

- /packages/praxrr-parser-go/README.md

Files to Modify

- /.github/workflows/docker.yml
- /.github/workflows/release.yml

Shift parser build/release jobs from .NET to Go, including multi-arch artifact generation for `praxrr-parser`. Keep published artifact naming stable so existing deployment and spawn assumptions remain valid.
Expected artifacts and tags:

- `praxrr-parser-linux-amd64`
- `praxrr-parser-linux-arm64`
- `praxrr-parser-darwin-amd64`
- `praxrr-parser-darwin-arm64`
- `ghcr.io/yandy-r/praxrr-parser:<version>`

#### Task 3.4: Finalize cutover, docs, and legacy parser retirement Depends on [3.1, 3.2, 3.3]

**READ THESE BEFORE TASK**

- /README.md
- /docs/ARCHITECTURE.md
- /scripts/dev.ts

**Instructions**

Files to Create

- /docs/plans/praxrr-parser-go/cutover-checklist.md

Files to Modify

- /README.md
- /docs/ARCHITECTURE.md

Document final cutover status, update architecture references to Go parser implementation, and list explicit legacy .NET parser cleanup steps. Do not remove legacy parser files until parity and release artifacts are confirmed in CI.
Retirement gate checklist (all required before removals):

- parity harness green for parse and match fixture suites
- release workflow publishes all expected Go artifacts
- compose and standalone startup both pass parser health checks
  Retirement targets once gates pass:
- `/packages/praxrr-parser/Program.cs`
- `/packages/praxrr-parser/Endpoints/ParseEndpoints.cs`
- `/packages/praxrr-parser/Endpoints/MatchEndpoints.cs`

## Advice

- Keep endpoint and payload compatibility as the top acceptance criterion; optimization goals are secondary.
- Treat `parser_version` behavior as a migration contract, not just metadata, because cache invalidation depends on it.
- Avoid coupling pipeline migration to unfinished parser modules; cut over build/release only after parity harness is green.
- The highest hidden risk is regex behavior drift on edge-case patterns, so expand fixtures before touching integration files.
- Preserve `spawn.ts` assumptions (`praxrr-parser` binary and health readiness) unless you intentionally plan a broader runtime contract change.
