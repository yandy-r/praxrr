# Encrypted Key Storage: Business Research

## Executive Summary

Issue #9 elevates encrypted API key storage to a high priority because Praxrr already centralizes every Arr instance credential in `arr_instances`, and those credentials flow into user-visible surfaces (e.g., `/arr` load and the InstanceForm test connection) and logs. We need a business boundary that keeps keys encrypted at rest, decrypts them only just-in-time for Arr client creation and connection tests, and never passes plaintext to the browser, telemetry, or logging layers. The new behavior must plug cleanly into the existing UI workflows (`/arr/new`, `/arr/[id]/settings`, environment-managed instances, sync jobs) while leaving optional rotation reminders and external secret providers as future phases.

## User Stories

- **Primary user story:** As a Praxrr operator adding or managing Arr instances, I want the API key that I paste into `/arr/new` or `/arr/[id]/settings` to be stored encrypted so that even if someone copies the SQLite file or inspects job artifacts (sync, rename, upgrade), they cannot read my credentials while Praxrr still uses them when talking to Radarr/Sonarr/Lidarr.
- **Secondary user story:** As a platform admin who ships Praxrr backed by environment variables (see `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts` and `source = 'env'` rows), I want those credentials to be encrypted in the same way as manually created instances so that automated provisioning plus scheduled jobs continue untouched but the secret isn't leaked through the instance list UI or logs.

## Business Rules

- **Core rules**
  - `arr_instances.api_key` must always be persisted as ciphertext derived from a runtime-only master secret; the raw API key should never sit in the database file or migration dumps. The same encrypted value supports all consumers (`arrInstancesQueries.create`, `arrInstancesQueries.update`, environment provisioning, `arrInstancesQueries.getEnabled`).
  - Server-side flows (instance creation, update, sync jobs, rename/upgrade jobs, `createArrClient` calls in `packages/praxrr-app/src/lib/server/sync/processor.ts`, `routes/arr/test/+server.ts`, and `jobs/cleanup`) are the only code paths that may decrypt the key, and they must discard the plaintext immediately after using it.
  - The `/arr` landing page (`routes/arr/+page.server.ts`) and any API that feeds UI components must stop serializing the decrypted key. Instance data delivered to the browser should keep everything but the API key (or expose only a stable fingerprint) so the front-end cannot read or leak the secret. The InstanceForm already marks the API key field as `private_`, so the masking/`Test Connection` UI remains unchanged, but updates must treat each submission as a new secret.
  - `arrInstancesQueries.apiKeyExists` and the uniqueness checks in `/arr/new` and `/arr/[id]/settings` must continue to enforce one credential per Arr install using the encrypted form (e.g., compare ciphertext or fingerprint) so duplicate detection survives encryption.
  - When editing an existing instance, the user must re-enter the API key because the server will not resend plaintext; the `canEditCoreConnectionFields` flag remains `true` only for `source === 'ui'` instances.

- **Validations and exceptions**
  - If the master encryption secret is missing, corrupted, or rotated without re-encrypting rows, decryption failures during job execution should mark the Arr instance as disabled and surface a clear admin action (re-enter API key or restart with the correct secret) before re-enabling sync, rename, or upgrade jobs.
  - Environment-managed instances (`source = 'env'`) remain lock-in their connection fields; encryption should happen at reconciliation time (the same place where `envInstances.ts` currently creates or updates the row) so the database never inherits plaintext from env var processing.
  - Logging statements and telemetry (see `logger` calls in `routes/arr/new/+page.server.ts` and `routes/arr/[id]/settings/+page.server.ts`) must not include the plaintext key; if we need to signal a difference, log a fingerprint (e.g., first/last few characters or hash) instead. Failures to encrypt/save should bubble up as user-friendly errors (`fail(500, { error: 'Failed to create instance' })`).

## Workflows

- **Primary flow (instance onboarding + sync)**
  1. Operator navigates to `/arr/new` and submits name, type, URL, tags, and API key. The action in `routes/arr/new/+page.server.ts` validates systems (type from `VALID_TYPES`, uniqueness via `arrInstancesQueries`, URL format) and calls `arrInstancesQueries.create`. With encrypted key storage, the controller encrypts the API key before the `INSERT` so `arr_instances.api_key` never contains plaintext even though the `FormInput` still sends the raw value to the server.
  2. After creation, the instance list page (`routes/arr/+page.server.ts` → `arrInstancesQueries.getAll`) fetches every row for display. The encrypted storage feature must ensure the load handler strips the API key (or replaces it with a fingerprint) before the Svelte page forwards the data to the browser, preventing `createDataPageStore` / `TableView` / `CardView` from ever exposing the secret.
  3. The jobs/sync layer (e.g., `packages/praxrr-app/src/lib/server/sync/processor.ts`, `rename/processor.ts`, `upgrades/processor.ts`) loads `arr_instances` rows, decrypts each API key, and uses `createArrClient(type, url, apiKey)` or the app-specific clients to communicate with Arr. Steps that previously pulled `instance.api_key` directly now must wrap access with a runtime vault/decrypt helper so every job keeps using the secret without new rollout friction.
  4. `routes/arr/test/+server.ts` continues to accept an API key over JSON and drives the client-test connection logic before persisting any information, ensuring operators still get instant feedback while we keep the encrypted value inside the database.

- **Error recovery flow (decryption failure or missing key)**
  1. A scheduled job tries to decrypt an `arr_instances` row to run `createArrClient`. If the master key changed or the ciphertext is tampered with, decryption fails.
  2. The job records the failure (without logging the secret) and disables the instance or prevents it from being enqueued; cleanup jobs can run via `cleanupJobsForArrInstance` to remove pending work.
  3. The UI reflects the disabled state in `/arr` and the settings page, then prompts the operator to re-enter the API key (via the InstanceForm) so Praxrr can re-encrypt the credential with the current master secret and re-enable sync.

## Domain Concepts

- **ArrInstance row** (`packages/praxrr-app/src/lib/server/db/schema.sql`, `arr_instances` table): captures `name`, `type`, `url`, `external_url`, `tags`, `enabled`, `source`, and the sensitive `api_key` that will now store ciphertext. Its lifecycle spans creation (`arrInstancesQueries.create`), updates (`arrInstancesQueries.update`), and deletion (`arrInstancesQueries.delete`).
- **ArrInstanceSource** (`'ui' | 'env'`): controls editability of the credential fields and determines whether the encryption path runs during interactive UI saves or env-var reconciliation (`envInstances.ts`).
- **Encryption/decryption boundary**: the master secret (likely an env var) encrypts API keys before `INSERT/UPDATE` and decrypts them only for `createArrClient`, connection tests, or job runners; decrypted text is never passed back to SvelteKit loads or network APIs.
- **Sync/Job pipelines** (`arr.sync`, `arr.rename`, `arr.upgrade`, `arr.sync.media_management`, `arr.sync.quality_profiles`, `arr.sync.delay_profiles`): all rely on `arr_instances.id` as the FK, so encrypted storage must not break the cascade; when a job builder needs an API key, it fetches the row, decrypts, and closes the secret immediately after use.
- **UI surfaces**: `/arr/new`, `/arr/[id]/settings`, and the InstanceForm (`private_` API key input) collect plaintext directly from operators and feed it to server actions, which now encrypt before writing. The `/arr` list page and assistive modals must never rehydrate or display the plaintext value.

## Success Criteria

- The `arr_instances` table no longer contains plaintext API keys: existing rows are re-encrypted (or migrated) to ciphertext and new rows always require encryption before `INSERT`. A regression test should prove `arrInstancesQueries.create` stores a non-human-readable value while an associated decrypt helper can recover the original.
- Any data delivered to `/arr`/instance list APIs excludes the full key (extra metadata such as a fingerprint may remain). Automated tests should fail if a `load` handler returns `api_key` to the browser or if `createDataPageStore` receives a plaintext secret.
- Jobs/sync/rename/upgrade processors continue functioning because they decrypt the key before `createArrClient`. A failure in decryption path triggers the disablement workflow and surfaces an admin message rather than letting jobs silently fail.
- Logging/telemetry (creation, updates, errors) does not log the API key. If necessary, log a deterministic fingerprint or mention that a masked key was provided so that support staff can identify which credential failed.
- The environment-variable reconciliation (`envInstances.ts`) encrypts the submitted API keys when inserting/updating `arr_instances`, and the `source = 'env'` logic still prevents direct edits from the UI.

## Open Questions

1. Where does the master encryption secret live (new env var, existing auth secret, KMS)? How is it rotated, and how do we coordinate migration of decryptable data when the secret changes?
2. How do we re-encrypt existing `arr_instances` rows that were stored in plaintext? Do we need a migration script that reads each row, encrypts the API key, and writes it back (with a fallback for missing plaintext)?
3. Should we surface a short fingerprint (e.g., `****abcd` or a hash) in the UI/logs to help operators confirm which key is stored without revealing it?
4. Do we need to hook this into future features such as rotation reminders or external secret managers, or should those always be later phases that read ciphertext from Praxrr but allow their own secret source to plug in?
