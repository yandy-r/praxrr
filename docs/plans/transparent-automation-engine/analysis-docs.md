# Documentation Analysis: Transparent Automation Engine

## Executive Summary

The documentation work has three distinct purposes: preserve the evidence
contract implementers must follow, document the completed automation audit, and
close issue/roadmap tracking with explicit follow-ups for facts Praxrr cannot
yet prove. Existing issue #21 design artifacts describe the shipped foundation
and should remain historical; the new `feature-spec.md` is the source of truth
for this completion slice.

The largest contract gap is already visible in checked-in API docs: sync-preview
apply is documented as returning `SyncPreviewResult`, while current runtime
behavior returns a coarse apply/job result. Documentation must not paper over
that mismatch or invent per-entity outcomes. Any correction must update modular
OpenAPI source, generated types, route/client behavior, and tests together.

## Must-Read Documents

- `CLAUDE.md`: **Required** — repository commands, contract-first API workflow,
  documentation/PR template rules, cross-Arr semantic validation,
  portable-contract fidelity, and graph update policy.
- `docs/plans/transparent-automation-engine/feature-spec.md`: **Required and
  authoritative for this slice** — scope, business rules, evidence limits,
  success criteria, proposed files, UX, risks, and required follow-up ownership.
- `docs/plans/issue-21/design.md`: **Required historical baseline** — PR #213
  narration architecture, template versioning, summary/verbose model, and
  authoritative final scope for the foundation.
- `docs/plans/issue-21/plan.md`: **Required historical baseline** — files,
  tests, and sequencing used to ship the foundation; do not re-execute its
  completed tasks.
- `docs/plans/issue-21/design-critique.md`: **Required for regressions** —
  adversarial review of recomputation, cross-Arr labels, renderer ownership, and
  over-explanation risks.
- `docs/plans/issue-21/research.md`: **Required but time-scoped** — original
  code map and preview/apply granularity gap. Statements such as “no shared
  narration primitive” are historical and superseded by PR #213.
- `docs/api/v1/paths/sync.yaml`: **Required API contract** — preview
  create/get/delete/apply behavior, errors, rate-limit semantics, and the
  currently suspect apply success response.
- `docs/api/v1/schemas/sync.yaml`: **Required data contract** — authoritative
  summary, `sectionOutcomes`, `EntityChange`, `FieldChange`, stage status, and
  current/desired direction.
- `docs/api/v1/paths/goals.yaml` and `docs/api/v1/schemas/goals.yaml`:
  **Required for Quality Goals** — canonical plan/reason, engine-version guard,
  preview/apply/binding contracts, and fields safe to describe in decision
  logging.
- `docs/api/v1/paths/resolved-config.yaml` and
  `docs/api/v1/schemas/resolved-config.yaml`: **Required for provenance** —
  exact base/user/resolved meanings, user override diff, pending-conflict
  signal, Arr-specific entity shapes, and sanitized live-diff failures.
- `docs/api/v1/paths/sync-history.yaml` and
  `docs/api/v1/schemas/sync-history.yaml`: **Required for result truthfulness**
  — durable run/section outcomes and the fact that recorded changes are
  pre-write intended changes, not confirmed per-entity results.
- `docs/api/v1/openapi.yaml`: **Required when any API shape changes** — modular
  OpenAPI root and component/path registration source of truth.
- `ROADMAP.md`: **Required tracking surface** — currently records #21 as
  foundation-only and must be updated after implementation, audit disposition,
  and follow-up issue creation are complete.

## Architecture Docs

- `docs/plans/transparent-automation-engine/analysis-architecture.md`: maps the
  current evidence flows, critical code boundaries, cross-cutting constraints,
  and dependency-aware work batches.
- `docs/plans/transparent-automation-engine/research-external.md`: documents
  internal/upstream API constraints, plan/apply precedent, no-new-dependency
  decision, and precise prerequisite boundaries.
- `docs/plans/transparent-automation-engine/research-security.md`: defines log
  minimization/redaction, XSS-safe rendering, cross-Arr integrity, provenance,
  and audit safety requirements.
- `docs/plans/transparent-automation-engine/research-practices.md`: identifies
  reusable modules, KISS boundaries, exhaustive audit pattern, test strategy,
  and build-versus-depend decisions.
- `docs/internal-docs/quality-goals/design.md`: background for the existing
  reason schema and generated-config transparency; useful when verifying that
  server logging consumes the exact plan.
- `docs/plans/resolved-config-viewer/feature-spec.md`: background for resolved
  layer semantics and scope; current OpenAPI and implementation remain
  authoritative where the old plan differs.

## Reading List

### Priority 1 — Before Editing

1. `CLAUDE.md`.
2. `docs/plans/transparent-automation-engine/feature-spec.md`.
3. The “Final Scope” and contracts in `docs/plans/issue-21/design.md` plus the
   critique.
4. `docs/api/v1/schemas/sync.yaml`, goals schemas, resolved-config schemas, and
   sync-history schemas.
5. `ROADMAP.md` issue #21/archive rows.

### Priority 2 — Before Surface-Specific Work

1. Sync Preview implementer: `docs/api/v1/paths/sync.yaml`, issue #7
   requirements, and issue #21 research on the apply granularity gap.
2. Quality Goals implementer: goals path/schema docs and
   `docs/internal-docs/quality-goals/design.md`.
3. Provenance implementer: resolved-config path/schema docs and resolved-config
   feature spec.
4. Audit implementer: feature-spec audit rules, `JobType` inventory documented
   in the architecture analysis, and current job/display/history behavior.

### Priority 3 — Review and Closeout

1. `research-security.md` for adversarial logging/rendering review.
2. `research-practices.md` for KISS, exhaustive test, and no-new-dependency
   checks.
3. All created follow-up issues and their acceptance criteria.
4. Updated API source/generated types, automation audit, `ROADMAP.md`, issue #21
   checklist, and PR template body as one consistency pass.

### Nice to Have

- Terraform plan/apply documentation for stage language.
- WAI disclosure pattern for the summary/verbose control.
- OWASP logging guidance for rationale event review.
- Older resolved-config and Quality Goals research artifacts when a current
  contract is ambiguous.

## Documentation Gaps

### Must Be Written or Updated in This Change

1. **Automation transparency audit**: create one durable checked-in matrix
   covering every queued `JobType` and every material direct mutator. Each row
   must identify inputs, decisions, outputs, user-facing failure reason,
   evidence path/test, and disposition (`pass`, `not-applicable`, or linked
   follow-up). Use the repository's established `docs/internal-docs/` convention
   unless the plan explicitly standardizes a new `docs/internal/` directory.
2. **ROADMAP completion record**: update the archive/history row with the
   completed sync-preview narration, Quality Goals server rationale, proven
   resolved provenance, audit, and follow-up issue numbers. Change the P3 #21
   row from “foundation shipped; remaining follow-ups” to the verified
   completion disposition without claiming blocked prerequisites shipped.
3. **Issue #21 checklist**: mark implemented items complete and link the
   prerequisite issues for confirmed per-entity apply outcomes and exact
   schema/default/op lineage. Every audit gap must also link to a templated
   engineering issue with pass/fail acceptance criteria.
4. **Follow-up issues**: use `.github/ISSUE_TEMPLATE/`; do not create free-form
   bodies. Minimum known ownership is (a) actual per-entity sync outcomes
   correlated to reviewed preview and Sync History, and (b) exact nested-field
   lineage across schema/base/tweaks/user/default sources. Add targeted
   audit-gap issues only after the audit provides evidence.
5. **PR body**: use the repository PR template via `--body-file`; describe
   planned-versus-actual limits, audit dispositions, cross-Arr checklist, tests,
   ROADMAP update, and issue-closing linkage.

### API Documentation Gaps

1. **Preview apply response mismatch**: `paths/sync.yaml` says a successful
   apply returns `SyncPreviewResult`; runtime currently returns a coarse
   `{success, results, staleWarning}` shape. Decide and document one truthful
   contract. Do not add per-entity result fields until execution emits them.
2. **Stage language**: API descriptions and UI-facing documentation should
   consistently call preview rows “planned changes” and reserve
   applied/succeeded wording for proven result records.
3. **Error semantics**: document which errors are closed sanitized reasons
   versus free-form generic detail. Avoid promising diagnosis from string
   matching.
4. **Generated artifacts**: if an API shape changes, regenerate/check
   `packages/praxrr-app/src/lib/api/v1.d.ts` and follow the repository's
   publish-mirror policy for `packages/praxrr-api/openapi.json`; do not
   hand-edit one contract surface in isolation.

### Existing Documentation That Is Stale but Should Remain Historical

- `docs/plans/issue-21/research.md` predates PR #213 and says no shared
  narration primitive exists. Add no retroactive rewrite unless a small status
  banner is desired; the foundation PR/design docs already establish chronology.
- The original issue #21 design/plan intentionally scoped only the foundation.
  Do not mutate its final scope to make it appear that the completion slice was
  part of PR #213.
- `ROADMAP.md` currently reports the correct foundation state but becomes stale
  once this completion PR and follow-up issues exist; update it only with
  verified final evidence and real issue/PR links.

### Validation and Consistency Gates

- Run the repository documentation formatter/linter on all changed
  Markdown/YAML.
- Validate modular OpenAPI references and regenerate types when API source
  changes.
- Search for contradictory “applied exactly,” “per-entity succeeded,” and
  “database default” claims.
- Verify every audit `follow-up` URL resolves to a real issue with explicit
  acceptance criteria.
- Verify every current `JobType` appears in both the typed registry and human
  audit, and direct mutators are separately inventoried.
- Confirm `ROADMAP.md`, issue #21, follow-up issues, PR body, audit document,
  and shipped behavior use the same completion language.
