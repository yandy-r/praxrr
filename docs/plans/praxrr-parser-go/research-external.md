# External API Research: Go Parser Migration

Research date: 2026-07-10\
Scope: GitHub issues [#1](https://github.com/yandy-r/praxrr/issues/1) through
[#5](https://github.com/yandy-r/praxrr/issues/5)

## Executive Summary

The migration can use the Go standard library for HTTP, JSON, lifecycle,
testing, fuzzing, and cross-compilation. The one necessary runtime dependency is
[`github.com/dlclark/regexp2/v2`](https://github.com/dlclark/regexp2): the
current parser relies on .NET-only lookbehind, atomic groups, named/repeated
captures, and backtracking that Go's RE2-based standard `regexp` cannot execute
unchanged.

Recommendations:

- Build with **Go 1.26.5** (current patch release); use a `go 1.25.0` module
  directive if no 1.26-only API is needed, matching regexp2/v2's minimum.
- Pin **`github.com/dlclark/regexp2/v2 v2.3.0`**. Treat upgrades as parser
  behavior changes and rerun the full .NET-vs-Go fixture corpus.
- Use regexp2's native API, not `regexp2/v2/compat`; the adapter panics on match
  timeout and backtracking-stack errors that this service must convert to
  `false`.
- Use default .NET mode plus only the original flags (`IgnoreCase`,
  `IgnorePatternWhitespace`). Do **not** enable `regexp2.RE2`, which changes
  `\d`, `\s`, `\w`, `$`, and escape behavior.
- Preserve the 100 ms `/match` and `/match/batch` timeout. Static domain regexes
  currently have no timeout. regexp2/v2 also has a 100,000-slot default
  backtracking-stack limit; strict parity points to
  `OptionMaxBacktrackingStackSize(-1)`, subject to adversarial resource tests.
- Compare decoded JSON structurally, plus separate assertions for status,
  headers, field presence, null vs empty arrays, and Unicode escaping. Object
  member order is not a portable API contract.

Primary sources: [Go releases](https://go.dev/doc/devel/release),
[Go 1.26 notes](https://go.dev/doc/go1.26),
[regexp2 v2.3.0 README](https://github.com/dlclark/regexp2/blob/v2.3.0/README.md),
[regexp2 API](https://pkg.go.dev/github.com/dlclark/regexp2/v2),
[`net/http`](https://pkg.go.dev/net/http), and
[`encoding/json`](https://pkg.go.dev/encoding/json).

## Primary APIs and Dependencies

### Toolchain

| Item              | Version    | Compatibility                                                                      |
| ----------------- | ---------- | ---------------------------------------------------------------------------------- |
| Go toolchain      | 1.26.5     | Current supported patch on 2026-07-10; Go 1 compatibility applies.                 |
| `go` directive    | 1.25.0     | regexp2/v2 minimum; builds with current 1.26.x.                                    |
| Dependency system | Go modules | Commit `go.mod` and `go.sum`; see the [modules reference](https://go.dev/ref/mod). |

Go 1.26's `go mod init` defaults new modules to Go 1.25.0. Pin full patch
versions in CI and Docker, not `latest`; minor Go releases include security and
`net/http` fixes.

### regexp2/v2

| API/option                       | Required use                       | Parity impact                                                 |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `Compile` / `MustCompile`        | Dynamic / static patterns          | Never `MustCompile` request data.                             |
| default engine mode              | All parser patterns                | Targets .NET syntax.                                          |
| `IgnoreCase`                     | Original case-insensitive patterns | Unicode/culture edges still need fixtures.                    |
| `IgnorePatternWhitespace`        | Original free-spacing patterns     | Direct behavioral mapping.                                    |
| `MatchTimeout`                   | 100 ms for match endpoints         | Default is effectively forever; timeout is approximate.       |
| `OptionMaxBacktrackingStackSize` | Explicit policy                    | v2.3 defaults to 100,000 slots, unlike the old domain parser. |
| `GroupByName`, `Group.Captures`  | Episode/season extraction          | Retains all repeated .NET captures.                           |
| `Replace`, `ReplaceFunc`         | Cleanup/substitution               | Both can return match errors.                                 |

`*regexp2.Regexp` is safe across goroutines. Internally it operates on runes; v2
exposes `RuneIndex`/`RuneLength` and `ByteRange()`. Prefer capture `String()`
values because .NET indices are UTF-16 code units. The maintainer explicitly
flags supplementary Unicode and right-to-left matching as risk areas. Timed
matches use a shared clock (normally about 100 ms granularity); tests that
verify goroutine cleanup should call `regexp2.StopTimeoutClock()`.
`SetTimeoutCheckPeriod` is not thread-safe and may only run before timed matches
start.

### Standard library APIs

| Package             | Purpose                                        | Official URL                               |
| ------------------- | ---------------------------------------------- | ------------------------------------------ |
| `net/http`          | exact routes, server limits/timeouts, shutdown | https://pkg.go.dev/net/http                |
| `encoding/json`     | request/response contract                      | https://pkg.go.dev/encoding/json           |
| `os/signal`         | SIGINT/SIGTERM lifecycle                       | https://pkg.go.dev/os/signal#NotifyContext |
| `net/http/httptest` | handler and real-listener tests                | https://pkg.go.dev/net/http/httptest       |
| `testing`           | unit, golden, fuzz, benchmarks                 | https://pkg.go.dev/testing                 |
| `errors`            | classify regexp2 sentinel errors               | https://pkg.go.dev/errors#Is               |
| `log/slog`          | optional dependency-free structured logs       | https://pkg.go.dev/log/slog                |

## Libraries and SDKs

Only regexp2/v2 is required outside the standard library. It is pure Go,
enabling static Linux and Windows cross-builds.

```go
module github.com/yandy-r/praxrr/packages/praxrr-parser

go 1.25.0

require github.com/dlclark/regexp2/v2 v2.3.0
```

Run `go mod tidy` and `go mod verify`. Do not initially add:

- a router/framework: three POST routes and one GET fit `http.ServeMux`, and
  framework defaults make ASP.NET error/JSON parity less visible;
- `regexp2/v2/compat`: its no-error signatures panic on timeout/stack errors;
- `regexp2cg`: upstream claims 3-10x hot-path improvements, but generation adds
  a parity/build surface; benchmark it only after the interpreted port is green;
- third-party golden/assertion packages: standard `testing` and `encoding/json`
  are sufficient and keep null/zero/missing distinctions explicit.

## Integration Patterns

### Regex wrapper and error policy

Centralize option mapping and safety behavior. Static developer-owned patterns
may fail fast; dynamic patterns compile to `false` on invalid input.

```go
func compileStatic(pattern string, options regexp2.RegexOptions) *regexp2.Regexp {
	return regexp2.MustCompile(pattern, options, regexp2.OptionMaxBacktrackingStackSize(-1))
}

func compileUser(pattern string) (*regexp2.Regexp, error) {
	re, err := regexp2.Compile(
		pattern,
		regexp2.IgnoreCase,
		regexp2.OptionMaxBacktrackingStackSize(-1),
	)
	if err != nil {
		return nil, err
	}
	re.MatchTimeout = 100 * time.Millisecond
	return re, nil
}

func isMatch(re *regexp2.Regexp, text string) bool {
	ok, err := re.MatchString(text)
	if err != nil { // invalid is caught at compile; timeout/stack/engine error => current false contract
		return false
	}
	return ok
}
```

Disabling the stack limit most closely models .NET's endpoint (100 ms time
bound, no independent stack ceiling) and static parsers (no timeout/ceiling). If
retained for safety, document it as a behavior deviation: some patterns can
return `false` before the reference timeout.

### Captures, multiple matches, and replacement

`Group.String()` is the last capture, like .NET `Group.Value`; episode logic
must consume every `Group.Captures` entry. Implement `.NET Regex.Matches` with
`FindStringMatch` then `FindNextMatch`.

```go
m, err := re.FindStringMatch(title)
for m != nil && err == nil {
	if group := m.GroupByName("episode"); group != nil {
		for _, capture := range group.Captures {
			episodes = append(episodes, capture.String())
		}
	}
	m, err = re.FindNextMatch(m)
}

renamed, err := re.Replace(input, "$1 AKA $2", 0, -1)
cleaned, err := extensionRE.ReplaceFunc(input, func(m regexp2.Match) string {
	ext := strings.ToLower(m.String())
	if videoExtensions[ext] || usenetExtensions[ext] { return "" }
	return m.String()
}, 0, -1)
```

Never discard replacement errors. `RegexOptions.Compiled` needs no semantic
mapping; it is a .NET execution optimization.

### Explicit HTTP/JSON contract

Register exactly `POST /parse`, `POST /match`, `POST /match/batch`, and
`GET /health` on a private `ServeMux`. Probe the reference for wrong
methods/paths, malformed or empty JSON, `null`, unknown fields, duplicate keys,
and trailing JSON before freezing Go errors.

```go
type parseRequest struct {
	Title string  `json:"title"`
	Type  *string `json:"type"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	// Do not DisallowUnknownFields unless the ASP.NET reference does.
	if err := dec.Decode(dst); err != nil { return err }
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		return errors.New("body must contain one JSON value")
	}
	return nil
}
```

Parity rules:

- Explicitly tag camelCase fields. Avoid `omitempty`: current responses always
  include nullable fields, zero values, booleans, and arrays.
- Initialize slices as empty, not nil; nil marshals as `null`, whereas
  `languages`, `movieTitles`, and episode number lists require `[]`.
- `encoding/json` ignores unknown object members and accepts case-insensitive
  field matches by default, closer to ASP.NET web defaults than
  `DisallowUnknownFields`.
- JSON object order is not a contract. Go encoding sorts string map keys;
  compare `/match` results structurally. If raw order is proven necessary, use
  an ordered custom encoder.
- Go and .NET default encoders differ in Unicode/HTML escaping. Raw fixtures
  must cover non-ASCII, `<`, `>`, `&`, U+2028/U+2029, and supplementary
  characters.
- Do not assume `strings.TrimSpace` exactly equals
  `.NET string.IsNullOrWhiteSpace` across Unicode versions; add whitespace
  fixtures.
- Preserve current validation texts exactly (`Title is required`, the
  movie/series type message, `Text is required`, and both
  `At least one ... is required` messages).

### Batch concurrency

Precompile patterns once and share compiled regexes across workers. Keep each
text's result map local and send it to a single collector; ordinary Go maps
cannot be written concurrently. Bound workers to prevent request-sized goroutine
growth. Add fixtures for duplicate texts/patterns: the object-keyed schema
collapses duplicates, so winner behavior must match the reference rather than
redesigning the API.

### Server lifecycle

Use `http.Server` rather than bare `ListenAndServe`; official docs recommend the
custom server when timeouts and limits matter.

```go
srv := &http.Server{
	Addr: net.JoinHostPort(host, port), Handler: mux,
	ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
	WriteTimeout: 35 * time.Second, IdleTimeout: 60 * time.Second,
	MaxHeaderBytes: 1 << 20,
}

ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
go func() {
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
}()
```

Windows signal behavior differs; smoke-test actual child termination. Either
temporarily parse `ASPNETCORE_URLS` or update `spawn.ts`, Deno tasks, Docker,
Compose, CI, and release workflows atomically to a native host/port contract.

### Tests and delivery

Test three boundaries: pure typed parser goldens; differential regex
matches/groups/all captures and replacements; HTTP handler/network contracts
with `httptest.NewRecorder` and `NewServer`.

```sh
go test ./...
go test -race ./...
go test -fuzz=FuzzMatchParity -fuzztime=60s ./internal/regexutil
go vet ./...
go mod verify
```

The [race detector](https://go.dev/doc/articles/race_detector) observes only
executed paths, requires cgo and a C compiler, and is expensive; run it as a
native CI job. Go [fuzzing](https://go.dev/doc/security/fuzz/) runs seeds under
normal `go test` and mutations with `-fuzz`. Fixture metadata should record
reference .NET runtime, culture, parser commit, Go version, and regexp2 version.
Separately verify required JSON field presence because missing numbers decode to
the same Go zero as present zero.

Pure-Go release builds:

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' \
	-o ../../dist/parser-out/praxrr-parser ./cmd/parser
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w' \
	-o ../../dist/parser-out-win/praxrr-parser.exe ./cmd/parser
```

Use a pinned Go builder image and a non-root minimal runtime. If Docker health
still invokes `wget`, the runtime must contain it; alternatively add a parser
healthcheck subcommand. Preserve port 5000. `/health.version` is an application
cache key and must change whenever parsing behavior changes; linker injection is
suitable if local builds have a deterministic fallback.

## Constraints and Gotchas

- .NET-vs-Go UTF-16/rune and culture-sensitive `IgnoreCase` differences need
  Turkish-I, supplementary Unicode, and case-fold fixtures.
- Timeout is approximate and the shared timeout-clock goroutine can outlive a
  test briefly.
- Invalid compile, timeout, stack limit, and engine defect all yield public
  `false`, but internal logs/metrics should distinguish them without leaking
  untrusted patterns.
- A request-body cap is useful hardening but may be a visible change; set it
  above measured legitimate batches and capture the reference's effective
  boundary first.
- Server write timeout must exceed valid work and align with the app client's
  30-second timeout.
- Map iteration is unspecified; never derive precedence from it.
- regexp2/v2 requires Go 1.25; older distro toolchains cannot build it.
- `go test -race` cannot validate `CGO_ENABLED=0` cross-artifacts. Run both race
  and cross-build jobs.
- Smoke-test Linux/Windows binary naming, startup, health, and shutdown.
- Cutover spans `Dockerfile.parser`, Compose, Deno tasks, `spawn.ts`, Actions,
  and release staging; switch only after the parity gate and retain the prior
  .NET artifact/image as rollback.

## Open Questions

1. Which .NET patch, OS, culture/globalization mode, parser commit, and
   appsettings version define the authoritative golden baseline?
2. Is HTTP parity structural or byte-for-byte? Byte parity additionally fixes
   object order, newline, Unicode escaping, and framework-generated error
   bodies.
3. Should v2's backtracking stack limit be disabled everywhere, or is a measured
   ceiling an approved security deviation?
4. What request-body, text, pattern, and batch limits are legitimate?
5. How should internal metrics classify invalid, timeout, stack-limit, and
   engine errors?
6. Is transitional `ASPNETCORE_URLS` support required for rollback, or will
   every launcher change in the same cutover?
7. What is the authoritative parser version source, and what behavior changes
   increment it?
8. Are case-insensitive JSON names and unknown members part of the compatibility
   contract?
9. Does any consumer depend on match-result member order?
10. Should `regexp2cg` remain a later benchmark-driven optimization issue?
