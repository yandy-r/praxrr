# Go Parser Pre-Merge Cutover Evidence

Recorded at `2026-07-11T04:02:37Z`, updated with blocker-resolution evidence
at `2026-07-11T04:19:50Z`, and reconciled after source retirement on
`2026-07-11`, from source revision
`a02b62eac1f69b28f98349f9c2814181be2e122c` in the
`feat/praxrr-parser-go` worktree.

## Decision

**Issues #1-#5 are implemented in PR, pending review/CI/merge.** Parser parity,
security, cache, container, release-artifact, full Deno test, parser E2E, an
authoritative representative remote Git workflow, documentation, and C# source
retirement all pass their local gates. Two limitations remain and are carried
without overstating them:

1. `deno task lint` reports 57 Prettier failures in untouched committed files.
   Independent base/feature classification confirms that every issue-owned path
   is Prettier-clean, so this is not a branch regression.
2. The reusable PR artifact matrix has not run yet, so native macOS and Windows
   startup and termination evidence remains pending review/CI/merge.

The original `yandy-r/praxrr-db-testing` remote required to reproduce the
historical 172-test E2E run exactly no longer exists. The accepted replacement
evidence is the parser-specific 11/11 suite, seven direct local Git tests, and a
production-equivalent clone/edit/export/push/pull/conflict/reset workflow
against an ignored local bare remote. This is not a claim that the 172
historical scenarios were replayed.

The previously recorded config-health clock failure is fixed and the full Deno
test suite is green at 2,349 passed and 0 failed. Local Git clone/export defects
discovered while replacing the missing fixture are also fixed and covered
directly. The legacy C# source and active .NET build/runtime inputs have been
removed; immutable oracle fixtures and rollback provenance remain.

## Environment and Oracle Identity

| Evidence                                       | Result                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Go toolchain                                   | `go1.26.5 linux/amd64`                                                                                  |
| Deno toolchain                                 | `2.9.1 x86_64-unknown-linux-gnu`                                                                        |
| Go behavior version                            | `2.0.0-go.1`                                                                                            |
| Golden corpus                                  | 114 oracle fixtures: batch 9, date 13, domain 40, HTTP 24, match 14, parse 8, Unicode 6                 |
| Oracle health                                  | `{"status":"healthy","version":"1.0.0"}`                                                                |
| Live oracle container image                    | `sha256:9f150cfe1a0d14bcf5d0ed089b11dffca3015672736d95733014b13e6b2c4392`                               |
| Oracle entrypoint/runtime                      | `["dotnet","Parser.dll"]`; ASP.NET Core and .NET Core `8.0.28`, invariant globalization, `C.UTF-8`, UTC |
| Published rollback image recorded by workflows | `ghcr.io/yandy-r/praxrr-parser@sha256:59edc5953cf89b237461f5df1d44d0f9b6887baaee9f096626ffb99a2d67802c` |

The corpus manifest records the same source revision and live-oracle identity.
Its SHA-256 is
`34972f6ce61d7f7c0fc1b81f03ec32fd687f9427494ed7db89883b5b34093bad`.

## Go Compatibility, Differential, and Security Gates

| Gate                                                                                                | Result                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-parser-go.sh` with the live oracle                                                   | PASS. Pinned version, `gofmt`, `go mod tidy -diff`, `go mod verify`, `go vet`, regex-import boundary, unit/golden/live differential, race, adversarial seeds, five cross-builds, and five Deno consumer suites passed. |
| Full differential, adversarial, and listener performance run                                        | PASS. All 114 fixtures had zero supported semantic or selected-transport differences. Maximum/one-over limits, catastrophic regexes, concurrency, disconnect, HTTP framing, and health-under-load cases passed.        |
| `go test -race -count=1 -timeout=15m ./...`                                                         | PASS for every Go package.                                                                                                                                                                                             |
| `go test -count=1 -timeout=3m ./internal/parity -run '^$' -fuzz='^FuzzHandlerSeeds$' -fuzztime=10s` | PASS: 368,123 executions, 132 new interesting inputs, 296 total corpus entries.                                                                                                                                        |
| `CGO_ENABLED=0 GOOS/GOARCH go build` matrix                                                         | PASS for `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`, and `windows/amd64`.                                                                                                                            |

Static and dynamic regex work remains finite: dynamic operations have a 100 ms
deadline, static operations have a finite measured deadline, stack and request
limits are bounded, and `regexp2` is imported only through
`internal/parser/regex.go`. Required tests contain no skips.

## Performance and Lifecycle

| Gate                               |                    Go result |                      Baseline/limit | Result |
| ---------------------------------- | ---------------------------: | ----------------------------------: | ------ |
| In-process startup to health       |                 `440.671 us` |             legacy p95 `484.181 ms` | PASS   |
| Isolated process startup to health |               `24.042929 ms` |             legacy p95 `484.181 ms` | PASS   |
| Warm 50-request latency p95 / p99  | `922.356 us` / `1.392642 ms` |              legacy p95 `15.998 ms` | PASS   |
| Isolated idle RSS                  |           `13,918,208 bytes` | below legacy p50 `23,750,246 bytes` | PASS   |
| Graceful shutdown                  |                `1.209556 ms` |                 at most `10,000 ms` | PASS   |

The measured performance commands were:

```text
PRAXRR_LEGACY_PARSER_URL=http://172.19.0.6:5000 go test -count=1 -v -timeout=10m ./internal/parity -run '^(TestDifferentialListenerFullCorpus|TestAdversarial|TestPerformanceListenerLatencyAndLifecycle)$'
PRAXRR_LEGACY_PARSER_URL=http://172.19.0.6:5000 PRAXRR_PERF_GATE=1 go test -count=1 -v -timeout=5m ./internal/parity -run '^TestPerformanceCandidateProcessRSSAndShutdown$'
```

## Cache and Rollback

`deno test -A packages/praxrr-app/src/tests/server/parserCacheCutover.test.ts`
passed one test with five required steps:

- same-version cache hits survive a restart;
- a new Go behavior version cannot hit the old namespace;
- an unavailable parser returns partial cached results and fills misses after
  recovery;
- C# rollback uses a distinct namespace;
- raw titles, text, patterns, and echoed bodies never appear in failure logs.

The compatibility and release workflows retain the immutable C# rollback
image, source revision, runtime, corpus oracle identity, checksums, SBOM, and
provenance fields.

## Container Evidence

Command:

```text
deno run -A scripts/smoke-parser-container.ts --image ghcr.io/yandy-r/praxrr-parser:task-5-4 --expected-image-id sha256:c9de2a84fbadc232718548284ef3e9b27090439a229784923ce0d53d0769c8fa
```

Result: PASS. The immutable image ID matched, health reported
`2.0.0-go.1`, the entrypoint was `/app/praxrr-parser`, runtime UID was `1000`,
the smoke container used `network=none`, no port was published, parse/match/batch
semantics passed, and graceful termination returned exit code 0. The
`Dockerfile.parser` SHA-256 is
`6c74b124ea54ae49f55a9406c6dff7a9208109bf52abb5e24c736f0c0f71fbaa`.

## Release Archive Evidence

All archives passed checksum, executable-magic, adjacent layout, `server.js`,
and `static/` inspection through `scripts/smoke-parser-release.ts`.

| Platform    | SHA-256                                                            | Native evidence                                                                                         |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Linux x64   | `1d114c81cc29b5ba651e20828710bc3b1d4c07c4b75e0134c6023dbcd6d2cdea` | PASS: app plus adjacent parser startup, health/version, parse/match/batch, and parent-child termination |
| Linux arm64 | `8577d53819de3d129ded841e63623d361c22b24a2b59dce07ef91ad4fb5cdc95` | Cross-architecture layout/checksum inspection passed locally                                            |
| macOS x64   | `32409c37bf697198f72e873dc6cec59b4a82d9c021d6782941294f9070c94319` | Cross-platform layout/checksum inspection passed locally                                                |
| macOS arm64 | `fb72af7bb2ad9c72c7c6546ac24669b0ae94d226c38fab61c68d72a8eff1072d` | Cross-platform layout/checksum inspection passed locally                                                |
| Windows x64 | `f64bd99821a67044318cc0cef366185346ec5b3e3084d79cdc4a25763950292b` | Cross-platform layout/checksum inspection passed locally                                                |

The reusable PR artifact matrix must still supply native macOS and Windows
startup/termination evidence before merge; local cross-platform inspection is
not a substitute for that CI evidence.

## Deno, Consumer, and E2E Evidence

| Command                                                                                                    | Result                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deno task check`                                                                                          | PASS: server check and Svelte check completed with 0 errors and 0 warnings.                                                                                                                                                                                    |
| `deno task build`                                                                                          | PASS: production Vite build and Linux x64 Deno compile completed. Existing Rollup circular-chunk warnings were non-fatal.                                                                                                                                      |
| `deno task check:dist-paths`                                                                               | PASS: build/runtime paths remain repo-local.                                                                                                                                                                                                                   |
| `DB_PATH=$PWD/dist/test/parser-surfaces/data/praxrr.db deno task test:e2e:reset -- --database-id 1 --head` | PASS; reported `a02b62eac1f69b28f98349f9c2814181be2e122c`.                                                                                                                                                                                                     |
| `npx playwright test packages/praxrr-app/src/tests/e2e/specs/4.4-score-simulator-ux-basics.spec.ts`        | PASS: 8 passed, 0 skipped, 0 failed in 39.1 s against an initialized DB and real Go parser.                                                                                                                                                                    |
| `npx playwright test packages/praxrr-app/src/tests/e2e/specs/4.5-parser-dependent-surfaces.spec.ts`        | PASS: 3 passed, 0 skipped, 0 failed in 16.4 s against an initialized DB and real Go parser.                                                                                                                                                                    |
| `deno test -A packages/praxrr-app/src/tests/pcd/localPathGitClone.test.ts`                                 | PASS: 7 passed, 0 failed. Covers filesystem copy, working and bare Git clones, writable `origin/main`, export preflight divergence, bounded cleanup, `file://`, and refresh.                                                                                   |
| Authoritative E2E `1.1 CF name rename conflict - a) override`                                              | PASS in 1.8m against an ignored local bare remote. Exercised clone, edit, export, fully qualified push, pull, conflict, override, reset, and clean resource cleanup.                                                                                           |
| `deno task lint`                                                                                           | BASELINE BLOCKER: 57 untouched committed files fail Prettier. Independent feature/base classification matched; all issue-owned files pass Prettier.                                                                                                            |
| `deno task test`                                                                                           | PASS: 2,349 passed, 0 failed across 51 steps in about 1m6s after correcting the fixed-clock boundary in `trends.ts`.                                                                                                                                           |
| `deno task test:e2e`                                                                                       | NOT EQUIVALENTLY REPLAYABLE: the historical suite depends on the removed `yandy-r/praxrr-db-testing` remote. Parser-specific 11/11 and one production-equivalent remote workflow are green, but the ledger does not claim all 172 historical scenarios passed. |

The focused parser consumer tests in `scripts/check-parser-go.sh` also passed
cache cutover, parser URL refresh, entity testing, score simulation, and impact
simulation with the real Go service.

## Issue Checklist Reconciliation

All five GitHub issues remain open with unchecked source checklists before the
PR lifecycle. The implementation evidence maps to those checklists as follows:

| Issue                                            | Implemented gate                                                                                                                                                                                                | Pre-merge status                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [#2](https://github.com/yandy-r/praxrr/issues/2) | The 114-fixture corpus, Go module and contract models, strict golden harness, shared parser utilities, and bounded regexp2 boundary are implemented and locally validated.                                      | Implemented in PR, pending review/CI/merge.                                                               |
| [#3](https://github.com/yandy-r/praxrr/issues/3) | Quality, language, release-group, title, episode, and common parsing rules pass the immutable domain corpus and focused/race tests.                                                                             | Implemented in PR, pending review/CI/merge.                                                               |
| [#4](https://github.com/yandy-r/praxrr/issues/4) | Parse orchestration, `/health`, `/parse`, `/match`, and `/match/batch` preserve the recorded JSON, status, header, version, and validation contract.                                                            | Implemented in PR, pending review/CI/merge.                                                               |
| [#5](https://github.com/yandy-r/praxrr/issues/5) | Go container and release workflows, adjacent-binary spawn, cache-version cutover, operator/developer docs, and atomic legacy source retirement are implemented; local Linux and cross-build/archive gates pass. | Implemented in PR, pending review/CI/merge; native macOS/Windows runtime jobs are still pending.          |
| [#1](https://github.com/yandy-r/praxrr/issues/1) | All four child scopes and the parent parity, CI/CD, and legacy-removal acceptance gates are represented by the evidence in this ledger.                                                                         | Implemented in PR, pending review/CI/merge; parent completion and issue closure are verified after merge. |

## Documentation and Retirement Evidence

- `packages/praxrr-parser/README.md`, contributor guidance, architecture docs,
  published installation/development/troubleshooting pages, and canonical agent
  instructions describe the Go source of truth, four-route contract, finite
  limits, cache/version policy, deployment, recovery, and fixture workflow.
- `scripts/check-parser-retirement.sh` passes with 114 immutable fixtures and no
  active C# source, project/config file, .NET build command, ASP.NET runtime
  input, or deleted-source link in executable build, launch, container, or CI
  surfaces.
- The C# oracle identity and immutable rollback image remain documented as
  historical evidence, not as a shipped runtime dependency.

### Post-blocker production corrections

- `packages/praxrr-app/src/lib/server/health/trends.ts` now derives relative
  range boundaries from the injected/fixed clock; the former one-day drift is
  removed and the complete Deno suite passes.
- `packages/praxrr-app/src/lib/server/utils/git/write.ts` preserves real local
  Git semantics for working and bare sources while retaining recursive-copy
  behavior for non-Git directories.
- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts` pushes the fully
  qualified refspec needed by a bare origin.
- The focused seven-test Git suite and the end-to-end remote conflict workflow
  both pass, establishing direct evidence rather than treating the local
  fixture as a mock.

## Resource and Worktree State

- No task-owned Vite, Go parser, Playwright, archive-smoke, or container-smoke
  process/container remains running.
- The ignored `dist/` tree contains the local acceptance outputs. No release
  archive was staged.
- The accidentally retained untracked `packages/praxrr-parser/praxrr-parser`
  build binary was removed.
- `parser-dev` remains available only as the pinned external oracle used to
  establish the immutable corpus; it is not an active repository runtime input.
- At the post-blocker update, `git status --short` contained 29 modified paths
  and 17 untracked path groups, all belonging to the in-progress implementation
  and planning work. There are no commits or pushes from this acceptance task.

## Completion Gate

The accepted replacement for the unavailable historical E2E remote authorized
atomic C# source retirement. The retirement guard and local parser, Deno, cache,
security, performance, container, archive, documentation, and exercised Git
workflow gates now pass. The 57-file lint result remains a documented repository
baseline exception and is not reported as green.

This ledger is deliberately pre-merge: issues #1-#5 are implemented in PR,
pending review/CI/merge. The PR matrix must still provide native macOS and
Windows startup/termination evidence. Review findings, CI results, squash merge,
issue closure, and cleanup are recorded only after they become authoritative.
