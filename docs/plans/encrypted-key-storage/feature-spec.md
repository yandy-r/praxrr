# Feature Spec: Encrypted Key Storage

## Executive Summary

Encrypted API key storage is implemented for Arr instances. The runtime contract is now:

- Arr API keys are persisted as encrypted envelopes and keyed fingerprints in the app DB.
- Runtime Arr clients call a shared decrypt boundary and receive plaintext only inside server call scope.
- Duplicate detection and env reconciliation now use deterministic fingerprints instead of direct `instance.api_key` comparison.

This avoids full-schema SQLCipher migration while removing plaintext `arr_instances.api_key` write-path usage for active instances and operations.

## External Dependencies

### APIs and Services

#### HashiCorp Vault (optional provider)

- **Documentation**: https://developer.hashicorp.com/vault/api-docs
- **Authentication**: Token auth (`X-Vault-Token`) or AppRole login (`/v1/auth/approle/login`)
- **Key Endpoints**:
  - `POST /v1/transit/encrypt/:name`: Encrypt data keys
  - `POST /v1/transit/decrypt/:name`: Decrypt data keys
  - `POST /v1/transit/rewrap/:name`: Rewrap ciphertext during key rotation
- **Rate Limits**: Operator-configured quotas via `/sys/quotas/rate-limit/:name`
- **Pricing**: Self-managed community option plus hosted/enterprise tiers

#### OpenBao (optional provider)

- **Documentation**: https://openbao.org/docs/
- **Authentication**: Vault-compatible token and AppRole auth
- **Key Endpoints**:
  - `POST /v1/auth/approle/login`
  - Vault-compatible transit/secret APIs depending on mounted engines
- **Rate Limits**: Self-hosted policy/infrastructure controlled
- **Pricing**: Open-source project (no platform pricing by project docs)

#### Infisical (optional provider)

- **Documentation**: https://infisical.com/docs/api-reference/overview/introduction
- **Authentication**: Universal Auth (`clientId` + `clientSecret` -> short-lived access token)
- **Key Endpoints**:
  - `POST /api/v1/auth/universal-auth/login`
  - `GET /api/v3/secrets/raw`
- **Rate Limits**: Plan-based cloud limits; no built-in limits for self-hosted
- **Pricing**: Free and paid identity-based plans

#### Docker Secrets (deployment baseline)

- **Documentation**: https://docs.docker.com/engine/swarm/secrets/
- **Authentication**: Service/task-level secret mounts
- **Key Capabilities**:
  - Secret material mounted as file in container runtime
  - Service-scoped access control
- **Rate Limits**: None (platform primitive, not quota API)
- **Pricing**: Included in Docker stack usage

#### SQLCipher (deferred option)

- **Documentation**: https://www.zetetic.net/sqlcipher/sqlcipher-api/
- **Authentication**: Database-level key via `PRAGMA key`
- **Key Capabilities**:
  - Full SQLite at-rest encryption
  - `PRAGMA rekey` rotation support
- **Rate Limits**: N/A (embedded DB encryption engine)
- **Pricing**: Community + commercial offerings

### Libraries and SDKs

| Library                                                    | Version          | Purpose                                               | Installation                 |
| ---------------------------------------------------------- | ---------------- | ----------------------------------------------------- | ---------------------------- |
| Deno Web Crypto (`crypto.subtle`)                          | Runtime built-in | AES-GCM encryption/decryption and HMAC fingerprinting | Built into Deno              |
| `@infisical/sdk` (optional)                                | Current stable   | Provider adapter for Infisical secrets                | `npm install @infisical/sdk` |
| Direct `fetch` clients for Vault/OpenBao/1Password Connect | N/A              | Keep adapters thin and explicit to provider APIs      | Native runtime               |

### External Documentation

- [Vault API Docs](https://developer.hashicorp.com/vault/api-docs): Transit and auth models for optional external key management
- [OpenBao Docs](https://openbao.org/docs/): Vault-compatible open-source secret manager patterns
- [Infisical API Reference](https://infisical.com/docs/api-reference/overview/introduction): Machine identity and secret retrieval contracts
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html): Secret lifecycle and least-privilege guidance
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): Redaction and sensitive logging controls

## Business Requirements

### User Stories

**Primary User: Praxrr Operator**

- As an operator, I want Arr API keys entered in `/arr/new` and `/arr/[id]/settings` to be stored encrypted so a copied DB cannot expose my credentials.
- As an operator, I want sync and management jobs to continue working after encryption so security improvements do not break daily workflows.

**Secondary User: Platform Admin**

- As a platform admin, I want environment-managed Arr instances to follow the same encrypted storage policy so automated provisioning does not reintroduce plaintext secrets.

### Business Rules

1. **Encrypt-at-write rule**: API keys must be encrypted before persistence; plaintext keys must never be stored in SQLite rows.
   - Validation: Startup checks `ARR_CREDENTIAL_MASTER_KEY`/version; runtime writes throw if no valid key material.
   - Exception: none for persisted keys.

2. **Write-only UI rule**: API keys are accepted on input but never returned to the browser after save.
   - Validation: Load handlers and API responses omit plaintext key fields.
   - Exception: One-time transient value in current form submission only.

3. **Runtime decrypt boundary rule**: Decryption is allowed only in server-side execution paths that need Arr calls.
   - Validation: `getArrInstanceClient()` is the decryption boundary for persisted instances.
   - Exception: `/arr/test` accepts ad hoc key input for connectivity checks only and does not persist it.

4. **Deduplication parity rule**: Duplicate detection and env reconciliation must continue without plaintext equality checks.
   - Validation: Deterministic keyed fingerprint supports existing matching semantics.
   - Exception: None.

### Edge Cases

| Scenario                                 | Expected Behavior                                                   | Notes                                      |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| Master key missing at startup            | Fail startup with clear admin guidance                               | Prevents partial writes and hardens startup ordering |
| Decryption failure during job run         | Mark instance disabled (sync path) and return remediation error         | No secret value in logs                    |
| Existing plaintext rows during migration   | Backfill in resumable transactional batches, then enforce encrypted-only writes | `arr_instance_api_key_backfill_state` tracks checkpoints |
| Env-managed credential changes            | Recompute fingerprint and re-encrypt during reconciliation flow        | Preserve `source='env'` immutability in UI |

### Success Criteria

- [x] New and updated Arr API keys are persisted as encrypted payloads plus deterministic fingerprint.
- [x] UI/API payloads do not return Arr API plaintext after save.
- [x] Sync/rename/upgrade/library flows consume credentials through the JIT decrypt boundary.
- [x] Legacy Arr rows are migrated during `20260221_encrypt_arr_api_keys` and ciphertext rows are enforced.
- [x] Logs, errors, and telemetry are redacted and do not expose secret material.

## Technical Specifications

### Architecture Overview

```text
[Arr Form Actions] ---> [Credential Encryption Service] ---> [arr_instance_credentials]
        |                          |                               |
        |                          v                               v
        |-----------------> [api_key_fingerprint] in arr_instances
                                   |
                                   v
                      [Arr Client Factory (decrypt JIT)] ---> [Arr APIs]
                                   |
                                   v
                        [Sync / Rename / Upgrade Jobs]
```

### Data Models

#### `arr_instances` (existing table; updated)

| Field               | Type    | Constraints                    | Description                                          |
| ------------------- | ------- | ------------------------------ | ---------------------------------------------------- |
| id                  | INTEGER | PK                             | Instance identifier                                  |
| name                | TEXT    | UNIQUE per app logic           | Instance label                                       |
| type                | TEXT    | Arr type enum                  | Sonarr/Radarr/Lidarr selection                       |
| url                 | TEXT    | NOT NULL                       | Arr base URL                                         |
| source              | TEXT    | `ui` or `env`                  | Origin of instance configuration                     |
| api_key             | TEXT    | EMPTY STRING after cutover       | Not used for runtime reads/writes after encryption cutover |
| api_key_fingerprint | TEXT    | UNIQUE, NOT NULL after cutover | Deterministic keyed fingerprint for duplicate checks |

**Indexes:**

- `idx_arr_instances_api_key_fingerprint` on (`api_key_fingerprint`): fast duplicate and env match lookups

**Relationships:**

- One-to-one relationship with `arr_instance_credentials` by `instance_id`

#### `arr_instance_credentials` (new table)

| Field       | Type    | Constraints                                    | Description                                       |
| ----------- | ------- | ---------------------------------------------- | ------------------------------------------------- |
| instance_id | INTEGER | PK, FK -> `arr_instances.id` ON DELETE CASCADE | Credential owner instance                         |
| ciphertext  | TEXT    | NOT NULL                                       | Base64 AES-GCM ciphertext                         |
| nonce       | TEXT    | NOT NULL                                       | Base64 96-bit nonce                               |
| key_version | TEXT    | NOT NULL                                       | Active key version used for encryption            |
| fingerprint | TEXT    | UNIQUE, NOT NULL                               | Deterministic keyed fingerprint for parity checks |
| created_at  | TEXT    | NOT NULL                                       | Creation timestamp                                |
| updated_at  | TEXT    | NOT NULL                                       | Update timestamp                                  |

**Indexes:**

- `idx_arr_instance_credentials_fingerprint` on (`fingerprint`): parity with instance lookups

**Relationships:**

- One credential row per Arr instance

**Plaintext Behavior Status**

- `arr_instances.api_key` is retained only for compatibility and is no longer populated with plaintext for normal create/update flows.
- Runtime reads for authentication derive credentials from `arr_instance_credentials` only.

### API Design

#### `POST /arr/new` (SvelteKit action)

**Purpose**: Create a new Arr instance and persist encrypted credentials.
**Authentication**: Existing app auth/session model

**Request:**

```json
{
  "name": "My Radarr",
  "type": "radarr",
  "url": "https://radarr.local",
  "api_key": "<plaintext user input>",
  "enabled": true
}
```

**Response (303 redirect on success):**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Condition                               | Response                |
| ------ | --------------------------------------- | ----------------------- |
| 400    | invalid form data                       | field validation errors |
| 409    | duplicate fingerprint/name/url conflict | conflict message        |
| 500    | encryption or persistence failure       | generic failure message |

#### `POST /arr/[id]/settings` (SvelteKit action)

**Purpose**: Update instance metadata and rotate/replace encrypted API key.
**Authentication**: Existing app auth/session model

**Request:**

```json
{
  "id": 12,
  "name": "My Sonarr",
  "api_key": "<new plaintext key>"
}
```

**Response (303 redirect on success):**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Condition                                        | Response                      |
| ------ | ------------------------------------------------ | ----------------------------- |
| 400    | validation failure                               | field validation errors       |
| 403    | attempting restricted edit on env-managed fields | forbidden message             |
| 500    | encryption/decryption key failure                | generic failure + remediation |

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/db/migrations/20260221_encrypt_arr_api_keys.ts`: schema migration and plaintext backfill.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstanceCredentials.ts`: query helpers for encrypted credential rows.
- `packages/praxrr-app/src/lib/server/utils/encryption/keys.ts`: key loading/versioning helper.
- `packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts`: AES-GCM + HMAC utility.
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: decrypt-just-in-time Arr client factory.

#### Files to Modify

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: replace plaintext key persistence with fingerprint and credential linkage.
- `packages/praxrr-app/src/routes/arr/new/+page.server.ts`: encrypt-before-create flow.
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: encrypt-before-update flow.
- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: fingerprint-based env reconciliation.
- `packages/praxrr-app/src/lib/server/sync/processor.ts`: client creation via decrypt helper.
- `packages/praxrr-app/src/lib/server/rename/processor.ts`: client creation via decrypt helper.
- `packages/praxrr-app/src/lib/server/upgrades/processor.ts`: client creation via decrypt helper.
- `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`: remove direct plaintext key dependency.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: classify credential failures and disable instances.
- `packages/praxrr-app/src/routes/api/v1/arr/releases/+server.ts`: remove direct plaintext key dependency.
- `packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts`: remove direct plaintext key dependency.

#### Configuration

- `ARR_CREDENTIAL_MASTER_KEY`: active base64 master key for encryption/HMAC derivation.
- `ARR_CREDENTIAL_MASTER_KEY_VERSION`: active key version label.
- `ARR_CREDENTIAL_PREVIOUS_KEYS` (optional): version-to-key map for decrypting legacy ciphertext during rotation windows.

## UX Considerations

### User Workflows

#### Primary Workflow: Add/Update Arr Credential

1. **Enter Credential**
   - User: Inputs API key in masked secure field with show/hide toggle.
   - System: Validates required fields and format server-side.

2. **Save Credential**
   - User: Submits settings.
   - System: Encrypts key, stores ciphertext/fingerprint, and returns success without exposing plaintext.

3. **Success State**
   - User: Sees confirmation plus non-sensitive metadata (configured status, last updated timestamp).
   - System: UI remains write-only for secret value.

#### Error Recovery Workflow

1. **Error Occurs**: Encryption key material is missing, invalid, or unavailable.
2. **User Sees**: Clear action-oriented error (`Encryption key unavailable. Configure key source and retry.`).
3. **Recovery**: Operator fixes key configuration and re-submits credential.

### UI Patterns

| Component                 | Pattern                               | Notes                                                    |
| ------------------------- | ------------------------------------- | -------------------------------------------------------- |
| API key input             | Masked `SecretInput` with show/hide   | Auto-rehide on blur/timeout to reduce shoulder-surf risk |
| Credential status         | `Configured` / `Not configured` badge | No plaintext display after save                          |
| Error messaging           | Field-level + summary region          | Avoid secret values in message text                      |
| Sensitive action controls | Confirm dialogs for rotate/delete     | Include impact warning text                              |

### Accessibility Requirements

- Provide explicit labels and helper text for secret fields.
- Use `aria-invalid` and `aria-describedby` for field errors.
- Announce dynamic errors with `role=alert` and non-blocking status with `role=status`.
- Keep reveal/hide and retry actions fully keyboard operable with visible focus states.

### Performance UX

- **Loading States**: `Checking encryption status...` with disabled submit until status resolves.
- **Optimistic Updates**: Avoid optimistic secret-state updates; wait for confirmed encrypted persistence.
- **Error Feedback**: Immediate field and form-level feedback with actionable remediation steps.

## Implementation Status (Current)

The Arr API key encryption model is implemented in code, migrations, and route/runtime call paths.

- AES-GCM credential envelope storage is live in `arr_instance_credentials`.
- JIT decrypt is enforced for runtime clients via `getArrInstanceClient()`.
- Duplicate/env matching now uses deterministic fingerprints stored in `arr_instances.api_key_fingerprint`.
- Write path is blocked for non-empty `arr_instances.api_key` after migration.
- Startup validates credential key ring configuration before dependent services initialize.

### Key Management Contract

- `ARR_CREDENTIAL_MASTER_KEY`: required 32-byte base64 key used for AES-GCM and HMAC derivation.
- `ARR_CREDENTIAL_MASTER_KEY_VERSION`: required active version label used as source-of-truth key version.
- `ARR_CREDENTIAL_PREVIOUS_KEYS`: optional JSON map of `{ "<version>": "<base64 key>" }` used only for decryption during rotations/restarts.
- Invalid or missing key material is a hard error at startup and causes startup failure.
- Runtime key import and fingerprint keys are cached per key version in memory until process restart.

### Migration and Cutover Sequence (Finalized)

1. `20260221_encrypt_arr_api_keys` migration adds credential schema and backfill state table.
2. Backfill runs in configurable batches with checkpoints so reruns resume from the last cursor.
3. Parity checks validate:
   - every non-empty legacy row has a credential row,
   - ciphertext decrypts back to the original key,
   - `arr_instances.api_key_fingerprint` matches credential fingerprint.
4. Migration enforces encrypted-only write behavior by:
   - clearing stored `api_key` values for rows with credentials,
   - installing `BEFORE INSERT/UPDATE` triggers that abort when `api_key` is non-empty.
5. Duplicate/env lookup and conflict checks switch to fingerprint inputs.

### Decrypt Failure and Rotation Remediation

- Arr client creation failures due to key material (`Unable to decrypt Arr API key`, `No Arr credentials found`, `No Arr credential key configured for version`) are surfaced as credential-availability errors.
- Sync job path (`arrSync`) disables the affected instance when this occurs and returns a clear remediation action.
- Operators should restore missing key material, rotate credentials in `/arr/[id]/settings` or env entries, then re-enable the instance.
- Key rotation without full-table rewrite is handled by:
  - reading legacy versions via `ARR_CREDENTIAL_PREVIOUS_KEYS`,
  - re-saving/update flow with active version to re-encrypt in `arr_instance_credentials`.

### Future Scope

- Planned vNext work remains: secret manager adapters (Vault/OpenBao/Infisical/1Password Connect) and broader encrypted fields outside Arr instances.

## Risk Assessment

### Technical Risks

| Risk                                                  | Likelihood | Impact | Mitigation                                                           |
| ----------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------- |
| Master key misconfiguration causes decrypt failures   | Medium     | High   | Fail fast on startup + explicit remediation docs and health checks   |
| Backfill migration corrupts or skips rows             | Medium     | High   | Transactional batch migration with checkpoints and idempotent resume |
| Secret leakage through non-updated response/log paths | Medium     | High   | Centralized redaction policy + targeted regression tests             |
| Performance overhead from frequent decrypt operations | Low        | Medium | Request/job scoped key cache and shared crypto key import cache      |

### Integration Challenges

- Any remaining callsites that use persisted `instance.api_key` for authentication are now out of contract and should be corrected before release.
- Arr env reconciliation and duplicate checks now operate on `api_key_fingerprint`; this must be kept consistent with `deriveArrInstanceApiKeyFingerprint` and write paths.
- Rollouts should include a migration-monitoring checkpoint because failures are resumable and require operator-directed action.

### Security Considerations

- Master keys must remain outside the DB and never be logged.
- Plaintext secrets should exist only in request memory and immediate runtime call boundaries.
- All error and telemetry paths must redact or omit secret values.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): External API details
- [research-business.md](./research-business.md): Business logic analysis
- [research-technical.md](./research-technical.md): Technical specifications
- [research-ux.md](./research-ux.md): UX research
- [research-recommendations.md](./research-recommendations.md): Full recommendations
