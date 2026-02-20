# API Key Masking Implementation Plan

This feature removes plaintext API key exposure from settings payloads and server logs while preserving existing update and regenerate workflows. The strategy is to align TMDB/AI/Auth key handling with the stronger Arr credential model: mask at serialization boundaries, fetch full values only through explicit reveal/copy actions, and sanitize logs globally. Implementation is organized into narrow, dependency-aware tasks so utility, server, UI, and logger work can proceed in parallel with minimal merge contention. The plan also includes a targeted Arr logs route fix that restores decrypted client creation and closes a known behavioral bug.

## Critically Relevant Files and Documentation

- `docs/plans/api-key-masking/shared.md`: central feature context and current target inventory.
- `docs/plans/api-key-masking/feature-spec.md`: acceptance criteria, masking format, and rollout priorities.
- `docs/plans/api-key-masking/research-technical.md`: implementation notes and edge-case guidance.
- `packages/praxrr-app/src/routes/settings/general/+page.server.ts`: TMDB/AI payload and action boundary.
- `packages/praxrr-app/src/routes/settings/security/+page.server.ts`: auth payload boundary and regenerate action.
- `packages/praxrr-app/src/routes/settings/general/components/types.ts`: settings DTO contracts.
- `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: global metadata serialization point.
- `packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts`: Arr logs page client initialization.
- `packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts`: reusable payload leak assertion pattern.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: established query-level key redaction pattern.

## Implementation Plan

### Phase 1: Foundation and Server Contract Updates

#### Task 1.1: Add shared key masking utility and baseline utility tests Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/shared/utils/uuid.ts`
- `docs/plans/api-key-masking/feature-spec.md`
- `docs/plans/api-key-masking/research-technical.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/shared/utils/masking.ts`
- `packages/praxrr-app/src/tests/base/apiKeyMasking.test.ts`

Implement `maskApiKey()` and `isMaskedValue()` with deterministic formatting and explicit short-key behavior so all downstream server and UI tasks share one source of truth. Add focused unit tests for null, empty, short, and normal keys plus masked value detection. Keep the utility import path stable so route and component tasks can depend on one canonical helper.

#### Task 1.2: Convert general settings load payload to masked key contract Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/settings/general/+page.server.ts`
- `packages/praxrr-app/src/routes/settings/general/components/types.ts`
- `docs/plans/api-key-masking/shared.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/settings/general/+page.server.ts`
- `packages/praxrr-app/src/routes/settings/general/components/types.ts`

Replace plaintext `api_key` fields in load output with `api_key_masked` and `has_api_key` fields for both TMDB and AI settings. Keep existing update actions unchanged for write paths, but ensure new typed contracts are propagated consistently to avoid mixed payload shapes.

#### Task 1.3: Convert security settings load payload to masked key contract Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/settings/security/+page.server.ts`
- `docs/plans/api-key-masking/feature-spec.md`
- `docs/plans/api-key-masking/research-patterns.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/settings/security/+page.server.ts`

Return `apiKeyMasked` and `hasApiKey` from the security page load function and keep `regenerateApiKey` show-once behavior unchanged. Ensure any derived load typing still supports form precedence where regenerated keys temporarily override masked load data.

#### Task 1.4: Fix Arr logs page to use decrypted instance client creation Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts`

Replace masked-key client initialization with `getArrInstanceClient()` so Arr logs requests use decrypted credentials from secure storage. Preserve current error behavior and route semantics while removing reliance on `instance.api_key`, which is intentionally empty.

### Phase 2: Reveal UX and Logger Redaction

#### Task 2.1: Create reusable masked API key display component Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte`
- `docs/plans/api-key-masking/research-ux.md`
- `docs/plans/api-key-masking/research-technical.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte`

Build a display-only component that renders masked values, supports reveal/hide state, and offers copy feedback hooks without owning persistence logic. Include acceptance criteria in the implementation notes:

- Keyboard flow supports tab navigation and Enter/Space activation for reveal/copy controls.
- Accessibility attributes include explicit labels, pressed-state semantics, and status announcements.
- Remask behavior covers manual hide and timeout-based hide.
- Copy feedback has clear success and failure states without rendering plaintext in persistent UI text.

#### Task 2.2: Add TMDB and AI reveal actions on general settings server route Depends on [1.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/settings/general/+page.server.ts`
- `packages/praxrr-app/src/lib/server/db/queries/tmdbSettings.ts`
- `packages/praxrr-app/src/lib/server/db/queries/aiSettings.ts`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/settings/general/+page.server.ts`

Add explicit reveal actions that fetch full keys server-side and return them only in action responses for user-initiated reveal/copy flows. Define an explicit contract for each action:

- Success response contains only action-scoped reveal payload fields (`revealedTmdbKey` or `revealedAiKey`).
- Missing key returns a safe, non-sensitive failure payload.
- Query/decryption/runtime failure returns a generic error payload with no secret fragments.
- Action handlers must avoid logging raw key values in error metadata.
  Keep load payloads masked and avoid introducing any shared state that could persist revealed values.

#### Task 2.3: Migrate TMDB and AI settings components to masked data and reveal flow Depends on [2.1, 2.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/settings/general/+page.svelte`
- `packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`
- `packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/settings/general/+page.svelte`
- `packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`
- `packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`

Switch component props and render paths to the masked contract (`api_key_masked`, `has_api_key`) and wire reveal/copy interactions to server actions. Preserve existing edit/update behavior where users must enter real values to change keys and never submit masked placeholders.

#### Task 2.4: Add security reveal action and migrate security page to masked component flow Depends on [1.3, 2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/settings/security/+page.server.ts`
- `packages/praxrr-app/src/routes/settings/security/+page.svelte`
- `docs/plans/api-key-masking/feature-spec.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/routes/settings/security/+page.server.ts`
- `packages/praxrr-app/src/routes/settings/security/+page.svelte`

Add a reveal action for auth API keys and replace plaintext display logic with the shared masked component flow. Define deterministic precedence and remask rules:

- If `regenerateApiKey` succeeds, regenerated value has highest display precedence until user dismisses or remasks.
- Subsequent reveal action requests may replace displayed value only for the active reveal session.
- Any reveal failure keeps masked display state and surfaces only generic error text.
- Copy operations must source from action-retrieved value and never from masked placeholders.
  Ensure regenerate action responses still show full values one time and that reveal/copy interactions re-mask correctly after completion.

#### Task 2.5: Introduce logger metadata sanitizer and hook into logger serialization Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`
- `packages/praxrr-app/src/lib/server/utils/logger/types.ts`
- `docs/plans/api-key-masking/research-technical.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`

Files to Modify

- `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`

Implement recursive metadata redaction for sensitive key names and common secret-bearing fields before any JSON serialization. Apply sanitizer consistently across console/file paths so logs cannot leak plaintext keys even when callers pass raw metadata.

### Phase 3: Verification and Integration Hardening

#### Task 3.1: Expand masking and redaction test coverage for server payloads and logger behavior Depends on [1.2, 1.3, 2.5]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts`
- `packages/praxrr-app/src/tests/base/apiKeyMasking.test.ts`
- `docs/plans/api-key-masking/shared.md`

**Instructions**

Files to Modify

- `packages/praxrr-app/src/tests/base/apiKeyMasking.test.ts`
- `packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts`

Add regression tests that assert no plaintext key exposure in route payloads and sanitized logger outputs. Reuse existing leak assertion helpers and include cases for short keys, empty keys, and nested log metadata structures.

#### Task 3.2: Add UI interaction regression coverage for reveal/copy/remask behavior Depends on [2.3, 2.4]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`
- `packages/praxrr-app/src/routes/settings/security/+page.svelte`
- `docs/plans/api-key-masking/research-ux.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/e2e/specs/2.40-api-key-masking.spec.ts`

Add focused UI interaction regression tests with explicit assertions for:

- Reveal action displays full key only after user action and does not alter initial page payload masking.
- Regenerated auth key display precedence over masked load data until remasked.
- Copy success and failure paths never expose plaintext in persistent page text or error messages.
- Auto-remask/manual-remask flows restore masked display state.
- Update submissions never send masked placeholder strings as credential values.

## Advice

- Keep `maskApiKey()` semantics stable and final before broad UI/server rollout to avoid cascading refactors.
- Treat `settings/general/+page.server.ts` as a merge hotspot; sequence changes to payload contract and reveal actions carefully.
- Keep Arr-specific encrypted client logic (`getArrInstanceClient`) isolated from masking concerns; do not regress existing credential decryption boundaries.
- Build logger redaction independently, then integrate with route-level tests to catch both payload and telemetry leaks.
- Prefer additive contract fields (`*_masked`, `has_*`) over overloaded existing fields to make misuse obvious during review.
