# UX Research: Transparent Automation Engine Completion

## Executive Summary

Transparent automation should feel like a calm, inspectable chain of evidence: what Praxrr looked at,
what it decided, what it plans to do, what it actually confirmed, and what the user can do next. The
foundation shipped in PR #213 already establishes the right presentation model: a concise headline,
optional verbose details, explicit tone, and raw evidence retained nearby. Completion should extend that
model consistently rather than inventing a new dashboard or replacing existing diff/config tables.

The recommended interaction pattern is **summary -> decision details -> raw evidence**:

1. Always show the operation target, state, timestamp, and a one-sentence summary.
2. Let one clearly labeled disclosure toggle reveal explanation details for the surface.
3. Keep raw field values, score math, provenance, and errors inspectable in their established tables.
4. Use separate visual/language states for planned, applying, partial, confirmed, and unavailable.
5. Never use a success icon or completed language for entity outcomes the backend did not confirm.

This aligns with three strong precedents:

- Terraform separates plan from apply, presents create/update/delete intent before execution, and warns
  that an earlier speculative plan can become stale. Its saved-plan workflow applies the reviewed
  artifact rather than silently substituting another plan
  ([Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan)).
- GitHub Actions presents run -> job -> step hierarchy, automatically expands the failed step, and keeps
  detailed searchable logs behind the summary
  ([GitHub Actions workflow logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs)).
- WAI's disclosure pattern requires a button with programmatic expanded state, while WCAG status-message
  guidance distinguishes advisory status from urgent alerts and warns against overly chatty live regions
  ([WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/),
  [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)).

## User Workflows

### Primary flow: Review and apply a narrated sync preview

1. User generates a sync preview.
2. While generating, keep the trigger and page structure stable; show a concise busy status such as
   "Preparing preview for Sonarr A" rather than an empty panel.
3. On success, place a **Planned changes** summary at the top:
   - instance and Arr type;
   - generated time and staleness;
   - create/update/delete/unchanged counts; and
   - coverage state (complete or partial because a section failed/skipped).
4. Present a single **Show explanation details** disclosure for the decision log. Summary is default.
5. Group entities by section. Each row shows action label + glyph + text, entity name, and one decision
   sentence. The existing current/desired field table remains expandable.
6. If deletes exist, keep the existing destructive warning and typed confirmation.
7. On apply, disable duplicate submission and change the button to a busy state with visible text.
8. After apply, show a separate **Apply result** region. Report confirmed section outcomes only. If
   entity-level outcomes are unavailable, label entity details "Planned changes" and link to Sync History;
   do not visually convert planned rows into successes.

### Alternative flow: Partial preview

1. Keep successfully generated sections visible.
2. Place a warning immediately above the decision log: "Preview incomplete: Media Management could not be
   evaluated. Other sections are shown below."
3. Give the failed/skipped section its own row with status, safe reason, and retry/regenerate action.
4. Do not show "All synced entities are up to date" while any selected section lacks evidence.
5. Preserve existing staleness and destructive warnings; incomplete coverage is an additional dimension.

### Alternative flow: Quality Goals explanation

1. User chooses target profile, preset, and sliders.
2. Controls update immediately, while the generated configuration is marked **Updating preview** until the
   server response for the latest inputs arrives.
3. Keep the previous preview visible during recomputation but visually label it as being refreshed; never
   present it as the result of the newest sliders until the response arrives.
4. The top summary shows coverage, threshold changes, and total fields affected.
5. Each custom-format row shows category, final score, and a concise "Why" sentence. A disclosure reveals
   exact base + contribution math and rule/ceiling details.
6. Uncategorized formats remain in a clearly titled **Not scored; existing value preserved** group.
7. Apply uses the currently displayed server plan. Stale-engine rejection preserves the user's selections
   and offers **Regenerate preview**.

### Alternative flow: Resolved-config provenance

1. User selects entity and layer as today.
2. Add a short layer explanation above the content, not only in documentation:
   - Resolved: final base + user state;
   - Base: state before user ops;
   - User Overrides: differences introduced by user ops.
3. On resolved fields, show provenance only when proven: **Base-side**, **User override**,
   **User-created**, or **Provenance unavailable**.
4. A pending conflict adds a persistent warning next to the provenance explanation and a direct
   **Review conflict** link.
5. Do not use a "Database default" badge until the backend can prove that source.

### Alternative flow: Audit an automated workflow

1. Start at Background Jobs or the feature's domain history page.
2. Show trigger/source, target/scope, start/finish, outcome, and next scheduled run in the summary.
3. Expansion reveals decision inputs, skipped/partial rationale, outputs, and recovery action.
4. Deep-link rich domain evidence (Sync History, drift detail, canary, Config Health) rather than flattening
   everything into a generic output string.
5. If a transparency dimension is not implemented, the internal audit must link a follow-up; the UI should
   use honest "Details unavailable" copy, not a blank cell.

## UI/UX Best Practices

### Progressive disclosure

- Use one surface-level verbose toggle so users do not have to expand every narration line separately.
- Label it by effect: **Show explanation details** / **Hide explanation details**.
- Implement it as a real button with `aria-expanded`; use `aria-controls` when one stable region is
  controlled. WAI specifies Enter and Space activation and programmatic expanded state
  ([WAI disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)).
- Existing entity-diff expansion buttons should also expose `aria-expanded` and an accessible name such as
  "Show field differences for WEB-DL".
- Do not hide critical warnings, incomplete coverage, destructive actions, or the planned/confirmed label
  behind verbose mode.

### Information hierarchy and language

- Use the visible headings **Planned changes**, **Apply result**, **Why Praxrr chose this**, and
  **Raw details**. These prevent users from conflating stages.
- Prefer verbs tied to evidence: "would create" for preview, "attempted" during apply, "created" only for
  a confirmed outcome.
- Keep technical identifiers available in secondary text; lead with user-facing labels.
- Avoid generic "Something went wrong" where a safe structured reason exists, but do not infer a cause
  from free-form upstream text.
- Pair every error or warning requiring action with a concrete next step. USWDS recommends concise,
  human-readable alerts that explain what to do next and warns against notification overload
  ([USWDS alert guidance](https://designsystem.digital.gov/components/alert/)).

### Accessibility

- Never rely on tone color. Keep visible status text and action glyphs/labels; WCAG requires a non-color
  cue for meaning ([WCAG Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)).
- Use `role="status"` or a polite live region for completion, count changes, and advisory progress. Reserve
  `role="alert"` for important time-sensitive errors. Do not announce every score-row update while a user
  drags a slider; announce one atomic result such as "Preview updated: 12 scores, 3 fields changed."
- Busy controls need text plus animation; decorative spinner icons should not be the only signal.
- Preserve focus after async updates. Move focus only when a modal/dialog intentionally changes context.
- Make field-level validation programmatically associated with controls and preserve entered values after
  errors. GOV.UK recommends an inline message, an error summary for multiple errors, and retaining user
  input ([GOV.UK error-message guidance](https://design-system.service.gov.uk/components/error-message/)).
- Use semantic table headings (`th`, scopes where needed) and descriptive captions/headings.
- Ensure icons are decorative when adjacent text already communicates the meaning; otherwise provide an
  accessible name.

### Responsive design

- Stack summary cards and action controls into one column at narrow widths.
- Keep narrative text outside horizontally scrolling table containers.
- Diff and score tables may scroll horizontally, but only the table region should scroll. WCAG Reflow
  allows two-dimensional table layouts while requiring surrounding content to reflow
  ([WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)).
- For the widest current/desired tables, offer a narrow-screen stacked row: Field -> Change -> Current ->
  Desired. This is preferable to forcing users to pan for every line.
- Keep destructive confirm actions and the exact target name visible without horizontal scrolling.

### Consistency with current Praxrr UI

- Reuse `NarrationBlock`, `Badge`, `Button`, existing alert styling, field-change glyphs, and
  `formatFieldValue` presentation.
- Retain the current summary/verbose foundation and host-owned toggle.
- Preserve the Resolved Config stale-request guards: old results must disappear when entity/instance
  context changes.
- Preserve existing raw diff tables; narration sits above them rather than duplicating values.
- Improve the existing drift detail toggle with `aria-expanded`; use that corrected pattern for sync.

## Error Handling

| State                   | Message pattern                                               | Recovery and interaction                                                  |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Initial preview load    | "Preparing preview for {instance}…"                           | Stable panel, disabled apply, polite status.                              |
| Full preview failure    | "A trustworthy preview could not be generated." + safe reason | **Try again**; preserve instance/section selections.                      |
| Section failure         | "Preview incomplete: {section} could not be evaluated."       | Show other sections; regenerate/retry.                                    |
| Unsupported section     | "{Section} is not supported for this Arr version."            | Explain skip; link compatibility details if available.                    |
| Stale preview           | "Preview is {age} old."                                       | Warn at existing threshold; block and offer regenerate at hard threshold. |
| Apply in progress       | "Applying the reviewed preview…"                              | Disable duplicate submit; retain visible plan.                            |
| Partial apply           | "2 sections applied; 1 failed."                               | List section outcomes; link Sync History; retry only safe scope.          |
| Missing entity outcomes | "Per-entity results were not recorded for this run."          | Keep rows labeled planned, not failed/successful.                         |
| Quality Goals refresh   | "Updating generated configuration…"                           | Preserve prior preview, label it pending refresh.                         |
| Stale goals engine      | "This plan was produced by an older engine version."          | Preserve inputs; **Regenerate preview**.                                  |
| Uncategorized CF        | "Not scored; existing score will be preserved."               | No error styling; keep in explicit neutral group.                         |
| Provenance unavailable  | "The source of this value is not recorded."                   | Show value; do not guess a badge.                                         |
| Pending conflict        | "Resolved value is ambiguous while this conflict is pending." | **Review conflict** link.                                                 |
| Rate limited            | "Too many checks; try again shortly."                         | Keep prior valid result timestamped; retry after wait.                    |
| Network/offline         | "Praxrr could not reach the server."                          | Keep user inputs and last confirmed data labeled with time/target; retry. |

Validation messages should identify the field and correction, not just the rule. Service failures belong in
operation-level alerts, not beside a field the user cannot fix.

## Performance UX

### Loading and freshness

- Use skeletons only when the shape is stable; otherwise use plain status text to avoid layout confusion.
- Preserve the last confirmed read-only result during refresh, with visible **Refreshing** and timestamp.
- Clear or invalidate results immediately when target context changes; a result for instance A must never
  appear under instance B.
- Keep preview age and target visible through confirmation and apply.
- Debounced Quality Goals previews should cancel/ignore stale responses and announce only the latest result.

### Optimistic behavior

- Slider/thumb movement and disclosure toggles can update optimistically because they are local UI state.
- Generated scores, provenance, sync preview, and apply outcomes must wait for authoritative server data.
- Never optimistically mark apply, goal persistence, or per-entity sync as successful.
- Do not blank useful evidence while a refresh runs; distinguish retained evidence from the pending result.

### Offline and degraded operation

Praxrr is not an offline-first application. The safe degraded pattern is read-only preservation:

- retain unsaved user choices locally in the current page;
- retain the last successful read result with its timestamp and target;
- disable writes/apply while connectivity is unknown;
- provide retry; and
- never queue an apply silently for later execution.

## Competitive Analysis

### Terraform plan/apply

Terraform's best lesson is semantic separation: a plan proposes actions and does not perform them; a saved
plan can later be applied as the reviewed artifact. It also explicitly warns that speculative plans can
become stale. Praxrr already follows much of this pattern with preview IDs, staleness gates, and destructive
confirmation. Adopt Terraform's strict stage language and final action summary. Avoid copying terminal-heavy
raw output as the primary UI; Praxrr's narration + structured tables are more approachable.

Source: [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) and
[Terraform apply command](https://developer.hashicorp.com/terraform/cli/commands/apply).

### GitHub Actions run details

GitHub Actions exposes a clear hierarchy: run summary, jobs, steps, failed step expanded, then searchable
logs. Praxrr should mirror the hierarchy as operation -> section -> entity -> field, automatically drawing
attention to the failed/partial branch while retaining deeper raw evidence. Avoid requiring users to search
generic logs before they can identify the failed section.

Source: [GitHub Actions workflow logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs).

### Existing Praxrr strengths

- Drift detail already demonstrates concise narration plus optional detail and raw field diffs.
- Resolved Config uses explicit terminal states and prevents stale async responses from crossing contexts.
- Quality Goals always shows generated configuration and calls out uncategorized formats.
- Sync Preview already distinguishes planned actions, warns on staleness/deletes, and requires explicit
  confirmation.

The main gaps are semantic and accessible consistency: sync narration is absent, disclosure state is not
programmatically exposed everywhere, post-apply evidence is too coarse for entity success, and provenance
must not overclaim database-default attribution.

## Recommendations

### Must have

- Add sync-preview summary, section-outcome, entity, and safe error narration from existing evidence.
- Use visible **Planned changes** and **Apply result** headings throughout.
- Add accessible disclosure semantics (`aria-expanded`, optional `aria-controls`) to verbose/entity toggles.
- Preserve partial/skipped sections and never show a whole-preview success when coverage is incomplete.
- Canonicalize Quality Goals "Why" wording from the server reason object; expose exact math on demand.
- Use only proven resolved-config provenance; show unavailable/ambiguous states explicitly.
- Use polite status announcements for async completion and urgent alerts sparingly.
- Keep color + glyph + text triple encoding and isolate table scrolling from page reflow.
- If per-entity apply outcomes remain unavailable, create a linked follow-up and keep entity rows labeled
  planned.

### Should have

- Add a single operation-level decision log component/pattern shared by sync, goals, and audit surfaces.
- Provide stacked mobile views for field and score tables.
- Link generic job runs to their richer domain detail surface.
- Preserve the last confirmed result during refresh with explicit freshness labeling.
- Add focused keyboard/screen-reader tests for disclosure, live status, partial preview, and destructive
  confirmation.

### Nice to have

- Persist the user's summary/verbose preference per browser after the interaction pattern stabilizes.
- Provide "Copy explanation" or structured export for support without copying secrets.
- Offer filters for changed-only, failed-only, and user-override-only on large result sets.
- Add comparison of reviewed plan versus confirmed outcomes once per-entity outcome evidence exists.

## Open Questions

1. Should one verbose toggle control the entire sync surface, or should each section remember its own state?
   One global toggle is simpler and matches the foundation unless user testing shows very large previews are
   overwhelming.
2. Can the apply response deep-link directly to the newly written Sync History entry? That would provide a
   clean transition from immediate status to durable evidence.
3. Should Quality Goals display exact contribution math inline for every row on desktop, or place it behind
   row disclosure? Concise inline "Why" plus disclosed math is the better default.
4. How should proven base-side provenance be labeled until schema/database-default attribution exists?
   **Base-side** is more honest than **Base** if users could interpret the latter as a specific op source.
5. Which status updates already flow through the global alert store with accessible live-region semantics?
   Avoid adding nested live regions that announce the same completion twice.
6. Is a responsive stacked diff available in the shared table system, or should this slice keep horizontal
   table scrolling and defer a reusable mobile diff component?
