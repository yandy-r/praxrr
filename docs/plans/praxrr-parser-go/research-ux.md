# UX Research: Go Parser Migration

## Executive Summary

The Go parser migration should be deliberately invisible to end users and
operationally boring for administrators. Issues #1-#5 replace an optional .NET
sidecar/adjacent binary with a Go service, but explicitly exclude an API
redesign and SvelteKit application refactor. The UX success condition is
therefore not a new interface: existing release titles must produce the same
parsed metadata, custom-format decisions, and scores; existing parser-dependent
screens must keep their current healthy, loading, partial, unavailable, and
recovered behavior; and existing Docker and standalone installations must
require no configuration migration.

The parser is nevertheless user-visible through its consequences. It powers
custom-format test results, quality-profile entity testing, the score simulator,
and release-scoring portions of the impact simulator. A parity defect can look
like a product decision rather than a service defect: a release may silently
change quality, language, episode identity, custom-format matches, or score.
That makes golden behavioral comparison and cross-runtime differential testing
UX safeguards, not only implementation tests.

The current interface already has useful degraded behavior. Score and impact
simulators poll for recovery every three seconds while unavailable, show
persistent warnings, preserve non-parser results where possible, and expose
loading state. Custom-format testing explains that pass/fail cannot be
evaluated, and entity testing warns that scoring is disabled. These behaviors
should be retained through the cutover. The migration should improve only the
fidelity of state communication: distinguish service unavailability from an
unrecognized title, keep stale results visually distinct from current results,
announce asynchronous status changes to assistive technology, and make recovery
automatic without stealing focus or discarding input.

For operators, preserve `PARSER_HOST`, `PARSER_PORT`, port `5000`, the
`parser`/`parser-dev` Compose service names, the
`praxrr-parser`/`praxrr-parser.exe` adjacent filenames, the parser image name,
and the minimal `GET /health` contract. Use comparable startup, request,
timeout, and shutdown logs so an operator can diagnose the new runtime with the
same mental model. Health must be cheap and truthful: “process alive” and “ready
to accept parser traffic” are different concepts even if the initial deployment
maps both to the existing endpoint.

## Research Scope and Current Experience

This research covers the headless parser migration and its human-facing edges.
It does not propose a new parser administration page, new API fields, or changes
to parser semantics.

Authoritative current touchpoints include:

- `packages/praxrr-parser/Endpoints/{Health,Parse,Match}Endpoints.cs`: service
  validation, response, timeout, and health behavior.
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts`: 30-second
  HTTP timeout, two retries, version-aware parse caching, match caching, batch
  behavior, and graceful failure.
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`: standalone binary
  discovery, free-port selection, ten-second startup wait, prefixed child
  output, and parent/child lifecycle.
- `packages/praxrr-app/src/routes/score-simulator/[databaseId]/`: a 300 ms
  single-input debounce, explicit batch action, 15-second browser request
  timeout, loading overlays, persistent outage warning, and three-second
  recovery polling.
- `packages/praxrr-app/src/routes/impact-simulator/[databaseId]/`: release-score
  degradation while config diff and cascade results remain usable, plus the same
  recovery polling pattern.
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/testing/`: an
  inline explanation that pass/fail cannot be evaluated while the parser is
  unavailable.
- `packages/praxrr-app/src/routes/quality-profiles/entity-testing/[databaseId]/`:
  lazy evaluation, row-level loading, and a persistent parser-unavailable alert.
- `compose.yml`, `compose.dev.yml`, `Dockerfile.parser`, `deno.json`,
  `scripts/dev.ts`, and release workflows: the current operator and contributor
  contract.

## Users and Jobs to Be Done

### Configuration author

The author enters representative movie, series, or anime release titles and
expects the same parsed metadata and regex matches used by Arr. Their core need
is confidence: a green test after the runtime switch must mean the same thing it
meant before the switch.

### Profile designer

The designer compares scoring across titles, profiles, and proposed changes.
They need prompt results, clear loading state, preserved inputs during failure,
and an unmistakable distinction between “no custom format matched,” “the title
was not recognized,” and “the parser service was unavailable.”

### Praxrr operator

The operator runs Docker Compose or a standalone archive. They need a drop-in
upgrade, a simple health signal, searchable logs, a non-zero exit on fatal
startup failure, graceful termination, and enough version/build identity to
determine which parser is actually running.

### Contributor and release maintainer

The contributor needs a short local feedback loop without a separately installed
.NET SDK. The release maintainer needs deterministic Go artifacts for every
supported platform, archive-level checks for the adjacent binary, and an
explicit parity gate before deleting the .NET oracle.

## User Workflows

### Workflow 1: Single-release score simulation

1. The user chooses movie, series, or anime context and a quality profile.
2. Title input is debounced for 300 ms; a new request cancels the previous
   request.
3. The UI shows `Simulating...` while preserving the prior layout.
4. A healthy parser returns metadata and match results, which become score
   output.
5. A domain miss is shown as “Parser could not parse this release title”; it is
   not a service outage.
6. An outage sets `parserAvailable: false`, shows a persistent warning, and
   starts recovery polling.

Migration requirement: Go output must not make an existing title transition
between success and domain miss or change its displayed metadata/score. A
superseded request must never overwrite the newer title's result.

Recovery requirement: retain title, media type, profile, comparison, and
overrides. When health returns, remove the unavailable state and either re-run
the current simulation automatically once or offer a clearly labeled retry.
Automatic retry is preferred because current pages already poll for recovery; it
must be deduplicated to avoid a request storm.

### Workflow 2: Batch and impact simulation

1. The user supplies up to 50 release titles and explicitly starts the batch, or
   supplies titles, profiles, and proposed changes for impact analysis.
2. Cached titles resolve quickly; uncached titles are parsed and matched
   concurrently.
3. Loading feedback remains visible for cold batches, and cancellation prevents
   stale completion.
4. Impact analysis continues to show config diff and cascade results when
   parser-backed release scoring is unavailable.

Migration requirement: do not trade parity for apparent speed. Preserve input
order in user-facing results even if Go evaluates requests concurrently. Do not
expose response-map iteration order as batch ordering.

Recovery requirement: partial cached match data must not be presented as a
complete current batch. If partial display is supported, label it with exact
coverage (for example, “18 of 50 titles evaluated; parser unavailable for 32”)
and provide one retry for missing items after recovery. Otherwise retain the
current all-or-unavailable presentation.

### Workflow 3: Custom-format and entity testing

1. The user opens saved release fixtures and expects pass/fail evaluation.
2. Entity rows fetch evaluations lazily on expansion and display a row-level
   loading state.
3. Invalid or timed-out individual regexes resolve to `false` without failing
   valid sibling patterns.
4. A service outage disables evaluation while leaving fixture creation and
   editing available.

Migration requirement: invalid regex and timeout results must remain isolated
Booleans; they must not become generic request errors or indefinite spinners.
Exact .NET-compatible matching is required because a runtime difference is
displayed as an authoring error.

Recovery requirement: expanded rows that failed due to outage must be retryable.
Do not permanently mark them “fetched” with empty results. Preserve the
distinction between expected non-match, invalid pattern, timeout, unrecognized
release, and service failure in logs even if the public Boolean API must remain
unchanged.

### Workflow 4: Standalone startup and shutdown

1. Praxrr discovers `praxrr-parser` or `praxrr-parser.exe` beside itself when no
   external host is configured.
2. It chooses a free loopback port, starts the child, prefixes child output with
   `[parser]`, sets the host/port environment, and polls health for up to ten
   seconds.
3. The main app continues in degraded mode if the binary is absent or fails to
   become healthy.
4. Parent shutdown terminates the child; unexpected child exit is logged.

Migration requirement: the Go binary must accept an explicit listen address/port
through a clear, tested launch contract. Remove ASP.NET environment names
internally without creating a new user configuration step. Keep loopback binding
for auto-spawn so the helper is not unintentionally network-exposed.

Recovery requirement: log the binary path, selected port, parser version,
readiness duration, exit code, and whether degraded startup was caused by
missing artifact, spawn failure, readiness timeout, or later process death.
Never log release titles at health-check frequency.

### Workflow 5: Docker deployment and upgrade

1. Compose starts the parser service on internal port 5000.
2. Its health check gates the Praxrr dependency.
3. Praxrr connects using the existing service name and environment variables.
4. During a rolling/restart upgrade, callers retry transient failures and
   screens degrade without blocking unrelated work.

Migration requirement: retain image, service, host, port, non-root execution,
timezone, and health contracts. Kubernetes' official probe guidance
distinguishes startup, liveness, and readiness and warns that poorly chosen
liveness checks can amplify overload; it also recommends dedicated health
endpoints with minimal bodies. Even if Praxrr currently uses Compose, applying
that model makes the container safe for common orchestrators: a startup probe
allows initialization, readiness controls traffic, and liveness detects a truly
stuck process
([Kubernetes probe guidance](https://kubernetes.io/docs/concepts/workloads/pods/probes/)).

Recovery requirement: a version switch must invalidate parser-result caches
intentionally. During the transition, operators should be able to identify
runtime and version from `/health` and startup logs without opening the image.

### Workflow 6: Contributor and release workflow

1. A contributor starts the parser alone or with the Vite app using existing
   Deno task names.
2. Go tests run locally and in CI; a differential suite runs the same fixtures
   against .NET and Go before oracle retirement.
3. Container and release workflows build the same image/archive surfaces.
4. Archive smoke tests start the staged parser and call health plus
   representative parse/match requests.

Migration requirement: preserve task intent and output prefixes while replacing
the underlying command. A missing Go toolchain should produce a direct
prerequisite message, not silently skip parser-backed tests in CI.

## UI/UX and Observability Best Practices

### Preserve a simple availability model at the public boundary

The existing app API exposes `{ parserAvailable: boolean }`; do not expand it
merely because the runtime changed. Internally, however, model enough states to
prevent misleading UI and logs:

`unknown -> starting -> healthy -> degraded/unavailable -> recovering -> healthy`.

The UI can continue to render mostly a Boolean, but transitions should be
intentional. A failed health fetch must set unavailable rather than leave a
stale `true`, and successful recovery should remove persistent warnings exactly
once.

### Keep messages actionable and scoped

- Service outage: “Parser service unavailable. Release scoring is paused; your
  input is preserved. Praxrr will retry automatically.”
- Domain miss: “This release title was not recognized. Check the title and
  selected media type.”
- Request timeout: “Simulation timed out after 15 seconds. Retry; if this
  continues, check parser health.”
- Invalid request: identify the invalid field and accepted values.
- Partial impact result: name what is still valid (“Config diff and cascade
  results are still available”) rather than describing the entire page as
  failed.

Do not tell browser users to “start the microservice” unless the installation
mode is known. That instruction is correct for contributors but not necessarily
for Docker or auto-spawn users.

### Make logs stable across runtimes

Operators should not have to learn a completely different log vocabulary at
cutover. Emit structured events with stable fields where available:

- startup: runtime, parser version, build commit, listen address, environment,
  readiness duration;
- request completion: route, status, duration, request counts (texts/patterns),
  timeout count, invalid pattern count, but not full release titles or regex
  bodies at normal log levels;
- degraded state: connection refused, deadline exceeded, malformed upstream
  response, child exit;
- shutdown: signal, drain start, drain completion, forced termination if
  applicable;
- parity/CI: fixture corpus version and zero/non-zero semantic diff count.

Health probes should be debug-level or excluded from normal request logs to
avoid drowning the events that explain an outage. Preserve `[parser]` prefixing
for auto-spawned output and the current source categories (`Startup`, `Health`,
`Parse`, `Match`, `ParserClient`, `ParserCache`) where useful.

### Use bounded, correlated timing

The browser simulator times out after 15 seconds while the server-side parser
client is configured for a 30-second attempt with retries. That can leave
backend work running after the user has already seen cancellation. The migration
should measure and align budgets so each outer timeout is longer than its inner
work, or explicitly propagate cancellation. Logs should carry a
request/correlation ID across the SvelteKit route and Go parser so “spinner
stopped” can be connected to backend work.

### Avoid sensitive or high-cardinality telemetry

Release titles and user-authored regexes can contain private media names or
identifiers. Prefer lengths, counts, hashes, route names, duration buckets, and
error categories. Full inputs belong only in deliberately enabled diagnostic
logging with clear documentation.

## Error, Loading, and Recovery States

| State                  | User-facing behavior                                                                  | Operator evidence                                          | Recovery                                             |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| Healthy, idle          | Normal inputs/actions; no parser badge needed                                         | One startup-ready event; quiet probes                      | None                                                 |
| Starting               | Preserve page/input; short neutral “Parser starting…” only if a request depends on it | Spawn/container start plus readiness duration              | Poll with bounded backoff; transition without reload |
| Single request loading | Keep current layout, show text plus spinner, cancel superseded request                | Route duration and cancellation                            | Latest request wins                                  |
| Cold batch loading     | Explicit progress language; do not imply exact percent without server progress        | Text/pattern counts and cache-hit count                    | Cancel safely; allow retry                           |
| Domain miss            | Explain title not recognized; metadata/matching unavailable for that item             | Parse outcome category, not HTTP error                     | User edits title/type                                |
| Invalid pattern        | Preserve sibling results; avoid generic service failure                               | Invalid-pattern count and safe pattern fingerprint         | User edits pattern                                   |
| Regex timeout          | Treat as non-match per contract; never hang the page                                  | Timeout count and duration                                 | User simplifies pattern; service remains healthy     |
| Parser unavailable     | Persistent inline warning near affected controls; retain unrelated results/input      | Connection/deadline/exit category and last healthy version | Poll; remove warning and re-run once                 |
| Browser/API timeout    | Stop spinner, preserve last confirmed result but mark it stale                        | Correlated cancellation/deadline event                     | Manual retry; health link/check                      |
| Partial cached batch   | Either suppress as incomplete or state exact evaluated/missing counts                 | Cache hits, uncached count, upstream failure               | Retry missing items after recovery                   |
| Version change         | No alarming user message unless work is delayed; never mix old/new parse results      | Old/new version and cache invalidation count               | Recompute on demand                                  |
| Shutdown/drain         | In-flight callers receive bounded failure, never an indefinite wait                   | Signal, drain duration, forced-exit flag                   | Orchestrator restarts or upgrade completes           |

Loading indicators must include text, not just an animated icon. Preserve
previous confirmed results during a refresh only when they are clearly marked as
previous/stale; otherwise clear them so users do not attribute old metadata to a
new title.

## Performance UX

The migration goal includes lower resource use, but perceived performance is
defined by latency, predictability, and recovery as well as CPU/RAM.

### Measure before setting targets

Capture comparable .NET and Go baselines for:

- process startup to healthy;
- idle RSS and container/image size;
- warm and cold `/parse` p50/p95/p99;
- `/match` and `/match/batch` latency by text count, pattern count, and
  timeout-path count;
- score simulation for 1, 10, and 50 cold titles and the same fully cached
  batches;
- concurrency saturation, error rate, and graceful-shutdown drain time.

Use the existing 300 ms input debounce, 15-second browser timeout, ten-second
standalone readiness budget, 100 ms per regex match timeout, and 30-second
parser-client timeout/retry configuration as constraints to investigate, not
automatic performance targets. A Go build is not a UX improvement if a cold
50-title batch regresses or timeout handling consumes all workers.

### Recommended experience budgets

- Standalone parser should normally become healthy comfortably inside the
  existing ten-second wait; establish a measured p99 and alert well below the
  cutoff.
- Warm single-title responses should complete quickly enough that the 300 ms
  debounce, not parser latency, dominates ordinary interaction.
- A 50-title cold batch should finish well inside the 15-second outer timeout on
  supported baseline hardware, with no head-of-line blocking from one
  catastrophic regex.
- Health checks must remain constant-time and independent of request-queue
  saturation where possible, while readiness must fail if the process cannot
  accept useful work.
- Concurrency must be bounded. Unbounded goroutines around backtracking regex
  work can improve a microbenchmark while making overload recovery and UI
  latency worse.

Go profile-guided optimization may be considered only after parity and measured
need. The official Go guidance treats the profile as a reproducible build input,
which implies it should be versioned and representative rather than captured ad
hoc ([Go PGO guidance](https://go.dev/doc/pgo)).

## Competitive and Runtime-Migration Patterns

### Drop-in sidecar replacement

Mature infrastructure migrations preserve the caller contract and replace one
service instance at a time. Here that means stable host/port/paths, image and
executable names, response schema, health shape, and failure semantics. The
caller should not branch on “Go parser” versus “.NET parser.” This reduces
rollback to an artifact/image change rather than an application or data
migration.

### Golden master plus differential shadowing

The safest pattern for a parser/regex-engine rewrite is to treat the old
implementation as an oracle: capture a versioned corpus, run both
implementations against identical inputs, canonicalize only JSON object-member
ordering, and block cutover on semantic differences. Before retirement, CI
should also exercise shipped custom-format patterns and representative
user-style .NET constructs. Where local or staging shadow execution is
practical, compare results out of band and never let shadow output affect users.

### Compatibility facade

The Go service should adapt its native errors, JSON encoder defaults, timeout
behavior, and regex engine details behind the existing HTTP contract. Do not
push runtime differences into SvelteKit workarounds. The facade is especially
important for `null` versus omitted fields, enum spelling, array ordering,
invalid-regex isolation, and map key preservation.

### Expand-and-contract cutover

Add Go build/test/container/release paths while the .NET oracle still exists;
prove parity and artifact integration; switch the active runtime; observe; then
remove C#, .NET SDK layers, and stale documentation. Deleting the oracle before
the archive and UI workflows pass makes rollback and diagnosis needlessly
expensive.

### Minimal runtime surface

One small Go binary can remove the .NET runtime dependency and reduce
installation friction. Keep that advantage by avoiding a second control plane or
new mandatory configuration. The Go toolchain has reproducible-build support,
but release provenance still requires pinned modules, recorded build metadata,
checksums, and archive smoke tests
([Go reproducible toolchain background](https://go.dev/blog/rebuild)).

## Accessibility Considerations for Existing UI Feedback

The migration itself should not add visual complexity, but it is an opportunity
to ensure the existing dynamic parser states are perceivable without sight,
color, or mouse input.

1. **Announce status changes without moving focus.** WCAG 2.2 Success Criterion
   4.1.3 requires status messages to be programmatically determinable without
   receiving focus. Use an appropriate polite live region for `Simulating...`,
   parser recovery, and non-urgent availability changes; reserve `role="alert"`
   for failures that require immediate attention
   ([WCAG 2.2](https://www.w3.org/TR/WCAG22/#status-messages)).
2. **Do not rely on amber/red or icons alone.** Every outage, timeout, domain
   miss, and invalid input needs text. WCAG error identification requires the
   erroneous item and problem to be described in text, and known corrections
   should be suggested
   ([W3C error-identification guidance](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)).
3. **Associate input errors with controls.** For an invalid title/type or batch
   limit, use visible inline text, `aria-describedby`, and `aria-invalid` where
   applicable. A global toast alone is easy to miss and does not identify the
   affected field.
4. **Make availability warnings live when they change.** Static server-rendered
   warnings are readable, but a warning inserted after polling or a recovery
   message removed dynamically needs a live-region announcement. Avoid
   announcing every three-second poll; announce only state changes.
5. **Give spinners accessible names and honor reduced motion.** Decorative
   rotating icons should be hidden from accessibility APIs when adjacent text
   names the state. Animation should not be the only loading cue and should
   respect reduced-motion preferences.
6. **Preserve keyboard and focus context.** Automatic recovery/retry must not
   focus a banner, reset a textarea, collapse expanded entity rows, or replace
   the focused control. Any explicit Retry action must be a real button with a
   clear accessible name.
7. **Do not encode stale/partial state through opacity alone.** Add text such as
   “Previous result” or “18 of 50 evaluated,” and ensure contrast remains
   sufficient in light and dark modes.
8. **Avoid duplicate persistent announcements.** Several pages currently combine
   inline warnings and persistent alert-store messages. Expose one semantic
   alert per state transition so screen reader users do not hear the same outage
   multiple times.
9. **Review toast semantics.** Current alert components use `role="button"` so
   they can be dismissed, but do not expose a live status/alert role.
   Parser-related errors should be announced by the container or a dedicated
   live region, and dismissal should have an explicit accessible label instead
   of making the entire message an unnamed action.

Accessibility regression tests should cover initial unavailable rendering,
healthy-to-unavailable and unavailable-to-healthy transitions, loading
completion, timeout, domain miss, and partial batch feedback with keyboard-only
and screen-reader-oriented assertions.

## Prioritized Recommendations

### P0: Required for a safe cutover

1. Freeze a golden corpus from the .NET service and require zero semantic diffs
   for every parser domain and all four HTTP routes before Go becomes
   authoritative.
2. Preserve the entire operator contract: environment variables, service/image
   names, port 5000, adjacent binary names, route paths, JSON shapes, health
   version, exit behavior, and task intent.
3. Test every parser-dependent screen with the Go service in healthy,
   domain-miss, invalid-regex, timeout, startup-failure, mid-request outage, and
   recovery states.
4. Keep parser-dependent failure isolated. Custom-format fixtures remain
   editable; impact config diff/cascade stays available; unrelated Praxrr
   startup and navigation continue.
5. Change the parser version at cutover and prove cache invalidation so .NET and
   Go results are never mixed under one version namespace.
6. Bound regexp2 work and concurrency so catastrophic expressions become `false`
   within the contract rather than starving health checks or other users.
7. Retain the .NET oracle until Go containers and every supported standalone
   archive pass smoke, parity, startup, shutdown, and app integration tests.

### P1: Strongly recommended in the migration PR

1. Add structured, privacy-conscious startup/request/timeout/shutdown logs with
   version and build identity; suppress routine health-probe noise.
2. Align or propagate cancellation across the 15-second browser budget and
   30-second retrying parser client so abandoned UI work does not continue
   invisibly.
3. Make parser availability transitions announceable and actionable: preserve
   input, poll without repeated announcements, remove warnings on recovery, and
   re-run current work at most once.
4. Differentiate service outage, request timeout, and unrecognized title in UI
   copy and tests.
5. Add explicit progress text for cold batch work and preserve deterministic
   result ordering.
6. Separate readiness from fatal-process liveness internally, even if
   compatibility keeps `/health` as the only public route initially.
7. Measure .NET versus Go startup, RSS, artifact/image size, and representative
   latency before claiming the resource-reduction goal is met.

### P2: Follow-up improvements if scope is constrained

1. Add an operator-facing diagnostic surface that reports parser
   reachable/version/build/last error without exposing hostnames, release
   titles, or regex contents to ordinary users.
2. Improve alert infrastructure semantics so status and error notifications are
   announced and the dismiss action has an explicit accessible name.
3. Add exact partial-batch coverage and retry-missing behavior if partial cached
   results are retained.
4. Add opt-in metrics for request duration, regex timeout count, cache hit
   ratio, queue depth, and active work, with bounded-cardinality labels.
5. Consider PGO only after representative profiles show a meaningful user-facing
   improvement.

## Testable UX Acceptance Criteria

- For a fixed corpus, users see identical parsed metadata, pass/fail results,
  and scores before and after cutover.
- No Docker, standalone, or developer workflow requires a renamed variable,
  port, image, service, executable, or Deno task.
- Parser absence never prevents the main app from starting and never disables
  non-parser features.
- Every affected page identifies unavailable versus unrecognized versus
  timed-out states in text.
- User input, selection, expanded rows, and last confirmed results are not
  silently lost during an outage or automatic recovery.
- Loading ends for success, error, cancellation, and timeout; a superseded
  request cannot overwrite a newer result.
- Recovery is detected without a full page reload, announced once, and does not
  create duplicate requests or repeated toasts.
- Batch output remains in user input order regardless of concurrent Go
  execution.
- Screen-reader users receive loading completion, outage, recovery, and error
  status without focus theft; keyboard users can retry and dismiss feedback.
- Startup and request logs identify parser version/build and failure category
  without routinely logging raw titles or regexes.
- Comparable measurements demonstrate reduced runtime footprint with no material
  p95/p99 or batch completion regression.

## Open Questions

1. Does strict HTTP parity include ASP.NET-generated behavior for malformed
   JSON, missing bodies, wrong content types, and method errors, or only
   application-authored 200/400 bodies? These cases should be captured from the
   oracle before deciding.
2. What parser version is authoritative after cutover, and how will it relate to
   Praxrr application releases? The version must change at least once to
   invalidate existing parse caches.
3. Should automatic recovery re-run the current simulation, or merely re-enable
   an explicit Retry? Current polling suggests automatic retry, but the behavior
   should be consistent across score, impact, custom-format, and entity-testing
   pages.
4. Should cached results remain visible during an outage, and if so, how will
   the UI label their parser version and staleness? Current cache behavior
   differs between parse and match paths.
5. Is a rolling upgrade between separately deployed .NET and Go parser
   containers required, or is a restart-based drop-in replacement sufficient?
6. What measured resource and performance thresholds define success for issue #1
   (RSS, image size, startup, p95/p99 latency, 50-title batch duration)?
7. What is the supported request-size/concurrency envelope for `/match/batch`?
   The current API does not advertise limits, while regexp2 work can be
   expensive even with per-match timeouts.
8. How should Go match the .NET oracle's culture/time-zone-dependent casing and
   date boundaries? Release results must not vary between developer, container,
   and CI environments.
9. Should health expose build commit/runtime identity in the existing `version`
   string, or only in logs, to preserve exact response expectations?
10. Should readiness fail under overload/queue saturation, or only when the
    server cannot accept requests? This determines whether orchestrators shed
    traffic or restart a busy but healthy parser.
11. How long should graceful shutdown wait for active regex work before forcing
    exit, and what should callers receive during drain?
12. Are parser-related accessibility fixes to alert/live-region semantics in
    scope for the migration PR, or should they be recorded as a follow-up issue
    after preserving existing behavior?
