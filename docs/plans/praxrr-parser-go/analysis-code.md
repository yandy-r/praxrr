# Code Analysis

## Executive Summary

The parser migration is an in-place implementation replacement, not a new
service. The current C# package is small at its HTTP boundary but behaviorally
dense: four minimal-API routes compose about 1,500 lines of ordered .NET regular
expressions and capture-processing code. The Go code must preserve the existing
JSON shapes, enum strings, validation order, duplicate-key collapse,
null/default distinctions, rule precedence, and silent parse-failure behavior
before changing any launcher or consumer.

The safest structure is the one in the feature spec: explicit wire DTOs in
`internal/contract`, a single regexp2 compatibility boundary, one cohesive
`internal/parser` package whose files mirror the existing C# parser files, an
explicit `internal/httpserver` adapter, and a thin `cmd/praxrr-parser`
composition root. Translation should be manual and source-ordered. In
particular, regexp2 must expose repeated named captures, replacement semantics,
and timeout/error classification rather than letting each parser use the library
directly.

The SvelteKit app already has one parser client and graceful-degradation paths.
Most application callers should remain unchanged. Two integration details do
require deliberate work: the parsed release cache is version-scoped, while
`pattern_match_cache` is only keyed by title and pattern hash; and standalone
spawning currently configures the child through ASP.NET variables. Delivery work
must also replace .NET in `deno.json`, `scripts/dev.ts`, `Dockerfile.parser`,
compatibility CI, Docker publication, and the five-platform release matrix while
preserving port 5000, service names, image name, and adjacent binary filenames.

## Existing Code Structure

### C# service boundary

- `packages/praxrr-parser/Program.cs` is the composition root. It loads
  `appsettings.json`, reads `Parser:Version` with a `1.0.0` fallback,
  initializes logging, maps all endpoints, and lets ASP.NET own listener and
  lifecycle behavior.
- `Endpoints/HealthEndpoints.cs` returns `{status:"healthy",version}` from
  `GET /health`.
- `Endpoints/ParseEndpoints.cs` validates title before type, then always
  evaluates quality, languages, and release group. It branches only for movie
  title versus episode parsing and explicitly fills every response field.
- `Endpoints/MatchEndpoints.cs` implements `/match` sequentially and
  `/match/batch` with precompiled patterns plus parallel text processing. Every
  regex uses case-insensitive matching and a 100 ms dynamic timeout. Invalid and
  timed-out cells become `false` rather than request errors.
- `Models/Requests.cs`, `Responses.cs`, `Types.cs`, and `Language.cs` are the
  effective wire and domain contract. ASP.NET camel-cases record properties in
  JSON. Enum names, not enum integers, are emitted for source, modifier,
  language, and release type.

### Domain parser pipeline

- `Parsers/Common/ParserCommon.cs` owns extension removal and shared
  website/torrent cleanup. Only recognized video, `.par2`, and `.nzb` suffixes
  are removed; arbitrary two-to-four-character suffixes are preserved.
- `Parsers/Common/RegexReplace.cs` couples match detection and .NET replacement
  formatting. Its `TryReplace` mutates even when no match occurs and reports the
  pre-replacement match result.
- `Parsers/QualityParser.cs` parses revision first, then resolution, then
  follows an early-return source/modifier decision tree. Defaults are `Unknown`,
  resolution `0`, modifier `None`, revision version `1`.
- `Parsers/LanguageParser.cs` appends in three passes: full-word substring
  checks, case-sensitive abbreviation regex captures, then case-insensitive
  captures. It defaults to `Unknown`, applies special German `DL`/`ML`
  expansion, and finally de-duplicates while preserving first occurrence.
- `Parsers/ReleaseGroupParser.cs` cleans input, prefers leading anime subgroup,
  then exception groups, then the last standard release-group capture. Numeric,
  season/episode-like, and hash-like results are rejected.
- `Parsers/TitleParser.cs` rejects obfuscated names, handles reversed titles and
  Unicode brackets, cleans the title, and tries movie regexes in array order
  until one yields a valid result. It preserves acronym dots, splits alternative
  titles, and separately derives edition, hash, hardcoded subtitles, IMDb ID,
  and TMDB ID.
- `Parsers/EpisodeParser.cs` is the highest-risk port. It tries
  `ReportTitleRegex` entries in order, relies on repeated named captures to
  expand episode/absolute ranges, rejects descending ranges, distinguishes
  ambiguous dates, and computes release type from populated arrays/full-season
  state. Broad exceptions intentionally degrade to `null`.

### Application integration

- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` is the primary
  boundary. Its `ParserClient` uses `BaseHttpClient` with a 30-second timeout,
  two retries, and 500 ms retry delay. It maps wire enum strings through the
  TypeScript enums and exposes cached parse and match helpers.
- `packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts` mirrors numeric
  enum values and the app-facing result shape. These values must remain stable
  even though Go should encode names at the wire boundary.
- `parsedReleaseCache.ts` keys parsed output by `(cache_key, parser_version)`
  and removes old versions. `patternMatchCache.ts` keys match output only by
  `(title, patterns_hash)`.
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts` discovers
  `praxrr-parser[.exe]` next to the Deno executable, allocates a loopback port,
  starts the child, waits up to 10 seconds for health, streams prefixed output,
  and terminates it with the parent.
- `hooks.server.ts` dynamically imports the spawner before config
  initialization. This startup order must not change because the spawner sets
  `PARSER_HOST` and `PARSER_PORT` for the config singleton.
- Entity testing and score simulation fail closed when the parser is
  unavailable. Impact simulation preserves unrelated config/cascade results and
  returns partial parser-dependent results. The parser health route
  intentionally projects only `{parserAvailable}`.
- `routes/api/regex101/[id]/+server.ts` is an exceptional direct `/match`
  consumer and therefore a contract test target even if it is not rewritten to
  use the shared helper during this migration.

### Build and delivery integration

- `deno.json` exposes `dev:parser` and two standalone tasks with inline `dotnet`
  commands.
- `scripts/dev.ts` detects `dotnet`, starts `dotnet watch`, and otherwise starts
  only Vite.
- `Dockerfile.parser` is currently an Alpine .NET SDK-to-ASP.NET multi-stage
  build with a non-root UID/GID 1000 user, port 5000, wget health check, and
  stable parser image metadata.
- `compose.yml` consumes `ghcr.io/yandy-r/praxrr-parser:latest` as service
  `parser`; the dev compose file builds the same Dockerfile as service/hostname
  `parser-dev`. Both expose rather than publish port 5000 and gate the app on
  parser health.
- `.github/workflows/compatibility.yml` recognizes parser paths but currently
  runs only Deno app checks. `.github/workflows/docker.yml` publishes the stable
  `praxrr-parser` image. `.github/workflows/release.yml` builds self-contained
  .NET binaries for Linux amd64/arm64, macOS amd64/arm64, and Windows amd64,
  renaming them to `praxrr-parser[.exe]` beside Praxrr.

## Implementation Patterns with examples

### Explicit response construction

Mirror `ParseEndpoints.Handle` rather than relying on Go zero-value omission.
DTO fields need explicit JSON tags and must not use `omitempty`. For a series
response, movie fields are still present as `movieTitles: []`, `year: 0`,
nullable strings as `null`, and `tmdbId: 0`; for a movie, `episode` is
explicitly `null`. Initialize slices before encoding so `[]` does not drift to
`null`.

### Ordered first-success parsing

Both title parsers iterate a declaration-ordered regex array and stop on the
first regex whose captures produce a valid result. Preserve this as an ordered
slice of named rules, for example a slice of `{name, compiledPattern}` values
traversed sequentially. Do not combine patterns, sort them, or replace the loop
with a map.

### Central compatibility boundary

All parser regex compilation, match enumeration, named capture access,
replacement, dynamic timeouts, and finite static-operation/stack handling should
live in one file or subpackage under `internal/parser`. Domain files should
request operations from that wrapper and must not import regexp2 directly. The
wrapper needs operations equivalent to `.Match`, `.Matches`, group success, all
`Group.Captures`, last match/capture, case-sensitive versus ignore-case modes,
ignore-pattern- whitespace, and .NET replacement strings such as `$1 AKA $2`.

### Preserve early returns and defaults

`QualityParser.ParseQuality` is a precedence tree, not an independent set of
detections. For example, `RawHD` returns before source parsing unless BR-disk
logic matches; Bluray plus Xvid forces 480p; DVD sources force 480p; anime
fallbacks run only after normal sources. Port branch-for- branch with a result
initialized to the C# defaults.

### Preserve insertion and overwrite semantics

Language results use stable append order followed by first-occurrence
de-duplication. Match responses use dictionaries keyed by pattern and batch
results use text keys, so duplicate patterns and duplicate texts collapse with
the last assignment. A Go result map naturally collapses keys, but
compilation/evaluation must retain request order where it affects which
duplicate assignment wins and golden fixtures must assert the oracle behavior.

### Fail closed at cell and parser boundaries

Regex compile, timeout, or finite-stack failure yields `false` for only that
pattern/text cell. Domain parser failures yield `nil` and the outer parse
response retains defaults. HTTP decoding or finite-limit failures are
request-level errors. Keep these three failure layers separate and log only
route, counts, duration, and classified error metadata—not titles, regex text,
or request bodies. This deliberately improves on current C# and TypeScript logs
that include sensitive input.

### Test the real boundary

Follow the existing Deno route-test pattern: live `Deno.serve` parser stubs with
mutable version, health, parse, and batch-match responses, plus cache query
stubs. Add Go table tests beside each parser file, handler tests with
`httptest`, committed golden JSONL parity tests, fuzz seed tests, race/load
tests for batch work, and archive/container smoke tests that start the actual
artifact, exercise health/parse/match, and terminate it.

## Integration Points (create/modify/delete)

### Create

| Path                                                                                       | Purpose                                                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `packages/praxrr-parser/go.mod`, `go.sum`                                                  | Pin the module, Go toolchain policy, and `github.com/dlclark/regexp2/v2 v2.3.0`.                             |
| `packages/praxrr-parser/cmd/praxrr-parser/main.go`                                         | Version injection, address resolution, signals, server startup/shutdown, safe logging.                       |
| `packages/praxrr-parser/internal/contract/*.go`                                            | Requests, full parse/episode/revision responses, match responses, enums/names, and error DTOs.               |
| `packages/praxrr-parser/internal/parser/common.go`                                         | Extension and shared cleanup behavior from `ParserCommon.cs`.                                                |
| `packages/praxrr-parser/internal/parser/regex.go`                                          | Sole regexp2 boundary, .NET options/replacements/captures, 100 ms timeout, finite limits, classified errors. |
| `packages/praxrr-parser/internal/parser/{quality,language,release_group,title,episode}.go` | Source-aligned ordered ports of each C# parser.                                                              |
| `packages/praxrr-parser/internal/parser/parser.go`                                         | Parse orchestration and exact movie/series default assembly.                                                 |
| `packages/praxrr-parser/internal/httpserver/{handlers,server,limits}.go`                   | Four routes, explicit JSON/framework parity, body/work limits, bounded workers, deadlines, and lifecycle.    |
| `packages/praxrr-parser/internal/**/*_test.go`                                             | Table, HTTP, adversarial, race-oriented, and regression tests.                                               |
| `packages/praxrr-parser/internal/parity/*_test.go`                                         | Golden loader and optional side-by-side differential runner.                                                 |
| `packages/praxrr-parser/testdata/golden/*.jsonl`                                           | Provenance-bearing oracle requests and expected transport/semantic results.                                  |
| `packages/praxrr-parser/tools/golden/`                                                     | Reproducible pinned legacy-oracle capture/minimization tooling.                                              |
| `packages/praxrr-parser/README.md`                                                         | Contract, limits, local development, fixtures, build, and oracle provenance.                                 |

### Modify

| Path                                                                                             | Required change                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`                                  | Remove C# wording; chunk requests if measured finite limits require it; namespace match-cache behavior by parser version or explicitly clear it at cutover; retain retries/degradation and enum mapping. |
| `packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`                                   | Update runtime wording only unless parity proves a contract correction; numeric values remain fixed.                                                                                                     |
| `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts` and possibly a DB migration | Add parser-version behavior to the key/schema, or implement a tested one-time invalidation. Do not silently reuse C# match decisions after cutover.                                                      |
| `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`                                       | Pass explicit Go listener configuration such as `PARSER_ADDR=127.0.0.1:<port>`, retain discovery/readiness/output/degradation, and harden cross-platform parent-child shutdown.                          |
| `deno.json`                                                                                      | Replace dev and standalone dotnet commands with Go commands/cross-builds while retaining task names and `dist/` artifact locations.                                                                      |
| `scripts/dev.ts`                                                                                 | Detect Go, run the parser with rebuild/watch behavior, keep labeled concurrent output and server-only degradation.                                                                                       |
| `Dockerfile.parser`                                                                              | Pinned Go multi-stage build, minimal non-root runtime, explicit private `:5000` binding, stable labels/health/entrypoint.                                                                                |
| `compose.dev.yml`                                                                                | Preserve `parser-dev`, health dependency, and source watch while switching any runtime environment to the Go address contract.                                                                           |
| `.github/workflows/compatibility.yml`                                                            | Setup pinned Go; run module verification, tests, race, vet, parity/security guards, and relevant Deno checks when parser paths change.                                                                   |
| `.github/workflows/docker.yml`                                                                   | Build/smoke the Go parser image under the same published image name; retain provenance and add artifact/SBOM evidence as designed.                                                                       |
| `.github/workflows/release.yml`                                                                  | Replace .NET RID columns/setup/publish with GOOS/GOARCH cross-builds; retain five archive targets and exact adjacent names; smoke runnable target artifacts.                                             |
| `.gitignore`, `.dockerignore`, root tool-version config                                          | Ignore only generated Go artifacts/caches; do not ignore golden fixtures or module checksums.                                                                                                            |
| Parser-dependent route tests                                                                     | Add version/cache cutover, exact response-shape, outage/recovery, finite chunking, and direct `/match` coverage without weakening current partial-degradation assertions.                                |
| `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, parser operator docs, `ROADMAP.md`               | Replace runtime/build prerequisites and record evidence; mark parent #1 complete only after child #2-#5 gates pass.                                                                                      |

`compose.yml` should normally remain behaviorally unchanged: service `parser`,
image `ghcr.io/yandy-r/praxrr-parser:latest`, private port 5000, and health
dependency are deployment contracts. Modify it only if a runtime environment
variable must be made explicit, without publishing the port or renaming the
service.

### Delete at final cutover

Delete `Program.cs`, `Parser.csproj`, `Directory.Build.props`,
`appsettings.json`, and the complete `Endpoints/`, `Models/`, `Parsers/`, and
`Logging/` C# trees only after oracle fixtures, differential parity,
finite-work, artifact, and lifecycle gates are green. Then remove all live
`dotnet`, `setup-dotnet`, `DOTNET_VERSION`, `dotnet_rid`, `ASPNETCORE_*`,
`Parser.dll`, and `.NET parser` references from tasks, workflows, Dockerfiles,
source comments, and current docs. Historical oracle provenance may still
accurately state that the baseline was .NET.

## Code Conventions

- Keep package boundaries small and ownership explicit: `contract`, `parser`,
  `httpserver`, and executable composition. Avoid one package per domain parser
  unless an actual independent API emerges.
- Use standard Go formatting, table-driven tests, subtests with stable rule
  names, explicit errors, context-aware lifecycle code, and dependency injection
  for clocks/version/limits where tests require determinism.
- Retain C# rule order and recognizable pattern comments/names so review can
  compare source and port mechanically. Avoid regex cleanup or optimization
  during the parity phase.
- Use regexp2 default .NET-compatible mode only. Do not use Go `regexp`,
  ECMAScript/RE2 modes, or the regexp2 compatibility subpackage for parser
  semantics.
- Encode every contract field explicitly. Use pointers for nullable
  scalars/objects and allocated empty slices for required arrays.
- Bind loopback by default for local/standalone execution. Container
  configuration may explicitly bind `:5000` on its private network. Never make
  public binding the implicit default.
- Keep the repository's TypeScript style unchanged in touched app files: tabs,
  single quotes, no trailing commas, 100-column formatting.
- Preserve existing task names, Compose identities, image name, port, endpoint
  paths, and archive filenames even when their implementation changes.

## Dependencies and Services

- The only parser runtime dependency should be
  `github.com/dlclark/regexp2/v2 v2.3.0`; everything else can use the Go
  standard library (`net/http`, `encoding/json`, `context`, `os/signal`, `sync`,
  and testing packages). Commit both module files and run downloads read-only in
  CI.
- The parser is unauthenticated by design because provided deployments keep it
  private. Its abuse boundary is therefore listener scope plus finite request,
  item, product, concurrency, regex, and HTTP deadline limits.
- The app reaches the service through `config.parserUrl`, derived from stable
  `PARSER_HOST` and `PARSER_PORT`. The Go-specific `PARSER_ADDR` is
  process-local listener configuration and should not leak into normal app
  consumers.
- Compose service discovery (`parser`/`parser-dev`) and health-gated
  `depends_on` are live operator contracts. Docker does not publish the parser
  port.
- The release workflow is responsible for pairing each Deno target with the
  matching Go target: Linux amd64/arm64, Darwin amd64/arm64, and Windows amd64.
- The C# service remains a pinned development/test oracle only until parity is
  proven. It must not remain in shipped build, runtime, CI prerequisite, or
  contributor setup after issue #5.

## Gotchas and Warnings

- .NET repeated named captures are essential to episode ranges. Reading only the
  final regexp2 group value will silently turn multi-episode releases into
  single episodes.
- `.NET Regex.Replace` replacement syntax and backreferences are not Go string
  replacement semantics. Centralize and test `$1`, named groups, and zero-width
  behavior.
- Ignore-case, inline mode changes such as `(?-i:WEB)`,
  ignore-pattern-whitespace, lookbehind, backreferences, atomic groups, and
  Unicode casing occur in existing patterns. Any unsupported or divergent
  regexp2 case is a fixture-driven design issue, not permission to simplify a
  rule.
- `TitleParser` and `EpisodeParser` intentionally catch all parser exceptions
  and return null. Preserve external behavior while exposing safe internal
  classification for tests/metrics.
- Empty Go slices marshal as `[]`, but nil slices marshal as `null`. Maps and
  pointers have similar field-presence consequences; exact response DTO
  initialization is mandatory.
- Duplicate input strings/patterns collapse because the response is
  object-keyed. Do not redesign responses into arrays or claim duplicate
  preservation.
- Current batch C# code parallelizes over all texts. Mirroring its unbounded
  implementation is not acceptable; preserve results inside a measured supported
  envelope with bounded workers and reject one-over-limit before regex work.
- A 100 ms regexp2 timeout is dynamic match timeout, not a complete memory/CPU
  bound. Add finite stack/static-operation controls and test errors as `false`
  cells.
- `cachedParserVersion` is session-global and parsed caches are versioned, but
  match caches are not. A version bump alone does not invalidate existing match
  results.
- `parseWithCacheBatch` currently issues parallel individual `/parse` requests;
  `/match/batch` is the only batch HTTP route. Do not invent a parse-batch
  endpoint during parity work. Chunking may be needed only to respect the new
  finite concurrency/work contract.
- Current application warning logs include release titles on parse errors. New
  Go logs must never repeat that pattern, and app logging should be reviewed for
  the same disclosure requirement.
- The standalone spawner sets environment before config import and treats
  readiness failure as nonfatal. A Go launcher change that throws or imports
  config earlier would break graceful degradation.
- Windows lacks the same signal support as Unix. Archive smoke tests must prove
  parent termination does not orphan `praxrr-parser.exe`.
- Cross-compilation proves only that a binary was produced. Each runnable
  artifact and the final container must be started and queried;
  foreign-architecture artifacts still need inspection and target-runner
  evidence where native execution is unavailable.
- Do not delete `Directory.Build.props` temporarily from a task and restore it
  with `git checkout`; the final Go workflow should be non-mutating and work
  from a clean checkout.

## Task-Specific Guidance

1. **Issue #2 foundation/parity:** freeze oracle provenance first; measure
   current HTTP behavior and workload maxima; create golden request/response
   fixtures; scaffold module, contract DTOs, regex wrapper, common cleanup, HTTP
   limit policy, and compatibility CI. Include malformed JSON, wrong types,
   nulls, trailing JSON, duplicate properties, method/content-type/unknown-path
   cases, repeated captures, Unicode/Turkish-I, invalid patterns, timeouts, and
   duplicate keys.
2. **Issue #3 domain parsers:** port `QualityParser`, `LanguageParser`,
   `ReleaseGroupParser`, `TitleParser`, and `EpisodeParser` in source order.
   Keep rule tables adjacent to focused tests, name fixtures by branch/rule, and
   turn every discrepancy into a minimized committed regression before altering
   the wrapper or port.
3. **Issue #4 orchestration/HTTP:** assemble exact movie/series responses,
   implement the four stable routes, reproduce validation order/text and
   selected framework behavior, and use bounded compilation/workers with one
   collector owning result-map writes. Prove health responsiveness,
   cancellation/shutdown, no goroutine growth, and no sensitive logging under
   adversarial load.
4. **Issue #5 cutover:** bump/inject a deterministic behavior version,
   invalidate or namespace both caches, switch dev/spawn/Docker/CI/release
   paths, smoke real artifacts, update current docs and `ROADMAP.md`, then
   remove every live .NET source/tool/runtime reference. Run final repository
   searches and clean-checkout validation.
5. **Required validation evidence:** `go test ./...`, `go test -race ./...`,
   `go vet ./...`, module verification/read-only resolution, golden/differential
   parity, fuzz seeds, finite-boundary/load tests, five target builds,
   archive/container lifecycle smoke, Deno lint/check/unit/build, focused
   parser-dependent E2E, and final no-live-.NET searches. Parent issue #1 is
   complete only when all four child-issue gates and the final
   artifact/lifecycle evidence are complete.
