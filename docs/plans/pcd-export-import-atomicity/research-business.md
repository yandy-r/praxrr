# PCD Export/Import Atomicity — Business Research

Scope: YAN-463 (exported drafts revert on next import) and YAN-466 (failed import leaves partial state).
Business logic only: stories, rules, workflows, domain model, integration, success criteria, open questions.

## Executive Summary

PCD promises two things that are currently broken:

1. **Export publishes local work.** A user edits config, reviews drafts on the Changes page,
   commits them, and expects the change to be live in the repo and survive the next pull.
   Today it does not: `exportDraftOps` (`packages/praxrr-app/src/lib/server/pcd/ops/exporter.ts`)
   writes the change as raw SQL under `ops/` plus a published base op row, but `importBaseOps`
   (`packages/praxrr-app/src/lib/server/pcd/ops/importBaseOps.ts`) only reads `entities/` YAML.
   Nothing it wrote is ever read back. Worse, the published op it recorded carries
   `source:'repo'` with `lastSeenInRepoAt=exportedAt`, so the next import's
   `markBaseOrphaned` (`packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts`)
   treats it as a deleted upstream file and orphans it — **the export visibly reverts itself**.
   The `entities/` YAML the importer actually consumes is never touched by export.
2. **Import is all-or-nothing.** A failed `importBaseOps` must leave the op table and the cache
   exactly as before. The writer path (`packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`)
   rewrites matched rows in place and inserts new rows as it goes, so a mid-import failure
   without a full snapshot restore leaves a partially applied import: some entities refreshed,
   some stale, some orphaned.

The round-trip contract that must hold: **export → import → compile reproduces the exported
state, and a failed import reproduces the pre-import state.**

## User Stories

### Export (publisher)

- **US-1 — Publish local edits.** As a database maintainer with a PAT-configured PCD, I edit a
  custom format locally, open Databases → Changes, select the draft change, enter a commit
  message, preview, and commit. The change is pushed to the repo branch, becomes canonical base
  state, and is still present after the next sync/pull.
- **US-2 — Preview before publishing.** As a maintainer, I preview an export (SQL content,
  filename, op count, preflight checks, git identity) before committing, so I never push
  something I have not reviewed.
- **US-3 — Blocked with a reason, not a broken push.** As a maintainer, when export cannot
  proceed (no PAT, missing git identity, dirty repo, behind/ahead of remote, invalid manifest),
  I get a specific error per failed check and nothing is pushed or recorded.
- **US-4 — Discard drafts.** As a maintainer, I drop draft ops I no longer want; they become
  `dropped`, leave the compiled view after recompile, and are never exported later.
- **US-5 — Read-only consumer stays read-only.** As a user of a PCD without a PAT (or with
  local ops enabled), I cannot publish changes (`canWriteToBase` false); the Changes page tells
  me why instead of offering a broken commit button.

### Import (consumer)

- **US-6 — Pull upstream updates safely.** As a PCD consumer with auto-pull or manual sync, I
  pull upstream changes and get exactly the new canonical state: new entities appear, changed
  entities update, removed entities disappear from the compiled view, and my user-layer
  overrides still apply on top.
- **US-7 — Failed import changes nothing.** As a consumer, when an import fails (bad YAML,
  duplicate stable identity, deserialize/write failure, compile failure), my database keeps
  serving the exact pre-import state — same op rows, same compiled cache, same Arr sync
  behavior. I see an error naming the offending entity file.
- **US-8 — Local-path PCDs stay in sync.** As a developer using a local-path PCD source, a
  refresh re-imports `entities/` and recompiles without requiring git push/pull.
- **US-9 — Entities I created locally are not clobbered.** As a maintainer, entities I created
  locally (base drafts or user ops) that happen to share a name with an incoming repo entity
  are skipped with a warning, not overwritten — and upstream renames keyed by stable identity
  still match correctly.

## Business Rules

### Op identity

- **BR-1 — Layers.** `origin` is `base` (canonical config) or `user` (local overrides).
  Compile replays schema → base → tweaks → user; user ops persist across base refreshes.
- **BR-2 — Sources.** `source` is `repo` (arrived via import, or published via export),
  `local` (created in-app), or `import` (portable JSON import). Only `repo`-sourced base ops
  participate in orphan detection.
- **BR-3 — States and lifecycle.**

  | State        | Meaning                                                                                 | Replay in compile? |
  | ------------ | --------------------------------------------------------------------------------------- | ------------------ |
  | `published`  | Live. Base-published = canonical; user-published = override.                            | Yes                |
  | `draft`      | Local base change, not yet pushed. Only `origin=base, source=local` rows can be drafts. | Yes                |
  | `superseded` | Replaced by `superseded_by_op_id`. Terminal.                                            | No                 |
  | `dropped`    | Explicitly discarded by user. Terminal.                                                 | No                 |
  | `orphaned`   | Upstream no longer contains it (or failed-import cleanup of new rows). Inert.           | No                 |

  Transitions: `draft → published` is NOT a transition — export supersedes drafts and inserts a
  new published row. `draft → dropped` (user discards), `draft → superseded` (exported),
  `published → superseded` (refreshed in place stays `published`; user-op chain supersede),
  `any base-repo → orphaned` (upstream removal). `orphaned` and `superseded` are terminal;
  nothing revives them.

- **BR-4 — `lastSeenInRepoAt` is the liveness heartbeat.** Every import stamps refreshed/created
  repo ops with `seenAt`. `markBaseOrphaned` orphans repo base ops with an older (or null)
  stamp. Any code path that creates a `source='repo'` row MUST guarantee the artifact it
  describes will be seen by the next import, or that row will be orphaned — this is the exact
  YAN-463 mechanism.

### Export rules

- **BR-5 — Export writes what import reads.** An export is only complete when the pushed commit
  contains the entity data in the format `importBaseOps` consumes (`entities/` YAML). A SQL
  audit file under `ops/` alone is not a publication; import ignores `ops/`.
- **BR-6 — One export, one published row, drafts superseded atomically.** Successful export
  inserts exactly one `origin=base, state=published, source=repo` row and marks every exported
  draft `superseded` pointing at it. Partial bookkeeping (row without supersede, or supersede
  without row) must be impossible.
- **BR-7 — Preflight gates.** Export requires: PAT present and local ops disabled
  (`canWriteToBase`), git author name+email, local repo on disk, valid manifest, reachable
  remote, no staged files, zero behind, zero ahead. Failure blocks push AND bookkeeping.
- **BR-8 — Numbering is audit-only.** `ops/<n>.<slug>.sql` numbering derives from committed
  `ops/` history (`getMaxOpNumber`). It is an audit trail, not an import source.
- **BR-9 — Empty selection is an error.** No ops and no file paths → reject; no empty commits.

### Import rules

- **BR-10 — YAML is the sole import source.** `readMigrationEntitySources` reads `<repo>/entities/`
  (`.yaml/.yml/.json`). Missing `entities/` dir = empty import (orphan pass only), not an error.
- **BR-11 — Stable identity wins.** Entity matching order: stable key (`stable_key.key=value`)
  → legacy `entityType + lowercase(name)` → filename prefix `entities/<relativePath>`.
  Duplicate stable identities inside one import fail fast (`validateStableIdentityConflicts`).
- **BR-12 — Refresh in place, then single orphan pass, then single compile.** Matching published
  repo ops are rewritten in place (same row id, new `seenAt`); new entities insert rows;
  `markBaseOrphaned` runs once before the final `compile()`. No per-entity compile (protects
  user ops from partial-base evaluation — YAN-461).
- **BR-13 — Failed import restores everything.** On any failure: every pre-existing repo base
  row is written back field-for-field from the pre-import snapshot; rows created during the
  failed run become `orphaned`; the registered cache is invalidated if a swap may have
  happened; no compile runs against partial state. Net effect: op table and served cache
  identical to pre-import.
- **BR-14 — Import never touches user ops or base drafts.** Drafts and user rows are invisible
  to matching, orphaning, and restore. Skipped entities (already present in registered cache,
  covering user-created and draft entities) log a warning and continue.

### Cross-cutting

- **BR-15 — Case-insensitive entity names.** Uniqueness and matching on names are
  case-insensitive everywhere (create/rename enforcement, import `lower(name)` checks).
- **BR-16 — Import failure surfaces, sync reports it.** `sync()` and `switchBranch()` return
  `success:false` with `Base op import failed: <reason>` instead of proceeding to seed,
  compile-as-success, or Arr sync fanout.

## Workflows

### W-1 — Export drafts (happy path)

1. User selects draft changes + optional repo file paths on
   `routes/databases/[id]/changes`, enters commit message → `preview` action →
   `previewDraftOps` returns preflight checks + SQL content + filename + hash.
2. User confirms → `commit` action → `exportDraftOps`:
   preflight → build plan (resolve selection + group/dependency closure, render SQL,
   next op number) → clone local repo to temp dir → write `ops/<n>.sql` + copy selected
   files → stage/commit/push → checkout + `pull --ff-only` local → insert published base op
   (`source=repo`, `lastSeenInRepoAt=exportedAt`), supersede drafts, history rows →
   compile (if enabled) → log + return.
3. Next `sync()` pulls the commit, `importBaseOps` sees the published artifact
   (YAML, per BR-5), refreshes the op in place with a fresh `seenAt`. No orphaning.

### W-2 — Export blocked (preflight failure)

Preflight fails → preview shows per-check errors → commit path refuses before any git or DB
mutation. No partial push, no published row, drafts stay `draft`.

### W-3 — Import via sync/pull (happy path)

`sync()` (remote: check → pull → deps; local-path: refresh clone) → `importBaseOps`:
read `entities/` → fail fast on reader issues/duplicates → snapshot repo base rows →
build ephemeral import cache (base minus refresh set, no user layer) → per candidate:
skip-if-present (registered cache) else deserialize through writer with repo-import context
(rewrite-in-place or insert, fast-path apply) → `markBaseOrphaned` → single `compile()` →
seed built-ins → `updateSyncedAt` → `triggerSyncs(on_pull)` → Arr syncs.

### W-4 — Import failure recovery (YAN-466)

Any throw inside the import loop or final compile → `restoreBaseRepoOpsFromSnapshot`
(full field restore + orphan novel rows) → `invalidate()` cache → rethrow with entity file
in message → `sync()` returns `success:false`, skips seed timestamp update and Arr fanout.
Operator fixes the repo content (or offending YAML) and re-syncs; the retry is a clean import.

### W-5 — Entity removed upstream

Entity file deleted from `entities/` → no candidate refreshes its op → op keeps old `seenAt`
→ orphan pass marks it `orphaned` → final compile drops it from the cache. User overrides
targeting it follow existing conflict handling.

### W-6 — Startup / link / branch switch

- `link()`: clone → manifest → deps → create instance → `importBaseOps` → seed built-ins →
  compile. Failure rolls back the instance row + cloned dir.
- `initialize()`: seed built-ins for all → validate deps → `importBaseOps` per enabled →
  compile per enabled. Per-instance failures log and continue; one bad PCD never blocks boot.
- `switchBranch()`: checkout → pull → `importBaseOps` (throw on failure) → seed → timestamp.

## Domain Model

`pcd_ops` row: `id, database_id, origin(base|user), state, source(repo|local|import),
filename, op_number, sequence, sql, metadata(operation/entity/name/stable_key/...),
desired_state, content_hash, last_seen_in_repo_at, superseded_by_op_id, pushed_at,
pushed_commit, created_at, updated_at`. Full schema:
`packages/praxrr-app/src/lib/server/db/schema.sql` (~L375),
`packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts`.

State diagram (base layer, repo-connected database):

```
local edit ──► draft ──export──► superseded ──► (terminal)
                              └─► NEW published(source=repo, lastSeen=exportedAt)
                                           │ next import sees artifact → refreshed (stays published, new seenAt)
                                           │ next import misses artifact → orphaned (inert, terminal)

upstream add ──import──► published(source=repo)
upstream change ──import──► published (same row, rewritten, new seenAt)
upstream delete ──import──► orphaned
failed import ──restore──► prior state (pre-existing rows) / orphaned (novel rows)

user edit ──► published(origin=user) ──► superseded by newer user op (guard-chain aware)
draft ──user drops──► dropped (terminal)
```

Compile replay set = `published + draft` only; `superseded/dropped/orphaned` are invisible.

## Existing Codebase Integration

- **Export UI:** `routes/databases/[id]/changes/+page.svelte` (selection, message, preview
  pane, preflight display) + `+page.server.ts` actions `commit/preview/drop/pull`.
  PAT-gated via `load` (`isDeveloper`); write gate `canWriteToBase` (writer.ts) requires PAT
  and disabled local ops. No `/api/v1` export endpoint — export is page-action only.
- **Portable export/import (separate system):** `GET /api/v1/pcd/export`, `POST /api/v1/pcd/import`
  move entities between databases as JSON (`docs/features/portable-import-export.md`,
  `docs/api/v1/paths/pcd.yaml`). Unaffected by YAN-463/466 except shared writer semantics.
- **`pcdManager.initialize`** (manager.ts ~L395): seed → import → compile per enabled instance,
  failure-isolated per instance. Startup in `hooks.server.ts`.
- **Sync → Arr fanout:** `sync()` calls `triggerSyncs({event:'on_pull'})` only after import +
  compile succeed (`packages/praxrr-app/src/lib/server/sync/processor.ts`). Import failure
  must therefore also mean no Arr push — W-4.
- **YAML tooling already exists for the fix:** `pcd/migration/converter.ts` serializes cached
  entities to deterministic YAML (`yamlFormatter.ts`, `migration: {format, version, source:
pcd-export}` header — the exact header seen in `packages/praxrr-db/entities/**`),
  `pcd/migration/reader.ts` reads them back. Export currently uses neither; it hand-renders SQL.
- **Compiler:** `pcd/database/compiler.ts` + `registry.ts` (`withScopedCache`, registered vs
  ephemeral import cache). `pcdOpHistory` records applied/skipped/dropped/superseded per op.
- **Snapshots:** `snapshotService.createAutoSnapshot` runs pre-pull (best-effort); it is a
  backup affordance, not the import-atomicity mechanism — BR-13 restore is.

## Success Criteria

- **SC-1 (YAN-463):** Export a draft change, run sync/import, assert the change is present in
  the compiled cache AND the exporting op row is still `published` (not `orphaned`).
- **SC-2:** Exported commit contains `entities/` YAML for every exported entity change; a fresh
  `link()` of the pushed repo reproduces the exported state with zero drafts.
- **SC-3 (YAN-466):** Inject a failure mid-import (bad YAML N of M, duplicate stable identity,
  deserialize error, compile error) and assert: op table byte-identical to pre-import snapshot
  (except `updated_at`), served cache unchanged, sync result `success:false`, no Arr fanout.
- **SC-4:** Upstream entity deletion still orphans exactly the removed entity's ops and nothing
  else; user ops and drafts untouched by any import.
- **SC-5:** All preflight blocks (no PAT, no identity, behind/ahead, dirty-staged, bad
  manifest) leave zero git and zero DB side effects.
- **SC-6:** Regression suite covers: export→import round-trip, re-import idempotence
  (no duplicate rows, no state churn), failed-import restore, orphan-on-delete.

## Open Questions

- **OQ-1 — Published artifact format: `entities/` YAML, `ops/` SQL, or both?** Evidence points
  to YAML-only as canonical: `packages/praxrr-db/README.md` ("`entities/` is the canonical
  source… Legacy SQL fixtures in `ops/` used for bootstrap ingestion were removed during the
  SQL-to-YAML cutover, so repository seed data is now YAML-only"), `importBaseOps` reads only
  `entities/`, and the exporter itself comments that `ops/` files are "retained for audit
  history". The `praxrr-db` mirror layout confirms it: `entities/**` (custom-formats,
  quality-profiles, delay-profiles, media-management, metadata-profiles, regular-expressions),
  `pcd.json` manifest, no `ops/` dir. Proposed resolution: export writes/updates `entities/`
  YAML via `converter.ts` + deterministic formatter as the published artifact; `ops/*.sql`
  stays as human audit trail. Needs maintainer confirmation because it changes what a "PCD
  repo" promises to consumers.
- **OQ-2 — Who serializes on export: cache or drafts?** `converter.ts` serializes from the
  compiled cache (post-change state). Draft ops on the Changes page are per-op diffs; mapping
  selected op subsets back to whole-entity YAML files (one file per entity, last-writer-wins
  per entity across selected + unselected drafts) needs a defined rule: export whole-entity
  files for every entity touched by the selection, requiring the selection closure
  (`resolveSelectedOps` group/requires expansion) to be entity-complete or rejected.
- **OQ-3 — Filename/identity stability for exported YAML.** Reader matches by stable key first,
  so renames survive — but only if the serializer emits the same stable key the deserializer
  wrote. Confirm the round-trip key contract per entity type (which types lack stable keys and
  fall back to `lower(name)` / filename prefix, where export renames could orphan+recreate).
- **OQ-4 — `op_number`/filename-prefix collision between export SQL and import YAML.** Import
  writes synthetic filenames `entities/<relativePath>#…` in a high sequence band
  (`YAML_SEQUENCE_BASE=4,000,000,000`), while export writes `ops/<n>.sql` numbered from
  `getMaxOpNumber`. If export bookkeeping keeps recording `filename=ops/<n>.sql` with
  `source='repo'`, orphan detection still bites unless the row's filename/content matches
  something import refreshes. Decide: does the export-published row adopt the entity-filename
  identity (per exported entity, mirroring import rows) or stay one batch row — and how does a
  batch row survive `markBaseOrphaned` at all under BR-4?
- **OQ-5 — Restore vs concurrent writes.** `restoreBaseRepoOpsFromSnapshot` runs in-process,
  but app DB is SQLite with WAL; a concurrent user edit between snapshot and restore can
  interleave. Is a transaction boundary (or write lock) required around import for true
  atomicity, or is single-writer job dispatch sufficient?
- **OQ-6 — Deletes and renames on export.** Draft ops can represent deletes/renames, but a
  whole-entity YAML file model only supports add/update. Export of a delete presumably means
  removing a YAML file from the repo commit — undefined today. Rename means filename change
  plus stable key continuity. Both need explicit workflow definitions before YAN-463 fix lands.
- **OQ-7 — Two published artifacts, one source of truth for `entities/` vs user hand-edits.**
  `exportDraftOps` already supports copying arbitrary repo `filePaths` (users hand-editing
  YAML). If export also writes YAML, a conflict between generated files and hand-edited files
  staged in the same commit needs precedence rules (fail preflight when both selected?).
- **OQ-8 — `praxrr-db` mirror governance.** AGENTS.md says `packages/praxrr-db` mirrors via
  subtree publish. If Praxrr instances now push `entities/` YAML directly to PCD repos, does
  the official Praxrr-DB repo accept app-generated commits, or must maintainer flow remain
  monorepo → subtree → mirror? Affects whether export targets forks only.
