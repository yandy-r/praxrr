# External API Research: sonarr-pull-resources (Second Pass)

## Executive Summary

As of February 15, 2026, this feature should continue to target Sonarr v4 instances using the `/api/v3/*` API namespace, with a preview-then-commit flow and optional selection before commit. The new requirement is compatible with current APIs: the backend can fetch full resource sets, then either honor user selections or default to import-all when no explicit selection is provided, while existing dedup/conflict logic still applies. The main external risk is forward compatibility with Sonarr v5-develop OpenAPI changes, not current v4 integration.

## Candidate APIs and Services

### Sonarr API (production target for this feature)

- Documentation URL: https://sonarr.tv/docs/api/
- OpenAPI URL: https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json
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

### Sonarr v5-develop OpenAPI (forward compatibility watch)

- OpenAPI URL: https://raw.githubusercontent.com/Sonarr/Sonarr/v5-develop/src/Sonarr.Api.V5/openapi.json
- Notes:
  - indicates path/schema drift from v3 contracts
  - should be treated as compatibility planning input, not MVP behavior

### GitHub releases metadata (version policy checks)

- URL: https://api.github.com/repos/Sonarr/Sonarr/releases
- Usage: optional checks for release/support messaging in docs and diagnostics

## Libraries and SDKs

- Runtime recommendation: keep using existing in-repo Arr client (`BaseArrClient`)
- Rationale:
  - all required fetch endpoints already exist in project code
  - avoids new dependency drift and keeps typing aligned with existing sync modules

Optional reference SDKs only (not required for implementation):

- Go: `golift.io/starr`
- Python: `sonarr-py`
- TypeScript npm: `@arr-ts-2/sonarr`

## Integration Patterns

- Recommended auth flow:
  - validate connectivity with `GET /api/v3/system/status`
  - call all selected resource endpoints with the existing Arr client
- Pull pattern:
  - preview: fetch + classify (new/identical/conflict/praxrr-managed)
  - execute: commit selected entities OR default to all previewed entities when `selections` is omitted/empty
- Error handling:
  - robust non-2xx handling (`401/403/404/5xx`)
  - retry transient transport failures only
  - do not retry validation/conflict failures
- Pagination:
  - target configuration endpoints are full-list fetches for MVP

## Constraints and Gotchas

- Do not assume v5 paths mirror v3; keep version-aware adapter boundaries in pull services.
- Keep compatibility statement explicit: this feature targets Sonarr v4 behavior as of February 15, 2026.
- Naming config may be exposed with both base and `{id}` variants; avoid brittle endpoint assumptions.
- Keep release-profile support out of MVP unless product scope expands; it adds complexity without value for current pull resources.

## Open Decisions

1. Should no-selection execute default include conflicts with `skip` policy or block for explicit resolution?
2. Should execute require a preview snapshot token/hash to avoid preview/execute drift?
3. Should missing QP dependencies (unselected CFs) auto-include by default or warn and drop scores?
4. Should v5 compatibility be tracked now behind a feature flag, or deferred?

## Corrections to Existing Research

1. Align all docs to the new required behavior: selection is optional, and no explicit selection means import-all through existing dedup/conflict pipeline.
2. Remove contradictions around mandatory `selections` in execute payload examples.
3. Replace “future enhancement” language for selective pull; it is now core scope.
4. Tighten date statements by using explicit dates in support/version notes where needed.

## Sources

- Sonarr API docs: https://sonarr.tv/docs/api/
- Sonarr OpenAPI v3: https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json
- Sonarr OpenAPI v5-develop: https://raw.githubusercontent.com/Sonarr/Sonarr/v5-develop/src/Sonarr.Api.V5/openapi.json
- Sonarr releases: https://github.com/Sonarr/Sonarr/releases
- Sonarr v4 release announcement (December 26, 2023): https://forums.sonarr.tv/t/sonarr-v4-released/33089
- Sonarr v3 support statement (May 2, 2024): https://forums.sonarr.tv/t/does-api-v3-work-in-v4/34942
