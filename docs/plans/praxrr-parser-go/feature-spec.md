# Feature Spec: Praxrr Parser Go Migration

## Executive Summary

Replace the optional .NET parser service with an in-place Go implementation
while preserving the observable parser contract used by Praxrr: endpoint paths,
validation order and text, JSON field presence and values, regex decisions,
domain parsing, service identity, port, image name, and standalone binary name.
The migration uses Go's standard HTTP stack and `github.com/dlclark/regexp2/v2`
in default .NET-compatible mode, with the existing C# service kept temporarily
as the behavioral oracle. A provenance-bearing golden corpus and differential
harness gate each child issue (#2-#5) before all .NET code and build
dependencies are retired. The primary risks are subtle regex/domain drift,
unbounded backtracking and batch work, transport-default differences, and
incomplete Docker/release/standalone cutover.

## External Dependencies

### APIs and Services

#### Existing parser HTTP API

- **Contract source**: `packages/praxrr-parser/Endpoints/*.cs`
- **Authentication**: none; the service remains private and is not published by
  provided Compose configurations.
- **Endpoints**:
  - `GET /health`: readiness and parser version.
  - `POST /parse`: movie or series title parsing.
  - `POST /match`: one text against multiple .NET-compatible regex patterns.
  - `POST /match/batch`: multiple texts against multiple patterns.
- **Compatibility rule**: no API redesign, version prefix, redirect, or consumer
  branching by runtime.

### Libraries and SDKs

| Library                         | Version                | Purpose                                             | Installation                                  |
| ------------------------------- | ---------------------- | --------------------------------------------------- | --------------------------------------------- |
| Go toolchain                    | pinned supported patch | compiler, HTTP/JSON, testing, fuzzing, cross-builds | repository/CI toolchain setup                 |
| `github.com/dlclark/regexp2/v2` | `v2.3.0`               | .NET-compatible backtracking regex engine           | `go get github.com/dlclark/regexp2/v2@v2.3.0` |

The implementation must not use Go's standard `regexp`, regexp2 RE2/ECMAScript
modes, or `regexp2/v2/compat` for parser behavior. `go.mod` and `go.sum` are
committed, module downloads run read-only in CI, and dependency upgrades require
the complete parity suite.

### External Documentation

- [Go releases](https://go.dev/doc/devel/release): supported toolchain patches.
- [Go modules reference](https://go.dev/ref/mod): dependency locking and
  verification.
- [regexp2 v2.3.0](https://pkg.go.dev/github.com/dlclark/regexp2/v2): regex
  syntax, captures, replacement, timeouts, stack limits, and concurrency.
- [Go net/http](https://pkg.go.dev/net/http): explicit server, handler, and
  shutdown behavior.
- [Go fuzzing](https://go.dev/doc/security/fuzz/): regression-oriented fuzz
  testing.
- [Go race detector](https://go.dev/doc/articles/race_detector): executed
  concurrency checks.
- [Kubernetes probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/):
  readiness and liveness semantics applicable to container operators.

## Business Requirements

### User Stories

**Configuration author**

- As a configuration author, I want existing release titles and Arr-style
  regexes to produce the same parsed metadata and matches after cutover so that
  saved custom-format tests do not drift.
- As a profile designer, I want score and impact simulations to retain the same
  quality, language, title, episode, release-group, revision, and match results.

**Operator and maintainer**

- As an operator, I want Docker and standalone upgrades to retain the parser
  host, port, image, health endpoint, and adjacent binary conventions without a
  configuration migration.
- As a maintainer, I want a reproducible oracle corpus and differential suite
  that blocks unexplained parser changes before the C# source is deleted.
- As a release maintainer, I want all supported archives and the parser
  container to build and smoke test without a .NET runtime or SDK.

### Business Rules

1. **Strict observable parity**: the Go service preserves successful response
   semantics, validation order/text, status codes, selected headers, arrays and
   duplicate ordering, enum names, map-key collapse, null/zero/empty
   distinctions, and parser outcomes.
   - JSON object-member order is excluded unless consumer evidence proves it is
     required.
   - Security behavior outside the measured supported envelope may reject work
     early under an explicitly tested finite contract.
2. **The .NET implementation is the oracle**: fixtures are captured from a
   pinned source commit, runtime patch, OS, culture/globalization mode, time
   zone, and configuration before deletion.
3. **Regex compatibility**: every user pattern uses regexp2 default .NET mode
   and a 100 ms dynamic match timeout; invalid, timed-out, or
   finite-stack-failed cells return `false` without failing valid siblings.
4. **Ordered domain rules**: common cleanup, quality, language, release group,
   movie title, and episode rules retain their current precedence, capture
   behavior, defaults, and quirks.
5. **Bounded public work**: body bytes, text/pattern sizes and counts,
   text-pattern work product, request concurrency, regex backtracking stack, and
   static operation duration are finite and derived from repository and UI
   maxima plus margin.
6. **Stable deployment identity**: preserve `PARSER_HOST`, `PARSER_PORT`, port
   `5000`, Compose service names, parser image name, and `praxrr-parser[.exe]`
   filenames.
7. **Graceful degradation**: parser-dependent features report
   unavailable/unknown while unrelated Praxrr behavior continues; recovery does
   not discard user input.
8. **One-way completion**: C# coexistence is temporary. Issue #5 is incomplete
   until legacy source, .NET build steps, ASP.NET-only runtime configuration,
   and live documentation are removed.

### Edge Cases

| Scenario                                      | Expected Behavior                                                 | Evidence                      |
| --------------------------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| Invalid or catastrophic regex                 | affected result is `false`; siblings continue; request is bounded | HTTP and adversarial fixtures |
| Duplicate texts or patterns                   | object-key overwrite/collapse matches oracle behavior             | differential fixture          |
| Empty versus null collections                 | emitted fields retain exact `[]`, `{}`, or `null` shape           | field-presence assertions     |
| Unicode, Turkish-I, supplementary code points | explicitly compared with pinned oracle                            | Unicode fixture set           |
| Repeated named captures                       | every capture used in the same order as .NET                      | episode/regex fixtures        |
| Tomorrow/year boundary                        | deterministic behavior under pinned date/time zone                | clock-bound fixture           |
| Malformed, null, wrong-type, or trailing JSON | observed ASP.NET status/body/header behavior reproduced           | HTTP oracle matrix            |
| Maximum supported batch                       | completes inside client budget without starving health            | load test                     |
| One over a finite limit                       | rejected before regex work with pinned response                   | boundary test                 |
| Parser absent or restarting                   | app remains usable and parser surfaces recover                    | app integration/E2E test      |
| Windows standalone termination                | child starts, becomes healthy, and exits with parent              | archive smoke test            |

### Success Criteria

- [ ] Issues #2-#5 have evidence-backed exit gates and parent issue #1 is
      complete.
- [ ] Golden/domain/regex/HTTP suites have zero unexplained parity differences.
- [ ] Every supported finite-limit boundary and adversarial case passes without
      health starvation, runaway memory, goroutine growth, or sensitive logging.
- [ ] `go test`, race, vet, module verification, fuzz seeds, cross-builds,
      container smoke, Deno lint/check/test/build, and parser-dependent
      integration/E2E gates pass.
- [ ] Go startup/idle footprint or artifact size improves without a material
      tail-latency or cold 50-title batch regression.
- [ ] All release archives contain the correctly named working parser binary.
- [ ] No shipped task, workflow, image, source file, or live documentation
      requires .NET.
- [ ] `ROADMAP.md` records completion only after the implementation evidence
      exists.

## Technical Specifications

### Architecture Overview

```text
SvelteKit parser client
        |
        | existing HTTP contract on private host:5000
        v
cmd/praxrr-parser
        |
        v
internal/httpserver ----> internal/contract
        |                        |
        v                        v
internal/parser --------> internal/parser/regex boundary
        |                        |
        +------------------------+----> regexp2/v2

Pinned legacy C# oracle ---> golden/differential fixture generator ---> committed testdata
```

Use one cohesive internal parser package, one wire-contract package, and one
HTTP adapter. Split packages only when an independently testable API or
ownership boundary appears. The Go runtime replaces the implementation in
`packages/praxrr-parser` so all external names remain stable.

### Data Models

No database schema or migration is required.

#### Requests

| Endpoint       | JSON model                              | Validation order                       |
| -------------- | --------------------------------------- | -------------------------------------- |
| `/parse`       | `{title: string, type: string           | null}`                                 |
| `/match`       | `{text: string, patterns: string[]}`    | nonblank text, then nonempty patterns  |
| `/match/batch` | `{texts: string[], patterns: string[]}` | nonempty texts, then nonempty patterns |
| `/health`      | none                                    | none                                   |

#### Parse response

The outer response always emits `title`, `type`, `source`, `resolution`,
`modifier`, `revision`, `languages`, `releaseGroup`, `movieTitles`, `year`,
`edition`, `imdbId`, `tmdbId`, `hardcodedSubs`, `releaseHash`, and `episode`.
Movie responses use explicit episode `null`; series responses retain movie
defaults. Episode objects always emit series title, season, episode/absolute
arrays, air date, season flags, special, and release type.

#### Golden fixture record

Each immutable JSONL fixture records oracle source commit/runtime/environment,
request method/path, relevant headers/body, expected status, selected response
headers, raw body, decoded semantic body, fixture category, and notes.
Nondeterministic transport headers are excluded explicitly.

### API Design

#### `GET /health`

**Response (200):**

```json
{ "status": "healthy", "version": "1.0.0" }
```

The final version policy is deterministic and intentionally cache-safe. A
cutover bump is preferred after cache behavior tests; local builds have a
deterministic fallback.

#### `POST /parse`

**Request:**

```json
{ "title": "Example.2026.1080p.WEB-DL-GROUP", "type": "movie" }
```

**Validation errors:**

| Status | Condition    | Body                                                           |
| ------ | ------------ | -------------------------------------------------------------- |
| 400    | blank title  | `{"error":"Title is required"}`                                |
| 400    | invalid type | `{"error":"Type is required and must be 'movie' or 'series'"}` |

#### `POST /match`

Returns `{ "results": { "<pattern>": true|false } }`. Blank text and empty
patterns produce the existing exact 400 errors; invalid and timed-out patterns
remain successful `false` results.

#### `POST /match/batch`

Returns `{ "results": { "<text>": { "<pattern>": true|false } } }`. Text/pattern
arrays are validated in current order. Patterns compile once per request,
workers are bounded, and one collector owns result-map writes.

Framework-level cases—malformed body, unsupported method/media type, unknown
path, duplicate JSON properties, and oversized work—are implemented from the
oracle/finite-contract matrix rather than left to `net/http` defaults.

### System Integration

#### Files to create

- `packages/praxrr-parser/go.mod`, `go.sum`: module and locked dependency.
- `packages/praxrr-parser/cmd/praxrr-parser/main.go`: versioned process entry
  point.
- `packages/praxrr-parser/internal/contract/*.go`: explicit
  request/response/domain DTOs.
- `packages/praxrr-parser/internal/parser/*.go`: common, regex, quality,
  language, release-group, title, episode, orchestration, limits, and focused
  tests.
- `packages/praxrr-parser/internal/httpserver/*.go`: handlers, server policy,
  lifecycle, and tests.
- `packages/praxrr-parser/internal/parity/*_test.go`: golden and differential
  execution.
- `packages/praxrr-parser/testdata/golden/*.jsonl`: oracle fixtures and
  provenance.
- `packages/praxrr-parser/tools/golden/`: reproducible legacy-oracle capture
  tooling.
- `packages/praxrr-parser/README.md`: contract, development, fixture, build, and
  security-limit docs.

#### Files to modify

- `deno.json`, `scripts/dev.ts`: preserve task intent while switching dotnet
  commands to Go.
- `Dockerfile.parser`, `compose.dev.yml`: pinned Go build, non-root minimal
  runtime, stable health and service identity.
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`: launch Go with the
  selected loopback address while keeping binary discovery and degradation.
- `.github/workflows/{compatibility,release,docker}.yml`: Go tests,
  cross-builds, parser image, archive staging, smoke tests,
  checksums/provenance.
- `.gitignore`, `.dockerignore`, root tooling/version files: Go artifacts
  without excluding fixtures.
- parser-related operator/developer/architecture documentation and `ROADMAP.md`.

#### Files to delete at final cutover

- C# endpoints, models, parsers, logging, `Program.cs`, `Parser.csproj`,
  `Directory.Build.props`, and `appsettings.json`.
- Remaining live dotnet setup/commands and ASP.NET-only configuration.

#### Configuration

- Public Praxrr configuration remains `PARSER_HOST` and `PARSER_PORT`.
- Standalone Go listener accepts explicit `PARSER_ADDR`; auto-spawn binds
  loopback.
- Container binds explicit `:5000` only on its private network and Compose does
  not publish it.
- `ASPNETCORE_URLS` may be parsed only during the temporary dual-runtime window
  and is removed at final cutover unless a time-boxed release compatibility need
  is documented.

## UX Considerations

### User Workflows

#### Parser-dependent testing and simulation

1. Preserve title, media type, profile, fixtures, comparisons, and overrides
   while requests run.
2. Keep service outage distinct from domain miss, invalid regex, timeout, and
   expected non-match.
3. Continue showing unrelated impact/config results when parser scoring is
   unavailable.
4. Poll/retry recovery once without stale responses overwriting newer input.

#### Operator startup and recovery

1. Standalone Praxrr finds the adjacent binary, chooses a free loopback port,
   starts it, prefixes child output, and waits up to the existing readiness
   budget.
2. Docker health gates the main service through the same private DNS/port
   contract.
3. Fatal startup, readiness timeout, unexpected exit, and graceful shutdown have
   stable classified logs without release titles or regex contents.

### UI Patterns

| State                       | Required feedback                                                               |
| --------------------------- | ------------------------------------------------------------------------------- |
| Starting/loading            | visible text plus spinner; input preserved                                      |
| Domain miss                 | title not recognized; not described as outage                                   |
| Invalid/timeout pattern     | sibling results preserved; service remains healthy                              |
| Unavailable                 | persistent scoped warning; unrelated work available; automatic bounded recovery |
| Prior result during refresh | marked stale or cleared so it cannot be attributed to new input                 |
| Recovery                    | warning removed once; current request retried without focus theft               |

### Accessibility Requirements

- Status transitions use an existing live-region/alert pattern and do not rely
  on color or animation.
- Loading indicators include text, focus remains on the initiating
  control/input, and recovery does not steal focus.
- Existing keyboard access and semantic result tables remain unchanged by the
  headless migration.

### Performance UX

- Measure startup, idle RSS/image size, single parse/match p50/p95/p99,
  1/10/50-title cold and warm batches, saturation, timeout recovery, health
  latency under load, and shutdown drain.
- Maximum supported work completes within existing UI/client deadlines; one
  pathological regex cannot monopolize all workers.
- Optimization such as regexp2 code generation or PGO is deferred until parity
  is green and benchmark evidence justifies it.

## Recommendations

### Implementation Approach

Use a gated strangler-style replacement inside the existing package: first
freeze and measure the C# oracle, then build the Go contract/regex foundation,
line-port domain rules, add HTTP orchestration, switch every integration, and
finally delete C# in the same feature branch. Keep rule order and names
recognizable for review. Centralize all regexp2 configuration/error mapping,
finite limits, DTO encoding, and safe logs so no domain parser or handler
invents incompatible behavior.

### Technology Decisions

| Decision     | Recommendation                                        | Rationale                                                         |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------- |
| Regex engine | regexp2/v2 default .NET mode                          | required constructs and capture behavior                          |
| HTTP stack   | standard `net/http`                                   | four routes; explicit parity is easier without framework defaults |
| Location     | replace `packages/praxrr-parser` in place             | preserves every deployment identity                               |
| Port method  | ordered manual transliteration                        | minimizes hidden rule-precedence changes                          |
| Comparison   | decoded semantics plus exact transport assertions     | catches meaningful shape without treating map order as API        |
| Work limits  | measured finite limits and bounded workers            | preserves supported parity without resource exhaustion            |
| Cutover      | temporary dual build, single Go runtime at completion | oracle remains until proven, but .NET retirement is mandatory     |

### Quick Wins

- Check in the endpoint/validation matrix, fixture provenance schema, and regex
  inventory first.
- Add highest-risk fixtures for repeated captures, Unicode/casing, whitespace,
  dates, duplicates, null/empty shape, invalid patterns, timeouts, and
  catastrophic backtracking.
- Add static guards forbidding standard `regexp` for parser semantics and direct
  regexp2 imports outside the compatibility boundary.
- Add reusable archive/container smoke commands early and run them throughout
  implementation.
- Record the .NET resource/latency baseline before Go code changes invalidate
  comparison.

### Future Enhancements

- Safe parser diagnostics and classified metrics without input content.
- End-to-end cancellation propagation across browser, SvelteKit, client retry,
  HTTP, and regex work.
- Scheduled fuzz/adversarial load jobs with minimized regressions.
- Audited regexp2 contingency or vendoring if upstream stewardship changes.
- Benchmark-driven regexp2 code generation, PGO, and multi-architecture
  container publishing.

## Risk Assessment

### Technical Risks

| Risk                                        | Likelihood | Impact   | Mitigation                                                            |
| ------------------------------------------- | ---------- | -------- | --------------------------------------------------------------------- |
| Unicode/capture/anchor/replacement mismatch | High       | Critical | oracle goldens, focused wrapper, zero unexplained diffs               |
| Domain rule-order drift                     | Medium     | Critical | line port, ordered tables, branch fixtures, source-aligned review     |
| Catastrophic regex/stack exhaustion         | High       | Critical | 100 ms dynamic timeout, finite stack/static bounds, adversarial tests |
| Batch work multiplication                   | High       | Critical | finite body/item/product/concurrency limits and bounded workers       |
| ASP.NET/net-http transport differences      | High       | High     | explicit malformed/method/media-type oracle matrix                    |
| Null/default/enum drift                     | Medium     | High     | explicit tagged DTOs and field-presence tests                         |
| Date/culture/environment drift              | Medium     | High     | pinned oracle metadata and boundary fixtures                          |
| Standalone/Windows lifecycle regression     | Medium     | High     | per-platform real-binary smoke tests                                  |
| Artifact omitted or misnamed                | Medium     | High     | archive inspection plus startup/health/parse/match smoke              |
| Sensitive title/regex logging               | High       | High     | count/class/fingerprint-only logs and secret-shape tests              |
| Private service exposed                     | Medium     | High     | loopback/default private binding and no Compose publication           |
| Mutable supply-chain input                  | Medium     | High     | pinned toolchain/dependency/action/image, SBOM, provenance            |

### Security Considerations

#### Critical — Hard Stops

| Finding                                   | Risk                                                       | Required Mitigation                                                                            |
| ----------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Unbounded regexp2 stack/static operations | memory/CPU exhaustion through unauthenticated endpoint     | finite measured stack and operation budgets; checked errors; stress tests                      |
| Unbounded `/match/batch` cardinality/work | attacker-controlled CPU, memory, goroutines, response size | body/item/length/product/concurrency limits, bounded workers, early rejection, caller chunking |

#### Warnings — Must Address

| Finding                     | Risk                                   | Mitigation                                                          | Alternatives                                              |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| public binding without auth | remote abuse                           | loopback default/private container binding; no publication          | authenticated/TLS proxy if remote deployment is supported |
| request/log disclosure      | private release names and regexes leak | safe structured metadata only; log-leak tests                       | opt-in redacted diagnostics                               |
| missing HTTP deadlines      | slow-client/worker retention           | explicit header/read/write/idle/shutdown budgets                    | upstream proxy plus server budgets                        |
| dependency bus factor       | behavior/supply-chain risk             | pin, verify, scan, dedicated upgrade parity PR                      | audited vendor/fork contingency                           |
| mutable build inputs        | unreproducible artifacts               | pin toolchains/actions/images; checksums/SBOM/provenance            | documented digest refresh workflow                        |
| permissive container        | larger blast radius                    | non-root, minimal/read-only where compatible, no extra capabilities | documented required writable paths only                   |

#### Advisories — Best Practices

- Classify internal invalid/timeout/stack/engine outcomes without exposing
  request contents.
- Retain immutable failing fuzz/load inputs and publish safe aggregate
  performance evidence.

## Task Breakdown Preview

### Phase 1: Foundation and Parity (#2)

**Focus**: freeze the oracle, measure supported bounds, scaffold Go, implement
contract/regex/common utilities, and create reproducible fixtures/harness.

**Parallelization**: fixture capture, contract models, regex inventory, and
CI/toolchain scaffolding may run concurrently after the oracle metadata schema
is fixed.

### Phase 2A: Domain Parsers (#3)

**Focus**: line-port quality, language, release group, movie title, and episode
parsing with focused branch fixtures.

**Dependencies**: Phase 1 regex/common utilities and golden loader.

### Phase 2B: Orchestration and HTTP (#4)

**Focus**: compose parse results, implement all four routes, exact
validation/errors, bounded batch execution, lifecycle, and full side-by-side
differential tests.

**Dependencies**: Phase 1 and domain parser completion.

### Phase 3: Integration, Cutover, and Retirement (#5)

**Focus**: switch dev, Docker, standalone, release, CI, docs, and roadmap; smoke
all artifacts; delete C# and every live .NET dependency; run clean-checkout
validation.

**Dependencies**: zero unexplained parity diffs, security/load gates, and
accepted performance evidence.

## Decisions Needed

The workflow resolves design choices as follows so implementation can proceed
without a product checkpoint:

1. **Parity boundary**: semantic JSON plus exact field presence, arrays, errors,
   status, and selected headers; raw object order/escaping is excluded absent
   consumer evidence.
2. **Security limits**: finite and measured; exact values are an implementation
   measurement task in issue #2, not an authorization to leave work unbounded.
3. **Version**: intentionally bump at cutover after cache tests; inject
   deterministically and record it in artifact evidence.
4. **Legacy listener variable**: accept `ASPNETCORE_URLS` only while both
   implementations coexist; remove it after all launchers use the Go listener
   contract unless tests prove an external release dependency.
5. **Oracle tooling**: retain reproducible tagged-container fixture regeneration
   instructions after source deletion so future changes can trace baseline
   provenance.
6. **Validation breadth**: full Deno unit/check/build plus focused
   parser-dependent E2E on every PR; full E2E and every artifact smoke gate
   before merge/release when environment prerequisites exist.

## Research References

- [research-external.md](./research-external.md): Go, regexp2, HTTP, build, and
  test APIs.
- [research-business.md](./research-business.md): strict parity rules,
  workflows, and criteria.
- [research-technical.md](./research-technical.md): architecture, contracts,
  files, and cutover.
- [research-ux.md](./research-ux.md): affected user/operator workflows and
  recovery states.
- [research-security.md](./research-security.md): threat model and
  severity-classified requirements.
- [research-practices.md](./research-practices.md): package, testing, CI, and
  maintainability guidance.
- [research-recommendations.md](./research-recommendations.md): consolidated
  strategy and risk choices.
