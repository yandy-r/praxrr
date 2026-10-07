# External Research: pcd-export-import-atomicity

Scope: make multi-step base-op import (many `pcd_ops` inserts/updates) atomic with rollback, and stop the
"mark-not-seen-as-orphaned" sweep from orphaning ops that were just exported/refreshed. Research date: 2026-10-07.

## Executive Summary

1. **Kysely is NOT the app-DB layer.** App DB (`praxrr.db`) is the `DatabaseManager` singleton in
   `packages/praxrr-app/src/lib/server/db/db.ts`: raw `@jsr/db__sqlite` `Database` (denodrivers/sqlite3, FFI,
   **synchronous**). Kysely 0.27.6 (pinned in `package.json`) + `@soapbox/kysely-deno-sqlite` `DenoSqlite3Dialect` is used
   only for the **in-memory PCD cache** (`pcd/database/cache.ts`, `new Database(':memory:')`) and as a query _compiler_
   (`CompiledQuery`) for op SQL. All `pcd_ops` writes go through `pcdOpsQueries` -> `db.execute(...)`.
   So `db.transaction().execute()` from Kysely is irrelevant for `pcd_ops`; the relevant primitives are raw SQLite
   `BEGIN IMMEDIATE` / `SAVEPOINT` plus denodrivers `Database#transaction`. **Confidence: High** (verified in repo source).
2. **Kysely 0.27.6 has no controlled transactions/savepoints.** `startTransaction()`, `ControlledTransaction`,
   `savepoint/rollbackToSavepoint/releaseSavepoint` shipped in **0.28.0 (2025-04-13)**. Even on 0.28+, the
   `@soapbox/kysely-deno-sqlite` driver (`PolySqliteDriver`) only implements begin/commit/rollback, so `trx.savepoint()`
   would throw "The `savepoint` method is not supported by this driver". Irrelevant unless cache writes need txns (they
   already use raw `SAVEPOINT` on `db.exec`). **Confidence: High** (release notes + driver source).
3. **Core hazard = one shared sync connection + async code.** The singleton connection has no isolation between callers
   (SQLite isolates connections, not statements). Any `await` between `BEGIN` and `COMMIT` lets other event-loop work
   (jobs, HTTP handlers, sync pipeline) run statements on the same connection; they join the open transaction and are
   rolled back with it (or committed with it). The repo already documents this (`qualityGoalApplyJournal.ts`,
   `driftStatus.ts`, `syncHistory.ts`, `configHealthSnapshots.ts` explicitly avoid `db.transaction()` for this reason).
   **Confidence: High.**
4. **Recommended shape (two-phase):** do all async work (parse, deserialize, validate against a scratch cache) first and
   _buffer_ the resulting op rows in memory; then apply them in ONE **synchronous** `BEGIN IMMEDIATE ... COMMIT` block
   (no `await` inside), including the orphan sweep. Sync block = atomic w.r.t. all other JS, rollback on throw, crash-safe.
   Then compile/swap cache after commit (existing behavior); `invalidate(databaseId)` on any failure.
   **Confidence: Medium** (design inference; depends on whether the writer pipeline can be buffered - see Open Questions).
5. **Fallback if the pipeline must stay async:** serialize with an in-process async mutex that _all_ `pcd_ops`/app-DB
   writers on that path honor, plus `SAVEPOINT` (not `BEGIN`) so it composes with outer txns. Mutex only protects
   cooperating code; jobs writing other tables via the bare singleton still interleave. **Confidence: Medium.**
6. **Orphan sweep:** `pcdOpsQueries.markBaseOrphaned(databaseId, seenAt)` compares `last_seen_in_repo_at < seenAt`
   (ISO string). It only spares rows that were rewritten with `lastSeenInRepoAt: seenAt`. Any repo-sourced base op the
   import legitimately keeps but does not rewrite (skipped candidates, rows outside a candidate's filename prefix,
   same-millisecond equality edge) is orphaned. Making the sweep run **inside the same transaction** and keyed on an
   explicit "seen set"/run id (or touching `last_seen_in_repo_at` for all retained ops) removes the dependence on
   timestamp ordering. **Confidence: Medium** (pattern-level; exact failing path to be confirmed against code).
7. **Existing compensating logic (YAN-466 `restoreBaseRepoOpsFromSnapshot`) is non-atomic:** it restores via many
   `UPDATE`s after the fact; a crash/kill mid-import or mid-restore leaves partial state. A real transaction supersedes it
   (keep only the cache `invalidate`). **Confidence: High.**

## Primary APIs

### Local stack (verified in worktree)

| Layer                    | Package / file                                                                                                                       | Notes                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| App DB driver            | `@jsr/db__sqlite@^0.12.0` (denodrivers/sqlite3), imported in `db.ts` as `Database`                                                   | Sync FFI API, `exec/prepare/changes/inTransaction/transaction`                                                     |
| App DB wrapper           | `DatabaseManager` (`db.ts`): `exec, query, queryFirst, execute, beginTransaction, commit, rollback, transaction`                     | `transaction(fn)` = bare `BEGIN TRANSACTION`, `await fn()`, `COMMIT`/`ROLLBACK`. **Async-unsafe, not re-entrant.** |
| Pragmas                  | `db.ts`: `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`                                                                 | **No `busy_timeout` set anywhere** (grep: no matches) -> C default 0                                               |
| PCD cache                | `pcd/database/cache.ts`: `new Database(':memory:', {int64:true})` + `Kysely({dialect:new DenoSqlite3Dialect({database})})`           | Separate connection; not covered by app-DB txn                                                                     |
| Kysely                   | `kysely@0.27.6` (`package.json`/lock)                                                                                                | No `ControlledTransaction`                                                                                         |
| Dialect                  | `jsr:@soapbox/kysely-deno-sqlite@^2.2.0` (`deno.json`) -> `DenoSqlite3Dialect` -> `PolySqliteDriver`                                 | Single connection + `ConnectionMutex`; txn = raw `begin`/`commit`/`rollback`; no savepoint driver methods          |
| Existing savepoint usage | `arrSync.ts` (`reviewed_sync_claim`), `writer.ts` (`pcd_writer_value_guard`), `cache.ts` (`validation_check`), `withSandboxCache.ts` | Raw `db.exec('SAVEPOINT ...')` pattern is established                                                              |
| Existing txn usage       | `snapshots/rollback/restore.ts applyRewind` (`db.beginTransaction()` ... sync body, `commit/rollback`), `migrations.ts` runner       | `applyRewind` is already a **fully synchronous** txn - the model to copy                                           |

### denodrivers/sqlite3 `Database#transaction` (sync, better-sqlite3 style)

Docs: https://github.com/denodrivers/sqlite3/blob/main/doc.md , API: https://jsr.io/@db/sqlite/doc

- `db.transaction(fn)` returns a function; calling it does `BEGIN`, runs `fn`, then `COMMIT`; `ROLLBACK` if `fn` throws.
- Variants on the returned function: `.deferred(...)`, `.immediate(...)`, `.exclusive(...)` -> `BEGIN DEFERRED/IMMEDIATE/EXCLUSIVE`.
- If called while already in a transaction it uses `SAVEPOINT / RELEASE / ROLLBACK TO` (nested-safe).
- `db.inTransaction` (boolean, "Whether DB is in mid of a transaction") - usable as a re-entrancy guard.
- `fn` must be **synchronous**: the wrapper commits as soon as `fn` returns; an `async fn` returns a Promise immediately,
  so `COMMIT` would run before the awaited work. (Inferred from the sync wrapper contract; confirm with a one-line test.)
  Types: `Transaction<T extends (...args:any[])=>void>`.
- No built-in busy timeout option on `DatabaseOpenOptions` (options: `create, readonly, memory, int64, flags, unsafeConcurrency, enableLoadExtension`); set via `PRAGMA busy_timeout = N`.
  `unsafeConcurrency` = "aggressive optimizations not possible with concurrent clients" - do not enable.

### Kysely transactions (reference; applies to PCD cache only)

Docs: https://kysely.dev/docs/examples/transactions/controlled-transaction-w-savepoints ,
API: https://kysely-org.github.io/kysely-apidoc/classes/ControlledTransaction.html

- `db.transaction().execute(async (trx) => {...})` - reserves the single connection, `begin`, commit on resolve, rollback +
  rethrow on throw. Uses `SingleConnectionProvider`: **only queries through `trx` are in the txn; the global `db` is not.**
  (Maintainer statement, https://github.com/kysely-org/kysely/issues/895).
- `trx.transaction()` -> throws `calling the transaction method for a Transaction is not supported` (0.27.6 `kysely.ts:429-431`).
- 0.28.0+: `db.startTransaction().setIsolationLevel(..).setAccessMode(..).execute()` -> `ControlledTransaction` with
  `commit()/rollback()` and `savepoint(name)/rollbackToSavepoint(name)/releaseSavepoint(name)` (each `.execute()`).
  Release notes: https://github.com/kysely-org/kysely/releases/tag/0.28.0 (2025-04-13). Current line seen: 0.28.17.
- SQLite driver ignores `isolationLevel`; begin is always plain `begin` (= DEFERRED), **no `BEGIN IMMEDIATE` hook**
  (driver source: https://raw.githubusercontent.com/kysely-org/kysely/0.27.6/src/dialect/sqlite/sqlite-driver.ts).
- `db.connection().execute(async (conn) => ...)` pins one connection without a txn.

## Libraries and SDKs

| Option                                                                                              | Verdict for this task                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Raw `BEGIN IMMEDIATE`/`SAVEPOINT` via existing `db.exec`                                            | **Preferred.** Zero deps, matches `applyRewind`, `arrSync.ts`.                                                               |
| `@jsr/db__sqlite` `db.getDatabase().transaction(fn).immediate()`                                    | Good if apply phase is sync; gives auto rollback + auto SAVEPOINT nesting. Needs a thin `DatabaseManager.transactionSync()`. |
| Upgrade Kysely to >=0.28 for controlled txns                                                        | Not useful: app DB is not Kysely; soapbox driver has no savepoint support; no IMMEDIATE.                                     |
| `fileshed/kysely-node-sqlite` (savepoints, `transactionMode: 'immediate'`, mutex)                   | Reference only (node:sqlite, different runtime). https://github.com/fileshed/kysely-node-sqlite                              |
| Async mutex (e.g. `@std/async` `Mutex`-style or the ~15-line `ConnectionMutex` pattern from kysely) | Only for the "must stay async" fallback.                                                                                     |

## Integration Patterns

### A. Sync apply block (recommended)

1. Phase 1 (async, no writes to `pcd_ops`): read repo, validate identities, build import cache, run each
   `candidate.deserialize` against the scratch cache with the repo-import write context routed to an **in-memory buffer**
   of `{filename, sequence, sql, metadata, desiredState, contentHash, lastSeenInRepoAt, state, ...}` rows instead of
   writing `pcd_ops` immediately.
2. Phase 2 (sync): `BEGIN IMMEDIATE`; insert/update every buffered row; run the orphan sweep for rows not in the retained
   set; `COMMIT`. Throw -> `ROLLBACK` -> nothing persisted (replaces `restoreBaseRepoOpsFromSnapshot`).
3. Phase 3 (async, after commit): `compile` / cache swap. On any error in phase 1-3: `invalidate(databaseId)` (keep the
   existing guard for compile-after-commit failure; note a post-commit compile failure can no longer be "rolled back" by
   the txn - decide whether compile moves before commit by compiling from the buffered rows on a scratch cache).

### B. Savepoint-in-existing-txn composition

Use `SAVEPOINT` for sub-steps (per-candidate) inside the outer sync txn so one bad candidate can be rolled back without
losing the whole import if desired (policy decision; current behavior is all-or-nothing). SQLite semantics
(https://sqlite.org/lang_savepoint.html): `RELEASE` of the outermost savepoint == `COMMIT`; inner release is not durable
until outer commit; `ROLLBACK TO` keeps the savepoint on the stack (must still `RELEASE`).

### C. Async-mutex fallback

```
importLock.run(async () => { SAVEPOINT; ...awaits...; RELEASE | ROLLBACK TO+RELEASE })
```

Only safe if every other writer of `pcd_ops` (user ops writer, rollback restore, sync claim) takes the same lock. Does
NOT stop unrelated bare `db.execute` calls (jobs, drift, history) from landing inside the open txn.

### D. Orphan-sweep fix patterns

- Same-txn sweep (so a failed import never leaves a half-applied "orphaned" set).
- Replace `last_seen_in_repo_at < seenAt` with an explicit predicate: `id NOT IN (retained ids)` (chunk to <=999/32766
  binds or use a temp table), or stamp `last_seen_in_repo_at = :seenAt` on **every** retained row (UPDATE ... WHERE id IN ...) before the sweep.
  Timestamp string comparison with ms resolution is fragile (equal-ms rows are not `<`; clock skew; skipped rows keep an old stamp).
- Mark-and-sweep generation counter (`import_run_id`) is the more robust long-term form (see "mark and sweep" reconciliation prior art:
  https://github.com/boardsesh/boardsesh/pull/4728 - rows may commit but the checkpoint/sweep only in the final txn).

## Constraints and Gotchas

**SQLite / WAL semantics** (https://sqlite.org/lang_transaction.html, https://sqlite.org/wal.html)

- One writer at a time even in WAL; readers don't block writers. A long write txn blocks other _connections'_ writers; in
  this app there is effectively one app-DB connection, so contention is with other **processes** (tests' `better-sqlite3`
  e2e helpers, backup/restore tooling, a second app instance) - and, more importantly, with other **async tasks on the same
  connection**.
- `BEGIN` = DEFERRED: lock acquired lazily; a read-then-write txn that gets upgraded can fail **immediately** with
  `SQLITE_BUSY`/"database is locked" even with a busy timeout (deadlock avoidance). Use `BEGIN IMMEDIATE` for any txn that
  will write. https://berthub.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout/ (2025-02-16),
  https://sqlite.org/src/doc/tip/doc/wal-lock.md
- `BEGIN` inside an open transaction (or after `SAVEPOINT`) errors. `DatabaseManager.transaction()` is therefore not
  re-entrant; nested call sites throw (already noted in `driftStatus.ts`/`syncHistory.ts` comments; swept rows silently dropped).
- No isolation inside a single connection (https://www.sqlite.org/isolation.html): statements from unrelated code see
  uncommitted rows and are rolled back together with the txn.
- Default `busy_timeout` is 0 in the C library; this repo never sets it. Add `PRAGMA busy_timeout` (e.g. 5000) so
  cross-process writers wait instead of failing instantly (https://hynek.me/til/sqlite-read-only-wal-locked/, 2026-07-26).
  Does not help read->write upgrade failures.
- Very large write txns grow the WAL until commit/checkpoint (https://sqlite.org/wal.html "Very large write transactions");
  bound it by batching only if import size warrants (PCD imports here are small; unlikely).
- Failure modes that auto-rollback the whole txn (`SQLITE_FULL/IOERR/INTERRUPT/NOMEM`): after any error, always issue
  `ROLLBACK`, tolerate "no transaction is active" so it does not mask the original error.
  `COMMIT` can fail with `SQLITE_BUSY` (open readers in rollback-journal mode); txn stays open - retry or rollback.
- FK enforcement is ON; deferred FKs (`PRAGMA defer_foreign_keys=ON`) are available if import order creates temporary
  dangling `superseded_by_op_id` references. Must be set inside the txn.
- Statement-level atomicity: a single `INSERT ... ON CONFLICT` / single `UPDATE` is already atomic without BEGIN; the
  existing codebase intentionally uses bare statements for hot paths.

**Async + single connection**

- `DatabaseManager.transaction(fn)` awaits `fn()` - every `await` yields the event loop; jobs (`$jobs`), sync pipeline,
  HTTP routes can issue `db.execute` mid-txn. Their writes commit/rollback with the import.
- Kysely `db` global vs `trx`: using the global instance inside a transaction callback runs **outside** the txn and, on a
  single-connection dialect with `ConnectionMutex`, **deadlocks forever** (the txn holds the only connection; the outer
  query waits for it). Kysely maintainer: "use another Kysely instance for non-transactional queries"
  (https://www.answeroverflow.com/m/1263425731527184405). Applies to the PCD cache Kysely instance: never `await cache.kysely...`
  from inside a `cache.kysely.transaction()` callback unless via `trx`.
- Kysely `streamQuery` holds the connection for the stream's life; another query on the same instance deadlocks.
- Sync FFI driver blocks the event loop; a long sync apply block stalls HTTP/jobs - acceptable for small imports, but keep the
  block free of network/file/git I/O.
- Cache writes in the import use a separate in-memory connection (`importCache`); rolling back `pcd_ops` does not roll back
  cache state -> keep `importCache.close()` in `finally` and `invalidate(databaseId)` on failure.

**Version/compat**

- Kysely pinned to 0.27.6 (no controlled txns). Don't bump just for this.
- `@soapbox/kysely-deno-sqlite` is flagged by a third-party dialect author as outdated (https://jsr.io/@marshift/kysely-deno-sqlite3); its executor calls `prepare(sql).all()` for every statement.
- `DatabaseManager.beginTransaction/commit/rollback` silently swallow `DatabaseNotInitializedError` (return without txn) - a
  caller may believe it is in a txn when it is not. Don't reuse for the new path without removing that swallow or asserting `inTransaction`.

## Code Examples

### 1. Sync IMMEDIATE transaction on the app DB (mirrors `applyRewind`)

```ts
// db.ts (addition, sketch)
transactionSync<T>(fn: () => T): T {
  const raw = this.getDatabase();
  if (raw.inTransaction) {
    // nested: compose via savepoint
    raw.exec('SAVEPOINT pcd_nested');
    try { const r = fn(); raw.exec('RELEASE SAVEPOINT pcd_nested'); return r; }
    catch (e) { raw.exec('ROLLBACK TO SAVEPOINT pcd_nested'); raw.exec('RELEASE SAVEPOINT pcd_nested'); throw e; }
  }
  raw.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();                       // MUST be sync: no await, no promise return
    raw.exec('COMMIT');
    return r;
  } catch (e) {
    try { raw.exec('ROLLBACK'); } catch { /* already auto-rolled back; don't mask e */ }
    throw e;
  }
}
```

### 2. Two-phase import (buffer then apply)

```ts
// phase 1 (async): collect rows
const buffered: BufferedBaseOp[] = [];
await withRepoImportWriteContext({ ...ctx, sink: buffered }, () => candidate.deserialize(...)); // writer pushes to sink

// phase 2 (sync): apply + sweep atomically
const { orphaned } = db.transactionSync(() => {
  for (const row of buffered) pcdOpsQueries.upsertRepoBase(row);          // insert or update-in-place by filename
  pcdOpsQueries.touchSeen(databaseId, retainedIds, seenAt);               // stamp ALL retained rows
  return { orphaned: pcdOpsQueries.markBaseOrphanedNotIn(databaseId, retainedIds) };
});
await compile(pcdPath, databaseId);                                       // after commit; invalidate on throw
```

### 3. Sweep keyed on retained set instead of timestamp (chunk-safe)

```sql
-- stamp retained rows (run in chunks of <= 500 ids)
UPDATE pcd_ops SET last_seen_in_repo_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (?, ?, ...);

-- sweep: anything repo-sourced, base, still published/draft, not stamped this run
UPDATE pcd_ops SET state = 'orphaned', updated_at = CURRENT_TIMESTAMP
WHERE database_id = ? AND origin = 'base' AND source = 'repo'
  AND state IN ('published','draft')
  AND (last_seen_in_repo_at IS NULL OR last_seen_in_repo_at <> ?);   -- exact-run equality, no `<` ordering
```

### 4. Kysely >=0.28 savepoints on a custom/other driver (raw fallback usable on 0.27.6 too)

```ts
import { sql } from 'kysely';
await db.transaction().execute(async (trx) => {
  await sql`savepoint sp1`.execute(trx); // raw; driver has no savepoint() on soapbox dialect
  try {
    /* work via trx only */ await sql`release sp1`.execute(trx);
  } catch (e) {
    await sql`rollback to sp1`.execute(trx);
    await sql`release sp1`.execute(trx);
    throw e;
  }
});
```

### 5. One-line sanity checks to leave behind (tests)

```ts
// async fn passed to sync transaction commits early -> assert it does not happen by construction
// 1) throw after 3 buffered inserts -> pcd_ops row count unchanged, no 'orphaned' flips
// 2) concurrent job write scheduled via queueMicrotask during phase 1 -> NOT rolled back with import
// 3) retained-but-unrewritten repo op survives sweep (state stays 'published')
```

## Open Questions

1. Can `writer.ts`'s repo-import write context (`withRepoImportWriteContext`, `writeContextStorage` AsyncLocalStorage) be
   redirected to an in-memory sink without breaking value-guard validation (`pcd_writer_value_guard` savepoint on the cache)?
   If not, do we accept the mutex+SAVEPOINT fallback (weaker: other bare writers still interleave)?
2. Post-commit `compileForTests`/`compile` failure (auto-override resolution can throw after `setCache`): should compile
   run on a scratch cache **before** commit so a compile failure rolls back `pcd_ops` too, instead of relying on cache
   `invalidate`?
3. Which exact retained repo ops get orphaned today? Candidates: skipped "existing" entities (`continue` path), ops whose
   filename prefix no longer matches any candidate, and equal-millisecond `seenAt`. Needs a failing test reproduction
   before choosing the sweep predicate.
4. Add `PRAGMA busy_timeout` globally (affects all writers) or only around the import txn? Other writers/processes in
   scope: e2e `better-sqlite3` helpers, backup jobs, possible second app instance.
5. Does `DatabaseManager.beginTransaction()` swallowing `DatabaseNotInitializedError` need fixing as part of this work
   (HMR re-init path), or is a new `transactionSync` that asserts `getDatabase()` enough?
6. Confirm `@jsr/db__sqlite@0.12.0` `Database#transaction` behavior when `fn` returns a Promise (expected: commits
   immediately) with a 5-line test before relying on it; otherwise prefer raw `exec('BEGIN IMMEDIATE')` as in Example 1.
7. Cross-Arr guardrail (repo policy): sweep/stamp predicates must stay `arr_type`-agnostic at the `pcd_ops` level but any
   new retained-id computation must not infer sibling-app mappings; no Arr-specific change expected - confirm during planning.

## Sources

- Kysely controlled transactions + savepoints: https://kysely.dev/docs/examples/transactions/controlled-transaction-w-savepoints (current docs)
- Kysely `ControlledTransaction` API: https://kysely-org.github.io/kysely-apidoc/classes/ControlledTransaction.html
- Kysely 0.28.0 release (2025-04-13): https://github.com/kysely-org/kysely/releases/tag/0.28.0
- Kysely issue #895 (queries use trx object only): https://github.com/kysely-org/kysely/issues/895
- Kysely single-connection deadlock discussion: https://www.answeroverflow.com/m/1263425731527184405
- Kysely 0.27.6 SQLite driver source: https://raw.githubusercontent.com/kysely-org/kysely/0.27.6/src/dialect/sqlite/sqlite-driver.ts
- Soapbox dialect source: https://gitlab.com/soapbox-pub/kysely-deno-sqlite (src/deno-sqlite3-dialect.ts, src/poly-sqlite-driver.ts); JSR: https://jsr.io/@soapbox/kysely-deno-sqlite
- denodrivers/sqlite3 docs: https://github.com/denodrivers/sqlite3/blob/main/doc.md ; JSR API: https://jsr.io/@db/sqlite/doc
- SQLite transactions: https://sqlite.org/lang_transaction.html (updated 2026-02-18)
- SQLite savepoints: https://sqlite.org/lang_savepoint.html
- SQLite WAL: https://www.sqlite.org/wal.html ; WAL locks: https://sqlite.org/src/doc/tip/doc/wal-lock.md
- SQLite isolation: https://www.sqlite.org/isolation.html
- BEGIN IMMEDIATE / busy despite timeout: https://berthub.eu/articles/posts/a-brief-post-on-sqlite3-database-locked-despite-timeout/ (2025-02-16)
- WAL busy_timeout default 0: https://hynek.me/til/sqlite-read-only-wal-locked/ (2026-07-26)
- SQLite forum on read->write upgrade: https://sqlite.org/forum/forumpost/423403c8a3f79d79
- Prior art, batched/atomic import with final-txn checkpoint: https://github.com/boardsesh/boardsesh/pull/4728
- Repo files inspected: `packages/praxrr-app/src/lib/server/db/db.ts`, `.../db/queries/pcdOps.ts`, `.../pcd/ops/importBaseOps.ts`,
  `.../pcd/ops/writer.ts`, `.../pcd/database/cache.ts`, `.../pcd/snapshots/rollback/restore.ts`,
  `.../db/queries/{arrSync,qualityGoalApplyJournal,driftStatus}.ts`, `deno.json`, `package.json`

## Search queries executed

Kysely transactions/savepoints/controlled; Kysely setIsolationLevel/controlled 0.27; SQLite WAL long write txn / BEGIN IMMEDIATE /
busy timeout; kysely-deno-sqlite single connection; SQLite isolation same connection; SQLite savepoint RELEASE semantics;
denodrivers/sqlite3 transaction; Kysely global db deadlock; SQLite import reconciliation/mark-sweep; Kysely releases 0.28.
