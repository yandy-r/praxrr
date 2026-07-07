# Business Analysis — Progressive Complexity Architecture ("Grow With Me")

Feature: GitHub issue #29 (Praxrr). Role: business-analyzer feeding `prp-plan`.
Scope: extract User Story, Problem → Solution, and binary Acceptance Criteria. Evidence-first; no recommendations.

## User Story

As a **self-hosted media-automation operator whose expertise grows over time**, I want **Praxrr to present each configuration section at a complexity tier (beginner / intermediate / advanced) that matches my expertise in that area, suggest advancing when my usage warrants it, and let me step back down at any time**, so that **I can complete tasks without drowning in controls I don't yet understand, while never losing access to the power controls I've grown into.**

Supporting actor stories:

- As a **casual/first-time user (leaving a managed service)**, I want **a beginner tier that shows only the essential controls for a section**, so that **I can finish initial configuration instead of abandoning at the config cliff.**
- As a **power user**, I want **an advanced tier that exposes every control for a section**, so that **the progressive system never hides capability I depend on.**
- As a **mixed-expertise user**, I want **to be advanced in one section (e.g. custom-format scoring) and beginner in another (e.g. media naming) at the same time**, so that **my interface reflects real, uneven expertise.**

## Problem → Solution

**Current state:** Praxrr offers only a per-section binary `basic | advanced` visibility toggle (`UI_PREFERENCE_MODES = ['basic','advanced']`, DB `CHECK (mode IN ('basic','advanced'))`), with no middle tier, no usage tracking, no advancement suggestions, and no complexity concept in the `$ui` design system — so casual users are still exposed to the full ~25–35 concept load (H6 / systems-thinker) and power users get no graduated growth path. **→ Desired state:** A per-user, per-section complexity tier (`beginner | intermediate | advanced`) layered on top of the existing disclosure primitive, where usage crossing a threshold _suggests_ (never forces) advancement, any section can be reset to a simpler tier at any time, and `$ui` components consume the active tier as a first-class prop/context — allocating the finite "complexity budget" dynamically per section per user.

## Acceptance Criteria rows

| #   | Criterion                                                                                                                                                                                                             | Testable? |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | A section's complexity tier resolves to exactly one of three values: `beginner`, `intermediate`, `advanced`; any other value is rejected at the API and DB boundary.                                                  | Yes       |
| 2   | For a section with no stored tier, the resolved tier defaults to `beginner` (the simplest tier); anonymous/unauthenticated users receive the default with zero DB writes.                                             | Yes       |
| 3   | Complexity tier is persisted keyed by `(user_id, section_key)`, so one user can simultaneously hold different tiers across different sections.                                                                        | Yes       |
| 4   | Changing the tier of one `section_key` for a user leaves the tier of every other `section_key` for that same user unchanged (per-section independence).                                                               | Yes       |
| 5   | The system records a per-user, per-section usage signal (e.g. count of profile/section edits), and when the signal crosses a defined threshold a tier-advancement suggestion is surfaced for that section.            | Yes       |
| 6   | A tier-advancement suggestion NEVER mutates the active tier by itself; the stored/active tier changes only after an explicit user confirmation action.                                                                | Yes       |
| 7   | A surfaced suggestion is dismissable, is non-blocking (does not modal-gate or prevent using the current tier), and once dismissed does not re-appear for that section until the threshold is re-crossed.              | Yes       |
| 8   | A user can reset (step down) any section to a lower tier at any time via an always-available control, and the lowered tier persists across reload.                                                                    | Yes       |
| 9   | `$ui` design-system components expose complexity tier as a first-class prop and/or context value; a tier-aware component reads the active tier from context without requiring a bespoke per-call wiring.              | Yes       |
| 10  | Rendered controls are strictly cumulative: every control visible at `beginner` is visible at `intermediate`, and every control at `intermediate` is visible at `advanced` (each tier is a superset of the one below). | Yes       |
| 11  | The new tier layer coexists with the existing `basic`/`advanced` `AdvancedSection`/`DisclosureSection` primitive; existing disclosure sections continue to function unchanged (backward compatible).                  | Yes       |
| 12  | Tier writes enforce optimistic concurrency (a stale `expected_updated_at` is rejected with HTTP 409), consistent with the existing `ui-preferences` endpoint contract.                                                | Yes       |
| 13  | Tier reads and writes are scoped to the authenticated requesting user; a user cannot read or modify another user's tier state (401 when unauthenticated, no cross-user leakage).                                      | Yes       |
| 14  | Tier state is queryable per user across all sections (list view), enabling a settings surface that shows every section's current tier and its reset control.                                                          | Yes       |

## Requirement → Criterion coverage (5 explicit feature requirements)

| Feature requirement (issue #29)                     | Covered by AC |
| --------------------------------------------------- | ------------- |
| 3 complexity tiers (beginner/intermediate/advanced) | 1, 2, 10      |
| Automatic progression — suggest, never force        | 5, 6, 7       |
| Per-section granularity                             | 3, 4, 14      |
| Reset option (return to simpler view)               | 2, 8          |
| Design-system integration (`$ui` tier prop/context) | 9, 10, 11     |

## Current-State Evidence (codebase, ≤5 lines each)

| Finding                                                               | File:Lines                                                                                     | Snippet                                                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Only 2 modes exist today (no middle tier)                             | `packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts:12`                              | `export const UI_PREFERENCE_MODES = ['basic', 'advanced'] as const;`                                   |
| DB constrains mode to 2 values                                        | `packages/praxrr-app/src/lib/server/db/migrations/050_create_user_interface_preferences.ts:14` | `mode TEXT NOT NULL CHECK (mode IN ('basic', 'advanced')),`                                            |
| Per-(user,section) uniqueness already exists                          | `.../migrations/050_...ts:20-21`                                                               | `CREATE UNIQUE INDEX ... ON user_interface_preferences(user_id, section_key);`                         |
| Default is `basic`; anonymous gets default, no writes                 | `packages/praxrr-app/src/lib/server/disclosure/loadSectionModes.ts:16-21`                      | `modes[key] = 'basic'; ... if (!userId) { return modes; }`                                             |
| Section key = `route-family:page:section`                             | `.../shared/disclosure/sectionKeys.ts:10`                                                      | `SECTION_KEY_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/;`                                          |
| `$ui` primitive takes binary `mode` prop, self-toggles basic↔advanced | `packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte:26,39-41`                   | `export let mode: UiPreferenceMode = 'basic'; ... mode = isAdvanced ? 'basic' : 'advanced';`           |
| Optimistic concurrency contract to mirror                             | `packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts:120-123`                      | `const optimisticConflict = detectConcurrencyConflict(...); if (...) return json({...},{status:409});` |
| No usage tracking / suggestion state anywhere                         | `.../db/queries/user_interface_preferences.ts:22-27`                                           | Row shape is `{user_id, section_key, mode, updated_at}` only — no counters/suggestion fields           |
| Reset today = toggle back to `basic` (no tier-aware reset)            | `.../ui/form/AdvancedSection.svelte:39-41`                                                     | `function toggleMode() { mode = isAdvanced ? 'basic' : 'advanced'; }`                                  |

## Research Evidence (grounding Problem → Solution)

| Claim                                                                                                                 | Source                                                     |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Complexity budget ~25–35 concepts, "nearly spent"; progressive disclosure is "not optional"                           | `research/.../persona-findings/systems-thinker.md:305,404` |
| Onboarding funnel: steepest drop between install and first sync; ~15% retained                                        | `research/.../persona-findings/systems-thinker.md:328-354` |
| Bad onboarding causes up to 80% abandonment; ecosystem excludes 3 segments (non-technical, non-English, disabilities) | `research/.../persona-findings/negative-space.md:142,318`  |
| Existing tools stop at a binary basic/advanced toggle; no multi-tier, no contextual help                              | `research/.../persona-findings/negative-space.md:207-214`  |
| H6 "Grow With Me" rated high-confidence / most transformative; suggested (not forced) tier advancement based on usage | `research/.../synthesis/innovation.md:64-73,190`           |

## Gaps / Flags (needs validation by synthesizer)

- GAP: `innovation.md:68` describes **4 tiers** ("Getting Started / Customizing / Managing / Expert"); issue #29 and the recommended direction specify **3 tiers** (beginner/intermediate/advanced). ACs are written to the 3-tier contract in issue #29. Discrepancy is a synthesis decision, not a business fact.
- GAP: The concrete usage signal for progression (issue example: "edited 10 profiles") is illustrative. AC #5 is written against a generic "threshold-crossing usage signal"; the exact metric, threshold, and storage location are unspecified in issue #29 — `ASSUMPTION — needs validation`.
- GAP: No existing table/column tracks per-user usage counts or suggestion dismissal state (`user_interface_preferences` row is mode-only). A new persistence surface is implied but its shape is undefined — `ASSUMPTION — needs validation`.
- GAP: issue #29 states this is an architectural foundation for #11 (Progressive Disclosure — already shipped as the 2-mode system) and #12 (Setup Wizard); "design now, full implementation gradual." Whether ACs 5–7 (progression) must ship now or are design-only is unstated — `ASSUMPTION — needs validation`.
- GAP: Relationship between legacy `mode` (`basic|advanced`) and new `tier` (`beginner|intermediate|advanced`) is not defined in issue #29 (map `basic→beginner`? keep both columns?). AC #11 only requires non-breaking coexistence — mapping is a synthesis decision.
