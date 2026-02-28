# Recommendations: PCD State Snapshots

## Executive Summary

Adopt a lightweight metadata snapshot model aligned with Praxrr's append-only ops architecture.
Implement per-database, pre-risk auto snapshots plus manual CRUD endpoints, with deterministic
published-op fingerprinting and bounded retention.

## Recommended Approach

1. Keep snapshots as boundaries, not data copies.
2. Scope API and storage ownership to `database_id`.
3. Trigger snapshots only at pre-risk points:
   - before pull mutation
   - before Arr sync execution
4. Keep snapshot creation non-blocking.

## Why This Approach

- Fits existing `pcd_ops` replay model.
- Minimizes storage/complexity.
- Produces strong rollback metadata without restore implementation coupling.
- Avoids operational ambiguity from global snapshot collections.

## Key Implementation Choices

| Topic         | Recommendation                                            |
| ------------- | --------------------------------------------------------- |
| API shape     | `/api/v1/pcd/{databaseId}/snapshots` + `/{snapshotId}`    |
| Pull hook     | `PCDManager.sync()` only                                  |
| Arr hook      | `arrSyncHandler` before section loop                      |
| Deduplication | Trigger-aware short-window dedupe for auto snapshots only |
| Fingerprint   | `state_hash_v1` canonical published-op stream hash        |
| Retention     | Inline prune with defaults `50` and `30 days`             |

## Improvements Applied in This Second Pass

- Removed invalid pseudocode that depended on nonexistent `arrSyncQueries.getByInstanceId`.
- Removed contradictory hook ownership between `pcdSyncHandler` and `PCDManager.sync()`.
- Replaced cache-table `id` hashing guidance with op-stream canonical fingerprinting.
- Standardized endpoint/path language across all docs.

## Alternatives Considered

### Option A: Global snapshot collection endpoints

Rejected because:

- Adds filtering ambiguity.
- Weakens explicit ownership checks.

### Option B: Snapshot in both `pcdSyncHandler` and `PCDManager.sync()`

Rejected because:

- Produces duplicate pull snapshots.
- Spreads pull ownership across two layers.

### Option C: Cache-table structural hash (`GROUP_CONCAT(id)` style)

Rejected because:

- Assumes table-level `id` shape that is not universal.
- More brittle across schema evolution.

## Delivery Phasing

1. Foundation: migration + query module + snapshot types.
2. Service: snapshot creation/dedupe/prune/fingerprint.
3. Integration: pull and arr-sync hooks.
4. API/OpenAPI: scoped routes and contract alignment.
5. Verification: behavior + consistency checks.

## Acceptance Checklist

- [ ] Docs use one endpoint shape everywhere.
- [ ] Hooks are pre-risk and non-duplicative.
- [ ] Arr DB resolution references existing APIs only.
- [ ] Fingerprint design is deterministic without cache-table key assumptions.
- [ ] Retention and dedupe defaults are documented identically across artifacts.

## Follow-Up Enhancements (Post-MVP)

- Restore execution endpoint + dry-run restore preview.
- Snapshot diff tooling.
- Retention controls in settings.
- Snapshot event notifications and audit trail enrichment.
