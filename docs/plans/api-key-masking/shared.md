# API Key Masking

Praxrr manages credentials across four surfaces: Arr instance API keys (already encrypted at rest via AES-GCM in `arr_instance_credentials` and masked at query level with `'' AS api_key`), TMDB read tokens, AI API keys, and Praxrr auth API keys -- the latter three flow as plaintext from singleton settings queries through `+page.server.ts` load functions into SvelteKit's `__data.json` payloads. The implementation adds a shared `maskApiKey()` utility at `$shared/utils/masking.ts`, a logger redaction interceptor at `$logger/sanitizer.ts`, reveal form actions for on-demand key retrieval, and a `MaskedApiKey.svelte` display component with reveal toggle and copy-to-clipboard -- following the existing Arr credential stripping pattern of masking at the serialization boundary while preserving full-key access for server-side consumers (TMDB client, AI client, auth middleware).

## Relevant Files

### Files to Create

- packages/praxrr-app/src/lib/shared/utils/masking.ts: Shared `maskApiKey()` and `isMaskedValue()` utility functions (pure, no dependencies, follows `uuid.ts`/`dates.ts` pattern)
- packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts: Logger meta sanitizer with field-name pattern matching and value-pattern heuristics for `[REDACTED]` replacement
- packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte: Display-only masked credential component with Eye/EyeOff reveal toggle, Copy/Check clipboard button, and 30s auto-hide timer
- packages/praxrr-app/src/tests/base/apiKeyMasking.test.ts: Unit tests for masking utility, logger sanitizer, and settings load redaction verification

### Files to Modify -- Server Load Functions (Exposure Points)

- packages/praxrr-app/src/routes/settings/general/+page.server.ts: Mask TMDB key (line 62) and AI key (line 58) in load return; add `revealTmdbKey` and `revealAiKey` form actions
- packages/praxrr-app/src/routes/settings/security/+page.server.ts: Mask auth API key (line 18) in load return; add `revealAuthKey` form action; keep `regenerateApiKey` show-once unchanged
- packages/praxrr-app/src/routes/settings/general/components/types.ts: Update `AISettings` and `TMDBSettings` interfaces: replace `api_key: string` with `api_key_masked: string` + `has_api_key: boolean`

### Files to Modify -- UI Components

- packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte: Replace direct `bind:value={settings.api_key}` pattern with MaskedApiKey display + separate input for editing; update test connection to use user-entered key
- packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte: Same pattern change as TMDB -- masked display with separate edit input
- packages/praxrr-app/src/routes/settings/security/+page.svelte: Replace inline `FormInput private_ readonly` with MaskedApiKey; update `copyApiKey()` to use reveal action; preserve `regenerateApiKey` show-once flow
- packages/praxrr-app/src/routes/settings/general/+page.svelte: Update prop passing to match new masked field names from load data

### Files to Modify -- Logger

- packages/praxrr-app/src/lib/server/utils/logger/logger.ts: Import and apply `sanitizeLogMeta()` in `formatMeta()` (line 40-43) and file-logging entry construction (lines 119-125)

### Files to Modify -- Bug Fix

- packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts: Fix broken logs page (line 25) -- migrate from `createArrClient(instance.type, instance.url, instance.api_key)` with always-empty key to `getArrInstanceClient(instance.type, instance.id, instance.url)`

### Reference Files (Read-Only Context)

- packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts: `arrInstanceSelect` SQL constant (line 48-62) with `'' AS api_key` -- the gold standard query-level masking pattern
- packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts: Arr layout destructuring (line 18) that strips `api_key` from instance -- second defense layer pattern
- packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte: "Re-enter to change" pattern for write-only credential entry (line 78: `apiKey: ''`)
- packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts: `getArrInstanceClient()` decrypt-on-demand pattern (lines 54-98) -- model for reveal endpoint design
- packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts: AES-GCM encrypt/decrypt primitives and HMAC fingerprinting
- packages/praxrr-app/src/lib/server/utils/auth/middleware.ts: Existing masking precedent (line 105: `****${apiKey.slice(-4)}`) for invalid key logging
- packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte: `private_` prop implementation (lines 114-148) -- Eye/EyeOff toggle pattern reference
- packages/praxrr-app/src/lib/server/db/queries/tmdbSettings.ts: TMDB singleton settings queries (`get()`, `update()`)
- packages/praxrr-app/src/lib/server/db/queries/aiSettings.ts: AI singleton settings queries (`get()`, `update()`)
- packages/praxrr-app/src/lib/server/db/queries/authSettings.ts: Auth singleton settings queries with `getApiKey()`, `regenerateApiKey()`, `validateApiKey()`
- packages/praxrr-app/src/lib/server/utils/logger/types.ts: Logger types (`LogOptions.meta` is `unknown`, `LogEntry.meta` is `unknown`)
- packages/praxrr-app/src/lib/client/alerts/store.ts: AlertStore for user feedback (`alertStore.add(type, message)`)
- packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts: Redaction test pattern with `assertPayloadNoLeak()` -- extend for TMDB/AI/Auth
- packages/praxrr-app/src/tests/base/BaseTest.ts: Test infrastructure with `installPatch()` for monkey-patching and `assertPayloadNoLeak()` helper
- packages/praxrr-app/src/routes/settings/notifications/edit/[id]/+page.server.ts: Notification webhook URL stripping pattern (lines 24-25) -- another existing server-side masking example

## Relevant Tables

- tmdb_settings: Singleton (id=1) with `api_key TEXT NOT NULL DEFAULT ''` -- plaintext TMDB read access token, needs masking in load
- ai_settings: Singleton (id=1) with `api_key TEXT NOT NULL DEFAULT ''` -- plaintext AI provider key, needs masking in load
- auth_settings: Singleton (id=1) with `api_key TEXT` (nullable) -- Praxrr auth API key (32-char hex), needs masking in load
- arr_instances: Multi-row with `api_key TEXT NOT NULL` -- already masked via `'' AS api_key` in query constant; no changes needed
- arr_instance_credentials: Per-instance `ciphertext`, `nonce`, `key_version`, `fingerprint` -- AES-GCM encrypted Arr keys; never exposed to client

## Relevant Patterns

**Query-Level Credential Masking**: Arr instances use `'' AS api_key` in the shared `arrInstanceSelect` SQL constant, preventing any query from returning the raw value. See [packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts](packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts) lines 48-62.

**Layout-Level Credential Exclusion**: The Arr layout server destructures out `api_key` before returning instance data to child routes as a second defense layer. See [packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts](packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts) line 18.

**Server-Side Field Stripping**: The notification edit page strips `webhook_url` from parsed config before returning to client. See [packages/praxrr-app/src/routes/settings/notifications/edit/[id]/+page.server.ts](packages/praxrr-app/src/routes/settings/notifications/edit/[id]/+page.server.ts) lines 24-25.

**Write-Only Credential Entry**: Arr instance forms and database instance forms never pre-populate credential fields in edit mode (`apiKey: ''` in dirty tracking init); users must re-enter credentials to save changes. See [packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte](packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte) line 78.

**SvelteKit Form Actions**: Settings pages use named form actions (`?/actionName`) with `use:enhance` for progressive enhancement; actions parse `formData`, validate, call query module, and return `fail()` or `{ success: true }`. See [packages/praxrr-app/src/routes/settings/general/+page.server.ts](packages/praxrr-app/src/routes/settings/general/+page.server.ts) lines 192-236.

**Show-Once Key Return**: The `regenerateApiKey` action returns the full new key in the action response for one-time display, while the load function will return masked; the client reactive statement `$: apiKey = form?.apiKey ?? data.apiKey` provides correct precedence. See [packages/praxrr-app/src/routes/settings/security/+page.server.ts](packages/praxrr-app/src/routes/settings/security/+page.server.ts) line 97.

**Redaction Test Pattern**: The `arrCredentialRedactionRoutes.test.ts` uses `installPatch()` to mock queries, calls `load()` directly with mock params, and uses `assertPayloadNoLeak(payload, SECRET_KEY, 'context')` to verify no plaintext leaks. See [packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts](packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts) lines 196-239.

**Shared Utility Pattern**: Shared utilities in `$shared/utils/` are individual `.ts` files exporting pure functions with JSDoc documentation; no class wrappers. See [packages/praxrr-app/src/lib/shared/utils/uuid.ts](packages/praxrr-app/src/lib/shared/utils/uuid.ts) and [packages/praxrr-app/src/lib/shared/utils/dates.ts](packages/praxrr-app/src/lib/shared/utils/dates.ts).

## Relevant Docs

**docs/plans/api-key-masking/feature-spec.md**: You _must_ read this when working on any masking task -- it contains the implementation blueprint with architecture diagram, exact file changes, masking format (`{8 bullets}{last4}`), TypeScript types, API design, UX workflows, phasing strategy, risk assessment, and 5 open decisions.

**docs/plans/api-key-masking/research-technical.md**: You _must_ read this when implementing `maskApiKey()`, `sanitizeLogMeta()`, or `MaskedApiKey.svelte` -- it provides file-level implementation guidance with exact line numbers, code examples, and 5 technical decisions with rationale.

**docs/plans/api-key-masking/research-patterns.md**: You _must_ read this when implementing any masking task -- it catalogs all relevant coding patterns, naming conventions, form action structures, and testing approaches with concrete file paths and line references.

**docs/plans/api-key-masking/research-integration.md**: You _must_ read this when modifying settings routes or UI components -- it documents exact current implementations of TMDB/AI/Auth key handling with line numbers, schema details, and edge cases.

**docs/plans/api-key-masking/research-architecture.md**: You _must_ read this when understanding the overall credential data flow -- it maps all credential surfaces, existing masking patterns, logger gaps, and integration points.

**docs/plans/api-key-masking/research-business.md**: You _must_ read this when defining test cases or validating business rules -- it contains user stories, edge case table, data flow diagrams, and the critical bug in `arr/[id]/logs/+page.server.ts`.

**docs/plans/api-key-masking/research-ux.md**: You _must_ read this when building the MaskedApiKey component -- it covers competitive analysis, accessibility requirements (ARIA attributes, keyboard navigation, screen reader), masking format conventions, and responsive design.

**docs/plans/encrypted-key-storage/feature-spec.md**: You _must_ read this when working on reveal endpoints or the logs page bug fix -- it documents the AES-GCM encryption model, `arr_instance_credentials` table, and JIT decrypt boundary that this feature builds upon.

**docs/ARCHITECTURE.md** (Sections 4, 19, 21.6): You _must_ read this when touching credential storage, auth, or Arr client architecture -- it covers the credential storage contract, auth flow, and `getArrInstanceClient()` decrypt-just-in-time pattern.

**packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts**: You _must_ read this when writing masking tests -- it provides the exact test pattern (`installPatch` -> call `load()` -> `assertPayloadNoLeak()`) to extend for TMDB/AI/Auth key surfaces.
