# Recommendations: Transparent Automation Engine Completion

## Executive Summary

Complete issue #21 by extending the foundation from PR #213 across the three surfaces that already
possess authoritative decision evidence: Sync Preview, Quality Goals, and Resolved Config. Do not add a
second explanation system, dependency, or persistence model.

The recommended implementation is one reviewable completion slice:

1. extend `$shared/narration` with pure sync-summary, section-outcome, batch-entity, and safe-error
   narrators;
2. render those lines in the existing sync-preview components with accessible summary/verbose disclosure;
3. emit one bounded, sanitized Quality Goals decision event from the same `GoalPlan` used for apply;
4. explain proven resolved-config layer provenance (`base-side`, `user-override`, `user-created`, and
   `ambiguous`) without claiming exact database-default lineage;
5. add contextual explanations to the touched automation controls/results;
6. create an exhaustive automation-transparency audit, enforced against registered `JobType` values and
   direct mutators; and
7. update ROADMAP and issue tracking with explicit follow-ups for prerequisite-blocked outcomes.

Two items should not be forced into this PR. Current sync results do not prove actual per-entity write
outcomes, and current PCD replay cannot distinguish implicit schema/database defaults from explicit base or
tweaks values. Pretending otherwise would violate the feature's purpose. Move these to linked follow-ups
with concrete acceptance criteria, as issue #21 explicitly permits.

## Implementation Recommendations

### Recommended approach

#### 1. Extend the existing pure narration engine

Add pure functions that consume existing records without fetching, diffing, or retallying:

- `narrateSyncPreviewSummary(summary, level)`;
- `narrateSyncSectionOutcome(outcome, level)`;
- `narrateEntityChanges(changes, arrType, section, level)`; and
- a safe free-form error wrapper that does not substring-classify upstream messages.

The batch function must delegate to the existing `narrateEntityChange`. Summary counts must come directly
from `SyncPreviewSummary`. New phrasing requires a single `NARRATION_TEMPLATE_VERSION` bump.

#### 2. Integrate narration into Sync Preview

Keep `SyncPreviewPanel` as the host of one surface-wide summary/verbose toggle. Show:

- a visible **Planned changes** summary;
- complete versus partial section coverage;
- per-section skipped/failure explanations;
- per-entity decision narration above the existing raw field table; and
- safe load/apply error framing.

Do not hide partial coverage, destructive warnings, or staleness behind verbose mode. Add `aria-expanded`
and, where useful, `aria-controls` to narration and entity disclosures. Preserve the existing typed delete
confirmation and raw current/desired values.

The current apply implementation and OpenAPI description should be aligned to the coarse result the route
actually returns. UI wording must distinguish **Planned changes** from **Apply result** and must not claim
the exact entity actions were confirmed.

#### 3. Record Quality Goals rationale server-side

Build a pure allowlist mapper from the exact `GoalPlan` used by apply. Emit one structured event only after
both scoring ops and binding persistence succeed. Include:

- event name, target IDs/names, explicit `arrType`, preset and engine version;
- thresholds and coverage;
- bounded per-decision score and machine-readable `GoalReason`; and
- uncategorized count/reason information.

Keep the event bounded: cap decision entries, record an omitted count, truncate long operational names,
and pass nested metadata through the existing sanitizer. Exclude URLs, credentials, headers, raw request
bodies, SQL, arbitrary configuration values, and regex contents. The authenticated API/UI remains the
place for the complete plan; the log is the durable server rationale, not a duplicate config store.

#### 4. Surface only proven resolved-config provenance

Use the existing base-versus-resolved diff to explain:

- **Base-side**: not changed by a user override;
- **User override**: field/path changed by user ops;
- **User-created**: resolved entity has no base entity; and
- **Ambiguous**: pending value-guard conflict.

Explain that base-side currently combines schema, base, and tweaks replay. Do not emit
`database-default` or exact op attribution. For nested changes, show the precise changed path in detail and
mark the containing field as user-modified without inventing child lineage.

#### 5. Make the workflow audit enforceable

Create a durable audit matrix with one row per current `JobType` plus direct automated mutators such as
sync-preview apply, Quality Goals apply, and rollback. Required columns:

- trigger/settings and target scope;
- exposed inputs;
- exposed decisions/skips;
- outputs and planned-versus-actual granularity;
- sanitized failure reason and recovery action;
- evidence surface; and
- disposition: Pass, Partial, Gap, Not Applicable, or linked follow-up.

Add a compile/test-time completeness guard so a new `JobType` cannot land without an audit entry. Prefer a
small typed/static manifest plus a checked-in human-readable audit, rather than a runtime audit service.
Every Partial or Gap must link an issue with explicit acceptance criteria before #21 closes.

### Technology choices

- Reuse TypeScript, Svelte, existing OpenAPI types, logger/sanitizer, `NarrationBlock`, badges, alerts,
  field-change presentation, and current route guards.
- Add no runtime dependency, telemetry SDK, markdown renderer, or parallel DTO family.
- Render narration with escaped Svelte interpolation only; do not use `{@html}`.
- Keep explicit `arrType` dispatch and literal fallback for unmapped labels.
- Add no database migration for the in-scope work.

### Quick wins

- Add `aria-expanded` to the existing drift verbose toggle and entity disclosures while applying the same
  corrected pattern to Sync Preview.
- Replace ambiguous success copy with visible planned/apply stage headings.
- Render section failures from existing `sectionOutcomes` immediately.
- Move Quality Goals friendly reason wording to a shared/canonical mapper rather than leaving business copy
  only in the UI.
- Add layer help text and honest unavailable/ambiguous provenance states to Resolved Config.

## Improvement Ideas

- Return a sync-history ID from apply so the immediate result can deep-link to one durable run record.
- Add changed-only, failed-only, and user-override-only filters for large result sets.
- Provide responsive stacked diff rows on narrow screens while retaining table comparison on desktop.
- Add a user-safe "Copy explanation" export that excludes credentials and sensitive raw values.
- Persist summary/verbose preference only after the pattern stabilizes through use.
- Add queryable Quality Goals decision history as a separate product feature if structured log retention is
  insufficient.
- Eventually compare reviewed plan with confirmed per-entity outcomes once that evidence exists.

## Risk Assessment

| Risk                                                                                       | Severity            | Mitigation                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------- |
| Planned entity changes are narrated as completed                                           | Critical trust risk | Use stage-specific types/copy; defer entity success until actual outcomes exist.                     |
| Preview apply is described as an exact saved-plan execution when it re-enters section sync | High                | Correct contract/copy now; follow up on binding execution to reviewed inputs.                        |
| Free-form errors leak internals or are misclassified across Arr apps                       | High                | Use closed codes where available; otherwise generic sanitized frame, no substring inference.         |
| Goal decision logs expose configuration strategy or grow unbounded                         | High                | Allowlist, cap, truncate, sanitize, retain one event per apply, preserve existing rotation.          |
| Narration/provenance strings introduce XSS                                                 | High                | Plain escaped interpolation; prohibit unsafe HTML/Markdown rendering for operational text.           |
| Database-default provenance is inferred from absence of an override                        | High                | Use base-side wording; create lineage follow-up.                                                     |
| Cross-Arr label or behavior is borrowed from a sibling app                                 | High                | Explicit exhaustive `arrType`, per-Arr tests, literal fallback, fail closed on unsupported behavior. |
| Audit becomes stale prose                                                                  | Medium              | Typed exhaustive manifest and test against `JobType`; follow-up required for every gap.              |
| Verbose rendering/logging causes large DOM or event payloads                               | Medium              | Summary default, collapse unchanged items, cap details, record omitted counts.                       |
| Duplicate live regions create screen-reader noise                                          | Medium              | One polite atomic status per async operation; reserve alerts for urgent failures.                    |

### Integration challenges

- Sync Preview can be narrated without API changes, but its apply response contract drift should be fixed
  contract-first.
- Resolved provenance may require a second layer read unless the response is extended. Choose a
  contract-first proven-source field only if it avoids repeated base replay and remains measurably bounded.
- Quality Goals logging must occur after the complete successful transaction sequence; a failed binding
  write must not produce an "applied" decision event.
- Audit coverage spans job and non-job operations; stable workflow IDs are required to avoid duplicate or
  missing rows.

### Performance and security

Narration should remain O(supplied records), with no additional Arr calls or diff runs. Log one bounded goal
event, not one event per custom format. Never rebuild a base cache per field. Preserve authentication,
same-origin calls, rate limits, preview TTL/store limits, secret redaction, and existing CSP.

## Alternative Approaches

| Option                                                         | Pros                                                          | Cons                                                                          | Effort    | Recommendation        |
| -------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------- | --------------------- |
| Extend current pure engine and surfaces                        | Minimal architecture, testable, no new dependency/persistence | Requires careful stage language and follow-ups                                | Medium    | **Choose**            |
| Return narration strings from server APIs                      | Centralized output for clients                                | Duplicates existing records, transport-couples wording, API churn             | Medium    | Reject                |
| Implement per-entity outcomes and exact lineage in the same PR | Completes every aspiration immediately                        | Crosses every syncer/compiler path; high semantic and review risk             | Very high | Reject for this slice |
| Documentation-only audit and UI copy                           | Fast                                                          | Does not deliver narration, rationale, provenance, or enforce future coverage | Low       | Reject                |
| Log the entire `GoalPlan`/request                              | Maximum forensic detail                                       | Sensitive, unbounded, duplicates state, retention risk                        | Low       | Reject                |
| Add a universal automation event store now                     | Queryable history                                             | New schema/system before event contracts stabilize; overlaps domain history   | High      | Defer                 |

## Task Breakdown Preview

### Phase 0 — Contract and audit baseline (medium)

- Define planned/attempted/confirmed language and truth boundaries.
- Align the coarse preview-apply OpenAPI/runtime response.
- Inventory `JobType` and direct mutators; draft audit dispositions.
- Create the two prerequisite follow-up issues with explicit acceptance criteria.

### Phase 1 — Pure narration v2 (medium)

- Add summary, section-outcome, batch-entity, and safe-error narrators.
- Bump template version once.
- Add unit tests for exact supplied totals, partial/skipped coverage, all sections, error safety, and
  cross-Arr literal fallback.

### Phase 2 — Sync Preview UX (medium)

- Add Planned changes decision log and one accessible verbose toggle.
- Pass `arrType`, section, and narration state to entity rows.
- Preserve raw diffs, delete confirmation, staleness, and request-generation guards.
- Test no-change plus failed-section, stale, destructive, partial, keyboard, and live-status cases.

### Phase 3 — Goal rationale and resolved provenance (medium)

- Add bounded goal decision-log mapper and post-success emission tests.
- Canonicalize friendly Quality Goals rationale.
- Add proven base/user/user-created/ambiguous explanations and tests.
- Add XSS, secret-shaped data, nested override, and pending-conflict regression cases.

### Phase 4 — Contextual explanations and audit closure (medium)

- Add minimum context to touched settings/result surfaces: behavior, scope, trigger, side effect, disabled
  behavior, evidence link, and recovery.
- Finalize audit matrix and exhaustive guard.
- Create targeted follow-ups for every remaining Partial/Gap row; avoid an unbounded umbrella issue.
- Update ROADMAP and issue #21 links/status.

### Phase 5 — Validation and review (medium)

- Run focused narration/goals/resolved/component tests, API generation if changed, check, lint, full tests,
  build as appropriate, and graph update.
- Review specifically for truthfulness, cross-Arr semantics, accessibility, redaction, and audit
  completeness.

Dependencies: Phase 0 precedes UI claims; Phase 1 precedes Phase 2; Phase 3 can run after Phase 0; Phase 4
depends on the completed audit and follow-up issue links.

## Explicit Follow-up Split

### F1 — Confirmed per-entity post-apply sync outcomes

Acceptance criteria:

- every section syncer emits one actual outcome per attempted entity;
- outcome status comes from the Arr write result, never preview intent;
- stable entity identity, action, terminal status, sanitized reason, and explicit `arrType` are recorded;
- apply API and Sync History expose/persist the outcomes;
- UI narrates confirmed success, partial, failed, and skipped entities; and
- tests prove preview records are never used as confirmation.

### F2 — Exact schema/default/base/tweaks/user field lineage

Acceptance criteria:

- replay records the field path and last establishing source/op;
- implicit schema defaults differ from explicit values equal to the default;
- schema-default, base-op, tweaks-op, and user-op are distinct;
- dropped/conflicted/pending value-guard outcomes do not receive false lineage;
- API/UI expose lineage for nested fields and every supported entity/Arr mapping; and
- tests reject inference from absence of a user override.

### F3 — Audit-discovered workflow gaps

Create one targeted issue per coherent workflow gap (or tightly related group). Each issue must identify
the missing input, decision, output, and/or failure surface; name the evidence source; define user-facing
acceptance criteria; and add a regression guard. No unlinked Partial/Gap row may remain when #21 closes.

## Key Decisions Needed

1. Confirm structured sanitized logs are sufficient for in-scope Quality Goals server rationale; treat
   queryable history as a separate feature.
2. Use **Base-side** rather than **Database default** until lineage exists.
3. Correct apply contract/copy now, while F1 owns actual per-entity outcomes.
4. Use one global verbose toggle per surface, with critical warnings always visible.
5. Make the audit manifest exhaustive at test time and keep the human audit document as review evidence.
6. Bump narration template version for the new sync vocabulary; keep it separate from Goals engine/API
   versions.

## Open Questions

1. Should apply return a Sync History ID now even before per-entity outcomes are available?
2. Is proven base/user provenance best returned contract-first or derived from a second authenticated layer
   read? Measure replay cost before choosing.
3. What decision-entry cap and retention window balance Quality Goals supportability with operational data
   minimization?
4. Which audit gaps are small enough to fix in this PR versus targeted F3 issues? Decide only from the
   completed evidence matrix.
5. Should preview apply eventually become a true saved-plan execution contract, or remain a fresh section
   sync with clearer wording? F1 should resolve this alongside outcome correlation.
