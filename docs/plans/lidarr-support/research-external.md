# Lidarr External API Research

## Executive Summary

Lidarr provides an official OpenAPI-backed v1 API that covers most areas Profilarr already uses in Radarr/Sonarr flows: quality profiles, custom formats, delay profiles, naming/media-management config, tags, command polling, and release/library endpoints. Authentication supports `X-Api-Key` (plus query-token fallbacks), and the startup pipeline also exposes SignalR and webhook capabilities that can be layered later for lower-latency refresh. The largest integration constraints are v1-specific endpoint differences and under-specified non-200 error contracts.

## Candidate APIs and Services

### Lidarr REST API v1

- Documentation URL: `https://lidarr.audio/docs/api/`
- OpenAPI URL: `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json`
- Auth model:
  - Header: `X-Api-Key`
  - Query: `apikey`
  - Code fallback: `Authorization: Bearer ...`
  - Source: `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Http/Authentication/ApiKeyAuthenticationHandler.cs`
- Key endpoints/capabilities (verified in OpenAPI):
  - `/api/v1/system/status`
  - `/api/v1/qualityprofile`
  - `/api/v1/customformat`
  - `/api/v1/delayprofile`
  - `/api/v1/config/mediamanagement`
  - `/api/v1/config/naming`
  - `/api/v1/qualitydefinition/update`
  - `/api/v1/tag`
  - `/api/v1/command`
  - `/api/v1/artist`, `/api/v1/album`, `/api/v1/trackfile`
  - `/api/v1/release`, `/api/v1/queue`, `/api/v1/history`, `/api/v1/log`
  - `/api/v1/metadataprofile`
  - `/api/v1/wanted/missing`, `/api/v1/wanted/cutoff`
- Rate limits/quotas:
  - No explicit rate-limit contract is documented in OpenAPI or startup code.
- Pricing notes:
  - Self-hosted OSS (GPL-3.0), no paid API plan.
  - Source: `https://github.com/Lidarr/Lidarr/blob/develop/LICENSE.md`

### Lidarr Notifications/Webhooks

- Docs/source:
  - OpenAPI notification endpoints: same OpenAPI URL above
  - Event enum: `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/NzbDrone.Core/Notifications/Webhook/WebhookEventType.cs`
- Auth model:
  - Same API key model as main API for notification endpoints.
- Key capabilities:
  - Notification CRUD/test endpoints
  - Webhook events include `Grab`, `Download`, `ImportFailure`, `Rename`, `ArtistAdd`, `AlbumDelete`, `Retag`, `Health`, `ApplicationUpdate`.
- Rate limits/quotas:
  - Not documented.
- Pricing notes:
  - Included in Lidarr.

### Lidarr SignalR Messages (Optional)

- Source: `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/NzbDrone.Host/Startup.cs`
- Path: `/signalr/messages` (requires authorization policy `SignalR`)
- Auth model:
  - Uses API key scheme with `access_token` query mapping in auth extension.
  - Source: `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Http/Authentication/AuthenticationBuilderExtensions.cs`

## Libraries and SDKs

- Current repo pattern is handcrafted typed clients (`src/lib/server/utils/arr/clients/*.ts`) with shared `BaseArrClient`; this is consistent with existing architecture.
- Optional tooling for stronger contract safety:
  - `openapi-typescript` for schema-driven TS types from Lidarr OpenAPI: `https://openapi-ts.dev/introduction`
  - Optional `openapi-fetch` runtime wrapper: `https://openapi-ts.dev/openapi-fetch/`
- No official Lidarr-maintained TypeScript SDK was identified in official docs.

## Integration Patterns

- Recommended auth flow:
  - Keep existing per-instance `url + api_key` storage and `X-Api-Key` headers via `BaseArrClient`.
  - Validate connection through `/api/v1/system/status` in `/arr/test` and create/edit flows.
- Sync/event strategy:
  - Phase 1: periodic REST polling only (consistent with current sync jobs).
  - Phase 2+: optional webhook-triggered refresh for faster state updates.
  - Phase 3+: optional SignalR evaluation if webhook coverage is insufficient.
- Pagination/error handling:
  - Reuse existing explicit request validation and response normalization.
  - For async operations, follow existing command polling pattern (`/api/v1/command/{id}` equivalent).
  - Keep server-side defensive handling for non-200 responses because Lidarr OpenAPI under-documents many error bodies.

## Constraints and Gotchas

- Lidarr uses API `v1`, while Radarr/Sonarr clients in this repo are v3-based.
- Lidarr startup only exposes `/docs/{documentName}/openapi.json` in debug mode; using the GitHub OpenAPI source is more reliable for generation.
- Music domain model differs materially from movie/series models (artist/album/track hierarchy).
- Webhook enum includes a TODO about casing changes in future major versions; avoid brittle string assumptions.

## Open Decisions

- What “same functionality” means for first delivery:
  - config sync parity only
  - config + library
  - config + library + release/rename/upgrades
- Event model for v1:
  - polling-only
  - polling + webhook triggers
- Type strategy:
  - continue handwritten client types
  - introduce OpenAPI-generated types for Lidarr (or all Arr clients)
- Support policy:
  - minimum tested Lidarr version and compatibility guarantees.

## Sources

- `https://lidarr.audio/docs/api/`
- `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json`
- `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/NzbDrone.Host/Startup.cs`
- `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Http/Authentication/ApiKeyAuthenticationHandler.cs`
- `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Http/Authentication/AuthenticationBuilderExtensions.cs`
- `https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/NzbDrone.Core/Notifications/Webhook/WebhookEventType.cs`
- `https://openapi-ts.dev/introduction`
