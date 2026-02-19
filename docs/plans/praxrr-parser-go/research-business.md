# Business Logic Research: praxrr-parser-go

## Executive Summary

The praxrr-parser is a C#/.NET 8 microservice that parses media release titles (e.g., `Movie.Name.2024.1080p.BluRay.x264-GROUP`) to extract structured metadata -- quality source, resolution, modifier, revision, languages, release group, movie title, year, edition, episode information, and external IDs. It also provides a regex matching endpoint that uses the .NET regex engine to evaluate custom format patterns against release titles, ensuring behavioral parity with Radarr/Sonarr. A Go rewrite must replicate the exact parsing logic (approximately 60 compiled regex patterns with named groups), the three HTTP endpoints, and critically the .NET-compatible regex matching behavior that custom formats rely on.

## Current Parser Architecture

### What It Does

The parser service performs three core functions:

1. **Release Title Parsing** (`POST /parse`): Accepts a release title string and media type (`movie` or `series`), then runs it through four independent parsers (Quality, Language, ReleaseGroup, and either Title or Episode) to produce a structured result containing source, resolution, modifier, revision info, languages, release group, movie titles/year/edition/IDs, and episode details.

2. **Single Pattern Matching** (`POST /match`): Accepts a text string and an array of regex patterns, then tests each pattern against the text using the .NET regex engine with `IgnoreCase` and a 100ms timeout per pattern. Returns a map of pattern to boolean match result.

3. **Batch Pattern Matching** (`POST /match/batch`): Accepts multiple texts and patterns, pre-compiles patterns with `RegexOptions.Compiled`, and processes texts in parallel using `Parallel.ForEach`. Returns a nested map of text to pattern to boolean match result.

4. **Health Check** (`GET /health`): Returns service status and version string.

### Why .NET Was Chosen

The parser exists in .NET for one primary reason: **regex engine parity with Radarr/Sonarr**. The evidence:

1. **Regex patterns are ported directly from Radarr/Sonarr source code.** The `QualityParser.cs`, `TitleParser.cs`, `EpisodeParser.cs`, `LanguageParser.cs`, and `ReleaseGroupParser.cs` files contain regex patterns that match those found in the Radarr/Sonarr C# codebases. Comments like "Some german or french tracker formats (missing year, ...) - see ParserFixture for examples and tests" directly reference Sonarr test fixtures.

2. **The `/match` endpoint exists specifically for .NET regex compatibility.** Custom format conditions in Radarr/Sonarr use .NET-flavored regex. The evaluator (`evaluator.ts`) has a comment: "Fallback to JS regex (may not work for .NET-specific patterns)" -- indicating that JavaScript regex cannot fully replicate .NET regex behavior.

3. **No external NuGet packages are used.** The `Parser.csproj` has zero package references beyond the base `Microsoft.NET.Sdk.Web`. The entire implementation uses only the .NET standard library, specifically `System.Text.RegularExpressions`.

4. **.NET-specific regex features in use:**
   - `RegexOptions.IgnorePatternWhitespace` (the `x` flag) -- allows multiline regex with comments
   - `RegexOptions.Compiled` -- JIT-compiles regex for performance
   - Named capture groups (`(?<name>...)`) -- used extensively throughout all parsers
   - Backreferences (`\k<sep>`) -- used in episode air date parsing
   - Conditional/inline modifiers (`(?-i:WEB)`) -- case-sensitive inline toggle within case-insensitive regex
   - Negative lookbehind (`(?<!...)`) and negative lookahead (`(?!...)`) -- used heavily
   - Regex match timeout (`TimeSpan.FromMilliseconds(100)`) -- ReDoS protection

### API Contract

**Base URL**: `http://{PARSER_HOST}:{PARSER_PORT}` (default: `http://localhost:5000`)

#### POST /parse

Request:

```json
{
  "title": "Movie.Name.2024.1080p.BluRay.x264-GROUP",
  "type": "movie" // or "series"
}
```

Response (movie):

```json
{
  "title": "Movie.Name.2024.1080p.BluRay.x264-GROUP",
  "type": "movie",
  "source": "Bluray", // enum string: Unknown|Cam|Telesync|Telecine|Workprint|DVD|TV|WebDL|WebRip|Bluray
  "resolution": 1080, // int: 0|360|480|540|576|720|1080|2160
  "modifier": "None", // enum string: None|Regional|Screener|RawHD|BRDisk|Remux
  "revision": {
    "version": 1, // int: 1 = original, 2+ = proper/repack
    "real": 0, // int: count of REAL tags
    "isRepack": false // bool
  },
  "languages": ["Unknown"], // string[]: language names
  "releaseGroup": "GROUP", // string|null
  "movieTitles": ["Movie Name"], // string[]: primary + AKA titles
  "year": 2024, // int: 0 if not found
  "edition": null, // string|null: "Director's Cut", etc.
  "imdbId": null, // string|null: "tt1234567"
  "tmdbId": 0, // int: 0 if not found
  "hardcodedSubs": null, // string|null
  "releaseHash": null, // string|null: anime release hash
  "episode": null // EpisodeResponse|null (always null for movies)
}
```

Response (series -- episode field):

```json
{
  "episode": {
    "seriesTitle": "Series Name",
    "seasonNumber": 1,
    "episodeNumbers": [5],
    "absoluteEpisodeNumbers": [],
    "airDate": null, // "yyyy-MM-dd" or null
    "fullSeason": false,
    "isPartialSeason": false,
    "isMultiSeason": false,
    "isMiniSeries": false,
    "special": false,
    "releaseType": "SingleEpisode" // Unknown|SingleEpisode|MultiEpisode|SeasonPack
  }
}
```

#### POST /match

Request:

```json
{
  "text": "Some.Release.Title.2024.1080p",
  "patterns": ["1080p", "\\bRemux\\b"]
}
```

Response:

```json
{
  "results": {
    "1080p": true,
    "\\bRemux\\b": false
  }
}
```

#### POST /match/batch

Request:

```json
{
  "texts": ["Title.One.1080p", "Title.Two.720p"],
  "patterns": ["1080p", "720p"]
}
```

Response:

```json
{
  "results": {
    "Title.One.1080p": { "1080p": true, "720p": false },
    "Title.Two.720p": { "1080p": false, "720p": true }
  }
}
```

#### GET /health

Response:

```json
{
  "status": "healthy",
  "version": "1.0.0"
}
```

### Parsing Rules

#### Quality Parser (`QualityParser.cs`)

The quality parser extracts three components: source, resolution, and modifier.

**Source detection** (priority order -- first match wins):

- Bluray: `Blu-Ray`, `BD`, `UHDBDR`, `BDISO`, `BDMux`, `BR-DISK`, `HD-DVD`
- WebDL: `WEB-DL`, `AmazonHD`, `AmazonSD`, `iTunesHD`, `MaxdomeHD`, `NetflixHD/UHD`, `WebHD`, `HBOMaxHD`, `DisneyHD`, and contextual patterns like `AMZN.WEB.`, `NF.WEB.`
- WebRip: `WebRip`, `Web-Rip`, `WEBMux`
- TV (HDTV): `HDTV`
- BDRip/BRRip: `BDRip`, `BDLight`, `BRRip` -> resolves to Bluray source
- DVD: `DVD`, `DVDRip`, `xvidvd`, `DVD-R`, `DVD-5`, `DVD-9`
- Screener: `SCR`, `SCREENER`, `DVDSCR`
- Telesync: `TS`, `TELESYNCH`, `HDTS`, `PDVD`, `TSRip`
- Telecine: `TC`, `TELECINE`, `HDTC`
- Cam: `CAMRIP`, `CAM`, `HD-CAM`, `HQCAM`
- Workprint: `WORKPRINT`, `WP`
- PDTV/SDTV/DSR/TVRip -> TV source

**Resolution detection**: `360p`, `480p` (incl. `640x480`, `848x480`), `540p`, `576p`, `720p` (incl. `1280x720`, `960p`), `1080p` (incl. `1920x1080`, `1440p`, `FHD`, `1080i`, `4kto1080p`), `2160p` (incl. `3840x2160`, `4K`, `UHD`).

**Modifier detection**: Remux (`Remux`, `BD-Remux`, `UHD-Remux`), BRDisk (complex pattern for complete disc images), RawHD, Regional, Screener.

**Revision detection**: `PROPER` bumps version to 2, `REPACK`/`RERIP` sets version=2 and isRepack=true, explicit version tags (`v2`, `v3`), `REAL` tag counted.

**Special behaviors**:

- Anime patterns: `bd720`, `bd1080`, `[WEB]` detected separately
- Codec-based resolution override: xvid/divx + Bluray -> 480p
- Default resolution: Bluray defaults to 720p if no resolution found; WebDL/WebRip defaults to 480p

#### Title Parser (`TitleParser.cs`)

Parses movie titles using a cascade of 10+ regex patterns tried in order (first match wins):

1. Anime with subgroup and year
2. Anime without year (versioned, hash variants)
3. German/French tracker formats (missing year)
4. Special/Despecialized Edition movies
5. Normal movie format (title + year)
6. PassThePopcorn format
7. Bracket-year format
8. Last-resort with brackets in title

Additional extractions: edition (Director's Cut, Extended, IMAX, etc.), IMDB ID (`tt\d{7,8}`), TMDB ID (`tmdb-\d+` or `tmdbid-\d+`), hardcoded subs, release hash (anime `[\w{8}]`).

Title cleanup: reversed title detection, file extension removal, CJK bracket normalization, website prefix/suffix removal, torrent suffix cleanup, quality bracket cleanup, dot-to-space conversion with acronym preservation, AKA title splitting.

#### Episode Parser (`EpisodeParser.cs`)

Parses series episode information using 30+ regex patterns in cascade:

- Daily episode formats (air dates in multiple formats: YYYY-MM-DD, DD.MM.YYYY, YYYYMMDD, YYMMDD)
- Standard S01E05 format (single and multi-episode)
- XxYY format (1x05)
- Multi-season packs
- Partial season packs
- Season-only releases
- Mini-series (Part 1, Part One, XofY)
- Anime: `[SubGroup] Title - Episode` with absolute episode numbers
- Anime OVA/specials
- Split episodes (S01E05a, S01E05b)

#### Language Parser (`LanguageParser.cs`)

Two-phase detection:

1. Full word contains check (case-insensitive): "english", "spanish", "japanese", etc.
2. Regex matching: abbreviations (`eng`, `ita`, `ger`), country codes (`FR`, `EN`, `DE`, `CZ`), special patterns (`dublado`, `pt-BR`, Chinese characters)
3. Special German handling: `DL` tag -> German + Original; `ML` tag -> German + Original + English

Supports 58 languages. Case-sensitive regex for 2-letter codes to avoid false positives.

#### Release Group Parser (`ReleaseGroupParser.cs`)

Extraction order:

1. Anime `[SubGroup]` at start of title
2. Exception groups (known groups that don't follow standard patterns): `YIFY`, `YTS`, `D-Z0N3`, etc.
3. Standard `-GROUP` suffix pattern with extensive negative lookbehind to avoid false matches
4. Trailing `[GROUP]` format
5. Post-processing: filter out numeric-only groups, season/episode patterns, hex hashes

## User Stories

### Primary User: Praxrr Administrator

- As an administrator, I want release titles to be parsed accurately so that custom format conditions evaluate correctly against source, resolution, modifier, language, release group, year, edition, and release type.
- As an administrator, I want regex patterns from custom formats to be evaluated using the same regex engine as Radarr/Sonarr so that pattern matches behave identically to how they would in production.
- As an administrator, I want the parser to handle anime release formats correctly so that Sonarr-focused databases work properly.
- As an administrator, I want parsed results to be cached so that repeated evaluations are fast without re-parsing.

### Secondary User: PCD Database Maintainer

- As a PCD maintainer, I want to test custom format conditions against sample release titles to verify correctness before publishing.
- As a PCD maintainer, I want regex101-imported patterns to be tested using the parser service so I can verify .NET regex compatibility.

## Business Rules

### Core Rules

1. **Title parsing is type-dispatched**: Movie parsing uses `TitleParser.ParseMovieTitle()`, series parsing uses `EpisodeParser.ParseTitle()`. Quality, language, and release group parsing are shared.
2. **Regex cascade -- first match wins**: All parsers try multiple regex patterns in order. The first successful match is used, even if a later pattern might produce a "better" result.
3. **Pattern matching uses IgnoreCase**: All `/match` endpoint patterns are evaluated case-insensitively.
4. **ReDoS protection**: 100ms timeout per regex match operation.
5. **Parser is optional**: The main application degrades gracefully when the parser is unavailable. Testing features show "parser unavailable" state. Sync and core features do not depend on the parser.
6. **Version-keyed caching**: Parse results are cached in SQLite keyed by `title:type` + parser version. When the parser version changes, old cache entries are invalidated.
7. **Pattern match caching**: Pattern match results are cached keyed by title + SHA-256 hash of sorted patterns. This allows cache invalidation when patterns change.

### Edge Cases

1. **Reversed titles**: Both Title and Episode parsers detect reversed titles (e.g., containing `p027` or `p0801`) and reverse them before parsing.
2. **Hashed releases**: MD5-like hashes, short lowercase hashes, and known spam patterns (`123`, `abc`, `b00bs`) are rejected pre-parse.
3. **Password-protected usenet**: Titles containing both "password" and "yenc" are rejected.
4. **CJK bracket normalization**: Full-width brackets are converted to ASCII equivalents before parsing.
5. **Ambiguous air dates**: When both month and day values are 12 or less, the parser returns null (ambiguous date).
6. **Release hash collision**: If the captured hash is `1280x720`, it is discarded (known false positive from resolution regex).
7. **Decimal absolute episodes**: Episodes like `12.5` are marked as specials.
8. **German DL/ML tags**: `DL` tag adds "Original" language; `ML` tag adds both "Original" and "English" -- but only when German is the sole detected language.
9. **Website prefix stripping**: URLs like `[www.site.com]` or `www.site.com -` are removed from titles before parsing, but `Naruto-Kun.` is excluded from the TLD matching.

## Workflows

### Parse Request Flow

1. Client sends `POST /parse` with `{ title, type }`.
2. Endpoint validates: title must be non-empty, type must be `movie` or `series`.
3. `QualityParser.ParseQuality(title)` runs: normalizes underscores, parses revision/modifiers, parses resolution, checks source pattern cascade, handles special cases (anime, remux-only).
4. `LanguageParser.ParseLanguages(title)` runs: full-word contains check, case-sensitive regex, case-insensitive regex, German DL/ML special handling, deduplication.
5. `ReleaseGroupParser.ParseReleaseGroup(title)` runs: file extension removal, pre-substitution, website cleanup, anime subgroup check, exception groups, standard pattern, validation filters.
6. For movies: `TitleParser.ParseMovieTitle(title)` runs through title regex cascade, extracts edition/hash/IMDB/TMDB/hardcoded subs.
7. For series: `EpisodeParser.ParseTitle(title)` runs through episode regex cascade, extracts season/episode/air date/release type.
8. Response is assembled and returned as JSON.

### Custom Format Evaluation Flow

1. UI page loads, checks `isParserHealthy()`.
2. Releases are batch-parsed via `parseWithCacheBatch()` -- checks SQLite cache first, misses call parser service.
3. All unique regex patterns are extracted from custom format conditions via `extractAllPatterns()`.
4. Patterns are batch-matched against all release titles via `matchPatternsBatch()` -- checks SQLite cache (keyed by patterns hash), misses call parser `/match/batch` endpoint.
5. For each release x custom format, conditions are evaluated:
   - `release_title` conditions use pre-computed .NET regex matches
   - `edition` and `release_group` conditions use JS regex against the PARSED edition/group (not full title)
   - `source`, `resolution`, `quality_modifier`, `language`, `release_type`, `year` conditions compare parsed values
   - Conditions are grouped by type: between types = AND, within type = OR (unless `required` flag = AND)
6. Results are returned to the UI.

### regex101 Integration Flow

1. User imports a regex101 link on the custom format condition form.
2. Backend fetches regex101 API for pattern + unit tests.
3. Each unit test is evaluated by calling `POST /match` on the parser service with the regex pattern and test string.
4. Results are compared against expected criteria (DOES_MATCH / DOES_NOT_MATCH).
5. Pass/fail results are returned to the UI.

## Domain Model

### Key Entities

| Field                            | Type                    | Description                                                                               |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `source`                         | `QualitySource` enum    | Media source: Unknown, Cam, Telesync, Telecine, Workprint, DVD, TV, WebDL, WebRip, Bluray |
| `resolution`                     | `Resolution` enum (int) | Video resolution: 0, 360, 480, 540, 576, 720, 1080, 2160                                  |
| `modifier`                       | `QualityModifier` enum  | Quality modifier: None, Regional, Screener, RawHD, BRDisk, Remux                          |
| `revision.version`               | int                     | Release version (1 = original, 2+ = proper/repack)                                        |
| `revision.real`                  | int                     | Count of REAL tags in title                                                               |
| `revision.isRepack`              | bool                    | Whether title contains REPACK/RERIP                                                       |
| `languages`                      | `Language[]`            | Detected languages (58 possible values + Unknown + Original)                              |
| `releaseGroup`                   | string or null          | Extracted release group name                                                              |
| `movieTitles`                    | string[]                | Primary title + AKA alternative titles (movies only)                                      |
| `year`                           | int                     | Release year (0 if not found)                                                             |
| `edition`                        | string or null          | Edition info (Director's Cut, Extended, IMAX, etc.)                                       |
| `imdbId`                         | string or null          | IMDB ID (tt\d{7,8})                                                                       |
| `tmdbId`                         | int                     | TMDB ID (0 if not found)                                                                  |
| `hardcodedSubs`                  | string or null          | Hardcoded subtitle indicator                                                              |
| `releaseHash`                    | string or null          | Anime release hash                                                                        |
| `episode.seriesTitle`            | string or null          | Series title (series only)                                                                |
| `episode.seasonNumber`           | int                     | Season number                                                                             |
| `episode.episodeNumbers`         | int[]                   | Episode numbers (range-expanded)                                                          |
| `episode.absoluteEpisodeNumbers` | int[]                   | Anime absolute episode numbers                                                            |
| `episode.airDate`                | string or null          | Daily show air date (yyyy-MM-dd)                                                          |
| `episode.fullSeason`             | bool                    | Whether this is a full season pack                                                        |
| `episode.isPartialSeason`        | bool                    | Partial season (e.g., S01 Part 1)                                                         |
| `episode.isMultiSeason`          | bool                    | Multi-season pack                                                                         |
| `episode.isMiniSeries`           | bool                    | Mini-series without season number                                                         |
| `episode.special`                | bool                    | OVA/special episode                                                                       |
| `episode.releaseType`            | `ReleaseType` enum      | Unknown, SingleEpisode, MultiEpisode, SeasonPack                                          |

## Existing Codebase Integration

### How Parser Is Called

| Call Site              | File                                                                                          | Purpose                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Parse endpoint         | `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`                               | `ParserClient.parse()` -- all parse calls go through this client |
| Match endpoint         | `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`                               | `ParserClient.match()` and `matchBatch()`                        |
| Health check           | `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`                               | `ParserClient.health()` via `isParserHealthy()`                  |
| CF testing page        | `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts`     | Direct `parse()` call for each test case                         |
| QP entity testing page | `packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts` | `isParserHealthy()` check                                        |
| Entity testing API     | `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`                    | `parseWithCacheBatch()` + `matchPatternsBatch()`                 |
| regex101 API           | `packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts`                                 | Direct `fetch` to `config.parserUrl/match`                       |
| CF evaluator           | `packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`                  | Consumes `ParseResult` for condition evaluation                  |

### Configuration

| Variable          | Default                                                     | Description                                   |
| ----------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `PARSER_HOST`     | `localhost`                                                 | Parser service hostname                       |
| `PARSER_PORT`     | `5000`                                                      | Parser service port                           |
| Config resolution | `packages/praxrr-app/src/lib/server/utils/config/config.ts` | Constructs `parserUrl = http://{host}:{port}` |

### Docker Setup

- **Production**: `ghcr.io/yandy-r/praxrr-parser:v2` image, port 5000 exposed internally
- **Development**: Built from `Dockerfile.parser` (multi-stage: `dotnet/sdk:8.0-alpine` for build, `dotnet/aspnet:8.0-alpine` for runtime)
- **Health check**: `wget -qO- http://localhost:5000/health` every 30s
- **Compose dependency**: Main praxrr service uses `depends_on: parser: condition: service_healthy`
- **Standalone binary**: `spawn.ts` auto-spawns parser binary on free port if not in Docker and no PARSER_HOST set

### Caching Infrastructure

Two SQLite cache tables support the parser:

1. **`parsed_release_cache`**: Caches full parse results keyed by `title:type` + `parser_version`. Auto-invalidated on parser version change.
2. **`pattern_match_cache`**: Caches regex match results keyed by `title` + `patterns_hash` (SHA-256 of sorted patterns). Auto-invalidated when patterns change.

### Components to Migrate

The Go rewrite must implement:

1. **HTTP server** with 4 endpoints: `POST /parse`, `POST /match`, `POST /match/batch`, `GET /health`
2. **Quality parser** -- ~12 compiled regex patterns + cascading source/resolution/modifier logic
3. **Language parser** -- 2 regex patterns + 34 string contains checks + German DL/ML special logic
4. **Release group parser** -- 5 regex patterns + validation logic
5. **Title parser** (movies) -- 10 regex patterns + title cleanup pipeline + edition/ID/subs extraction
6. **Episode parser** (series) -- 30+ regex patterns + air date handling + episode range expansion
7. **Common utilities** -- file extension removal, website prefix/suffix removal, torrent suffix cleanup, `RegexReplace` helper
8. **Logging** -- structured logging with console and file output (can be simplified for Go)
9. **Docker image** -- multi-stage Dockerfile (Go compiles to single static binary, much simpler)
10. **Standalone binary spawn** -- the existing `spawn.ts` already handles any binary named `praxrr-parser`

## Relevant Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Program.cs`: Entry point, endpoint registration
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Parser.csproj`: Project file (net8.0, no external packages)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Endpoints/ParseEndpoints.cs`: Parse endpoint handler
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Endpoints/MatchEndpoints.cs`: Match + batch match handlers
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Endpoints/HealthEndpoints.cs`: Health check handler
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Parsers/QualityParser.cs`: Quality/source/resolution/modifier parsing
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Parsers/TitleParser.cs`: Movie title parsing (~420 lines)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Parsers/EpisodeParser.cs`: Series episode parsing (~550 lines)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Parsers/LanguageParser.cs`: Language detection
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Parsers/ReleaseGroupParser.cs`: Release group extraction
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Parsers/Common/ParserCommon.cs`: Shared utilities (website cleanup, file extension removal)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Parsers/Common/RegexReplace.cs`: Regex replace helper class
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Models/Types.cs`: Enums (QualitySource, Resolution, QualityModifier, Revision)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Models/Language.cs`: Language enum (58 values)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Models/Requests.cs`: Request DTOs
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-parser/Models/Responses.cs`: Response DTOs
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: TypeScript client for parser service
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts`: TypeScript mirror types (enums, interfaces)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts`: Parser module public exports
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`: Standalone binary auto-spawn logic
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/customFormats/evaluator.ts`: Custom format condition evaluator (consumes ParseResult)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`: Entity testing evaluation API
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/regex101/[id]/+server.ts`: regex101 integration (calls /match)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/+page.server.ts`: CF testing page server
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/+page.server.ts`: QP entity testing page server
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`: Parse result caching queries
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`: Pattern match caching queries
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Config with parserUrl construction
- `/home/yandy/Projects/github.com/yandy-r/praxrr/Dockerfile.parser`: Parser Docker image build
- `/home/yandy/Projects/github.com/yandy-r/praxrr/compose.yml`: Production compose with parser service
- `/home/yandy/Projects/github.com/yandy-r/praxrr/compose.dev.yml`: Development compose with parser build

## Success Criteria

A successful Go rewrite must:

1. **Produce identical parse output** for any given release title. This can be validated by running the same titles through both the .NET and Go parsers and diffing results.
2. **Produce identical regex match results** for the `/match` and `/match/batch` endpoints. This is the hardest requirement because .NET and Go regex engines differ.
3. **Maintain the same API contract** (endpoints, request/response JSON structure) so no changes are needed in the TypeScript client or any calling code.
4. **Support the same environment variables** and Docker deployment model.
5. **Be spawnable as a standalone binary** by the existing `spawn.ts` (binary named `praxrr-parser` in same directory as main executable).
6. **Produce a significantly smaller Docker image** (Go static binary vs .NET runtime).
7. **Maintain or improve performance** -- the current .NET service is already fast; Go should be comparable or faster.

## Open Questions

1. **Regex engine parity**: Go's `regexp` package uses RE2 syntax, which does NOT support lookahead, lookbehind, backreferences, or inline modifiers (`(?-i:...)`, `(?:...)`). The .NET regex engine supports all of these, and they are used extensively in the parser. Options:
   - **Use a PCRE2 binding** (e.g., `github.com/GRbit/go-pcre` or `github.com/dlclark/regexp2`). `regexp2` is a pure-Go implementation of .NET-compatible regex and is the most likely candidate.
   - **Rewrite regex patterns** to avoid .NET-specific features. This is error-prone and could introduce behavioral differences.
   - **Use both engines**: Go `regexp` for simple patterns, `regexp2` for patterns needing .NET features.

2. **`RegexOptions.IgnorePatternWhitespace`**: The `SourceRegex` in `QualityParser.cs` uses this flag to write the regex across multiple lines with whitespace. Go regex does not support this natively -- the whitespace must be stripped before compilation.

3. **Regex compilation/caching**: .NET `RegexOptions.Compiled` JIT-compiles regex. `regexp2` does not JIT but has its own optimization. Performance benchmarks should be run.

4. **Regex timeout**: .NET supports per-match timeout (`TimeSpan.FromMilliseconds(100)`). `regexp2` supports `MatchTimeout` but Go's standard `regexp` does not. The `/match` endpoint relies on this for ReDoS protection.

5. **Test coverage**: There are no dedicated parser unit tests in the repository. Validation should be done by creating a comprehensive test suite from known release title samples and comparing output against the .NET parser.

6. **Named group indexing**: The parsers make heavy use of `.Groups["name"].Success` and `.Groups["name"].Value`. `regexp2` supports named groups; Go standard `regexp` supports them too. Need to verify behavior parity for all patterns.

7. **Parallel batch processing**: The .NET `/match/batch` endpoint uses `Parallel.ForEach`. Go can achieve similar parallelism with goroutines and `sync.WaitGroup`, likely with better performance.

8. **Release cadence**: Should the Go parser version string track independently or mirror the praxrr version? Version changes invalidate the parse cache.
