# Integration Research: API Key Masking

## Overview

Three plaintext credential surfaces need masking: TMDB (`tmdb_settings.api_key`), AI (`ai_settings.api_key`), and Auth (`auth_settings.api_key`). All are singleton settings tables queried via `*SettingsQueries.get()` and returned raw in SvelteKit `load()` functions. Arr instance keys are already handled: encrypted at rest in `arr_instance_credentials`, returned as `'' AS api_key` in SQL queries, and stripped in the layout server load. The logger `formatMeta()` performs a raw `JSON.stringify(meta)` with no field-level sanitization, so any key passed as metadata is written to console and log files in plaintext.

## API Endpoints

### Settings Routes That Return API Keys

**`/settings/general` (load function)**

- File: `/packages/praxrr-app/src/routes/settings/general/+page.server.ts` (lines 12-67)
- Returns `aiSettings.api_key` (line 58) and `tmdbSettings.api_key` (line 62) as plaintext strings
- Queries: `aiSettingsQueries.get()` (line 15), `tmdbSettingsQueries.get()` (line 16)
- These values flow into SvelteKit `__data.json` payloads and are visible in browser DevTools

**`/settings/security` (load function)**

- File: `/packages/praxrr-app/src/routes/settings/security/+page.server.ts` (lines 9-35)
- Returns `apiKey` (line 18) as plaintext from `authSettingsQueries.getApiKey()`
- The full auth API key is embedded in the page data for display

### Form Actions That Handle Keys

**`/settings/general` actions:**

- `updateAI` (line 192): Reads `api_key` from form data, passes to `aiSettingsQueries.update()`. Already avoids logging the key (line 230 comment). Writes plaintext to DB.
- `updateTMDB` (line 238): Reads `api_key` from form data, passes to `tmdbSettingsQueries.update()`. Writes plaintext to DB.

**`/settings/security` actions:**

- `regenerateApiKey` (line 90): Calls `authSettingsQueries.regenerateApiKey()`, returns the full new key in the action response (show-once pattern). This is intentional and should remain unchanged.
- `changePassword`, `revokeSession`, `revokeOtherSessions`: Do not touch API keys.

### Test Connection Endpoints

**`/api/tmdb/test` (POST)**

- File: `/packages/praxrr-app/src/routes/api/tmdb/test/+server.ts`
- Receives `apiKey` from client-side POST body (user-entered, not stored)
- Creates a `TMDBClient(apiKey)` and calls `validateKey()`
- No masking needed here: the key comes from the form input, not from load data

**`/arr/test` (POST)**

- File: `/packages/praxrr-app/src/routes/arr/test/+server.ts`
- Receives `type`, `url`, `apiKey` from client-side POST body (user-entered)
- Creates an `ArrClient` with 3s timeout for quick feedback
- No masking needed here: same reasoning as TMDB test

**`/api/tmdb/search` (GET)**

- File: `/packages/praxrr-app/src/routes/api/tmdb/search/+server.ts`
- Reads stored key via `tmdbSettingsQueries.get()` (line 16-17)
- Creates `TMDBClient(settings.api_key)` server-side only; key never returned to client
- No masking change needed for this endpoint itself

### API v1 Endpoints

- No `/api/v1/**` routes directly reference or return API keys
- The `getArrInstanceClient()` function handles decryption internally for all Arr API calls

### Route Organization

Settings routes use SvelteKit form actions (`method="POST" action="?/actionName"`) with `use:enhance` for progressive enhancement. Load functions return data directly (no API layer). This means:

1. Masking must happen in `load()` return values
2. Reveal actions should be additional form actions (e.g., `revealTmdbKey`, `revealAiKey`, `revealAuthKey`)
3. No REST API endpoint changes are needed

## Database

### Relevant Tables

| Table                      | Credential Field                  | Storage                        | Singleton         | Masking Approach        |
| -------------------------- | --------------------------------- | ------------------------------ | ----------------- | ----------------------- |
| `tmdb_settings`            | `api_key` (TEXT, default `''`)    | Plaintext                      | Yes (id=1)        | Mask in `load()`        |
| `ai_settings`              | `api_key` (TEXT, default `''`)    | Plaintext                      | Yes (id=1)        | Mask in `load()`        |
| `auth_settings`            | `api_key` (TEXT, nullable)        | Plaintext                      | Yes (id=1)        | Mask in `load()`        |
| `arr_instances`            | `api_key`                         | Cleared to `''` at query level | No                | Already masked          |
| `arr_instance_credentials` | `ciphertext`, `nonce`             | AES-GCM encrypted              | No (per-instance) | Never exposed to client |
| `database_instances`       | `personal_access_token`           | Plaintext                      | No                | Out of scope            |
| `notification_services`    | `config` (JSON with webhook URLs) | Plaintext                      | No                | Out of scope            |

### Schema Details

**tmdb_settings** (migration 020):

```sql
CREATE TABLE tmdb_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  api_key TEXT NOT NULL DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**ai_settings** (migration 014):

```sql
CREATE TABLE ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  api_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**auth_settings** (migration 036):

```sql
CREATE TABLE auth_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  session_duration_hours INTEGER NOT NULL DEFAULT 168,
  api_key TEXT,  -- nullable, generated via lower(hex(randomblob(16)))
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**arr_instances** query-level masking (already implemented):

```sql
-- In arrInstances.ts (line 48-62)
SELECT id, name, type, url, external_url,
  '' AS api_key,  -- Always returns empty string
  api_key_fingerprint, tags, enabled, source,
  created_at, updated_at
FROM arr_instances
```

### Settings Query Patterns (Singleton Get/Update)

All three settings tables use the same singleton pattern:

- `get()`: `SELECT * FROM {table} WHERE id = 1` returning the typed row or undefined
- `update(input)`: Dynamic `UPDATE SET` with only provided fields + `updated_at = CURRENT_TIMESTAMP`
- `reset()`: Hardcoded defaults

The `authSettingsQueries` adds:

- `getApiKey()`: Returns `this.get().api_key` (string | null)
- `regenerateApiKey()`: Generates via `crypto.randomUUID().replace(/-/g, '')`, stores, returns new key
- `validateApiKey(key)`: Direct string comparison of provided key against stored key

## Internal Services

### tmdbSettingsQueries

- File: `/packages/praxrr-app/src/lib/server/db/queries/tmdbSettings.ts`
- Interface: `TMDBSettings { id, api_key, created_at, updated_at }`
- `get()` returns full plaintext `api_key` -- this is what needs masking in load
- Used by: `settings/general/+page.server.ts` (load), `api/tmdb/search/+server.ts` (server-side client creation)

### aiSettingsQueries

- File: `/packages/praxrr-app/src/lib/server/db/queries/aiSettings.ts`
- Interface: `AISettings { id, enabled, api_url, api_key, model, created_at, updated_at }`
- `get()` returns full plaintext `api_key` -- needs masking in load
- Used by: `settings/general/+page.server.ts` (load)

### authSettingsQueries

- File: `/packages/praxrr-app/src/lib/server/db/queries/authSettings.ts`
- Interface: `AuthSettings { id, session_duration_hours, api_key (nullable), created_at, updated_at }`
- `getApiKey()` returns `string | null` -- needs masking in load
- `validateApiKey(key)` performs direct comparison (no encryption)
- `regenerateApiKey()` returns the new full key -- show-once is acceptable
- Used by: `settings/security/+page.server.ts` (load + regenerateApiKey action), `auth/middleware.ts` (validateApiKey for X-Api-Key header)

### Logger Module

- File: `/packages/praxrr-app/src/lib/server/utils/logger/logger.ts`
- Types: `/packages/praxrr-app/src/lib/server/utils/logger/types.ts`
- `formatMeta(meta?: unknown)` at line 40: `JSON.stringify(meta)` with no sanitization
- Used in two paths:
  1. Console output (line 111): `formatMeta()` colorized with grey
  2. File output (line 119-126): Raw `JSON.stringify(logEntry)` where `logEntry.meta = options.meta`
- Both paths serialize `meta` without filtering sensitive field names
- The `updateAI` action (line 225-233) manually omits `apiKey` from meta, but this is ad-hoc and not enforced
- The auth middleware (line 104-106) already masks invalid API keys: `****${apiKey.slice(-4)}`

### getArrInstanceClient() Decryption Flow

- File: `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`
- Flow: `arrInstanceCredentialsQueries.getByInstanceId(instanceId)` -> `decryptArrInstanceApiKey({keyVersion, nonce, ciphertext})` -> `createArrClient(type, url, apiKey)`
- Uses an in-memory client cache keyed by `instanceId:keyVersion`
- Invalidates cached clients when key version changes
- This is the reference pattern for how encrypted Arr keys are consumed server-side

### Encryption Module

- Files: `/packages/praxrr-app/src/lib/server/utils/encryption/keys.ts` and `arr-credentials.ts`
- AES-256-GCM encryption with 12-byte random nonce
- Key ring loaded from `ARR_CREDENTIAL_MASTER_KEY` env var (base64-encoded 32 bytes)
- Supports key rotation via `ARR_CREDENTIAL_PREVIOUS_KEYS` (JSON object map)
- HMAC-SHA256 fingerprinting for duplicate detection
- TMDB/AI/Auth keys do not use this encryption system (plaintext in DB)

## UI Components

### TMDBSettings.svelte

- File: `/packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`
- Receives `settings: TMDBSettings` prop (with `api_key: string`)
- Uses its own `showApiKey` toggle (line 9) to switch `type={showApiKey ? 'text' : 'password'}` on a raw `<input>` (not FormInput)
- Binds directly to `settings.api_key` via `bind:value` (line 90)
- Test button sends `settings.api_key` to `/api/tmdb/test` via fetch POST (line 33)
- Reset button clears `settings.api_key` to empty string (line 18)
- Form submits `api_key` via `name="api_key"` hidden in form data

**Impact of masking**: After masking, the component will receive a masked string instead of the real key. The `bind:value` pattern must change to a "re-enter to change" model or use the new `MaskedApiKey` component for display + a separate input for editing.

### AISettings.svelte

- File: `/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`
- Same pattern as TMDBSettings: receives `settings: AISettings`, has `showApiKey` toggle (line 10)
- Uses raw `<input>` with `type={showApiKey ? 'text' : 'password'}` and `bind:value={settings.api_key}` (line 118)
- Has Eye/EyeOff button for local visibility toggle (line 122-132)
- Reset button clears `settings.api_key` to empty string (line 16-17)

**Impact of masking**: Same as TMDBSettings -- needs to shift from `bind:value` on the real key to displaying a masked value with separate reveal/edit mechanism.

### Security Page (+page.svelte)

- File: `/packages/praxrr-app/src/routes/settings/security/+page.svelte`
- Receives `data.apiKey` (string | null) from load function (line 49)
- Also receives `form?.apiKey` from the `regenerateApiKey` action response (line 49: `$: apiKey = form?.apiKey ?? data.apiKey`)
- Displays the key in a `FormInput` with `private_` prop (line 216-223), which renders as a password field with eye toggle
- Has a Copy button that calls `navigator.clipboard.writeText(apiKey)` (line 51-55)
- Has a Regenerate button that triggers the `regenerateApiKey` form action (lines 233-248)

**Impact of masking**: The load data should return a masked value. The `regenerateApiKey` action should continue returning the full new key (show-once). The copy function needs to fetch the full key from a reveal action rather than reading from `data`.

### InstanceForm.svelte (Arr Instances)

- File: `/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`
- Already uses "re-enter to change" pattern for API keys in edit mode (line 78: `apiKey: ''` -- never pre-populated)
- Uses `FormInput` with `private_` prop (line 430-444)
- Test connection sends user-entered key via fetch POST (lines 183-188)
- This component does NOT need changes for this feature -- it already handles API keys correctly

### Component Types

- File: `/packages/praxrr-app/src/routes/settings/general/components/types.ts`
- Current types return raw `api_key: string` for both `AISettings` and `TMDBSettings`
- These interfaces need updating to `api_key_masked: string` + `has_api_key: boolean`

### FormInput Component

- File: `/packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte`
- The `private_` prop (line 16) renders a password-type input with Eye/EyeOff toggle
- The toggle is local-only (client-side visibility switch), not a server reveal
- This component is for write/edit scenarios; the new `MaskedApiKey` component is for read-only display with server-side reveal

### Existing Form UI Components

- Directory: `/packages/praxrr-app/src/lib/client/ui/form/`
- Components: `FormInput`, `IconCheckbox`, `NumberInput`, `DateInput`, `TimeInput`, `TagInput`, `KeyValueList`, `MarkdownInput`, `RangeScale`, `SearchDropdown`
- The new `MaskedApiKey.svelte` fits naturally in this directory as a display-only credential component

## Configuration

### Environment Variables

No new environment variables are needed. The masking feature is purely server-side logic and UI changes.

Existing relevant env vars:

- `ARR_CREDENTIAL_MASTER_KEY`: AES-256 key for Arr credential encryption (already required)
- `ARR_CREDENTIAL_MASTER_KEY_VERSION`: Key version identifier
- `ARR_CREDENTIAL_PREVIOUS_KEYS`: JSON map for key rotation support
- `AUTH`: Auth mode (`on`|`local`|`off`|`oidc`) -- affects whether security page is accessible

### Config Module

- File: `/packages/praxrr-app/src/lib/server/utils/config/config.ts`
- The Config class does not directly expose TMDB/AI/Auth keys -- those live in the database
- No config changes needed

## Relevant Files

- `/packages/praxrr-app/src/routes/settings/general/+page.server.ts`: Load + actions for TMDB/AI keys (primary modification target)
- `/packages/praxrr-app/src/routes/settings/security/+page.server.ts`: Load + actions for auth API key (primary modification target)
- `/packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`: TMDB key display/edit component
- `/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`: AI key display/edit component
- `/packages/praxrr-app/src/routes/settings/security/+page.svelte`: Auth key display/copy/regenerate component
- `/packages/praxrr-app/src/routes/settings/general/components/types.ts`: TypeScript interfaces for settings data
- `/packages/praxrr-app/src/routes/settings/general/+page.svelte`: Parent page passing data to child components
- `/packages/praxrr-app/src/lib/server/db/queries/tmdbSettings.ts`: TMDB settings singleton queries
- `/packages/praxrr-app/src/lib/server/db/queries/aiSettings.ts`: AI settings singleton queries
- `/packages/praxrr-app/src/lib/server/db/queries/authSettings.ts`: Auth settings singleton queries
- `/packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: Logger with unsanitized `formatMeta()`
- `/packages/praxrr-app/src/lib/server/utils/logger/types.ts`: Logger type definitions (LogOptions.meta is `unknown`)
- `/packages/praxrr-app/src/lib/shared/utils/`: Target directory for new `masking.ts` utility
- `/packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte`: Reference for `private_` prop pattern
- `/packages/praxrr-app/src/lib/client/ui/form/`: Target directory for new `MaskedApiKey.svelte`
- `/packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts`: Bug -- uses `createArrClient()` with empty api_key
- `/packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts`: Reference for how Arr keys are already stripped from layout data
- `/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`: Reference for "re-enter to change" pattern
- `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: Reference for decrypt-on-demand pattern
- `/packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts`: Arr key encryption/decryption
- `/packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`: Already masks invalid API keys in log output (line 105)
- `/packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts`: Reference test for payload redaction verification
- `/packages/praxrr-app/src/tests/base/BaseTest.ts`: Test infrastructure with `assertPayloadNoLeak()` helper

## Architectural Patterns

- **Singleton settings tables**: TMDB, AI, and Auth settings all use `id = 1` primary key constraint with a single row. Queries use `get()` (returns typed row or undefined) and `update(input)` (dynamic SET clause). This pattern means a single `get()` call always returns the full row including any API key.
- **Query-level credential stripping**: Arr instances use `'' AS api_key` in the SQL SELECT constant (line 55 of `arrInstances.ts`). This is the most aggressive masking approach -- the real key column is never even read from the database for client-facing queries.
- **Layout-level credential exclusion**: The arr layout server (`arr/[id]/+layout.server.ts`, lines 18-19) destructures out `api_key` before returning instance data to child routes. This provides a second defense layer beyond the query-level masking.
- **"Re-enter to change" for write forms**: `InstanceForm.svelte` initializes `apiKey: ''` in edit mode (line 78). The API key field is always empty on page load; users must re-enter it to save changes. This avoids ever sending a stored key back to the client for edit forms.
- **Form action pattern**: All settings use SvelteKit form actions with `use:enhance`. Actions receive raw form data, validate, update DB, and return success/failure. This is the natural place for reveal actions.
- **Test connection with user input**: Both `/arr/test` and `/api/tmdb/test` receive the API key from the client POST body (user-typed), not from stored data. Masking does not affect these flows.
- **Client-side password toggle**: `FormInput`'s `private_` prop and the TMDB/AI settings components use a local `showApiKey` boolean to toggle `type="text"` vs `type="password"`. This is a client-only visibility toggle, not a server reveal. The full key is always in the DOM.

## Gotchas and Edge Cases

- **Arr logs page bug**: `/packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts` (line 25) calls `createArrClient(instance.type, instance.url, instance.api_key)` where `instance.api_key` is always `''` due to the query-level masking. This means the logs page is broken -- Arr API calls fail with an empty API key. Must migrate to `getArrInstanceClient()` which decrypts from the credentials table.
- **Auth key show-once after regeneration**: The `regenerateApiKey` action (security/+page.server.ts line 97) returns the full new key as `{ apiKey: newKey }`. The client reads this via `$: apiKey = form?.apiKey ?? data.apiKey` (line 49). After masking `data.apiKey`, the regeneration flow must still work: the action response overrides the masked load value. This is already the correct precedence but needs testing.
- **AI settings meta logging**: The `updateAI` action (line 225-233) manually excludes `apiKey` from the log meta object with a comment "Note: Don't log apiKey for security". This is ad-hoc and would be superseded by systematic logger sanitization.
- **Auth middleware already masks**: In `middleware.ts` (line 105), invalid API keys are masked as `****${apiKey.slice(-4)}` before logging. This is a different masking format than the proposed `{8 bullets}{last4}` and should be unified.
- **TMDB test sends stored key from form**: `TMDBSettings.svelte` (line 33) sends `settings.api_key` to the test endpoint. After masking, this value would be a masked string, not the real key. The test button needs to either: (a) use a server-side test action that reads the stored key, or (b) only work when the user has typed a new key into the form field. The current "re-enter to change" approach would handle (b) naturally.
- **`database_instances.personal_access_token`**: This table stores PATs for PCD git repos in plaintext. Out of scope for this feature but should be tracked for follow-up.
- **`notification_services.config`**: JSON blob that may contain webhook URLs with embedded tokens. Out of scope but same concern.
- **Auth key can be null**: Unlike TMDB/AI keys (which default to empty string), the auth API key can be `null` (not yet generated). The masking function must handle both `null` and empty string inputs.
- **SvelteKit `__data.json` serialization**: All data returned from `load()` is serialized into the HTML page and a `__data.json` endpoint. Any unmasked key in load data is exposed in both page source and the data endpoint.

## Other Docs

- `/docs/plans/api-key-masking/feature-spec.md`: Complete feature specification with architecture diagram, task breakdown, and risk assessment
- `/docs/plans/api-key-masking/research-technical.md`: Technical architecture research
- `/docs/plans/api-key-masking/research-business.md`: Business domain model and data flow analysis
- `/docs/plans/api-key-masking/research-ux.md`: UX competitive analysis and accessibility requirements
- `/docs/plans/api-key-masking/research-external.md`: Industry patterns from AWS, GitHub, Stripe, Cloudflare
- `/docs/plans/api-key-masking/research-recommendations.md`: Implementation approach comparison and phasing strategy
