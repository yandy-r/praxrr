## Executive Summary

Issue #9 marks encrypted API key storage as a high-priority trust foundation item, and the research explicitly recommends shipping it early with masking rather than treating it as a later add-on. Today, Praxrr still handles multiple API-key fields as plaintext in the DB/query layer, while Arr flows depend on API-key equality for duplicate detection and env reconciliation. The most realistic path is phased: immediate masking and redaction hardening, then app-level encrypted storage with hash-based lookups, then full cutover and lifecycle hardening.

### Recommended Implementation Strategy

- `high-confidence approach`: Implement application-level field encryption for secret-bearing columns with an authenticated cipher and per-record random nonce, plus a deterministic keyed hash column for equality lookups. Start with `arr_instances` first because it is the largest blast-radius surface and is directly tied to sync/runtime operations.
- `rationale and tradeoffs`: This approach aligns with current Deno + SQLite architecture and avoids an immediate SQLCipher operational migration. It also preserves current behavior that depends on API-key matching by moving those comparisons to hash-based queries. The tradeoff is temporary migration complexity (dual-format reads during backfill) and a new operational dependency on master-key management.
- `evidence basis`: Issue #9 and Phase 1 recommendations in `research/praxrr-additional-features/report.md`; trust-infrastructure guidance in `research/praxrr-additional-features/synthesis/pattern-recognition.md`; current plaintext handling and API-key equality dependencies in `packages/praxrr-app/src/lib/server/db/schema.sql`, `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`, and `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`.

## Phased Rollout Suggestion

- `phase 1 goal`: Reduce exposure immediately and lay compatibility foundations. Complete API-key masking/redaction coverage for UI/log/API surfaces, introduce a shared secret-redaction utility, add encryption primitives and new secret-storage columns for `arr_instances`, and dual-write new/updated keys as `ciphertext + hash` while allowing controlled legacy reads.
- `phase 2 goal`: Execute cutover for core Arr credentials. Backfill legacy `arr_instances` keys in transactional batches, switch duplicate/env-reconcile lookups from plaintext equality to hash equality, block plaintext writes, and fail fast when encryption key material is missing or invalid.
- `phase 3 goal`: Expand and harden secret lifecycle. Apply the same pattern to `tmdb_settings`, `auth_settings`, and `ai_settings`, remove legacy plaintext paths/columns, add re-encryption (key-rotation) workflow, and capture audit events for secret updates/rotations.

## Quick Wins

- Enforce masked-secret logging everywhere (`hasApiKey`/last-4 only), including auth failures and form validation paths.
- Ensure Praxrr-generated integrations always use `X-Api-Key` headers and avoid query-param key propagation in internal flows.
- Add startup warnings when plaintext secret fields are detected pre-cutover so operators know migration status.
- Document secure backup handling for DB + environment files as part of this feature rollout.

## Future Enhancements

- External secret provider support (`_FILE` inputs, Docker secrets, Infisical/OpenBao connectors).
- Secret rotation metadata (`last_rotated_at`, rotation reminders, stale-key warnings).
- Per-secret access/change audit views tied to existing ops history.
- Optional full-database encryption evaluation (SQLCipher) once field-level encryption is stable in production.

### Risk Mitigations

- `master key loss risk`: Require startup key fingerprint validation, document key backup/recovery steps, and block writes if key config is inconsistent.
- `migration integrity risk`: Use transactional backfill batches with checkpointing and explicit success/failure counters; support resumable migration runs.
- `behavior regression risk`: Add targeted tests around `apiKeyExists`, `getByApiKey`, env reconciliation updates/disable logic, and duplicate detection after hash cutover.
- `leakage risk`: Centralize redaction helper usage and add a CI rule that rejects obvious secret logging patterns.
- `operational rollout risk`: Ship behind a feature flag with telemetry for decrypt failures, fallback reads, and backfill progress before enforcing hard cutover.

## Decision Checklist

- Choose encryption scope for v1: `arr_instances` only first, or all secret-bearing tables in the same milestone.
- Confirm crypto mode and key format: algorithm, nonce handling, key ID/versioning, and hash function strategy.
- Decide master-key source of truth: env var, file mount, or secret manager baseline.
- Approve migration/cutover model: dual-read window length, enforcement criteria, and rollback triggers.
- Decide whether legacy plaintext columns are removed in phase 3 or retained temporarily with strict read-blocking.
- Define rotation expectations for first release: manual re-encrypt only vs. user-facing rotation workflow.
