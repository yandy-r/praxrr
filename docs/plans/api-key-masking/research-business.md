# Business Logic Research: API Key Masking

## Executive Summary

Praxrr manages Arr instance API keys that flow through three layers: database storage (now encrypted via `arr_instance_credentials`), server-side operations (sync, rename, upgrade jobs), and UI/API surfaces. The encrypted key storage feature (#9) already solved at-rest encryption, but API keys can still leak through server log metadata objects, unguarded API response payloads, and the UI must be enhanced with proper masked display and controlled reveal/copy workflows. This feature (#8) closes the remaining exposure surfaces so that no full API key is visible outside the encrypted store unless the user explicitly requests it.

## User Stories

### Primary

- **As a Praxrr operator**, I want API keys shown as masked values (e.g., `************ab3f`) in every UI surface so that a passerby or screen-share viewer cannot read my Arr credentials.
- **As a Praxrr operator**, I want to copy a full API key to clipboard through an explicit action (click-to-copy button) without the key ever appearing in the DOM as visible text, so I can transfer the key to another tool securely.
- **As a Praxrr operator**, I want server logs and API responses to never contain full API key values, so that log files, debug output, and API integrations cannot leak credentials.

### Secondary

- **As a platform admin running Praxrr via Docker/env vars**, I want environment-managed instance keys to be masked identically to UI-created keys so there is no discrepancy in how credentials are displayed.
- **As a Praxrr developer**, I want a reusable masking utility that works for all credential types (Arr API keys, TMDB tokens, AI API keys, database PATs, Discord webhook URLs, Praxrr auth API keys) so future credential surfaces are secure by default.
- **As a security auditor**, I want to verify via automated tests that no full API key appears in API responses, server load data, or log output.

### What Security Problems Masking Solves

1. **Shoulder surfing**: Full keys visible on screen during demos, screen-shares, or in shared environments.
2. **Log exfiltration**: API keys serialized into `meta` objects of log entries (both file and console) are readable by anyone with log access.
3. **API response leakage**: Any endpoint returning instance data could expose keys to browser devtools, proxy interceptors, or downstream API consumers.
4. **Clipboard pollution**: Without controlled copy, users may inadvertently paste keys into chat or documents.

## Business Rules

### Core Masking Rules

1. **Masking format**: Show only the last 4 characters, prefixed with bullet characters. Format: `••••••••{last4}`. For keys shorter than 5 characters, mask the entire value as `••••`. For empty/null keys, display nothing or a placeholder like "Not set".
2. **Masking is the default state**: Every surface that displays a credential MUST show the masked variant. Full key visibility requires an explicit user action.
3. **Reveal toggle (optional)**: A "show/hide" toggle may reveal the full key in the UI for a limited time. Reveal should require the key to be decrypted server-side and fetched on demand (not embedded in page data).
4. **Copy-to-clipboard**: The full key value is retrieved server-side only when the user clicks a "Copy" button. The key is written directly to the clipboard without being rendered in visible DOM text.
5. **API responses never include full keys**: All API endpoints and SvelteKit `load` functions that return instance data must exclude `api_key` (or return the masked version). The current pattern of `'' AS api_key` in `arrInstanceSelect` is a starting point but must be standardized.
6. **Server logs never include full keys**: The logger's `meta` parameter must be sanitized before serialization. Any object containing `api_key`, `apiKey`, `personal_access_token`, or similar fields must have those values masked or removed.

### When Full Keys Should Be Accessible

- **Server-side only**: Decrypt operations for sync/rename/upgrade jobs via `getArrInstanceClient()` -- these already use the encrypted credential store and never expose plaintext to the UI.
- **Test connection flow**: The `/arr/test` endpoint receives a plaintext key from the user's form submission (before storage) and uses it for an ephemeral connection test. This is acceptable because the key originates from the user's input in the same request.
- **Copy-to-clipboard API**: A dedicated server endpoint decrypts the stored key and returns it as a single-use response for clipboard write. This endpoint should require authentication and return the key as a transient response (not cached).

### Validation Requirements

- Masked values must never be submitted back to the server as if they were real keys. The InstanceForm already handles this correctly by initializing `apiKey: ''` in edit mode.
- Empty string (`''`) API key in the `arrInstanceSelect` SQL alias must be treated as "no key available for display" -- not a valid credential.
- The fingerprint field (`api_key_fingerprint`) can be safely returned to the UI for identification/deduplication purposes.

### Edge Cases

1. **Empty keys**: Display "Not configured" or leave blank. No masking needed.
2. **Very short keys (1-4 chars)**: Mask entirely as `••••` to prevent full disclosure.
3. **Keys exactly 5 chars**: Show `•{last4}` -- but this reveals 80% of the key. Safer to mask entirely for keys under 8 chars.
4. **Multiple credential types**: TMDB API keys, AI API keys, database PATs, Discord webhook URLs, and Praxrr auth API keys all need masking. The utility must be generic.
5. **Environment-managed instances**: `source = 'env'` instances have `canEditCoreConnectionFields = false`. Masking display and copy behavior should still work; reveal/edit is blocked.
6. **Decryption failure**: If the master key is missing or rotated, the masked display should still work (show a "Key stored (encrypted)" placeholder) even though copy/reveal will fail with an error.
7. **Concurrent key updates**: If a user copies a key while another admin rotates it, the copy should either succeed with the current key or fail cleanly -- never return a partial or corrupted value.

## Workflows

### 1. Adding a New Arr Instance (Entering API Key for First Time)

1. User navigates to `/arr/new`.
2. User enters name, type, URL, and API key in the `InstanceForm`.
3. The API key field uses `FormInput` with `private_` prop, rendering as a password-type input with an eye toggle.
4. User clicks "Test Connection" -- the plaintext key is POSTed to `/arr/test` for ephemeral validation. Key is not stored.
5. User clicks "Save" -- form submits to `routes/arr/new/+page.server.ts`. The action encrypts the key via `encryptArrInstanceApiKey()`, stores the credential in `arr_instance_credentials`, and stores an empty `api_key` in `arr_instances` (enforced by DB trigger).
6. After redirect to `/arr/{id}/settings`, the instance loads with `api_key: ''` (from `arrInstanceSelect`). The UI shows the masked API key field with "Re-enter API key to save changes" description.
7. **Masking impact**: No change to creation workflow. The key is already handled securely on input. The only addition is ensuring the redirect/subsequent page does not leak the key.

### 2. Viewing Instance Details (Seeing Masked Key)

1. User navigates to `/arr` (instance list) or `/arr/{id}/settings`.
2. `routes/arr/+page.server.ts` calls `arrInstancesQueries.getAll()`, which uses `arrInstanceSelect` returning `'' AS api_key`. The server-side `load` function also explicitly destructures out the api_key field.
3. **Current behavior**: The instance list does not display API keys at all. The settings page shows an empty password field.
4. **Desired behavior**: Instead of an empty field, show a masked representation: `••••••••ab3f` (derived from the fingerprint or last 4 chars of the stored key). This provides confirmation that a key is configured without exposing it.
5. **Implementation note**: The masked display value can be computed server-side by decrypting the key, taking the last 4 chars, and prepending bullets. Alternatively, store a `display_hint` (last 4 chars) at encryption time to avoid runtime decryption for display.

### 3. Copying API Key to Clipboard

1. User is on `/arr/{id}/settings` and clicks a "Copy Key" button (new UI element).
2. The button triggers a client-side `fetch` to a new server endpoint (e.g., `POST /arr/{id}/key/copy` or `POST /api/v1/arr/instances/{id}/key`).
3. The endpoint authenticates the request, decrypts the stored credential via `arrInstanceCredentialsQueries.getByInstanceId()` + `decryptArrInstanceApiKey()`, and returns the plaintext key.
4. The client receives the key and writes it to `navigator.clipboard.writeText()` without rendering it in visible DOM.
5. A success alert is shown: "API key copied to clipboard".
6. The plaintext key is immediately discarded from JavaScript memory (not stored in component state beyond the clipboard operation).

### 4. Revealing Full API Key (Optional Confirm/Re-auth)

1. User clicks a "Reveal" toggle button on the masked API key display.
2. The client fetches the full key from the same server endpoint as copy.
3. The key is displayed in the input field (switching from password to text type) for a limited duration (e.g., 30 seconds), then auto-hides.
4. **Optional re-auth**: For enhanced security, the reveal action could require re-entering the user password. This is a future enhancement and not required for initial implementation.
5. **Env-managed instances**: Reveal works the same way -- the key is stored encrypted regardless of source.

### 5. Editing/Updating an API Key

1. User navigates to `/arr/{id}/settings` with `source = 'ui'`.
2. The API key field is empty (current behavior). User must re-enter the full key to make changes.
3. User enters a new API key and clicks "Save".
4. The `update` action in `routes/arr/[id]/settings/+page.server.ts` encrypts the new key, upserts into `arr_instance_credentials`, and clears `arr_instances.api_key`.
5. **Masking impact**: After save, the field resets to empty (current behavior) or transitions to showing the new masked value.
6. **Env-managed instances**: `canEditCoreConnectionFields = false` prevents editing the API key field entirely. The masked display is read-only.

### 6. Sync Operations That Use API Keys Internally

1. Jobs (`arr.sync.*`, `arr.rename`, `arr.upgrade`) load instances via `arrInstancesQueries.getById()` which returns `'' AS api_key`.
2. Client creation uses `getArrInstanceClient()` which fetches from `arr_instance_credentials`, decrypts the key, and creates an `ArrClient` with the plaintext key in the `X-Api-Key` header.
3. **Masking impact**: No change to sync flow. The plaintext key exists only in memory during the HTTP client lifecycle and is never logged or returned to the UI.
4. **Critical bug found**: `routes/arr/[id]/logs/+page.server.ts` line 25 calls `createArrClient(instance.type, instance.url, instance.api_key)` directly. Since `arrInstanceSelect` now returns `'' AS api_key`, this is broken post-encryption migration. This must be fixed to use `getArrInstanceClient()` instead.

## Domain Model

### Key Entities

| Entity                  | Table/Location             | Credential Fields                                   | Current State                           |
| ----------------------- | -------------------------- | --------------------------------------------------- | --------------------------------------- |
| Arr Instance            | `arr_instances`            | `api_key` (cleared to ''), `api_key_fingerprint`    | Encrypted in `arr_instance_credentials` |
| Arr Instance Credential | `arr_instance_credentials` | `ciphertext`, `nonce`, `key_version`, `fingerprint` | AES-GCM encrypted, HMAC fingerprint     |
| TMDB Settings           | `tmdb_settings`            | `api_key`                                           | Plaintext in DB                         |
| AI Settings             | `ai_settings`              | `api_key`                                           | Plaintext in DB                         |
| Auth Settings           | `auth_settings`            | `api_key`                                           | Plaintext in DB (Praxrr API key)        |
| Database Instance       | `database_instances`       | `personal_access_token`                             | Plaintext in DB                         |
| Notification Service    | `notification_services`    | `config` JSON (contains `webhook_url`)              | Plaintext in DB                         |

### Data Flow: Arr API Key Lifecycle

```
User Input (plaintext)
    |
    v
Server Action (routes/arr/new or arr/[id]/settings)
    |-- encryptArrInstanceApiKey() --> arr_instance_credentials (ciphertext)
    |-- '' --> arr_instances.api_key (cleared by trigger)
    |-- fingerprint --> arr_instances.api_key_fingerprint
    |
    v
Storage (SQLite)
    |
    +-- UI Display Path:
    |   arrInstanceSelect returns '' AS api_key
    |   load functions strip api_key from response
    |   --> Masked display in browser (NEW: derive from fingerprint or stored hint)
    |
    +-- Copy/Reveal Path (NEW):
    |   Server endpoint decrypts via arrInstanceCredentialsQueries + decryptArrInstanceApiKey()
    |   --> Transient plaintext response for clipboard
    |
    +-- Job/Sync Path:
    |   getArrInstanceClient() decrypts from arr_instance_credentials
    |   --> BaseArrClient with X-Api-Key header
    |   --> Plaintext discarded after client creation
    |
    +-- Log Path:
        logger.info/error/warn/debug with meta objects
        --> Must sanitize before JSON.stringify (NEW)
```

### Other Credential Flows

- **TMDB API key**: Stored plaintext in `tmdb_settings.api_key`. Returned to UI via `TMDBSettings.svelte`. Currently uses `type="password"` with eye toggle. Not encrypted at rest.
- **AI API key**: Stored plaintext in `ai_settings.api_key`. Returned to UI via `AISettings.svelte`. Currently uses `type="password"` with eye toggle. Not encrypted at rest.
- **Praxrr auth API key**: Stored plaintext in `auth_settings.api_key`. Returned to UI via security page. Uses `FormInput` with `private_` prop. Has copy-to-clipboard button already.
- **Database PAT**: Stored plaintext in `database_instances.personal_access_token`. The form uses `personalAccessToken: ''` pattern to avoid pre-population (same as Arr keys). Not masked in table/card views.
- **Discord webhook URL**: Stored in `notification_services.config` JSON. Not masked in the form.

## Existing Codebase Integration

### Related Features (Already Implemented)

- **Encrypted Arr credential storage** (migration `20260221`): The foundation. Arr API keys are encrypted at rest with AES-GCM. Fingerprints enable duplicate detection without decryption. DB triggers prevent plaintext writes.
- **`arrInstanceSelect` SQL alias**: Returns `'' AS api_key` for all queries, preventing plaintext from reaching query consumers. Located at `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` line 48-62.
- **`FormInput` `private_` prop**: Located at `/packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte`. Renders password-type inputs with eye toggle (show/hide). Already used for Arr API keys, passwords, and auth keys.
- **Instance layout `api_key` stripping**: `/packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts` line 18 destructures out `api_key` before returning to the client.
- **Instance list `api_key` clearing**: `/packages/praxrr-app/src/routes/arr/+page.server.ts` line 15-22 replaces `api_key` with `''` in every instance record.
- **Settings page `api_key` clearing**: `/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts` line 44 returns `api_key: ''`.

### Patterns to Follow

- **`getArrInstanceClient()` for all runtime key access**: Located at `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`. This is the canonical way to get a decrypted key for HTTP client creation. Uses a per-instance cache keyed by `{instanceId}:{keyVersion}`.
- **`private_` prop pattern**: The `FormInput` component already handles show/hide toggle. Extend this for masked display (not just empty password field).
- **Server-side stripping in `load` functions**: Every `+page.server.ts` or `+layout.server.ts` that returns instance data strips the api_key. This pattern must be formalized and tested.
- **`alertStore.add()` for user feedback**: Copy/reveal actions should use the existing alert system for success/error feedback.
- **Fingerprint for identity**: The `api_key_fingerprint` field (HMAC-SHA256 of the plaintext key) is safe to expose in the UI for identification. Consider deriving the masked display hint from this.

### Bugs and Gaps Found During Research

1. **CRITICAL: `routes/arr/[id]/logs/+page.server.ts` line 25**: Calls `createArrClient(instance.type, instance.url, instance.api_key)` directly. Since `arrInstanceSelect` now returns `'' AS api_key`, this creates an Arr client with an empty API key, which will fail all authenticated requests. Must be migrated to `getArrInstanceClient()`.
2. **Logger has no sanitization**: `/packages/praxrr-app/src/lib/server/utils/logger/logger.ts` serializes `meta` objects via `JSON.stringify()` without any filtering. Any caller passing an object containing `api_key` or similar fields will write the value to log files and console.
3. **TMDB, AI, and Auth API keys are not masked in responses**: `tmdbSettingsQueries.get()`, `aiSettingsQueries.get()`, and `authSettingsQueries.getApiKey()` return plaintext keys directly to `load` functions, which pass them to the browser.
4. **Database PAT visible in table/card views**: `database_instances.personal_access_token` is returned to the UI and rendered in `TableView.svelte` and `CardView.svelte` (as a boolean indicator, but the full value is in the page data).
5. **Notification webhook URLs stored in plaintext**: `notification_services.config` JSON contains sensitive webhook URLs that are returned to the UI.

## Success Criteria

1. **No full API key in any API response or SvelteKit `load` return value**: Automated test scans response payloads for key-shaped values and fails if found.
2. **Masked display in all UI credential fields**: Every surface that shows a configured credential displays `••••••••{last4}` or equivalent.
3. **Copy-to-clipboard works for Arr API keys**: User can copy a stored key without it appearing in visible DOM text.
4. **Logger sanitization active**: A test proves that logging an object with `api_key`, `apiKey`, `personal_access_token`, or `webhook_url` fields produces masked output.
5. **`routes/arr/[id]/logs/+page.server.ts` migrated**: Uses `getArrInstanceClient()` instead of direct `createArrClient()` with empty key.
6. **Existing tests continue passing**: Sync, rename, upgrade, and connection test flows are unaffected.
7. **Reusable masking utility**: A shared utility function handles masking for all credential types with consistent formatting.

## Open Questions

1. **Reveal scope**: Should the reveal toggle be available on the instance settings page, or only as copy-to-clipboard? Reveal increases exposure risk (visible on screen) but improves usability.
2. **Masking for non-Arr credentials**: Should TMDB, AI, and auth API keys also be masked in this phase, or is that a separate feature? They are currently plaintext in both storage and display.
3. **Display hint storage**: Should the last 4 characters of the key be stored alongside the ciphertext (at encryption time) to avoid a decryption round-trip for masked display? This is a minor security tradeoff (4 chars of the key are stored in cleartext) vs. a performance/simplicity win.
4. **Rate limiting on key retrieval**: Should the copy/reveal endpoint have rate limiting to prevent brute-force enumeration? The endpoint requires authentication, but additional throttling may be warranted.
5. **Re-authentication for reveal**: Should revealing or copying a key require re-entering the user's password? This adds friction but prevents unauthorized access if a session is hijacked.
6. **Audit trail integration**: Issue #17 (Audit Trail) is listed as a companion. Should copy/reveal actions be logged in an audit table? If so, what metadata should be captured?
