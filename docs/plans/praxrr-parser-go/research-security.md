# Security Research: Go Parser Migration

Research date: 2026-07-10\
Scope: GitHub issues [#1](https://github.com/yandy-r/praxrr/issues/1) through
[#5](https://github.com/yandy-r/praxrr/issues/5)

## Executive Summary

The parser is a small, stateless service, but it deliberately evaluates
.NET-compatible regular expressions supplied by callers. That makes
availability—not confidentiality or privilege escalation—the dominant risk.
`regexp2` is the correct compatibility choice, but it is a backtracking engine:
unlike Go's standard `regexp`, it can exhibit catastrophic backtracking.
Upstream therefore provides both an approximate match timeout and a bounded
backtracking stack.

The migration should preserve all supported API and regex results while adding a
clearly defined resource envelope. Normal requests must remain byte/structure
compatible with the .NET oracle. Oversized or adversarial requests cannot remain
unlimited merely for parity; their rejection must be treated as an intentional
security boundary, characterized against the oracle, documented, and covered by
contract tests. The app client can transparently chunk legitimate work that
exceeds a single-request work budget and merge the maps without changing
user-visible results.

There are two release blockers:

1. Every `regexp2` operation reachable from untrusted input—including static
   title-parser patterns and replacements—must have a bounded stack, a match
   timeout, and checked errors.
2. `/match/batch` must have bounded body size, element sizes, work product,
   request concurrency, and worker concurrency. A per-match timeout alone does
   not bound `texts × patterns` work.

The current deployment already has useful controls: Compose uses `expose` rather
than a host port, and the parser image runs as a non-root user. The Go cutover
must retain those properties, default standalone binding to loopback, remove
request contents from ordinary logs, and produce pinned, scanned, attestable
artifacts.

## Sources and Current-State Evidence

Primary external guidance:

- [`regexp2/v2` v2.3.0 README](https://github.com/dlclark/regexp2/blob/v2.3.0/README.md),
  [API documentation](https://pkg.go.dev/github.com/dlclark/regexp2/v2), and
  [MIT license](https://github.com/dlclark/regexp2/blob/v2.3.0/LICENSE)
- [Go security best practices](https://go.dev/doc/security/best-practices),
  [vulnerability management](https://go.dev/doc/security/vuln/), and
  [fuzzing guidance](https://go.dev/doc/security/fuzz/)
- [`net/http.Server`](https://pkg.go.dev/net/http#Server) and
  [`http.MaxBytesReader`](https://pkg.go.dev/net/http#MaxBytesReader)
- [Go module authentication](https://go.dev/ref/mod#authenticating)
- [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
  and
  [GitHub Actions secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use)

Repository evidence:

- The legacy
  [`MatchEndpoints.cs`](../../../packages/praxrr-parser/Endpoints/MatchEndpoints.cs)
  gives user patterns a 100 ms timeout, returns `false` on invalid/timeout, and
  uses `Parallel.ForEach` for batch texts without request cardinality limits.
- Static patterns in [`Parsers/`](../../../packages/praxrr-parser/Parsers) do
  not set .NET regex timeouts.
  [`ParseEndpoints.cs`](../../../packages/praxrr-parser/Endpoints/ParseEndpoints.cs)
  logs full release titles, and match failures log full patterns.
- [`Program.cs`](../../../packages/praxrr-parser/Program.cs) uses framework
  defaults and defines no body, header, connection, or server timeouts.
- [`compose.yml`](../../../compose.yml) keeps port 5000 inside the Compose
  network, while the usage comment in
  [`Dockerfile.parser`](../../../Dockerfile.parser) demonstrates a published
  host port (`docker run -p 5000:5000`). That makes the unauthenticated service
  reachable on every host interface unless the operator supplies a loopback host
  address.
- [`client.ts`](../../../packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts)
  uses a 30 s timeout and two retries, sends the complete uncached batch in one
  request, and performs no chunking. The legacy regex101 route makes direct
  parser fetches without an abort timeout.
- Docker publishing already creates a build-provenance attestation. Release
  archives do not have an equivalent provenance/checksum gate. Workflow actions
  and base images are tag-pinned rather than digest/SHA-pinned.

As observed on 2026-07-10, `regexp2` v2.3.0 is an active, non-archived MIT
repository, but maintenance is highly concentrated in one contributor and
releases are tags rather than GitHub Releases. This is a manageable dependency
risk, not a reason to substitute Go RE2 and lose required semantics.

## Threat Model

### Assets and security properties

- **Availability:** the parser, the Praxrr app that waits on it, and the host
  CPU/memory/process budget must survive malicious patterns, titles, bodies, and
  connection behavior.
- **Integrity:** parser output must retain .NET-compatible ordering, captures,
  enum strings, null/empty behavior, timeout-as-`false` behavior, and
  duplicate-key overwrite behavior.
- **Confidentiality:** release titles and custom regexes can reveal media
  libraries and private naming rules. They must not leak through logs, crash
  output, telemetry, or unintended network exposure.
- **Supply-chain integrity:** the Go toolchain, `regexp2`, container bases,
  Actions, and release archives must be attributable to pinned inputs.

### Trust boundaries and actors

1. An authenticated or unauthenticated app user can indirectly cause `/parse`
   and `/match/batch` work through entity-testing, simulation, and regex101
   flows. Authentication on the main app does not make its content
   computationally safe.
2. Any peer that can reach port 5000 can call the parser directly; the parser
   has no authentication or TLS. In default Compose this is other containers on
   the network. With a published host port it may include the LAN or Internet.
3. PCD/regex101 content is third-party-controlled data and can contain
   adversarial expressions even when the HTTP caller itself is trusted.
4. A compromised dependency, image, or CI action can affect all published parser
   binaries and images.

The parser needs no database, filesystem writes, outbound network, credentials,
or privileged OS capabilities. Granting any of those expands the threat surface
without feature value.

## Findings by Severity

### SEC-01 — CRITICAL: catastrophic backtracking is reachable in dynamic and static regex paths

`regexp2` explicitly supports constructs that can catastrophically backtrack.
Its default timeout is effectively disabled. v2.3.0 bounds the per-match
interpreter stack to 100,000 integer slots, but that limit does not bound total
time or all memory. `MatchTimeout` is approximate and checked by a shared clock
updated about every 100 ms.

Required mitigation:

- Pin `github.com/dlclark/regexp2/v2 v2.3.0` and use its native error-returning
  API, never `regexp2/v2/compat` for request work.
- Preserve the legacy 100 ms timeout for `/match` and `/match/batch`; set it
  before a compiled regex is shared and never mutate it concurrently. Invalid
  pattern, timeout, and `ErrBacktrackingStackLimit` all map to the existing
  `false` result.
- Apply a finite timeout to every static parser match, next-match iteration,
  split, and replacement. Replacement and iteration errors must be checked
  rather than discarded. Choose the smallest static timeout that passes the full
  parity corpus and adversarial benchmarks; 250 ms per regex operation is a
  conservative starting point, not a final value.
- Retain the 100,000-slot default backtracking limit initially. Do **not** use
  `OptionMaxBacktrackingStackSize(-1)` in the network service. If a real parity
  fixture exceeds the default, raise the limit only to a measured finite value
  and document the fixture.
- Treat the timeout clock's granularity as part of capacity planning. Test
  elapsed upper bounds under load; do not assume a configured 100 ms timeout
  means 100 ms wall time. Use `StopTimeoutClock()` in test teardown when
  checking goroutine leaks. Do not change `SetTimeoutCheckPeriod` after matching
  begins.

Parity impact: ordinary and golden-corpus inputs are unchanged. A stack/timeout
failure on a previously unbounded adversarial static match is an intentional
availability hardening deviation and must fail closed to the same absent/default
parser fields, not panic or return implementation detail.

### SEC-02 — CRITICAL: unbounded batch work can bypass per-match protection

The legacy batch cost is approximately `len(texts) × len(unique(patterns))`,
plus compilation and a response map of similar size. Thousands of individually
bounded matches can still monopolize CPU for minutes, retain regexp runner
stacks, and allocate a very large JSON response. Concurrent HTTP requests
multiply this cost. The app's automatic retries can repeat expensive work.

Required mitigation:

- Enforce limits on decoded body bytes, UTF-8 bytes/runes per
  title/text/pattern, number of texts, number of patterns, unique keys, and the
  `uniqueTexts × uniquePatterns` work product.
- Use a bounded worker pool and a global request/work semaphore. A safe initial
  ceiling is at most `min(GOMAXPROCS, 8)` regex workers and at most that many
  active expensive requests; lower it after memory/load tests. Never spawn a
  goroutine per cell.
- Compile each unique pattern once per request, set its timeout before
  publication, keep result maps worker-local, and merge through one owner. Do
  not add an unbounded global cache for attacker-chosen patterns.
- Make overload fail quickly with a stable 429/503 policy and `Retry-After`; the
  app client must not blindly retry non-transient limit rejections.
- Add caller-side chunking by both item count and work product, then merge
  response maps. This preserves legitimate user-visible results while bounding
  each parser request.

Provisional starting limits for measurement are: 1 MiB JSON body, 16 KiB release
title/text, 32 KiB pattern, 256 unique texts, 256 unique patterns, and 2,048
text-pattern cells. These are security defaults to validate against real PCD
maxima, not arbitrary final contract values. If supported data exceeds one
request, chunk it; do not simply remove the bound.

### SEC-03 — WARNING: the HTTP server needs explicit connection, header, body, and handler budgets

`http.ListenAndServe`/a zero-value `http.Server` has no read, write, or idle
deadlines. Slow headers, slow bodies, oversized JSON, and stalled clients can
consume sockets and goroutines. Go documents `MaxBytesReader` specifically for
preventing large request resource waste.

Required mitigation:

- Construct `http.Server` explicitly. Starting values: `ReadHeaderTimeout` 5 s,
  `ReadTimeout` 15 s, `WriteTimeout` 30 s, `IdleTimeout` 60 s, and
  `MaxHeaderBytes` 32 KiB. Align the write/request budget below the app client's
  30 s timeout after load testing so callers do not abandon still-running work.
- Wrap every JSON body with `http.MaxBytesReader` before decoding; close it,
  reject trailing JSON, and classify over-limit errors without returning decoder
  internals.
- Use a request-scoped deadline and graceful `Server.Shutdown`. A handler
  timeout alone does not stop regexp computation, so regex and work limits
  remain mandatory.
- Add panic recovery at the outer handler boundary, log only a request ID/error
  class, and return the oracle-compatible generic 5xx shape. Static regex
  compilation should fail startup/tests, while request regex compilation must
  never use `MustCompile`.

Contract tests must freeze malformed, empty, null, wrong-type, duplicate-key,
trailing-value, unsupported-method, media-type, and over-limit behavior. Do not
leak Go decoder errors merely because ASP.NET previously generated a different
framework response.

### SEC-04 — WARNING: an unauthenticated plaintext parser becomes unsafe when published externally

No endpoint authenticates; responses echo titles/pattern keys; expensive
endpoints accept arbitrary regexes. This is acceptable only as a loopback or
private service-network component. Adding a new mandatory auth header would
break standalone health checks and current callers, so network confinement is
the parity-preserving control.

Required mitigation:

- Default the standalone Go process to `127.0.0.1:5000`. Require an explicit
  `PARSER_ADDR=:5000` in the parser container. Continue accepting the temporary
  legacy `ASPNETCORE_URLS` input only during cutover, validating it strictly
  rather than accepting arbitrary URL schemes.
- Keep Compose on `expose`, not `ports`; remove/document the unsafe
  `docker run -p 5000:5000` example or change it to `-p 127.0.0.1:5000:5000`.
- Do not add CORS. Do not advertise parser routes through the app reverse proxy
  or tsdproxy.
- For an intentional cross-host deployment, require a private network or a
  sidecar/reverse proxy providing TLS plus service authentication. Never send
  parser credentials in request bodies or logs.
- Keep `/health` minimal (`status`, required version) and unauthenticated for
  current probes; it must not expose runtime, dependency, environment, host, or
  build-path details.

### SEC-05 — WARNING: current logs disclose release titles and regular expressions

Release titles describe a user's library; regexes may be proprietary
configuration. The .NET parser logs full titles on successful parse and full
patterns on invalid/timeout paths. Container logs can be retained or forwarded
far beyond the service lifetime.

Required mitigation:

- Log route, outcome, latency bucket, counts, sizes, timeout/stack/compile
  classification, and an opaque request ID. Do not log raw title, text, regex,
  request/response body, query, or headers.
- Keep verbose content logging off by default. If a temporary diagnostic mode is
  indispensable, make it explicit, prominently warn that it is sensitive,
  truncate/sanitize values, and never enable it in CI fixtures or published
  containers.
- Ensure panic/error logs do not include regexp text returned by compilation
  errors. Return only the established API errors/`false`, not engine messages or
  stack traces.

API parity is unaffected; logging text is not part of the HTTP contract.

### Dependency Security

#### SEC-06 — WARNING: dependency concentration and behavior-sensitive upgrades need governance

`regexp2` is pure Go, actively maintained, and MIT-licensed, but contributor
history shows a strong single-maintainer concentration. It is also deliberately
behavior-sensitive: an upgrade can change captures, Unicode, timeout, memory, or
replacement behavior without an API compilation failure.

Required mitigation:

- Commit `go.mod` and `go.sum`; keep the public checksum database enabled; run
  `go mod verify`; use `-mod=readonly` in CI/release builds; prohibit unreviewed
  `replace` directives and branch or pseudo-version dependencies.
- Make regexp2 upgrades dedicated reviewed changes. Require full golden parity,
  adversarial regex, race, fuzz-seed, memory, and timeout tests before merging.
- Add `govulncheck ./...` to CI and scan the produced binary, not only source
  imports. Keep the Go patch release current because Go point releases carry
  security fixes.
- Maintain a contingency note: if upstream becomes unmaintained, first
  audit/vendor the pinned source or adopt a reviewed fork. Do not silently
  switch to RE2 or enable regexp2 `RE2` mode; both change required .NET
  behavior.

#### SEC-07 — WARNING: current build inputs are mutable and release archives lack equivalent provenance

Go modules authenticate source, but mutable container tags and `uses: ...@vN`
Actions remain supply chain inputs. Docker's guidance recommends digest pinning
for reproducibility; GitHub states that a full commit SHA is the immutable way
to reference an Action.

Required mitigation:

- Pin the full Go patch version and both builder/runtime images by digest. Use a
  minimal runtime and an update bot/process that opens reviewed digest bumps so
  security updates are not frozen forever.
- Pin third-party and first-party Actions to verified full commit SHAs,
  retaining version comments for maintainability.
- Build with `CGO_ENABLED=0`, `-trimpath`, `-mod=readonly`, and an explicit
  deterministic version value. Build the same commit twice in clean environments
  and compare per-platform SHA-256 before claiming reproducibility.
- Generate an SBOM and provenance for parser images and release binaries;
  publish SHA-256 checksums for archives. Preserve the existing least-privilege
  workflow permissions and ensure PR builds cannot publish packages or
  attestations.
- Run `go test ./...`, `go test -race ./...` on a supported native platform,
  `go vet ./...`, `govulncheck ./...`, and cross-build gates before publishing.

### SEC-08 — WARNING: container cutover can regress existing least privilege

The .NET parser image already runs as UID/GID 1000. A Go binary needs no shell,
package manager, writable application directory, root user, Linux capabilities,
or outbound access.

Required mitigation:

- Use a multi-stage build and copy only the parser binary plus any genuinely
  required CA/time-zone data into a digest-pinned minimal runtime. Run as a
  fixed numeric non-root UID/GID.
- Provide a parser-binary `healthcheck` subcommand so the runtime need not
  include `wget`/`curl` or a shell. The subcommand must have a short client
  timeout and only contact loopback.
- In Compose enable a read-only root filesystem, drop all capabilities, set
  `no-new-privileges`, and define explicit CPU/memory/PID limits appropriate to
  supported batch benchmarks. Do not mount the Docker socket, source tree, or
  app configuration into the parser.
- Verify graceful SIGTERM and that no crash/core dump or temporary fixture is
  written. If time-zone data affects the current-year parser boundary, embed/pin
  it and add New Year boundary fixtures rather than making the filesystem
  writable.

### SEC-09 — ADVISORY: licensing is compatible but notices and inventory must follow the binary

`regexp2` v2.3.0 uses the permissive MIT license; Praxrr is AGPL-3.0. The
dependency does not create a copyleft conflict, but its copyright/permission
notice must accompany substantial copies.

Required mitigation:

- Record regexp2 and its MIT notice in the repository's third-party notice/SBOM
  process and include it with release archives/images as required by the
  project's distribution policy.
- Keep the Praxrr OCI license label as `AGPL-3.0`; do not relabel the combined
  artifact as MIT.
- Re-run license and dependency inventory on every module change.

### SEC-10 — ADVISORY: echoed inputs and in-memory handling require bounded, non-persistent treatment

The API intentionally echoes the release title and uses regex strings/texts as
JSON object keys. That is required parity, not an injection flaw: Go's JSON
encoder escapes them as data. It does, however, amplify response memory and
makes generic access logging sensitive.

Required mitigation:

- Always serialize through `encoding/json`; never concatenate JSON or log lines
  from request data.
- Do not persist request data, write temporary files, emit telemetry, or add an
  on-disk regex cache.
- Bound response-producing key sizes and cell counts under SEC-02. Keep
  `Content-Type` exact and add `X-Content-Type-Options: nosniff` if
  oracle/header compatibility permits.
- Avoid compression on this tiny internal service unless measured; compression
  adds CPU and can make reflected-data behavior harder to reason about.

## Verification Gates

The feature is not security-complete until all gates are automated or have
captured evidence:

1. **Parity gate:** golden .NET-vs-Go fixtures pass for all normal endpoints,
   invalid regexes, timeout regexes, Unicode/capture/replacement edges,
   duplicate patterns/texts, and framework error cases. Security caps are tested
   separately and documented as deliberate boundary behavior.
2. **Adversarial regex gate:** nested quantifiers, ambiguous alternation,
   lookbehind/backreference, zero-width repetition, huge captures, invalid
   syntax, replacement loops, and known timeout patterns never panic; they
   return the required default/`false` within a measured wall ceiling.
3. **Resource gate:** maximum allowed single and batch requests run under
   concurrent load with recorded p95/p99 latency, peak RSS, goroutine count,
   allocations, and CPU. One-over-limit cases reject before regex evaluation.
   Ten concurrent over-limit clients cannot starve `/health`.
4. **HTTP gate:** slow headers/body, body over limit, header over limit, client
   disconnect, half-closed connection, trailing JSON, wrong types, unsupported
   methods, and shutdown during work release connections/goroutines. Run with
   the race detector.
5. **Fuzz gate:** seed native Go fuzzers with the golden/adversarial corpus for
   JSON decoding, regex utility functions, each domain parser, and handlers. CI
   runs seeds every change; a scheduled job runs time-bounded fuzzing and
   preserves minimized regressions.
6. **Exposure gate:** container inspection proves non-root UID, no published
   parser port by default, read-only operation, zero capabilities, no
   secrets/mounts, and loopback default outside the container. A remote host
   cannot reach port 5000 in the supported Compose topology.
7. **Supply-chain gate:** `go mod verify`, `govulncheck`, SBOM/license scan,
   pinned-action check, pinned-base check, image scan, provenance, archive
   checksums, and clean-environment rebuild all pass. `go version -m` identifies
   the expected toolchain/module version in each binary.
8. **Logging gate:** success, malformed JSON, invalid pattern, timeout, panic
   recovery, and shutdown logs contain no supplied title, text, regex, body,
   auth header, stack trace, or local build path.
9. **Caller gate:** the main client chunks above-budget legitimate workloads,
   merges maps exactly, uses bounded timeouts, does not retry 4xx/limit
   responses, and the regex101 direct fetch gains an abort deadline. End-to-end
   simulation/entity-testing results remain unchanged.

## Open Questions Requiring Design Decisions

1. What are the observed maximum text count, unique pattern count, pattern byte
   length, and work product in real Praxrr databases? Final caps and chunk sizes
   must be based on this evidence.
2. Does the team accept finite static-parser timeouts and a bounded regexp2
   stack as the explicit security exception to pathological legacy parity? The
   security recommendation is yes; shipping an unbounded network path is not
   acceptable.
3. What exact status/body/header should represent 413 body limits, 429
   concurrency overload, and work-product rejection? These cases need oracle
   characterization plus a documented intentional deviation where the oracle has
   no safe bound.
4. Should expensive-request concurrency be fixed, derived from `GOMAXPROCS`, or
   configurable? Any environment override needs a safe maximum and startup
   validation.
5. Is cross-host parser deployment officially supported? If yes, which component
   owns mTLS/service authentication? The parser should remain private by default
   either way.
6. Is raw response-byte parity required for Unicode/HTML escaping, or only
   decoded JSON plus pinned headers? This affects encoder hardening but not the
   no-concatenation requirement.
7. Which runtime image family is approved, and does the episode parser require
   embedded time-zone data for exact year-boundary behavior on all release
   platforms?
8. What existing project mechanism should publish third-party notices, SBOMs,
   release checksums, and non-container provenance so the parser does not create
   a parallel process?

## Security Recommendation

Proceed with Go and regexp2/v2 v2.3.0. Make the regex wrapper and
resource-budget middleware foundational work in issue #2, not a late hardening
pass. Treat finite regex limits, bounded batch work, private binding, sanitized
logs, explicit HTTP deadlines, and reproducible scanned artifacts as acceptance
criteria across issues #2–#5. The migration is safe when strict parity is
demonstrated inside the supported envelope and adversarial inputs are proven to
fail closed outside it.
