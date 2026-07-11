# Praxrr Parser

The Praxrr parser is an optional Go service used by custom-format and quality-profile testing. It
parses release titles and evaluates user-supplied, .NET-compatible regular expressions. Linking,
syncing, and the rest of Praxrr continue to work when the parser is unavailable.

The service is private to the Praxrr deployment. Do not publish its listener directly to an
untrusted network.

## HTTP contract

The parser has exactly four routes. The three `POST` routes require an `application/json` (or
`application/*+json`) content type.

| Method | Route          | Request                                | Successful response                           |
| ------ | -------------- | -------------------------------------- | --------------------------------------------- |
| `GET`  | `/health`      | No body                                | `{"status":"healthy","version":"2.0.0-go.1"}` |
| `POST` | `/parse`       | `{"title":"...","type":"movie          | series"}`                                     | Complete legacy-compatible parsed-release object |
| `POST` | `/match`       | `{"text":"...","patterns":["..."]}`    | `{"results":{"pattern":true}}`                |
| `POST` | `/match/batch` | `{"texts":["..."],"patterns":["..."]}` | `{"results":{"text":{"pattern":true}}}`       |

Unknown routes return `404`. Wrong methods return `405` with `Allow`; unsupported media types
return `415`; malformed JSON and missing required values return `400`; supported-envelope
violations return `413`. A saturated matcher returns `503` with `Retry-After: 1`. Empty response
bodies for transport and limit failures, JSON field names, enum values, nulls, empty arrays, object
key collapse for duplicate strings, and validation order are compatibility behavior. Change them
only with new golden evidence and a behavior-version bump.

### Regular-expression semantics

Pattern routes use [`regexp2`](https://github.com/dlclark/regexp2) in its default .NET-compatible
mode, with case-insensitive matching. They intentionally support constructs used by Praxrr data,
including lookbehind, atomic groups, named captures/backreferences, and .NET replacement tokens.
They do not use Go's standard `regexp` syntax as the compatibility boundary. All engine access must
remain behind `internal/parser/regex.go`; callers receive safe failure classes rather than engine
errors that can echo input.

## Finite execution policy

The supported envelope comes from `testdata/golden/limits.json`. Requests are rejected before work
when they exceed any of these limits:

| Limit                                |       Value |
| ------------------------------------ | ----------: |
| Request body                         |   105,999 B |
| One title/text                       | 1,000 runes |
| One pattern                          | 1,636 runes |
| Texts per batch                      |         100 |
| Patterns per request                 |         910 |
| Unique text plus pattern keys        |       1,010 |
| Unique text-pattern work product     |      45,500 |
| Active HTTP requests / regex workers |       8 / 8 |
| Dynamic regex timeout                |      100 ms |
| Static regex timeout                 |      250 ms |
| Regex backtracking stack             |     100,000 |

The server also bounds headers to 32 KiB and configures finite read-header, read, write, idle,
request, and shutdown timeouts. Do not increase a limit without updating the measured artifact,
tests, and security rationale.

## Run and build

Use the pinned Go 1.26.5 toolchain from the repository root:

```bash
mise install
deno task dev:parser
```

The source-built binary listens on `127.0.0.1:5000` by default. `PARSER_ADDR` is the parser-process
listener setting and accepts a complete `host:port`, for example:

```bash
cd packages/praxrr-parser
PARSER_ADDR=127.0.0.1:5001 go run ./cmd/praxrr-parser
```

`PARSER_HOST` and `PARSER_PORT` belong to the Praxrr app client; they do not configure this binary.
The supplied container sets `PARSER_ADDR=:5000`, runs as UID 1000, exposes port 5000 only to its
private Compose network, and probes `GET /health`. Build it from the repository root:

```bash
docker build -f Dockerfile.parser -t praxrr-parser .
```

Standalone archives contain `praxrr` and an adjacent `praxrr-parser` (or the corresponding `.exe`
files on Windows). The app launcher starts the adjacent parser, waits for its health endpoint, and
terminates it with the app. A missing or unhealthy adjacent parser degrades only parser-dependent
features.

## Verify changes

Run focused Go checks from this directory:

```bash
gofmt -d .
go mod tidy -diff
go mod verify
go vet ./...
go test ./...
go test -race ./...
```

Run the complete parser and app-consumer gate from the repository root:

```bash
./scripts/check-parser-go.sh
./scripts/check-parser-retirement.sh
```

The complete gate also verifies the pinned toolchain, regex-engine boundary, immutable corpus,
adversarial seeds, five cross-build targets, and Deno consumers.

## Golden fixtures

`testdata/golden/manifest.json` and the JSONL files beside it are 114 immutable observations from
the retired C# oracle. The manifest pins its source revision, container digest, .NET runtime,
culture, globalization mode, time zone, configuration, and invocation. Normal development never
regenerates expected output from Go.

Validate the corpus offline:

```bash
deno run --allow-read scripts/capture-parser-goldens.ts --validate
```

Run that command from the repository root. Adding or changing an oracle response requires explicit
compatibility review and reconstruction of the exact pinned historical oracle from the manifest.
Only then may `scripts/capture-parser-goldens.ts` capture and verify a recapture as documented in
`tools/golden/README.md`. If that immutable environment cannot be reproduced, do not rewrite the
golden; introduce and review a new behavior contract instead.

## Logging and exposure

Parser logs are structured metadata only: route class, status, outcome, duration, text/pattern
counts, version, listener source, and stable error class. Never log raw titles, texts, patterns,
request/response bodies, regular-expression engine errors, or query strings. The default listener
is loopback, and the container is intended for an internal network without a published host port.

## Behavior versions, caches, and rollback

`GET /health` reports a parser **behavior version**, currently `2.0.0-go.1`; release builds inject it
with `-ldflags`. It is not merely the application release tag. Bump it whenever parsing, matching,
wire, or limit behavior can change. Parsed-release caches are keyed by the version. Pattern-match
caches use the version plus the pattern hash as their namespace, so results from different parser
behaviors cannot mix. During an outage, the app may use already-proven entries for the last observed
version but must not fill misses without a fresh health response.

Release provenance records the Go behavior version, archive checksums, SBOM, and immutable rollback
identifiers. The historical C# rollback image is
`ghcr.io/yandy-r/praxrr-parser@sha256:59edc5953cf89b237461f5df1d44d0f9b6887baaee9f096626ffb99a2d67802c`;
the corpus manifest supplies its oracle source/runtime identity. Roll back by immutable digest, not
a moving tag, and expect a distinct cache namespace. Keep the Go artifact digest and behavior
version from the same release provenance so a forward recovery is equally reproducible.

## Source map

- `cmd/praxrr-parser/` — process configuration, lifecycle, and version injection
- `internal/httpserver/` — bounded HTTP adapter and safe request logging
- `internal/contract/` — exact JSON DTOs and enums
- `internal/parser/` — domain parsing, matching, limits, and the sole regex-engine boundary
- `internal/parity/` — immutable golden, adversarial, performance, and safety gates
- `testdata/golden/` — captured oracle records, provenance, limits, and baseline
