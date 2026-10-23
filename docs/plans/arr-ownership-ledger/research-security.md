## Executive Summary

The feature adds the first destructive Arr operation to the sync pipeline. Today no syncer deletes anything. The only delete path is the manual `/api/v1/arr/cleanup` route, which needs the `admin` scope and re-scans server-side. Reviewed apply, scheduled sync, canary rollout, drift and history all assume write actions are `create`/`update`.

Praxrr already has the binding machinery needed to make pruning safe: a SHA-256 reviewed-plan binding, a process-local preview store with apply-claim receipts, and section claims. Pruning is safe only if every one of these holds:

1. **Ownership comes from a confirmed `create` only.** A `create` is a `status: 'success'`, `action: 'create'` outcome. An `update` that matched a same-name entity by name never creates ownership.
2. **A delete re-verifies identity at the moment of the DELETE.** The id must still map to the same suffixed name, and the entity must still be unused. The ledger id alone is never trusted.
3. **Only the reviewed apply path can emit deletes.** `executeSyncJob` (the scheduled, on_pull/on_change, canary and `manual` job path) and the canary rollout executor re-plan without any binding. They must never prune.
4. **The delete audit trail is mandatory.** `recordSyncHistory` is best-effort and self-gates (`record.ts:195-212`). A delete without a durable record violates acceptance criterion 3.

Counts: **5 CRITICAL, 9 WARNING, 6 ADVISORY.** The main findings:

- **C1 — unreviewed pruning.** Unreviewed execution paths reach the same syncers. Canary and scheduled runs call `executeSyncJob`, which has no binding.
- **C2 — ID reuse.** Arr database reset or restore, an instance URL repoint, or env-instance repointing makes stored `remote_id` values point at foreign hand-made entities. Name+id verification at delete time is mandatory. The proposed ledger columns lack `remote_name`, `arr_type` and an instance-identity epoch.
- **C3 — ownership from name-adoption.** The syncers match remote entities by suffixed name (`customFormats/syncer.ts:149,191-194`; `qualityProfiles/syncer.ts:403,562`). A hand-made entity with a matching name gets overwritten, and a careless "any success outcome" ledger write would then make it prunable.
- **C4 — empty or failed desired-state read.** An unavailable PCD cache or unresolved TRaSH source treated as empty desired state would delete everything Praxrr owns. Cleanup already has keep-namespace logic (`cleanup.ts:82-90,117-160`) that prune must reuse.
- **C5 — no audit trail.** History disabled or failing to record means deletes with no durable evidence.

**Residual risks that no design fully removes:**

- Arr offers no conditional (`If-Match`) writes (`arrSync.ts:502-503`), so a TOCTOU window remains between the final pre-delete GET and the DELETE. It is narrowed, not closed.
- Arr exposes no stable server identity that Praxrr currently captures. `getSystemStatus` returns only `appName` and `version` (`base.ts:72-86`). A reset or restore to a state where an old id carries the same suffixed name cannot be detected, but that requires someone to have re-created a zero-width-suffixed name by hand.

No new third-party dependency is needed or recommended (see Dependency Security).

---

## Findings by Severity

Citations are relative to `packages/praxrr-app/src/lib/server/` unless prefixed otherwise. All paths are under the worktree `/home/yandy/.claude-worktrees/praxrr-feat-yan-516-arr-ownership-ledger/`.

### CRITICAL

#### C1. Unbound execution paths could prune without a reviewed preview (violates AC1 "only after a preview")

**Evidence**

- Reviewed apply is the only path with a binding. `routes/api/v1/sync/preview/[previewId]/apply/+server.ts:244-275` claims via `previewStore.claimReadyForApply` and calls `executeReviewedSyncJob`. That function re-materializes and compares hashes (`jobs/handlers/arrSync.ts:571,588`).
- `executeSyncJob(instanceId, sections, source, previewId?)` (`arrSync.ts:190-216`) is unbound. It calls `arrSyncHandler` with a fabricated job. `previewId` is only a correlation field recorded in history (`arrSync.ts:787,862`).
- Canary runs the canary inline via `executeSyncJob(instanceId, sections ?? [], 'manual')` (`sync/canary/coordinator.ts:61-63`). `proceedRollout` enqueues a resumable rollout job (coordinator header, lines 8-14), which also runs `executeSyncJob`-style syncs. The gate previews the remaining targets, but nothing binds the exact delete set that the run will later execute.
- Scheduled and event-triggered syncs go through `processor.ts` (`evaluateScheduledSyncs` 121-160, `triggerSyncs` 395-458, `processPendingSyncs` 271-346) and the same `arrSyncHandler` (`arrSync.ts:785`).

**Risk:** if the policy flag is read inside the shared syncer (`qualityProfiles/syncer.ts`), every schedule tick, on_pull/on_change trigger and canary run can delete. PCD content comes from third-party git repositories, so an upstream commit that drops a CF would silently delete from Arr.

**Mitigation**

- Pruning is a separate, explicit input to the syncer. It is never read from the policy flag inside `sync()`. The only constructor of a "prune set" is `executeReviewedSyncJob`.
- The prune set is derived from the reviewed binding. Persist the exact candidate ids/names and ownership snapshot in the plan evidence so they are hashed into `planHash`/`arrHash`/`pcdHash` (`reviewBinding.ts:441-451`). Any plan-only difference then yields `unverifiable_review` (`reviewBinding.ts:594-601`).
- Scheduled, on_pull, on_change and `manual` job runs must treat prune as a **report-only** candidate set. Candidates show up in drift/preview; they are never executed. Add a unit test: `executeSyncJob` with the policy on and candidates present performs zero DELETE calls.
- Canary: the verification-gate evidence for remaining targets must carry the candidate ids. Rollout execution should either pass an immutable allowlist (runtime candidates must be a subset of reviewed candidates, else skipped with evidence) or never prune. Simplest and safest: canary never prunes in v1 and records candidates as evidence only.

#### C2. `remote_id` reuse after Arr DB reset/restore or instance repoint deletes the wrong entity

**Evidence**

- The proposed ledger is keyed on `instance_id` + `remote_id` (issue text). Arr numeric ids are per-installation. [INFERENCE: the upstream tables use autoincrement ids, so ids are not reused within a live DB, but a fresh or restored DB restarts the sequence. `research-external.md` records the same uncertainty.]
- `arrInstances.ts:100-107` lets `url` and `type` be patched on an existing row. `routes/arr/[id]/settings/+page.server.ts:214-232` rewrites `url` for an existing `id`. Env-managed instances can be re-pointed via `updateEnvInstanceById/ByApiKey` (`arrInstances.ts:287-322`, caller `utils/arr/envInstances.ts:387,410`). The ledger's foreign key is `instance_id`, not the endpoint.
- The reviewed binding does catch URL/credential change for a plan: `syncPreviewReviewTarget` (`reviewBinding.ts:75-89`), `normalizeTargetUrl` (91-106), `buildSyncPreviewTargetHash` (322-341) and the comparison at `arrSync.ts:549-558`. But the **ledger itself** survives. A review created after the repoint would happily trust old ids.
- Backups: a restored Praxrr `praxrr.db` (`backups/applyRestore.ts:178-287`) can carry a ledger that is newer or older than the live Arr state.
- `getSystemStatus` captures only `appName` and `version` (`utils/arr/base.ts:72-86`). No stable Arr identity exists in the codebase today.

**Risk:** an old ledger row `{remote_id: 7}` on a re-pointed or reset Arr deletes whatever hand-made CF or QP now has id 7.

**Mitigation (all required)**

1. **Delete-time identity verification, always.** Immediately before each DELETE, `GET /customformat/{id}` (`base.ts:233`) or `GET /qualityprofile/{id}` (`base.ts:272`). Require the live `name` to equal the ledger's stored `remote_name` (full suffixed name, including the zero-width trailing run). Require `hasNamespaceSuffix(name)` and that the trailing run matches the suffix currently assigned to the owning namespace (`namespace.ts:28-41,49-51,62-65`). Any mismatch means skip with reason `identity_mismatch`; never fall back to a name lookup or delete by name.
2. **Extend the ledger beyond the issue's column list.** Add `arr_type` (CHECK radarr/sonarr/lidarr), `remote_name` (the exact suffixed name at write time), and an `instance_epoch` value. Derive the epoch from a hash of the normalized endpoint (origin+path) plus `arr_type`, deliberately **excluding** API-key rotation so a key rotation does not orphan the ledger. On URL/type change, or when env re-pointing is detected, rows with a stale epoch become **ineligible** for prune and only a fresh `create` re-establishes ownership. Do not silently rewrite their epoch.
3. **Soft identity probe.** Store the Arr `version` and `appName` already available from the heartbeat (`drift/check.ts:58-88`) as a weak sanity check. Treat any mismatch or unreachable instance as "ledger untrusted for this run". Do not claim this detects a reset. [INFERENCE: whether Radarr/Sonarr/Lidarr expose a stable instance GUID in `system/status` was not verified.]
4. **Primary key shape.** `UNIQUE(instance_id, entity_type, remote_id)` and a logical key `UNIQUE(instance_id, entity_type, source_kind, database_id|source_id, pcd_name)`. A new `create` for the same logical key replaces the row (id changed ⇒ the old id is no longer owned).
5. **Reconcile after restore.** Surface a one-time "ledger reconciliation" preview after a Praxrr restore (`applyRestore.ts` result `applied`). It compares ledger rows to live Arr entities by `(id, name)` and drops non-matching rows. Dropping is always safe (fail-closed leak, never a delete).

#### C3. Name-adoption must not create ownership (hand-made CFs deleted → violates AC2)

**Evidence**

- CF write path: `buildCustomFormatPayloads` maps existing remote CFs by exact suffixed name (`customFormats/syncer.ts:148-149`), sets `arrFormat.id = existingId` (191-194), and `writeCustomFormatPayload` then issues `updateCustomFormat` (`:73-79`). The outcome carries `action: 'update'`, `status: 'success'`, `remoteId` (`:93-104`).
- QP write path: existing profiles map by name (`qualityProfiles/syncer.ts:402-403,496,562,1303`), and creates are recognized only when `remoteId` is null (`:1341-1344`).
- A failed update still reports `remoteId: String(payload.id)` (`customFormats/syncer.ts:127`).
- `SyncEntityOutcome` has no `databaseId`, `sourceKind` or suffixed name (`sync/types.ts:46-61`). A naive "upsert every outcome with `remoteId`" would claim updates and failures.
- Cross-reference: `research-external.md` says Recyclarr's automatic same-name adoption is weaker than "Praxrr created". Configarr deletes everything absent from the allowlist (`mediaPipeline.ts`), which is the unsafe precedent this feature must not copy.

**Risk:** a user hand-creates a CF named exactly as the PCD name plus suffix (rare, since the suffix is invisible, but achievable by copy/paste or API import). Sync updates it, and a loose ledger write then makes the next prune delete a hand-made entity.

**Mitigation**

- Ledger writes come **only** from outcomes with `action === 'create' && status === 'success' && remoteId is a positive integer string`. This matches `requireCreatedId` in the CF syncer (`:58-63`) and the QP check at `qualityProfiles/syncer.ts:1342-1344`.
- Never write from `update`, `skipped` or `failed` outcomes. Never write synthetic negative preview ids (`customFormats/syncer.ts:154-199`, the `includeSyntheticIds` option). Ledger-write code must reject any `remoteId` that is not a positive integer.
- Updates are treated as "already tracked or foreign". If an `update` hits a remote id that is **not** in the ledger, record nothing and emit an advisory outcome field (`adopted: false`) for the UI. Optional later feature: an explicit, previewed "adopt this entity" action with `source_kind: 'adopted'`. Adopted rows are excluded from prune by default.
- Extend `SyncEntityOutcome` (contract-first via `packages/praxrr-api`) with the non-secret provenance the ledger needs: `databaseId` or TRaSH `sourceId`, `sourceKind`, and `remoteName` (suffixed). Do not infer them later from `pcd_name` strings.
- Only `customFormat` and `qualityProfile` entity types are prunable. Hard-allowlist both in the ledger writer and in the prune planner. Singletons (`delayProfile`, `naming`, `mediaSettings`, `qualityDefinitions`, `metadataProfile`; `sync/types.ts:30-37`) are never deleted.
- Backfill risk: Arr items that predate the ledger have no creation proof. Do **not** auto-backfill them into prunable ownership from `hasNamespaceSuffix` (`namespace.ts:49-51`) or from "currently in Arr". That would re-import the YAN-444-style over-inclusion. Offer an explicit, previewed "adopt namespaced items" action that sets `source_kind: 'adopted'`, non-prunable until a user opts in. This is a decision for TechDesigner.

#### C4. A failed or empty desired-state read is not "removed upstream"

**Evidence**

- Cleanup scan already handles unavailable caches: `getCache(sel.databaseId)` null ⇒ `keepSuffixes` (`cleanup.ts:80-90`). TRaSH sources use `keepAllTrashSuffixed` for `no_cache`/`transform_failed` (117-130), `keepSuffixes` for missing profiles (147-160), and the unassigned-namespace case (134-144). Expected CF names are the **union** across all selected profiles (`:91-94,162-173`).
- Syncers' desired sets are built from `getCache` per database (`qualityProfiles/syncer.ts:813-966`). A selection deselected, a database unlinked, a failed git pull, a rebuild error or an empty cache all shrink the desired set.
- A malicious or erroneous upstream PCD commit (third-party content) can legitimately remove entities. Pruning then executes someone else's removal on the user's Arr.

**Risk:** mass deletion of everything Praxrr owns on a transient or hostile PCD state.

**Mitigation**

- Candidate = ledger row ∧ not in the **union** of all still-desired producers for that `(instance, entity_type)`. Database and source scope must be honored: deselecting database A must not delete an entity still desired by database B (different suffix ⇒ different remote name, so keying must include `database_id`/`source_id`).
- Reuse the cleanup scan's keep-namespace predicates. Extract a shared `resolveDesiredState(instance)` returning `{desired, undeterminableNamespaces}`. Candidates in an undeterminable namespace are excluded and listed in the preview as "kept: source unavailable".
- A cache that `isBuilt() !== true` (`drift/check.ts:112-114` pattern), a thrown read, or a count of zero desired entities for a namespace that previously had entities is "unknown", never "empty".
- **Circuit breaker.** If candidates exceed a threshold (suggest `max(5, 25% of the ledger rows for that instance)`) or equal all ledger rows of a namespace, the plan is marked `requiresExplicitConfirmation` and the apply request must echo a digest of the candidate set. Thresholds are an open design choice; flag for TechDesigner.
- A CF dropped before write (Lidarr unsupported conditions, `customFormats/syncer.ts:258-270`) or one whose write failed is still **desired**. Desired state comes from PCD content, not from successful writes.

#### C5. Delete evidence must be durable: history/audit gaps defeat AC3

**Evidence**

- `recordSyncHistory` returns `null` and swallows errors when history is disabled or the insert throws (`sync/syncHistory/record.ts:193-214`, gate at `:195`). The reviewed apply flow records history after all writes, at `arrSync.ts:708-731`.
- If the process dies after a DELETE but before history is written, no record exists.
- The preview `SyncPreviewAction` already includes `'delete'` (`sync/preview/types.ts:10`), but `sync/preview/diff.ts` never emits it (no `'delete'` occurrences). `flattenSyncPreviewChanges`/`tag` (`record.ts:75-123`) will only carry deletes if the preview emits them.
- Canary classification reads the newest `sync_history` row (`coordinator.ts:91-100`) and falls back to `JobRunStatus` when no row exists, so Canary evidence is only as good as the history row.

**Risk:** destructive operations with no durable record.

**Mitigation**

- **Prune requires history enabled.** If `isSyncHistoryEnabled()` is false, the prune section is not executed and the plan says why (fail closed). Alternatively, write a dedicated append-only `arr_managed_entity_events` row (action, ids, names, preview id, timestamp) inside the same transaction as the ledger mutation, independent of the history setting.
- Order of operations per entity: (1) re-verify, (2) DELETE, (3) in one SQLite transaction: remove the ledger row and append the event. A crash after (2) leaves a ledger row for a now-absent id; the next run records `delete`/`skipped`/"already absent" (`research-external.md` recommendation 5) and drops the row.
- Delete outcomes use `action: 'delete'` with `remoteId`, original `pcd_name`/`databaseId`/`sourceKind` and a sanitized reason. They flow through the existing `entityOutcomes` blob (`migrations/20260720_add_sync_history_entity_outcomes.ts`). Ensure `deriveSyncHistoryStatus` treats a failed delete as `partial` (`record.ts:45-64` already does for any `failed` outcome).
- Drift and preview emit `delete` `EntityChange`s only as read-only candidate evidence. Drift runs unattended (`drift/check.ts:25-26,37`) and must never touch the ledger or Arr writes.

---

### WARNING

#### W1. Authorization: a `sync:apply` token would gain deletion power

**Evidence**

- `sync/preview/{id}/apply` is classified `sync:apply` (`utils/auth/scopePolicy.ts:33-41,59-62`). Preview create is `read` (`:47`). Unknown mutating routes default to `admin` (`:64`); the cleanup POST therefore needs `admin`.
- Session and bypass principals hold every scope (`utils/auth/middleware.ts:28-29`). Tokens are limited by scope (`scopePolicy.ts:71-90`) and accepted only under `/api/v1/` (header comment).
- The apply handler does not receive the principal: `export const POST = ({ params, request }) => _handleSyncPreviewApplyRequest(params.previewId, request)` (`apply/+server.ts:382`).

**Risk:** today `sync:apply` can overwrite configs, but not delete. Reviewed apply with prune gives that scope irreversible deletion. A leaked token holding only `sync:apply` could delete Praxrr-created entities, though only those already in the reviewed plan, and the preview is created by the same or a `read` token.

**Mitigation**

- In the apply handler, pass `locals.principal` through. If the claimed plan contains any `delete`, require the `admin` scope for token principals and return 403 with `requiredScope: 'admin'` otherwise. Do the check **before** `previewStore.claimReadyForApply` (`apply/+server.ts:244`) so the claim is not consumed.
- Policy toggle, include-unmanaged cleanup, adopt, and any ledger maintenance endpoints are new mutating routes. They fall to `admin` through the fail-closed default (`scopePolicy.ts:64`). Add them explicitly to a test that asserts `requiredScopeFor('PUT', ...) === 'admin'`. Do not add them to `SYNC_APPLY_ROUTES` or `READ_POST_ROUTES` (`scopePolicy.ts:34,47`).
- Ledger reads can be `read`-scoped GETs. They expose only ids and names, no secrets. There must be **no** write API for ledger rows (see W2).
- MCP: tools declare `requiredScope` and are checked at `mcp/tools.ts:446`. Do not add a prune/ledger-write MCP tool. If a read-only tool lists ledger rows, give it `read`.

#### W2. Ledger poisoning

**Vectors and mitigations**

| Vector                                                      | Mitigation                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public/API write of ledger rows                             | No create/update/delete API on `arr_managed_entities`. Only internal code paths after confirmed outcomes can write. OpenAPI exposes read-only GET and the policy toggle (contract-first, `packages/praxrr-api/openapi.json`).                                                                                                                                                        |
| Writing ownership from `update`/`failed`/`skipped` outcomes | Create-only rule (C3); unit tests per status/action matrix.                                                                                                                                                                                                                                                                                                                          |
| Preview synthetic ids (`customFormats/syncer.ts:154-199`)   | Writers run only inside real apply paths and reject non-positive ids.                                                                                                                                                                                                                                                                                                                |
| Plugin or untrusted code writing outcomes                   | The ledger writer takes data from the `SyncResult.outcomes` of syncers executed in-process. [INFERENCE: plugin system code was not reviewed for sync-outcome access; check `loadPluginsFeatureFlag` consumers.]                                                                                                                                                                      |
| Stale rows after manual deletion in Arr                     | Drop on mismatch during reconcile; never trust, always verify at delete time.                                                                                                                                                                                                                                                                                                        |
| Tampered `praxrr.db` or foreign backup restore              | Out of the threat model (full compromise of local data). Note that the restore path does not validate ledger contents (`applyRestore.ts`). The delete-time GET plus `remote_name` match limits damage to entities that already bear a Praxrr suffixed name.                                                                                                                          |
| Hand-made entity named like a ledger row (name collision)   | A name-colliding hand-made CF is overwritten by sync, not deleted, but it **would** be deletable if its id is in the ledger. The ledger holds only creator-provenance ids, and the identity check requires the suffixed name. Residual risk: a user renames a hand-made CF to a ledger row's exact suffixed name while the row's id was reused, which requires an Arr reset. See C2. |

#### W3. Preview/apply race and TOCTOU

**Evidence**

- Preview TTL is 10 minutes (`preview/store.ts:19`); stale warning at 5 minutes, block at 30 minutes (`:20-21`). The store is in-memory per process, so a restart expires every preview (fail-closed).
- `claimReadyForApply` transitions `ready → applying` atomically within the single process and issues an owner-token receipt (`store.ts:568-624`). The section claim (`db/queries/arrSync.ts:228-290`) uses in-memory maps plus a row status update, and refuses `in_progress` rows (`:249-251`).
- Re-materialization compares PCD/Arr/plan hashes (`arrSync.ts:571-609`; `reviewBinding.ts:540-617`), and the file's own comment admits Arr has no conditional writes (`arrSync.ts:502-503`). Time passes between the comparison and `syncer.sync()` (`arrSync.ts:631-664`): snapshots are created at `:643-650`, then writes begin.
- The existing cleanup route has no section claim or lock at all (`routes/api/v1/arr/cleanup/+server.ts:20-59`). Concurrent cleanup and sync/prune on the same instance can interleave.

**Mitigation**

- The prune evidence must be part of the hashed `arr` evidence (the full list of Arr CFs/QPs and dependency observations for candidates) and `plan` evidence (candidate ids/names), so any change between preview and apply returns `arr_drift`/`pcd_drift`/`unverifiable_review` (`reviewBinding.ts:610-616`).
- Re-verify per entity immediately before DELETE (C2.1). For QPs, re-run the dependency scan immediately before the DELETE. See W4.
- Have cleanup and prune acquire the same instance/section claims (`claimReviewedSyncSections`) so they serialize. The cleanup route is a gap even before this feature.
- DELETE retry behavior: the cleanup route passes `retries: 0` (`cleanup/+server.ts:42-44`), but the reviewed apply path creates its client with default options (`getArrInstanceClient(...)` in `jobs/handlers/arrSync.ts`, no `retries` override), so `BaseHttpClient` applies its defaults: 3 retries on `retryStatusCodes` `[500, 502, 503, 504]` regardless of HTTP method (`utils/http/client.ts:19-21,113,142`). Network errors (status 0) and timeouts (408) are not in that list and are not retried. A DELETE is idempotent, so a retry after a 5xx that did delete the entity returns 404, which `executePrunes` treats as "already gone" (success, ledger row dropped). Radarr's in-use rejection is an HTTP 500, so it is retried up to 3 times with backoff before surfacing as a `failed` outcome (row kept); the repeated attempts are harmless because the in-use rejection is deterministic and no entity is removed. Sonarr and Lidarr return 400, which is not retried.
- Document the residual window (`arrSync.ts:502-503`) in the plan. It is not closable without an Arr-side conditional write.

#### W4. QP "in use" guard is per-Arr and wider than media

**Evidence**

- Existing cleanup maps HTTP 500 to "Profile is assigned to media" (`cleanup.ts:337-343`). Sonarr and Lidarr return 400; Radarr returns 500 (`research-external.md` table, lines 11-15). Any other status just surfaces `err.message`.
- Upstream guards: Radarr blocks movies, import lists and collections; Sonarr blocks series and import lists; Lidarr blocks artists, import lists and root-folder default profiles. Per `ApiResearcher-2`: the Lidarr wire field on import lists is `qualityProfileId` and on root folders `defaultQualityProfileId`.
- Arr clients do not yet expose import list/collection/root folder reads (`research-external.md` line 55).

**Mitigation**

- Per-`arr_type` dependency matrix as in `research-external.md`, with an explicit switch on `arr_type`. No sibling fallback (cross-Arr policy). Unknown arr type ⇒ no QP prune.
- Any dependency endpoint that fails, is unsupported, or returns an unrecognized shape ⇒ usage "unknown" ⇒ do not delete. The Arr-side guard is a backstop, not the preview implementation.
- Never reassign dependents automatically.
- Do not interpret "delete failed with 4xx/5xx" as "in use" generically. Record the sanitized reason and leave the ledger row intact.
- Fetch full collections without monitored/has-file filters. Bound memory with a cap (see A4).

#### W5. Silent score removal in unmanaged QPs when a managed CF is deleted

Deleting a CF removes it from all profiles' score lists, including hand-made profiles that referenced a Praxrr-created CF (`research-external.md` CF side-effects section). This silently alters an unmanaged QP.

**Mitigation**

- The preview lists every QP (managed and unmanaged) that scores each candidate CF, as a plan blocker or an explicit acknowledgement item bound into the plan hash.
- Order the writes: sync updates to managed QPs first (refresh them via GET after deleting CFs, per `research-external.md` recommendation 6), then delete managed CFs, then managed QPs. This differs from `deleteStaleItems`, which deletes CFs first (`cleanup.ts:316-345`).

#### W6. Cleanup execute (YAN-471) and the new "include unmanaged" mode

**Evidence**

- `executeCleanup` already re-scans server-side and deletes only items whose `id` AND `name` match the fresh stale set (`cleanup.ts:244-300`, partition at `:261`, comment `:238-242`). It deletes the server-side item so client display names aren't trusted.
- The request is a client-supplied `scanResult` with at most `MAX_CLEANUP_ITEMS` items (`cleanupRequest.ts:14,16-32`) and is typed as a union of `scan`/`execute` (`:8-9`). There is no mode field.
- The stale definition is "not expected" (`cleanup.ts:197,210`), so hand-made items are stale today.

**Mitigation**

- Add an explicit `scope: 'managed' | 'unmanaged'` field validated server-side. Missing means `'managed'`. An unknown value returns 400 (fail closed). Extend `parseCleanupRequest` (`cleanupRequest.ts:35-66`).
- The execute re-scan must use the **same** scope as the request. The server never derives scope from the client's `scanResult`. `managed` ⇒ stale ∧ present in ledger ∧ identity-verified; items outside the ledger are ignored (reported `not_owned`).
- `unmanaged` is a deliberate destructive mode (delete hand-made entities). Keep `admin`. Require an explicit confirmation field (for example the count of unmanaged items, or typed `"include-unmanaged"`) and never enable it from a scheduled job. Record every unmanaged deletion in history/event audit with a distinct marker. It must not be reachable through reviewed apply or the policy toggle.
- Behavior change: after the ledger lands, default cleanup finds nothing for existing users until ownership is established, because no backfill. State this in the migration notes and the UI. Don't "fix" it with a silent backfill (C3).
- Reuse `id+name` matching plus the delete-time GET from C2.
- Sanitize delete failure reasons. `deleteStaleItems` currently returns raw `err.message` to the client (`cleanup.ts:322-326,340-343`), and the route returns `err.message` on a 500 (`cleanup/+server.ts:52-53`). Use the existing `sync/sanitizeArrWriteError.ts` helper and never echo Arr bodies.
- Cleanup and prune share a mutex/claim (W3).

#### W7. Unauthenticated modes make destructive endpoints network-exposed

`AUTH=off`, and `AUTH=local` with a local IP, skip authentication entirely (`hooks.server.ts:267-273`). With principal scopes at `API_TOKEN_SCOPES` (`middleware.ts:28`), anyone who can reach the port can call apply with prune or run unmanaged cleanup. CSRF only blocks cross-origin browser requests and lets absent `Origin` through (`security/csrf.ts:82-92`, header comment lines 18-20).

**Mitigation**

- This matches the existing cleanup exposure. Do not add compensating auth logic. Document it in release notes.
- Consider refusing to enable the prune policy while `AUTH=off`. This is the cheapest safe rule; flag as an open product decision.

#### W8. Env-managed instances

Env instances can be updated or disabled by the env sync (`arrInstances.ts:287-337`; `utils/arr/envInstances.ts:387,410`), including URL changes under the same `id`. A re-pointed env instance keeps the ledger (C2). Include `source: 'env'` instances in the epoch logic, and make the env reconciler bump the epoch when URL or type changes.

#### W9. Namespace suffix instability

Suffix indices are persisted per (instance, database) / per (instance, TRaSH source) (`arrNamespaceQueries`/`arrTrashNamespaceQueries`, `namespace.ts:28-41`). Index 6+ repeats U+200B (`namespace.ts:31`), and the DB index-1 suffix is a tail of the TRaSH suffix (`namespace.ts:62-65`). Re-linking a database could reuse an index for a different database.

**Mitigation:** the ledger stores `database_id`/`source_id` and the full `remote_name`. The identity check uses exact trailing-run equality (`getTrailingNamespaceSuffix`), never `endsWith`. A database re-link that reassigns an index must invalidate ledger rows whose `database_id` differs (the logical key includes it).

---

### ADVISORY

#### A1. Rename vs remove

The proposal keys on `pcd_name` rather than a stable PCD entity id (`research-external.md` line 100). A rename in the PCD looks like remove + create. With pruning on, the old Arr entity is deleted and a new one created, which loses user-side customizations and temporarily removes CF scores. The preview must show the delete and the create pairing so the user can see a rename. If a stable entity id exists in the PCD model, prefer it. [INFERENCE: not verified in this pass.]

#### A2. Non-atomic remote/local consistency

Arr and SQLite have no shared transaction. Remote success followed by local persistence failure leaves a ledger row for an absent entity. This is safe, but the next prune pass must treat it as "already absent" and reconcile (C5). The reverse failure, DELETE failing after the ledger row is removed, must never happen. Remove the ledger row only after confirmed remote success.

#### A3. Notifications leak entity names

`fireNotification` embeds sync detail (`record.ts:149-185`). Delete outcomes add names of removed configs. Names are not secrets, but they come from third-party PCD content. Keep existing sanitization and never include raw Arr error bodies.

#### A4. Resource bounds on dependency scans

Fetching full movie/series/artist libraries per candidate QP can be large. Bounds needed: one fetch per entity family per run (not per candidate), a size cap, and a timeout. If a cap is exceeded, mark usage "unknown" ⇒ no QP delete (fail closed). Drift sweeps run under a 20 s budget (`drift/check.ts:37`) and share the preview rate limit (`sync/preview/limits.ts`, `registerPreviewCreateAttempt`). Dependency scans in drift/preview must be skipped or degraded rather than extended.

#### A5. Ledger foreign-key policy

Audit tables use `ON DELETE SET NULL` for instances so history survives (`migrations/20260710_create_sync_history_tables.ts:28`). Config-state tables use `ON DELETE CASCADE` (`20260709_create_drift_tables.ts:38`). The ledger is operational state tied to a live instance, so `ON DELETE CASCADE` is correct. The delete-event audit table, if added, should use `SET NULL` with a denormalized instance name.

#### A6. Parameterized SQL and no dynamic identifiers from input

New ledger queries must use bound parameters like the existing `db.execute(..., ...params)` pattern (`arrInstances.ts:162`). Dynamic SQL identifiers appear in `arrSync.ts` only from constants (`REVIEWED_SYNC_SECTION_CONFIG`, `:142-159`). Do not interpolate `section`/`entity_type` from requests. Validate against the enum first. CHECK constraints on `entity_type`, `section`, `source_kind` and `arr_type` belong in the migration.

---

## Dependency Security

**No new runtime dependency is required or recommended.** The feature needs only what is already present:

- SHA-256 binding: Web Crypto in `reviewBinding.ts:296-300`. Reuse `buildSyncPreviewTargetHash` and the canonicalizer (`canonicalizeReviewValue`). Do not introduce a hashing/diffing library.
- Persistence: app SQLite via the existing `db` wrapper and `@soapbox/kysely-deno-sqlite@^2.2.0` (root `deno.json:25`). Add one migration under `lib/server/db/migrations/` and keep the reference `schema.sql` as documentation only.
- Arr I/O: the existing `BaseArrClient` already has `deleteCustomFormat`/`deleteQualityProfile` and GET-by-id (`utils/arr/base.ts:233,254,272,293`). Add only minimal, Arr-specific typed readers for import lists, collections and root folders, with strict response-shape validation (no `any`). The Arr instance is semi-trusted input.
- Lockfile: `deno.lock` is present at the repo root. Any dependency change would need a lockfile diff, and none is planned.

**Existing dependency surface touched indirectly:**

- `xss`, `marked` — not touched.
- `@simplewebauthn/server@13.3.2` (pinned) — not touched.
- `better-sqlite3`/`esbuild`/`fsevents` appear in `allowScripts` (`deno.json:119-125`), which is existing install-script trust and unaffected here.
- The Go parser microservice is unrelated to this feature.

**Security checks not performed in this pass:** no network advisory database lookup (`deno audit`/OSV/GitHub advisories) was run, and no builds or tests were executed. Nothing here claims the current pinned versions are clean. Verification should happen in CI/main-agent audit.

**External reference behavior** (from `research-external.md`, not re-verified here):

- Recyclarr tracks synced ids but adopts same-name entities, so don't equate update/adoption with creation (C3).
- Configarr's `delete_unmanaged_custom_formats` deletes any remote CF not in a name allowlist (unsafe precedent; only the explicit "include unmanaged" mode may resemble it).
- Upstream Arr QP delete guards differ per app (W4).

### Suggested acceptance tests (security-focused)

1. A ledger row whose id now has a different name in Arr ⇒ skipped `identity_mismatch`, no DELETE sent.
2. A hand-made CF with the exact suffixed name is updated by sync ⇒ no ledger row ⇒ never a prune candidate.
3. The matrix of outcome `{action, status}` ⇒ ledger write only on `create`+`success`.
4. `executeSyncJob` and the canary executor with policy on ⇒ zero DELETE calls.
5. A reviewed apply with an unchanged plan and deletes ⇒ deletes executed. One changed candidate ⇒ `unverifiable_review`/`arr_drift`, no DELETE.
6. A token with `sync:apply` but not `admin` applying a plan with deletes ⇒ 403, preview still `ready`.
7. An unavailable cache, TRaSH `no_cache` or empty desired set ⇒ zero candidates in the affected namespace.
8. A QP referenced by a collection (Radarr), an import list (Radarr, Sonarr, Lidarr) or a root-folder default (Lidarr) ⇒ skipped. An unknown dependency read ⇒ skipped.
9. URL change on an instance ⇒ pre-change rows become ineligible; rotating the API key alone ⇒ rows stay eligible.
10. Cleanup with the default/missing `scope` ⇒ managed only. An unknown scope ⇒ 400. History disabled ⇒ prune refused.
