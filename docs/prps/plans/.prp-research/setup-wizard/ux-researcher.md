## UX Design

Route-based `/setup/` 6-step guided first-run flow that replaces self-directed discovery of the empty dashboard. All primitives already exist; the wizard is presentation/orchestration only.

### Before

- First-run user lands on a mostly-empty dashboard (`packages/praxrr-app/src/routes/+page.svelte`) with no guided path.
- User must self-discover the correct order-of-operations, hopping between three unconnected routes:
  1. `packages/praxrr-app/src/routes/arr/new/` → add Arr instance (form: `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte`, `mode="create"`; connection test POSTs to `packages/praxrr-app/src/routes/arr/test/+server.ts`).
  2. `packages/praxrr-app/src/routes/databases/new/` → link a PCD (form: `packages/praxrr-app/src/routes/databases/components/InstanceForm.svelte`).
  3. `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte` → select profiles + preview + sync.
- No cross-step continuity, no resume, no progress signal; `arr_type`/URL/key re-entered manually; sequencing knowledge lives outside the product (drives 80%+ abandonment).

### After

- Single linear `/setup/` route group; server-authoritative current step (persisted in `setup_state`), resumable after tab close.
- Steps: **welcome → connect-arr → link-database → select-profiles → preview-sync → done**, each `routes/setup/<step>/+page.svelte` under a shared `+layout.svelte` stepper shell.
- Horizontal 6-step stepper (desktop) collapsing to "Step X of 6" counter (existing Tailwind breakpoint); Next/Back below content; Back always enabled except after sync fires.
- **connect-arr** embeds `InstanceForm.svelte (mode="create")` with inline connection-test state machine: idle → testing (spinner <2s) → success ("Connected to Radarr 5.x") → fail, with distinct copy for **unreachable** (error on URL field) vs **bad key / reachable-but-rejected** (error on API-key field). Advance only on green.
- **link-database** pre-selects default `Praxrr-DB`; custom source behind collapsed disclosure; detects env/boot auto-link and shows "already linked" instead of re-prompting.
- **select-profiles** pre-checks a recommended baseline (if PCD defines one), filtered strictly by target `arr_type`; explicit empty state (`$ui/state/EmptyState.svelte`) for zero compatible profiles, never a blank list.
- **preview-sync** reuses #7 dry-run render (`SyncPreviewPanel.svelte`/`SyncPreviewTrigger.svelte`/`SyncPreviewEntityDiff.svelte`); distinct terminal states for zero-change ("already matches") vs compute-fail. Terminal success marks `wizard_completed`.
- **Skip** is a de-emphasized-but-visible one-click action on every step (sets `wizard_dismissed_at`), reversible via Settings + a dismissable "Finish setup" banner on `/`.

### Interaction Changes

| Touchpoint                | Before                                      | After                                                                                                                                             | Notes / Accessibility                                                                                                                      |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry after `/auth/setup` | Empty dashboard, no next-action             | Redirect to `/setup/<current-step>` via `hooks.server.ts` gate (page-nav only, never `/api/*`); reverse-gate sends done/skipped users back to `/` | Per-step page title includes progress ("Connect Arr Instance — Step 2 of 6"); title announced first by screen readers                      |
| Progress signal           | None across the 3 routes                    | Persistent 6-step stepper (desktop) / "Step X of 6" (mobile)                                                                                      | Progress conveyed via title + heading text, not color alone; do NOT reuse `$ui/navigation/tabs` (section nav, invites invalid jumps)       |
| Add Arr instance          | Manual visit to `/arr/new`                  | `/setup/connect-arr` embeds `arr/components/InstanceForm.svelte (mode="create")`                                                                  | Focus moves to step heading/first field on every Next/Back (explicit activation, never a focus event)                                      |
| Connection test           | Button in isolated form; generic pass/fail  | Inline idle/testing/success/fail; unreachable-vs-bad-key differentiated copy; debounce typing-retest 500ms–1s                                     | Async result announced via ARIA live region ("Testing…" → "Connected"/"Failed: invalid API key"); error moves focus to first invalid field |
| Link PCD DB               | Manual visit to `/databases/new`; full form | `/setup/link-database` reusing `databases/components/InstanceForm.svelte`; default pre-selected, custom collapsed; detects boot/env auto-link     | Labeled indeterminate state if clone >~3s ("Cloning Praxrr-DB…"); non-git/local-path gets distinct failure copy, no 500                    |
| Select profiles/CFs       | Blank multi-select on `/arr/[id]/sync`      | `/setup/select-profiles`: pre-checked baseline, `arr_type`-scoped; explicit empty state                                                           | `$ui/state/EmptyState.svelte`; validate compatible names before submit; pessimistic advance                                                |
| Preview & apply           | Same route, buried below selection          | `/setup/preview-sync` reusing #7 diff components; dry-run framing, explicit confirm                                                               | Mobile-safe stacked/scroll diff; zero-change vs fail visually distinct; staged microcopy if >~3s; no "Done" until sync confirmed           |
| Exit / skip               | Nothing to skip (no flow)                   | One-click Skip every step; dashboard "Finish setup" banner; re-run from Settings                                                                  | No wizard session timeout (state server-side; WCAG 2.2.1); respect reduced motion; keyboard + one screen-reader pass before ship           |

**Reused UI primitives (cite):** `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte` (Arr connect, has built-in `testConnection()` + `testing` flag + `mode` prop), `packages/praxrr-app/src/routes/databases/components/InstanceForm.svelte` (DB link), `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte` + `SyncPreviewTrigger.svelte` + `SyncPreviewEntityDiff.svelte` (preview/diff), `$ui/button/Button.svelte`, `$ui/modal/Modal.svelte` + `DirtyModal.svelte`, `$ui/form/FormInput.svelte` + `NumberInput.svelte`, `$ui/badge/Badge.svelte`, `$ui/table/Table.svelte` + `ExpandableTable.svelte`, `$ui/card/StickyCard.svelte`, `$ui/state/EmptyState.svelte`. **New primitive needed:** a stepper component (`$ui/navigation/tabs` is section nav, explicitly not a stepper).
