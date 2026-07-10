# Sync Preview Reviewed Plan — Security Research

Scope: GitHub issue #234. This analysis is grounded in the current sync-preview store,
orchestrator, create/get/apply routes, sync job handler, section registry and atomic status claims,
OpenAPI contract, UI, and focused route-hardening tests. The security objective is integrity: an
operator's confirmation must authorize only the exact instance, Arr family, selected sections,
desired PCD/config state, and live Arr state that were reviewed.

## Executive Summary

The current preview is read-only and short-lived, but it is not an execution authorization. Apply
passes only `instanceId`, selected sections, and `previewId` into `executeSyncJob`; the normal job
then reloads current config and Arr state and independently decides what to write. Material PCD,
saved sync-config, preview-override, instance-binding, or Arr changes can therefore produce writes
that were never reviewed. Age thresholds do not detect this state drift.

The safest design is a server-owned immutable reviewed-plan envelope plus a single-use execution
boundary. The envelope should bind the preview to its creator/security principal, `instanceId`,
explicit `arrType`, target identity, ordered selected sections, preview-only section config, a
versioned canonicalizer/engine version, and separate fingerprints for authoritative desired PCD
inputs and relevant live Arr inputs. Apply must atomically consume the preview, acquire all selected
section claims without resetting an existing claim, revalidate every selected section before the
first write, and either execute the already-revalidated plan or return a closed-vocabulary stale
reason. PCD and Arr mismatches must remain distinguishable, while ambiguous, unavailable, expired,
or binding-mismatch states fail closed.

Hash comparison alone narrows but cannot eliminate the external Arr time-of-check/time-of-use
(TOCTOU) window. Prefer handing the exact revalidated desired/from payload to the writers and using
per-entity old-value guards where the Arr API permits. If the first implementation must retain the
normal syncers, put revalidation inside the claimed job boundary, use the same client, validate all
sections before any write, and document the remaining external-race limitation.

## Findings by Severity

### CRITICAL

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                              | Impact                                                                                                                                                                                                                                                       | Concrete mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Apply is not bound to reviewed evidence. `generatePreview()` records display diffs, but the apply route calls `executeSyncJob(snapshot.instanceId, sectionsToApply, ..., snapshot.id)`. The job reloads the instance, saved sync configuration, PCD-derived desired values, and live Arr state. Preview-only `sectionConfigs` are not persisted as execution inputs. | A reviewed create/update/delete set can silently become a materially different set before execution. A hypothetical preview made from unsaved form state can authorize execution of different saved state. This violates the central confirmation invariant. | Store a server-owned reviewed-plan envelope. At minimum persist exact preview config plus separate, versioned canonical fingerprints for all desired PCD/config inputs and live Arr inputs used by each selected section. Recompute them within the execution boundary and reject before any write on mismatch. Stronger: execute the immutable revalidated plan with per-entity from-state/value guards. Never accept hashes or plan contents back from the client as authoritative.                                                           |
| C2  | The existing concurrency pre-check is racy and the job path can defeat its own claim guard. Apply calls `getSectionsInProgress()`, then later `executeSyncJob()` unconditionally sets selected section statuses to `pending`; this can overwrite a concurrently acquired `in_progress` status before `claimSync()` runs.                                             | Two jobs can write the same instance/section concurrently. Revalidation performed before this sequence would not protect execution, and overlapping writes can invalidate the reviewed state mid-run.                                                        | Move claim acquisition and reviewed-plan validation into one execution boundary. Add an all-or-none claim operation that updates only claimable states and never changes `in_progress` to `pending`. Claim every selected section before revalidation, validate every section before the first write, and execute without re-pending/re-claiming. Use an owner token/lease where practical so cleanup releases only claims owned by this apply. A claim conflict returns a typed 409 and performs zero writes.                                  |
| C3  | A compare-then-call design still leaves a TOCTOU gap if validation runs in the route or uses different clients/reads from execution. Multi-section validation followed by the current section-by-section sync also allows section 1 to write before section 2 is discovered stale.                                                                                   | Changed Arr or PCD data can execute after passing an earlier check; later-section drift can yield partial execution even though the reviewed plan was invalid as a whole.                                                                                    | Revalidate inside the claimed job, not in the HTTP route. Resolve all authoritative PCD/config and Arr evidence for all selected sections first, compare all fingerprints, re-check TTL/binding, and only then cross the first-write boundary. Reuse the same explicit-`arrType` client and already-revalidated payloads for execution. Where an Arr endpoint supports ETag/version/precondition semantics, send the precondition; otherwise perform an immediate per-entity old-value check before each write and fail that entity/run closed. |

### WARNING

| ID  | Finding                                                                                                                                                                                                                                                                                                                                        | Impact                                                                                                                                                                                                             | Concrete mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | The snapshot stores `instanceId` and `arrType`, but the job reloads the current row by ID and dispatches from the row's current `type`; it does not assert equality with the reviewed `arrType` or target identity.                                                                                                                            | Instance edits, replacement, URL changes, credential rotation, or Arr-family changes can redirect an old preview to a target that was not reviewed. Cross-Arr fallback or changed semantics are especially unsafe. | Bind the plan to `instanceId`, exact `arrType`, and a non-secret target-binding fingerprint covering stable instance identity plus canonical URL and credential-key/version identity (never the API key itself). Reload the instance inside the job and require an exact match before creating the explicitly typed client. Unsupported or changed types return `binding_drift`; never infer a sibling Arr mapping.                                                                                                                                         |
| W2  | Preview lifecycle transitions are not exposed as a non-throwing compare-and-set. Two apply requests may both read `ready`; the loser can encounter an invalid `applying -> applying` transition and surface an internal failure rather than a typed replay result.                                                                             | Replay is fail-closed by accident, but behavior is noisy and hard to audit; future awaits or multi-worker deployment could weaken single-use guarantees.                                                           | Add `claimForApply(previewId, principal, now)` that atomically checks existence, ownership, TTL, `ready`, and binding, then transitions once. Return a discriminated result (`claimed`, `missing`, `expired`, `already_claimed`, `terminal`) rather than throwing. A preview that fails drift validation becomes terminal/invalidated and cannot be retried without regeneration.                                                                                                                                                                           |
| W3  | Any authenticated caller who learns a high-entropy preview ID can currently get, delete, or apply it. No creator/session/API-principal ownership is stored. The current product is largely single-operator, but the authorization boundary is implicit.                                                                                        | In a multi-user, shared-proxy, or leaked-log scenario, one principal can inspect sensitive diffs or execute another principal's reviewed plan. UUID entropy is not authorization.                                  | Capture a normalized security-principal identifier when creating the preview and check it on get/delete/apply. Define explicit behavior for API-key identity and `AUTH=off`/local bypass. If the product intentionally remains single-principal, document that trust model and still keep preview IDs out of logs and URLs outside the path where required.                                                                                                                                                                                                 |
| W4  | Apply and generation error paths can return raw `Error.message`; section-generation errors are stored and returned by the preview GET route. Arr/HTTP errors may include internal hosts, response bodies, or configuration details.                                                                                                            | Authenticated callers can receive internal topology or upstream diagnostic data; raw bodies can also make the UI an unsafe future rendering source.                                                                | Use a closed error contract: `pcd_drift`, `arr_drift`, `pcd_and_arr_drift`, `binding_drift`, `expired`, `claim_conflict`, and `revalidation_unavailable`, plus a safe user message directing regeneration/review. Reuse `sanitizeArrWriteError` principles. Put raw exceptions, upstream bodies, hashes, and field-level mismatch diagnostics only in protected logs with credentials and URLs redacted. Render messages as escaped text.                                                                                                                   |
| W5  | A fingerprint built from the display diff or only `pcd_ops` state is under-inclusive. Sync behavior also depends on saved per-instance selections, TRaSH hydrations, Arr-specific mappings, preview overrides, transformations, remote IDs, and section/engine semantics. Conversely, including volatile Arr fields causes false invalidation. | Under-inclusion permits materially different writes with the same hash; over-inclusion creates unusable previews and encourages bypassing the guard.                                                               | Define and test a versioned canonical evidence schema per Arr type and section. Desired evidence includes every value that can influence transformed writes; current evidence includes every live value used to decide create/update/delete, but excludes timestamps/statistics irrelevant to writes. Sort object keys and semantically unordered collections, preserve meaningful order, encode null/absence distinctly, reject unsupported values, include canonicalizer/schema/engine versions, and invalidate previews across incompatible deployments. |

### ADVISORY

| ID  | Finding                                                                                                                                                                                                                                   | Impact                                                                                                                         | Concrete mitigation                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The in-memory preview store is process-local. Restart already fails closed with 404, but multiple application workers would not share lifecycle or replay state.                                                                          | Availability loss on restart is acceptable; multi-replica routing could produce inconsistent not-found or single-use behavior. | Keep the current store for a single-process deployment. Before horizontal scaling, move envelope and apply-claim CAS to shared durable storage or require documented sticky routing; do not weaken missing-state behavior into an unguarded apply.                                       |
| A2  | `DEFAULT_PREVIEW_TTL_MS` is 10 minutes while the UI/server hard-block threshold is 30 minutes, so the hard-age branch is normally unreachable because the store expires first. Validation can also take time after the initial TTL check. | Confusing policy and a possible interpretation that starting before expiry authorizes writes after expiry.                     | Treat `expiresAt` as authoritative, preserve the existing 10-minute lifetime unless product policy changes, and re-check it inside the claimed execution boundary immediately before the first write. Make UI wording/countdown derive from `expiresAt`; do not extend TTL during apply. |
| A3  | Revalidation adds outbound reads and canonicalization work. Apply has request-size guards, but repeated unavailable validations can still consume Arr/CPU resources if the preview remains reusable.                                      | Authenticated denial of service against Praxrr or an Arr instance.                                                             | Single-use claim stale previews, bound canonical evidence size/entity counts using existing preview limits, retain create rate limits/capacity, and rate-limit repeated apply attempts per principal/instance. Time out Arr reads and fail closed without retry loops in the request.    |

## Authentication/Authorization

- Global `hooks.server.ts` protects `/api/v1/sync/preview*` unless `AUTH=off`, local-IP bypass, or
  another configured authentication path applies. Do not add these endpoints to `PUBLIC_PATHS`.
- Authentication alone is insufficient for plan ownership. Add a principal abstraction usable for
  user sessions, the API-key pseudo-user, and intentional auth bypass, then bind create/get/delete/
  apply consistently. Do not bind solely to a mutable username.
- The plan authorizes one target only. At apply, re-authorize the current instance record and require
  exact target/`arrType` binding; never use a client-supplied `instanceId` or `arrType` on apply.
- Preserve same-origin JSON requests. For cookie-authenticated mutation routes, validate Origin/
  Fetch Metadata according to the app's central policy if one is introduced; do not make this route
  a special weaker exception. API keys should remain headers, not be copied into preview state.

## Data Protection

- Preview diffs expose entity names, regexes, scoring, naming templates, and live Arr state. Retain
  the short in-memory TTL, delete/terminal cleanup, authentication, and ownership checks. Do not
  persist the full plan unless durability is explicitly required.
- SHA-256 fingerprints are integrity comparators, not encryption or signatures. Keep them
  server-side; returning them invites accidental use as bearer tokens and discloses stable equality
  signals. The preview ID remains a random opaque identifier.
- Never include Arr API keys, decrypted credentials, authorization headers, repository tokens, or
  raw upstream error bodies in canonical evidence. If target credential rotation must invalidate a
  plan, hash a non-secret credential record/key version identifier rather than secret material.
- Log preview ID, safe reason code, instance ID, Arr type, and selected sections for audit. Avoid
  full plan bodies, raw hashes, internal URLs, and changed field values in normal logs.

## Dependency Security

- No new dependency is required. Use Deno/Web Crypto `crypto.subtle.digest('SHA-256', ...)`, matching
  the repository's existing snapshot fingerprint primitive.
- Do not add a generic canonical-JSON or diff package for this change. The security boundary needs a
  narrow, versioned, typed canonical schema; a permissive generic serializer increases ambiguity
  around `undefined`, non-finite numbers, dates, maps, and collection ordering.
- If an external package later becomes necessary, pin it, review transitive dependencies and
  prototype-pollution history, and keep all plan objects immutable/plain-data before serialization.

## Input Validation

- Continue strict allowlisting and de-duplication of sections. Apply may only choose a non-empty
  subset of successfully reviewed sections; it cannot add, reorder into a different execution
  dependency order, or revive skipped/failed sections.
- Persist and bind preview-only `sectionConfigs`; validate each with the same section-specific
  runtime schema used by the syncer. The current generic `unknown` map/key validation is not enough
  for an execution authorization.
- Validate `instanceId` as a positive integer, reload the instance server-side, require enabled
  state, and compare exact `arrType`/target binding before any Arr request or write.
- Canonicalizers must be total over their declared schema and fail closed on unknown/ambiguous
  fields. Do not silently drop unsupported values. Include explicit domain separators such as
  schema version, Arr type, section, and evidence class before hashing to prevent cross-context
  reuse.
- Separate PCD and Arr evidence computations so the stale response can name the invalidating class.
  If either computation fails or yields ambiguous mappings, return `revalidation_unavailable` or
  `binding_drift`; never interpret failure as unchanged.

## Infrastructure Security

- Claim state must live at the execution choke point and be authoritative across every trigger
  (manual preview apply, manual non-preview, schedule, job queue). Route-level `in_progress` checks
  are advisory only.
- Acquire all selected section claims before any network validation/write and release/fail them in
  `finally` using ownership-aware semantics. A process crash needs an existing or new stale-claim
  recovery policy; a bare status with no owner/lease cannot distinguish abandoned from active work.
- Use bounded Arr timeouts and one explicitly typed client/cache per target. Do not parallelize
  dependent sections or make cross-Arr fallback requests.
- In a future multi-worker deployment, both preview single-use CAS and section claims must be shared
  and atomic. An in-memory preview claim combined with database section claims is safe only under
  the documented single-process model.

## Secure Coding Guidelines

1. Model the reviewed envelope and revalidation result as discriminated, immutable TypeScript
   unions. Exhaustively handle every stale/failure reason; the default branch fails closed.
2. Make one function the source of truth for preview-time and apply-time evidence generation. A
   separate copy of canonicalization logic will drift and silently weaken equality.
3. Fingerprint separate domain-separated payloads for desired PCD/config state and current Arr
   state; compare both and report a safe combined reason when both changed.
4. Put apply claim, exact instance/Arr-type check, all-section claim, TTL re-check, all-section
   revalidation, and first write in a visibly ordered execution path. No write-capable callback may
   run before every guard passes.
5. Do not call the current `setSectionsStatusPending()` from a reviewed-plan execution path if it
   can overwrite `in_progress`. Add a CAS/all-or-none claim API and test the affected row count.
6. Reuse the exact revalidated desired/from payload for execution. If a writer must re-read, add an
   old-value guard at the last responsible moment and classify mismatch as Arr drift.
7. Never surface raw caught exceptions. Log protected diagnostics; return stable codes/messages and
   tell the UI to generate and review a new preview.
8. Preserve planned evidence versus actual outcome separation. A matching plan authorizes an
   attempt; only write results and Sync History are execution proof.
9. Add adversarial tests for PCD-only drift, Arr-only drift, both, config/override drift, later-
   section drift, instance/Arr-type rebinding, expiry during validation, validation failure,
   duplicate apply, and a concurrent non-preview sync. Assert the write/`execute` spy is never
   called on every fail-closed path and run cases for Radarr, Sonarr, and Lidarr explicitly.

## Trade-off Recommendations

- **Recommended:** immutable reviewed envelope plus revalidation under all selected claims, then
  execution of the already-revalidated payload. This fits the issue without replacing the entire
  sync engine and materially narrows both local and external TOCTOU windows.
- **Acceptable first increment:** re-run the same preview evidence generator inside `arrSyncHandler`
  after all-or-none claims, compare versioned PCD and Arr hashes, and only then run existing syncers.
  This satisfies fail-closed pre-execution validation but retains a small external Arr race while
  syncers re-read; record it as residual risk and do not claim exact-plan execution.
- **Not acceptable:** comparing only the stored display diff, checking only preview age, validating
  only PCD or only Arr, validating sections immediately before each section's writes (which permits
  earlier partial writes), or doing validation in the HTTP route before invoking the job.
- Return safe typed reasons rather than detailed deltas. Operators need to know whether PCD,
  Arr, both, binding, expiry, or validation availability invalidated review; showing the unreviewed
  replacement diff in an error would bypass the intended regenerate-and-review UX.

## Open Questions

1. Should saved per-instance sync-config changes be classified as `pcd_drift`, a distinct
   `config_drift`, or `binding_drift`? The UI must still explicitly distinguish PCD from Arr drift.
2. Are preview-only `sectionConfigs` intended to be executable unsaved state, or only a visual aid?
   If executable, the envelope must retain and validate them; if visual-only, apply must be disabled
   until saved state exactly matches them.
3. Can each Arr section expose a complete typed desired/from payload that writers can consume, or
   must the initial implementation retain re-read-based syncers and accept the documented residual
   external TOCTOU window?
4. Must section claims be all-or-none across multiple SQLite rows, and is schema support for an
   owner token/lease in scope? Without ownership, safe crash recovery and precise release are hard.
5. What principal owns previews under `AUTH=off`, local-IP bypass, OIDC, and API-key access? The
   answer determines whether ownership is per user, per session, per API key, or deployment-wide.
6. Should drift invalidate the preview terminally (`failed` with typed stale reason), or should a
   new explicit `stale` status be added? Either choice must prevent retrying the old review.
7. Which Arr endpoints expose ETag/version fields or conditional writes for the relevant Radarr,
   Sonarr, and Lidarr resources? Absence must be treated explicitly rather than assuming parity.
