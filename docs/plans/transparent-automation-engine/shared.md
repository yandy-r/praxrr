# Transparent Automation Engine Completion

Issue #21 completes as an evidence-rendering and governance layer over existing
sync, Quality Goals, Resolved Config, and job subsystems—not as a new automation
runtime. `$shared/narration` remains the single pure, versioned wording
boundary; Svelte pages compose that output beside raw evidence; server-only code
adds one bounded Goals decision event and an exhaustive audit registry. Planned
preview records, coarse section results, and resolved layers retain their
existing truth limits, with confirmed per-entity outcomes and exact default/op
lineage assigned to explicit follow-ups.

## Relevant Files

- `packages/praxrr-app/src/lib/shared/narration/types.ts`: narration contract
  and single template version.
- `packages/praxrr-app/src/lib/shared/narration/templates.ts`: cross-Arr labels
  and safe phrasing registry.
- `packages/praxrr-app/src/lib/shared/narration/narrate.ts`: pure
  evidence-to-narration functions.
- `packages/praxrr-app/src/lib/shared/narration/index.ts`: public narration
  exports.
- `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`: table-driven
  narration coverage.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`: authoritative
  planned summary/outcome/diff atoms.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`:
  preview lifecycle and summary surface.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte`:
  entity/raw field-diff surface.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`:
  coarse apply-result boundary.
- `docs/api/v1/paths/sync.yaml`: portable sync endpoint contract.
- `docs/api/v1/schemas/sync.yaml`: portable sync response schemas.
- `packages/praxrr-app/src/lib/shared/goals/types.ts`: canonical
  GoalPlan/GoalReason contracts.
- `packages/praxrr-app/src/routes/api/v1/goals/apply/+server.ts`: post-success
  decision-event insertion point.
- `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`: recursive
  secret-redaction boundary.
- `packages/praxrr-app/src/lib/server/pcd/resolved/layerDiff.ts`: proven
  base-versus-user override evidence.
- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`:
  resolved layer presentation.
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: closed
  queued-workflow type inventory.
- `packages/praxrr-app/src/lib/server/jobs/queueRegistry.ts`: production
  job-handler registrations.
- `ROADMAP.md`: durable issue completion and follow-up tracking.

## Relevant Tables

- `quality_goal_bindings`: latest applied goal intent; not a historical
  decision-event store.
- `job_runs`: queued-job status, timing, output, and error evidence used by the
  audit.
- `sync_history`: durable trigger, section outcomes, counts, timing, errors, and
  pre-write planned changes.
- `pcd_ops`: append-only base/user operations replayed into resolved state;
  current rows do not retain per-field default lineage.

## Relevant Patterns

**Pure Evidence Renderer**: Narrators accept already-computed typed records and
return immutable `NarrationLine` values without fetching, diffing, tallying, or
persistence. See `packages/praxrr-app/src/lib/shared/narration/narrate.ts`.

**Single Core Delegation**: Specialized drift/preview narrators normalize and
delegate entity phrasing to `narrateEntityChange`, avoiding wording drift across
surfaces.

**Explicit Cross-Arr Fallback**: Narration receives explicit `arrType`; verified
mappings are per app and unknown fields fall back to literal names. See
`templates.ts` and the repository cross-Arr policy.

**Host-Owned Disclosure**: `NarrationBlock.svelte` stays presentational while
each surface owns its summary/verbose state. Follow the `aria-expanded` pattern
in `packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte`.

**Bounded Post-Success Logging**: Build allowlisted metadata from the exact
server-generated plan, cap arrays/strings, then emit once after all writes
succeed through the existing sanitized logger.

**Diff as Provenance Evidence**: Base-versus-resolved `FieldChange` records
prove user overrides; base-absent/resolved-present proves user-created; pending
conflict forces ambiguity. Absence of an override does not prove a database
default.

**Exhaustive Closed Registry**: Use `satisfies Record<JobType, ...>` and runtime
parity tests so a new job cannot bypass transparency review.
`packages/praxrr-app/src/lib/shared/arr/parity.ts` is the type pattern.

**Contract-First Portable API**: When the apply response changes, update modular
OpenAPI source, generate app/package artifacts, then type the route/client
against generated schemas.

## Relevant Docs

**`CLAUDE.md`**: You _must_ read this for project conventions, portable contract
fidelity, and cross-Arr rules.

**`docs/plans/transparent-automation-engine/feature-spec.md`**: You _must_ read
this for binding scope, truth boundaries, acceptance criteria, risks, and
required follow-ups.

**`docs/plans/issue-21/design.md`** and **`design-critique.md`**: You _must_
read the foundation's accepted architecture and deferred preview/error
constraints; do not rewrite its historical scope.

**`docs/api/v1/paths/sync.yaml`** and **`docs/api/v1/schemas/sync.yaml`**: You
_must_ read these before any preview-apply response change and keep generated
artifacts in lockstep.

**`docs/internal-docs/quality-goals/design.md`**: You _must_ read this before
logging or changing GoalReason wording so the exact applied plan remains
authoritative.

**`docs/plans/resolved-config-viewer/feature-spec.md`**: You _must_ read this
for current layer semantics; runtime types remain authoritative when historical
plans differ.

**`.github/ISSUE_TEMPLATE/engineering-task.yml`** and
**`.github/PULL_REQUEST_TEMPLATE.md`**: You _must_ use these structures for
follow-up issues and the completion PR.
