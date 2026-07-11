# Task Structure Analysis

## Executive Summary

Implement issues #2-#5 as one oracle-backed expand-and-contract migration in the
existing `praxrr-parser-go` feature worktree. The recommended structure is 35
stable tasks across seven gated phases. Most tasks own one production file and
one focused test file; integration and documentation tasks own at most three
files. The only intentional wide task is final C# retirement, because deleting
the legacy implementation must be one auditable contraction after every parity,
security, cache, artifact, review, and rollback gate has passed.

The critical path is:

```text
oracle provenance -> immutable corpus -> Go contract/regex foundation -> domain parity
-> HTTP/differential parity -> cache-safe consumer activation -> delivery cutover
-> artifact/security evidence -> C# deletion -> live docs/ROADMAP truth
```

Do not split the implementation across worktrees or introduce a permanent Go/C#
runtime selector. All tasks use the one shared feature worktree. C# remains
buildable only as the pinned oracle through issues #2-#4 and the pre-retirement
portion of #5. Every behavior discrepancy becomes an oracle fixture before code
changes; no Go-generated output may become its own expected result.

## Recommended Phase Structure

### Phase 0 — Issue #2: freeze the oracle and supported envelope

#### P0-T01 — Pin oracle provenance and regeneration contract

**Files (3):** `packages/praxrr-parser/tools/golden/main.go` (new),
`packages/praxrr-parser/testdata/golden/manifest.json` (new),
`packages/praxrr-parser/tools/golden/README.md` (new).

**Depends on:** none.

Capture the exact source commit, .NET/runtime patch, image or SDK identity, OS,
culture, globalization mode, time zone, parser version, and invocation needed to
reproduce oracle output. The tool must call only the pinned C# service and
record raw request/response evidence; it must not contain Go parser
expectations. Prove a second capture from the same environment is
byte-identical.

#### P0-T02 — Capture parse and domain oracle corpus

**Files (3):** `packages/praxrr-parser/testdata/golden/parse.jsonl` (new),
`packages/praxrr-parser/testdata/golden/domain-edges.jsonl` (new),
`packages/praxrr-parser/testdata/golden/unicode-date.jsonl` (new).

**Depends on:** P0-T01.

Capture every response field, enum/default, null/empty distinction, ordered
language/capture result, movie and series branch, domain miss,
extension/obfuscation case, Unicode/culture edge, repeated capture, tomorrow,
and year-boundary case. Each record carries provenance/category/notes and raw
plus decoded response evidence.

#### P0-T03 — Capture match and HTTP oracle corpus

**Files (3):** `packages/praxrr-parser/testdata/golden/match.jsonl` (new),
`packages/praxrr-parser/testdata/golden/match-batch.jsonl` (new),
`packages/praxrr-parser/testdata/golden/http.jsonl` (new).

**Depends on:** P0-T01.

Capture .NET regex constructs, replacement/capture behavior, duplicate
pattern/text collapse, invalid and catastrophic patterns, sibling isolation, and
all four routes. Include malformed, empty, null, wrong-type, trailing,
wrong-method, unknown-path, content-type, selected-header, and observed
body-limit cases rather than assuming `net/http` behavior.

#### P0-T04 — Measure legitimate workloads, limits, and legacy baseline

**Files (2):** `packages/praxrr-parser/testdata/golden/limits.json` (new),
`packages/praxrr-parser/testdata/golden/baseline.json` (new).

**Depends on:** P0-T01.

Measure repository/UI maxima for body bytes, text and pattern lengths/counts,
text-pattern product, cold/warm 1/10/50-title batches, startup, idle RSS,
image/binary size, latency, health-under-load, and shutdown. Record proposed
supported limits with margin and one-over-limit cases. This evidence is the
prerequisite for finite HTTP, worker, regex-stack, and operation budgets;
theoretical parity is not permission to leave unauthenticated work unbounded.

**Phase gate:** the pinned oracle can reproducibly regenerate the committed
corpus, and the supported finite envelope and baseline are reviewed before Go
behavior is implemented.

### Phase 1 — Issue #2: Go foundation, contract, and parity harness

#### P1-T01 — Pin the Go module and toolchain

**Files (3):** `packages/praxrr-parser/go.mod` (new),
`packages/praxrr-parser/go.sum` (new), `mise.toml`.

**Depends on:** P0-T01.

Pin the supported Go 1.25 patch and `github.com/dlclark/regexp2/v2@v2.3.0`;
commit authenticated module hashes. Establish read-only module, tidy-clean,
verify, build, and test commands without changing any live launcher yet.

#### P1-T02 — Define exact wire contracts

**Files (3):** `packages/praxrr-parser/internal/contract/request.go` (new),
`packages/praxrr-parser/internal/contract/response.go` (new),
`packages/praxrr-parser/internal/contract/types_test.go` (new).

**Depends on:** P1-T01, P0-T02, P0-T03.

Define explicit requests, parse/episode/revision responses, health, match,
batch, enum wire names, and JSON tags. Avoid accidental `omitempty`; test every
field's presence plus null, zero, empty array, empty object, and ordering
behavior against the oracle corpus.

#### P1-T03 — Centralize the regexp2 compatibility boundary

**Files (2):** `packages/praxrr-parser/internal/parser/regex.go` (new),
`packages/praxrr-parser/internal/parser/regex_test.go` (new).

**Depends on:** P1-T01, P0-T03, P0-T04.

Make this the only direct regexp2 import. Support named groups, all
captures/matches in order, replacement, and only proven options in default .NET
mode. Separate startup-fatal static patterns from caller patterns whose compile,
100 ms timeout, and finite-stack failures map to `false`. Configure timeout
checking once, inspect every error, never log input/pattern content, and test
Unicode/rune, lookaround, backreference, atomic, inline-option, and
repeated-capture behavior.

#### P1-T04 — Port common cleanup and replacement semantics

**Files (2):** `packages/praxrr-parser/internal/parser/common.go` (new),
`packages/praxrr-parser/internal/parser/common_test.go` (new).

**Depends on:** P1-T03, P0-T02.

Line-port extension allowlists, cleanup, hash/title helpers, and .NET
replacement semantics without reordering or opportunistic fixes. Cover empty,
malformed, extension, obfuscation, whitespace, and Unicode fixtures.

#### P1-T05 — Implement the immutable golden loader

**Files (2):** `packages/praxrr-parser/internal/parity/golden.go` (new),
`packages/praxrr-parser/internal/parity/golden_test.go` (new).

**Depends on:** P1-T02, P0-T02, P0-T03.

Load JSONL plus provenance, compare decoded semantic bodies and exact field
presence/status/selected headers/raw error bodies, and reject missing or
Go-authored provenance. Normalize only explicitly excluded transport data such
as JSON object-member order and nondeterministic headers.

#### P1-T06 — Codify finite limits and safe error classes

**Files (2):** `packages/praxrr-parser/internal/parser/limits.go` (new),
`packages/praxrr-parser/internal/parser/limits_test.go` (new).

**Depends on:** P0-T04, P1-T03.

Encode reviewed text/pattern/count/product, worker, static-operation, stack, and
timeout budgets with stable classifications. Test exact maximum and one-over
boundaries, overflow-safe product checks, and metadata-only error rendering.
HTTP body/concurrency enforcement is wired later, but it must consume these
decisions rather than invent new limits.

**Phase gate:** `go mod verify`, `go test ./...`, static-regex compilation,
corpus-loader integrity, and dependency/import guards pass; no domain or HTTP
implementation is required yet.

### Phase 2 — Issue #3: ordered domain parser parity

These tasks may start in parallel after Phase 1. Each must preserve C# source
order and recognizable rule names, use only P1-T03 for regex operations, and add
any discovered mismatch to the oracle corpus before changing the port.

#### P2-T01 — Port quality and revision parsing

**Files (2):** `packages/praxrr-parser/internal/parser/quality.go` (new),
`packages/praxrr-parser/internal/parser/quality_test.go` (new).

**Depends on:** P1-T03, P1-T04, P1-T05.

Preserve resolution/source/modifier precedence, early returns, repeated
resolution captures, revision/repack/REAL case behavior, and exact
unknown/default enum outputs.

#### P2-T02 — Port language parsing

**Files (2):** `packages/praxrr-parser/internal/parser/language.go` (new),
`packages/praxrr-parser/internal/parser/language_test.go` (new).

**Depends on:** P1-T03, P1-T04, P1-T05.

Preserve all 59 identifiers, source insertion order, stable distinct filtering,
casing, and duplicate behavior. Do not iterate a map to produce output.

#### P2-T03 — Port release-group parsing

**Files (2):** `packages/praxrr-parser/internal/parser/releasegroup.go` (new),
`packages/praxrr-parser/internal/parser/releasegroup_test.go` (new).

**Depends on:** P1-T03, P1-T04, P1-T05.

Preserve last-match/capture selection, extension cleanup, exception removal,
null behavior, and fail-closed outcomes without leaking title/group content into
logs.

#### P2-T04 — Port movie-title parsing

**Files (2):** `packages/praxrr-parser/internal/parser/title.go` (new),
`packages/praxrr-parser/internal/parser/title_test.go` (new).

**Depends on:** P1-T03, P1-T04, P1-T05.

Preserve ordered report-title rules, alternate titles, year, edition, IMDB/TMDB
IDs, hardcoded subtitles, hashes, extensions, Unicode, and movie defaults
exactly.

#### P2-T05 — Port episode parsing

**Files (2):** `packages/praxrr-parser/internal/parser/episode.go` (new),
`packages/praxrr-parser/internal/parser/episode_test.go` (new).

**Depends on:** P1-T03, P1-T04, P1-T05.

Preserve the complete regex list order, repeated named captures,
season/episode/range expansion,
absolute/anime/daily/date/season-pack/miniseries/special/release-type behavior,
and domain-miss defaults. This is the highest-risk parser and must have
branch-specific oracle assertions.

#### P2-T06 — Run whole-domain parity and static safety gates

**Files (2):** `packages/praxrr-parser/internal/parity/domain_test.go` (new),
`packages/praxrr-parser/internal/parity/static_safety_test.go` (new).

**Depends on:** P2-T01, P2-T02, P2-T03, P2-T04, P2-T05, P1-T06.

Replay the complete domain corpus, assert all static patterns compile at
startup, enforce the single regexp2 boundary/no standard `regexp` rule, and test
measured static-operation limits. Any unexplained difference blocks issue #3
completion.

**Phase gate:** zero unexplained semantic diffs across every domain fixture, all
enum/default and ordered-capture contracts covered, and static work bounded
without changing supported outputs.

### Phase 3 — Issue #4: orchestration, match scheduling, and HTTP parity

#### P3-T01 — Compose parse orchestration

**Files (2):** `packages/praxrr-parser/internal/parser/service.go` (new),
`packages/praxrr-parser/internal/parser/service_test.go` (new).

**Depends on:** P2-T06, P1-T02.

Compose quality, languages, release group, and movie-or-series results in the
exact legacy order. Always populate the complete outer response and preserve
movie/series defaults and episode nullness; keep this layer independent of HTTP,
environment, and logging globals.

#### P3-T02 — Implement bounded match and batch execution

**Files (2):** `packages/praxrr-parser/internal/parser/matcher.go` (new),
`packages/praxrr-parser/internal/parser/matcher_test.go` (new).

**Depends on:** P1-T03, P1-T06.

Compile each distinct caller pattern once per request, use a bounded worker pool
and one result-map collector, preserve duplicate-key collapse, and isolate
invalid/timeout/stack failures as `false`. Reject oversized work before
compilation and prove no goroutine growth, race, or health starvation.

#### P3-T03 — Implement exact HTTP handlers

**Files (2):** `packages/praxrr-parser/internal/httpserver/handler.go` (new),
`packages/praxrr-parser/internal/httpserver/handler_test.go` (new).

**Depends on:** P3-T01, P3-T02, P1-T05.

Implement `GET /health`, `POST /parse`, `POST /match`, and `POST /match/batch`
with exact validation order/text, decoded success shapes, duplicate behavior,
and measured malformed/method/media-type/path contract. Enforce
body/item/product/concurrency limits before regex work. Logs contain only route,
counts, duration, and stable error classes.

#### P3-T04 — Implement listener policy and graceful lifecycle

**Files (2):** `packages/praxrr-parser/internal/httpserver/server.go` (new),
`packages/praxrr-parser/internal/httpserver/server_test.go` (new).

**Depends on:** P3-T03, P0-T04.

Configure explicit header/read/write/idle/shutdown deadlines, bounded request
admission, panic recovery, loopback-safe defaults, cancellation, graceful drain,
and responsive health under load. Test slow clients, disconnects, overload,
signals, and shutdown without payload logging.

#### P3-T05 — Add the versioned process entry point

**Files (2):** `packages/praxrr-parser/cmd/praxrr-parser/main.go` (new),
`packages/praxrr-parser/cmd/praxrr-parser/main_test.go` (new).

**Depends on:** P3-T04.

Own address/environment parsing, deterministic fallback version, build-time
version injection, structured safe logging, signals, and exit codes. Support
`PARSER_ADDR`; tolerate `ASPNETCORE_URLS` only as a temporary, tested
coexistence bridge and do not make it part of the final contract.

#### P3-T06 — Differential real-listener and adversarial gate

**Files (3):** `packages/praxrr-parser/internal/parity/differential_test.go`
(new), `packages/praxrr-parser/internal/parity/adversarial_test.go` (new),
`packages/praxrr-parser/internal/parity/benchmark_test.go` (new).

**Depends on:** P3-T05, P0-T04.

Run pinned C# and Go listeners on separate loopback ports, replay the full
corpus, and compare semantic JSON plus exact selected transport behavior. Run
maximum/one-over, catastrophic regex, parallel/disconnect, race, fuzz-seed,
health-under-load, startup/RSS/latency, and shutdown tests.

**Phase gate:** zero supported-request and selected-framework diffs; finite
over-limit rejection is stable and pre-work; `go test`, race, vet, fuzz seeds,
load, leak, lifecycle, and performance acceptance gates pass. Issue #4 cannot
close on handler unit tests alone.

### Phase 4 — Issue #5: cache-safe consumer activation

#### P4-T01 — Namespace both parser caches by cutover behavior

**Files (3):** `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`,
`packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`,
`packages/praxrr-app/src/tests/server/parserCacheCutover.test.ts` (new).

**Depends on:** P3-T06.

Select a deterministic Go behavior version distinct from the C# version.
Preserve parsed-cache same-version hits/new-version misses and add the version
to the pattern-match namespace (or perform an explicitly equivalent one-time
invalidation) so stale C# decisions cannot survive the switch or rollback. Test
partial cached batch behavior, restart/version refresh, Go-to-C# rollback
separation, and unavailable recovery. Do not change app enum mappings or retry
budgets without oracle evidence.

#### P4-T02 — Verify existing app consumers against the real Go service

**Files (3):**
`packages/praxrr-app/src/tests/routes/entityTestingEvaluateRoute.test.ts`,
`packages/praxrr-app/src/tests/routes/simulateScoreRoute.test.ts`,
`packages/praxrr-app/src/tests/routes/impactSimulatorRoute.test.ts`.

**Depends on:** P4-T01.

Add real-Go contract coverage beside existing stubs for healthy, domain miss,
unavailable, restart, bounded recovery, partial degradation, invalid/timeout
match cells, and maximum legitimate batches. Keep current feature inputs and
unrelated results available during outage.

#### P4-T03 — Cut developer and standalone launchers together

**Files (3):** `deno.json`, `scripts/dev.ts`,
`packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`.

**Depends on:** P4-T02, P3-T05.

Replace dotnet watch/publish with Go run/build while preserving task names,
labeled output, adjacent `praxrr-parser[.exe]` discovery, selected free loopback
port, readiness budget, optional external parser behavior, parent/child
termination, and repo-root `dist/` outputs. Remove launcher use of ASP.NET
variables once `PARSER_ADDR` works everywhere.

**Phase gate:** app cache and route suites pass against Go; developer,
external-parser, Linux standalone, and Windows standalone lifecycle tests prove
the activation is invisible to consumers.

### Phase 5 — Issue #5: container, CI, release, and artifact cutover

#### P5-T01 — Cut the parser container and Compose development wiring

**Files (3):** `Dockerfile.parser`, `compose.dev.yml`, `.dockerignore`.

**Depends on:** P4-T03.

Use a pinned Go builder and minimal non-root UID/GID 1000 runtime while
preserving image/service identity, private port 5000, DNS, health path, and
Praxrr health dependency. Watch Go module/source files in development; do not
publish the parser port or retain a .NET runtime/SDK layer.

#### P5-T02 — Add reusable real-artifact smoke tooling

**Files (2):** `scripts/smoke-parser-artifact.ts` (new),
`scripts/smoke-parser-container.ts` (new).

**Depends on:** P5-T01, P3-T06.

Start actual binaries/images, verify version, health, representative
parse/match/batch, non-root and private exposure, graceful termination, exact
executable names, and checksums. Make the scripts usable locally and from CI;
cross-compilation alone is not acceptance evidence.

#### P5-T03 — Make Go compatibility checks required

**Files (2):** `.github/workflows/compatibility.yml`, `scripts/go-tools.sh`.

**Depends on:** P3-T06, P4-T02.

Add path-aware pinned-Go setup, formatting, tidy-clean, module verification,
vet, unit/golden, differential-while-oracle-exists, race, adversarial/fuzz-seed,
cross-build, and Deno consumer gates. Fail direct regexp2 imports outside the
compatibility boundary and standard-regexp parser use.

#### P5-T04 — Cut Docker publication and release archives

**Files (3):** `.github/workflows/docker.yml`, `.github/workflows/release.yml`,
`scripts/smoke-parser-release.ts` (new).

**Depends on:** P5-T02, P5-T03.

Replace .NET/RID publishing with pinned `GOOS`/`GOARCH`, `CGO_ENABLED=0` builds
for Linux x64/arm64, macOS x64/arm64, and Windows x64 while retaining archive
layout and `praxrr-parser[.exe]`. Smoke native artifacts and the image; inspect
every archive, record checksums, SBOM/provenance, and the last known-good C#
image/archive rollback identifiers.

#### P5-T05 — Run full pre-retirement acceptance

**Files (1):** `docs/plans/praxrr-parser-go/cutover-evidence.md` (new).

**Depends on:** P4-T03, P5-T01, P5-T03, P5-T04.

Record exact commands/results for Go format/tidy/verify/vet/test/race/fuzz
seeds; full differential, security/load/lifecycle; all Deno
lint/check/test/build and parser-dependent E2E; `check:dist-paths`; container;
all five archives; cache/rollback; tracked-source cleanliness; and accepted
performance comparison. Evidence must identify artifact digests/checksums and
prove no supported regression.

**Phase gate:** every build/runtime surface uses Go, required checks are green,
real artifacts pass, the rollback artifact is recorded, and the immutable corpus
can outlive C# source deletion.

### Phase 6 — Issue #5 and parent #1: retirement, documentation, and completion

#### P6-T01 — Retire the legacy implementation atomically

**Files (wide deletion exception):** all
`packages/praxrr-parser/{Program.cs,Parser.csproj,Directory.Build.props,appsettings.json}`
and `packages/praxrr-parser/{Endpoints,Models,Parsers,Logging}/**/*.cs`; update
`.gitignore` only if a retired .NET-only artifact rule remains.

**Depends on:** P5-T05.

Delete C# only now. Remove all active `dotnet`, `setup-dotnet`,
`DOTNET_VERSION`, RID, `ASPNETCORE_*`, SDK/runtime image, and C# build inputs.
Retain only immutable fixture provenance and clearly historical planning/oracle
references. Run a clean-checkout, no-dotnet build/test/artifact audit and repeat
the complete Go/app smoke subset after deletion.

#### P6-T02 — Update developer and operator documentation

**Files (3):** `README.md`, `docs/CONTRIBUTING.md`, `docs/DEVELOPMENT.md`.

**Depends on:** P6-T01.

Replace live .NET prerequisites/commands with pinned Go workflows, limits,
fixture regeneration, private binding, standalone/container behavior,
cache/version policy, and troubleshooting. Preserve the term “.NET-compatible
regex” where it describes syntax rather than implementation.

#### P6-T03 — Update architecture documentation

**Files (3):** `docs/ARCHITECTURE.md`, `docs/architecture/components.md`,
`docs/architecture/data-flow.md`.

**Depends on:** P6-T01.

Point component/data-flow references at the Go command, HTTP adapter, contract,
parser, cache, and oracle corpus. Remove live links to deleted `.cs` files while
retaining optional-service degradation and deployment identity.

#### P6-T04 — Update published site documentation

**Files (3):** `docs/site/src/content/docs/app/development.md`,
`docs/site/src/content/docs/getting-started/installation.md`,
`docs/site/src/content/docs/app/architecture.md`.

**Depends on:** P6-T02, P6-T03.

Synchronize supported toolchain, installation, architecture, and operator
expectations with the sole Go implementation. Validate internal links and the
docs build.

#### P6-T05 — Record ROADMAP completion last

**Files (1):** `ROADMAP.md`.

**Depends on:** P6-T02, P6-T03, P6-T04 and final PR review/fix plus green CI
evidence.

Replace deferred/low-priority language, record evidence-backed delivery for #2,

# 3, #4, and #5, and check parent #1 only after all child issue checklists, final

PR review findings, fixes, required CI, artifact gates, C# deletion, and
live-documentation audits are complete. ROADMAP state must reflect evidence, not
predict it.

**Final gate:** active-source/docs/workflow searches show no shipped .NET parser
dependency; all issue acceptance criteria and PR review findings are resolved;
CI is green; the Go parser is the only implementation; `ROADMAP.md` and GitHub
issue/PR state agree.

## Task Granularity Recommendations

- Keep domain ports one implementation file plus one focused test. Their rule
  order and fixture ownership are independently reviewable, and P2-T01 through
  P2-T05 are file-disjoint.
- Keep `contract`, `parser`, and `httpserver` as the only internal ownership
  boundaries. Do not create a package per domain parser or generic `models`,
  `utils`, or `common` packages.
- Treat fixture generation and fixture consumption as separate tasks. P0 tasks
  own oracle-produced data; P1-T05 owns comparison mechanics. This prevents the
  Go implementation from blessing itself.
- Split handler, server lifecycle, and process entry point. Each has different
  failure modes and tests, while their dependency direction remains
  `cmd -> httpserver -> parser -> contract`.
- Keep cache cutover in one three-file task because parser version selection and
  pattern-match invalidation must activate atomically. Splitting them permits
  stale C# decisions to leak into Go.
- Keep developer launcher changes together (`deno.json`, `scripts/dev.ts`,
  `spawn.ts`) because the address, port, executable, readiness, and shutdown
  contracts must change in lockstep.
- Make P6-T01 the sole wide exception. Mechanical C# deletion spread across
  earlier tasks would destroy the oracle and make a nominally reversible
  migration irreversible too soon.
- Never parallelize tasks that edit the same file in the shared worktree.
  Parallel-ready batches are listed below; integrate and validate each batch
  before opening the next.

## Dependency Analysis

```text
P0-T01 -> {P0-T02, P0-T03, P0-T04, P1-T01}
P1-T01 + P0-T02 + P0-T03 -> P1-T02
P1-T01 + P0-T03 + P0-T04 -> P1-T03
P1-T03 + P0-T02 -> P1-T04
P1-T02 + P0-T02 + P0-T03 -> P1-T05
P0-T04 + P1-T03 -> P1-T06

{P1-T03, P1-T04, P1-T05} -> {P2-T01, P2-T02, P2-T03, P2-T04, P2-T05}
{P2-T01..P2-T05, P1-T06} -> P2-T06
P2-T06 + P1-T02 -> P3-T01
P1-T03 + P1-T06 -> P3-T02
P3-T01 + P3-T02 + P1-T05 -> P3-T03 -> P3-T04 -> P3-T05 -> P3-T06

P3-T06 -> P4-T01 -> P4-T02 -> P4-T03
P4-T03 -> P5-T01 -> P5-T02
P3-T06 + P4-T02 -> P5-T03
P5-T02 + P5-T03 -> P5-T04
{P4-T03, P5-T01, P5-T03, P5-T04} -> P5-T05

P5-T05 -> P6-T01 -> {P6-T02, P6-T03}
{P6-T02, P6-T03} -> P6-T04
{P6-T02, P6-T03, P6-T04, review/fix, green CI} -> P6-T05
```

Recommended dependency-safe batches:

1. P0-T01.
2. P0-T02, P0-T03, P0-T04, and P1-T01 in parallel after provenance is fixed.
3. P1-T02, P1-T03, and P1-T05 in parallel; then P1-T04 and P1-T06.
4. P2-T01 through P2-T05 in parallel; then P2-T06.
5. P3-T01 and P3-T02 in parallel; then P3-T03 through P3-T06 sequentially.
6. P4-T01 through P4-T03 sequentially because cache activation precedes launcher
   activation.
7. P5-T01 and P5-T03 in parallel after their prerequisites; P5-T02, P5-T04, then
   P5-T05.
8. P6-T01 alone; P6-T02 and P6-T03 in parallel; P6-T04; PR review/fix/CI; P6-T05
   last.

There are no cycles. Every edge moves from evidence to implementation,
implementation to integration, integration to irreversible retirement, and
retirement to completion records.

## File-to-Task Mapping

| Task   | Primary ownership                                 | Validation/evidence                   |
| ------ | ------------------------------------------------- | ------------------------------------- |
| P0-T01 | oracle capture tool, manifest, regeneration guide | byte-identical recapture              |
| P0-T02 | parse/domain/Unicode-date JSONL                   | provenance and field-presence audit   |
| P0-T03 | match/batch/HTTP JSONL                            | raw transport and duplicate-key audit |
| P0-T04 | finite-envelope and baseline JSON                 | workload and resource measurements    |
| P1-T01 | `go.mod`, `go.sum`, `mise.toml`                   | tidy-clean, verify, build             |
| P1-T02 | contract request/response DTOs                    | contract serialization test           |
| P1-T03 | sole regexp2 adapter                              | regex compatibility/security test     |
| P1-T04 | parser common helpers                             | cleanup/replacement test              |
| P1-T05 | golden loader/comparator                          | provenance/comparison test            |
| P1-T06 | parser limits                                     | boundary/overflow/log-safety test     |
| P2-T01 | quality/revision                                  | quality oracle test                   |
| P2-T02 | language                                          | ordering/all-identifiers test         |
| P2-T03 | release group                                     | capture/cleanup/fail-closed test      |
| P2-T04 | movie title                                       | title/ID/edition/hash test            |
| P2-T05 | episode                                           | branch/range/date/anime test          |
| P2-T06 | domain parity/static guards                       | full domain and import safety gates   |
| P3-T01 | parse service                                     | full-response orchestration test      |
| P3-T02 | match scheduler                                   | race/load/limit test                  |
| P3-T03 | route handlers                                    | HTTP oracle matrix                    |
| P3-T04 | HTTP server/lifecycle                             | slow-client/load/shutdown test        |
| P3-T05 | process command                                   | env/version/signal test               |
| P3-T06 | differential/adversarial/benchmark suites         | real-listener phase gate              |
| P4-T01 | parser client and pattern cache                   | cache cutover/rollback test           |
| P4-T02 | three parser-dependent route suites               | healthy/outage/recovery tests         |
| P4-T03 | root tasks, dev launcher, spawn                   | developer/standalone lifecycle        |
| P5-T01 | parser Dockerfile/Compose ignore and watch        | non-root/private image smoke          |
| P5-T02 | binary/container smoke scripts                    | real-artifact assertions              |
| P5-T03 | compatibility workflow/Go tool script             | required native quality gates         |
| P5-T04 | Docker/release workflows/smoke                    | five archives, image, provenance      |
| P5-T05 | cutover evidence                                  | full acceptance ledger                |
| P6-T01 | legacy source/build deletion                      | clean-checkout no-dotnet audit        |
| P6-T02 | root developer/operator docs                      | command and prerequisite review       |
| P6-T03 | architecture docs                                 | source-link/data-flow review          |
| P6-T04 | published site docs                               | docs link/build validation            |
| P6-T05 | `ROADMAP.md`                                      | issues/PR/review/CI reconciliation    |

## Optimization Opportunities

- Generate the corpus once and let every focused test select categories from the
  same immutable JSONL. Avoid copying expectations into individual Go tests or
  TypeScript stubs.
- Compile static patterns once at service construction and distinct caller
  patterns once per request. Do not add an unbounded cross-request pattern
  cache.
- Use one bounded worker pool sized from reviewed limits (defaulting no higher
  than useful CPU parallelism) and one collector for result maps. This reduces
  goroutine/race risk while preserving dictionary semantics.
- Reuse P5-T02 smoke tooling in compatibility, Docker, release, rollback, and
  local acceptance gates. One real-artifact contract prevents five superficially
  different checks from drifting.
- Run focused Go tests during the parallel domain batch, then run the full
  golden/differential/race suite only at integration boundaries. Correctness
  gates remain strict without paying the complete oracle cost after every file
  edit.
- Defer code generation, PGO, regex rewrites, shared caches, new metrics/control
  planes, and UI/API redesign. Consider them only after this migration is merged
  with benchmark evidence.
- Preserve the app client, endpoint names, Compose identity, port, image, and
  binary filenames. The most efficient integration change is the one consumers
  cannot observe.

## Implementation Strategy Recommendations

1. Work in the single existing issue worktree and integrate dependency-safe
   batches frequently. Before each batch, confirm a clean scoped diff and that
   no parallel task owns the same file.
2. Freeze evidence before translation. When Go and C# disagree, minimize the
   case, add it to the pinned oracle corpus, classify whether it is supported
   behavior or an intentional finite-limit boundary, and only then change code.
3. Transliterate first. Preserve regex/rule order, branch order, capture
   selection, defaults, enum names, and legacy quirks so reviews can compare C#
   and Go. Refactors require an already-green complete corpus and should not
   share a commit with behavior translation.
4. Enforce the security contract centrally: default .NET regexp2 mode, 100 ms
   caller timeout, finite stack/static budgets, body/item/product limits,
   bounded request/worker concurrency, HTTP deadlines, loopback/private binding,
   non-root image, and content-free logs.
5. Treat cache activation as deployment behavior. Bump the parse behavior
   version deliberately and namespace or invalidate pattern-match decisions in
   both upgrade and rollback directions before any launcher or image begins
   using Go.
6. Prove artifacts, not build commands. Start native binaries and the final
   image, exercise health/parse/match/batch/version/shutdown, inspect archive
   names/checksums, and test standalone parent-child termination on supported
   native runners.
7. Keep rollback viable until retirement: record the last known-good C#
   image/archive digests and ensure stable external names require no data/config
   migration. Do not delete C# on the same gate that first exercises Go
   delivery.
8. Run a formal PR review after the complete cutover diff exists. Resolve every
   actionable finding, rerun affected focused tests plus the full required
   gates, and monitor CI until green before the ROADMAP completion task or
   merge.
9. Delete C# only after P5-T05 proves parity, security, consumers, caches,
   containers, archives, rollback, and performance. After deletion, repeat
   clean-checkout/no-dotnet searches and runtime smokes so removal itself cannot
   conceal a dependency.
10. Update live docs in the same PR, but mark `ROADMAP.md` and GitHub
    child/parent completion only after review fixes and green CI provide
    authoritative evidence.
