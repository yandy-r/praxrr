## Executive Summary

Encrypted API key storage should feel secure and predictable: users should understand what is stored, what cannot be recovered, and what action is required when encryption key material is missing. A low-friction flow uses masked-by-default inputs, clear one-time reveal rules, and actionable (but non-leaky) error states. The best UX combines trust messaging with operational transparency (status, last update, rotation path) so users can recover quickly without exposing secrets.

### Core User Workflows

- Happy path flow

1. User opens integration credentials and sees current state: `Not configured` or `Configured` (with timestamp and non-sensitive fingerprint like last 4 chars).
2. User enters API key in a secure field (masked by default) with an explicit `Show/Hide` toggle.
3. User saves; app validates format, encrypts server-side, and confirms success.
4. Post-save, plaintext is no longer shown; UI displays masked reference + metadata (`last updated`, `created by`, `rotation recommended by`).
5. User can later replace or rotate key through the same flow.

- Recovery/error flow

1. If encryption key material is missing/unavailable, block secret save/reveal actions and show a focused recovery panel with primary CTA: `Set up encryption key` or `Reconnect key provider`.
2. If encryption fails (disabled key, permission issue, key state invalid), return actionable error copy tied to recovery steps (for example: `Key is disabled. Re-enable key version and retry.`).
3. If key material is irrecoverable, guide user through controlled re-entry: clear explanation that stored secrets cannot be decrypted, then checklist to re-enter affected API keys.
4. For repeated failures, surface support/runbook link plus audit correlation ID (never include secret values).

## UI and Interaction Patterns

- Component and interaction recommendations
- Use a dedicated `SecretInput` component with:

1. `type=password` default.
2. Explicit `Show/Hide` control with accessible labels.
3. Auto-rehide after short timeout or on blur/tab switch.
4. Paste support enabled.

- Do not prefill stored plaintext when editing. Show `Stored` state with masked token reference only (for example `••••••••••ab12`).
- Use one-time reveal semantics for newly created/replaced secrets: prompt user to copy once, then hide permanently unless rotated/replaced.
- Separate `API key` and `encryption key` setup into different cards/sections to reduce mental model confusion.
- Add a lightweight trust explainer near save action: `Stored encrypted at rest. Plaintext is never shown after save.`
- Require step-up authentication for high-risk actions (reveal, delete, rotate, key-provider change) when session risk is high.
- For destructive actions (`Delete key`, `Rotate now`), show impact copy before confirm (`Existing integrations may fail until updated`).

## Accessibility Considerations

- Key accessibility requirements and mitigations
- Always provide visible labels, helper text, and text-based error messages (not color-only).
- Link errors to fields with `aria-invalid` and `aria-describedby`; include error summary at top for multi-error forms.
- Announce dynamic validation/errors via pre-rendered live regions (`role=alert` for urgent errors, `role=status` for non-blocking status).
- Keep reveal/hide, copy, rotate, and retry actions keyboard reachable with clear focus styles.
- Use programmatic input purpose hints where applicable (`autocomplete` tokens) and consistent field naming for assistive tech.
- Ensure state messages (saving, success, retrying, failure) are announced without stealing focus unless user action is required.
- Maintain minimum contrast and non-color indicators for secure-state badges (`Configured`, `Missing key`, `Action required`).

### Feedback and State Design

- Loading, empty, success, and error states
- Loading

1. Initial load: `Checking encryption status…` skeleton + disabled primary actions.
2. Save in progress: disable submit, show inline spinner and `Encrypting and saving key…`.

- Empty

1. No key configured: concise empty-state copy with single primary CTA (`Add API key`).
2. No encryption key provider configured: block secret entry and route to setup (`Configure encryption key`).

- Success

1. Inline confirmation + toast: `API key stored securely`.
2. Show non-sensitive metadata (`Updated just now`, actor, next recommended rotation date).
3. If one-time reveal applies, show copy panel once, then dismiss permanently.

- Error

1. Validation errors: field-level and specific (`API key format looks invalid`).
2. Security-preserving auth errors: generic where enumeration risk exists, plus support path.
3. Encryption provider errors: explicit remediation (`Key disabled`, `Access denied`, `Key not found`, `Service unavailable`) with retry/backoff guidance.
4. Never echo secrets in UI errors, telemetry, or logs.

## UX Risks

- Confusion points and mitigations
- Risk: Users think masked values can be recovered.
  Mitigation: Persistent note: `Plaintext cannot be retrieved after save; replace to update.`
- Risk: Users confuse API key vs encryption key responsibilities.
  Mitigation: Separate sections, distinct labels, and short “what this is” microcopy.
- Risk: Shoulder-surfing during reveal.
  Mitigation: Mask by default, explicit reveal intent, auto-rehide on timeout/blur.
- Risk: Overly generic errors block recovery.
  Mitigation: Two-layer errors: security-safe public message + actionable admin detail where safe.
- Risk: Key rotation causes unexpected outage.
  Mitigation: Pre-rotation impact summary and post-rotation checklist.
- Risk: Screen-reader users miss transient toasts.
  Mitigation: Mirror toast content into persistent `status` region.

## Sources

- OWASP Authentication Cheat Sheet (generic auth errors, re-auth for sensitive features): https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Secrets Management Cheat Sheet (least privilege, automation, lifecycle, auditing): https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- OWASP Logging Cheat Sheet (exclude secrets/keys from logs): https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- NIST SP 800-63B (show/hide option, allow password manager paste/autofill): https://pages.nist.gov/800-63-4/sp800-63b.html
- GOV.UK Password Input guidance (hide by default, clear security behavior patterns): https://design-system.service.gov.uk/components/password-input/
- WCAG Understanding SC 3.3.1 (error identification): https://www.w3.org/WAI/WCAG22/Understanding/error-identification
- WCAG Understanding SC 1.3.5 (programmatic input purpose): https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose
- WCAG Understanding SC 4.1.3 (status messages): https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html
- WAI Technique ARIA19 (`role=alert` / live region for errors): https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA19
- WAI Technique ARIA22 (`role=status` for non-blocking updates): https://w3c.github.io/wcag/techniques/aria/ARIA22
- Stripe API key UX patterns (one-time live key reveal, rotate if lost): https://docs.stripe.com/keys
