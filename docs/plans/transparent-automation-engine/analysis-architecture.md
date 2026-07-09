# Architecture Analysis: Transparent Automation Engine

## Executive Summary

The remaining issue #21 work is an evidence-rendering and governance layer over
existing subsystems, not a new automation runtime. The architecture should keep
computation in the current sync, goals, resolved-config, and job services;
extend the pure shared narration boundary for user-facing wording; and add two
server-only seams: bounded Quality Goals decision metadata and an exhaustive
automation audit keyed by `JobType`.

The most important boundary is epistemic: preview diffs are planned state, sync
history records section outcomes plus pre-write intended changes, and resolved
layers prove layer composition but not exact per-field op/default lineage. Types
and copy must preserve those limits, with prerequisite gaps owned by explicit
follow-up issues rather than inferred inside narration.

## Architecture Context

- **System Structure**: The SvelteKit app separates pure client/server-safe
  domain contracts under `$shared`, server orchestration under `$lib/server`,
  and route composition under `src/routes`. `$shared/narration` already defines
  the versioned output contract and pure renderers; `NarrationBlock.svelte` is
  the presentation boundary. New wording belongs in the former and new
  placement/toggles in the latter.
- **Sync Evidence Flow**: Arr clients and section syncers produce
  current/desired data; `$sync/preview` creates `SyncPreviewResult` with
  authoritative totals, per-section outcomes, and `EntityChange`/`FieldChange`
  records; the sync page loads that snapshot and renders it. Narration must
  consume the loaded snapshot directly, trust supplied totals even in a filtered
  view, and avoid new Arr calls or diff logic.
- **Apply Evidence Flow**: Preview apply re-enters `executeSyncJob`; the job
  handler records terminal run/section results and captures planned entity
  changes before writes in Sync History. Current contracts do not correlate a
  terminal status to every planned entity. The architecture may narrate section
  results but must keep per-entity rows in planned tense until a future
  actual-outcome type is produced by syncers.
- **Quality Goals Flow**: `/api/v1/goals/apply` validates the engine version,
  recomputes the canonical `GoalPlan`, writes standard user-layer scoring ops,
  and persists a binding. One server-only mapper should copy an allowlisted,
  capped subset of that exact applied plan into `logger.meta` after both
  persistence steps succeed; UI and logs must not rebuild reasons from scores.
- **Resolved Config Flow**: Resolved readers and ephemeral layer caches return
  `base`, `user`, and `resolved` state; `layerDiff.ts` expresses user overrides
  as base-versus-resolved `FieldChange`s and correlates pending conflicts. The
  page can explain base-side, user-override, user-created, and ambiguous states
  with no API/schema change. Exact schema/default/op attribution is outside the
  available data model.
- **Automation Audit Flow**: `queueTypes.ts` is the closed queued-workflow
  inventory and `queueRegistry.ts` is the runtime handler inventory. A
  server-side `Record<JobType,
TransparencyAuditEntry>` provides compile-time
  closure; a test compares audit keys with registered handlers. A checked human
  document adds direct synchronous mutators that are outside the queue and
  records pass/not-applicable/follow-up dispositions.
- **Integration Points**: Extend `$shared/narration` for preview summary,
  section outcome, planned entity list/error, goal decision, and layer
  provenance wording; wire those into the existing sync and resolved-config
  components; add one goals decision-log mapper/call; add the job audit
  registry, tests, human audit, follow-up links, and `ROADMAP.md` entry.

## Critical Files Reference

- `packages/praxrr-app/src/lib/shared/narration/types.ts`: single narration
  contract and template version; planned/result semantics must not be hidden in
  an untyped context bag.
- `packages/praxrr-app/src/lib/shared/narration/narrate.ts`: pure wording
  boundary; extend without I/O, fetches, tallying, or domain recomputation.
- `packages/praxrr-app/src/lib/shared/narration/templates.ts`: central cross-Arr
  labels and safe reason text; literal fallback prevents sibling-app semantic
  borrowing.
- `packages/praxrr-app/src/lib/client/ui/narration/NarrationBlock.svelte`:
  reusable escaped-text renderer; should remain dumb and unchanged unless
  accessibility semantics require a small additive adjustment.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`: authoritative
  preview lifecycle, summary, section-outcome, entity, and field contracts.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`:
  surface-level integration point for supplied totals, partial coverage,
  stale/destructive state, and one verbose disclosure.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte`:
  per-entity integration point; narration must augment rather than replace raw
  current/desired evidence.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`:
  current coarse apply result boundary; do not add fictional entity outcomes,
  and keep any response correction contract-first.
- `packages/praxrr-app/src/lib/server/sync/types.ts`: `SyncResult` limitation is
  the formal blocker for confirmed per-entity narration.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: actual sync
  execution and Sync History section-result recording; preserves the
  planned-versus-actual boundary.
- `packages/praxrr-app/src/lib/server/sync/syncHistory/{types,record}.ts`:
  durable run/section evidence and pre-write planned changes; candidate source
  for an apply-result link.
- `packages/praxrr-app/src/lib/shared/goals/types.ts`: canonical `GoalReason`,
  coverage, thresholds, and engine version consumed by UI and server logging.
- `packages/praxrr-app/src/routes/api/v1/goals/apply/+server.ts`: decision-event
  insertion point after scoring and binding succeed.
- `packages/praxrr-app/src/lib/server/goals/decisionLog.ts`: proposed pure
  allowlist/cap mapper that makes log volume/redaction behavior unit-testable.
- `packages/praxrr-app/src/lib/server/utils/logger/{logger,sanitizer}.ts`:
  existing structured sink and secret-redaction boundary; no new telemetry
  dependency is warranted.
- `packages/praxrr-app/src/lib/server/pcd/resolved/{layers,layerDiff}.ts`:
  authoritative provenance evidence and pending-conflict semantics.
- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/ResolvedStatePanel.svelte`:
  layer and ambiguity explanation integration point.
- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts`: exhaustive `JobType`
  source of truth.
- `packages/praxrr-app/src/lib/server/jobs/queueRegistry.ts`: runtime
  registered-handler set for audit parity validation.
- `packages/praxrr-app/src/lib/server/jobs/transparencyAudit.ts`: proposed typed
  queued-workflow coverage registry.
- `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`: established
  pure, table-driven test location for narration v2.
- `docs/api/v1/{paths,schemas}/sync.yaml`: portable contract that must move with
  any apply response change.
- `docs/internal/automation-transparency-audit.md`: proposed reviewed inventory
  of queued and direct automation, dispositions, evidence, and follow-up
  acceptance criteria.

## Cross-Cutting Concerns

- **Truthful stages**: Make `planned`, section-level `success/failed/skipped`,
  and future confirmed entity outcomes type-distinct. Preview records must never
  be restyled or reworded as completed work.
- **Cross-Arr fidelity**: Every narrator receives explicit `arrType`; verified
  mappings are per app; unknown labels remain literal; unsupported
  section/entity combinations fail closed.
- **Error safety**: Closed reason codes can receive specific copy. Free-form
  errors receive a generic safe frame and must not be substring-classified into
  stronger diagnoses. Raw diagnostics remain in sanitized server logs.
- **Log protection**: The goals mapper allowlists fields, caps decision count,
  reports omitted count, bounds identifiers, and passes nested metadata through
  `sanitizeLogMeta`. Emit one event only after the full apply transaction-like
  sequence succeeds.
- **Provenance precision**: `base` includes schema/base/tweaks, `user` is a
  diff, and `resolved` is the final replay. “Database default” and exact op
  lineage are prohibited without new replay evidence. Pending conflict always
  overrides confident provenance wording.
- **Accessibility**: One host-owned disclosure uses `aria-expanded` and stable
  controlled content; status uses text plus tone/glyph; asynchronous updates
  avoid competing live regions.
- **Performance**: Narration is O(supplied records), summary mode is default,
  unchanged rows remain collapsed, and Quality Goals logs are bounded. No new
  network request, base replay, or diff pass is introduced.
- **Contract fidelity**: If preview apply's documented/runtime response mismatch
  is corrected, update OpenAPI source, generated types, route, client, and tests
  together.
- **Governance**: Typed job coverage prevents queued-workflow drift, but direct
  mutators still require a human-reviewed inventory and linked issues. The audit
  artifact must record evidence, not merely assert “pass.”
- **Testing**: Use pure table-driven fixtures for summary/verbose, contradictory
  summary versus visible rows, partial sections, free-form errors, XSS-shaped
  text, all Arr types, goal arithmetic, log caps/redaction, provenance
  ambiguity, and audit registry parity.

## Parallelization Opportunities

- **Batch A — Narration core**: Implement pure narration v2
  functions/templates/types and focused unit tests independently of UI wiring.
  This is the shared dependency for preview and provenance surfaces.
- **Batch A — Goal decision logging**: Implement the pure bounded metadata
  mapper and tests in parallel; route insertion depends only on its stable
  output.
- **Batch A — Audit registry/inventory**: Build the exhaustive `JobType`
  registry, runtime parity test, and initial human audit concurrently. Follow-up
  issue creation waits for reviewed gap rows.
- **Batch B — Sync Preview UI**: After narrator signatures stabilize, wire
  summary/section/entity lines, safe errors, and accessible disclosure into the
  two existing components.
- **Batch B — Resolved Config UI**: After provenance narrator stabilizes, add
  layer/ambiguity copy to `ResolvedStatePanel` independently of preview UI.
- **Batch B — Goals route**: After decision metadata tests pass, emit the event
  after scoring and binding persistence; this is independent of the Svelte work.
- **Batch C — Audit closure/tracking**: Review dispositions, create
  prerequisite/gap issues with acceptance criteria, update issue #21 and
  `ROADMAP.md`, then run full validation. This depends on the human audit and
  implementation evidence from prior batches.
- **Coordination rule**: Do not parallel-edit `$shared/narration` across
  multiple implementors; assign its files/tests to one owner to avoid
  template/version conflicts.

## Implementation Constraints

- No new external API, service, runtime library, database table, diff engine, or
  Arr call.
- Svelte 5 without runes; host pages own toggle state and use existing
  alert/dirty/navigation conventions where applicable.
- Narration functions are pure: no I/O, date/randomness, logging, fetch, store
  reads, re-diffing, or re-tallying.
- Supplied `SyncPreviewSummary` remains authoritative even when a focused view
  displays fewer rows; section failures/skips prevent global “up to date”
  language.
- The preview entity surface is explicitly **Planned changes**. Confirmed
  per-entity wording remains a linked prerequisite until `SyncResult` exposes
  actual outcomes.
- Goal rationale comes from the exact applied server-generated `GoalPlan`; log
  after scoring and binding both succeed, using an allowlisted bounded mapper
  and the existing sanitizer.
- Provenance claims are limited to base-side, user override, user-created, and
  pending-conflict ambiguity. Do not expose the unused `database-default` seam
  as fact.
- Audit every current queued job and material direct mutator as pass,
  not-applicable with rationale, or follow-up with URL and explicit acceptance
  criteria. Exhaustiveness is a closure gate.
- Preserve explicit Arr dispatch and the repository's cross-Arr validation
  checklist.
- Maintain OpenAPI/runtime/generated-type lockstep for any touched API response.
- Update `ROADMAP.md`, run focused tests plus `deno task test`,
  `deno task check`, lint/docs checks, and `graphify update .` after code
  changes.
