# Encrypted Key Storage: Deployment Recommendations (Finalized)

## Current state

The Arr credential encryption model is implemented and running on the new migration/contract:

- `arr_instance_credentials` stores encrypted envelopes (`ciphertext`, `nonce`, `key_version`).
- `arr_instances.api_key_fingerprint` is used for lookup and duplicate/env matching.
- `arr_instances.api_key` is **not** used for runtime authentication and is treated as a write-blocked compatibility field.

## Finalized Storage Model

- Write path:
  - Route/action calls `encryptArrInstanceApiKey()`.
  - Arr instance row stores fingerprint and non-sensitive metadata.
  - Credential envelope is persisted in `arr_instance_credentials`.
- Runtime path:
  - `getArrInstanceClient()` loads envelope from `arr_instance_credentials`.
  - Decrypt happens just-in-time in server process memory.
  - Arr clients receive plaintext key only during request/job execution.
- UI/API contract:
  - Stored/returned payloads do not include plaintext keys.
  - `arrInstancesQueries.getById` and list selectors return `api_key` as an empty placeholder.

## Key Management Expectations

- Required variables:
  - `ARR_CREDENTIAL_MASTER_KEY` (base64, 32-byte raw key)
  - `ARR_CREDENTIAL_MASTER_KEY_VERSION` (active label)
- Optional:
  - `ARR_CREDENTIAL_PREVIOUS_KEYS` (JSON map of legacy version -> base64 key)
- Failure behavior:
  - Invalid key config causes startup failure in `hooks.server.ts` before migrations.
  - Decrypt failures surface through credential-specific errors and do not include key material.

## Migration and Cutover Sequence

1. `runMigrations()` applies `20260221_encrypt_arr_api_keys`.
2. Migration creates schema additions and resumable backfill state table.
3. Migration backfills existing rows in batches, validates round-trip decrypt + fingerprint parity, then:
   - clears legacy `arr_instances.api_key` values for credential-backed rows.
   - installs triggers rejecting non-empty `arr_instances.api_key` inserts/updates.
4. Duplicate detection and env reconciliation consume fingerprints.
5. Runtime call sites consume `getArrInstanceClient()` for persisted credentials.

Plaintext path status:

- Persisted plaintext storage/write behavior is removed from active contracts.
- Direct `instance.api_key` usage for persisted credentials is out-of-contract and should be considered a regression if reintroduced.

## Remediation for Decrypt Failures and Key Rotation

- If startup fails due to master-key config:
  1. Verify `ARR_CREDENTIAL_MASTER_KEY` and `ARR_CREDENTIAL_MASTER_KEY_VERSION` values.
  2. Confirm no accidental whitespace/truncation.
  3. Restart service after correction.
- If job/runtime sees decryption failures:
  - Error text must indicate key config or credential read failure.
  - For sync, affected instances are disabled by design to prevent repeated hard failures.
  - Correct key config, rotate/update instance credential, then re-enable.
- Rotation event procedure:
  1. Add previous versions to `ARR_CREDENTIAL_PREVIOUS_KEYS` to keep decryptability.
  2. Deploy with new `ARR_CREDENTIAL_MASTER_KEY` and `ARR_CREDENTIAL_MASTER_KEY_VERSION`.
  3. Re-save credentials through `/arr/[id]/settings` / env reconciliation to re-encrypt under the active version.

## Operator Rollout Checklist

- Pre-rollback checks:
  - Back up `praxrr.db`.
  - Confirm env vars are injected in all deploy targets.
  - Confirm migration table has not already failed mid-run in previous version.
- Rollout checks:
  - Service starts and `runMigrations()` succeeds.
  - `arr_instance_api_key_backfill_state` has no unresolved checkpoint rows.
  - All non-empty instances have matching `arr_instance_credentials` row and non-empty fingerprint.
  - API surfaces no longer return or log `instance.api_key` plaintext.
  - Manual instance test and one scheduled `arr.sync` flow succeed.
- Rollback decision points:
  - If startup fails: rollback to previous release only after key vars are fixed or restored.
  - If migration gate fails: hold deployment and decide restore backup or resolve data/credential issue before rerun.
  - If active instances begin failing decryption immediately after rollout: pause scheduler jobs, restore previous key material, then rotate credentials in-place.

## Future Enhancements (Out-of-Scope for this task)

- Secret-provider adapters (Vault/OpenBao/Infisical/1Password Connect)
- Encrypted storage coverage for other credential-bearing tables
- Centralized secret-change audit trail for credential operations
