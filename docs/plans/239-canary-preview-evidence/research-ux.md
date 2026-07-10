# UX Research: Canary Remaining-Target Preview Evidence

## Executive Summary

The verification gate needs an explicit evidence state, not an inference from an
array or the canary's Sync History row. Today `/canary/[id]` treats missing
diagnostics and zero captured changes as the same message, uses the
canary-applied diff as a representative remaining preview, and loses the
`remainingPreview` returned by the start request when it navigates to the detail
page. This can make unavailable evidence look like a harmless no-op.

The detail page should present remaining-preview availability as a first-class
status with two branches: `available` (which can contain changes or be empty)
and `unavailable` (with a safe reason and recovery action). Proceed must be
visibly present but disabled when unavailable, and the server must independently
reject promotion. Abort must remain enabled at every awaiting-confirmation gate.
Canary execution evidence should remain labeled as actual, while remaining
previews are labeled as planned.

## User Workflows

1. **Start:** The operator selects a canary, batch size, and partial policy.
   While the canary and previews run, change the button label to “Starting
   rollout…” with a spinner, disable form inputs, and expose `aria-busy="true"`.
   Do not imply success until the response is authoritative.
2. **Review:** Navigation lands on durable/reloadable detail data. The page
   first shows actual canary outcome and diagnostics, then a “Remaining-target
   preview” card with availability, exact target count/names, generation time,
   and planned changes.
3. **Decide:** Available evidence enables Proceed and Abort. Unavailable
   evidence blocks Proceed but leaves Abort usable. The Abort confirmation
   repeats that remaining instances stay untouched and the canary is not rolled
   back.
4. **Recover:** Safe recovery copy tells the operator what to correct. If this
   issue has no retry action, say “Abort this rollout, correct the problem, then
   start a new rollout”; do not suggest refresh if refresh cannot regenerate
   evidence.

## UI, UX, Accessibility, and Error States

Render the five states exactly as follows:

- **Unavailable:** a red, bordered panel headed “Remaining preview unavailable”
  with a visible `Unavailable` badge, the safe human-readable failure message,
  and a separately labeled “Recovery” sentence. If partial previews are
  retained, place them under “Incomplete preview details” and say they cannot
  authorize rollout. Never show “no changes.” Keep “Proceed to remaining N
  instances” in its normal action position but disabled. Immediately beneath it
  show “Proceed is disabled until a complete remaining-target preview is
  available.” Connect the button to that text with `aria-describedby`. Keep
  “Abort rollout” enabled.
- **Available, empty:** an emerald/neutral panel headed “Remaining preview
  complete” with an `Available · No changes` badge and the sentence “Preview
  completed for N remaining instances. No changes are currently planned.” Show
  the target list and generated timestamp. Proceed remains enabled because
  completeness, not mutation count, is the gate condition; its confirmation
  should warn that sync re-evaluates current state and may still produce
  outcomes.
- **Available, with changes:** show `Available · Changes planned`, aggregate
  create/update/delete counts, then target-grouped expandable diffs.
  Default-expand mutations and collapse unchanged entries. Use “Planned changes”
  consistently; do not call them applied or confirmed. Proceed and Abort are
  enabled.
- **Abort:** render as a secondary danger-outline action beside Proceed, never
  hidden or disabled merely because preview evidence is unavailable. The modal
  heading is “Abort rollout”; its primary sentence is “Remaining instances will
  not be touched.” Follow with “The canary changes are already applied and are
  not rolled back,” plus the Snapshots recovery link. During an abort request,
  show “Aborting…” and disable both actions only to prevent competing
  submissions.
- **Disabled Proceed:** preserve the button label and target count rather than
  replacing it with a vague “Unavailable.” Use native `disabled`, subdued
  styling, and persistent explanatory text; color or a tooltip alone is
  insufficient. A failed keyboard activation should do nothing, while
  server-side fail-closed validation protects alternate clients and races.

Give the preview card an associated heading and status text, use icons plus
words rather than color alone, and announce async status changes through a
polite live region. Recovery failures warrant `role="alert"`; existing loaded
failures do not need repeated announcement. Target names should be a semantic
list, and expanders need `aria-expanded`/`aria-controls`. Preserve focus after
refresh; after a failed Proceed, focus the unavailable/recovery heading rather
than silently returning to the top.

## Performance UX

Preview evidence must survive navigation and reload, so the detail load should
return authoritative availability rather than regenerate invisibly on every
render. Show a skeleton or “Preparing remaining preview…” only when generation
is genuinely in progress; never temporarily render empty. For large fleets,
render aggregate counts first and progressively disclose per-target diffs to
limit DOM cost. If Proceed revalidates/regenerates evidence, the modal should
say “Verifying preview…” and remain cancellable only before submission; timeout
or failure returns to the gate as unavailable without dispatching rollout work.

## Comparable Safe Verification-Gate Patterns

Praxrr's Sync Preview panel already models the desired pattern: error plus
recovery copy, a distinct complete-zero-change success state,
planned-versus-actual labeling, and Apply blocked when evidence is too old. The
snapshot rollback flow similarly requires preview before a destructive
confirmation. Deployment approval and plan/apply gates use the same safety
principle: evidence status is explicit, an absent or incomplete plan fails
closed, and cancel remains available. Canary should reuse these concepts and
visual language rather than inventing a softer empty-state convention.

## Prioritized Recommendations

1. Make availability durable/reloadable and render it independently from canary
   Sync History.
2. Implement the exact available-empty, available-with-changes, and unavailable
   panels above.
3. Gate Proceed in both UI and server logic; retain Abort for every
   awaiting-confirmation state.
4. Reuse safe failure/recovery copy and Sync Preview status styling; never
   expose raw errors.
5. Add accessibility and loading-state tests, including disabled Proceed plus
   enabled Abort.

## Open Questions

- Will recovery include in-place “Retry preview,” or only Abort-and-restart?
- Should incomplete successful target previews be shown for diagnosis or hidden
  by default?
- What evidence timestamp or staleness threshold should the gate display and
  enforce?
- If every persisted remaining target disappears, does the rollout complete as
  available-empty or require an explicit target-set-changed recovery state?
