> [!WARNING]
> Superseded on 2026-02-15 by the first-class Lidarr initiative plan in `docs/plans/enhance-lidarr-support/parallel-plan.md` (tracked by GitHub issue #130 and umbrella #13).
>
> This document captures the legacy Sonarr-reuse rollout model and is retained for historical context only. Do not use it for current implementation planning.

# Documentation Research: lidarr-support

## Architecture Docs

- `/docs/ARCHITECTURE.md`: Describes the Media Management stack (naming, media settings, quality definitions) as separate Radarr/Sonarr entities with UI routes under `packages/praxrr-app/src/routes/media-management/**`. The write‑up lists the tables and CRUD flows for Radarr/Sonarr only; Lidarr is nowhere mentioned, so implementers looking for how Lidarr naming/quality/media presets should be surfaced or created get no guidance here.

## API Docs

- `/docs/api/v1/schemas/pcd.yaml`: Portable entity schema notes that “v1 Lidarr media-management strategy” reuses `radarr_*`/`sonarr_*` shapes for naming, media settings, and quality definitions, capability-gating unsupported Lidarr-only fields and keeping `arr_type = 'lidarr'` on shared rows. Export/Import sections explicitly list the reused PortableMediaSettings/PortableQualityDefinitions and emphasize deterministic, logged outcomes when Lidarr fields are skipped.
- `/docs/api/v1/schemas/arr.yaml`: Defines `LidarrLibraryItem` as a placeholder with `additionalProperties: true` and documents the `LibraryLidarrResponse`, noting Lidarr payload fields are capability-gated until future library support ships. This is the only schema-level acknowledgement of Lidarr media data at present.
- `/docs/api/v1/paths/arr.yaml`: Describes library and release routes, with brief parenthetical notes that Lidarr endpoints return artists/albums or albums/releases and that identifiers are album IDs. No media-management endpoints are covered here, but the file flags that Lidarr payload details are deferred, which is useful context for implementers trying to understand the API surface they can (and cannot) expect right now.

## Development Guides

- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts`: Module-level documentation at the top of the file explains the three config types (media settings, naming, quality definitions) and the sync flow. Throughout the file there are constants and log messages that explicitly describe how Lidarr v1 reuses Sonarr entities, why unsupported Lidarr fields are skipped, and when Lidarr naming/quality syncs log capability-gating reasons. Reading this is essential to understand the actual behavior behind the documentation, especially the hard-coded reasons (e.g., `LIDARR_REUSE_ENTITY_REASON`) and the `sync*` methods that map Lidarr requests to Sonarr tables.

## README Files

- `/README.md`: Frames this fork as a Lidarr-support branch, warns that “v2” is under heavy development, and points to `yandy-r.dev` for “complete installation, usage, and API documentation.” There’s no mention of how to configure Lidarr media-management naming/quality presets or how the UI surfaces Lidarr configs in those sections.
- `packages/praxrr-app/src/lib/server/utils/arr/README.md`: Explains the arr client hierarchy and enumerates Radarr/Sonarr/Lidarr/Chaptarr clients with their directory layout. It’s useful for developers needing to see where `LidarrClient` lives, but it doesn’t cover media-management naming/quality settings or how Lidarr-specific behaviors differ from its peers.

## Must-Read Documents

- `/docs/api/v1/schemas/pcd.yaml` – Details the portable entity contracts that Lidarr shares with Radarr/Sonarr, including the reuse strategy and explicit capability gating of unsupported music fields. Reading it is critical before touching import/export or sync code for Lidarr media management.
- `packages/praxrr-app/src/lib/server/sync/mediaManagement/syncer.ts` – Outlines the runtime flow for media settings, naming, and quality-definition syncs, and documents the Lidarr-specific reuse/gating logic. Anyone implementing or extending Lidarr media-management support needs this as a mental model of what fields are actually touched.

## Documentation Gaps

- `media-management/naming`: `/docs/ARCHITECTURE.md` lists only `radarr_naming` and `sonarr_naming` entities; there’s no mention of Lidarr naming, how to declare a `lidarr` arr_type preset, or how the UI should expose it. Implementers lack guidance on even making a visible Lidarr naming config, let alone how the tables/queries should be structured.
- `media-management/quality-definitions`: The docs likewise mention just Radarr/Sonarr tables. `docs/api/v1/schemas/pcd.yaml` only says Lidarr reuses those shared shapes, but there’s no detail about which quality-definition entries map to Lidarr, how to scope Lidarr-specific definitions, or what needs to be capability-gated. There is no reference doc that walks through `media-management/quality-definitions` from a Lidarr point of view.
- `media-management/media-settings`: Nothing in `/docs/ARCHITECTURE.md` or related docs explains how Lidarr media settings (propers/repacks, enableMediaInfo, etc.) should be surfaced. The only mention of Lidarr here is that it reuses Sonarr media settings in the PCD schema, so implementers don’t know which fields Lidarr actually supports, how to create a visible config, or how to handle the “reused entity” logic in the UI or docs.
