# UX Research: API Key Masking

## Executive Summary

API key masking is a well-established UX pattern across cloud platforms (Stripe, GitHub, AWS, Cloudflare, OpenAI) and password managers (1Password, Bitwarden), with strong consensus on core interactions: display masked by default, reveal via explicit toggle, and copy via dedicated button with toast feedback. For Praxrr's self-hosted context managing Arr instance credentials, the recommended approach is a read-only masked display with last-4-character visibility, an eye-icon reveal toggle, a dedicated copy button with clipboard feedback, and optional auto-hide after a configurable timeout. This balances the security expectations of the target audience (home-lab and self-hosted enthusiasts) with the practical need to copy and verify keys during setup and troubleshooting.

**Confidence**: High -- based on consistent patterns across 10+ major platforms and industry design systems (Carbon, Tailwind UI, Flowbite, Preline).

## User Workflows

### Primary Flow: First-Time Setup (Entering New API Key)

1. User navigates to Arr instances page and clicks "Add Instance".
2. User selects Arr type (Radarr, Sonarr, Lidarr).
3. User enters instance name and URL.
4. User pastes API key into the API Key field.
   - Field displays input as masked dots by default (standard `type="password"` behavior).
   - Eye icon toggle is available to verify the pasted value.
5. User clicks "Test Connection" to validate the key.
   - Success: green toast notification confirming connection.
   - Failure: red toast notification with error details (connection refused, unauthorized, etc.).
6. User clicks "Save" to persist the instance configuration.

**Current Praxrr behavior**: The `FormInput` component with `private_` prop already implements this flow using `type="password"` with an eye-icon toggle (Eye/EyeOff from lucide-svelte). The API key is never pre-populated in edit mode for security (`apiKey: ''` in dirty tracking init).

### Primary Flow: Viewing Masked Key (Instance Details)

1. User navigates to an existing instance's settings page.
2. API key field displays as a masked string: `••••••••ab3f` (last 4 characters visible).
3. The field is read-only in the masked display state -- not an editable input.
4. Adjacent to the masked value, two action buttons are visible:
   - **Copy** (clipboard icon): copies full key to clipboard without revealing it.
   - **Reveal** (eye icon): temporarily shows the full key.

**Key UX decision**: The masked display should NOT be an input field -- it should be a read-only display element. The current Praxrr pattern requires re-entering the API key for edit operations, which is correct from a security perspective. The new masked display is for viewing/verification only.

### Primary Flow: Copying Key to Clipboard

1. User views an instance with a masked API key.
2. User clicks the Copy button (clipboard icon).
3. Full key value is written to clipboard via `navigator.clipboard.writeText()`.
4. Button transitions to a checkmark icon for 2 seconds, then reverts.
5. A toast notification confirms: "API key copied to clipboard".
6. The masked display does NOT change -- the key remains hidden.

**Error handling**: If clipboard access fails (permission denied, insecure context), display an inline error message suggesting the user reveal the key and copy manually.

### Primary Flow: Revealing Full Key

1. User views an instance with a masked API key.
2. User clicks the Reveal button (eye icon).
3. **Option A (recommended for Praxrr)**: Key is revealed immediately with an auto-hide timer.
   - Full key displays in monospace font for readability.
   - Eye icon changes to EyeOff to indicate the revealed state.
   - Key auto-hides after 30 seconds (configurable).
   - Visual countdown indicator (subtle progress bar or timer text).
4. **Option B (higher security)**: A confirmation dialog appears: "Reveal API key? The key will be visible for 30 seconds."
5. User can manually re-hide by clicking the EyeOff icon.

**Re-authentication consideration**: For a self-hosted app where the user is already authenticated and has full control of the instance, requiring re-authentication to reveal a key adds friction without meaningful security benefit. Re-authentication is better suited for multi-tenant SaaS platforms. **Recommendation**: Skip re-authentication for Praxrr.

### Primary Flow: Editing/Updating an API Key

1. User navigates to instance settings.
2. Current API key is displayed in masked form (read-only display).
3. Below the masked display, a separate "Update API Key" section or button is available.
4. User clicks "Update API Key" to reveal an input field.
5. User pastes the new key into the input field (standard password input with eye toggle).
6. User clicks "Test Connection" to validate.
7. User clicks "Save" to persist.

**Current Praxrr behavior**: The existing pattern already handles this correctly -- the API key field is always empty in edit mode with the message "Re-enter API key to save changes". The masked display enhancement adds a visual representation of the stored key above the input field.

### Secondary Flow: Troubleshooting with Partially Visible Key

1. User encounters a sync error mentioning an API key issue.
2. User navigates to instance settings.
3. The last 4 characters of the masked key are visible: `••••••••ab3f`.
4. User can compare the suffix against their Arr instance's Settings > General > Security > API Key page.
5. If the suffix matches, the issue is likely not a key mismatch.
6. If the suffix does not match, user knows they need to update the key.
7. For full comparison, user can click Reveal to see the entire key temporarily.

## UI/UX Best Practices

### Industry Standards for Credential Masking

The following table summarizes how major platforms handle API key display:

| Platform          | Masking Format                                                                | Reveal                                  | Copy                    | Show-Once                     | Re-auth to View            |
| ----------------- | ----------------------------------------------------------------------------- | --------------------------------------- | ----------------------- | ----------------------------- | -------------------------- |
| **Stripe**        | `sk_live_...` (prefix only after creation)                                    | Sandbox: unlimited. Live: one-time only | Click key value to copy | Yes (live mode)               | No                         |
| **GitHub**        | `ghp_****...****` (prefix + last 6 for checksum)                              | Never (show-once at creation)           | At creation only        | Yes                           | N/A                        |
| **OpenAI**        | `sk-admin...xyz` (prefix + last 3-4)                                          | Never (show-once)                       | At creation only        | Yes                           | N/A                        |
| **AWS**           | "Show Access Key" button pattern                                              | Click to reveal                         | After reveal            | Secret shown once at creation | No                         |
| **Cloudflare**    | Token shown once at creation; Global API Key behind "View" button             | Global key: requires password           | After reveal            | Tokens: yes                   | Global key: yes (password) |
| **Google Cloud**  | Full key shown on detail page                                                 | Always visible on detail page           | Copy button             | No                            | No                         |
| **Radarr/Sonarr** | Plain text in Settings > General > Security (V4: obfuscated in API responses) | Always visible in UI settings           | Manual selection + copy | No                            | No                         |

**Confidence**: High -- verified across official documentation for each platform.

**Key patterns that emerge**:

1. **Show-once at creation** is common for platforms that generate keys (Stripe, GitHub, OpenAI). This does NOT apply to Praxrr, where users paste existing keys from their Arr instances.
2. **Partial visibility** (prefix or suffix) is the universal standard for identifying keys without full exposure.
3. **Copy without reveal** is supported by Stripe and is the preferred secure pattern.
4. **Re-authentication** is only used by Cloudflare (for global API key) and is specific to high-security multi-tenant contexts.

### Masking Format Conventions

**Characters used for masking**:

| Character                   | Usage                                                   | Context                             |
| --------------------------- | ------------------------------------------------------- | ----------------------------------- |
| `*` (asterisk)              | Most common in text/log contexts                        | GitHub, many APIs                   |
| `\u2022` (bullet, `&bull;`) | Standard for password fields and UI display             | Browsers, password managers, Stripe |
| `\u00B7` (middle dot)       | Lighter visual weight, sometimes used in minimalist UIs | Less common                         |

**Recommended format for Praxrr**: `\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022ab3f`

- Use bullet characters (`\u2022`) for the masked portion -- this matches browser password field conventions and is visually clean.
- Show the **last 4 characters** of the key -- this provides enough entropy for identification without revealing the full key.
- Use a **fixed width** of 8 bullets regardless of actual key length to avoid leaking key length information.
- Display in **monospace font** for the visible suffix to aid character-by-character comparison.

**Confidence**: High -- bullet characters are the de facto standard in web UI password fields; last-4 display follows credit card and the "least leakage logging" convention.

**Why last 4 (not first 4 or prefix)**:

- Arr API keys do not have standardized prefixes (unlike `sk_live_` for Stripe or `ghp_` for GitHub).
- Last 4 characters provide a quick visual check against the key shown in the Arr instance's own settings page.
- Showing the beginning of a key reveals more about its structure/format than the end.

### Reveal Toggle Patterns

**Icon choices (industry consensus)**:

| Icon State               | Meaning                                     | Icon                        |
| ------------------------ | ------------------------------------------- | --------------------------- |
| Eye (open)               | "Click to reveal" / key is currently hidden | `Eye` from lucide-svelte    |
| Eye-off (closed/slashed) | "Click to hide" / key is currently visible  | `EyeOff` from lucide-svelte |

This matches the existing Praxrr `FormInput` component which already uses `Eye`/`EyeOff` from lucide-svelte.

**Interaction patterns**:

1. **Click toggle** (most common): Click once to reveal, click again to hide. Used by AWS, password managers, most web forms.
2. **Press-and-hold** (less common): Hold the button to see the key; release to re-mask. Used by Windows 8 login. Not recommended for API keys because users need time to read/compare long strings.
3. **Timed auto-hide**: Key reveals for a set duration then automatically re-masks. Combines security with convenience.

**Recommended for Praxrr**: Click toggle with timed auto-hide (30 seconds default).

- Click eye icon to reveal the full key.
- Key auto-hides after 30 seconds.
- User can manually re-hide at any time by clicking EyeOff.
- A subtle visual indicator shows time remaining (thin progress bar below the field, or a countdown badge on the button).
- Screen reader announcement: "API key revealed. Will auto-hide in 30 seconds."

**Confidence**: Medium -- auto-hide timers are a frequently requested feature (Bitwarden community) but not yet widely implemented. The 30-second default is a reasonable balance based on community discussion, though no empirical user research was found to validate a specific duration.

### Copy-to-Clipboard UX

**Button placement options**:

| Placement                      | Pros                                        | Cons                                            |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------- |
| Right of masked field (inline) | Discoverable, follows input-group pattern   | Can crowd the field on mobile                   |
| Below masked field (stacked)   | Clean layout, good for mobile               | Less discoverable, requires more vertical space |
| Inside field (suffix position) | Compact, common in Tailwind UI input groups | Can conflict with reveal button                 |

**Recommended for Praxrr**: Right of the masked field, as a separate button from the reveal toggle. Layout: `[masked-value] [copy-btn] [reveal-btn]`

**Feedback mechanisms**:

1. **Button state change** (primary): Button icon transitions from clipboard to checkmark for 2 seconds.
2. **Toast notification** (secondary): Brief success toast: "API key copied to clipboard" (auto-dismiss after 3 seconds).
3. **Tooltip change**: Button tooltip changes from "Copy to clipboard" to "Copied!" temporarily.

**Implementation**:

```typescript
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fallback for non-secure contexts or permission denied
    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}
```

**Confidence**: High -- navigator.clipboard.writeText with fallback is the industry-standard approach; button state change + toast is the consensus feedback pattern across Stripe, GitHub, Flowbite, and Carbon.

### Accessibility (WCAG)

**Required ARIA attributes for the reveal toggle**:

```html
<button
  type="button"
  aria-pressed="false"
  aria-controls="api-key-display"
  aria-label="Show API key"
>
  <svg aria-hidden="true"><!-- Eye icon --></svg>
</button>
```

- `aria-pressed`: Indicates the toggle state (true = revealed, false = masked).
- `aria-controls`: Links the button to the controlled element.
- `aria-label`: Dynamic label that updates between "Show API key" and "Hide API key".

**Live region for state announcements**:

```html
<div aria-live="assertive" class="sr-only" id="key-announce">
  <!-- Populated dynamically: "API key revealed" / "API key hidden" -->
</div>
```

Use `aria-live="assertive"` because credential visibility is a security-relevant state change that warrants immediate screen reader notification.

**Copy button accessibility**:

```html
<button type="button" aria-label="Copy API key to clipboard">
  <svg aria-hidden="true"><!-- Clipboard icon --></svg>
</button>
```

After successful copy, announce via live region: "API key copied to clipboard."

**Keyboard navigation requirements**:

- Both buttons must be focusable (native `<button>` elements).
- Tab order: masked display (if focusable) -> copy button -> reveal button.
- Enter and Space should activate both buttons.
- Focus indicators must be visible (3px outline, meets WCAG 2.4.7).

**Screen reader behavior for masked text**:

- The masked display should NOT read out individual bullet characters.
- Use `aria-label="API key ending in ab3f"` on the display element.
- When revealed, update to `aria-label="API key: [full value]"` -- though consider whether reading the full key aloud is a security concern for shared environments.

**Confidence**: High -- based on WCAG 2.1 AA requirements and the accessible password reveal pattern from Make Things Accessible.

### Responsive Design

**Desktop (1024px+)**:

```
[API Key label]
[••••••••ab3f                    ] [Copy] [Reveal]
```

- Inline layout with buttons right-aligned.
- Minimum button size: 36x36px (comfortable click target).

**Tablet (768px-1023px)**:

```
[API Key label]
[••••••••ab3f              ] [Copy] [Reveal]
```

- Same layout, slightly compressed.
- Button spacing reduced but remains at least 8px gap.

**Mobile (below 768px)**:

```
[API Key label]
[••••••••ab3f        ] [Copy] [Reveal]
```

- Buttons remain inline but use icon-only display (no text labels).
- Touch targets must be at least 44x44px (WCAG 2.5.5, Apple HIG) with minimum 10px spacing.
- Consider making the entire masked value area tappable to copy (with visual affordance).

**Confidence**: High -- touch target sizing follows WCAG 2.5.5 and established mobile design guidelines from Apple (44pt) and Google (48dp).

## Error Handling

### Clipboard Copy Failure

**Cause**: Browser denies clipboard access (insecure context, user denied permission, WebView environment).

**UX Response**:

1. Display an inline error below the masked field: "Could not copy to clipboard. Try revealing the key and copying manually."
2. Do NOT use a toast for this error -- the user needs to take corrective action, and toasts auto-dismiss.
3. Fallback: If the primary `navigator.clipboard.writeText()` fails, attempt the legacy `document.execCommand('copy')` fallback before showing the error.

**Confidence**: High -- clipboard permission issues are well-documented, especially on mobile WebViews and non-HTTPS contexts.

### Reveal Action Failure (If Auth Required)

**Cause**: If re-authentication is required and the auth check fails (session expired, wrong password).

**UX Response**:

1. Display an error message in the confirmation dialog: "Authentication failed. Please try again."
2. Do not dismiss the dialog -- let the user retry.
3. After 3 failed attempts, close the dialog and suggest logging in again.

**Note**: Re-authentication is not recommended for Praxrr's self-hosted context, so this flow is unlikely to be needed. Documented for completeness.

### Invalid or Empty API Key Display

**Cause**: A stored key is empty, null, or corrupted.

**UX Response**:

1. Display a clear "No API key configured" message instead of an empty masked field.
2. Show a warning icon (triangle-alert from lucide-svelte) with the message.
3. The Copy and Reveal buttons should be disabled/hidden when there is no key to act on.
4. Provide a direct link or button to "Set API Key" that opens the edit flow.

### Connection Test Failure with Masked Key

**Cause**: User tests connection but the API key is invalid or the instance is unreachable.

**UX Response**:

1. Display error details in a toast notification (current Praxrr behavior).
2. For "Unauthorized" (401) errors, add contextual help: "The API key may be incorrect. Check your Arr instance at Settings > General > Security."
3. Show the last 4 characters of the key in the error message for troubleshooting: "Connection failed (key ending in ...ab3f). The API key may be incorrect."
4. Never show the full key in error messages.

**Confidence**: High -- contextual error messages with partial key identification are standard practice.

## Competitive Analysis

### Arr Ecosystem

#### Radarr/Sonarr (Native UI)

**How they display API keys**:

- API key is shown in **plain text** at Settings > General > Security.
- No masking, no toggle, no copy button in the native UI.
- Radarr V5/Sonarr V4 added API-level obfuscation: passwords and API keys are redacted in API responses, but the UI settings page still shows the key in plain text.
- The key is auto-generated and can be regenerated but not manually set.

**Security posture**: Low -- keys are always visible in the UI. The V5 API obfuscation only protects API responses, not the settings page itself. This is a known pain point (GitHub Issue #9397 discusses the tension between usability and security).

**Implication for Praxrr**: Praxrr can provide a meaningfully better experience than native Radarr/Sonarr by masking keys by default and requiring explicit action to reveal.

**Confidence**: High -- verified via Servarr Wiki, Radarr GitHub issues #3890 and #9397.

#### Recyclarr

**How it handles API keys**:

- CLI-based tool; no web UI for key display.
- API keys stored in YAML configuration files.
- Supports `!secret` YAML tags to store keys in a separate `secrets.yml` file.
- No masking or reveal UI -- all interaction is via text files.

**Confidence**: High -- verified via Recyclarr documentation.

#### Configarr

**How it handles API keys**:

- Configuration-file-based tool with experimental web UI.
- API keys stored via `!env` (environment variables) or `!secret` (secrets file) YAML tags.
- The web UI (experimental since v1.21.0) focuses on general settings, not credential management.
- No dedicated key masking or reveal interface.

**Confidence**: Medium -- documentation covers configuration syntax but limited detail on web UI key handling.

#### Profilarr

**How it handles API keys**:

- Web-based UI for managing Sonarr/Radarr profiles.
- API key is entered as a standard text/password input during instance setup.
- "Test" button validates the connection.
- Limited documentation on whether stored keys are masked in the UI after initial setup.

**Confidence**: Low -- limited documentation available; would need hands-on testing to verify exact behavior.

### Cloud Platforms

#### Stripe

**Pattern**: Two-tier key visibility.

- **Publishable keys** (`pk_live_`): Always visible, safe to expose client-side.
- **Secret keys** (`sk_live_`): Shown once at creation in live mode; can be revealed unlimited times in sandbox mode. Click the key value to copy.
- Keys are identifiable by prefix (`sk_live_`, `pk_test_`, `rk_test_`).

**What Praxrr can adopt**: The click-to-copy interaction (clicking the value itself copies it) is elegant but less discoverable than a dedicated button. Recommend the dedicated button approach for Praxrr's less technical audience.

#### GitHub

**Pattern**: Show-once with prefix-based identification.

- Tokens (format: `ghp_[40 chars]`) shown once at creation, then only the prefix and last 6 characters visible on the tokens management page.
- The last 6 characters serve as a checksum for secret scanning.
- No reveal mechanism -- lost tokens must be regenerated.

**What Praxrr can adopt**: The last-N-characters display for identification without full reveal. GitHub's approach is more restrictive than needed for Praxrr (since Praxrr stores keys from external services, not its own generated keys).

#### AWS

**Pattern**: Show/reveal with full visibility.

- Access Key ID is always visible.
- Secret Access Key is shown once at creation.
- A "Show" button reveals the secret key on the console detail page.
- A Chrome extension ("AWS Masking") exists because the native console does not mask keys in some views, indicating unmet user demand for masking.

**What Praxrr can adopt**: The "Show" button pattern is simple and effective. The existence of a masking Chrome extension validates user demand for key masking in self-hosted/admin dashboards.

#### Cloudflare

**Pattern**: Show-once for tokens + re-authentication for global key.

- API tokens: shown once at creation only; listed by name on management page with no reveal option.
- Global API Key: viewable behind a "View" button that requires password re-entry.
- This two-tier approach distinguishes between one-time-use tokens and persistent global credentials.

**What Praxrr can adopt**: The password re-entry pattern for high-value credentials. However, for a self-hosted app this adds friction without proportional security benefit. Consider as an optional setting.

#### OpenAI

**Pattern**: Show-once with prefix + suffix identification.

- Keys displayed as `sk-admin...xyz` after creation (prefix + last 3-4 characters).
- Full key shown only at creation time.
- Management page lists keys with masked format for identification.

**What Praxrr can adopt**: The `prefix...suffix` display format is clean and informative. Since Arr keys lack standardized prefixes, use `••••••••[last 4]` instead.

### Password Managers

#### 1Password

**Pattern**: Click-to-reveal with clipboard integration.

- Credentials hidden behind dots by default.
- Click the field or an eye icon to reveal temporarily.
- Dedicated copy button next to each field.
- Large-type display option for shared-screen scenarios.
- Watchtower security audit flags weak/reused credentials.

#### Bitwarden

**Pattern**: Eye icon toggle with persistent reveal.

- Credentials masked with dots by default.
- Eye icon toggles between masked and revealed states.
- No auto-hide timer (frequently requested by community -- Bitwarden Forum thread from 2019, closed as stale in 2025).
- Copy button (clipboard icon) adjacent to each field.
- "Hidden" password feature adds an extra layer requiring explicit action to view.
- Master password reprompt can be enabled per-item for sensitive entries.

**What Praxrr can adopt**: The side-by-side [copy] [reveal] button pattern. The lack of auto-hide in Bitwarden and the community request for it validates including auto-hide as a feature in Praxrr.

**Confidence**: Medium -- based on community forum discussions and feature documentation; exact UI implementation details for current versions could not be fully verified via web research alone.

### Best Practices to Adopt

Based on the competitive analysis, the following patterns are recommended for Praxrr:

1. **From Stripe**: Click-to-copy with immediate feedback; two-tier key visibility (test vs. live context).
2. **From GitHub/OpenAI**: Partial key display (last 4 characters) for identification.
3. **From Cloudflare**: Consider optional re-auth for high-security deployments (future enhancement).
4. **From Bitwarden**: Side-by-side copy and reveal buttons; add the auto-hide timer that Bitwarden's community has been requesting.
5. **From AWS**: Simple "Show"/"Hide" toggle with clear state indication.
6. **From Carbon Design System**: Modal-based key generation with copy button and download option (applicable if Praxrr ever generates its own keys).

## Security UX Recommendations

### Should Reveal Require Re-Authentication?

**Recommendation: No (for initial release), with an optional setting for future consideration.**

Rationale:

- Praxrr is a self-hosted application. The user who can access the web UI already has full system access.
- The API keys being managed belong to the user's own Arr instances, not third-party services with shared secrets.
- Re-authentication adds friction to troubleshooting workflows where quick key comparison is essential.
- For users who want stricter security (shared household setups, VPN-exposed instances), a configurable "require password to reveal keys" setting can be added in a future release.

**Confidence**: High -- this aligns with how Radarr/Sonarr themselves handle key display (no re-auth), and the self-hosted context fundamentally differs from multi-tenant SaaS.

### Auto-Hide Timer After Reveal

**Recommendation: 30 seconds default, with user-configurable duration.**

Options to consider:

- **10 seconds**: Too short for comparing long API keys character-by-character.
- **30 seconds**: Sufficient for reading, comparing, and copying. Matches the typical "glance and verify" workflow.
- **60 seconds**: Generous for complex troubleshooting but increases exposure window.
- **No auto-hide**: Simplest implementation but leaves keys exposed if the user forgets.

Implementation details:

- Display a subtle countdown indicator (thin progress bar below the field).
- Allow the user to extend the timer by clicking the reveal button again while revealed.
- If the user navigates away from the page, immediately re-mask.
- If the browser tab loses focus, immediately re-mask.

**Confidence**: Medium -- the 30-second default is a pragmatic choice; no empirical user research was found to validate a specific optimal duration. The Bitwarden community discussed auto-hide without converging on a specific time.

### Visual Indicators for Masked vs. Revealed State

**Masked state**:

- Bullet characters (`\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022ab3f`) in default text color.
- Eye icon (open) indicates "click to reveal".
- No special visual treatment -- this is the default, expected state.

**Revealed state**:

- Full key displayed in **monospace font** for readability.
- Background color change: subtle blue or amber tint to signal "this is sensitive content currently visible".
- EyeOff icon (slashed) indicates "click to hide".
- Optional: thin animated border or pulsing indicator to draw attention to the revealed state.
- Countdown bar showing remaining auto-hide time.

**Confidence**: High -- visual differentiation between states is a well-established pattern; monospace for key readability is universal.

### Should the Key Be Visible in Browser Dev Tools / Network Tab?

**Considerations**:

1. **In-memory on page load**: If the full key is sent to the browser as part of page data (server-side rendering), it will be visible in the HTML source and in memory regardless of UI masking. This is unavoidable for a SvelteKit application that renders server-side.

2. **Fetched on demand**: The more secure pattern is to only fetch the full key when the user explicitly requests it (reveal or copy action), via a dedicated API endpoint. This limits exposure to explicit user actions.

3. **Network tab visibility**: Any API call to fetch the key will be visible in the network tab. This is acceptable because:
   - The user is already authenticated.
   - The browser dev tools require physical access to the machine (or a compromised browser extension).
   - This is consistent with how Radarr/Sonarr handle it (V4 API obfuscation prevents casual inspection, but the settings UI still shows the key).

**Recommendation**: Fetch the full key value on demand via a dedicated API endpoint (`GET /api/v1/arr/{id}/key`), rather than including it in the initial page load data. This way:

- The masked display (last 4 chars) can be included in the page data (safe to expose).
- The full key is only transmitted when the user clicks Reveal or Copy.
- Server-side logging can record key access events for audit purposes.

**Confidence**: High -- on-demand fetching is the industry standard for sensitive credential display; reduces attack surface versus embedding in page load data.

### Log Masking (Server-Side)

API keys should be masked in all server-side log output:

- **Structured logging**: Use a blacklist of sensitive field names (`api_key`, `apiKey`, `api-key`, `secret`, `password`, `token`, `authorization`) and automatically redact matching values.
- **Replacement format**: `[REDACTED:...ab3f]` -- include last 4 characters for correlation, matching the UI masking format.
- **HTTP headers**: Never log `Authorization`, `X-Api-Key`, or `Cookie` header values. Log the header name only.
- **URL parameters**: Scrub `?apikey=` and similar query parameters from logged URLs.

**Confidence**: High -- log redaction best practices are well-documented across multiple authoritative sources (Better Stack, Skyflow, Dash0).

## Recommendations

### Must Have

1. **Masked display with last 4 characters**: `\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022ab3f` format for all stored API keys in the instance settings view. Fixed-width masking (8 bullets) to avoid leaking key length.

2. **Copy-to-clipboard button**: Dedicated clipboard icon button adjacent to the masked display. Uses `navigator.clipboard.writeText()` with `document.execCommand('copy')` fallback. Button state change (clipboard -> checkmark for 2s) plus toast notification for feedback.

3. **Reveal toggle**: Eye/EyeOff icon toggle using the existing lucide-svelte icons. Switches between masked and full-key display.

4. **ARIA accessibility**: `aria-pressed` on toggle, `aria-label` on buttons, `aria-live="assertive"` region for state change announcements. All buttons keyboard-accessible with visible focus indicators.

5. **On-demand key fetching**: Full API key value fetched via dedicated API endpoint only when Reveal or Copy is triggered, not included in initial page load data.

6. **Server-side log masking**: Redact API keys in all log output, showing at most the last 4 characters for correlation.

### Should Have

7. **Auto-hide timer**: Key automatically re-masks after 30 seconds with a visual countdown indicator. Re-masks immediately on page navigation or tab blur.

8. **Mobile-optimized touch targets**: Minimum 44x44px for Copy and Reveal buttons with at least 10px spacing between them.

9. **Monospace font for revealed keys**: Full key displays in a monospace font for character-by-character readability.

10. **Empty key state handling**: Clear "No API key configured" message with disabled Copy/Reveal buttons and a "Set API Key" action.

11. **Contextual error messages**: Connection test failures include the last 4 characters of the key for troubleshooting without revealing the full value.

### Nice to Have

12. **Configurable auto-hide duration**: User preference setting for auto-hide timer (10s, 30s, 60s, or disabled).

13. **Visual state differentiation**: Subtle background color change when key is revealed (light amber or blue tint) to signal sensitivity.

14. **Reveal countdown progress bar**: Thin, animated progress bar below the field showing remaining time before auto-hide.

15. **Optional re-authentication**: Configurable setting to require password confirmation before revealing keys (for shared-access environments).

16. **Copy success animation**: Micro-animation on the copy button (brief scale pulse) for satisfying feedback.

17. **Keyboard shortcut**: `Ctrl+Shift+C` to copy the key when the masked field is focused (discoverable via tooltip).

## Open Questions

1. **Should the masked format use prefix or suffix?** This document recommends last 4 characters (suffix). If Arr API keys gain standardized prefixes in the future, revisit to use `prefix...suffix` format like OpenAI.

2. **Should Copy work without a network round-trip?** The current recommendation fetches the key on demand. An alternative is to embed an encrypted key reference in the page data and decrypt client-side, avoiding a network call -- but this adds implementation complexity for marginal benefit.

3. **Should the auto-hide timer be per-reveal or global?** If multiple instances are shown on a single page, does each have its own timer, or does revealing one hide all others? Recommendation: per-instance timers.

4. **Should key access be auditable?** The on-demand fetch endpoint creates a natural audit point. Should Praxrr log when a user reveals or copies a key, and surface this in a security audit log? This may be desirable for multi-user future scenarios.

5. **How should environment-variable-managed keys be displayed?** When `canEditCoreConnectionFields` is false (keys managed by env vars), should the masked display still show last 4 characters, or should it show a different indicator like "Managed by environment"? Current recommendation: show the masked value but disable Reveal and Copy buttons with a tooltip: "This key is managed by environment variables."

6. **What about future credential types?** The masking component should be generic enough to handle not just Arr API keys but also TMDB API keys, notification service tokens, OIDC client secrets, and any future credential type. Design the component as a reusable `MaskedCredential` rather than coupling it to the Arr instance form.

## Sources

- [Stripe API Keys Documentation](https://docs.stripe.com/keys)
- [Stripe Key Management](https://stripe.com/docs/development/dashboard/manage-api-keys)
- [GitHub Managing Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [GitHub New Token Format](https://www.infoq.com/news/2021/04/github-new-token-format/)
- [Cloudflare Create API Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [AWS CLI Access Key Visibility Issue](https://github.com/aws/aws-cli/issues/7372)
- [OpenAI Admin API Keys](https://platform.openai.com/docs/api-reference/admin-api-keys)
- [Google Cloud Manage API Keys](https://docs.google.com/docs/authentication/api-keys)
- [Carbon Design System: Generate an API Key](https://carbondesignsystem.com/community/patterns/generate-an-api-key/)
- [Radarr API Key Obfuscation Discussion (Issue #9397)](https://github.com/Radarr/Radarr/issues/9397)
- [Radarr TMDB API Key Exposure (Issue #3890)](https://github.com/Radarr/Radarr/issues/3890)
- [Radarr Settings Wiki](https://wiki.servarr.com/radarr/settings)
- [Sonarr Settings Wiki](https://wiki.servarr.com/sonarr/settings)
- [Recyclarr Configuration Reference](https://recyclarr.dev/reference/configuration/)
- [Configarr Configuration File](https://configarr.de/docs/configuration/config-file/)
- [Profilarr GitHub Repository](https://github.com/Dictionarry-Hub/profilarr)
- [Bitwarden Auto-Hide Feature Request](https://community.bitwarden.com/t/auto-hide-password-field-after-configurable-period/1176)
- [Bitwarden Hidden Passwords Blog](https://bitwarden.com/blog/introducing-hidden-passwords/)
- [Make Things Accessible: Accessible Password Reveal](https://www.makethingsaccessible.com/guides/make-an-accessible-password-reveal-input/)
- [UK GDS: Making a Show Password Option](https://technology.blog.gov.uk/2021/04/19/simple-things-are-complicated-making-a-show-password-option/)
- [WCAG 2.5.5: Target Size](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)
- [WCAG 2.5.8: Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Toast Notifications UX Best Practices (LogRocket)](https://blog.logrocket.com/ux-design/toast-notifications/)
- [Clipboard API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)
- [Unblocking Clipboard Access (web.dev)](https://web.dev/articles/async-clipboard)
- [JavaScript Clipboard API with Fallback (SiteLint)](https://www.sitelint.com/blog/javascript-clipboard-api-with-fallback)
- [Flowbite Svelte Clipboard Component](https://flowbite-svelte.com/docs/components/clipboard)
- [API Key Best Practices (freeCodeCamp)](https://www.freecodecamp.org/news/best-practices-for-building-api-keys-97c26eabfea9/)
- [API Key Best Practices (Okta)](https://developer.okta.com/blog/2021/02/03/api-key-best-practices-and-examples)
- [Logging Sensitive Data Best Practices (Better Stack)](https://betterstack.com/community/guides/logging/sensitive-data/)
- [Keeping Sensitive Data Out of Logs (Skyflow)](https://www.skyflow.com/post/how-to-keep-sensitive-data-out-of-your-logs-nine-best-practices)
- [Masked Text Pattern (AL Guidelines)](https://alguidelines.dev/docs/navpatterns/patterns/security/4-masked-text/)
- [Smashing Magazine: Password Masking](https://www.smashingmagazine.com/2012/10/password-masking-hurt-signup-form/)
- [Password Masking Usability Study (Georgia Tech, CCS 2024)](https://faculty.cc.gatech.edu/~frankli/papers/PasswordMasking_CCS24.pdf)
