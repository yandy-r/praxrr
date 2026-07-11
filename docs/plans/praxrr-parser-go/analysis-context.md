# Context Analysis

## Executive Summary

The Go parser migration is a compatibility replacement, not an API redesign. The
implementation inside `packages/praxrr-parser` changes, while the four HTTP
routes, JSON semantics, validation behavior, service identity, port, cache
behavior, adjacent executable names, container identity, and five-platform
archive layout remain stable. The existing C# parser must stay available as a
pinned differential oracle until the domain, HTTP, security, lifecycle, and
artifact gates are green; final completion then removes all live C#/.NET source
and tooling.

Plan the work as four dependency-gated child-issue phases: foundation and oracle
(#2), ordered domain parsers (#3), orchestration and HTTP (#4), and
integration/cutover/retirement (#5). Within each phase, fixture, implementation,
and validation tasks can run in parallel once their shared contracts are fixed.
The critical release gates are zero unexplained semantic differences, finite and
measured unauthenticated work, deliberate cache activation, real
delivered-artifact smoke tests, clean .NET retirement, and evidence-backed
updates to `ROADMAP.md`.

## Architecture Context

Use one nested Go module at `packages/praxrr-parser` with a deliberately narrow
dependency graph:

```text
cmd/praxrr-parser
        |
        v
internal/httpserver ------> internal/contract
        |                         ^
        v                         |
internal/parser -----------------+
        |
        v
central regexp2/v2 compatibility boundary
```

- `internal/contract` owns explicit request, response, enum, null, empty, and
  zero-value wire semantics. It must not depend on HTTP, process configuration,
  or parser implementation.
- `internal/parser` owns common cleanup, the only regexp2 boundary, ordered
  domain parsers, and pure parse orchestration. Keep the five domain parsers
  cohesive until a proven ownership/API boundary warrants a split.
- `internal/httpserver` owns route dispatch, decoding, validation ordering,
  stable errors, response encoding, body/work limits, bounded batch scheduling,
  deadlines, overload behavior, and handler test seams.
- `cmd/praxrr-parser` is the composition root for deterministic version
  injection, environment, listener binding, safe logging, signals, startup
  failure, and graceful shutdown.
- The SvelteKit application continues to depend only on the existing HTTP
  service through
  `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`; do not add
  Go/C# runtime detection or generated Go model coupling.

The parser stays database-free. Both caches remain app-owned, but the cutover is
cache-sensitive: `parsed_release_cache` is namespaced by `/health.version`,
while `pattern_match_cache` is not. Therefore the final activation must use a
deterministic behavior-version bump and an explicit match-cache invalidation or
namespace strategy before any Go result can mix with legacy rows.

## Critical Files Reference

| Area                  | Verified path(s)                                                                                                                                                                                                  | Planning significance                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Process and routes    | `packages/praxrr-parser/Program.cs`, `packages/praxrr-parser/Endpoints/ParseEndpoints.cs`, `packages/praxrr-parser/Endpoints/MatchEndpoints.cs`                                                                   | Oracle for startup/version, route paths, validation precedence/text, timeout isolation, duplicate collapse, and response assembly.       |
| Wire contract         | `packages/praxrr-parser/Models/Requests.cs`, `packages/praxrr-parser/Models/Responses.cs`, `packages/praxrr-parser/Models/Types.cs`, `packages/praxrr-parser/Models/Language.cs`                                  | Source of required fields, enum names, ordered languages, and null/empty/default behavior.                                               |
| Regex/common boundary | `packages/praxrr-parser/Parsers/Common/RegexReplace.cs`, `packages/praxrr-parser/Parsers/Common/ParserCommon.cs`                                                                                                  | Port once; preserve replacement, extension removal, error, and capture semantics.                                                        |
| Domain rules          | `packages/praxrr-parser/Parsers/QualityParser.cs`, `LanguageParser.cs`, `ReleaseGroupParser.cs`, `TitleParser.cs`, `EpisodeParser.cs`                                                                             | Transliterate in source order; episode parsing is the highest-risk repeated-capture/range/date surface.                                  |
| App boundary          | `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`, `packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`                                                                                   | Sole consumer contract, 30-second budget/retry behavior, enum conversion, graceful failure, and cache orchestration.                     |
| Cache activation      | `packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`, `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`                                                                       | Prove parse version transition and prevent legacy match-result reuse.                                                                    |
| Standalone lifecycle  | `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`, `packages/praxrr-app/src/hooks.server.ts`                                                                                                             | Preserve adjacent name lookup, pre-config startup, selected loopback port, readiness timeout, degradation, and parent/child termination. |
| Legitimate workload   | `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`, `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts`, `packages/praxrr-app/src/routes/api/v1/simulate/impact/+server.ts` | Measure actual title, pattern, and work-product maxima before choosing finite limits.                                                    |
| Developer flow        | `deno.json`, `scripts/dev.ts`                                                                                                                                                                                     | Retain task names, port behavior, labeled concurrent output, and server-only/degraded workflows while replacing dotnet commands.         |
| Containers            | `Dockerfile.parser`, `compose.yml`, `compose.dev.yml`                                                                                                                                                             | Preserve private port 5000, service/DNS names, health ordering, non-root execution, and dev watch behavior.                              |
| Delivery gates        | `.github/workflows/compatibility.yml`, `.github/workflows/docker.yml`, `.github/workflows/release.yml`                                                                                                            | Add pinned Go/module/parity/security gates; preserve image/tag policy and five archive targets with real smoke tests.                    |
| Completion docs       | `ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`                                                                                                                                                      | Update only as implementation evidence becomes true; distinguish live Go guidance from historical oracle provenance.                     |

## Patterns to Follow

1. **Freeze behavior before translation.** Golden JSONL records must carry the
   pinned C# source commit, runtime patch, OS, culture/globalization mode, time
   zone, request method/path/headers/raw body, selected response headers, raw
   response, decoded semantics, category, and notes. Go must never generate its
   own expected output.
2. **Transliterate first, refactor after parity.** Preserve regex arrays, branch
   precedence, early returns, last-match/last-capture choices, stable language
   deduplication, range expansion, and legacy quirks. Every discovered runtime
   difference becomes a minimized fixture before a fix.
3. **Centralize regexp2 behavior.** Pin `github.com/dlclark/regexp2/v2` and use
   default .NET mode. Forbid parser use of Go `regexp`, regexp2 RE2/ECMAScript
   modes, and direct regexp2 calls outside the adapter. Expose ordered
   matches/captures and replacement without slicing UTF-8 by rune offsets.
4. **Separate static and caller regex policies.** Static patterns compile at
   startup and fail with a stable rule identifier. Caller patterns compile once
   per distinct request pattern; invalid, timed-out, stack-limited, or
   engine-failed cells become `false` while valid siblings continue.
5. **Encode the contract explicitly.** Use DTOs and field-presence tests rather
   than relying on Go encoding defaults. Preserve enum strings, complete outer
   response fields, `[]`/`{}`/`null`, movie-versus-series defaults, dictionary
   overwrite behavior, validation order, status, and selected headers.
6. **Bound scheduling, not only regex duration.** Reject excess
   body/item/length/product work before regex execution, compile unique patterns
   once, use a bounded worker pool, and give one collector ownership of
   result-map writes. Keep `/health` responsive at maximum supported load.
7. **Verify delivered identity.** The image, DNS/service names, port, public
   parser variables, adjacent filenames, and archive root layout are contracts.
   Smoke the actual staged binaries and image rather than accepting compilation
   as proof.

## Cross-Cutting Concerns

- **Security and availability:** the unauthenticated service needs finite
  request bytes, item sizes and counts, text-pattern product, concurrent
  requests, static-operation duration, regexp2 stack, and HTTP
  header/read/write/idle/shutdown budgets. Limits must be measured against real
  repository and UI workloads plus margin and tested at the limit and one over
  it.
- **Privacy:** never log release titles, regex bodies, request bodies, or
  arbitrary captures. Log stable classifications, counts, safe rule IDs,
  durations, and fingerprints only; test logs for secret-shaped inputs.
- **Concurrency/lifecycle:** exercise race tests on real executed paths,
  cancellation, slow clients, disconnects, overload, panic recovery, goroutine
  cleanup, signal drain, readiness timeout, and Windows parent-child
  termination. Stop regexp2's timeout clock in tests that assert goroutine
  lifetime.
- **Unicode/time parity:** fixtures must cover casing (including Turkish-I),
  accented Latin, CJK, supplementary code points, repeated named captures,
  malformed JSON strings, tomorrow/year boundaries, and pinned time zone/culture
  behavior.
- **Graceful optionality:** parser failure remains unavailable/null at the app
  boundary; unrelated app work must continue, user input must survive
  outage/recovery, and stale responses must not be attributed to newer requests.
- **Supply chain:** pin a supported Go patch, regexp2 version, actions, and
  container inputs; commit `go.sum`; run read-only module verification,
  vulnerability scanning, checksums, SBOM/provenance, and dependency-upgrade
  parity gates.
- **Rollback:** record the last known-good legacy image/archive identifiers and
  checksums. Stable wire and delivery identities must support old-app/new-parser
  and new-app/old-parser during the rollout window without data/config
  migration.

## Parallelization Opportunities

| Stage         | Parallel work after shared prerequisite                                                                                                                                | Join gate                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| #2 Foundation | Oracle capture/provenance; endpoint and regex inventory; Go module/contract scaffolding; regex adapter tests; workload measurement; CI/toolchain scaffolding           | Regenerable immutable corpus, explicit finite limits, centralized regex parity, and green Go module/race/vet/fuzz-seed gates.             |
| #3 Domain     | Quality/revision; language; release group; movie title; episode parser tasks can proceed independently after common/regex APIs and fixture loader stabilize            | Zero semantic diffs across complete domain corpus; shared common behavior and all enum/language identifiers verified.                     |
| #4 HTTP       | Contract encoding; route/transport matrix; bounded batch scheduler; lifecycle/server policy; differential runner; app-client integration tests                         | All four real-listener routes match the oracle, overload is bounded, health remains responsive, and adversarial/race tests pass.          |
| #5 Cutover    | Developer/standalone launcher; container/Compose; CI; release archives; app/cache integration; documentation inventory may proceed against a frozen Go binary contract | One coordinated cache/version activation, all real artifacts smoked, clean-checkout validation green, and active .NET references removed. |

Do not parallelize edits to shared DTOs, the regex adapter API, parser
orchestration, version policy, or cache activation without an owner and a frozen
contract. Issue #3 depends on #2; issue #4 depends on completed domain
orchestration; final retirement depends on every parity, load, lifecycle, and
artifact gate. Documentation and `ROADMAP.md` can be prepared in parallel but
completion boxes must wait for authoritative merged/green evidence.

## Implementation Constraints

- Preserve `GET /health`, `POST /parse`, `POST /match`, and `POST /match/batch`;
  do not add a version prefix, redirects, runtime selectors, or consumer
  branching.
- Preserve observable validation and transport behavior measured from the
  oracle, including malformed/null/wrong-type/trailing JSON, unsupported
  methods/media types, unknown paths, duplicate properties/keys, errors,
  selected headers, and status codes.
- Preserve the dynamic-regex 100 ms contract, but explicitly configure and test
  regexp2 timeout checking and stack policy; static operations also require a
  finite measured budget.
- Preserve `PARSER_HOST`, `PARSER_PORT`, default port `5000`, private Compose
  networking, `ghcr.io/yandy-r/praxrr-parser`, service identities, and
  `praxrr-parser[.exe]`. A Go-native `PARSER_ADDR` may replace ASP.NET listener
  configuration; `ASPNETCORE_*` is transitional only.
- Keep all build/runtime output under repository-root `dist/`; run
  `deno task check:dist-paths` and ensure standalone builds do not mutate
  tracked files.
- Cross-build Linux x64/arm64, macOS x64/arm64, and Windows x64. Archive success
  requires exact layout plus native or explicitly justified platform smoke,
  including startup, health, parse, match, version, shutdown, and adjacent
  auto-spawn.
- Final completion requires deletion of C# endpoints/models/parsers,
  `Program.cs`, `Parser.csproj`, `Directory.Build.props`, `appsettings.json`,
  .NET container stages, dotnet/setup commands, and live ASP.NET/.NET
  documentation. Historical fixture provenance remains allowed and must be
  clearly labeled.
- Do not mark child issues #2-#5 or parent #1 complete in `ROADMAP.md` until
  their exit evidence, review/fix cycle, required CI, merge state, and cleanup
  are proven.

## Key Recommendations

1. Make issue #2 produce the non-negotiable contract artifacts first: pinned
   oracle manifest, golden corpus, HTTP matrix, regex inventory, workload
   measurements, Go module, explicit DTOs, centralized regex wrapper, and
   CI-visible validation commands.
2. Port domain parsers in dependency order—common, quality/revision, language,
   release group, movie title, episode—and require source-aligned review plus a
   focused regression fixture for every discrepancy.
3. Implement HTTP only after domain parity, using explicit decoding/encoding and
   bounded worker orchestration rather than `net/http` defaults or
   goroutine-per-cell scheduling.
4. Decide the deterministic behavior version and pattern-cache activation policy
   before switching any launcher. Test forward activation, restart,
   mixed-version operation, and rollback cache behavior.
5. Switch developer, standalone, container, CI, and release surfaces as one
   coordinated issue #5 cutover. Preserve names and topology, smoke real
   outputs, then delete all live .NET inputs in the same branch.
6. Use a completion audit that maps every issue acceptance item to authoritative
   evidence: fixture output, command result, cache test, load/race result,
   image/archive inspection, PR review/fix artifact, green required checks,
   squash merge, and local/remote worktree/branch cleanup.
