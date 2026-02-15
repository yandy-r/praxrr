# Research: External APIs

## Executive Summary

Lidarr already provides the API surface needed to stop Sonarr reuse for media-management. The key first-class resources are naming config, media-management config, and quality definitions, and each is available through stable v1 endpoints. A low-risk integration pattern is full-snapshot read, deterministic ordered writes, and explicit post-change command execution with command-status polling.

## Candidate APIs and Services

### Lidarr REST API v1

- Documentation URL: <https://lidarr.audio/docs/api/>
- OpenAPI URL: <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json>
- Auth model: `X-Api-Key` header (also supports query `apikey`; bearer auth accepted by handler)
- Key endpoints/capabilities:
  - `GET /api`
  - `GET /api/v1/config/naming`
  - `PUT /api/v1/config/naming/{id}`
  - `GET /api/v1/config/mediamanagement`
  - `PUT /api/v1/config/mediamanagement/{id}`
  - `GET /api/v1/qualitydefinition`
  - `PUT /api/v1/qualitydefinition/{id}`
  - `PUT /api/v1/qualitydefinition/update`
  - `POST /api/v1/command`
  - `GET /api/v1/command/{id}`
- Rate limits/quotas: no explicit contract documented
- Pricing notes: self-hosted open source project (GPLv3)

### Lidarr Connect Custom Scripts

- Documentation URL: <https://raw.githubusercontent.com/Servarr/Wiki/master/lidarr/custom-scripts.md>
- Auth model: local process hooks (not HTTP API auth)
- Capabilities: event hooks for import, rename, retag, and health events
- Rate limits/quotas: not documented
- Pricing notes: no separate paid tier

## Libraries and SDKs

- TypeScript/Deno: generate typed clients from Lidarr OpenAPI using `typescript-fetch` generator
- Python (optional tooling only): `devopsarr/lidarr-py` exists but is third-party and should remain non-authoritative

## Integration Patterns

- Recommended auth flow:
  - Use header-based API key auth (`X-Api-Key`) to avoid query-string leakage.
  - Run lightweight capability/version probe (`GET /api`, `GET /api/v1/system/status`) before sync/apply.
- Sync/event strategy:
  - Read current snapshot of naming/media/quality definitions.
  - Apply updates in deterministic order: naming -> media settings -> quality definitions.
  - Trigger optional reconciliation commands (rescan/rename/reset) and poll command status.
- Pagination/error handling:
  - These target config endpoints are effectively snapshot endpoints.
  - For other paginated Lidarr resources, use explicit `page` and `pageSize`.
  - Treat `400` validation responses and `401/403` auth failures as hard-stop errors.

## Constraints and Gotchas

- Naming/media config controllers behave as singleton-like resources (`id = 1` semantics), so migration should treat them as singleton records per arr instance.
- `PUT` config updates should send full payload objects to avoid unintended defaulting.
- Quality definitions are internally normalized against known quality sets; migration should key by stable quality identity rather than label text.
- OpenAPI response codes and runtime response codes may differ (`200` vs `202/201` patterns in some controllers), so clients must accept equivalent success classes.

## Open Decisions

- Should quality-definition migration be strict-by-id only, or allow label-based fallback matching?
- Should reconciliation commands be auto-run after migration or remain operator-triggered?
- Do we support polling-only command tracking first, or implement SignalR progress immediately?
- What explicit collision behavior is required when both legacy Sonarr-backed and new `lidarr_*` records are present?

## References

- <https://lidarr.audio/docs/api/>
- <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json>
- <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Http/Authentication/ApiKeyAuthenticationHandler.cs>
- <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/Config/NamingConfigController.cs>
- <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/Config/MediaManagementConfigController.cs>
- <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/Qualities/QualityDefinitionController.cs>
- <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/Commands/CommandController.cs>
- <https://raw.githubusercontent.com/Servarr/Wiki/master/lidarr/custom-scripts.md>
