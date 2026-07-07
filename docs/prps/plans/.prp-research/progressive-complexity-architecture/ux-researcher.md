## UX Design

### Before

Today a new user lands on a config page and sees every section already rendered; each section that
has extra controls exposes a per-section text toggle. No tier concept, no guidance, no reset.

```
StickyCard [ title/description | Delete  Save(disabled until dirty) ]   MediaSettingsForm.svelte:139-162
──────────────────────────────────────────────────────────────────
Basic Info (always visible)                                            MediaSettingsForm.svelte:168-179
──────────────────────────────────────────────────────────────────
Naming            [ Show Advanced ▾ ]   ← per-section, basic default   AdvancedSection.svelte:63-78
Folder Management [ Show Advanced ▾ ]   aria-expanded / aria-controls  AdvancedSection.svelte:67-68
Importing         [ Show Advanced ▾ ]   loads 'basic' each visit       DisclosureSection.svelte:10
```

- Mode vocabulary is binary only: `basic | advanced` (`sectionKeys.ts:12-14`, `userInterfacePreferences.ts:96-98`).
- Per-section mode persists per user, debounced PATCH `/api/v1/ui-preferences` (`userInterfacePreferences.ts:388-397`).
- No page-level or app-level control; no progression prompt; no "reset to simpler view".

### After

Tier orchestration wraps the existing primitive. A tier sets each section's default mode; the
Show/Hide Advanced control still works as a per-section override. A subtle, dismissible progression
suggestion appears after tracked actions; a reset control returns to a simpler tier.

```
StickyCard [ title | Tier: (Beginner)(Intermediate)(Advanced) ⟲Reset | Save ]  NEW selector, right slot
── inline suggestion banner (dismissible, aria-live=polite) ─────────  NEW, only when eligible
"Opening lots of advanced options — switch to Advanced tier?" [Switch][Not now ✕]
──────────────────────────────────────────────────────────────────
Basic Info (always visible)
Naming            [ Hide Advanced ▴ ]   ← tier=Advanced pre-expands    tier→initialMode default
Folder Management [ Show Advanced ▾ ]   ← per-section override wins     unchanged primitive
```

- Beginner = guided/preset, sections collapsed; Intermediate = today's behavior; Advanced = all pre-expanded.
- Suggestion surface is non-blocking (inline banner OR toast via `alertStore.add`, `store.ts:19-35`), never a modal.
- Per-section override still writes the existing section key; tier only changes the default (`DisclosureSection.svelte:10`).

### Interaction Changes

| Touchpoint                       | Before                                                                                                                                               | After                                                                                                             | Notes                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Tier selector placement          | None                                                                                                                                                 | Segmented control in `StickyCard` right slot alongside Save (`MediaSettingsForm.svelte:144-161`)                  | Global/per-page; keyboard-focusable segmented buttons, `aria-pressed` per tier                       |
| Default landing state (new user) | All sections render, each `basic` by default (`DisclosureSection.svelte:10`, `progressive-disclosure.md:19`)                                         | New users land in Beginner (collapsed + preset guidance); no forced walkthrough                                   | Preserve "loads basic by default"; tier just names/extends it                                        |
| Per-section advanced toggle      | `Show Advanced`/`Hide Advanced` text button, `aria-expanded`/`aria-controls`, slide 200ms (`AdvancedSection.svelte:35-41,63-93`)                     | Unchanged control; tier sets its starting mode, manual toggle overrides tier                                      | Composition: explicit per-section override beats tier default; do not remove text toggle             |
| Per-section tier override        | Only mode override (`basic`/`advanced`) persisted per section (`userInterfacePreferences.ts:388-397`)                                                | Same override remains authoritative; "advanced in one area, beginner in another" is the existing per-section mode | No new key format needed if override maps to existing mode                                           |
| Progression suggestion           | None                                                                                                                                                 | Subtle inline banner or toast after tracked actions (e.g. N manual `Show Advanced` in a session)                  | Must be dismissible + `aria-live=polite`; never a modal ("routes over modals"); never auto-switch    |
| Suggestion dismissal             | N/A                                                                                                                                                  | `Not now`/✕ dismiss; remembers dismissal so it is not re-shown aggressively                                       | Toasts auto-dismiss (`store.ts:28-32`); banner should stay until dismissed                           |
| Reset affordance                 | None                                                                                                                                                 | `Reset to simpler view` control near tier selector returns to Beginner/Intermediate and re-collapses sections     | Should also reset per-section overrides for that page/scope; confirm only if changes are destructive |
| Toast/alert surface reuse        | `alertStore.add('warning', …)` fixed overlay, top-center default, `z-50`, `max-w-sm`, auto-dismiss (`AlertContainer.svelte:20-34`, `store.ts:19-35`) | Reuse same surface for progression toasts; add `info` type for suggestions                                        | Sidebar-offset (`md:pl-80`) already handled by container                                             |
| Dirty-state / navigation         | `isDirty` + `beforeNavigate` warns via `DirtyModal` (`dirty.ts:46-49,104-114`, `DirtyModal.svelte:14-24`)                                            | Tier change / reset must NOT flip form dirty state (visibility-only, mirrors current toggle)                      | Preserve "toggling preserves form data" (`progressive-disclosure.md:22`)                             |
| Accessibility                    | Text actions, `aria-expanded`, `aria-controls`, `role=region`, reduced-motion respected (`AdvancedSection.svelte:29-30,67-93`)                       | Tier = focusable segmented buttons w/ `aria-pressed`; suggestion `aria-live=polite`; reset is a labeled button    | Keep text (not icon-only) actions; honor `prefers-reduced-motion`                                    |
| Persistence scope                | One `mode` per `section_key`, per user (`userInterfacePreferences.ts:212-240`)                                                                       | New tier value likely needs its own persisted preference (per user, maybe per route-family)                       | GAP: no existing tier field on `/api/v1/ui-preferences`; only `basic`/`advanced` mode                |

## Gaps

- GAP: `UiPreferenceMode` is strictly `'basic' | 'advanced'` (`sectionKeys.ts:12-14`); no third tier value exists — a tier needs a separate persisted field, not a third mode.
- GAP: No page-level or app-level disclosure control exists today; all state is per-section (`DisclosureSection.svelte`), so tier selector placement is net-new.
- GAP: No action-tracking/telemetry hook exists for "count of manual Show Advanced" to trigger progression suggestions — must be added client-side.
- GAP: No existing "reset to defaults" affordance for disclosure state; reset semantics (per-page vs global, whether it clears persisted overrides) are undefined.
- GAP: `$ui` design system has no tier prop/context primitive today; DisclosureSection/AdvancedSection take only `mode` (`AdvancedSection.svelte:26`).
