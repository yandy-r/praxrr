# Analysis Code: encrypted-key-storage

## Executive Summary

The codebase already has strong centralization points for this feature: Arr persistence in `arrInstancesQueries`, UI input paths in Arr form actions, and runtime Arr auth usage through `createArrClient` consumers. This allows encrypted storage to be introduced with minimal architecture churn if contracts are updated consistently. The key risk is partial cutover where some code still assumes `instance.api_key` plaintext.

## Related Components

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: CRUD, duplicate checks, env update helpers.
- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: parse/validate/reconcile env instances.
- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: Arr client instantiation.
- `packages/praxrr-app/src/routes/arr/new/+page.server.ts`: create action and validation.
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: update action + env edit restrictions.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: job handler using Arr clients.
- `packages/praxrr-app/src/lib/server/sync/processor.ts`: sync processor using instance credentials.
- `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`: API route with direct Arr client usage.
- `packages/praxrr-app/src/routes/api/v1/arr/releases/+server.ts`: release API path requiring Arr auth.
- `packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: cleanup API path requiring Arr auth.

## Implementation Patterns

**Query-Oriented Persistence**

- Example: `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- Apply to: schema changes, new credential query module, dedupe/env matching updates.

**SvelteKit Action Validation Pipeline**

- Example: `packages/praxrr-app/src/routes/arr/new/+page.server.ts`
- Apply to: encrypt-before-persist flow, error surfacing, redaction-safe logging.

**Factory-Based Arr Client Access**

- Example: `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`
- Apply to: decrypt-on-demand client helper and call-site migration.

**Env Reconciliation with Savepoints**

- Example: `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`
- Apply to: fingerprint-based lookup/update for env-managed credentials.

## Integration Points

### Files to Create

- `packages/praxrr-app/src/lib/server/db/migrations/049_encrypt_arr_api_keys.ts`: schema + backfill migration.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstanceCredentials.ts`: encrypted credential persistence.
- `packages/praxrr-app/src/lib/server/utils/encryption/keys.ts`: key loading/version resolution.
- `packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts`: encrypt/decrypt + fingerprint helpers.
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: decrypt-and-create Arr client helper.

### Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: migrate to fingerprint contract and credential linkage.
- `packages/praxrr-app/src/routes/arr/new/+page.server.ts`: encrypt API key before create.
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: encrypt API key before update.
- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: fingerprint-based env reconciliation.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: swap to decrypt helper.
- `packages/praxrr-app/src/lib/server/sync/processor.ts`: swap to decrypt helper.
- `packages/praxrr-app/src/lib/server/rename/processor.ts`: swap to decrypt helper.
- `packages/praxrr-app/src/lib/server/upgrades/processor.ts`: swap to decrypt helper.
- `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`: remove plaintext key dependency.
- `packages/praxrr-app/src/routes/api/v1/arr/releases/+server.ts`: remove plaintext key dependency.
- `packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: remove plaintext key dependency.

## Conventions

- Keep strict typing in server query/utils modules (no `any`).
- Preserve early validation and fail-fast error handling patterns.
- Prefer centralized helpers over duplicating crypto/decrypt logic in routes/jobs.
- Maintain Arr-type-specific behavior; no cross-Arr semantic shortcuts.

## Gotchas and Warnings

- Plaintext matching in env reconciliation must be fully removed to avoid parity breaks.
- Any missed `instance.api_key` usage will break at cutover.
- Migration must fail fast if key material is unavailable.
- Redaction hygiene must be applied consistently in logs and API payload shaping.

## Task Guidance by Area

- database: add credential storage + fingerprint indexes + backfill migration tests.
- api: route/job processor migration to decrypt helper + non-leak responses.
- ui: preserve write-only key UX and ensure load outputs never include plaintext secrets.
