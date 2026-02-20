# Pattern Research: API Key Masking

This document catalogs the concrete coding patterns, naming conventions, error handling approaches, and testing strategies used in the Praxrr codebase that are directly relevant to implementing API key masking. Every pattern includes file paths and line references into the actual source.

## Relevant Files

- `/packages/praxrr-app/src/routes/settings/general/+page.server.ts`: Settings load + form actions (TMDB/AI keys flow here)
- `/packages/praxrr-app/src/routes/settings/general/+page.svelte`: Settings page consuming load data
- `/packages/praxrr-app/src/routes/settings/general/components/types.ts`: Settings component type definitions (AISettings, TMDBSettings interfaces)
- `/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`: AI key display with manual Eye/EyeOff toggle
- `/packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`: TMDB key display with manual Eye/EyeOff + test connection
- `/packages/praxrr-app/src/routes/settings/security/+page.server.ts`: Auth API key load + regenerate action
- `/packages/praxrr-app/src/routes/settings/security/+page.svelte`: Auth key display using FormInput private\_ + Copy button
- `/packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte`: Reusable form input with `private_` prop (Eye/EyeOff toggle)
- `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Arr credential stripping via `arrInstanceSelect` SQL alias (line 48-62)
- `/packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts`: Arr layout destructuring to omit `api_key` (line 18)
- `/packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts`: AES-GCM encrypt/decrypt for Arr keys
- `/packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: Logger class with `formatMeta()` that serializes meta via `JSON.stringify`
- `/packages/praxrr-app/src/lib/server/utils/logger/types.ts`: LogOptions, LogEntry, LoggerConfig type definitions
- `/packages/praxrr-app/src/lib/client/alerts/store.ts`: Alert store for user feedback
- `/packages/praxrr-app/src/lib/shared/utils/uuid.ts`: Example shared utility pattern (pure function, no dependencies)
- `/packages/praxrr-app/src/lib/shared/utils/dates.ts`: Example shared utility pattern (exports, JSDoc)
- `/packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts`: Credential redaction test (layout + API endpoint)
- `/packages/praxrr-app/src/tests/base/arrCredentialEncryption.test.ts`: Encryption unit test with mock patching
- `/packages/praxrr-app/src/tests/base/BaseTest.ts`: Base test class with `installPatch()`, `assertPayloadNoLeak()`
- `/packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts`: Bug -- uses `createArrClient()` with empty `api_key` (line 25)
- `/packages/praxrr-app/src/lib/server/db/queries/aiSettings.ts`: AI settings singleton queries
- `/packages/praxrr-app/src/lib/server/db/queries/tmdbSettings.ts`: TMDB settings singleton queries
- `/packages/praxrr-app/src/lib/server/db/queries/authSettings.ts`: Auth settings queries with `regenerateApiKey()`

## Architectural Patterns

### Settings Page Load Functions

Settings pages use synchronous `load()` that queries singleton DB rows, validates presence with `throw new Error()`, and returns a shaped object. No `ServerLoad` type annotation on the general settings page (uses `export const load = () =>`), but the security page uses `export const load: ServerLoad = async ({ cookies }) =>`.

- Pattern: Query DB, null-check with thrown error, return only the fields the UI needs.
- Example: `/packages/praxrr-app/src/routes/settings/general/+page.server.ts` lines 12-67.
- The load function currently returns `api_key: aiSetting.api_key` as raw plaintext (line 57) and `api_key: tmdbSetting.api_key` (line 61). These are the two primary masking targets.
- Security page returns `apiKey: authSettingsQueries.getApiKey()` as plaintext (line 18).

### Form Actions Pattern

All form actions follow this structure: parse `formData`, validate inputs, call query module, handle failure with `fail(status, { error: message })`, log result, return `{ success: true }`.

- Named actions use `?/actionName` convention: `updateAI`, `updateTMDB`, `updateLogs`, `changePassword`, `regenerateApiKey`.
- Error returns use `fail(400, { error: '...' })` for validation, `fail(500, { error: '...' })` for DB/server errors.
- Success returns `{ success: true }` or `{ success: true, extraField: value }`.
- Example: `/packages/praxrr-app/src/routes/settings/general/+page.server.ts` lines 192-236 (`updateAI` action).
- The `regenerateApiKey` action returns the full new key: `{ apiKey: newKey, apiKeyRegenerated: true }` (line 97) -- this is the show-once pattern.

### FormInput private\_ Prop

The `FormInput.svelte` component has a `private_: boolean = false` prop that toggles the input between password and text type, with an Eye/EyeOff button.

- When `private_` is true, a separate `{#if private_}` branch renders with a relative-positioned wrapper, the eye toggle button, and dynamic `inputType` computed as `showPassword ? 'text' : 'password'`.
- The component dispatches `input`, `focus`, `blur` events via `createEventDispatcher`.
- Has a `suffix` slot for extra right-side content, with padding adjustment via `privatePaddingClass`.
- Used in security page for password fields and the auth API key read-only display.
- Example: `/packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte` lines 16, 35-37, 114-148.

### Arr Credential Stripping (Query-Level)

Arr instance queries use a SQL select alias `'' AS api_key` to return an empty string instead of the actual key. This is a query-level masking pattern.

- The constant `arrInstanceSelect` is defined once and reused by all query methods (`getById`, `getAll`, `getByType`, etc.).
- Pattern: `SELECT id, name, ..., '' AS api_key, ... FROM arr_instances`.
- Example: `/packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` lines 48-62.

### Arr Layout Destructuring

The Arr `[id]/+layout.server.ts` strips `api_key` from the instance object before returning it to the client using object destructuring.

- Pattern: `const { api_key: _api_key, ...instanceWithoutSecret } = instance;`
- This is a second defense layer on top of the query-level empty string.
- Example: `/packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts` line 18.

### Arr Instance Settings Page (api_key empty string)

The Arr settings page load function further ensures `api_key: ''` by spreading the parent layout instance and overriding.

- Pattern: `return { instance: { ...instance, source, api_key: '' } }`.
- The form submission on the settings page receives a new `api_key` from the user form (user re-enters the key to change it). Empty key is rejected: `if (!isEnvManaged && !apiKey) return fail(400, { error: 'API Key is required' })`.
- Example: `/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts` lines 29-48.

### Encrypted Credential Flow

Arr API keys are encrypted with AES-GCM before storage and decrypted on demand via `getArrInstanceClient()`.

- Encrypt flow: `encryptArrInstanceApiKey(apiKey)` returns `{ credential: { keyVersion, nonce, ciphertext }, fingerprint: { keyVersion, value } }`.
- Decrypt flow: `decryptArrInstanceApiKey({ keyVersion, nonce, ciphertext })` returns plaintext string.
- Client creation: `getArrInstanceClient(type, instanceId, url)` handles the full decrypt + client creation, with caching by `instanceId:keyVersion`.
- Example: `/packages/praxrr-app/src/lib/server/utils/encryption/arr-credentials.ts` lines 89-118 (encrypt), 120-146 (decrypt).
- Example: `/packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` lines 54-98.

### Settings Components and Component Types

Settings component types are defined in a sibling `types.ts` file within the component directory. Each component receives its settings as a typed prop.

- Type file: `/packages/praxrr-app/src/routes/settings/general/components/types.ts`
- Current interfaces: `AISettings { enabled, api_url, api_key, model }`, `TMDBSettings { api_key }`.
- These will need to change to `api_key_masked` + `has_api_key` per the feature spec.
- Components use `export let settings: AISettings;` and bind directly to `settings.api_key`.

### Inline Eye/EyeOff in AI/TMDB Settings

Both AISettings.svelte and TMDBSettings.svelte implement their own inline eye toggle rather than using FormInput's `private_` prop. They use raw `<input type={showApiKey ? 'text' : 'password'}>` with adjacent button.

- Icons: `Eye`, `EyeOff` from `lucide-svelte`.
- Local state: `let showApiKey = false;` toggled by button click.
- The AI component also has a reset-to-defaults function that clears the key.
- Example: `/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte` lines 10, 113-133.
- Example: `/packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte` lines 9, 85-105.

## Code Conventions

### Shared Utility Organization

Shared utilities live under `$shared/utils/` as individual `.ts` files, each exporting pure functions.

- Naming: lowercase filename matching the concept (`dates.ts`, `uuid.ts`, `version.ts`).
- The masking utility should be `$shared/utils/masking.ts` per the feature spec.
- Functions use JSDoc with `@param` and `@example` blocks.
- Example: `/packages/praxrr-app/src/lib/shared/utils/dates.ts` -- exports `toUTC()` and `parseUTC()`, both are pure functions with JSDoc.
- Example: `/packages/praxrr-app/src/lib/shared/utils/uuid.ts` -- exports a single `uuid()` function.

### Import/Export Conventions

- Server-side: `import { X } from '$db/queries/Y.ts';` -- always with `.ts` extension.
- Client-side: `import X from '$ui/form/FormInput.svelte';` -- default import for Svelte components.
- Shared: `import { X } from '$shared/utils/Y';` -- sometimes without `.ts` extension on client imports.
- Path aliases are used extensively (see CLAUDE.md alias table).
- Query modules export a const object with methods: `export const fooQueries = { get(), update(), ... }`.

### Svelte Component Conventions

- Svelte 5, no runes. Props use `export let`.
- Event handlers use `onclick` / `on:click` (mixed -- `onclick` for newer patterns in FormInput, `on:click` for older patterns in AISettings/TMDBSettings).
- `use:enhance` for progressive form enhancement with SvelteKit.
- `lucide-svelte` for icons (Eye, EyeOff, Copy, Check, Save, RotateCcw, etc.).
- Tailwind CSS v4 classes with dark mode variants (`dark:bg-neutral-800`, etc.).
- Component files use tabs, single quotes, no trailing commas per Prettier config.

### Naming Conventions

- DB column names: `snake_case` (`api_key`, `api_key_fingerprint`).
- TypeScript interfaces: `PascalCase` (`AISettings`, `TMDBSettings`, `ArrInstance`).
- Interface fields: `snake_case` matching DB columns.
- Function/method parameters: `camelCase` (`apiKey`, `retentionDays`).
- Query module exports: `camelCase` const (`aiSettingsQueries`, `arrInstancesQueries`).
- Form action names: `camelCase` (`updateAI`, `updateTMDB`, `regenerateApiKey`).
- SvelteKit form names: match DB column names (`name="api_key"`).

### Logger Meta Conventions

- Logger calls: `await logger.info('message', { source: 'context', meta: { ... } })`.
- Source strings use hierarchical naming: `'settings/general'`, `'arr/[id]/settings'`, `'Auth:APIKey'`, `'Auth:Session'`.
- Meta objects are untyped (`unknown`) per `LogOptions.meta`.
- **Important security note**: The `updateAI` action explicitly comments `// Note: Don't log apiKey for security` and omits `apiKey` from logged meta (line 228-232). This shows the current ad-hoc approach that logger sanitization will systematize.

## Error Handling

### Form Action Error Pattern

Every form action follows this error handling structure:

```typescript
// 1. Validation errors return fail(400)
if (!field) {
  return fail(400, { error: 'Field is required' });
}

// 2. DB operation failures return fail(500) with logger.error
const updated = queries.update({ ... });
if (!updated) {
  await logger.error('Failed to update X', {
    source: 'settings/general',
  });
  return fail(500, { error: 'Failed to update settings' });
}

// 3. Success returns { success: true }
return { success: true };
```

- Example: `/packages/praxrr-app/src/routes/settings/general/+page.server.ts` lines 80-120.
- Arr settings page wraps credential processing in try/catch and translates encryption errors to user-friendly messages via `getArrCredentialProcessingErrorMessage()` (lines 10-27 of `/packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`).

### AlertStore Usage

Client-side error/success feedback uses `alertStore.add(type, message)` inside `use:enhance` callbacks.

```typescript
use:enhance={() => {
  return async ({ result, update }) => {
    if (result.type === 'failure' && result.data) {
      alertStore.add('error', (result.data as { error?: string }).error || 'Failed to save');
    } else if (result.type === 'success') {
      alertStore.add('success', 'Settings saved successfully!');
    }
    await update();
  };
}}
```

- Types: `'success' | 'error' | 'warning' | 'info'`.
- Auto-dismiss via configurable timeout (default from `alertSettingsStore`).
- Example: `/packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte` lines 45-54.

### Clipboard Operations

The security page implements clipboard copy with basic error handling:

```typescript
function copyApiKey() {
  if (apiKey) {
    navigator.clipboard.writeText(apiKey);
    alertStore.add('success', 'API key copied to clipboard');
  }
}
```

- No error handling on the clipboard call itself.
- No fallback for non-HTTPS contexts.
- Example: `/packages/praxrr-app/src/routes/settings/security/+page.svelte` lines 51-56.

### Logger Error Patterns

The logger is async (`await logger.error(...)`) and failures during log file writes are caught and sent to `console.error` as a fallback. Meta objects are serialized via `JSON.stringify` without any sanitization.

- Key integration point: `formatMeta()` at line 40-43 and the file-logging JSON serialization at lines 119-125.
- The logger has no interceptor/middleware pattern currently. Sanitization must be injected into `formatMeta()` and the file-write path.

## Testing Approach

### Test Infrastructure

Tests use Deno's built-in test runner (`Deno.test`) with `@std/assert` assertions. Two patterns are used:

1. **Standalone `Deno.test` calls** -- simpler tests call `Deno.test` directly with `async () => { ... }` body.
2. **`BaseTest` class** -- complex test suites extend `BaseTest` which provides lifecycle hooks (`beforeEach`, `afterEach`), `installPatch()` for monkey-patching, `assertPayloadNoLeak()` for credential leak detection, and temp directory management.

Test runner: `scripts/test.ts` with alias mapping. Tests live in `packages/praxrr-app/src/tests/`.

### Credential Redaction Tests

The `arrCredentialRedactionRoutes.test.ts` file is the primary example for testing credential masking. Key patterns:

1. **Environment configuration**: Tests set `ARR_CREDENTIAL_MASTER_KEY` and version in both `Deno.env` and the config object, with restore-on-teardown.
2. **Patching queries**: `this.installPatch(arrInstancesQueries, 'getById', () => fixture, this.restoreStack)` to return controlled data.
3. **Patching crypto**: `crypto.subtle.decrypt` is patched to return known plaintext for deterministic tests.
4. **Invoking load/API directly**: The test imports `load` from `+layout.server.ts` and `GET` from `+server.ts`, calling them with minimal mock parameters.
5. **Leak assertion**: `this.assertPayloadNoLeak(payload, SECRET_API_KEY, 'context')` serializes the payload and checks the forbidden string is absent.
6. **Field absence**: `assertFalse('api_key' in layout.instance)` verifies the field is not present at all.

Example: `/packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts` lines 196-213 (layout test), 216-239 (episodes endpoint test).

### Mocking Patterns

Two mocking approaches are used:

1. **`patchTarget` helper** (standalone): Takes `target`, `key`, `replacement`, `restores[]`. Manual restore in finally block.
   - Example: `/packages/praxrr-app/src/tests/base/arrCredentialEncryption.test.ts` lines 61-72.

2. **`BaseTest.installPatch`** (class-based): Same signature but managed by the class lifecycle.
   - Example: `/packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts` line 199.

DB mocking pattern: Patch `db.execute`, `db.queryFirst`, `db.beginTransaction`, `db.commit`, `db.rollback` with no-op or recording functions.

### Test File Naming and Aliases

Test files use `camelCase.test.ts` naming. Aliases can be registered in `scripts/test.ts` for `deno task test <alias>`. The new masking test should be registered there.

## Patterns to Follow

### For `maskApiKey()` in `$shared/utils/masking.ts`

- Follow the `uuid.ts` / `dates.ts` pattern: export pure functions with JSDoc, no class wrapper.
- Signature: `export function maskApiKey(key: string | null | undefined, visibleChars?: number): string`.
- Add `export function isMaskedValue(value: string): boolean` to detect masked strings.
- File should have a module-level JSDoc comment explaining the masking format.

### For Logger Sanitizer in `$logger/sanitizer.ts`

- Create as a new file adjacent to `logger.ts` in the `$logger/` directory.
- Export a `sanitizeLogMeta(meta: unknown): unknown` function.
- Integrate by calling it in `Logger.formatMeta()` (line 40-43 of `logger.ts`) and in the file-logging entry construction (lines 119-125).
- Sensitive field names to match (from feature spec): `api_key`, `apiKey`, `password`, `secret`, `token`, `authorization`, `ciphertext`, `nonce`, `master_key`.

### For Settings Load Masking

- Replace `api_key: aiSetting.api_key` with `api_key_masked: maskApiKey(aiSetting.api_key), has_api_key: !!aiSetting.api_key` in `settings/general/+page.server.ts`.
- Same pattern for TMDB and auth settings.
- Update the component types in `settings/general/components/types.ts` to match: replace `api_key: string` with `api_key_masked: string; has_api_key: boolean`.

### For Reveal Form Actions

- Add `revealTmdbKey`, `revealAiKey` actions to `settings/general/+page.server.ts`.
- Add `revealAuthKey` action to `settings/security/+page.server.ts`.
- Follow existing action pattern: `async () => { const settings = queries.get(); return { revealedField: settings?.api_key ?? '' }; }`.
- The `regenerateApiKey` action already returns full key (show-once) and should not be changed.

### For `MaskedApiKey.svelte` Component

- Place in `$ui/form/MaskedApiKey.svelte`.
- Use `export let` props: `maskedValue: string`, `hasKey: boolean`, `revealAction: string`, `disabled: boolean = false`.
- Icons from `lucide-svelte`: `Eye`, `EyeOff`, `Copy`, `Check`.
- Follow the `Button.svelte` pattern for variant/size props and Tailwind classes.
- Use `fetch` or form action to get the full key on reveal/copy, not embedded in page data.
- 30-second auto-hide timer per feature spec.

### For Redaction Tests

- Extend the pattern from `arrCredentialRedactionRoutes.test.ts`:
  - Import `load` from the settings `+page.server.ts`.
  - Patch the relevant query module (`aiSettingsQueries`, `tmdbSettingsQueries`, `authSettingsQueries`) to return fixtures with known key values.
  - Call `load()` with minimal mock params.
  - Use `assertPayloadNoLeak(result, SECRET_KEY, 'context')` to verify the key is not in the serialized result.
  - Verify the masked field format matches `maskApiKey()` output.
- Register the test alias in `scripts/test.ts`.

### For the Logs Page Bug Fix

- `/packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts` line 25 calls `createArrClient(instance.type, instance.url, instance.api_key)` but `instance.api_key` is always `''` due to the query-level stripping.
- Fix: Replace with `getArrInstanceClient(instance.type, instance.id, instance.url)` which handles credential decryption.
- This matches the pattern used in all API v1 routes (episodes, releases, cleanup, library endpoints).

## Edge Cases

- The `arrInstanceSelect` SQL alias returns `'' AS api_key` which means `instance.api_key` is always empty string (not null), so `maskApiKey('')` needs to handle empty strings and return empty or "Not configured".
- Auth API key can be null (`api_key: string | null` in `AuthSettings`), so `maskApiKey()` must handle null.
- TMDB and AI `api_key` fields are `string` (never null in the DB interface), but can be empty strings after reset.
- The `regenerateApiKey` action returns the full key in the action result (`form?.apiKey`), and the security page reads it as `$: apiKey = form?.apiKey ?? data.apiKey`. After masking the load data, this reactive statement needs to distinguish between the masked load value and the full action-returned value.
- Environment-managed Arr instances (`source: 'env'`) should have reveal/copy disabled per the feature spec since keys are managed externally.
- The TMDB test connection (`testConnection()` in TMDBSettings.svelte) sends `settings.api_key` via POST. After masking, the component must distinguish between the masked display value and a user-entered new key for testing.

## Other Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/feature-spec.md`: Full feature specification with architecture diagram, phasing, and decision matrix
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-technical.md`: Technical research on masking approaches
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-recommendations.md`: Implementation approach comparison
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-ux.md`: UX research and competitive analysis
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/api-key-masking/research-business.md`: Business domain analysis
- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`: Project conventions, path aliases, and development rules
