# Repository Guidelines

## Project Structure & Module Organization

`packages/praxrr-app/src/routes/` contains SvelteKit pages and API handlers, with the active API under `packages/praxrr-app/src/routes/api/v1/**`. Backend logic lives in `packages/praxrr-app/src/lib/server/` (`pcd`, `sync`, `jobs`, `db`, `utils`). UI code is in `packages/praxrr-app/src/lib/client/` (components, stores, alerts), and shared types/utilities are in `packages/praxrr-app/src/lib/shared/`. Tests are in `packages/praxrr-app/src/tests/`, with Playwright specs in `packages/praxrr-app/src/tests/e2e/specs/`. The optional parser microservice is in `packages/praxrr-parser/` (.NET). Reference docs and OpenAPI sources are under `docs/` and `docs/api/v1/`.

## Build, Test, and Development Commands

- `deno task dev`: run local development stack (Vite server + parser service).
- `deno task dev:server`: run only the app server.
- `deno task build`: build app assets and compile the Deno binary into `dist/build/`.
- `deno task lint`: run Prettier check + ESLint.
- `deno task check`: run server type checks and `svelte-check`.
- `deno task test`: run Deno tests in `packages/praxrr-app/src/tests`.
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

### Arr Cutover Guardrails (Required)

- After promoting an Arr entity family to first-class tables, remove legacy sibling-app fallback paths immediately in route/read/write/sync resolution.
- When introducing built-in PCD base-op migrations, also register them in `packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts` so newly initialized databases receive them without rerunning migrations.
- For Arr-specific default templates, update both runtime form defaults and migration/backfill ops in the same change to avoid mixed legacy/native defaults.
- For Arr-scoped quality profile UI filtering, do not rely on `quality_profile_custom_formats.arr_type` alone because legacy or shared `arr_type='all'` scores can make incompatible profiles appear valid; enforce app compatibility from enabled quality names mapped via `quality_api_mappings` for the target `arr_type`.
- For Arr-scoped quality profile compatibility, do not require `enabled=1` quality rows; profiles with all qualities disabled (or transitional defaults) must still be considered against app-compatible quality names, otherwise valid profiles can disappear from sync selection UI.

## Testing Guidelines

Place tests by domain (`packages/praxrr-app/src/tests/upgrades`, `packages/praxrr-app/src/tests/jobs`, etc.). Use `*.test.ts` for Deno tests and `*.spec.ts` for Playwright specs; keep the numeric prefix pattern for E2E files (for example `2.31-...spec.ts`). For regressions, add a test that fails before the fix and passes after it. You can run scoped suites with aliases from `scripts/test.ts`, such as `deno task test upgrades`.

## Commit & Pull Request Guidelines

Follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`). Keep commits and PRs focused on one logical change. PR descriptions should include behavior changes, validation steps (commands run), and linked issues when relevant. Include screenshots for UI updates and update docs when API contracts or workflows change.

### GitHub Template Compliance (Required)

- Every `gh issue create` must use a repository issue template from `.github/ISSUE_TEMPLATE/` (for example via `--template <template-file>`); do not create freeform issues.
- Every `gh pr create` must use the repository PR template once it exists (default template or equivalent `--body-file` derived from it); do not create freeform PR bodies.
- If a matching issue/PR template is missing or unclear, stop and ask for direction before creating the issue or PR.

### GitHub CLI PR Editing Reliability

- When creating or updating PR bodies via shell commands, prefer `--body-file` over inline `--body` strings.
- Do not include unescaped backticks in inline shell arguments because command substitution can corrupt PR body content.
- If `gh pr edit` fails with GraphQL `projectCards` deprecation errors, update PR fields using `gh api` (REST) instead of retrying `gh pr edit`.
