# PR #170 Review: feat(progressive-disclosure): complete rollout across all form and settings pages

**Branch:** `feat/enhance-progressive-disclosure` -> `main`
**Size:** +5,654 / -1,339 across 44 files
**Reviewed:** 2026-03-04

---

## Executive Summary

The PR implements a well-architected progressive disclosure system with canonical section keys, SSR hydration, client-side persistence, and two component patterns (DisclosureSection for forms, CollapsibleCard for settings). The code is Svelte 5 compliant (no runes), has good a11y attributes, and zero `any` usage. The client store (`userInterfacePreferences.ts`) is particularly well-designed with intercepted Svelte store interfaces and reference-counted lifecycle management.

**Verdict:** Mergeable with recommended fixes for error handling and type consolidation.

---

## Critical Issues (2 found)

### 1. Persistence failure catch block silently discards errors

- **Agent:** silent-failure-hunter
- **File:** `$stores/userInterfacePreferences.ts:306-315`
- **Impact:** When `flushSection` persistence fails, the `.catch` handler for generic `Error` instances is completely empty. The user toggles a disclosure section, it appears to work, then silently reverts seconds later with no explanation.
- **Fix:** Log with `console.error` and consider surfacing via `alertStore.add('warning', ...)`.
- **Status (2026-03-04):** Fixed. Added `console.error` plus `alertStore.add('warning', ...)` in the `flushSection` error branch.

### 2. Non-OK hydration responses silently discarded

- **Agent:** silent-failure-hunter
- **File:** `$stores/userInterfacePreferences.ts:170-174`
- **Impact:** When `hydrateSection` receives 500/503/429 responses, it silently returns without logging. Users who previously set sections to "advanced" will see them reset to "basic" on page load with no indication that persistence failed.
- **Fix:** Add `console.warn` at the `!response.ok` branch with status/sectionKey context. Consider retry for 5xx (matching the write path's existing retry logic).
- **Status (2026-03-04):** Fixed. Added `console.warn` with section key and HTTP status/details before returning on non-OK hydration responses.

---

## Important Issues (5 found)

### 3. `UiPreferenceMode` type defined in 5 separate locations

- **Agent:** type-design-analyzer
- **Impact:** The type `'basic' | 'advanced'` is independently defined in: client store, `loadSectionModes.ts`, DB queries, `AdvancedSection.svelte`, and the API endpoint. If a third mode is added, all 5 must be updated in lockstep.
- **Fix:** Export a single `UiPreferenceMode` from `$shared/disclosure/sectionKeys.ts` and import everywhere.

### 4. Validation constants (regex, max-length) triplicated

- **Agent:** type-design-analyzer
- **Impact:** `SECTION_KEY_PATTERN` and max-length `96` are defined independently in the client store, DB queries, and API endpoint. Documented in JSDoc of `sectionKeys.ts` but not exported as actual constants.
- **Fix:** Export `SECTION_KEY_PATTERN` and `SECTION_KEY_MAX_LENGTH` from `sectionKeys.ts` and import in all three consumers.

### 5. No `SectionKey` union type -- keys typed as `string` everywhere

- **Agent:** type-design-analyzer
- **Impact:** The registry exports 17+ string constants but never derives a union type. Every consumer accepts plain `string`, meaning the compiler cannot catch misspelled or unregistered keys.
- **Fix:** Derive `type SectionKey = typeof CF_CONDITIONS | typeof CF_SCORING | ...` from the registry and use it in component props, `loadSectionModes`, and `SectionModeMap`.

### 6. `loadSectionModes` has no error handling around DB queries

- **Agent:** silent-failure-hunter
- **File:** `$lib/server/disclosure/loadSectionModes.ts:24-29`
- **Impact:** DB queries can throw (`SQLITE_BUSY`, `SQLITE_CORRUPT`, assertion failures). If the first key query throws, remaining keys are never queried and the SSR load function crashes with an opaque 500.
- **Fix:** Either wrap the loop in try-catch with logging and return defaults on failure, or document that it throws and add try-catch in page server `load` functions.

### 7. `loadSectionModes` has zero unit tests

- **Agent:** pr-test-analyzer
- **Impact:** Called in 8+ `+page.server.ts` load functions. If it regresses (e.g., throws on `undefined` userId), every page with disclosure sections breaks.
- **Fix:** Add unit tests for: `undefined` userId returns all `'basic'`, valid userId returns persisted modes + `'basic'` defaults, empty key list returns empty record.

---

## Suggestions (11 found)

### 8. `SectionModeMap` redefined inline in 4 Svelte components

- **Agent:** type-design-analyzer
- **Fix:** Define once in `$shared/disclosure/sectionKeys.ts` as `Record<SectionKey, UiPreferenceMode>`.

### 9. `loadSectionModes` should use generic signature to preserve key info

- **Agent:** type-design-analyzer
- **Fix:** `function loadSectionModes<K extends SectionKey>(userId: number | undefined, sectionKeys: readonly K[]): Record<K, UiPreferenceMode>` -- eliminates `?? 'basic'` fallbacks at consumption sites.

### 10. `CollapsibleCard` `{#if isOpen}` destroys slot DOM -- no test for form data survival

- **Agent:** pr-test-analyzer
- **Impact:** If someone wraps multiple cards in a single parent form, collapsed cards silently drop form fields from submission.
- **Fix:** Add E2E test or document that each card's form submits independently.

### 11. `GET` with `strict=true` returns 404 -- untested

- **Agent:** pr-test-analyzer
- **Fix:** Add unit test for the `strict=true` code path.

### 12. Concurrency conflict (stale `expected_updated_at`) -- untested

- **Agent:** pr-test-analyzer
- **Fix:** Add unit test that PATCHing with a stale `expected_updated_at` returns 409.

### 13. Invalid `mode` values rejected -- untested

- **Agent:** pr-test-analyzer
- **Fix:** Add unit test sending invalid mode value (e.g., `'expanded'`) returns 400.

### 14. JSDoc says "server-side regex" but validation is also client-side

- **Agent:** comment-analyzer
- **File:** `$shared/disclosure/sectionKeys.ts:1-7`
- **Fix:** Change to "must match the validation regex (enforced on both client and server)".

### 15. `onMinBlocked` message says "at least 0.1.0" but `min={2}`

- **Agent:** comment-analyzer
- **File:** `databases/[id]/config/+page.svelte:293`
- **Fix:** Update message to match the actual `min` constraint.

### 16. `CollapsibleCard` `sectionKey: string = ''` uses empty string as sentinel

- **Agent:** type-design-analyzer
- **Fix:** Use `sectionKey: SectionKey | undefined = undefined` for explicit intent.

### 17. `$page.data.arrSettingsSectionModes ?? {}` hides missing server data

- **Agent:** silent-failure-hunter
- **File:** `InstanceForm.svelte:424`
- **Fix:** Log a warning when `arrSettingsSectionModes` is nullish to distinguish "not yet loaded" from "property missing after refactor".

### 18. `temp/temp.md` included in PR

- **Agent:** code-reviewer
- **Fix:** Remove from the PR or add to `.gitignore`.

---

## Strengths

- **Architecture:** Clean separation -- `DisclosureSection` always persists, `CollapsibleCard` optionally persists. Canonical key registry prevents typos.
- **Client store:** Excellent encapsulation with intercepted Svelte store interfaces, reference counting, debounced persistence, retry with rollback. No `any` usage.
- **A11y:** Proper `aria-expanded`, `aria-controls`, `role="region"`, `aria-labelledby`. Reduced-motion preference respected.
- **Testing:** Strong user isolation, namespace isolation, E2E persistence across sessions, hidden input preservation for notifications, rate limiting coverage.
- **Comments:** `sectionKeys.ts` JSDoc explaining key naming pattern is well-done. `InstanceForm.svelte` "Never pre-populate for security" and dirty-tracking comments capture non-obvious design decisions.
- **CLAUDE.md compliance:** No runes, proper `onclick` handlers, `alertStore` for feedback, conventional commits, no `any`.

---

## Recommended Action

1. **Fix critical issues 1-2** (silent error handling in persistence store)
2. **Address important issues 3-7** (type consolidation, `loadSectionModes` error handling + tests)
3. **Consider suggestions** based on priority and timeline
4. **Remove** `temp/temp.md` from the PR

## Validation Log

- `deno task test packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts` passed (12/12), confirming disclosure preference API behavior remains unchanged after fixes.

---

## Review Agents Used

| Agent                 | Focus                             | Result                              |
| --------------------- | --------------------------------- | ----------------------------------- |
| code-reviewer         | CLAUDE.md compliance, bugs, logic | No critical/important issues        |
| silent-failure-hunter | Error handling, swallowed errors  | 2 critical, 2 high, 3 medium        |
| type-design-analyzer  | Type safety, invariants           | 3 important consolidation items     |
| pr-test-analyzer      | Coverage gaps                     | 1 critical gap, 4 important gaps    |
| comment-analyzer      | Comment accuracy                  | 1 misleading JSDoc, 1 wrong message |
