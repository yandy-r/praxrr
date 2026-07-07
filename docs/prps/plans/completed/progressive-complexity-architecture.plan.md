# Plan: Progressive Complexity Architecture ("Grow With Me")

## Summary

Layer a per-user, per-section **complexity tier** concept (`beginner | intermediate | advanced`) on top of Praxrr's already-shipped 2-mode (`basic`/`advanced`) progressive-disclosure primitive. The tier drives each section's default disclosure mode, powers non-intrusive "ready to advance?" suggestions from simple activity counters, exposes the active tier to `$ui` components via Svelte context, and offers a reset to a simpler view. This is the architectural foundation that #11 (Progressive Disclosure — already built) and #12 (Setup Wizard) build on; it ships the framework plus one reference integration, not a full rollout.

## User Story

As a self-hosted Arr operator whose expertise grows over time, I want the interface complexity to scale with me — simple and guided at first, progressively revealing advanced controls as I gain confidence, independently per feature area — so that I'm neither overwhelmed as a beginner nor limited as a power user, without ever being forced to switch modes.

## Problem → Solution

Today Praxrr exposes only a binary per-section `basic | advanced` toggle (`UI_PREFERENCE_MODES`, DB `CHECK`, `AdvancedSection.svelte`) with no notion of user expertise, no guidance, no automatic progression, and no reset — so casual users still face the full surface and power users get no acceleration → Introduce a per-user, per-section 3-tier "grow with me" layer that sets disclosure defaults, subtly suggests advancing based on tracked activity, exposes tier as a first-class `$ui` concept, and can always be reset, while the existing `basic/advanced` mode remains the low-level per-section override.

## Metadata

- **Complexity**: Large
- **Source PRD**: N/A (GitHub issue #29)
- **PRD Phase**: N/A — cross-cutting UX architecture (design in Phase 2, implement gradually)
- **Estimated Files**: ~16 (10 CREATE, 6 UPDATE)
- **GitHub Issue**: [#29 Progressive Complexity Architecture ("Grow With Me")](https://github.com/yandy-r/praxrr/issues/29)

## Batches

Tasks grouped by dependency for parallel execution. Tasks within the same batch run concurrently; batches run in order. No two tasks in a batch touch the same file.

| Batch | Tasks         | Depends On | Parallel Width |
| ----- | ------------- | ---------- | -------------- |
| B1    | 1.1, 1.2, 1.3 | —          | 3              |
| B2    | 2.1           | B1         | 1              |
| B3    | 3.1, 3.2      | B2         | 2              |
| B4    | 4.1           | B3         | 1              |
| B5    | 5.1           | B4         | 1              |
| B6    | 6.1, 6.2      | B5         | 2              |
| B7    | 7.1           | B5         | 1              |
| B8    | 8.1, 8.2      | B6, B7     | 2              |

- **Total tasks**: 13
- **Total batches**: 8
- **Max parallel width**: 3

---

## UX Design

### Before

New users land on a config page with every section already rendered; each section with extras exposes a per-section text toggle. No tier concept, no guidance, no reset.

```
StickyCard [ title/description | Delete  Save(disabled until dirty) ]
──────────────────────────────────────────────────────────────────
Basic Info (always visible)
Naming            [ Show Advanced ▾ ]   ← per-section, basic default   AdvancedSection.svelte:63-78
Folder Management [ Show Advanced ▾ ]   aria-expanded / aria-controls
Importing         [ Show Advanced ▾ ]   loads 'basic' each visit       DisclosureSection.svelte:10
```

### After

Tier orchestration wraps the existing primitive. Tier sets each section's default mode; the per-section Show/Hide Advanced control still works as an override. A subtle, dismissible suggestion appears after tracked actions; a reset returns to a simpler tier.

```
StickyCard [ title | Tier: (Beginner)(Intermediate)(Advanced) ⟲Reset | Save ]   NEW selector (right slot)
── inline suggestion banner (dismissible, aria-live=polite) ─────────────────── NEW, only when eligible
"Opening lots of advanced options — switch this area to Advanced?" [Switch][Not now ✕]
──────────────────────────────────────────────────────────────────
Basic Info (always visible)
Naming            [ Hide Advanced ▴ ]   ← tier=Advanced pre-expands (default only)
Folder Management [ Show Advanced ▾ ]   ← manual per-section override still wins   (unchanged primitive)
```

- Beginner = guided/preset, sections collapsed; Intermediate = today's neutral behavior; Advanced = sections pre-expanded by default.
- Suggestion surface is non-blocking (inline dismissible banner and/or `alertStore.add('info', …)` toast) — never a modal, never auto-switches.
- Per-section manual override still writes the existing `mode` key and always beats the tier default.

### Interaction Changes

| Touchpoint                  | Before                                                  | After                                                                                                     | Notes                                                                 |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Tier selector               | None                                                    | Segmented control in `StickyCard` right slot beside Save                                                  | Keyboard-focusable buttons, `aria-pressed` per tier                   |
| New-user landing            | All sections render `basic` by default                  | Land in Beginner (collapsed defaults)                                                                     | Preserves "loads basic by default"; tier just names/extends it        |
| Per-section advanced toggle | `Show/Hide Advanced` text button, `aria-expanded`       | Unchanged control; tier only sets its starting mode; manual toggle overrides                              | Explicit override beats tier default; do NOT remove the text toggle   |
| Progression suggestion      | None                                                    | Subtle inline banner / `info` toast after N tracked advanced-toggles                                      | Dismissible + `aria-live=polite`; never modal; never auto-switch      |
| Suggestion dismissal        | N/A                                                     | `Not now`/✕ persists dismissal so it isn't re-shown aggressively                                          | Store `suggestion_dismissed_at`                                       |
| Reset affordance            | None                                                    | "Reset to simpler view" sets tier back to beginner for the section                                        | Tier-only reset; does NOT silently clear per-section `mode` overrides |
| Dirty-state / navigation    | `isDirty` + `beforeNavigate` warn                       | Tier change / reset must NOT flip form dirty state (visibility-only)                                      | Preserve "toggling preserves form data"                               |
| Accessibility               | Text actions, `aria-expanded`, reduced-motion respected | Tier = focusable segmented buttons w/ `aria-pressed`; suggestion `aria-live=polite`; reset labeled button | Keep text (not icon-only) actions; honor `prefers-reduced-motion`     |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority       | File                                                                                                                                                                | Lines           | Why                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| P0 (critical)  | `packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts`                                                                                                      | 10-93           | Exact fixed-union/`as const` + section-key registry pattern to mirror for tiers                                |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts`                                                                                       | 1-123           | Repository shape (types, `rowToX`, `assertSectionKey`, idempotent upsert) to mirror                            |
| P0 (critical)  | `packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts`                                                                                                   | 1-320           | API route to clone: 401 gate, boundary parsers→400, optimistic concurrency→409, rate limit→429, default record |
| P0 (critical)  | `packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts`                                                                                             | 1-465           | Client store engine to clone (debounce 300ms, retry `[300,600,1200]`, refCount, auth clear)                    |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/db/migrations/050_create_user_interface_preferences.ts`                                                                         | 1-31            | Migration shape (CHECK, FK CASCADE, unique index) to mirror                                                    |
| P1 (important) | `packages/praxrr-app/src/lib/server/db/migrations.ts`                                                                                                               | 5-77, 300-370   | How migrations are registered (static import + `loadMigrations()` array); find next version                    |
| P1 (important) | `packages/praxrr-app/src/lib/server/disclosure/loadSectionModes.ts`                                                                                                 | 1-39            | SSR loader to mirror for `loadSectionTiers`                                                                    |
| P1 (important) | `packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte`                                                                                               | 1-41            | Integration point where tier feeds the default mode                                                            |
| P1 (important) | `packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte`                                                                                                 | 26-93           | a11y disclosure primitive (aria, reduced-motion) to reuse                                                      |
| P1 (important) | `packages/praxrr-app/src/lib/client/ui/card/CardGrid.svelte` / `card/Card.svelte`                                                                                   | all             | `setContext`/`getContext` no-runes provider/consumer pattern to mirror for tier context                        |
| P1 (important) | `docs/api/v1/openapi.yaml`                                                                                                                                          | 41-148, 680-723 | `/ui-preferences` path + schemas to mirror for `/complexity-tiers`                                             |
| P2 (reference) | `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts` + `components/GeneralForm.svelte`                                         | all             | Reference integration target (loader → `initialMode` wiring)                                                   |
| P2 (reference) | `packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts`, `tests/disclosure/loadSectionModes.test.ts`, `tests/e2e/specs/2.50-progressive-disclosure.spec.ts` | all             | Test patterns (Deno.test, in-memory route fixture, Playwright e2e) to mirror                                   |
| P2 (reference) | `docs/features/progressive-disclosure.md`                                                                                                                           | all             | Current disclosure model + docs to extend                                                                      |

## External Documentation

| Topic                                      | Source                                   | Key Takeaway                                                                                                                                                                                                              |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Svelte context (`setContext`/`getContext`) | <https://svelte.dev/docs/svelte/context> | Correct primitive for a cross-cutting `$ui` tier; must be set during component init (top of `<script>`), not in callbacks/async; context is per-request (SSR-safe) — never use a module-level singleton for per-user tier |
| No-runes reactive context                  | <https://svelte.dev/docs/svelte/context> | This repo bans runes — put a Svelte **store** in context and subscribe with `$store`; mirror `CardGrid`'s `$: setContext('card-flush', flush)` provider + `Card`'s `getContext` consumer with graceful fallback           |
| `openapi-typescript` codegen               | `deno.json` (`generate:api-types`)       | Build-time only (via `npx`), NOT a runtime dep; regenerate `v1.d.ts` after every `openapi.yaml` edit; generates types only, no client SDK                                                                                 |
| No new runtime dependency                  | —                                        | Client uses native `fetch`; activity counters = one integer upsert reusing the existing pattern. Do NOT add an HTTP client or telemetry library.                                                                          |

---

## Patterns to Mirror

Code patterns discovered in the codebase. Follow these exactly.

### NAMING_CONVENTION

```
// SOURCE: packages/praxrr-app/src/lib/shared/disclosure/sectionKeys.ts:10-14
export const SECTION_KEY_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$/;
export const SECTION_KEY_MAX_LENGTH = 96;
export const UI_PREFERENCE_MODES = ['basic', 'advanced'] as const;
export type UiPreferenceMode = (typeof UI_PREFERENCE_MODES)[number];
// Mirror EXACTLY: export const COMPLEXITY_TIERS = ['beginner','intermediate','advanced'] as const;
```

Conventions:

- New query module mirrors the disclosure sibling's **snake_case** filename: `user_complexity_tiers.ts` (decision: mirror the feature it extends, not the dominant camelCase; ~34 other query modules are camelCase — deliberate exception).
- Migration file uses the current **date-based** scheme `YYYYMMDD_snake_case.ts` with integer `version: YYYYMMDD` (sequential `NNN_` ended at `050`).
- Route folder: kebab under `/api/v1/` → `complexity-tiers/+server.ts`, `export const GET/PATCH: RequestHandler`.
- Client store: `createXStore()` factory + exported singleton + `getXSectionStore(key, default)` convenience.

### ERROR_HANDLING

```
// SOURCE: packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts:40-42, 183-197, 233-239
if (!locals.user) { return json({ error: 'Unauthorized' }, { status: 401 }); } // 401 before any DB op
if (sectionKey.length > SECTION_KEY_MAX_LENGTH) throw new Error('Invalid section_key format');
if (!SECTION_KEY_PATTERN.test(sectionKey)) throw new Error('Invalid section_key format');
if (raw !== 'basic' && raw !== 'advanced') throw new Error('mode is required ...'); // enum allow-list → mirror for tier
```

```
// SOURCE: packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts:38-46 (defense-in-depth re-validation)
function assertSectionKey(sectionKey: string): void {
  if (sectionKey.length > SECTION_KEY_MAX_LENGTH) throw new Error(`Invalid disclosure section key format: ${sectionKey}`);
  if (!SECTION_KEY_PATTERN.test(sectionKey)) throw new Error(`Invalid disclosure section key format: ${sectionKey}`);
}
```

### REPOSITORY_PATTERN

```
// SOURCE: packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts:88-122 (idempotent upsert + app-set updated_at)
upsert(input: UserInterfacePreferenceInput): UserInterfacePreference {
  assertSectionKey(input.sectionKey);
  const existing = this.getByUserIdAndSectionKey(input.userId, input.sectionKey);
  if (existing && existing.mode === input.mode) return existing;  // no-op write
  const now = new Date().toISOString();  // app-set for optimistic concurrency
  // ... UPDATE ... WHERE user_id = ? AND section_key = ?  OR  INSERT (parameterized ? only)
}
```

### SERVICE_PATTERN (SSR loader + optimistic concurrency)

```
// SOURCE: packages/praxrr-app/src/lib/server/disclosure/loadSectionModes.ts:9-24 (default-fill, then overlay from DB; guest → defaults)
export function loadSectionModes<K extends SectionKey>(userId: number | undefined, sectionKeys: readonly K[]): Record<K, UiPreferenceMode> {
  const modes = {} as Record<K, UiPreferenceMode>;
  for (const key of sectionKeys) modes[key] = 'basic';
  if (!userId) return modes;            // anonymous → safe defaults, no reads
  // ... overlay persisted values, try/catch per key with warn-and-continue
}
```

```
// SOURCE: packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts:158-181, 302-315 (optimistic concurrency → 409)
// PATCH compares expected_updated_at; conditional UPDATE ... WHERE updated_at = ?; rowcount 0 → 409;
// 'UNIQUE constraint failed' race also mapped → 409; per-(userId:sectionKey) sliding window (8/30s) → 429.
```

### $ui CONTEXT (no-runes provider/consumer)

```
// SOURCE: packages/praxrr-app/src/lib/client/ui/card/CardGrid.svelte:2,9 (provider)  +  card/Card.svelte:2,11-16 (consumer)
import { setContext, getContext } from 'svelte';
$: setContext('card-flush', flush);                                  // provider sets reactively (no $state)
try { contextFlush = getContext<boolean>('card-flush') ?? false; } catch { /* no parent provider */ }
// Mirror: provider puts the tier store in context; DisclosureSection consumes with graceful fallback.
```

### TEST_STRUCTURE

```
// SOURCE: packages/praxrr-app/src/tests/disclosure/loadSectionModes.test.ts:1,13-22 (Deno.test + @std/assert + monkey-patch restore)
import { assertEquals } from '@std/assert';
Deno.test('loadSectionModes returns basic for all keys when userId is undefined', () => {
  const original = userInterfacePreferencesQueries.getByUserIdAndSectionKey;   // stub
  try { /* ... assertEquals(...) ... */ } finally { userInterfacePreferencesQueries.getByUserIdAndSectionKey = original; }
});
```

```
// SOURCE: packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts:2-6,45-84 (in-memory route fixture; import handlers directly)
import { GET, PATCH } from '../../routes/api/v1/ui-preferences/+server.ts';
// withInMemoryStore() patches getByUserIdAndSectionKey + upsert over a Map<`${userId}:${sectionKey}`> — no real DB;
// buildGetRequest/buildPatchRequest fabricate Partial<RequestEvent> with url + locals.user; assert response.status + json().
```

---

## Files to Change

| File                                                                                                                        | Action             | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/shared/complexity/tiers.ts`                                                                    | CREATE             | Shared tier contract: `COMPLEXITY_TIERS = ['beginner','intermediate','advanced'] as const`, `ComplexityTier`, `SectionTierMap`; `tierToDefaultMode(tier): UiPreferenceMode` (beginner→basic, intermediate→basic, advanced→advanced); re-use `SECTION_KEY_PATTERN`/`SECTION_KEY_MAX_LENGTH`/`SectionKey` from `$shared/disclosure/sectionKeys.ts`. Mirrors `sectionKeys.ts`. FOUNDATIONAL.                                                                                    |
| `packages/praxrr-app/src/lib/server/db/migrations/<version>_create_user_complexity_tiers.ts`                                | CREATE             | New table `user_complexity_tiers(user_id, section_key, tier CHECK IN (beginner/intermediate/advanced), interaction_count INT NOT NULL DEFAULT 0 CHECK(>=0), advanced_toggle_count INT NOT NULL DEFAULT 0 CHECK(>=0), last_suggested_tier TEXT, suggestion_dismissed_at DATETIME, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`, FK→users ON DELETE CASCADE, unique idx `(user_id, section_key)`. Mirror migration 050. Do NOT touch `user_interface_preferences`. |
| `packages/praxrr-app/src/lib/server/db/migrations.ts`                                                                       | UPDATE             | Register migration: static import + entry in `loadMigrations()` array (two edits). FOUNDATIONAL.                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/praxrr-app/src/lib/server/db/queries/user_complexity_tiers.ts`                                                    | CREATE             | Repository mirroring `user_interface_preferences.ts`: `UserComplexityTier`/`...Row`/`...Input` types, `rowToTier`, `assertSectionKey`, `getByUserIdAndSectionKey`, `getByUserId`, idempotent `upsert`, `incrementActivity(userId, sectionKey, {interaction?, advancedToggle?})` (bounded/clamped), `reset(userId, sectionKey)` (tier→beginner, keeps mode override).                                                                                                         |
| `docs/api/v1/openapi.yaml`                                                                                                  | UPDATE             | Add `/complexity-tiers` get+patch mirroring `/ui-preferences`; schemas `ComplexityTier` (enum), `ComplexityTierRecord`, `ComplexityTierUpsertRequest`; reuse existing `UiSectionKey`. Contract-first. FOUNDATIONAL.                                                                                                                                                                                                                                                          |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                                                                                   | UPDATE (generated) | Regenerate via `deno task generate:api-types`. Do NOT hand-edit. FOUNDATIONAL (contract).                                                                                                                                                                                                                                                                                                                                                                                    |
| `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts`                                                         | CREATE             | GET(`?section_key`,`strict`) + PATCH(`section_key`,`tier`,`expected_updated_at`) cloning `ui-preferences/+server.ts`: 401 gate, boundary parse→400, tier enum allow-list, optimistic concurrency→409, rate limit→429, default non-strict record. Guard `user.id > 0` (skip persist for API-key synthetic user id=0).                                                                                                                                                         |
| `packages/praxrr-app/src/lib/server/complexity/loadSectionTiers.ts`                                                         | CREATE             | SSR loader mirroring `loadSectionModes.ts`: pre-fill keys to `'beginner'`, override from `userComplexityTiersQueries`, guest → defaults, per-key try/catch.                                                                                                                                                                                                                                                                                                                  |
| `packages/praxrr-app/src/lib/client/stores/userComplexityTiers.ts`                                                          | CREATE             | Client store mirroring `userInterfacePreferences.ts`: per-section `writable<ComplexityTier>`, debounce 300ms, retry `[300,600,1200]`, optimistic concurrency, 401 → `authRequired` + `clearOnAuthChange`, refCount cleanup; endpoint `/api/v1/complexity-tiers`.                                                                                                                                                                                                             |
| `packages/praxrr-app/src/lib/client/ui/complexity/complexityTierContext.ts`                                                 | CREATE             | Context key + `setComplexityTierContext(value)` / `getComplexityTierContext()` mirroring `CardGrid`/`Card`; exposes the tier store accessor + `tierToDefaultMode`.                                                                                                                                                                                                                                                                                                           |
| `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityTierProvider.svelte`                                            | CREATE             | Provider: props `sectionKey` + `initialTier`; wires `userComplexityTiers` section store; `setComplexityTierContext(...)`; renders `<slot/>`. Svelte 5 no-runes (stores + `$:`, `onclick`).                                                                                                                                                                                                                                                                                   |
| `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityProgressionHint.svelte`                                         | CREATE             | Dismissible, never-forced "advance?" suggestion driven by activity counters + threshold; accept → `store.set(nextTier)`; dismiss → record `suggestion_dismissed_at`; `aria-live=polite`.                                                                                                                                                                                                                                                                                     |
| `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityTierSelector.svelte`                                            | CREATE             | Segmented tier control (`aria-pressed`) + "Reset to simpler view" action for the `StickyCard` right slot; `onclick` sets/reset tier via context store.                                                                                                                                                                                                                                                                                                                       |
| `packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte`                                                       | UPDATE             | When `initialMode` not explicitly provided, derive default from tier context: `getComplexityTierContext()?` → `tierToDefaultMode(tier)`; existing per-section `basic/advanced` store stays the source of truth for render + override. FOUNDATIONAL (shared UI).                                                                                                                                                                                                              |
| `packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts` + `components/GeneralForm.svelte` | UPDATE             | Reference integration: call `loadSectionTiers(locals.user?.id, CUSTOM_FORMAT_KEYS)` in `load`; wrap the general section in `ComplexityTierProvider`; render `ComplexityTierSelector` + `ComplexityProgressionHint`. Proves end-to-end; broad rollout deferred to #11/#12.                                                                                                                                                                                                    |
| `scripts/test.ts`                                                                                                           | UPDATE             | Add a `complexity` test alias (mirror existing aliases) so `deno task test complexity` runs the new suite.                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/features/progressive-disclosure.md` (or new `docs/features/progressive-complexity.md`)                                | UPDATE/CREATE      | Document tier↔mode relationship, reset behavior, progression suggestions, anonymous/AUTH=off defaults.                                                                                                                                                                                                                                                                                                                                                                       |

## NOT Building

- **Full #12 Setup Wizard** — separate feature; this only lays the tier foundation it consumes.
- **Rollout to all ~15 existing route families** — one reference integration (custom-formats general) only; per-route tiering is Phase 2/3 of #11/#12.
- **ML / statistical / behavioral-model progression** — progression is a single deterministic activity-counter + threshold rule, not a learned model or analytics pipeline.
- **Generic tier plugin/registry/strategy abstraction** — tiers are a fixed 3-value union + simple map (rule-of-three not met); no pluggable registry.
- **Changing/extending the `basic|advanced` mode enum** — tier is additive; mode stays 2-valued to avoid breaking the 4 lockstep contract sites (`sectionKeys.ts`, migration CHECK, runtime validators, generated `v1.d.ts`).
- **Forced/automatic tier promotion** — issue #29 mandates "never forced"; suggestions only, user-confirmed.
- **Anonymous / AUTH=off / API-key (`user_id=0`) tier persistence** — deterministic default tier + defaults only, zero DB writes (mirrors existing disclosure anonymous behavior).
- **Cross-device realtime sync, expand-all/collapse-all, deep-linking, keyboard shortcuts, badges, analytics dashboards, admin/org-wide global tier policy** — out of scope for the foundation.
- **A new `$ui` theming/token subsystem** — reuse `AdvancedSection`/`DisclosureSection` primitives; no new design-token system.

---

## Step-by-Step Tasks

### Task 1.1: Shared tier contract — Depends on [none]

- **BATCH**: B1
- **ACTION**: Create `packages/praxrr-app/src/lib/shared/complexity/tiers.ts`.
- **IMPLEMENT**: Export `COMPLEXITY_TIERS = ['beginner','intermediate','advanced'] as const`, `type ComplexityTier`, `type SectionTierMap = Partial<Record<SectionKey, ComplexityTier>>`, and `tierToDefaultMode(tier): UiPreferenceMode` (`advanced`→`'advanced'`, else `'basic'`). Re-export/import `SectionKey`, `SECTION_KEY_PATTERN`, `SECTION_KEY_MAX_LENGTH` from `$shared/disclosure/sectionKeys.ts` — do not fork the regex.
- **MIRROR**: NAMING_CONVENTION (`sectionKeys.ts:10-14`).
- **IMPORTS**: `import { SECTION_KEY_PATTERN, SECTION_KEY_MAX_LENGTH, type SectionKey, type UiPreferenceMode } from '$shared/disclosure/sectionKeys.ts';`
- **GOTCHA**: Keep tier a fixed union; do NOT build a registry. Intermediate maps to `'basic'` default (differs from beginner via guidance/progression behavior, not raw disclosure default).
- **VALIDATE**: `deno task check:server` passes; `tierToDefaultMode('advanced') === 'advanced'`.

### Task 1.2: DB migration + registration — Depends on [none]

- **BATCH**: B1
- **ACTION**: Create `migrations/<version>_create_user_complexity_tiers.ts` and register it in `migrations.ts`.
- **IMPLEMENT**: `export const migration: Migration = { version, name, up, down }`. `up` creates `user_complexity_tiers` (columns per Files to Change), `tier TEXT NOT NULL CHECK (tier IN ('beginner','intermediate','advanced'))`, counters `INTEGER NOT NULL DEFAULT 0 CHECK (... >= 0)`, `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`, unique index `(user_id, section_key)` + lookup index on `user_id`. `down` drops indexes then table. Add the static import and `loadMigrations()` array entry.
- **MIRROR**: REPOSITORY_PATTERN migration (`050_create_user_interface_preferences.ts:7-31`); registration (`migrations.ts:54,350,366`).
- **IMPORTS**: `import type { Migration } from '../migrations.ts';`
- **GOTCHA**: Determine the next version from the current max (date-based `YYYYMMDD`, latest observed `20260228`; today → `20260706`). Verify no same-day collision; you MUST add BOTH the import and the array entry or the table won't exist at runtime.
- **VALIDATE**: Fresh DB init runs the migration; `deno task check:server` passes; `PRAGMA table_info(user_complexity_tiers)` shows all columns/constraints.

### Task 1.3: OpenAPI contract + regenerate types — Depends on [none]

- **BATCH**: B1
- **ACTION**: Add the `/complexity-tiers` contract to `docs/api/v1/openapi.yaml`, then regenerate `v1.d.ts`.
- **IMPLEMENT**: Add `get` (query `section_key`, `strict`) + `patch` (body `section_key`, `tier`, optional `expected_updated_at`) with `operationId`s, mirroring `/ui-preferences` (openapi.yaml:41-148). Add schemas `ComplexityTier` (enum beginner/intermediate/advanced), `ComplexityTierRecord`, `ComplexityTierUpsertRequest`; reuse existing `UiSectionKey`. Response codes 400/401/404/409/429/500. Run `deno task generate:api-types`.
- **MIRROR**: SERVICE_PATTERN OpenAPI (`openapi.yaml:41-148,680-723`).
- **IMPORTS**: N/A (spec + generated types).
- **GOTCHA**: Do NOT hand-edit `v1.d.ts`; only regenerate. Keep the enum in lockstep with `tiers.ts` (1.1) and the migration CHECK (1.2).
- **VALIDATE**: `deno task generate:api-types` produces `components['schemas']['ComplexityTier']`; `git diff` shows only additive generated changes.

### Task 2.1: Tier queries module — Depends on [1.1, 1.2]

- **BATCH**: B2
- **ACTION**: Create `packages/praxrr-app/src/lib/server/db/queries/user_complexity_tiers.ts`.
- **IMPLEMENT**: `userComplexityTiersQueries` const object mirroring `userInterfacePreferencesQueries`: `UserComplexityTier`/`...Row`/`...Input` types, `rowToTier`, `assertSectionKey`, `getByUserIdAndSectionKey`, `getByUserId`, idempotent `upsert` (app-set ISO `updated_at`, no-op when unchanged), `incrementActivity(userId, sectionKey, {interaction?, advancedToggle?})` (clamp to `>=0`, bounded max), `reset(userId, sectionKey)` (set tier `'beginner'`, leave any `user_interface_preferences.mode` untouched).
- **MIRROR**: REPOSITORY_PATTERN (`user_interface_preferences.ts:29-123`).
- **IMPORTS**: `import { db } from '../db.ts';` + tier types from `$shared/complexity/tiers.ts`.
- **GOTCHA**: Parameterized `?` placeholders only; every query scoped by `user_id`; re-assert section key at the DB layer (defense in depth).
- **VALIDATE**: `deno task check:server`; unit test for upsert idempotency + `incrementActivity` clamping (added in 8.2).

### Task 3.1: SSR tier loader — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: Create `packages/praxrr-app/src/lib/server/complexity/loadSectionTiers.ts`.
- **IMPLEMENT**: `loadSectionTiers<K extends SectionKey>(userId, keys): Record<K, ComplexityTier>` — pre-fill all keys to `'beginner'`; if `!userId` return defaults; overlay persisted tiers via `userComplexityTiersQueries.getByUserIdAndSectionKey`, per-key try/catch warn-and-continue.
- **MIRROR**: SERVICE_PATTERN loader (`loadSectionModes.ts:9-39`).
- **IMPORTS**: `userComplexityTiersQueries`, tier types.
- **GOTCHA**: Anonymous/no-user path must perform zero DB reads and return deterministic defaults.
- **VALIDATE**: Unit test mirroring `loadSectionModes.test.ts` (defaults when no user; overlay when persisted).

### Task 3.2: Tier API route — Depends on [2.1, 1.3]

- **BATCH**: B3
- **ACTION**: Create `packages/praxrr-app/src/routes/api/v1/complexity-tiers/+server.ts`.
- **IMPLEMENT**: Clone `ui-preferences/+server.ts`. `GET`: 401 if no user; parse+validate `section_key`; return persisted or default record (`strict=true`→404 on miss). `PATCH`: 401 gate; guard `locals.user.id > 0` (API-key synthetic id=0 → return default, no write); JSON body guard→400; validate `section_key` + `tier` enum allow-list→400; optimistic concurrency via `expected_updated_at`→409; per-`(userId:sectionKey)` sliding-window rate limit→429; generic 500 (log detail server-side only).
- **MIRROR**: SERVICE_PATTERN + ERROR_HANDLING (`ui-preferences/+server.ts:40-42,158-320`).
- **IMPORTS**: `json` from `@sveltejs/kit`, `userComplexityTiersQueries`, tier types.
- **GOTCHA**: Do not leak raw SQL/`error.message` in 500 responses. Increment activity counters through a bounded path only.
- **VALIDATE**: Route test (in-memory fixture) covering 401, per-user isolation, default-on-miss, strict 404, invalid tier/key 400, 409, 429.

### Task 4.1: Client tier store — Depends on [1.1, 3.2]

- **BATCH**: B4
- **ACTION**: Create `packages/praxrr-app/src/lib/client/stores/userComplexityTiers.ts`.
- **IMPLEMENT**: Clone `userInterfacePreferences.ts` retargeted to `/api/v1/complexity-tiers` and `ComplexityTier`: per-section `writable`, `DEBOUNCE_MS=300`, `RETRY_DELAYS_MS=[300,600,1200]`, inflight coalescing, optimistic rollback, `expected_updated_at`, 401 → `authRequired` + cache clear, refCount cleanup. Export `getUserComplexityTierSectionStore(key, defaultTier='beginner')`, singleton, and `clearOnAuthChange`.
- **MIRROR**: `userInterfacePreferences.ts:1-465` (reuse the sync engine wholesale).
- **IMPORTS**: `browser` from `$app/environment`, `alertStore` from `$alerts/store`, `writable/get` from `svelte/store`, tier types.
- **GOTCHA**: Runtime type-guard responses before trusting; wire `clearOnAuthChange` to the same auth-change surface the disclosure store expects (note: existing `clearOnAuthChange` has no caller yet — do not regress, expose the hook).
- **VALIDATE**: `deno task check:client`; store subscribes/persists against a mocked endpoint.

### Task 5.1: $ui tier context module — Depends on [4.1]

- **BATCH**: B5
- **ACTION**: Create `packages/praxrr-app/src/lib/client/ui/complexity/complexityTierContext.ts`.
- **IMPLEMENT**: A `Symbol` context key + `setComplexityTierContext(value)` / `getComplexityTierContext(): ComplexityTierContext | undefined` helpers (graceful fallback when no provider). Context value exposes the active section tier store + `tierToDefaultMode`.
- **MIRROR**: $ui CONTEXT (`CardGrid.svelte` / `Card.svelte`).
- **IMPORTS**: `setContext, getContext` from `svelte`; tier store + `tierToDefaultMode`.
- **GOTCHA**: `setContext` must be called at component init (in the provider's `<script>`), never in async/callbacks. Context is per-request → never store a module singleton for tier state.
- **VALIDATE**: `deno task check:client`; consumer without a provider returns `undefined` and does not throw.

### Task 6.1: ComplexityTierProvider + Selector — Depends on [4.1, 5.1]

- **BATCH**: B6
- **ACTION**: Create `ComplexityTierProvider.svelte` and `ComplexityTierSelector.svelte` under `$ui/complexity/`.
- **IMPLEMENT**: Provider takes `sectionKey` + `initialTier`, wires `getUserComplexityTierSectionStore`, calls `setComplexityTierContext(...)`, renders `<slot/>`. Selector renders a segmented control (`aria-pressed`) + a "Reset to simpler view" button; `onclick` sets tier / triggers reset via the context store. Svelte 5 no-runes (stores + `$:`).
- **MIRROR**: $ui CONTEXT provider (`CardGrid.svelte`); a11y button patterns (`AdvancedSection.svelte:32-41`).
- **IMPORTS**: context helpers, tier store, `COMPLEXITY_TIERS`.
- **GOTCHA**: Tier change / reset must NOT set the form dirty state (visibility-only). Reset is tier-only; do not clear per-section `mode` overrides.
- **VALIDATE**: `deno task check:client` + `deno task lint`; keyboard-focusable, `aria-pressed` reflects active tier.

### Task 6.2: ComplexityProgressionHint — Depends on [4.1, 5.1]

- **BATCH**: B6
- **ACTION**: Create `packages/praxrr-app/src/lib/client/ui/complexity/ComplexityProgressionHint.svelte`.
- **IMPLEMENT**: Subscribe to activity counters / `last_suggested_tier`; when the threshold is crossed and not already dismissed, show a dismissible `aria-live=polite` banner (or `alertStore.add('info', …)`); accept → `store.set(nextTier)`; dismiss → persist `suggestion_dismissed_at`. Never a modal; never auto-switch.
- **MIRROR**: alert usage (`userInterfacePreferences.ts:325-328`), a11y (`AdvancedSection.svelte`).
- **IMPORTS**: tier store/context, `alertStore`.
- **GOTCHA**: Threshold is a simple constant (e.g. `ADVANCED_TOGGLES_BEFORE_SUGGEST = 5`) — flagged `ASSUMPTION`; keep deterministic. Respect prior dismissal so it is not re-shown aggressively.
- **VALIDATE**: `deno task check:client`; below threshold → no hint; at threshold (not dismissed) → hint appears; dismissal suppresses re-show.

### Task 7.1: DisclosureSection tier-default integration — Depends on [5.1, 1.1]

- **BATCH**: B7
- **ACTION**: Update `packages/praxrr-app/src/lib/client/ui/form/DisclosureSection.svelte`.
- **IMPLEMENT**: When the caller does not pass an explicit `initialMode`, read the tier from `getComplexityTierContext()` and derive the default via `tierToDefaultMode(tier)`; fall back to `'basic'` when no provider. The per-section `basic/advanced` store remains the source of truth for render + manual override.
- **MIRROR**: $ui CONTEXT consumer (`Card.svelte`); existing prop wiring (`DisclosureSection.svelte:7-14`).
- **IMPORTS**: `getComplexityTierContext`, `tierToDefaultMode`.
- **GOTCHA**: This is a shared UI file used by ~15 routes — an explicit `initialMode` prop MUST still win, and no-provider behavior MUST be identical to today (`'basic'`). Preserve `onDestroy` cleanup.
- **VALIDATE**: Existing disclosure e2e (`2.50-progressive-disclosure.spec.ts`) still passes; with an `advanced` tier provider and no explicit `initialMode`, the section defaults to advanced.

### Task 8.1: Reference integration (custom-formats general) — Depends on [3.1, 6.1, 6.2, 7.1]

- **BATCH**: B8
- **ACTION**: Update `custom-formats/[databaseId]/[id]/general/+page.server.ts` + `components/GeneralForm.svelte`.
- **IMPLEMENT**: In `load`, add `loadSectionTiers(locals.user?.id, CUSTOM_FORMAT_KEYS)` alongside the existing `loadSectionModes` and return it. In the form, wrap the general sections in `ComplexityTierProvider`, render `ComplexityTierSelector` in the sticky header slot and `ComplexityProgressionHint` inline. Let existing `DisclosureSection` pick up tier defaults (drop explicit `initialMode` where tier should drive it).
- **MIRROR**: loader→page wiring (`custom-formats/.../general/+page.server.ts:48-55`); consumer defaults (`GeneralForm.svelte:211,232,253`).
- **IMPORTS**: `loadSectionTiers`, `ComplexityTierProvider/Selector`, `ComplexityProgressionHint`, `CUSTOM_FORMAT_KEYS`.
- **GOTCHA**: Only this one route in the foundation PR — do not sweep all routes. Keep the existing per-section override behavior intact.
- **VALIDATE**: Manual + e2e: switching tier changes the section default; reset returns to beginner; manual Show/Hide still overrides.

### Task 8.2: Tests, alias, and docs — Depends on [2.1, 3.1, 3.2, 4.1, 6.1, 6.2, 7.1]

- **BATCH**: B8
- **ACTION**: Add unit + route + e2e tests, register the `complexity` test alias, and update docs.
- **IMPLEMENT**: (a) `tests/complexity/loadSectionTiers.test.ts` (mirror `loadSectionModes.test.ts`); (b) `tests/complexity/userComplexityTiersQueries.test.ts` (upsert idempotency, `incrementActivity` clamping, `reset`); (c) `tests/routes/complexityTiersApi.test.ts` (mirror `uiPreferencesApi.test.ts` in-memory fixture: 401, isolation, default-on-miss, strict 404, invalid tier/key 400, 409, 429, id=0 no-persist); (d) e2e `tests/e2e/specs/2.51-progressive-complexity.spec.ts` (tier switch → section default; reset); (e) add `complexity` alias in `scripts/test.ts`; (f) update `docs/features/progressive-disclosure.md` (or new `progressive-complexity.md`) + `docs/api/endpoints.md`.
- **MIRROR**: TEST_STRUCTURE (`loadSectionModes.test.ts`, `uiPreferencesApi.test.ts`, `2.50-progressive-disclosure.spec.ts`).
- **IMPORTS**: `assertEquals` from `@std/assert`; handlers imported directly from `+server.ts`.
- **GOTCHA**: e2e requires a running server + auth (`ensureAuthenticated`); gate with `test.skip` when unavailable, like the existing spec. Seed state through the real PATCH endpoint.
- **VALIDATE**: `deno task test complexity` green; `deno task test` shows no regressions; `deno task test:e2e` passes (or skips) the new spec.

---

## Testing Strategy

### Unit Tests

| Test                       | Input                                        | Expected Output                                    | Edge Case? |
| -------------------------- | -------------------------------------------- | -------------------------------------------------- | ---------- |
| `loadSectionTiers` no user | `userId=undefined`, keys                     | all keys → `'beginner'`, zero DB reads             | Yes        |
| `loadSectionTiers` overlay | persisted `advanced` for one key             | that key `'advanced'`, others `'beginner'`         | No         |
| `upsert` idempotency       | same tier twice                              | second call is a no-op (unchanged `updated_at`)    | Yes        |
| `incrementActivity` clamp  | negative / overflow input                    | clamped to `[0, MAX]`, never negative              | Yes        |
| `reset`                    | section with tier `advanced` + mode override | tier→`beginner`; `mode` override untouched         | Yes        |
| `tierToDefaultMode`        | each tier                                    | advanced→`advanced`, beginner/intermediate→`basic` | No         |

### Route Tests (in-memory fixture, mirror `uiPreferencesApi.test.ts`)

- 401 for anonymous GET/PATCH; zero writes.
- Per-user isolation (user A cannot read/write user B).
- Default record on first visit; `strict=true` → 404.
- Invalid `tier` enum → 400; invalid/oversized `section_key` → 400.
- Optimistic concurrency: stale/null `expected_updated_at` → 409.
- Rate limit → 429.
- API-key synthetic `user.id === 0` → no persist, returns default.

### Edge Cases Checklist

- [ ] Anonymous / AUTH=off / AUTH=local (null user) → defaults, no writes, no 500
- [ ] API-key user (`id=0`) → no persist, no FK 500
- [ ] Concurrent manual tier set vs automatic-progression write → 409, no lost update
- [ ] SSR first paint shows correct tier (no basic→advanced flash)
- [ ] Tier store cleared on logout / auth-identity change
- [ ] Explicit `initialMode` prop on `DisclosureSection` still wins over tier default
- [ ] Reduced-motion respected on tier selector / hint

---

## Validation Commands

### Static Analysis

```bash
deno task check
```

EXPECT: Zero type errors (server `deno check` + client `svelte-check`).

### Lint / Format

```bash
deno task lint
```

EXPECT: Prettier + ESLint clean (tabs, single quotes, no trailing commas, 100-char).

### Unit Tests (feature)

```bash
deno task test complexity
```

EXPECT: All new complexity unit/route tests pass.

### Full Test Suite

```bash
deno task test
```

EXPECT: No regressions — existing `disclosure` + `ui-preferences` tests still green.

### API Types (contract)

```bash
deno task generate:api-types
```

EXPECT: `v1.d.ts` regenerated with `ComplexityTier` schemas; `git diff` additive only.

### Database Validation

```bash
deno task dev:server   # first run applies migrations
```

EXPECT: `user_complexity_tiers` table created; `PRAGMA table_info` shows CHECK/FK/index; `user_interface_preferences` unchanged.

### Browser / E2E Validation

```bash
deno task test:e2e     # requires running server
```

EXPECT: New `2.51-progressive-complexity` spec passes (or skips cleanly without auth); `2.50-progressive-disclosure` still passes.

### Manual Validation

- [ ] On the custom-formats general page: switch tier Beginner → Advanced; sections default-expand.
- [ ] Manually toggle a single section; that override persists over the tier default.
- [ ] Trigger the progression suggestion (cross the toggle threshold); confirm it is dismissible and never forces a switch.
- [ ] Reset to simpler view; tier returns to beginner; manual `mode` overrides remain.

---

## Acceptance Criteria

- [ ] Three tiers `beginner | intermediate | advanced` exist as a shared fixed union and are persisted per-user, per-section in `user_complexity_tiers`.
- [ ] Tier drives each section's **default** disclosure mode via `tierToDefaultMode`; the existing per-section `basic/advanced` `mode` remains the render source of truth and manual override.
- [ ] Per-section granularity: a user can be `advanced` in one section and `beginner` in another simultaneously.
- [ ] Automatic progression: after a deterministic activity threshold, a **non-intrusive, dismissible** suggestion appears; it never auto-switches and is never a modal.
- [ ] Reset returns a section to a simpler tier without silently discarding per-section `mode` overrides.
- [ ] `$ui` exposes the active tier as a first-class concept via Svelte context (`ComplexityTierProvider` → `DisclosureSection` consumer).
- [ ] The existing `basic/advanced` disclosure system is unchanged (enum still 2-valued; `2.50` e2e + `ui-preferences` route tests green).
- [ ] Every tier read/write/reset query is scoped by authenticated `locals.user.id`; user A cannot access user B's tier state.
- [ ] Anonymous / AUTH=off / AUTH=local (null user) requests return 401 with safe defaults and perform zero DB writes.
- [ ] API-key synthetic user (`id=0`) never persists tier state and never surfaces an FK 500.
- [ ] `tier` validated against the enum at the endpoint AND enforced by DB `CHECK`; `section_key` reuses `SECTION_KEY_PATTERN` + max length at endpoint and re-asserted in the query layer.
- [ ] Activity counters are clamped non-negative + bounded; writes are rate-limited per `(user_id, section_key)`.
- [ ] Concurrent writes use `expected_updated_at` optimistic concurrency (mismatch → 409); tier store clears on auth change.
- [ ] All new SQL is parameterized; 500 responses do not leak internal SQL/error detail.
- [ ] `deno task test`, `deno task lint`, `deno task check` all pass.

## Completion Checklist

- [ ] Code follows discovered patterns (repository / route / store / migration mirrors)
- [ ] Error handling matches codebase style (401-first, typed parser throws → 400, 409/429)
- [ ] Tests follow test patterns (Deno.test, in-memory route fixture, Playwright e2e)
- [ ] No hardcoded values beyond documented threshold constants (flagged as ASSUMPTION)
- [ ] Tier→mode-default mapping and per-section granularity documented before implementation
- [ ] Tier enum kept in lockstep across `tiers.ts`, migration `CHECK`, runtime validators, and regenerated `v1.d.ts`
- [ ] New migration created with date-based `YYYYMMDD_` name AND registered in `migrations.ts` (import + array entry)
- [ ] `deno task generate:api-types` re-run and regenerated `v1.d.ts` committed
- [ ] `seedBuiltInBaseOps.ts` confirmed **N/A** (app-DB state, not PCD base ops); `generate:pcd-types` **N/A** (PCD schema unchanged)
- [ ] Existing basic/advanced disclosure still passes (`loadSectionModes.test.ts` + `ui-preferences` route tests + `2.50` e2e)
- [ ] Anonymous / AUTH=off path verified: deterministic default tier, zero writes, no 500s
- [ ] SSR hydration verified on the reference section: correct first paint, no flash
- [ ] New tier store clears on auth change
- [ ] `docs/features/*` + `docs/api/endpoints.md` updated with tier↔mode relationship and reset behavior
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk                                                                                                             | Likelihood | Impact | Mitigation                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two overlapping concepts (3-tier vs 2-mode) confuse users AND devs; unclear which wins                           | High       | High   | Tier is a defaults-driver only; `mode` stays the single render source of truth; document the relationship explicitly; manual `mode` override always beats tier default                    |
| Intermediate tier has no distinct render in the 2-mode component → ambiguous state                               | High       | Med    | Locked in this plan: beginner/intermediate → `basic` default; tiers differ via guidance/progression, not raw disclosure. Revisit only if a distinct intermediate render is later required |
| Contract drift: tier added to OpenAPI/`v1.d.ts` but not runtime validators (or vice-versa) across lockstep sites | Med        | High   | Define tier in shared `tiers.ts`; update OpenAPI + regen `v1.d.ts` + runtime guards + migration `CHECK` in one change; add a round-trip route test                                        |
| IDOR / broken per-user isolation on tier read/write/reset                                                        | Med        | High   | Scope every query by `locals.user.id`; unique index `(user_id, section_key)`; route + query defense-in-depth validation                                                                   |
| API-key synthetic `user_id=0` INSERT violates FK → 500                                                           | Med        | Med    | Guard `user.id > 0` before any write; treat id=0 as no-persist (return defaults)                                                                                                          |
| Activity-counter write amplification / DoS on high-frequency actions                                             | Med        | Med    | Clamp + bound counters; DB `CHECK`; reuse per-`(user,section)` rate limit; batch/idempotent increments                                                                                    |
| SSR hydration mismatch → flash of wrong complexity on first paint                                                | Med        | Med    | `loadSectionTiers(locals.user?.id, keys)` in `+page.server.ts`; seed store from SSR value                                                                                                 |
| Migration not registered in `migrations.ts` (import + array) → table missing at runtime                          | Low        | High   | Add BOTH edits; verify on fresh DB init                                                                                                                                                   |
| "Design before Phase 2" sequencing: ambiguous tier→mode contract bakes rework into future routes                 | Med        | High   | Freeze tier→mode mapping + granularity here; validate on the single reference section first                                                                                               |
| Reset silently discards explicit per-section overrides → feels like data loss                                    | Med        | Low    | Reset is tier-only; do NOT clear `mode` overrides; document behavior                                                                                                                      |
| Cross-user cache leakage: tier store retains prior user's tier after logout                                      | Med        | High   | Mirror `clearOnAuthChange` + 401 → clear cache                                                                                                                                            |

## Notes

- **Confidence Score: 8/10.** The recommended "layer on top of the existing primitive" direction is HIGH confidence — the `basic|advanced` enum is hardcoded in 4 lockstep sites, so mutating it is expensive and unnecessary; prior research (`docs/plans/enhance-progressive-disclosure/research-recommendations.md`) already scoped a Beginner/Intermediate/Advanced profile. The remaining 2 points of uncertainty are the intentionally-frozen design decisions below.
- **Key architectural decision (issue #29 is the foundation for an ALREADY-shipped #11):** Praxrr already ships a full 2-mode per-section progressive-disclosure system (migration `050`, queries, `/api/v1/ui-preferences`, client store, `DisclosureSection`/`AdvancedSection`, ~15 route integrations, docs + e2e). This plan **extends** it with a tier layer rather than replacing it. Alternative rejected: changing `UI_PREFERENCE_MODES` to a 3-value enum (breaking migration + API contract + store + ~15 consumers).
- **Frozen decisions (were flagged under-specified by research; resolved here):**
  1. **Granularity** = per-user, per-**section-key** tier (honors "advanced in one area, beginner in another" literally + reuses the existing 3-token key format).
  2. **tier→default mode** = `advanced`→`advanced`, `beginner`/`intermediate`→`basic`; tiers differ via guidance/progression surfaces, not raw disclosure default.
  3. **Reset** = tier-only (back to `beginner`); does not clear `mode` overrides.
  4. **API-key `user_id=0`** = no-persist (defaults only).
  5. **Query file naming** = snake_case `user_complexity_tiers.ts` (mirror the disclosure sibling; deliberate exception to the dominant camelCase).
  6. **Tier count** = 3 (per issue #29). Note: research `innovation.md` H6 mentions 4 tiers — the issue's 3-tier contract wins.
- **ASSUMPTIONS to confirm during implementation:** progression threshold value (e.g. `ADVANCED_TOGGLES_BEFORE_SUGGEST = 5`); exact suggestion surface (inline banner vs `info` toast); whether the tier selector is per-page or global for the reference integration (plan assumes per-page/per-provider).
- **Research artifacts:** full per-researcher discovery tables are in `docs/prps/plans/.prp-research/progressive-complexity-architecture/` (api, business, tech-designer, ux, security, practices, recommendations).
- **Research dispatch:** Enhanced (7 standalone researchers, parallel). **Execution mode:** Parallel (8 batches, max width 3). **Worktree mode:** Disabled via `--no-worktree`.
