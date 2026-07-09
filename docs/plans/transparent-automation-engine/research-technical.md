# Transparent Automation Engine — Technical Research

## Executive Summary

PR #213 established the correct foundation: a pure, versioned `$shared/narration`
engine, a reusable `NarrationBlock`, and the drift-detail proof surface. The remaining
issue #21 work should extend that foundation, not create a second explanation system.

Three checklist items are implementable from authoritative data already present:

1. Sync-preview narration can consume `SyncPreviewResult.summary`,
   `sectionOutcomes`, and the existing `EntityChange`/`FieldChange` arrays without an
   endpoint or diff-engine change.
2. Quality Goals already computes canonical `GoalReason` records. The apply route can
   emit a sanitized, structured server decision event from that exact plan.
3. Contextual explanations and the workflow audit can be added to the affected
   settings/results and an explicit audit matrix.

Two claims cannot be made truthfully from the current model:

- `SyncResult` exposes section counts and optional failed profile names, not confirmed
  per-entity outcomes. Planned preview changes must not be relabeled as applied results.
- Resolved Config proves base-versus-user differences, but it folds schema, base, and
  tweaks together. It cannot distinguish a SQLite/schema default from an explicitly
  supplied base value.

Those prerequisites require linked follow-up issues with the acceptance criteria given
below. This matches issue #21's closure rule: complete the remaining work or move a
prerequisite-blocked item to an explicit linked follow-up.

## Architecture Design

```text
existing authoritative records
  SyncPreviewResult -------> $shared/narration v2 -------> SyncPreviewPanel
    summary                       pure functions            NarrationBlock
    sectionOutcomes                                        EntityDiff narration
    EntityChange[]

  GoalPlan ----------------> buildGoalDecisionLogMeta ---> logger.info
    decisions[].reason           pure mapper                sanitized JSON meta
    thresholds/coverage

  base entity + resolved ---> proven field provenance ---> ResolvedStatePanel
    FieldChange overrides       base | user-override        chips + explanation

  JobType + direct mutators -> transparency audit matrix -> pass / gap / follow-up
```

### New and Extended Components

#### 1. Narration engine v2

Extend `packages/praxrr-app/src/lib/shared/narration/narrate.ts` with pure functions:

```ts
export function narrateSyncPreviewSummary(
  summary: SyncPreviewSummary,
  level: NarrationLevel
): NarrationLine;

export function narrateSyncSectionOutcome(
  outcome: SyncPreviewSectionOutcome,
  level: NarrationLevel
): NarrationLine;

export function narrateEntityChanges(
  changes: readonly EntityChange[],
  arrType: SyncPreviewArrType,
  section: SyncPreviewSection,
  level: NarrationLevel
): readonly NarrationLine[];
```

`narrateEntityChanges` delegates to the existing `narrateEntityChange`; it must not
reimplement field phrasing. Summary narration reads the supplied totals verbatim and
never re-tallies entities. Section errors receive a stable user-facing frame, with the
already-exposed error retained verbatim only as detail. No substring classification of
free-form errors is permitted, because Radarr, Sonarr, and Lidarr do not share guaranteed
error wording.

Adding templates requires bumping `NARRATION_TEMPLATE_VERSION` from `1` to `2`. It
remains declared once in `types.ts` and stamped on every emitted line.

#### 2. Sync-preview integration

`SyncPreviewPanel.svelte` already fetches the complete preview. It should own one
summary/verbose toggle and render:

- a summary line from `preview.summary`;
- one line for each `sectionOutcome`, including skipped and failed sections;
- entity lines grouped by the existing section groups;
- safe narration for load/apply failures without inferring a cause.

`SyncPreviewEntityDiff.svelte` receives `arrType`, `section`, and `verbose`, renders the
pure entity narration above its existing raw value table, and retains badges as compact
status tokens. Raw current/desired values remain in the table; narration does not copy
or reinterpret them.

No sync-preview API change is required for pre-apply narration.

#### 3. Quality Goals decision record

The goal engine already returns the canonical rationale:

```ts
interface GoalReason {
  code: string;
  category: GoalCategory | null;
  ruleId: string;
  base: number;
  axisContributions: GoalAxisContribution[];
  ceiling: GoalCeilingRelation | null;
}
```

Add a pure server mapper, for example
`packages/praxrr-app/src/lib/server/goals/decisionLog.ts`:

```ts
interface GoalDecisionLogMeta {
  event: 'quality_goal.applied';
  databaseId: number;
  profileName: string;
  arrType: GoalArrType;
  presetId: string;
  engineVersion: string;
  thresholds: GoalThresholds;
  coverage: GoalCoverage;
  decisions: Array<{
    customFormatName: string;
    score: number;
    reason: GoalReason;
  }>;
  uncategorized: GoalUncategorizedCf[];
}
```

After `updateScoring` and binding persistence both succeed, the apply route emits one
`logger.info('Quality goal applied', { source: 'QualityGoals', meta })` event. The event
must be built from the same `GoalPlan` used for writes. It must preserve exact score math,
uncategorized exclusions, engine version, and explicit `arrType`; it must not contain API
keys, Arr URLs, raw SQL, or arbitrary request objects. `sanitizeLogMeta` remains the final
logging boundary.

Logs are the in-scope server-side decision record anticipated by the #213 design. If
queryable historical goal decisions are later required, add an append-only audit model
rather than overloading `quality_goal_bindings`, which intentionally stores latest intent.

#### 4. Resolved-config provenance

The current server can prove two sources at field-path level:

- `user-override`: a path exists in the authoritative base-versus-resolved
  `FieldChange[]`;
- `base`: the resolved path is not changed by a user override.

Expose these proven sources on the Resolved State surface and explain that “base” means
the combined schema + base + tweaks replay. A small pure mapper can translate override
paths into chips and `NarrationLine`s. Nested paths must mark their top-level container as
user-modified without discarding the precise path shown in verbose detail.

Do **not** emit `NarrationProvenance = 'database-default'` yet. The replay currently
cannot tell whether a value equal to a schema default was explicitly supplied by a base
op. Guessing would make the transparency feature misleading.

#### 5. Automated-workflow audit

Create `docs/internal/automation-transparency-audit.md` with one row per workflow. The
inventory starts with every literal in `JobType` (18 current values) and adds direct
mutators that bypass the job queue, including sync-preview apply, Quality Goals apply,
and snapshot rollback.

Required columns:

| Column             | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| Workflow ID        | Stable job type or route operation                              |
| Trigger/settings   | User, schedule, or system input and where it is configured      |
| Inputs exposed     | Target, scope, source, and destructive intent shown to the user |
| Decisions exposed  | Selection, skip, threshold, or mapping rationale                |
| Outputs exposed    | Counts, entities, history, or resulting state                   |
| Failures exposed   | Sanitized user-facing reason and recovery action                |
| Status             | Pass, Partial, or Gap                                           |
| Evidence/follow-up | Source paths and linked issue with acceptance criteria          |

A row may be `Pass` only when all four dimensions are evidenced. Every `Partial` or `Gap`
must link a follow-up issue. This prevents a documentation-only “audit” from silently
declaring incomplete workflows transparent.

### Integration Points

- `$shared/narration`: single wording and tone source.
- `$sync/preview/types.ts`: authoritative preview atoms; type-only imports from shared
  narration preserve the client/server boundary.
- `/api/v1/sync/preview/{previewId}/apply`: current coarse apply response; contract drift
  should be corrected, but it must not claim per-entity confirmation.
- `$shared/goals`: canonical goal decisions and reason math.
- `$logger/sanitizer.ts`: mandatory decision-meta redaction boundary.
- `$pcd/resolved/layerDiff.ts`: authoritative user-override derivation.
- `jobs/queueTypes.ts`: authoritative queued-workflow inventory.

## Data Models

### In-scope persistence

No new table or migration is required. Preview narration is derived from the existing
ephemeral snapshot, Quality Goals uses the existing structured log, and proven resolved
provenance is derived from base/resolved state.

### Existing models that remain authoritative

| Model                   | Relevant fields                                                         | Constraint                       |
| ----------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| `SyncPreviewResult`     | `summary`, `sectionOutcomes`, section entity arrays, `arrType`          | Planned state only               |
| `SyncResult`            | `success`, `itemsSynced`, `error?`, `failedProfiles?`                   | No per-entity outcome            |
| `GoalPlan`              | `engineVersion`, `decisions`, `thresholds`, `coverage`, `uncategorized` | Exact deterministic rationale    |
| `quality_goal_bindings` | preset, weights, engine version, applied time                           | Latest intent, not audit history |
| `ResolvedEntityState`   | layer, entity/overrides, pending conflict                               | Base folds schema/base/tweaks    |

### Follow-up data model: confirmed apply outcomes

The post-apply follow-up should extend `SyncResult` rather than reuse preview records:

```ts
type SyncEntityOutcomeStatus =
  'created' | 'updated' | 'deleted' | 'unchanged' | 'failed' | 'skipped';

interface SyncEntityOutcome {
  section: SectionType;
  entityType: string;
  name: string;
  remoteId: number | null;
  status: SyncEntityOutcomeStatus;
  reasonCode: string | null;
  error: string | null;
}

interface SyncResult {
  success: boolean;
  itemsSynced: number;
  outcomes: readonly SyncEntityOutcome[];
  error?: string;
  failedProfiles?: string[];
}
```

Every section syncer must populate outcomes from actual write responses, not the preview.
Cross-Arr mapping remains explicit by `arrType`; unsupported mappings fail fast.

### Follow-up data model: exact default lineage

Exact `database-default` provenance needs replay lineage such as:

```ts
interface ResolvedFieldLineage {
  path: string;
  source: 'schema-default' | 'base-op' | 'tweaks-op' | 'user-op';
  operationId: number | null;
  explicit: boolean;
}
```

The compiler must record whether a column/value was explicit in the operation. Equality
with a schema default is insufficient proof.

## API Design

### Sync preview

Pre-apply narration adds no endpoint and no response field. The browser derives it from
the existing `SyncPreviewResult`.

The current apply implementation and OpenAPI description should be aligned with a coarse,
truthful contract:

```json
{
  "success": true,
  "results": {
    "status": "success",
    "output": "qualityProfiles: 3 item(s)"
  },
  "staleWarning": null
}
```

Errors remain the existing 400/404/409/422/500 cases. A future `outcomes` property is
added only with the confirmed-outcome follow-up.

### Quality Goals

No wire change is required. Preview and apply already return `GoalPlan`, including each
decision's `reason`. The new server record is internal structured logging from the same
plan.

### Resolved Config

Base/user provenance can be rendered from the existing resolved and user-layer responses.
If the implementation chooses to avoid a second client request, an optional contract-first
field may be added:

```yaml
provenance:
  type: array
  items:
    type: object
    required: [path, source]
    properties:
      path: { type: string }
      source:
        type: string
        enum: [base, user-override]
```

Do not include `database-default` in the wire enum before the lineage prerequisite lands.

## System Constraints

### Performance and scalability

- Narration is O(number of supplied changes) and must not fetch, re-diff, or re-tally.
- Summary mode should render one rollup plus section failures; unchanged entity detail can
  remain collapsed to avoid DOM growth.
- Goal decision metadata is bounded to the plan already produced. Log one event per apply,
  not one event per custom format.
- Resolved provenance should reuse one base-only replay per request; never rebuild a base
  cache once per field.

### Security and privacy

- Narration must not surface raw server exceptions that the current API does not expose.
- Quality Goal log metadata passes through `sanitizeLogMeta` and contains no credentials,
  URLs, SQL, or arbitrary body data.
- User-facing errors use sanitized route error values. Free-form Arr text is never parsed
  into a stronger semantic claim.

### Compatibility

- All templates and decisions take explicit `arrType`.
- Unmapped entity/field labels use the existing literal fallback, never a sibling-Arr term.
- Radarr/Sonarr/Lidarr section support continues to resolve through existing capability and
  sync registries.
- OpenAPI, generated app types, and package API artifacts stay in lockstep for any contract
  change.

## Codebase Changes

### Modify

- `packages/praxrr-app/src/lib/shared/narration/types.ts` — bump template version.
- `packages/praxrr-app/src/lib/shared/narration/narrate.ts` — preview summary, section,
  and list narrators.
- `packages/praxrr-app/src/lib/shared/narration/templates.ts` — preview section phrasing.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte` —
  decision log, verbose toggle, section failures.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte` —
  entity narration without replacing raw diffs.
- `packages/praxrr-app/src/routes/api/v1/goals/apply/+server.ts` — emit structured
  decision event after successful apply and binding update.
- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`
  — proven base/user chips and layer explanations.
- OpenAPI/generated types only if the apply-response or provenance wire contract changes.
- `ROADMAP.md` — record completed issue #21 scope and linked prerequisite follow-ups.

### Create

- `packages/praxrr-app/src/lib/server/goals/decisionLog.ts` — pure log-meta mapper.
- `docs/internal/automation-transparency-audit.md` — evidence matrix and follow-up links.
- Focused tests for preview narration, goal decision metadata, and provenance mapping.

### Dependencies

No new runtime or third-party dependency is needed.

## Technical Decisions

### D1 — Client-derived preview narration vs server narration payload

- **Options:** derive from current preview; add narration strings to the API.
- **Recommendation:** derive from current preview.
- **Rationale:** the client already has every authoritative atom, and `$shared/narration`
  is intentionally client/server safe. A server payload would duplicate data and couple
  phrasing to transport.

### D2 — Infer errors vs frame existing errors

- **Options:** substring-classify free-form errors; frame without inference.
- **Recommendation:** frame without inference.
- **Rationale:** upstream error wording is not a stable cross-Arr contract.

### D3 — Goal rationale in logger vs new audit table

- **Options:** sanitized structured log; append-only goal audit table; expand latest binding.
- **Recommendation:** structured log now.
- **Rationale:** it is the seam explicitly deferred by #213, uses the exact plan, adds no
  competing score store, and is proportionate to this issue. Queryable history is a
  separate product requirement.

### D4 — Claim database defaults vs explicit follow-up

- **Options:** infer by value equality; call schema/base/tweaks collectively “default”;
  add lineage instrumentation.
- **Recommendation:** expose only proven base/user attribution now and file the lineage
  follow-up.
- **Rationale:** transparent automation must not manufacture provenance.

### D5 — Audit prose vs enforceable inventory

- **Options:** narrative review; matrix keyed by stable workflow IDs.
- **Recommendation:** stable-ID matrix with evidence and mandatory follow-ups for gaps.
- **Rationale:** it is reviewable against `JobType` and direct mutating routes and gives
  issue #21 an objective completion record.

## Validation Strategy

- `deno task test packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`
- focused goal decision-log mapper tests, including uncategorized and ceiling cases
- focused resolved provenance tests, including nested override paths and base-absent entities
- sync-preview route/component tests for failed and skipped section outcomes
- `deno task generate:api-types` and package API bundle generation if contracts change
- `deno task check`
- `deno task lint`
- `deno task test`
- `graphify update .` after code changes

Tests must assert that preview narration reads supplied totals, never claims planned
entities succeeded after apply, emits explicit `arrType`, preserves goal reason math, and
never emits `database-default` without lineage evidence.

## Required Follow-up Issues

### F1 — Confirmed per-entity post-apply sync outcomes

Acceptance criteria:

- every syncer returns one actual outcome per attempted entity;
- outcome status is based on the Arr write result, not preview intent;
- apply API and sync history persist/return the outcomes;
- post-apply UI narrates success, partial failure, skipped, and failed entities;
- tests cover partial Quality Profile failure and each supported `arrType`/section;
- no preview record is presented as confirmation.

### F2 — Exact schema/default/base/tweaks/user field lineage

Acceptance criteria:

- replay records field paths and the operation that last established each value;
- explicit values equal to a schema default remain distinguishable from implicit defaults;
- schema-default, base-op, tweaks-op, and user-op are separately represented;
- pending/dropped/conflicted value-guard outcomes do not receive false lineage;
- resolved-config API and UI expose the lineage with tests for nested arrays and all
  supported entity/Arr mappings.

### F3 — Audit-discovered workflow gaps

Each audit `Partial` or `Gap` row must have a linked issue whose acceptance criteria name
the missing input, decision, output, and/or failure surface. Issue #21 should not close
until those links exist.

## Open Questions

1. Should the coarse sync-preview apply response be corrected in this PR even though
   per-entity outcomes remain deferred? Recommended: yes, to restore contract fidelity.
2. Are application logs sufficient retention for Quality Goal decisions, or is queryable
   goal history a separate requirement? Recommended: logs for #21, follow-up for history.
3. Should proven base/user provenance be transported by the resolved API or derived by a
   second UI request? Recommended: server field when performance measurements show the
   extra base replay is acceptable.
4. Which audit gaps are small enough to fix in the issue #21 PR versus linked follow-ups?
   Decide from the completed matrix, not before the audit.
