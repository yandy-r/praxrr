# Documentation Research: API Key Masking

## Overview

Comprehensive documentation exists for API key masking across six feature-specific research files, architecture documentation, encrypted key storage prior art, and inline code documentation. The feature is well-defined: mask TMDB/AI/Auth API keys in server responses and UI, add logger redaction as defense-in-depth, and build a `MaskedApiKey.svelte` component with reveal/copy actions. The encrypted key storage feature (#9) is already implemented for Arr instances and serves as the foundational pattern. Most documentation gaps are operational (no runbook for logger redaction testing, no PR template for masking compliance).

## Architecture Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ARCHITECTURE.md`: Full codebase encyclopedia. Section 4 covers Arr Credential Storage (Encrypted at Rest) with the storage contract, migration model, and the rule that plaintext credentials must not be returned from server payloads or logged. Section 19 covers Auth and Security including API key authentication flow, session management, and the `auth_settings` data model. Section 21.6 documents the Arr HTTP client stack and `getArrInstanceClient()` decrypt-just-in-time pattern.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`: Project conventions including path aliases, server/client layout, environment variables, and the cross-Arr semantic validation policy. Critical convention: "Svelte 5, no runes" and "Routes over modals" directly impact the MaskedApiKey component design.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr HTTP client architecture documenting the class hierarchy (BaseHttpClient -> BaseArrClient -> specific clients) and the file structure. Shows where `X-Api-Key` header injection occurs in `base.ts`.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/README.md`: Auth module documentation covering auth modes (`on`, `local`, `off`, `oidc`), sequence diagrams for login flows, and API key authentication via `X-Api-Key` header or `apikey` query parameter.

## API Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml`: Root OpenAPI 3.1.0 spec. Does not currently define any instance-listing endpoint that would return API keys. The `arr` paths are for library, releases, cleanup, and episodes -- none expose credentials.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/arr.yaml`: Arr endpoint paths. Endpoints use `instanceId` query parameter; none return API key fields. No changes needed to these endpoint definitions.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/arr.yaml`: Arr response/request schema definitions. Defines `ArrType`, library item schemas, and error response shapes. No `api_key` field in any schema -- confirms the API layer is already clean.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/common.yaml`: Common schema definitions shared across API endpoints.

## Development Guides

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/DEVELOPMENT.md`: Release channels (develop/beta/stable), branching strategy (GitHub Flow), versioning (semver), conventional commit format. Relevant for release planning of the masking feature.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/CONTRIBUTING.md`: Lightweight contributing guide pointing to ARCHITECTURE.md. Covers conventions for Svelte 5, alerts, dirty tracking, routes vs modals, and the `/api/v1/*` namespace requirement.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/todo/component-check.md`: UI component audit tracking. Lists FormInput consolidation candidates and style inconsistencies. Relevant because the new MaskedApiKey component must follow the same CSS variable patterns being standardized here.

## Existing Research -- API Key Masking (Primary)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/feature-spec.md`: **REQUIRED READING**. Complete feature specification including executive summary, business rules, masking format (`••••••••{last4}`), architecture diagram, data model (no schema changes), TypeScript types for `maskApiKey()` and `isMaskedValue()`, API design showing exact load function changes for settings/general and settings/security, new files to create (4) and files to modify (8), UX workflows, accessibility requirements, phased implementation plan (3 phases), risk assessment, and 5 decisions needing confirmation.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-technical.md`: **REQUIRED READING**. File-level architecture analysis with exact line numbers for all API key surfaces (Arr, TMDB, AI, Auth), current schema for all credential tables, detailed `maskApiKey()` and `sanitizeLogMeta()` implementation code, logger integration points (`formatMeta()` line ~41, file-logging path lines ~119-125), MaskedApiKey.svelte component design, clipboard integration pattern, 5 technical decisions with rationale, and comprehensive list of all files referencing API keys.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-business.md`: **REQUIRED READING**. User stories, business rules (6 core rules), data flow diagram showing Arr API key lifecycle from input through storage to all consumer paths, domain model with all credential entities, existing codebase integration patterns, bugs found during research (critical: `arr/[id]/logs/+page.server.ts` calls broken `createArrClient()` with empty key), and success criteria.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-ux.md`: **REQUIRED READING**. Competitive analysis of 10+ platforms (Stripe, GitHub, AWS, Cloudflare, OpenAI, 1Password, Bitwarden, Radarr/Sonarr, Recyclarr, Configarr, Profilarr), masking format conventions, reveal toggle patterns, copy-to-clipboard UX, accessibility requirements (ARIA attributes, keyboard navigation, screen reader), responsive design breakpoints, error handling flows, and security UX recommendations (no re-auth needed for self-hosted context).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-external.md`: Industry patterns (AWS, GitHub, Stripe), library evaluation (4 recommended + 4 alternatives with trade-offs), integration code examples for API response masking, log sanitization, UI masking component, clipboard patterns, reveal endpoint pattern, and security edge cases. Decision: no new dependencies needed.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-recommendations.md`: Implementation recommendations with 3 option comparison (API serialization layer vs DB query layer vs manual per-endpoint), phasing strategy (3 phases, 13-15 tasks, 5-7 dev days), quick wins list, dependency graph, risk assessment with 5 technical risks, integration challenges, security edge cases (7 documented), and alternative approaches analysis. Recommends Option C (manual per-endpoint) with centralized utility and logger redaction as defense-in-depth.

## Existing Research -- Encrypted Key Storage (Related Prior Art)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/encrypted-key-storage/feature-spec.md`: Completed feature spec for Arr credential encryption. Documents the AES-GCM encryption model, `arr_instance_credentials` table, key ring management via `ARR_CREDENTIAL_MASTER_KEY`, migration `20260221`, and JIT decrypt boundary. All success criteria marked complete. Important context for understanding the existing credential infrastructure that API key masking builds upon.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/encrypted-key-storage/research-architecture.md`: Architecture analysis of the encryption integration. Documents data flow from UI entry points through query layer to consumer paths (sync, rename, upgrade). Shows integration points for encrypt/decrypt logic.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/encrypted-key-storage/research-docs.md`: Documentation index for the encrypted key storage feature. Lists must-read documents and identifies documentation gaps (missing runbook for master-key provisioning, missing operator migration checklist).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/encrypted-key-storage/analysis-code.md`: Code analysis for the encryption feature. Lists related components, implementation patterns (query-oriented persistence, SvelteKit action validation, factory-based client access, env reconciliation with savepoints), files to create and modify.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/encrypted-key-storage/research-technical.md`: Technical design details for the encryption service.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/encrypted-key-storage/research-recommendations.md`: Rollout strategy and risk controls for the encryption feature.

## Code-Level Documentation

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/middleware.ts` (line 104-108): **Existing masking precedent**. Auth middleware already masks API keys in log output using `****${apiKey.slice(-4)}` format for invalid key attempts. This is the pattern reference for the new `maskApiKey()` utility.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: Logger with no meta sanitization. Uses `JSON.stringify(meta)` in `formatMeta()` and file-logging paths. This is the primary integration point for the new `sanitizeLogMeta()` interceptor.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts`: AES-GCM encrypt/decrypt primitives. Reference implementation for the credential decryption boundary used by reveal endpoints.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: The `getArrInstanceClient()` function -- canonical JIT decrypt boundary. Shows the pattern that reveal endpoints should follow: fetch credential by instance ID, decrypt, use transiently.

## Test Documentation

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts`: **REQUIRED READING for test patterns**. Tests that layout and API endpoints do not leak Arr API keys. The new masking tests should extend this pattern to cover TMDB, AI, and Auth key surfaces.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/arrCredentialEncryption.test.ts`: Tests encrypt/decrypt round-trip for Arr credentials.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/arrCredentialCutover.test.ts`: Tests the encrypted client flow end-to-end.

## Template and Process Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/ISSUE_TEMPLATE/feature.yml`: Feature issue template. Required for creating any new tracking issues.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/ISSUE_TEMPLATE/engineering-task.yml`: Engineering task template for implementation sub-tasks.
- No PR template file exists at `.github/pull_request_template.md`. Per CLAUDE.md: "every `gh pr create` must use the repository PR template once it exists (or a `--body-file` derived from it)."

## Must-Read Documents

Implementers MUST read these documents before starting work, listed in priority order:

1. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/feature-spec.md`** -- Complete feature specification with architecture diagram, exact file changes, phased plan, and success criteria. This is the implementation blueprint.
2. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-technical.md`** -- File-level implementation guide with line numbers, TypeScript types, code examples for `maskApiKey()`, `sanitizeLogMeta()`, and `MaskedApiKey.svelte`.
3. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-recommendations.md`** -- Implementation strategy comparison, phasing, dependency graph, risk assessment, and key decisions needed.
4. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-business.md`** -- Business rules, data flow diagrams, critical bug in logs page, and success criteria.
5. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-ux.md`** -- Masking format consensus, accessibility requirements, competitive analysis, and responsive design.
6. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ARCHITECTURE.md`** (Sections 4, 19, 21.6) -- Credential storage contract, auth flow, and Arr client architecture. Essential context for understanding the existing security posture.
7. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/encrypted-key-storage/feature-spec.md`** -- Completed encryption feature that this builds upon. Understanding the AES-GCM model, `arr_instance_credentials` table, and JIT decrypt boundary is prerequisite knowledge.
8. **`/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts`** -- Test pattern to extend for TMDB/AI/Auth key masking verification.

### Nice-to-Have Reading

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-external.md` -- Library evaluations and industry patterns (useful for context but decisions are already made in recommendations).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/encrypted-key-storage/research-architecture.md` -- Encryption architecture details (useful if extending encryption to TMDB/AI keys in future).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/README.md` -- Auth module docs (useful for understanding API key authentication flow and where masking already exists in middleware).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/README.md` -- Arr client class hierarchy (useful for understanding where `X-Api-Key` header injection happens).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/todo/component-check.md` -- UI component audit (useful for CSS variable patterns that MaskedApiKey component should follow).

## Documentation Gaps

1. **No logger sanitization guide**: There is no documentation describing how logger sanitization should work, what fields should be redacted, or how to test redaction behavior. The feature spec covers the design but this should become permanent developer documentation after implementation.
2. **No credential masking convention in CLAUDE.md**: The CLAUDE.md file does not yet document the convention that all `load()` functions returning credential fields must apply `maskApiKey()`. This should be added as a convention after implementation to prevent regressions in new routes.
3. **No PR template**: The repository lacks a `.github/pull_request_template.md` file. CLAUDE.md references it as a requirement. Any PR for this feature will need a `--body-file` approach.
4. **No security best practices guide**: There is no centralized document covering Praxrr's security posture (credential handling, log redaction, response sanitization). The ARCHITECTURE.md covers it partially in sections 4 and 19, but a dedicated security guide would benefit the masking feature and future credential work.
5. **No OpenAPI spec for settings endpoints**: The settings pages (`settings/general`, `settings/security`) are SvelteKit page routes, not API routes, so they have no OpenAPI coverage. If settings masking is ever exposed via the `/api/v1/` namespace, OpenAPI schemas will need `api_key_masked` and `has_api_key` field definitions.
6. **Missing operator runbook for credential verification**: No documentation exists for operators to verify that masking is working correctly (e.g., how to check `__data.json` payloads, how to verify logger redaction in production logs).
7. **No E2E test documentation**: While the feature spec describes E2E tests for verifying `__data.json` payloads, there is no existing documentation on how E2E tests interact with the settings pages or how to set up credential fixtures for E2E testing.
