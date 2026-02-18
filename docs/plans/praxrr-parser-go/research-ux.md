# UX Research: praxrr-parser-go

## Executive Summary

A Go rewrite of the praxrr parser delivers significant deployment and resource efficiency gains -- smaller Docker images (5-15 MB vs ~110 MB), faster startup (~3 ms vs ~60 ms), and dramatically lower memory usage (~25 MB vs ~160 MB) -- all of which directly benefit self-hosted users who run praxrr on resource-constrained hardware. However, the current parser makes **heavy use of .NET-specific regex features** (106 lookaround assertions, 119 named groups, and backreferences) that Go's standard `regexp` package does not support. The rewrite **must** use `dlclark/regexp2`, a pure-Go port of .NET's regex engine, which preserves full pattern compatibility but trades away Go's linear-time regex guarantees. This is the single largest technical risk to the rewrite and the primary factor determining whether parse-parity can be achieved without rewriting every regex pattern by hand.

**Confidence**: High -- based on direct source code analysis of the current parser and documented regexp2 capabilities.

---

## Developer Experience

### Go Toolchain

Go's toolchain is widely praised for its simplicity and self-contained nature. A single `go` binary handles building, testing, dependency management, formatting, and vetting, with no separate package manager, build system, or runtime to install.

**Key advantages for a parser microservice:**

- `go build` produces a statically linked binary with zero runtime dependencies
- `go test` runs tests with built-in coverage, benchmarking, and fuzzing support
- `go mod` handles dependency management with a lockfile (`go.sum`) and no `node_modules`-style bloat
- `gofmt` enforces a single canonical formatting style, eliminating style debates
- `go vet` catches common bugs at compile time
- Cross-compilation is a single environment variable change: `GOOS=linux GOARCH=amd64 go build`

**Comparison to .NET for this project:**

The current parser requires the .NET 8 SDK (~700 MB) for development, `dotnet restore` for package management, and the ASP.NET runtime for execution. Go replaces all of this with a single ~150 MB SDK download that produces self-contained binaries.

**Confidence**: High -- Go toolchain simplicity is one of its most documented and universally acknowledged strengths. Multiple authoritative sources confirm this.

Sources:

- [.NET vs Go Comparison - Flexiple](https://flexiple.com/compare/dot-net-vs-go)
- [Go vs C# - Medium](https://medium.com/@anthonyjoanes_72638/go-vs-c-a-comprehensive-comparison-for-modern-developers-9a93890705b4)
- [Go Ecosystem 2025 - JetBrains](https://blog.jetbrains.com/go/2025/11/10/go-language-trends-ecosystem-2025/)

### IDE Support

Go has mature IDE support across all major editors:

| IDE/Editor             | Go Support Quality | Key Features                                                         |
| ---------------------- | ------------------ | -------------------------------------------------------------------- |
| VS Code + Go extension | Excellent          | gopls language server, Delve debugger, code generation, test runner  |
| GoLand (JetBrains)     | Excellent          | Integrated debugger, refactoring, profiler, advanced code navigation |
| Neovim/Vim             | Good               | gopls via LSP, tree-sitter highlighting                              |
| Zed                    | Good               | Built-in Go support via gopls                                        |

VS Code is the most widely used editor for Go development, powered by the official Go extension maintained by Google. The `gopls` language server provides IntelliSense, code navigation, symbol search, rename refactoring, and signature help. This is comparable to the C# Dev Kit experience in VS Code for .NET development, with the advantage that gopls is a single binary with no additional dependencies.

GoLand provides a more integrated experience with its built-in debugger that handles Go's concurrency model (goroutines, channels) more gracefully than VS Code's Delve integration, showing inline variable values and allowing breakpoint evaluation during concurrent execution.

**Confidence**: High -- IDE tooling for Go is well-documented and widely used.

Sources:

- [Go in VS Code](https://code.visualstudio.com/docs/languages/go)
- [Best Go IDE Options 2025 - Netguru](https://www.netguru.com/blog/best-go-ide-options)
- [VS Code Setup for Go 2025 - Medium](https://dipjyotimetia.medium.com/vs-code-setup-for-golang-development-in-2025-57ba0a50881c)

### Debugging

Go debugging is handled primarily through the Delve debugger, which provides:

- Breakpoints, conditional breakpoints, and watchpoints
- Step-in, step-over, step-out execution
- Goroutine inspection and switching
- Variable evaluation and modification
- Remote debugging for containers

**Compared to .NET debugging:**

.NET debugging in Visual Studio is arguably more mature, with better hot-reload support, richer watch windows, and deeper framework integration. However, for a regex-heavy parser microservice, the debugging experience difference is minimal -- most debugging involves inspecting regex match results and string state, which both ecosystems handle well. Go's `testing` package also makes it trivial to write table-driven tests for parser edge cases, which reduces the need for interactive debugging.

**Confidence**: Medium -- .NET debugging is more feature-rich in absolute terms, but the practical difference for a parser service is small.

Sources:

- [Go Debugging in VS Code](https://code.visualstudio.com/docs/languages/go)
- [GoLand Debugging - JetBrains](https://www.jetbrains.com/help/go/migrating-from-visual-studio-code-to-goland.html)

---

## Deployment Experience

### Binary Distribution

This is the single largest UX improvement of a Go rewrite for self-hosted users.

**Current state (.NET):**

- Requires the ASP.NET 8.0 runtime (~110 MB Docker layer)
- Must ship as a DLL + runtime, not a standalone binary
- Separate `Dockerfile.parser` with multi-stage build
- Users cannot run the parser without Docker or .NET installed

**Proposed state (Go):**

- Single statically linked binary, zero runtime dependencies
- Can run directly on any Linux/macOS/Windows machine
- Docker image can use `scratch` or `distroless` base (0-5 MB overhead)
- Binary size for a regex-heavy HTTP service: estimated 10-20 MB

The Go binary approach eliminates the .NET runtime dependency entirely. For users running praxrr on NAS devices, Raspberry Pis, or other constrained hardware, this is transformative -- they can download a single file and run it, no runtime installation required.

**Confidence**: High -- Go's static binary compilation is a core language feature, thoroughly documented and battle-tested.

### Docker Comparison

| Metric                | .NET Parser (Current)           | Go Parser (Proposed)        | Source                                                                                                                              |
| --------------------- | ------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Base image            | `aspnet:8.0-alpine`             | `scratch` or `distroless`   | Dockerfile analysis                                                                                                                 |
| Runtime image size    | ~110 MB (aspnet alpine)         | ~5-15 MB (scratch + binary) | [Docker size comparison](https://github.com/dev-details/go-lang-docker-image-size-comparison)                                       |
| Build image size      | ~700 MB (dotnet/sdk:8.0-alpine) | ~300 MB (golang:alpine)     | Docker Hub                                                                                                                          |
| Startup time          | ~60 ms (.NET JIT)               | ~3 ms (native binary)       | [Benchmark analysis](https://medium.com/@anthonyjoanes_72638/go-vs-c-a-comprehensive-comparison-for-modern-developers-9a93890705b4) |
| Idle memory           | ~30-50 MB (CLR overhead)        | ~2-5 MB (Go runtime)        | [Memory comparison](https://flexiple.com/compare/dot-net-vs-go)                                                                     |
| Working memory (load) | ~100-162 MB                     | ~20-30 MB                   | [Flexiple comparison](https://flexiple.com/compare/dot-net-vs-go)                                                                   |
| Health check          | wget (added to image)           | curl or built-in HTTP check | Dockerfile analysis                                                                                                                 |
| Build time            | ~30-60s (restore + publish)     | ~10-20s (go build)          | Estimated                                                                                                                           |

**Key Docker improvements:**

1. **Image pull time**: ~110 MB -> ~10 MB is a 10x reduction in pull time, which matters for first-time deployment and CI/CD pipelines.
2. **Layer caching**: Go's dependency caching (`go mod download`) is faster and more predictable than `dotnet restore`.
3. **Multi-arch builds**: Go cross-compilation (`GOOS`/`GOARCH`) is simpler than .NET's cross-compilation story, especially for ARM64 support on Raspberry Pi.
4. **No runtime vulnerability surface**: A `scratch`-based Go image has zero OS packages to patch. The current .NET image inherits Alpine's package surface plus the ASP.NET runtime.

**Confidence**: High -- Docker image sizes are well-documented for both ecosystems. Go scratch images at 5-15 MB and .NET aspnet:alpine at ~110 MB are consistent across multiple sources.

Sources:

- [Go Docker image size comparison](https://github.com/dev-details/go-lang-docker-image-size-comparison)
- [.NET Docker image sizes - November 2025](https://github.com/dotnet/dotnet-docker/blob/main/documentation/sample-image-size-report.md)
- [Containerizing Go apps with Docker](https://www.buanacoding.com/2025/10/how-to-containerize-and-deploy-go-apps-with-docker.html)
- [Lightweight Go Docker images with Alpine](https://medium.com/@kvinothsha/how-to-create-lightweight-go-docker-images-using-alpine-linux-ac56733af7d3)

### Self-Hosting Impact

The self-hosted media server community overwhelmingly uses Docker for deployment, and values:

1. **Small image sizes** -- less bandwidth, faster updates
2. **Low memory usage** -- many users run 10+ containers on a single machine
3. **Fast startup** -- container restarts should be near-instant
4. **Simple configuration** -- fewer environment variables, fewer moving parts

A Go parser checks all four boxes. The current .NET parser's `depends_on: parser: condition: service_healthy` pattern in `compose.dev.yml` adds startup latency as praxrr waits for the parser's health check to pass. A Go parser's ~3 ms startup would make this wait negligible.

For users who prefer bare-metal deployment (no Docker), a Go parser is a single binary download. The .NET parser requires either Docker or a .NET runtime installation, which is a significant barrier for non-technical users.

**Confidence**: High -- the self-hosted community's preferences are well-documented through tools like awesome-selfhosted, and Docker is the dominant deployment method.

Sources:

- [awesome-selfhosted - Go platforms](https://awesome-selfhosted.net/platforms/go.html)
- [Perfect Media Server - Docker](https://perfectmediaserver.com/02-tech-stack/docker/)

---

## End-User Impact

### Parsing Accuracy

This is the **highest-risk area** of the rewrite. The current parser contains:

| Feature                                | Count    | Go `regexp` Support              | `regexp2` Support         |
| -------------------------------------- | -------- | -------------------------------- | ------------------------- |
| Negative lookaheads `(?!...)`          | 53       | No                               | Yes                       |
| Negative lookbehinds `(?<!...)`        | 42       | No                               | Yes                       |
| Positive lookaheads `(?=...)`          | 7        | No                               | Yes                       |
| Positive lookbehinds `(?<=...)`        | 4        | No                               | Yes                       |
| Named groups `(?<name>...)`            | 119      | No (uses `(?P<name>...)` syntax) | Yes                       |
| Backreferences `\k<name>`              | 2        | No                               | Yes                       |
| `RegexOptions.Compiled`                | Multiple | N/A                              | N/A (compiled by default) |
| `RegexOptions.IgnoreCase`              | Multiple | Via flags                        | Via flags                 |
| `RegexOptions.IgnorePatternWhitespace` | Multiple | Via flags                        | Via flags                 |

**Critical finding:** Go's standard `regexp` package (based on RE2) **cannot** be used for this rewrite. The parser requires `dlclark/regexp2`, a pure-Go port of the .NET regex engine, which supports all of the above features.

**regexp2 compatibility assessment:**

The `regexp2` library was directly ported from .NET's `System.Text.RegularExpressions.Regex` engine (open-sourced in 2015). The author states that "the parse tree, code emitted, and therefore patterns matched should be identical" to .NET's behavior. This means the regex patterns from the current parser should be directly portable to Go with `regexp2` without modification.

**Risk factors:**

1. **Subtle behavioral differences**: While regexp2 aims for .NET compatibility, edge cases in Unicode handling or group capture ordering could produce different results. Every regex pattern must be tested against the same corpus.
2. **No constant-time guarantees**: Unlike Go's `regexp`, `regexp2` allows backtracking, which means pathological patterns could hang. The current .NET parser already has this risk (it uses `RegexOptions.Compiled` with backtracking), so this is not a regression.
3. **Timeout support**: `regexp2` provides `MatchTimeout` similar to .NET's `Regex.MatchTimeout`, which the current `MatchEndpoints.cs` already uses (`TimeSpan.FromMilliseconds(100)`). This can be directly ported.

**Mitigation strategy:**

- Port all regex patterns verbatim from .NET to regexp2
- Create a comprehensive test corpus from the current parser's test cases
- Run both parsers (old .NET, new Go) against the same inputs and diff the outputs
- Use regexp2's timeout mechanism for the `/match` endpoint (same as current 100ms timeout)
- Consider using `regexp2cg` code generation for hot-path patterns to recover 3-10x performance

**Confidence**: Medium -- regexp2 is a well-maintained port with good .NET compatibility, but regex engine edge cases are notoriously hard to catch without exhaustive testing. The backreference usage (`\k<sep>` in EpisodeParser) is a particularly sensitive area.

Sources:

- [regexp2 - GitHub](https://github.com/dlclark/regexp2)
- [regexp2 README](https://github.com/dlclark/regexp2/blob/master/README.md)
- [Go regex limitations - golang/go#18868](https://github.com/golang/go/issues/18868)

### Performance

Expected performance changes from .NET to Go for this parser:

**Parse throughput:**

- The parser is CPU-bound (regex matching), not I/O-bound
- regexp2 is slower than Go's standard `regexp` (due to backtracking engine), but comparable to .NET's `System.Text.RegularExpressions` since it is a direct port
- The `regexp2cg` code generation tool can improve performance 3-10x for compiled patterns
- Net effect: **comparable or slightly faster** parse throughput, depending on whether `regexp2cg` is used

**HTTP overhead:**

- Go's `net/http` or a lightweight router (Chi, Gin) has lower overhead than ASP.NET Core's Kestrel for simple JSON APIs
- The parser only has 5 endpoints (`/parse`, `/match`, `/match/batch`, `/health`, `/health/ready`) -- minimal routing complexity
- Net effect: **faster** HTTP response times due to lower framework overhead

**Batch processing:**

- The current `HandleBatchMatch` uses `Parallel.ForEach` for concurrent text matching
- Go's goroutines provide equivalent or better concurrency for this pattern, with lower memory overhead per concurrent task
- Net effect: **comparable or better** batch processing throughput

**Cold start:**

- Go: ~3 ms to first request vs .NET: ~60 ms
- This matters when the parser container is restarted or when praxrr checks parser health on startup
- Net effect: **20x faster** cold start

**Confidence**: Medium -- performance comparisons depend heavily on workload patterns. The regex engine comparison (regexp2 vs .NET Regex) has not been benchmarked for these specific patterns.

Sources:

- [Go vs .NET HTTP performance](https://medium.com/hackernoon/go-vs-net-core-in-terms-of-http-performance-7535a61b67b8)
- [ASP.NET Core 8 vs Go benchmark](https://trungtq.com/2025/02/07/benchmarking-giants-asp-net-core-8-vs-node-js-vs-go-a-performance-analysis/)
- [regexp2 performance](https://github.com/dlclark/regexp2/issues/19)

### Error Handling

The current parser has a minimalist error handling approach:

```csharp
catch
{
    // Parsing failed
}
return null;
```

This swallows all exceptions silently. A Go rewrite presents an opportunity to improve error reporting:

**Go's explicit error handling** (`if err != nil`) forces every error path to be handled explicitly. This is initially more verbose but produces more robust code. For the parser, this means:

- Failed regex matches return structured errors, not silent `null`
- Invalid input titles get specific error messages (currently only checks for empty title and invalid type)
- Regex timeout errors can be distinguished from parse failures
- The `/match` endpoint's ReDoS timeout (currently 100ms) can return specific timeout error messages

**User-facing impact:**

End users interacting with the parser through praxrr's UI would see better diagnostic messages when a title cannot be parsed, instead of the current silent failure mode. This is a net UX improvement regardless of language choice, but Go's error handling philosophy makes it harder to accidentally swallow errors.

**Confidence**: High -- Go's explicit error handling is a core language design decision, and the current parser's error handling is observably minimal.

---

## Build and Distribution UX

### Current (.NET)

**Build requirements:**

- .NET 8 SDK (~700 MB)
- `dotnet restore` (downloads NuGet packages)
- `dotnet publish -c Release` (produces DLL + runtime deps)
- Requires ASP.NET runtime on the target machine (or Docker)

**Distribution:**

- Cannot distribute as a single binary without .NET Native AOT (not currently used)
- Docker image is the primary distribution mechanism
- Multi-stage Dockerfile required for reasonable image sizes
- Cross-platform builds require specifying runtime identifiers (`-r linux-x64`, `-r linux-arm64`)

**Developer setup for contributors:**

- Install .NET 8 SDK
- Install `dotnet watch` for hot reload
- Configure IDE with C# extensions
- Restore NuGet packages

### Proposed (Go)

**Build requirements:**

- Go SDK (~150 MB)
- `go build` (no separate restore step -- modules are cached automatically)
- Produces a single statically linked binary

**Distribution:**

- Single binary per platform (linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64)
- Can be distributed via GitHub Releases without Docker
- Docker image uses `scratch` base -- entire image is the binary + CA certificates
- GoReleaser can automate multi-platform builds and GitHub Release creation

**Cross-platform build commands:**

```bash
# Linux amd64
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags='-w -s' -o parser-linux-amd64

# Linux arm64 (Raspberry Pi)
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-w -s' -o parser-linux-arm64

# macOS
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-w -s' -o parser-darwin-arm64

# Windows
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags='-w -s' -o parser-windows-amd64.exe
```

**Note:** `CGO_ENABLED=0` is required for fully static binaries. Since `regexp2` is pure Go (no C dependencies), this works without issues. The `-ldflags='-w -s'` strips debug information, reducing binary size by ~30%.

**Developer setup for contributors:**

- Install Go SDK
- `go build` (that's it)
- IDE auto-configures via `go.mod`

**Impact on praxrr's build pipeline:**

- `deno task dev:parser` currently runs `dotnet watch` -- would become `go run .` or a pre-built binary
- `Dockerfile.parser` shrinks from a two-stage .NET build to a simpler Go build
- CI/CD pipeline for parser becomes faster (Go builds are typically 10-20s vs 30-60s for .NET publish)

**Confidence**: High -- Go's cross-compilation and static binary story is one of its most universally acknowledged strengths.

Sources:

- [Go cross-compilation](https://www.compilenrun.com/docs/language/go/go-tools/go-cross-compilation/)
- [Go Docker multi-stage builds 2026](https://oneuptime.com/blog/post/2026-01-07-go-docker-multi-stage/view)
- [Reducing Go Docker image size](https://medium.com/code-beyond/dockerizing-golang-apps-a-step-by-step-guide-to-reducing-docker-image-size-306898e7359e)

---

## Competitive Analysis

### Radarr/Sonarr Parser

Radarr, Sonarr, Prowlarr, and all \*arr applications are written in C# (.NET). Their parsers live in `NzbDrone.Core/Parser/` and use the same regex-heavy approach as the praxrr parser -- in fact, **praxrr's parser appears to be directly derived from the Radarr/Sonarr parser codebase**, sharing identical regex patterns (e.g., `EditionRegex`, `SourceRegex`, `ReportMovieTitleRegex`).

This shared lineage means:

1. The regex patterns are battle-tested against years of real-world release titles
2. Any Go rewrite must maintain exact behavioral parity with these patterns
3. The .NET regex engine's behavior is the "gold standard" for correctness
4. Using `regexp2` (a .NET regex port) is the safest path to parity

**Confidence**: High -- direct source code comparison confirms shared lineage between praxrr and Radarr/Sonarr parsers.

Sources:

- [Radarr Parser.cs - GitHub](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/Parser/Parser.cs)
- [Sonarr Parser.cs - GitHub](https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/Parser/Parser.cs)

### Other Tools in the \*arr Ecosystem

| Tool               | Language            | Purpose             | Distribution            |
| ------------------ | ------------------- | ------------------- | ----------------------- |
| Radarr             | C# (.NET)           | Movie management    | Docker, native packages |
| Sonarr             | C# (.NET)           | TV management       | Docker, native packages |
| Prowlarr           | C# (.NET)           | Indexer management  | Docker, native packages |
| Recyclarr          | C# (.NET)           | TRaSH Guide sync    | Docker, native binaries |
| Notifiarr          | **Go** + Svelte     | Notification client | Docker, native binaries |
| Configarr          | TypeScript/Node.js  | TRaSH Guide sync    | Docker                  |
| Profilarr (praxrr) | Deno/SvelteKit + C# | Config management   | Docker                  |

**Key observation:** Notifiarr is the only major *arr ecosystem tool written in Go, and it successfully integrates with Radarr, Sonarr, Plex, and other services. Its Go backend (67.5% of codebase) demonstrates that Go is a viable language for *arr ecosystem tooling. Notifiarr distributes as both Docker images and native binaries across multiple platforms.

**Confidence**: High -- programming language choices are verifiable from public repositories.

Sources:

- [Notifiarr - GitHub](https://github.com/Notifiarr/notifiarr)
- [Recyclarr - GitHub](https://github.com/recyclarr/recyclarr)
- [Configarr - GitHub](https://github.com/raydak-labs/configarr)
- [Profilarr - GitHub](https://github.com/Dictionarry-Hub/profilarr)
- [awesome-arr collection](https://github.com/Ravencentric/awesome-arr)

### Community Preferences

The self-hosted community values:

1. **Single binary distribution** -- tools that "just work" without runtime dependencies are preferred (Notifiarr, Caddy, Traefik are all Go)
2. **Small Docker images** -- bandwidth costs money on VPS/cloud instances
3. **Low resource usage** -- many users run 15-20 containers on a single NAS or mini-PC
4. **Reliability** -- parsers must not crash or hang on edge-case inputs

Go aligns with all four preferences. However, the \*arr ecosystem is overwhelmingly .NET, which means:

- Contributors familiar with \*arr internals likely know C# better than Go
- Regex patterns from Radarr/Sonarr can be copied directly into a .NET parser but need validation when ported to regexp2
- The TRaSH Guides community primarily tests custom format regex patterns against .NET's regex engine

**Confidence**: Medium -- community preferences are inferred from tool adoption patterns and forum discussions, not direct surveys.

Sources:

- [awesome-selfhosted - Go platforms](https://awesome-selfhosted.net/platforms/go.html)
- [Profilarr vs Recyclarr comparison 2026](https://corelab.tech/profilarr-vs-trash/)
- [TRaSH Guides Custom Formats](https://trash-guides.info/Sonarr/sonarr-collection-of-custom-formats/)

### TRaSH Guides and Custom Format Parsing

TRaSH Guides custom formats are JSON definitions containing regex patterns that Radarr/Sonarr evaluate against release titles. These patterns are:

1. Written and tested against .NET's `System.Text.RegularExpressions` engine
2. Validated using regex101.com (which supports multiple regex flavors)
3. Applied by Radarr/Sonarr's built-in parser, not by praxrr directly

Praxrr's parser is used for **testing and previewing** custom format matches (via the `/match` and `/match/batch` endpoints), not for production sync. This means:

- **The parser must match .NET regex behavior** to give accurate previews
- If praxrr's Go parser evaluates a custom format regex differently than Radarr's .NET engine, users will see misleading test results
- Using `regexp2` (the .NET regex port) is therefore not just convenient but **necessary** for correctness

**Confidence**: High -- TRaSH Guides custom format regex patterns are publicly documented and their .NET dependency is verifiable.

Sources:

- [TRaSH Guides Custom Formats](https://trash-guides.info/Sonarr/sonarr-collection-of-custom-formats/)
- [TRaSH Guides Contributing - regex requirements](https://github.com/TRaSH-Guides/Guides/blob/master/CONTRIBUTING.md)

---

## Recommendations

### Must Have

1. **Use `dlclark/regexp2` for all regex operations** -- Go's standard `regexp` package cannot handle the 106 lookaround assertions and 2 backreferences in the current parser. This is non-negotiable.

2. **Comprehensive test parity** -- Port all existing test cases from the .NET parser and run side-by-side comparison against the current parser before deployment. Include edge cases from TRaSH Guides custom format patterns.

3. **Identical API contract** -- The Go parser must expose the same HTTP endpoints (`/parse`, `/match`, `/match/batch`, `/health`, `/health/ready`) with identical request/response JSON shapes. praxrr's SvelteKit server communicates with these endpoints and must not require changes.

4. **Regex timeout protection** -- Port the 100ms match timeout from `MatchEndpoints.cs` to `regexp2.MatchTimeout`. This prevents ReDoS attacks from custom format patterns submitted by users.

5. **Static binary builds** -- Use `CGO_ENABLED=0` to ensure fully static binaries. Since `regexp2` is pure Go, this is feasible.

### Should Have

6. **Minimal Docker image** -- Use `scratch` or `gcr.io/distroless/static` as the base image. Include CA certificates if the parser ever needs HTTPS (currently it does not).

7. **Structured logging** -- Replace the current custom logging with Go's `slog` (standard library structured logging, available since Go 1.21). Match the current parser's log format for consistency.

8. **Graceful shutdown** -- Handle `SIGTERM` properly for container orchestration. Go's `context` package and `http.Server.Shutdown()` make this straightforward.

9. **Build with `regexp2cg` code generation** -- For the hot-path regex patterns (title parsing, quality parsing, language parsing), use `regexp2cg` to pre-compile patterns into Go code for 3-10x speedup. This compensates for regexp2 being slower than Go's standard regexp.

10. **GoReleaser for distribution** -- Automate multi-platform binary builds and GitHub Release creation. This gives users direct download options alongside Docker.

### Nice to Have

11. **Benchmark suite** -- Create a Go benchmark suite (`go test -bench`) that compares parse throughput against the .NET parser using the same corpus. This provides concrete data for the speed comparison.

12. **Fuzz testing** -- Go's built-in fuzz testing (`go test -fuzz`) can find edge cases in the parser that traditional tests miss. Feed random strings through the parser and check for panics or hangs.

13. **Embed version info** -- Use Go's `-ldflags` to embed build version, commit hash, and build time into the binary. This helps with debugging deployed instances.

14. **Health endpoint with regex engine info** -- Include the regexp2 version and Go version in the `/health` response, making it easy to diagnose compatibility issues.

---

## Open Questions

1. **Should the Go parser be embedded into the main praxrr binary?** Currently the parser is a separate microservice because Deno cannot run .NET code. Go binaries can be called as subprocesses or linked via FFI. Alternatively, the parser could remain a sidecar microservice (simplest migration path).

2. **How to handle regex pattern updates?** As Radarr/Sonarr update their parsers, praxrr needs to pull in new regex patterns. Currently these are hardcoded in C#. Should the Go rewrite load patterns from configuration, or keep them hardcoded? Configuration-driven patterns would be more maintainable but add complexity.

3. **What is the minimum Go version to target?** Go 1.21+ is recommended for `slog` support. Go 1.22+ adds enhanced routing in `net/http` (pattern matching in routes), which could eliminate the need for a third-party router.

4. **Should the `/match` endpoint use Go's standard `regexp` where possible?** For custom format regex patterns that do not use lookarounds or backreferences, Go's standard `regexp` would provide linear-time guarantees and better performance. A hybrid approach (try `regexp` first, fall back to `regexp2`) adds complexity but could be worthwhile for the batch match endpoint.

5. **Is there value in also porting the parser to WebAssembly?** Go compiles to WASM, which could allow running the parser client-side in the browser for instant preview without a round-trip to the server. This is a significant UX improvement but requires careful consideration of binary size (~5-10 MB WASM module).

6. **What about the `Parallel.ForEach` in batch matching?** Go's goroutines are a natural replacement, but the concurrency model is different. Should the batch endpoint use a worker pool with a bounded number of goroutines, or spawn one goroutine per text (matching the current unbounded parallel behavior)?

---

## Search Queries Executed

1. `Go vs .NET developer experience comparison 2025 2026 microservice regex parsing`
2. `Go static binary Docker image size comparison .NET aspnet alpine 2025`
3. `Go startup time memory footprint vs .NET 8 minimal API benchmarks`
4. `Radarr Sonarr Prowlarr parser release title parsing .NET implementation`
5. `Go regex engine limitations no lookahead RE2 vs .NET System.Text.RegularExpressions`
6. `Go release title parser media torrent scene naming github`
7. `.NET to Go rewrite experience microservice lessons learned 2024 2025`
8. `self-hosted media server community Go language preferences Docker deployment simplicity`
9. `TRaSH Guides custom formats parsing release title quality determination regex`
10. `Go IDE support VS Code gopls GoLand debugging experience 2025`
11. `Go cross-compilation CGO_ENABLED build multiple platforms simplicity`
12. `Profilarr Recyclarr Notifiarr arr ecosystem tools language choice Python Go`
13. `Go regexp2 dlclark .NET regex engine port performance benchmarks lookahead lookbehind`
14. `.NET 8 aspnet alpine docker image size megabytes 2025`
15. `Radarr parser.cs source code regex NzbDrone.Core github`
16. `Configarr programming language TypeScript github raydak-labs`
17. `Profilarr programming language github Dictionarry-Hub`
18. `Go net/http microservice HTTP server performance chi gin minimal simple`
19. `Go regexp2 named groups lookbehind backreference performance vs standard regexp benchmark`

---

## Uncertainties and Gaps

1. **regexp2 behavioral parity with .NET for these specific patterns**: While regexp2 is a port of .NET's regex engine, no public test suite validates the exact regex patterns used in the praxrr/Radarr parser. This is the highest-risk unknown.

2. **Exact Docker image sizes for the Go parser**: The 5-15 MB estimate is based on general Go microservice data, not a built praxrr parser binary. The actual size depends on the number of compiled regex patterns and embedded data.

3. **regexp2cg availability and maturity**: The code generation tool is mentioned in regexp2's documentation but its production readiness and maintenance status are unclear.

4. **Community reception**: No data exists on how the \*arr community would receive a Go-based parser in a .NET-dominated ecosystem. This could affect contributor recruitment.

5. **Specific performance benchmarks**: No .NET-vs-regexp2 benchmark exists for the specific regex patterns in this parser. The "comparable performance" assessment is based on architectural analysis, not measurement.

6. **No documented .NET-to-Go rewrites in media server space**: Despite searching, no public case studies of media server tools rewriting from .NET to Go were found. Notifiarr was written in Go from the start, not rewritten.
