# Technical Specifications: API Key Masking

## Executive Summary

API key masking requires a multi-layer approach spanning the database query layer, server-side API serialization, logger sanitization, and client-side UI components. The Arr credential encryption system (`arr_instance_credentials` + `arr-credentials.ts`) is already in place and already prevents Arr API keys from appearing in `arrInstancesQueries` SELECT results (the query returns `'' AS api_key`). The primary remaining work is: (1) extending masking to TMDB, AI, and Praxrr auth API keys which currently flow as plaintext through server responses, (2) building a logger sanitization layer to redact any key-like values from log output, (3) creating a dedicated masked-input UI component with reveal/copy capabilities, and (4) formalizing API response contracts that never return full keys.

## Architecture Design

### Masking Data Flow

**DB layer (already partially done for Arr keys):**

- `arrInstancesQueries` SELECT already returns `'' AS api_key` on line 55 of `arrInstances.ts` -- Arr API keys never leave the DB layer in plaintext through normal queries.
- TMDB, AI, and auth API keys are returned as plaintext by `tmdbSettingsQueries.get()`, `aiSettingsQueries.get()`, and `authSettingsQueries.getApiKey()`.

**Server/route layer (needs masking):**

- `settings/general/+page.server.ts` load function returns full `aiSettings.api_key` and `tmdbSettings.api_key` to the client (lines 56-62).
- `settings/security/+page.server.ts` load function returns full `authSettingsQueries.getApiKey()` to the client (line 18).
- `settings/security/+page.server.ts` `regenerateApiKey` action returns the full new key (line 97).
- `arr/+page.server.ts` load already strips api_key (sets to `''`, line 21).
- `arr/[id]/+layout.server.ts` already strips api_key via destructuring (line 18).
- `arr/[id]/settings/+page.server.ts` load already sets api_key to `''` (line 44).

**Logger layer (needs sanitization):**

- Logger writes `meta` objects as JSON (`JSON.stringify(meta)`) with no sanitization (logger.ts lines 41, 114-125).
- Some call sites already avoid logging keys (e.g., `settings/general/+page.server.ts` line 228 has a comment "Note: Don't log apiKey for security").
- Auth middleware already masks API keys in log output (middleware.ts line 105: `****${apiKey.slice(-4)}`).
- Other call sites could inadvertently pass API keys in error objects or meta fields.

**Client layer (needs masked-input component):**

- `FormInput.svelte` already supports `private_` prop which renders a password input with eye toggle (lines 114-148).
- `InstanceForm.svelte` already uses `private_` for the API key field (line 441).
- `TMDBSettings.svelte` and `AISettings.svelte` have their own inline eye toggle implementations (not using `FormInput private_`).
- `settings/security/+page.svelte` has its own show/hide and copy pattern for Praxrr auth API key (lines 23, 51-56, 216-224).

### New Components

1. **`$shared/utils/masking.ts`** -- Shared masking utility with `maskApiKey(key, visibleChars = 4)` function, usable on both server and client.
2. **`$logger/sanitizer.ts`** -- Logger meta sanitizer that scans for key-like patterns and replaces them with masked values before writing to console/file.
3. **`$ui/form/MaskedApiKey.svelte`** -- Dedicated masked API key display component with reveal toggle and copy-to-clipboard button (replaces ad-hoc patterns in TMDB/AI/Security settings).
4. **Server-side response serialization helpers** -- Masking functions applied in `+page.server.ts` load functions before returning data to the client.

### Integration Points

- **`arrInstancesQueries`**: Already handles masking at the SQL query level (`'' AS api_key`). No changes needed for Arr instance API keys in responses.
- **`tmdbSettingsQueries.get()`**: Returns raw `api_key`. The `settings/general/+page.server.ts` load function must mask before sending to client.
- **`aiSettingsQueries.get()`**: Returns raw `api_key`. Same treatment as TMDB.
- **`authSettingsQueries.getApiKey()`**: Returns raw API key. The `settings/security/+page.server.ts` load function must mask for display; a separate action can return the full key for clipboard copy.
- **Logger**: The sanitizer wraps `formatMeta()` in `logger.ts` to intercept and redact sensitive patterns.
- **Sync pipeline**: Uses `getArrInstanceClient()` which decrypts keys at runtime. These keys never appear in response payloads (only in the `X-Api-Key` HTTP header to Arr instances). No masking needed in sync flow internals.
- **`/arr/test` endpoint**: Receives plaintext API key from client for one-off test. Key is never persisted or logged. No change needed beyond ensuring error messages do not echo the key.
- **`/api/tmdb/test` endpoint**: Same pattern -- receives plaintext key for test, never persists. No change needed.

## Data Models

### Current Schema

**arr_instances table** (from `schema.sql` lines 24-45):

```sql
CREATE TABLE arr_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    url TEXT NOT NULL,
    external_url TEXT,
    api_key TEXT NOT NULL,        -- Legacy; runtime writes leave empty
    api_key_fingerprint TEXT,     -- HMAC fingerprint for dedup
    tags TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'ui',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**arr_instance_credentials table** (from migration `20260221`):

```sql
CREATE TABLE arr_instance_credentials (
    instance_id INTEGER PRIMARY KEY,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    key_version TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (instance_id) REFERENCES arr_instances(id) ON DELETE CASCADE
);
```

**tmdb_settings table**: `id, api_key TEXT, created_at, updated_at` (plaintext)

**ai_settings table**: `id, enabled, api_url, api_key TEXT, model, created_at, updated_at` (plaintext)

**auth_settings table**: `id, session_duration_hours, api_key TEXT NULL, created_at, updated_at` (plaintext)

### Schema Changes

No schema changes are required. The masking approach is applied at the serialization layer, not the storage layer. Arr keys are already encrypted at rest. TMDB, AI, and auth keys remain stored as plaintext (they are lower-sensitivity service tokens, and encrypting them is a separate concern from masking in API/UI responses).

If future work encrypts TMDB/AI keys, the masking layer designed here will continue to work without modification.

### TypeScript Types

**New shared type** (`$shared/utils/masking.ts`):

```typescript
/** A masked representation of a sensitive value */
export interface MaskedValue {
  /** Masked display string, e.g., "••••••••ab3f" */
  masked: string;
  /** Whether a reveal endpoint is available */
  revealable: boolean;
}

/** Mask a key, showing only the last N characters */
export function maskApiKey(key: string | null, visibleChars = 4): string {
  if (!key || key.length === 0) return '';
  if (key.length <= visibleChars) return '•'.repeat(8);
  return '•'.repeat(8) + key.slice(-visibleChars);
}
```

**Modified response types for settings pages:**

```typescript
// settings/general load data
interface GeneralSettingsData {
  aiSettings: {
    enabled: boolean;
    api_url: string;
    api_key_masked: string; // Masked display value
    has_api_key: boolean; // Whether a key is configured
    model: string;
  };
  tmdbSettings: {
    api_key_masked: string; // Masked display value
    has_api_key: boolean;
  };
}

// settings/security load data
interface SecuritySettingsData {
  apiKey: string | null; // Currently returns full key
  // Change to:
  apiKeyMasked: string | null; // Masked display value
  hasApiKey: boolean;
}
```

## API Design

### Affected Endpoints

**Endpoints that currently return full API keys to the client:**

| Endpoint                         | File                                       | Key Type | Current Behavior                                               |
| -------------------------------- | ------------------------------------------ | -------- | -------------------------------------------------------------- |
| `GET /settings/general` (load)   | `routes/settings/general/+page.server.ts`  | TMDB, AI | Returns full `api_key` in both `aiSettings` and `tmdbSettings` |
| `GET /settings/security` (load)  | `routes/settings/security/+page.server.ts` | Auth     | Returns full `authSettingsQueries.getApiKey()`                 |
| `POST ?/regenerateApiKey` action | `routes/settings/security/+page.server.ts` | Auth     | Returns new full key in form response                          |

**Endpoints that already do NOT return API keys:**

| Endpoint                        | File                                       | Mechanism                                           |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `GET /arr` (load)               | `routes/arr/+page.server.ts`               | Sets `api_key: ''`                                  |
| `GET /arr/[id]` (layout)        | `routes/arr/[id]/+layout.server.ts`        | Destructures out `api_key`                          |
| `GET /arr/[id]/settings` (load) | `routes/arr/[id]/settings/+page.server.ts` | Sets `api_key: ''`                                  |
| `GET /api/v1/arr/library`       | `routes/api/v1/arr/library/+server.ts`     | Uses `getArrInstanceClient()`, never serializes key |
| `GET /api/v1/arr/releases`      | `routes/api/v1/arr/releases/+server.ts`    | Uses `getArrInstanceClient()`, never serializes key |
| `POST /api/v1/arr/cleanup`      | `routes/api/v1/arr/cleanup/+server.ts`     | Uses `getArrInstanceClient()`, never serializes key |

### Response Changes

**`settings/general/+page.server.ts` load:**

```typescript
// Before:
aiSettings: {
  api_key: aiSetting.api_key,        // Full plaintext key
}
tmdbSettings: {
  api_key: tmdbSetting.api_key,      // Full plaintext key
}

// After:
aiSettings: {
  api_key_masked: maskApiKey(aiSetting.api_key),
  has_api_key: aiSetting.api_key.length > 0,
}
tmdbSettings: {
  api_key_masked: maskApiKey(tmdbSetting.api_key),
  has_api_key: tmdbSetting.api_key.length > 0,
}
```

**`settings/security/+page.server.ts` load:**

```typescript
// Before:
apiKey: authSettingsQueries.getApiKey()   // Full plaintext key

// After:
apiKeyMasked: maskApiKey(authSettingsQueries.getApiKey()),
hasApiKey: authSettingsQueries.getApiKey() !== null,
```

**`settings/security/+page.server.ts` regenerateApiKey action:**
The `regenerateApiKey` action is a special case. It currently returns the full key so the user can copy it. This is the one case where the full key should be returned, but only via an explicit user action (form POST), and only once (the page load should show masked). This is acceptable since the user explicitly requested regeneration and needs to copy it.

### New Endpoints (if any)

**Option A (recommended): No new endpoints.** Use the existing `FormInput` `private_` toggle for reveal on settings pages. The full key is already available server-side; the `+page.server.ts` load can return it for the `private_` password input (hidden by default, revealed on toggle). This matches the existing pattern in `InstanceForm.svelte` and `settings/security/+page.svelte`.

**Option B (stricter): Separate reveal endpoint.** Add `POST ?/revealTmdbKey` and `POST ?/revealAiKey` SvelteKit actions that return the full key only when explicitly requested. This adds complexity but ensures the full key never appears in the initial page load payload.

**Recommendation:** Option A for TMDB/AI keys (lower sensitivity, user-provided tokens). Option B could be considered later if stricter isolation is needed. For the Praxrr auth API key, the `regenerateApiKey` action already provides the full key only on explicit action, and the `private_` toggle handles display.

However, based on the requirement "No API key should ever be fully visible outside the encrypted store," Option B is more aligned. Implement as SvelteKit form actions:

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
```

### OpenAPI Spec Changes

The current OpenAPI spec in `docs/api/v1/paths/arr.yaml` does not expose any instance listing endpoint (the `/arr` routes are SvelteKit page routes, not API routes). The `test` operation already marks `apiKey` as `format: password`. No OpenAPI changes are needed unless a `GET /api/v1/arr/instances` endpoint is added in the future, in which case it must exclude `api_key` from the response schema.

## Server-Side Implementation

### Masking Utility

**File: `packages/praxrr-app/src/lib/shared/utils/masking.ts`**

```typescript
const MASK_CHAR = '\u2022'; // bullet character
const DEFAULT_VISIBLE_CHARS = 4;
const DEFAULT_MASK_LENGTH = 8;

export function maskApiKey(
  key: string | null | undefined,
  visibleChars: number = DEFAULT_VISIBLE_CHARS
): string {
  if (!key || key.length === 0) return '';
  const mask = MASK_CHAR.repeat(DEFAULT_MASK_LENGTH);
  if (key.length <= visibleChars) return mask;
  return mask + key.slice(-visibleChars);
}

export function isMaskedValue(value: string): boolean {
  return value.startsWith(MASK_CHAR);
}
```

Placing this in `$shared/` allows both server-side route handlers and client-side components to import the same masking logic.

### Logger Sanitization

**File: `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`**

The logger currently calls `JSON.stringify(meta)` in `formatMeta()` (logger.ts line 41). The sanitizer should intercept meta objects before serialization:

```typescript
const API_KEY_FIELD_PATTERNS = [
  /api[_-]?key/i,
  /apikey/i,
  /api[_-]?token/i,
  /authorization/i,
  /x-api-key/i,
  /credential/i,
  /ciphertext/i,
  /nonce/i,
  /secret/i,
  /password/i,
  /master[_-]?key/i,
];

const API_KEY_VALUE_PATTERNS = [
  /^[a-f0-9]{32}$/i, // 32-char hex (Arr API keys, Praxrr auth keys)
  /^eyJ[A-Za-z0-9_-]+/, // JWT-like (TMDB bearer tokens)
  /^sk-[a-zA-Z0-9]+/, // OpenAI-style keys
];

export function sanitizeLogMeta(meta: unknown): unknown {
  if (meta === null || meta === undefined) return meta;
  if (typeof meta === 'string') return sanitizeStringValue(meta);
  if (typeof meta !== 'object') return meta;
  if (Array.isArray(meta)) return meta.map(sanitizeLogMeta);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (API_KEY_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
      result[key] =
        typeof value === 'string' ? maskApiKey(value) : '[REDACTED]';
    } else {
      result[key] = sanitizeLogMeta(value);
    }
  }
  return result;
}

function sanitizeStringValue(value: string): string {
  if (API_KEY_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return maskApiKey(value);
  }
  return value;
}
```

**Integration point:** Modify `Logger.formatMeta()` and the file-logging path in `logger.ts` to call `sanitizeLogMeta(meta)` before `JSON.stringify()`. This is a single-point integration:

```typescript
// In logger.ts, line ~41
private formatMeta(meta?: unknown): string {
  if (!meta) return '';
  return `${colors.grey}${JSON.stringify(sanitizeLogMeta(meta))}${colors.reset}`;
}

// And in the file-logging path, line ~119-125
const logEntry: LogEntry = {
  timestamp,
  level,
  message,
  ...(options?.source ? { source: options.source } : {}),
  ...(options?.meta ? { meta: sanitizeLogMeta(options.meta) } : {}),
};
```

### Response Serialization

No new middleware is needed. Masking is applied at the point of data assembly in each `+page.server.ts` load function, which is the established pattern in this codebase. The masking utility function is called inline:

- `settings/general/+page.server.ts`: Apply `maskApiKey()` to AI and TMDB key fields in the returned object.
- `settings/security/+page.server.ts`: Apply `maskApiKey()` to the auth API key in the returned object.

This follows the same pattern already used for Arr instances in `arr/+page.server.ts` (line 21: `api_key: ''`).

## Client-Side Implementation

### Masked Input Component

**File: `packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte`**

A reusable component that displays a masked API key with reveal toggle and copy-to-clipboard:

```svelte
<script lang="ts">
  import { Eye, EyeOff, Copy, Check } from 'lucide-svelte';
  import { alertStore } from '$alerts/store';

  export let maskedValue: string = '';
  export let revealAction: string = '';     // SvelteKit form action for reveal
  export let label: string = 'API Key';
  export let description: string = '';
  export let copyValue: string = '';        // Full key for clipboard (set after reveal)

  let revealed = false;
  let revealedKey = '';
  let copied = false;
  let revealing = false;

  async function handleReveal() {
    if (revealed) {
      revealed = false;
      return;
    }
    // Trigger SvelteKit action to get full key
    revealing = true;
    // ... fetch via form action or API call
  }

  async function handleCopy() {
    const keyToCopy = revealedKey || copyValue;
    if (!keyToCopy) return;
    await navigator.clipboard.writeText(keyToCopy);
    copied = true;
    alertStore.add('success', 'API key copied to clipboard');
    setTimeout(() => { copied = false; }, 2000);
  }
</script>
```

**Design principles:**

- Displays masked value by default (bullet characters + last 4 chars).
- Reveal toggle triggers a server-side action to fetch the full key (not embedded in page data).
- Copy button is only enabled after reveal, ensuring the user has explicitly requested access.
- Follows existing component patterns: uses `lucide-svelte` icons, `alertStore` for feedback, Tailwind CSS v4 classes.
- Compatible with Svelte 5 (no runes), uses `on:click` handlers.

### Existing Pattern: FormInput `private_`

The existing `FormInput.svelte` component already has a `private_` prop that:

- Renders an `<input type="password">` with a show/hide toggle (Eye/EyeOff icons).
- Toggles between `password` and `text` input types.
- This is used in `InstanceForm.svelte` for the Arr API key field (line 441).
- This is used in `settings/security/+page.svelte` for password fields.

For the Arr instance form, this pattern is sufficient because the user is entering a new key (write-only). The `MaskedApiKey` component is for display-only scenarios (showing a stored key).

### Clipboard Integration

The existing clipboard pattern is in `settings/security/+page.svelte` lines 51-56:

```typescript
function copyApiKey() {
  if (apiKey) {
    navigator.clipboard.writeText(apiKey);
    alertStore.add('success', 'API key copied to clipboard');
  }
}
```

The new `MaskedApiKey` component will incorporate this pattern but gate it behind reveal:

1. On page load, only the masked value is available.
2. User clicks "Reveal" which fetches the full key from the server via a form action.
3. Once revealed, the "Copy" button becomes active and copies the full key.
4. The full key is held in component-local state, not exposed in the page's serialized data.

### How Instance Forms Currently Handle API Keys

The `InstanceForm.svelte` component (for creating/editing Arr instances) handles API keys as follows:

1. **Create mode**: Empty `apiKey` field, user types the key, it is submitted via hidden form.
2. **Edit mode**: `apiKey` is initialized as `''` (line 78: `apiKey: '', // Never pre-populate for security`). The user must re-enter the key to save changes. The description reads "Re-enter API key to save changes" (line 436).
3. **Env-managed instances**: The API key field is disabled (line 443: `disabled={lockCoreFields}`), and the description reads "API key is managed by environment variables and cannot be edited" (line 438).
4. **Test connection**: Sends the user-entered key to `/arr/test` via POST (line 184-188). The key is never persisted by the test endpoint.
5. **Form submission**: The key is sent as a hidden input value (line 486-489). On success, the dirty state resets with `apiKey: ''` (line 257).

This pattern is already secure for Arr instances. No changes needed for the Arr instance form.

## Codebase Analysis

### Files Referencing API Keys

**Core encryption/credential system:**

- `/packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts` -- AES-GCM encrypt/decrypt, fingerprint derivation
- `/packages/praxrr-app/src/lib/server/utils/encryption/keys.ts` -- Key ring management, master key loading
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstanceCredentials.ts` -- Encrypted credential CRUD
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` -- Instance queries (already masks api_key in SELECT)
- `/packages/praxrr-app/src/lib/server/db/migrations/20260221_encrypt_arr_api_keys.ts` -- Encryption migration

**Settings with plaintext API keys:**

- `/packages/praxrr-app/src/lib/server/db/queries/tmdbSettings.ts` -- TMDB API key (plaintext)
- `/packages/praxrr-app/src/lib/server/db/queries/aiSettings.ts` -- AI API key (plaintext)
- `/packages/praxrr-app/src/lib/server/db/queries/authSettings.ts` -- Praxrr auth API key (plaintext)

**Routes that return API keys to clients:**

- `/packages/praxrr-app/src/routes/settings/general/+page.server.ts` -- Returns TMDB and AI keys unmasked (lines 56-62)
- `/packages/praxrr-app/src/routes/settings/security/+page.server.ts` -- Returns auth API key unmasked (line 18)

**Routes that already handle API key masking correctly:**

- `/packages/praxrr-app/src/routes/arr/+page.server.ts` -- Sets `api_key: ''` (line 21)
- `/packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts` -- Destructures out api_key (line 18)
- `/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts` -- Sets `api_key: ''` (line 44)

**Routes that handle API keys in transit (write-only, no masking needed):**

- `/packages/praxrr-app/src/routes/arr/test/+server.ts` -- Connection test, receives key from client
- `/packages/praxrr-app/src/routes/arr/new/+page.server.ts` -- Create instance, receives key from client
- `/packages/praxrr-app/src/routes/api/tmdb/test/+server.ts` -- TMDB test, receives key from client

**Client components with API key fields:**

- `/packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte` -- Arr instance form (already uses `private_`)
- `/packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte` -- Inline show/hide toggle
- `/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte` -- Inline show/hide toggle
- `/packages/praxrr-app/src/routes/settings/security/+page.svelte` -- Auth API key display + copy

**Client component type definitions:**

- `/packages/praxrr-app/src/routes/settings/general/components/types.ts` -- TMDBSettings, AISettings interfaces

**Backend API key consumers (use encrypted client, no masking needed in these):**

- `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` -- Decrypts key just-in-time for client creation
- `/packages/praxrr-app/src/lib/server/utils/arr/factory.ts` -- Creates Arr client with plaintext key (in-memory only)
- `/packages/praxrr-app/src/lib/server/utils/arr/base.ts` -- Sets `X-Api-Key` header (line 38)
- `/packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts` -- Env reconciliation (encrypts before storing)
- `/packages/praxrr-app/src/lib/server/utils/tmdb/client.ts` -- Sets `Authorization: Bearer` header
- `/packages/praxrr-app/src/lib/server/utils/ai/client.ts` -- Sets `Authorization: Bearer` header, caches key in memory
- `/packages/praxrr-app/src/lib/server/sync/processor.ts` -- Uses `getArrInstanceClient()` (line 133)

**Logger system:**

- `/packages/praxrr-app/src/lib/server/utils/logger/logger.ts` -- Logger with no meta sanitization
- `/packages/praxrr-app/src/lib/server/utils/logger/types.ts` -- Logger types
- `/packages/praxrr-app/src/lib/server/utils/auth/middleware.ts` -- Already masks API key in log (line 105)

**Test files:**

- `/packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts` -- Tests Arr key redaction in routes
- `/packages/praxrr-app/src/tests/base/arrCredentialEncryption.test.ts` -- Tests encryption/decryption
- `/packages/praxrr-app/src/tests/base/arrCredentialCutover.test.ts` -- Tests encrypted client flow
- `/packages/praxrr-app/src/tests/base/envInstances.test.ts` -- Tests env-based instance reconciliation

**Docker/config files:**

- `/compose.dev.yml` -- May contain API key env vars
- `/compose.yml` -- May contain API key env vars

### Files to Modify

| File                                                                             | Change                                                                             |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`                      | Import and apply `sanitizeLogMeta()` in `formatMeta()` and file-logging path       |
| `packages/praxrr-app/src/routes/settings/general/+page.server.ts`                | Mask TMDB and AI API keys in load return; add reveal actions                       |
| `packages/praxrr-app/src/routes/settings/security/+page.server.ts`               | Mask auth API key in load return                                                   |
| `packages/praxrr-app/src/routes/settings/security/+page.svelte`                  | Use `MaskedApiKey` component instead of inline pattern                             |
| `packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte` | Use `MaskedApiKey` component or update to receive masked value + use reveal action |
| `packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`   | Same as TMDB                                                                       |
| `packages/praxrr-app/src/routes/settings/general/components/types.ts`            | Update `TMDBSettings` and `AISettings` interfaces to use masked fields             |

### Files to Create

| File                                                             | Purpose                                             |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| `packages/praxrr-app/src/lib/shared/utils/masking.ts`            | Shared `maskApiKey()` utility function              |
| `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`   | Logger meta sanitization for API keys               |
| `packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte` | Reusable masked API key display component           |
| `packages/praxrr-app/src/tests/base/apiKeyMasking.test.ts`       | Unit tests for masking utility and logger sanitizer |

## Technical Decisions

### Decision 1: Masking layer -- serialization vs query

**Options:**

- A) Mask at the DB query level (like `arrInstancesQueries` does with `'' AS api_key`).
- B) Mask at the route/serialization layer (in `+page.server.ts` load functions).

**Recommendation: Option B** for TMDB/AI/auth keys. The `+page.server.ts` files are the boundary between server and client. Masking here is explicit, auditable, and does not require modifying query functions that other server-side code depends on (e.g., the AI client needs the plaintext key from `aiSettingsQueries.get()` to make API calls). Option A is appropriate for Arr keys (already done) because no server-side consumer needs the plaintext from the query -- they go through the encrypted credential system instead.

### Decision 2: Logger sanitization -- pattern-based vs explicit opt-in

**Options:**

- A) Automatic pattern-based sanitization (scan all meta fields for key-like patterns).
- B) Explicit opt-in (callers must use a `sensitive()` wrapper for fields they want redacted).

**Recommendation: Option A** as the primary mechanism, with pattern matching on field names. This provides defense-in-depth -- even if a developer forgets to mark a field, common patterns like `api_key`, `apiKey`, `secret`, `password` are caught. The risk of false positives is low since these field names are unambiguous. Value-pattern matching (detecting 32-char hex strings) should be a secondary heuristic applied cautiously.

### Decision 3: Reveal mechanism -- page data vs action

**Options:**

- A) Include full key in page load data (hidden by `type="password"` input), toggle reveals it client-side.
- B) Return only masked value in page load; reveal requires a server action (form POST).

**Recommendation: Option B** for strict compliance with "no API key should ever be fully visible outside the encrypted store." Option A technically includes the full key in the HTML/SSR payload even though it is not visible. Option B ensures the full key only travels over the wire when the user explicitly requests it.

### Decision 4: Component reuse vs new component

**Options:**

- A) Reuse existing `FormInput` with `private_` prop, adapt it for display-only masked values.
- B) Create a new `MaskedApiKey` component purpose-built for display + reveal + copy.

**Recommendation: Option B.** `FormInput` is designed for editable inputs. A display-only masked key component has different interaction patterns (reveal from server, copy-to-clipboard, no form binding needed). Creating a new component keeps `FormInput` focused and avoids adding conditional logic for a fundamentally different use case.

### Decision 5: Scope of API keys to mask

**In scope for this feature:**

- Arr instance API keys (already encrypted at rest and masked in queries)
- TMDB API read access token
- AI service API key
- Praxrr auth API key

**Out of scope (but noted for future):**

- Database instance personal access tokens (stored in `database_instances.personal_access_token`)
- Git credentials for PCD repos
- Encryption master keys (never in DB, env-only)

## Open Questions

1. **TMDB/AI key encryption at rest**: Should this feature also encrypt TMDB and AI API keys at rest (like Arr keys), or is masking in UI/API/logs sufficient? These are user-provided service tokens with lower sensitivity than Arr instance keys. Encrypting them adds implementation complexity and operational requirements (master key dependency) for arguably limited security gain. **Recommendation:** Defer encryption at rest for TMDB/AI keys; focus on masking.

2. **Reveal audit logging**: Should key reveal actions be logged? The auth middleware already logs API key authentication attempts. Logging reveal actions provides an audit trail for sensitive data access. **Recommendation:** Yes, log reveal actions at INFO level with the user/session context.

3. **Copy-to-clipboard browser compatibility**: The `navigator.clipboard.writeText()` API requires HTTPS in some browsers. The dev server runs on HTTP. Should there be a fallback mechanism? **Recommendation:** The existing pattern in `settings/security/+page.svelte` already uses `navigator.clipboard` without fallback, so maintain consistency. Document that clipboard copy requires HTTPS in production.

4. **Rate limiting on reveal actions**: Should reveal actions be rate-limited to prevent brute-force extraction? **Recommendation:** Not needed initially -- reveal actions require an authenticated session, and the keys themselves are not secrets from the authenticated user (the user entered them). Rate limiting the auth layer is sufficient.

5. **Backward compatibility of settings page data shape**: Changing the `settings/general` load return shape (removing `api_key`, adding `api_key_masked`) will break the TMDB and AI settings components. This must be coordinated -- the component changes and server changes must ship together. **Recommendation:** Implement as a single atomic change set.
