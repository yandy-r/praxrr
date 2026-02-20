# Feature Spec: Encrypted Key Storage

## Executive Summary

Encrypted API key storage is a Phase 1 trust-foundation feature tracked in GitHub issue #9. Praxrr currently centralizes Arr credentials and uses them across UI actions, API routes, and background jobs, so plaintext persistence creates a high-impact compromise path if the database is copied or logs leak sensitive values. The recommended implementation is application-level envelope encryption for Arr API keys using Deno Web Crypto (AES-GCM), with deterministic keyed fingerprints for duplicate detection and environment reconciliation flows that currently compare keys directly. This approach minimizes architecture disruption versus immediate full-database encryption and keeps existing sync behavior intact by decrypting credentials just-in-time for Arr client calls. Primary risks are key-management operational failure, migration integrity, and accidental plaintext exposure during transitional paths.

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
   - Validation: Server action fails if encryption key material is unavailable.
   - Exception: None for persisted keys.

2. **Write-only UI rule**: API keys are accepted on input but never returned to the browser after save.
   - Validation: Load handlers and API responses omit plaintext key fields.
   - Exception: One-time transient value in current form submission only.

3. **Runtime decrypt boundary rule**: Decryption is allowed only in server-side execution paths that need Arr calls.
   - Validation: Shared helper encapsulates decrypt-and-client creation.
   - Exception: `/arr/test` accepts ad hoc key in request but does not persist it.

4. **Deduplication parity rule**: Duplicate detection and env reconciliation must continue without plaintext equality checks.
   - Validation: Deterministic keyed fingerprint supports existing matching semantics.
   - Exception: None.

### Edge Cases

| Scenario                                 | Expected Behavior                                                   | Notes                                      |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| Master key missing at startup            | Block writes and fail fast with actionable admin error              | Avoid partial unencrypted writes           |
| Decryption failure during job run        | Mark instance disabled and surface remediation path                 | No secret value in logs                    |
| Existing plaintext rows during migration | Backfill in transactional batches, then enforce encrypted-only path | Must be resumable                          |
| Env-managed credential changes           | Recompute fingerprint and re-encrypt value in reconciliation flow   | Preserve `source='env'` immutability in UI |

### Success Criteria

- [ ] New and updated Arr API keys are persisted only as encrypted payload plus deterministic fingerprint.
- [ ] UI/API payloads never return plaintext keys after save.
- [ ] Sync/rename/upgrade/library operations continue via just-in-time decrypt without behavior regressions.
- [ ] Migration converts existing plaintext Arr keys and removes plaintext write path.
- [ ] Logs, errors, and telemetry are redacted and do not expose secret material.

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

- `packages/praxrr-app/src/lib/server/db/migrations/049_encrypt_arr_api_keys.ts`: schema migration and plaintext backfill.
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

## Recommendations

### Implementation Approach

**Recommended Strategy**: Deliver encrypted Arr API key storage in phased cutover, starting with app-level field encryption and deterministic fingerprinting for parity with existing matching logic.

**Phasing:**

1. **Phase 1 - Foundation**: Add crypto/key helpers, redaction guarantees, new credential table, and dual-write path.
2. **Phase 2 - Core Cutover**: Backfill existing plaintext keys, switch duplicate/env logic to fingerprints, enforce encrypted-only writes.
3. **Phase 3 - Hardening**: Add key rotation workflow, auditability, and extend pattern to other secret-bearing settings tables.

### Technology Decisions

| Decision                  | Recommendation                                 | Rationale                                                       |
| ------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| Encryption scope (v1)     | Arr credentials first                          | Highest blast-radius reduction with focused migration scope     |
| Crypto primitive          | AES-GCM + deterministic keyed HMAC fingerprint | Authenticated encryption with parity-friendly dedupe key        |
| Key source baseline       | Environment/file-backed deployment secret      | Simple, portable default with optional external providers later |
| External provider support | Optional adapter phase                         | Reduces first-cut complexity while preserving extension path    |
| Full DB encryption        | Defer SQLCipher evaluation                     | Avoid immediate DB-engine migration overhead                    |

### Quick Wins

- Centralize secret redaction helper and apply across logs/routes.
- Ensure no API/UI response includes plaintext Arr keys.
- Add startup warning for legacy plaintext state before cutover completion.

### Future Enhancements

- External secret manager adapters (Vault/OpenBao/Infisical/1Password Connect).
- Rotation reminders and staleness metadata.
- Optional broader encrypted storage for `tmdb_settings`, `auth_settings`, and `ai_settings`.

## Risk Assessment

### Technical Risks

| Risk                                                  | Likelihood | Impact | Mitigation                                                           |
| ----------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------- |
| Master key misconfiguration causes decrypt failures   | Medium     | High   | Fail fast on startup + explicit remediation docs and health checks   |
| Backfill migration corrupts or skips rows             | Medium     | High   | Transactional batch migration with checkpoints and idempotent resume |
| Secret leakage through non-updated response/log paths | Medium     | High   | Centralized redaction policy + targeted regression tests             |
| Performance overhead from frequent decrypt operations | Low        | Medium | Request/job scoped key cache and shared crypto key import cache      |

### Integration Challenges

- Existing code paths directly reference `instance.api_key`; all Arr client creation sites must move to shared decrypt helper.
- Environment reconciliation currently matches by plaintext key semantics; migration must preserve behavior via fingerprints.
- Transitional period requires careful dual-read/write handling to avoid breaking running jobs.

### Security Considerations

- Master keys must remain outside the DB and never be logged.
- Plaintext secrets should exist only in request memory and immediate runtime call boundaries.
- All error and telemetry paths must redact or omit secret values.

## Task Breakdown Preview

### Phase 1: Encryption Foundation

**Focus**: Introduce crypto primitives and safe persistence scaffolding.
**Tasks**:

- Add encryption/key utilities and deterministic fingerprint helper.
- Add credential table and migration scaffolding.
- Implement dual-write in Arr instance create/update flows.
- Add secret redaction coverage to logs/API payloads.
  **Parallelization**: crypto helper + logging hardening can proceed while DB query layer is updated.

### Phase 2: Arr Credential Cutover

**Focus**: Migrate existing data and enforce encrypted-only semantics.
**Dependencies**: Phase 1 complete and key configuration finalized.
**Tasks**:

- Run backfill for plaintext rows and verify row coverage.
- Switch duplicate and env reconciliation logic to fingerprint lookups.
- Update all runtime Arr client call sites to decrypt-on-demand helper.
- Remove plaintext writes and block fallback paths.

### Phase 3: Lifecycle Hardening

**Focus**: Operational resiliency and broader rollout.
**Tasks**:

- Add key rotation/re-encryption workflow.
- Expand pattern to other secret-bearing tables.
- Add audit and operational observability around secret changes/failures.

## Decisions Needed

Before proceeding to implementation planning, clarify:

1. **Key Management Baseline**
   - Options: env var only, file mount (Docker secrets), optional external provider from day one
   - Impact: operational complexity, reliability, and deployment portability
   - Recommendation: file-mount/env baseline first, external provider adapters in follow-on phase

2. **Migration Enforcement Timing**
   - Options: immediate hard cutover after backfill, temporary dual-read grace window
   - Impact: rollback safety versus security posture speed
   - Recommendation: short, explicit dual-read window with hard deadline and telemetry

3. **Fingerprint Algorithm Contract**
   - Options: keyed HMAC-SHA256 vs non-keyed hash
   - Impact: collision resistance and offline attack resistance for leaked DB data
   - Recommendation: keyed HMAC-SHA256 tied to master key versioning

4. **v1 Scope Boundaries**
   - Options: Arr credentials only, all secret-bearing tables
   - Impact: delivery speed versus immediate security coverage breadth
   - Recommendation: Arr credentials in v1 with documented Phase 3 expansion path

5. **Decryption Failure Behavior**
   - Options: fail per operation, auto-disable instance with remediation prompt
   - Impact: runtime safety and operator recovery clarity
   - Recommendation: auto-disable affected instance and surface explicit recovery steps

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): External API details
- [research-business.md](./research-business.md): Business logic analysis
- [research-technical.md](./research-technical.md): Technical specifications
- [research-ux.md](./research-ux.md): UX research
- [research-recommendations.md](./research-recommendations.md): Full recommendations
