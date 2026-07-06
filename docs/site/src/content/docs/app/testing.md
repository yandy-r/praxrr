---
title: Testing
description: Deno test runner, scripts/test.ts aliases, APP_BASE_PATH isolation, test layout under packages/praxrr-app/src/tests, and Playwright e2e tasks.
---

Praxrr uses Deno’s built-in test runner for unit and integration tests. Playwright e2e
tests require a running server. Run **`deno task test`**, **`deno task lint`**, and
**`deno task check`** before merging application code changes.

## Unit Test Runner

```bash
deno task test              # all tests under packages/praxrr-app/src/tests
deno task test filters      # single alias (see table below)
deno task test:watch        # watch mode with dist/test base path
```

`scripts/test.ts` sets `APP_BASE_PATH` to `{repoRoot}/dist/test` so tests do not touch
developer `dist/dev` state.

## Test Aliases

Derived from `scripts/test.ts`:

| Alias           | Target                                                                     |
| --------------- | -------------------------------------------------------------------------- |
| `backup`        | `packages/praxrr-app/src/tests/jobs/createBackup.test.ts`                  |
| `cleanup`       | `packages/praxrr-app/src/tests/logger/cleanupLogs.test.ts`                 |
| `env-instances` | `packages/praxrr-app/src/tests/base/envInstances.test.ts`                  |
| `filters`       | `packages/praxrr-app/src/tests/upgrades/filters.test.ts`                   |
| `normalize`     | `packages/praxrr-app/src/tests/upgrades/normalize.test.ts`                 |
| `phase3`        | score simulator phase 3 helper + URL state tests                           |
| `selectors`     | `packages/praxrr-app/src/tests/upgrades/selectors.test.ts`                 |
| `url-state`     | `packages/praxrr-app/src/tests/routes/scoreSimulatorUrlState.test.ts`      |
| `what-if`       | `packages/praxrr-app/src/tests/routes/scoreSimulatorPhase3Helpers.test.ts` |
| `jobs`          | `packages/praxrr-app/src/tests/jobs/` (directory)                          |
| `logger`        | `packages/praxrr-app/src/tests/logger/` (directory)                        |
| `upgrades`      | `packages/praxrr-app/src/tests/upgrades/` (directory)                      |

Pass a file or directory path directly when no alias exists.

## Test Layout

```
packages/praxrr-app/src/tests/
├── arr/           # Arr-specific parity and entity tests
├── base/          # Shared fixtures and env instance tests
├── jobs/          # Job handler tests
├── logger/        # Log cleanup tests
├── routes/        # Route handler tests
├── sync/          # Sync pipeline tests
├── trashguide/    # TRaSH guide transformer tests
└── upgrades/      # Upgrade engine filters (not documented in app section)
```

Arr-touching tests validate behavior per `arr_type` — see project Arr cutover checklist
in `CLAUDE.md`.

## E2E Tests

| Task                        | Purpose                     |
| --------------------------- | --------------------------- |
| `deno task test:e2e`        | Playwright suite (headless) |
| `deno task test:e2e:headed` | Visible browser             |
| `deno task test:e2e:debug`  | Debug mode                  |
| `deno task test:e2e:reset`  | Reset e2e state             |

E2e requires a running Praxrr instance — start `deno task dev` or `dev:noauth` first.

## Pre-Merge Checks

| Change scope       | Required checks                                       |
| ------------------ | ----------------------------------------------------- |
| Application code   | `deno task test`, `deno task lint`, `deno task check` |
| Documentation only | `deno task docs:build`, Prettier on changed markdown  |
| OpenAPI / schema   | Regenerate types + compat checks per `CLAUDE.md`      |

Docs-only PRs skip app unit tests by design; CI still runs Lint and Docs Site build.

## Source References

- `scripts/test.ts`
- `scripts/e2e.ts`
- `deno.json` task definitions
- `packages/praxrr-app/src/tests/`

## Related

- [Development Setup](/app/development/) — dev tasks and environment
- [Job System](/app/jobs/) — `deno task test jobs`
- [Sync Pipeline](/app/sync-pipeline/) — sync tests under `tests/sync/`
- [Architecture Overview](/app/architecture/) — modules under test
