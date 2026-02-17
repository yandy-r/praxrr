# External API Research: radarr-pull-resources (Second Pass)

## Executive Summary

As of February 15, 2026, this feature should target Radarr v6 behavior via the `/api/v3/*` API namespace, using the same preview-then-commit flow used for Sonarr pull resources. The required behavior is compatible with current Radarr APIs: backend preview can fetch full resource sets, and execute can either honor explicit selections or default to import-all when `selections` is omitted/empty. The main external risk is not endpoint availability, but keeping version and schema assumptions explicit over time.

## Candidate APIs and Services

### Radarr API (production target for this feature)

- Documentation URL: <https://radarr.video/docs/api/>
- OpenAPI URL: <https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json>
- Auth model: `X-Api-Key` header (preferred), `apikey` query param (fallback)
- Key endpoints/capabilities:
  - `GET /api/v3/customformat`
  - `GET /api/v3/qualityprofile`
  - `GET /api/v3/delayprofile`
  - `GET /api/v3/qualitydefinition`
  - `GET /api/v3/config/naming`
  - `GET /api/v3/config/mediamanagement`
  - `GET /api/v3/tag`
  - `GET /api/v3/system/status`
- Rate limits/quotas: no documented API quota contract for these endpoints
- Pricing notes: self-hosted, no API usage pricing

### Radarr develop branch OpenAPI (forward compatibility watch)

- OpenAPI URL: <https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json>
- Notes:
  - `develop` still exposes `Radarr.Api.V3` as of February 15, 2026
  - there is no published Radarr v4/v5 API namespace equivalent today

### GitHub releases metadata (version policy checks)

- URL: <https://api.github.com/repos/Radarr/Radarr/releases>
- Usage: optional checks for release support messaging in docs and diagnostics
- Current observed releases (February 15, 2026):
  - latest stable: `v6.0.4.10291` (published November 16, 2025)
  - latest prerelease: `v6.1.1.10317` (published January 7, 2026)

## Libraries and SDKs

- Runtime recommendation: keep using existing in-repo Arr client (`BaseArrClient`)
- Rationale:
  - all required fetch endpoints already exist in project code patterns
  - avoids dependency drift and keeps typing aligned with existing sync modules

Optional reference SDKs only (not required for implementation):

- Go: `golift.io/starr`
- Python: `pyarr`

## Integration Patterns

- Recommended auth flow:
  - validate connectivity with `GET /api/v3/system/status`
  - call selected resource endpoints with existing Arr client
- Pull pattern:
  - preview: fetch + classify (`new`/`identical`/`conflict`/`praxrr_managed`)
  - execute: commit selected entities OR default to all previewed entities when `selections` is omitted/empty
- Error handling:
  - robust non-2xx handling (`401/403/404/5xx`)
  - retry transient transport failures only
  - do not retry validation/conflict failures
- Pagination:
  - target configuration endpoints are full-list fetches for MVP

## Constraints and Gotchas

- Keep compatibility statement explicit: this feature targets Radarr v6 behavior as of February 15, 2026.
- Radarr naming schema differs from Sonarr:
  - Radarr uses string enum `ColonReplacementFormat` values (`delete`, `dash`, `spaceDash`, `spaceDashSpace`, `smart`)
  - Sonarr naming uses integer representation in current v3 schema
- Radarr quality profiles include `language`; Sonarr quality profiles do not.
- Avoid overcommitting on undocumented API quotas; treat "no documented rate limits" as current documentation state, not a guarantee.

## Open Decisions

1. Should no-selection execute default include conflicts with `skip` policy or block for explicit resolution?
2. Should execute require a preview snapshot token/hash to avoid preview/execute drift?
3. Should missing QP dependencies (unselected CFs) auto-include by default or warn and drop scores?
4. Should a lightweight Radarr major-version guard (`/system/status`) be mandatory in preview?

## Corrections to Existing Research

1. Align all docs to explicit second-pass behavior: selection is optional and no explicit selection means import-all through existing dedup/conflict pipeline.
2. Correct release timeline references with exact dates (not relative terms).
3. Replace secondary aggregation links with primary Radarr/GitHub sources.
4. Rephrase forward-compatibility claims as evidence-based observations (as-of-date), not long-term guarantees.

## Sources

- Radarr API docs: <https://radarr.video/docs/api/>
- Radarr OpenAPI v3: <https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json>
- Radarr repository src listing (`develop`): <https://api.github.com/repos/Radarr/Radarr/contents/src?ref=develop>
- Radarr releases API: <https://api.github.com/repos/Radarr/Radarr/releases>
- Radarr v6.0.0 release: <https://github.com/Radarr/Radarr/releases/tag/v6.0.0.10217>
- Sonarr OpenAPI v3 (schema comparison): <https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json>
