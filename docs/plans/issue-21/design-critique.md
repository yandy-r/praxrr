# Design Critique — Transparent Automation Engine (Issue #21)

Adversarial review of `docs/plans/issue-21/design.md`. Every referenced anchor was
verified against source: `SyncPreviewPanel.svelte:251` (fetches full `SyncPreviewResult`),
`SyncPreviewEntityDiff.svelte:68` (`formatValue` dup), `resolved/fieldChangeDisplay.ts:20`
(`formatFieldValue`), `drift/[instanceId]/+page.svelte:164` (`Reason: {detail.reason}`),
`$shared` alias present in both `deno.json` files, and `DriftCategory` /
`DriftSummaryStatus` exports. The core thesis — a pure `$shared/narration` engine over
already-computed diff atoms, no recompute, no endpoint — is sound and well-grounded. The
problems below are gaps in completeness, scope, and internal duplication, not fabricated
references.

## Blocking

### B1. No pure function for the "Decision Log" rollup — the headline surface is untestable

The engine's Type Contracts expose `narrateEntityChange(s)`, `narrateDriftEntity`,
`narrateDriftReason`, `narrateSyncError` — but **nothing** that consumes
`SyncPreviewSummary` or `DriftCounts`. Yet the UI Surface section promises "a **Decision
Log** block with a single summary/verbose toggle... **Section rollup** rendered from the
already-fetched `SyncPreviewResult`." That rollup sentence ("3 created, 1 updated, 2
unchanged" style) has nowhere to live except inline in `SyncPreviewPanel.svelte` and
`drift/[instanceId]/+page.svelte`.

Consequences:

- The most user-visible line (the summary headline) lands in `.svelte`, which the stated
  test strategy (pure Deno unit tests) does not cover. The design's own testability goal
  and the task's "testable with deno unit tests (pure functions preferred)" constraint are
  defeated for the primary surface.
- It re-tallies/re-phrases counts in **two** components, directly contradicting the
  design's own invariant: _"rollups reuse `SyncPreviewSummary` / `DriftCounts`."_ Reuse of
  the data structure is not reuse of the phrasing; two inline rollups will drift.

Fix: add a pure `narrateSummary(summary: SyncPreviewSummary, level)` and
`narrateDriftCounts(counts: DriftCounts, status, level)` (or one shared
`narrateCounts`) returning a `NarrationLine`, and unit-test them. The `.svelte` files then
render, not author, the sentence.

### B2. Two user surfaces in one PR violates the explicit one-PR / at-least-one-surface constraint

The scoping constraint is "ONE reviewable PR that establishes the foundation **plus at
least one** concrete user-visible surface." The design ships **two** (sync-preview _and_
drift), plus the engine, plus four in-place `.svelte` edits, plus tests — and the Risks
table itself concedes this is "the largest diff among proposals." For a P3 _philosophy_
foundation, this is the single biggest reviewability risk.

Fix: cut to the **drift** surface only for this PR (the design already argues drift is the
one that uniquely delivers the Done-When "failure reasons" dimension via
`narrateDriftReason`). Defer the sync-preview surface + its two component edits
(`SyncPreviewPanel`, `SyncPreviewEntityDiff`) to an immediate follow-up. Same engine, half
the diff, both goals (foundation + one surface) still met. The design's own fallback note
("if the PR must shrink, keep the drift surface") should be promoted from contingency to
the plan.

## Should-fix

### S1. `narrateSyncError` free-text string-matching is brittle and cross-Arr unsafe

`SyncResult.error` (verified in `sync/types.ts:17-22`) is a coarse, free-form `string`
with **no error-code enum**. The UI section says the error state "narrates **known
failures** via `narrateSyncError`," which can only mean substring-matching arbitrary error
text. That is fragile (breaks on Arr version/locale changes) and violates the strict
cross-Arr policy — Radarr and Sonarr error strings are not guaranteed to share wording, so
a match keyed off one app's text mis-narrates the other. It also contradicts the design's
own test spec ("maps `null` and **arbitrary strings** to safe sentences").

Fix: `narrateSyncError` should map only `null`/empty to a generic safe sentence and
otherwise pass the raw error through verbatim inside a neutral frame — no pattern-matching
of free text. Structured per-`arrType` error codes are a prerequisite for "known failure"
narration and are out of scope here; say so.

### S2. `NARRATION_TEMPLATE_VERSION` is declared twice — double source of truth for the stamp

The Type Contracts show `export const NARRATION_TEMPLATE_VERSION = '1'` in **both**
`types.ts` and `templates.ts`. The whole point of the stamp (and the "every
`NarrationLine.templateVersion === NARRATION_TEMPLATE_VERSION`" test) is a single
authoritative version; two declarations can silently diverge and the test would still pass
against whichever one it imports.

Fix: declare it once (in `types.ts`), import it into `templates.ts`, re-export from the
barrel. One constant, one source.

### S3. Two entity-narration code paths risk exactly the phrasing drift #21 warns against

`narrateEntityChange` (preview) and `narrateDriftEntity` (drift) are near-duplicate
functions over near-identical inputs — `DriftEntityChange` is structurally
`EntityChange` + `section` + `category` (verified `drift/types.ts:45-53`). Two independent
phrasing paths over the same diff atoms is the precise failure mode the issue's binding
constraint ("sync narration should use the SAME diff data as sync preview") exists to
prevent. Divergence here means the drift page and the preview page describe the same field
change differently.

Fix: `narrateDriftEntity` should normalize its input to the shared entity shape and
delegate to one internal core; `category` contributes only a prefix/tone. This also
resolves the minor API-shape inconsistency where `narrateEntityChange` takes `section` as
a separate parameter while `narrateDriftEntity` reads it off the change.

### S4. Stated gates miss `check:client` — the four `.svelte` edits go type-unchecked

Testing Strategy claims `deno task check` "type-checks the tests, which type-check the
route/component imports." That is inaccurate for this repo: routes are excluded from
`deno check`, and `.svelte` files are type-checked by `svelte-check` (`deno task
check:client`), not `deno check`. A pure-engine test's `deno check` pass proves nothing
about the four edited components. As written, the design's required-gate list would let
type errors in the `.svelte` edits through.

Fix: add `deno task check:client` (svelte-check) to the required gates for this PR and
state that the engine test only covers `narrate.ts`/`templates.ts`/`types.ts`.

### S5. Action/field/pluralization phrasing already exists in the components — converge or the two diverge

The components already own presentational phrasing the engine re-implements:
`SyncPreviewEntityDiff.svelte:74` computes `summaryText` ("1 field change" /
"N field changes") — the design's "field pluralization" test case duplicates it; the
same file's `ACTION_META` owns create/update/delete labels; `fieldChangeDisplay.ts`
owns field-change labels. After this PR, a badge can say "Update" while the narration
headline says something subtly different, and both are sources of truth.

Fix: state explicitly that badges stay the short presentational token and narration owns
the sentence, and where practical source the action label from one place. At minimum,
delete the now-redundant `summaryText` in favor of the engine output on the surface you
keep.

## Nits

- **N1. `NarrationProvenance` is a defined-but-unwired export** (design admits mild YAGNI).
  An exported-but-unused type invites "no dead code" review churn. Either drop it from this
  PR entirely (re-add in the #25 PR that wires it) or add one test that references it so it
  is not literally dead.
- **N2. `resolveReasonExplanation` takes no `arrType`.** Defensible — drift reasons
  (`unreachable`/`timeout`/`unauthorized`) are transport-level, not domain semantics — but
  the cross-Arr checklist requires justification. Add one sentence stating reasons are
  connection-level and intentionally Arr-agnostic, so a reviewer running the checklist does
  not flag it.
- **N3. `formatFieldValue` dedup deferral is correct** (the dup at
  `SyncPreviewEntityDiff.svelte:68` vs `fieldChangeDisplay.ts:20` is real and verbatim).
  Keeping it out of this PR is the right call; no action, noted for completeness.
- **N4. `NARRATION_TEMPLATE_VERSION = '1'` bump discipline is convention-only.** Acknowledged
  in Risks. Consider a trivial test asserting the constant is non-empty and every emitter
  stamps it (already planned) — the residual risk is acceptable for v1.

## Verdict

**Approve with required changes.** The architecture is correct and the anti-recompute /
no-endpoint / pure-`$shared` posture is the right one — this is a genuinely good foundation
design, not a rewrite candidate. But it must not ship as specified:

1. Add the missing pure summary/rollup function (**B1**) — otherwise the headline surface
   is untestable and re-tallies counts, defeating the stated goal.
2. Cut to one surface, drift (**B2**) — to honor the one-PR / at-least-one-surface
   constraint and keep the diff reviewable.

Then land S1–S4 (brittle error narration, duplicated version constant, single entity-core,
correct gate list) before merge. S5 and the nits are cleanup that can ride along. With B1
and B2 addressed the PR is a clean, testable foundation that later features plug into
unchanged — which is exactly what the issue asks for.
