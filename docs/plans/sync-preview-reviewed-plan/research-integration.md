# Integration Research: Sync Preview Reviewed-Plan Binding

Issue #234 is an integration-hardening change across the existing Sync Preview API, the ephemeral
preview store, section syncers, the Arr sync execution boundary, and the generated OpenAPI
artifacts. It should not introduce a second sync engine or a durable reviewed-plan table. The safest
fit is to keep a private, versioned review binding beside the public preview snapshot, re-materialize
the selected PCD/config and live Arr evidence through the same section-specific preparation path,
and compare all selected sections before any Arr mutation.

The current gap is precise: `POST /api/v1/sync/preview` accepts runtime `sectionConfigs` and the
orchestrator applies them only to `generatePreview()`. The store retains only `SyncPreviewResult`.
Apply later calls `executeSyncJob(instanceId, sections, 'manual', previewId)`, whose section syncers
read saved configuration again. The `previewId` correlates the resulting run to the preview in Sync
History, but does not prove that the reviewed desired/current state was the state executed.

## API Endpoints (Existing Related Endpoints + Route Organization)

### Existing Related Endpoints

| Endpoint                                      | Current integration                                                                                                                                                                                                                                                                                                                                                                              | Required issue #234 integration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/sync/preview`                   | Implemented by `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`. Validates a positive `instanceId`, optional ordered/deduplicated sections, optional section-config object keys, enabled instance, supported concrete Arr type, request size, rate limit, and store capacity. It creates a `generating` snapshot, calls `generatePreview()`, and updates the snapshot to `ready`. | Build a private versioned review binding from the exact successful section results, effective `sectionConfigs`, explicit `instanceId`/`arrType`, and separate PCD/Arr/plan evidence. Persist the public result and private binding atomically so a `ready` preview can never exist without verifiable evidence. Do not return the binding, raw PCD rows, raw Arr payloads, or credentials.                                                                                                                                                                                              |
| `GET /api/v1/sync/preview/{previewId}`        | Implemented by `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/+server.ts`. Cleans expired entries and serializes the public `SyncPreviewResult`.                                                                                                                                                                                                                                | Keep this response public-only. A private binding added to `StoredPreview` must not be reachable by `get()` or JSON spread/serialization. The old diff may remain readable after evidence invalidation while apply remains terminally disabled.                                                                                                                                                                                                                                                                                                                                         |
| `DELETE /api/v1/sync/preview/{previewId}`     | Same route file; removes an unexpired in-memory snapshot and returns `204`.                                                                                                                                                                                                                                                                                                                      | Delete the public snapshot and private binding together through the same store entry. No database or Arr operation is involved.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /api/v1/sync/preview/{previewId}/apply` | Implemented by `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`. It checks `ready`, generation errors, body size/JSON, an optional non-empty valid section subset, eligible successful sections, age policy, and an advisory `getSectionsInProgress()` preflight. It then transitions to `applying` and calls the normal executor.                              | Replace the separate `get()` then `transition()` sequence with a store-level atomic claim returning the snapshot plus its binding. Pass the exact ordered eligible subset to a reviewed execution function. Re-read the enabled instance; require exact `instanceId` and stored concrete `arrType`; acquire authoritative section claims; regenerate both evidence classes for all selected sections; compare before the first write; and return a typed fail-closed `422` on drift/unverifiable evidence. Material drift terminally invalidates the preview and requires regeneration. |

The apply request may narrow the reviewed preview to a non-empty subset of sections that completed
preview generation successfully. It must not add a section, revive a skipped/failed section, resolve
all configured sections again, or change the selected order between parsing, evidence validation,
claiming, and execution. Revalidation for a subset should use only that subset's bound evidence, so
drift solely in an unselected section does not block the request.

Recommended typed apply invalidation fields are a closed `code`, `changedEvidence`,
`changedSections`, `regenerateRequired: true`, the existing nullable `staleWarning`, and a sanitized
human message. The feature spec's stable distinctions are `pcd_drift`, `arr_drift`,
`pcd_and_arr_drift`, `scope_drift`, and `unverifiable_review`. Existing `400`, `404`, `409`, age/TTL,
and unexpected `500` behaviors remain separate. A rejection must say that nothing was applied and
must never include the newly computed unreviewed diff or upstream response bodies.

### Route Organization

The canonical OpenAPI sources are `docs/api/v1/paths/sync.yaml` and
`docs/api/v1/schemas/sync.yaml`, registered by `docs/api/v1/openapi.yaml`. The existing path keys are
`preview`, `previewById`, and `previewApply`; issue #234 extends these contracts rather than adding a
parallel endpoint. `SyncPreviewCreateRequest` currently omits `sectionConfigs` even though the route
accepts it, so the contract-first change must document the section-config shape used at runtime or
otherwise narrow runtime to a documented typed schema. The apply error schema currently contains
only `error` and `staleWarning`; it must gain the closed typed invalidation fields before the route
uses them.

Contract generation order is:

1. Update `docs/api/v1/schemas/sync.yaml` and the `previewApply` descriptions/responses in
   `docs/api/v1/paths/sync.yaml`.
2. Run `deno task generate:api-types`, which invokes `openapi-typescript` over
   `docs/api/v1/openapi.yaml` and writes
   `packages/praxrr-app/src/lib/api/v1.d.ts`.
3. Use the generated `components['schemas'][...]` types in the route and make returned objects satisfy
   those wire types; keep runtime parsing/validation at least as strict as the OpenAPI schema.
4. Run `deno task bundle:api`, which writes the bundled portable spec to
   `packages/praxrr-api/openapi.json` and copies the generated app declarations to
   `packages/praxrr-api/types.ts`.
5. Prettier-format the bundled `openapi.json` (it is CI-gated), inspect generated diffs for unrelated
   generator churn, and run the normal type/lint checks.

Authentication and authorization remain the repository-wide `/api/v1` middleware concern; these
routes should not introduce a new public path, API key, or per-route credential mechanism.

## Database (Relevant Tables + Schema Details, noting no migration if recommended)

### Relevant Tables

`arr_instances` is the authoritative apply-time target record. The reviewed executor must reload it,
require it to exist and be enabled, and compare its exact type with the binding's `radarr`, `sonarr`,
or `lidarr`. URL/credential changes may affect the authoritative Arr read and should fail closed when
the reviewed live evidence cannot be reproduced; no sibling-type client fallback is permitted.

The sync configuration and status tables are:

- `arr_sync_quality_profiles` plus `arr_sync_quality_profiles_config`: selected database/profile
  names and the per-instance trigger/status row.
- `arr_sync_delay_profiles_config`: selected `database_id`/`profile_name` plus trigger/status.
- `arr_sync_media_management`: per-instance naming, quality-definition, and media-settings database
  IDs and exact config names plus trigger/status.
- `arr_sync_metadata_profiles_config`: Lidarr-only database/profile selection plus trigger/status;
  query and update paths explicitly constrain the owning `arr_instances.type = 'lidarr'`.
- TRaSH Guide source hydration/selection tables queried by `trashGuideSyncQueries` for quality-profile
  configuration. These inputs are part of desired evidence when a reviewed quality-profile batch is
  sourced from TRaSH rather than a linked PCD.
- `pcd_ops` and the compiled per-database in-memory PCD caches. Desired evidence must cover the
  materialized selected rows, mappings, namespaces, and transforms, not merely a database ID or an op
  timestamp.

The sync configuration rows also contain `should_sync`, `sync_status`, `last_error`, and
`last_synced_at` (plus schedule fields where applicable). `sync_status` is a four-state operational
claim marker: `idle`, `pending`, `in_progress`, or `failed`. Each section handler's `claimSync()` is a
single conditional update from `pending` to `in_progress`; completion returns the row to `idle`, and
failure writes `failed` plus a sanitized error.

These status rows are concurrency coordination, not reviewed-state evidence. In particular,
`executeSyncJob()` currently calls `setSectionsStatusPending()` unconditionally, and the handler loop
also calls `setStatusPending()` immediately before `claimSync()`. Those writes can overwrite an
existing `in_progress` state, so the current `getSectionsInProgress()` route check and subsequent
claim do not form an all-or-none claim for the reviewed section set. Issue #234 should add a
transactional/all-or-none claim operation (or equivalent compare-and-set protocol) that refuses any
selected non-claimable section without resetting active work. All selected claims must be obtained
before evidence validation and any mutation. On validation rejection, acquired claims must be
released/failed consistently without recording entity writes. Existing startup recovery changes
orphaned `in_progress` rows back to `pending`; adding owner/lease columns would be a broader durable
claim redesign and is not necessary for the reviewed binding itself.

`sync_history` is the append-only audit trail for actual sync runs. It stores target identity,
trigger, attempted sections, aggregate status/counts, JSON `section_results`, planned pre-sync
`changes`, confirmed JSON `entity_outcomes`, and nullable `preview_id`; `idx_sync_history_preview`
supports correlation. `sync_history_settings` controls whether recording and the best-effort
pre-sync preview capture are enabled, plus retention bounds.

### Schema Details and Migration Recommendation

No database migration is recommended for the reviewed-plan binding. `SyncPreviewStore` is already an
in-memory TTL store with a default ten-minute lifetime, capacity cleanup, and terminal lifecycle
states. Extend its private `StoredPreview` entry from only `{ snapshot, createdAtMs, expiresAtMs }` to
also hold an immutable `SyncPreviewReviewBinding`. The binding should contain a closed version,
instance ID, explicit Arr type, ordered successful sections, normalized cloned section configs, and
per-section PCD/Arr/plan fingerprints. A restart safely removes the binding and makes the preview
unavailable; persisting it would add recovery, cleanup, ownership, and sensitive-evidence concerns
outside the issue's scope.

The store API should expose narrow operations rather than its internal map: an atomic generation
completion that writes the `ready` public result and private binding together, and an atomic
`claimReadyForApply(id, sections, now)` that verifies expiry, lifecycle, binding version/coverage,
and performs `ready -> applying` before returning immutable copies. Fixtures or old entries without a
binding are `unverifiable_review`, never a compatibility path to the unguarded executor.

Do not add a Sync History row or entity outcomes for a rejected review. `preview_id` is correlation,
not proof; `changes` is a best-effort planned diff; only `entity_outcomes` populated from resolved or
failed Arr write calls is execution evidence. A PCD/Arr/scope/unverifiable rejection happens before
the write boundary and must return `outcomes: []`/no apply result and no `syncHistoryId`. If rejection
auditing is desired later, it needs an explicitly separate event/status contract rather than being
misrepresented as a sync run.

## External Services

The only external runtime systems involved are the operator's configured Radarr, Sonarr, and Lidarr
instances. Praxrr authenticates with the existing decrypted instance API key in the `X-Api-Key`
header. `getArrInstanceClient()` enforces URL safety, loads encrypted credentials (with a legacy
instance-column fallback), and constructs a concrete client through `createArrClient()`.

Dispatch must remain exact:

- `RadarrClient` and `SonarrClient` use the shared v3 configuration endpoints for custom formats,
  quality profiles, delay profiles, naming, media management, and quality definitions, with their
  concrete clients supplying app-specific behavior where needed.
- `LidarrClient` explicitly uses API v1 and adds Lidarr-only metadata-profile list/schema/create/
  update/delete methods. Metadata profile revalidation/execution must require `LidarrClient`; it
  cannot borrow Sonarr semantics even if payload fields appear related.
- The shared `BaseArrClient` defaults to a 30-second timeout, three retries, exponential retry delay,
  and retryable 5xx statuses. It disables redirect following and sends JSON with `X-Api-Key`.

Preview generation currently creates a short-lived request-local client cache, uses one client for
all selected sections, and closes it in `finally`; normal execution creates its own client and also
performs best-effort version detection. Reviewed revalidation should use one explicitly typed client
for the exact bound Arr type and include any version/schema-dependent material used by a section in
the evidence projection. Failure to load required live state is `unverifiable_review`, not equality.

Published Arr configuration APIs do not provide a cross-app conditional-write contract on which
Praxrr can rely (`ETag`/`If-Match` parity is not established). Therefore a matching re-read narrows
but cannot eliminate races with an external writer. Keep the revalidation immediately adjacent to
the first write, serialize Praxrr's own section execution through claims, and reuse the exact
revalidated prepared payload/value guard where possible. Do not add an Arr SDK or new hashing
service; Deno's built-in Web Crypto SHA-256 is sufficient for deterministic private fingerprints.

PCD Git remotes and TRaSH Guide sources are upstream desired-state sources, but issue #234 should not
perform a pull during apply. It should fingerprint the authoritative material currently compiled and
selected by the normal sync preparation path. Any changed compiled PCD/TRaSH material, namespace,
quality mapping, or effective selection that changes the reviewed evidence invalidates the preview.

## Internal Services

`packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` is the shared read-only dispatcher.
It resolves requested sections in order, creates the explicit Arr client, uses the registry handler to
construct each concrete syncer, applies transient preview configuration, calls `generatePreview()`,
clears the override in `finally`, and accumulates section outcomes and summary totals. Extend this
path with a private evidence sink/preparation result so preview-time and apply-time evidence use one
canonical implementation. Do not hash summary totals alone; include stable entity identity, action,
remote ID where material, complete comparable current/desired fields, mappings, and section outcome.

`packages/praxrr-app/src/lib/server/sync/preview/reviewBinding.ts` should own the closed internal
binding/evidence types, bounded canonical projections, SHA-256 hashing, and comparison that reports
PCD, Arr, both, scope, or unverifiable results. Domain-separate hashes by binding version, Arr type,
section, and evidence class. Preserve semantic array order, sort only true sets with explicit
comparators, reject unsupported/non-finite/ambiguous values, and deep-clone/freeze normalized config
at bind time.

`packages/praxrr-app/src/lib/server/sync/preview/store.ts` owns TTL and lifecycle. Its existing default
TTL is ten minutes; warning begins at five minutes and hard-age blocking is thirty minutes, although
the default TTL normally evicts first. Evidence validation must not refresh `createdAt` or
`expiresAt`. A successful execution ends `applied`; any proven drift or unverifiable binding after
claim ends `failed` (or another explicitly terminal stale state if the contract chooses one), never
back at `ready`.

`packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` is the execution choke point and the
correct location for a reviewed wrapper such as `executeReviewedSyncJob(input)`. The wrapper should:

1. accept one object containing preview ID, instance ID, explicit Arr type, exact sections, private
   evidence, effective section configs, and expiry;
2. reload and validate the target;
3. acquire every selected section claim without overwriting active status;
4. prepare/revalidate every selected section before any section syncer mutates Arr;
5. on mismatch, release/fail claims and return a typed pre-write invalidation with no history/outcomes;
6. on equality, execute the existing concrete syncers using the same effective section configs or the
   exact prepared desired payload; and
7. preserve the existing actual-outcome aggregation and Sync History recording only for the write
   execution branch.

The current ordinary executor also creates PCD snapshots, detects Arr versions, and calls
`capturePreSyncChanges()` before the section write loop. Reviewed validation must account for the
latency and rereads introduced by those steps: either perform them before the final evidence guard or
thread prepared evidence/value guards through to each first mutation. Calling `generatePreview()`
again for Sync History must not silently replace the reviewed diff or become the authorization check.

The section registry and concrete syncers remain the domain owners:

- Quality profiles integrate selected PCD databases and TRaSH hydrations, namespaces, custom formats,
  profile transforms, and per-Arr quality mappings.
- Delay profiles use an explicit concrete client check and have Lidarr-specific target resolution.
- Media management resolves separate naming, quality-definition, and media-settings sources and
  app-specific payloads.
- Metadata profiles are Lidarr-only and use the Lidarr schema when available.

Today each `generatePreview()` can use `getPreviewConfig()`, while each `sync()` explicitly rereads
`arrSyncQueries`. That split is the central config-fidelity gap. Reviewed execution must supply a
validated execution context or prepared payload to `sync()`; merely retaining configs for the second
preview and then invoking the old `sync()` still permits different saved configuration to execute.

Sync History outcome separation must remain explicit throughout the API and UI. Planned
`EntityChange` records and the best-effort `changes` blob describe intent. `SyncEntityOutcome[]` is
created only from actual Arr create/update/delete results and is returned on both successful and
failed write runs. `syncHistoryId` is nullable because history recording can be disabled or fail
best-effort. A matching binding authorizes an attempt; it is not itself a successful outcome.

## Configuration

No new environment variable, dependency, external service, or database setting is required.
Preserve these existing controls:

- `DEFAULT_PREVIEW_TTL_MS = 10 minutes`;
- `PREVIEW_STALE_WARNING_MS = 5 minutes`;
- `PREVIEW_STALE_BLOCK_MS = 30 minutes` as an independent age policy;
- `PREVIEW_REQUEST_BODY_LIMIT_BYTES = 64 KiB` for create/apply bodies;
- preview creation rate limit of 6 attempts per instance per 60 seconds;
- in-memory capacity of 200 preview snapshots;
- existing Arr HTTP timeout/retry settings and credential encryption configuration; and
- `sync_history_settings.enabled` plus retention controls for actual run history.

The private evidence size must remain bounded by storing versioned hashes and normalized effective
configs rather than complete raw PCD/Arr payloads. Store capacity and TTL cleanup should delete the
binding with the snapshot. Unknown binding versions, missing evidence for a selected successful
section, a process restart, decryption/connectivity errors, or ambiguous cross-Arr mappings all fail
closed and require a new preview.

Logging may include preview ID, instance ID/name, explicit Arr type, selected sections, changed
evidence class, and sanitized error category. It must not include decrypted API keys, raw upstream
response bodies, raw private evidence, or a newly computed unreviewed plan. The UI should use the
typed response to render a persistent “Nothing was applied” recovery state and a generate-new-preview
action; global alerts remain supplemental rather than the only invalidation state.
