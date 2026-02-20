# Contributing to Praxrr

Use this page as the contributor quickstart, then jump to linked guides for deeper details.

## Setup

Prerequisites:

- Git
- Deno 2.x
- .NET SDK 8+ (optional, only for the parser service)

```bash
git clone https://github.com/yandy-r/praxrr.git
cd praxrr
deno task dev
```

## Usage

- `deno task dev` - run app + parser locally.
- `deno task dev:server` - run app server only.
- `deno task lint` - run formatting and lint checks.
- `deno task check` - run type checks (`svelte-check` + server checks).
- `deno task test` - run Deno test suites.
- `deno task test:e2e` - run Playwright end-to-end tests.
- `bash scripts/stats.sh` - optional module-level code stats.

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
