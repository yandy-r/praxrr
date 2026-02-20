# Analysis Context: encrypted-key-storage

## Executive Summary

Encrypted key storage must replace plaintext Arr API key persistence without breaking existing Arr sync, rename, upgrade, and API workflows. The core approach is AES-GCM encrypted credential storage plus deterministic keyed fingerprints for duplicate detection and env reconciliation parity. The integration boundary is clear: encrypt at write paths, decrypt only at Arr client creation time, and never expose plaintext through UI/API responses or logs.

## Architecture Context

- System Structure: Keep `arr_instances` as identity/config table, add `arr_instance_credentials` as one-to-one encrypted credential table, and centralize crypto in server-side helpers under `packages/praxrr-app/src/lib/server/utils/encryption/`.
- Data Flow: form/env plaintext input -> encryption helper (ciphertext + nonce + key_version + fingerprint) -> persistence (`arr_instances.api_key_fingerprint` + credential row) -> runtime consumers fetch/decrypt via shared Arr client helper -> `createArrClient`.
- Integration Points: `arrInstancesQueries`, Arr form actions, env reconciler, sync/job/API Arr client call sites, startup initialization and migration sequencing.

## Critical Files Reference

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: write/read surface that currently assumes plaintext key storage.
- `packages/praxrr-app/src/lib/server/db/schema.sql`: base schema contract that requires new credential table + fingerprint support.
- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: env reconciliation currently keyed by plaintext matching.
- `packages/praxrr-app/src/routes/arr/new/+page.server.ts`: create action accepting raw API key input.
- `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: update action and source-based edit guardrails.
- `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`: central Arr client creation point; decrypt-at-use boundary.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: critical downstream consumer dependent on Arr credentials.
- `packages/praxrr-app/src/lib/server/sync/processor.ts`: high-frequency Arr client usage path.
- `packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts`: API route with direct Arr client dependency.
- `docs/plans/encrypted-key-storage/feature-spec.md`: authoritative behavior and acceptance criteria.

## Patterns to Follow

- Query module pattern: keep SQL and data shaping inside dedicated query modules.
- Route action orchestration: validate -> query call -> fail/redirect flow for SvelteKit actions.
- Factory boundary pattern: centralize Arr client creation and auth construction.
- Env reconciliation pattern: normalize env input and reconcile with DB in one utility.

## Cross-Cutting Concerns

- Security: no plaintext persistence, no plaintext in logs/responses, strict server-only decrypt boundary.
- Reliability: fail fast when encryption keys are unavailable or invalid.
- Performance: avoid repeated crypto key import/decrypt overhead with request/run scoped caching.
- Migration safety: transactional, resumable backfill with deterministic validation of converted rows.
- Test coverage: regressions for dedupe parity, env reconciliation parity, client creation, and non-leak behavior.

## Parallelization Opportunities

- Independent work areas:
  - Encryption/key utilities and key config loading.
  - DB migration/query scaffolding for credential table and fingerprint column.
  - Route/API/log redaction updates and UI response hardening.
- Coordination hotspots:
  - `arrInstancesQueries` contract changes shared across routes, env reconciliation, and runtime consumers.
  - Migration/cutover timing relative to job startup and client usage paths.

## Implementation Constraints

- Preserve Arr-specific semantics and existing behavior across Sonarr/Radarr/Lidarr.
- Keep `source='env'` edit restrictions intact while updating reconciliation to fingerprint semantics.
- Enforce deterministic keyed fingerprint contract across all write/update paths.
- Ensure startup sequence in `hooks.server.ts` remains stable with migrations and env reconciliation.

## Planning Recommendations

- Phase 1: establish encryption/key utilities + persistence scaffolding + dual-write/read-safe contracts.
- Phase 2: run backfill and complete runtime cutover to decrypt-on-demand helpers.
- Phase 3: operational hardening (rotation workflow, observability, documentation/runbooks).
