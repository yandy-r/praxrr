# Architecture Research: praxrr-parser-go

## Executive Summary

The parser is a small HTTP service with a disproportionately broad delivery
surface. Its implementation is isolated under `packages/praxrr-parser`, but its
observable contract is consumed by SvelteKit routes, two SQLite caches,
standalone process bootstrap, local development tasks, Compose health ordering,
the parser container, and five-platform release archives. The Go migration must
therefore replace the implementation in place while preserving the service
identity (`praxrr-parser`), four routes, port `5000`, app-facing
`PARSER_HOST`/`PARSER_PORT` configuration, adjacent executable names, and JSON
semantics.

The target package graph should remain deliberately narrow:

```text
cmd/praxrr-parser
        |
        v
internal/httpserver ----------> internal/contract
        |                              ^
        v                              |
internal/parser -----------------------+
        |
        v
regexp2/v2 compatibility boundary
```

`internal/parser` owns domain rules and the single .NET-compatible regex
adapter; `internal/httpserver` owns wire behavior, finite request limits,
bounded batch scheduling, and lifecycle; `internal/contract` owns explicit DTOs
whose null, zero, empty, and field-presence behavior is testable. The C# service
must remain available as an oracle through issues #2-#4, but it is not a
permanent runtime option. Issue #5 is a one-way cutover: switch every launcher,
container, CI, archive, and documentation surface, prove the built artifacts,
then remove the C# and .NET inputs.

## Architecture Overview

### Current runtime topology

```text
Browser / server-rendered pages
        |
        v
SvelteKit simulator and entity-testing routes
        |
        v
packages/praxrr-app parser client (30 s timeout, retry policy)
        |                         |
        |                         +--> SQLite parsed_release_cache
        |                         +--> SQLite pattern_match_cache
        v
http://${PARSER_HOST}:${PARSER_PORT}
        |
        +--> GET  /health
        +--> POST /parse
        +--> POST /match
        +--> POST /match/batch
        |
        v
ASP.NET minimal API --> quality/language/group/title/episode parsers
                    --> System.Text.RegularExpressions
```

The app URL is assembled once by
`packages/praxrr-app/src/lib/server/utils/config/config.ts` and defaults to
`localhost:5000`.
`packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` provides the
single client boundary. It maps string enum names returned by the service into
the numeric TypeScript enums in
`packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`; unknown names
fall back to `Unknown`/`None`. This mapping makes response names, not only JSON
field types, part of the compatibility boundary.

### Target runtime topology

The topology and network boundary stay the same. Only the process behind the
four endpoints changes:

```text
SvelteKit parser client
        |
        v
Go net/http adapter
        |
        +--> explicit request/response DTOs
        +--> parse orchestrator
        |       +--> common normalization
        |       +--> quality and revision
        |       +--> languages
        |       +--> release group
        |       +--> movie title OR episode
        |
        +--> bounded regex match scheduler
                +--> one regexp2 configuration boundary
```

The Go service should be deployable in three verified modes without consumer
branching:

1. A developer process started by `deno task dev`, `deno task dev:parser`, or
   directly from the Go module.
2. The private Compose service and `ghcr.io/yandy-r/praxrr-parser` image,
   explicitly listening on container port `5000` but not publishing that port in
   provided Compose files.
3. An adjacent `praxrr-parser` or `praxrr-parser.exe` child in standalone
   archives, bound to a dynamically selected loopback port.

## Component Map

| Component                            | Current source                                                                                                                                   | Target responsibility / planning consequence                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process entry and route registration | `packages/praxrr-parser/Program.cs`                                                                                                              | Move to `packages/praxrr-parser/cmd/praxrr-parser/main.go`; own config, safe logging, signal handling, deterministic build version, and graceful shutdown.                                                                                  |
| HTTP contract                        | `packages/praxrr-parser/Endpoints/HealthEndpoints.cs`, `MatchEndpoints.cs`, `ParseEndpoints.cs`                                                  | Move to `packages/praxrr-parser/internal/httpserver/`; reproduce route, validation order/text, statuses, selected headers, malformed-request behavior, and duplicate/null semantics rather than inheriting `net/http` defaults.             |
| Wire/domain DTOs                     | `packages/praxrr-parser/Models/Requests.cs`, `Responses.cs`, `Types.cs`, `Language.cs`                                                           | Move explicit JSON DTOs and enums to `packages/praxrr-parser/internal/contract/`; response fields must not disappear through accidental `omitempty`.                                                                                        |
| Domain parsing                       | `packages/praxrr-parser/Parsers/Common/`, `QualityParser.cs`, `LanguageParser.cs`, `ReleaseGroupParser.cs`, `TitleParser.cs`, `EpisodeParser.cs` | Translate in dependency and rule order into one cohesive `packages/praxrr-parser/internal/parser/` package. Keep regex order, captures, defaults, and known quirks recognizable for review.                                                 |
| Regex behavior                       | `System.Text.RegularExpressions` calls throughout endpoints and parsers                                                                          | Centralize all `github.com/dlclark/regexp2/v2` use in `internal/parser/regex.go`; default .NET mode only, with common option, timeout, capture, replacement, and error mapping policy.                                                      |
| App client                           | `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` and `types.ts`                                                                   | No runtime-specific branch. Preserve the same endpoints and response names; add request chunking only if measured supported limits require it.                                                                                              |
| Parser availability facade           | `packages/praxrr-app/src/routes/api/v1/parser/health/+server.ts`                                                                                 | Must continue returning the app-level `{ parserAvailable }` view; service migration is intentionally hidden from browser consumers.                                                                                                         |
| Parse cache                          | `packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`                                                                            | `/health.version` is a persistent cache namespace. A deterministic cutover version and cache invalidation test are architectural release requirements.                                                                                      |
| Match cache                          | `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`                                                                             | Keyed by title plus a sorted-pattern hash, not parser version. Strict regex parity is required because a runtime change alone does not invalidate these rows.                                                                               |
| Standalone bootstrap                 | `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`, imported first by `packages/praxrr-app/src/hooks.server.ts`                          | Preserve adjacent names and pre-config startup ordering. Switch child listener configuration to a Go-native explicit address, test free-port readiness and termination on every archive platform, and retain graceful app degradation.      |
| Developer launcher                   | `scripts/dev.ts`, `deno.json`                                                                                                                    | Replace `dotnet` discovery/watch/publish with pinned Go commands while retaining task names, labeled output, port `5000`, and server-only fallback behavior where intended.                                                                 |
| Container                            | `Dockerfile.parser`                                                                                                                              | Replace .NET SDK/ASP.NET stages with a pinned Go builder and minimal non-root runtime; keep image name, port, health route, explicit container bind, and build metadata.                                                                    |
| Compose                              | `compose.yml`, `compose.dev.yml`                                                                                                                 | Keep parser service names/DNS, `expose: 5000`, `depends_on: condition: service_healthy`, and parser source rebuild watch. Do not introduce a host-published parser port.                                                                    |
| Pull-request CI                      | `.github/workflows/compatibility.yml`                                                                                                            | It currently treats parser changes as app changes but runs only app check/build. Add dedicated Go/module/parity/security gates rather than relying on the existing Deno job.                                                                |
| Container publication                | `.github/workflows/docker.yml`                                                                                                                   | Matrix already publishes `praxrr-parser`; preserve tags and provenance while making the Docker build produce and smoke-test the Go service. Current configured platform is `linux/amd64`.                                                   |
| Release archives                     | `.github/workflows/release.yml`                                                                                                                  | Replace `.NET` setup/RIDs and `dotnet publish` with pinned Go cross-builds for Linux x64/arm64, macOS x64/arm64, and Windows x64. Continue staging `praxrr-parser[.exe]` next to the app binary and add real-binary smoke/inspection gates. |
| Local standalone builds              | `deno.json` tasks `build:standalone` and `build:standalone:windows`                                                                              | Stop deleting/restoring tracked `Directory.Build.props`; compile Go directly below repository `dist/`, preserving output names and enforcing `check:dist-paths`.                                                                            |
| Operator/developer documentation     | `README.md`, `docs/site/src/content/docs/app/development.md`, `configuration.md`, `custom-formats.md`, `troubleshooting.md`                      | Update implementation/toolchain descriptions only after command and deployment behavior exists; preserve public configuration semantics.                                                                                                    |
| Roadmap                              | `ROADMAP.md`                                                                                                                                     | Mark #1/#2-#5 complete only after parity, delivery, review, CI, and artifact evidence exists.                                                                                                                                               |

## Data Flow

### Health and cache identity

1. `getParserVersion()` calls `GET /health` through the singleton client and
   caches the returned version in process memory.
2. `parseWithCache()` and `parseWithCacheBatch()` use that version alongside
   `title:type` as the `parsed_release_cache` key.
3. A version change makes old parse rows unreachable and
   `cleanupOldCacheEntries()` can delete them.
4. Therefore, the Go build must provide a deterministic version and issue #5
   must prove the intended cache transition. Reusing an old version while any
   result differs can serve stale C# output under the Go runtime.

### Parse requests

1. Simulator/entity-testing code checks parser health and calls the app parser
   facade.
2. The client sends `{ title, type }` to `POST /parse`.
3. The service validates title before media type.
4. Quality, language, and release-group parsing always run; `type` then selects
   movie-title or episode parsing.
5. The service emits the complete response shape. The app converts enum strings
   to numeric TypeScript enums and persists successful results where caching is
   used.
6. Service failure is converted to `null`/unavailable by cache helpers so
   unrelated Praxrr behavior can continue.

### Match requests

1. `matchPatterns()` sends one text and many patterns to `POST /match`.
2. `matchPatternsBatch()` hashes the sorted patterns, loads cached rows, and
   sends only uncached texts to `POST /match/batch`.
3. The service compiles each unique pattern and evaluates the text-pattern
   product. Invalid or timed-out cells become `false`; valid siblings remain in
   the successful response.
4. Response objects collapse duplicate pattern and text keys according to the
   existing dictionary behavior. The Go implementation and any client-side chunk
   merge must preserve this behavior.
5. Newly computed results are persisted by text and pattern hash. Unlike parse
   cache rows, these entries are not namespaced by parser version, making zero
   unexplained regex drift a cutover gate.

### Standalone process lifecycle

1. `hooks.server.ts` dynamically imports `spawn.ts` before importing and
   initializing the configuration singleton.
2. Outside Docker, and only when `PARSER_HOST` is absent, `spawn.ts` searches
   beside the app executable for `praxrr-parser` and `praxrr-parser.exe`.
3. It reserves a free loopback port, starts the child, sets
   `PARSER_HOST/PARSER_PORT`, and polls `/health` for up to 10 seconds.
4. Readiness failure does not abort app startup. Signal handlers attempt to
   terminate the child; Windows has different signal support and therefore needs
   a real archive lifecycle test.
5. The Go listener contract must be available before `spawn.ts` is switched;
   otherwise config initialization freezes a URL for a child that cannot bind to
   the selected port.

### Container and release delivery

```text
source + pinned toolchain
        |
        +--> Dockerfile.parser --> health-smoked image --> GHCR tags/provenance
        |
        +--> release matrix --> praxrr-parser[.exe]
                                  + app executable/static assets
                                  --> platform archive
```

Archive correctness is more than cross-compilation: each staged binary must be
named correctly, executable on its target, start on an explicit address, answer
health plus representative parse/match calls, and terminate with its parent. The
parser container likewise needs a health and API smoke test, non-root assertion,
and confirmation that provided Compose topology remains private.

## Dependencies

### Runtime and code dependencies

- Go toolchain pinned consistently in `go.mod`/toolchain policy, CI, developer
  tooling, and `Dockerfile.parser`.
- `github.com/dlclark/regexp2/v2` pinned in `packages/praxrr-parser/go.mod` and
  `go.sum`. It is the only acceptable parser regex engine because the rule set
  uses .NET-specific constructs and capture behavior.
- Go standard `net/http`, `encoding/json`, process signal, and context packages
  for the service boundary and lifecycle.
- No database dependency in the parser. Both SQLite caches remain app-owned.
- The C#/.NET runtime is a temporary test/oracle dependency through parity
  development, then must be absent from live source, builds, containers, and
  workflows after issue #5.

### Dependency direction

- `contract` must not depend on HTTP, parser implementations, environment, or
  app TypeScript.
- `parser` may depend on `contract` and the centralized regexp2 adapter, but not
  on HTTP, global process configuration, Docker, or SQLite.
- `httpserver` depends on parser-facing interfaces and contract DTOs. Define
  test seams at this consumer boundary so handler tests do not require a child
  process.
- `cmd/praxrr-parser` is the composition root. It is the only layer that should
  bind process environment, build identity, logging, and operating-system
  signals to the HTTP service.
- The SvelteKit app depends only on the existing HTTP contract; it must not
  import Go-generated models or detect which runtime answers the request.

### Verification dependencies

- Golden fixtures depend on a pinned C# source commit, runtime patch, OS,
  culture/globalization, time zone, and parser configuration.
- Domain parser work depends on the shared regex/common behavior and fixture
  reader from issue #2.
- HTTP differential tests depend on completed domain orchestration from issue #3
  and must compare both services on separate loopback ports.
- Integration retirement depends on zero unexplained parity differences plus
  resource-limit, race, load, and lifecycle evidence. C# deletion before these
  gates would remove the authoritative local oracle.

## Integration Points

### Application integrations

- `packages/praxrr-app/src/lib/server/utils/config/config.ts`: stable service
  URL construction from `PARSER_HOST` and `PARSER_PORT`.
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: all service
  calls, enum conversion, retry/timeout policy, caching orchestration, and
  graceful failure.
- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`,
  `simulate/impact/+server.ts`, and `entity-testing/evaluate/+server.ts`: batch
  parse/match consumers with large legitimate workloads that must inform
  finite-limit measurements.
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts`
  and quality-profile/simulator page servers: health-gated interactive
  consumers.
- `packages/praxrr-app/src/routes/api/v1/parser/health/+server.ts`: browser-safe
  availability projection.
- `packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts`: direct `/match`
  integration that must remain covered when auditing consumers.

### Build and operations integrations

- `deno.json` and `scripts/dev.ts`: discoverable local task contract and
  concurrent app/parser development.
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts` and
  `hooks.server.ts`: standalone child discovery, listener selection, readiness,
  and shutdown.
- `Dockerfile.parser`, `compose.yml`, and `compose.dev.yml`: parser image,
  service DNS, private networking, health dependency, and source-watch rebuild.
- `.github/workflows/compatibility.yml`: pull-request validation entry point.
- `.github/workflows/docker.yml`: GHCR publication and provenance.
- `.github/workflows/release.yml`: five target archives and adjacent child
  binary staging.
- `.gitignore` and `.dockerignore`: remove .NET build exclusions only after
  adding appropriately scoped Go build/cache exclusions without hiding golden
  fixtures or module sums.

## Architectural Constraints

1. **Behavioral translation, not redesign.** Endpoint paths, validation order
   and text, status codes, selected headers, field presence, null/empty/default
   distinctions, enums, duplicate-key collapse, regex results, and parser rule
   precedence are compatibility requirements.
2. **One regex authority.** Parser semantics must not use Go `regexp`, regexp2
   RE2/ECMAScript modes, or scattered regexp2 configuration. Compile, match,
   capture, replacement, timeout, stack/error, and logging decisions belong in
   one adapter.
3. **Finite unauthenticated work.** The service is unauthenticated. Body bytes,
   item counts and lengths, text-pattern product, request concurrency, regex
   backtracking, static parser operations, and server deadlines must be finite,
   measured against real consumer maxima, rejected before expensive work, and
   tested at the boundary.
4. **Bounded concurrency.** `/match/batch` cannot translate the current
   `Parallel.ForEach` into a goroutine per text-pattern cell. Use bounded
   workers, compile unique patterns once, and serialize or otherwise safely own
   result-map writes. `/health` must remain responsive at the maximum supported
   workload.
5. **Stable deployment identity.** Retain `PARSER_HOST`, `PARSER_PORT`, port
   `5000`, Compose names/DNS, `ghcr.io/yandy-r/praxrr-parser`, and
   `praxrr-parser[.exe]`. A Go-native `PARSER_ADDR` may control the
   child/service listener; `ASPNETCORE_URLS` is transitional only and should not
   survive the completed cutover without explicit compatibility evidence.
6. **Private by default.** Standalone binds loopback. The container explicitly
   binds all interfaces only inside its private network. Provided Compose files
   continue to use `expose`, not `ports`, for the parser.
7. **Cache-aware versioning.** `/health.version` is part of behavior and build
   architecture. It must be deterministic, intentionally changed or retained,
   and tested against parse and match cache realities.
8. **Graceful optionality.** Parser unavailability must not prevent Praxrr
   startup or unrelated work. Startup/readiness failures, request failures, and
   child death need safe classification without logging release titles,
   patterns, or bodies.
9. **Artifact fidelity.** Cross-build success alone is insufficient. Release
   archives and images must be inspected and smoke tested as delivered.
10. **Clean one-way retirement.** Completion requires no shipped task, workflow,
    container stage, executable path, configuration, or current documentation to
    require .NET. Historical fixture provenance may retain explicit legacy
    references.
11. **Repository build policy.** Generated parser and app outputs stay under
    repository-root `dist/`; validation includes `deno task check:dist-paths`,
    and build tasks must not delete/restore tracked files as the current .NET
    standalone commands do.

## Parallelization Implications

The architecture supports parallel work only after shared contracts are fixed.
Parallel branches must not independently invent DTO serialization, regex
options, limits, versioning, or fixture formats.

### Issue #2: foundation and oracle

After a single provenance/fixture schema and compatibility boundary are agreed,
these tracks can proceed concurrently:

- oracle HTTP/domain corpus capture and reproducibility tooling;
- explicit contract/enums and golden fixture loader;
- regex inventory plus centralized regexp2 adapter and adversarial seeds;
- Go toolchain/module/CI scaffolding and baseline build tasks;
- measurement of real app batch cardinalities and payload sizes for limit
  selection.

They converge on one gate: reproducible oracle fixtures, a single regex API,
finite documented limits, and passing module/unit/race/vet/security checks.

### Issue #3: domain parsers

Quality/revision, language, release group, movie title, and episode work can be
assigned separately only after common cleanup and regex/capture behavior are
stable. Merge order must respect shared rule dependencies:

```text
common + regex
    +--> quality/revision
    +--> language
    +--> release group
    +--> movie title
    +--> episode
            |
            v
       parse orchestration
```

Each track should own disjoint source and focused fixtures, but all must run the
full golden suite because precedence and shared regex behavior create semantic
coupling. Refactoring shared utilities during parallel domain ports should be
serialized through one owner.

### Issue #4: HTTP and orchestration

HTTP contract tests, bounded batch scheduling, server lifecycle/security, and
parse orchestration can begin from interfaces, but final behavior depends on
every issue #3 parser. Differential replay, overload/health responsiveness,
malformed transport cases, and full response-shape checks form the convergence
gate. App-client chunking, if measurements require it, depends on the chosen
limits and duplicate-collapse merge contract and therefore cannot be designed
independently.

### Issue #5: integration and retirement

Once the Go command and listener contract are stable, independent file groups
can be prepared in parallel:

- developer tasks and `scripts/dev.ts`;
- standalone spawn/lifecycle integration;
- parser Dockerfile and Compose watch/health topology;
- compatibility, Docker publication, and release archive workflows;
- operator/developer documentation and final `ROADMAP.md` evidence.

The irreversible cutover is necessarily serialized:

1. Select deterministic version/build identity and verify cache behavior.
2. Switch and smoke each launcher and delivery surface while the oracle remains
   available.
3. Run the complete parity, resource, app, container, archive, and
   clean-checkout gates.
4. Record known-good rollback image/archive identifiers and checksums.
5. Delete C# source, project/config files, .NET build/container/workflow inputs,
   and transitional ASP.NET listener handling.
6. Audit current code, tasks, workflows, images, docs, and artifacts for live
   .NET dependencies; then update roadmap and issue evidence.

This ordering allows broad parallel implementation without making the oracle,
wire contract, cache identity, or final release state race between owners.
