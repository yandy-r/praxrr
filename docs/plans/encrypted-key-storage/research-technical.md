# Encrypted Key Storage – Technical Research

## Executive Summary

Encrypting Arr instance API keys at rest requires a new credential store plus a lightweight encryption/key-fingerprint service that plugs into the existing UI forms, server actions, and sync jobs. Stored credentials will be AES‑GCM ciphertexts keyed from a master secret (managed outside the database) while a deterministic HMAC fingerprint allows existing flow such as `parseArrInstanceEnvVars` and `arrInstancesQueries` to continue to deduplicate/normalize instances without ever exposing the plaintext key. The design keeps backend services (sync processor, rename/upgrade jobs, `routes/api/v1/arr/*` and `/arr/test`) on the canonical `arr_instances.url` while only decrypting API keys just before containerizing `createArrClient` calls.

## Architecture Approach

### Component / Service Boundaries

- **Credential service**: a new helper under `packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts` handles AES‑GCM encryption/decryption plus fingerprint/HMAC derivation. It relies on a key ring module (e.g., `packages/praxrr-app/src/lib/server/utils/encryption/keys.ts`) that loads `ARR_CREDENTIAL_MASTER_KEY`/`ARR_CREDENTIAL_MASTER_KEY_VERSION` (with optional previous keys for rotation) and exposes a fast `getEncryptionKey(version)` API, failing fast if no usable key exists.
- **Persistence layer**: move the sensitive payload out of `arr_instances.api_key` into a new `arr_instance_credentials` table and drop the plaintext column. The existing `arrInstancesQueries` module becomes the orchestrator: creation/update flows now encrypt incoming keys, persist ciphertext/nonce/key version, and expose only the opaque fingerprint for duplicate detection.
- **Client instantiation**: wrap the current `createArrClient` usages (routes under `routes/api/v1/arr/`, sync/rename jobs, `routes/arr/[id]/logs`, etc.) with a helper that resolves an `ArrInstance`, fetches its encrypted row, decrypts the API key once per request/run, and finally calls `createArrClient(type, url, decryptedKey, options)`.
- **UI/server boundary**: the `InstanceForm` flow (`packages/praxrr-app/src/routes/arr/*`) continues to send `api_key` to `/arr/test` and the SvelteKit `save` action (`arr/new` or `[id]/settings`) but only the server knows how to encrypt the payload before persisting. The UI still receives `ArrInstance` rows from `arrInstancesQueries.getAll()` but responses omit both ciphertext and fingerprint, preventing leakage.

### Integration Points with Existing System

- Store fingerprints alongside `arr_instances.source` tracking so `env` reconciler in `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts` can look up instances by the hash of the env-provided API key instead of comparing plaintext values.
- Controller actions (`packages/praxrr-app/src/routes/arr/+page.server.ts`, `[id]/settings/+page.server.ts`) will feed `api_key` through the encryption service before calling `arrInstancesQueries.create/update`, matching the existing shape (name, type, url, tags, enabled) while reusing the `arrInstancesQueries` helper structure.
- All backend consumers that historically read `instance.api_key` (see `routes/api/v1/arr/library/+server.ts`, `jobs/handlers/arrSync.ts`, `lib/server/sync/processor.ts`, `lib/server/rename/processor.ts`, `routes/api/v1/arr/releases/+server.ts`, `routes/api/v1/arr/cleanup/+server.ts`, etc.) will use the new decrypt-plus-client helper so they keep using `instance.url` for HTTP traffic and never expose ciphertext elsewhere.

### Data Model Implications

### Entities / Tables / Collections

- **`arr_instances`**: remove the plaintext `api_key` column in favor of an opaque `api_key_fingerprint` text column (unique) that stores `HMAC-SHA256(apiKey)` with the current master key. This column enables existing `getByApiKey`/`updateEnvInstanceByApiKey` logic to survive without decrypting values. It keeps the `source`, `tags`, `enabled`, and `external_url` fields that downstream UI/sync logic still relies on.
- **`arr_instance_credentials` (new table)**: stores the encrypted payload per instance. Columns include:
  - `instance_id INTEGER PRIMARY KEY REFERENCES arr_instances(id) ON DELETE CASCADE`
  - `ciphertext TEXT NOT NULL` (base64-encoded AES-GCM ciphertext)
  - `nonce TEXT NOT NULL` (base64, 12 bytes generated per encryption)
  - `key_version TEXT NOT NULL` (allows rotation; default is the current master key version)
  - `fingerprint TEXT NOT NULL UNIQUE` (same HMAC used in `arr_instances.api_key_fingerprint` to make lookups fast even if the master key rotates)
  - `created_at`, `updated_at` timestamps
  - optional `metadata JSON` for future features (e.g., user-provided label, rotation hint)
- **Key ring helper**: although not persisted in the database, the master key provider may read from `ARR_CREDENTIAL_MASTER_KEY` and optionally `ARR_CREDENTIAL_MASTER_KEYS` (a JSON map) so the code can read historical keys by version when decrypting older credentials.

### Indexes & Migration Considerations

- Add unique indexes on both `arr_instances.api_key_fingerprint` and `arr_instance_credentials.fingerprint` to guard against duplicate API keys from different UI entries or env sources. Also index `arr_instance_credentials.instance_id` (primary key) to make Decrypt+Use paths O(1).
- Migration steps:
  1. Add `arr_instance_credentials` table and `api_key_fingerprint` column (nullable initially) with defaults.
  2. Run a migration script that iterates existing `arr_instances` rows, computes fingerprint `HMAC(api_key)` and encrypts the plaintext `api_key` using the active master key via the new helper (relying on the same environment configuration that production will set). Insert ciphertext/nonce rows into `arr_instance_credentials` and populate `api_key_fingerprint`, handling `NULL`/empty API keys if any.
  3. After the migration succeeds and code is released, drop the original `api_key` column from `arr_instances` and switch `ArrInstance` types to stop exposing it. Because encryption requires the master key, the migration should error (and abort) if the key ring cannot resolve a key, preventing the database from ending up in an inconsistent state.
  4. Add a `key_version` column defaulting to the active version so future decrypts can pull the right key. When rotating keys, re-run a migration that decrypts with the old key version and re-encrypts with the new active key, updating both `arr_instance_credentials.key_version` and `arr_instances.api_key_fingerprint` (fingerprint recomputation is deterministic and does not change, assuming we keep the same HMAC salt derived from the active key).

## API Design Considerations

### Endpoints / Interfaces

- **`POST /arr/new` & `/arr/[id]/settings` actions** (`routes/arr/new/+page.server.ts` and `[id]/settings/+page.server.ts`) retain their current request shape (form fields including `api_key`) but now route the `api_key` through a new `encryptArrInstanceApiKey(input)` helper before the `arrInstancesQueries` upsert runs. The helper returns `(ciphertext, nonce, fingerprint, keyVersion)`; the server stores the cipher data via `arrInstanceCredentialsQueries` and keeps only the fingerprint on the instance row.
- **Env reconciliation** (`packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`) now hashes the env-supplied API key to a fingerprint before calling `arrInstancesQueries.updateEnvInstanceByApiKey`. That method should accept the fingerprint (not plaintext) so it finds the matching `arr_instance_credentials` row even when the key is already encrypted.
- **`/arr/test`** (`routes/arr/test/+server.ts`) remains unchanged in terms of client behavior—it still takes `{ type, url, apiKey }` JSON and never stores the API key, so no encryption logic is necessary there. However, the success path now must avoid logging or echoing the API key if errors are returned.
- **Backend service helper**: create a shared helper (e.g., `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`) that exposes `withArrClient(instanceId, options, callback)` or `createArrClientForInstance(instance, options)`; it internally fetches the credential row, decrypts the API key, instantiates the client via `createArrClient`, and finally closes the client after the callback completes. This helper is the only place that touches ciphertext; callers (e.g., `routes/api/v1/arr/library/+server.ts`, `lib/server/jobs/handlers/arrSync.ts`, `lib/server/sync/processor.ts`, `lib/server/rename/processor.ts`, etc.) are updated to take `(instance)` and pass it along instead of reusing `instance.api_key` directly.

### Request / Response Shape Guidance

- UI forms continue to send plain `api_key` values over TLS when the user enters them, but the server should treat `api_key` as write-only and never populate a field with it when rendering pages. For edits, the form pre-populates an empty string (already the case in `InstanceForm.svelte`) so nothing is echoed back to the browser.
- Any new admin endpoints that expose credential metadata (e.g., `GET /api/v1/arr/instances` if such exists) should include only the publicly useful fields (`name`, `url`, `type`, `enabled`, `source`, `api_key_fingerprint`, `external_url`) and never decrypt keys for the response payload.
- The fingerprint field is deterministic, so responses can safely include it for device/CI automation, but sensitive ciphertext and key version should stay behind server-only helpers.

### Error Handling Model

- Encryption/decryption helpers should throw descriptive errors when the key ring cannot resolve a key, when AES-GCM fails (e.g., tampered ciphertext), or when the fingerprint cannot be generated. These exceptions bubble up to the SvelteKit action layer, which then returns 500-level responses and surfaces a generic “Unable to encrypt API key” message to the UI, avoiding raw secret exposure.
- Migration scripts must stop and log (with `logger.error`) before mutating data if the master key is missing or invalid, ensuring the database isn’t half-migrated. Run-time failure to decrypt (e.g., due to corrupted ciphertext) must restart the process or mark the instance as `enabled=0` and surface the error to admins via logs/alerts.
- `fleet` operations such as env reconciliation should surface conflicts (duplicate fingerprint) via metrics (matching the existing `ReconcileEnvInstancesResult` counters) while continuing with the remaining instances; these flows only need the fingerprint, not the plaintext API key.

## System Constraints

- **Performance**: decrypting every Arr client use could add overhead for sync jobs (`lib/server/sync/processor.ts` iterates all enabled instances). Cache the decrypted key for the lifetime of a single request/run using a short-lived in-memory map keyed by `(instance_id, key_version)` and clear it as soon as the job/route finishes. The aio-crypto helper should avoid repeated `crypto.subtle.importKey` calls by persisting derived keys per version.
- **Security**: the master key(s) must live outside the database (`ARR_CREDENTIAL_MASTER_KEY` + optional `ARR_CREDENTIAL_MASTER_KEYS`) and never be logged. On startup, the helper should verify at least one key is configured; otherwise, fail fast before the server accepts requests. AES-GCM with 256-bit keys and 96-bit nonces are recommended, storing both ciphertext and nonce as base64 to keep the SQL column text-based.
- **Compatibility**: to keep existing flows stable:
  1. Server-to-server traffics (`arr/test`, `routes/api/v1/arr/library`/`releases`, jobs, rename/upgrade processors) remain on `instance.url`; only the stored API key becomes encrypted.
  2. The new fingerprint column preserves features like `arrInstancesQueries.updateEnvInstanceByApiKey` and duplicate detection while preventing UI exposures.
  3. Key rotation is handled by tagging each credential row with `key_version` and keeping old keys handy so decrypts succeed; encryption uses the active version so new writes automatically upgrade.
  4. Tests that build mock `ArrInstance` objects will populate `api_key` fields as before, but the new helper can accept a plain-text override or a fake `credential`. Update the factory functions in tests under `packages/praxrr-app/src/tests/*` to use the helper or to inject decrypted keys explicitly.

## File-Level Impact Preview

- **Likely files to create:**
  - `packages/praxrr-app/src/lib/server/db/migrations/049_encrypt_arr_api_keys.ts` (adds `arr_instance_credentials`, populates it from the old `api_key` column, populates `api_key_fingerprint`, and drops/cleans the plain column).
  - `packages/praxrr-app/src/lib/server/db/queries/arrInstanceCredentials.ts` (CRUD helpers for the new table).
  - `packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts` + `packages/praxrr-app/src/lib/server/utils/encryption/keys.ts` (AES-GCM encrypt/decrypt helpers, fingerprint/HMAC logic, key-ring loader).
  - Optional test fixture helpers under `packages/praxrr-app/src/tests/support/arrInstanceCredentials.ts` that mock decryption for unit tests.

- **Likely files to modify:**
  - `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` (stop writing/reading plain `api_key`, keep/serve `api_key_fingerprint`, integrate with the credential helper during create/update, adjust `ArrInstance` type so the exported interface no longer exposes plaintext).
  - `packages/praxrr-app/src/routes/arr/new/+page.server.ts`, `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`, `+page.server.ts` (Source of truth for arr creation/edit flows) to pass `api_key` through the encryption helper when persisting.
  - All backend Arr client call sites (`routes/api/v1/arr/library/+server.ts`, `/library/episodes/+server.ts`, `/releases/+server.ts`, `/cleanup/+server.ts`, `routes/arr/[id]/logs/+page.server.ts`, `lib/server/jobs/handlers/arrSync.ts`, `lib/server/sync/processor.ts`, `lib/server/rename/processor.ts`, `lib/server/upgrades/processor.ts`, etc.) to use the new `createArrClientForInstance` abstraction instead of `instance.api_key`.
  - `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts` & related reconciliation helpers so they hash env-supplied keys before comparing and update only the fingerprint if kube secrets change.
  - Any shared type definitions (`packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`, `packages/praxrr-app/src/lib/shared/arr/*`) to avoid leaking ciphertext/fingerprint to UI layers and to help compile-time callers that only need public fields.

STATUS: IN PROGRESS
