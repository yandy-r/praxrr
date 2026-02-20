# Pattern Research: encrypted-key-storage

## Architectural Patterns

**Repository modules for Arr configuration state**: All database access lives in dedicated query modules that export strongly typed interfaces (`CreateArrInstanceInput`, `ArrInstance`, and others) and encapsulate SQL/transactional logic. Controllers for UI routes call these helpers instead of talking to the `db` singleton directly, which keeps persistence isolated and testable.

- Example: `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`

**Arr client abstraction + factory**: Network operations against Radarr/Sonarr/Lidarr share a `BaseArrClient` that extends a shared HTTP client, adds `X-Api-Key` handling, and exposes helpers like `testConnection`. Concrete clients (`RadarrClient`, `LidarrClient`, and others) inherit from this base, and `createArrClient` centralizes the type switch. This is the pattern to reuse the decrypted key exactly when a job or route needs it.

- Example: `packages/praxrr-app/src/lib/server/utils/arr/base.ts`
- Example: `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`

**Route controllers as validators + orchestrators**: SvelteKit `+page.server.ts` and `+server.ts` files validate inputs (`parseOptionalAbsoluteHttpUrl`, required fields), call query helpers, log structured metadata, and use `fail`/`redirect` to control the HTTP response. They never mutate the DB directly and rely on helpers like `cleanupJobsForArrInstance` for side effects.

- Example: `packages/praxrr-app/src/routes/arr/new/+page.server.ts`
- Example: `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`
- Example: `packages/praxrr-app/src/routes/arr/test/+server.ts`

**Environment reconciliation service**: Environment-provided Arr instances are parsed, validated, and reconciled through a dedicated util that converts prefixed env vars into descriptors, tests connectivity, and updates/disables rows via the same query APIs. This layer shows how encrypted storage should plug into env-managed paths without duplicating logic.

- Example: `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`

## Code Conventions

Naming follows small, descriptive nouns with `Queries`/`Client` suffixes, and everything is exported as named bindings (no default exports). SQL helpers are grouped by table (for example `arrInstancesQueries`, `generalSettingsQueries`) and expose typed input/output interfaces rather than letting callers build their own SQL. Route directories mirror SvelteKit conventions (`routes/arr/[id]/settings/+page.server.ts` paired with `+page.svelte`) so server logic lives beside the UI that consumes it. Aliases from `deno.json` (`$db/`, `$arr/`, `$utils/`, `$logger/`) are used consistently, which keeps import paths short even when logic crosses modules. Shared types (for example `ArrType`) live in dedicated files like `packages/praxrr-app/src/lib/server/utils/arr/types.ts`, making union types and interfaces reusable across routes, jobs, and tests.

## Error Handling

Routes treat user-facing validation errors, duplicates, and invalid payloads as early `fail` responses with structured error messages, logging warnings before returning a 400. Database write failures are wrapped in `try/catch` blocks that log via the centralized `logger` (with `source`/`meta`) and return 500-level `fail`s while preserving redirect semantics. Deletions log at `warn` when invalid IDs or env-managed instances are involved, and jobs/cleanup helpers expect callers to log context as well. Background helpers like `cleanupJobsForArrInstance` return counts instead of throwing; the caller (for example `routes/arr/+page.server.ts`) decides how to report the failure. HTTP endpoints (such as `routes/arr/test/+server.ts`) also wrap logic in `try/catch` and return JSON errors with explicit status codes.

- Example: `packages/praxrr-app/src/routes/arr/new/+page.server.ts`
- Example: `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`
- Example: `packages/praxrr-app/src/routes/arr/test/+server.ts`

## Testing Approach

All tests live under `packages/praxrr-app/src/tests/` with subfolders per domain (`base`, `jobs`, `upgrades`, and others). Route-related suites extend `BaseTest`, which provisions per-test temp dirs, provides lifecycle hooks, and exposes helpers such as `this.patch` for swapping functions at runtime. Most tests mock the `arrInstancesQueries` helpers (for example patching `nameExists`, `apiKeyExists`, `create`) so they can assert that the server action both validates input and calls persistence correctly. Job/unit tests (for example `jobs/lidarrSync.test.ts`) replace `arrInstancesQueries.getById` to simulate enabled/disabled instances and verify that encrypted-key lookups would still feed the job pipeline. End-to-end scenarios use `Deno.test` with descriptive names, reusing the same `BaseTest` scaffolding.

- Example (Base + patching): `packages/praxrr-app/src/tests/base/lidarrOnboarding.test.ts`
- Example (job stubs): `packages/praxrr-app/src/tests/jobs/lidarrSync.test.ts`
- Helper base: `packages/praxrr-app/src/tests/base/BaseTest.ts`

## Patterns to Follow

1. **New persistence helpers should follow the existing `*Queries` convention**: typed inputs/outputs, centralized SQL via `$db/db.ts`, and `execute`/`query` helpers. For encrypted-key storage add a module such as `arrInstanceCredentialsQueries` alongside `arrInstancesQueries` so the repository remains focused.
2. **Decrypt just-in-time via the `createArrClient` factory** before talking to Arr APIs; keep the decrypted key inside the client lifecycle and never expose it to the browser (mirror how `arr/test` uses a transient client).
3. **Routes must keep validation/logging/response handling identical to existing flows** (`fail`, structured `logger`, redirect handling) so new encrypted fields do not bypass the consistent UX.
4. **Tests should mock the same query helpers** (via `BaseTest` patch helpers or direct assignment) to prove the new storage behaves correctly during onboarding/settings flows, and add regression coverage in `packages/praxrr-app/src/tests/base/` and relevant job suites.
