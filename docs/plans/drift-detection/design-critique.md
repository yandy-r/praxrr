# Design Adversarial Critique (resolved in design.md)


**Verdict:** NOT implementation-ready. No design doc exists: docs/plans/drift-detection/ holds only research.md (the brief). Verified against code: the brief is correct that FieldChange is current=LIVE/desired=PCD, api_key is never read, generatePreview normalizes namespace names end-to-end (Q7 resolved), and cross-Arr dispatch fails fast. But its core recipe (call generatePreview, persist EntityChange[]) has code-verified defects: delete=every unmanaged/foreign live entity so delete->drift is permanent false drift; the preview is not read-only (getOrCreate writes rows, getCache needs a built cache); a full sweep blocks the single-flag serialized dispatcher. All 8 open design questions are unresolved. Author a design doc that resolves them first.

## Findings

- **[BLOCKER]** No design doc exists; only research.md (the brief) is present and all 8 section-4 open questions are unresolved.
  - Fix: Author docs/plans/drift-detection/design.md resolving granularity, storage/keying, dedup, routing scope, drift-vs-unmanaged, retention, and scheduling before implementation.
  - Location: docs/plans/drift-detection/
- **[BLOCKER]** generatePreview emits action=delete for every live entity not in the instance's configured desired set (syncer.ts:400 passes ALL live CFs; sectionDiffs.ts:211-225 deletes every unconsumed one), including foreign-DB, manual, and Recyclarr CFs. Mapping delete->drift yields permanent false drift.
  - Fix: Classify create/delete as a separate 'unmanaged' category, not drift; only action=update (and possibly managed-but-missing) is true drift; persist category per row; document per arr_type.
  - Location: sync/preview/sectionDiffs.ts:211-225; sync/qualityProfiles/syncer.ts:400
- **[BLOCKER]** The preview is not read-only nor scheduler-safe: it writes via arrNamespaceQueries.getOrCreate (syncer.ts:484) and getCache (:501) throws without a built PCD cache; a sweep runs inside the single-flag serialized dispatcher (dispatcher.ts:12,54-64), blocking all other jobs incl. sync.
  - Fix: Bound per-instance timeout and chunk the sweep across short job runs (or per-instance sub-jobs keyed drift.check:<id>); guard cache.isBuilt() and degrade instead of 500; remove/handle the getOrCreate write via a read-only namespace resolver.
  - Location: sync/qualityProfiles/syncer.ts:484,501; jobs/dispatcher.ts:12,54-64
- **[MAJOR]** Engine is instance-scoped (generatePreview input has no databaseId; syncer.ts:457-468 groups all databases internally) but the brief routes UI by /drift/[databaseId], which one call cannot satisfy.
  - Fix: Commit to instance-scoped routing to match generatePreview, or add a separate database-scoped desired-vs-live path; do not mix; resolve the [databaseId]/[instanceId] waffling.
  - Location: sync/preview/orchestrator.ts:40-45; research.md 2e
- **[MAJOR]** EntityChange.name is the namespace-stripped display name (sectionDiffs.ts:185,202,215), so two databases syncing same-named entities collide under a latest-state upsert keyed on (instance_id, entity_type, entity_name).
  - Fix: Key drift rows on remote_id or a namespace-qualified id, never the display name; define a deterministic key for create rows (remoteId=null).
  - Location: sync/preview/sectionDiffs.ts:185,202,215
- **[MAJOR]** generatePreview does not apply version-availability gating (only handler.hasConfig at orchestrator.ts:232); a version-unsupported section throws HttpError (captured :255-263) and maps to a false unreachable/invalid_response drift reason. The 'skip-never-fail as arrSync' claim is true of arrSync, not generatePreview.
  - Fix: Run detectAndRecordArrVersion + resolveSyncSectionAvailability around generatePreview and skip unavailable sections instead of erroring.
  - Location: sync/preview/orchestrator.ts:232,255-263
- **[MAJOR]** generatePreview creates and closes its own client cache per call (orchestrator.ts:216-222,281), so the brief's 'share one cache per cycle' is impossible and 'call per section' re-decrypts creds and reopens the client N times per instance.
  - Fix: Call generatePreview once per instance with all supported sections (it loops sections internally); drop the shared-cache claim or use a lower-level fetch path.
  - Location: sync/preview/orchestrator.ts:216-222,281
- **[MAJOR]** Notification dedup is unspecified, so drift.detected fires every cycle while drift persists (brief 2c.4/Q4), spamming users - worse given the false delete-drift.
  - Fix: Define a stable dedup key (instance_id + remote_id + changed-field hash), emit only on new/changed drift vs prior check, persist last-notified state, clear on return-to-in-sync.
  - Location: research.md 2c.4, Q4
- **[MAJOR]** Append-only drift_results with 'unchanged' rows grows unbounded with no retention (brief 2a includes unchanged in the CHECK; section 4 leaves storage open).
  - Fix: Do not persist unchanged rows (store only drifted/unmanaged plus a per-instance summary); add a prune routine like pcdSnapshots.pruneAutoSnapshots; decide latest-state vs capped-history.
  - Location: research.md 2a, Q2
- **[MINOR]** Schema/render gaps: arr_type TEXT has no CHECK; the summary filters by status but only (arr_instance_id, checked_at) is indexed; delete rows have fields=[] and create rows have current=null (sectionDiffs.ts:145,223).
  - Fix: Add CHECK(arr_type IN radarr/sonarr/lidarr), add a status-covering index, and specify empty-field and null-current rendering.
  - Location: research.md 2a; sync/preview/sectionDiffs.ts:145,223
- **[MINOR]** FieldChange direction (current=LIVE, desired=PCD) is correct but load-bearing and easily inverted (compareForAction passes current=live, desired=PCD).
  - Fix: State that drift.fields stores EntityChange.fields verbatim without swapping current/desired; reuse FIELD_META/formatFieldValue as-is.
  - Location: sync/preview/sectionDiffs.ts:143-145