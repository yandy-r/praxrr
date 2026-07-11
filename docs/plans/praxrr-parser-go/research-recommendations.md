# Recommendations: Go Parser Migration

Research date: 2026-07-10\
Scope: GitHub issues [#1](https://github.com/yandy-r/praxrr/issues/1) through
[#5](https://github.com/yandy-r/praxrr/issues/5)

## Executive Summary

Proceed with an in-place replacement of the .NET parser by a Go parser under
`packages/praxrr-parser`, using `github.com/dlclark/regexp2/v2` in its default
.NET-compatible mode. The migration must be an observable no-op for supported
requests: the same routes, validation order, statuses, headers selected as
contract, JSON field presence and values, array order, null/default behavior,
parser decisions, regex results, timeout-as-`false` behavior, health/version
semantics, executable and image names, host/port configuration, and degraded app
behavior.

The implementation strategy is an oracle-backed expand-and-contract cutover.
Keep the C# service alive long enough to capture a versioned golden corpus and
run both services against identical requests. Port the shared regex/string
compatibility layer first, then domain parsers in legacy rule order, then
orchestration and HTTP, then every build/deployment surface. Delete C#, .NET
tooling, and ASP.NET-only configuration only after the Go binary, container, app
integration, and all release archives pass parity and smoke gates. Full legacy
retirement is part of issue #5 and is not an optional follow-up.

`regexp2` is necessary because Go's standard `regexp` cannot reproduce the
lookbehind, backreferences, atomic groups, named/repeated captures, inline
options, and replacement behavior in the current parser. It is also a
backtracking engine exposed to caller-controlled patterns. Strict parity
therefore applies inside an explicitly measured supported request envelope;
finite regex, batch, HTTP, and concurrency bounds must be chosen from oracle
fixtures and real PCD workloads. Those bounds may fail closed only outside the
supported envelope, must be documented as intentional security boundaries, and
must never silently change ordinary parser results.

The release decision is binary: cut over only with zero known semantic diffs,
green cross-platform artifact tests, proven cache-version behavior, and a tested
rollback artifact. Otherwise retain the .NET implementation and continue
differential work.

## Implementation Recommendations

### P0 — Release blockers

1. **Freeze the oracle before translating behavior.** Record the source commit,
   .NET SDK/runtime patch, OS, culture/globalization mode, time zone, parser
   version, and configuration. Capture successful, rejected, malformed, Unicode,
   boundary-date, duplicate-key, invalid-regex, timeout, replacement, and
   repeated-capture cases directly from that service.
2. **Define parity as a hybrid contract.** Compare decoded JSON structurally for
   objects and maps, while separately asserting status, selected headers, field
   presence, null versus empty/zero, exact enum strings, error text, and array
   ordering. Do not require JSON object-member ordering unless an observed
   consumer proves it necessary.
3. **Centralize all regex behavior.** Only `internal/parser/regex.go` may import
   `regexp2`. It must map the original options, expose captures and replacements
   without losing errors, distinguish internal compile/timeout/stack failures,
   and map dynamic invalid/timeout failures to public `false`. Never enable
   `regexp2.RE2` or `ECMAScript`, never fall back to `regexp`, and never use the
   panic-prone compatibility adapter for request work.
4. **Port behavior, not intent.** Preserve first-match-wins pattern order,
   cleanup order, language ordering and quirks, duplicate collapse, extension
   rules, revision arithmetic, release-group precedence, date boundaries,
   fail-closed movie/episode parsing, and exact output defaults. Do not simplify
   patterns, rename fields, deduplicate outputs, trim persisted/echoed values,
   or repair odd legacy results during this migration.
5. **Freeze the complete HTTP boundary.** Retain `GET /health`, `POST /parse`,
   `POST /match`, and `POST /match/batch`; exact application validation messages
   and order; camelCase fields; explicit nullable/default fields; original map
   keys; and health version semantics. Characterize ASP.NET behavior for
   malformed/empty/null/wrong-type/trailing JSON, duplicate properties, wrong
   methods, unknown paths, media types, and oversized bodies before implementing
   Go responses.
6. **Bound adversarial work without weakening supported parity.** Preserve the
   100 ms dynamic-match timeout. Use checked errors, finite stack and
   static-operation budgets, bounded batch cardinality and work product, a
   bounded worker pool, and a global expensive-work semaphore. Final values must
   pass the full oracle corpus and measured maximum legitimate workloads. If a
   legitimate fixture reaches a bound, raise the finite bound with evidence; do
   not disable it globally.
7. **Preserve deployment identity.** Keep `PARSER_HOST`, `PARSER_PORT`, port
   5000, Compose service names, parser image name,
   `praxrr-parser`/`praxrr-parser.exe`, Deno task intent, health polling,
   non-root execution, and app behavior when the optional parser is absent.
8. **Test the actual cutover surfaces.** Build and start Linux amd64/arm64,
   macOS amd64/arm64, and Windows amd64 binaries; exercise health, parse, match,
   shutdown, and parent-child lifecycle. Build the parser container, validate
   private networking and health dependency, and run the app's parser-dependent
   E2E workflows.
9. **Make cache transition explicit.** Choose and test the health version used
   by the Go release. Do not allow .NET and Go results to share a version
   namespace unless full parity has been proven; an intentional version bump is
   the safer cutover default because it prevents mixed caches.
10. **Retire the legacy runtime completely.** After all gates pass, remove the
    C# source, project files, .NET SDK/container layers, dotnet tasks,
    ASP.NET-only settings, obsolete CI steps, and current documentation
    references. Run a final repository audit and clean-checkout validation.

### P1 — Required quality and operability in the migration PR

1. Use `http.Server` with explicit read-header, read, write, idle, header, body,
   and graceful shutdown budgets. Make the write deadline compatible with valid
   maximum work and shorter than the app client's abandonment horizon.
2. Default standalone binding to loopback; use an explicit all-interface address
   only inside the parser container. Keep Compose on `expose`, not a published
   host port.
3. Keep logs privacy-conscious and stable across runtimes: route, outcome,
   duration, counts, sizes, error class, parser version, and build identity, but
   no raw title, text, regex, request body, or stack trace at ordinary levels.
4. Add app-client chunking if measured legitimate batches exceed the parser's
   per-request work envelope. Merge results without changing original keys or
   duplicate-collapse semantics, and do not retry permanent limit rejections.
5. Use bounded concurrency sized from `GOMAXPROCS` and measurements, not a
   goroutine per match cell. Keep `/health` responsive under maximum allowed
   work and concurrent hostile requests.
6. Run `go test ./...`, `go test -race ./...`, `go vet ./...`, `go mod verify`,
   vulnerability scanning, fuzz seeds, cross-builds, app lint/check/unit tests,
   Docker smoke tests, and focused parser-dependent E2E tests in CI.
7. Pin the Go patch release, `regexp2/v2`, module sums, builder/runtime images,
   and Actions inputs. Generate checksums, SBOM/provenance, and third-party
   notices for distributed artifacts.
8. Preserve graceful degraded UX: parser absence must not stop Praxrr startup or
   unrelated work; domain miss, invalid regex, timeout, and service outage must
   remain distinct outcomes; automatic recovery must preserve input and avoid
   duplicate work.
9. Keep the Go package surface deliberately small: `internal/contract`, one
   cohesive `internal/parser`, `internal/httpserver`, and `cmd/praxrr-parser`.
   Define any parser-service interface at the HTTP consumer, export only what is
   consumed, and avoid implementation-shaped one-package-per-parser ceremony.
10. Align developer tooling across `go.mod`, its `toolchain` directive,
    `mise.toml`, the pinned Docker builder, and Actions. Reuse
    `scripts/go-tools.sh` where it matches the standard checks, and add
    discoverable root tasks such as `test:parser`, `check:parser`, and
    `build:parser`.

### P2 — Follow-ups after strict cutover, not substitutes for it

1. Add an operator diagnostic view for parser reachability, version/build, and
   last safe error class.
2. Improve live-region, stale-result, retry, and alert semantics across
   parser-dependent screens.
3. Add bounded-cardinality metrics for latency, queue depth, cache hits, invalid
   patterns, timeouts, and stack-limit events.
4. Evaluate `regexp2cg` or Go PGO only from representative benchmarks and only
   behind the complete parity suite.
5. Add scheduled differential/fuzz campaigns using the immutable legacy fixture
   baseline or a reproducible tagged oracle image.

## Technology Decisions

| Area                 | Decision                                                                                    | Rationale and constraint                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source layout        | Replace in place in `packages/praxrr-parser`                                                | Preserves package, image, task, release, and executable identity; C# may coexist only as a temporary oracle.                                                                           |
| Language/toolchain   | Current supported Go patch with a pinned module/toolchain policy                            | Pure-Go static builds simplify all target artifacts. Use the oldest module directive supported by the selected `regexp2/v2` line; pin the exact CI/Docker patch.                       |
| Regex engine         | `github.com/dlclark/regexp2/v2 v2.3.0`, default .NET mode                                   | Required constructs cannot run in Go RE2. Dependency upgrades are parser behavior changes and require full parity/security reruns.                                                     |
| HTTP stack           | Standard `net/http` and `encoding/json`                                                     | Four routes do not justify framework defaults that obscure ASP.NET contract emulation.                                                                                                 |
| Package layout       | `internal/contract`, cohesive `internal/parser`, `internal/httpserver`, `cmd/praxrr-parser` | Matches actual ownership and dependency direction without forcing exports or duplicating C# class folders as Go packages.                                                              |
| Models               | Explicit `internal/contract` DTOs with JSON tags; no response `omitempty`                   | Makes null, empty array, zero, false, and field presence deliberate and testable.                                                                                                      |
| Regex boundary       | One unexported adapter in `internal/parser/regex.go`                                        | Parser domains share regex semantics and models; one import site prevents option, timeout, capture, replacement, and error-handling drift.                                             |
| Porting method       | Line-oriented manual behavioral translation                                                 | Retains ordered rules and quirks; generated translation and cleanup-oriented rewrites create silent drift.                                                                             |
| Golden format        | Versioned JSONL plus provenance manifest                                                    | Supports request/status/header/body capture and reproducible review. Golden expectations come from the oracle, not hand-authored assumptions.                                          |
| Batch execution      | Compile unique patterns once; bounded workers; single-owner map merge                       | Avoids unbounded goroutines/data races while retaining map results and duplicate collapse.                                                                                             |
| Server configuration | Native `PARSER_ADDR`; temporary strict `ASPNETCORE_URLS` compatibility                      | Allows in-repo launchers to migrate atomically and preserves rollback during the cutover window. Remove legacy parsing at final retirement unless explicitly approved for one release. |
| Versioning           | Deterministic build-injected parser version; intentional cutover bump recommended           | The health version is a cache namespace. A bump avoids mixing runtime outputs and makes rollback observable.                                                                           |
| Container            | Multi-stage, `CGO_ENABLED=0`, minimal read-only non-root runtime                            | Reduces footprint and attack surface while retaining the current image/health interface.                                                                                               |
| Comparison           | Semantic JSON plus exact contract metadata                                                  | Ignores non-contract object order while catching nullability, arrays, validation, headers, and error behavior.                                                                         |
| Cutover              | Gated one-way expand-and-contract                                                           | Permanent dual runtime defeats the resource/dependency objective; big-bang deletion destroys the oracle too early.                                                                     |

## Phased Strategy Mapped to Issues #2–#5

### Issue #2 — Foundation and Parity

Deliverables:

- Pin and record the .NET oracle environment and source commit.
- Inventory every legacy regex, parser branch, enum, default, validation path,
  endpoint behavior, launcher, container, workflow, and release target.
- Capture and review golden fixtures for domain, regex, HTTP, Unicode,
  date/time-zone, duplicate, malformed, timeout, and adversarial cases.
- Create the Go module, contract/domain models, enum serialization, regex
  compatibility package, fixture reader, differential runner, fuzz seeds, and
  security/resource test scaffolding.
- Use the minimum package graph
  `cmd/praxrr-parser -> internal/httpserver -> internal/parser ->
internal/contract`,
  with `httpserver` also consuming `contract`; keep parsing free of HTTP,
  environment, logging-global, Docker, and TypeScript concerns.
- Measure real PCD text count, unique pattern count, pattern/text size, and work
  product to select supported request limits.

Exit gate:

- Fixtures can be regenerated from the frozen oracle with a provenance manifest.
- The regex layer reproduces compile options, captures, all-match iteration,
  replacement, invalid pattern, timeout, and Unicode behavior for the fixture
  corpus.
- Resource-bound decisions are explicit, finite, tested, and do not reject
  legitimate measured workloads.
- `go test ./...`, race tests for executed paths, vet, module verification, fuzz
  seeds, and adversarial timeout tests pass.

### Issue #3 — Domain Parsers

Port in dependency order: common normalization and extension removal; quality
and revision; language; release group; movie title; episode. Preserve regex and
parser ordering exactly. Add a focused regression whenever Go rune/string, case
folding, whitespace, date/time-zone, numeric parsing, capture collection, or
replacement behavior differs from .NET.

Exit gate:

- Zero semantic diffs across all domain fixtures.
- Every source/modifier/resolution/revision enum/default and all 59 language
  identifiers are covered.
- Movie and episode recognition, domain misses, ranges, daily dates, season
  packs, anime, alternate titles, IDs, editions, hashes, release groups,
  extensions, obfuscation rejects, and exception fail-closed behavior match the
  oracle.
- Static regex operations complete inside measured finite safety limits without
  changing supported outputs.

### Issue #4 — Orchestration and HTTP

Implement parse orchestration and the four exact routes behind interfaces. Run
.NET and Go on separate loopback ports and replay the entire corpus against
both. Add real-listener tests for headers, body decoding, cancellation,
deadlines, wrong methods/paths, panic recovery, shutdown, concurrency, overload,
and health responsiveness.

Exit gate:

- Zero known semantic diffs for supported requests and every framework case
  selected as contract.
- Regex compile, timeout, stack, and engine failures remain isolated
  Booleans/default fields rather than request failures or panics.
- Maximum supported batches complete inside client/UI budgets; over-limit work
  rejects before regex evaluation with stable documented behavior.
- Race, fuzz-seed, slow-client, disconnect, and concurrent adversarial tests
  pass without leaks or health starvation.

### Issue #5 — Integration, Cutover, and Legacy Retirement

First switch launch and delivery surfaces while the oracle remains available:
`spawn.ts`, Deno tasks, dev launcher, Dockerfile, Compose development watch,
compatibility CI, Docker publish, release matrix, archive staging,
documentation, and `ROADMAP.md`. Preserve public names, variables, port, health
behavior, and optional-service degradation. Build, run, and inspect every
artifact.

Then perform the irreversible contraction (the retirement phase of issue #5):

- select and test the cutover parser version and cache invalidation;
- run the complete differential, security, app, container, archive, and E2E
  gates;
- capture rollback image/archive identifiers and checksums;
- delete all C#/.NET runtime and build inputs;
- remove transitional ASP.NET configuration after all in-repo launchers use the
  Go contract;
- audit for live `dotnet`, `.NET`, C#, `Parser.csproj`, and `ASPNETCORE_`
  references, allowing only explicitly historical planning/fixture provenance;
- validate from a clean checkout and update issue/roadmap completion evidence.
- verify Go outputs stay below repository-root `dist/`, run
  `deno task check:dist-paths`, and confirm build commands never mutate or
  restore tracked source files.

Exit gate:

- The Go parser is the sole implementation and no shipped workflow requires
  .NET.
- All supported binaries and the parser image pass startup, health,
  representative parse/match, version, shutdown, non-root, exposure, and
  checksum/provenance checks.
- The app passes parser health, caching, standalone auto-spawn, Docker,
  simulator, custom-format, and entity-testing tests in healthy, unavailable,
  and recovered states.
- The previous parser image/archive is known-good and rollback requires no
  data/config migration.

## Quick Wins

1. Check in an endpoint/validation matrix and fixture provenance schema before
   any Go parser code.
2. Create a single legacy-regex inventory with pattern options and usage sites;
   this exposes unsupported constructs and prevents accidental RE2 use.
3. Add regression fixtures for the highest-risk mismatches immediately: repeated
   named captures, lookbehind/backreferences, Unicode/supplementary characters,
   Turkish-I casing, whitespace, `REAL` case sensitivity, duplicate map keys,
   null/empty arrays, and tomorrow/date boundaries.
4. Add CI searches forbidding `regexp` use as a parser-engine substitute and
   forbidding direct `regexp2` imports outside `internal/parser/regex.go`.
5. Replace full title/regex logging with safe counts and error classes early;
   this has no HTTP parity impact.
6. Add archive smoke scripts that start the adjacent binary and call `/health`,
   `/parse`, and `/match`; reuse them for every platform and rollback artifact.
7. Measure real maximum batch/work-product values from test and PCD data before
   choosing limits.
8. Record baseline .NET startup, idle RSS, image/archive size, and
   representative p50/p95/p99 latency so the stated resource goal has objective
   evidence.
9. Wire `gofmt`, `go vet`, module tidy/clean-diff, tests, and parser builds into
   root tasks and the existing path-scoped compatibility workflow instead of
   creating disconnected tribal commands.

## Rejected Alternatives

| Alternative                                               | Why rejected                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go standard `regexp`                                      | Cannot implement required .NET regex constructs or Arr-compatible behavior.                                                                       |
| `regexp2` RE2/ECMAScript modes                            | Deliberately change character classes, anchors, escapes, and matching semantics.                                                                  |
| `regexp2/v2/compat`                                       | Hides errors and can panic on timeout/stack failures instead of returning the required `false`.                                                   |
| New `packages/praxrr-parser-go` as the permanent location | Duplicates runtime identity and creates needless changes across Compose, releases, auto-spawn, docs, and operators.                               |
| A Go web framework                                        | Framework validation/error/serialization defaults make strict ASP.NET contract matching harder for only four routes.                              |
| Hand-authored goldens                                     | Encode the port author's expectations rather than the service's actual observable behavior.                                                       |
| Raw-byte-only JSON comparison                             | Treats object order/escaping as contract while still risking missed semantic field-presence assertions.                                           |
| Decoded-JSON-only comparison                              | Misses field omission, null/default distinctions, array order, status, headers, and exact error bodies.                                           |
| Rewrite or regex simplification                           | Changes overlapping-rule precedence and legacy quirks that affect scores and custom-format results.                                               |
| Big-bang deletion of C#                                   | Removes the only authoritative oracle and makes mismatch diagnosis and rollback expensive.                                                        |
| Permanent dual runtime                                    | Retains the .NET dependency and operational complexity, defeating issue #1.                                                                       |
| Unbounded stack/static regex work for theoretical parity  | Leaves an unauthenticated backtracking service vulnerable to availability attacks. Supported parity must be proven within finite measured bounds. |
| Goroutine per text-pattern cell                           | Lets caller-controlled cardinality explode CPU, memory, and goroutine count.                                                                      |
| Unbounded global regex cache                              | Lets attacker-controlled patterns create unbounded retained memory and cross-request complexity.                                                  |
| API redesign or new UI control plane                      | Explicitly out of scope and increases migration risk without improving parser parity.                                                             |
| Early `regexp2cg` or PGO                                  | Adds generated/build behavior before correctness; consider only after parity with benchmark evidence.                                             |

## Risk Assessment

| Risk                                                                                | Likelihood | Impact   | Mitigation and evidence                                                                                                                   |
| ----------------------------------------------------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Subtle .NET/regexp2 mismatch in Unicode, casing, captures, anchors, or replacements | High       | Critical | Oracle fixtures, focused compatibility wrapper, differential fuzz seeds, no cutover with any unexplained diff.                            |
| Parser rule order changes during translation                                        | Medium     | Critical | Line-oriented port, ordered pattern tables, branch-specific fixtures, code review against C# source.                                      |
| Catastrophic backtracking or stack exhaustion                                       | High       | Critical | Dynamic 100 ms timeout, finite stack/static budgets, checked errors, adversarial/load tests, global bounded work.                         |
| Batch cardinality multiplies bounded matches into prolonged exhaustion              | High       | Critical | Body/item/work-product limits, caller chunking, bounded workers/requests, early rejection, health-starvation test.                        |
| HTTP decoder/framework behavior differs from ASP.NET                                | High       | High     | Capture malformed/method/media-type cases, explicit handler behavior, hybrid transport assertions.                                        |
| `null`, empty slices, zero values, or enum names drift                              | Medium     | High     | Explicit DTOs/tags, no response omission, field-presence assertions, full model fixtures.                                                 |
| Date/culture/time-zone behavior differs by environment                              | Medium     | High     | Freeze oracle environment, pin/normalize runtime settings only where proven, test New Year/tomorrow and culture edges on all artifacts.   |
| Parser version fails to invalidate or incorrectly churns caches                     | Medium     | High     | Deliberate version policy, app-client cache tests, upgrade/rollback scenarios, log old/new version.                                       |
| Go cutover breaks standalone child lifecycle, especially Windows                    | Medium     | High     | Platform smoke tests for free-port launch, readiness, output prefix, parent exit, SIGTERM/Windows termination, unexpected exit.           |
| Docker/release path omits or misnames parser artifact                               | Medium     | High     | Matrix archive inspection and real start tests; preserve names and paths; checksum every archive.                                         |
| Logs leak titles or user regexes                                                    | High       | Medium   | Safe structured fields only; logging tests scan success/error/panic/shutdown output for fixture secrets.                                  |
| Network exposure of unauthenticated service                                         | Medium     | High     | Loopback default, Compose `expose`, explicit container bind, safe docs, no proxy/CORS, exposure test.                                     |
| Single-maintainer `regexp2` dependency changes behavior or stalls                   | Medium     | High     | Pin v2.3.0, dedicated upgrade PRs, module verification/vulnerability scan, contingency to audit/vendor/fork rather than switch semantics. |
| Supply-chain inputs are mutable or unverifiable                                     | Medium     | High     | Pin toolchain/images/Actions, `-mod=readonly`, reproducible builds, SBOM, provenance, checksums, notices.                                 |
| Security limits reject legitimate current workloads                                 | Medium     | High     | Measure PCD maxima, test one-at-limit cases, chunk in client, raise only finite limits with fixture evidence.                             |
| Performance improves footprint but regresses tail latency or timeout recovery       | Medium     | Medium   | Baseline .NET and compare startup/RSS/image plus p50/p95/p99 and 50-title batch under concurrency.                                        |
| C#/.NET references survive nominal cutover                                          | Medium     | Medium   | Final repository audit, clean-checkout build, no-dotnet CI environment, delete legacy project/build/docs inputs.                          |

## Validation, Rollout, and Rollback Criteria

### Validation criteria

The implementation is eligible for cutover only when:

- all checked-in domain, regex, HTTP, Unicode, date, duplicate, invalid,
  timeout, and adversarial fixtures pass with zero unexplained semantic diffs;
- response field presence, array order, exact error text, status, selected
  headers, and health version assertions pass independently of semantic JSON
  comparison;
- maximum legitimate batches pass under concurrency inside the established
  client/UI timing budgets, and one-over-limit requests reject before regex
  work;
- `/health` remains responsive during maximum allowed and adversarial load;
- race, vet, module verification, vulnerability, fuzz-seed, logging secrecy,
  slow-client, disconnect, shutdown, and resource tests pass;
- `gofmt` is clean, `go mod tidy` produces no diff, the repository-pinned
  toolchain is consistent in `go.mod`, `mise.toml`, Docker, and CI, and the
  existing Go tooling script remains compatible;
- Deno lint/check/unit/build and parser-dependent E2E tests pass;
- each target binary and container starts, reports the intended version, handles
  representative requests, shuts down, and has the expected name, permissions,
  exposure, and provenance;
- measured Go startup/footprint is improved without a material p95/p99 or
  cold-batch regression.

### Rollout criteria

1. Keep both implementations buildable during development, but allow only the
   .NET service to define expected fixtures.
2. Switch CI and development paths to exercise Go while differential CI still
   runs the oracle.
3. Build candidate Go image and standalone archives from the same commit and
   record their digests, checksums, SBOM, provenance, version, and smoke
   results.
4. Verify app cache invalidation, degraded operation, and recovery using the
   candidate artifacts.
5. Delete the oracle only in the final contraction after the above evidence is
   attached to #2-#5.
6. Update `ROADMAP.md` and issue checklists only as each issue's evidence-backed
   exit gate passes.
7. After merge/release, monitor health failures, parse domain-miss rate,
   invalid/timeout/stack error classes, app cache behavior, tail latency, batch
   failures, and child/container restarts without logging request contents.

### Rollback triggers

Rollback immediately for any reproducible parser/match semantic drift, cache
namespace collision, startup/archive omission, health/readiness regression,
unbounded resource behavior, sensitive log leak, supported-workload limit
rejection, or material latency/error regression.

### Rollback mechanism

- Before merge, revert the integration switch and continue using the retained C#
  oracle.
- After release, republish/redeploy the recorded previous parser image and
  standalone archive, or revert the cutover commit. Public host, port, image,
  executable, and API contracts remain stable, so no app configuration or
  database rollback is required.
- If the Go release used a new parser version, allow the app to repopulate
  caches under the restored version namespace; never rewrite cache data
  manually.
- Preserve the immutable golden corpus and candidate failure input so the
  regression becomes a required fixture before another cutover attempt.

## Concrete Decisions and Resolutions

1. **Strict parity scope:** decoded response semantics plus explicitly pinned
   transport behavior; object-member order is excluded unless consumer evidence
   establishes it as required. Array order, key strings, duplicate collapse,
   field presence, null/default values, and error text are included.
2. **Regex choice:** `regexp2/v2 v2.3.0` default .NET mode is mandatory.
   Standard `regexp`, RE2 mode, ECMAScript mode, and the compatibility adapter
   are prohibited for parser behavior.
3. **Failure mapping:** dynamic invalid pattern, timeout, or finite-stack
   failure returns `false` for that cell while siblings continue. Internal
   parser-operation failure produces the same absent or default movie/episode
   fields as the legacy service; neither case exposes engine errors.
4. **Resource parity resolution:** there will be no unbounded network-reachable
   regex path. Strict legacy behavior is guaranteed for the measured supported
   envelope; finite limits beyond it are a documented security contract. Limits
   are not final until issue #2 measurements and fixtures pass.
5. **Architecture:** replace in place with standard-library HTTP and explicit
   DTOs; keep C# only as a temporary oracle; full deletion is mandatory in issue
   #5.
6. **Concurrency:** compile unique request patterns once, publish them only
   after configuration, process through bounded workers, and merge maps under
   single ownership. Concurrency is an optimization and must not change results.
7. **Deployment contract:** public app configuration remains
   `PARSER_HOST`/`PARSER_PORT`; standalone Go configuration uses `PARSER_ADDR`;
   strict legacy `ASPNETCORE_URLS` parsing is transitional and removed after
   every launcher migrates unless a time-boxed compatibility release is
   approved.
8. **Binding:** loopback by default for standalone; explicit `:5000` in the
   private container; Compose does not publish the parser port.
9. **Version:** build-inject a deterministic value and intentionally bump at Go
   cutover unless product ownership explicitly requires retaining `1.0.0` after
   proving that cache mixing is safe.
10. **Optimization:** no regex generation, PGO, broad refactor, API redesign, or
    UI redesign enters the critical path. Correctness and safe bounded execution
    precede optimization.
11. **Package design:** begin with one cohesive internal parser package, one
    wire-contract package, and one HTTP adapter; split only after a genuinely
    independent API/ownership boundary emerges.
12. **Documentation and roadmap:** issue #5 is incomplete until
    operator/developer docs and `ROADMAP.md` describe Go as the sole parser
    runtime and no live instruction requires .NET.
13. **Definition of done:** parent issue #1 closes only after #2-#5 are
    complete, the PR is reviewed and fixed, CI is green, the PR is
    squash-merged, and its branch/worktree cleanup is verified.

## Future Enhancements

- A safe parser diagnostic endpoint or app view exposing reachability,
  build/version, queue state, and classified last error without input content.
- More precise app cancellation propagation so browser, SvelteKit, parser-client
  retry, and regex budgets form one coherent deadline hierarchy.
- Partial-batch coverage reporting and retry-missing behavior, if product design
  chooses to expose cached partial results.
- Scheduled time-bounded fuzzing and adversarial load jobs with minimized
  regression preservation.
- A reviewed long-term `regexp2` contingency (vendored audited source or
  maintained fork) if upstream stewardship changes.
- Benchmark-driven `regexp2cg`, PGO, or compiled-pattern packaging after parity
  remains green.
- Multi-architecture parser container publishing when the existing Docker
  workflow restores arm64.
- Stronger release reproducibility checks, archive attestations, and automated
  third-party notice generation across all Praxrr artifacts.

## Open Questions

1. Which exact .NET runtime patch, OS, culture/globalization mode, time zone,
   parser commit, and configuration define the authoritative oracle?
2. What measured PCD and UI maxima define supported text count, pattern count,
   byte lengths, unique keys, work product, request concurrency, and response
   size?
3. What final finite stack limit and static regex-operation timeout pass all
   legitimate fixtures and adversarial tests? The network service must not use
   an unlimited value.
4. Which exact 413, 429, or 503 statuses, bodies, headers, and retry policy
   represent security limits and overload outside the legacy supported envelope?
5. Does any real consumer require raw JSON property ordering, escaping, newline
   behavior, or ASP.NET Problem Details bytes beyond semantic JSON and selected
   transport metadata?
6. Should the Go cutover parser version be the next parser-specific version, the
   Praxrr release version, or another deterministic scheme? The recommendation
   is an intentional bump.
7. Is `ASPNETCORE_URLS` compatibility needed for one released rollback window,
   or can it be removed in the same PR after all in-repo launchers change?
8. What objective RSS, image/archive size, startup, p95/p99 latency, and
   50-title batch thresholds define successful resource reduction without UX
   regression?
9. Is cross-host parser deployment officially supported? If so, which
   surrounding component owns TLS and service authentication while the parser
   remains private and unauthenticated by default?
10. What graceful-shutdown deadline is valid for maximum supported work on
    Linux, macOS, and Windows?
11. Which parser-dependent Playwright scenarios are mandatory in every PR versus
    scheduled/full release CI?
12. Should the oracle generation tool remain able to run a tagged legacy
    container after C# deletion, or should the committed corpus become immutable
    and append-only?
13. Are availability/live-region UI refinements part of the migration PR, or
    separately tracked after behavior-preserving E2E coverage is established?
