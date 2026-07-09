# Integration Analysis: Transparent Automation Engine

## Executive Summary

The completion slice integrates almost entirely with existing internal contracts: Sync
Preview already transports planned changes, Quality Goals already returns structured
reasons, Resolved Config already exposes layer evidence, and the job queue supplies a
finite automation inventory. No external API, SDK, or database table is required.

The two hard integration boundaries are evidence fidelity and portable contract fidelity.
The current apply path proves only run/section outcomes, not per-entity success, and the
resolved replay proves base-versus-user state but not exact schema-default/op lineage.
Those claims must remain linked follow-ups rather than being inferred in narration.

## API Endpoints

### Sync Preview

- `POST /api/v1/sync/preview`: creates an ephemeral preview containing target metadata,
  `SyncPreviewSummary`, `SyncPreviewSectionOutcome[]`, and section-specific
  `EntityChange`/`FieldChange` records. Handler:
  `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`.
- `GET /api/v1/sync/preview/{previewId}`: returns the stored preview consumed by
  `SyncPreviewPanel.svelte`. Handler:
  `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/+server.ts`.
- `POST /api/v1/sync/preview/{previewId}/apply`: validates state, expiry, selected
  sections, staleness, and concurrent work, then calls `executeSyncJob`. Handler:
  `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`.

Pre-apply narration needs no new field or endpoint. The client already receives all
authoritative planned-change evidence and should call pure `$shared/narration` functions.

The apply handler currently returns a coarse runtime payload:

```json
{
  "success": true,
  "results": { "status": "success", "output": "..." },
  "staleWarning": null
}
```

This does not match the documented success shape in the current sync OpenAPI path. If the
implementation touches apply-result typing, it must first define a portable
`SyncPreviewApplyResponse`, update `docs/api/v1`, regenerate app/package types, and type
the handler response. It must not add entity outcomes until every syncer produces actual
write outcomes.

Relevant contracts:

- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`
- `docs/api/v1/paths/sync.yaml`
- `docs/api/v1/schemas/sync.yaml`
- `packages/praxrr-app/src/lib/api/v1.d.ts`
- `packages/praxrr-api/openapi.json`
- `packages/praxrr-api/types.ts`

### Quality Goals

- `GET /api/v1/goals/presets`: returns presets, axis descriptions, and engine version.
- `POST /api/v1/goals/preview`: computes a `GoalPlan` and sandbox config diff without
  persistence. Handler:
  `packages/praxrr-app/src/routes/api/v1/goals/preview/+server.ts`.
- `POST /api/v1/goals/apply`: verifies `expectedEngineVersion`, computes the same plan,
  persists scoring through `updateScoring`, and upserts the binding. Handler:
  `packages/praxrr-app/src/routes/api/v1/goals/apply/+server.ts`.
- `GET /api/v1/goals/binding`: returns latest intent metadata for the selected profile.

`GoalPlan.decisions[].reason` already carries the canonical `code`, `category`, `ruleId`,
base score, axis contributions, and ceiling relationship. The integration should add a
pure allowlisted mapper under `$lib/server/goals`, then emit one bounded, sanitized
`logger.info` event only after both scoring persistence and binding upsert succeed. No
public API change is required.

The logger payload must be server-computed; the route must never accept client-authored
narration, reason codes, or log metadata.

### Resolved Config

- `GET /api/v1/pcd/{databaseId}/resolved/{entityType}`: lists named entities for a
  requested layer.
- `GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}`: returns `base`, `user`, or
  `resolved` state plus `hasPendingConflict`.
- `GET .../{name}/diff`: returns desired-versus-live changes for one Arr instance.
- `GET .../{name}/compare`: returns cross-instance desired/live comparison.

Handlers live under
`packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/` and perform explicit
authentication, strict ID/entity/Arr validation, and typed error mapping.

The current named-state response is sufficient for truthful layer explanations:

- `base` means schema + base + tweaks, excluding user ops;
- `user` is the base-versus-resolved `FieldChange[]`;
- `resolved` is the final replayed state;
- `hasPendingConflict` makes attribution ambiguous.

The UI may derive base-side, user-override, user-created, and ambiguous wording from these
responses. Do not add `database-default` to an API enum until replay lineage exists. If a
new provenance field is added for efficiency, update
`docs/api/v1/schemas/resolved-config.yaml`, route mappers, generated types, and tests in
the same change.

### Sync History and Job Results

Sync History is the durable source for trigger, overall status, section outcomes, counts,
duration, errors, and the pre-sync intended diff. It is useful for run/section narration
and post-apply deep links, but its entity changes are planned evidence captured before
writes, not confirmed per-entity outcomes.

Generic background-job history stores terminal status, output, error, and timing. Rich
domain surfaces such as Sync History, drift, canary, and Config Health should remain the
preferred evidence destination; the transparency audit should link to them instead of
flattening every workflow into a generic output string.

## Middleware and Route Conventions

- Global SvelteKit authentication remains authoritative. Resolved Config additionally
  checks `locals.user || locals.authBypass`; new endpoints are not needed.
- State-changing Goals and preview-apply routes retain current authorization and body
  validation. Narration parameters must not affect authorization or execution.
- Errors returned to UI should use existing sanitized route values or a closed reason
  union. Arbitrary upstream `error.message` text must not be substring-classified into a
  stronger diagnosis.
- OpenAPI portable schemas, runtime handlers, and generated types must remain in lockstep.
  Route casts are not an acceptable substitute for updating the contract.

## Database

### Existing tables

#### `quality_goal_bindings`

Migration:
`packages/praxrr-app/src/lib/server/db/migrations/20260711_create_quality_goal_bindings.ts`.

Primary key: `(database_id, profile_name, arr_type)`. The row stores preset, weights,
engine version, and applied time; actual scores remain in `pcd_ops`. This table is latest
intent metadata, not an append-only decision history. The recommended issue #21 slice
does not change it.

#### `pcd_ops` and `pcd_op_history`

These tables are the write and conflict evidence behind resolved state. `pcd_ops` records
base/user origin and operation metadata; `pcd_op_history` records value-guard outcomes.
They do not currently provide complete per-field last-writer/default lineage, especially
for schema/tweaks file operations. Equality with a default is insufficient attribution.

#### `sync_history`

The append-only sync audit stores section results and expected pre-sync changes. It can
support section-level apply-result narration and a durable link from preview apply. It
must not be used to claim an individual entity write succeeded.

#### Job queue and run history

`JobQueueRecord` supplies type, source, payload, scheduling, attempts, and terminal state;
`JobRunHistoryRecord` supplies run status, duration, output, and error. Contracts are in
`packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`.

### New persistence

None is recommended for this slice:

- previews remain in the existing in-memory TTL store;
- narration is derived, not stored;
- Quality Goals writes one structured file-log event through the existing logger;
- provenance is derived from existing layer evidence;
- the audit is a typed source registry plus checked documentation.

A future queryable Quality Goals audit or field-lineage store is a separate migration and
retention decision.

## Logger Integration

The logger writes JSON file entries with optional `source` and arbitrary `meta`, after
passing metadata through `sanitizeLogMeta`. Relevant files:

- `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`
- `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`
- `packages/praxrr-app/src/lib/server/utils/logger/types.ts`

Recommended event shape:

```ts
interface QualityGoalDecisionLogMeta {
  event: 'quality_goal.applied';
  databaseId: number;
  profileName: string;
  arrType: GoalArrType;
  presetId: string;
  engineVersion: string;
  coverage: GoalCoverage;
  thresholds: GoalThresholds;
  decisions: readonly BoundedGoalDecision[];
  omittedDecisionCount: number;
  uncategorizedCount: number;
}
```

The mapper must allowlist fields, cap decision count and string length, record omitted
counts, and exclude request bodies, URLs, headers, tokens, API keys, raw SQL, regex bodies,
and arbitrary config payloads. Use one event per successful apply, not one event per
custom format. Test nested secret-shaped values against the sanitizer.

## Integration Points

### Internal Services

### `$shared/narration`

Extend the existing pure engine with preview-summary, section-outcome, entity-list, and
safe-error narrators. It consumes `SyncPreviewResult` atoms through type-only imports and
performs no I/O, fetch, diff, or count reconstruction. `NarrationBlock.svelte` remains a
dumb escaped-text renderer and should not be changed to `{@html}` or Markdown.

### Preview store and orchestrator

`preview/orchestrator.ts` owns Arr fetch/transform/diff and per-section failure isolation.
`preview/store.ts` owns TTL, capacity, status transitions, expiry, and staleness. Narration
must not duplicate either responsibility. Existing body/rate/store limits remain intact.

### Sync execution

`executeSyncJob` calls section syncers through explicit `SectionType`/Arr dispatch.
`SyncResult` currently contains `success`, `itemsSynced`, optional `error`, and optional
`failedProfiles`. A follow-up must extend all syncers with a common actual-outcome model
before post-apply per-entity narration can land.

### Resolved-layer service

`pcd/resolved/layers.ts` builds ephemeral read-only caches; `layerDiff.ts` derives user
overrides with the shared diff engine; route handlers map typed errors. Provenance helpers
must reuse one base-only replay per operation and must not rebuild a cache per field.

### Automation audit registry

Create a typed registry under `packages/praxrr-app/src/lib/server/jobs/`:

```ts
const JOB_TRANSPARENCY_AUDIT = {
  // every JobType literal
} satisfies Record<JobType, TransparencyAuditEntry>;
```

The registry covers all current `JobType` values, including section-specific sync and
cleanup jobs. A parity test must fail when a registered/declared job type lacks an audit
entry. Material direct mutators—preview apply, Quality Goals apply, and rollback—belong in
the checked human audit even though they are not `JobType`s.

## External Services

No new third-party service or dependency is required.

Praxrr continues to use its existing explicit clients for:

- Radarr `/api/v3` resources;
- Sonarr `/api/v3` resources;
- Lidarr `/api/v1` resources, including its distinct metadata-profile behavior.

The feature adds no Arr requests. API keys continue through the existing header/client
path and must never enter narration or log metadata. Unsupported section/entity mappings
fail closed; friendly labels use literal fallback and never borrow sibling-Arr semantics.

## Configuration

- Logger enablement, file logging, console logging, level, rotation, and cleanup remain
  existing settings. Because logs may be disabled or retained briefly, the authenticated
  Goals response remains the full immediate rationale surface.
- Preview TTL, stale-warning/block thresholds, capacity, body limits, and generation rate
  limits remain unchanged.
- No new environment variable, secret, feature flag, CORS rule, or CSP exception is
  required.
- `AUTH=off`/trusted-local behavior remains an existing deployment trust decision; this
  work must not broaden it.

## Contract Implications

1. **Narration version:** bump the shared narration template version when new phrasing is
   added; keep it distinct from the Goals engine version and API schema version.
2. **Plan versus result:** preview contracts remain planned-state types. A future
   `SyncEntityOutcome` must be a separate actual-result type, never an alias of
   `EntityChange`.
3. **Apply response mismatch:** if corrected, update modular OpenAPI, bundled API JSON,
   generated package/app types, route response typing, and route tests together.
4. **Resolved provenance:** current public semantics support base/user/resolved and pending
   conflict. Exact default/op attribution requires a separately versioned lineage contract.
5. **Audit completeness:** the typed registry gives compile-time `JobType` coverage; tests
   must additionally compare it with the runtime job registrations so an unregistered or
   newly registered handler cannot bypass the audit.

## Integration Risks and Mitigations

| Risk                          | Integration failure                                   | Mitigation                                                                         |
| ----------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Planned data shown as success | Preview records are mistaken for apply outcomes       | Separate headings/types; narrate only section facts; follow-up for entity outcomes |
| OpenAPI/runtime drift         | Client types describe a different apply payload       | Contract-first schema and full regeneration                                        |
| Large/sensitive Goal log      | Policy data or secret-shaped text is retained         | Pure allowlist mapper, cap, omitted count, sanitizer tests                         |
| False provenance              | Schema default or op is guessed from final value      | Base-side/user-only wording; exact-lineage follow-up                               |
| Cross-Arr semantic leak       | Sibling labels or unsupported operations appear valid | Explicit `arrType`, capability dispatch, literal fallback, fail closed             |
| Stale audit                   | New job type lacks transparency review                | Exhaustive `Record<JobType, ...>` plus runtime-registry parity test                |
| XSS through operational text  | Arr/PCD names are treated as markup                   | Plain Svelte interpolation; prohibit `{@html}` for narration                       |

## Validation

- Unit-test pure narration with full, partial, skipped, failed, focused, and zero-change
  previews; assert supplied totals are not re-tallied.
- Unit-test the Goal decision-log mapper for caps, omitted counts, exact reason math,
  explicit `arrType`, and secret-shaped nested strings.
- Unit-test audit parity across every `JobType` and registered handler.
- Test Resolved Config wording for base-side, user override, user-created, and pending
  conflict; assert no database-default claim is emitted.
- Test API/runtime parity if preview apply response schemas change.
- Run API type generation/bundling when contracts change, then `deno task check`,
  `deno task lint`, and focused/full tests.
- Run `graphify update .` after implementation.

## Required Follow-up Integrations

### Confirmed per-entity sync outcomes

Extend every section syncer, apply response, and Sync History with actual attempted action,
entity identity, terminal status, remote ID, and sanitized reason. Tests must cover partial
success and each supported Arr/section mapping. Preview intent must remain separately typed.

### Exact field/default lineage

Instrument replay to distinguish schema default, explicit base op, tweaks op, and user op
for nested field paths, including value-guard conflict/drop behavior. Extend the resolved
API/UI only after that evidence exists.

### Audit-discovered gaps

Every human-audit `Partial`/`Gap` must link to an issue with pass/fail acceptance criteria
for the missing input, decision, output, or failure surface before issue #21 closes.
