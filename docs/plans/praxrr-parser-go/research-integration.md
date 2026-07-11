# Integration Research: Praxrr Parser Go Migration

## Executive Summary

The parser can be replaced in place without changing the application-facing API,
Compose topology, image name, or standalone archive layout. That compatibility
is not automatic, however: the current C# implementation is coupled to Praxrr
through four HTTP endpoints, TypeScript enum conversion, two persistent caches,
optional degraded-mode behavior, early standalone auto-spawn, Deno
developer/build tasks, two Compose files, three GitHub Actions workflows,
release archive naming, and operator/developer documentation.

The highest-risk integration contract is the parser health `version`. It is not
display-only metadata:
`packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` caches it for
the process lifetime and uses it to namespace `parsed_release_cache`. A Go
cutover that reports the legacy `1.0.0` while behavior changes can reuse stale
parsed JSON. The cutover therefore needs a deterministic, build-injected version
and an intentional behavior-version bump, plus tests proving cache miss/hit
behavior across version changes. Pattern-match cache invalidation is different:
it is keyed only by title and a sorted-pattern hash, not parser version, so a
regex-engine cutover can reuse C# decisions unless that cache is cleared,
versioned, or its key contract is revised.

The safest sequence is: preserve and test the HTTP consumer contract; add
Go-native tasks and CI while the C# oracle remains; switch
local/standalone/container builders; smoke every archive and image;
bump/validate cache identity; update live docs and `ROADMAP.md`; then remove C#
files, .NET setup, ASP.NET-only configuration, and `.NET` ignore/documentation
residue. Issue #5 must be the atomic integration cutover after issues #2-#4
establish parity.

## API Endpoints

The private parser contract consists of `GET /health`, `POST /parse`,
`POST /match`, and `POST /match/batch`. The application-facing health facade is
`GET /api/v1/parser/health`; it intentionally exposes only
`{ parserAvailable: boolean }`. The endpoint paths, methods, validation order
and text, status codes, selected headers, JSON field presence, enum names,
null/empty distinctions, duplicate-key collapse, and observed result ordering
are migration contracts. Their exact consumers and validation requirements are
inventoried below.

## Integration Inventory

### 1. Runtime HTTP client and wire conversion

| Surface                     | Verified path                                                                                                                                                              | Current integration behavior                                                                                                                                                                        | Go cutover requirement                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser client               | `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`                                                                                                            | `BaseHttpClient` calls `GET /health`, `POST /parse`, `POST /match`, and `POST /match/batch` with a 30 s timeout, two retries, and 500 ms retry delay. A lazy singleton binds to `config.parserUrl`. | Preserve paths, methods, JSON names/shapes, status handling, and responses within the existing client budget. No runtime-based client branch. |
| Consumer types              | `packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`                                                                                                             | Defines numeric application enums and the complete `ParseResult`; the client converts response enum **names** to these numeric values and defaults unknown names.                                   | Go must emit the exact C# enum strings/casing and all nullable/default fields expected by `ParseResponse`.                                    |
| Re-export boundary          | `packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts`                                                                                                             | Exposes the parser client/types to routes and evaluation code.                                                                                                                                      | Keep exports stable unless a separately reviewed consumer change is required.                                                                 |
| Parser URL                  | `packages/praxrr-app/src/lib/server/utils/config/config.ts`                                                                                                                | Builds `http://${PARSER_HOST                                                                                                                                                                        |                                                                                                                                               |
| App health facade           | `packages/praxrr-app/src/routes/api/v1/parser/health/+server.ts`                                                                                                           | Converts any healthy parser response to `{ parserAvailable: true }`; failures become `false`.                                                                                                       | Keep this public app API unchanged. Parser version/build details remain internal unless separately specified contract-first.                  |
| Public API contract/mirrors | `docs/api/v1/paths/system.yaml`, `docs/api/v1/openapi.yaml`, `packages/praxrr-api/openapi.json`, `packages/praxrr-api/types.ts`, `packages/praxrr-app/src/lib/api/v1.d.ts` | `/api/v1/parser/health` exposes only required boolean `parserAvailable`.                                                                                                                            | No OpenAPI change is needed for a runtime-only migration; regenerate mirrors only if the public schema changes.                               |

The direct parser API is private and unversioned. The authoritative current
server routes are `packages/praxrr-parser/Endpoints/HealthEndpoints.cs`,
`ParseEndpoints.cs`, and `MatchEndpoints.cs`; `Program.cs` wires them. Go
handler tests must compare status, selected headers, raw JSON field presence,
and semantic body against the pinned C# oracle, not merely TypeScript
assignability.

### 2. Persistent and process caches

| Cache                  | Verified paths                                                                                                                                                                                                                       | Current key/invalidation contract                                                                                                                                                                    | Integration risk/action                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parsed release         | `packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`; migration `packages/praxrr-app/src/lib/server/db/migrations/021_create_parsed_release_cache.ts`; reference `packages/praxrr-app/src/lib/server/db/schema.sql` | Lookup uses `cache_key = "${title}:${type}"` plus parser health `version`; stored value is serialized application `ParseResult`. Old versions can be deleted.                                        | Inject a deterministic new Go behavior version. Test same-version hit and new-version miss. Do not reuse `1.0.0` accidentally.                                                                                                                   |
| Process health version | `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`                                                                                                                                                                      | First successful `/health` version is cached in module state until `clearParserVersionCache()`; failures are not cached.                                                                             | Restart/version tests must clear process state. Decide whether unexpected parser replacement in a long-running app remains outside the supported contract or needs refresh logic.                                                                |
| Pattern match          | `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`; migration `packages/praxrr-app/src/lib/server/db/migrations/023_create_pattern_match_cache.ts`; reference `packages/praxrr-app/src/lib/server/db/schema.sql`   | Key is `(title, patterns_hash)` where hash is SHA-256 over sorted patterns, truncated to 16 hex chars. Parser version/engine is absent. Cached rows may be returned even when parser is unavailable. | This is a cutover hazard. Before enabling Go, either clear this table once, add behavior version to the hash/key with a migration, or deliberately change the derived hash namespace. Prove stale C# decisions cannot survive the engine switch. |
| Batch parse            | `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`                                                                                                                                                                      | Uncached titles are sent as parallel individual `/parse` calls; there is no parser `/parse/batch`.                                                                                                   | Parser concurrency/request bounds must accommodate the app's parallel fan-out, or the client must add bounded concurrency without changing results.                                                                                              |
| Batch regex            | same client path                                                                                                                                                                                                                     | Cached texts are removed, then one `/match/batch` request is made. Duplicate texts and pattern keys collapse through JSON objects/Maps.                                                              | Preserve overwrite/collapse and ordering observations from the oracle; enforce finite limits consistent with actual simulator maxima.                                                                                                            |

### 3. SvelteKit routes, pages, and graceful degradation

The parser is optional by product contract. A cutover must not turn parser
startup or downtime into application startup failure.

| Consumer                       | Verified path(s)                                                                                                 | Failure behavior to preserve                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entity testing API             | `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`                                       | Health failure returns HTTP 200 with `parserAvailable: false`, unknown/empty evaluations; otherwise uses `parseWithCacheBatch` and `matchPatternsBatch`. |
| Score simulator API            | `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`                                                | Health gates evaluation and response carries `parserAvailable`; missing individual parses may still permit pattern-only evaluation.                      |
| Impact simulator API           | `packages/praxrr-app/src/routes/api/v1/simulate/impact/+server.ts`                                               | Health gates both current and proposed simulations; response still returns structured non-parser data and `parserAvailable`.                             |
| Custom-format test page        | `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts` and `+page.svelte`     | Unavailable parser yields `unknown`, null parse/match data, and warning UI rather than throwing the page.                                                |
| Quality-profile entity testing | `packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts` and `+page.svelte` | Load returns `parserAvailable`; UI warns that release scoring is disabled.                                                                               |
| Score simulator page           | `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.server.ts` and `+page.svelte`                 | Load advertises availability; UI disables/warns without blocking unrelated navigation.                                                                   |
| Impact simulator page          | `packages/praxrr-app/src/routes/impact-simulator/[databaseId]/+page.server.ts` and `+page.svelte`                | Same optional-service availability contract.                                                                                                             |

Existing route integration tests with an HTTP stub are
`packages/praxrr-app/src/tests/routes/entityTestingEvaluateRoute.test.ts`,
`impactSimulatorRoute.test.ts`, and `simulateScoreRoute.test.ts`. They already
exercise health/version, parse, match-batch, unavailable mode, caches, and real
.NET-style patterns. They are necessary consumer regression gates but are not a
replacement for Go handler/oracle tests because their stub supplies expected
JSON. The score simulator Playwright coverage lives at
`packages/praxrr-app/src/tests/e2e/specs/4.2-score-simulator-what-if.spec.ts`,
`4.3-score-simulator-url-state.spec.ts`, and
`4.4-score-simulator-ux-basics.spec.ts`; add at least one real-parser happy-path
and one unavailable/recovery scenario to the integration gate.

### 4. Standalone auto-spawn and parent lifecycle

`packages/praxrr-app/src/hooks.server.ts` dynamically imports
`packages/praxrr-app/src/lib/server/utils/parser/spawn.ts` before importing
config. The spawn module:

1. skips Docker and an explicitly configured `PARSER_HOST`;
2. searches beside `Deno.execPath()` for `praxrr-parser`, then
   `praxrr-parser.exe`;
3. chooses a free loopback port;
4. currently launches with `ASPNETCORE_URLS=http://localhost:<port>` and
   `ASPNETCORE_ENVIRONMENT=Production`;
5. sets app-side `PARSER_HOST=localhost` and `PARSER_PORT=<port>` before
   `Config` is initialized;
6. polls `/health` for up to 10 seconds (individual fetch timeout 2 seconds, 250
   ms polling);
7. streams labeled stdout/stderr, sends `SIGTERM` on app shutdown, and reports
   unexpected nonzero exit.

The executable names, adjacency, loopback binding, readiness deadline, and
parent-child behavior are archive contracts. Migrate the child environment to a
Go-native `PARSER_ADDR` (or equivalent) atomically with the Go command. A
temporary strict `ASPNETCORE_URLS` compatibility parser is useful during
rollback, but it must not remain as an undocumented permanent configuration
surface. Windows needs a real archive smoke test because Deno does not install
the `SIGTERM` listener there and child termination semantics differ from Unix.

### 5. Developer tasks and launcher

| Surface                 | Verified path                                                       | Current state                                                                                                    | Required change/gate                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser-only task        | `deno.json` task `dev:parser`                                       | `dotnet watch run --urls http://localhost:5000` in `packages/praxrr-parser`.                                     | Replace with Go run/watch behavior on port 5000.                                                                                             |
| Combined dev            | `scripts/dev.ts`; `deno.json` tasks `dev`, `dev:noauth`, `dev:oidc` | Detects `dotnet`, launches parser and Vite concurrently; without .NET runs server-only.                          | Detect Go/parser availability, retain labeled output and server-only degradation, and terminate both processes cleanly.                      |
| Server-only/preview     | `deno.json` tasks `dev:server`, `preview`                           | Set `PARSER_HOST=localhost`, `PARSER_PORT=5000`; do not launch parser.                                           | Preserve intent and address.                                                                                                                 |
| Local standalone builds | `deno.json` tasks `build:standalone`, `build:standalone:windows`    | Mutate `Directory.Build.props`, run `dotnet publish`, rename `Parser[.exe]` into adjacent `praxrr-parser[.exe]`. | Use `go build` with explicit `GOOS`/`GOARCH`, output directly to stable names, avoid tracked-file mutation, inject deterministic version.    |
| Root parser gates       | `deno.json`                                                         | No dedicated Go format/vet/test/build tasks currently exist.                                                     | Add discoverable `format:parser`/check, `test:parser`, and `build:parser` tasks (exact naming may follow final plan) used locally and in CI. |
| Docker dev tasks        | `deno.json` tasks `docker:dev:up*`                                  | Start Compose parser before rebuilding/watching Praxrr.                                                          | Preserve ordering and service health dependency.                                                                                             |

`packages/praxrr-parser/Directory.Build.props` exists only to support the C#
build layout and should disappear with the C# project, together with
`Parser.csproj` and `appsettings.json` after the oracle fixtures are frozen.

### 6. Containers and Compose

`Dockerfile.parser` currently uses .NET SDK/ASP.NET Alpine stages, runs as
uid/gid 1000 user `parser`, listens on port 5000 through `ASPNETCORE_URLS`, and
uses `wget` against `/health`. The Go replacement must retain OCI image identity
`ghcr.io/yandy-r/praxrr-parser`, non-root execution, `EXPOSE 5000`, and a
working health check. If the minimal runtime image lacks `wget`, use a
binary-native health subcommand or include a deliberate health client rather
than shipping a broken Compose dependency.

`compose.yml` names the service `parser`, container `praxrr-parser`, uses
internal `expose: 5000`, and makes Praxrr wait for `service_healthy`.
`compose.dev.yml` keeps the Compose service key `parser` but hostname/container
identity `parser-dev`, watches `packages/praxrr-parser` and `Dockerfile.parser`,
and directs Praxrr to `parser-dev:5000`. Neither configuration publishes the
parser port. These names and private-network semantics must remain unchanged.

`.dockerignore` contains C# `bin/` and `obj/` entries. Remove or replace these
only after the final source cutover; ensure Go build outputs and test/fuzz
artifacts are also excluded from image contexts where appropriate.

### 7. Compatibility, Docker, and release workflows

| Workflow         | Verified path                         | Current parser coupling                                                                                                                                                | Required Go integration                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR compatibility | `.github/workflows/compatibility.yml` | Parser paths trigger `app_paths`, but the job only sets up Deno, runs `deno task check`, and builds SvelteKit. There is no parser compilation/test.                    | Add Go setup and a focused parser job or explicit parser task: `gofmt` clean diff, `go mod tidy` clean diff, `go mod verify`, `go vet`, unit/golden tests, race tests where supported, and binary build. Include `go.mod`, `go.sum`, fixtures, Dockerfile, launcher/tasks, and workflow paths in filters.                            |
| Image publish    | `.github/workflows/docker.yml`        | Matrix publishes `praxrr` and `praxrr-parser` from `Dockerfile`/`Dockerfile.parser`; only `linux/amd64` is enabled; tags/channels and GHCR identity are shared policy. | Preserve matrix image/tag/attestation behavior. Add pre-push build/health/API smoke or a separate gated job; test non-root and internal port. Re-enable arm64 only with a tested policy.                                                                                                                                             |
| Release archive  | `.github/workflows/release.yml`       | Pins `DOTNET_VERSION`, `PARSER_PROJECT_DIR`, and `dotnet_rid`; builds five platforms, stages `praxrr-parser[.exe]`, archives all staging contents.                     | Pin Go patch, map matrix to `GOOS`/`GOARCH`, remove .NET setup/env/RIDs, inject version, and keep the five platform/archive names.                                                                                                                                                                                                   |
| Release gate     | same release workflow                 | Runs contract compatibility before build, but does not launch the staged parser or inspect archive contents beyond successful packaging.                               | For each artifact, assert exact root layout (`praxrr[.exe]`, `praxrr-parser[.exe]`, `server.js`, `static/`), launch parser on a free port where runner-compatible, verify `/health`, `/parse`, `/match`, `/match/batch`, and test standalone auto-spawn. Cross-platform artifacts need native runners or an explicit smoke strategy. |

Current archive naming is
`praxrr-<app-version>-<linux-x64|linux-arm64|macos-x64|macos-arm64|windows-x64>.<tar.gz|zip>`.
Each archive places the app executable, parser executable, `server.js`, and
`static/` at its root. Preserve that layout because `spawn.ts` searches only
adjacent to the main executable.

### 8. Versioning and release identity

The legacy parser reads `Parser:Version` from configuration and falls back to
`1.0.0` (`packages/praxrr-parser/Program.cs` and `appsettings.json`).
Application release versioning is separately managed by
`release-please-config.json`, `.release-please-manifest.json`, root
`package.json`, and package `deno.json` files; tags are `app/v*`.

The Go binary should receive its parser behavior/build version through linker
injection in local, container, and release builds, with a deterministic
development fallback. The selected string must be identical for parser binaries
and parser container built from the same release, and must deliberately change
when observable parsing behavior changes. Do not make health version depend on
wall-clock build time: that would destroy cache reuse on byte-identical
rebuilds. Record the legacy oracle source/runtime version separately from the
live Go cache namespace.

### 9. Documentation and roadmap inventory

Live content that names the runtime, dependency, tasks, deployment identity, or
troubleshooting flow must be updated only when the Go cutover is real:

- `README.md` (Compose example, optional parser, .NET development prerequisite,
  `PARSER_HOST`/`PARSER_PORT`);
- `docs/CONTRIBUTING.md` (prerequisite and local task descriptions);
- `docs/ARCHITECTURE.md`, `docs/architecture/overview.md`,
  `docs/architecture/components.md`, and `docs/architecture/data-flow.md` (C#
  identity and exact source references);
- `docs/site/src/content/docs/app/development.md` (toolchain, package
  description, task table, environment);
- `docs/site/src/content/docs/getting-started/installation.md` and
  `getting-started/docker.md` (optional dependency, Compose/internal
  networking);
- `docs/site/src/content/docs/guides/configuration.md`,
  `guides/custom-formats.md`, and `guides/troubleshooting.md` (address and
  degraded behavior);
- `.github/copilot-instructions.md`, `CLAUDE.md`, and `AGENTS.md` references
  where generated/project guidance still calls the parser C#/.NET;
- `ROADMAP.md` Go Parser Migration table and Maintenance checklist.

Keep user-visible configuration (`PARSER_HOST`, `PARSER_PORT`), optional-service
messaging, and image/executable names. Replace only implementation/toolchain
claims. Mark #2-#5 and parent #1 complete in `ROADMAP.md` only after their
evidence gates and merged PR state are true.

## Integration Contracts

### Must remain stable

- Private HTTP endpoints: `GET /health`, `POST /parse`, `POST /match`,
  `POST /match/batch`.
- Exact status codes, validation precedence/text, selected content headers, JSON
  property names, null/empty/zero distinctions, enum names, duplicate collapse,
  and result ordering observed from the pinned oracle.
- App facade `/api/v1/parser/health` returning only
  `{ parserAvailable: boolean }`.
- `PARSER_HOST`, `PARSER_PORT`, default `localhost:5000`, and Compose
  internal-only networking.
- Image `ghcr.io/yandy-r/praxrr-parser`, service identities
  `parser`/`parser-dev`, and executable names
  `praxrr-parser`/`praxrr-parser.exe`.
- Optional failure semantics: unrelated app startup/editing/sync continue;
  parser screens expose unavailable/unknown and recover without losing input.
- Release archive root adjacency and the five-platform matrix.

### Must intentionally change

- Parser health behavior version/cache namespace at Go activation.
- Pattern-match cache namespace or contents at engine activation.
- Internal child bind configuration from ASP.NET-specific variables to a
  Go-native address (with only a bounded rollback compatibility window if
  retained).
- Toolchain/build implementation from .NET to pinned Go and `regexp2/v2`.
- Runtime/toolchain documentation and source references.

### Must be removed at completion

- `packages/praxrr-parser/**/*.cs`, `Parser.csproj`, `Directory.Build.props`,
  and ASP.NET `appsettings.json`, after oracle capture is immutable.
- `dotnet` commands, `actions/setup-dotnet`, `DOTNET_VERSION`, `dotnet_rid`,
  `ASPNETCORE_*` live launch requirements, and .NET SDK/runtime container
  stages.
- Live documentation that calls the production parser C# or requires .NET.
- `.dockerignore` entries that exist solely for retired .NET build output.

## Change Matrix

| Phase / owner issue                    | Files or surfaces                                                                 | Change                                                                                                                           | Depends on                                         |
| -------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Foundation (#2)                        | `packages/praxrr-parser/go.mod`, `go.sum`, fixture/testdata paths, oracle tooling | Pin Go/regexp2, freeze provenance corpus, establish Go test/build commands.                                                      | Pinned C# oracle and limits decision.              |
| Domain parity (#3)                     | Go internal parser packages/testdata                                              | Port parsing behavior; no app/deployment cutover.                                                                                | Foundation regex/fixture contract.                 |
| HTTP parity (#4)                       | Go command/http/contract packages                                                 | Implement four endpoints and exact transport behavior; provide deterministic version injection and bind option.                  | Domain parity.                                     |
| Consumer verification (#4/#5 boundary) | parser client/types, route tests, real-parser integration tests                   | Run existing client/routes unchanged against Go; add cache-version, pattern-cache, unavailable/recovery, and finite-limit tests. | HTTP parity.                                       |
| Developer cutover (#5)                 | `deno.json`, `scripts/dev.ts`, `spawn.ts`, `hooks.server.ts` if necessary         | Replace .NET commands, preserve output/readiness/degraded mode and executable adjacency.                                         | Working Go binary.                                 |
| Container cutover (#5)                 | `Dockerfile.parser`, `.dockerignore`, `compose.yml`, `compose.dev.yml`            | Build/run Go non-root image while retaining service/image/port/health identity.                                                  | Go build and health behavior.                      |
| CI/release cutover (#5)                | three workflows                                                                   | Pin Go, add native gates, replace cross-build, smoke artifacts/images, remove .NET.                                              | All parity and integration tests.                  |
| Cache activation (#5)                  | client/cache key or migration/one-time cleanup policy                             | Bump parse version and invalidate/version regex decisions atomically with deployment.                                            | Final behavior version.                            |
| Docs/roadmap (#5/#1)                   | live docs list above, `ROADMAP.md`                                                | Replace C#/.NET guidance; record child and parent completion only after evidence.                                                | Green release/CI evidence.                         |
| Retirement (#5)                        | legacy parser files and all repository references                                 | Delete C# oracle/build/runtime residue; enforce search-based no-.NET gate.                                                       | Fixtures immutable and rollback artifact recorded. |

## Sequencing and Dependencies

1. **Freeze integration evidence before deletion.** Record current C# commit,
   runtime patch, OS/culture/time zone, health version, raw HTTP fixtures, and
   representative app-client results. Do not alter app consumers yet.
2. **Land Go foundation/domain/HTTP behind tests.** The C# oracle may coexist
   inside `packages/praxrr-parser` temporarily, but no production selector
   should make two contracts permanent.
3. **Prove consumer compatibility.** Run the real TypeScript client and route
   tests against a Go process, including unavailable state and restart. Resolve
   finite batch limits against actual simulator request limits before enforcing
   them.
4. **Choose cache activation policy.** Finalize deterministic Go health version
   and pattern-cache invalidation/versioning before the first Go deployment.
5. **Cut developer and standalone launchers.** Update tasks, `scripts/dev.ts`,
   and `spawn.ts` together so the binary receives its bind address and Praxrr
   reads the same selected port.
6. **Cut container and Compose build.** Preserve service topology, then test
   non-root health and API behavior from the Praxrr network namespace.
7. **Cut CI and release archives.** Go gates must become required before removal
   of .NET setup. Native-smoke or otherwise verify every supported artifact.
8. **Update live documentation and roadmap.** Do this in the same PR so source,
   commands, and operator guidance cannot diverge.
9. **Retire legacy implementation.** Delete C# and run a repository search that
   distinguishes intentional historical/oracle notes from active dependencies.

## Validation by Surface

| Surface        | Required validation                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP transport | Differential tests for every method/path, success, validation order, malformed/null/wrong-type/trailing JSON, unsupported methods/content types, selected headers, raw field presence, duplicate keys, and body limits.                       |
| Parse model    | Exact semantic comparison for all fields and enum strings; movie/series defaults; null versus empty arrays/objects; Unicode/date boundary fixtures.                                                                                           |
| Regex          | Oracle matrix for `.NET` constructs, invalid patterns, timeout/stack failure as `false`, duplicate patterns/texts, batch key collapse, and sibling isolation.                                                                                 |
| App client     | Real Go server tests for health/version, enum conversion, parse/match/batch, timeout/retry interaction, and error degradation.                                                                                                                |
| Caches         | Parse same-version hit/new-version miss; process version reset; regex cache cannot reuse C# results after cutover; partial cached batch remains available during outage.                                                                      |
| Routes/UI      | Existing three route suites; custom-format/entity/score/impact unavailable warnings; at least one real-parser Playwright happy path and outage/recovery path.                                                                                 |
| Standalone     | For Linux and Windows at minimum, place binaries adjacent, omit `PARSER_HOST`, start Praxrr, observe auto-selected port and health, parse a fixture, terminate parent, and prove no child remains. Test explicit external parser skips spawn. |
| Developer flow | `deno task dev:parser`, combined `dev`, server-only without Go/parser, labeled logs, signal cleanup, and port 5000 behavior.                                                                                                                  |
| Container      | Build `Dockerfile.parser`; verify non-root uid, port 5000, healthcheck, all four endpoints, shutdown, resource bounds, no .NET runtime/SDK, and private Compose reachability.                                                                 |
| CI modules     | `gofmt` clean, `go mod tidy` clean, `go mod verify`, `go vet`, `go test`, `go test -race`, golden/differential suites, cross-builds; retain Deno lint/check/test/build.                                                                       |
| Archives       | Inspect exact file layout/names for all five platforms; execute native artifacts; verify `/health` version matches release policy and app auto-spawn where supported.                                                                         |
| Documentation  | Search active docs/tasks/workflows for `dotnet`, `setup-dotnet`, `ASPNETCORE`, `Parser.csproj`, and claims that the live parser is C#/.NET; allow only clearly labeled historical oracle records.                                             |
| Completion     | `ROADMAP.md` entries #1-#5 agree with GitHub issue/PR state; required CI is green; published/merged change contains no active .NET parser dependency.                                                                                         |

## Rollback Concerns

- **Cache rollback:** A distinct Go behavior version prevents Go parses from
  being read by the old service, but the legacy version must also remain
  distinct. Pattern matches require an explicit namespace strategy in both
  directions.
- **Binary/image rollback:** Record the last known-good C# image digest and
  release archive/checksums before retirement. Stable image/executable names
  allow rollback without changing Praxrr configuration.
- **Mixed deployment:** Praxrr and parser images can be upgraded independently
  by operators. Therefore the unchanged wire contract must tolerate
  old-app/new-parser and new-app/old-parser during the rollout window. Do not
  require Go-only response fields for baseline operation.
- **Bind configuration:** If `spawn.ts` switches immediately to only
  `PARSER_ADDR`, it cannot launch a rolled-back C# binary. A short, tested
  compatibility window or release-level rollback of both adjacent binaries is
  required; document which is supported.
- **Oracle removal:** Once C# source is deleted, unexplained drift can no longer
  be regenerated locally. Preserve provenance-bearing expected outputs and the
  exact last oracle commit/runtime instructions, while keeping those records
  clearly historical so no CI still requires .NET.
- **Health/version mismatch:** Never roll forward a behavior-changing binary
  under a previous health version. Never use a nondeterministic version that
  invalidates caches on every restart.
- **Container health tool:** Changing the runtime base can silently remove
  `wget`; validate the actual health command before Compose is made dependent on
  it.
- **Cross-platform lifecycle:** Unix success does not prove Windows child
  cleanup or macOS execution. A release is not rollback-safe until native
  archive smoke evidence exists or unsupported behavior is explicitly removed
  from the release matrix.

## Verified Repository Paths

The following current-state paths were inspected for this integration inventory:

- `packages/praxrr-parser/Program.cs`, `Endpoints/*.cs`, `Models/*.cs`,
  `Parser.csproj`, `Directory.Build.props`, `appsettings.json`;
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`, `index.ts`,
  `types.ts`;
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`,
  `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`,
  `packages/praxrr-app/src/hooks.server.ts`;
- `packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`,
  `patternMatchCache.ts`, migrations `021_create_parsed_release_cache.ts` and
  `023_create_pattern_match_cache.ts`;
- parser health/entity-testing/score/impact route and page paths listed above;
- route tests `entityTestingEvaluateRoute.test.ts`,
  `impactSimulatorRoute.test.ts`, `simulateScoreRoute.test.ts`, and score
  simulator E2E specs `4.2`-`4.4`;
- `deno.json`, `scripts/dev.ts`, `Dockerfile.parser`, `.dockerignore`,
  `compose.yml`, `compose.dev.yml`;
- `.github/workflows/compatibility.yml`, `docker.yml`, `release.yml`;
- `docs/api/v1/paths/system.yaml`, `docs/api/v1/openapi.yaml`, generated API
  mirrors, live README/contributor/architecture/site documentation,
  release-please configuration, and `ROADMAP.md`.
