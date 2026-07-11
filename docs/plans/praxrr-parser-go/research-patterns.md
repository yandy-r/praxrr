# Praxrr Parser Go Migration — Repository Pattern Research

## Executive Summary

The Go parser should be an in-place behavioral port, not a parallel product or
an API redesign. The repository already exposes a stable parser identity at four
layers:

- `packages/praxrr-parser/Endpoints/*.cs` defines the HTTP paths, validation
  order, error text, and response construction.
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` defines the
  real consumer contract, including enum-name conversion, a 30-second request
  budget, retry behavior, graceful `null` degradation, and parser-version cache
  namespacing.
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`, `scripts/dev.ts`,
  and `deno.json` define local and standalone process conventions.
- `Dockerfile.parser`, `compose.yml`, `compose.dev.yml`, and
  `.github/workflows/{compatibility,docker,release}.yml` define the deployed
  image, port, health check, archive names, and platform matrix.

The implementation should preserve those boundaries while adopting the
repository's existing Go-tooling profile. Put the nested module at
`packages/praxrr-parser`, keep the executable name `praxrr-parser`, use a small
`cmd` plus `internal` layout, and make the C# service the temporary fixture
oracle. The port should retain ordered rules, explicit defaults, and fail-closed
domain parsing. Tests should follow the repository's existing table/fixture and
live HTTP-stub style while adding Go-native table tests, `httptest`, race tests,
fuzz seeds, golden JSONL, and cross-build/container smoke gates.

## Existing Patterns

### 1. The parser contract is explicit and small

`packages/praxrr-parser/Program.cs` is a minimal composition root. It reads the
parser version, initializes logging, maps three endpoint groups, and runs the
server. The endpoint registration pattern is direct:

- `HealthEndpoints.Map` registers `GET /health`.
- `ParseEndpoints.Map` registers `POST /parse`.
- `MatchEndpoints.Map` registers `POST /match` and `POST /match/batch`.

The Go command should mirror this separation: configuration and process
lifecycle in `cmd/praxrr-parser/main.go`, route construction in
`internal/httpserver`, and all parser behavior in `internal/parser`. It should
not move parsing into handlers or introduce a framework whose implicit defaults
make the wire contract harder to control.

`packages/praxrr-parser/Endpoints/ParseEndpoints.cs` also establishes the exact
orchestration order:

1. Reject blank title.
2. Reject missing or unsupported type.
3. Parse quality.
4. Parse languages.
5. Parse release group.
6. Dispatch explicitly to movie-title or episode parsing.
7. Construct every response field with deliberate zero, empty, or null values.

That order is observable. The Go service should preserve it in a pure service
method and use the HTTP layer only for decode, validation, status, and encode.

### 2. Wire defaults are deliberately different from internal optional data

`packages/praxrr-parser/Models/Responses.cs` initializes collection fields to
empty lists and revision version to `1`. `ParseEndpoints.cs` then makes movie
and series defaults explicit:

- Movie: `movieTitles` is `[]` on a miss, `year` and `tmdbId` are `0`, and
  `episode` is `null`.
- Series: `movieTitles` is `[]`; movie-only scalar fields use their current
  null/zero values; `episode` is either a fully populated object or `null`.
- Episode number collections are always arrays, not omitted properties.
- Quality source/modifier, languages, and release type are serialized as enum
  names, while resolution is numeric.

`packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` independently
declares the same response shape and maps string enum names through the numeric
enums in `types.ts`. Unknown names deliberately fall back to `Unknown` or
`None`. Go DTOs therefore need explicit JSON tags and must not use `omitempty`.
Keep wire DTOs in `internal/contract`; do not expose internal parser structs
directly when nullability or enum representation differs.

### 3. Domain parsing is ordered, regex-driven, and fail-closed

The current parser is closer to an ordered compatibility engine than a generic
parser library:

- `Parsers/QualityParser.cs` normalizes underscores, parses revision state, then
  uses early returns to preserve source/modifier precedence. Bluray, remux,
  BR-DISK, WebDL, WebRip, HDTV, DVD, CAM, TS, TC, and anime fallbacks overlap;
  their order is behavior.
- `Parsers/LanguageParser.cs` runs case-sensitive abbreviation detection and
  general language detection separately, applies special `DL`/`ML` German rules,
  then calls `Distinct().ToList()`. This preserves first-seen order while
  removing later duplicates.
- `Parsers/ReleaseGroupParser.cs` applies shared substitutions and cleanup,
  tries anime extraction first, then exact and general exceptions, then uses the
  last ordinary release-group match and rejects known invalid groups.
- `Parsers/TitleParser.cs` iterates `ReportMovieTitleRegex` in declaration order
  and returns the first successfully parsed result. Alternate titles, bracket
  cleanup, edition, IDs, hardcoded subtitles, and release hashes are
  post-processing on that selected match.
- `Parsers/EpisodeParser.cs` similarly iterates `ReportTitleRegex` in order,
  depends on repeated named captures for season/episode arrays, and returns
  `null` on rejected hashes, invalid ranges, invalid dates, or unexpected
  exceptions.
- `Parsers/Common/ParserCommon.cs` centralizes file-extension allowlists and
  shared website/torrent cleanup. `RemoveFileExtension` removes only known
  video/usenet suffixes and preserves unknown extensions.
- `Parsers/Common/RegexReplace.cs` combines match detection with replacement;
  `TryReplace` mutates even when it reports whether a match existed.

The Go port should translate these branches and regex arrays closely enough to
review beside the C# oracle. A map-driven rules engine, reordered table, or
deduplicating set is unsafe unless the golden/differential suite proves exact
equivalence.

### 4. Regex failures are isolated at the smallest useful unit

`packages/praxrr-parser/Endpoints/MatchEndpoints.cs` uses case-insensitive .NET
regexes and a 100 ms timeout. `/match` converts invalid patterns and timeout
errors to `false` without failing the request. `/match/batch` compiles patterns
once, represents invalid compiled entries as absent, and returns `false` per
affected text-pattern cell. Duplicate pattern keys and duplicate text keys
collapse through dictionary assignment.

The Go adapter should be the only importer of `regexp2/v2`. It must centralize
option mapping, timeout classification, capture access, all-match iteration,
replacement semantics, and rune-versus-.NET string offsets. Static parser
regexes should fail during tests/startup if the port is invalid; caller patterns
should fail closed to `false`. Batch concurrency must remain bounded and use a
single owner for result-map writes rather than translating `Parallel.ForEach`
into one unbounded goroutine per text.

### 5. The TypeScript client treats availability as optional but version as data

`packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` extends the
shared `BaseHttpClient` with:

- `timeout: 30000`, `retries: 2`, and `retryDelay: 500`;
- typed methods for `/health`, `/parse`, `/match`, and `/match/batch`;
- one lazy singleton based on `config.parserUrl`;
- a session-cached parser version;
- version-keyed parsed-release caching;
- `null` results and warning logs when the parser is unavailable.

The health version is therefore a cache namespace, not decorative metadata. The
Go binary should expose a deterministic build-injected version with a stable
development fallback, and the cutover should intentionally decide whether to
bump it. The Go migration must not require client branching or a second base
URL.

### 6. Standalone spawn has an adjacent-binary convention

`packages/praxrr-app/src/lib/server/utils/parser/spawn.ts` finds `praxrr-parser`
or `praxrr-parser.exe` next to the Praxrr executable, chooses a free loopback
port, starts the child, streams labeled stdout/stderr, sets
`PARSER_HOST`/`PARSER_PORT` before config initialization, waits up to 10 seconds
for `/health`, and terminates the child with the parent. It deliberately allows
the app to continue when readiness fails.

The current child receives `ASPNETCORE_URLS` and `ASPNETCORE_ENVIRONMENT`.
During expansion, Go may accept the narrow existing `ASPNETCORE_URLS` forms as a
rollback aid, but the launcher should move to one native address variable
atomically. Preserve loopback binding for standalone use, the binary names,
output labels, readiness polling, graceful degradation, and Windows signal
caveat.

`scripts/dev.ts` uses the same yellow `[parser]` label and concurrently streams
the parser and Vite server. It currently probes `dotnet --version` and falls
back to server-only development. Replace that probe/command with the pinned Go
toolchain and a repository task; retain the labeled streams, concurrent
lifecycle, fixed port `5000`, and optional-parser behavior.

### 7. Container identity is stable while the implementation is replaceable

`Dockerfile.parser` currently uses a two-stage build, an explicit
`PARSER_PROJECT_DIR`, dependency-first copy for cache reuse, a non-root
`parser:parser` user, port `5000`, and an HTTP health check. The runtime image
is published as `ghcr.io/yandy-r/praxrr-parser` by
`.github/workflows/docker.yml`.

The Go Dockerfile should preserve:

- multi-stage dependency caching (`go.mod`/`go.sum` before source);
- the `praxrr-parser` image and OCI labels;
- a non-root UID/GID 1000 runtime;
- internal port `5000` and `GET /health` health check;
- the existing Compose service names (`parser`, `parser-dev`) and app-side
  `PARSER_HOST`/`PARSER_PORT` values.

Use a pinned Go builder, `CGO_ENABLED=0`, and a minimal runtime that still
contains the health-check mechanism and required CA/time-zone data. Do not
silently remove the health command by selecting a scratch image without an
equivalent check strategy.

### 8. CI uses path-scoped gates and explicit platform matrices

`.github/workflows/compatibility.yml` already routes changes under
`packages/praxrr-parser/**` into `app_paths`, then runs Deno type checks and a
production SvelteKit build. Parser changes also trigger when
`Dockerfile.parser`, `scripts/dev.ts`, `deno.json`, or release/docker workflows
change. Extend this focused gate with Go setup and parser checks rather than
creating an unrelated workflow with different path semantics.

`.github/workflows/release.yml` explicitly packages:

- Linux x64 and arm64;
- macOS x64 and arm64;
- Windows x64;
- `praxrr-parser` on Unix and `praxrr-parser.exe` on Windows.

The matrix separates archive platform naming, Deno target, Vite platform, and
binary extension. Replace the `dotnet_rid` column with `GOOS`/`GOARCH`, but
retain archive names and stage the parser at the same path. Add an archive smoke
step that extracts each artifact and exercises the staged parser binary where
the runner can execute it; at minimum validate cross-built names and formats for
non-native targets.

`.github/workflows/docker.yml` builds app and parser images through one matrix
and attaches metadata/provenance. Preserve the parser matrix entry and add a
container health/smoke gate before considering the cutover complete.

### 9. Existing app tests prefer real boundaries with controlled substitutes

`packages/praxrr-app/src/tests/routes/entityTestingEvaluateRoute.test.ts` and
`impactSimulatorRoute.test.ts` demonstrate the parser integration-test style:

- Set `PARSER_HOST`/`PARSER_PORT` before dynamically importing config consumers.
- Start a real `Deno.serve` HTTP stub on a dedicated port.
- Return explicit JSON response fixtures with all parser fields.
- Toggle health and version at runtime.
- Stub cache query methods while retaining their versioned key behavior.
- Restore patched functions and shut down resources explicitly.

This pattern should remain for app-consumer tests. Go handler tests should use
`httptest` and an interface defined by `httpserver` only where it makes handler
substitution useful. Cross-runtime tests should use real subprocesses on
allocated ports and capture raw HTTP details separately from semantic JSON.

`scripts/test.ts` provides discoverable aliases over the default Deno suite and
sets `APP_BASE_PATH` consistently. Add root tasks such as `test:parser`,
`check:parser`, and `build:parser`; do not hide all Go validation behind a
one-off CI shell block.

### 10. A repository Go lint profile already exists

`scripts/go-tools.sh` generates `.golangci.yml` with a five-minute timeout,
tests enabled, zero issue caps, and the following selected linters:

- `errcheck`
- `gofmt`
- `goimports`
- `gosimple`
- `govet`
- `ineffassign`
- `staticcheck`
- `typecheck`
- `unused`

It also uses the repository-wide generated/build/cache exclusions and relaxes
`errcheck` only for `_test.go`. Generate the parser module's config from this
script rather than inventing a second lint policy. `mise.toml` currently pins
only Node, so the Go migration must add and align the chosen Go patch with
`go.mod`, its `toolchain` directive, Docker, and Actions.

## Naming and Structure Conventions

### Recommended module layout

```text
packages/praxrr-parser/
  go.mod
  go.sum
  .golangci.yml
  cmd/praxrr-parser/
    main.go
  internal/contract/
    requests.go
    responses.go
    domain.go
  internal/parser/
    service.go
    regex.go
    common.go
    quality.go
    language.go
    releasegroup.go
    title.go
    episode.go
  internal/httpserver/
    handler.go
    handler_test.go
  testdata/
    parity/
    regex/
```

Use `praxrr-parser` for the command because that is the distributed artifact.
Use `contract` for wire DTOs, `parser` for the cohesive domain engine, and
`httpserver` for transport behavior. Avoid generic packages named `util`,
`common`, `models`, `types`, or `api` when the narrower ownership name is
available. A `common.go` file inside the cohesive `parser` package is acceptable
because it does not create a generic package boundary.

Keep exports minimal. The command composes the server; `httpserver` consumes a
narrow parsing/matching interface if needed for handler tests; parser helper
functions and regex adapters remain unexported. Define interfaces at the
consumer, matching the repository's preference for concrete modules until a real
substitution boundary exists.

### File and identifier naming

- Go file names should be lowercase and role-specific (`releasegroup.go`,
  `handler_test.go`), following `gofmt`/`goimports` output.
- Preserve wire JSON names exactly (`releaseGroup`, `movieTitles`, `imdbId`,
  `isRepack`, `absoluteEpisodeNumbers`).
- Preserve enum wire names exactly as declared by C# and consumed by `types.ts`;
  Go constant spelling is internal and must not leak through automatic integer
  JSON encoding.
- Preserve environment names `PARSER_HOST` and `PARSER_PORT` on the app side.
  Use one explicitly documented native server-address variable for the Go
  process rather than proliferating host/port aliases.
- Preserve Docker service/image and release binary names.

## Error Conventions

There are three distinct error classes and they should not be collapsed:

1. **HTTP contract errors**: decode, shape, method, media type, and validation
   errors return the oracle status/body/header behavior. Validation text from
   `ParseEndpoints.cs` and `MatchEndpoints.cs` is exact contract data.
2. **User regex errors**: invalid pattern, timeout, or bounded-stack failure is
   a `false` result for that pattern/cell; valid siblings still succeed.
3. **Domain misses/internal parser exceptions**: movie/episode data is absent,
   not an HTTP 500. The C# title and episode parsers catch broadly and return
   `null`; the Go port should narrow recoverable errors where possible but
   preserve the observable fail-closed result.

Normal runtime failures should return errors rather than panic. Panic is
appropriate only for invalid static parser regexes or impossible initialization
that must prevent serving. Wrap errors with operation context, but do not expose
internal error strings in contract responses unless the oracle does.

Resource-limit rejections are a fourth, intentionally new boundary. They must be
derived from measured repository/UI workloads, checked before regex work, and
assigned explicit tested responses. They must not masquerade as regex
non-matches or silently reject legitimate current batches.

## Logging Conventions

The current parser uses source-tagged logs (`Health`, `Match`, `Parse`,
`Startup`, `Docker`) and structured metadata for successful parse/startup
events. The TypeScript client also uses `source` plus a `meta` object through
the central logger. Preserve the useful shape while simplifying implementation:

- Use a standard structured logger or `log/slog` owned by the command and
  injected into `httpserver`; avoid a mutable global singleton like the legacy
  `Log` class.
- Keep stable component/source fields and structured parse summaries.
- Log startup version, listen address, timezone, and hostname once.
- Log invalid patterns and timeouts with bounded/sanitized metadata; do not log
  full arbitrary titles, regex bodies, request bodies, secrets, or unbounded
  arrays by default.
- Do not log routine `/health` traffic at info level.
- Preserve labeled `[parser]` streaming in `scripts/dev.ts` and `spawn.ts`;
  service log formatting should not require ANSI color to be machine-readable.
- Write operational logs to stdout/stderr for containers. Retain legacy file
  logging only if current deployment evidence proves it is consumed; otherwise
  document its retirement rather than silently emulating daily append files.

## Test Conventions

### Go unit and package tests

- Use table-driven tests with descriptive subtest names for ordered quality,
  language, release-group, title, episode, and common-cleanup rules.
- Keep tests beside their package and fixtures under `testdata/`.
- Assert complete contract structs, including empty slices versus nil slices,
  zeros, false values, and null pointers.
- Add direct adapter tests for default regexp2 mode, ignore-case and
  ignore-pattern-whitespace options, lookarounds, backreferences, repeated
  captures, replacements, Unicode offsets, compile errors, timeout errors, and
  stack bounds.
- Run executed concurrency paths under `go test -race`; batch tests must verify
  duplicate collapse, deterministic semantic output, bounded worker behavior,
  and continued health responsiveness.
- Use fuzz tests for decode and parser crash resistance, seeded from reviewed
  real/golden cases. Fuzz tests must assert invariants, not replace oracle
  parity.

### Golden and differential tests

- Generate expectations only from a pinned unmodified C# oracle.
- Store versioned JSONL plus a provenance manifest recording source commit, .NET
  patch, OS, culture/globalization mode, timezone, and capture date.
- Record method, path, relevant headers, raw request body, expected status,
  selected response headers, raw response body, semantic JSON, category, and
  notes.
- Compare semantic JSON for object-member-order-insensitive success while
  separately comparing field presence, null/empty/zero distinctions, arrays,
  status, content type, and validation/error bodies.
- Include malformed/null/wrong-type/trailing JSON, duplicate properties,
  Unicode, Turkish-I, repeated captures, year boundaries, invalid/catastrophic
  regexes, duplicates, maximum supported batches, and one-over-limit cases.
- Never allow the Go service to regenerate its own golden expectations.

### App, process, container, and archive tests

- Retain Deno live-parser stubs for consumer fallback/cache tests.
- Add at least one real Go service integration path through the TypeScript
  client, including outage and recovery.
- Smoke the adjacent standalone binary discovery/readiness/shutdown flow on
  Linux and Windows; validate the Windows termination strategy explicitly.
- Build and run the parser container as non-root, call `/health`, exercise one
  parse and one match request, and test graceful stop.
- Cross-build every release target and verify the exact staged filenames inside
  archives.

## CI Conventions

The parser gate should be discoverable locally and mirrored in Actions. A
recommended focused sequence is:

1. `gofmt`/`goimports` verification and repository `.golangci.yml`.
2. `go vet ./...`.
3. `go test ./...`.
4. `go test -race ./...` for executed supported-host paths.
5. `go mod tidy` cleanliness and read-only module verification/download.
6. `govulncheck ./...`.
7. Golden/differential/adversarial suites while the oracle exists.
8. Cross-build matrix.
9. Parser container smoke.
10. Existing Deno `check`, focused parser-consumer tests, and production build.

Add Go setup only when parser-relevant paths change, but include all integration
surfaces in those filters: parser sources/module files, TypeScript parser client
and spawn code, `scripts/dev.ts`, `deno.json`, `mise.toml`, `Dockerfile.parser`,
Compose files, and compatibility/docker/release workflows. Pin the same Go patch
across local tooling, module toolchain, Docker, and CI.

## Patterns to Follow

1. **In-place identity preservation** from the current package, image, Compose,
   and archive structure.
2. **Minimal composition root** from `Program.cs`, with explicit route mapping
   and no domain logic in `main`.
3. **Validation-before-work** and exact error strings from the endpoint files.
4. **Pure ordered parser orchestration** from `ParseEndpoints.Handle`.
5. **Shared cleanup primitives** from `ParserCommon` and one regex replacement
   adapter.
6. **First-success/early-return precedence** from quality, title, and episode
   parsers.
7. **First-seen stable deduplication** from `LanguageParser`; use a slice plus
   membership map, never map iteration for output.
8. **Compile-once batch matching** from `MatchEndpoints`, combined with bounded
   workers and one result-map owner.
9. **Graceful optional-service behavior** from the TypeScript client and
   standalone launcher.
10. **Version-keyed caching** from `client.ts`.
11. **Dependency-first Docker layers, non-root runtime, and health check** from
    `Dockerfile.parser`.
12. **Explicit release matrix and artifact naming** from `release.yml`.
13. **Path-scoped compatibility gates** from `compatibility.yml`.
14. **Live HTTP substitutes with explicit teardown** from parser-dependent Deno
    route tests.
15. **Generated repository Go lint policy** from `scripts/go-tools.sh`.

## Anti-patterns to Avoid

- Do not use Go `regexp`, regexp2 RE2/ECMAScript modes, or a silent fallback
  engine for parser behavior.
- Do not reorganize or simplify regex arrays and early-return branches during
  the initial port.
- Do not use Go maps as ordered result sources where C# list/dictionary
  construction order or duplicate collapse matters.
- Do not add `omitempty` to compatibility DTOs.
- Do not change enum names, numeric resolutions, validation strings, endpoint
  paths, port, image, binary, or Compose service names to make Go code easier.
- Do not merge transport, contract, parsing, logging globals, and process
  configuration into one `main` package.
- Do not reproduce every C# folder/class as a separate Go package; it creates
  exports and circular ownership without an independent API.
- Do not catch every Go error and return HTTP 500; preserve regex-cell and
  domain-miss isolation.
- Do not launch an unbounded goroutine per text/pattern pair or write shared
  maps from workers.
- Do not use a scratch container if it removes the existing usable health check
  without a replacement.
- Do not delete the C# oracle before provenance-bearing goldens and temporary
  differential gates are reviewed and green.
- Do not retain permanent dual-runtime code, `.NET` build steps, or ASP.NET-only
  configuration after final cutover.
- Do not let the Go service author its expected parity fixtures.
- Do not treat green narrow unit tests as proof that release archives,
  standalone spawning, Docker health, or TypeScript cache behavior still work.

## File-Specific Guidance

| File or area                                                    | Guidance                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/praxrr-parser/Program.cs`                             | Use as the process-composition oracle while Go is added; migrate version/address/logging/shutdown into `cmd/praxrr-parser/main.go`, then delete only at final cutover.                                                   |
| `packages/praxrr-parser/Endpoints/*.cs`                         | Capture exact HTTP fixtures before modifying. Port validation order, text, status, response shape, and duplicate behavior into `internal/httpserver`.                                                                    |
| `packages/praxrr-parser/Models/*.cs`                            | Define explicit Go contract enums/DTOs. Preserve all defaults and field presence; test JSON directly.                                                                                                                    |
| `packages/praxrr-parser/Parsers/Common/*.cs`                    | Port extension allowlists and replacement behavior once into the cohesive parser package.                                                                                                                                |
| `packages/praxrr-parser/Parsers/QualityParser.cs`               | Preserve normalization, revision calculation, branch order, and early returns. Add overlap-focused table tests before refactoring.                                                                                       |
| `packages/praxrr-parser/Parsers/LanguageParser.cs`              | Preserve two-pass matching, special German rules, all language names, insertion order, and stable distinct semantics.                                                                                                    |
| `packages/praxrr-parser/Parsers/ReleaseGroupParser.cs`          | Preserve preprocessing, anime priority, exception ordering, last-match selection, and invalid-group rejection.                                                                                                           |
| `packages/praxrr-parser/Parsers/TitleParser.cs`                 | Preserve regex declaration order, first successful parsed match, folder-mode extension, alternate title ordering, and fail-closed behavior.                                                                              |
| `packages/praxrr-parser/Parsers/EpisodeParser.cs`               | Preserve repeated capture ordering, range/date validation, tomorrow boundary, release-type derivation, and null-on-failure behavior. Inject/control clock for deterministic tests without changing production semantics. |
| `packages/praxrr-parser/Logging/*`                              | Preserve useful source/meta semantics, but replace the global/file-oriented implementation with injected structured logging unless file-log consumption is demonstrated.                                                 |
| `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` | Treat as consumer evidence. Update stale C# comments only after cutover; avoid runtime-specific branches. Add real-Go integration coverage for version caching and recovery.                                             |
| `packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`  | Keep enum values and public app types unchanged; use these as a parity checklist for Go wire enum names.                                                                                                                 |
| `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`      | Preserve adjacent names, free-port/readiness logic, labeled output, optional failure, and parent-child shutdown. Atomically replace ASP.NET env with native Go address configuration.                                    |
| `scripts/dev.ts`                                                | Replace the .NET availability probe and watcher with pinned Go tooling/tasks while retaining concurrent labeled output and server-only fallback.                                                                         |
| `deno.json`                                                     | Add focused parser check/test/build tasks; replace standalone `dotnet publish` steps without changing output locations or names. Avoid destructive `git checkout` cleanup in tasks.                                      |
| `mise.toml`                                                     | Add the selected Go patch and keep it aligned with `go.mod`, `toolchain`, Docker, and Actions.                                                                                                                           |
| `scripts/go-tools.sh`                                           | Generate the parser `.golangci.yml`; keep the generated policy rather than hand-diverging it.                                                                                                                            |
| `Dockerfile.parser`                                             | Replace only build/runtime implementation. Retain image metadata, non-root identity, port, health behavior, and cache-friendly dependency copy order.                                                                    |
| `compose.yml`                                                   | Keep service `parser`, image `ghcr.io/yandy-r/praxrr-parser`, internal port 5000, and `depends_on: condition: service_healthy`.                                                                                          |
| `compose.dev.yml`                                               | Keep `parser-dev`, profile/watch behavior, and parser source rebuild triggers; include Go module/tooling files in rebuild scope.                                                                                         |
| `.github/workflows/compatibility.yml`                           | Add pinned Go setup and focused Go gates to parser-relevant changes; retain existing Deno app check/build because the consumer is part of the compatibility boundary.                                                    |
| `.github/workflows/docker.yml`                                  | Preserve the `praxrr-parser` matrix entry, GHCR tags, metadata, and attestation; add an executable container smoke/health gate.                                                                                          |
| `.github/workflows/release.yml`                                 | Replace .NET setup/RIDs with pinned Go and GOOS/GOARCH, retain all five platform archives and exact parser filenames, and add archive validation/smoke.                                                                  |
| Parser-dependent Deno tests                                     | Continue setting env before dynamic imports, using dedicated live stubs, explicit complete fixtures, cache-version assertions, and teardown. Add outage/recovery coverage against the real Go service.                   |
| `README.md` and `docs/CONTRIBUTING.md`                          | Update tool prerequisites, development commands, and architecture only after the corresponding commands work; remove live .NET guidance at final cutover.                                                                |
| `ROADMAP.md`                                                    | Mark issue/phase completion only after parity, Go gates, Docker/standalone/release evidence, .NET removal, PR review fixes, and green CI exist.                                                                          |

## Verified Path Inventory

The following relevant paths were verified in this worktree:

- `packages/praxrr-parser/Program.cs`
- `packages/praxrr-parser/Endpoints/HealthEndpoints.cs`
- `packages/praxrr-parser/Endpoints/MatchEndpoints.cs`
- `packages/praxrr-parser/Endpoints/ParseEndpoints.cs`
- `packages/praxrr-parser/Models/{Language,Requests,Responses,Types}.cs`
- `packages/praxrr-parser/Parsers/{Episode,Language,Quality,ReleaseGroup,Title}Parser.cs`
- `packages/praxrr-parser/Parsers/Common/{ParserCommon,RegexReplace}.cs`
- `packages/praxrr-parser/Logging/{LogSettings,Logger,Startup,Types}.cs`
- `packages/praxrr-app/src/lib/server/utils/arr/parser/{client,types}.ts`
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`
- `packages/praxrr-app/src/tests/routes/entityTestingEvaluateRoute.test.ts`
- `packages/praxrr-app/src/tests/routes/impactSimulatorRoute.test.ts`
- `scripts/{dev,test}.ts`
- `scripts/go-tools.sh`
- `deno.json`
- `mise.toml`
- `Dockerfile.parser`
- `compose.yml`
- `compose.dev.yml`
- `.github/workflows/{compatibility,docker,release,lint}.yml`
