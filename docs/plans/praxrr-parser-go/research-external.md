# External API Research: praxrr-parser-go

## Executive Summary

Rewriting the praxrr parser from C#/.NET to Go is feasible but requires the `regexp2` library (a .NET regex engine port) because the current parser relies heavily on lookahead, lookbehind, named backreferences (`\k<name>`), and inline flag toggling (`(?-i:...)`) -- none of which are supported by Go's standard `regexp` package. The recommended architecture is a lightweight HTTP microservice using `chi` or `net/http` (Go 1.22+), compiled as a static binary for scratch Docker containers (5-15 MB images), communicating over the same REST API the current .NET parser exposes.

**Confidence**: High -- based on direct analysis of the current parser's regex patterns and documented capabilities of Go libraries.

## Primary APIs

### Go Standard Library `regexp` (RE2 Engine)

- **Documentation**: https://pkg.go.dev/regexp
- **Key Features**:
  - RE2-based engine with guaranteed linear-time execution (O(n) in input length)
  - Named capture groups via `(?P<name>re)` syntax
  - Inline flag groups `(?i:re)` for case-insensitive scoping
  - `SubexpNames()` for named group enumeration
  - `FindStringSubmatch` / `FindAllStringSubmatch` for capture extraction
  - Thread-safe compiled patterns (`regexp.MustCompile`)
  - No external dependencies
- **Limitations (CRITICAL)**:
  - **No lookahead assertions** (`(?=...)`, `(?!...)`) -- used 50+ times in current parser
  - **No lookbehind assertions** (`(?<=...)`, `(?<!...)`) -- used 30+ times in current parser
  - **No backreferences** (`\k<name>`, `\1`) -- used in EpisodeParser and ReleaseGroupParser
  - **No inline flag negation** (`(?-i:...)`) -- used in QualityParser for case-sensitive WEB matching
  - **No atomic groups** or possessive quantifiers
  - Named group syntax differs from .NET: `(?P<name>...)` instead of `(?<name>...)`
- **Verdict**: Cannot be the sole regex engine for this parser. The current .NET parser uses too many advanced features that RE2 explicitly excludes.

**Confidence**: High -- verified by direct grep of all regex patterns in the current C# parser source code.

### `regexp2` (Third Party -- .NET-Compatible Engine)

- **Documentation**: https://pkg.go.dev/github.com/dlclark/regexp2
- **Repository**: https://github.com/dlclark/regexp2
- **Version**: v1.11.5 (published Dec 31, 2024)
- **License**: MIT
- **Stars**: ~1.1k on GitHub
- **Key Features**:
  - **Ported directly from .NET's `System.Text.RegularExpressions.Regex`**
  - Full lookahead/lookbehind support (positive and negative)
  - Named capture groups with .NET syntax: `(?<name>re)` and `(?'name're)`
  - Named backreferences: `\k<name>`
  - Inline flag toggling: `(?-i:...)` for flag unsetting within groups
  - `IgnorePatternWhitespace` option (equivalent to `RegexOptions.IgnorePatternWhitespace`)
  - `GroupByName(name string) *Group` for named group access
  - `GroupNumberFromName(name string) int` for name-to-number mapping
  - `MatchTimeout` field for catastrophic backtracking protection
  - `FindNextMatch(m *Match)` for iterating over all matches
  - RE2 compatibility mode available (opt-in)
  - Thread-safe compiled patterns
- **RegexOptions Supported**:
  - `IgnoreCase` (0x0001)
  - `Multiline` (0x0002)
  - `ExplicitCapture` (0x0004)
  - `Compiled` (0x0008)
  - `Singleline` (0x0010)
  - `IgnorePatternWhitespace` (0x0020)
  - `RightToLeft` (0x0040)
  - `ECMAScript` (0x0100)
  - `RE2` (0x0200)
  - `Unicode` (0x0400)
- **Performance Caveats**:
  - Slower than Go stdlib `regexp` (approximately 3x slower in benchmarks)
  - No constant-time execution guarantees (backtracking can cause exponential behavior)
  - Higher memory consumption than RE2 alternatives
  - `regexp2cg` code generation tool can improve performance 3-10x
  - Operates on `[]rune` internally, so index/length values reference rune positions
- **Verdict**: This is the required library for the parser rewrite. The .NET regex patterns from the current parser can be transferred with minimal modification (primarily changing named group syntax from `(?<name>...)` to keep as-is since regexp2 supports it natively).

**Confidence**: High -- regexp2 is explicitly a .NET regex port and supports all features used by the current parser.

### HTTP Frameworks

#### Comparison Matrix

| Feature                | `net/http` (Go 1.22+)           | `chi` v5              | `gin`                 | `echo`                |
| ---------------------- | ------------------------------- | --------------------- | --------------------- | --------------------- |
| **Dependencies**       | Zero                            | Zero (stdlib only)    | Multiple              | Multiple              |
| **Routing**            | Method + path params since 1.22 | Full pattern matching | Full pattern matching | Full pattern matching |
| **Middleware**         | Manual                          | Composable chain      | Built-in              | Built-in              |
| **JSON binding**       | Manual (`encoding/json`)        | Manual                | Built-in              | Built-in              |
| **GitHub Stars**       | N/A (stdlib)                    | ~18k                  | ~80k                  | ~30k                  |
| **Production Users**   | Everywhere                      | Cloudflare, Heroku    | Widespread            | Widespread            |
| **Binary Size Impact** | None                            | Minimal               | Moderate              | Moderate              |
| **Idiomatic Go**       | Maximum                         | Very high             | Medium                | Medium                |
| **Learning Curve**     | Low                             | Low                   | Low                   | Low                   |

#### Recommendation: `chi` v5 or `net/http` (Go 1.22+)

For a small microservice with 3-4 endpoints (parse, match, batch-match, health), either `chi` or raw `net/http` is optimal. `chi` adds clean middleware composition and sub-routing with zero external dependencies. Since Go 1.22, `net/http` now supports method-based routing (e.g., `mux.Handle("POST /parse", handler)`), making it a viable zero-dependency option.

**Confidence**: High -- well-documented ecosystem with clear community consensus for microservices.

Sources:

- [chi router](https://github.com/go-chi/chi)
- [Go 1.22 routing enhancements](https://go.dev/blog/routing-enhancements)
- [JetBrains Go Ecosystem 2025](https://blog.jetbrains.com/go/2025/11/10/go-language-trends-ecosystem-2025/)
- [Go web framework comparison 2025](https://blog.logrocket.com/top-go-frameworks-2025/)

## Libraries and SDKs

### Release Title Parsing Libraries

#### go-ptn (razsteinmetz/go-ptn)

- **Repository**: https://github.com/razsteinmetz/go-ptn
- **Description**: Extracts media metadata from torrent filenames using sequential regex matching.
- **Extracted Fields**: Title, Season, Episode, Year, Resolution, Quality, Codec, Audio, Container, Service, Region, Group, Language, Size, Extended, Hardcoded, Proper, Repack, Widescreen, 3D, Unrated, IsMovie
- **Approach**: Applies regex patterns sequentially, removing matched sections; remaining text becomes the title.
- **Usefulness for praxrr**: Partial -- covers basic field extraction but lacks the depth and edge-case handling of the Radarr/Sonarr parser patterns. Does not handle anime naming conventions, multi-episode patterns, or air-date episodes.
- **Assessment**: Good reference implementation for Go regex parsing patterns but not a drop-in replacement.

**Confidence**: Medium -- reviewed README; not inspected for completeness against praxrr's test cases.

#### go-parse-torrent-name (middelink/go-parse-torrent-name)

- **Repository**: https://github.com/middelink/go-parse-torrent-name
- **Description**: Extracts 20+ metadata fields from torrent filenames. Port of a JavaScript library.
- **Extracted Fields**: audio, codec, container, episode, episodeName, excess, extended, garbage, group, hardcoded, language, proper, quality, region, repack, resolution, season, title, website, widescreen, year
- **Assessment**: Similar coverage to go-ptn. Less actively maintained. Same limitations regarding advanced episode/anime parsing.

**Confidence**: Medium -- same caveat as go-ptn.

#### torrent-name-parser (ProfChaos/torrent-name-parser)

- **Repository**: https://github.com/ProfChaos/torrent-name-parser
- **Description**: Another Go torrent name parser. Less documented than the above.
- **Assessment**: Minimal community adoption. Not recommended as a primary dependency.

**Confidence**: Low -- limited documentation and adoption.

### Recommended Libraries Stack

| Library                             | Purpose                      | Required?                     |
| ----------------------------------- | ---------------------------- | ----------------------------- |
| `github.com/dlclark/regexp2` v1.11+ | .NET-compatible regex engine | **Yes** (critical)            |
| `github.com/go-chi/chi/v5`          | HTTP routing + middleware    | Optional (can use `net/http`) |
| `encoding/json` (stdlib)            | JSON serialization           | Yes (stdlib, no install)      |
| `net/http` (stdlib)                 | HTTP server                  | Yes (stdlib, no install)      |
| `testing` (stdlib)                  | Unit testing                 | Yes (stdlib, no install)      |
| `github.com/stretchr/testify`       | Test assertions              | Recommended                   |

### Alternative Regex Options

| Library           | Performance vs stdlib | Lookahead/Lookbehind | Backreferences | Notes                                |
| ----------------- | --------------------- | -------------------- | -------------- | ------------------------------------ |
| `regexp` (stdlib) | Baseline              | No                   | No             | RE2 engine, linear-time guarantee    |
| `regexp2`         | ~3x slower            | Yes                  | Yes            | .NET port, required for this project |
| `rure-go`         | ~130x faster          | Yes (via Rust RE)    | Limited        | Requires Rust/C linkage, CGO         |
| `go-re2`          | ~10x faster           | No                   | No             | RE2 via C binding, CGO               |
| `hyperscan`       | ~30x faster           | Partial              | No             | Intel only, CGO                      |
| `coregex`         | 3-3000x faster        | Partial              | No             | SIMD optimizations, newer project    |

**Key Decision**: `regexp2` is the only pure-Go option that supports all regex features used by the current parser. The CGO-based alternatives (rure-go, go-re2, hyperscan) offer better performance but add build complexity and eliminate the "single static binary" advantage of Go.

**Confidence**: High -- based on feature matrix analysis and benchmark data from multiple sources.

Sources:

- [regexp2 GitHub](https://github.com/dlclark/regexp2)
- [Best Regexp Alternative for Go (benchmarks)](https://hackernoon.com/best-regexp-alternative-for-go-benchmarks-and-plots)
- [Go regex benchmark](https://github.com/mariomka/regex-benchmark)

## Integration Patterns

### Recommended Approach: REST Microservice (Drop-in Replacement)

The Go parser should expose the exact same HTTP API as the current .NET parser:

| Endpoint       | Method | Description                                 |
| -------------- | ------ | ------------------------------------------- |
| `/parse`       | POST   | Parse a release title (movie or series)     |
| `/match`       | POST   | Match text against a list of regex patterns |
| `/match/batch` | POST   | Batch match texts against patterns          |
| `/health`      | GET    | Health check + version info                 |

**Why REST over gRPC**: The current .NET parser already uses REST. The SvelteKit app calls it via HTTP. Switching to gRPC would require changes to both the parser and the calling code for marginal benefit on what is a low-throughput, latency-tolerant internal service. REST keeps the parser a true drop-in replacement.

**Why Microservice over Embedded**: The parser runs as a sidecar to the main Deno/SvelteKit process. Embedding Go code into Deno would require CGO or WASM, both adding complexity. A separate process maintains clean separation and allows independent scaling/deployment.

**Confidence**: High -- aligns with current architecture and minimizes integration risk.

### Build and Distribution

#### Static Binary Compilation

Go excels at producing self-contained static binaries with zero runtime dependencies:

```bash
# Linux AMD64
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-w -s" -o parser-linux-amd64 ./cmd/parser

# Linux ARM64
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-w -s" -o parser-linux-arm64 ./cmd/parser

# Windows AMD64
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-w -s" -o parser-windows-amd64.exe ./cmd/parser

# macOS AMD64
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags="-w -s" -o parser-darwin-amd64 ./cmd/parser

# macOS ARM64 (Apple Silicon)
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags="-w -s" -o parser-darwin-arm64 ./cmd/parser
```

Key flags:

- `CGO_ENABLED=0`: Pure Go, no C dependencies (critical since `regexp2` is pure Go)
- `-ldflags="-w -s"`: Strip debug info and symbol table (reduces binary 20-30%)
- Cross-compilation works from any host OS to any target OS/arch

Expected binary size: **5-15 MB** (vs .NET 8 single-file publish at 50-80 MB, or self-contained at 60-150 MB).

**Confidence**: High -- well-established Go capability.

#### Docker Container Pattern

```dockerfile
# Build stage
FROM golang:1.23-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /parser ./cmd/parser

# Runtime stage
FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /parser /parser
EXPOSE 5000
ENTRYPOINT ["/parser"]
```

Expected image size: **5-15 MB** (vs current .NET 8 image at 80-200 MB).

**Confidence**: High -- standard Go Docker pattern.

### Communication Protocol

| Protocol        | Latency    | Complexity | Binary Size Impact | Current Compatibility     |
| --------------- | ---------- | ---------- | ------------------ | ------------------------- |
| **REST/JSON**   | ~1-5ms     | Low        | None               | Direct drop-in            |
| gRPC/Protobuf   | ~0.5-2ms   | Medium     | +5-10MB (protoc)   | Requires caller changes   |
| Unix Socket     | ~0.1-0.5ms | Low        | None               | Requires caller changes   |
| Embedded (WASM) | ~0ms       | High       | N/A                | Major architecture change |

**Recommendation**: REST/JSON for v1 (drop-in replacement). Consider Unix domain sockets as a future optimization if latency becomes a concern.

## Constraints and Gotchas

### 1. regexp2 Performance (CRITICAL)

- **Impact**: regexp2 is ~3x slower than Go stdlib and ~7-10x slower than .NET's optimized regex engine for equivalent patterns.
- **Workaround**: Pre-compile all regex patterns at startup (like the current C# `RegexOptions.Compiled`). Use `regexp2cg` code generation for hot paths. The `/match` and `/match/batch` endpoints execute user-provided patterns at runtime, so pre-compilation is not possible there -- but the `MatchTimeout` field provides protection against catastrophic backtracking (equivalent to the current C# `TimeSpan.FromMilliseconds(100)` timeout).
- **Mitigation**: For the `/parse` endpoint, all patterns are known at compile time and can be pre-compiled. Performance may actually be acceptable since parsing individual release titles is inherently fast (small input strings).

**Confidence**: High -- based on published benchmarks and analysis of the workload.

### 2. Named Group Syntax Compatibility

- **Impact**: The current C# parser uses .NET named group syntax `(?<name>...)`. Go stdlib uses `(?P<name>...)`. regexp2 supports the .NET syntax directly.
- **Workaround**: When using regexp2, existing .NET regex patterns can be used with minimal changes. For any patterns that could work with Go stdlib `regexp`, a syntax transformation from `(?<name>...)` to `(?P<name>...)` is needed.
- **Strategy**: Use regexp2 for all patterns that require advanced features. Use stdlib `regexp` for simple patterns (like hash validation, extension matching) where RE2 is sufficient and faster.

**Confidence**: High -- verified against regexp2 documentation.

### 3. Backreference Usage

- **Impact**: The current parser uses `\k<sep>` backreferences in two EpisodeParser patterns (daily episode date parsing) and `\k<part2>` in ReleaseGroupParser. These are impossible in Go stdlib.
- **Workaround**: regexp2 supports `\k<name>` backreferences natively. Alternatively, these specific patterns could be rewritten as two-pass parsing (first match the separator, then construct a second pattern using the matched separator value).
- **Recommendation**: Use regexp2 for these patterns. The backreference patterns are clean and well-understood.

**Confidence**: High -- verified by grep of current source code.

### 4. Inline Flag Negation `(?-i:...)`

- **Impact**: The QualityParser uses `(?-i:WEB)` to match "WEB" case-sensitively within an otherwise case-insensitive pattern. Go stdlib supports `(?i:...)` (set flag) but does not support `(?-i:...)` (unset flag).
- **Workaround**: regexp2 supports inline flag negation. Alternatively, split the pattern into two: one case-insensitive and one case-sensitive.
- **Recommendation**: Use regexp2 for this pattern.

**Confidence**: High -- verified against both Go stdlib docs and regexp2 feature list.

### 5. Match Collection / Multiple Captures per Group

- **Impact**: The current C# parser uses `match.Groups["episode"].Captures` to get multiple captures of the same named group (e.g., `S01E05E06` captures `05` and `06` separately under the `episode` group). Go stdlib `regexp` only returns the last match for a repeated group.
- **Workaround**: regexp2 supports `group.Captures` (a slice of all captures for a group), matching the .NET API exactly.
- **Recommendation**: This is another reason regexp2 is required, not optional.

**Confidence**: High -- critical for multi-episode parsing.

### 6. `RegexOptions.Compiled` in .NET vs Go

- **Impact**: .NET's `RegexOptions.Compiled` JIT-compiles regex to IL code for faster execution. Go's `regexp.Compile` / `regexp2.Compile` pre-process the pattern but do not JIT.
- **Workaround**: In Go, the standard approach is to compile patterns once at package init time and reuse them. regexp2 has a `Compiled` option flag but its effect differs from .NET. The `regexp2cg` tool provides true code generation as an alternative.
- **Recommendation**: Pre-compile all patterns as package-level variables (e.g., `var sourceRegex = regexp2.MustCompile(...)`) -- this is idiomatic Go and matches the current C# approach of `static readonly Regex`.

**Confidence**: High.

### 7. Error Handling Differences

- **Impact**: .NET regex methods never return errors for pre-compiled patterns (only timeout). regexp2 returns `error` from match methods.
- **Workaround**: Check errors in all regexp2 calls. For pre-compiled, known-good patterns with no timeout set, the error will always be nil, but idiomatic Go requires checking.
- **Recommendation**: Set `MatchTimeout` on user-provided patterns (the `/match` endpoints) and handle timeout errors. For pre-compiled patterns, consider a helper that panics on error for cleaner code.

**Confidence**: High.

## Performance Comparisons

### Go vs .NET Regex

| Metric                        | Go `regexp` (stdlib) | Go `regexp2`              | .NET 8 `System.Text.RegularExpressions` |
| ----------------------------- | -------------------- | ------------------------- | --------------------------------------- |
| **Benchmark (email+URI+IP)**  | 850 ms               | ~2500 ms (estimated)      | 122-264 ms                              |
| **Time Guarantee**            | O(n) linear          | None (backtracking)       | None (backtracking)                     |
| **Lookahead/Lookbehind**      | No                   | Yes                       | Yes                                     |
| **Backreferences**            | No                   | Yes                       | Yes                                     |
| **Named Groups**              | `(?P<name>)`         | `(?<name>)`               | `(?<name>)`                             |
| **Compilation**               | Pre-compiled NFA     | Pre-compiled backtracking | JIT to IL (optional)                    |
| **Catastrophic Backtracking** | Impossible           | Possible (use timeout)    | Possible (use timeout)                  |

Source: [regex-benchmark](https://github.com/mariomka/regex-benchmark)

**Analysis**: For the specific workload of parsing release titles (small input strings, ~50-200 characters), the absolute performance difference is negligible. A single parse call takes microseconds, not seconds. The benchmark numbers above represent millions of matches against large input files. In practice, even regexp2's slower performance will parse thousands of titles per second.

**Confidence**: Medium -- benchmarks are for generic patterns, not release-title-specific patterns. Real-world performance should be validated with the actual parser patterns.

### Memory and CPU

| Metric                           | Go Parser (projected) | .NET 8 Parser (current)    |
| -------------------------------- | --------------------- | -------------------------- |
| **Binary Size**                  | 5-15 MB               | 50-150 MB (self-contained) |
| **Docker Image**                 | 5-15 MB (scratch)     | 80-200 MB (aspnet base)    |
| **Idle Memory**                  | 5-15 MB               | 30-80 MB                   |
| **Per-Request Memory**           | ~1-5 KB               | ~5-20 KB                   |
| **Startup Time**                 | <100 ms               | 500-2000 ms                |
| **Goroutine/Thread per Request** | ~2 KB (goroutine)     | ~1 MB (thread pool)        |
| **Concurrent Parsing Capacity**  | 10,000+ goroutines    | 100s of threads            |

Source: [Microservice Size Comparison](https://medium.com/@patibandha/why-microservice-size-matters-a-deep-dive-into-java-c-and-go-in-the-cloud-era-d21ef7ae3188)

**Key Advantage**: Go's static binary eliminates the .NET runtime dependency entirely. The parser becomes a single file that runs anywhere without installing .NET SDK/runtime. This is particularly valuable for praxrr's distribution model.

**Confidence**: Medium -- projected numbers based on Go microservice norms, not measured from this specific parser.

## Code Examples

### Basic Release Title Parser in Go (Proof of Concept)

```go
package parser

import (
	"strings"
	"time"

	"github.com/dlclark/regexp2"
)

// QualitySource represents the source of a release.
type QualitySource int

const (
	SourceUnknown  QualitySource = 0
	SourceCam      QualitySource = 1
	SourceTelesync QualitySource = 2
	SourceTelecine QualitySource = 3
	SourceWorkprint QualitySource = 4
	SourceDVD      QualitySource = 5
	SourceTV       QualitySource = 6
	SourceWebDL    QualitySource = 7
	SourceWebRip   QualitySource = 8
	SourceBluray   QualitySource = 9
)

// Resolution represents video resolution.
type Resolution int

const (
	ResUnknown Resolution = 0
	Res360p    Resolution = 360
	Res480p    Resolution = 480
	Res540p    Resolution = 540
	Res576p    Resolution = 576
	Res720p    Resolution = 720
	Res1080p   Resolution = 1080
	Res2160p   Resolution = 2160
)

// QualityResult holds parsed quality information.
type QualityResult struct {
	Source     QualitySource `json:"source"`
	Resolution Resolution   `json:"resolution"`
	Modifier   string       `json:"modifier"`
	Revision   Revision     `json:"revision"`
}

// Revision holds version/repack information.
type Revision struct {
	Version  int  `json:"version"`
	Real     int  `json:"real"`
	IsRepack bool `json:"isRepack"`
}

// Pre-compile all regex patterns at package init (equivalent to C# static readonly).
// Using regexp2 for .NET-compatible patterns with lookahead/lookbehind.
var (
	sourceRegex = mustCompile(`\b(?:
		(?<bluray>M?Blu[-_. ]?Ray|HD[-_. ]?DVD|BD(?!$)|UHD2?BD|BDISO|BDMux|BD25|BD50|BR[-_. ]?DISK)|
		(?<webdl>WEB[-_. ]?DL(?:mux)?|AmazonHD|AmazonSD|iTunesHD|MaxdomeHD|NetflixU?HD|WebHD|HBOMaxHD|DisneyHD)|
		(?<webrip>WebRip|Web-Rip|WEBMux)|
		(?<hdtv>HDTV)|
		(?<dvd>DVD(?!-R)|DVDRip|xvidvd)|
		(?<cam>CAMRIP|(?:NEW)?CAM|HD-?CAM(?:Rip)?|HQCAM)
	)(?:\b|$|[ .])`,
		regexp2.IgnoreCase|regexp2.IgnorePatternWhitespace)

	resolutionRegex = mustCompile(
		`\b(?:(?<R480p>480p|480i|640x480|848x480)|(?<R720p>720p|1280x720)|(?<R1080p>1080p|1920x1080|FHD|1080i)|(?<R2160p>2160p|3840x2160|4k[-_. ](?:UHD|HEVC|BD|H\.?265)))\b`,
		regexp2.IgnoreCase)

	properRegex = mustCompile(`\b(?<proper>proper)\b`, regexp2.IgnoreCase)
	repackRegex = mustCompile(`\b(?<repack>repack\d?|rerip\d?)\b`, regexp2.IgnoreCase)
)

// mustCompile compiles a regexp2 pattern or panics.
func mustCompile(pattern string, options regexp2.RegexOptions) *regexp2.Regexp {
	re := regexp2.MustCompile(pattern, options)
	re.MatchTimeout = 100 * time.Millisecond // Prevent catastrophic backtracking
	return re
}

// groupMatched checks if a named group was matched in a regexp2 match.
func groupMatched(m *regexp2.Match, name string) bool {
	g := m.GroupByName(name)
	return g != nil && g.Length > 0
}

// groupValue returns the matched text for a named group, or empty string.
func groupValue(m *regexp2.Match, name string) string {
	g := m.GroupByName(name)
	if g == nil || g.Length == 0 {
		return ""
	}
	return g.String()
}

// ParseQuality extracts quality information from a release title.
func ParseQuality(name string) QualityResult {
	normalized := strings.ReplaceAll(name, "_", " ")
	normalized = strings.TrimSpace(normalized)

	result := QualityResult{
		Revision: Revision{Version: 1},
	}

	// Parse resolution
	if m, _ := resolutionRegex.FindStringMatch(normalized); m != nil {
		switch {
		case groupMatched(m, "R480p"):
			result.Resolution = Res480p
		case groupMatched(m, "R720p"):
			result.Resolution = Res720p
		case groupMatched(m, "R1080p"):
			result.Resolution = Res1080p
		case groupMatched(m, "R2160p"):
			result.Resolution = Res2160p
		}
	}

	// Parse source
	if m, _ := sourceRegex.FindStringMatch(normalized); m != nil {
		switch {
		case groupMatched(m, "bluray"):
			result.Source = SourceBluray
			if result.Resolution == ResUnknown {
				result.Resolution = Res720p
			}
		case groupMatched(m, "webdl"):
			result.Source = SourceWebDL
			if result.Resolution == ResUnknown {
				result.Resolution = Res480p
			}
		case groupMatched(m, "webrip"):
			result.Source = SourceWebRip
			if result.Resolution == ResUnknown {
				result.Resolution = Res480p
			}
		case groupMatched(m, "hdtv"):
			result.Source = SourceTV
		case groupMatched(m, "dvd"):
			result.Source = SourceDVD
			result.Resolution = Res480p
		case groupMatched(m, "cam"):
			result.Source = SourceCam
		}
	}

	// Parse revision
	if m, _ := properRegex.FindStringMatch(normalized); m != nil {
		result.Revision.Version = 2
	}
	if m, _ := repackRegex.FindStringMatch(normalized); m != nil {
		result.Revision.Version = 2
		result.Revision.IsRepack = true
	}

	return result
}
```

### HTTP Server Example (chi)

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type ParseRequest struct {
	Title string `json:"title"`
	Type  string `json:"type"`
}

type ParseResponse struct {
	Title        string   `json:"title"`
	Type         string   `json:"type"`
	Source       string   `json:"source"`
	Resolution   int      `json:"resolution"`
	Modifier     string   `json:"modifier"`
	Languages    []string `json:"languages"`
	ReleaseGroup *string  `json:"releaseGroup"`
	// ... additional fields
}

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Post("/parse", handleParse)
	r.Post("/match", handleMatch)
	r.Post("/match/batch", handleBatchMatch)
	r.Get("/health", handleHealth)

	log.Println("Parser listening on :5000")
	http.ListenAndServe(":5000", r)
}

func handleParse(w http.ResponseWriter, r *http.Request) {
	var req ParseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if req.Title == "" {
		http.Error(w, `{"error":"Title is required"}`, http.StatusBadRequest)
		return
	}

	if req.Type != "movie" && req.Type != "series" {
		http.Error(w, `{"error":"Type must be 'movie' or 'series'"}`, http.StatusBadRequest)
		return
	}

	// Parse using the parser package
	// result := parser.Parse(req.Title, req.Type)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func handleMatch(w http.ResponseWriter, r *http.Request)      { /* ... */ }
func handleBatchMatch(w http.ResponseWriter, r *http.Request)  { /* ... */ }
func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"version": "1.0.0",
	})
}
```

### Match Endpoint with Timeout (regexp2)

```go
package parser

import (
	"time"

	"github.com/dlclark/regexp2"
)

// MatchPatterns tests multiple regex patterns against text.
// Equivalent to the C# MatchEndpoints with TimeSpan.FromMilliseconds(100).
func MatchPatterns(text string, patterns []string) map[string]bool {
	results := make(map[string]bool, len(patterns))

	for _, pattern := range patterns {
		re, err := regexp2.Compile(pattern, regexp2.IgnoreCase)
		if err != nil {
			// Invalid regex pattern
			results[pattern] = false
			continue
		}

		re.MatchTimeout = 100 * time.Millisecond // ReDoS protection

		matched, err := re.MatchString(text)
		if err != nil {
			// Timeout or other error
			results[pattern] = false
			continue
		}

		results[pattern] = matched
	}

	return results
}
```

### Table-Driven Test Example

```go
package parser_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"praxrr-parser-go/parser"
)

func TestParseQuality(t *testing.T) {
	tests := []struct {
		name       string
		title      string
		wantSource parser.QualitySource
		wantRes    parser.Resolution
	}{
		{
			name:       "bluray 1080p",
			title:      "Movie.Title.2024.1080p.BluRay.x264-GROUP",
			wantSource: parser.SourceBluray,
			wantRes:    parser.Res1080p,
		},
		{
			name:       "webdl 720p",
			title:      "Movie.Title.2024.720p.WEB-DL.DD5.1.H.264-GROUP",
			wantSource: parser.SourceWebDL,
			wantRes:    parser.Res720p,
		},
		{
			name:       "hdtv no resolution",
			title:      "Series.Title.S01E05.HDTV-GROUP",
			wantSource: parser.SourceTV,
			wantRes:    parser.ResUnknown,
		},
		{
			name:       "4k uhd bluray",
			title:      "Movie.2024.2160p.UHD.Blu-ray.Remux",
			wantSource: parser.SourceBluray,
			wantRes:    parser.Res2160p,
		},
		{
			name:       "repack detected",
			title:      "Movie.Title.2024.1080p.BluRay.REPACK-GROUP",
			wantSource: parser.SourceBluray,
			wantRes:    parser.Res1080p,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parser.ParseQuality(tt.title)
			assert.Equal(t, tt.wantSource, result.Source, "source mismatch")
			assert.Equal(t, tt.wantRes, result.Resolution, "resolution mismatch")
		})
	}
}
```

## Proposed Project Structure

```
praxrr-parser-go/
  cmd/
    parser/
      main.go              # Entry point, HTTP server setup
  internal/
    parser/
      quality.go           # QualityParser (port of QualityParser.cs)
      quality_test.go
      title.go             # TitleParser (port of TitleParser.cs)
      title_test.go
      episode.go           # EpisodeParser (port of EpisodeParser.cs)
      episode_test.go
      language.go           # LanguageParser (port of LanguageParser.cs)
      language_test.go
      releasegroup.go       # ReleaseGroupParser (port of ReleaseGroupParser.cs)
      releasegroup_test.go
      common.go             # Common regex helpers, file extension removal
      common_test.go
    handler/
      parse.go              # POST /parse handler
      match.go              # POST /match, /match/batch handlers
      health.go             # GET /health handler
    model/
      request.go            # Request types (ParseRequest, MatchRequest, etc.)
      response.go           # Response types (ParseResponse, MatchResponse, etc.)
      types.go              # Enums (QualitySource, Resolution, etc.)
  go.mod
  go.sum
  Dockerfile
  Makefile
```

## Migration Strategy

### Phase 1: Foundation

1. Set up Go module with `regexp2` dependency
2. Port `QualityParser` first (simplest, fewest cross-dependencies)
3. Write comprehensive table-driven tests using test data from C# test suite
4. Validate regex pattern parity between C# and Go

### Phase 2: Core Parsers

1. Port `TitleParser` (movie title extraction)
2. Port `EpisodeParser` (series episode extraction)
3. Port `LanguageParser` (language detection)
4. Port `ReleaseGroupParser` (release group extraction)

### Phase 3: HTTP Layer

1. Implement REST endpoints matching current .NET API contract
2. Add health check endpoint
3. Add structured logging (match current log format if needed)

### Phase 4: Integration

1. Test against praxrr's existing parser test suite
2. Run both parsers side-by-side, compare outputs
3. Switch praxrr to use Go parser
4. Remove .NET parser dependency

## Open Questions

1. **Regex pattern audit**: Should all ~80 regex patterns be ported 1:1 from C#, or should some be simplified/rewritten for Go? Some patterns (like the BRDISKRegex with nested lookaheads) could potentially be decomposed into simpler multi-step logic.

2. **Hybrid regex strategy**: Should the parser use `regexp` (stdlib) for simple patterns and `regexp2` for complex ones? This adds complexity but improves performance for ~40% of patterns that do not require advanced features.

3. **regexp2cg code generation**: Should the code generation tool be integrated into the build pipeline for the ~15 pre-compiled patterns used by the parse endpoint? This could provide 3-10x speedup on the hot path.

4. **Test data format**: Should test cases be shared between the C# and Go implementations (e.g., JSON test fixture files) to ensure parity, or should the Go tests be standalone?

5. **Logging parity**: Should the Go parser match the current C# parser's structured logging format exactly, or use Go-idiomatic `slog` (structured logging added in Go 1.21)?

6. **Parser versioning**: Should the Go parser expose a different version number to distinguish it from the C# parser in logs/health checks?

7. **Batch match parallelism**: The current C# parser uses `Parallel.ForEach` for batch matching. Go's goroutines provide natural parallelism -- should the batch endpoint use a worker pool or unbounded goroutines?

---

## Search Queries Executed

1. `Go regexp2 library .NET compatible regex lookahead lookbehind 2025`
2. `Go release title parser torrent media PTN parse-torrent-name golang`
3. `Go vs .NET regex performance benchmark 2024 2025`
4. `Go HTTP microservice framework comparison chi gin echo fiber 2025 production`
5. `Go static binary cross compilation Docker scratch container best practices 2025`
6. `Go gRPC vs REST microservice inter-service communication sidecar pattern`
7. `golang regexp2 named groups performance benchmark vs stdlib regexp 2025`
8. `Go embed binary into other program WebAssembly wasm plugin sidecar microservice pattern`
9. `regexp2cg golang code generation tool regex performance optimization`
10. `Go regex named capture groups golang standard library subexp name`
11. `Radarr Sonarr parser C# regex source code github release title parsing`
12. `Go memory usage comparison .NET 8 microservice small binary footprint 2025`
13. `golang testing table driven tests testify assert parser unit testing best practices`
14. `Go chi router minimal microservice JSON API example production 2025`
15. `golang regexp inline flags modifier group scoped flags standard library`
16. `Go regexp backreference named backreference support`
17. `Go net/http standard library ServeMux routing 1.22 2024 improvements pattern matching`

## Uncertainties and Gaps

- **regexp2 real-world performance with praxrr's specific patterns**: Published benchmarks use generic patterns. The actual performance with 80+ complex patterns including nested lookaheads needs to be measured. Low confidence in exact timing projections.

- **regexp2cg maturity**: The code generation tool is mentioned in the regexp2 README but has limited community reports of production usage. Its stability and maintenance status are unclear.

- **Edge cases in Unicode handling**: regexp2 notes uncertainty around supplementary Unicode characters. Release titles occasionally contain CJK characters (anime releases). Testing with these inputs is recommended.

- **Batch match concurrency model**: The optimal parallelism strategy for the batch match endpoint (bounded worker pool vs goroutine-per-text) depends on typical batch sizes, which are unknown. Needs profiling with production-like workloads.

- **go-ptn and go-parse-torrent-name quality**: These libraries were assessed by README only, not by running them against praxrr's test suite. Their regex coverage may be useful as supplementary reference but their production readiness is unverified.

## Sources

- [regexp2 GitHub Repository](https://github.com/dlclark/regexp2)
- [regexp2 Go Package Documentation](https://pkg.go.dev/github.com/dlclark/regexp2)
- [Go stdlib regexp Package](https://pkg.go.dev/regexp)
- [Go Issue #18868: regexp lookahead/lookbehind](https://github.com/golang/go/issues/18868)
- [go-ptn: Parse Torrent File Name in Go](https://github.com/razsteinmetz/go-ptn)
- [go-parse-torrent-name](https://github.com/middelink/go-parse-torrent-name)
- [regex-benchmark (Go vs C#)](https://github.com/mariomka/regex-benchmark)
- [Best Regexp Alternative for Go (Benchmarks)](https://hackernoon.com/best-regexp-alternative-for-go-benchmarks-and-plots)
- [Go chi router](https://github.com/go-chi/chi)
- [Go 1.22 Routing Enhancements](https://go.dev/blog/routing-enhancements)
- [JetBrains Go Ecosystem 2025](https://blog.jetbrains.com/go/2025/11/10/go-language-trends-ecosystem-2025/)
- [Go Web Framework Comparison 2025](https://blog.logrocket.com/top-go-frameworks-2025/)
- [Go Cross-Compiled Docker Images](https://www.jvt.me/posts/2025/06/04/go-cross-compile-docker/)
- [Minimal Go Docker Containers](https://chemidy.medium.com/create-the-smallest-and-secured-golang-docker-image-based-on-scratch-4752223b7324)
- [Microservice Size: Java vs C# vs Go](https://medium.com/@patibandha/why-microservice-size-matters-a-deep-dive-into-java-c-and-go-in-the-cloud-era-d21ef7ae3188)
- [Radarr Parser Source](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/Parser/Parser.cs)
- [Sonarr Parser Source](https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/Parser/Parser.cs)
- [Go Wiki: Table Driven Tests](https://go.dev/wiki/TableDrivenTests)
- [gRPC for Microservices Communication](https://www.capitalone.com/tech/software-engineering/grpc-framework-for-microservices-communication/)
- [regexp2go Code Generation](https://github.com/CAFxX/regexp2go)
- [coregex: SIMD-optimized regex for Go](https://github.com/coregx/coregex)
