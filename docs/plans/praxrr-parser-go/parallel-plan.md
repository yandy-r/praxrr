# Praxrr Parser Go Migration Implementation Plan

Replace the C# parser in place with a Go service that preserves all supported
parser, HTTP, deployment, cache, and artifact behavior. Freeze the current
service as a reproducible oracle before translation, then gate domain, HTTP,
consumer, and delivery activation on immutable fixtures and finite resource
limits. Keep the legacy implementation only until all Go artifacts pass parity,
security, lifecycle, and rollback checks, then remove every live .NET dependency
atomically. Execute this plan inside the existing `feat/praxrr-parser-go`
worktree.

The single toolchain source of truth is Go `1.26.5`; `go.mod` uses `go 1.25.0`
only as regexp2's minimum language compatibility while `toolchain go1.26.5`,
`mise.toml`, CI, Docker, and release builders pin `1.26.5`. Container stages
also pin the resolved image digest, and CI asserts that every surface agrees.
Every task finishes with focused tests and `git diff --check`; once the cutover
ledger exists, task evidence is appended there. Phase gates run every aggregate
command named by the gate task.

## Critically Relevant Files and Documentation

- `docs/plans/praxrr-parser-go/feature-spec.md`: Approved scope and design
  decisions.
- `docs/plans/praxrr-parser-go/shared.md`: Verified architecture, files,
  patterns, and docs.
- `docs/plans/praxrr-parser-go/research-security.md`: Mandatory finite-work and
  privacy constraints.
- `docs/plans/praxrr-parser-go/research-integration.md`: Cache, launcher,
  container, and release map.
- `packages/praxrr-parser/Endpoints/ParseEndpoints.cs`: Parse validation and
  response oracle.
- `packages/praxrr-parser/Endpoints/MatchEndpoints.cs`: Match/batch timeout and
  duplicate oracle.
- `packages/praxrr-parser/Models/Responses.cs`: Field-presence, null, empty, and
  enum contract.
- `packages/praxrr-parser/Parsers/QualityParser.cs`: Quality/revision
  precedence.
- `packages/praxrr-parser/Parsers/LanguageParser.cs`: Ordered language
  semantics.
- `packages/praxrr-parser/Parsers/ReleaseGroupParser.cs`: Release-group
  selection semantics.
- `packages/praxrr-parser/Parsers/TitleParser.cs`: Movie title and identifier
  behavior.
- `packages/praxrr-parser/Parsers/EpisodeParser.cs`: Highest-risk
  capture/date/range behavior.
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: Sole
  application client.
- `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`:
  Unversioned legacy cache.
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`: Standalone child
  lifecycle.
- `deno.json`: Stable developer and standalone task names.
- `Dockerfile.parser`: Parser image identity and health contract.
- `.github/workflows/compatibility.yml`: Pull-request quality gates.
- `.github/workflows/release.yml`: Five-platform archive matrix.
- `ROADMAP.md`: Evidence-backed issue completion record.

## Implementation Plan

### Per-Task Validation Contract

Every task runs the command below from the repository root (or the named package
directory), requires exit 0 plus `git diff --check`, and reports the exact
output in its task result. Task 5.5 consolidates all earlier results into
`cutover-evidence.md`; later tasks append their results there before the PR is
created.

| Task | Focused validation and required result                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Run `deno run -A scripts/capture-parser-goldens.ts --verify-recapture`; `cmp` outputs are byte-identical.                         |
| 0.2  | Run the capture script with `--categories parse,domain,unicode,date --validate`; every record has provenance/fields.              |
| 0.3  | Run the capture script with `--categories match,batch,http --validate`; zero errors and all transport cases classified.           |
| 0.4  | Run `deno run -A scripts/measure-parser-baseline.ts --repeat=2 --validate`; schema/variance/threshold approval pass.              |
| 1.1  | `go version`; `go mod tidy`; assert clean diff; `go mod verify`; `go test ./...` in the parser module.                            |
| 1.2  | `go test ./internal/contract`; every response field-presence/null/empty/enum case passes.                                         |
| 1.3  | `go test ./internal/parser -run 'Regex\|Limit'`; timeout/stack/overflow/log-secrecy cases pass.                                   |
| 1.4  | `go test ./internal/parser -run Common`; all common oracle categories pass.                                                       |
| 1.5  | `go test ./internal/parity -run Golden`; provenance and semantic/transport comparison pass.                                       |
| 1.6  | `go mod verify && go vet ./... && go test ./...`; zero skipped #2 criteria and import-guard violations.                           |
| 2.1  | `go test ./internal/parser -run Quality`; zero quality/revision fixture differences.                                              |
| 2.2  | `go test ./internal/parser -run Language`; all identifiers/order/duplicates match.                                                |
| 2.3  | `go test ./internal/parser -run ReleaseGroup`; all selection/rejection/null cases match.                                          |
| 2.4  | `go test ./internal/parser -run Title`; all movie/ID/edition/hash cases match.                                                    |
| 2.5  | `go test ./internal/parser -run Episode`; every rule/range/date/anime branch matches.                                             |
| 2.6  | `go test ./internal/parity -run 'Domain\|StaticSafety'`; zero unexplained diffs/import violations.                                |
| 3.1  | `go test ./internal/parser -run Service`; complete movie/series response fixtures match.                                          |
| 3.2  | `go test -race ./internal/parser -run Matcher`; max/one-over, duplicates, timeout, race, and leak cases pass.                     |
| 3.3  | `go test ./internal/httpserver -run Handler`; full HTTP oracle matrix passes.                                                     |
| 3.4  | `go test -race ./internal/httpserver ./cmd/praxrr-parser`; slow-client/load/signal/drain tests pass.                              |
| 3.5  | `go test -race ./internal/parity -run 'Differential\|Adversarial'` plus benchmarks/fuzz seeds; zero diffs/thresholds met.         |
| 4.1  | `deno test packages/praxrr-app/src/tests/server/parserCacheCutover.test.ts -A`; upgrade/rollback namespaces and log secrecy pass. |
| 4.2  | `deno test` the three named route suites with `-A`; healthy/miss/outage/recovery/max batch pass against Go.                       |
| 4.3  | Run `deno task dev:parser`, standalone Linux build/smoke, Windows build inspection, and `deno task check:dist-paths`; all pass.   |
| 4.4  | `cd packages/praxrr-app && npx playwright test src/tests/e2e/specs/4.*.spec.ts`; state/focus/live-region assertions pass.         |
| 5.1  | `docker build -f Dockerfile.parser -t praxrr-parser:test .` then container smoke; non-root/private/API pass.                      |
| 5.2  | Run `deno run -A` on both parser smoke scripts; every identity/lifecycle assertion passes.                                        |
| 5.3  | `bash scripts/check-parser-go.sh`; local and workflow command/path parity passes.                                                 |
| 5.4  | Invoke the PR artifact matrix and `deno run -A scripts/smoke-parser-release.ts`; five archives/native smokes/checksums pass.      |
| 5.5  | Run parser check, full Deno lint/check/test/build/E2E, Docker/archive smokes; ledger has no failed/missing gate.                  |
| 6.1  | Run retirement/check-parser scripts, full Deno gates/E2E, and artifact smokes in a no-dotnet environment.                         |
| 6.2  | Execute every parser README/contributor command and run Markdown/link checks; all instructions are true.                          |
| 6.3  | `bash scripts/check-parser-retirement.sh --docs && deno task format:check`; only explicit allowlists remain.                      |
| 6.4  | `deno task docs:build` plus link checks; published docs build without deleted references.                                         |
| 6.5  | Run `gh issue view` for #1-#5 plus PR/evidence audit; ROADMAP has no premature merged/green claim.                                |
| 7.1  | `git push` and `gh pr create --body-file`; `gh pr view` proves SHA/base/title/template and five close keywords.                   |
| 7.2  | Formal review artifact exists and every finding has severity, stable ID, evidence, and `Open` status.                             |
| 7.3  | Review artifact has zero actionable `Open`/`Failed` findings; focused and full validation pass on pushed HEAD.                    |
| 7.4  | `gh pr view --json statusCheckRollup,headRefOid`; checks succeed and local gates match that SHA.                                  |
| 7.5  | `gh pr merge --squash --delete-branch`; PR merged, commit on default, issues #1-#5 closed.                                        |
| 7.6  | `git worktree list`, `git branch -a`, and `git status`; feature state absent and default contains squash.                         |

### Phase 0: Freeze the Oracle and Supported Envelope (#2)

#### Task 0.1: Pin oracle provenance and regeneration Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Program.cs`
- `packages/praxrr-parser/Parser.csproj`
- `docs/plans/praxrr-parser-go/feature-spec.md`

**Instructions**

Files to Create

- `scripts/capture-parser-goldens.ts`
- `packages/praxrr-parser/tools/golden/README.md`
- `packages/praxrr-parser/testdata/golden/manifest.json`

Capture the exact source commit, .NET runtime/container, OS,
culture/globalization mode, time zone, configuration, and invocation. The tool
calls only the pinned legacy listener and records raw request/response evidence;
it must never derive expectations from Go. The Deno tool is available before the
nested Go module exists. Prove deterministic recapture with its
`--verify-recapture` mode.

#### Task 0.2: Capture parse and domain goldens Depends on [0.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Endpoints/ParseEndpoints.cs`
- `packages/praxrr-parser/Models/Responses.cs`
- `packages/praxrr-parser/Parsers/EpisodeParser.cs`

**Instructions**

Files to Create

- `packages/praxrr-parser/testdata/golden/parse.jsonl`
- `packages/praxrr-parser/testdata/golden/domain-edges.jsonl`
- `packages/praxrr-parser/testdata/golden/unicode-date.jsonl`

Record every response field/default/null/empty distinction and each domain
branch, near miss, repeated capture, Unicode/culture edge, tomorrow/year
boundary, and obfuscation/extension case. Store raw and decoded bodies plus
provenance and category.

#### Task 0.3: Capture match and HTTP goldens Depends on [0.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Endpoints/MatchEndpoints.cs`
- `packages/praxrr-parser/Endpoints/HealthEndpoints.cs`
- `docs/plans/praxrr-parser-go/research-external.md`

**Instructions**

Files to Create

- `packages/praxrr-parser/testdata/golden/match.jsonl`
- `packages/praxrr-parser/testdata/golden/match-batch.jsonl`
- `packages/praxrr-parser/testdata/golden/http.jsonl`

Capture required .NET constructs, invalid/catastrophic patterns, timeout
isolation, duplicate text/pattern keys, all routes,
malformed/null/wrong-type/trailing bodies, wrong methods/paths/media types, and
selected headers. Do not infer ASP.NET defaults.

#### Task 0.4: Measure legitimate limits and legacy baseline Depends on [0.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/simulate/impact/+server.ts`

**Instructions**

Files to Create

- `scripts/measure-parser-baseline.ts`
- `packages/praxrr-parser/testdata/golden/limits.json`
- `packages/praxrr-parser/testdata/golden/baseline.json`

Measure body, text, pattern, count, unique-key, and work-product maxima plus
margin; capture startup, idle RSS, binary/image size, 1/10/50-title cold/warm
latency, health under load, and shutdown. Define finite supported maximum and
one-over cases before implementing limits.

`limits.json` records the source fixture/UI route, observed maximum, hardware
and OS, runtime versions, sample count, p50/p95/p99, margin formula
`max(observed * 2, observed + fixed_headroom)`, chosen finite limit, client
deadline relationship, overflow case, and approval state for every dimension.
All known PCD fixtures and the UI maximum batch must pass. Acceptance requires
lower idle RSS and artifact size, startup no slower than legacy p95, p95/p99 and
cold-50 latency within 10% of legacy, health-under-load below 250 ms p95, and
graceful shutdown within 10 seconds.

### Phase 1: Go Contract, Regex Boundary, and Harness (#2)

#### Task 1.1: Pin the Go module and repository toolchain Depends on [0.1]

**READ THESE BEFORE TASK**

- `mise.toml`
- `scripts/go-tools.sh`
- `docs/plans/praxrr-parser-go/research-practices.md`

**Instructions**

Files to Create

- `packages/praxrr-parser/go.mod`
- `packages/praxrr-parser/go.sum`

Files to Modify

- `mise.toml`

Pin Go `1.26.5` via `toolchain go1.26.5`, regexp2/v2 `v2.3.0`, and a `go 1.25.0`
language directive. Propagate the same toolchain through `mise.toml` and later
CI/Docker/release tasks with an automated drift assertion. Establish tidy-clean,
read-only module, verify, build, format, vet, and test commands without
switching a live launcher.

#### Task 1.2: Define explicit wire contracts Depends on [0.2, 0.3, 1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Models/Requests.cs`
- `packages/praxrr-parser/Models/Responses.cs`
- `packages/praxrr-parser/Models/Types.cs`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/contract/request.go`
- `packages/praxrr-parser/internal/contract/response.go`
- `packages/praxrr-parser/internal/contract/types_test.go`

Define every request, health, parse/episode/revision, match/batch, and enum wire
value. Use explicit JSON tags, no accidental omission, initialized slices/maps,
and field-presence tests against the oracle for null/zero/empty and array
ordering.

#### Task 1.3: Centralize regexp2 and finite regex policy Depends on [0.3, 0.4, 1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Parsers/Common/RegexReplace.cs`
- `docs/plans/praxrr-parser-go/research-security.md`
- `docs/plans/praxrr-parser-go/research-external.md`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parser/regex.go`
- `packages/praxrr-parser/internal/parser/regex_test.go`
- `packages/praxrr-parser/internal/parser/limits.go`

Make this the sole regexp2 import. Support named/all captures, all matches, and
.NET replacements in default mode. Separate startup-fatal static patterns from
dynamic patterns whose invalid, 100 ms timeout, finite-stack, or engine failure
becomes `false`. Encode measured size/count/product/worker, static-operation,
stack, and timeout budgets with overflow-safe checks and content-free
diagnostics.

#### Task 1.4: Port common cleanup and replacement Depends on [0.2, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Parsers/Common/ParserCommon.cs`
- `packages/praxrr-parser/Parsers/Common/RegexReplace.cs`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parser/common.go`
- `packages/praxrr-parser/internal/parser/common_test.go`

Line-port extension allowlists, cleanup, character, hash, and replacement
semantics. Preserve current quirks and source order; add focused empty,
malformed, extension, whitespace, obfuscation, and Unicode fixtures before
resolving discrepancies.

#### Task 1.5: Implement immutable golden loading and comparison Depends on [0.2, 0.3, 1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/testdata/golden/manifest.json`
- `docs/plans/praxrr-parser-go/research-practices.md`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parity/golden.go`
- `packages/praxrr-parser/internal/parity/golden_test.go`

Load JSONL with provenance, reject missing or Go-authored expectations, compare
semantic JSON plus field presence/status/selected headers/raw errors, and
normalize only explicitly excluded transport data. Gate the phase with module
verification, unit tests, static compile checks, and import guards.

#### Task 1.6: Gate issue #2 foundation acceptance Depends on [1.2, 1.4, 1.5]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/go.mod`
- `packages/praxrr-parser/internal/parser/regex_test.go`
- `packages/praxrr-parser/internal/parity/golden_test.go`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parity/foundation_test.go`

Run `go mod tidy` with a clean-diff assertion, `go mod verify`, `go vet ./...`,
and `go test ./...` from `packages/praxrr-parser`. Assert all static regexes
compile, limits are measurement/provenance-bound, the corpus is regenerable, and
only the adapter imports regexp2. Record zero skipped requirements before #2 may
close.

### Phase 2: Ordered Domain Parser Parity (#3)

#### Task 2.1: Port quality and revision parsing Depends on [1.3, 1.4, 1.5, 1.6]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Parsers/QualityParser.cs`
- `packages/praxrr-parser/Models/Types.cs`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parser/quality.go`
- `packages/praxrr-parser/internal/parser/quality_test.go`

Preserve revision-first behavior, resolution/source/modifier precedence, early
returns, REAL/repack casing, repeated captures, and exact defaults. Minimize
every mismatch into the oracle corpus first.

#### Task 2.2: Port language parsing Depends on [1.3, 1.4, 1.5, 1.6]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Parsers/LanguageParser.cs`
- `packages/praxrr-parser/Models/Language.cs`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parser/language.go`
- `packages/praxrr-parser/internal/parser/language_test.go`

Preserve all identifiers, three-pass ordering, case rules, DL/ML behavior,
`Unknown`, duplicates, and stable first-occurrence distinct filtering. Never use
map iteration to produce output.

#### Task 2.3: Port release-group parsing Depends on [1.3, 1.4, 1.5, 1.6]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Parsers/ReleaseGroupParser.cs`
- `packages/praxrr-parser/Parsers/Common/ParserCommon.cs`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parser/releasegroup.go`
- `packages/praxrr-parser/internal/parser/releasegroup_test.go`

Preserve anime/exception/standard selection, last capture, cleanup,
numeric/episode/hash rejection, null behavior, and fail-closed outcomes without
logging input content.

#### Task 2.4: Port movie-title parsing Depends on [1.3, 1.4, 1.5, 1.6]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Parsers/TitleParser.cs`
- `packages/praxrr-parser/Models/Responses.cs`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parser/title.go`
- `packages/praxrr-parser/internal/parser/title_test.go`

Preserve ordered patterns, reversed/alternate titles, year, edition, IMDb/TMDb
IDs, hardcoded subs, release hashes, extension removal, Unicode
brackets/acronyms, and all movie defaults.

#### Task 2.5: Port episode parsing Depends on [1.3, 1.4, 1.5, 1.6]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Parsers/EpisodeParser.cs`
- `packages/praxrr-parser/Models/Responses.cs`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parser/episode.go`
- `packages/praxrr-parser/internal/parser/episode_test.go`

Preserve the full rule order, repeated named captures, range
rejection/expansion, absolute/anime/date/ daily/season-pack/miniseries/special
behavior, release types, broad fail-closed handling, and defaults. Require
branch-specific oracle assertions.

#### Task 2.6: Gate whole-domain parity and static safety Depends on [2.1, 2.2, 2.3, 2.4, 2.5]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/internal/parity/golden.go`
- `packages/praxrr-parser/internal/parser/limits.go`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parity/domain_test.go`
- `packages/praxrr-parser/internal/parity/static_safety_test.go`

Replay the full domain corpus, assert all static patterns compile at startup,
prohibit direct regexp2 and standard-regexp parser use outside the boundary,
test measured static budgets, and accept zero unexplained differences before
closing #3.

### Phase 3: Orchestration and HTTP Parity (#4)

#### Task 3.1: Compose parse orchestration Depends on [1.2, 2.6]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Endpoints/ParseEndpoints.cs`
- `packages/praxrr-parser/internal/contract/response.go`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parser/service.go`
- `packages/praxrr-parser/internal/parser/service_test.go`

Compose quality, languages, group, and movie-or-series parsing in legacy order.
Populate the complete outer response and exact movie/series defaults without
HTTP, environment, or logging globals.

#### Task 3.2: Implement bounded match scheduling Depends on [1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Endpoints/MatchEndpoints.cs`
- `packages/praxrr-parser/internal/parser/limits.go`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parser/matcher.go`
- `packages/praxrr-parser/internal/parser/matcher_test.go`

Compile distinct patterns once, reject oversized work before compilation, use
bounded workers and a single result collector, preserve duplicate collapse, and
isolate invalid/timeout/stack failures. Prove race freedom, bounded goroutines,
and health capacity.

#### Task 3.3: Implement exact handlers Depends on [1.5, 3.1, 3.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Endpoints/HealthEndpoints.cs`
- `packages/praxrr-parser/Endpoints/ParseEndpoints.cs`
- `packages/praxrr-parser/testdata/golden/http.jsonl`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/httpserver/handler.go`
- `packages/praxrr-parser/internal/httpserver/handler_test.go`

Implement the four routes with exact validation order/text, success fields,
duplicate behavior, malformed/method/media-type/path contract, pre-regex limits,
and safe metadata-only request logging.

#### Task 3.4: Implement server lifecycle and process entry Depends on [0.4, 3.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/Program.cs`
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`
- `docs/plans/praxrr-parser-go/research-security.md`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/httpserver/server.go`
- `packages/praxrr-parser/internal/httpserver/server_test.go`
- `packages/praxrr-parser/cmd/praxrr-parser/main.go`

Add explicit header/read/write/idle/shutdown deadlines, admission, cancellation,
panic recovery, loopback-safe defaults, graceful drain, deterministic version
injection, `PARSER_ADDR`, signals, safe logging, and exit codes. Keep
`ASPNETCORE_URLS` only as a temporary tested oracle bridge.

#### Task 3.5: Gate differential listener, adversarial, and performance parity Depends on [3.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-parser/testdata/golden/manifest.json`
- `packages/praxrr-parser/testdata/golden/baseline.json`
- `docs/plans/praxrr-parser-go/research-security.md`

**Instructions**

Files to Create

- `packages/praxrr-parser/internal/parity/differential_test.go`
- `packages/praxrr-parser/internal/parity/adversarial_test.go`
- `packages/praxrr-parser/internal/parity/benchmark_test.go`

Run pinned C# and Go listeners side by side over the full corpus. Gate #4 on
zero supported semantic/ selected-transport differences plus max/one-over,
catastrophic, concurrency, disconnect, race, fuzz-seed, health-under-load,
startup/RSS/latency, and shutdown evidence.

### Phase 4: Cache-Safe Consumer and Launcher Activation (#5)

#### Task 4.1: Namespace parser caches by behavior version Depends on [3.5]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`
- `packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`
- `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`
- `packages/praxrr-parser/cmd/praxrr-parser/main.go`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/server/parserCacheCutover.test.ts`

Files to Modify

- `packages/praxrr-parser/cmd/praxrr-parser/main.go`
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`
- `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`

Set `2.0.0-go.1` as the deterministic fallback and linker-injected cutover
behavior version. Include it in the match-cache namespace and make
health-version refresh testable rather than permanently process-cached. Redact
raw titles/text/patterns from existing app-client failure logs. Test
same/new-version hits, partial batches, restart, unavailable recovery, C#
rollback separation, and secret-shaped title/regex log output.

#### Task 4.2: Verify app consumers against the real Go service Depends on [4.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/routes/entityTestingEvaluateRoute.test.ts`
- `packages/praxrr-app/src/tests/routes/simulateScoreRoute.test.ts`
- `packages/praxrr-app/src/tests/routes/impactSimulatorRoute.test.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/tests/routes/entityTestingEvaluateRoute.test.ts`
- `packages/praxrr-app/src/tests/routes/simulateScoreRoute.test.ts`
- `packages/praxrr-app/src/tests/routes/impactSimulatorRoute.test.ts`

Add real-Go coverage beside stubs for healthy, domain miss, invalid/timeout
match, unavailable, restart/recovery, partial degradation, cache transition, and
maximum legitimate batches. Preserve input and unrelated results during outage.

#### Task 4.3: Cut developer and standalone launchers together Depends on [3.4, 4.2]

**READ THESE BEFORE TASK**

- `deno.json`
- `scripts/dev.ts`
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`

**Instructions**

Files to Modify

- `deno.json`
- `scripts/dev.ts`
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`

Replace dotnet watch/publish with Go run/build while preserving task names,
labeled output, repo-root `dist/`, adjacent names, free loopback port, readiness
budget, external parser mode, graceful degradation, and parent/child
termination. Remove launcher ASP.NET variables.

#### Task 4.4: Cover every parser-dependent UI and direct consumer Depends on [4.1, 4.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts`
- `packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts`
- `packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts`
- `packages/praxrr-app/src/tests/e2e/specs/4.4-score-simulator-ux-basics.spec.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/e2e/specs/4.5-parser-dependent-surfaces.spec.ts`

Files to Modify

- `packages/praxrr-app/src/tests/e2e/specs/4.4-score-simulator-ux-basics.spec.ts`

Files to Modify if acceptance tests expose a production gap

- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte`
- `packages/praxrr-app/src/routes/impact-simulator/[databaseId]/+page.svelte`
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.svelte`
- `packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.svelte`
- `packages/praxrr-app/src/routes/api/v1/parser/health/+server.ts`
- `packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts`

Exercise score/impact simulators, custom-format testing, quality-profile entity
testing, app parser health, and direct regex101 matching. Assert unavailable
versus domain miss versus invalid/timeout, input preservation,
latest-request-wins, bounded recovery, stale-result treatment, live-region
semantics, keyboard access, and focus preservation against the real Go service.

### Phase 5: Container, CI, Release, and Artifact Cutover (#5)

#### Task 5.1: Cut parser container and Compose development wiring Depends on [3.5, 4.1]

**READ THESE BEFORE TASK**

- `Dockerfile.parser`
- `compose.yml`
- `compose.dev.yml`

**Instructions**

Files to Modify

- `Dockerfile.parser`
- `compose.dev.yml`
- `.dockerignore`

Use a pinned Go builder and minimal non-root runtime while keeping image/service
identity, private port 5000, health, DNS, and app dependency. Watch Go
module/source files; do not publish the port or retain a .NET layer.

#### Task 5.2: Add reusable real-artifact smoke tooling Depends on [3.5, 5.1]

**READ THESE BEFORE TASK**

- `.github/workflows/release.yml`
- `.github/workflows/docker.yml`
- `docs/plans/praxrr-parser-go/research-integration.md`

**Instructions**

Files to Create

- `scripts/smoke-parser-artifact.ts`
- `scripts/smoke-parser-container.ts`

Start actual binaries/images; verify exact name, version, health, parse, match,
batch, non-root/private exposure, graceful termination, and checksums. Make the
scripts reusable locally and in CI.

#### Task 5.3: Make Go compatibility checks required Depends on [3.5, 4.2, 4.4]

**READ THESE BEFORE TASK**

- `.github/workflows/compatibility.yml`
- `docs/plans/praxrr-parser-go/feature-spec.md`

**Instructions**

Files to Create

- `scripts/check-parser-go.sh`

Files to Modify

- `.github/workflows/compatibility.yml`

Add pinned Go setup, format, tidy-clean, module verify, vet,
unit/golden/differential, race, adversarial/fuzz seeds, cross-build, Deno
consumer gates, and regex-import guards with correct path filters. Differential
runs only while the oracle is retained. Local and CI validation call the same
parser-specific script; generic `scripts/go-tools.sh` remains unchanged.

#### Task 5.4: Cut Docker publication and five release archives Depends on [5.2, 5.3]

**READ THESE BEFORE TASK**

- `.github/workflows/docker.yml`
- `.github/workflows/release.yml`
- `scripts/smoke-parser-artifact.ts`

**Instructions**

Files to Create

- `scripts/smoke-parser-release.ts`

Files to Modify

- `.github/workflows/compatibility.yml`
- `.github/workflows/docker.yml`
- `.github/workflows/release.yml`

Replace .NET/RID publishing with pinned `GOOS`/`GOARCH`, `CGO_ENABLED=0` builds
for Linux x64/arm64, macOS x64/arm64, and Windows x64. Preserve archive layout
and `praxrr-parser[.exe]`; smoke native artifacts/image and record checksums,
SBOM/provenance, and last known-good C# rollback identifiers. Use Linux, macOS,
and Windows native runners for startup, adjacent-binary discovery, health,
parse/match/batch, version, shutdown, and Windows parent-child termination;
cross-architecture artifacts still receive archive-layout/checksum inspection.
Expose this native matrix as a reusable `workflow_call` or PR-triggered required
workflow invoked by `compatibility.yml`; pre-retirement and pre-merge evidence
must not depend on a post-merge tag-only release run.

#### Task 5.5: Record complete pre-retirement acceptance Depends on [4.3, 5.1, 5.3, 5.4]

**READ THESE BEFORE TASK**

- `docs/plans/praxrr-parser-go/feature-spec.md`
- `docs/plans/praxrr-parser-go/parallel-plan.md`
- `docs/plans/praxrr-parser-go/research-security.md`

**Instructions**

Files to Create

- `docs/plans/praxrr-parser-go/cutover-evidence.md`

Record exact Go format/tidy/verify/vet/test/race/fuzz, full differential,
security/load/lifecycle, Deno lint/check/test/build, `deno task test:e2e:reset`,
the full `deno task test:e2e`, dist paths, container, all archives,
cache/rollback, performance, digests, and worktree cleanliness evidence. No
retirement proceeds on indirect proof.

### Phase 6: Retire .NET, Document, and Record Completion (#5 and #1)

#### Task 6.1: Retire the C# implementation atomically Depends on [5.5]

**READ THESE BEFORE TASK**

- `docs/plans/praxrr-parser-go/cutover-evidence.md`
- `docs/plans/praxrr-parser-go/research-docs.md`
- `packages/praxrr-parser/tools/golden/README.md`

**Instructions**

Files to Create

- `scripts/check-parser-retirement.sh`

Files to Modify

- `packages/praxrr-parser/`
- `.github/workflows/compatibility.yml`
- `scripts/check-parser-go.sh`
- `.gitignore`
- `.dockerignore`

Delete `Program.cs`, project/build/config files, endpoints, models, parsers,
logging, and every active dotnet/setup/RID/ASP.NET input only after acceptance.
Transition permanent CI from differential execution to immutable golden replay
and provenance validation. Retain the corpus/provenance. Search for `.cs`,
`.csproj`, `Directory.Build.props`, `dotnet`, `setup-dotnet`, `DOTNET_`, RID
fields, `ASPNETCORE_`, and deleted C# links with only historical-oracle and
`.NET-compatible regex` allowlists. Run a clean no-dotnet build/test/artifact
audit, the full E2E reset/suite, and Go/app smokes after deletion.

#### Task 6.2: Create parser source of truth and developer docs Depends on [6.1]

**READ THESE BEFORE TASK**

- `docs/plans/praxrr-parser-go/research-docs.md`
- `README.md`
- `docs/CONTRIBUTING.md`

**Instructions**

Files to Create

- `packages/praxrr-parser/README.md`

Files to Modify

- `README.md`
- `docs/CONTRIBUTING.md`

Document the four-route contract, .NET-compatible regexp2 semantics, finite
limits, safe logging, version/cache policy, fixture regeneration, Go commands,
container/standalone behavior, and rollback. Remove live .NET prerequisites
while retaining historical and compatibility language accurately.

#### Task 6.3: Update canonical agent and architecture documentation Depends on [6.1]

**READ THESE BEFORE TASK**

- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/architecture/data-flow.md`

**Instructions**

Files to Modify

- `CLAUDE.md`
- `.github/copilot-instructions.md`
- `docs/ARCHITECTURE.md`
- `docs/architecture/components.md`
- `docs/architecture/data-flow.md`

Point live structure/data flow at Go command, HTTP adapter, contract, parser,
caches, and corpus. Synchronize canonical instructions, remove deleted C# links,
and preserve optional degradation and the `.NET-compatible regex` syntax
promise.

#### Task 6.4: Update published docs and validate links Depends on [6.2, 6.3]

**READ THESE BEFORE TASK**

- `docs/site/src/content/docs/app/development.md`
- `docs/site/src/content/docs/getting-started/installation.md`
- `docs/site/src/content/docs/guides/troubleshooting.md`

**Instructions**

Files to Modify

- `docs/site/src/content/docs/app/development.md`
- `docs/site/src/content/docs/getting-started/installation.md`
- `docs/site/src/content/docs/app/architecture.md`
- `docs/site/src/content/docs/guides/troubleshooting.md`

Synchronize the Go toolchain, private health versus app health, classified
failure/limits, install, architecture, and recovery instructions. Run link/build
checks and preserve runtime-neutral API docs.

#### Task 6.5: Update ROADMAP and completion evidence Depends on [6.2, 6.3, 6.4]

**READ THESE BEFORE TASK**

- `ROADMAP.md`
- `docs/plans/praxrr-parser-go/cutover-evidence.md`
- `docs/plans/praxrr-parser-go/feature-spec.md`

**Instructions**

Files to Modify

- `ROADMAP.md`
- `docs/plans/praxrr-parser-go/cutover-evidence.md`

Record the implemented #2-#5 gates, parent #1 status,
parity/security/cache/artifact/docs/.NET retirement evidence, and the
PR/review/CI lifecycle as evidence becomes authoritative. Before merge,
reconcile the roadmap and issue checklists with the current PR; do not claim a
green/merged state early. The committed pre-merge wording is “implemented in PR,
pending review/CI/merge”; merged state and issue closure are verified after the
squash merge rather than predicted in source.

### Phase 7: PR, Review, CI, Merge, and Cleanup

#### Task 7.1: Commit, push, and create the template-backed PR Depends on [6.5]

**READ THESE BEFORE TASK**

- `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/plans/praxrr-parser-go/cutover-evidence.md`
- `ROADMAP.md`

**Instructions**

Files to Modify

None; this task changes Git and GitHub state only.

Run the complete local pre-push gate, stage deletions with `git add -A`, create
intentional conventional commits, and push `feat/praxrr-parser-go`. Create the
PR with a `--body-file` derived from the repository template, exact validation/
artifact/rollback evidence, and separate `Closes #1` through `Closes #5` lines.
Verify the PR base is the live default branch and the title passes repository
policy.

#### Task 7.2: Perform a formal PR code review Depends on [7.1]

**READ THESE BEFORE TASK**

- `docs/plans/praxrr-parser-go/feature-spec.md`
- `docs/plans/praxrr-parser-go/cutover-evidence.md`
- `docs/prps/reviews/`

**Instructions**

Files to Create

- `docs/prps/reviews/issue-1-parser-go-review.md`

Run the repository formal code-review workflow over the PR, including Go
domain/regex parity, security limits, cache behavior, TypeScript consumers,
Docker/release workflows, deletions, docs, and tests. Assign severity and stable
finding IDs/statuses, post the review through GitHub when the workflow requires,
and treat any uncertain parity claim as open.

#### Task 7.3: Fix every actionable review finding Depends on [7.2]

**READ THESE BEFORE TASK**

- `docs/prps/reviews/issue-1-parser-go-review.md`
- `docs/plans/praxrr-parser-go/cutover-evidence.md`

**Instructions**

Files to Modify

Files are determined by open review finding IDs.

Run the formal review-fix workflow, group non-overlapping fixes safely, update
each finding `Open -> Fixed/Failed` in place, rerun focused and full gates, and
commit/push the fixes. Resolve GitHub threads only after evidence proves the
finding fixed; zero actionable open findings is the exit gate. If review found
no actionable issues, still commit and push the review artifact so CI and merge
validation run against the reviewed SHA.

#### Task 7.4: Monitor and repair CI until green Depends on [7.3]

**READ THESE BEFORE TASK**

- `.github/workflows/compatibility.yml`
- `.github/workflows/docker.yml`
- `.github/workflows/release.yml`

**Instructions**

Files to Modify

Files are determined only by reproducible code-caused CI failures.

Monitor the PR status rollup until every required check is successful. For each
failure, inspect the authoritative Actions log, reproduce locally when possible,
fix the root cause, rerun the affected full gate, push, and resume monitoring.
The required rollup must include the PR-invoked Linux/macOS/Windows parser
artifact matrix from Task 5.4. Before merge rerun `deno task test:e2e:reset`
plus full `deno task test:e2e`, the parser check script, app
lint/check/test/build, artifact smokes, and review-open finding audit. External
pending review bots are monitored but not treated as code failures.

#### Task 7.5: Squash merge and verify issue closure Depends on [7.4]

**READ THESE BEFORE TASK**

- `.github/PULL_REQUEST_TEMPLATE.md`
- `ROADMAP.md`

**Instructions**

Files to Modify

None; this task changes GitHub state only.

Confirm required checks are green, the PR is mergeable, all actionable review
threads are resolved, and closure keywords/checklists cover #1-#5. Squash merge,
verify the merged commit is on the default branch, verify child issues #2-#5 and
parent #1 are closed with their acceptance checklists represented, and record
the final PR/commit evidence externally without making a false post-merge source
edit.

#### Task 7.6: Clean local and remote feature state Depends on [7.5]

**READ THESE BEFORE TASK**

- `docs/plans/praxrr-parser-go/cutover-evidence.md`

**Instructions**

Files to Modify

None; this task changes Git/worktree state only.

Fetch/prune the default checkout, verify it contains the squash commit, remove
the remote feature branch if GitHub did not, remove the dedicated
`praxrr-issue-1-parser-go` worktree, delete the local feature branch, and verify
`git worktree list`, local/remote branch listings, clean default checkout,
merged PR state, and closed issue states. Never delete unrelated worktrees or
branches.

## Advice

- Preserve the oracle until the real Go container and archives pass; deleting C#
  earlier destroys the only authoritative discrepancy debugger.
- Minimize each C#/Go mismatch into a provenance-bearing fixture before changing
  code; never let Go generate its own expected outputs.
- Keep all regexp2 use behind one adapter and all work limits in one reviewed
  policy; an isolated 100 ms timeout does not bound request-level batch
  multiplication.
- Treat cache activation as deployment behavior. The current match cache is not
  versioned, so a parser version bump alone cannot prevent stale C# regex
  decisions.
- Preserve stable endpoint, image, port, service, environment, and executable
  names so rollback is an artifact switch, not a configuration or database
  migration.
- Smoke actual staged artifacts. Cross-compilation or a Docker build exit code
  does not prove archive layout, startup, version, health, request behavior, or
  shutdown.
- Keep logs content-free: titles, regexes, captures, request bodies, and
  hostnames are private or high-cardinality. Use counts, durations, safe rule
  IDs, classifications, and fingerprints.
- Final retirement searches must distinguish obsolete runtime claims from the
  still-required phrase `.NET-compatible regex` and historical oracle
  provenance.
- Run formal PR review only after the full cutover diff exists, then fix every
  actionable finding, rerun focused plus full gates, and wait for required CI
  before squash merge and cleanup.
