# Pattern Research: praxrr-parser-go

## Architectural Patterns

**Layered Parser/Server Split**: HTTP surface is isolated from parsing logic so server handlers simply marshal requests/responses and delegate to the parser package; models live in their own package to avoid circular deps.

- Example: `docs/plans/praxrr-parser-go/research-technical.md` section “Go Module Structure” describes `server/handlers.go` calling into `parser/parser.go` with shared `models` types.

**Regex Migration Strategy**: All parser logic centralizes around regex-driven sub-parsers (`title`, `quality`, `language`, `episode`, `releasegroup`) with shared utilities in `parser/common.go`, mirroring the existing C# parser’s structure.

- Example: `docs/plans/praxrr-parser-go/research-technical.md` “Regex Pattern Inventory” and “parser/…” outline per-concern files.

**Logging & Configuration Abstraction**: Dedicated `logging` package wraps structured logging (console + file) and configuration loading, keeping cross-cutting concerns out of parser logic.

- Example: “Logging” section in the plan specifies `logging/logger.go` plus config-derived settings.

## Code Conventions

Follow Go conventions: package-per-responsibility, compile-time regex initialization (`regexp2.MustCompile`), standard `encoding/json` DTOs, `net/http` handlers, and minimal dependencies. Keep parser tests adjacent to the package (`parser/*_test.go`).

- Example: `docs/plans/praxrr-parser-go/research-technical.md` “Go Module Structure” and “Files to Create” list package layout and file naming.

## Error Handling

Fail-fast on startup (panic when regex fails to compile). Runtime errors return JSON `{ "error": "message" }` with HTTP 400 for validation or 500 for internal faults; `/match` timeouts or compilation failures are treated like `false` matches rather than HTTP errors.

- Example: “Error Handling” section under “API Contract” describes JSON error format and status codes.

## Testing Approach

Add focused unit tests per parser file (`parser/title_test.go`, etc.) that validate important regex outcomes; mimic the C# parser’s lack of tests by introducing a corpus derived from known titles but keep tests local to each parser package. Use Go’s standard testing framework.

- Example: “Files to Create” in the technical research plan calls out `parser/*_test.go` for each parser file to cover core behavior.

## Patterns to Follow

- Compile all regex at package `init()` time with `regexp2` and panic on failure to prevent startup-time surprises.
- Keep HTTP logic in `server/` and parsing logic in `parser/`, exchanging only well-defined request/response DTOs in `models/`.
- Mirror `/match` timeout behavior by configuring `regexp2.MatchTimeout` (100ms) rather than waiting indefinitely.
- Log via a structured logger (`logging/logger.go`) that supports both console and NDJSON file output, keeping log settings configurable.
- Maintain Docker and build parity by exposing the same endpoints (`/parse`, `/match`, `/health`) and returning identical JSON contracts documented in the plan.
