# Architecture Research: API Key Masking

## System Overview

Praxrr stores credentials across four distinct surfaces: Arr instance API keys (encrypted at rest with AES-GCM in a separate `arr_instance_credentials` table), TMDB read tokens (`tmdb_settings.api_key`), AI API keys (`ai_settings.api_key`), and auth API keys (`auth_settings.api_key`). Arr keys are already masked at the SQL level (the `arrInstanceSelect` constant returns `'' AS api_key`), but all other credentials flow as plaintext from database queries through `+page.server.ts` load functions into SvelteKit's `__data.json` payloads. Additionally, the custom `Logger` class serializes its `meta` parameter with raw `JSON.stringify()` without any field-level redaction, so any credential inadvertently passed as metadata ends up in log files and console output.

## Relevant Components

### Credential Storage and Queries

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/tmdbSettings.ts`: Singleton TMDB settings (api_key stored as plaintext in SQLite)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/aiSettings.ts`: Singleton AI settings (api_key, api_url stored as plaintext)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/authSettings.ts`: Singleton auth settings with api_key (32-char hex), regenerateApiKey(), validateApiKey()
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Arr instances with SQL-level masking via `'' AS api_key` in the select constant (line 55)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/arrInstanceCredentials.ts`: Encrypted credential storage (ciphertext, nonce, key_version, fingerprint)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/databaseInstances.ts`: Database instances with `personal_access_token` stored as plaintext (line 17)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/notificationServices.ts`: Notification service config stored as JSON string; webhook URLs embedded inside

### Encryption Pipeline (Arr-only)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts`: AES-GCM encrypt/decrypt with HMAC fingerprinting for Arr API keys
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/encryption/keys.ts`: Key ring management (active version, previous keys for rotation)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: `getArrInstanceClient()` decrypts credentials on demand to create HTTP clients

### Settings Page Server Files (Load Functions = Exposure Points)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/+page.server.ts`: **EXPOSES** `aiSettings.api_key` (line 57) and `tmdbSettings.api_key` (line 61) in load return
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.server.ts`: **EXPOSES** `authSettingsQueries.getApiKey()` (line 18) in load return; also returns full key from `regenerateApiKey` action (line 97)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`: Correctly masks Arr key -- returns `api_key: ''` in load (line 44)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/databases/[id]/+layout.server.ts`: **EXPOSES** full `database` object including `personal_access_token` to all child routes (line 18)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/notifications/edit/[id]/+page.server.ts`: Correctly strips `webhook_url` from config on load (lines 24-25)

### UI Components

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte`: Reusable input with `private_` prop for password toggle (Eye/EyeOff icons); used for write-only credential entry
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`: TMDB key entry with local `showApiKey` toggle; binds directly to `settings.api_key` (the plaintext value from load)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`: AI key entry with local `showApiKey` toggle; binds to `settings.api_key`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.svelte`: Auth API key display with `FormInput private_` prop, copy-to-clipboard (line 51-56), and regenerate action
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`: Arr instance form; never pre-populates apiKey for security (line 78); uses `FormInput private_`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/notifications/components/DiscordConfiguration.svelte`: Webhook URL input (no masking currently; relies on server-side strip in edit mode)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/components/types.ts`: TypeScript types for settings components (AISettings, TMDBSettings, etc.)

### Logger

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: Core Logger class; `formatMeta()` (line 40-43) calls `JSON.stringify(meta)` with no redaction; `log()` method (line 96-146) writes to console and JSON log files
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/logger/types.ts`: `LogOptions.meta` is typed as `unknown`; `LogEntry.meta` is also `unknown`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/logger/reader.ts`: Log file reader; parses JSON lines from log files and returns `LogEntry[]`; these entries are displayed in the logs UI
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/logger/settings.ts`: LogSettingsManager singleton for cached database settings

### Shared Utilities

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/utils/dates.ts`: Date parsing utilities
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/utils/version.ts`: Version string utilities
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/shared/utils/uuid.ts`: UUID utilities

### Config and Auth

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/config/config.ts`: Config singleton; holds `oidc.clientSecret` (line 18) and `arrCredentialMasterKey` (line 21) in memory
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/middleware.ts`: Auth middleware; already masks invalid API keys before logging (line 105: `****${apiKey.slice(-4)}`)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/apiKey.ts`: API key generation (UUID without hyphens)

### Credential Consumers

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/tmdb/client.ts`: TMDBClient receives plaintext API key in constructor, passes as `Authorization: Bearer` header
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/ai/client.ts`: AIClient receives plaintext API key; caches client with `cachedApiKey` comparison (line 88)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/tmdb/test/+server.ts`: TMDB connection test endpoint; receives raw API key from client POST body

## Data Flow

### Current Flow: TMDB/AI Keys (Plaintext Exposure)

```
Database (plaintext) --> tmdbSettingsQueries.get() --> +page.server.ts load()
  --> SvelteKit serializes to __data.json --> Browser receives full key
  --> TMDBSettings.svelte binds to settings.api_key (full plaintext)
```

The `settings/general/+page.server.ts` load function calls `tmdbSettingsQueries.get()` (returns full row including `api_key`) and `aiSettingsQueries.get()` (returns full row including `api_key`), then includes them verbatim in the return object. SvelteKit serializes this into `__data.json`, making the full keys visible in network traffic and page source.

### Current Flow: Auth API Key (Plaintext Exposure)

```
Database (plaintext) --> authSettingsQueries.getApiKey() --> +page.server.ts load()
  --> __data.json --> security/+page.svelte displays via FormInput private_
```

The security page loads the full API key and sends it to the client. The `FormInput` component uses `type="password"` which hides the dots visually but the full value is in the DOM and `__data.json`.

### Current Flow: Arr Instance Keys (Already Masked)

```
Database (encrypted ciphertext) --> arrInstancesQueries.getById() returns '' AS api_key
  --> UI never receives actual key value
  --> For API calls: getArrInstanceClient() decrypts from arr_instance_credentials table on demand
```

This is the model to follow. Arr keys are encrypted at rest, masked at the query level, and only decrypted when an HTTP client needs them.

### Current Flow: Database Personal Access Tokens (Plaintext Exposure)

```
Database (plaintext) --> databaseInstancesQueries.getById() --> +layout.server.ts
  --> All child routes receive full token via __data.json
  --> UI checks for truthiness (e.g., database.personal_access_token) but never displays value
```

The layout server at `databases/[id]/+layout.server.ts` loads the full `DatabaseInstance` and passes it to all child routes. While the UI doesn't display the token value, it's present in `__data.json`.

### Current Flow: Discord Webhook URLs (Partially Masked)

```
Database (JSON in config column) --> notificationServicesQueries.getById()
  --> edit/+page.server.ts strips webhook_url from parsed config (lines 24-25)
  --> Client never receives webhook URL in edit mode
```

This is another existing masking pattern -- server-side stripping of sensitive fields before sending to client.

### Current Flow: Logger (No Redaction)

```
logger.info('message', { meta: { apiKey: 'sk-abc123...' } })
  --> formatMeta() calls JSON.stringify(meta) verbatim
  --> Written to console AND JSON log file without any field filtering
```

The `Logger.log()` method at line 96 passes `options?.meta` through `JSON.stringify()` for both console and file output with zero field-level filtering.

### Proposed Flow: Masked Load + On-Demand Reveal

```
Database (plaintext) --> query.get() --> maskApiKey(key) in +page.server.ts
  --> __data.json contains only masked value (e.g., "••••••••ab3f")
  --> Reveal action: form action fetches full key server-side, returns in ActionData
  --> Copy action: form action fetches full key, returns for clipboard write
```

## Integration Points

### 1. Shared Masking Utility

**Location**: New file at `$shared/utils/masking.ts` (alongside `dates.ts`, `version.ts`, `uuid.ts`)

This utility needs to be shared between server and client because:

- Server uses it in `+page.server.ts` load functions to mask before sending
- Client may use it for display formatting

Function signature: `maskApiKey(key: string | null | undefined): string`

- Returns empty string for null/undefined/empty
- Returns `'••••••••'` for keys shorter than 8 characters
- Returns `'••••••••' + key.slice(-4)` for keys 8+ characters

### 2. Settings Page Server Load Functions (Mask on Output)

Files requiring changes:

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/+page.server.ts`: Replace `aiSetting.api_key` with `maskApiKey(aiSetting.api_key)` and `tmdbSetting.api_key` with `maskApiKey(tmdbSetting.api_key)` in load return
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.server.ts`: Replace `authSettingsQueries.getApiKey()` with masked version in load return
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/databases/[id]/+layout.server.ts`: Strip `personal_access_token` from database object before returning (or replace with boolean flag)

### 3. Reveal/Copy Form Actions (On-Demand Key Retrieval)

New form actions needed in:

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/general/+page.server.ts`: `revealTMDB` and `revealAI` actions returning full keys
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/settings/security/+page.server.ts`: `revealApiKey` action returning full auth API key

### 4. UI Components (Masked Display + Reveal Toggle)

A new `MaskedApiKey.svelte` component should be created at `$ui/form/MaskedApiKey.svelte` that:

- Displays masked value by default
- Has Reveal button that triggers a form action
- Has Copy button that triggers a form action and writes to clipboard
- Disables Reveal/Copy when key is empty/null
- Uses existing `Eye`, `EyeOff`, `Copy`, `Check` icons from `lucide-svelte`

Components requiring updates:

- `TMDBSettings.svelte`: Replace direct `input bind:value` pattern with `MaskedApiKey` for display, keep existing `FormInput` for the save form
- `AISettings.svelte`: Same pattern as TMDB
- `security/+page.svelte`: Replace current `FormInput private_ readonly` with `MaskedApiKey`; keep existing `regenerateApiKey` action (show-once pattern)

### 5. Logger Redaction (Sanitize Meta Before Serialization)

**Location**: Modify `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/logger/logger.ts`

Add a `sanitizeMeta()` function called in the `log()` method (line 96) before `formatMeta()` and before building `logEntry`. This function should:

- Recursively walk the `meta` object
- Replace values for keys matching sensitive field patterns (`api_key`, `apiKey`, `password`, `secret`, `token`, `authorization`, `ciphertext`, `nonce`, `master_key`, `webhook_url`) with `[REDACTED]`
- Handle nested objects and arrays
- Short-circuit for non-object values

The interception point is between lines 96-126 in `logger.ts`. Both the console output path (line 106-114) and file output path (line 118-145) share the same `options` parameter, so sanitizing once at the top of `log()` covers both.

### 6. Arr Instance Logs Bug Fix

**Location**: `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts`

Line 25 calls `createArrClient(instance.type, instance.url, instance.api_key)` but `instance.api_key` is always `''` because the `arrInstanceSelect` SQL constant masks it. This needs to be changed to use `getArrInstanceClient()` from `arrInstanceClients.ts`, which decrypts the credential on demand.

## Key Dependencies

### Internal Modules

- **`$shared/utils/`**: Target location for `maskApiKey()` utility (new file `masking.ts`)
- **`$ui/form/`**: Target location for `MaskedApiKey.svelte` component (new file)
- **`$logger/logger.ts`**: Logger class to modify for meta sanitization
- **`$db/queries/`**: Settings query modules (no changes needed; they continue returning full values)
- **`$arr/arrInstanceClients.ts`**: `getArrInstanceClient()` for the logs page bug fix

### External Libraries (Already Installed)

- **`lucide-svelte`**: Provides `Eye`, `EyeOff`, `Copy`, `Check` icons (already used in `FormInput`, `TMDBSettings`, `AISettings`, `security/+page.svelte`)
- **`@sveltejs/kit`**: `enhance`, `fail`, form actions (already used in all settings pages)

### No New Dependencies Required

Per the feature spec, no new libraries are needed. `navigator.clipboard.writeText()` covers clipboard needs, and the masking/redaction logic is simple enough for inline implementation.

## Architectural Patterns

- **SQL-Level Masking for Encrypted Keys**: Arr instances use `'' AS api_key` in the shared `arrInstanceSelect` SQL constant to prevent any query from returning the raw (encrypted) value. The actual decryption happens only in `getArrInstanceClient()`. This is the gold standard pattern in this codebase.
- **Server-Side Field Stripping**: Notification edit page destructures `{ webhook_url: _webhook_url, ...configWithoutWebhook }` to remove sensitive fields before returning to client. A simpler but effective approach.
- **Singleton Settings Pattern**: TMDB, AI, backup, log, and auth settings all use a singleton row pattern (`WHERE id = 1`). Each has a separate query module with `get()`, `update()`, and `reset()` methods.
- **SvelteKit Load + Actions Pattern**: Settings pages use `load()` to populate form fields and named `actions` for mutations. The load return becomes `__data.json` which is the primary exposure vector.
- **FormInput private\_ Prop**: The shared `FormInput.svelte` component has a `private_` boolean prop that renders the input as `type="password"` with an Eye/EyeOff toggle button. This is client-side visual masking only and does not protect the value in the DOM or `__data.json`.
- **Write-Only Credential Entry**: Arr instance forms and database instance forms never pre-populate credential fields in edit mode (e.g., `apiKey: ''` in dirty tracking init). Users must re-enter credentials to save changes. This is an important pattern to preserve.
- **Auth Middleware Masking**: `middleware.ts` already masks invalid API keys before logging: `apiKey.length > 4 ? '****' + apiKey.slice(-4) : '****'` (line 105). The new `maskApiKey()` utility should use a similar pattern but with bullet characters per the spec.

## Edge Cases and Gotchas

- **Arr Logs Page is Broken**: `/routes/arr/[id]/logs/+page.server.ts` line 25 calls `createArrClient()` with `instance.api_key` which is always `''` because of the SQL-level masking in `arrInstanceSelect`. This means the logs page currently fails to fetch logs from Arr instances. Must be fixed as part of this feature by switching to `getArrInstanceClient()`.
- **Database Layout Leaks PAT**: `databases/[id]/+layout.server.ts` returns the full `DatabaseInstance` object (including `personal_access_token`) to ALL child routes. While no child component displays the token value, it is present in `__data.json` on every page under `databases/[id]/`.
- **AI Settings Comment Already Acknowledges Risk**: Line 230-232 of `settings/general/+page.server.ts` has a comment `// Note: Don't log apiKey for security` but the key is still sent to the client via the load function return value on line 57.
- **TMDB Test Endpoint Receives Raw Key**: `/api/tmdb/test/+server.ts` receives the API key in the POST body from the client. After masking in load, the TMDB test flow will need the client to send the user-entered key (not the masked value), or use a server-side action pattern.
- **Auth Key Regeneration Show-Once**: The `regenerateApiKey` action returns the full new key (line 97 of security server). This is intentional show-once behavior and should be preserved.
- **Notification Webhook Partial Pattern**: The notification edit page strips `webhook_url` but the notification list page (`notifications/+page.server.ts`) returns full service objects including the `config` JSON which contains the webhook URL. The list page load function spreads the service object without stripping.
- **Config Singleton Holds Secrets in Memory**: `config.ts` stores `oidc.clientSecret`, `arrCredentialMasterKey`, and `arrCredentialPreviousKeys` as class properties. These are not exposed via any load function but could leak if the config object is ever logged.
- **Logger Meta is `unknown` Type**: The `LogOptions.meta` field is typed as `unknown`, so sanitization must handle arbitrary object shapes, arrays, nested objects, and non-object primitives.
- **Form Submission Must Not Send Masked Values**: If a user doesn't change a key, the form should submit empty string (not the masked dots) so the server knows to preserve the existing value. The existing Arr instance pattern handles this correctly (line 78-79 of InstanceForm: `apiKey: ''` init).

## Other Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/feature-spec.md`: Full feature specification with architecture diagram, task breakdown, and success criteria
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-business.md`: Business context research
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-technical.md`: Technical approach research
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-ux.md`: UX pattern research
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr client architecture docs
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/README.md`: Auth module docs
