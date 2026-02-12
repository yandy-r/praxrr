# Lidarr Support

Profilarr already models Arr instances as typed records, instantiates app-specific clients through a shared factory, and executes configuration sync through section-based jobs. Lidarr support should extend that same pipeline by adding `lidarr` parity across onboarding validation, OpenAPI/shared enums, and runtime branch points in library and release routes. The core integration path is `arr_instances` -> `createArrClient` -> route/sync handlers -> Lidarr API v1 while preserving existing error envelopes, caching, and job history behavior. Current rename/upgrades and several UI controls are still dual-app assumptions, so this feature must either implement or explicitly capability-gate those surfaces for Lidarr.

## Relevant Files

- `src/routes/arr/new/+page.server.ts`: Instance creation validation and allowed Arr types.
- `src/routes/arr/test/+server.ts`: Connection test API and type allowlist.
- `src/routes/arr/components/InstanceForm.svelte`: Arr type selector and onboarding UX flow.
- `src/lib/server/db/queries/arrInstances.ts`: Persistence and retrieval for instance credentials and type.
- `src/lib/server/utils/arr/factory.ts`: Central client instantiation by Arr type.
- `src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr-specific client methods and API version wiring.
- `src/routes/api/v1/arr/library/+server.ts`: Library aggregation path with per-type branching and cache use.
- `src/routes/api/v1/arr/releases/+server.ts`: Release search path with per-type branching.
- `src/lib/server/jobs/handlers/arrSync.ts`: Section-based sync job orchestration entry point.
- `src/lib/server/sync/mappings.ts`: Sync Arr type mappings and section constants.
- `src/lib/shared/pcd/types.ts`: Shared Arr/PCD type unions used by server and UI.
- `docs/api/v1/schemas/arr.yaml`: OpenAPI source for `ArrType` and Arr route contracts.
- `docs/api/v1/schemas/pcd.yaml`: OpenAPI source for PCD entity enums and schema alignment.
- `src/lib/api/v1.d.ts`: Generated API types that must stay schema-aligned.
- `src/routes/custom-formats/[databaseId]/[id]/conditions/components/ConditionCard.svelte`: Existing dual-app UI pattern needing generalization.
- `src/lib/server/jobs/handlers/arrRename.ts`: Rename handler currently constrained to Radarr/Sonarr.
- `src/routes/arr/[id]/upgrades/+page.server.ts`: Upgrades page capability constraints for non-Radarr types.

## Relevant Tables

- `arr_instances`: Stores Arr instance type, URL, API key, and enablement state.
- `pcd_ops`: Source of portable config operations consumed by sync/cache layers.
- `arr_sync_quality_profiles_config`: Per-instance quality profile sync configuration.
- `arr_sync_delay_profiles_config`: Per-instance delay profile sync configuration.
- `arr_sync_media_management`: Per-instance media management sync configuration.
- `jobs`: Job definitions for scheduled/manual sync and related workflows.
- `job_runs`: Execution history and statuses for sync/operation jobs.

## Relevant Patterns

**Arr-Type Branching**: Resolve instance type once, then execute type-specific logic with a normalized response contract. Example: [`src/routes/api/v1/arr/library/+server.ts`](src/routes/api/v1/arr/library/+server.ts).

**Client Factory + Base Client**: Keep transport/auth common in base client and route type differences through factory-selected subclasses. Example: [`src/lib/server/utils/arr/factory.ts`](src/lib/server/utils/arr/factory.ts).

**Section-Based Sync Orchestration**: Run sync by reusable sections and mappings instead of app-specific pipelines. Example: [`src/lib/server/jobs/handlers/arrSync.ts`](src/lib/server/jobs/handlers/arrSync.ts).

**Contract-First Type Alignment**: Update OpenAPI schemas first, then regenerate and align shared/server unions to prevent drift. Example: [`docs/api/v1/schemas/arr.yaml`](docs/api/v1/schemas/arr.yaml).

**Capability-Gated UX**: Explicitly show unsupported surfaces where parity is not implemented yet. Example: [`src/routes/arr/[id]/upgrades/+page.server.ts`](src/routes/arr/[id]/upgrades/+page.server.ts).

## Relevant Docs

**`docs/plans/lidarr-support/feature-spec.md`**: You _must_ read this when working on scope, acceptance criteria, and rollout boundaries.

**`docs/plans/lidarr-support/research-technical.md`**: You _must_ read this when modifying architecture seams, types, or sync paths.

**`docs/plans/lidarr-support/research-external.md`**: You _must_ read this when implementing Lidarr API endpoints and auth behavior.

**`docs/plans/lidarr-support/research-business.md`**: You _must_ read this when prioritizing parity decisions and user-facing rules.

**`docs/plans/lidarr-support/research-ux.md`**: You _must_ read this when changing Arr UI controls and unsupported-state messaging.

**`docs/plans/lidarr-support/github-issue-drafts.md`**: You _must_ read this when mapping plan tasks to issue IDs `#1`-`#5` under `#6`.

**`docs/api/v1/schemas/arr.yaml`**: You _must_ read this when changing Arr API contracts and `ArrType` enums.

**`docs/api/v1/schemas/pcd.yaml`**: You _must_ read this when deciding Lidarr media-management entity strategy.
