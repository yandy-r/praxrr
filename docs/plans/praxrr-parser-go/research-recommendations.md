# Recommendations: praxrr-parser-go

## Executive Summary

The current C#/.NET parser is a well-structured ~1,600 LOC microservice (~8,000 lines including logging/infrastructure) that handles three concerns: release title parsing, quality/language extraction, and .NET-compatible regex matching for custom format evaluation. **The recommended approach is Option B: Port to TypeScript/Deno**, which eliminates the microservice entirely, removes the .NET dependency from the build pipeline, and simplifies deployment -- with a targeted use of `dlclark/regexp2` (via a thin Go CLI or WASM) only for the `/match` endpoint's .NET regex compatibility requirement. If .NET regex compatibility is not a hard requirement (i.e., user-authored patterns can tolerate JS regex semantics), then a pure TypeScript port with zero external dependencies is the cleanest path.

## Implementation Recommendations

### Recommended Approach

**Port parsing logic to TypeScript/Deno (Option B), with a Go regexp2 shim only if .NET regex parity is proven necessary.**

Evidence supporting this recommendation:

1. **The parsing logic is pure string/regex manipulation** -- no .NET framework dependencies, no database access, no file I/O, no async operations. Every parser file (`QualityParser.cs`, `TitleParser.cs`, `EpisodeParser.cs`, `LanguageParser.cs`, `ReleaseGroupParser.cs`) is a static class with static methods operating purely on string inputs. This is trivially portable to TypeScript.

2. **The microservice is optional today** -- `dev.ts` already gracefully skips the parser when `dotnet` is not installed. The `spawn.ts` auto-spawn logic includes a comment: "the app degrades gracefully without the parser." The `Dockerfile` for the main app does NOT include the parser -- it is a separate `Dockerfile.parser` and a separate Docker image.

3. **The HTTP overhead is unnecessary** -- the main app makes HTTP calls to `localhost:5000` for what are pure, stateless functions. Batch parsing in `client.ts` parallelizes individual HTTP calls via `Promise.all`, which is far less efficient than in-process function calls. The caching layer (`parsed_release_cache`, `pattern_match_cache`) exists partly to amortize this HTTP overhead.

4. **The build pipeline is significantly complicated by .NET** -- `release.yml` requires `.NET 8.0.x` SDK setup, `dotnet publish` with per-platform RID targeting across 5 platforms (linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64), self-contained publish flags, and binary staging. Docker workflow builds a separate `praxrr-parser` image. The standalone build task in `deno.json` has a complex sequence including `rm -f Directory.Build.props` followed by `git checkout` to reset it.

5. **TypeScript types already mirror the C# models exactly** -- `packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts` (154 lines) contains identical enums and interfaces for `QualitySource`, `Resolution`, `QualityModifier`, `Language`, `ReleaseType`, `ParseResult`, etc.

6. **.NET regex features used are limited and identifiable** -- the codebase uses `IgnoreCase`, `Compiled`, `IgnorePatternWhitespace`, named groups (`(?<name>...)`), lookbehind (`(?<!...)`), lookahead (`(?!...)`), inline modifiers (`(?-i:WEB)`, `(?i)`), and named backreferences (`\k<sep>`). JavaScript regex supports lookbehind/lookahead and named groups. The inline modifiers and `IgnorePatternWhitespace` would need minor regex string transformations during porting.

### Technology Choices

| Component                               | Recommendation                       | Rationale                                                                                     |
| --------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Title/Quality/Episode/Language Parsing  | TypeScript (in-process)              | Pure string logic, zero framework deps, types already exist                                   |
| `/match` endpoint (user regex patterns) | JS regex with fallback consideration | Most user patterns are JS-compatible; only need .NET compat if Sonarr/Radarr patterns diverge |
| `/match/batch` endpoint                 | TypeScript (in-process)              | Eliminates HTTP overhead; use `Promise.all` or Web Workers for parallelism                    |
| Regex compatibility shim (if needed)    | Go CLI via `dlclark/regexp2` or WASM | Only for .NET-specific regex features that JS cannot handle                                   |
| Caching layer                           | Simplify or remove                   | In-process calls are fast enough; cache may become unnecessary                                |

### Phasing Strategy

1. **Phase 1 - Parse Port (MVP)**: Port `QualityParser`, `LanguageParser`, `TitleParser`, `EpisodeParser`, `ReleaseGroupParser`, and `ParserCommon` to TypeScript. Build a comprehensive test harness using known release title fixtures. Validate parity against the C# service running side-by-side.

2. **Phase 2 - Match Port**: Port the `/match` and `/match/batch` endpoints to TypeScript using JavaScript `RegExp`. Audit all user-facing regex patterns stored in PCD custom formats to confirm JS regex compatibility. If any patterns use .NET-only features, build a compatibility layer.

3. **Phase 3 - Pipeline Cleanup**: Remove `Dockerfile.parser`, the `parser` service from `compose.dev.yml`, the `.NET` setup from `release.yml` and `docker.yml`, the `spawn.ts` auto-spawn logic, and the `dev:parser` task. Simplify the standalone build. Optionally remove or simplify the HTTP caching layer.

### Quick Wins

- **Eliminate parser health check polling**: Currently `getParserVersion()` is called to gate cache operations; with in-process parsing, this becomes a no-op constant.
- **Remove Docker dependency**: The `compose.dev.yml` `depends_on: parser: condition: service_healthy` block and separate parser container go away entirely.
- **Simplify standalone distribution**: No more `praxrr-parser` / `praxrr-parser.exe` companion binary.
- **Remove spawn.ts complexity**: 157 lines of auto-spawn, port detection, health polling, and signal handling are eliminated.

## Improvement Ideas

### Eliminate Microservice?

**Yes, strongly recommended.** The parser performs zero operations that require a separate process. Every function in the C# service is a pure, stateless transformation:

- `QualityParser.ParseQuality(string name)` -> `QualityResult`
- `LanguageParser.ParseLanguages(string title)` -> `List<Language>`
- `TitleParser.ParseMovieTitle(string title)` -> `ParsedMovieInfo?`
- `EpisodeParser.ParseTitle(string title)` -> `ParsedEpisodeInfo?`
- `ReleaseGroupParser.ParseReleaseGroup(string title)` -> `string?`
- `MatchEndpoints.HandleMatch(MatchRequest)` -> `MatchResponse`

There is no shared state, no database, no persistent connections -- only regex matching against input strings. The HTTP transport adds latency (~1-5ms per call), serialization overhead, and operational complexity (health checks, retries, connection pooling) for zero benefit.

The evaluator in `packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts` already falls back to JS regex when the parser is unavailable (lines 248-255), proving the path is viable:

```typescript
// Fallback to JS regex (may not work for .NET-specific patterns)
try {
  const regex = new RegExp(pattern.pattern, 'i');
  if (regex.test(title)) { ... }
} catch { /* Invalid JS regex - skip this pattern */ }
```

### Batch Parsing

With in-process parsing, "batch" becomes trivially fast. The current `parseWithCacheBatch` in `client.ts` fires N parallel HTTP requests. In-process, you would just loop synchronously -- regex operations on short strings are sub-millisecond. The SQLite cache (`parsed_release_cache`) may become unnecessary for parsed results, though the `pattern_match_cache` could still be useful if pattern matching is expensive.

If batch regex matching against many patterns is a bottleneck, consider:

- Pre-compiling regex patterns once at PCD cache compile time (analogous to .NET's `RegexOptions.Compiled`)
- Using Web Workers for CPU-intensive batches

### Testing Infrastructure

This is the **most critical enabler** for any migration approach. The current codebase has **zero parser-specific tests** -- the test files found under `packages/praxrr-app/src/tests/` are all for other subsystems (lidarr operations, e2e specs, logger cleanup). Before porting, you must:

1. Create a fixture file of release titles with expected parse results (JSON format)
2. Run the current C# parser against all fixtures to establish the "golden" output
3. Port the fixtures as test cases for the TypeScript implementation
4. Use snapshot testing to catch any regressions

Sonarr and Radarr both have extensive parser test suites in their repositories that can serve as a reference for fixture data.

### Pluggable Parser Backend

Not recommended at this stage. A pluggable architecture adds abstraction overhead for a problem that has one correct implementation (match Radarr/Sonarr parsing behavior). However, the TypeScript port naturally enables future flexibility:

- The `parse()` function signature becomes a simple importable function rather than an HTTP client
- Swapping implementations (if ever needed) becomes a module import change, not a service URL change

## Risk Assessment

### Technical Risks

| Risk                                                  | Likelihood | Impact | Mitigation                                                                |
| ----------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------- |
| Regex behavior divergence (JS vs .NET)                | Medium     | High   | Build golden fixture suite; test every regex pattern individually         |
| Named backreference incompatibility                   | Low        | Medium | JS supports `\k<name>` since ES2018; verify in Deno                       |
| Inline modifier `(?-i:WEB)` incompatibility           | High       | Medium | Transform patterns during port: extract to separate regex or restructure  |
| `IgnorePatternWhitespace` incompatibility             | High       | Low    | Strip whitespace/comments from patterns at port time (one-time transform) |
| User-authored CF patterns using .NET-only regex       | Medium     | High   | Audit PCD databases for pattern syntax; provide compatibility warnings    |
| Performance regression from JS regex vs .NET compiled | Low        | Low    | Release title strings are short; regex is sub-ms either way               |
| Build pipeline breakage during transition             | Low        | Medium | Keep .NET path functional until TypeScript port passes all fixtures       |

### Regex Compatibility Detailed Analysis

The C# parser uses these .NET-specific regex features that need careful handling:

**1. `IgnorePatternWhitespace` (3 patterns)**
Used in `QualityParser.SourceRegex`, `LanguageParser.LanguageRegex`, and `LanguageParser.CaseSensitiveLanguageRegex`. These multiline patterns use whitespace for readability. **Mitigation**: Strip whitespace and comments at port time. This is a one-time source code transformation, not a runtime concern.

**2. Inline case-sensitivity modifier `(?-i:WEB)`** (1 pattern in `QualityParser.SourceRegex`)
Switches to case-sensitive matching for the literal "WEB" within an otherwise case-insensitive pattern. **Mitigation**: JavaScript does not support `(?-i:...)`. Restructure the pattern to use a separate case-sensitive check or use a two-pass approach. Alternatively, the pattern `[. ](?-i:WEB)$` can be rewritten as a separate regex: `/[. ]WEB$/` (no `i` flag).

**3. Inline `(?i)` modifier** (2 patterns in `LanguageParser.CaseSensitiveLanguageRegex`)
The `CaseSensitiveLanguageRegex` uses `(?i)` within a case-sensitive context for the lookbehind/lookahead portions. **Mitigation**: Restructure into separate regex operations or use the overall `i` flag with explicit case-sensitive sub-patterns restructured.

**4. Named backreferences `\k<sep>`, `\k<part2>`** (3 patterns)
Used in `EpisodeParser` daily episode patterns and `ReleaseGroupParser`. **Mitigation**: JavaScript supports `\k<name>` with named capture groups (ES2018+, fully supported in Deno). **No action needed.**

**5. Named capture groups `(?<name>...)`** (extensive use)
Used throughout all parsers. **Mitigation**: JavaScript supports this natively (ES2018+). **No action needed.**

**6. Lookbehind `(?<!...)` and `(?<=...)`** (extensive use)
Used throughout all parsers. **Mitigation**: JavaScript supports both positive and negative lookbehind (ES2018+). **No action needed.**

**7. `/match` endpoint: user-provided patterns**
The `/match` and `/match/batch` endpoints execute arbitrary regex patterns from PCD custom format conditions against release titles. These patterns are authored by users and stored in the PCD database. The endpoint currently uses `RegexOptions.IgnoreCase` and a 100ms timeout. **Risk**: Users may have authored patterns relying on .NET-specific syntax. **Mitigation**: Audit the default Praxrr-DB patterns; provide a migration/validation tool that flags patterns using `.NET`-only features.

### Regex Timeout (ReDoS Protection)

The .NET `/match` endpoint uses `TimeSpan.FromMilliseconds(100)` as a regex timeout. JavaScript `RegExp` does not have built-in timeout support. **Mitigation**: For user-provided patterns, wrap regex execution in a timeout using `AbortSignal.timeout()` with a worker, or validate patterns against a complexity heuristic before execution.

## Alternative Approaches

### Option A: Full Go Rewrite

- **Pros**: Go compiles to a single static binary (no runtime dependency), excellent cross-compilation, goroutines for batch parallelism, `dlclark/regexp2` provides near-perfect .NET regex compatibility including inline modifiers and `IgnorePatternWhitespace`.
- **Cons**: Still a separate microservice (or requires CGo/FFI integration with Deno which is fragile), introduces a third language to the stack (Deno/TypeScript + Go + historically C#), team must maintain Go code, Go stdlib `regexp` does NOT support backtracking (no lookbehind/backreferences) so you MUST use `regexp2` for all patterns, HTTP overhead remains unless eliminated via FFI.
- **Effort**: Medium-High. ~2-3 weeks for core port, plus test infrastructure, plus pipeline changes.

### Option B: TypeScript/Deno Port (Recommended)

- **Pros**: Eliminates microservice entirely, zero new dependencies, no build pipeline changes for parser (removes .NET entirely), types already exist and are validated, in-process calls eliminate HTTP overhead/caching complexity, single language codebase, evaluator already has JS regex fallback proving viability.
- **Cons**: JS regex lacks `(?-i:...)` inline modifier and `IgnorePatternWhitespace` (requires pattern transformation at port time), no built-in regex timeout (ReDoS risk for user patterns), may need a compatibility shim for .NET-only user patterns.
- **Effort**: Medium. ~1-2 weeks for core port, ~1 week for test infrastructure, ~0.5 week for pipeline cleanup.

### Option C: Optimize .NET (Keep Current)

- **Pros**: Zero migration risk, proven parsing accuracy, .NET 8 already has good performance, could use NativeAOT for smaller binaries.
- **Cons**: Keeps .NET SDK in build pipeline (5-platform matrix), keeps Docker complexity (separate parser image), keeps HTTP overhead, keeps spawn.ts complexity, .NET 8 goes out of support November 2026.
- **Effort**: Low. ~1 week to optimize (NativeAOT, trimmed publish). Does not address fundamental architectural issues.

### Option D: Go Parser Libraries as Foundation

- **Pros**: Could leverage `anitogo` for anime parsing, Go ecosystem has some parsing primitives.
- **Cons**: No existing Go library matches Radarr/Sonarr parsing behavior (which the C# parser is based on), would still need custom implementation for quality/language/episode/movie parsing, still requires microservice architecture unless using FFI.
- **Effort**: High. Existing libraries cover only anime titles, not the full Radarr/Sonarr parsing surface.

### Option E: Hybrid (Go for core, .NET for edge cases)

- **Pros**: Gradual migration, can keep .NET for .NET-only regex patterns.
- **Cons**: Worst of all worlds -- three languages, two microservices, doubled build complexity. Does not simplify anything.
- **Effort**: Very High. Not recommended.

### Recommendation

**Option B (TypeScript/Deno Port)** is the clear winner. The parsing logic is pure string manipulation that ports directly to TypeScript. The types already exist. The evaluator already proves JS regex viability as a fallback. The build pipeline simplification alone justifies the effort. The only risk area (inline regex modifiers in 3 patterns) requires targeted pattern rewrites, not architectural changes.

If .NET regex compatibility for user-authored custom format patterns becomes a hard requirement after auditing the PCD database, add a thin Go CLI using `dlclark/regexp2` as a subprocess for the `/match` endpoint only -- not a full microservice, just a stdin/stdout pattern matcher.

## Task Breakdown Preview

### Phase 1: Foundation (Test Infrastructure)

**Estimated: 3-5 days. No dependencies. Can start immediately.**

- [ ] Create `packages/praxrr-app/src/tests/parser/` test directory
- [ ] Build release title fixture file with 200+ titles covering movies, series, anime, daily shows, edge cases
- [ ] Run current C# parser against all fixtures, capture golden output as JSON snapshots
- [ ] Extract Radarr/Sonarr parser test cases from their open-source repos as additional fixtures
- [ ] Set up snapshot testing framework for parser output comparison
- [ ] **Parallelizable**: Fixture collection and test harness setup can happen concurrently

### Phase 2: Core Port (Parsing Logic)

**Estimated: 5-8 days. Depends on Phase 1 fixtures being ready.**

- [ ] Port `ParserCommon` (file extension removal, website prefix/suffix cleaning)
- [ ] Port `RegexReplace` utility class
- [ ] Port `QualityParser` (transform `IgnorePatternWhitespace` and `(?-i:WEB)` patterns)
- [ ] Port `LanguageParser` (transform `(?i)` inline modifiers)
- [ ] Port `EpisodeParser` (largest file, ~555 LOC, 35+ regex patterns)
- [ ] Port `TitleParser` (10+ regex patterns, complex title extraction logic)
- [ ] Port `ReleaseGroupParser` (5 regex patterns, backreference `\k<part2>`)
- [ ] Run all fixture tests against TypeScript implementation, compare to golden output
- [ ] Fix any divergences until 100% parity achieved
- [ ] **Parallelizable**: Each parser file can be ported independently after `ParserCommon`

### Phase 3: Integration

**Estimated: 3-5 days. Depends on Phase 2 passing all tests.**

- [ ] Create in-process parser module at `$lib/server/utils/arr/parser/engine.ts`
- [ ] Update `client.ts` to call in-process functions instead of HTTP
- [ ] Audit PCD database custom format patterns for .NET-only regex features
- [ ] Implement ReDoS protection for user-provided patterns (timeout or complexity limit)
- [ ] Update evaluator to use in-process parsing directly (remove HTTP fallback comments)
- [ ] Simplify or remove `parsed_release_cache` (in-process parsing may be fast enough)
- [ ] Keep `pattern_match_cache` if pattern evaluation is expensive

### Phase 4: Pipeline Cleanup

**Estimated: 2-3 days. Depends on Phase 3 being stable.**

- [ ] Remove `packages/praxrr-parser/` directory
- [ ] Remove `Dockerfile.parser`
- [ ] Remove `parser` service from `compose.dev.yml`
- [ ] Remove `.NET` setup from `.github/workflows/release.yml`
- [ ] Remove `praxrr-parser` image from `.github/workflows/docker.yml`
- [ ] Remove `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`
- [ ] Remove `dev:parser` task from `deno.json`
- [ ] Update `build:standalone` and `build:standalone:windows` tasks (remove dotnet publish steps)
- [ ] Update `scripts/dev.ts` (remove dotnet detection and parser process spawning)
- [ ] Update `CLAUDE.md` and documentation to remove parser references
- [ ] **Parallelizable**: Pipeline file changes are independent of each other

## Relevant Files

### Parser Service (to be ported/removed)

- `/packages/praxrr-parser/Program.cs`: Entry point, ASP.NET minimal API setup
- `/packages/praxrr-parser/Endpoints/ParseEndpoints.cs`: `/parse` endpoint - main parsing orchestration
- `/packages/praxrr-parser/Endpoints/MatchEndpoints.cs`: `/match` and `/match/batch` - regex matching with ReDoS protection
- `/packages/praxrr-parser/Endpoints/HealthEndpoints.cs`: `/health` endpoint
- `/packages/praxrr-parser/Parsers/QualityParser.cs`: Source, resolution, modifier, revision extraction (~295 LOC)
- `/packages/praxrr-parser/Parsers/TitleParser.cs`: Movie title parsing with 10+ regex patterns (~423 LOC)
- `/packages/praxrr-parser/Parsers/EpisodeParser.cs`: Series/episode parsing with 35+ regex patterns (~555 LOC)
- `/packages/praxrr-parser/Parsers/LanguageParser.cs`: Language detection from release titles (~165 LOC)
- `/packages/praxrr-parser/Parsers/ReleaseGroupParser.cs`: Release group extraction (~97 LOC)
- `/packages/praxrr-parser/Parsers/Common/ParserCommon.cs`: Shared utilities (file extension removal, website cleaning)
- `/packages/praxrr-parser/Parsers/Common/RegexReplace.cs`: Regex replace utility class
- `/packages/praxrr-parser/Models/Types.cs`: Enums for QualitySource, Resolution, QualityModifier, Revision
- `/packages/praxrr-parser/Models/Language.cs`: Language enum (58 values)
- `/packages/praxrr-parser/Models/Requests.cs`: Request DTOs
- `/packages/praxrr-parser/Models/Responses.cs`: Response DTOs

### TypeScript Integration (to be updated)

- `/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: HTTP client for parser service (505 LOC) - will become in-process calls
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`: TypeScript types mirroring C# models (154 LOC) - keep as-is
- `/packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts`: Module exports (18 LOC)
- `/packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`: Auto-spawn logic for standalone builds (157 LOC) - remove entirely
- `/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`: CF evaluator with JS regex fallback (536 LOC)
- `/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: API endpoint using parser (123 LOC)
- `/packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`: Parse result cache (82 LOC) - may simplify
- `/packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`: Pattern match cache (113 LOC) - may keep

### Build/Deploy (to be simplified)

- `/Dockerfile.parser`: Parser Docker image (61 LOC) - remove entirely
- `/Dockerfile`: Main app Docker image - no parser references (already clean)
- `/compose.dev.yml`: Dev compose with parser service dependency - remove parser service
- `/deno.json`: Task definitions including `dev:parser`, `build:standalone` - simplify
- `/scripts/dev.ts`: Dev script running parser + server concurrently (133 LOC) - simplify
- `/.github/workflows/release.yml`: Release workflow with .NET build matrix - remove .NET
- `/.github/workflows/docker.yml`: Docker workflow building parser image - remove parser matrix entry
- `/packages/praxrr-app/src/hooks.server.ts`: Startup sequence importing spawn.ts - remove spawn import

## Key Decisions Needed

1. **Is .NET regex parity a hard requirement for user-authored custom format patterns?** If the Praxrr-DB (default database) patterns all work with JS regex, the answer is likely "no." An audit of the PCD database patterns should be done first.

2. **Should the `parsed_release_cache` be kept?** In-process parsing is fast (sub-ms), so caching may add complexity without meaningful benefit. However, the `pattern_match_cache` may still be valuable if pattern evaluation involves many patterns.

3. **What is the minimum test fixture count that provides confidence?** The C# parser has zero tests currently. A fixture suite of 200+ titles covering all source types, resolutions, languages, anime formats, daily shows, and edge cases is recommended before starting the port.

4. **Should this be done on the `dev` branch or a dedicated feature branch?** Given the scope (touching build pipeline, removing infrastructure), a dedicated branch with incremental PRs is recommended.

## Open Questions

1. **What patterns exist in the default Praxrr-DB?** An audit of custom format condition patterns would determine if any use .NET-only regex features, which would affect whether a Go regexp2 shim is needed.

2. **Are there known parsing edge cases where the C# parser produces incorrect results?** If so, the port is an opportunity to fix them rather than replicate bugs.

3. **What is the actual usage frequency of the `/match` vs `/parse` endpoints?** If `/match` is rarely used, it could be deprioritized or kept as a separate concern.

4. **Is there interest in publishing the parser as a standalone npm/jsr package?** A TypeScript parser could be reusable by other projects in the Arr ecosystem.

5. **What is the target timeline?** If this needs to ship before .NET 8 EOL (November 2026), starting Phase 1 (test infrastructure) soon is important to avoid time pressure on the port itself.
