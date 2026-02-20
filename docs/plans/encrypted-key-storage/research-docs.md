# Documentation Research: encrypted-key-storage

## Architecture Docs

- `docs/plans/encrypted-key-storage/feature-spec.md`: Executive summary, dependencies, business rules, success criteria, architecture, data model, API design, and migration expectations.
- `docs/plans/encrypted-key-storage/research-technical.md`: Technical design for credential encryption service, key ring helper, table changes, migration approach, and impacted files.
- `docs/plans/encrypted-key-storage/research-external.md`: External key-management and encryption strategy options (Vault/OpenBao/Infisical/1Password, Docker secrets, SQLCipher).
- `docs/plans/encrypted-key-storage/research-recommendations.md`: Phased rollout, quick wins, risk mitigations, and decision checklist.

## API Docs

- `docs/api/v1/openapi.yaml`: Global API contract including Arr endpoints that consume Arr credentials.
- `docs/api/v1/paths/arr.yaml`: Detailed Arr endpoint paths for library, releases, cleanup, and episodes.
- `docs/api/v1/schemas/arr.yaml`: Arr response/request schema definitions.

## Development Guides

- `docs/DEVELOPMENT.md`: Contribution and release workflow guidance.
- `docs/ARCHITECTURE.md`: System architecture and security context relevant to credential handling.
- `docs/plans/encrypted-key-storage/research-ux.md`: UX guidance for secret input masking, recovery, and accessibility.
- `docs/plans/encrypted-key-storage/research-business.md`: User stories, business rules, and failure/recovery expectations.

## README Files

- `README.md`: Environment variable patterns for Arr instances and operational setup context.
- `packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr client architecture and factory usage.
- `packages/praxrr-schema/README.md`: Schema and migration ecosystem context.

## Must-Read Documents

- `docs/plans/encrypted-key-storage/feature-spec.md`: Definition of required behavior and acceptance criteria.
- `docs/plans/encrypted-key-storage/research-technical.md`: Core implementation details and system constraints.
- `docs/plans/encrypted-key-storage/research-business.md`: Domain rules and operational behaviors.
- `docs/plans/encrypted-key-storage/research-external.md`: Key source and provider tradeoffs.
- `docs/plans/encrypted-key-storage/research-recommendations.md`: Rollout strategy and risk controls.

## Documentation Gaps

- Missing explicit runbook for master-key provisioning, backup, and rotation.
- Missing operator migration checklist for plaintext-to-ciphertext backfill and rollback.
- Missing focused test plan for encrypted-key storage verification and regression coverage.
- Missing observability guidance for decrypt failures, secret redaction checks, and fingerprint collision monitoring.
