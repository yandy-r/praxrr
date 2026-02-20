## Executive Summary

For Praxrr’s encrypted Arr API key storage, the strongest near-term path is application-level envelope encryption using Deno Web Crypto (AES-GCM) with a master key sourced from a deploy-time secret source (prefer Docker secrets file mounts over env vars). For teams that need centralized secret lifecycle and audit, Vault/OpenBao, Infisical, and 1Password Connect all provide viable control-plane patterns, with distinct auth and operational tradeoffs. SQLCipher is a credible full-database-at-rest option but has integration and migration cost that should be weighed against targeted field encryption.

### Candidate APIs and Services

### HashiCorp Vault (KV v2 + Transit)

- Documentation URL: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2, https://developer.hashicorp.com/vault/api-docs/secret/transit, https://developer.hashicorp.com/vault/api-docs/auth/approle, https://developer.hashicorp.com/vault/api-docs/system/rate-limit-quotas
- Auth model: Token-based API auth (`X-Vault-Token`); machine-friendly AppRole login at `/v1/auth/approle/login`.
- Key endpoints/capabilities: KV read/write/versioned secrets (`GET/POST /:mount/data/:path`), Transit key creation (`POST /transit/keys/:name`), encrypt/decrypt (`POST /transit/encrypt/:name`, `POST /transit/decrypt/:name`), rewrap (`POST /transit/rewrap/:name`), data-key generation (`POST /transit/datakey/:type/:name`).
- Rate limits/quotas: No fixed public SaaS cap in API docs; quotas are operator-configured via `/sys/quotas/rate-limit/:name` (positive `rate`, default `interval` `1s`, optional `block_interval`, restricted to root/admin namespace). Transit docs also note a default HTTP API max request size of 32MB.
- Pricing notes: Vault Community Edition is available for self-managed installs; HCP Vault Dedicated is trial/PAYG/contract with hourly cluster + client-based billing.

### OpenBao (Vault-compatible OSS)

- Documentation URL: https://openbao.org/docs/auth/approle/, https://openbao.org/api-docs/auth/approle/, https://openbao.org/api-docs/libraries/, https://github.com/openbao/openbao
- Auth model: Token header (`X-Vault-Token` or `Authorization: Bearer`) and AppRole login (`/v1/auth/approle/login`).
- Key endpoints/capabilities: Vault-compatible auth/secrets APIs; OpenBao states compatibility with existing Vault clients and tooling.
- Rate limits/quotas: No separate hosted quota model documented; typically controlled by your self-hosted deployment policies and infrastructure limits.
- Pricing notes: Open source (MPL-2.0); no vendor usage pricing published by project docs.

### Infisical Public API

- Documentation URL: https://infisical.com/docs/api-reference/overview/introduction, https://infisical.com/docs/api-reference/overview/authentication, https://infisical.com/docs/documentation/platform/identities/universal-auth, https://infisical.com/docs/api-reference/endpoints/deprecated/secrets/list, https://infisical.com/docs/documentation/platform/webhooks, https://infisical.com/pricing
- Auth model: Machine identity Universal Auth exchanges `clientId` + `clientSecret` at `/api/v1/auth/universal-auth/login` for short-lived access tokens.
- Key endpoints/capabilities: Secret list/read via `/api/v3/secrets/raw` (Bearer token), machine-identity client-secret lifecycle endpoints under `/api/v1/auth/universal-auth/identities/{identityId}/client-secrets`, webhook signing via `x-infisical-signature`.
- Rate limits/quotas: Cloud limits are documented by operation class; self-hosted has no limits. Listed Cloud examples include Free (Read 200/min, Write 90/min, Secret 120/min) and Pro (Read 350/min, Write 200/min, Secret 300/min), plus Identity/Project creation limits.
- Pricing notes: Free tier available; Pro listed at $18/month per identity; Enterprise/custom available.

### 1Password Connect Server API

- Documentation URL: https://developer.1password.com/docs/connect/, https://developer.1password.com/docs/connect/api-reference/, https://developer.1password.com/docs/connect/security/, https://1password.com/pricing/password-manager
- Auth model: Access-token authenticated API requests to your self-hosted Connect server.
- Key endpoints/capabilities: Vault/item CRUD and retrieval (`/v1/vaults`, `/v1/vaults/{vaultUUID}/items`, item detail/update/delete), API activity listing with pagination controls (`limit`, `offset`).
- Rate limits/quotas: Connect docs state unlimited re-requests after secrets are cached locally; only internal 1Password service limits apply when Connect initially fetches data.
- Pricing notes: Requires 1Password subscription/Secrets Automation workflow. Public pricing page lists Teams Starter Pack and Business plans (per-user/business subscription model).

### Docker Secrets (Swarm/Compose deployment pattern)

- Documentation URL: https://docs.docker.com/engine/swarm/secrets/, https://docs.docker.com/compose/how-tos/use-secrets/
- Auth model: Access is granted per service/task by Swarm/Compose secret declarations (not an external bearer-token API).
- Key endpoints/capabilities: Secrets encrypted in Swarm transit/at-rest, mounted into containers as files (for example `/run/secrets/<name>`), explicit per-service access control.
- Rate limits/quotas: No API quota model; implementation constraints include swarm-only availability and per-secret size limit (up to 500KB).
- Pricing notes: Included in Docker platform usage (no standalone secret-manager subscription fee).

### SQLCipher (encrypted SQLite engine)

- Documentation URL: https://www.zetetic.net/sqlcipher/sqlcipher-api/, https://www.zetetic.net/sqlcipher/, https://www.zetetic.net/sqlcipher/commercial/
- Auth model: Database keying via `PRAGMA key`/`sqlite3_key`; key must be set before first DB operation.
- Key endpoints/capabilities: Full-database encryption, `PRAGMA rekey` rotation, KDF/HMAC/cipher configuration pragmas, integrity checks.
- Rate limits/quotas: No request quotas; performance/operational limits depend on key-derivation and page-size settings.
- Pricing notes: Community open-source edition exists; commercial edition pricing is published (starting at $999/application/year) with enterprise options.

## Libraries and SDKs

- `Deno/TypeScript`: Built-in Web Crypto API (`globalThis.crypto.subtle`) for AES-GCM encryption plus HKDF/PBKDF2 key derivation; avoids custom crypto dependencies and aligns with standards-based APIs.
- `Deno/TypeScript` for Infisical: `@infisical/sdk` (official Node SDK; install via `npm install @infisical/sdk`) provides Universal Auth and secret operations.
- `Deno/TypeScript` for Vault/OpenBao/1Password Connect: Prefer a small typed `fetch` client over unofficial wrappers; all three expose stable HTTP APIs with explicit endpoint docs.
- `Go` (optional sidecar/helper): `github.com/openbao/openbao/api/v2` is OpenBao’s official client and can simplify robust secret-provider sidecars.
- `SQLite encryption layer`: SQLCipher library when you need whole-database encryption rather than only field-level envelope encryption.

## Integration Patterns

- recommended auth flow: Use envelope encryption for Arr API keys. Generate per-record DEKs, encrypt values with AES-GCM + AAD (for example `instance_id`, `arr_type`, field version), then wrap DEKs with a KEK from Vault Transit or a bootstrapped master key loaded from Docker secret files. Keep KEKs out of the DB and never return plaintext via API responses after write.
- sync/event/webhook strategy: For external managers, implement provider adapters with periodic refresh and explicit cache invalidation. Use Infisical webhooks (`x-infisical-signature`) for near-real-time rotation events. For 1Password Connect, rely on local Connect caching and periodic reconciliation since request quotas primarily affect first fetches.
- pagination/error handling approach: Standardize provider clients around retries with backoff/jitter on transient failures, explicit handling for `401/403` auth errors, and provider pagination (`limit/offset` for Connect activity; provider-specific list iteration elsewhere). Add redaction middleware so request/response logs never include secret plaintext.

## Constraints and Gotchas

- Vault rate-limit quota management is a restricted endpoint requiring root/admin namespace context.
- Vault Transit API requests are subject to max payload sizing (documented 32MB default HTTP API request size).
- OpenBao documentation emphasizes Vault API compatibility, but official maintained client libraries are limited (notably official Go).
- Infisical `/raw` secret endpoints may require project settings that disable E2EE for those routes.
- Docker secrets are swarm-service scoped (not standalone containers) and capped in size (500KB); Windows containers have distinct runtime handling where secrets may be persisted in clear text on root disk while running.
- SQLCipher key setup order is strict (`PRAGMA key` before first DB touch); incorrect keys may only surface on first read attempt.

## Open Decisions

- Should Praxrr ship v1 with mandatory application-level encryption only, or include optional secret-manager providers from day one?
- Master key source of truth: Docker secrets file, environment variable, Vault/OpenBao Transit, Infisical, or 1Password Connect?
- Rotation policy: periodic automatic rotation vs manual/operator-triggered, and dual-read migration window length.
- Failure mode when external manager is unavailable: fail-closed writes only, or fail-closed reads+writes?
- Scope choice: encrypt only Arr API key fields now, or adopt SQLCipher for full-database at-rest protection immediately.
