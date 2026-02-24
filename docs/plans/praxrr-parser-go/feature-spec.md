# Feature Spec: praxrr-parser-go

## Executive Summary

The praxrr parser is a C#/.NET 8 microservice (~1,600 LOC of parsing logic across 6 parser files)
that parses media release titles to extract quality, resolution, language, episode info, and release
group metadata, and provides .NET-compatible regex matching for custom format evaluation. The .NET
choice was made for **regex engine parity with Radarr/Sonarr** -- the 96 regex patterns are ported
directly from their C# codebases and rely heavily on .NET-specific features (119 named groups, 53
negative lookaheads, 42 negative lookbehinds, 2 backreferences, inline modifiers). Research
identified two viable migration paths: **(A) Go HTTP microservice** using `dlclark/regexp2` (a
pure-Go .NET regex engine port) as a drop-in replacement with dramatically smaller Docker images
(5-15 MB vs ~110 MB), or **(B) TypeScript/Deno port** that eliminates the microservice entirely
since parsing is pure string/regex manipulation and JS regex supports most .NET features since
ES2018+. The primary risk for either approach is regex behavioral parity, compounded by the absence
of any parser-specific tests in the current codebase.

## External Dependencies

### APIs and Services

The parser is a self-contained microservice with **no external API dependencies**. It communicates
only with the main praxrr app via HTTP on port 5000.

#### Current Parser HTTP API

- **Base URL**: `http://{PARSER_HOST}:{PARSER_PORT}` (default: `http://localhost:5000`)
- **Endpoints**: `POST /parse`, `POST /match`, `POST /match/batch`, `GET /health`
- **Authentication**: None (internal service)
- **Rate Limits**: None
- **Pricing**: Self-hosted, no external costs

### Libraries and SDKs

#### Option A: Go Rewrite

| Library                      | Version  | Purpose                                                                         | Installation                        |
| ---------------------------- | -------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| `github.com/dlclark/regexp2` | v1.11.5+ | .NET-compatible regex engine (pure Go port of `System.Text.RegularExpressions`) | `go get github.com/dlclark/regexp2` |
| `net/http` (stdlib)          | Go 1.22+ | HTTP server with method-based routing                                           | Built-in                            |
| `encoding/json` (stdlib)     | Go 1.x   | JSON serialization                                                              | Built-in                            |
| `log/slog` (stdlib)          | Go 1.21+ | Structured logging                                                              | Built-in                            |

#### Option B: TypeScript/Deno Port

| Library | Version | Purpose                                    | Installation |
| ------- | ------- | ------------------------------------------ | ------------ |
| None    | N/A     | All parsing uses Deno stdlib + JS `RegExp` | N/A          |

### External Documentation

- [regexp2 GitHub Repository](https://github.com/dlclark/regexp2): .NET regex engine port for Go
- [regexp2 Package Docs](https://pkg.go.dev/github.com/dlclark/regexp2): API reference
- [Radarr Parser Source](https://github.com/Radarr/Radarr/tree/develop/src/NzbDrone.Core/Parser):
  Upstream regex patterns
- [Sonarr Parser Source](https://github.com/Sonarr/Sonarr/tree/develop/src/NzbDrone.Core/Parser):
  Upstream regex patterns
- [Go 1.22 Routing Enhancements](https://go.dev/blog/routing-enhancements): Method-based routing in
  stdlib

## Business Requirements

### User Stories

**Primary User: Praxrr Administrator**

- As an administrator, I want release titles to be parsed accurately so that custom format
  conditions evaluate correctly against source, resolution, modifier, language, release group, year,
  edition, and release type
- As an administrator, I want regex patterns from custom formats to be evaluated using a
  .NET-compatible regex engine so that pattern matches behave identically to how they would in
  Radarr/Sonarr
- As an administrator, I want the parser to start quickly and use minimal resources so it runs well
  on NAS devices and Raspberry Pis
- As an administrator, I want the parser to be distributed as a single binary without requiring a
  .NET runtime installation

**Secondary User: PCD Database Maintainer**

- As a PCD maintainer, I want to test custom format conditions against sample release titles to
  verify correctness before publishing
- As a PCD maintainer, I want regex101-imported patterns tested using the parser so I can verify
  .NET regex compatibility

### Business Rules

1. **Title parsing is type-dispatched**: Movie parsing uses `TitleParser`, series parsing uses
   `EpisodeParser`. Quality, language, and release group parsing are shared.
2. **Regex cascade -- first match wins**: All parsers try multiple regex patterns in order. The
   first successful match is used.
3. **Pattern matching uses IgnoreCase**: All `/match` endpoint patterns are evaluated
   case-insensitively with a 100ms timeout per pattern (ReDoS protection).
4. **Parser is optional**: The main application degrades gracefully when the parser is unavailable.
   Sync and core features do not depend on it.
5. **Version-keyed caching**: Parse results are cached in SQLite keyed by `title:type` +
   `parser_version`. Version changes invalidate cache.
6. **API contract must be preserved**: Any rewrite must expose identical HTTP endpoints with
   identical JSON request/response shapes -- zero changes to the TypeScript client.

### Edge Cases

| Scenario                                   | Expected Behavior                                               | Notes                                      |
| ------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------ |
| Reversed titles (e.g., `p027` or `p0801`)  | Detect and reverse before parsing                               | Both Title and Episode parsers handle this |
| Hashed releases (MD5-like hashes)          | Reject pre-parse                                                | Known spam patterns also rejected          |
| CJK bracket normalization                  | Convert full-width to ASCII brackets                            | For anime releases                         |
| Ambiguous air dates (month/day both <= 12) | Return null (ambiguous)                                         | Cannot determine MM-DD vs DD-MM            |
| German DL/ML tags                          | `DL` adds "Original" language; `ML` adds "Original" + "English" | Only when German is sole detected language |
| Inline modifier `(?-i:WEB)`                | Match "WEB" case-sensitively within case-insensitive context    | Critical for quality source detection      |
| Named backreference `\k<sep>`              | Match consistent date separators                                | Used in 2 episode daily patterns           |

### Success Criteria

- [ ] Produce identical parse output for any given release title (validated against .NET parser)
- [ ] Produce identical regex match results for `/match` and `/match/batch` endpoints
- [ ] Maintain the same API contract (endpoints, request/response JSON structure)
- [ ] Support the same environment variables and Docker deployment model
- [ ] Be spawnable as a standalone binary by existing `spawn.ts` (binary named `praxrr-parser`)
- [ ] Produce a significantly smaller Docker image (target: <15 MB vs current ~110 MB)
- [ ] Maintain or improve performance
- [ ] Zero changes required in the TypeScript client or calling code

## Technical Specifications

### Architecture Overview

```
Current Architecture (no change to interaction model):

                    Docker Compose / Standalone
                    +--------------------------+
                    |                          |
+----------+       |  +--------+  HTTP/JSON   |  +------------------+
|  Browser | <---> |  | praxrr | <----------> |  | praxrr-parser    |
+----------+       |  | (Deno) |  :5000       |  | (Go or TS)       |
                    |  +--------+              |  +------------------+
                    |    |  |                  |    |
                    |    |  +-- SQLite cache   |    +-- regex engine
                    |    +-- spawn.ts (auto)   |    +-- HTTP server
                    +--------------------------+
```

### Current Parser Architecture

The parser is a minimal ASP.NET Core 8 web application with **no external NuGet dependencies**. It
contains:

- **5 parsers**: QualityParser (~295 LOC), TitleParser (~423 LOC), EpisodeParser (~555 LOC),
  LanguageParser (~165 LOC), ReleaseGroupParser (~97 LOC)
- **96 regex patterns**: 78 require .NET-specific features (lookaheads, lookbehinds, backreferences,
  inline modifiers)
- **4 HTTP endpoints**: POST /parse, POST /match, POST /match/batch, GET /health
- **Custom logging**: Console (ANSI colored) + file (JSON NDJSON) with daily rotation

### Regex Pattern Inventory

| Category           | Total Patterns | Requires .NET Features | Standard Regex OK |
| ------------------ | -------------- | ---------------------- | ----------------- |
| ParserCommon       | 4              | 1                      | 3                 |
| TitleParser        | ~25            | ~18                    | ~7                |
| QualityParser      | 14             | 12                     | 2                 |
| LanguageParser     | 4              | 3                      | 1                 |
| EpisodeParser      | ~43            | ~40                    | ~3                |
| ReleaseGroupParser | 6              | 4                      | 2                 |
| Match endpoint     | dynamic        | all                    | 0                 |
| **Total**          | **~96**        | **~78**                | **~18**           |

**.NET-specific features in use:**

- Named capture groups `(?<name>...)`: 119 occurrences
- Negative lookaheads `(?!...)`: 53 occurrences
- Negative lookbehinds `(?<!...)`: 42 occurrences
- Positive lookaheads `(?=...)`: 7 occurrences
- Positive lookbehinds `(?<=...)`: 4 occurrences
- Named backreferences `\k<name>`: 2 occurrences
- Inline modifiers `(?-i:...)`: 1 occurrence
- `IgnorePatternWhitespace` mode: 3 patterns

### Data Models

#### ParseRequest / ParseResponse (API Contract)

**POST /parse Request:**

```json
{
  "title": "Movie.Name.2024.1080p.BluRay.x264-GROUP",
  "type": "movie"
}
```

**POST /parse Response (movie):**

```json
{
  "title": "Movie.Name.2024.1080p.BluRay.x264-GROUP",
  "type": "movie",
  "source": "Bluray",
  "resolution": 1080,
  "modifier": "None",
  "revision": { "version": 1, "real": 0, "isRepack": false },
  "languages": ["Unknown"],
  "releaseGroup": "GROUP",
  "movieTitles": ["Movie Name"],
  "year": 2024,
  "edition": null,
  "imdbId": null,
  "tmdbId": 0,
  "hardcodedSubs": null,
  "releaseHash": null,
  "episode": null
}
```

**POST /match Request/Response:**

```json
// Request
{ "text": "Some.Title.1080p", "patterns": ["1080p", "\\bRemux\\b"] }
// Response
{ "results": { "1080p": true, "\\bRemux\\b": false } }
```

**POST /match/batch Request/Response:**

```json
// Request
{ "texts": ["Title.One.1080p", "Title.Two.720p"], "patterns": ["1080p", "720p"] }
// Response
{ "results": { "Title.One.1080p": { "1080p": true, "720p": false }, "Title.Two.720p": { "1080p": false, "720p": true } } }
```

**GET /health Response:**

```json
{ "status": "healthy", "version": "0.1.0" }
```

#### Key Enums

| Enum              | Values                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| `QualitySource`   | Unknown, Cam, Telesync, Telecine, Workprint, DVD, TV, WebDL, WebRip, Bluray |
| `Resolution`      | 0, 360, 480, 540, 576, 720, 1080, 2160                                      |
| `QualityModifier` | None, Regional, Screener, RawHD, BRDisk, Remux                              |
| `Language`        | 58 values (Unknown through Original)                                        |
| `ReleaseType`     | Unknown, SingleEpisode, MultiEpisode, SeasonPack                            |

### System Integration

#### How Parser Is Called

| Call Site          | File                                                                                      | Purpose                                           |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Parse/Match client | `$arr/parser/client.ts`                                                                   | `ParserClient.parse()`, `match()`, `matchBatch()` |
| Health check       | `$arr/parser/client.ts`                                                                   | `isParserHealthy()` via `health()`                |
| CF testing page    | `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts` | Direct parse calls                                |
| Entity testing API | `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`                | Batch parse + pattern match                       |
| regex101 API       | `packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts`                             | Pattern matching                                  |
| CF evaluator       | `$pcd/entities/customFormats/evaluator.ts`                                                | Consumes ParseResult                              |
| Auto-spawn         | `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`                                | Standalone binary auto-spawn                      |

#### Configuration

| Variable      | Default     | Description             |
| ------------- | ----------- | ----------------------- |
| `PARSER_HOST` | `localhost` | Parser service hostname |
| `PARSER_PORT` | `5000`      | Parser service port     |

#### Docker Setup

- **Production**: `ghcr.io/yandy-r/praxrr-parser:v2` image, port 5000
- **Development**: Built from `Dockerfile.parser`, multi-stage .NET build
- **Health check**: `wget -qO- http://localhost:5000/health` every 30s
- **Compose dependency**: `depends_on: parser: condition: service_healthy`
- **Standalone**: `spawn.ts` auto-spawns parser binary on free port

#### Caching Layer

- **`parsed_release_cache`**: Keyed by `title:type` + `parser_version`, auto-invalidated on version
  change
- **`pattern_match_cache`**: Keyed by `title` + `patterns_hash` (SHA-256 of sorted patterns)

## UX Considerations

### Deployment Impact

| Metric                | .NET Parser (Current)      | Go Parser (Proposed) |
| --------------------- | -------------------------- | -------------------- |
| Docker image          | ~110 MB (aspnet-alpine)    | ~5-15 MB (scratch)   |
| Startup time          | ~60 ms                     | ~3 ms                |
| Idle memory           | ~30-50 MB                  | ~2-5 MB              |
| Working memory (load) | ~100-160 MB                | ~20-30 MB            |
| Binary size           | 50-150 MB (self-contained) | 5-15 MB (static)     |
| Build SDK             | .NET SDK ~700 MB           | Go SDK ~150 MB       |
| Build time (CI)       | ~30-60s                    | ~10-20s              |

### User Workflows

#### Primary Workflow: Custom Format Testing

1. **User opens CF testing page**: System checks `isParserHealthy()`
2. **Releases are batch-parsed**: `parseWithCacheBatch()` checks SQLite cache, misses call parser
3. **Patterns extracted and matched**: `matchPatternsBatch()` calls parser `/match/batch`
4. **Conditions evaluated**: Source, resolution, language, etc. compared against parsed values
5. **Results displayed**: Pass/fail per custom format per release title

#### Error Recovery Workflow

1. **Parser unavailable**: System shows "parser unavailable" state in UI
2. **User sees**: Degraded testing experience -- CF evaluation still works for non-regex conditions
3. **Recovery**: Restart parser container or standalone binary

### Performance UX

- **Loading States**: Parse results are cached in SQLite; second evaluation is near-instant
- **Optimistic Updates**: Not applicable (parser is read-only)
- **Error Feedback**: Invalid patterns return `false` (not HTTP errors), matching .NET behavior

### Self-Hosting Impact

The self-hosted media server community values small images, low memory, fast startup, and simple
configuration. A Go parser checks all four boxes. For bare-metal users (no Docker), a Go binary is a
single file download vs requiring .NET runtime installation.

## Recommendations

### Implementation Approach

Research identified two viable approaches with distinct trade-offs:

#### Option A: Go HTTP Microservice (Drop-in Replacement)

**Strategy**: Rewrite the parser as a standalone Go HTTP service with identical API endpoints using
`regexp2` for all regex operations. Ship as a single static binary.

**Pros:**

- Zero changes to TypeScript integration code, caching, Docker compose, or CI/CD structure
- `regexp2` is a direct .NET regex port -- all 96 patterns can be transferred with minimal
  modification
- Static binary: no runtime, no framework, 5-15 MB Docker images
- Cross-compilation is trivial (`GOOS=linux GOARCH=arm64 go build`)
- Proven approach -- regexp2 v1.11.5 has ~1.1k GitHub stars, MIT licensed

**Cons:**

- Still a separate process/container with HTTP round-trips
- Introduces Go as a third language in the stack
- `regexp2` is ~3x slower than Go stdlib `regexp` (acceptable for short strings)
- No constant-time regex guarantees (same as current .NET -- uses backtracking)

**Effort**: Medium-High (~2-3 weeks for core port + test infrastructure + pipeline changes)

#### Option B: TypeScript/Deno Port (Eliminate Microservice)

**Strategy**: Port parsing logic directly into TypeScript, eliminating the microservice entirely.

**Pros:**

- Eliminates microservice, HTTP overhead, Docker image, spawn.ts, health check polling
- Types already exist and are validated in `$arr/parser/types.ts`
- JS regex supports named groups, lookbehind, lookahead since ES2018+
- Evaluator already has JS regex fallback proving viability
- Single language codebase, simpler build pipeline
- Removes .NET SDK from CI entirely

**Cons:**

- JS regex lacks `(?-i:...)` inline modifier (1 pattern needs restructuring)
- JS regex lacks `IgnorePatternWhitespace` (3 patterns need whitespace stripping at port time)
- No built-in regex timeout for ReDoS protection (need wrapper or worker-based timeout)
- Risk of subtle behavioral differences for user-authored custom format patterns
- Users' CF patterns may rely on .NET-specific regex features

**Effort**: Medium (~1-2 weeks for core port + 1 week tests + 0.5 week pipeline cleanup)

### Recommended Strategy

**Start with Option A (Go HTTP Microservice)** for the following reasons:

1. **Regex parity is the #1 risk** -- `regexp2` provides near-perfect .NET compatibility including
   inline modifiers and `IgnorePatternWhitespace`. JS regex does not.
2. **User-authored patterns** in PCD custom formats are written/tested against .NET regex. The
   `/match` endpoint _must_ behave identically to Radarr/Sonarr's regex engine.
3. **Drop-in replacement** means zero risk to the TypeScript codebase during migration.
4. **Deployment improvements** are substantial (10x smaller images, 20x faster startup).
5. **Option B remains viable as a future optimization** -- once Go parser stabilizes, parsing logic
   could be ported to TS while keeping a Go regex shim for `/match`.

### Technology Decisions

| Decision            | Recommendation                   | Rationale                                                         |
| ------------------- | -------------------------------- | ----------------------------------------------------------------- |
| Regex library       | `regexp2` exclusively            | 78/96 patterns require it; `/match` endpoint requires .NET compat |
| HTTP framework      | `net/http` (stdlib, Go 1.22+)    | 4 endpoints, no middleware needed                                 |
| JSON                | `encoding/json` (stdlib)         | Payloads <1KB, not the bottleneck                                 |
| Batch concurrency   | Worker pool (`runtime.NumCPU()`) | Matches .NET `Parallel.ForEach` behavior                          |
| Repository location | `packages/praxrr-parser-go/`     | Same pattern as current `packages/praxrr-parser/`                 |
| Logging             | `log/slog` (stdlib, Go 1.21+)    | Minimal needs, built-in JSON + text output                        |
| ReDoS protection    | `regexp2.MatchTimeout` (100ms)   | Direct equivalent of .NET `TimeSpan.FromMilliseconds(100)`        |

### Quick Wins

- Docker image reduction: ~110 MB to ~10 MB (immediate user impact)
- Startup time: ~60 ms to ~3 ms (faster health checks, quicker container restarts)
- Build pipeline: Remove .NET SDK (~700 MB) from CI runners
- ARM64 Docker: Go cross-compilation makes re-enabling ARM64 trivial

### Future Enhancements

- **TypeScript parsing port**: Once Go parser is stable, port title/quality/language/episode parsing
  to TypeScript for in-process evaluation (keep Go regex shim for `/match`)
- **regexp2cg code generation**: 3-10x speedup for pre-compiled parser patterns
- **Go fuzz testing**: `go test -fuzz` to find edge cases in parser
- **WASM compilation**: Go compiles to WASM -- could enable client-side preview in browser
- **Benchmark suite**: Compare parse throughput Go vs .NET with same corpus

## Risk Assessment

### Technical Risks

| Risk                                       | Likelihood | Impact | Mitigation                                                              |
| ------------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------- |
| regexp2 behavioral divergence from .NET    | Low        | High   | Build golden fixture suite (200+ titles); run both parsers side-by-side |
| Backreference (`\k<sep>`) edge cases       | Low        | Medium | regexp2 supports natively; verify with targeted tests                   |
| Inline modifier `(?-i:WEB)` handling       | Low        | Medium | regexp2 supports natively; test thoroughly                              |
| regexp2 performance on complex patterns    | Medium     | Low    | Short input strings (~50-200 chars); sub-ms even at 3x slower           |
| No parser tests exist currently            | High       | High   | Must build test infrastructure before starting port                     |
| BRDISKRegex complexity (nested lookaheads) | Medium     | Medium | Exhaustive test cases for this specific pattern                         |

### Integration Challenges

- **Binary naming**: Go binary must be named `praxrr-parser` to work with existing `spawn.ts`
- **Health endpoint response**: Must match exact JSON structure
  (`{ "status": "healthy", "version": "..." }`)
- **Enum serialization**: Go response must use exact .NET `ToString()` output (e.g., `"Bluray"`, not
  `"bluray"`)
- **Null handling**: Use `*string` in Go for nullable fields to serialize as JSON `null`

### Security Considerations

- **ReDoS protection**: `regexp2.MatchTimeout` set to 100ms for user-supplied patterns (equivalent
  to current .NET behavior)
- **No authentication**: Parser is internal-only; no changes needed
- **Input validation**: Empty title returns 400; invalid type returns 400

## Task Breakdown Preview

### Phase 1: Test Infrastructure (Foundation)

**Focus**: Create comprehensive test suite before starting port **Tasks**:

- Create release title fixture file (200+ titles: movies, series, anime, daily shows, edge cases)
- Run current .NET parser against all fixtures, capture golden output as JSON snapshots
- Extract test cases from Radarr/Sonarr parser test suites
- Set up Go test harness with table-driven tests **Parallelization**: Fixture collection and test
  harness setup can happen concurrently

### Phase 2: Core Parsers

**Focus**: Port all 5 parsers from C# to Go **Dependencies**: Phase 1 fixtures must be ready
**Tasks**:

- Set up Go module with `regexp2` dependency at `packages/praxrr-parser-go/`
- Port `ParserCommon` (file extension removal, website cleaning)
- Port `QualityParser` (source, resolution, modifier, revision)
- Port `LanguageParser` (58 languages, German DL/ML special handling)
- Port `TitleParser` (10+ regex patterns, title extraction, edition/ID parsing)
- Port `EpisodeParser` (38 regex patterns, air dates, multi-episode, anime)
- Port `ReleaseGroupParser` (5 regex patterns, backreferences)
- Run all fixture tests, compare to golden output **Parallelization**: Each parser can be ported
  independently after `ParserCommon`

### Phase 3: HTTP Layer & Integration

**Focus**: Wire up HTTP endpoints and test end-to-end **Dependencies**: Phase 2 parsers passing all
tests **Tasks**:

- Implement HTTP server with 4 endpoints (net/http)
- Implement batch match with goroutine worker pool
- Add structured logging (slog)
- Add graceful shutdown (SIGTERM handling)
- Build Dockerfile (multi-stage, scratch base)
- Run both parsers side-by-side, compare outputs **Parallelization**: HTTP layer and Docker setup
  can happen concurrently

### Phase 4: Pipeline Migration

**Focus**: Switch build/CI/CD from .NET to Go **Dependencies**: Phase 3 end-to-end validation
complete **Tasks**:

- Update `Dockerfile.parser` for Go build
- Update `.github/workflows/release.yml` (replace dotnet with go)
- Update `.github/workflows/docker.yml` (if needed)
- Update `deno.json` tasks (`dev:parser`, `build:standalone`)
- Update `scripts/dev.ts` (Go toolchain detection)
- Remove .NET parser directory (after validation period) **Parallelization**: Pipeline file changes
  are independent

## Decisions Needed

Before proceeding to implementation planning, clarify:

1. **Go vs TypeScript Port**
   - Options: (A) Go HTTP microservice with regexp2, (B) TypeScript/Deno port eliminating
     microservice
   - Impact: Option A is lower risk (guaranteed .NET regex parity) but keeps microservice. Option B
     is simpler architecture but has regex compatibility risk for user-authored patterns.
   - Recommendation: Option A (Go) -- regex parity is the highest priority requirement

2. **.NET Regex Parity for User Patterns**
   - Options: (A) Must match .NET regex exactly, (B) JS regex is acceptable with known limitations
   - Impact: If (A), Go with regexp2 is required. If (B), TypeScript port becomes more viable.
   - Recommendation: Audit PCD database patterns first, but default to .NET parity

3. **Repository Structure**
   - Options: (A) `packages/praxrr-parser-go/` in monorepo, (B) Separate repository
   - Impact: Monorepo keeps CI/CD simple; separate repo adds versioning complexity
   - Recommendation: (A) monorepo subdirectory

4. **Migration Period**
   - Options: (A) Hard cutover, (B) Run both parsers side-by-side during validation
   - Impact: Side-by-side comparison catches subtle parity issues before users are affected
   - Recommendation: (B) side-by-side validation with output diffing

5. **Test Fixture Source**
   - Options: (A) Create from scratch, (B) Adapt from Radarr/Sonarr test suites, (C) Both
   - Impact: Radarr/Sonarr suites provide battle-tested fixtures; custom fixtures cover
     praxrr-specific scenarios
   - Recommendation: (C) Both for maximum coverage

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Go libraries, regexp2 analysis, HTTP frameworks,
  Docker patterns, performance benchmarks
- [research-business.md](./research-business.md): Current parser architecture, API contract, parsing
  rules, integration points
- [research-technical.md](./research-technical.md): Regex pattern inventory, Go struct definitions,
  build/CI changes, architecture options
- [research-ux.md](./research-ux.md): Deployment impact, Docker comparison, community analysis,
  TRaSH Guides compatibility
- [research-recommendations.md](./research-recommendations.md): Alternative approaches (Go vs
  TypeScript vs Hybrid), risk analysis, task breakdown
