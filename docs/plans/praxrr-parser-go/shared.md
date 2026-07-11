# Praxrr Parser Go Migration

The migration replaces the implementation inside `packages/praxrr-parser` while
preserving the private HTTP service, app client, cache, process, container, and
archive contracts around it. The Go service will use explicit contract DTOs, one
centralized regexp2 boundary, ordered domain parsers, and a standard-library
HTTP adapter with finite request/work limits. The C# service remains only as the
pinned differential oracle until parity, load, lifecycle, and artifact gates
pass; the final cutover removes all live .NET source and tooling. No application
database schema is required, but both parser caches require explicit cutover
treatment because only parsed releases are currently namespaced by parser
version.

## Relevant Files

- `packages/praxrr-parser/Program.cs`: Current composition root and version
  source.
- `packages/praxrr-parser/Endpoints/ParseEndpoints.cs`: Exact parse validation
  and response assembly.
- `packages/praxrr-parser/Endpoints/MatchEndpoints.cs`: Regex timeout,
  invalid-pattern, and batch behavior.
- `packages/praxrr-parser/Endpoints/HealthEndpoints.cs`: Stable private health
  contract.
- `packages/praxrr-parser/Models/Requests.cs`: Existing request DTO shape.
- `packages/praxrr-parser/Models/Responses.cs`: Required field/null/empty
  response semantics.
- `packages/praxrr-parser/Models/Types.cs`: Quality and revision enum/default
  contract.
- `packages/praxrr-parser/Models/Language.cs`: Ordered language names returned
  to the app.
- `packages/praxrr-parser/Parsers/Common/ParserCommon.cs`: Shared cleanup and
  extension behavior.
- `packages/praxrr-parser/Parsers/Common/RegexReplace.cs`: .NET replacement
  semantics to centralize.
- `packages/praxrr-parser/Parsers/QualityParser.cs`: Ordered
  quality/resolution/modifier/revision rules.
- `packages/praxrr-parser/Parsers/LanguageParser.cs`: Language precedence,
  casing, and duplicate behavior.
- `packages/praxrr-parser/Parsers/ReleaseGroupParser.cs`: Group extraction and
  exception cleanup.
- `packages/praxrr-parser/Parsers/TitleParser.cs`: Movie
  title/year/edition/ID/hash parsing.
- `packages/praxrr-parser/Parsers/EpisodeParser.cs`: Season/episode/date/anime
  capture logic.
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: Sole app
  client, caches, retries, enum mapping.
- `packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`: App-side parse
  contract and enum names.
- `packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`:
  Version-namespaced parse cache.
- `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`:
  Unversioned match cache cutover hazard.
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`: Adjacent binary
  startup and lifecycle.
- `packages/praxrr-app/src/hooks.server.ts`: Requires parser spawn before config
  initialization.
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`: Stable
  `PARSER_HOST`/`PARSER_PORT` URL.
- `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`:
  Legitimate batch workload consumer.
- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`:
  Parser-dependent scoring workload.
- `packages/praxrr-app/src/routes/api/v1/simulate/impact/+server.ts`:
  Partial-degradation workload.
- `packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts`: Direct `/match`
  consumer.
- `packages/praxrr-app/src/routes/api/v1/parser/health/+server.ts`: Browser-safe
  availability projection.
- `packages/praxrr-app/src/tests/routes/entityTestingEvaluateRoute.test.ts`:
  Existing parser stub contract.
- `packages/praxrr-app/src/tests/routes/simulateScoreRoute.test.ts`:
  Parse/match/cache integration coverage.
- `packages/praxrr-app/src/tests/routes/impactSimulatorRoute.test.ts`: Parser
  outage and recovery coverage.
- `deno.json`: Developer and standalone build task contract.
- `scripts/dev.ts`: Concurrent parser/app development launcher.
- `Dockerfile.parser`: Parser image build/runtime/health contract.
- `compose.yml`: Stable production parser service identity.
- `compose.dev.yml`: Development build, health dependency, and source watch.
- `.github/workflows/compatibility.yml`: Pull-request Go/parity gate
  integration.
- `.github/workflows/docker.yml`: Stable parser image publication.
- `.github/workflows/release.yml`: Five-platform adjacent parser archive
  staging.
- `ROADMAP.md`: Evidence-gated completion record for issues #1-#5.

## Relevant Patterns

**Explicit Boundary DTOs**: Preserve every emitted field and enum name; follow
the current complete response construction in
[`packages/praxrr-parser/Endpoints/ParseEndpoints.cs`](../../../packages/praxrr-parser/Endpoints/ParseEndpoints.cs).

**Single Client Boundary**: Keep runtime replacement invisible behind
[`packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`](../../../packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts);
do not add Go/C# branching to consumers.

**Ordered Rule Transliteration**: Port domain regexes in source order and
minimize every discrepancy into a fixture before changing the adapter or rule,
using
[`packages/praxrr-parser/Parsers/EpisodeParser.cs`](../../../packages/praxrr-parser/Parsers/EpisodeParser.cs)
as the highest-risk example.

**Typed Fail-Closed Integration**: Invalid/time-limited match cells remain
`false`, parser failures degrade to unavailable/null in the app, and logs retain
classified detail without request contents; mirror the graceful client boundary
in
[`packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`](../../../packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts).

**Cache Namespace by Behavior Version**: Observable parser changes must not
reuse old outputs; follow the parsed cache version pattern in
[`packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`](../../../packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts)
and extend or invalidate the match cache deliberately.

**Composition Root Owns Process State**: Environment, version, logging, signals,
and listener binding belong only in the executable layer, matching the startup
ordering enforced by
[`packages/praxrr-app/src/hooks.server.ts`](../../../packages/praxrr-app/src/hooks.server.ts).

**Stable Delivery Identity**: Implementation may change while image, DNS, port,
health path, and adjacent filenames remain stable; the current contract is
visible in [`compose.yml`](../../../compose.yml) and
[`packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`](../../../packages/praxrr-app/src/lib/server/utils/parser/spawn.ts).

**Real Artifact Smoke Tests**: Cross-compilation alone is insufficient; staged
binaries and images must start, answer health/parse/match, and terminate,
extending the matrix in
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml).

## Relevant Docs

**`docs/plans/praxrr-parser-go/feature-spec.md`**: You _must_ read this for
scope, parity, security, architecture, and issue #2-#5 exit gates.

**`docs/plans/praxrr-parser-go/research-security.md`**: You _must_ read this
before implementing regex or HTTP work limits, concurrency, logging, container,
or dependency policy.

**`docs/plans/praxrr-parser-go/research-integration.md`**: You _must_ read this
before cache, standalone, Docker, CI, release, or rollback changes.

**`docs/plans/praxrr-parser-go/research-patterns.md`**: You _must_ read this
before translating domain rules or adding Go packages/tests.

**`docs/plans/praxrr-parser-go/research-docs.md`**: You _must_ read this before
documentation and final .NET-retirement searches; preserve
`.NET-compatible regex` and historical oracle provenance.

**`CLAUDE.md`**: You _must_ read this for repository commands, conventions,
worktree rules, and required documentation synchronization.

**`ROADMAP.md`**: You _must_ read this before recording issue completion; do not
mark #1 complete before #2-#5 and all lifecycle gates are proven.

**`docs/ARCHITECTURE.md`**: You _must_ read this when changing parser component
and data-flow docs.

**`docs/CONTRIBUTING.md`**: You _must_ read this when changing contributor
prerequisites or validation commands.
