# Documentation Research: Praxrr Parser Go Migration

## Executive Summary

The parser migration has a wide documentation cutover surface even though the
HTTP contract is intentionally unchanged. Current operator and contributor
documentation still calls `packages/praxrr-parser` a C#/.NET service, requires
the .NET SDK, points architecture readers at deleted-at-cutover `.cs` entry
points, and tells developers to expect `dotnet watch`. Those statements must
change in the same issue #5 commit that switches tasks, containers, CI,
releases, and standalone archives to Go.

The stable public language should remain deliberately boring: the optional
**Praxrr parser service** listens on port `5000`, is configured from the app
with `PARSER_HOST` and `PARSER_PORT`, is private in the supplied Compose
topology, and enables release-title parsing and .NET-compatible
regular-expression matching for testing and simulation. Runtime-neutral operator
text already using this language generally needs no rewrite. In particular,
“.NET-compatible regex” describes the observable regex contract, not the
implementation, and must be retained.

The migration also needs a new package-local `packages/praxrr-parser/README.md`.
It is the missing source of truth for the four parser routes, Go
development/build/test commands, golden-oracle regeneration, finite work limits,
safe logging, listener configuration, version/cache implications, and parity
gates. Public `/api/v1` schemas do not expose the parser's four private routes
and should not be expanded as part of this migration.

Historical plans and research accurately document the system that existed when
they were written. They should not be bulk-rewritten from “C#/.NET” to “Go”;
doing so would destroy design provenance and make old performance and
alternative analyses misleading. The frozen C# oracle, its provenance manifest,
and reproducible fixture-generation guidance also remain intentionally
documented after the live C# source is removed.

## Must-Read Documents

1. `docs/plans/praxrr-parser-go/feature-spec.md` — authoritative feature scope,
   compatibility rules, files, success criteria, and final-retirement
   requirement.
2. `docs/plans/praxrr-parser-go/research-architecture.md` — runtime topology,
   package boundaries, deployment identities, cache/version coupling, and issue
   #2-#5 gates.
3. `docs/plans/praxrr-parser-go/research-technical.md` — exact HTTP/JSON/regex
   behavior, target Go layout, fixture contract, and integration cutover.
4. `docs/plans/praxrr-parser-go/research-recommendations.md` — consolidated
   one-way cutover strategy and mandatory retirement audit.
5. `docs/plans/praxrr-parser-go/research-security.md` — limits, listener
   exposure, timeouts, safe logging, container, and supply-chain documentation
   requirements.
6. `docs/plans/praxrr-parser-go/research-ux.md` — operator recovery and
   parser-unavailable language that must remain accurate across the headless
   runtime migration.
7. `README.md` — primary operator install/Compose/configuration surface.
8. `docs/CONTRIBUTING.md` and `docs/site/src/content/docs/app/development.md` —
   contributor prerequisites, commands, and verification workflow.
9. `docs/ARCHITECTURE.md`, `docs/architecture/overview.md`,
   `docs/architecture/components.md`, and `docs/architecture/data-flow.md` —
   live architecture maps and source-entry-point links.
10. `docs/site/src/content/docs/getting-started/installation.md`,
    `docs/site/src/content/docs/getting-started/docker.md`,
    `docs/site/src/content/docs/guides/configuration.md`, and
    `docs/site/src/content/docs/guides/troubleshooting.md` — public setup and
    recovery contract.
11. `docs/api/v1/paths/entity-testing.yaml`,
    `docs/api/v1/schemas/entity-testing.yaml`, and
    `docs/api/v1/paths/system.yaml` — canonical public API source; generated
    copies must follow it.
12. `ROADMAP.md` — parent/child issue state and final completion evidence.

## Documentation Inventory

### Operator and user-facing documentation

| Path                                                         | Current state                                                                                         | Required disposition                                                                                                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                  | Compose identity, port, optionality, and `PARSER_*` are correct; source prerequisite says .NET 8+.    | Update prerequisite to the pinned Go toolchain and link parser package docs. Preserve image/service/binary names, port, variables, and optional-service note.                     |
| `docs/site/src/content/docs/getting-started/installation.md` | Source install requires optional .NET SDK; Compose contract is otherwise runtime-neutral and correct. | Replace .NET with Go prerequisite and link the parser development section/package README. Keep Compose example unchanged unless implementation changes its stable image contract. |
| `docs/site/src/content/docs/getting-started/docker.md`       | Correctly documents private `parser-dev:5000`, production parser opt-in, and `PARSER_*`.              | Retain topology and optionality. Add no Go implementation detail unless needed for source-built images; explicitly keep “internal-only.”                                          |
| `docs/site/src/content/docs/guides/configuration.md`         | Runtime-neutral and correct.                                                                          | Retain `PARSER_HOST`/`PARSER_PORT`; do not publish internal `PARSER_ADDR` as app configuration. A short link to parser troubleshooting is optional.                               |
| `docs/site/src/content/docs/guides/custom-formats.md`        | Runtime-neutral parser testing workflow.                                                              | Retain. If expanded, say matching is .NET-compatible, not that the runtime is .NET.                                                                                               |
| `docs/site/src/content/docs/guides/quality-profiles.md`      | Runtime-neutral parser availability statement.                                                        | Retain.                                                                                                                                                                           |
| `docs/site/src/content/docs/guides/troubleshooting.md`       | Correct container/host/port checks but no Go-specific binary diagnostics.                             | Preserve checks; add standalone adjacent-binary name, `/health`, startup/readiness, and safe recovery guidance without exposing release titles or patterns in suggested logs.     |
| `docs/features/entity-testing.md`                            | Correct degraded-mode behavior.                                                                       | Retain runtime-neutral language; optionally link parser troubleshooting/package contract.                                                                                         |
| `docs/api/endpoints.md`                                      | Correct public `parserAvailable` behavior.                                                            | Retain unless regenerated/updated from OpenAPI; no runtime name belongs here.                                                                                                     |

### Developer, architecture, and agent documentation

| Path                                             | Current state                                                                                                                           | Required disposition                                                                                                                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                      | Calls parser C#/.NET and points at a C# service.                                                                                        | Replace with Go service language and package-local README/Go entry points. Keep optionality and `PARSER_*`. This is the canonical project-agent source.                                                                           |
| `AGENTS.md`                                      | Duplicates project guidance, including C# and `dotnet watch`.                                                                           | Follow repository sync policy: update the generated/project-doc mirror from canonical `CLAUDE.md`; do not independently invent divergent prose.                                                                                   |
| `.github/copilot-instructions.md`                | Calls parser C#/.NET and documents `dotnet watch`.                                                                                      | Regenerate/synchronize from canonical project guidance after cutover; include the actual Go command and parity-test expectation.                                                                                                  |
| `docs/CONTRIBUTING.md`                           | Requires optional .NET SDK and has no parser-specific verification commands.                                                            | Require the pinned Go version for parser work; document `deno task dev:parser`, `go test ./...`, race/vet/module checks, and point to the package README for golden regeneration.                                                 |
| `docs/site/src/content/docs/app/development.md`  | Requires .NET, labels package C#, and says `dev:parser` runs `dotnet watch`.                                                            | Replace all three with Go, add parser-focused test/build commands, and mention that `deno task dev` may degrade to server-only when the Go toolchain/parser cannot start if that remains implemented behavior.                    |
| `docs/ARCHITECTURE.md`                           | Multiple live C# statements and links to `Parsers`, `Models`, `Endpoints`; correctly explains separate service and version-keyed cache. | Rewrite parser section around `cmd/praxrr-parser`, `internal/contract`, `internal/parser`, and `internal/httpserver`; retain separate-process rationale, .NET-compatible regex fidelity, optionality, and cache version coupling. |
| `docs/architecture/overview.md`                  | Diagram says C#; package table links `Program.cs`/`ParseEndpoints.cs`.                                                                  | Rename node to Go parser service and replace entry points with verified Go paths created by implementation.                                                                                                                       |
| `docs/architecture/components.md`                | Parser integration links deleted C# files.                                                                                              | Replace with Go command/server/parser boundary paths; retain auto-spawn and parser-client responsibilities.                                                                                                                       |
| `docs/architecture/data-flow.md`                 | Entity-testing flow is correct but key references point to deleted C# files.                                                            | Keep sequence semantics; replace references with Go HTTP/parser entry points and mention golden parity tests where appropriate.                                                                                                   |
| `docs/site/src/content/docs/app/architecture.md` | Diagram/table identify an optional .NET service.                                                                                        | Change runtime label to Go; add package/HTTP boundary references without duplicating the package README.                                                                                                                          |
| `docs/README.md`                                 | Generated/navigation index already anticipates the parser-go plan artifacts.                                                            | Regenerate after all planning outputs exist; do not hand-maintain stale links. Verify `research-docs.md`, `shared.md`, analyses, and final plan links resolve.                                                                    |

### API and generated contract documentation

| Path                                                                         | Current state                                                                | Required disposition                                                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `docs/api/v1/paths/entity-testing.yaml`                                      | Says matching uses “.NET-compatible regex via the parser service.”           | Retain exactly in substance. This is a compatibility promise, not an obsolete runtime claim. |
| `docs/api/v1/schemas/entity-testing.yaml`                                    | Runtime-neutral `parserAvailable` description.                               | Retain.                                                                                      |
| `docs/api/v1/paths/system.yaml`                                              | Runtime-neutral app-side parser health endpoint.                             | Retain. It is distinct from the private parser's `GET /health`.                              |
| `packages/praxrr-api/openapi.json`                                           | Generated artifact contains the same descriptions.                           | Do not hand-edit; regenerate only if canonical OpenAPI changes.                              |
| `packages/praxrr-api/types.ts` and `packages/praxrr-app/src/lib/api/v1.d.ts` | Generated types/comments inherit OpenAPI text.                               | Do not hand-edit; regenerate and diff only when source contract changes.                     |
| `packages/praxrr-api/README.md`                                              | No parser-runtime coupling.                                                  | No change.                                                                                   |
| `packages/praxrr-db/README.md`                                               | No parser-runtime coupling.                                                  | No change.                                                                                   |
| `packages/praxrr-schema/README.md`                                           | Mentions parsing upstream Arr C# source, unrelated to Praxrr parser runtime. | Retain; it documents schema validation inputs, not the service being migrated.               |

### Build, release, and package documentation surfaces

| Path                                  | Current state                                                                                     | Required disposition                                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-parser/README.md`    | Missing.                                                                                          | Create as the parser's durable contract/developer/operator source of truth; detailed outline below.                                                                                                                                          |
| `Dockerfile.parser`                   | Header and executable describe .NET; implementation is entirely dotnet/ASP.NET.                   | Replace comments/examples with pinned Go multi-stage build, stable image name/port/health, minimal non-root runtime, and explicit private/container bind behavior.                                                                           |
| `deno.json`                           | Task descriptions are implicit in command strings; `dev:parser` and standalone builds use dotnet. | Switch tasks to documented Go commands while preserving task names and output filenames. Documentation must quote tasks, not duplicate fragile command lines where avoidable.                                                                |
| `scripts/dev.ts`                      | User-visible messages say `.NET`/`dotnet not found`.                                              | Change messages to Go/parser terminology and keep server-only degradation accurate.                                                                                                                                                          |
| `compose.dev.yml`                     | Runtime-neutral identity and watch path are correct.                                              | Retain names and private port. Verify comments/watch ignores describe Go artifacts if added.                                                                                                                                                 |
| `.github/workflows/compatibility.yml` | Watches parser paths but has no parser-specific Go gate in the surfaced matrix.                   | Document/check Go module changes as app-impacting and require parser tests in the workflow; no prose doc change beyond package README/CONTRIBUTING.                                                                                          |
| `.github/workflows/docker.yml`        | Stable parser image matrix.                                                                       | Retain image and Dockerfile names; add/describe image smoke evidence in release/PR notes, not public API docs.                                                                                                                               |
| `.github/workflows/release.yml`       | Names `DOTNET_VERSION`, `dotnet_rid`, setup-dotnet, and publishes C# binaries.                    | Replace with pinned Go version/targets and archive smoke checks. Keep `praxrr-parser[.exe]` archive names. Release notes should call out runtime replacement, lower dependency burden, stable config/API, and rollback artifact identifiers. |
| `.gitignore` and `.dockerignore`      | Contain only .NET parser artifact rules.                                                          | Remove obsolete parser-specific .NET rules after source retirement; add narrowly scoped Go output ignores without excluding `testdata/golden`, provenance, `go.mod`, or `go.sum`.                                                            |

## Documentation Gaps

### Missing package-local source of truth

Create `packages/praxrr-parser/README.md` with these exact subjects:

1. Purpose, optional-service behavior, and stable identities: image
   `ghcr.io/yandy-r/praxrr-parser`, port `5000`, executables `praxrr-parser` and
   `praxrr-parser.exe`.
2. Private HTTP contract table for `GET /health`, `POST /parse`, `POST /match`,
   and `POST /match/batch`, including exact request/response examples and a link
   to golden contract tests rather than duplicating every edge-case matrix.
3. Explicit statement that regex behavior is .NET-compatible through regexp2
   default mode; Go standard `regexp`, RE2 mode, and ECMAScript mode are not
   substitutes.
4. Local prerequisites and verified commands for run, test, race, vet,
   formatting, module verification, cross-build, and focused golden/differential
   tests.
5. Configuration boundary: app-side `PARSER_HOST`/`PARSER_PORT`; process-side
   `PARSER_ADDR`; loopback standalone spawn and explicit private container bind.
   Do not document removed `ASPNETCORE_*` variables as supported after final
   cutover.
6. Golden corpus provenance and regeneration workflow, including pinned legacy
   source commit, .NET runtime/container, OS, culture/globalization, time zone,
   and review rule.
7. Finite request/body/item/work-product/concurrency/regex timeout and stack
   limits with their exact implemented values, rejection behavior, and
   measurement basis.
8. Safe logging policy: counts, classes, and fingerprints only; never release
   titles, regex bodies, secrets, hostnames, or raw request bodies.
9. Version semantics: `/health` version namespaces application caches;
   intentional bumps require full parity and cache tests.
10. Container and standalone smoke commands, graceful shutdown behavior, and
    supported release platforms.

### No explicit cutover/release note template

The repository has no general changelog for the application. The merge/PR body
and GitHub release notes therefore need a dedicated migration section that
records:

- the Go replacement and removal of the runtime/SDK dependency on .NET;
- unchanged parser image, port, `PARSER_*`, endpoints, and adjacent binary
  names;
- the intentional parser version value and cache consequence;
- parity/security/performance evidence and supported archive matrix;
- parser container and standalone smoke results;
- rollback image/archive identifiers and checksums;
- any deliberately unsupported listener compatibility, especially removal of
  `ASPNETCORE_URLS`.

### Public docs do not explain the two health endpoints

`docs/api/v1/paths/system.yaml` documents the app-facing `/api/v1/parser/health`
availability check, while the private parser exposes `GET /health`. The package
README and troubleshooting guide should distinguish them so operators do not
expose the parser or probe the wrong process.

### Limits and failure classes are not operator-visible

Current docs say only “parser unavailable.” Final docs must separately describe
service unavailability, validation/over-limit rejection, invalid or timed-out
regex cells, and a domain non-match. User guidance should not imply that an
invalid pattern or ordinary non-match means the service is unhealthy.

### Development docs omit parser-specific quality gates

Contributor docs currently list only Deno gates. They need the real Go parity,
race, vet, module, fuzz-seed/adversarial, container, and archive gates, with
expensive or platform-specific commands clearly labeled. Documentation must be
written against the implemented task/workflow names, not planned names.

## Exact Per-File Update and Delete Guidance

### Update in the final integration/cutover change

- `README.md`: replace the .NET SDK prerequisite with the pinned Go version; add
  a link to `packages/praxrr-parser/README.md`; preserve Compose contract and
  optionality.
- `CLAUDE.md`: replace C#/.NET tech-stack and service-layout descriptions with
  Go and add actual Go test/run commands. Keep it canonical.
- `AGENTS.md`: synchronize its embedded project documentation from `CLAUDE.md`
  according to the repository policy; remove `dotnet watch` and C# labels.
- `.github/copilot-instructions.md`: synchronize the Go toolchain, `dev:parser`,
  service layout, and parser verification rules.
- `docs/CONTRIBUTING.md`: replace prerequisite; add package README and Go
  validation links/commands.
- `docs/ARCHITECTURE.md`: rewrite section 8 and every C# path reference; retain
  .NET-compatible regex rationale and version-keyed cache behavior.
- `docs/architecture/overview.md`: update diagram runtime label and package
  entry points.
- `docs/architecture/components.md`: replace `Program.cs` and
  `ParseEndpoints.cs` with implemented Go paths.
- `docs/architecture/data-flow.md`: replace `Program.cs` and `MatchEndpoints.cs`
  with implemented Go paths; retain flow.
- `docs/site/src/content/docs/app/architecture.md`: change `.NET` runtime labels
  to Go.
- `docs/site/src/content/docs/app/development.md`: update prerequisite, package
  purpose, task implementation, and verification commands.
- `docs/site/src/content/docs/getting-started/installation.md`: replace optional
  .NET prerequisite and link source developers to Go instructions.
- `docs/site/src/content/docs/guides/troubleshooting.md`: add binary, direct
  private health, classified failure, restart, and safe-log guidance.
- `docs/site/src/content/docs/getting-started/docker.md`: retain current
  networking and opt-in language; update only any source-build/runtime wording
  introduced elsewhere.
- `docs/site/src/content/docs/guides/configuration.md`: retain app-side
  variables and add a cross-link; do not add `PARSER_ADDR` to app configuration.
- `packages/praxrr-parser/README.md`: create the missing source of truth using
  the outline above.
- `Dockerfile.parser`: update human-readable build/run/runtime comments along
  with the Go implementation.
- `ROADMAP.md`: move #1-#5 out of deferred/low-priority language only after
  evidence is complete; add dated completed entries with issue/PR links and
  concise parity, security, artifact, docs, .NET-retirement, and CI evidence. Do
  not mark the parent complete before all child checklists are actually closed.
- `docs/README.md`: regenerate after design/plan/research files are final so
  every link is present and no nonexistent analysis file is advertised.

### Review but normally retain unchanged

- `docs/api/v1/paths/entity-testing.yaml`: retain “.NET-compatible regex.”
- `docs/api/v1/schemas/entity-testing.yaml`, `docs/api/v1/paths/system.yaml`,
  and `docs/api/endpoints.md`: retain runtime-neutral parser availability
  contract.
- `docs/features/entity-testing.md`,
  `docs/site/src/content/docs/guides/custom-formats.md`, and
  `docs/site/src/content/docs/guides/quality-profiles.md`: retain
  workflow/optional service wording unless links are added.
- `compose.dev.yml`: retain service/hostname/port/private-network identity.
- `packages/praxrr-api/README.md`, `packages/praxrr-db/README.md`, and
  `packages/praxrr-schema/README.md`: no migration-specific edit. The schema
  README's C# wording concerns upstream Arr source parsing and must not be
  mechanically changed.

### Delete or remove from live documentation at final retirement

- Delete no historical Markdown solely because it mentions the old runtime.
- Remove all live claims that developers need the .NET SDK or that the parser is
  written in C#.
- Remove all live `dotnet`, `Parser.csproj`, `Program.cs`, `Endpoints/*.cs`,
  `ASPNETCORE_URLS`, and `ASPNETCORE_ENVIRONMENT` instructions after launchers
  and builds have cut over.
- Remove obsolete `.NET` parser artifact ignore comments/rules from `.gitignore`
  and `.dockerignore` when the C# tree is deleted.
- Delete temporary dual-runtime/oracle instructions only if reproducible
  tagged-container fixture regeneration remains documented elsewhere. The
  provenance manifest and golden corpus must stay.

## Historical References to Retain

The following are provenance, not live operator instructions, and should retain
their time-accurate C#/.NET descriptions:

- `docs/plans/score-simulator/` research, spec, shared context, and plan files;
- `docs/plans/score-simulator-phase2/` research and shared context;
- `docs/plans/score-simulator-phase3/` research files;
- `docs/plans/progressive-disclosure/research-integration.md`;
- the parser migration's own `docs/plans/praxrr-parser-go/research-*.md` and
  `feature-spec.md`, including descriptions of the legacy oracle;
- unrelated external research describing Radarr/Sonarr/Lidarr's C#/.NET
  implementation, including
  `docs/plans/resolved-config-viewer/research-external.md` and
  `docs/plans/setup-wizard/research-external.md`;
- `packages/praxrr-schema/README.md` statements about parsing canonical Arr C#
  source;
- checked-in golden fixture provenance and oracle regeneration records.

If historical documents are easy to mistake for current instructions, add a
concise status banner with date and link to `packages/praxrr-parser/README.md`;
do not rewrite their analysis, measured assumptions, or alternatives. Never
globally replace `.NET` with `Go`: it would corrupt the required
`.NET-compatible regex` promise and unrelated Arr-source documentation.

## Validation and Search Strategy

Run the documentation audit only after the C# source and transitional build
paths are removed, from a clean checkout of the feature branch.

### 1. Hard retirement searches

These searches must have no live hits outside explicitly reviewed
historical/provenance allowlists:

```bash
rg -n -i 'dotnet|Parser\.csproj|Program\.cs|Endpoints/.*\.cs|ASPNETCORE_' \
  README.md CLAUDE.md AGENTS.md .github docs packages scripts deno.json \
  Dockerfile.parser compose.dev.yml

rg -n -i 'C# parser|C# microservice|\.NET parser|\.NET microservice|\.NET SDK' \
  README.md CLAUDE.md AGENTS.md .github/copilot-instructions.md \
  docs/CONTRIBUTING.md docs/ARCHITECTURE.md docs/architecture \
  docs/site/src/content/docs packages/praxrr-parser
```

Review every hit; do not assert zero repository-wide because historical research
and upstream Arr documentation legitimately retain some terms.

### 2. Stable-contract searches

Confirm the stable identities remain documented and implemented:

```bash
rg -n 'PARSER_HOST|PARSER_PORT|5000|praxrr-parser|/match/batch|/health' \
  README.md docs packages/praxrr-parser Dockerfile.parser compose.dev.yml \
  deno.json .github/workflows

rg -n '\.NET-compatible regex|regexp2' \
  docs packages/praxrr-parser
```

Inspect results for accidental public documentation of `PARSER_ADDR` or removed
`ASPNETCORE_*` compatibility. Verify the app-facing `/api/v1/parser/health` and
private parser `/health` are described as distinct endpoints.

### 3. Path and link validation

- Use `test -e` or `rg --files` to prove every new Go source path cited by docs
  exists.
- Verify no live doc links a deleted `.cs` file.
- Regenerate `docs/README.md` with the repository's documentation index
  mechanism.
- Run the docs site's link/build validation and manually inspect generated
  navigation for the parser package and migration plan.

### 4. Formatting and generated artifacts

Run the repository's actual documentation gates after implementation determines
their final names:

```bash
deno task format:check
deno task docs:build
```

If canonical OpenAPI text changes, run `deno task generate:api-types` and verify
`packages/praxrr-api/openapi.json`, `packages/praxrr-api/types.ts`, and
`packages/praxrr-app/src/lib/api/v1.d.ts` contain only expected generated diffs.
Do not regenerate them merely because the runtime language changed.

### 5. Command truth tests

Execute every command printed in `packages/praxrr-parser/README.md` and
developer docs:

- local run followed by `GET /health`, one `/parse`, one `/match`, and one
  `/match/batch`;
- focused and full Go tests, race, vet, module verification, and committed fuzz
  seeds;
- parser container build/health/smoke as the documented non-root user;
- every supported standalone archive, confirming exact adjacent binary name and
  lifecycle;
- Deno parser-client/integration tests and focused parser-dependent E2E;
- a parser-absent scenario proving documented graceful degradation.

Commands that require a platform runner or container engine must be labeled
accordingly; documentation evidence must reference the CI job that executed
them.

### 6. Release and completion audit

Before editing the roadmap to complete:

- verify issues #2-#5 exit gates and parent #1 checklist against current GitHub
  state;
- verify the PR/release notes include compatibility, version/cache, performance,
  security-limit, archive, image, rollback, and .NET-retirement evidence;
- search the built container and unpacked archives for expected binary names and
  absence of .NET runtime payloads;
- confirm all required CI checks are green;
- rerun the hard-retirement searches on the merge candidate, not an earlier
  commit.

Only then record the completed issue and PR links in `ROADMAP.md`.
