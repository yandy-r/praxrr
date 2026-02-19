# Lidarr Support - External API Research

## Executive Summary

Lidarr support is feasible with the same high-level integration model used for Radarr and Sonarr,
but important parts of the data model differ for music (audio quality taxonomy, metadata profiles,
and release profile semantics). The primary integration surface is Lidarr's REST API under
`/api/v1`, with optional SignalR updates from `/signalr/messages` for near-real-time sync status.
Successful support depends on write ordering (for example custom formats before quality profiles),
Lidarr-specific validations, and a clear decision on how much of Lidarr's music-only model should be
represented in `praxrr-db`.

## Candidate APIs and Services

### Lidarr REST API v1

- Documentation URL:
  - https://lidarr.audio/docs/api/
  - https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json
- Auth model:
  - API key via `X-Api-Key` header (preferred) or `apikey` query parameter.
- Key endpoints/capabilities:
  - Profiles/config: `/api/v1/qualityprofile`, `/api/v1/metadataprofile`, `/api/v1/releaseprofile`,
    `/api/v1/customformat`, `/api/v1/qualitydefinition`, `/api/v1/config/naming`,
    `/api/v1/config/mediamanagement`, `/api/v1/rootfolder`, `/api/v1/tag`
  - Operational introspection: `/api/v1/system/status`, `/api/v1/system/routes`
  - Async command execution: `/api/v1/command`, `/api/v1/command/{id}`
- Rate limits/quotas:
  - No first-party documented hard quota found.
  - Inference: no obvious built-in throttling layer is documented, so client backoff should still be
    used.
- Pricing notes:
  - Self-hosted OSS (GPL-3.0), no API usage fees.

### Lidarr SignalR Hub (optional realtime)

- Documentation URL:
  - https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Host/Startup.cs
  - https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.SignalR/MessageHub.cs
  - https://learn.microsoft.com/en-us/aspnet/core/signalr/configuration?view=aspnetcore-9.0
- Auth model:
  - API-key-based auth policy; token-style query parameter usage for websocket flows.
- Key endpoints/capabilities:
  - Hub endpoint: `/signalr/messages`
  - Broadcast method usage: `receiveMessage`
  - Useful for command progress and resource-change notifications.
- Rate limits/quotas:
  - No first-party documented quota found.
- Pricing notes:
  - Included with Lidarr.

### Lidarr Connections/Webhook Subsystem

- Documentation URL:
  - https://wiki.servarr.com/lidarr/settings
  - https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Notifications/Webhook/Webhook.cs
  - https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Notifications/Webhook/WebhookEventType.cs
- Auth model:
  - Outbound webhook configuration supports custom headers and optional auth fields.
- Key endpoints/capabilities:
  - Managed through notification endpoints in `/api/v1/notification*`
  - Supports event push for grab/import/failure/rename/health/application-update events.
- Rate limits/quotas:
  - Not explicitly documented.
- Pricing notes:
  - Included with Lidarr.

## Libraries and SDKs

- `node/typescript`: OpenAPI Generator (`@openapitools/openapi-generator-cli`) using
  `typescript-fetch` from Lidarr's OpenAPI file.
- `python`: generated client from OpenAPI Generator, or evaluate community clients such as
  `devopsarr/lidarr-py`.
- `go`: generated client from OpenAPI Generator, or evaluate community clients such as
  `devopsarr/lidarr-go`.
- `.NET` realtime channel: `Microsoft.AspNetCore.SignalR.Client` when realtime command/resource
  updates are needed.

## Integration Patterns

- Recommended auth flow:
  - Prefer `X-Api-Key` header for REST.
  - Respect Lidarr base-path hosting when constructing URLs.
  - For SignalR, use API-key token flow appropriate for websocket negotiation.
- Sync/event/webhook strategy:
  - Start with full REST reads of config/profile resources.
  - For queued operations, use command endpoints and status polling.
  - Optional enhancement: subscribe to SignalR and/or use notification/webhook events for faster
    reconciliation.
- Pagination/error handling approach:
  - Support both paged and unpaged endpoints where applicable.
  - Handle validation and error payloads explicitly, not only status code.
  - Expect runtime non-200 cases beyond what OpenAPI examples may show.

## Constraints and Gotchas

- Quality-profile updates can fail if payload custom-format membership does not match expectations.
- Lidarr profile semantics are music-oriented and do not map 1:1 to Radarr/Sonarr video assumptions.
- Metadata/quality profile delete/update operations can fail when referenced by existing entities.
- Root-folder path behavior has immutability constraints in practice.
- OpenAPI exposure can vary by runtime configuration; do not assume live docs endpoints are always
  enabled.
- Release profile rule requirements differ from simple quality profile behavior.
- Audio codec/bitrate model requires dedicated mapping strategy in DB.

## Open Decisions

- Full Lidarr domain support in v1 vs scoped subset (quality profiles only, or include
  metadata/release profiles).
- Shared-table extension with `arr_type='lidarr'` vs distinct Lidarr-specific table family.
- REST polling-only initial integration vs immediate realtime SignalR augmentation.
- Generated API clients vendored in repo vs build-time generation.

## Sources

Accessed on 2026-02-13.

- https://lidarr.audio/docs/api/
- https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json
- https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Host/Startup.cs
- https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Http/Authentication/AuthenticationBuilderExtensions.cs
- https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Http/Authentication/ApiKeyAuthenticationHandler.cs
- https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/Profiles/Quality/QualityProfileController.cs
- https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/CustomFormats/CustomFormatController.cs
- https://github.com/Lidarr/Lidarr/blob/develop/src/Lidarr.Api.V1/RootFolders/RootFolderController.cs
- https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Profiles/Qualities/QualityProfileService.cs
- https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Profiles/Metadata/MetadataProfileService.cs
- https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Qualities/Quality.cs
- https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.SignalR/MessageHub.cs
- https://wiki.servarr.com/lidarr/settings
- https://openapi-generator.tech/docs/installation/
- https://openapi-generator.tech/docs/usage/
- https://openapi-generator.tech/docs/generators/
- https://learn.microsoft.com/en-us/aspnet/core/signalr/configuration?view=aspnetcore-9.0
- https://github.com/devopsarr/lidarr-py
- https://github.com/devopsarr/lidarr-go
