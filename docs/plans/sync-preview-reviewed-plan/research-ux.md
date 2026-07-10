# UX Research: Sync Preview Reviewed-Plan Apply (Issue #234)

## Executive Summary

Sync Preview already has the right review hierarchy: instance and `arrType`, generated time, plan
summary, section coverage, expandable current-versus-desired entity diffs, destructive-change
confirmation, and a clear separation between planned changes and confirmed outcomes. The trust gap is
at the final action. The UI says that the user is applying the reviewed preview, while the apply route
currently starts a new sync calculation. If authoritative PCD or live Arr evidence changes, the UI
cannot distinguish the cause, and its generic error handling can leave the old Apply button apparently
usable.

The target interaction should make one promise: **Apply Preview validates and executes only the plan
shown for this instance, explicit Arr family, and reviewed sections.** If that evidence no longer
matches, nothing is applied, the preview becomes visibly non-applicable, and the primary recovery is
to generate and review a new preview. Never replace the visible plan with a newly calculated one and
continue automatically.

Recommended UX changes are intentionally small:

1. Add a stable typed reason to apply errors and map it to evidence-specific, persistent copy.
2. Show the reviewed `arrType` and section scope again in the confirmation dialog.
3. During apply, label the pre-write phase as **Validating reviewed preview…**, disable all execution
   actions, and keep the reviewed diff available.
4. On drift, mark the old preview **Review invalidated**, disable Apply immediately, retain the old diff
   for audit context, and offer **Generate New Preview**.
5. Keep one execution path inside the preview surface. The current **Save & Sync** quick action can run
   a separate unreviewed sync and should not appear as an equivalent way to apply the displayed plan.

This is compatible with the existing Svelte 5 no-runes style, `alertStore` feedback, `Modal`, `Button`,
and `SyncPreviewPanel` components. Use ordinary local variables and `$:` statements; do not introduce
runes.

## Current UI and API Findings

- `SyncPreviewTrigger.svelte` posts `instanceId`, an explicit section list, and current form state as
  `sectionConfigs`, then announces generation through an `aria-live="polite"` status.
- `SyncPreviewPanel.svelte` fetches the stored preview, displays `instanceName`, generated time,
  `arrType`, coverage, section/entity diffs, TTL warnings, and destructive confirmation.
- Apply currently posts `{}`. The server defaults to the preview's eligible sections, but the UI does
  not restate those sections in the confirmation and does not send the visible selection explicitly.
- Apply errors are reduced to a string and mirrored through `alertStore.add('error', message)`. The API
  has no stable reason code for PCD drift versus live Arr drift.
- When apply fails, the local preview can still be `ready`; consequently the old **Apply Preview**
  control can remain enabled until a reload or another state change.
- The preview modal also contains **Save changes** and **Save & Sync**. The latter is a separate sync
  path and can undermine the reviewed-plan mental model.

## User Workflows

### Core User Workflows

1. **Generate**
   - The user activates **Preview Sync** from one sync section.
   - The trigger becomes disabled and reads **Generating preview…**.
   - The request retains the exact ordered section scope and the relevant preview configuration.

2. **Review**
   - The panel opens on the new preview and shows a compact identity line:
     **`{instanceName}` · `{ArrLabel}` · `{Section labels}` · generated `{time}`**.
   - The existing plan summary and progressive disclosure remain: totals, coverage, per-section
     entities, then field-level current/desired values.
   - Planned data remains explicitly labelled as planning evidence, not apply outcome data.

3. **Confirm**
   - **Apply Preview** opens the existing confirmation dialog.
   - The dialog restates target, explicit Arr family, and exact section scope; for example:
     **Target: Movies · Radarr** and **Reviewed sections: Quality Profiles**.
   - Destructive confirmation remains unchanged. The confirm action is the only action in this surface
     that purports to execute the displayed plan.

4. **Validate, then apply**
   - After confirmation, the button/status reads **Validating reviewed preview…** while Praxrr obtains
     the section claim and validates both desired PCD and live Arr evidence.
   - The panel or modal is `aria-busy="true"`; Apply, close-and-reapply, and preview-generation actions
     are disabled for the active request.
   - Only after validation succeeds may the label become **Applying reviewed changes…**. Do not show
     apply progress while the server is still deciding whether the review is valid.

5. **Finish**
   - Success uses the existing `alertStore.add('success', 'Preview applied')` convention and displays
     confirmed outcomes separately from the retained planned changes.
   - A drift or validation failure follows the invalidation workflow below and must never look like a
     partial apply.

## Alternative Workflows

### Drift invalidates the review

Keep the old plan visible but place a persistent error block before the plan summary:

- badge/title: **Review invalidated**;
- evidence-specific explanation from the table below;
- explicit **Nothing was applied** statement;
- primary action: **Generate New Preview**;
- secondary action: **Keep Reviewing Old Preview** (dismisses no warning and never re-enables Apply).

The invalidated preview is historical context, not a draft that can be repaired in place. Generating a
replacement creates a new preview ID and reopens the normal review workflow.

### Expired or missing preview

The details may no longer be recoverable from the in-memory store. Replace Apply with **Generate New
Preview**. If the already-loaded client copy is retained for context, label it **Expired preview** and
do not imply that server evidence is still available.

### Section already claimed

This is a transient concurrency conflict, not proof of PCD/Arr drift. Keep the reviewed diff visible,
label it **Apply blocked**, and do not mark it as applied or partially applied. Because the competing
sync may change live Arr evidence, the safest primary recovery after that sync completes is to generate
and review a new preview. A secondary **View Sync History** link is useful when a history record is
available.

### Revalidation cannot classify the source

If PCD or Arr evidence cannot be read, canonicalized, or mapped unambiguously, do not guess which side
changed. Use the combined/ambiguous copy below, fail closed, and keep technical details out of the UI.
Logs may carry diagnostic context.

## UI/UX Best Practices and Accessibility

### Persistent, actionable error state

`alertStore` is useful global feedback but should not be the only recovery surface. A transient toast
cannot carry the invalidated lifecycle state or a durable regeneration action. Mirror the same concise
message through `alertStore.add('error', message)`, then render the full explanation and CTA in
`SyncPreviewPanel`.

The error response should be a discriminated contract (for example, `reason: 'pcd_drift'`) rather than
client parsing of English text. Map every reason exhaustively; unknown reasons use fail-closed
ambiguous copy.

### Status and alert semantics

- Use `role="status" aria-live="polite" aria-atomic="true"` for **Generating…**,
  **Validating…**, **Applying…**, and completion status. Announce the whole message, not only a changed
  verb or count.
- Use `role="alert" aria-atomic="true"` for a newly rendered drift/invalidation error. Keep it on
  screen; do not auto-dismiss it.
- Avoid putting `aria-live` on the continuously updating preview-age text. A 15-second age update is
  not important enough to interrupt a screen-reader user. Announce only threshold transitions (stale
  warning or blocked/expired).
- Do not encode PCD/Arr/both solely through color or icon. Always include the evidence class in text.
- On confirmation-dialog close, return focus to the persistent invalidation block or its
  **Generate New Preview** action. Do not return focus to a now-disabled Apply button.

These recommendations follow WCAG 2.2 status-message and error-identification guidance: dynamic
results and busy states must be programmatically determinable, while detected errors should identify
what failed and offer a known correction. WAI's Alert Pattern also advises that important alerts remain
available and do not take keyboard focus merely because they were announced.

### Scope and identity comprehension

- Show human-facing Arr labels (`Radarr`, `Sonarr`, `Lidarr`) while retaining exact lowercase
  `arrType` in the API contract.
- Display reviewed sections as labelled badges or a short comma-separated list in both panel and
  confirmation. Do not add editable section controls during apply; changing scope requires a new
  preview.
- A scope/Arr mismatch is not presented as PCD or Arr drift. It is an unsafe binding error and uses the
  ambiguous/binding recovery: regenerate from the intended instance and review again.

### Confirmation and destructive actions

- Preserve exact-name confirmation for plans containing deletes.
- Add one sentence before confirm: **Praxrr will first verify that the reviewed PCD and live
  `{ArrLabel}` evidence still match.**
- Do not show the new, unreviewed diff inside an error response. The regeneration action should create
  a fresh review surface; otherwise the user may confuse error diagnostics with approved changes.

### Avoid competing execution actions

Within the Sync Preview modal, **Apply Preview** should be the only control that executes the displayed
plan. Prefer removing **Save & Sync** from this modal. If saving unsaved form configuration remains
necessary, label it **Save Configuration**, explain that saving invalidates this preview, disable Apply,
and require regeneration. Normal manual sync may remain elsewhere on the page, but should not be
visually grouped as an alternate confirmation of the reviewed plan.

## Error States and Exact Recovery

All evidence failures are pre-write failures. Every message must include **Nothing was applied** and
must immediately disable the old preview's Apply action.

| Typed reason / state                                           | Persistent title                                             | Exact body copy                                                                                                                                                                                                                                         | Primary action and behavior                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pcd_drift`                                                    | **Review invalidated: PCD changed**                          | **Desired PCD data changed after this preview was generated. Nothing was applied. Generate a new preview and review the updated desired changes before applying.**                                                                                      | **Generate New Preview** creates a new preview with the same instance, exact `arrType`, and exact reviewed sections; it does not reuse the old confirmation.           |
| `arr_drift`                                                    | **Review invalidated: live {ArrLabel} data changed**         | **Live {ArrLabel} data changed after this preview was generated. Nothing was applied. Generate a new preview and review the updated current state before applying.**                                                                                    | **Generate New Preview** creates a new preview for the same bound target and scope.                                                                                    |
| `pcd_and_arr_drift`                                            | **Review invalidated: PCD and live {ArrLabel} data changed** | **Both desired PCD data and live {ArrLabel} data changed after this preview was generated. Nothing was applied. Generate a new preview and review all updated changes before applying.**                                                                | **Generate New Preview**; never auto-accept one side or apply matching sections.                                                                                       |
| `binding_drift`, `scope_drift`, or ambiguous cross-Arr mapping | **Review invalidated: target or scope changed**              | **Praxrr could not verify this preview for the same instance, Arr type, and reviewed sections. Nothing was applied. Generate a new preview from the intended instance and review it before applying.**                                                  | **Generate New Preview** from the current route only after its instance and `arrType` are explicitly resolved; no sibling-Arr fallback.                                |
| `validation_failed` / revalidation unavailable                 | **Could not verify the reviewed preview**                    | **Praxrr could not safely compare the reviewed preview with current PCD and live {ArrLabel} data. Nothing was applied. Generate a new preview and review it before applying. If preview generation also fails, check PCD and {ArrLabel} connectivity.** | **Generate New Preview**. Keep a secondary **View Logs** action only when the user has access; never expose raw upstream bodies inline.                                |
| `preview_expired` or missing TTL snapshot                      | **Preview expired**                                          | **This preview is too old or is no longer available. Nothing was applied. Generate a new preview and review it before applying.**                                                                                                                       | **Generate New Preview**. Old client-rendered evidence, if retained, is read-only and labelled expired.                                                                |
| stale-age hard block                                           | **Preview is too old to apply**                              | **This preview is over 30 minutes old. Nothing was applied. Generate a new preview and review it before applying.**                                                                                                                                     | **Generate New Preview**. Preserve the existing 5-minute warning as advisory, but evidence drift can block at any age.                                                 |
| `section_claimed` / active sync                                | **Apply blocked: sync already in progress**                  | **{SectionLabels} is already syncing for {instanceName}. Nothing from this preview was applied. Wait for the current sync to finish, then generate a new preview and review it before applying.**                                                       | Primary **View Sync Status** or **View Sync History** when available; follow with **Generate New Preview** after completion. Do not label this state as PCD/Arr drift. |
| preview lifecycle is `applying`, `applied`, or `failed`        | **Preview cannot be applied again**                          | **This preview is already being applied or has reached a final state. Generate a new preview and review it before starting another apply.**                                                                                                             | **Generate New Preview** unless the request is still actively applying, in which case show status and prevent duplicate requests.                                      |

If the API can prove only one changed evidence class because the other read failed, prefer
`validation_failed` over a misleading single-side drift claim. Precise classification is helpful; safe
classification is mandatory.

## Performance UX

### Feedback and State Design

#### Generate

- Disable the initiating preview button for the request and ignore repeated activations.
- If regenerating from an invalidated preview, keep the old diff rendered and visibly invalidated while
  the new preview loads. Do not clear the context to a blank panel.
- On success, atomically swap to the new preview ID, reset confirmation text/results, announce
  **New preview ready. Review the changes before applying.**, and move focus to the new preview heading.
- On failure, leave the old invalidated preview visible and the regeneration CTA enabled for retry.

#### Validate/apply

- Treat confirmation submission as a single in-flight operation. The first activation disables
  confirm, Apply, regeneration, and quick-sync actions; duplicate clicks must not send duplicate POSTs.
- Prefer two user-visible phases if the contract supports them: **Validating reviewed preview…** then
  **Applying reviewed changes…**. If the endpoint returns only once, show the conservative first label;
  do not claim writes have begun before validation succeeds.
- Do not optimistically mark changes applied. Update planned versus actual outcome areas only from the
  authoritative response.
- On a typed stale response, update local state immediately to non-applicable before adding the global
  alert. Do not rely on `invalidateAll()` or a later fetch to disable Apply.
- If the network response is lost, use **Apply status unknown** rather than **Apply failed**. Disable
  immediate retry and direct the user to Sync History/status first, because the request may have crossed
  the write boundary.

#### Claims and multiple sections

- Claims should be all-or-none for the exact selected section set. If any reviewed section is claimed,
  display the complete blocking section list and run none of them.
- Never silently remove a claimed or drifted section and apply the remainder.
- The UI must render the section order and exact `arrType` supplied by the reviewed snapshot; it must not
  infer scope from currently configured sections after confirmation.

## Competitive and Standards References

- [Terraform `plan`](https://developer.hashicorp.com/terraform/cli/commands/plan) explicitly separates
  speculative review from a saved plan intended for later execution and warns that intervening target
  changes can alter an unsaved/speculative plan's effect. Praxrr should similarly distinguish a displayed
  diff from executable reviewed evidence.
- [Terraform `apply`](https://developer.hashicorp.com/terraform/cli/commands/apply) treats a saved plan as
  the final result of planning decisions and does not accept new planning options while applying it.
  That is the clearest competitive precedent for preserving exact reviewed scope.
- [Terraform Enterprise remote saved plans](https://developer.hashicorp.com/terraform/enterprise/workspaces/run/cli#remote-saved-plans)
  become stale when the state they planned against is no longer valid. This supports a visible
  non-applicable state rather than silently recalculating and continuing.
- [WCAG 2.2 SC 4.1.3: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)
  requires dynamic action results, application state, progress, and errors to be programmatically
  determinable without requiring focus.
- [WCAG 2.2 SC 3.3.1: Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification)
  requires textual identification of what is wrong; [Technique G177](https://www.w3.org/WAI/WCAG22/Techniques/general/G177)
  supports including a known correction, here generating and reviewing a new preview.
- [WAI-ARIA Alert Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/) recommends alerts for brief,
  important dynamic messages without moving focus and cautions against alerts that disappear
  automatically or interrupt too frequently.

## Prioritized Recommendations

### P0 — required for the issue's trust contract

1. Add typed apply error reasons for PCD drift, Arr drift, both, binding/ambiguity, expiry, validation
   failure, and section claim; handle them exhaustively in `SyncPreviewPanel`.
2. On any evidence mismatch, transition the visible preview to **Review invalidated**, disable Apply
   synchronously, retain the old diff read-only, and provide **Generate New Preview**.
3. Restate and preserve exact instance, `arrType`, and selected sections through review, confirmation,
   validation, and execution. The confirmation must display them, not merely rely on server state.
4. Ensure the preview surface has one execution CTA. Remove or clearly separate **Save & Sync** so it
   cannot be mistaken for applying the reviewed evidence.
5. Add UI regression coverage that each typed reason produces the exact evidence-specific copy,
   disables Apply, and never displays successful/partial outcomes.

### P1 — accessibility and recovery quality

6. Add persistent inline error/recovery blocks in addition to `alertStore`; use `role="alert"` for new
   invalidations and `role="status"`/`aria-busy` for generate/validate/apply status.
7. Stop live-announcing every preview-age tick; announce only warn/block transitions.
8. Preserve focus after modal closure by focusing the persistent recovery action or new preview heading.
9. Distinguish a lost/unknown network response from a confirmed pre-write rejection and direct the user
   to Sync History before retrying an unknown apply.

### P2 — useful follow-up, not required for first delivery

10. Add a **View Sync Status/History** secondary action for section claims and unknown apply status.
11. If server progress becomes observable, split **Validating…** and **Applying…** into authoritative
    phases; do not simulate progress with a timer.

## Open Questions

1. Does `sectionConfigs` represent executable unsaved form state? If yes, apply must preserve it as part
   of reviewed evidence. If no, the UI should require save, invalidate the preview, and regenerate.
2. Should PCD-adjacent saved sync-configuration changes receive a distinct `config_drift` reason or be
   presented as PCD drift? The user still needs a stable desired-side message either way.
3. Will drift make the preview terminally `failed`, or will the contract add a dedicated `stale` status?
   A dedicated state is clearer in the UI, but either must prevent re-apply.
4. Can the apply endpoint return authoritative validation/apply phases, or should the UI use one
   conservative **Validating reviewed preview…** message until completion?
5. When a claim blocks apply but the preview is still under the age threshold, may the user retry the
   same preview after the claim clears, or should policy always require regeneration? Regeneration is
   the safer, simpler default because the competing sync may have changed live Arr state.
6. Is a durable Sync History record created for pre-write rejected reviews? If so, it should be labelled
   **Review invalidated** rather than failed sync, and expose no entity outcomes.
7. Should regeneration preserve the exact section order automatically, or return the user to the source
   section with a new explicit preview action? Automatic same-scope regeneration is recommended if the
   route still resolves to the same instance and `arrType`.
