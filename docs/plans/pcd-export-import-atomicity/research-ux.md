# UX Research: PCD Export / Import Atomicity (YAN-463, YAN-466)

## Executive Summary

Fixes target server-side atomicity; no new UI needed. Today UX already has a solid export path (preflight -> preview modal -> "Approve & Export" -> `alertStore` success) but a **blind spot after export**: success alert says "Exported and pushed N ops" while the next import may silently revert those ops (YAN-463), and a failed import surfaces only as `Pull failed: Base op import failed: ...` while DB is left in a hybrid state (YAN-466). Core UX rule from config-as-code tools: **"success" must mean durable and consistent; "failure" must mean state unchanged (or state precisely described) plus a retry path.** Best fix = make import all-or-nothing (transaction/stage-then-swap) so existing messaging becomes truthful. Optional small copy tweaks only.

**Confidence**: High on current-UI findings (read from source). Medium on tool comparisons (official docs, single source each).

## User Workflows

### Export (developer-only; `isDeveloper` = has PAT)

Route: `packages/praxrr-app/src/routes/databases/[id]/changes/+page.svelte` + `+page.server.ts` actions `preview`, `commit`, `drop`, `pull`.

1. Open Changes page; `fetchChanges()` loads status, incoming commits, `draftChanges`.
2. If `hasIncomingChanges`: commit input + preview button disabled; warning alert "Pull incoming changes before exporting."
3. Select drafts (group + dependency auto-select, info alert "Auto-selected N dependencies").
4. Enter commit message -> preview (`?/preview`) -> modal shows SQL, op count, identity, preflight badges (clean, up to date, remote reachable, manifest, identity, can publish). Stale-selection / stale-message guards disable confirm.
5. "Approve & Export" (`?/commit` -> `exportDraftOps`): writes SQL file, git commit/push, marks ops `published`, supersedes originals. Success: `alertStore.add('success', 'Exported and pushed 3 ops (file.sql)')`, refetch, clear selection.
6. Failure: `alertStore.add('error', 'Export failed: <detail>')`; modal stays open.

### Import (pull/sync)

- Triggers: StatusCard refresh button ("Sync now"), "Pull N commits" button, `auto_pull` job, startup.
- UI action `?/pull` only **enqueues** a `pcd.sync` job (`enqueueManualPcdSync`). Alerts: "Sync queued (job #N)" / "Sync already running in background" / "Sync requested". These report **enqueue**, not **outcome**.
- Real outcome (`PCDManager.sync` -> `importBaseOps`) returns `{success:false, error:'Base op import failed: ...'}` only to the job; it is logged (`logger.error`) but **no alert is shown to the user** because the UI already said "queued". `pull` alert `Pull failed:` fires only for enqueue errors.
- Net effect: user sees success toast on queue, nothing on failure, page refetch shows possibly hybrid ops state.

## UI/UX Best Practices

- **Truthful success**: toast must not appear until the durable state change is committed. Export already waits for git push; but ops state flip (draft->published) must survive the import that follows (YAN-463).
- **All-or-nothing apply**: failure leaves previous known-good state visible; user never sees half-imported ops (YAN-466).
- **Surface async failures**: queued jobs need a visible terminal state (last sync status/error on StatusCard, or failure alert when the job finishes). Fire-and-forget + log-only = silent failure.
- **Actionable error text**: say what failed, what state remains ("No changes were applied"), and what to do ("Retry sync; if it persists check Logs").
- **Idempotent retry**: re-running sync after failure must be safe and converge.
- **Keep drafts until proven published**: do not drop/supersede local drafts unless the corresponding base op is confirmed present post-import.
- **Minimal new surface**: reuse `alertStore` (5s default, `duration` override), avoid new modals (repo convention: routes over modals).

## Error Handling

| Scenario                                                            | Current user-visible behavior                                                          | Desired behavior                                                                         | Where                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| Export preflight fails (dirty/behind/ahead/no identity/remote down) | Preview modal badges + red error list; confirm disabled                                | Keep as is                                                                               | `changes/+page.svelte`, `exporter.ts`      |
| Export commit/push fails                                            | Error toast `Export failed: <detail>`, modal stays                                     | Keep; ensure drafts NOT marked published / superseded on failure                         | `handleExportConfirm`, `exportDraftOps`    |
| Export succeeds but ops later revert on import (YAN-463)            | Success toast; ops silently reappear as drafts / vanish after sync/restart             | Published ops remain published and match repo base after import; no silent revert        | server: `exporter.ts` + `importBaseOps`    |
| Import fails mid-way (YAN-466)                                      | Job returns `Base op import failed: ...`; log only; UI showed "Sync queued"; DB hybrid | Import atomic (transaction or staged swap); on failure prior state intact; error visible | server: `manager.ts` sync, `importBaseOps` |
| Queued sync later fails                                             | No alert; `last_synced_at` unchanged                                                   | Surface failure (toast on next fetch or last-error line in StatusCard)                   | jobs + changes page                        |
| Sync already running                                                | Info toast                                                                             | Keep                                                                                     | `handlePull`                               |
| Pull enqueue error                                                  | Error toast `Pull failed: <msg>`                                                       | Keep                                                                                     | `handlePull`                               |
| Recompile fails after import                                        | Log only in drop path; sync path propagates                                            | Treat as failure of whole sync; no partial success                                       | `compileIfEnabled`                         |
| Stale preview (selection/message changed)                           | Amber banner; confirm disabled                                                         | Keep                                                                                     | modal                                      |

Proposed copy (only if a message change is made):

- Import fail: `Sync failed: base ops could not be imported. No changes were applied. Retry sync or check Logs.`
- Export success (unchanged): `Exported and pushed N ops (file.sql)`.

## Performance UX

- Export confirm shows `committing` spinner via Modal `loading`; preview uses spinner icon + "Preparing preview...". Adequate.
- Sync is async (job queue); page refetches immediately after enqueue, so UI likely shows pre-sync state. Consider refetch on job completion (poll once or on next navigation) only if cheap.
- Atomic import should run inside a single SQLite transaction (WAL) - same speed class as today; do not hold transaction across git/network I/O (do pull + parse first, then transaction).
- No blocking spinner needed beyond existing `pulling`/`syncing` flags.

## Competitive Analysis

| Tool                               | Failure model                                                                                                                                                                                                       | Surfacing                                                      | Takeaway for Praxrr                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terraform                          | Failed apply is NOT rolled back; state is updated for what succeeded, lock released, error printed; user re-applies (roll-forward). Docs: "Terraform does not automatically roll back a partially-completed apply." | Console error + state reflects partial truth                   | Partial state is acceptable only if it is **recorded accurately** and re-apply converges. Praxrr's hybrid state is unaccounted, which is the real defect. Prefer true atomicity (cheaper here: one local SQLite txn). |
| Flux (HelmRelease / Kustomization) | Remediation: failed upgrade -> rollback, failed install -> uninstall; retries configurable                                                                                                                          | Resource `Ready=False` with reason/message visible until fixed | Rollback to last good + persistent status condition. Map to: txn rollback + persisted last-sync error on database instance.                                                                                           |
| Argo CD                            | Sync fails -> app status `OutOfSync`/`Failed`; PreSync hook fail stops sync, old version keeps running; no auto-rollback by default                                                                                 | Status badge + operation message in UI                         | Gate before mutate; keep prior state serving on failure; persistent status, not just a toast.                                                                                                                         |
| Recyclarr                          | Validates config up front, aborts with errors before writing; keeps a sync-state cache; error/warning docs page per message                                                                                         | Console output with specific message; docs link per error      | Fail fast pre-write; stable, documented error strings; idempotent re-run.                                                                                                                                             |
| SQLite txn (primitive)             | Atomic commit/rollback                                                                                                                                                                                              | n/a                                                            | Use for import: either all base ops replaced/inserted or none.                                                                                                                                                        |

Sources: developer.hashicorp.com/terraform/cli/commands/apply; fluxcd.io/flux/components/helm/helmreleases/; argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/; recyclarr.dev/guide/troubleshooting/errors/ ; recyclarr.dev/guide/troubleshooting/state/. Recyclarr rollback semantics not verified from primary docs (**Confidence**: Low-Medium for that row).

## Recommendations

### Must

1. Make import atomic server-side (single txn or stage-then-swap); on any failure restore prior ops/cache so state is never hybrid (YAN-466).
2. Make export-published ops durable across import/restart: import must not delete/replace `published` ops that match exported repo content, and must not resurrect/drop them as drafts (YAN-463). Don't mark drafts published/superseded unless commit+push confirmed.
3. Keep the error string `Base op import failed: <reason>` stable (tests/log search) and add that no changes were applied only when true.
4. Ensure failed import does not call `updateSyncedAt`, `triggerPullSync`, or compile with partial data (current early-return in `manager.ts` already does; preserve).

### Should

5. Surface async sync failure to the user: persist last sync error/status on the database instance and show it on the Changes StatusCard (or toast when the job result is read), so "Sync queued" is not the only feedback.
6. After successful export, add regression test: export -> sync/import -> ops remain published and repo/cache match.
7. Add regression test: forced failure mid-import leaves ops table identical to pre-import snapshot.

### Nice

8. Refetch/poll once after queued sync completes so UI reflects the true outcome.
9. Link error toast to Logs page; per-error docs like Recyclarr.
10. Optional pre-import auto-snapshot already exists for pull (`snapshotService.createAutoSnapshot`); expose "Restore snapshot" hint in failure message.

## Open Questions

- Where exactly does YAN-463 revert occur: `importBaseOps` replacing `published` rows, or export `superseded` linkage lost on re-import? (Needs server research doc.)
- Is a persisted last-sync-error field available on `database_instances` / job history already, or would it need a migration (scope creep vs. bug fix)?
- Should failure of queued `pcd.sync` jobs produce an alert at all, given alert store is client-ephemeral (page may be closed)?
- Local-path sources (`isLocalRepositorySource`) share the same import path - confirm same atomic guarantee and messaging.
- Is "no UI change" acceptable to product, or is surfacing queued-sync failure (Should #5) required for closing YAN-466?
