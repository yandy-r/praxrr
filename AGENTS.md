# Repository Guidelines

## Project Structure & Module Organization

`src/routes/` contains SvelteKit pages and API handlers, with the active API under `src/routes/api/v1/**`. Backend logic lives in `src/lib/server/` (`pcd`, `sync`, `jobs`, `db`, `utils`). UI code is in `src/lib/client/` (components, stores, alerts), and shared types/utilities are in `src/lib/shared/`. Tests are in `src/tests/`, with Playwright specs in `src/tests/e2e/specs/`. The optional parser microservice is in `src/services/parser/` (.NET). Reference docs and OpenAPI sources are under `docs/` and `docs/api/v1/`.

## Build, Test, and Development Commands

- `deno task dev`: run local development stack (Vite server + parser service).
- `deno task dev:server`: run only the app server.
- `deno task build`: build app assets and compile the Deno binary into `dist/build/`.
- `deno task lint`: run Prettier check + ESLint.
- `deno task check`: run server type checks and `svelte-check`.
- `deno task test`: run Deno tests in `src/tests`.
- `deno task test:e2e`: run Playwright end-to-end tests.
- `deno task test:e2e:headed -- 1.12`: run a focused E2E subset by spec prefix.

## Coding Style & Naming Conventions

Use TypeScript with strict typing and Svelte 5 conventions used by this repo (no runes). Formatting is enforced by Prettier: tabs, single quotes, no trailing commas, 100-char print width. Prefer `PascalCase.svelte` for components and `camelCase.ts` for utility modules. Reuse import aliases from `deno.json` (for example `$server/`, `$shared/`, `$alerts/`) instead of long relative paths.

## Cross-Arr Semantic Validation Policy

This rule applies to all future enhancements, features, and bug fixes.

- Do not assume Sonarr, Radarr, and Lidarr semantics are interchangeable, even when APIs look similar.
- Validate API behavior per Arr app (`arr_type`) before reusing handlers, payload parsing, or sync logic.
- Validate schema fields per Arr app; do not share field mappings without explicit parity proof.
- Use Arr-specific domain model terms in code, contracts, and docs; avoid cross-app naming shortcuts.
- Validate migration/import/export mappings per Arr app and fail fast on missing or ambiguous mappings.

Checklist (required for Arr-touching changes):

- [ ] API semantics verified per Arr app involved.
- [ ] Schema fields validated per Arr app involved.
- [ ] Read/write/sync dispatch resolves by explicit `arr_type` (no implicit sibling fallback).
- [ ] Domain model terminology is Arr-specific and correct.
- [ ] Migration/import/export mappings are explicitly defined per Arr app.

### Portable Contract Fidelity (Required)

- Keep OpenAPI portable schemas aligned with runtime import/export validators and entity create/update payloads.
- Do not publish Arr-specific portable field names unless runtime currently accepts them.
- For persisted config names used in sync lookups, preserve exact values (no normalization that changes identifier bytes, such as trim).
- When testing scoped rename propagation, assert targeted `instance_id` coverage, not only affected row counts.
- For transitional shared-table contracts (for example Sonarr-backed Lidarr entities), define table identifiers once in a shared constants module and reuse across read/create/update/delete paths to prevent silent contract drift between files.

## Testing Guidelines

Place tests by domain (`src/tests/upgrades`, `src/tests/jobs`, etc.). Use `*.test.ts` for Deno tests and `*.spec.ts` for Playwright specs; keep the numeric prefix pattern for E2E files (for example `2.31-...spec.ts`). For regressions, add a test that fails before the fix and passes after it. You can run scoped suites with aliases from `scripts/test.ts`, such as `deno task test upgrades`.

## Commit & Pull Request Guidelines

Follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`). Keep commits and PRs focused on one logical change. PR descriptions should include behavior changes, validation steps (commands run), and linked issues when relevant. Include screenshots for UI updates and update docs when API contracts or workflows change.

### GitHub CLI PR Editing Reliability

- When creating or updating PR bodies via shell commands, prefer `--body-file` over inline `--body` strings.
- Do not include unescaped backticks in inline shell arguments because command substitution can corrupt PR body content.
- If `gh pr edit` fails with GraphQL `projectCards` deprecation errors, update PR fields using `gh api` (REST) instead of retrying `gh pr edit`.
