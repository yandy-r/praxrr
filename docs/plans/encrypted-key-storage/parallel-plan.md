# Encrypted Key Storage Implementation Plan

Encrypted key storage for Arr instances requires replacing plaintext persistence with an encrypted credential table and deterministic fingerprint contract while preserving current Arr workflows. The core strategy is to centralize encryption/decryption in server helpers, keep `arr_instances` as identity/config metadata, and move credential secrecy into a one-to-one credential store with versioned key metadata. Integration must preserve runtime behavior for UI actions, env reconciliation, jobs, and API routes by shifting all Arr client creation to decrypt-on-demand helpers. Migration work is the highest-risk path, so the plan isolates schema scaffolding from backfill/cutover and then converges on hardening, regression tests, and operational docs.

## Critically Relevant Files and Documentation

- `docs/plans/encrypted-key-storage/shared.md`: baseline architecture and required context references.
- `docs/plans/encrypted-key-storage/feature-spec.md`: acceptance criteria, data model intent, and phased outcome expectations.
- `docs/plans/encrypted-key-storage/research-technical.md`: encryption service boundaries, migration concerns, and runtime integration guidance.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: current Arr instance persistence and duplicate/env lookup logic.
- `packages/praxrr-app/src/lib/server/db/migrations.ts`: migration registration order and execution mechanism.
- `packages/praxrr-app/src/lib/server/db/schema.sql`: schema contract reference for table/column expectations.
- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: env-managed Arr reconciliation logic that currently uses plaintext comparison paths.
- `packages/praxrr-app/src/routes/arr/new/+page.server.ts`: create action ingress for raw API key input.
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: update action ingress and env-source edit guardrails.
- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: Arr client instantiation boundary.
- `packages/praxrr-app/src/lib/server/sync/processor.ts`: high-impact Arr client consumer path.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: job runtime path requiring stable Arr auth behavior.
- `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`: API route path that currently depends on instance API key directly.
- `packages/praxrr-app/src/hooks.server.ts`: startup initialization sequencing that interacts with migrations and env reconciliation.
- `docs/ARCHITECTURE.md`: system boundary expectations for server-side secrets and runtime behavior.

## Implementation Plan

### Phase 1: Encryption and Persistence Foundations

#### Task 1.1: Add Key Ring and Encryption Helpers Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/encrypted-key-storage/research-technical.md`
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/utils/encryption/keys.ts`
- `packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/utils/config/config.ts`

Implement a server-only key loader that resolves active/previous key versions from configuration and fails fast when required key material is missing. Implement AES-GCM encrypt/decrypt helpers and deterministic keyed fingerprint generation with explicit version metadata. Keep helper APIs narrow and typed so query/routes/jobs can consume a single contract for encrypt-at-write and decrypt-at-use behaviors.

#### Task 1.2: Add Credential Schema and Query Scaffolding Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/migrations.ts`
- `packages/praxrr-app/src/lib/server/db/schema.sql`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/db/migrations/20260221_encrypt_arr_api_keys.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstanceCredentials.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/db/migrations.ts`

Create migration scaffolding for `arr_instance_credentials` plus `arr_instances.api_key_fingerprint` and required unique indexes, using the repo's current timestamp-based migration naming pattern (do not reuse `049_*`). Add a dedicated query module for credential CRUD/read paths and ensure registration in `migrations.ts`. Keep this task schema-first and avoid cutover deletion logic until backfill is implemented in Phase 2.

#### Task 1.3: Refactor Arr Instance Query Contracts to Fingerprint Semantics Depends on [1.1, 1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstanceCredentials.ts`
- `docs/plans/encrypted-key-storage/feature-spec.md`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstanceCredentials.ts`
- `packages/praxrr-app/src/lib/server/db/schema.sql`

Update Arr query methods so duplicate detection and lookups rely on deterministic fingerprint values instead of plaintext API key comparisons. Ensure create/update flows coordinate `arr_instances` and `arr_instance_credentials` writes atomically and preserve existing `source` behavior. Keep exported types safe for UI/server boundaries by removing plaintext key expectations from shared return shapes.

#### Task 1.4: Encrypt Arr Form Action Write Paths and Response Redaction Depends on [1.1, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/new/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/+page.server.ts`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/routes/arr/new/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/+page.server.ts`

Wire form actions to encrypt submitted keys before persistence and never emit plaintext credential values in success/error payloads. Preserve env-source edit restrictions and current form validation behavior while mapping duplicate checks to fingerprints. Ensure list/load paths remain write-only from a credential perspective by returning only non-sensitive metadata.

#### Task 1.5: Seal Settings Load and Form Write-Only Secret Contract Depends on [1.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts`
- `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`
- `docs/plans/encrypted-key-storage/research-ux.md`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts`
- `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`

Finalize write-only secret behavior on settings pages by ensuring load payloads and component props never include persisted plaintext key material. Keep API-key entry UX intact (masked input, explicit user entry on update) while avoiding hidden-field or prefill leakage patterns. Add explicit acceptance criteria in task execution notes: no `api_key` value reaches rendered page data after save.

### Phase 2: Cutover and Runtime Integration

#### Task 2.1: Implement Backfill and Encrypted-Only Schema Cutover Depends on [1.1, 1.2, 1.3, 1.5]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/db/migrations/20260221_encrypt_arr_api_keys.ts`
- `packages/praxrr-app/src/lib/server/db/migrations.ts`
- `docs/plans/encrypted-key-storage/research-recommendations.md`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/lib/server/db/migrations/20260221_encrypt_arr_api_keys.ts`
- `packages/praxrr-app/src/lib/server/db/migrations.ts`
- `packages/praxrr-app/src/lib/server/db/schema.sql`

Add transactional backfill logic that encrypts existing plaintext keys, writes credential rows, and populates deterministic fingerprints with resumable safeguards. After backfill validation, enforce encrypted-only writes and remove remaining plaintext column dependency in schema/runtime contracts. Abort migration with explicit errors when key material is missing or decryption integrity checks fail.

Define explicit cutover gates inside the task implementation notes before removing plaintext support:

- Gate A: row parity confirmed (`arr_instances` rows with prior keys have matching credential rows and fingerprints).
- Gate B: no unresolved backfill failures/checkpoints remain.
- Gate C: UI/action writes are already encryption-first (`Task 1.4` and `Task 1.5` complete).
- Gate D: rollback path documented before hard enforcement step.

#### Task 2.2: Convert Env Reconciliation to Fingerprint Matching Depends on [1.3, 2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- `docs/plans/encrypted-key-storage/research-business.md`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`

Replace plaintext env-key matching with deterministic fingerprint matching while preserving existing reconcile counters, savepoint behavior, and disable-missing-instance semantics. Ensure env updates re-encrypt values and keep `source='env'` lifecycle restrictions intact. Validate duplicate/conflict behavior remains equivalent for Sonarr, Radarr, and Lidarr flows.

#### Task 2.3: Introduce Decrypt-on-Demand Arr Client Helper Depends on [1.1, 1.2, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`
- `packages/praxrr-app/src/lib/server/sync/processor.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstanceCredentials.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`
- `packages/praxrr-app/src/lib/server/sync/processor.ts`

Create a shared helper that fetches encrypted credentials, decrypts just-in-time, and returns ready Arr clients without leaking plaintext outside a minimal runtime boundary. Keep helper usage Arr-type aware and compatible with existing factory patterns. Use request/job-scoped cache keys including `(instance_id, key_version)` and invalidate cache entries immediately on decrypt failure or detected key-version mismatch to avoid stale-secret reuse during rotation windows.

#### Task 2.4: Migrate Job Runtime Consumers to Decrypt Helper Depends on [2.3, 2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `packages/praxrr-app/src/lib/server/rename/processor.ts`
- `packages/praxrr-app/src/lib/server/upgrades/processor.ts`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `packages/praxrr-app/src/lib/server/rename/processor.ts`
- `packages/praxrr-app/src/lib/server/upgrades/processor.ts`

Replace direct `instance.api_key` usage in job pipelines with the shared decrypt helper and keep existing failure-handling expectations for job queue state. Ensure disabled-instance and error paths remain deterministic and do not leak secret values in logs. Preserve Arr-specific semantics across sync/rename/upgrade dispatch paths.

#### Task 2.5: Migrate Arr API Routes to Decrypt Helper Depends on [2.3, 2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/arr/releases/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/arr/releases/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`

Move each API path to obtain Arr clients through decrypt-on-demand helper calls and remove direct plaintext key assumptions. Preserve existing response contracts and error status behavior while ensuring diagnostics only include safe metadata. Verify route-level caching and retry semantics still behave as expected after helper integration.

#### Task 2.6: Harden Test-Connection and UI Non-Leak Boundaries Depends on [1.4, 2.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/test/+server.ts`
- `packages/praxrr-app/src/routes/arr/+page.server.ts`
- `docs/api/v1/paths/arr.yaml`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/routes/arr/test/+server.ts`
- `packages/praxrr-app/src/routes/arr/+page.server.ts`
- `docs/api/v1/paths/arr.yaml`

Ensure connection-test and list/load flows remain operational while never persisting or echoing plaintext keys. Align API documentation with the write-only credential behavior and fingerprint-based duplicate semantics where exposed. Confirm no UI-facing payload includes sensitive credential material after save.

#### Task 2.7: Migrate Library Episodes Route and Complete Plaintext Call-Site Sweep Depends on [2.5]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/api/v1/arr/library/episodes/+server.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`
- `docs/plans/encrypted-key-storage/feature-spec.md`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/routes/api/v1/arr/library/episodes/+server.ts`

Move the library episodes API route to decrypt-on-demand client usage and remove any direct plaintext assumptions. During task execution, run a targeted sweep (`rg 'instance\\.api_key' packages/praxrr-app/src/routes/api/v1/arr packages/praxrr-app/src/lib/server`) and resolve any remaining Arr runtime plaintext call sites before closing the task.

### Phase 3: Operational Hardening and Verification

#### Task 3.1: Add Startup and Runtime Guardrails for Key Failures Depends on [2.2, 2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`

**Instructions**

Files to Create

- [none]

Files to Modify

- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`

Add explicit guardrails for missing/invalid master key configuration at startup and deterministic remediation paths when decryption fails during runtime jobs. Ensure affected instances are handled safely (for example disable + actionable error) without spilling secrets into logs or client messages. Keep startup ordering compatible with migration/env reconciliation initialization.

#### Task 3.2: Add Regression Tests for Encryption, Cutover, and Env Parity Depends on [2.2, 2.3, 2.5, 2.7]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/envInstances.test.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/base/arrCredentialEncryption.test.ts`
- `packages/praxrr-app/src/tests/base/arrCredentialCutover.test.ts`

Files to Modify

- `packages/praxrr-app/src/tests/base/envInstances.test.ts`

Add tests that assert encrypted-at-rest storage, deterministic fingerprint matching, no-plaintext response behavior, and successful decrypt-on-demand runtime use. Extend env reconciliation tests to cover fingerprint parity and source-specific restrictions. Include failure-path assertions for missing keys and corrupted ciphertext handling.

#### Task 3.3: Add Route and Page Redaction Regression Coverage Depends on [1.5, 2.6, 2.7]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts`
- `packages/praxrr-app/src/routes/api/v1/arr/library/episodes/+server.ts`
- `packages/praxrr-app/src/tests/base/BaseTest.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts`

Files to Modify

- `packages/praxrr-app/src/tests/base/BaseTest.ts`

Add regression coverage that fails when Arr route/page payloads leak credential plaintext. Include assertions for settings page data and library episodes API responses to ensure write-only behavior remains enforced through refactors. Keep fixtures deterministic and sanitized so failures clearly identify leakage boundaries.

#### Task 3.4: Finalize Documentation and Operator Runbook Updates Depends on [3.1, 3.2, 3.3]

**READ THESE BEFORE TASK**

- `docs/ARCHITECTURE.md`
- `docs/plans/encrypted-key-storage/feature-spec.md`
- `docs/plans/encrypted-key-storage/research-recommendations.md`

**Instructions**

Files to Create

- [none]

Files to Modify

- `docs/ARCHITECTURE.md`
- `docs/plans/encrypted-key-storage/feature-spec.md`
- `docs/plans/encrypted-key-storage/research-recommendations.md`

Document the final storage model, key management expectations, migration/cutover sequence, and remediation steps for decrypt failures or key rotation events. Keep docs aligned with actual runtime contracts and explicitly mark plaintext behavior as removed. Provide an operator-focused checklist for rollout validation and rollback decision points.

## Advice

- Treat migration naming/versioning as a first-class constraint: this repo already has `049_create_job_queue`, so new migration IDs must follow current timestamp conventions to avoid collisions.
- Do not leave mixed credential contracts across modules; any remaining `instance.api_key` assumption after Phase 2 will create runtime failures that are hard to diagnose.
- Keep fingerprint derivation centralized and deterministic across all write paths (UI + env) or duplicate detection parity will drift and cause subtle reconcile regressions.
- Prefer a single decrypt helper boundary rather than route/job-specific decrypt snippets to reduce leakage risk and simplify key rotation later.
- Validate startup sequencing in `hooks.server.ts` after migration/env changes because this feature touches both initialization and runtime job lifecycles.
