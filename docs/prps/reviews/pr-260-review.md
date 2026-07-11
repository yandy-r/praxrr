# PR Review #260 — feat(parser): replace .NET parser with Go

**Reviewed**: 2026-07-11T04:59:45Z
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/praxrr-parser-go → main
**Decision**: REQUEST CHANGES

## Summary

The Go parser cutover is strongly covered by immutable parity, boundary, lifecycle, application, and release tests. One branch-preservation regression in the newly hardened local-Git refresh path and two branch-owned formatting failures must be corrected before merge; the repository-wide lint command also retains unrelated clean-main failures.

## Findings

### CRITICAL

### HIGH

- **[F001]** `packages/praxrr-app/src/lib/server/utils/git/write.ts:174` — Refreshing a local Git source deletes the existing clone and reclones without preserving its checked-out branch. When the configured source branch differs from the source repository's default HEAD, a sync silently switches the target to the wrong branch.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Capture the target clone's current branch before removal and pass it to `cloneLocalGitRepository`; add a regression test using a non-default branch.

### MEDIUM

- **[F002]** `packages/praxrr-app/src/tests/e2e/helpers/entity.ts:1` — The branch-owned helper is not Prettier-clean, so scoped formatting validation fails.
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Format this file with the repository Prettier configuration.

- **[F003]** `packages/praxrr-parser/testdata/golden/manifest.json:1` — The generated golden manifest is not Prettier-clean, so scoped formatting validation fails.
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Format the manifest deterministically and ensure the capture workflow preserves that formatting.

### LOW

## Validation Results

| Check                | Result                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Type check           | Pass — `deno task check` (0 errors, 0 warnings)                                                         |
| Lint                 | Fail — full repo reports pre-existing clean-main failures; scoped branch check identifies F002 and F003 |
| Tests                | Pass — `scripts/check-parser-go.sh` and `deno task test` (2,353 passed, 0 failed)                       |
| Build                | Pass — `deno task build`                                                                                |
| Parser compatibility | Pass — 114 fixtures, race/adversarial gates, five cross-builds, and Deno consumers                      |

## Files Reviewed

- `.dockerignore` (Modified)
- `.github/copilot-instructions.md` (Modified)
- `.github/workflows/compatibility.yml` (Modified)
- `.github/workflows/docker.yml` (Modified)
- `.github/workflows/release.yml` (Modified)
- `.gitignore` (Modified)
- `CLAUDE.md` (Modified)
- `Dockerfile.parser` (Modified)
- `README.md` (Modified)
- `ROADMAP.md` (Modified)
- `compose.dev.yml` (Modified)
- `deno.json` (Modified)
- `docs/ARCHITECTURE.md` (Modified)
- `docs/CONTRIBUTING.md` (Modified)
- `docs/architecture/components.md` (Modified)
- `docs/architecture/data-flow.md` (Modified)
- `docs/plans/praxrr-parser-go/analysis-code.md` (Added)
- `docs/plans/praxrr-parser-go/analysis-context.md` (Added)
- `docs/plans/praxrr-parser-go/analysis-tasks.md` (Added)
- `docs/plans/praxrr-parser-go/cutover-evidence.md` (Added)
- `docs/plans/praxrr-parser-go/feature-spec.md` (Added)
- `docs/plans/praxrr-parser-go/parallel-plan.md` (Added)
- `docs/plans/praxrr-parser-go/research-architecture.md` (Added)
- `docs/plans/praxrr-parser-go/research-business.md` (Added)
- `docs/plans/praxrr-parser-go/research-docs.md` (Added)
- `docs/plans/praxrr-parser-go/research-external.md` (Added)
- `docs/plans/praxrr-parser-go/research-integration.md` (Added)
- `docs/plans/praxrr-parser-go/research-patterns.md` (Added)
- `docs/plans/praxrr-parser-go/research-practices.md` (Added)
- `docs/plans/praxrr-parser-go/research-recommendations.md` (Added)
- `docs/plans/praxrr-parser-go/research-security.md` (Added)
- `docs/plans/praxrr-parser-go/research-technical.md` (Added)
- `docs/plans/praxrr-parser-go/research-ux.md` (Added)
- `docs/plans/praxrr-parser-go/shared.md` (Added)
- `docs/site/src/content/docs/app/architecture.md` (Modified)
- `docs/site/src/content/docs/app/development.md` (Modified)
- `docs/site/src/content/docs/getting-started/installation.md` (Modified)
- `docs/site/src/content/docs/guides/troubleshooting.md` (Modified)
- `mise.toml` (Modified)
- `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts` (Modified)
- `packages/praxrr-app/src/lib/server/health/trends.ts` (Modified)
- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts` (Modified)
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` (Modified)
- `packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts` (Modified)
- `packages/praxrr-app/src/lib/server/utils/config/config.ts` (Modified)
- `packages/praxrr-app/src/lib/server/utils/git/write.ts` (Modified)
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts` (Modified)
- `packages/praxrr-app/src/routes/impact-simulator/[databaseId]/+page.svelte` (Modified)
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte` (Modified)
- `packages/praxrr-app/src/tests/e2e/helpers/dropdown.ts` (Modified)
- `packages/praxrr-app/src/tests/e2e/helpers/entity.ts` (Modified)
- `packages/praxrr-app/src/tests/e2e/helpers/linkPcd.ts` (Modified)
- `packages/praxrr-app/src/tests/e2e/helpers/unlinkPcd.ts` (Modified)
- `packages/praxrr-app/src/tests/e2e/specs/4.4-score-simulator-ux-basics.spec.ts` (Modified)
- `packages/praxrr-app/src/tests/e2e/specs/4.5-parser-dependent-surfaces.spec.ts` (Added)
- `packages/praxrr-app/src/tests/pcd/localPathGitClone.test.ts` (Modified)
- `packages/praxrr-app/src/tests/routes/entityTestingEvaluateRoute.test.ts` (Modified)
- `packages/praxrr-app/src/tests/routes/impactSimulatorRoute.test.ts` (Modified)
- `packages/praxrr-app/src/tests/routes/simulateScoreRoute.test.ts` (Modified)
- `packages/praxrr-app/src/tests/server/parserCacheCutover.test.ts` (Added)
- `packages/praxrr-app/src/tests/server/utils/config/parserUrl.test.ts` (Added)
- `packages/praxrr-parser/Directory.Build.props` (Deleted)
- `packages/praxrr-parser/Endpoints/HealthEndpoints.cs` (Deleted)
- `packages/praxrr-parser/Endpoints/MatchEndpoints.cs` (Deleted)
- `packages/praxrr-parser/Endpoints/ParseEndpoints.cs` (Deleted)
- `packages/praxrr-parser/Logging/Colors.cs` (Deleted)
- `packages/praxrr-parser/Logging/LogSettings.cs` (Deleted)
- `packages/praxrr-parser/Logging/Logger.cs` (Deleted)
- `packages/praxrr-parser/Logging/Startup.cs` (Deleted)
- `packages/praxrr-parser/Logging/Types.cs` (Deleted)
- `packages/praxrr-parser/Models/Language.cs` (Deleted)
- `packages/praxrr-parser/Models/Requests.cs` (Deleted)
- `packages/praxrr-parser/Models/Responses.cs` (Deleted)
- `packages/praxrr-parser/Models/Types.cs` (Deleted)
- `packages/praxrr-parser/Parser.csproj` (Deleted)
- `packages/praxrr-parser/Parsers/Common/ParserCommon.cs` (Deleted)
- `packages/praxrr-parser/Parsers/Common/RegexReplace.cs` (Deleted)
- `packages/praxrr-parser/Parsers/EpisodeParser.cs` (Deleted)
- `packages/praxrr-parser/Parsers/LanguageParser.cs` (Deleted)
- `packages/praxrr-parser/Parsers/QualityParser.cs` (Deleted)
- `packages/praxrr-parser/Parsers/ReleaseGroupParser.cs` (Deleted)
- `packages/praxrr-parser/Parsers/TitleParser.cs` (Deleted)
- `packages/praxrr-parser/Program.cs` (Deleted)
- `packages/praxrr-parser/README.md` (Added)
- `packages/praxrr-parser/appsettings.json` (Deleted)
- `packages/praxrr-parser/cmd/praxrr-parser/main.go` (Added)
- `packages/praxrr-parser/cmd/praxrr-parser/main_signal_unix_test.go` (Added)
- `packages/praxrr-parser/cmd/praxrr-parser/main_test.go` (Added)
- `packages/praxrr-parser/doc.go` (Added)
- `packages/praxrr-parser/go.mod` (Added)
- `packages/praxrr-parser/go.sum` (Added)
- `packages/praxrr-parser/internal/contract/request.go` (Added)
- `packages/praxrr-parser/internal/contract/response.go` (Added)
- `packages/praxrr-parser/internal/contract/types_test.go` (Added)
- `packages/praxrr-parser/internal/httpserver/handler.go` (Added)
- `packages/praxrr-parser/internal/httpserver/handler_test.go` (Added)
- `packages/praxrr-parser/internal/httpserver/server.go` (Added)
- `packages/praxrr-parser/internal/httpserver/server_test.go` (Added)
- `packages/praxrr-parser/internal/parity/adversarial_test.go` (Added)
- `packages/praxrr-parser/internal/parity/benchmark_test.go` (Added)
- `packages/praxrr-parser/internal/parity/differential_test.go` (Added)
- `packages/praxrr-parser/internal/parity/domain_test.go` (Added)
- `packages/praxrr-parser/internal/parity/foundation_test.go` (Added)
- `packages/praxrr-parser/internal/parity/golden.go` (Added)
- `packages/praxrr-parser/internal/parity/golden_test.go` (Added)
- `packages/praxrr-parser/internal/parity/static_safety_test.go` (Added)
- `packages/praxrr-parser/internal/parser/common.go` (Added)
- `packages/praxrr-parser/internal/parser/common_test.go` (Added)
- `packages/praxrr-parser/internal/parser/episode.go` (Added)
- `packages/praxrr-parser/internal/parser/episode_test.go` (Added)
- `packages/praxrr-parser/internal/parser/language.go` (Added)
- `packages/praxrr-parser/internal/parser/language_test.go` (Added)
- `packages/praxrr-parser/internal/parser/limits.go` (Added)
- `packages/praxrr-parser/internal/parser/limits_test.go` (Added)
- `packages/praxrr-parser/internal/parser/matcher.go` (Added)
- `packages/praxrr-parser/internal/parser/matcher_test.go` (Added)
- `packages/praxrr-parser/internal/parser/parity_bridge.go` (Added)
- `packages/praxrr-parser/internal/parser/quality.go` (Added)
- `packages/praxrr-parser/internal/parser/quality_test.go` (Added)
- `packages/praxrr-parser/internal/parser/regex.go` (Added)
- `packages/praxrr-parser/internal/parser/regex_test.go` (Added)
- `packages/praxrr-parser/internal/parser/releasegroup.go` (Added)
- `packages/praxrr-parser/internal/parser/releasegroup_test.go` (Added)
- `packages/praxrr-parser/internal/parser/service.go` (Added)
- `packages/praxrr-parser/internal/parser/service_test.go` (Added)
- `packages/praxrr-parser/internal/parser/title.go` (Added)
- `packages/praxrr-parser/internal/parser/title_test.go` (Added)
- `packages/praxrr-parser/testdata/golden/baseline.json` (Added)
- `packages/praxrr-parser/testdata/golden/domain-edges.jsonl` (Added)
- `packages/praxrr-parser/testdata/golden/http.jsonl` (Added)
- `packages/praxrr-parser/testdata/golden/limits.json` (Added)
- `packages/praxrr-parser/testdata/golden/manifest.json` (Added)
- `packages/praxrr-parser/testdata/golden/match-batch.jsonl` (Added)
- `packages/praxrr-parser/testdata/golden/match.jsonl` (Added)
- `packages/praxrr-parser/testdata/golden/parse.jsonl` (Added)
- `packages/praxrr-parser/testdata/golden/unicode-date.jsonl` (Added)
- `packages/praxrr-parser/tools/golden/README.md` (Added)
- `scripts/capture-parser-goldens.ts` (Added)
- `scripts/check-dist-paths.sh` (Modified)
- `scripts/check-parser-go.sh` (Added)
- `scripts/check-parser-retirement.sh` (Added)
- `scripts/dev.ts` (Modified)
- `scripts/measure-parser-baseline.ts` (Added)
- `scripts/smoke-parser-artifact.ts` (Added)
- `scripts/smoke-parser-container.ts` (Added)
- `scripts/smoke-parser-release.ts` (Added)
