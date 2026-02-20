# Feature Spec: API Key Masking

## Executive Summary

API key masking ensures no full credential is visible in UI, server logs, or page-load responses unless the user explicitly requests it. Arr keys are already encrypted at rest and masked in queries, but TMDB, AI, and auth keys flow as plaintext through `+page.server.ts` into SvelteKit's `__data.json` payloads. The implementation adds a shared `maskApiKey()` utility, a logger redaction interceptor, and masked display components (`••••••••ab3f` format) with reveal toggle and copy-to-clipboard.

## External Dependencies

### APIs and Services

No external APIs are required. All masking is applied to credentials already stored locally.

### Libraries and SDKs

| Library              | Version | Purpose                                     | Installation                      | Recommendation                                                                          |
| -------------------- | ------- | ------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `svelte-copy`        | 2.x     | Clipboard action with fallback for Svelte 5 | `npm install svelte-copy -D`      | Optional -- native `navigator.clipboard.writeText()` with manual fallback is sufficient |
| `@logtape/redaction` | latest  | Log redaction patterns for Deno             | `deno add jsr:@logtape/redaction` | Not recommended -- Praxrr uses custom Logger, not LogTape; inline regex is simpler      |
| `fast-redact`        | latest  | High-performance object redaction           | `npm:fast-redact`                 | Not recommended -- overkill for Praxrr's log volume                                     |

**Decision**: No new dependencies. The masking utility is a ~15-line pure function, and logger redaction uses targeted regex on field names. The existing `lucide-svelte` icons (Eye, EyeOff, Copy, Check) cover all UI needs.

### External Documentation

- [Stripe API Key Management](https://docs.stripe.com/keys): Industry-leading masking UX patterns
- [MDN Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText): Browser clipboard integration
- [SvelteKit Hooks](https://svelte.dev/docs/kit/hooks): Server hook architecture reference
- [WCAG 2.5.5 Target Size](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html): Accessibility requirements for touch targets
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): Re-authentication guidance for sensitive actions

## Business Requirements

### User Stories

**Primary User: Praxrr Operator**

- As a Praxrr operator, I want API keys shown as masked values (e.g., `••••••••ab3f`) in every UI surface so that a passerby or screen-share viewer cannot read my credentials.
- As a Praxrr operator, I want to copy a full API key to clipboard through an explicit action without the key appearing as visible text, so I can transfer the key securely.
- As a Praxrr operator, I want server logs and API responses to never contain full API key values, so that log files and debug output cannot leak credentials.

**Secondary User: Platform Admin**

- As a platform admin running Praxrr via Docker/env vars, I want environment-managed instance keys masked identically to UI-created keys so there is no display discrepancy.
- As a Praxrr developer, I want a reusable masking utility that works for all credential types so future credential surfaces are secure by default.

### Business Rules

1. **Default masked state**: Every surface displaying a credential MUST show the masked variant. Full key visibility requires explicit user action.
   - Validation: Automated tests scan `load()` return values and API responses for key-shaped strings.
   - Exception: The `regenerateApiKey` action returns the full key once (show-once pattern).

2. **Masking format**: Show last 4 characters prefixed with 8 bullet characters (`••••••••{last4}`). Keys shorter than 5 characters are masked entirely as `••••••••`. Empty/null keys display nothing.
   - Validation: Unit tests for `maskApiKey()` cover all length edge cases.

3. **On-demand key retrieval**: Full key values are fetched server-side only when the user clicks Reveal or Copy, not embedded in initial page load data.
   - Validation: E2E tests verify `__data.json` payloads contain no full keys.

4. **Logger redaction**: The logger's `meta` parameter is sanitized before serialization. Fields matching `api_key`, `apiKey`, `password`, `secret`, `token`, `authorization`, `ciphertext`, `nonce`, `master_key` are replaced with `[REDACTED]` or masked values.
   - Validation: Unit tests log objects with sensitive fields and verify redacted output.

5. **No masked values stored**: Masked values are never submitted back to the server as real keys. Form submissions always use user-entered plaintext or empty strings.
   - Validation: Existing form patterns (empty `apiKey` in edit mode) already enforce this.

### Edge Cases

| Scenario                                  | Expected Behavior                          | Notes                                       |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| Empty/null key                            | Display nothing or "Not configured"        | Copy/Reveal buttons disabled                |
| Key 1-4 chars                             | Mask entirely as `••••••••`                | Prevents full disclosure of short keys      |
| Key 5-7 chars                             | Mask entirely as `••••••••`                | Revealing 4 of 5-7 chars exposes too much   |
| Key 8+ chars                              | `••••••••{last4}`                          | Standard masking format                     |
| Decryption failure (missing master key)   | Show "Key stored (encrypted)" placeholder  | Copy/Reveal fail with error message         |
| Concurrent key rotation during copy       | Return current key or fail cleanly         | Never return partial/corrupted values       |
| Env-managed instance                      | Masked display with disabled Reveal/Copy   | Tooltip: "Managed by environment variables" |
| Browser without clipboard API (non-HTTPS) | Fallback to `document.execCommand('copy')` | Legacy textarea method                      |

### Success Criteria

- [ ] No full API key in any `+page.server.ts` load return value or API endpoint response (except show-once after regeneration)
- [ ] Masked display (`••••••••{last4}`) in all UI credential fields: Arr instances, TMDB, AI, Auth
- [ ] Copy-to-clipboard works for all stored API keys via on-demand fetch
- [ ] Logger sanitization active: logging objects with `api_key` fields produces redacted output
- [ ] `routes/arr/[id]/logs/+page.server.ts` migrated from broken `createArrClient()` to `getArrInstanceClient()`
- [ ] All existing sync/rename/upgrade tests continue passing
- [ ] Reusable `maskApiKey()` utility in `$shared/utils/masking.ts`

## Technical Specifications

### Architecture Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Client (Browser)                          │
│                                                             │
│  ┌─────────────────────┐  ┌──────────────────────────────┐ │
│  │  MaskedApiKey.svelte │  │  FormInput (private_ prop)   │ │
│  │  - Masked display    │  │  - Password input for entry  │ │
│  │  - Reveal toggle     │  │  - Eye/EyeOff toggle         │ │
│  │  - Copy button       │  │  - Write-only (create/edit)  │ │
│  └────────┬─────────────┘  └──────────────────────────────┘ │
│           │ fetch on reveal/copy                             │
└───────────┼──────────────────────────────────────────────────┘
            │
┌───────────▼──────────────────────────────────────────────────┐
│                  Server (+page.server.ts)                     │
│                                                              │
│  load() ─── maskApiKey() ──▶ masked value to client          │
│  action ─── decrypt/read ──▶ full key (on-demand only)       │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐ │
│  │  maskApiKey()     │  │  Logger + sanitizeLogMeta()      │ │
│  │  $shared/utils/   │  │  Field-name + pattern redaction  │ │
│  │  masking.ts       │  │  $logger/sanitizer.ts            │ │
│  └──────────────────┘  └──────────────────────────────────┘ │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Database Layer                                          ││
│  │  Arr: '' AS api_key (query-level masking)                ││
│  │  TMDB/AI/Auth: plaintext (masked at serialization layer) ││
│  │  Arr credentials: AES-GCM encrypted at rest              ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Data Models

No schema changes required. Masking is applied at the serialization layer, not the storage layer.

**Existing tables with credentials:**

| Table                      | Credential Field             | Current State                  | Masking Approach              |
| -------------------------- | ---------------------------- | ------------------------------ | ----------------------------- |
| `arr_instances`            | `api_key`                    | Cleared to `''` by query alias | Already masked at query level |
| `arr_instance_credentials` | `ciphertext`, `nonce`        | AES-GCM encrypted              | Never exposed to client       |
| `tmdb_settings`            | `api_key`                    | Plaintext                      | Mask in `load()` return       |
| `ai_settings`              | `api_key`                    | Plaintext                      | Mask in `load()` return       |
| `auth_settings`            | `api_key`                    | Plaintext                      | Mask in `load()` return       |
| `database_instances`       | `personal_access_token`      | Plaintext                      | Out of scope (future)         |
| `notification_services`    | `config` JSON (webhook URLs) | Plaintext                      | Out of scope (future)         |

### TypeScript Types

```typescript
// $shared/utils/masking.ts
export function maskApiKey(key: string | null | undefined, visibleChars?: number): string;

export function isMaskedValue(value: string): boolean;

// Modified response types for settings pages
// settings/general load data changes:
//   api_key: string  -->  api_key_masked: string, has_api_key: boolean
// settings/security load data changes:
//   apiKey: string   -->  apiKeyMasked: string, hasApiKey: boolean
```

### API Design

#### Response Changes

**`settings/general/+page.server.ts` load:**

```typescript
// Before:
aiSettings: { api_key: aiSetting.api_key }      // Full plaintext
tmdbSettings: { api_key: tmdbSetting.api_key }   // Full plaintext

// After:
aiSettings: { api_key_masked: maskApiKey(aiSetting.api_key), has_api_key: !!aiSetting.api_key }
tmdbSettings: { api_key_masked: maskApiKey(tmdbSetting.api_key), has_api_key: !!tmdbSetting.api_key }
```

**`settings/security/+page.server.ts` load:**

```typescript
// Before:
apiKey: authSettingsQueries.getApiKey()           // Full plaintext

// After:
apiKeyMasked: maskApiKey(authSettingsQueries.getApiKey()),
hasApiKey: authSettingsQueries.getApiKey() !== null
```

**`settings/security/+page.server.ts` regenerateApiKey action:** No change -- returns full new key (show-once pattern, acceptable since user explicitly requested regeneration).

#### New Endpoints

**Reveal actions via SvelteKit form actions (recommended):**

```typescript
// In settings/general/+page.server.ts
revealTmdbKey: async () => {
  const settings = tmdbSettingsQueries.get();
  return { revealedTmdbKey: settings?.api_key ?? '' };
},
revealAiKey: async () => {
  const settings = aiSettingsQueries.get();
  return { revealedAiKey: settings?.api_key ?? '' };
},

// In settings/security/+page.server.ts
revealAuthKey: async () => {
  const apiKey = authSettingsQueries.getApiKey();
  return { revealedAuthKey: apiKey ?? '' };
},
```

### System Integration

#### Files to Create

| File                                                             | Purpose                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/shared/utils/masking.ts`            | Shared `maskApiKey()` and `isMaskedValue()` utilities                       |
| `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`   | Logger meta sanitization with field-name and pattern-based redaction        |
| `packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte` | Reusable masked credential display with reveal toggle and copy-to-clipboard |
| `packages/praxrr-app/src/tests/base/apiKeyMasking.test.ts`       | Unit tests for masking utility and logger sanitizer                         |

#### Files to Modify

| File                                                                             | Change                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`                      | Import and apply `sanitizeLogMeta()` in `formatMeta()` and file-logging path            |
| `packages/praxrr-app/src/routes/settings/general/+page.server.ts`                | Mask TMDB and AI API keys in load return; add `revealTmdbKey` and `revealAiKey` actions |
| `packages/praxrr-app/src/routes/settings/security/+page.server.ts`               | Mask auth API key in load return; add `revealAuthKey` action                            |
| `packages/praxrr-app/src/routes/settings/security/+page.svelte`                  | Use `MaskedApiKey` component for auth key display                                       |
| `packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte` | Receive masked value; use reveal action for full key; update eye toggle pattern         |
| `packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`   | Same as TMDB                                                                            |
| `packages/praxrr-app/src/routes/settings/general/components/types.ts`            | Update interfaces: `api_key` to `api_key_masked` + `has_api_key`                        |
| `packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts`                   | Fix bug: migrate from `createArrClient()` with empty key to `getArrInstanceClient()`    |

## UX Considerations

### User Workflows

#### Primary Workflow: Viewing Masked Key

1. **Page Load**
   - User: Navigates to instance settings or general settings.
   - System: Returns masked value (`••••••••ab3f`) in page data. Full key never in payload.

2. **Reveal**
   - User: Clicks Eye icon on masked display.
   - System: Fetches full key via server action; displays in monospace font; starts 30s auto-hide timer.

3. **Copy**
   - User: Clicks Copy icon on masked display.
   - System: Fetches full key via server action; writes to clipboard; shows checkmark for 2s + toast "API key copied to clipboard". Key never rendered as visible DOM text.

4. **Auto-Hide**
   - System: After 30 seconds, revealed key automatically re-masks. Also re-masks on page navigation or tab blur.

#### Error Recovery Workflow

1. **Clipboard fails** (non-HTTPS context): Inline error: "Could not copy to clipboard. Try revealing the key and copying manually."
2. **Decryption fails** (missing master key): Error toast: "Unable to decrypt API key. Check that the encryption master key is configured."
3. **Empty key**: "No API key configured" message with disabled Copy/Reveal buttons.

### UI Patterns

| Component       | Pattern                                          | Notes                              |
| --------------- | ------------------------------------------------ | ---------------------------------- |
| Masked display  | Read-only `<code>` element with monospace suffix | Not an input field; display-only   |
| Reveal toggle   | Eye/EyeOff from lucide-svelte                    | Matches existing FormInput pattern |
| Copy button     | Copy/Check from lucide-svelte                    | 2s checkmark feedback + toast      |
| Auto-hide timer | 30s countdown, optional progress bar             | Re-masks on blur/navigation        |
| Button layout   | `[masked-value] [Copy] [Reveal]` inline          | Right-aligned action buttons       |

### Accessibility Requirements

- `aria-pressed` on reveal toggle (true = revealed, false = masked)
- `aria-controls` linking toggle to display element
- `aria-label` dynamic: "Show API key" / "Hide API key"
- `aria-live="assertive"` region for state change announcements
- All buttons keyboard-accessible with visible focus indicators (3px outline)
- Touch targets minimum 44x44px with 10px spacing (WCAG 2.5.5)
- Masked display uses `aria-label="API key ending in ab3f"` (not individual bullet chars)

### Performance UX

- **Loading states**: Spinner on reveal/copy button while fetching key from server
- **Optimistic copy**: Button transitions to checkmark immediately; error reverts
- **Error feedback**: Inline error for clipboard failures (persistent); toast for server errors (auto-dismiss 3s)

## Recommendations

### Implementation Approach

**Recommended Strategy**: Manual per-endpoint masking (Option C from research) with a centralized `maskApiKey()` utility and logger redaction as defense-in-depth. This matches existing codebase conventions, is explicit and auditable, and avoids framework-level interception complexity.

**Phasing:**

1. **Phase 1 - Foundation**: Create masking utility, mask TMDB/AI/Auth keys in load functions, update settings form components.
2. **Phase 2 - Logger & Reveal**: Implement logger redaction interceptor, add reveal form actions, build MaskedApiKey component, copy-to-clipboard via fetch.
3. **Phase 3 - Testing & Polish**: E2E verification of `__data.json` payloads, comprehensive redaction tests, error message audit, SvelteKit data payload audit.

### Technology Decisions

| Decision         | Recommendation                                   | Rationale                                                                          |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Masking layer    | Serialization (`load()` functions)               | Arr keys use query-level; TMDB/AI/Auth keys need plaintext for server-side clients |
| Logger redaction | Automatic field-name pattern matching            | Defense-in-depth; catches forgotten call sites                                     |
| Reveal mechanism | SvelteKit form actions (not page data)           | Full key never in initial page load; strict compliance with spec                   |
| UI component     | New `MaskedApiKey.svelte` (not extend FormInput) | Different interaction pattern (display vs edit); keeps FormInput focused           |
| Dependencies     | None added                                       | Masking is ~15 lines; clipboard API is native; lucide icons already installed      |
| Masking format   | `••••••••{last4}` with 8 fixed bullets           | Industry consensus; fixed width prevents key length leakage                        |

### Quick Wins

- **Mask TMDB/AI keys in settings load** (~15 min): Change `api_key: aiSetting.api_key` to `api_key_masked: maskApiKey(aiSetting.api_key)` in `settings/general/+page.server.ts`. Immediately stops keys appearing in `__data.json`.
- **Mask auth key in security page load** (~10 min): Apply `maskApiKey()` to auth key in `settings/security/+page.server.ts`. Keep `regenerateApiKey` returning full key (show-once).
- **Fix broken logs page** (~5 min): Migrate `routes/arr/[id]/logs/+page.server.ts` from `createArrClient()` with empty key to `getArrInstanceClient()`.

### Future Enhancements

- **TMDB/AI key encryption at rest**: Extend the Arr credential AES-GCM pattern to TMDB and AI keys.
- **Show-once pattern for regenerated keys**: Modal with "Copy and close" for newly generated auth keys.
- **Configurable auto-hide duration**: User preference setting (10s, 30s, 60s, disabled).
- **Optional re-authentication for reveal**: Configurable setting for shared-access environments.
- **Security dashboard integration** (#28): Masking coverage metrics and recent reveal events.
- **Audit trail integration** (#17): Log all key reveal and copy actions for security audit.
- **Secret provider adapters**: Vault/OpenBao/1Password Connect integration.

## Risk Assessment

### Technical Risks

| Risk                                        | Likelihood           | Impact                    | Mitigation                                                                |
| ------------------------------------------- | -------------------- | ------------------------- | ------------------------------------------------------------------------- |
| SvelteKit `__data.json` leaks keys          | High (current state) | High                      | Apply masking in all `load()` functions; verify with automated tests      |
| Masked value accidentally used for API auth | Medium               | High (broken connections) | Masking only in load/response; forms always use user-entered plaintext    |
| New routes bypass masking convention        | Medium               | High                      | Code review checklist; extend `arrCredentialRedactionRoutes` test pattern |
| Logger redaction regex false positives      | Low                  | Medium                    | Use targeted field-name patterns, not broad value matching                |
| Logger redaction performance overhead       | Low                  | Low                       | Negligible for Praxrr's log volume (tens-hundreds per sync cycle)         |

### Integration Challenges

- **Settings edit flow coordination**: Changing load return shapes (removing `api_key`, adding `api_key_masked`) requires atomic server + component changes.
- **Test connection with masked keys**: TMDB/AI test endpoints receive keys via POST from client form. The masking concern is about stored/loaded keys, not user-submitted ones. No change needed.
- **Auth key dual role**: The auth API key is both a display value and a security token. Masking in load means adding a reveal mechanism. The `regenerateApiKey` show-once pattern already provides a precedent.

### Security Considerations

- **Browser DevTools**: Even with UI masking, users can inspect network requests. Masking in `load()` ensures no key in initial payload; reveal endpoint responses are acceptable since user explicitly requested.
- **SvelteKit SSR serialization**: Data from `load()` is embedded in HTML. Masking prevents keys in page source.
- **Clipboard persistence**: Copied keys remain in system clipboard until overwritten. Standard behavior for all credential managers.
- **Error messages**: `decryptArrInstanceApiKey()` errors do not include key material. Logger redaction catches any accidental leakage through error objects.
- **Module-scoped caches**: `cachedApiKey` in `ai/client.ts` holds plaintext in server memory. Acceptable for server-only modules; logger redaction prevents serialization.

## Task Breakdown Preview

### Phase 1: Foundation

**Focus**: Create masking utility and apply to all key surfaces in load functions.
**Tasks**:

- Create `maskApiKey()` utility in `$shared/utils/masking.ts` with unit tests
- Mask TMDB and AI keys in `settings/general/+page.server.ts` load
- Mask auth API key in `settings/security/+page.server.ts` load
- Update TMDB/AI settings components to receive masked values (adopt "re-enter to change" pattern)
- Fix bug: migrate `arr/[id]/logs/+page.server.ts` to use `getArrInstanceClient()`

**Parallelization**: Tasks 1 (utility) must complete first; tasks 2-5 can then run in parallel.

### Phase 2: Logger & Reveal UI

**Focus**: Add logger defense-in-depth and user-facing reveal/copy capabilities.
**Dependencies**: Phase 1 complete (masking utility exists, settings return masked values).
**Tasks**:

- Implement `sanitizeLogMeta()` in `$logger/sanitizer.ts` and integrate into Logger pipeline
- Add reveal form actions to `settings/general/+page.server.ts` and `settings/security/+page.server.ts`
- Build `MaskedApiKey.svelte` component with reveal toggle and copy-to-clipboard
- Update TMDB, AI, and Auth settings pages to use MaskedApiKey component
- Extend redaction test suite to cover TMDB/AI/Auth key surfaces

**Parallelization**: Logger sanitizer and reveal actions/component are independent tracks.

### Phase 3: Testing & Polish

**Focus**: Comprehensive verification and security hardening.
**Tasks**:

- E2E tests verifying `__data.json` payloads contain no full keys
- SvelteKit data payload audit across all `load()` functions
- Error message audit for accidental key leakage
- Auto-hide timer, tab-blur re-mask, and accessibility polish

## Decisions Needed

Before proceeding to implementation planning, clarify:

1. **TMDB/AI settings UX pattern**
   - Options: (A) Empty field with "re-enter to change" like Arr instances, (B) Masked display with reveal/copy buttons
   - Impact: Option A is simpler (no reveal endpoint needed); Option B provides better UX for key verification
   - Recommendation: Option A for Phase 1, upgrade to Option B in Phase 2

2. **Auth API key display**
   - Options: (A) Mask by default, revealable on demand, (B) Show-once at regeneration then masked forever, (C) Leave as-is (password toggle)
   - Impact: Option A requires reveal endpoint; Option B is most secure; Option C is simplest
   - Recommendation: Option A -- mask in load, reveal via form action

3. **Logger redaction scope**
   - Options: (A) Field-name matching only, (B) Field-name + value-pattern matching, (C) Both with value-patterns as secondary heuristic
   - Impact: Option B catches unnamed key fields but risks false positives; Option A is targeted
   - Recommendation: Option C -- field names primary, value patterns secondary with conservative regex

4. **Non-Arr credential scope**
   - Options: (A) TMDB + AI + Auth keys only, (B) Also include database PATs and notification webhook URLs
   - Impact: Option B is more comprehensive but increases scope significantly
   - Recommendation: Option A for this feature; Option B as a follow-up

5. **Masking format confirmation**
   - Format: `••••••••{last4}` with 8 fixed bullet characters
   - Confirm: Is this the desired format for all credential types?

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Industry patterns (AWS, GitHub, Stripe, Cloudflare), library evaluation, integration code examples
- [research-business.md](./research-business.md): Domain model, data flow diagrams, workflow analysis, critical bug in logs page
- [research-technical.md](./research-technical.md): Architecture design, file-level change map, 5 technical decisions with rationale
- [research-ux.md](./research-ux.md): Competitive analysis (10+ platforms), masking format, accessibility requirements, responsive design
- [research-recommendations.md](./research-recommendations.md): Implementation approach comparison (3 options), phasing strategy, risk assessment, dependency graph
