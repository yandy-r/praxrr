# Feature Spec: PCD Export/Import Atomicity (YAN-463, YAN-466)

## Executive Summary

Two PCD data-integrity bugs share the base-op import path. YAN-463: `exportDraftOps` records the exported drafts as a published `source='repo'` batch op whose `last_seen_in_repo_at` is never refreshed (import reads only `entities/` YAML since #105/#110), so the next `importBaseOps` orphans it in `markBaseOrphaned` and the exported change silently reverts. YAN-466: a failed `importBaseOps` still leaves residue — #275 restores refreshed repo rows, but rows created during the pass stay behind (as orphans, with history), `updated_at` is not restored exactly, and user-op mutations made by `autoResolveOverrideConflicts` during the final compile are outside the snapshot. This change tags export batch ops in metadata and excludes them from the orphan sweep, and makes the import rollback cover all `pcd_ops` rows of the database plus deletion of rows created during the pass, applied in a single synchronous SQLite transaction. Canonical YAML regeneration on export (consumer-visible publish) is deferred to a follow-up issue.

## External Dependencies

### APIs and Services

None. No external HTTP APIs involved.

### Libraries and SDKs

| Library                         | Version         | Purpose                                      | Installation      |
| ------------------------------- | --------------- | -------------------------------------------- | ----------------- |
| `@jsr/db__sqlite` (denodrivers) | existing        | Synchronous app-DB driver behind `$db/db.ts` | already installed |
| Kysely + `DenoSqlite3Dialect`   | 0.27.6 existing | In-memory PCD cache only (not app DB)        | already installed |

No new dependencies.

### External Documentation

- [SQLite transactions](https://www.sqlite.org/lang_transaction.html): `BEGIN IMMEDIATE` semantics; a synchronous block on a single connection cannot interleave with other JS work.
- [SQLite json_extract](https://www.sqlite.org/json1.html#jex): metadata discriminator in the orphan sweep.

## Business Requirements

### User Stories

**Primary User: PCD maintainer (exports local drafts)**

- As a maintainer, I want my exported changes to persist across restart/sync so that publishing never silently reverts my work.

**Secondary User: Operator (runs imports on startup/sync/link)**

- As an operator, I want a failed import to leave the previous base layer exactly intact so that the compiled cache is never a hybrid of old and new repo state.

### Business Rules

1. **Export batch ops are not upstream-tracked**: an op with metadata `export_batch: true` is never orphaned by `markBaseOrphaned`.
   - Validation: SQL predicate `json_extract(metadata, '$.export_batch') IS NULL` (or equivalent) in the sweep.
   - Exception: none; all other `source='repo'` base ops keep the upstream-removal semantics.
2. **Import is all-or-nothing for `pcd_ops`**: on any failure inside `importBaseOps` (candidate write, orphan sweep, final compile), every `pcd_ops` row of that database returns to its pre-import column values, and rows (and their `pcd_op_history`) created during the pass are deleted.
   - Validation: restore runs inside one synchronous native transaction (no awaits inside), history deleted before ops (FK order).
   - Exception: in-memory cache state is handled by the existing `invalidate` call, not the snapshot.
3. **Error string stability**: `Base op import failed:` log/result messages stay unchanged.

### Edge Cases

| Scenario                                               | Expected Behavior                                                      | Notes                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------- |
| Export, then restart (import)                          | Batch op stays `published`; change present in cache                    | YAN-463 regression test                            |
| Pre-existing export batch rows without the flag        | Still orphaned (no backfill)                                           | Legacy rows; documented, follow-up repair possible |
| Import fails after rewriting row A and inserting row B | A restored byte-for-byte incl. `updated_at`; B and its history deleted | YAN-466 regression test                            |
| Compile auto-override mutates user ops then throws     | User ops restored to snapshot                                          | Gap 1                                              |
| Successful retry after failure                         | No unique-filename collision                                           | Rows deleted, not orphaned                         |

### Success Criteria

- [ ] Export → `importBaseOps` → batch op `published` and change resolved in cache.
- [ ] Forced mid-import failure leaves the `pcd_ops` table (all columns) and `pcd_op_history` identical to the pre-import snapshot.
- [ ] Existing `importBaseOps.test.ts` suite (incl. #275/#286 tests) stays green; `deno task check` clean.

## Technical Specifications

### Architecture Overview

```
exportDraftOps ──(metadata.export_batch=true)──> pcd_ops batch row (source=repo)
importBaseOps:
  snapshot(all pcd_ops for db) + watermark(max ids)
  try { candidates → writer; markBaseOrphaned(excl. export_batch); compile() }
  catch { db sync tx: delete history>wm, delete ops>wm, restore snapshot rows exactly; invalidate cache; rethrow/report }
```

### Data Models

No schema change. `pcd_ops.metadata` JSON gains optional `export_batch: true` for export batch rows (`source` CHECK `repo|local|import` untouched). `PcdOp` fields restored exactly, including `updated_at`.

### API Design

No HTTP/API contract changes. `exportDraftOps` result shape unchanged.

### System Integration

#### Files to Create

- `packages/praxrr-app/src/tests/pcd/ops/exporterOrphan.test.ts` (or extend existing import test) — round-trip regression.

#### Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`: add `export_batch: true` to batch-op metadata (`buildMetadataJson`, ~L104-112; create at ~L634-646).
- `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts`: `markBaseOrphaned` (~L215-226) excludes export-batch rows; add exact-restore + delete-above-watermark helpers executed synchronously in one transaction.
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`: widen snapshot (`restoreBaseRepoOpsFromSnapshot` ~L401-435, call sites ~L462-467, ~L540-550) to all rows of the database; capture id watermarks; rollback via new helper.
- `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts`: extend failure-path assertions.

## UX Considerations

### User Workflows

#### Primary Workflow: Export

1. User opens `databases/[id]/changes`, previews, clicks "Approve & Export".
2. Toast "Exported and pushed N ops" — now true across restarts.

#### Error Recovery Workflow

1. Import fails during sync/startup; logged `Base op import failed: …`.
2. State is fully restored; retry converges. No UI change in this PR.

### UI Patterns

None changed.

### Accessibility Requirements

N/A (server-only).

### Performance UX

- `json_extract` predicate adds negligible cost to one UPDATE per import.
- Full-db snapshot is in-memory row copies; acceptable at current op volumes.

## Recommendations

### Implementation Approach

**Recommended Strategy**: minimal, local fixes extending #275 conventions (snapshot/compensate) rather than a whole-import async transaction, which on the shared singleton connection would capture unrelated writes across awaits.

**Phasing:**

1. **This PR**: T1 export_batch flag + sweep exclusion; T2 widened snapshot; T3 watermark delete + exact restore in one sync transaction; regression tests.
2. **Follow-up**: export regenerates canonical `entities/*.yaml` (consumer-visible publish); export file-path confinement validation (security finding).

### Technology Decisions

| Decision            | Recommendation                                               | Rationale                                                                     |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Batch discriminator | metadata `export_batch`                                      | No migration; self-describing; CHECK constraint blocks new `source` value     |
| Rollback mechanism  | snapshot + watermark, applied in one synchronous transaction | Safe on shared connection (no awaits); extends #275                           |
| YAML regen          | defer                                                        | Large surface (serializers, rename/delete, tweaks exclusion); separate review |
| YAN-465             | separate ticket                                              | Different subsystem                                                           |

### Quick Wins

- Log orphaned filenames count with export-batch exclusion visible in debug.

### Future Enhancements

- Canonical YAML export; per-PCD import/export mutex; surface last sync error in UI.

## Risk Assessment

### Technical Risks

| Risk                                                   | Likelihood | Impact | Mitigation                                                              |
| ------------------------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------- |
| Exclusion hides real upstream removals                 | Low        | Medium | Flag set only by exporter builder; test asserts entity ops still orphan |
| Restore clobbers concurrent legit writes during import | Low        | Medium | Imports serialized per-DB via manager/jobs; restore only on failure     |
| FK violation deleting new ops                          | Low        | Low    | Delete `pcd_op_history` above watermark first                           |
| Legacy un-flagged batch rows still orphan              | Medium     | Low    | Documented; follow-up repair                                            |

### Integration Challenges

- Compile auto-override paths mutate user ops; covered by full-db snapshot.

### Security Considerations

#### Critical — Hard Stops

| Finding                                    | Risk                        | Required Mitigation                                 |
| ------------------------------------------ | --------------------------- | --------------------------------------------------- |
| Export `filePaths` unvalidated (traversal) | File escape in export clone | Out of this bug's scope; tracked as follow-up issue |

#### Warnings — Must Address

| Finding                                    | Risk  | Mitigation                                  | Alternatives |
| ------------------------------------------ | ----- | ------------------------------------------- | ------------ |
| No per-PCD lock between pull/export/import | Races | Existing job serialization; follow-up mutex | —            |

#### Advisories — Best Practices

- Token in remote URL / `.git/config` (tracked by YAN-460).

## Task Breakdown Preview

### Phase 1: Fix

**Focus**: YAN-463 + YAN-466
**Tasks**:

- T1 exporter metadata flag + `markBaseOrphaned` exclusion
- T2/T3 importBaseOps rollback widening + pcdOps restore/delete helpers
  **Parallelization**: T1 and T2/T3 touch different functions; `pcdOps.ts` shared — assign to one writer.

### Phase 2: Tests

**Dependencies**: Phase 1
**Tasks**: export→import round-trip; failure-path exact restore + new-row deletion.

## Decisions Needed

All resolved by accepting recommended options (data integrity, minimal blast radius): D1 metadata flag; D2 YAML regen deferred; D3 snapshot+watermark in sync tx; D4 YAN-465 separate; D5 no feature flag (no user-reachable new behavior).

## Research References

- [research-external.md](./research-external.md)
- [research-business.md](./research-business.md)
- [research-technical.md](./research-technical.md)
- [research-ux.md](./research-ux.md)
- [research-security.md](./research-security.md)
- [research-practices.md](./research-practices.md)
- [research-recommendations.md](./research-recommendations.md)
