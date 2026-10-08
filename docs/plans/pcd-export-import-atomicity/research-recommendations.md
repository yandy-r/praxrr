# PCD Export/Import Atomicity — Research & Recommendations (YAN-463, YAN-466, YAN-465 note)

## Executive Summary

YAN-463 root cause: export writes an audit-only SQL file under `ops/` and creates a published base op with batch-shaped metadata (`entity: 'batch'`, no `stable_key`), but import was deliberately collapsed to YAML-only (#105–#110, Feb 2026) and never refreshes batch ops — so `markBaseOrphaned` reverts the exported change on the next import. Recommended fix is two-stage: (1) small stopgap excluding export-batch ops from orphaning, then (2) export regenerates `entities/*.yaml` via the existing converter so the published repo carries the change to all consumers. YAN-466 is mostly already fixed by #275 (`restoreBaseRepoOpsFromSnapshot`); the residual gap is user-op mutations made by `autoResolveOverrideConflicts` inside the final `compile()` (runs after cache swap) plus leaked new/history rows — recommend widening the snapshot and adding an id-watermark delete, not an app-DB transaction. YAN-465 is a different failure surface (overrideConflict's drop-then-regenerate); recommend NOT bundling.

Why import stopped reading `ops/`: commit `c8257f77` "refactor(#105): remove migration-mode contract and collapse base import to YAML" (−379 lines in `importBaseOps.ts`) removed SQL ingestion; `a1145bf8` "fix: lock export SQL behavior to history-only for SQL filenames (Refs #107)" locked export SQL to audit-only. The exporter comment (L380–381) states it outright: "Import no longer reads ops/ as a source; these files are retained for audit history." The export pipeline was never migrated to emit the new YAML representation — that omission is YAN-463.

## Relevant Files

- `packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts` — `exportDraftOps` (L480), `buildExportPlan` (L342), batch-op create with `source:'repo'`, `lastSeenInRepoAt: exportedAt` (L634–646), audit-only `ops/` write (L563–569)
- `packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts` — `importBaseOps` (L437), `buildPublishedRepoBaseOpIndex` (L128), `restoreBaseRepoOpsFromSnapshot` (L409), orphan-then-compile (L532–539)
- `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts` — `markBaseOrphaned` (L215–226): orphans every `source='repo'` base op with stale `last_seen_in_repo_at`
- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` — repo-import in-place rewrite by filename (L710–741), `fastPathRepoImport`, `supersedePriorUserOps`
- `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts` — `compile` (L116): cache swap (L136) THEN `autoResolveOverrideConflicts` (L144) — the uncovered YAN-466 surface
- `packages/praxrr-app/src/lib/server/pcd/conflicts/override.ts` — `overrideConflict` drop-then-regenerate (L140–156, YAN-465)
- `packages/praxrr-app/src/lib/server/pcd/migration/converter.ts` — full per-entity serializer map + `ENTITY_DIRECTORY_BY_TYPE` (L73–105): the Phase-2 building block
- `packages/praxrr-app/src/lib/server/pcd/migration/reader.ts` — `readMigrationEntitySources`: YAML-only import reader (`entities/**`)
- `packages/praxrr-app/src/lib/server/db/db.ts` — `db.transaction` helper (L213); nested-BEGIN hazards noted elsewhere (`configHealthSnapshots.ts` L293)
- `packages/praxrr-app/src/lib/server/db/schema.sql` — `pcd_ops.source` CHECK constraint `('repo','local','import')` (L376): blocks a new `export` source value without migration
- `packages/praxrr-app/src/tests/pcd/ops/importBaseOps.test.ts` — 632-line test suite; extend here (conventions from #275/#286)
- `packages/praxrr-app/src/routes/databases/[id]/changes/+page.server.ts` — export/drop action callers

## Implementation Recommendations

### YAN-463 — exported drafts revert on next import

**Recommended: two-stage. Stage 1 (ship-stopper, S):** keep batch op `source:'repo'` (CHECK constraint blocks new values without a migration), but add an explicit discriminator and exclude it from orphaning.

- `buildMetadataJson` gains `export_batch: true` (+ filename/opNumber); `exporter.ts` L104–112.
- `markBaseOrphaned` gains exclusion: `AND json_extract(metadata, '$.export_batch') IS NULL` (`pcdOps.ts` L215). Keeps upstream-removal semantics intact for all real entity ops.
- Rationale for metadata flag over filename pattern: import's index already parses op metadata (`parsePcdOpMetadata`), batch metadata is self-describing, and filename regex on `^\d+\.` is brittle against future naming.

**Stage 2 (M–L, the real fix):** export regenerates `entities/*.yaml` in the export clone, exactly as the migration converter does (`converter.ts` `ENTITY_SERIALIZERS` + `formatDeterministicYaml` + `ENTITY_DIRECTORY_BY_TYPE`), and stops creating the batch `pcd_ops` row for replay purposes — the `ops/` SQL file remains a pure audit artifact (no row, or a row in a non-replayable state only if a receipt is wanted). Sequence:

1. Build export plan as today (drafts resolved, superseded at export).
2. In the temp clone, serialize every affected entity from the current cache to `entities/<dir>/<slug>.yaml` (deterministic YAML), stage + commit + push together with the audit SQL file.
3. After pull, record per-entity base rows in `entities/<relativePath>#<seq>` format (the import path's own shape) instead of the single batch row — then the existing `buildPublishedRepoBaseOpIndex` stable-identity/filename-prefix matching refreshes them naturally on every future import. No orphaning exclusion is needed for these rows.
4. Alternatively (simpler variant worth deciding, see Key Decisions): skip step 3's eager row-writing and let the next `importBaseOps` create the rows from the pushed YAML; keep the batch row + Stage-1 exclusion until that import runs. Lower risk, but leaves a window where the local base layer is the only carrier.

Rejected option: re-reading `ops/` during import to refresh export ops (task's option C). It reinstates a SQL ingestion path that #105/#110 deliberately removed and still doesn't publish to other repo consumers. Only acceptable as an emergency hotfix if Stage 1's metadata exclusion is somehow blocked.

### YAN-466 — import failure leaves partial state

**State:** #275 already shipped `restoreBaseRepoOpsFromSnapshot` (restore-in-place for pre-existing repo rows; orphan for new rows) + `invalidate` on compile failure. Verify and close the residual gaps:

- **Gap 1 (real):** `compile()` swaps the registered cache at `compiler.ts` L136 and only then runs `autoResolveOverrideConflicts` (L144). If resolution partially mutates user ops (`dropOp`, `supersedeOp`, history rows — see `override.ts`) and then throws, `restoreBaseRepoOpsFromSnapshot` never restores those rows (snapshot filters `source === 'repo'` only). Fix: snapshot ALL `pcd_ops` rows for the database (drop the `.filter`), restore both `origin='user'` and `origin='base'` rows. S effort.
- **Gap 2:** rows created during the failed import are orphaned, never deleted, and their `pcd_op_history` rows leak (FK-enforced). Fix: capture `max(id)` watermarks for `pcd_ops`/`pcd_op_history` pre-import; on rollback DELETE rows above watermark (history first for FK order). S effort, hygiene-only (orphaned is already inert).
- **Recommended over an app-DB transaction:** `db.transaction` exists (`db.ts` L213) but the import body spans `buildImportCache` file reads, in-memory SQLite replay, and the final full `compile()` — a single write transaction held across all that risks lock contention with jobs and nested-BEGIN hazards already documented in `configHealthSnapshots.ts` L293. Snapshot+watermark keeps #275's convention and stays local to `importBaseOps.ts`.

### YAN-465 — overrideConflict drops op before replacement (DO NOT bundle)

`override.ts` L140–156 drops the conflicting user op and recompiles BEFORE generating the replacement, deliberately (comment: override handler must read a clean cache or its guards won't match). If `overrideEntity` then fails, the original op is gone — same _class_ of atomicity bug, different subsystem (conflict resolution, not export/import), different fix shape (generate replacement against a sandbox first — `pcd/sandbox/withSandboxCache.ts` exists — then swap). Bundling it would couple two review surfaces and two test suites for no shared code. Recommend a separate ticket following this work.

## Improvement Ideas

- Warn in `exporter.ts` when a batch op survives Stage 1 but the repo has no regenerated YAML for its entities (bridges Stage 1 → Stage 2 observability).
- Add `markBaseOrphaned` a debug counter/log listing orphaned filenames — today it returns only a count; YAN-463-class bugs are invisible in logs.
- Round-trip property test: export → fresh clone → `importBaseOps` → resolved cache equals pre-export resolved cache (the missing invariant that would have caught YAN-463).
- Add `exporter`/`importer` aliases to `scripts/test.ts` (existing aliases: filters, normalize, selectors, backup, cleanup, upgrades, jobs, logger).

## Risk Assessment

| #   | Risk                                                                                                         | Sev  | Likelihood | Mitigation                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------ | ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Stage 1: `json_extract` exclusion hides real upstream removals if batch metadata leaks into entity ops       | Med  | Low        | Metadata shape is builder-controlled (`entity:'batch'`); assert in test                                                    |
| 2   | Stage 1→2 window: batch op + future entity YAML ops both replay same change → duplicate/guard conflicts      | Med  | Med        | Per-entity row format (`entities/...#seq`) supersedes batch row at first refresh; add supersede step                       |
| 3   | Stage 2 serializer gaps (entity type not in `ENTITY_SERIALIZERS`) silently skips YAML regen                  | High | Low        | Fail export hard on unserializable entity (fail-fast per Portable Contract Fidelity policy); map covers all 14 types today |
| 4   | YAML roundtrip drift (serialize → deserialize ≠ original ops, e.g. field order/defaults)                     | High | Med        | Deterministic YAML formatter + roundtrip test vs cache state before enabling                                               |
| 5   | Export branch ≠ default branch: regenerated YAML pushed to feature branch still orphaned locally until merge | Med  | Med        | Preflight already reports branch; document + keep Stage 1 exclusion until merge                                            |
| 6   | YAN-466 Gap 1 fix (snapshot all rows) restore clobbers concurrent legit writes during long import            | Med  | Low        | Single-process event loop, synchronous SQLite; imports triggered from manager/job paths that serialize per-DB              |
| 7   | Watermark DELETE hits FK from `pcd_op_history`                                                               | Low  | Low        | Delete history rows first; both keyed by op id                                                                             |
| 8   | `pcd_ops.source` CHECK blocks any 'export' source value later                                                | Low  | —          | Needs migration if chosen; Stage 1 avoids it                                                                               |
| 9   | Cross-Arr semantic drift in regenerated YAML (Lidarr/Sonarr naming dirs)                                     | Med  | Low        | `ENTITY_DIRECTORY_BY_TYPE` is per-Arr explicit; reuse verbatim, no new mappings                                            |

## Alternative Approaches

**YAN-463**

- A1 _Orphaning exclusion only (Stage 1)_ — Pros: ~10-line diff, stops data loss now. Cons: other repo consumers still never see the change; batch op lives forever. Effort: S.
- A2 _Export regenerates YAML (recommended Stage 2)_ — Pros: aligns with YAML-only design (#110); publishes to all consumers; import refresh works with zero new matching logic if per-entity row format used. Cons: serializer/roundtrip risk; bigger blast radius. Effort: M–L.
- A3 _Import refreshes export ops from `ops/`_ — Pros: no exporter change. Cons: resurrects retired SQL ingestion; still not consumer-visible; contradicts c8257f77/a1145bf8. Effort: M. Not recommended.
- A4 _New `source` value 'export' + exclusion_ — Pros: explicit provenance. Cons: schema CHECK migration + query churn. Effort: M for marginal gain over metadata flag.

**YAN-466**

- B1 _Widen snapshot + watermark delete (recommended)_ — Pros: extends #275 pattern; no lock semantics change. Cons: restore code grows; covers only DB rows, not in-memory side effects (invalidate handles those). Effort: S.
- B2 _Wrap whole import in `db.transaction`_ — Pros: true atomicity incl. auto-override mutations. Cons: long write transaction across file I/O; nested-BEGIN hazard; WAL single-writer contention with jobs. Effort: M. Only if B1 proves insufficient.

## Task Breakdown Preview

Conventions from #275/#286: `fix(pcd): …` subject, body bullets stating invariants + "New tests:" list, tests in `src/tests/pcd/**` with `@std/assert`, test-only seams named `__testOnly_*`.

1. **T1 (YAN-463 Stage 1)** — `exporter.ts` metadata `export_batch`; `pcdOps.ts` `markBaseOrphaned` exclusion; test: export → importBaseOps → batch op still `published`, resolved cache retains change. (`fix(pcd): keep exported batch ops published across yaml import`)
2. **T2 (YAN-466 Gap 1)** — `importBaseOps.ts` snapshot all rows + restore user ops; test: autoResolveOverrideConflicts throws mid-resolution → user ops restored, cache invalidated.
3. **T3 (YAN-466 Gap 2)** — watermark capture + rollback DELETE (`pcd_ops`, `pcd_op_history` order); test: failed import leaves zero new rows/history.
4. **T4 (YAN-463 Stage 2, behind decision D2)** — serialize affected entities into export clone; per-entity `entities/…#seq` rows replace batch row; roundtrip property test; docs update for repo layout.
5. **T5 (follow-up ticket)** — YAN-465 sandbox-first overrideConflict.

Phasing: T1 → T2/T3 (parallel) → T4 → T5. T1+T2+T3 fit one PR or two small ones; T4 standalone PR.

## Key Decisions Needed

1. **D1 — batch-op discriminator:** metadata `export_batch` flag (recommended) vs filename pattern vs new `source` enum value (requires migration).
2. **D2 — Stage 2 row strategy:** eagerly write per-entity `entities/…#seq` rows at export (recommended) vs defer to next import and keep Stage-1 exclusion as permanent bridge.
3. **D3 — YAN-466 mechanism:** widened snapshot + watermark (recommended) vs whole-import `db.transaction`.
4. **D4 — YAN-465 scope:** confirm exclusion from this epic; file follow-up now.
5. **D5 — feature flag for T4** until roundtrip tests mature, or direct cutover (V2 not production-ready argues for direct).

## Open Questions

- Should the `ops/` audit SQL file keep getting a `pcd_ops` row at all after T4, or become file-only? (Audit queries/UI that read batch ops — `listDraftEntityChanges`, changes page — need a sweep.)
- Is export always to the default branch? Preflight reports the branch; if feature-branch exports are a supported flow, Stage 1 exclusion must survive until merge — is that acceptable UX?
- Does any consumer today read `praxrr-db` mirrors without Praxrr (CI, scripts)? Determines how urgent T4's "other consumers" payoff is.
- `markBaseOrphaned` has no index on `last_seen_in_repo_at`; `json_extract` exclusion adds a full scan per import — acceptable at current op volumes, but confirm with the largest known PCD.
- Are there live databases with pre-#275 partial imports that need a one-time cleanup pass?

## Other Docs

- `research/data-schema/persona-findings/systems-thinker.md` — earlier flow analysis noting the `exportDraftOps → ops/ → ???` gap
- Commits: `c8257f77` (YAML-only import), `a1145bf8` (export SQL history-only, Refs #107), `8fb94d69` (#110 YAML-only cleanup), `e438ef7f` (#275 / YAN-461 snapshot-restore), `f444197c` (#286 / YAN-462+464 guards)
