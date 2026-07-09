# Feature Spec: Transparent Automation Engine Completion

## Executive Summary

Complete issue #21 by extending PR #213's pure narration foundation across Sync
Preview, Quality Goals, and Resolved Config. Preview narration will render
supplied evidence without recomputation; Quality Goals will log a bounded,
sanitized event from the applied `GoalPlan`; and Resolved Config will explain
only proven base-side, user-override, user-created, and ambiguous states. An
exhaustive automation audit will cover every registered job and material direct
mutator, linking each gap to explicit acceptance criteria. Confirmed per-entity
apply outcomes and exact schema/default/op lineage remain prerequisite
follow-ups because current contracts do not contain that evidence.

## External Dependencies

### APIs and Services

No new external API or service is required. The implementation consumes existing
authenticated Praxrr APIs and retains current explicit Arr dispatch:

- `POST /api/v1/sync/preview` and `GET /api/v1/sync/preview/{previewId}` provide
  the authoritative planned summary, section outcomes, and entity/field diffs.
- `POST /api/v1/goals/preview` and `/apply` provide the canonical `GoalPlan` and
  `GoalReason` records used for both display and server decision logging.
- `GET /api/v1/pcd/{databaseId}/resolved/{entityType}[/{name}]` provides layer
  state and base-versus-user evidence.
- Radarr, Sonarr, and Lidarr remain behind the existing Arr clients. Official
  contracts:
  [Radarr OpenAPI](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/openapi.json),
  [Sonarr OpenAPI](https://github.com/Sonarr/Sonarr/blob/v5-develop/src/Sonarr.Api.V3/openapi.json),
  and
  [Lidarr OpenAPI](https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/openapi.json).

### Libraries and SDKs

No new library is permitted. Reuse `$shared/narration`, `NarrationBlock.svelte`,
generated OpenAPI types, the existing logger and sanitizer, resolved-layer
services, and the job registry.

### External Documentation

- [Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan):
  strict plan/apply language and stale-plan precedent.
- [WAI disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/):
  accessible `aria-expanded` disclosure behavior.
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html):
  allowlisted, bounded, sanitized decision metadata.

## Business Requirements

### User Stories

- As an operator, I want a concise explanation of what Praxrr plans to change
  and why before I approve a sync.
- As an operator, I want planned, attempted, partial, and confirmed states kept
  distinct so I never mistake intent for a successful write.
- As a Quality Goals user, I want the exact structured rationale behind
  generated scores preserved server-side as well as visible in the UI.
- As a Resolved Config user, I want provenance claims limited to sources Praxrr
  can prove and ambiguity called out instead of guessed.
- As a maintainer, I want every automated workflow audited for inputs,
  decisions, outputs, and failure reasons, with exhaustive coverage when new
  jobs are added.

### Business Rules

1. **Narration renders evidence**: it never fetches, re-diffs, re-tallies, or
   infers a missing outcome.
2. **Stages are distinct**: preview entities are always planned; confirmed
   entity wording requires an actual per-entity outcome record.
3. **Summary first**: one surface-level disclosure reveals material details
   while warnings, destructive actions, incomplete coverage, and stage labels
   remain visible.
4. **Partial coverage is explicit**: skipped or failed sections prevent
   whole-preview success or "up to date" claims.
5. **Errors are safely framed**: closed reason codes may receive specific copy;
   free-form errors are never substring-classified into a stronger diagnosis.
6. **Cross-Arr semantics are explicit**: every narrator receives `arrType`;
   unknown labels fall back literally and never borrow a sibling-app term.
7. **Goal rationale is canonical**: logs and UI consume the same `GoalReason`;
   arithmetic must match the generated score.
8. **Provenance is evidence-based**: base-side, user override, user-created, and
   pending-conflict ambiguity are allowed; database-default and exact op
   attribution are not claimed without lineage.
9. **Audit is a closure gate**: every current job/direct mutator is Pass, Not
   Applicable with rationale, or linked to a follow-up with explicit acceptance
   criteria.

### Edge Cases

| Scenario                             | Expected Behavior                                   | Notes                                       |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------------- |
| Zero changes with one failed section | Report incomplete preview, never fully up to date   | Trust supplied section outcomes             |
| Focused/filtered section view        | Whole-preview narration still uses supplied summary | Do not re-tally visible rows                |
| Unknown Arr field/entity label       | Display literal raw name                            | Never sibling fallback                      |
| Free-form preview/apply error        | Generic safe frame plus already-sanitized detail    | No substring classification                 |
| Goal decision list exceeds log cap   | Record bounded prefix and omitted count             | Full plan remains in authenticated response |
| Resolved entity absent from base     | Mark user-created                                   | Not a base override                         |
| Pending value-guard conflict         | Mark provenance ambiguous                           | Preserve conflict warning                   |
| Entity apply outcomes unavailable    | Show section outcome and planned entity detail only | Owned by follow-up                          |

### Success Criteria

- [ ] Sync Preview has summary, section, and per-entity narration derived solely
      from its loaded `SyncPreviewResult`.
- [ ] Incomplete, skipped, stale, destructive, and no-change states remain
      truthful and accessible.
- [ ] Quality Goals emits one bounded, sanitized post-success decision event
      from the exact applied `GoalPlan`.
- [ ] Resolved Config explains proven layer provenance and explicitly withholds
      unsupported database-default claims.
- [ ] A typed audit exhaustively covers every `JobType`; the human audit
      dispositions every queued and direct automation workflow.
- [ ] Every remaining Partial/Gap and each prerequisite-blocked checklist item
      links to a structured engineering issue with pass/fail acceptance
      criteria.
- [ ] `ROADMAP.md` records the completed slice and linked follow-ups.

## Technical Specifications

### Architecture Overview

```text
SyncPreviewResult ──> $shared/narration v2 ──> SyncPreviewPanel / EntityDiff
GoalPlan ───────────> bounded decision mapper ──> sanitized logger.meta
Resolved layers ────> proven provenance mapper ──> ResolvedStatePanel
JobType + mutators ─> exhaustive audit registry ──> checked audit document
```

All paths consume existing evidence. No new database table, diff engine, Arr
call, or runtime dependency is introduced.

### Data Models

#### Preview narration inputs

Use existing `SyncPreviewSummary`, `SyncPreviewSectionOutcome`, `EntityChange`,
`FieldChange`, `SyncPreviewArrType`, and `SyncPreviewSection`. Add no parallel
DTO.

#### Goal decision log metadata

| Field                | Type                     | Constraints  | Description                    |
| -------------------- | ------------------------ | ------------ | ------------------------------ |
| event                | `'quality_goal.applied'` | constant     | Stable event class             |
| databaseId           | number                   | integer      | Target PCD database            |
| profileName          | string                   | bounded      | Exact target identifier        |
| arrType              | `GoalArrType`            | explicit     | No sibling fallback            |
| presetId             | string                   | known preset | User intent                    |
| engineVersion        | string                   | required     | Decision-engine version        |
| coverage             | `GoalCoverage`           | copied       | Authoritative coverage         |
| thresholds           | `GoalThresholds`         | copied       | Output thresholds              |
| decisions            | bounded decision array   | allowlisted  | Name, score, structured reason |
| omittedDecisionCount | number                   | non-negative | Entries excluded by cap        |
| uncategorizedCount   | number                   | non-negative | Deliberately untouched formats |

#### Transparency audit registry

```ts
interface TransparencyAuditEntry {
  readonly inputs: readonly string[];
  readonly decisions: readonly string[];
  readonly outputs: readonly string[];
  readonly failureReasons: readonly string[];
  readonly userSurface: string | null;
  readonly disposition: 'pass' | 'not-applicable' | 'follow-up';
  readonly followUpUrl: string | null;
}

const JOB_TRANSPARENCY_AUDIT = { /* every JobType */ }
  satisfies Record<JobType, TransparencyAuditEntry>;
```

### API Design

No new public endpoint is required. Sync Preview narration is
client/shared-derived; Quality Goals logging is internal; provenance can use
existing base/user/resolved responses. If the existing preview-apply
OpenAPI/runtime response mismatch is touched, update the portable spec,
generated types, and route together, but do not add per-entity outcome fields
until execution produces them.

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/goals/decisionLog.ts`: pure bounded
  log-meta mapper.
- `packages/praxrr-app/src/lib/server/jobs/transparencyAudit.ts`: exhaustive
  queued-workflow audit.
- `docs/internal-docs/automation-transparency-audit.md`: verified matrix for
  jobs and direct mutators.
- Focused tests for decision metadata and audit completeness.

#### Files to Modify

- `$shared/narration/{types,templates,narrate,index}.ts`: template version 2,
  preview summary, section-outcome, entity-list, and safe-error functions.
- `SyncPreviewPanel.svelte` and `SyncPreviewEntityDiff.svelte`: planned-decision
  log, one accessible verbose toggle, and per-entity narration without replacing
  raw diffs.
- `goals/apply/+server.ts`: emit one decision event only after scoring and
  binding both succeed.
- `ResolvedStatePanel.svelte`: concise layer/provenance explanations limited to
  proven evidence.
- `ROADMAP.md`: mark completion and list follow-up ownership.

## UX Considerations

### User Workflows

#### Primary Workflow: Review a Narrated Preview

1. Generate preview and show a stable busy status.
2. Show **Planned changes** with target, age, supplied totals, and
   complete/partial coverage.
3. Toggle **Show explanation details** to reveal section and field rationale.
4. Retain raw current/desired tables, stale warnings, destructive warning, and
   typed confirmation.
5. During/after apply, use a separate **Apply result** region and only report
   proven section results.

#### Error Recovery Workflow

1. Preserve successful sections when another section fails.
2. Name the incomplete section and give a retry/regenerate action.
3. Retain stage and freshness labels; never turn planned rows into success
   styling.

### UI Patterns

| Component       | Pattern                       | Notes                          |
| --------------- | ----------------------------- | ------------------------------ |
| Decision log    | Summary then disclosure       | One host-owned verbose toggle  |
| Entity change   | Narration above raw diff      | Existing badge/table retained  |
| Section outcome | Visible status line           | Failure/skipped never hidden   |
| Provenance      | Evidence-backed chip and copy | Ambiguous/unavailable explicit |

### Accessibility Requirements

- Disclosure buttons use `aria-expanded` and an accessible name; add
  `aria-controls` for a stable controlled region where practical.
- Status meaning uses text plus glyph/tone, never color alone.
- Use one polite atomic status per async operation and reserve alerts for urgent
  errors.
- Keep narration outside horizontally scrolling raw tables; preserve keyboard
  and focus behavior.

### Performance UX

- Narration remains O(supplied records); summary mode is default and unchanged
  rows stay collapsed.
- Do not issue additional Arr calls or rebuild base state per field.
- Log one bounded goal event rather than one event per decision.

## Recommendations

### Implementation Approach

1. **Contract/audit baseline**: define planned/confirmed language; inventory
   jobs and mutators; create prerequisite issues.
2. **Narration v2 and preview UX**: add pure functions/tests, then wire the two
   existing components.
3. **Goal rationale and proven provenance**: add bounded logging and contextual
   layer explanations.
4. **Audit closure and roadmap**: finalize evidence rows; create targeted gap
   issues; update tracking.
5. **Validation and review**: focused tests, full checks, graph update,
   adversarial PR review.

### Technology Decisions

| Decision              | Recommendation                          | Rationale                         |
| --------------------- | --------------------------------------- | --------------------------------- |
| Narration transport   | Derive from existing typed records      | Avoid duplicate strings/contracts |
| Error wording         | Safe frame, no free-text classification | Cross-Arr and disclosure safety   |
| Goal rationale record | Existing sanitized logger               | Proportionate, no new store       |
| Provenance precision  | Base-side/user only                     | Matches current evidence          |
| Audit enforcement     | Typed registry plus checked document    | Prevents stale prose              |

### Quick Wins

- Add `aria-expanded` to existing drift and preview disclosures.
- Label preview data **Planned changes** and immediate execution evidence
  **Apply result**.
- Render section skips/errors already present in `sectionOutcomes`.
- Explain base/user/resolved layer composition above the existing Resolved
  Config content.

### Future Enhancements

- Confirmed per-entity outcomes correlated to the reviewed preview and persisted
  in Sync History.
- Exact schema-default/base-op/tweaks-op/user-op lineage for nested field paths.
- Targeted transparency fixes for audit-discovered workflow gaps.

## Risk Assessment

### Technical Risks

| Risk                                      | Likelihood | Impact | Mitigation                                  |
| ----------------------------------------- | ---------- | ------ | ------------------------------------------- |
| Planned changes described as complete     | Medium     | High   | Stage-specific types/copy and follow-up     |
| Free-form error leakage/misclassification | Medium     | High   | Safe framing and sanitizer                  |
| Goal log payload disclosure/growth        | Medium     | High   | Allowlist, cap, truncate, omitted count     |
| False database-default provenance         | High       | High   | Base-side wording; lineage follow-up        |
| Cross-Arr semantic borrowing              | Medium     | High   | Explicit `arrType`, literal fallback, tests |
| Stale audit prose                         | Medium     | Medium | Exhaustive typed registry and parity tests  |

### Integration Challenges

- The preview-apply route and OpenAPI description may not currently describe the
  same coarse response; any correction must remain contract-first.
- Existing resolved layers prove override scope but not exact op/default origin.
- Goal logging must happen after both scoring persistence and binding upsert
  succeed.

### Security Considerations

#### Critical — Hard Stops

| Finding         | Risk | Required Mitigation                                        |
| --------------- | ---- | ---------------------------------------------------------- |
| None identified | N/A  | Preserve the current auth and escaped-rendering boundaries |

#### Warnings — Must Address

| Finding                      | Risk                              | Mitigation                               | Alternatives                              |
| ---------------------------- | --------------------------------- | ---------------------------------------- | ----------------------------------------- |
| Goal metadata retention      | Operational policy disclosure     | Allowlist, bound, sanitize               | Store only codes/counts                   |
| Operational text XSS         | Linked names/fields are untrusted | Plain Svelte interpolation; no `{@html}` | Audited sanitizer only for typed markdown |
| Provenance/outcome overclaim | Unsafe operator decisions         | Render only recorded evidence            | Display unavailable state                 |

#### Advisories — Best Practices

- Keep template and engine versions distinct.
- Include durable correlation IDs when already available.
- Bound verbose detail and announce omitted counts for very large data sets.

## Task Breakdown Preview

### Phase 1: Follow-up and Audit Baseline

**Focus**: Fix the truth boundaries and create closure ownership.

- Inventory every `JobType` and material direct mutator.
- Create confirmed-outcome and exact-lineage issues from the repository
  template.
- Draft typed/human audit entries and identify targeted gap issues.

**Parallelization**: audit inventory and prerequisite issue drafting can run
independently.

### Phase 2: Narration and Preview

**Focus**: Complete the primary user-facing narration surface.

- Extend and test pure narration functions.
- Wire Sync Preview summary/section/entity narration and accessibility.

**Dependencies**: Phase 1 language boundary.

### Phase 3: Rationale and Provenance

**Focus**: Preserve server decisions and explain current resolved layers.

- Add/test bounded Quality Goals decision metadata.
- Add contextual resolved-layer provenance copy and ambiguity handling.

**Parallelization**: Goals and Resolved Config touch separate files.

### Phase 4: Audit Closure and Tracking

**Focus**: Make the philosophy enforceable and close the issue honestly.

- Finalize registry and audit matrix.
- Create targeted issues for every remaining Gap/Partial row.
- Update ROADMAP and issue #21 tracking.

## Decisions Needed

The design adopts these binding decisions for planning:

1. Structured sanitized logs are sufficient for in-scope Quality Goals server
   rationale; queryable goal history is separate work.
2. Use **Base-side** rather than **Database default** until replay lineage
   exists.
3. Correct only truthful coarse apply contracts/copy now; confirmed per-entity
   outcomes are a follow-up.
4. Use one surface-wide verbose toggle with critical warnings always visible.
5. Make queued-job audit coverage exhaustive at compile/test time and audit
   direct mutators in the checked document.

## Research References

- [research-external.md](./research-external.md): APIs, integrations, and
  contract boundaries.
- [research-business.md](./research-business.md): user value, rules, workflows,
  and closure criteria.
- [research-technical.md](./research-technical.md): architecture, data models,
  files, and tests.
- [research-ux.md](./research-ux.md): progressive disclosure, accessibility, and
  stage language.
- [research-security.md](./research-security.md): severity-ranked integrity and
  disclosure risks.
- [research-practices.md](./research-practices.md): reuse, KISS, modularity, and
  testability.
- [research-recommendations.md](./research-recommendations.md): consolidated
  phasing and follow-up split.
