# Technical Research: PCD Export / Import Atomicity

## Executive Summary

- **YAN-463 remains reproducible by inspection.** `exportDraftOps` commits only an audit SQL artifact plus explicitly selected working-tree files, then creates a repo-sourced published batch op and supersedes drafts (`packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts:563-588`, `:631-657`). Import consumes `entities/`, not `ops/`; startup import orphans the batch (`pcd/ops/importBaseOps.ts:437-445`, `:535`; `db/queries/pcdOps.ts:215-225`). Export must publish portable entity source state, not preserve an unimportable SQL batch indefinitely.
- **YAN-466 task description is behind this checkout.** HEAD `f444197c` includes #286 (YAN-462/464); #275 `e438ef7f` already adds full repo-base row snapshot restoration, not merely state restoration (`pcd/ops/importBaseOps.ts:401-435`, `:462-467`, `:540-550`). Its existing regression at `src/tests/pcd/ops/importBaseOps.test.ts:1348-1470` verifies SQL and timestamp restoration. Remaining holes: new rows remain orphaned, timestamps are not restored exactly, final compile side effects exceed snapshot scope, and overlapping imports can restore over one another.
- **App DB is not Kysely.** `$db/db.ts` uses synchronous `@jsr/db__sqlite` statements on one process-global SQLite connection; Kysely with `DenoSqlite3Dialect` belongs to the separate in-memory PCD cache (`db/db.ts:1-18`, `:133-162`; `pcd/database/cache.ts:381-388`). Existing `db.transaction` accepts async callbacks but has no ownership/concurrency isolation (`db/db.ts:213-227`). A blind async transaction around import is not safe.
- Recommended export: selected-op-only ephemeral base replay, serialize affected entities through existing portable serializers and deterministic YAML formatter, commit YAML additions/updates/deletions together with optional SQL audit file, then reconcile app state from those sources. Recommended import: retain scoped-cache architecture; harden existing compensating rollback for immediate fix, and explicitly separate import persistence from effectful live compile. True crash-safe whole-pass atomicity requires an isolated app-DB transaction context or staged synchronous persistence, not a naked `db.transaction(async ...)`.

References below use `packages/praxrr-app/src/lib/server/` prefix unless explicitly marked `src/tests/` or `src/routes/`.

## Architecture Design

### Current import flow

1. Reader recursively loads entity files, determines entity type from path, validates portable payloads, resolves exact stable names, and returns deserializers (`pcd/migration/reader.ts:88-117`, `:192-235`, `:238-243`, `:261-284`). Any reader issue or duplicate identity fails before writes (`pcd/ops/importBaseOps.ts:437-445`).
2. Published base ops are indexed by stable identity, legacy entity/name, and synthetic entity filename (`pcd/ops/importBaseOps.ts:128-218`). Matching IDs are excluded from import cache, not orphaned up front (`:451-470`).
3. `buildImportCache` replays schema/base/tweaks without user-layer value-guard or history writes (`:29-45`). AsyncLocalStorage `withScopedCache` keeps this ephemeral view private to import execution; unrelated readers keep registered cache (`pcd/database/registry.ts:14-31`, `:54-63`).
4. Sorted candidate deserializers run under repo writer context. Synthetic identity is `entities/<relativePath>#00000.sql`, sequence `4_000_000_000 + candidateIndex * 10_000 + operationIndex` (`pcd/ops/importBaseOps.ts:75-78`, `:473-526`; `pcd/ops/writer.ts:54-101`). Writer validates SQL with a cache SAVEPOINT, hashes payload, updates existing filename row or inserts new row, then applies SQL directly to ephemeral cache without full compile (`pcd/ops/writer.ts:658-740`, `:782-804`; `pcd/database/cache.ts:526-547`).
5. After all candidates, stale repo rows are orphaned; one live compile runs after scoped cache exits (`pcd/ops/importBaseOps.ts:532-539`). Failure restores repo-base snapshot and invalidates registered cache; ephemeral cache closes (`:540-550`). Empty candidate branch only orphans rows, with no final compile inside import (`:551-553`).

### Current export flow and defect

`resolveSelectedOps` expands whole entity/group/dependency selections and orders draft rows (`pcd/ops/exporter.ts:282-339`). `buildExportPlan` concatenates those SQL ops into numbered `ops/*.sql`; comment explicitly calls files audit-only (`:342-398`). Export clones committed repository, writes artifact, copies selected files, stages/commits/pushes, then attempts local pull (`:538-629`). It never invokes entity serializers or converter. File selection can happen to include YAML edits, but SQL-draft export itself never produces YAML.

Published export SQL uses low numbered sequence; synthetic YAML imports use the later sequence band. Merely exempting export batches from orphaning therefore introduces two canonical representations and replay-order/value-guard hazards. New clone imports no batch at all. Refreshing audit artifacts would preserve only old local DB behavior, not fresh installs.

### Proposed export flow

1. Preserve selection expansion. Capture exact selected op rows and affected entity identities; fail closed for missing/unsupported metadata.
2. Build owned ephemeral cache containing published base plus selected draft IDs only. Exclude all user ops and unselected drafts; omit tweaks from published entity snapshot so runtime tweaks do not become upstream defaults. Existing `buildReadOnly`/`snapshotOpIds` can construct this set (`pcd/database/cache.ts:321-343`; `pcd/ops/loadOps.ts:45-63`, `:129-159`). **Do not serialize registered cache:** it includes unrelated drafts, tweaks, and local user overrides.
3. Apply selected ops in their established replay order. Read-only replay currently warn-skips non-schema SQL failures (`pcd/database/cache.ts:349-369`); export must detect failures and abort rather than publish incomplete state. Add a strict replay option only if existing hooks cannot prove all selected ops succeeded.
4. Map original names to existing source paths using committed entity candidates. Reuse current path for updates; delete old path on delete/rename; create a collision-safe YAML path for new entity names. Preserve exact config names; slug only filename. Rename chains and generated dependents must travel together (`pcd/ops/draftChanges.ts:708-717`, `:733-746`). Serialize final state, not desired-state deltas.
5. Reuse `entities/serialize.ts` serializers; type/directory mapping exists in `pcd/migration/converter.ts:73-105`; reuse `formatDeterministicYaml` (`pcd/migration/yamlFormatter.ts:38-61`). Commit only affected YAML files and deletions, plus SQL artifact if audit history retained. Validate generated payloads through `readMigrationEntitySources` before push. Reject overlapping explicit file selections for generated paths rather than overwrite one representation with another.
6. Push immutable clone commit. Only after confirmed push, reconcile selected drafts and synthetic repo ops in one protected local operation. Selected drafts must become inactive before importing their new YAML, otherwise new create entities can be skipped by current presence check (`pcd/ops/importBaseOps.ts:482-498`). Remove replayable audit-batch creation; audit artifact/history is not canonical SQL.
7. Pull failure must not be treated as successful local reconciliation against old sources. Keep/reuse pushed clone until reconciliation succeeds or report explicit pushed-but-local-reconciliation-failed result. Remote Git and local DB cannot share one transaction; recovery must retain evidence of pushed commit and selected ops.

### Import atomicity and transaction feasibility

All `pcdOpsQueries` calls immediately use singleton app DB (`db/queries/pcdOps.ts:76-105`, `:149-212`). Native SQLite can transactionally cover their SQL, and app DB transaction need not include cache SQLite connection: ephemeral cache is disposable. However deserializers, crypto digest, log calls, source IO, and compile all await. On shared connection, unrelated app queries issued during an await join the same transaction, can see uncommitted rows, and can be rolled back by importer. Per-database mutex alone does not isolate app DB transactions from unrelated writers or other PCDs.

Live compile also writes app DB: history insertion, user-op auto-drop, disabling database on build failure (`pcd/database/cache.ts:124-127`, `:196-203`, `:249-261`, `:289-294`). It swaps/closes registered cache before async auto-override work (`pcd/database/compiler.ts:116-146`), which can create further user ops through override handlers. Repo-base-only restore cannot undo these effects. Cache invalidation is necessary after a failure after swap, but does not restore history, user state, or enabled flag.

**Immediate bounded approach:** harden existing snapshot rollback for failures during candidate import; use synchronous native SAVEPOINT for the restore itself, delete newly inserted repo rows rather than orphan them, and restore every original column including `updated_at`. Serialize same-PCD import/export operations. Keep effectful compile out of the rollback scope: complete durable import, then compile; compile failure reports cache-build failure without claiming source import was rolled back. This explicitly defines atomicity as canonical import persistence, not the entire live compiler lifecycle.

**If acceptance requires any compile failure to restore pre-import app state:** use isolated app-DB connection plus AsyncLocalStorage transaction routing for all query families reached by compile, or fully stage mutations before a short synchronous commit. Existing singleton queries cannot meet this safely without plumbing. Do not silently ship narrow repo-row rollback as whole-pass atomicity. Cache publication must occur after durable commit; compile should expose prepare/build and publish/resolve phases if this stronger boundary is chosen. Rollback must cover `pcd_ops`, `pcd_op_history`, relevant instance fields, and any override-generated mutations.

## Data Models

No new portable entity schema needed. Existing portable serialization already has explicit Radarr/Sonarr/Lidarr functions (`pcd/entities/serialize.ts:181-325`, `:331-385`). Reuse these; do not map sibling Arr fields by inference.

`PcdOp` stores SQL, metadata, desired state, content hash, source identity, lineage, push bookkeeping, and creation/update timestamps (`db/queries/pcdOps.ts:7-26`). Filename uniqueness spans every base state (`db/migrations/041_create_pcd_ops.ts:62-65`), making deterministic orphan-row reuse intentional. Current rollback restores all update-input fields but `update()` always changes `updated_at`; newly created orphan rows still hold unique filenames (`pcd/ops/importBaseOps.ts:416-433`; `db/queries/pcdOps.ts:208-211`). Exact rollback needs purpose-specific SQL restore/delete, not generic update alone.

Extend internal export plan with generated file writes/deletions and selected source-state fingerprint. Existing plan fields remain usable for SQL audit (`pcd/ops/exporter.ts:43-54`). Do not invent new `source` enum merely to avoid orphaning: enum constrained to `repo|local|import` (`db/migrations/041_create_pcd_ops.ts:39-41`). Repo canonical state should be synthetic entity ops; audit batches should not replay.

## API Design

No new HTTP endpoints required. Existing changes page invokes `previewDraftOps` / `exportDraftOps` (`src/routes/databases/[id]/changes/+page.server.ts`). Preserve current argument and result contracts where possible (`pcd/ops/exporter.ts:17-20`, `:409-414`, `:480-486`). Preview should expose generated YAML paths/deletions alongside SQL audit content, and actual `fileCount` should include committed entity source changes if UI intends total commit files. Confirm compatibility before changing meaning of `fileCount`, `filename`, or nullable `opId`.

Export must distinguish pre-push failure from post-push reconciliation failure. If additive response fields become public API work, update corresponding contract and generated types first. No Arr API calls needed for this feature; portable validators remain trust boundary.

## System Constraints

- Filesystem/Git push cannot rollback with app SQLite. Do not supersede drafts before confirmed push. Do not retry a confirmed push blindly after local reconciliation error.
- Existing clone safety isolates Git writes from unrelated working-tree changes (`pcd/ops/exporter.ts:84-90`, `:557-588`); retain this. Validate selected paths are relative and confined to clone; account for deletion instead of `copyFile` only (`:573-582`).
- No blanket whole-cache conversion: `convertCompiledCacheToEntities` enumerates all entities, writes incrementally, does not remove obsolete paths, and catches failures until end (`pcd/migration/converter.ts:347-359`, `:389-459`, `:478-488`). Direct use with overwrite does not implement selected atomic export.
- #275 protects user ops from partial-base recompiles. Preserve no-user scoped import cache and exactly one post-import live compile. #286 protects guarded update chains; never flatten SQL or supersede load-bearing prior ops merely for convenience.
- Existing exported batch recovery is separate from forward fix: already-orphaned batch plus superseded drafts may need explicit repair. Never automatically republish unknown audit SQL over changed upstream YAML.
- Empty entity repository is valid input to reader (`pcd/migration/reader.ts:88-93`); define removals and cache refresh consistently for zero candidates.

### Test strategy

Existing import tests use real in-memory cache plus patched query/reader/compiler collaborators. Coverage includes identity conflicts, refresh and skip behavior, user-op preservation and single final compile, and failed deserialize restoration (`src/tests/pcd/ops/importBaseOps.test.ts:110-197`, `:278-462`, `:1248-1269`, `:1348-1470`). Manager tests cover orchestration failure/success (`src/tests/pcd/migration/managerImportOrchestration.test.ts:142`, `:213`). Converter tests prove reader-compatible paths, deterministic bytes, and failure reporting (`src/tests/pcd/migration/converter.test.ts:272`, `:331`, `:476`, `:506`). No direct `exportDraftOps` test found under `src/tests/`.

Required additions:

1. Real temporary bare Git remote + clone + real isolated app DB. Import baseline YAML, create draft edit, export, assert pushed YAML contains edit; close app DB and caches, reopen persisted DB, run startup-equivalent `importBaseOps` then compile; assert same entity value. Fresh second app DB import from pushed repo must match too. No stub importer for this oracle.
2. Selected export isolation: unselected draft and user override on same/other entity must not leak into YAML. Create/update/delete/rename, rename chains, slug collisions, explicit-file overlap, dependency-generated changes, and all relevant Arr-specific serializers.
3. Import failure after rewriting old row and inserting new row: compare exact persisted rows including SQL, metadata, desired state, hashes, timestamps, lineage and filename set. Retry successfully; no leftover unique-filename collision.
4. Failure from missing dependency/SQL application, deserialize result, orphaning, and final compile. Assert chosen boundary explicitly: either complete rollback of all app effects or committed import with invalidated cache and clear compile error. User/history/enabled state must not be accidentally left half-mutated.
5. Empty-candidate import removals, repeated import idempotence, simultaneous import/export rejection or serialization, and forced failure followed by restart. If transaction routing added, unrelated app write during awaited import must neither join nor be rolled back.

Tests were inspected, not executed during research. Use existing Deno test runner and project aliases/options; no new test framework.

## Codebase Changes

| File / function                                 | Required change                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pcd/ops/exporter.ts:342-398` `buildExportPlan` | Build selected replay snapshot and affected entity file plan; preserve optional SQL audit. Shared preview/export plan generation.                            |
| `pcd/ops/exporter.ts:563-588` clone write stage | Write portable YAML, delete obsolete source paths, validate clone before commit; stage generated paths explicitly.                                           |
| `pcd/ops/exporter.ts:597-657` pull/bookkeeping  | No replayable audit batch. Reconcile synthetic repo ops and deactivate selected drafts after push; handle local pull failure explicitly.                     |
| `pcd/migration/converter.ts:73-105` mappings    | Expose minimum existing type-to-directory/serializer helper needed by exporter instead of duplicating complete maps; keep full converter behavior unchanged. |
| `pcd/database/cache.ts:321-369` `buildReadOnly` | Optional strict selected replay if needed; default behavior unchanged for lineage/import users.                                                              |
| `pcd/ops/importBaseOps.ts:401-435`, `:437-553`  | Harden rollback/delete semantics; define compile failure boundary; serialize import/export; zero-candidate behavior parity.                                  |
| `db/queries/pcdOps.ts:149-227`                  | Purpose-specific exact restore/delete helper only if compensating rollback chosen; no weakening orphan filter.                                               |
| `pcd/database/compiler.ts:116-148`              | Only if strong whole-pass boundary selected: split build from publish/auto-resolve. Otherwise avoid compiler refactor.                                       |
| `db/db.ts:213-227`                              | Only if isolated transaction path selected: connection routing/ownership; never naked async singleton transaction.                                           |
| `src/tests/pcd/ops/importBaseOps.test.ts`       | Extend partial-write/compile/empty-import regression assertions.                                                                                             |
| `src/tests/pcd/ops/exporter.test.ts` (new)      | Real Git/app DB round-trip and failure-boundary oracle; reuse existing test conventions.                                                                     |

## Technical Decisions

1. **Canonical entity YAML export, not orphan exemption.** Matches importer and makes fresh clones correct. Audit SQL remains history only; no second live base representation.
2. **Reuse serializers, formatter, slug handling.** Existing modules cover all supported entity families; new serialization infrastructure unnecessary. Source-path index needed for arbitrary existing YAML/JSON paths and rename/delete correctness.
3. **Selected snapshot, not registered cache or full converter.** Prevents leaking user overrides/unselected drafts and avoids unrelated source churn. New dependencies selected by current resolver are included.
4. **Preserve #275 and #286 architecture.** No full compile during candidate deserialization; no rewrite of guarded op chains.
5. **No blind async transaction.** Synchronous SQLite capability is real; safe transaction ownership is absent. Immediate bounded snapshot hardening is smaller, but guarantees must be named honestly. Strong whole-pass crash-safe guarantee requires transaction/context and compiler publication work.
6. **No unrelated runtime edits in research.** This document is only output; recommendations require implementation approval and review.

## Open Questions

- Does YAN-466 require physical row equality and crash safety, or only no effective partial imported state after handled deserialize failures? #275 already meets much of latter. This decides compensating rollback versus isolated/staged transaction scope.
- Must final compile/auto-override failure rollback canonical source import, or can import commit and expose cache-build failure? Existing catch implies stronger guarantee than implemented.
- Keep SQL audit artifact and legacy `opId` result? If yes, what inactive lineage record replaces replayable batch? Clarify UI consumers before changing history semantics.
- Export snapshots should exclude tweaks; confirm product contract. Persisting tweak-computed state would convert local runtime transformation into upstream base defaults.
- How recover exports already superseded/orphaned under old path without replaying stale guards or clobbering newer upstream state? Explicit user repair may be safest.
- Which entities outside portable family set can appear as draft metadata (e.g. quality-profile test entities/releases)? Serializer currently carries custom-format tests, but quality-profile serializer reads only profile fields/qualities/scores (`pcd/entities/serialize.ts:126-175`). Unsupported selected state must fail visibly, not disappear.
- Does current timestamp identity need replacement for concurrent same-millisecond imports? Serialization mitigates concurrency, but monotonic import token could avoid `< seenAt` ambiguity if needed.
