# Business Logic Research: Go Parser Migration

## Executive Summary

GitHub issue #1 is a tracking issue whose deliverable is the combined completion
of child issues #2-#5: establish a parity baseline, port every parser domain,
reproduce the HTTP service contract, and cut all development, container, CI,
release, and standalone integrations over from .NET to Go. The intended
user-visible change is operational only: lower resource usage and removal of the
.NET runtime dependency. Release parsing, custom-format evaluation, score
simulation, health reporting, cache invalidation, error handling, and degraded
behavior must not change.

The current .NET service is therefore the behavioral oracle, including its
intentional defaults and its observable quirks. “Feature-equivalent” means the
same accepted requests, HTTP statuses, JSON shape and values, ordered arrays,
nullable/default fields, regex decisions, timeout behavior, and parser outcomes
for the same input. JSON object-member order is not semantically meaningful, but
duplicate input keys that collapse into result maps and the order of arrays are
meaningful. The Go implementation must use a .NET-compatible regex engine
(`regexp2`) because user-authored custom format expressions are expected to
behave like Arr/.NET expressions, not like Go's standard RE2 engine.

This migration is safe only if golden fixtures are captured from the running
.NET oracle before it is removed. Those fixtures must cover normal scene
releases, anime, daily and mini-series releases, invalid/unrecognized titles,
every exposed enum/default, adversarial regexes, invalid regexes, and timeouts.
The final cutover must retain the service address (`PARSER_HOST`/`PARSER_PORT`,
port 5000), endpoint paths, adjacent standalone binary names, version-based
cache invalidation, and graceful degradation when the optional parser is
unavailable.

## User Stories

1. As a Praxrr user testing a custom format, I want the same release title to
   produce the same parsed fields and condition matches after the Go cutover so
   that an existing test cannot silently change from pass to fail or vice versa.
2. As a user simulating or validating a quality profile, I want movie and series
   releases to retain the same quality, resolution, language, release-group,
   movie, episode, and revision interpretation so that computed scores do not
   drift.
3. As a user importing regex101 tests or authoring Arr-style regex conditions, I
   want .NET-compatible case-insensitive regex semantics, including lookarounds,
   named groups, backreferences, and inline option behavior, so that expressions
   do not need to be rewritten for Go.
4. As a user running Praxrr without the optional parser, I want linking,
   editing, syncing, and other non-parser features to continue while
   parser-dependent results are clearly unavailable/unknown.
5. As a standalone-install user, I want the bundled parser to start
   automatically beside the Praxrr binary on a free local port with no new
   configuration.
6. As a Docker operator, I want the existing parser hostname, port, health
   check, image name, and compose dependency to continue working without a
   configuration migration.
7. As a maintainer, I want one executable parity suite that compares the old and
   new services and prevents future regex or parser drift before the .NET oracle
   is retired.
8. As a release operator, I want every currently supported release platform to
   contain a correctly named parser binary and CI/container builds to stop
   requiring .NET after parity is proven.

## Business Rules and Edge Cases

### Contract-wide parity rules

- The externally supported routes remain `GET /health`, `POST /parse`,
  `POST /match`, and `POST /match/batch`; no version prefix or redirect is
  introduced.
- Successful bodies remain JSON with camel-cased property names. Nullable values
  remain explicit JSON `null`, numeric defaults remain zero, Boolean defaults
  remain `false`, and collection defaults remain empty arrays/maps rather than
  being omitted.
- Request validation remains strict at the application level:
  - `/parse` rejects a null, empty, or whitespace-only title with status 400 and
    `{ "error": "Title is required" }`.
  - `/parse` accepts only the exact lower-case type `movie` or `series`;
    missing, blank, differently cased, or other values return status 400 and
    `{ "error": "Type is required and must be 'movie' or 'series'" }`.
  - `/match` rejects blank text with `{ "error": "Text is required" }`, then
    rejects a null or empty pattern list with
    `{ "error": "At least one pattern is required" }`.
  - `/match/batch` rejects a null or empty text list with
    `{ "error": "At least one text is required" }`, then rejects a null or empty
    pattern list with `{ "error": "At least one pattern is required" }`.
- Framework-level behavior for malformed JSON, wrong JSON types, absent bodies,
  wrong HTTP methods, and unsupported content types is part of “strict API
  parity” unless explicitly excluded before implementation. It must be captured
  as HTTP oracle fixtures rather than guessed.
- Raw release titles are echoed unchanged in `ParseResponse.title`.
  Normalization is internal and must not change the echoed request value.
- Domain recognition failure is not an HTTP failure. A valid movie request can
  return empty movie titles and default movie metadata; a valid series request
  can return `episode: null`, both with 200.
- Map-shaped results use the original pattern and text strings as keys.
  Duplicate patterns collapse to one result key; duplicate batch texts collapse
  to one text key. Golden comparison must canonicalize object-member ordering
  while preserving exact keys and values.
- All exposed names are contract identifiers and retain their current
  spelling/case. Sources are `Unknown`, `Cam`, `Telesync`, `Telecine`,
  `Workprint`, `DVD`, `TV`, `WebDL`, `WebRip`, `Bluray`; modifiers are `None`,
  `Regional`, `Screener`, `RawHD`, `BRDisk`, `Remux`; episode release types are
  `Unknown`, `SingleEpisode`, `MultiEpisode`, `SeasonPack`; language names are
  the current 59 enum names from `Unknown` through `Original`.

### Regex matching

- User patterns are always evaluated case-insensitively, even when the caller
  provides no flags. Inline pattern options and .NET constructs must retain
  their current effects.
- Each pattern/text match has a 100 ms timeout. A timeout is a non-match
  (`false`), not an HTTP error.
- An invalid pattern is a non-match (`false`) for that pattern while other
  patterns still run.
- `/match` evaluates each pattern against one text. `/match/batch` applies every
  unique pattern to every unique text and returns the full nested Boolean map.
- Batch compilation is an optimization only; it must not alter the result
  compared with repeated `/match` requests.
- Regex behavior must be parity-tested for Unicode and ASCII casing, anchors,
  multiline text, lookahead/lookbehind, named and numbered captures,
  backreferences, alternation, repeated captures, balancing/atomic constructs
  used by the shipped parsers, inline case modifiers, invalid syntax,
  catastrophic backtracking, empty patterns, and empty batch text elements.
- The current business promise is .NET/Arr compatibility, not merely “accepted
  by regexp2.” Any regexp2/.NET difference must be normalized or explicitly
  rejected as a migration blocker.

### Shared title normalization

- Only recognized video/Usenet suffixes are stripped, case-insensitively:
  `.mkv`, `.mp4`, `.avi`, `.wmv`, `.mov`, `.m4v`, `.mpg`, `.mpeg`, `.m2ts`,
  `.ts`, `.flv`, `.webm`, `.vob`, `.ogv`, `.divx`, `.xvid`, `.3gp`, `.asf`,
  `.rm`, `.rmvb`, `.iso`, `.img`, `.par2`, and `.nzb`. An arbitrary final
  `.<2-4 alphanumerics>` suffix is preserved.
- Full-width brackets `【】` normalize to `[]` for movie/episode parsing.
  Recognized website prefixes, website postfixes, and torrent suffixes `[ettv]`,
  `[rartv]`, `[rarbg]`, `[cttv]`, and `[publichd]` are removed exactly as today.
- Inputs containing both `password` and `yenc` (case-insensitive), inputs with
  no alphanumeric character, and known hash/obfuscation-only names are rejected
  by movie/episode parsing.
- Known reversed-title markers trigger reversal of the extension-free title
  before parsing. This unusual behavior is part of parity and requires fixtures.

### Quality and revision parsing

- Every valid parse request receives a quality result. The default is source
  `Unknown`, resolution `0`, modifier `None`, and revision
  `{ version: 1, real: 0, isRepack: false }`.
- Resolution recognition retains the current token aliases for 360, 480, 540,
  576, 720, 1080, and 2160. Source-specific fallback resolutions remain
  unchanged: Blu-ray/anime WEB commonly default to 720 when absent;
  WEB-DL/WEBRip/BDRip/BRRip default to 480; DVD, regional, and screener
  force 480.
- Source/modifier precedence is observable: RawHD can terminate parsing before
  source assignment; Blu-ray disc detection wins over remux; legacy Xvid/DivX
  Blu-ray forces 480; HDTV with MPEG-2 is `TV` + `RawHD`; a remux with a
  recognized resolution can imply `Bluray` + `Remux`; otherwise an unrecognized
  source remains `Unknown` even when some other metadata was found.
- `proper`, `repack`, `rerip`, explicit `vN`, `repackN`, and `reripN` keep the
  existing revision arithmetic. A proper/repack without an explicit version
  becomes version 2; with an explicit version it increments that version once.
  Repack/rerip sets `isRepack: true`.
- `real` counts case-sensitive uppercase `REAL` matches in the original,
  non-normalized title.

### Language and release-group parsing

- Language detection combines the existing full-word/sub-string vocabulary,
  case-sensitive short codes, and case-insensitive aliases. It returns the
  first-seen order with later duplicates removed. The exact ordering is
  significant because it is serialized as an array.
- If no language is recognized, the result is exactly `["Unknown"]`.
- The existing German-only rules remain: a sole German result plus `DL` adds
  `Original`; a sole German result plus `ML` adds `Original` and `English`.
  Existing detection-order/duplicate quirks that determine whether German is
  “sole” must be represented in fixtures rather than cleaned up.
- Release group recognition strips supported extensions and known site/torrent
  adornments, then uses this precedence: leading anime subgroup; last exact
  exception group; last bracket/parenthesis exception group; last standard
  `-group` candidate.
- Purely numeric groups, season/episode-like groups, and eight-character hex
  hashes are rejected. The explicit current exception-group vocabulary is
  contract data and must be carried over intact.

### Movie parsing

- Movie parsing uses the first successful parser pattern in the existing ordered
  pattern set. Later patterns are fallbacks, not competing interpretations.
- The response preserves one primary movie title plus `AKA`, `A.K.A.`, slash, or
  bracketed AKA alternatives in current order. Empty alternatives are dropped;
  existing equality filtering and acronym/dot handling remain unchanged.
- Year defaults to `0`. Edition, IMDb id, hardcoded-subtitle label, release
  hash, and release group default to `null`; TMDB id defaults to `0`; movie
  titles default to `[]`.
- IMDb identifiers accept the existing `tt` plus seven/eight digit forms; TMDB
  identifiers accept `tmdb-<digits>` and `tmdbid-<digits>`. Invalid or
  overflowing TMDB values produce `0`.
- Edition text preserves its matched wording with dots converted to spaces.
  Hardcoded subtitle aliases preserve the matched token, while generic
  `HC`/`SUBBED` becomes `Generic Hardcoded Subs`. The last hardcoded-subtitle
  match wins.
- A captured eight-character hash is returned without brackets except the
  resolution token `1280x720`, which is not a release hash.
- Any internal movie parsing exception is converted to a domain miss/default
  response, not surfaced to the HTTP caller.

### Episode parsing

- Episode parsing uses the first successful pattern from the current ordered
  grammar. It covers daily dates, repeated/multi-episode forms, split episodes,
  `SxxEyy`, `x` notation, anime absolute numbers, multi/partial/full season
  packs, mini-series parts, air dates, and specials.
- Episode ranges expand inclusively from the first capture through the last.
  Descending ranges are rejected as an unrecognized episode (`episode: null`).
  Multi-season packs expose the first season number and set
  `isMultiSeason: true`.
- With episode numbers but no captured season, season defaults to 1 and
  `isMiniSeries` becomes true. A result with more than one regular or absolute
  episode is `MultiEpisode`; exactly one is `SingleEpisode`; no episodes plus
  `fullSeason` is `SeasonPack`; all other results are `Unknown`.
- Integer absolute ranges expand inclusively. Decimal absolute numbers identify
  a special and do not populate the integer absolute-number array.
- A season with no episode is full-season unless it is a partial-season or
  special form. If the raw release title contains `Special`, an otherwise
  full-season result changes to `special: true` and `fullSeason: false`.
- Daily dates are returned as `yyyy-MM-dd`. An ambiguous month/day form is
  rejected when both values are 12 or less; a captured month greater than 12
  swaps with the day. Invalid calendar dates, dates before 1970-01-01, and dates
  after tomorrow are rejected. The reference clock/time zone therefore affects
  boundary cases and needs an explicit parity test strategy.
- Internal fields such as season extras, split episode, season part, and daily
  part affect parsing decisions but are not added to the HTTP response. The Go
  migration must not expand the contract.
- Any internal episode parsing exception is converted to `episode: null`.

### Health, availability, and cache behavior

- `/health` returns status 200 and
  `{ "status": "healthy", "version": "<parser version>" }`. Version is
  behaviorally significant: parsed-release cache entries are keyed by parser
  version, and a new version invalidates old results.
- App-level `/api/v1/parser/health` continues to expose only
  `{ parserAvailable: boolean }`; reaching the parser health route means true,
  and connection/request failure means false.
- Parsed-release cache identity remains `title:type` plus parser version.
  Matching cache identity remains release text plus a hash of the sorted
  patterns; pattern order does not invalidate cache.
- When the parser is unavailable, cached batch matches may still be returned,
  uncached parse results become null, and parser-dependent screens/results
  become unavailable or `unknown`. Non-parser product behavior continues.
- Parser request failures are logged but do not turn optional-parser downtime
  into application startup failure or unrelated feature failure.

## Workflows, Including Recovery

### Parse and evaluate a release

1. The app checks parser health/version.
2. It looks up the parsed-release cache using exact title, media type, and
   parser version.
3. On a miss, it posts the exact title and `movie`/`series` type to `/parse`.
4. The service independently derives quality/revision, languages, and release
   group, then selects the movie or episode grammar and returns one complete
   response object.
5. The app converts string enum names to its numeric TypeScript enums, stores
   the result, obtains pattern matches (often through `/match/batch`), and
   evaluates custom-format/profile conditions.
6. The UI presents pass/fail, parsed information, and scores.

Recovery: if health/version or parsing fails, the caller returns null/unknown
and warns that parser evaluation is unavailable. The user can
restart/reconfigure the parser and retry; version-aware cache behavior prevents
a recovered/new parser from serving stale parsed results.

### Match regex tests

1. The caller sends one text or a text batch with one or more patterns.
2. The service validates non-empty request collections.
3. Every pattern is compiled/evaluated with case-insensitive .NET-compatible
   semantics and a 100 ms per-match timeout.
4. Each text/pattern pair receives a Boolean. Invalid or timed-out patterns
   become false locally; valid sibling patterns still return normally.
5. Regex101 tests compare the Boolean with `DOES_MATCH`/`DOES_NOT_MATCH`;
   entity/score evaluation feeds the maps into custom-format condition logic.

Recovery: a bad pattern does not poison the request and can be corrected by the
user. Service unavailability leaves regex101 test result fields unset or
parser-driven evaluation unavailable; cached match results may allow partial
batch progress.

### Standalone startup

1. Before configuration initializes, Praxrr checks whether it is outside Docker,
   `PARSER_HOST` is unset, and `praxrr-parser` or `praxrr-parser.exe` exists
   beside the main executable.
2. It chooses a free local port, starts the adjacent parser, sets
   `PARSER_HOST=localhost` and the selected `PARSER_PORT`, and polls `/health`
   for up to 10 seconds.
3. On success the app uses the parser normally and terminates it with the parent
   process.

Recovery: a missing binary skips auto-spawn. A slow/failed child logs an error
and the app continues in degraded mode. An unexpected parser exit is logged;
restarting the whole standalone app or configuring an external parser restores
the service. The Go binary must accept the launch contract used by `spawn.ts`
after its .NET-specific environment variables are replaced.

### Docker and release cutover

1. Docker builds and publishes the existing `praxrr-parser` image, exposes
   internal port 5000, runs as a non-root user, and reports health through
   `/health`.
2. Compose connects Praxrr with `PARSER_HOST=parser` (or `parser-dev`) and
   `PARSER_PORT=5000`.
3. Tagged releases build parser binaries for Linux x64/arm64, macOS x64/arm64,
   and Windows x64 and stage them as `praxrr-parser`/`praxrr-parser.exe` beside
   the Praxrr executable.
4. Only after parity, integration, image, and release-archive tests pass is the
   .NET source/runtime removed.

Recovery: retain an explicit pre-retirement parity checkpoint so failure can be
resolved before the oracle disappears. A cutover failure is corrected by
rebuilding the Go artifact/image while leaving the app's hostname, port, binary
name, and public contract unchanged; it must not require user data or
configuration migration.

## Domain Model and State Transitions

### Core domain objects

- **Parse request:** exact raw title + media type (`movie` or `series`).
- **Quality:** source + numeric resolution + modifier + revision.
- **Revision:** version (default 1) + uppercase `REAL` count + repack flag.
- **Language set:** ordered, distinct language identifiers; never empty
  (`Unknown` fallback).
- **Movie identity:** ordered titles, year, edition, IMDb/TMDB ids, hardcoded
  subs, release hash.
- **Episode identity:** series title, season, regular and absolute episode
  ranges, air date, pack and special flags, and derived release type.
- **Release group:** nullable exact group label derived from ordered detection
  rules.
- **Match matrix:** original text keys mapped to original pattern keys mapped to
  Booleans.
- **Parser version:** opaque health value and parsed-result cache namespace.

### Parse state transition

`Received` -> `Rejected` when request validation fails. Otherwise `Received` ->
`Quality/language/group
derived` -> `Movie grammar` or `Episode grammar` ->
`Recognized` or `Domain miss` -> `HTTP 200`. Internal grammar exceptions
transition to `Domain miss`, not `HTTP error`. A recognized response may still
contain individual unknown/default fields.

### Pattern state transition

`Received` -> `Rejected` for an empty request-level text/pattern collection. For
each pair: `Uncompiled` -> `Invalid(false)` or `Compiled` -> `Matched(true)`,
`Not matched(false)`, or `Timed out(false)`. Pair failures are isolated and the
request still transitions to `HTTP 200`.

### Availability state transition

`Not configured/missing` -> `Unavailable`; or `Binary found` -> `Starting` ->
`Healthy`. A startup timeout or process exit transitions to `Unavailable`
without stopping Praxrr. A later reachable health check transitions the app view
back to `Available`. Parser-dependent UX transitions among `Evaluated`,
`Unknown/unavailable`, and `Evaluated after retry`; unrelated UX remains
operational.

### Cache state transition

`Lookup` -> `Hit` -> `Return`; or `Miss` -> `Parser request` -> `Store` ->
`Return`. Parser failure transitions a parse miss to `Null/unknown`. A parser
version change makes prior parsed entries stale and eligible for cleanup. For
batch matching, cached texts transition directly to results while uncached texts
may either be fetched/stored or remain absent if the parser is unavailable.

## Existing Codebase Integration

- `packages/praxrr-parser/Program.cs` defines configuration, logging startup,
  route registration, and the current version default (`1.0.0`).
- `packages/praxrr-parser/Endpoints/{Health,Parse,Match}Endpoints.cs` are the
  authoritative HTTP behavior and validation oracle.
- `packages/praxrr-parser/Models/*.cs` and
  `packages/praxrr-app/src/lib/server/utils/arr/parser/types.ts` jointly define
  the serialized and consumer-side contracts. Enum spelling and numeric mappings
  must stay synchronized.
- `packages/praxrr-parser/Parsers/*.cs` and `Parsers/Common/*.cs` contain the
  ordered domain rules, normalization vocabulary, exception lists, and
  failure-to-null behavior that golden fixtures must freeze before retirement.
- `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts` owns URL
  calls, timeout/retry policy, version caching, parsed-result caching, match
  caching, enum translation, batch behavior, and graceful failure.
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts` owns
  adjacent-binary discovery, auto-selected port startup, health polling, log
  streaming, and child lifecycle for standalone distributions. Go cutover must
  remove ASP.NET-specific launch variables without changing the user-visible
  spawn behavior.
- `packages/praxrr-app/src/hooks.server.ts` requires auto-spawn to run before
  normal config loading.
- Parser output and match maps feed custom-format testing, entity testing,
  score/impact simulation, quality-profile evaluation, and regex101 test
  execution. The central batch evaluation route is
  `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`.
- The app-facing health contract is documented under
  `docs/api/v1/paths/system.yaml` and generated into
  `packages/praxrr-app/src/lib/api/v1.d.ts`; it remains unchanged by the service
  rewrite.
- `deno.json`, `scripts/dev.ts`, `Dockerfile.parser`, `compose.yml`, and
  `compose.dev.yml` currently encode .NET launch/build assumptions and must
  preserve their user-facing task, port, image, and service behavior while
  switching toolchains.
- `.github/workflows/docker.yml`, `.github/workflows/release.yml`, and
  `.github/workflows/compatibility.yml` define affected build/change-detection
  paths. Release archives currently promise parser binaries on five
  platform/architecture combinations.
- Contributor, architecture, installation, Docker, configuration, development,
  and troubleshooting docs currently describe the parser as optional .NET/C#
  infrastructure and must describe the same optional behavior with Go after
  cutover.
- `ROADMAP.md` declares #1 a parent only, #2 foundation/parity, #3 domain
  parsers, #4 orchestration, and #5 final integration/cutover. Completion
  requires closing the child work, reflecting it in the roadmap, and then
  completing the parent checklist.

## Testable Success Criteria

1. A committed fixture corpus records request, status, response headers relevant
   to JSON behavior, and canonicalized body from the current .NET service for
   every supported route and representative invalid request.
2. The same corpus run against .NET and Go produces zero semantic diffs: exact
   status, JSON field presence/type/null/default/value, exact map keys/Booleans,
   and exact array order/value. JSON object member order alone is ignored.
3. Quality fixtures cover every source, modifier, resolution, revision path,
   fallback resolution, unknown/default path, early-return precedence, anime
   source form, and case-sensitive `REAL` count.
4. Language fixtures cover every exposed language enum, alias/code paths,
   ordering, deduplication, `Unknown`, German `DL`/`ML`, Unicode labels, and
   known ambiguity/false-positive boundaries.
5. Release-group fixtures cover standard, anime, exact/pattern exceptions,
   multiple candidates, extension/site/suffix cleanup, numeric rejection,
   season/episode rejection, hash rejection, and null.
6. Movie fixtures cover every ordered grammar family plus aliases, acronym/dot
   normalization, editions, IDs, hashes, hardcoded subs, reversed names,
   supported/unsupported extensions, obfuscated/rejected names, malformed
   matches, and default response behavior.
7. Episode fixtures cover every ordered grammar family plus
   single/multi/range/split/absolute/decimal, anime, mini-series,
   partial/full/multi-season, extras/special decisions, daily dates, six-digit
   dates, ambiguity, invalid/descending ranges, reversed names, date bounds, and
   null results.
8. Regex parity tests cover shipped parser regexes and user-pattern constructs,
   invalid expressions, duplicate patterns/texts, zero-length patterns,
   Unicode/culture-sensitive casing, and a reliably bounded catastrophic
   expression. Invalid/timeout pairs return false without losing siblings.
9. HTTP integration tests pin validation precedence, exact 400 error bodies,
   success bodies, health version, malformed JSON/type/content/method behavior,
   and concurrent batch requests.
10. App integration tests prove parser enum conversion, cache hit/miss/version
    rollover, sorted-pattern cache identity, partial cached batch recovery,
    health false/true transitions, and unchanged parser-unavailable UX.
11. Standalone tests prove Linux/macOS and Windows binary discovery names,
    free-port launch, health readiness, parent shutdown, unexpected-exit
    logging, missing/slow binary degradation, and no required configuration
    change.
12. Container tests prove non-root execution, port 5000 reachability, `/health`
    healthcheck, existing image/service names, and compose connectivity for
    production and development service names.
13. CI builds and tests Go on all affected pull requests. Tagged release
    validation finds the parser at the existing filename in Linux x64/arm64,
    macOS x64/arm64, and Windows x64 archives.
14. Existing Deno unit/integration/e2e suites pass with the Go service,
    including parser healthy and unavailable paths. No SvelteKit business logic
    is rewritten to compensate for parser drift.
15. No .NET SDK/runtime, C# source, `dotnet` command, ASP.NET environment
    contract, or .NET container layer remains after the final parity gate;
    user-visible docs and `ROADMAP.md` describe the Go service and completed
    issues accurately.
16. Resource measurements demonstrate the migration goal rather than assume it:
    comparable idle and representative parse/batch workloads record startup
    time, memory, CPU, and image/artifact size, with no material throughput or
    timeout regression.

## Open Questions

1. Does “strict API parity” include ASP.NET's exact framework-generated error
   envelopes and headers for malformed/mistyped bodies and method/content-type
   errors, or only the application-authored 400/200 JSON bodies? The safe
   default is to fixture and preserve all observable HTTP behavior.
2. What is the authoritative parser version after cutover? It must change to
   invalidate cached .NET outputs, but issue text does not define whether it
   follows app versions, a parser schema version, or an independent semantic
   version.
3. Which .NET runtime/current-culture settings are the oracle for Unicode
   case-insensitive matching? Container and developer locales can differ; parity
   fixtures need a declared locale.
4. How should time-dependent episode fixtures control “after tomorrow”? The
   current parser reads the local system clock directly. A fixed-clock test seam
   or boundary-relative assertion is needed to avoid flaky golden outputs while
   preserving production semantics.
5. Should the 100 ms timeout be measured as regexp2's match timeout with
   equivalent granularity, and what bounded test expression is reliable across
   CI hardware? The business result is fixed (`false`), but timeout enforcement
   needs a portable acceptance method.
6. Are empty pattern strings explicitly supported? The current regex engine
   treats them as valid and matching every text, while only an empty pattern
   list is rejected; this should be frozen by an oracle fixture.
7. Are null elements inside otherwise non-empty `patterns`/`texts` lists inside
   the supported contract? Current model annotations reject them conceptually,
   but runtime failure behavior should be captured before deciding whether exact
   parity or clean 400 validation is required.
8. Should duplicate text/pattern behavior be documented as supported map
   deduplication, or merely preserved compatibility? Current response maps
   cannot represent duplicates.
9. Must batch response object order reproduce the current concurrent
   dictionary's incidental order? JSON semantics say no; acceptance should
   compare maps order-insensitively and arrays strictly.
10. What quantitative resource threshold makes the migration successful? Issue
    #1 states reduction as motivation but provides no memory, CPU, startup,
    image-size, or throughput target.
11. Is zero-downtime meant only as a drop-in release/configuration promise, or
    is a live rolling upgrade scenario required for the separately deployed
    parser image? The current client retries and degrades, but no explicit
    rolling-upgrade protocol is defined.
12. Should the final PR close #2-#5 and #1 together, or are child checklists
    expected to be updated and closed in phase order before the tracking issue?
    `ROADMAP.md` clearly makes parent completion dependent on all children, but
    the GitHub closure workflow is not specified.
