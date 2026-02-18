# Technical Specifications: praxrr-parser-go

## Executive Summary

The praxrr parser is a .NET 8 HTTP microservice (~1,200 lines of C# across 23 files) that parses media release titles to extract quality, resolution, language, episode info, and release group metadata. This document specifies a drop-in Go rewrite that preserves HTTP API compatibility while drastically simplifying the build, distribution, and operational footprint. The primary technical risk is regex migration: the parser contains 60+ regex patterns, many using .NET-specific features (named groups, lookbehinds, inline modifiers) that require the `regexp2` library rather than Go's standard `regexp` package.

## Current Architecture Analysis

### .NET Parser Structure

The parser is a minimal ASP.NET Core 8 web application with no external NuGet dependencies beyond the framework SDK.

**Entry point and configuration:**

- `/src/services/parser/Program.cs` -- ASP.NET minimal API setup, endpoint registration, config loading
- `/src/services/parser/Parser.csproj` -- .NET 8.0 SDK Web project, no external packages
- `/src/services/parser/appsettings.json` -- Logging and version config
- `/src/services/parser/Directory.Build.props` -- Redirects build output to `dist/parser/`

**Endpoints (3 files):**

- `/src/services/parser/Endpoints/ParseEndpoints.cs` -- `POST /parse` handler; dispatches to all parsers, assembles `ParseResponse`
- `/src/services/parser/Endpoints/MatchEndpoints.cs` -- `POST /match` and `POST /match/batch` handlers; compiles user-supplied regex patterns, matches against text with 100ms ReDoS timeout
- `/src/services/parser/Endpoints/HealthEndpoints.cs` -- `GET /health` handler; returns `{ status, version }`

**Models (4 files):**

- `/src/services/parser/Models/Types.cs` -- Enums: `QualitySource`, `Resolution`, `QualityModifier`; class: `Revision`, `QualityResult`
- `/src/services/parser/Models/Requests.cs` -- `ParseRequest`, `MatchRequest`, `BatchMatchRequest`
- `/src/services/parser/Models/Responses.cs` -- `ParseResponse`, `RevisionResponse`, `EpisodeResponse`, `MatchResponse`, `BatchMatchResponse`
- `/src/services/parser/Models/Language.cs` -- `Language` enum (58 members)

**Parsers (6 files):**

- `/src/services/parser/Parsers/Common/ParserCommon.cs` -- Shared utilities: file extension removal, website prefix/postfix stripping, torrent suffix cleaning
- `/src/services/parser/Parsers/Common/RegexReplace.cs` -- Helper class wrapping `Regex` with replace/tryReplace semantics
- `/src/services/parser/Parsers/TitleParser.cs` -- Movie title extraction: 10 title regex patterns, edition, IMDB/TMDB ID, hardcoded subs, alternative titles (AKA), hashed release rejection, reversed title detection
- `/src/services/parser/Parsers/QualityParser.cs` -- Source/resolution/modifier/revision extraction: source regex (26 named groups), resolution regex, BRDISK detection, anime patterns, codec detection
- `/src/services/parser/Parsers/LanguageParser.cs` -- Language detection: string contains checks (34 languages) + 2 regex patterns (case-insensitive and case-sensitive) with 29 named groups each + German DL/ML special handling
- `/src/services/parser/Parsers/EpisodeParser.cs` -- Episode/season extraction: 38 regex patterns for episodes, daily shows, anime, season packs, mini-series; date validation, word-to-number conversion
- `/src/services/parser/Parsers/ReleaseGroupParser.cs` -- Release group extraction: main regex, anime regex, exception groups (exact + pattern), invalid group filtering, cleanup regex

**Logging (5 files):**

- `/src/services/parser/Logging/Logger.cs` -- Console (ANSI colored) + file (JSON NDJSON) logger with daily rotation
- `/src/services/parser/Logging/LogSettings.cs` -- Config loader from appsettings.json + env vars
- `/src/services/parser/Logging/Colors.cs` -- ANSI escape code constants
- `/src/services/parser/Logging/Types.cs` -- `LogLevel` enum, `LogOptions`, `LogEntry`, `LoggerConfig`
- `/src/services/parser/Logging/Startup.cs` -- Docker detection, server info logging

### TypeScript Integration Points

The SvelteKit app communicates with the parser via HTTP. Integration is centralized in `$arr/parser/`.

- `/src/lib/server/utils/arr/parser/client.ts` -- `ParserClient` extends `BaseHttpClient`; exports `parse()`, `parseQuality()`, `isParserHealthy()`, `getParserVersion()`, `parseWithCache()`, `parseWithCacheBatch()`, `matchPatterns()`, `matchPatternsBatch()`
- `/src/lib/server/utils/arr/parser/types.ts` -- TypeScript enums and interfaces mirroring C# models
- `/src/lib/server/utils/arr/parser/index.ts` -- Re-exports all client functions and types
- `/src/lib/server/utils/parser/spawn.ts` -- Auto-spawns parser binary for standalone builds; detects Docker vs bare-metal, finds binary next to executable, allocates free port, streams output, handles SIGINT/SIGTERM cleanup
- `/src/lib/server/utils/config/config.ts` -- Constructs `parserUrl` from `PARSER_HOST` and `PARSER_PORT` env vars (defaults: `localhost:5000`)

**Consumers of parser API:**

- `/src/hooks.server.ts` -- Imports `spawn.ts` as first action (auto-spawn before config loads)
- `/src/routes/api/v1/entity-testing/evaluate/+server.ts` -- Batch parse + pattern match for CF evaluation
- `/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts` -- CF test evaluation with parse + evaluate
- `/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts` -- Checks `isParserHealthy()` for UI status
- `/src/routes/api/regex101/[id]/+server.ts` -- Fetches regex101 data, runs patterns through parser `/match` endpoint
- `/src/lib/server/pcd/entities/customFormats/evaluator.ts` -- Evaluates CF conditions using `ParseResult` and pattern matches

### Docker and CI/CD

- `/Dockerfile.parser` -- Multi-stage: `dotnet/sdk:8.0-alpine` build, `dotnet/aspnet:8.0-alpine` runtime; non-root user; healthcheck via `wget`; exposes port 5000
- `/compose.dev.yml` -- Parser as dependency of praxrr with `service_healthy` condition; `PARSER_HOST=parser`, `PARSER_PORT=5000`
- `/compose.yml` -- Production compose; same pattern using `ghcr.io/yandy-r/praxrr-parser:v2`
- `/.github/workflows/docker.yml` -- Matrix build for both `praxrr` and `praxrr-parser` images; builds from respective Dockerfiles
- `/.github/workflows/release.yml` -- Cross-platform release: 5 targets (linux-x64, linux-arm64, macos-x64, macos-arm64, windows-x64); publishes .NET parser as self-contained single-file binary named `praxrr-parser`; requires `dotnet-version: 8.0.x`

### Build Tasks

- `deno task dev` -- Runs `dotnet watch run` for parser + Vite dev server concurrently (via `scripts/dev.ts`)
- `deno task dev:parser` -- Parser only: `dotnet watch run --urls http://localhost:5000`
- `deno task dev:server` -- Server only (no parser), expects parser on `localhost:5000`
- `deno task build:standalone` -- Builds Deno binary + .NET self-contained single-file parser; places `praxrr-parser` next to `praxrr` binary
- `deno task build:standalone:windows` -- Same for Windows; produces `praxrr-parser.exe`

### Caching Layer

- `/src/lib/server/db/queries/parsedReleaseCache.ts` -- SQLite cache for parse results, keyed by `title:type`, invalidated by `parser_version`
- `/src/lib/server/db/queries/patternMatchCache.ts` -- SQLite cache for pattern match results, keyed by `title` + `patterns_hash` (SHA-256 of sorted patterns)
- `/src/lib/server/db/migrations/021_create_parsed_release_cache.ts` -- Migration creating the cache table

---

## Regex Pattern Inventory

### Legend

- **Named groups** (`(?<name>...)`) -- Supported by `regexp2`, NOT by Go `regexp`
- **Lookbehind** (`(?<=...)`, `(?<!...)`) -- Supported by `regexp2`, NOT by Go `regexp`
- **Lookahead** (`(?=...)`, `(?!...)`) -- Supported by `regexp2`, NOT by Go `regexp`
- **Backreferences** (`\k<name>`) -- Supported by `regexp2`, NOT by Go `regexp`
- **Inline modifiers** (`(?-i:...)`, `(?i)`) -- Supported by `regexp2`, NOT by Go `regexp`
- **`x` mode** (`RegexOptions.IgnorePatternWhitespace`) -- Supported by `regexp2`, NOT by Go `regexp`

### ParserCommon.cs (4 patterns)

| #   | Name                      | .NET-Specific Features         | Go Library  |
| --- | ------------------------- | ------------------------------ | ----------- |
| 1   | `WebsitePrefixRegex`      | Lookbehind `(?<!Naruto-Kun\.)` | `regexp2`   |
| 2   | `WebsitePostfixRegex`     | None                           | `regexp` OK |
| 3   | `CleanTorrentSuffixRegex` | None                           | `regexp` OK |
| 4   | `FileExtensionRegex`      | None                           | `regexp` OK |

### TitleParser.cs (24 patterns)

| #   | Name                                     | .NET-Specific Features                                                                       | Go Library  |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------- | ----------- | -------------------- | --------- | --------- |
| 5   | `EditionRegex`                           | Named group `(?<edition>...)`, lookahead `(?=...)`                                           | `regexp2`   |
| 6   | `ReportEditionRegex`                     | Inherits from EditionRegex                                                                   | `regexp2`   |
| 7   | `HardcodedSubsRegex`                     | Named groups `(?<hcsub>...)`, `(?<hc>...)`, lookbehind `(?<!SOFT                             | MULTI       | HORRIBLE)`, `x` mode | `regexp2` |
| 8   | `ReportMovieTitleRegex[0]`               | Named groups: `subgroup`, `title`, `year`, `hash`; lookbehind `(?<![)\[!])`, lookahead `(?!p | i           | x                    | ...)`     | `regexp2` |
| 9   | `ReportMovieTitleRegex[1]`               | Named groups: `subgroup`, `title`, `hash`                                                    | `regexp2`   |
| 10  | `ReportMovieTitleRegex[2]`               | Named groups: `subgroup`, `title`, `hash`                                                    | `regexp2`   |
| 11  | `ReportMovieTitleRegex[3]`               | Named groups: `subgroup`, `title`, `hash`                                                    | `regexp2`   |
| 12  | `ReportMovieTitleRegex[4]`               | Named groups: `title`, `year`; lookbehind `(?<!...)`, embedded `EditionRegex`                | `regexp2`   |
| 13  | `ReportMovieTitleRegex[5]`               | Named groups: `title`, `year`, `edition`; lookbehind, embedded `EditionRegex`                | `regexp2`   |
| 14  | `ReportMovieTitleRegex[6]`               | Named groups: `title`, `year`; lookbehind `(?<![)\[!])`, lookahead `(?!p                     | i           | ...)`                | `regexp2` |
| 15  | `ReportMovieTitleRegex[7]`               | Named groups: `title`, `year`; lookbehind `(?<![()\[!])`                                     | `regexp2`   |
| 16  | `ReportMovieTitleRegex[8]`               | Named groups: `title`, `year`; lookbehind `(?<![)!])`                                        | `regexp2`   |
| 17  | `ReportMovieTitleRegex[9]`               | Named groups: `title`, `year`; lookbehind `(?<![)\[!])`                                      | `regexp2`   |
| 18  | `ReportMovieTitleFolderRegex[0]`         | Named groups: `title`, `year`; lookbehind `(?<![)!])`, lookahead `(?!...)`                   | `regexp2`   |
| 19  | `RejectHashedReleasesRegex` (8 patterns) | None                                                                                         | `regexp` OK |
| 20  | `ReversedTitleRegex`                     | None                                                                                         | `regexp` OK |
| 21  | `AlternativeTitleRegex`                  | None                                                                                         | `regexp` OK |
| 22  | `BracketedAlternativeTitleRegex`         | None                                                                                         | `regexp` OK |
| 23  | `NormalizeAlternativeTitleRegex`         | None                                                                                         | `regexp` OK |
| 24  | `ReportImdbId`                           | Named group `(?<imdbid>...)`                                                                 | `regexp2`   |
| 25  | `ReportTmdbId`                           | Named group `(?<tmdbid>...)`                                                                 | `regexp2`   |
| 26  | `SimpleTitleRegex`                       | Lookahead `(?![a-b0-9])`                                                                     | `regexp2`   |
| 27  | `SimpleReleaseTitleRegex`                | None                                                                                         | `regexp` OK |
| 28  | `CleanQualityBracketsRegex`              | None                                                                                         | `regexp` OK |
| 29  | `RequestInfoRegex`                       | None                                                                                         | `regexp` OK |

### QualityParser.cs (14 patterns)

| #   | Name                         | .NET-Specific Features                                                                                                                         | Go Library  |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 30  | `SourceRegex`                | Named groups (26 groups: `bluray`, `webdl`, `webrip`, etc.); lookahead `(?=...)`, lookbehind `(?<!...)`, inline modifier `(?-i:WEB)`, `x` mode | `regexp2`   |
| 31  | `ResolutionRegex`            | Named groups: `R360p` through `R2160p`; lookbehind `(?!...)`                                                                                   | `regexp2`   |
| 32  | `AlternativeResolutionRegex` | Named group `R2160p`                                                                                                                           | `regexp2`   |
| 33  | `RemuxRegex`                 | Named group `(?<remux>...)`                                                                                                                    | `regexp2`   |
| 34  | `ProperRegex`                | Named group `(?<proper>...)`                                                                                                                   | `regexp2`   |
| 35  | `RepackRegex`                | Named group `(?<repack>...)`                                                                                                                   | `regexp2`   |
| 36  | `VersionRegex`               | Named group `(?<version>...)`                                                                                                                  | `regexp2`   |
| 37  | `RealRegex`                  | Named group `(?<real>...)`                                                                                                                     | `regexp2`   |
| 38  | `RawHDRegex`                 | Named group `(?<rawhd>...)`                                                                                                                    | `regexp2`   |
| 39  | `BRDISKRegex`                | Lookahead `(?=...)`, lookbehind `(?!...)`, extremely complex multi-line pattern with nested lookaheads                                         | `regexp2`   |
| 40  | `CodecRegex`                 | Named groups: `x264`, `h264`, `xvidhd`, `xvid`, `divx`                                                                                         | `regexp2`   |
| 41  | `AnimeBlurayRegex`           | Lookbehind `(?<=[-_. (\[])`                                                                                                                    | `regexp2`   |
| 42  | `AnimeWebDlRegex`            | None                                                                                                                                           | `regexp` OK |
| 43  | `MPEG2Regex`                 | Named group `(?<mpeg2>...)`                                                                                                                    | `regexp2`   |

### LanguageParser.cs (4 patterns)

| #   | Name                         | .NET-Specific Features                                                                                                        | Go Library  |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 44  | `LanguageRegex`              | Named groups (29 language names), `x` mode                                                                                    | `regexp2`   |
| 45  | `CaseSensitiveLanguageRegex` | Named groups (8 language codes), lookbehind `(?<!SUB...)`, lookahead `(?!...SUB)`, inline modifier `(?i)` / `(?-i)`, `x` mode | `regexp2`   |
| 46  | `GermanDualLanguageRegex`    | Lookbehind `(?<!WEB[-_. ]?)`                                                                                                  | `regexp2`   |
| 47  | `GermanMultiLanguageRegex`   | None                                                                                                                          | `regexp` OK |

### EpisodeParser.cs (43 patterns)

| #     | Name                                     | .NET-Specific Features                                                                                                                                                                                                         | Go Library  |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 48-85 | `ReportTitleRegex` (38 patterns)         | Named groups (`title`, `season`, `episode`, `absoluteepisode`, `airyear`, `airmonth`, `airday`, `subgroup`, `hash`, `special`, `splitepisode`, `extras`, `seasonpart`, etc.); lookbehinds; lookaheads; backreference `\k<sep>` | `regexp2`   |
| 86    | `RejectHashedReleasesRegex` (9 patterns) | None (duplicated from TitleParser)                                                                                                                                                                                             | `regexp` OK |
| 87    | `ReversedTitleRegex`                     | None                                                                                                                                                                                                                           | `regexp` OK |
| 88    | `SimpleTitleRegex`                       | Lookbehind `(?<![a-f0-9])`, lookahead implied                                                                                                                                                                                  | `regexp2`   |
| 89    | `CleanQualityBracketsRegex`              | None                                                                                                                                                                                                                           | `regexp` OK |
| 90    | `SixDigitAirDateRegex`                   | Named groups: `airdate`, `airyear`, `airmonth`, `airday`; lookbehind `(?<=...)`, lookbehind `(?<!...)`                                                                                                                         | `regexp2`   |
| 91    | `RequestInfoRegex`                       | None                                                                                                                                                                                                                           | `regexp` OK |

### ReleaseGroupParser.cs (6 patterns)

| #   | Name                              | .NET-Specific Features                                                                                                           | Go Library  |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------- |
| 92  | `ReleaseGroupRegex`               | Named groups: `releasegroup`, `part2`, `tmdbid`, `imdbid`; lookahead `(?!...)`, lookbehind `(?<!...)`, backreference `\k<part2>` | `regexp2`   |
| 93  | `InvalidReleaseGroupRegex`        | None                                                                                                                             | `regexp` OK |
| 94  | `AnimeReleaseGroupRegex`          | Named group `(?<subgroup>...)`, lookbehind `(?!\s)`, lookbehind `(?<!\s)`                                                        | `regexp2`   |
| 95  | `ExceptionReleaseGroupRegexExact` | Named group `(?<releasegroup>...)`                                                                                               | `regexp2`   |
| 96  | `ExceptionReleaseGroupRegex`      | Named group `(?<releasegroup>...)`; lookbehind `(?<=[._ \[])`, lookahead `(?=\]                                                  | \))`        | `regexp2` |
| 97  | `CleanReleaseGroupRegex`          | None                                                                                                                             | `regexp` OK |

### Match Endpoints (dynamic patterns)

| #   | Name                                                  | .NET-Specific Features                                           | Go Library                                                                   |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 98  | User-supplied patterns at `/match` and `/match/batch` | Arbitrary .NET regex from Radarr/Sonarr custom format conditions | `regexp2` (mandatory -- these are .NET regex patterns authored by end users) |

### Migration Summary

| Category           | Total Patterns | Requires `regexp2` | Standard `regexp` OK |
| ------------------ | -------------- | ------------------ | -------------------- |
| ParserCommon       | 4              | 1                  | 3                    |
| TitleParser        | ~25            | ~18                | ~7                   |
| QualityParser      | 14             | 12                 | 2                    |
| LanguageParser     | 4              | 3                  | 1                    |
| EpisodeParser      | ~43            | ~40                | ~3                   |
| ReleaseGroupParser | 6              | 4                  | 2                    |
| Match endpoint     | dynamic        | all                | 0                    |
| **Total**          | **~96**        | **~78**            | **~18**              |

**Conclusion: Use `regexp2` for all patterns.** Mixing two regex engines adds complexity with no meaningful benefit. The `regexp2` library is a direct port of .NET's `System.Text.RegularExpressions` and supports all features used in this codebase: named groups, lookbehinds, lookaheads, backreferences, inline modifiers, and `x` mode. Using a single engine guarantees behavioral parity.

---

## Architecture Design

### Architecture Options

#### Option A: Go HTTP Microservice (drop-in replacement)

Rewrite the parser as a standalone Go HTTP service with identical API endpoints. Ship as a single static binary with zero dependencies.

**Pros:**

- Zero changes to TypeScript integration code (same HTTP API)
- Zero changes to caching layer
- Static binary: no .NET SDK, no runtime, no Alpine packages needed
- Cross-compilation is trivial: `GOOS=linux GOARCH=arm64 go build`
- Docker image shrinks from ~100MB (aspnet-alpine) to ~10MB (scratch/distroless)
- Startup time drops from ~500ms (.NET JIT) to ~5ms
- Memory drops from ~50MB (.NET runtime) to ~5MB

**Cons:**

- Still a separate process/container
- Still requires HTTP round-trips for parsing

#### Option B: Go compiled to shared library + Deno FFI

Compile Go to a C-shared library (`.so`/`.dll`/`.dylib`) and call it via Deno FFI.

**Pros:**

- Eliminates HTTP overhead entirely
- Single process, single container
- Lower latency per parse call (~microseconds vs ~milliseconds)

**Cons:**

- CGo required for shared library builds (`-buildmode=c-shared`), complicating cross-compilation
- Deno FFI is unstable and requires `--allow-ffi`
- Shared library ABI stability is fragile
- Memory management across FFI boundary is error-prone
- Debugging crashes across FFI is significantly harder
- Would require rewriting the entire TypeScript integration layer
- Go garbage collector + Deno GC in same process could conflict

#### Option C: Go WASM module

Compile Go to WebAssembly and run it within Deno.

**Pros:**

- Single process, single container
- Cross-platform by default

**Cons:**

- Go WASM support (`GOOS=js GOARCH=wasm`) targets browser environments, not Deno
- `regexp2` performance in WASM is unknown and likely significantly degraded
- WASM binary size for Go is large (~20MB+ with runtime)
- No goroutine support in WASM
- Would require a JS/WASM bridge layer
- Debugging is extremely difficult

### Recommended Architecture

**Option A: Go HTTP Microservice** is the clear winner.

**Rationale:**

1. **Risk minimization.** The current architecture works. A drop-in replacement means zero changes to the TypeScript codebase, caching, Docker compose, or CI/CD structure. The only things that change are the parser binary itself and its Dockerfile.
2. **Operational simplicity.** A static Go binary with zero dependencies is the simplest possible deployment unit. No runtime, no framework, no GC tuning.
3. **Build simplicity.** Go cross-compilation is a single command. No SDK installation required in CI runners (just the Go toolchain). The .NET SDK is 700MB+; the Go toolchain is ~150MB.
4. **Distribution.** The standalone binary distribution already ships `praxrr-parser` next to `praxrr`. Replacing a .NET binary with a Go binary is transparent to users.
5. **Future optionality.** Once the Go parser is stable, Option B (FFI) could be explored as a performance optimization. But the HTTP microservice architecture provides a clear contract for testing correctness first.

### Component Diagram

```
                    Docker Compose / Standalone
                    +--------------------------+
                    |                          |
+----------+       |  +--------+  HTTP/JSON   |  +------------------+
|  Browser | <---> |  | praxrr | <----------> |  | praxrr-parser-go |
+----------+       |  | (Deno) |  :5000       |  | (Go, static bin) |
                    |  +--------+              |  +------------------+
                    |    |  |                  |    |
                    |    |  +-- SQLite cache   |    +-- regexp2 engine
                    |    +-- spawn.ts (auto)   |    +-- net/http server
                    +--------------------------+
```

No changes to the component interaction model. The Go binary responds to the same HTTP endpoints on the same port.

---

## Data Models

### Go Struct Definitions

```go
package parser

// --- Enums ---

type QualitySource int
const (
    QualitySourceUnknown   QualitySource = 0
    QualitySourceCam       QualitySource = 1
    QualitySourceTelesync  QualitySource = 2
    QualitySourceTelecine  QualitySource = 3
    QualitySourceWorkprint QualitySource = 4
    QualitySourceDVD       QualitySource = 5
    QualitySourceTV        QualitySource = 6
    QualitySourceWebDL     QualitySource = 7
    QualitySourceWebRip    QualitySource = 8
    QualitySourceBluray    QualitySource = 9
)

type Resolution int
const (
    ResolutionUnknown Resolution = 0
    Resolution360p    Resolution = 360
    Resolution480p    Resolution = 480
    Resolution540p    Resolution = 540
    Resolution576p    Resolution = 576
    Resolution720p    Resolution = 720
    Resolution1080p   Resolution = 1080
    Resolution2160p   Resolution = 2160
)

type QualityModifier int
const (
    QualityModifierNone     QualityModifier = 0
    QualityModifierRegional QualityModifier = 1
    QualityModifierScreener QualityModifier = 2
    QualityModifierRawHD    QualityModifier = 3
    QualityModifierBRDisk   QualityModifier = 4
    QualityModifierRemux    QualityModifier = 5
)

type Language int
// 58 members, 0=Unknown through 58=Original (mirrors C# enum exactly)

type ReleaseType int
const (
    ReleaseTypeUnknown       ReleaseType = 0
    ReleaseTypeSingleEpisode ReleaseType = 1
    ReleaseTypeMultiEpisode  ReleaseType = 2
    ReleaseTypeSeasonPack    ReleaseType = 3
)

// --- Request types ---

type ParseRequest struct {
    Title string  `json:"title"`
    Type  *string `json:"type"`
}

type MatchRequest struct {
    Text     string   `json:"text"`
    Patterns []string `json:"patterns"`
}

type BatchMatchRequest struct {
    Texts    []string `json:"texts"`
    Patterns []string `json:"patterns"`
}

// --- Response types ---

type RevisionResponse struct {
    Version  int  `json:"version"`
    Real     int  `json:"real"`
    IsRepack bool `json:"isRepack"`
}

type EpisodeResponse struct {
    SeriesTitle            *string `json:"seriesTitle"`
    SeasonNumber           int     `json:"seasonNumber"`
    EpisodeNumbers         []int   `json:"episodeNumbers"`
    AbsoluteEpisodeNumbers []int   `json:"absoluteEpisodeNumbers"`
    AirDate                *string `json:"airDate"`
    FullSeason             bool    `json:"fullSeason"`
    IsPartialSeason        bool    `json:"isPartialSeason"`
    IsMultiSeason          bool    `json:"isMultiSeason"`
    IsMiniSeries           bool    `json:"isMiniSeries"`
    Special                bool    `json:"special"`
    ReleaseType            string  `json:"releaseType"`
}

type ParseResponse struct {
    Title         string           `json:"title"`
    Type          string           `json:"type"`
    Source        string           `json:"source"`
    Resolution    int              `json:"resolution"`
    Modifier      string           `json:"modifier"`
    Revision      RevisionResponse `json:"revision"`
    Languages     []string         `json:"languages"`
    ReleaseGroup  *string          `json:"releaseGroup"`
    MovieTitles   []string         `json:"movieTitles"`
    Year          int              `json:"year"`
    Edition       *string          `json:"edition"`
    ImdbId        *string          `json:"imdbId"`
    TmdbId        int              `json:"tmdbId"`
    HardcodedSubs *string          `json:"hardcodedSubs"`
    ReleaseHash   *string          `json:"releaseHash"`
    Episode       *EpisodeResponse `json:"episode"`
}

type MatchResponse struct {
    Results map[string]bool `json:"results"`
}

type BatchMatchResponse struct {
    Results map[string]map[string]bool `json:"results"`
}

type HealthResponse struct {
    Status  string `json:"status"`
    Version string `json:"version"`
}
```

**Key design decisions:**

- Use `*string` for nullable fields to preserve `null` in JSON output (matches .NET behavior where `string?` serializes as `null`)
- Use `[]int` for episode/absolute episode numbers (empty slice serializes as `[]`, matching .NET `List<int>`)
- Enum string serialization in responses must match .NET `ToString()` output exactly (e.g., `"Bluray"`, not `"bluray"`)

---

## API Design

### Endpoints

All endpoints are backward-compatible with the current .NET API.

#### `POST /parse`

**Request:**

```json
{
  "title": "Movie.Name.2024.1080p.BluRay.x264-GROUP",
  "type": "movie" // "movie" | "series"
}
```

**Response (200):**

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

**Validation:**

- 400 if `title` is empty/missing
- 400 if `type` is not `"movie"` or `"series"`

#### `POST /match`

**Request:**

```json
{
  "text": "Movie.Name.2024.DTS-HD",
  "patterns": ["DTS-?HD", "\\bATMOS\\b"]
}
```

**Response (200):**

```json
{
  "results": {
    "DTS-?HD": true,
    "\\bATMOS\\b": false
  }
}
```

**Behavior:**

- Each pattern is compiled with `IgnoreCase` flag
- 100ms timeout per pattern match (ReDoS protection)
- Invalid patterns return `false` (not errors)

#### `POST /match/batch`

**Request:**

```json
{
  "texts": ["Title.One.DTS", "Title.Two.ATMOS"],
  "patterns": ["DTS", "ATMOS"]
}
```

**Response (200):**

```json
{
  "results": {
    "Title.One.DTS": { "DTS": true, "ATMOS": false },
    "Title.Two.ATMOS": { "DTS": false, "ATMOS": true }
  }
}
```

**Behavior:**

- Patterns are pre-compiled once, then matched against all texts
- Process texts concurrently using goroutines
- Same timeout and error handling as `/match`

#### `GET /health`

**Response (200):**

```json
{
  "status": "healthy",
  "version": "2.0.0"
}
```

### Error Handling

- All errors return JSON: `{ "error": "message" }`
- 400 for validation errors (missing title, invalid type, empty patterns)
- 500 for internal errors (should be extremely rare)
- Pattern compilation failures and match timeouts are treated as `false` results, not HTTP errors (matches current .NET behavior)

---

## Regex Migration

### Strategy

Use `github.com/dlclark/regexp2` exclusively for all patterns. This library is a direct port of .NET's `System.Text.RegularExpressions` to Go and supports every feature used in the parser:

- Named capture groups (`(?<name>...)`)
- Lookbehind assertions (`(?<=...)`, `(?<!...)`)
- Lookahead assertions (`(?=...)`, `(?!...)`)
- Backreferences (`\k<name>`)
- Inline modifiers (`(?i)`, `(?-i:...)`)
- Free-spacing mode (`(?x)` / `IgnorePatternWhitespace`)

### Migration Risk Matrix

| Risk Level | Description                                 | Pattern Count | Notes                                                                                        |
| ---------- | ------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| **Low**    | Simple patterns, no .NET-specific features  | ~18           | Could use standard `regexp` but use `regexp2` for consistency                                |
| **Low**    | Named groups only, no lookarounds           | ~20           | Direct translation to `regexp2`                                                              |
| **Medium** | Lookbehinds + named groups                  | ~40           | `regexp2` handles these natively; test thoroughly                                            |
| **Medium** | Complex patterns (SourceRegex, BRDISKRegex) | ~5            | Long patterns with nested lookaheads/lookbehinds; need extensive test coverage               |
| **High**   | Backreferences (`\k<sep>`)                  | 2             | EpisodeParser daily episode patterns; `regexp2` supports these but behavior must be verified |
| **High**   | Inline modifiers (`(?-i:...)`)              | 1             | SourceRegex uses `(?-i:WEB)` to match `WEB` case-sensitively within case-insensitive pattern |
| **High**   | User-supplied patterns at `/match`          | dynamic       | Must handle arbitrary .NET regex; `regexp2` with timeout is the only viable approach         |

### Critical Patterns Requiring Extra Testing

1. **`BRDISKRegex`** (QualityParser.cs) -- The most complex pattern in the codebase. It is a single regex spanning ~5 lines with nested lookaheads, negative lookaheads, and alternation groups. Must have exhaustive test cases.

2. **`SourceRegex`** (QualityParser.cs) -- Uses `(?-i:WEB)` inline modifier to match `WEB` case-sensitively within an otherwise case-insensitive pattern. This is a subtle .NET feature that `regexp2` supports.

3. **`CaseSensitiveLanguageRegex`** (LanguageParser.cs) -- Uses `(?i)` and implicit case-sensitivity switching within the same pattern. Complex interaction between case-sensitive and case-insensitive regions.

4. **`ReleaseGroupRegex`** (ReleaseGroupParser.cs) -- Uses `\k<part2>` backreference. Must verify `regexp2` handles this correctly.

5. **Episode daily patterns** (EpisodeParser.cs, patterns 0-1) -- Use `\k<sep>` backreference to match consistent separators in date patterns (e.g., `2024-01-15` but not `2024-01_15`).

### `regexp2` Integration Pattern

```go
import "github.com/dlclark/regexp2"

// Compile once at package init, panic on invalid patterns (same as .NET Compiled flag)
var sourceRegex = regexp2.MustCompile(
    `\b(?:(?<bluray>M?Blu[-_. ]?Ray|...)...)\b`,
    regexp2.IgnoreCase,
)

// Match with timeout (for user-supplied patterns)
func matchWithTimeout(re *regexp2.Regexp, input string, timeout time.Duration) (bool, error) {
    re.MatchTimeout = timeout
    return re.MatchString(input)
}

// Get named group value
func getNamedGroup(m *regexp2.Match, name string) string {
    g := m.GroupByName(name)
    if g == nil || g.Length == 0 {
        return ""
    }
    return g.String()
}
```

---

## Build and Distribution

### Go Module Structure

```
praxrr-parser-go/
+-- go.mod                      # module github.com/yandy-r/praxrr-parser-go
+-- go.sum
+-- main.go                     # Entry point: config, server setup, routes
+-- server/
|   +-- server.go               # HTTP server, middleware, routing
|   +-- handlers.go             # parse, match, batch-match, health handlers
+-- parser/
|   +-- parser.go               # Orchestrator: dispatches to sub-parsers
|   +-- title.go                # Movie title parsing (TitleParser.cs)
|   +-- quality.go              # Quality/source/resolution parsing (QualityParser.cs)
|   +-- language.go             # Language detection (LanguageParser.cs)
|   +-- episode.go              # Episode/season parsing (EpisodeParser.cs)
|   +-- releasegroup.go         # Release group extraction (ReleaseGroupParser.cs)
|   +-- common.go               # Shared utilities (ParserCommon.cs)
|   +-- matcher.go              # Pattern matching with timeout (MatchEndpoints logic)
+-- models/
|   +-- types.go                # Enums and core types
|   +-- request.go              # Request DTOs
|   +-- response.go             # Response DTOs
+-- logging/
|   +-- logger.go               # Structured logger (console + file)
+-- Dockerfile                  # Multi-stage: build + scratch
+-- Makefile                    # Build targets
```

**Key design choices:**

- Separate `models/` package avoids circular imports
- `parser/` package is testable independently of HTTP layer
- `server/` package handles HTTP concerns only
- `logging/` is a thin wrapper (Go's `slog` or `log/slog` from stdlib would suffice)
- All regex patterns compiled at package `init()` time, fail-fast on startup
- The repo can live as a subdirectory within the praxrr monorepo at `src/services/parser-go/` or as a separate repository -- a decision for the project owner

### Cross-Compilation

Go cross-compilation requires no additional tooling:

```makefile
BINARY_NAME = praxrr-parser
VERSION = 2.0.0

build-linux-amd64:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -X main.version=$(VERSION)" -o dist/$(BINARY_NAME) .

build-linux-arm64:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w -X main.version=$(VERSION)" -o dist/$(BINARY_NAME) .

build-darwin-amd64:
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -X main.version=$(VERSION)" -o dist/$(BINARY_NAME) .

build-darwin-arm64:
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w -X main.version=$(VERSION)" -o dist/$(BINARY_NAME) .

build-windows-amd64:
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -X main.version=$(VERSION)" -o dist/$(BINARY_NAME).exe .
```

**Important:** `CGO_ENABLED=0` is required for static binaries. The `regexp2` library is pure Go, so no CGo is needed.

**Binary size estimate:** ~8-12MB stripped (vs ~70MB for .NET self-contained single-file).

### Docker Integration

**New `Dockerfile.parser` (replaces current):**

```dockerfile
# Build stage
FROM golang:1.23-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /praxrr-parser .

# Runtime stage
FROM scratch
COPY --from=builder /praxrr-parser /praxrr-parser
EXPOSE 5000
ENTRYPOINT ["/praxrr-parser"]
```

**Image size comparison:**

|               | .NET (current)                                        | Go (proposed)                 |
| ------------- | ----------------------------------------------------- | ----------------------------- |
| Build image   | `mcr.microsoft.com/dotnet/sdk:8.0-alpine` (~700MB)    | `golang:1.23-alpine` (~250MB) |
| Runtime image | `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` (~100MB) | `scratch` (~8MB total)        |
| CI build time | ~60s (restore + publish)                              | ~15s (download + build)       |

**Docker compose changes:** None. The container interface is identical (port 5000, healthcheck at `/health`).

### CI/CD Changes

#### `/.github/workflows/docker.yml`

No structural changes needed. The matrix entry for `praxrr-parser` continues to use `Dockerfile.parser`. The Dockerfile itself changes, but the workflow stays the same.

#### `/.github/workflows/release.yml`

Replace .NET build steps with Go build steps:

**Current:**

```yaml
- name: Setup .NET
  uses: actions/setup-dotnet@v4
  with:
    dotnet-version: '8.0.x'

- name: Build parser
  run: |
    rm -f src/services/parser/Directory.Build.props
    dotnet publish src/services/parser/Parser.csproj \
      -c Release -r ${{ matrix.dotnet_rid }} --self-contained \
      -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true \
      -o dist/parser-out
```

**Proposed:**

```yaml
- name: Setup Go
  uses: actions/setup-go@v5
  with:
    go-version: '1.23'

- name: Build parser
  run: |
    cd src/services/parser-go
    GOOS=${{ matrix.go_os }} GOARCH=${{ matrix.go_arch }} CGO_ENABLED=0 \
      go build -ldflags="-s -w -X main.version=${{ steps.version.outputs.value }}" \
      -o $GITHUB_WORKSPACE/dist/parser-out/praxrr-parser${{ matrix.binary_ext }} .
```

**Matrix changes:** Replace `dotnet_rid` column with `go_os` and `go_arch`:

| platform    | dotnet_rid (current) | go_os / go_arch (proposed) |
| ----------- | -------------------- | -------------------------- |
| linux-x64   | linux-x64            | linux / amd64              |
| linux-arm64 | linux-arm64          | linux / arm64              |
| macos-x64   | osx-x64              | darwin / amd64             |
| macos-arm64 | osx-arm64            | darwin / arm64             |
| windows-x64 | win-x64              | windows / amd64            |

#### `deno.json` tasks

- `dev:parser` changes from `cd src/services/parser && dotnet watch run --urls http://localhost:5000` to `cd src/services/parser-go && go run . --port 5000` (or use `air` for hot-reload)
- `build:standalone` and `build:standalone:windows` replace `dotnet publish` commands with `go build` commands
- All other tasks remain unchanged

---

## Codebase Changes

### Files to Create

| File                                            | Description                      |
| ----------------------------------------------- | -------------------------------- |
| `src/services/parser-go/go.mod`                 | Go module definition             |
| `src/services/parser-go/go.sum`                 | Go dependency checksums          |
| `src/services/parser-go/main.go`                | Entry point                      |
| `src/services/parser-go/server/server.go`       | HTTP server                      |
| `src/services/parser-go/server/handlers.go`     | Request handlers                 |
| `src/services/parser-go/parser/parser.go`       | Parse orchestrator               |
| `src/services/parser-go/parser/title.go`        | Title parser                     |
| `src/services/parser-go/parser/quality.go`      | Quality parser                   |
| `src/services/parser-go/parser/language.go`     | Language parser                  |
| `src/services/parser-go/parser/episode.go`      | Episode parser                   |
| `src/services/parser-go/parser/releasegroup.go` | Release group parser             |
| `src/services/parser-go/parser/common.go`       | Common utilities                 |
| `src/services/parser-go/parser/matcher.go`      | Pattern matcher                  |
| `src/services/parser-go/models/types.go`        | Enums and types                  |
| `src/services/parser-go/models/request.go`      | Request DTOs                     |
| `src/services/parser-go/models/response.go`     | Response DTOs                    |
| `src/services/parser-go/logging/logger.go`      | Logger                           |
| `src/services/parser-go/parser/*_test.go`       | Unit tests (one per parser file) |
| `src/services/parser-go/Dockerfile`             | New Go-based Dockerfile          |
| `src/services/parser-go/Makefile`               | Build targets                    |

### Files to Modify

| File                                    | Change                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/Dockerfile.parser`                    | Replace .NET build with Go build (or point to `src/services/parser-go/Dockerfile`)                      |
| `/.github/workflows/release.yml`        | Replace `setup-dotnet` with `setup-go`; replace `dotnet publish` with `go build`; update matrix columns |
| `/.github/workflows/docker.yml`         | Update `Dockerfile.parser` path if moved                                                                |
| `/deno.json`                            | Update `dev:parser`, `build:standalone`, `build:standalone:windows` tasks                               |
| `/scripts/dev.ts`                       | Change `isDotnetAvailable()` to check for Go toolchain; update `runParser()` to use `go run`            |
| `/src/lib/server/utils/parser/spawn.ts` | No changes needed (looks for `praxrr-parser` binary by name, which stays the same)                      |
| `/compose.dev.yml`                      | No changes needed (uses `Dockerfile.parser`)                                                            |
| `/compose.yml`                          | No changes needed (uses image from GHCR)                                                                |

### Files to Remove (after Go parser is validated)

| File                                        | Reason                                |
| ------------------------------------------- | ------------------------------------- |
| `src/services/parser/` (entire directory)   | Replaced by `src/services/parser-go/` |
| `src/services/parser/Directory.Build.props` | .NET-specific                         |
| `src/services/parser/Parser.csproj`         | .NET-specific                         |

**Note:** Keep the .NET parser directory during the transition period. Both parsers can coexist: the TypeScript client does not care which binary responds on port 5000.

---

## Technical Decisions

### Decision 1: Regex Library

**Options:**

- A) Go standard `regexp` (RE2-based) -- Missing named groups, lookbehinds, lookaheads, backreferences
- B) `github.com/dlclark/regexp2` -- Full .NET regex compatibility
- C) Mix: `regexp` for simple patterns, `regexp2` for complex ones

**Recommendation:** B -- `regexp2` exclusively.

**Rationale:** 78 of 96 patterns require `regexp2` features. Mixing engines adds complexity and the risk of subtle behavioral differences. More importantly, the `/match` endpoint accepts arbitrary .NET regex from Radarr/Sonarr users, which definitively requires `regexp2`.

### Decision 2: HTTP Framework

**Options:**

- A) Standard `net/http` from stdlib
- B) `chi` router (lightweight, stdlib-compatible)
- C) `gin` or `echo` (feature-rich frameworks)

**Recommendation:** A -- `net/http` with `http.ServeMux`.

**Rationale:** The parser has 4 endpoints. No middleware chain, no path parameters, no query parameters, no authentication. The standard library's `http.ServeMux` (improved in Go 1.22 with method routing) is sufficient. Adding a framework for 4 routes is unnecessary complexity.

### Decision 3: JSON Serialization

**Options:**

- A) Standard `encoding/json`
- B) `github.com/json-iterator/go` (faster)
- C) `github.com/goccy/go-json` (fastest)

**Recommendation:** A -- `encoding/json`.

**Rationale:** JSON payloads are small (< 1KB). Serialization is not the bottleneck; regex matching is. Standard library is sufficient and avoids a dependency.

### Decision 4: Concurrency for Batch Match

**Options:**

- A) Sequential iteration over texts
- B) `sync.WaitGroup` + goroutines
- C) Worker pool with bounded concurrency

**Recommendation:** C -- Worker pool with `runtime.NumCPU()` workers.

**Rationale:** The .NET implementation uses `Parallel.ForEach` which bounds concurrency to the number of CPU cores. A bounded worker pool in Go achieves the same behavior. Unbounded goroutines could cause contention on `regexp2`'s internal state (if any) or stack growth pressure.

### Decision 5: Repository Structure

**Options:**

- A) Subdirectory within praxrr monorepo: `src/services/parser-go/`
- B) Separate repository: `github.com/yandy-r/praxrr-parser-go`

**Recommendation:** A -- Subdirectory.

**Rationale:** The parser is tightly coupled to the praxrr release cycle, CI/CD, and Docker workflow. A separate repository would require cross-repo versioning, release coordination, and submodule or dependency management. The current .NET parser lives at `src/services/parser/` and the Go version can follow the same pattern.

### Decision 6: Logging

**Options:**

- A) Port the custom Logger from .NET (console ANSI + file JSON)
- B) Use Go's `log/slog` (structured logging, stdlib since 1.21)
- C) Use `zerolog` or `zap` (high-performance structured logging)

**Recommendation:** B -- `log/slog`.

**Rationale:** The parser's logging needs are minimal: startup info, per-request debug lines, and error reporting. `slog` supports JSON output (for file logging) and text output (for console) out of the box. No need for a third-party library or a custom implementation.

### Decision 7: ReDoS Protection

**Options:**

- A) Use `regexp2`'s built-in `MatchTimeout` property
- B) Use Go context with timeout wrapping regex execution
- C) No protection (trust input)

**Recommendation:** A -- `regexp2.MatchTimeout`.

**Rationale:** The `regexp2` library has a `MatchTimeout` property that works identically to .NET's `TimeSpan` parameter on `Regex` constructor. Set to 100ms for user-supplied patterns (matching current behavior). Internal parser patterns do not need timeouts since they are pre-compiled and tested.

---

## Open Questions

1. **Repository location.** Should the Go parser live at `src/services/parser-go/` within the monorepo or as a separate Go module? (Recommendation: monorepo subdirectory, but confirm with project owner.)

2. **Test corpus.** The .NET parser has no unit test files in the repository. Should the Go rewrite include a test corpus derived from known release title formats? This is strongly recommended to validate behavioral parity. Radarr/Sonarr source code has extensive parser tests that could be adapted.

3. **Migration timeline.** Should both parsers coexist during a transition period? The TypeScript client is parser-agnostic (it only cares about the HTTP contract), so a gradual rollout is possible -- run both, compare outputs, switch when confident.

4. **Version bump.** The parser version string is used for cache invalidation. Changing from .NET to Go should bump the version (e.g., `1.0.0` to `2.0.0`) to force cache invalidation.

5. **Hot-reload in development.** The .NET parser uses `dotnet watch run` for development hot-reload. Go's closest equivalent is [air](https://github.com/air-verse/air) or `go run .` on save. Decide whether to add `air` as a dev dependency or use a simpler approach.

6. **ARM64 Docker.** The current Docker workflow has ARM64 disabled ("FOR NOW: ARM disabled for faster debugging"). Go cross-compilation to ARM64 is trivial and might be a good time to re-enable it.

---

## References

- [regexp2 library (Go port of .NET regex engine)](https://github.com/dlclark/regexp2)
- [regexp2 Go package documentation](https://pkg.go.dev/github.com/dlclark/regexp2)
- [Radarr parser source (upstream)](https://github.com/Radarr/Radarr/tree/develop/src/NzbDrone.Core/Parser)
- [Sonarr parser source (upstream)](https://github.com/Sonarr/Sonarr/tree/develop/src/NzbDrone.Core/Parser)
