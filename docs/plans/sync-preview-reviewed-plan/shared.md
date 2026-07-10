# Sync Preview Reviewed-Plan Binding

Sync Preview creation already uses the explicit section registry and concrete Radarr, Sonarr, or
Lidarr syncers to produce a public read-only diff, but Apply currently forwards only instance ID,
sections, and preview ID into a fresh normal sync. Issue #234 adds a private versioned review binding
to the existing TTL store, captures separate material PCD/config, live Arr, and plan fingerprints, and
atomically claims and revalidates every selected section before any snapshot, history record, outcome,
or Arr mutation. Matching evidence continues through the existing writers with the exact reviewed
configuration; drift fails closed with a typed regenerate-required response and no sibling-Arr fallback.

## Relevant Files

- `docs/plans/sync-preview-reviewed-plan/feature-spec.md`: Authoritative decisions and acceptance scope.
- `docs/api/v1/paths/sync.yaml`: Contract-first create/get/apply path definitions.
- `docs/api/v1/schemas/sync.yaml`: Apply response and typed invalidation schemas.
- `docs/api/v1/openapi.yaml`: Registers modular sync paths and schemas for generation.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts`: Public preview and explicit Arr contracts.
- `packages/praxrr-app/src/lib/server/sync/preview/store.ts`: TTL lifecycle and private binding owner.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`: Ordered shared materialization path.
- `packages/praxrr-app/src/lib/server/sync/preview/diff.ts`: Field-level material comparison utilities.
- `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts`: Section entity identity/order rules.
- `packages/praxrr-app/src/lib/server/sync/base.ts`: Preview config and evidence-capture seam.
- `packages/praxrr-app/src/lib/server/sync/types.ts`: Section registry and confirmed outcome types.
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`: Explicit Arr support/order/capability mapping.
- `packages/praxrr-app/src/lib/server/sync/registry.ts`: Exact section handler dispatch.
- `packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`: Quality evidence and config parity.
- `packages/praxrr-app/src/lib/server/sync/delayProfiles/syncer.ts`: Delay evidence and config parity.
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: Media evidence and config parity.
- `packages/praxrr-app/src/lib/server/sync/metadataProfiles/syncer.ts`: Lidarr-only metadata evidence.
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`: Reviewed execution choke point.
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: Saved configs and conditional claims.
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: Authoritative enabled target/type.
- `packages/praxrr-app/src/lib/server/pcd/snapshots/fingerprint.ts`: SHA-256 canonicalization precedent.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`: Generation and private binding install.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/[previewId]/apply/+server.ts`: Apply claim/mapping.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewTrigger.svelte`: Transient configs.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`: Recovery UI.
- `packages/praxrr-app/src/tests/base/syncPreviewRouteHardening.test.ts`: Current apply regression seam.
- `packages/praxrr-app/src/tests/pcd/snapshots/fingerprint.test.ts`: Fingerprint mutation patterns.
- `packages/praxrr-app/src/tests/sync/syncEntityOutcomes.test.ts`: Planned/confirmed separation proof.
- `packages/praxrr-app/src/tests/base/bundleApiContract.test.ts`: Portable contract validation.
- `ROADMAP.md`: Required delivery record for issue #234.

## Relevant Tables

- `arr_instances`: Current enabled target, URL/credential identity, detected version, and explicit type.
- `arr_quality_profile_sync`: Quality selection/config plus guarded sync status.
- `arr_delay_profile_sync`: Delay selection/config plus guarded sync status.
- `arr_media_management_sync`: Naming/quality/media selections plus guarded sync status.
- `arr_metadata_profile_sync`: Lidarr metadata selection/config plus guarded sync status.
- `sync_history`: Actual run/outcome evidence only; pre-write invalidation creates no row.

No new table or migration is planned. The private binding expires with the existing process-local
preview entry; restart/eviction safely requires regeneration.

## Relevant Patterns

**Contract-first generated API**: Edit the modular OpenAPI sources, then regenerate both app and
portable package artifacts. See `docs/api/v1/schemas/sync.yaml` and `scripts/bundle-api.ts`.

**Public snapshot/private envelope**: Keep evidence beside private `StoredPreview`, never in the GET
DTO. Follow the lifecycle ownership in `packages/praxrr-app/src/lib/server/sync/preview/store.ts`.

**Atomic compare-and-transition**: Replace route-level `get()` plus `transition()` composition with an
operation that checks binding/coverage/expiry and performs `ready -> applying` atomically. Mirror the
guarded update style in `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`.

**Versioned deterministic fingerprints**: Use bounded explicit projections, semantic ordering, and
Deno Web Crypto SHA-256. Follow `packages/praxrr-app/src/lib/server/pcd/snapshots/fingerprint.ts`.

**One preparation path**: Preview and apply-time evidence must use `generatePreview()` and concrete
syncer readers rather than a second domain implementation. Evidence capture remains optional for
drift/history/MCP callers.

**Explicit Arr dispatch**: Narrow and compare `radarr`, `sonarr`, or `lidarr` at every boundary; use
`packages/praxrr-app/src/lib/server/sync/mappings.ts` and never infer sibling compatibility.

**All-selected-before-any-write**: Acquire every selected section without resetting active work,
revalidate every section, then cross the first-write boundary. The current pending reset in
`packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts` must not be used by reviewed execution.

**Planned versus confirmed evidence**: `EntityChange` authorizes an attempt only after validation;
`SyncEntityOutcome` comes only from actual writes. See
`packages/praxrr-app/src/lib/server/sync/types.ts` and sync-history recording.

**Injected route dependencies**: Keep request parsing/HTTP mapping tests deterministic by injecting
the reviewed executor and clock as in `syncPreviewRouteHardening.test.ts`.

**Persistent accessible recovery**: Keep invalidated old diffs read-only, disable Apply, state that
nothing was written, and focus a `role="alert"` regeneration action in `SyncPreviewPanel.svelte`.

## Relevant Docs

**`CLAUDE.md`**: You _must_ read this for contract-first API, explicit cross-Arr, config-name fidelity,
Svelte 5, formatting, and portable-contract rules.

**`docs/plans/sync-preview-reviewed-plan/feature-spec.md`**: You _must_ read this for issue scope,
drift taxonomy, decisions, edge cases, and acceptance proof.

**`docs/site/src/content/docs/app/sync-pipeline.md`**: You _must_ read this when changing preview and
execution ordering; update it for the reviewed validation phase.

**`docs/site/src/content/docs/app/architecture.md`**: You _must_ read this for API/PCD/job/Arr service
boundaries.

**`docs/api/v1/paths/sync.yaml`, `docs/api/v1/schemas/sync.yaml`, `docs/api/v1/openapi.yaml`**: You
_must_ read these before changing runtime or generated apply types.

**`docs/api/README.md` and `packages/praxrr-api/README.md`**: You _must_ read these when regenerating
and validating app/package contract mirrors.

**`docs/site/src/content/docs/app/development.md`**: You _must_ read this for monorepo API-generation
order and validation commands.

**`docs/site/src/content/docs/app/testing.md`**: You _must_ read this for focused test execution and
APP_BASE_PATH isolation.

**`docs/plans/sync-history/design.md`**: You _must_ read this when preserving planned-versus-confirmed
evidence and avoiding history rows for rejected reviews.

**`ROADMAP.md`**: You _must_ read this when recording #234 delivery and distinguishing it from #232
confirmed outcomes.
