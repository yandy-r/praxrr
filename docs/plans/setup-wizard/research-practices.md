# Setup Wizard — Engineering Practices Research

## Executive Summary

Praxrr already has every functional building block a first-run wizard needs — instance
creation, database linking, quality-profile/custom-format selection, and a full read-only
preview/apply pipeline (#7) — as fully-formed, route-scoped features. None of it was built
as a "wizard." The single biggest risk for this feature is **rebuilding forms and
selection UI that already exist** instead of sequencing the user through the real routes.

The recommended shape: `/setup/*` is a thin **orchestration layer** — a step
tracker/progress shell plus a first-run redirect gate — that embeds two existing
components verbatim (`InstanceForm.svelte` x2) and, for the profile-selection and
preview/sync steps, **hands off to the existing `/arr/[id]/sync` route** rather than
re-implementing its ~600-line selection UI inside a wizard step. This keeps the wizard
small, avoids a second maintenance surface for sync-selection logic, and automatically
inherits any future improvements to `/arr/[id]/sync` and the sync-preview pipeline.

`setup_state` currently has exactly one purpose today — gating a startup auto-link, not
UI flow — so the wizard's "is setup complete" signal should be derived from existing
queries (`arrInstancesQueries.getAll()`, `databaseInstancesQueries.getAll()`) rather than
grown into a multi-flag state machine. See Open Questions for the one case (explicit
skip) that does need new persisted state.

## Existing Reusable Code

| Module / Location | Purpose | How the wizard should reuse it |
| --- | --- | --- |
| `packages/praxrr-app/src/routes/arr/components/InstanceForm.svelte` | Full create/edit form for Arr instances (type, name, URL, API key, test-connection, tags, capability warnings) | Import directly with `mode="create"` for the "Connect Arr Instance" step. Do not re-derive field logic — it already handles `$isDirty`/dirty-store init, `ARR_APP_OPTIONS`, capability messaging (`supportsArrWorkflow`/`supportsArrSyncSurface`), and the `/arr/test` connection-test call. |
| `packages/praxrr-app/src/routes/arr/new/+page.server.ts` (`actions.default`) | Validates + creates an Arr instance (name/type/URL/API-key required, duplicate-name/fingerprint checks, encryption, redirect to `/arr/{id}/settings`) | Wizard step's `+page.server.ts` should call the *same* validation/creation path. Either reuse this action verbatim (point the form at `/arr/new` and redirect back into the wizard afterward) or copy the action but change only the redirect target — do not re-derive the fingerprint/duplicate-check logic. |
| `$db/queries/arrInstances.ts` → `arrInstancesQueries` (`create`, `getAll`, `getEnabled`, `nameExists`) | Instance CRUD + existence checks | Use `getAll()`/`getEnabled()` to compute "has an Arr instance" wizard-completion state — do not add a new setup_state flag for this. |
| `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` (`getArrInstanceClient`, `createArrInstanceClientCache`) | Arr connectivity client factory used by sync/preview | Any wizard-side connection re-verification (if needed beyond the form's own Test Connection button) goes through this, never a new client. |
| `packages/praxrr-app/src/routes/databases/components/InstanceForm.svelte` | Full create/edit form for PCD database links (repo URL, branch, PAT, git identity, conflict/sync strategy) | Import directly with `mode="create"` for the "Link Database" step, same pattern as the Arr form. |
| `packages/praxrr-app/src/routes/databases/new/custom/+page.server.ts` / `databases/new/trash-guide/+page.server.ts` | Server actions for linking a custom PCD repo vs. a TRaSH Guides source | Wizard's "Link Database" step should present the same two choices `databases/new/+page.svelte` already offers (custom vs. TRaSH) rather than inventing a third path. |
| `$db/queries/databaseInstances.ts` → `databaseInstancesQueries` (`getAll`, `getEnabled`, `create`) | Database-link CRUD | `getAll()` drives "has a database linked" wizard-completion state. |
| `packages/praxrr-app/src/lib/server/db/queries/setupState.ts` → `setupStateQueries` | Singleton `setup_state` row; currently only `default_database_linked` | **Read-only reuse for now.** Do not repurpose this table for wizard step tracking without a product decision — see Open Questions. |
| `packages/praxrr-app/src/hooks.server.ts` (auth setup block, L213-219) | Existing first-run gate: redirects to `/auth/setup` while `auth.needsSetup`, and the default-DB auto-link block (L58-129) | The wizard's redirect gate is a **new, later** check in the same `handle` function — it must run *after* the existing `/auth/setup` (admin account) gate, never replace or race it. Mirror the existing pattern: check-and-redirect, with an explicit allowlist for `/setup/*` and static assets. |
| `packages/praxrr-app/src/routes/auth/setup/+page.svelte` + `+page.server.ts` | Prior art for a "first-run, full-screen, no-nav" route the same `handle` hook redirects into | Structural template for `/setup/*`'s layout (centered, minimal chrome) — reuse the pattern, not the file. |
| `$sync/preview/orchestrator.ts`, `$sync/preview/types.ts`, `/api/v1/sync/preview/*` routes | Read-only, per-section diff generation + apply endpoint (#7) | Reuse the API and types wholesale. Do not add a wizard-specific preview format. |
| `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte` | Renders a generated preview: staleness warnings, per-section diffs, destructive-delete confirmation, Apply button | Reuse directly for the wizard's "Preview & Sync" step. It already owns the full apply lifecycle (`/api/v1/sync/preview/{id}` fetch, `/apply` POST, staleness/deletion guardrails) — do not reimplement any of this. |
| `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte` | "Preview Sync" button that POSTs `/api/v1/sync/preview` | **Caveat:** reads `instanceId` from `$page.params.id`, i.e. it assumes it's mounted under `/arr/[id]/...`. Reuse only if the wizard's preview step is itself route-scoped as `/arr/[id]/setup/...` (or similar), or fork a thin variant that takes `instanceId` as a prop. Do not silently rely on `$page.params.id` matching in a differently-shaped `/setup/*` route. |
| `packages/praxrr-app/src/routes/arr/[id]/sync/components/QualityProfiles.svelte` | Unified PCD + TRaSH quality-profile picker: source filter, search, pagination, `SyncFooter` wiring | **High reuse value, but tightly coupled to sibling route actions** (`?/saveQualityProfiles`, `?/saveTrashGuideSource`, `?/syncQualityProfiles` — all relative form-action POSTs resolved against the current route). Recommended approach below (KISS Assessment) is to *not* embed this component inside `/setup/*` at all — link forward into the real `/arr/[id]/sync` page instead. |
| `$ui/form/FormInput.svelte`, `$ui/dropdown/DropdownSelect.svelte`, `$ui/form/TagInput.svelte`, `$ui/form/DisclosureSection.svelte`, `$ui/card/StickyCard.svelte`, `$ui/button/Button.svelte`, `$ui/modal/Modal.svelte`, `$ui/modal/InfoModal.svelte`, `$ui/modal/DirtyModal.svelte`, `$ui/toggle/Toggle.svelte`, `$ui/badge/Badge.svelte` | Full form/layout primitive set already used by both `InstanceForm.svelte` variants | These are the *only* primitives the wizard should need for steps 1-2. No new form atoms required. |
| `$lib/client/stores/dirty.ts` (`initEdit`, `initCreate`, `update`, `current`, `isDirty`, `clear`, `confirmNavigation`) | Snapshot-based dirty tracking, already wired into both `InstanceForm.svelte`s and the sync page | Reuse verbatim for any wizard step that embeds a form. Each step should call `clear()` on unmount (as the existing forms do) so dirty state doesn't leak across wizard steps. |
| `$alerts/store` (`alertStore.add`) | Global toast/alert feedback | Use for all wizard success/error feedback — no separate wizard alert UI. |
| `$ui/navigation/tabs/Tabs.svelte` | Route-driven top tab bar with active-state, back button, breadcrumb, responsive dropdown | **Not a fit for wizard step progress** (see Modularity Design) — it's a page-level section nav, not a linear stepper. Don't force it into that role. |

## Modularity Design

Proposed module boundaries, all under `packages/praxrr-app/src/routes/setup/` and one
small server module:

- **`routes/setup/+layout.svelte` + `+layout.server.ts`** — the only wizard-specific
  "framework" piece: renders a lightweight step indicator (numbered list, not `Tabs`)
  and computes step-completion (Arr connected? / DB linked?) once, passed down via
  `load`. Single responsibility: sequencing and progress display, nothing else.
- **`routes/setup/instance/+page.svelte`** — embeds `arr/components/InstanceForm.svelte`
  with `mode="create"`; its `+page.server.ts` action reuses `arrInstancesQueries.create`
  the same way `arr/new/+page.server.ts` does, but redirects to `/setup/database`
  instead of `/arr/{id}/settings`.
- **`routes/setup/database/+page.svelte`** — mirrors `databases/new/+page.svelte`'s
  two-card choice (TRaSH vs. custom), each linking to `databases/new/trash-guide` /
  `databases/new/custom` with a `?returnTo=/setup/profiles` (or equivalent) so those
  existing routes redirect back into the wizard instead of forking their logic.
- **`routes/setup/profiles+preview`** — **not a wizard-owned UI at all**. This step
  should simply deep-link to the newly created instance's real
  `/arr/[id]/sync` page (optionally with a `?returnTo=/setup/done` marker for a "Back to
  setup" banner). This is the direct application of the KISS assessment below.
- **`routes/setup/done/+page.svelte`** — terminal step; marks the wizard as
  seen/skippable (see Open Questions) and links into the app's real nav.
- **Server-side "setup progress" service** (`$server/setup/progress.ts`, new, small) —
  the *only* new server module: a pure function `getSetupProgress()` that calls
  `arrInstancesQueries.getAll()` and `databaseInstancesQueries.getAll()` and returns which
  steps are done. No new table. Consumed by `+layout.server.ts` and by the
  `hooks.server.ts` redirect gate so the "am I done?" logic lives in exactly one place.

Shared vs. feature-specific: everything above the "Server-side setup progress service"
line is either (a) a direct import of an existing feature module, or (b) a thin
route-local file with no exported surface — i.e. nothing here needs to move into
`$lib/shared/` or a new `$wizard/` alias. A dedicated alias would be premature for a
handful of route-local files (see File Organization guidance in CLAUDE.md: group by
existing route conventions).

## KISS Assessment

- **Do not build a generic, reusable "wizard framework."** There is exactly one wizard
  in this codebase. A configurable step-engine (step registry, generic
  next/back/skip state machine, pluggable validators) is speculative generality for a
  five-step, mostly-linear flow. A plain SvelteKit route-per-step layout with a small
  shared layout component is sufficient and matches the "Routes over modals" /
  route-based navigation convention already used everywhere else in this app.
- **Do not duplicate `InstanceForm.svelte` (either variant).** Both forms already handle
  everything the wizard needs (validation gating via `canSubmit`, capability warnings,
  secret reveal/copy, connection testing). A wizard-specific "simplified" instance form
  would immediately drift from the real one (e.g. new capability flags added to
  `$shared/arr/capabilities.ts` would only reach one of the two forms).
- **Do not re-embed `QualityProfiles.svelte`/`DelayProfiles.svelte`/`MediaManagement.svelte`
  inside a wizard step.** These components are ~300-600 lines each, each wired to
  sibling-route form actions (`?/saveQualityProfiles`, `?/saveTrashGuideSource`, etc.)
  and to a local `SyncFooter`/preview-config contract. Rebuilding that inside `/setup/*`
  means either (a) copying ~1500 lines of selection/save/sync logic into a second
  location that will silently diverge, or (b) re-plumbing every one of those actions
  onto a new `+page.server.ts` — for no material benefit, since `/arr/[id]/sync` already
  is the profile-selection + preview + apply UI. **Recommendation: the wizard's
  "profiles & preview" step is a deep link into `/arr/[id]/sync`, not an embedded view.**
  This is the single highest-leverage KISS decision for this feature.
- **Route-based steps, not one big component.** Consistent with existing conventions
  (`arr/new`, `databases/new/*`, `settings/*` are all route-per-concern, not modal
  wizards or single mega-components). A `/setup/[step]` dynamic route is unnecessary
  indirection over discrete `/setup/instance`, `/setup/database`, etc. routes — prefer
  the latter for clearer server `load`/`actions` per step and simpler back/forward
  browser navigation.
- **Reuse the existing `/auth/setup` redirect pattern in `hooks.server.ts` rather than
  inventing a parallel gating mechanism.** The wizard's redirect check should sit
  directly below the existing `auth.needsSetup` block, using the same
  `if (path === allowedPath) return resolve(...); else redirect(...)` shape already
  proven there.
- **Do not add wizard-tracking columns to `setup_state` speculatively.** Its only
  current consumer (`hooks.server.ts`) treats it as a one-shot auto-link marker. Deriving
  wizard-step completion from `arrInstancesQueries.getAll()` /
  `databaseInstancesQueries.getAll()` avoids a second source of truth that can drift from
  actual data (e.g. a user deletes their only Arr instance — a persisted "step complete"
  flag would now lie).

## Abstraction vs Repetition (Rule of Three)

- `arr/components/InstanceForm.svelte` and `databases/components/InstanceForm.svelte`
  independently implement near-identical "reveal/copy stored secret" logic (~80 lines
  each: `requestXReveal`, `toggleStoredXReveal`, `copyXToClipboard`,
  `copyStoredXToClipboard`, hidden reveal `<form>`, masked-display computation). That's
  two occurrences, not three — per the rule of three this is **not** a blocker for the
  wizard and shouldn't be extracted as part of this feature. Flagging it here only so
  the wizard doesn't become the "third occurrence" that finally triggers extraction: if
  the wizard needs a secret-reveal field anywhere, prefer embedding the existing forms
  (as recommended above) over hand-rolling a third copy.
- No new abstraction is justified by the wizard itself: steps 1-2 are two call sites of
  existing forms (not three variations of new logic), and steps 3-4 are deep-links, not
  new UI. The one legitimately new piece — `getSetupProgress()` — has exactly one
  purpose and one call site pattern (used from both `hooks.server.ts` and
  `+layout.server.ts`), so it's a plain function, not a class/service with configurable
  strategies.

## Interface Design

- `getSetupProgress()` should return a small, explicit shape, e.g.
  `{ hasArrInstance: boolean; hasDatabase: boolean }`, computed straight from
  `arrInstancesQueries.getAll().length > 0` and
  `databaseInstancesQueries.getAll().length > 0`. Keep it synchronous (both queries are
  synchronous `better-sqlite3`-style calls elsewhere in this codebase) so it can be
  called directly from `hooks.server.ts` without adding async complexity to the request
  pipeline.
- Wizard step `+page.server.ts` actions should return the same `fail(...)`/`redirect(...)`
  shapes as `arr/new/+page.server.ts` and `databases/new/*/+page.server.ts` (e.g.
  `fail(400, { error, values })`) so `InstanceForm.svelte`'s existing `form.error` /
  `form.success` handling works unmodified when the component is embedded in a wizard
  route instead of its original route.
- Any "return to wizard" links (e.g. from `databases/new/custom` back to
  `/setup/profiles`) should be a plain `?returnTo=` query param read by the target
  route's existing redirect, not a new session/cookie mechanism — matches the
  query-param-driven patterns already used for `initialType` in `arr/new/+page.svelte`.

## Testability Patterns

- Test aliases live in `scripts/test.ts` (e.g. `deno task test filters`); add a new
  alias (e.g. `setup-wizard`) once wizard tests exist so `deno task test setup-wizard`
  works, following the existing `alias -> path` convention.
- Route-level logic tests belong under `packages/praxrr-app/src/tests/routes/` alongside
  existing examples like `trashGuideSources.test.ts`, `complexityTiersApi.test.ts`, and
  `uiPreferencesApi.test.ts` — these test server `load`/`actions` logic directly rather
  than through a browser, which is the cheapest way to cover the new
  `+page.server.ts` files and `getSetupProgress()`.
- `packages/praxrr-app/src/tests/base/BaseTest.ts` is the shared test harness other route
  tests extend/use for DB setup/teardown — reuse it rather than writing a new fixture
  bootstrap for wizard tests.
- Because steps 1-2 embed existing forms verbatim, they inherit existing component
  behavior; new unit tests should focus on the two *new* things: (1) `getSetupProgress()`
  correctness (no instance / instance only / instance+database), and (2) the
  `hooks.server.ts` redirect gate (allowed paths while incomplete, no redirect once
  complete, no interference with the existing `auth.needsSetup` gate). E2E coverage
  (`deno task test:e2e`) should cover the happy-path click-through once, not per-step
  unit-test the forms again (already covered where they live today, if at all).

## Build vs Depend

No new dependencies are needed. Every capability the wizard requires — forms, dirty
tracking, alerts, dropdowns, modals, sync preview, diffing — already exists in-repo.
The only build vs. depend judgment here is architectural (embed vs. link-forward for
steps 3-4), covered under KISS Assessment, not a package decision.

## Open Questions

- **Does "setup complete" need to be persisted, or is it always derived?** Deriving from
  `arrInstancesQueries`/`databaseInstancesQueries` is simplest and can't drift, but it
  means a user who deletes their only instance/database will be routed back into
  `/setup/*` on next load. If product wants an explicit one-time "I'll do this later" /
  skip affordance that persists even with zero instances, that *does* require a new
  persisted flag (e.g. a `wizard_skipped_at` column on `setup_state`, or a new row) —
  this is a schema change and should be an explicit product decision, not something
  inferred by the implementer.
- **Does the wizard need to run for existing installs (upgrade path), or only fresh
  installs?** `setup_state.default_database_linked` already exists for all installs
  (via migration), so gating purely on `getSetupProgress()` naturally treats "no arr
  instance yet" the same for a fresh install and an existing install that never added
  one. Confirm that's the desired behavior (likely yes, but worth stating explicitly
  since it affects the redirect gate's blast radius on upgrade).
- **Where does `SyncPreviewTrigger.svelte`'s `$page.params.id` coupling point the wizard's
  URL structure?** If the "preview & sync" step is a genuine deep-link to
  `/arr/[id]/sync` (recommended), this is a non-issue. If a future iteration decides to
  render preview *inside* `/setup/*` after all, `SyncPreviewTrigger.svelte` will need an
  `instanceId` prop fallback before it can be reused outside `/arr/[id]/...`.
- **Return-to-wizard plumbing for `databases/new/trash-guide` and
  `databases/new/custom`:** confirm whether their `+page.server.ts` actions should grow a
  `returnTo`-aware redirect, or whether the wizard should instead fork tiny
  `/setup/database/trash-guide` and `/setup/database/custom` routes that import the same
  `databases/components/*Form.svelte` components with a hardcoded wizard redirect. The
  latter avoids touching two existing, working routes for a wizard-only concern; the
  former avoids two near-duplicate route files. Either is reasonable — flagging so it's a
  deliberate choice in the plan, not an accident.
