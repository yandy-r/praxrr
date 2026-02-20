# External API Research: api-key-masking

## Executive Summary

API key masking is a well-established security pattern with consistent approaches across cloud providers and password managers: mask by default, require explicit user action to reveal, and support one-click copy-to-clipboard. Praxrr should implement a three-layer masking strategy: (1) a server-side serialization layer that never returns raw keys in API/page responses, (2) a log redaction pass using either custom regex patterns or field-based redaction on the existing Logger class, and (3) a client-side masked input component with reveal toggle and clipboard copy. No external masking library is strictly necessary since the masking logic is simple enough to implement inline, but log redaction benefits from the `@logtape/redaction` package already built for Deno.

## Industry Patterns for API Key Masking

### Cloud Provider Dashboard Patterns

**Confidence**: High (multiple authoritative sources agree, well-documented public behavior)

| Provider   | Masking Strategy                                                                     | Reveal Mechanism                                  | Copy Mechanism              |
| ---------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------- |
| AWS IAM    | Secret key shown only at creation time; never retrievable afterward                  | No reveal post-creation; must create new key      | One-time copy at creation   |
| GitHub PAT | Token displayed once after generation; permanently hidden thereafter                 | No reveal; regenerate key instead                 | Copy at creation, then gone |
| Stripe     | Secret key shown as `sk_test_...` prefix with rest masked; live keys shown only once | "Reveal test key" button; live keys one-time only | Click key value to copy     |

**Common masking formats observed:**

- **Prefix-visible**: `sk_test_...XXXX` (Stripe) -- show type prefix, mask the rest
- **Suffix-visible**: `••••••••ab3f` -- show last 4 characters for verification
- **Full replacement**: `****` asterisks (Radarr V5)
- **Show-once**: display full value at creation, never again (AWS, GitHub)

**Consensus pattern:** The most user-friendly approach for Praxrr combines suffix-visible masking (`••••••••ab3f`) for at-a-glance key identification with an explicit "Reveal" action and "Copy" button. This is the pattern used by Stripe's test mode dashboard.

Sources:

- [AWS IAM Access Keys Documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html)
- [GitHub PAT Management Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Stripe API Keys Documentation](https://docs.stripe.com/keys)
- [Stripe Key Management Dashboard](https://stripe.com/docs/development/dashboard/manage-api-keys)

### Password Manager UI Patterns

**Confidence**: Medium (patterns observed from community forums and documentation, not direct source code)

Both **1Password** and **Bitwarden** use an eye icon toggle to reveal/hide passwords:

- **Default state**: All characters replaced with bullet dots (e.g., `••••••••••••`)
- **Reveal**: Click eye icon to toggle between masked and plaintext
- **Auto-hide**: Some implementations auto-hide after a configurable timeout (30s-60s)
- **Clipboard**: Separate copy button that copies the actual value without revealing it visually

**Bitwarden-specific behavior:** The password visibility toggle button (eye icon) in Bitwarden's browser extension coexists with website native reveal buttons. In version 2024.12.3+, clicking the toggle returns cursor focus to the password field.

**Key UX insight**: Password managers separate the "copy" action from the "reveal" action. Users can copy a credential without ever seeing it on screen, which is ideal for environments where shoulder-surfing is a concern.

Sources:

- [Bitwarden Show Password Toggle Discussion](https://community.bitwarden.com/t/show-password-toggle/89743)
- [Bitwarden Password Visibility During Login](https://community.bitwarden.com/t/password-visibility-during-login-and-password-protection-while-vault-unlocked/13850)
- [Bitwarden Re-enable Toggle Visibility](https://community.bitwarden.com/t/re-enable-toggle-visibility-action-to-return-to-the-password/77700)

### Arr Ecosystem Precedent

**Confidence**: High (confirmed via GitHub issue tracking and Buildarr integration reports)

**Radarr V5 obfuscation approach:**

Radarr V5 introduced server-side obfuscation where API keys and passwords returned via the API are replaced with `*` characters. This is a full replacement strategy -- the entire key value becomes asterisks.

**Key implementation details:**

- Obfuscation happens at the API response serialization layer in the C# backend
- The UI receives only asterisks, never the actual credential
- Resources with obfuscated fields can still be saved back -- if the submitted value matches the obfuscation pattern, the server retains the existing stored value
- Connection tests are skipped for resources re-saved with unchanged settings (to avoid the obfuscated key being tested against the Arr instance)

**Implications for Praxrr:**

- Praxrr already returns `'' AS api_key` in the SQL select for `arrInstancesQueries`, effectively returning empty strings instead of actual keys
- Radarr's approach of full asterisk replacement is aggressive and broke idempotent configuration management tools (Buildarr)
- Praxrr's approach should be more nuanced: show last 4 characters for identification, support reveal/copy for legitimate administration, but never return the full key by default

Sources:

- [Radarr Issue #9397: Un-obfuscate passwords and API keys](https://github.com/Radarr/Radarr/issues/9397)
- [Buildarr-Radarr Issue #20: Passwords and API keys are obfuscated](https://github.com/buildarr/buildarr-radarr/issues/20)

## Libraries and SDKs

### Recommended Libraries

#### 1. @logtape/redaction -- Log Redaction (Deno-native)

**Confidence**: High (published on JSR, purpose-built for Deno, well-documented)

LogTape is a zero-dependency logging library with first-class Deno support via JSR. Its `@logtape/redaction` package provides two complementary redaction strategies:

**Pattern-based redaction** -- regex-driven, operates on formatted output:

```typescript
import { redactByPattern } from '@logtape/redaction';

const API_KEY_PATTERN = {
  pattern: /[a-f0-9]{32}/gi,
  replacement: '[REDACTED_API_KEY]',
};

const formatter = redactByPattern(defaultConsoleFormatter, [API_KEY_PATTERN]);
```

**Field-based redaction** -- name-driven, operates on structured log data:

```typescript
import { redactByField, DEFAULT_REDACT_FIELDS } from '@logtape/redaction';

const sink = redactByField(getConsoleSink(), [
  /api[-_]?key/i,
  /password/i,
  /secret/i,
  /token/i,
  ...DEFAULT_REDACT_FIELDS,
]);
```

**Installation:**

```bash
deno add jsr:@logtape/redaction
```

**Trade-off for Praxrr:** Praxrr uses a custom Logger class (not LogTape). Adopting `@logtape/redaction` would either require migrating to LogTape as the logging backend, or extracting the redaction logic and applying it within the existing Logger. A simpler approach is to add regex-based redaction directly to the existing `formatMeta()` method.

Sources:

- [LogTape Data Redaction Manual](https://logtape.org/manual/redaction)
- [@logtape/redaction on npm](https://www.npmjs.com/package/@logtape/redaction)
- [@logtape/logtape on JSR](https://jsr.io/@logtape/logtape)

#### 2. @transcend-io/secret-value -- Type-safe Secret Wrapper

**Confidence**: Medium (single authoritative source, MIT licensed, well-designed API)

A TypeScript utility that wraps sensitive values so they cannot be accidentally logged or serialized:

```typescript
import { Secret } from '@transcend-io/secret-value';

const apiKey = new Secret('abc123def456');

console.log(apiKey); // [redacted]
JSON.stringify(apiKey); // "[redacted]"
apiKey.toString(); // [redacted]
apiKey.release(); // "abc123def456" (explicit unwrap)
```

Also supports wrapping specific object fields:

```typescript
import { wrapSecrets } from '@transcend-io/secret-value';

const config = wrapSecrets({ url: 'http://radarr:7878', apiKey: 'abc123' }, ['apiKey']);
console.log(config); // { url: 'http://radarr:7878', apiKey: [redacted] }
```

**Trade-off for Praxrr:** Elegant compile-time safety but introduces a dependency for what could be a simple runtime function. The `Secret<T>` type would need to permeate through any code that handles API keys, which is a significant refactor. More practical for greenfield projects.

Sources:

- [@transcend-io/secret-value on GitHub](https://github.com/transcend-io/secret-value)
- [Transcend Blog: Keeping Sensitive Values Out of Logs](https://transcend.io/blog/keep-sensitive-values-out-of-your-logs-with-types)

#### 3. svelte-copy -- Clipboard Action for Svelte 5

**Confidence**: High (MIT licensed, Svelte 5 compatible, uses Clipboard API with fallback)

A Svelte action for copying text to clipboard with automatic fallback from `navigator.clipboard` to legacy methods:

```svelte
<script>
  import { copy } from 'svelte-copy';
</script>

<button
  use:copy={{
    text: fullApiKeyValue,
    onCopy({ text }) {
      alertStore.add('success', 'API key copied to clipboard');
    },
    onError({ error }) {
      alertStore.add('error', `Copy failed: ${error.message}`);
    }
  }}
>
  Copy Key
</button>
```

**Installation:**

```bash
npm install svelte-copy -D
```

**Note:** Svelte-copy v2 requires Svelte 5. Praxrr uses Svelte 5 so this is compatible.

Sources:

- [svelte-copy on GitHub](https://github.com/ghostdevv/svelte-copy)
- [svelte-copy on npm](https://www.npmjs.com/package/svelte-copy)

### Alternative Options

#### fast-redact (Log Redaction)

**Confidence**: High (mature library, used by Pino, well-benchmarked)

Very fast object redaction via compiled functions. ~30x faster than pino-noir, ~1% overhead on JSON.stringify for static paths.

```typescript
import fastRedact from 'fast-redact';

const redact = fastRedact({
  paths: ['apiKey', 'api_key', '*.apiKey', '*.api_key'],
  censor: '[REDACTED]',
});

redact({ name: 'radarr', apiKey: 'abc123' });
// {"name":"radarr","apiKey":"[REDACTED]"}
```

**Pros:**

- Exceptional performance (~161M ops/sec for correct usage)
- Path-based configuration with wildcard support
- Battle-tested in Pino ecosystem

**Cons:**

- Mutates original object (must use `.restore()` or `serialize: true`)
- npm package, not on JSR (but usable via `npm:` specifier in Deno)
- Paths must be known at init time (not pattern-based)
- Security warning: never let user input supply paths (compiled to executable code)

Sources:

- [fast-redact on GitHub](https://github.com/davidmarkclements/fast-redact)
- [fast-redact on npm](https://www.npmjs.com/package/fast-redact)

#### @hackylabs/deep-redact (Object Redaction)

**Confidence**: Medium (well-documented, zero dependencies, but smaller community)

Recursive object redaction with support for blacklisted keys, regex patterns, and custom transformers:

```typescript
import { DeepRedact } from '@hackylabs/deep-redact';

const redactor = new DeepRedact({
  blacklistedKeys: ['apiKey', 'api_key', /password/i, /secret/i, /token/i],
  replacement: '[REDACTED]',
  types: ['string'],
  serialize: false,
});

redactor.redact({ name: 'radarr', api_key: 'abc123', url: 'http://localhost' });
// { name: 'radarr', api_key: '[REDACTED]', url: 'http://localhost' }
```

**Pros:**

- Zero dependencies
- Handles circular references
- Supports both key-based and regex pattern-based redaction
- Custom transformers for special value types
- Does not mutate original object

**Cons:**

- Slower than fast-redact for high-throughput scenarios
- npm package, not on JSR

Sources:

- [@hackylabs/deep-redact on GitHub](https://github.com/hackylabs/deep-redact)

#### maskdata (String Masking)

**Confidence**: Medium (well-documented utility library, covers many masking scenarios)

Provides configurable string masking with visible start/end characters:

```typescript
import MaskData from 'maskdata';

const masked = MaskData.maskStringV2('abc123def456ghij', {
  maskWith: '*',
  unmaskedStartCharacters: 0,
  unmaskedEndCharacters: 4,
  maxMaskedCharacters: 256,
});
// "************ghij"
```

**Pros:**

- Highly configurable (mask character, visible start/end count, max length)
- Covers many data types (email, phone, card, password, string)

**Cons:**

- Overkill for Praxrr's simple last-4-characters masking requirement
- npm package

Sources:

- [maskdata on GitHub](https://github.com/Sumukha1496/maskdata)
- [maskdata on npm](https://www.npmjs.com/package/maskdata)

## Integration Patterns

### API Response Masking

**Confidence**: High (Praxrr already implements partial masking; pattern is well-established)

#### Current State in Praxrr

The `arrInstancesQueries` module already returns empty strings for API keys via the SQL select:

```sql
SELECT
  id, name, type, url, external_url,
  '' AS api_key,  -- Already masked at query level
  api_key_fingerprint, tags, enabled, source,
  created_at, updated_at
FROM arr_instances
```

The `+page.server.ts` for the Arr list page also strips `api_key` from the response:

```typescript
const { api_key: _redactedApiKey, ...instanceWithoutApiKey } = instance;
return { ...instanceWithoutApiKey, api_key: '' };
```

#### Recommended Approach: Query-Level + Serialization Guard

**Layer 1 -- Query level (already done):** SQL select returns `'' AS api_key` for all list/detail queries. This prevents accidental leakage from the database layer.

**Layer 2 -- Dedicated reveal endpoint:** Create a separate API endpoint (`/api/v1/arr/instances/{id}/reveal-key`) that:

- Requires authentication
- Optionally requires re-authentication or confirmation
- Returns the last 4 characters for display, OR the full decrypted key for clipboard copy
- Logs the reveal action for audit purposes

**Layer 3 -- Response serialization guard in SvelteKit handle hook:**

```typescript
// hooks.server.ts
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  // Guard: strip any api_key fields from JSON API responses
  if (event.url.pathname.startsWith('/api/') && response.headers.get('content-type')?.includes('application/json')) {
    const body = await response.json();
    const sanitized = redactSensitiveFields(body);
    return new Response(JSON.stringify(sanitized), {
      status: response.status,
      headers: response.headers,
    });
  }

  return response;
};
```

**Trade-off:** The handle hook approach adds overhead to every API response. Since Praxrr already masks at the query level, the hook guard is a defense-in-depth measure. A more targeted approach is to audit all API endpoints that touch instances and ensure none return raw keys.

Sources:

- [SvelteKit Hooks Documentation](https://svelte.dev/docs/kit/hooks)
- [SvelteKit Handle Hook Internals](https://www.okupter.com/blog/sveltekit-internals-handle-hook)

### Log Sanitization

**Confidence**: High (well-established pattern with multiple library options)

#### Approach A: Inline Redaction in Existing Logger (Recommended for Praxrr)

Add a `sanitize()` method to the existing Logger class that processes both `message` and `meta` before writing:

```typescript
// Pattern matches common API key formats (32+ hex chars, base64 strings, etc.)
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /[a-f0-9]{32,}/gi, replacement: '[REDACTED_KEY]' },
  { pattern: /(?:api[_-]?key|apikey|token|secret|password)\s*[:=]\s*\S+/gi, replacement: '$1: [REDACTED]' },
];

const SENSITIVE_FIELD_NAMES = /^(api[_-]?key|apikey|token|secret|password|credential)$/i;

private sanitizeValue(value: string): string {
  let result = value;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

private sanitizeMeta(meta: unknown): unknown {
  if (typeof meta !== 'object' || meta === null) return meta;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (SENSITIVE_FIELD_NAMES.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      sanitized[key] = this.sanitizeValue(value);
    } else if (typeof value === 'object') {
      sanitized[key] = this.sanitizeMeta(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
```

#### Approach B: LogTape Migration (Future consideration)

If Praxrr migrates to LogTape as its logging backend, use the built-in `@logtape/redaction` package for both pattern-based and field-based redaction as shown in the Libraries section above.

#### Performance Considerations

- **Regex overhead**: Negligible for Praxrr's logging volume. Praxrr is not a high-throughput service; it processes configuration syncs, not thousands of requests per second
- **fast-redact benchmarks**: ~1% overhead on JSON.stringify for static paths, ~25% for intermediate wildcards
- **Recommendation**: Inline regex is sufficient. Do not add a dependency for log redaction performance optimization that Praxrr does not need

Sources:

- [LogTape Data Redaction](https://logtape.org/manual/redaction)
- [Pino Redaction Documentation](https://github.com/pinojs/pino/blob/main/docs/redaction.md)
- [fast-redact Performance](https://github.com/davidmarkclements/fast-redact)
- [Best Practices for Keeping Sensitive Data Out of Logs](https://medium.com/@joecrobak/seven-best-practices-for-keeping-sensitive-data-out-of-logs-3d7bbd12904)

### UI Masking Components

**Confidence**: High (standard web patterns, well-supported browser APIs)

#### Masked Display Pattern

```svelte
<!-- MaskedApiKey.svelte -->
<script lang="ts">
  export let maskedValue: string;    // "••••••••ab3f" from server
  export let instanceId: number;
  export let canReveal: boolean = true;

  let revealed = false;
  let fullValue: string | null = null;
  let loading = false;
  let copied = false;

  async function revealKey() {
    if (fullValue) {
      revealed = !revealed;
      return;
    }
    loading = true;
    try {
      const res = await fetch(`/api/v1/arr/instances/${instanceId}/reveal-key`);
      if (!res.ok) throw new Error('Failed to retrieve key');
      const data = await res.json();
      fullValue = data.apiKey;
      revealed = true;
      // Auto-hide after 30 seconds
      setTimeout(() => { revealed = false; }, 30_000);
    } catch (error) {
      alertStore.add('error', 'Failed to reveal API key');
    } finally {
      loading = false;
    }
  }

  async function copyKey() {
    const valueToCopy = fullValue ?? maskedValue;
    if (!fullValue) {
      // Fetch full key for copy without revealing visually
      const res = await fetch(`/api/v1/arr/instances/${instanceId}/reveal-key`);
      if (!res.ok) return;
      const data = await res.json();
      fullValue = data.apiKey;
    }
    try {
      await navigator.clipboard.writeText(fullValue!);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      alertStore.add('error', 'Failed to copy to clipboard');
    }
  }
</script>

<div class="flex items-center gap-2">
  <code class="font-mono text-sm">
    {revealed && fullValue ? fullValue : maskedValue}
  </code>
  {#if canReveal}
    <button onclick={revealKey} title={revealed ? 'Hide' : 'Reveal'}>
      <!-- Eye / EyeOff icon toggle -->
    </button>
    <button onclick={copyKey} title={copied ? 'Copied!' : 'Copy'}>
      <!-- Copy / Check icon toggle -->
    </button>
  {/if}
</div>
```

#### Reveal Toggle Implementation

The standard pattern for password/secret reveal toggles:

1. **Eye icon toggle**: Use `lucide-svelte` icons (`Eye` / `EyeOff`) which Praxrr already depends on
2. **Input type toggle**: Switch `<input type="password">` to `<input type="text">` for editable fields
3. **Display toggle**: Switch between masked string and full value for read-only displays
4. **Auto-hide timer**: Reset to masked state after 30-60 seconds of inactivity
5. **Copy without reveal**: Allow clipboard copy without visually showing the key

Sources:

- [Svelte Playground: Toggle Password Visibility](https://svelte.dev/playground/52042751e4d0462380312ff1b2ac661b)
- [SvelteKit Show/Hide Password Implementation](https://blog.makeinfo.co/show-or-hide-password-in-sveltekit)
- [Flowbite Svelte Input Fields](https://flowbite-svelte.com/docs/forms/input-field)

### Clipboard Copy Patterns

**Confidence**: High (W3C standard, widely supported since March 2020)

#### Browser Clipboard API

```typescript
async function copyToClipboard(text: string): Promise<boolean> {
  // Modern Clipboard API (preferred)
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy method
    }
  }

  // Legacy fallback for non-HTTPS or older browsers
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    return true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
```

**Requirements:**

- `navigator.clipboard.writeText()` requires a **secure context** (HTTPS or localhost)
- During development on `localhost`, the API works without HTTPS
- In production, Praxrr should be served over HTTPS (typically via reverse proxy)
- The `svelte-copy` library handles the fallback automatically

Sources:

- [MDN: Clipboard writeText()](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)
- [MDN: Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)
- [web.dev: Unblocking Clipboard Access](https://web.dev/articles/async-clipboard)

## Constraints and Gotchas

### Browser Clipboard API Requirements

**Confidence**: High

- **Secure Context**: `navigator.clipboard` is only available over HTTPS or localhost. Praxrr in development uses `localhost:6969` which satisfies this requirement. Production deployments behind a reverse proxy (nginx, Caddy, Traefik) with TLS termination also satisfy it.
- **User Gesture**: Some browsers require the clipboard write to happen within a user-initiated event handler (click, keydown). The copy button pattern satisfies this.
- **Focus**: The browser tab/window must be focused. Clipboard writes silently fail on unfocused tabs in some browsers.
- **Firefox**: Does not support the `clipboard-write` permission query; the API still works but permission-checking code should handle this gracefully.
- **Fallback**: Always include the legacy `document.execCommand('copy')` fallback, or use `svelte-copy` which handles this.

Sources:

- [MDN: Navigator.clipboard Property](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/clipboard)
- [The Pitfall of Using navigator.clipboard in Non-HTTPS Web Apps](https://medium.com/@seeranjeeviramavel/the-pitfall-of-using-navigator-clipboard-in-non-https-web-apps-b47e3f065ab6)

### Performance Considerations

**Confidence**: High

- **Log redaction overhead**: For Praxrr's volume (configuration syncs, not request-per-second workloads), regex-based log sanitization adds negligible overhead. Even at ~25% JSON.stringify overhead (fast-redact worst case), Praxrr logs tens to hundreds of entries per sync cycle, not millions.
- **API response transformation**: If using the handle hook approach, parsing and re-serializing every JSON API response adds latency. Benchmarking suggests ~1-5ms per response for small payloads. For Praxrr's use case this is acceptable, but the query-level masking approach avoids this entirely.
- **No-op optimization**: If `api_key` is already empty string from the SQL query, the redaction pass can short-circuit. Avoid running regex on fields that are already masked.

### Security Edge Cases

**Confidence**: Medium (theoretical risks, not observed exploits in comparable tools)

- **Browser DevTools**: Even with UI masking, a user can inspect network requests in DevTools. The API must never return the full key in normal responses. The reveal endpoint should be clearly separated and auditable.
- **SvelteKit serialization**: Data returned from `+page.server.ts` is serialized into HTML (viewable in page source). Never include raw API keys in `load()` return values. Praxrr already returns empty strings here.
- **Memory dumps**: The decrypted key exists briefly in server memory during API calls. This is unavoidable and acceptable for Praxrr's threat model. The encrypted-at-rest storage already mitigates the primary risk.
- **Clipboard persistence**: Copied API keys remain in the system clipboard until overwritten. Users should be warned, but this is standard behavior for all credential managers.
- **Auto-fill**: Browser password managers may attempt to auto-fill API key fields. Use `autocomplete="off"` on API key input elements.

### Reveal Toggle Security Considerations

**Confidence**: Medium (patterns well-documented but implementation tradeoffs depend on threat model)

**Option A -- Simple confirmation (Recommended for Praxrr):**

- User clicks "Reveal" button
- Optional: show a confirmation dialog ("Are you sure you want to reveal this API key?")
- Server returns decrypted key via dedicated endpoint
- Key displayed for 30 seconds, then auto-hidden
- Action logged for audit

**Option B -- Re-authentication (Higher security, more friction):**

- User clicks "Reveal" button
- Prompted for password re-entry
- Server validates credentials before returning decrypted key
- OWASP recommends this for sensitive operations like password changes or financial transactions
- Probably excessive for Praxrr's self-hosted threat model, but could be offered as an option

**Recommendation:** Start with Option A (simple confirmation + audit log). Add Option B as an optional enhancement for users running Praxrr with `AUTH=on` or `AUTH=oidc`. For `AUTH=off` or `AUTH=local`, re-authentication adds no security value.

Sources:

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Re-authentication on Sensitive Actions (OpSec)](https://opsec.readthedocs.io/en/latest/user/re-authentication-on-sensitive-actions.html)
- [Microsoft: Reauthentication for Sensitive Resources](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/prompt-users-for-reauthentication-on-sensitive-apps-and-high-risk-actions-with-c/4062703)

## Code Examples

### Basic Masking Function (TypeScript)

```typescript
/**
 * Mask a string showing only the last N characters.
 * Returns a masked string like "••••••••ab3f"
 */
export function maskApiKey(apiKey: string, visibleChars: number = 4): string {
  if (!apiKey || apiKey.length <= visibleChars) {
    return '••••••••';
  }

  const masked = '\u2022'.repeat(8); // 8 bullet characters
  const suffix = apiKey.slice(-visibleChars);
  return `${masked}${suffix}`;
}

/**
 * Check if a value looks like a masked API key (for skip-update logic).
 */
export function isMaskedApiKey(value: string): boolean {
  return /^\u2022+/.test(value) || value === '' || value === '[REDACTED]';
}

/**
 * Redact sensitive fields from an object for logging.
 * Operates on a shallow copy; does not mutate the original.
 */
export function redactSensitiveFields<T extends Record<string, unknown>>(obj: T): T {
  const SENSITIVE_KEYS = /^(api[_-]?key|apikey|password|secret|token|credential|authorization)$/i;
  const result = { ...obj };

  for (const key of Object.keys(result)) {
    if (SENSITIVE_KEYS.test(key) && typeof result[key] === 'string') {
      (result as Record<string, unknown>)[key] = '[REDACTED]';
    }
  }

  return result;
}
```

### Log Sanitization Integration (for Praxrr Logger)

```typescript
// Add to packages/praxrr-app/src/lib/server/utils/logger/logger.ts

const SENSITIVE_KEY_PATTERN = /^(api[_-]?key|apikey|password|secret|token|credential)$/i;

/**
 * Recursively redact sensitive fields from log metadata.
 */
function sanitizeLogMeta(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    // Redact long hex strings that look like API keys
    return value.replace(/[a-f0-9]{32,}/gi, '[REDACTED_KEY]');
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeLogMeta);
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeLogMeta(val);
      }
    }
    return sanitized;
  }

  return value;
}

// Usage in Logger.log():
private formatMeta(meta?: unknown): string {
  if (!meta) return '';
  const sanitized = sanitizeLogMeta(meta);
  return `${colors.grey}${JSON.stringify(sanitized)}${colors.reset}`;
}
```

### Svelte Masked Input Component (Conceptual)

```svelte
<!-- MaskedSecretField.svelte -->
<script lang="ts">
  import { Eye, EyeOff, Copy, Check } from 'lucide-svelte';

  export let label: string = 'API Key';
  export let maskedDisplay: string = '';       // e.g., "••••••••ab3f"
  export let fetchFullValue: () => Promise<string>;  // async fetcher
  export let editable: boolean = false;
  export let disabled: boolean = false;

  let revealed = false;
  let fullValue: string | null = null;
  let copied = false;
  let loading = false;
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  function clearAutoHide() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  async function toggleReveal() {
    if (revealed) {
      revealed = false;
      clearAutoHide();
      return;
    }

    if (!fullValue) {
      loading = true;
      try {
        fullValue = await fetchFullValue();
      } catch {
        return;
      } finally {
        loading = false;
      }
    }

    revealed = true;
    clearAutoHide();
    autoHideTimer = setTimeout(() => {
      revealed = false;
    }, 30_000);
  }

  async function copyValue() {
    if (!fullValue) {
      try {
        fullValue = await fetchFullValue();
      } catch {
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(fullValue);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      // Fallback: create temporary textarea
      const textarea = document.createElement('textarea');
      textarea.value = fullValue;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    }
  }
</script>

<div class="space-y-1">
  <label class="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
    {label}
  </label>
  <div class="flex items-center gap-2">
    <code
      class="flex-1 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-sm
             text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
    >
      {revealed && fullValue ? fullValue : maskedDisplay}
    </code>

    {#if !disabled}
      <button
        type="button"
        class="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700
               dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        title={revealed ? 'Hide' : 'Reveal'}
        onclick={toggleReveal}
        {disabled}
      >
        {#if loading}
          <span class="animate-spin">...</span>
        {:else if revealed}
          <EyeOff size={16} />
        {:else}
          <Eye size={16} />
        {/if}
      </button>

      <button
        type="button"
        class="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700
               dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        onclick={copyValue}
        {disabled}
      >
        {#if copied}
          <Check size={16} class="text-green-600 dark:text-green-400" />
        {:else}
          <Copy size={16} />
        {/if}
      </button>
    {/if}
  </div>
</div>
```

### Reveal Endpoint Pattern

```typescript
// /api/v1/arr/instances/[id]/reveal-key/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { arrInstanceCredentialsQueries } from '$db/queries/arrInstanceCredentials';
import { decryptArrInstanceApiKey } from '$server/utils/encryption/arr-credentials';
import { logger } from '$logger/logger';
import { maskApiKey } from '$shared/utils/masking';

export const GET: RequestHandler = async ({ params, locals }) => {
  const instanceId = parseInt(params.id, 10);
  if (!instanceId) throw error(400, 'Invalid instance ID');

  // Require authentication
  if (!locals.user && !locals.authBypass) {
    throw error(401, 'Unauthorized');
  }

  const credential = arrInstanceCredentialsQueries.getByInstanceId(instanceId);
  if (!credential) {
    throw error(404, 'Instance credentials not found');
  }

  const apiKey = await decryptArrInstanceApiKey({
    keyVersion: credential.key_version,
    nonce: credential.nonce,
    ciphertext: credential.ciphertext,
  });

  // Audit log
  await logger.info('API key revealed', {
    source: 'Security',
    meta: {
      instanceId,
      userId: locals.user?.id ?? 'bypass',
      maskedKey: maskApiKey(apiKey),
    },
  });

  return json({ apiKey });
};
```

## Open Questions

1. **Masking format decision**: Should the masked display use bullet characters (`••••••••ab3f`) or asterisks (`********ab3f`)? Bullets are more conventional in modern UIs, asterisks are more universally renderable. The existing Praxrr FormInput component uses `type="password"` which renders browser-native dots.

2. **Reveal scope**: Should revealing one instance's API key auto-hide any previously revealed keys on the same page? This prevents multiple keys being visible simultaneously.

3. **Auto-hide timeout**: 30 seconds is recommended. Should this be configurable in settings, or is a fixed timeout sufficient?

4. **Copy without reveal**: Should the "Copy" button work without showing the key? Password managers support this pattern, but it means fetching the decrypted key from the server on every copy action (unless cached client-side).

5. **Client-side caching**: After fetching the full key for reveal/copy, should it be cached in component state for the session duration? This reduces API calls but means the decrypted key lives in JavaScript memory longer. Praxrr's self-hosted context makes this acceptable, but it should be documented.

6. **Re-authentication for AUTH=on**: Should the reveal endpoint require password re-entry when `AUTH=on`? This adds friction but follows OWASP recommendations for sensitive data access. The recommendation is to start without re-auth and add it as an optional enhancement.

7. **TMDB/AI API keys**: The `instances` table stores Arr API keys, but Praxrr also stores TMDB API keys and potentially AI provider keys. Should the masking infrastructure be generic enough to cover all credential types from day one, or scoped to Arr instances initially?

8. **Env-managed instances**: For instances with `source='env'`, the API key comes from environment variables. Should the reveal endpoint still work for these, or should env-sourced keys be treated differently since the user already has access to the environment configuration?
