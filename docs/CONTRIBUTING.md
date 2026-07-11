# Contributing to Praxrr

Use this page as the contributor quickstart, then jump to linked guides for deeper details.

## Setup

Prerequisites:

- Git
- Deno 2.x
- Go 1.26.5 (optional, only for parser development; pinned in `mise.toml`)

```bash
git clone https://github.com/yandy-r/praxrr.git
cd praxrr
deno task dev
```

## Usage

- `deno task dev` - run app + parser locally.
- `deno task dev:server` - run app server only.
- `deno task dev:parser` - run only the Go parser on loopback port 5000.
- `deno task lint` - run formatting and lint checks.
- `deno task check` - run type checks (`svelte-check` + server checks).
- `deno task test` - run Deno test suites.
- `deno task test:e2e` - run Playwright end-to-end tests.
- `bash scripts/stats.sh` - optional module-level code stats.

### Parser changes

The optional parser's source of truth is
[`packages/praxrr-parser/README.md`](../packages/praxrr-parser/README.md). It defines the private
four-route contract, .NET-compatible regex semantics, finite limits, logging rules, behavior/cache
versioning, immutable fixtures, deployment, and rollback identifiers.

Install the pinned toolchain and run the focused checks:

```bash
mise install
cd packages/praxrr-parser
gofmt -d .
go mod tidy -diff
go mod verify
go vet ./...
go test ./...
go test -race ./...
```

Before submitting a parser or parser-consumer change, run the repository gates from the root:

```bash
./scripts/check-parser-go.sh
./scripts/check-parser-retirement.sh
```

The retired C# service is historical compatibility evidence, not a development prerequisite. Its
114 captured responses and exact runtime provenance are immutable. Validate them offline with
`deno run --allow-read scripts/capture-parser-goldens.ts --validate`; never derive expected output
from the Go implementation. See the parser guide before proposing a fixture or behavior-version
change.

## Conventions

- **Svelte 5, no runes.** Use `onclick`, no `$state` / `$derived`.
- **Alerts for feedback.** Use `alertStore.add(type, message)`.
- **Dirty tracking.** Use the dirty store to block saves + warn on navigation.
- **Routes > modals.** Only use modals for confirmations or rare one‑off forms.
- **API:** extend `/api/v1/*` only; legacy routes are migration targets.

## Navigation

- [Project README](../README.md) - product overview and runtime setup.
- [Architecture Guide](ARCHITECTURE.md) - module boundaries, data flow, and PCD context.
- [Development Guide](DEVELOPMENT.md) - branching, release channels, and versioning.
- [OpenAPI Source](api/v1/openapi.yaml) - canonical `/api/v1` API contract.
- [Documentation Plans](plans/) - active planning artifacts and implementation specs.

## PRs

Keep changes focused. Update docs when behavior changes.
