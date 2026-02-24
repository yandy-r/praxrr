# Feature Spec: Radarr Pull Resources (Second Pass)

## Executive Summary

This feature adds optional resource selection between pull preview and commit for Radarr resource imports into PCD. Users fetch resources, optionally deselect categories/items, and commit; if users do not make explicit selections, the system defaults to importing all previewed resources while keeping existing deduplication/conflict detection behavior unchanged. The implementation extends the existing preview/execute pull architecture with an updated execute contract (`selections?`) and a server-side default execution plan. As of February 15, 2026, this should target Radarr v6 behavior via the `/api/v3` API namespace.

## External Dependencies

### APIs and Services

#### Radarr API v3 namespace (for current Radarr v6 behavior)

- **Documentation**: <https://radarr.video/docs/api/>
- **OpenAPI**: <https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json>
- **Authentication**: `X-Api-Key` header
- **Key Endpoints**:
  - `GET /api/v3/customformat`
  - `GET /api/v3/qualityprofile`
  - `GET /api/v3/delayprofile`
  - `GET /api/v3/qualitydefinition`
  - `GET /api/v3/config/naming`
  - `GET /api/v3/config/mediamanagement`
  - `GET /api/v3/tag`
  - `GET /api/v3/system/status`
- **Rate Limits**: no documented API quota contract for these endpoints
- **Pricing**: self-hosted

### Libraries and SDKs

| Library                  | Purpose             | Decision             |
| ------------------------ | ------------------- | -------------------- |
| Existing `BaseArrClient` | Arr API integration | Use                  |
| External SDKs            | Alternative clients | Not required for MVP |

### External Documentation

- Radarr API docs: <https://radarr.video/docs/api/>
- Radarr OpenAPI v3: <https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json>
- Radarr releases: <https://github.com/Radarr/Radarr/releases>

## Business Requirements

### User Stories

- As a Radarr user, I want to import my existing resources into Praxrr without rebuilding them manually.
- As a user, I want optional selection by category/item before commit.
- As a user, if I do not make selection changes, I want all pulled resources imported by default.
- As a user, I want current dedup/conflict logic to continue unchanged.

### Business Rules

1. Preview performs read-only fetch/classification and writes nothing.
2. Execute writes user-layer PCD ops only.
3. Execute supports explicit mode (`selections` provided) and implicit mode (`selections` omitted/empty).
4. Implicit mode defaults to import-all previewed items.
5. Existing dedup/conflict rules still determine final per-item outcomes.
6. Namespace suffixes must be stripped before comparison/import.
7. Dependency order must be preserved (CF before QP references).
8. Radarr quality profile `language` must be preserved in imported representation.
9. Radarr-only quality modifier conditions must preserve `arr_type='radarr'`.
10. Radarr-specific resources route to Radarr-specific PCD entities.

### Edge Cases

| Scenario                                | Expected Behavior                                             | Notes                                |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------ |
| No explicit selections                  | Import all previewed resources                                | Still run dedup/conflict checks      |
| Identical entity exists                 | Skip                                                          | Existing dedup behavior              |
| Conflict detected                       | Apply default conflict policy (`skip` recommended) and report | Can be overridden in explicit mode   |
| Missing CF dependencies for selected QP | Warn and offer auto-include or drop-score policy              | Decision required                    |
| Stale preview at execute time           | Reject execute and require re-preview                         | Prevents drift                       |
| Radarr QP with language field           | Preserve language data in imported target                     | Radarr-specific field                |
| Radarr quality modifier condition       | Preserve as `arr_type='radarr'`                               | Avoids cross-arr condition confusion |

### Success Criteria

- [ ] Users can preview resources before commit.
- [ ] Users can optionally deselect categories/items.
- [ ] No-selection path imports all previewed resources by default.
- [ ] Existing dedup/conflict behavior remains intact.
- [ ] Execute response includes per-category summary and failures.
- [ ] Radarr-specific fields are preserved in imported entities.

## Technical Specifications

### Architecture Overview

```text
UI (Import tab)
  -> POST /api/v1/arr/pull/preview
      -> fetch + classify
  -> POST /api/v1/arr/pull/execute
      -> explicit selections OR implicit import-all plan
      -> writeOperation() (user layer)
      -> compile/update cache
```

### Data Models

MVP requires no mandatory new table.

Optional/deferred:

- `arr_pull_history` for audit/history
- `'pull'` source enum in `pcd_ops.source`

### API Design

#### `POST /api/v1/arr/pull/preview`

**Purpose**: Fetch and classify resources for review.

**Request**:

```json
{
  "instanceId": 1,
  "databaseId": 1,
  "resourceTypes": [
    "customFormats",
    "qualityProfiles",
    "delayProfiles",
    "qualityDefinitions"
  ]
}
```

**Response**:

```json
{
  "previewId": "pvw_123",
  "customFormats": [{ "name": "x265 (HD)", "status": "new" }],
  "qualityProfiles": [{ "name": "HD-1080p", "status": "conflict" }],
  "delayProfiles": [],
  "qualityDefinitions": []
}
```

#### `POST /api/v1/arr/pull/execute`

**Purpose**: Commit pull results.

**Request (explicit)**:

```json
{
  "instanceId": 1,
  "databaseId": 1,
  "previewId": "pvw_123",
  "selections": {
    "customFormats": [{ "name": "x265 (HD)", "action": "import" }],
    "qualityProfiles": [{ "name": "HD-1080p", "action": "import" }],
    "delayProfiles": [
      { "arrId": 1, "pcdName": "Imported - Prefer Usenet", "action": "import" }
    ],
    "qualityDefinitions": [
      { "pcdConfigName": "Imported QD", "action": "import" }
    ]
  }
}
```

**Request (implicit import-all)**:

```json
{
  "instanceId": 1,
  "databaseId": 1,
  "previewId": "pvw_123"
}
```

**Response**:

```json
{
  "success": true,
  "summary": {
    "customFormats": { "imported": 10, "skipped": 2, "errors": 0 },
    "qualityProfiles": { "imported": 3, "skipped": 1, "errors": 0 },
    "delayProfiles": { "imported": 1, "skipped": 0, "errors": 0 },
    "qualityDefinitions": { "imported": 1, "skipped": 0, "errors": 0 }
  },
  "errors": []
}
```

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/pull/processor.ts`
- `packages/praxrr-app/src/lib/server/pull/types.ts`
- `packages/praxrr-app/src/lib/server/pull/conflicts.ts`
- `packages/praxrr-app/src/routes/api/v1/arr/pull/preview/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/arr/pull/execute/+server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/pull/+page.server.ts`
- `packages/praxrr-app/src/routes/arr/[id]/pull/+page.svelte`

#### Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` (batch/deferred compile)
- `packages/praxrr-app/src/lib/server/sync/mappings.ts` (reverse lookup exports)
- `packages/praxrr-app/src/routes/arr/[id]/+layout.svelte` (Import tab)

## UX Considerations

### User Workflows

1. Configure scope and fetch preview.
2. Review results (all selected by default).
3. Optionally deselect categories/items.
4. Confirm summary and commit.
5. Review outcome summary with retries for failures.

### Accessibility

- keyboard-first controls for selection and confirm flow
- non-color status indicators
- `aria-live` status updates during operations

### Feedback States

- loading (`Fetching from Radarr`, `Importing X/Y`)
- empty (`No resources found`)
- success summary and partial-failure reporting

## Recommendations

### Implementation Approach

- Keep architecture and add optional selection semantics in execute.
- Require preview snapshot id/hash on execute.
- Default no-selection behavior to import-all through existing dedup/conflict pipeline.
- Keep shared pull processor arr-type agnostic and isolate Radarr-specific mapping branches.

### Phasing

1. API contract update (`selections?`) + implicit planner.
2. UI controls and confirmation messaging.
3. Optional history/audit and scaling improvements.

## Risk Assessment

### Technical Risks

| Risk                       | Likelihood | Impact | Mitigation                             |
| -------------------------- | ---------- | ------ | -------------------------------------- |
| Preview/execute drift      | Medium     | High   | Require `previewId` + validation       |
| Dependency gaps (QP -> CF) | Medium     | High   | Preflight check + auto-include option  |
| Large import performance   | Medium     | Medium | Batch writes and deferred compile      |
| Conflict default surprises | Medium     | Medium | Explicit confirmation copy and summary |
| Radarr mapping regressions | Medium     | High   | Fixture-based round-trip mapping tests |

## Task Breakdown Preview

### Phase 1

- Update execute request schema (`selections?`)
- Implement implicit import-all planner
- Enforce preview snapshot validation
- Return detailed summary counts
- Add Radarr mapping verification tests for key resources

### Phase 2

- Add optional deselection controls by category/item
- Add clear import-all confirmation messaging
- Add dependency warnings and actions

### Phase 3

- Optional pull history
- performance hardening for large imports
- selection presets

## Decisions Needed

1. Default conflict action in implicit mode: `skip` or `block`?
2. Is `previewId` mandatory for execute in v1?
3. Auto-include missing CF dependencies by default?

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): External API details
- [research-business.md](./research-business.md): Business logic analysis
- [research-technical.md](./research-technical.md): Technical specifications
- [research-ux.md](./research-ux.md): UX research
- [research-recommendations.md](./research-recommendations.md): Full recommendations
