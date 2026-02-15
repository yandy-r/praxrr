# Recommendations: sonarr-pull-resources (Second Pass)

## Executive Summary

Implement optional selection by changing execute semantics, not by rebuilding the pull stack. Keep preview/execute architecture, make `selections` optional, and generate a server-side import-all execution plan when selections are omitted. This satisfies the new UX requirement with minimal risk while preserving existing dedup/conflict behavior.

## Recommended Implementation Strategy

- Keep current pull architecture and endpoints.
- Update execute contract to `selections?`.
- Add deterministic default behavior when no selections are provided:
  - `new` -> import
  - `identical` -> skip
  - `conflict` -> default policy (`skip` recommended for v1, plus report)
- Require `previewId` on execute to avoid drift.

## Phased Rollout Suggestion

### Phase 1

- API contract update (`selections` optional)
- server-side default plan generation
- previewId enforcement
- explicit outcome summary in execute response

### Phase 2

- UI controls for per-category/per-item deselection
- clearer confirmation copy for default import-all behavior
- dependency auto-include prompt for QP->CF gaps

### Phase 3

- pull history/audit
- performance hardening for large imports
- selection presets/templates

## Quick Wins

1. Allow missing `selections` in execute payload.
2. Add “Import all pulled” button in preview page.
3. Return status counts by classification and category.
4. Log preview/execute mismatch errors with actionable message.

## Future Enhancements

- Saved selection presets per instance/database.
- Incremental pull since last successful preview/execute.
- Background execution and resumable sessions.

## Risk Mitigations

- Drift: enforce preview snapshot hash/token.
- Dependency gaps: preflight checks + optional auto-include.
- Performance: batch write/deferred compile path.
- Concurrent imports: lock by `(instanceId, databaseId)` during execute.

## Decision Checklist

1. Default conflict action in implicit mode: `skip` or `block`?
2. Is preview snapshot enforcement mandatory in v1?
3. Should dependency auto-include be default or opt-in?
4. Is pull history table v1 or deferred?
5. UI label final choice: `Import` vs `Pull`?

## Second-pass Corrections

1. Selective pull is now core behavior, not deferred scope.
2. Execute payload examples must reflect optional `selections`.
3. Any mandatory history-table wording should be moved to optional/deferred unless explicitly approved for v1.
4. Scope should stay focused on the agreed four categories unless expanded deliberately.
