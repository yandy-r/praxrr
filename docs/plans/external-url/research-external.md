## Executive Summary

As of February 16, 2026, Radarr/Sonarr/Lidarr expose host configuration fields (`urlBase`, `applicationUrl`) and API-key auth, but there is no dedicated upstream contract that maps directly to Praxrr's "Open in" link behavior. For this feature, the low-risk pattern is a dual-URL model: keep `url` for server-to-Arr API communication and add optional `external_url` for browser links. If link resolution is computed as `external_url ?? url` at render time, already-configured instances will automatically pick up External URL when it is added later.

### Candidate APIs and Services

### Radarr API v3 (HostConfig + System Status)

- Documentation URL: https://radarr.video/docs/api/
- OpenAPI URL: https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json
- Auth model: `X-Api-Key` header and `apikey` query auth are both declared in OpenAPI `securitySchemes`.
- Key endpoints/capabilities:
  - `GET /api/v3/system/status`
  - `GET /api/v3/config/host`
  - `PUT /api/v3/config/host/{id}`
  - `HostConfigResource` includes `urlBase` and `applicationUrl` properties.
- Rate limits/quotas: No explicit API rate-limit contract found in official docs/OpenAPI (checked February 16, 2026).
- Pricing notes: Self-hosted OSS (GPL-3.0), no API usage pricing.

### Sonarr API v3 (HostConfig + System Status)

- Documentation URL: https://sonarr.tv/docs/api/
- OpenAPI URL: https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json
- Auth model: `X-Api-Key` header and `apikey` query auth are both declared in OpenAPI `securitySchemes`.
- Key endpoints/capabilities:
  - `GET /api/v3/system/status`
  - `GET /api/v3/config/host`
  - `PUT /api/v3/config/host/{id}`
  - `HostConfigResource` includes `urlBase` and `applicationUrl` properties.
- Rate limits/quotas: No explicit API rate-limit contract found in official docs/OpenAPI (checked February 16, 2026).
- Pricing notes: Self-hosted OSS (GPL-3.0), no API usage pricing.

### Lidarr API v1 (HostConfig + System Status)

- Documentation URL: https://lidarr.audio/docs/api/
- OpenAPI URL: https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json
- Auth model: `X-Api-Key` header and `apikey` query auth are both declared in OpenAPI `securitySchemes`.
- Key endpoints/capabilities:
  - `GET /api/v1/system/status`
  - `GET /api/v1/config/host`
  - `PUT /api/v1/config/host/{id}`
  - `HostConfigResource` includes `urlBase` and `applicationUrl` properties.
- Rate limits/quotas: No explicit API rate-limit contract found in official docs/OpenAPI (checked February 16, 2026).
- Pricing notes: Self-hosted OSS (GPL-3.0), no API usage pricing.

### Servarr Wiki Reverse-Proxy and URL-Base Guidance

- Documentation URL:
  - https://raw.githubusercontent.com/Servarr/Wiki/master/radarr/settings.md
  - https://raw.githubusercontent.com/Servarr/Wiki/master/sonarr/settings.md
  - https://raw.githubusercontent.com/Servarr/Wiki/master/radarr/installation/reverse-proxy.md
  - https://raw.githubusercontent.com/Servarr/Wiki/master/sonarr/installation/reverse-proxy.md
  - https://raw.githubusercontent.com/Servarr/Wiki/master/lidarr/installation/reverse-proxy.md
- Auth model: N/A (documentation source).
- Key endpoints/capabilities: Documents URL Base and reverse-proxy subpath patterns (`/radarr`, `/sonarr`, `/lidarr`) that directly affect link composition.
- Rate limits/quotas: N/A.
- Pricing notes: Free documentation for OSS projects.

## Libraries and SDKs

- TypeScript/Deno (runtime): native `URL` Web API (`new URL`, `URL.canParse`) via Deno Web APIs, with MDN behavior reference.
  - Rationale: standards-based parsing/normalization/path resolution; no new dependency; avoids brittle string concatenation around trailing slashes and subpaths.
  - References:
    - https://docs.deno.com/api/web/~/URL
    - https://developer.mozilla.org/en-US/docs/Web/API/URL/URL
- TypeScript/Deno (Arr integration): continue using existing in-repo Arr client layer.
  - Recommended package: existing internal modules (`packages/praxrr-app/src/lib/server/utils/arr/base.ts`, `packages/praxrr-app/src/lib/server/utils/arr/factory.ts`), no external SDK required.
  - Rationale: already implements API-key auth, retries, timeouts, and Arr-type dispatch used across the codebase.

## Integration Patterns

- recommended auth flow
  - Keep `url` + `api_key` as the only fields used for server communication and connection tests (`/arr/test` -> `/api/v{n}/system/status`).
  - Treat `external_url` as presentation-only data for browser navigation.
  - Do not substitute `external_url` into backend Arr API calls; in Docker setups, browser-reachable and server-reachable hosts are often intentionally different.
- sync/event/webhook strategy
  - No Arr webhook integration is required for this feature.
  - Persist optional `external_url` on `arr_instances` and resolve open-link base at read/render time: `openBaseUrl = external_url ?? url`.
  - Apply this precedence for all "Open in" entry points in `packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte` (table row links and top action open button).
  - This read-time precedence satisfies the requirement that already-configured instances immediately switch once External URL is added later.
- pagination/error handling approach
  - Pagination is unaffected (feature is link-target selection only).
  - Validate `external_url` as absolute `http`/`https` during create/update server actions (`packages/praxrr-app/src/routes/arr/new/+page.server.ts`, `packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts`) and return `400` for invalid values.
  - Build destination links with URL-aware composition instead of raw string concatenation when adding entity path segments.

## Constraints and Gotchas

- Existing schema and query types only model `url` today:
  - `packages/praxrr-app/src/lib/server/db/migrations/001_create_arr_instances.ts`
  - `packages/praxrr-app/src/lib/server/db/schema.sql`
  - `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- Current library page derives link base from `instance.url` only, so all "Open in" links currently point to the API URL:
  - `packages/praxrr-app/src/routes/arr/[id]/library/+page.svelte`
- URL-base/subpath handling is implementation-impacting: Servarr docs explicitly support reverse-proxy subpaths (`/radarr`, `/sonarr`, `/lidarr`). Link building must preserve configured path prefixes.
- URL-constructor behavior caveat: absolute paths reset pathname. For example, joining with a leading `/` can drop an existing base path segment; relative joins with normalized trailing slash are safer.
- Inference note: Arr HostConfig `applicationUrl` could be used as an optional autofill source, but this is not required by current feature scope.

## Open Decisions

- Should `external_url` be restricted to `http`/`https` only, or allow custom schemes?
- Should the UI behavior stay implicit (`external_url` blank => fallback to `url`) or expose an explicit toggle?
- Should save-time validation be syntax-only, or also include optional reachability checks from browser/server contexts?
- Should Praxrr offer a one-click "seed from Arr HostConfig applicationUrl" action?
- Should `external_url` be included immediately in import/export/backups and API contracts, or staged after UI behavior ships?
