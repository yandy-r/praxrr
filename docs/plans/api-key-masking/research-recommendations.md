# Recommendations: API Key Masking

## Executive Summary

Praxrr already has strong encrypted storage for Arr instance API keys (issue #9 is substantially complete), with `arr_instances.api_key` write-blocked by SQLite triggers and runtime decryption happening just-in-time in `getArrInstanceClient()`. The remaining masking gap is narrower than expected: TMDB and AI API keys are stored and returned in plaintext from the settings page, the auth API key is returned fully visible from the security page, and the logger has no redaction layer for accidental key leakage in error messages or meta payloads. The recommended approach is a centralized masking utility (`maskApiKey()`) plus a logger redaction interceptor, applied systematically across the three remaining key surfaces (TMDB, AI, Auth) and the logger pipeline.

## Relevant Files

### API Key Surfaces (Arr -- already mostly redacted)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` -- `arrInstanceSelect` already returns `'' AS api_key`; read path is safe
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/+page.server.ts` -- list page strips `api_key` to empty string
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts` -- destructures and drops `api_key` from layout payload
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts` -- returns `api_key: ''` in load
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte` -- uses `private_` prop on FormInput; never pre-populates api_key in edit mode
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` -- decrypts JIT, passes plaintext only to client constructor
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts` -- AES-GCM encrypt/decrypt primitives
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/encryption/keys.ts` -- Key ring management

### API Key Surfaces (TMDB -- NOT redacted, needs work)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/+page.server.ts` -- returns full `tmdbSetting.api_key` and `aiSetting.api_key` in page load data
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte` -- binds full key to input, sends full key in test POST body
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/tmdbSettings.ts` -- stores plaintext `api_key` in SQLite
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/tmdb/test/+server.ts` -- receives apiKey in POST body (test endpoint, acceptable)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/tmdb/search/+server.ts` -- reads key from DB, uses server-side only (OK, no leak)

### API Key Surfaces (AI -- NOT redacted, needs work)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte` -- binds full key to input
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/aiSettings.ts` -- stores plaintext `api_key`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/ai/client.ts` -- caches plaintext API key in module-level variable `cachedApiKey`

### API Key Surfaces (Auth API Key -- partially redacted)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.server.ts` -- returns full `apiKey` from `authSettingsQueries.getApiKey()` in page load AND in `regenerateApiKey` action response
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.svelte` -- shows full key with eye toggle; has copy-to-clipboard
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/middleware.ts` -- **already masks** invalid API keys in logs (line 105: last 4 chars)

### Logger (no redaction layer)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/logger/logger.ts` -- no meta/message sanitization before write

### UI Components

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte` -- already supports `private_` prop with Eye/EyeOff toggle

### Test Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts` -- tests that layout and API endpoints do not leak Arr API keys
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/base/arrCredentialEncryption.test.ts` -- tests encrypt/decrypt round-trip

### Existing Research

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/encrypted-key-storage/research-recommendations.md` -- finalized encrypted storage deployment recommendations

## Implementation Recommendations

### Recommended Approach

The masking feature should be implemented as a layered defense with three tiers:

1. **Shared masking utility** (`$shared/utils/mask.ts`) -- a pure function `maskApiKey(key: string, visibleChars?: number): string` that returns `'••••••••' + key.slice(-visibleChars)`. Shared between server and client.
2. **Server-side load/response redaction** -- all page `load()` functions and API endpoints that return settings data must apply the mask before sending. The pattern already exists for Arr instances (return `api_key: ''`); extend it to TMDB and AI settings.
3. **Logger redaction interceptor** -- a `redactSecrets(message: string, meta?: unknown): { message: string; meta: unknown }` function injected at the `Logger.log()` pipeline entry point, scanning for known key patterns and replacing them.

### Technology Choices

| Component            | Recommendation                                   | Rationale                                                                                         |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Masking utility      | Pure function in `$shared/utils/mask.ts`         | Shareable between server and client; testable; no framework dependency                            |
| UI field masking     | Extend existing `FormInput` `private_` prop      | Already has Eye/EyeOff toggle; add optional `maskedValue` prop for server-supplied masked display |
| API response masking | Apply in each `load()` / endpoint handler        | Matches existing Arr instance pattern; explicit over implicit                                     |
| Logger redaction     | Interceptor in `Logger.log()` method             | Single chokepoint; covers console + file output                                                   |
| Clipboard            | Separate fetch-to-copy endpoint for TMDB/AI keys | Avoids sending full key in page load; requires explicit user action                               |

### Phasing Strategy

**Phase 1: Core Utility and Arr Completeness (MVP)**

- Create `maskApiKey()` utility in `$shared/utils/mask.ts`
- Verify all Arr instance surfaces are already fully redacted (they are, based on analysis)
- Add unit tests for masking utility
- Add masking to `settings/general/+page.server.ts` for TMDB and AI keys
- Estimated scope: 3-4 tasks

**Phase 2: Logger Redaction and Non-Arr Key Surfaces**

- Implement `redactSecrets()` in logger pipeline
- Create dedicated server endpoint for full-key retrieval (TMDB, AI) behind explicit action
- Update TMDB and AI settings Svelte components to show masked values and add "reveal" fetch
- Mask auth API key in page load (currently returns full key)
- Estimated scope: 5-6 tasks

**Phase 3: Comprehensive Testing and Polish**

- E2E tests verifying no key leakage in page data
- Extend `arrCredentialRedactionRoutes.test.ts` pattern to TMDB/AI/Auth
- Browser dev tools mitigation (ensure SvelteKit `__data` payloads are redacted)
- Copy-to-clipboard with fetch-on-demand for all key types
- Security posture integration (feed masking coverage into #28)
- Estimated scope: 4-5 tasks

### Quick Wins

1. **Mask TMDB/AI keys in `settings/general/+page.server.ts` load function** -- 15 minutes, high impact. Change `api_key: aiSetting.api_key` to `api_key: maskApiKey(aiSetting.api_key)`. Same for TMDB. This immediately stops keys from appearing in SvelteKit's `__data.json` payload visible in browser dev tools.

2. **Apply `maskApiKey()` to auth API key in security page load** -- 10 minutes. Change `apiKey` in the load return to `maskApiKey(apiKey)`. Regeneration action can still return the full key once (show-once pattern).

3. **Auth middleware already masks** -- line 105 of `middleware.ts` already does `****${apiKey.slice(-4)}` for invalid key logging. This is a good pattern reference.

## Improvement Ideas

### Related Features

- **Show-once pattern for newly regenerated keys** -- When the auth API key is regenerated, show the full key exactly once with a "Copy and close" modal. After dismissal, only the masked version is ever shown again. This matches industry patterns (GitHub, Stripe).
- **Key presence indicator** -- Instead of showing a masked key value, show a status indicator ("Configured" / "Not configured") with a separate "Reveal" action that requires re-authentication.
- **Secret change audit trail** -- Log all key creation, rotation, and reveal events to feed into #17 (Audit Trail).

### Future Enhancements

- **Key rotation UI** -- Guided flow for rotating `ARR_CREDENTIAL_MASTER_KEY` with visual confirmation of re-encryption status per instance.
- **Security dashboard** -- Aggregate key age, last rotation date, masking coverage status, and recent reveal events into a single view for #28.
- **Secret provider adapters** -- Vault/OpenBao/1Password Connect integration as noted in the encrypted storage research. Masking remains relevant even with external providers since UI display still needs it.
- **Content Security Policy headers** -- Add CSP headers to prevent exfiltration of any accidentally exposed key material via XSS.

### Integration with Encrypted Storage (#9)

The encrypted storage implementation is already live for Arr instance credentials. The masking feature complements it by:

1. **Ensuring the decrypted key never reaches the client** -- `getArrInstanceClient()` decrypts JIT on the server; the masking layer ensures no route accidentally passes it through. This is already working correctly.
2. **Extending the pattern to TMDB and AI keys** -- These are currently stored in plaintext. Phase 1 masks them in transit to the UI. A future Phase 4 (or part of #9 expansion) would encrypt them at rest using the same `AES-GCM` envelope pattern, with separate key versions if needed.
3. **Design for encryption readiness** -- The masking utility should accept both raw strings and a "key is encrypted" flag, so that when TMDB/AI keys move to encrypted storage, the masking code path does not change.

## Risk Assessment

### Technical Risks

| Risk                                                       | Likelihood           | Impact                    | Mitigation                                                                                                              |
| ---------------------------------------------------------- | -------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Masked value accidentally used for API authentication      | Medium               | High (broken connections) | Masking only in load/response; form submissions always take user-entered plaintext; never store masked values           |
| SvelteKit `__data.json` leaks keys in serialized page data | High (current state) | High                      | Apply masking in all `load()` functions before return; verify with automated tests                                      |
| Logger redaction regex too aggressive (false positives)    | Low                  | Medium                    | Use targeted key-format patterns, not broad matching; start with explicit field-name-based redaction in `meta` objects  |
| New code paths bypass masking                              | Medium               | High                      | Establish convention: all API key fields in load returns go through `maskApiKey()`; add ESLint rule or review checklist |
| Logger redaction performance overhead                      | Low                  | Low                       | Pattern matching on log message strings is fast; meta object walking is bounded by depth; benchmark if concerned        |

### Integration Challenges

1. **TMDB/AI test connection endpoints need full keys** -- The test endpoints (`/arr/test`, `/api/tmdb/test`) receive keys via POST body from the client. This is acceptable because the key is user-entered in the form field and transmitted over the existing authenticated session. The masking concern is about stored/loaded keys, not user-submitted ones.

2. **Settings page edit flow** -- If the load function returns a masked TMDB key, the user cannot "test connection" with the masked value. Two solutions:
   - **Option A (simpler)**: Leave the key field blank on load (like Arr instances do), requiring re-entry to save. This is the existing Arr pattern.
   - **Option B (better UX)**: Show masked value for display only; add a "reveal" button that fetches the full key via a dedicated authenticated endpoint. The test connection and save flows use the revealed/re-entered value.
   - Recommendation: Start with Option A for consistency with existing Arr UI pattern.

3. **Sync pipeline needs unmasked keys internally** -- `getArrInstanceClient()` already handles this correctly by decrypting from `arr_instance_credentials`. No change needed for the sync pipeline. TMDB and AI clients read directly from DB server-side, also no change needed.

4. **Auth API key is both a display value and a security token** -- The security settings page shows the key so the user can copy it. Masking it in page load means the user needs a "reveal" mechanism. This is more complex than the TMDB/AI case because the auth key is used for external API authentication and users need to be able to retrieve it.

### Security Edge Cases

1. **Error messages containing keys** -- If `decryptArrInstanceApiKey()` throws, the error message does NOT include the key (it says "Unable to decrypt Arr API key"). Good. However, `JSON.stringify(error)` in logger meta could include the full error object including any key material passed to the throwing function. The logger redaction layer addresses this.

2. **Stack traces** -- `Logger.errorWithTrace()` writes `error.stack` to file. Stack traces could contain API key values if they appear in function arguments. Mitigation: the redaction interceptor should also process stack trace strings.

3. **SvelteKit form action responses** -- When `regenerateApiKey` returns `{ apiKey: newKey }`, this goes through SvelteKit's form serialization and appears in the network tab. This is intentional (show-once pattern) but should be flagged in documentation.

4. **Database backup files** -- TMDB and AI keys are stored in plaintext in `praxrr.db`. Database backups (if unencrypted) expose these. Future #9 expansion should encrypt them. Masking does not address this; it is an at-rest encryption concern.

5. **Environment variables** -- Arr API keys appear in env vars like `RADARR_INSTANCE_API_KEY_1`. The startup logger in `envInstances.ts` already filters these out of the reconciliation debug log (it logs `type, index, name, url, enabled, tagCount` but NOT `apiKey`). However, the raw env var could appear in process listings or Docker inspect output. This is outside Praxrr's control.

6. **BaseArrClient stores apiKey in instance field** -- `BaseArrClient` (line 32-43 of `base.ts`) stores `this.apiKey = apiKey` as a private field and also passes it as a header. If the client object is accidentally serialized (e.g., logged), the key could leak. The private field is not enumerable by default in JS, but `JSON.stringify` on the headers object would expose `X-Api-Key`. The logger redaction layer should catch `X-Api-Key` header values.

7. **AI client caches key in module scope** -- `cachedApiKey` in `ai/client.ts` (line 78) holds the plaintext AI key in a module-level variable. This is a server-only module, so it is not exposed to the client, but it could appear in heap dumps or process inspection.

## Alternative Approaches

### Option A: API Serialization Layer (Response Middleware)

**Description**: Create a SvelteKit `handle` hook or response transformer that scans all outgoing JSON responses for fields matching `api_key`, `apiKey`, `X-Api-Key` and replaces their values with masked versions.

**Pros**:

- Single implementation point; covers all endpoints automatically
- Cannot be bypassed by new routes forgetting to mask

**Cons**:

- Performance cost of parsing and scanning every JSON response body
- False positives (e.g., a field named `api_key_configured` being treated as a key)
- SvelteKit page data is serialized through `devalue`, not JSON -- would need to intercept at a different layer
- Difficult to allow intentional full-key returns (like regenerateApiKey show-once pattern)
- Opaque behavior -- hard to debug when masking happens unexpectedly

**Effort**: Medium-High (3-4 days). Requires careful integration with SvelteKit internals.

### Option B: Database Query Layer (Kysely Plugin/Hook)

**Description**: Add a Kysely query interceptor or post-query transformer that automatically masks any `api_key` column value returned from SELECT queries.

**Pros**:

- Catches all DB read paths regardless of which route uses them
- Clean separation of concerns

**Cons**:

- Praxrr uses raw SQL via `db.query()` and `db.execute()`, not Kysely query builder -- there is no Kysely plugin hook to intercept
- The `arrInstancesQueries` already returns `'' AS api_key` in the SQL itself -- this pattern is already in use but manually
- Would break server-side code that legitimately needs the plaintext key for authentication (TMDB, AI clients read the key from DB)
- Requires distinguishing "masking for client output" from "reading for server-side use" at the query layer, which is the wrong level of abstraction

**Effort**: High (4-5 days). Would require significant refactoring of the database layer.

### Option C: Manual Per-Endpoint Masking

**Description**: Apply masking individually in each `load()` function, API endpoint handler, and form action that returns key material. This is what the Arr instance routes already do.

**Pros**:

- Explicit and easy to understand -- each route is self-documenting about what it redacts
- Follows existing codebase pattern (`arrInstancesQueries` returning `'' AS api_key`, layout destructuring out `api_key`)
- No framework-level integration needed
- Easy to allow intentional full-key returns where needed
- Lowest risk of regression or unintended behavior

**Cons**:

- Requires discipline -- new routes must remember to apply masking
- Coverage depends on developer awareness and code review
- No automatic safety net for forgotten endpoints

**Effort**: Low-Medium (1-2 days for initial coverage, ongoing for new routes).

### Recommendation

**Option C (Manual Per-Endpoint)** is the recommended approach, supplemented with:

- A centralized `maskApiKey()` utility to ensure consistent masking format
- A logger redaction interceptor as a defense-in-depth measure
- Test patterns (like `arrCredentialRedactionRoutes.test.ts`) extended to cover all key surfaces
- A code review checklist item for any route that touches settings or credentials

This matches the existing codebase conventions, is the simplest to implement, and avoids the complexity and risk of framework-level interception. The logger redaction layer provides the automatic safety net that Option C otherwise lacks.

## Task Breakdown Preview

### Phase 1: Foundation (3-4 tasks, no cross-dependencies)

1. **Create masking utility** -- `$shared/utils/mask.ts` with `maskApiKey()` and `isApiKeyLike()` functions. Unit tests in `$tests/base/apiKeyMasking.test.ts`.
2. **Mask TMDB/AI keys in settings load** -- Update `settings/general/+page.server.ts` to apply `maskApiKey()` before returning `aiSettings.api_key` and `tmdbSettings.api_key`.
3. **Mask auth API key in security page load** -- Update `settings/security/+page.server.ts` to return masked key in load; keep `regenerateApiKey` action returning full key (show-once).
4. **Update TMDB/AI settings forms** -- Change the AI and TMDB settings Svelte components to use the same "re-enter to change" pattern as the Arr instance form (empty field on load, `private_` prop).

### Phase 2: Logger and Comprehensive Coverage (5-6 tasks)

5. **Logger redaction interceptor** -- Add `redactSecrets()` to `Logger.log()` pipeline. Scan `message` string and `meta` object for patterns matching API key formats. Cover `formatMeta()` and `errorWithTrace()`.
6. **Key reveal endpoint** -- Create `GET /api/v1/settings/key-reveal?type=tmdb|ai|auth` server endpoint that returns the full key after authentication check. Rate-limit or require re-auth for sensitive operations.
7. **Add reveal toggle to TMDB/AI settings** -- Update Svelte components to fetch full key on-demand via the reveal endpoint. Show masked value by default.
8. **Auth API key reveal UX** -- Update security page to show masked key by default, with a "Reveal" button that calls the reveal endpoint.
9. **Copy-to-clipboard via fetch** -- Update clipboard handlers to fetch the full key on-demand rather than reading from page data.
10. **Extend redaction tests** -- Create `apiKeyRedactionSettings.test.ts` verifying TMDB, AI, and Auth key surfaces do not leak in load data.

### Phase 3: Polish and Security Hardening (4-5 tasks)

11. **E2E masking verification** -- Add Playwright tests verifying `__data.json` payloads do not contain full keys on settings pages.
12. **SvelteKit data payload audit** -- Systematically verify every `load()` function and form action in the codebase for accidental key leakage.
13. **Error message audit** -- Grep for `error.message` and `JSON.stringify(error)` patterns near API key handling code; ensure no key material leaks through error paths.
14. **Documentation** -- Update `CLAUDE.md` with masking conventions; add developer guide for handling API keys in new features.
15. **Security posture integration** -- Define masking coverage metrics for #28 security dashboard.

### Estimated Complexity

- **Total tasks**: 13-15
- **Critical path**: Phase 1 tasks 1-4 (foundation, independent of each other), then Phase 2 tasks 5 and 10 (logger + tests)
- **Parallelization opportunities**: Phase 1 tasks 1-4 are fully independent. Phase 2 tasks 6-9 (reveal endpoints and UI) can parallelize. Phase 3 tasks 11-15 are mostly independent.
- **Estimated effort**: 5-7 developer days total across all phases.

### Dependency Graph

```
Phase 1 (all parallel):
  [1] maskApiKey utility
  [2] Settings load masking -----> depends on [1]
  [3] Auth page load masking ----> depends on [1]
  [4] TMDB/AI form updates ------> depends on [2]

Phase 2:
  [5] Logger redaction ----------> depends on [1]
  [6] Key reveal endpoint -------> independent
  [7] TMDB/AI reveal toggle -----> depends on [4] and [6]
  [8] Auth key reveal UX --------> depends on [3] and [6]
  [9] Copy-to-clipboard fetch ---> depends on [6]
  [10] Redaction tests ----------> depends on [2] and [3]

Phase 3:
  [11-15] all depend on Phase 2 completion
```

## Key Decisions Needed

1. **Masking format**: `••••••••ab3f` (last 4 chars) vs `••••••••` (no visible chars) vs `tmdb_****ab3f` (prefix + last 4). The issue specifies last 4 chars. Confirm this is the desired format for all key types (Arr, TMDB, AI, Auth).

2. **Empty-field vs masked-display for settings forms**: Should TMDB and AI settings show a masked value (like `••••ab3f`) or an empty field (like Arr instances)? Empty field is simpler and already proven in the codebase. Masked display requires a reveal mechanism.

3. **Auth API key: mask in load or keep show-always?** The current security page shows the full key at all times with a password toggle. The issue implies masking it. Should the key be:
   - (a) Masked by default, revealable on demand (like a password manager)
   - (b) Only shown at generation time, then masked forever (show-once pattern)
   - (c) Left as-is since it is already behind the password toggle UI

4. **Logger redaction scope**: Should the logger redact based on:
   - (a) Known key field names in meta objects (`api_key`, `apiKey`, `X-Api-Key`)
   - (b) Regex patterns matching common API key formats (hex strings of known lengths, JWT-like strings)
   - (c) Both

5. **Key reveal authentication**: Should revealing a masked key require re-entering the user password, or is the existing session authentication sufficient?

## Open Questions

1. **TMDB/AI key encryption at rest** -- Should this feature also encrypt TMDB and AI keys in the database (extending the Arr credential pattern)? Or is that deferred to a future #9 expansion? The masking feature works regardless, but storage encryption would provide defense-in-depth.

2. **Database instance tokens** -- The `database_instances` table has a `personal_access_token` field for Git operations. Should this also be masked and/or encrypted? It was not mentioned in the issue but represents a credential surface.

3. **Compose file key references** -- The `compose.yml` and `compose.dev.yml` files reference API keys via `${PRAXRR_RADARR_API_KEY}` etc. These are environment variable references, not literal keys. Should the README/documentation warn about not hardcoding keys in compose files?

4. **Rate limiting on key reveal** -- If a reveal endpoint is created, should it be rate-limited to prevent brute-force enumeration? The endpoint would already be behind authentication, but additional protection may be warranted.

5. **Backward compatibility** -- Are there any external integrations or API consumers that expect full API keys in responses? The `/api/v1/` namespace has no key-returning endpoints currently, but future API work should be checked.
