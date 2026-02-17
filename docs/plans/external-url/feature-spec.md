# Feature Spec: External URL for Arr "Open in" Links

## Executive Summary

Praxrr currently uses one Arr instance URL for both backend API communication and frontend "Open in" links. In Docker and internal-network deployments, that URL is often an internal hostname such as `http://lidarr:8686`, which works for server-to-server traffic but fails in user browsers. This feature adds an optional `external_url` field per Arr instance and updates link rendering so browser navigation uses `external_url` when present, otherwise falls back to the existing `url`. The backend must continue to use `url` for all Arr API calls, sync jobs, and tests. The change should apply to existing records without migration backfills, so links update automatically as soon as users set or clear `external_url`.

## External Dependencies

### APIs and Services

#### Radarr API v3

- **Documentation**: https://radarr.video/docs/api/
- **OpenAPI**: https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json
- **Authentication**: `X-Api-Key` header (and query apikey supported by spec)
- **Key Endpoints**:
  - `GET /api/v3/system/status`: connectivity/system checks
  - `GET /api/v3/config/host`: host config inspection
  - `PUT /api/v3/config/host/{id}`: host settings update
- **Rate Limits**: no explicit published limit found in official docs as of February 16, 2026
- **Pricing**: self-hosted OSS

#### Sonarr API v3

- **Documentation**: https://sonarr.tv/docs/api/
- **OpenAPI**: https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json
- **Authentication**: `X-Api-Key` header (and query apikey supported by spec)
- **Key Endpoints**:
  - `GET /api/v3/system/status`
  - `GET /api/v3/config/host`
  - `PUT /api/v3/config/host/{id}`
- **Rate Limits**: no explicit published limit found in official docs as of February 16, 2026
- **Pricing**: self-hosted OSS

#### Lidarr API v1

- **Documentation**: https://lidarr.audio/docs/api/
- **OpenAPI**: https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json
- **Authentication**: `X-Api-Key` header (and query apikey supported by spec)
- **Key Endpoints**:
  - `GET /api/v1/system/status`
  - `GET /api/v1/config/host`
  - `PUT /api/v1/config/host/{id}`
- **Rate Limits**: no explicit published limit found in official docs as of February 16, 2026
- **Pricing**: self-hosted OSS

### Libraries and SDKs

| Library                                             | Version          | Purpose                                         | Installation |
| --------------------------------------------------- | ---------------- | ----------------------------------------------- | ------------ |
| Web `URL` API (Deno runtime)                        | runtime built-in | safe URL parsing, normalization, path joining   | none         |
| Existing Arr client modules (`$server/utils/arr/*`) | in-repo          | keep API communication bound to canonical `url` | none         |

### External Documentation

- [Servarr reverse proxy guidance](https://raw.githubusercontent.com/Servarr/Wiki/master/radarr/installation/reverse-proxy.md): path/base URL behavior impacts link composition.
- [Servarr settings references](https://raw.githubusercontent.com/Servarr/Wiki/master/sonarr/settings.md): documents app URL base concepts relevant to UI link generation.
- [MDN URL API](https://developer.mozilla.org/en-US/docs/Web/API/URL/URL): standards behavior for safe URL composition.

## Business Requirements

### User Stories

**Primary User: Deployment Operator**

- As a deployment operator, I want to configure an optional browser-facing URL so "Open in" links work even when canonical Arr URLs are internal hostnames.
- As a deployment operator, I want links to switch automatically after saving External URL so I do not have to recreate instances.

**Secondary User: Praxrr Administrator**

- As an admin, I want backend jobs and tests to keep using canonical `url` so existing Docker/internal communication remains stable.
- As an admin, I want clearing External URL to immediately revert links to canonical `url`.

### Business Rules

1. **Canonical API URL preservation**: `arr_instances.url` remains mandatory and remains the only URL used for server-side Arr communication.
2. **External URL optionality**: `external_url` is nullable/optional and only affects browser navigation.
3. **Open-link fallback rule**: link base is `external_url` when non-empty, otherwise `url`.
4. **Immediate propagation**: update to `external_url` applies to link rendering on next load with no manual migration/re-sync.
5. **Scope consistency**: all in-scope "Open in" link surfaces must use one shared resolver to prevent drift.

### Edge Cases

| Scenario                                    | Expected Behavior                                            | Notes                                          |
| ------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| Existing instance has no `external_url`     | Links continue using `url`                                   | Backward compatible default                    |
| `external_url` added after months of use    | Links switch to `external_url` immediately after save/reload | No backfill required                           |
| `external_url` cleared                      | Links revert to `url`                                        | Empty string normalized to NULL                |
| `external_url` malformed                    | Save rejected with clear validation error                    | Validate only when field is present            |
| URL contains reverse-proxy path (`/radarr`) | Path preserved in generated links                            | Avoid leading-slash joins that drop base paths |

### Success Criteria

- [x] Existing instances without `external_url` behave unchanged.
- [x] All in-scope "Open in" links use `external_url` when provided.
- [x] Arr API clients and jobs still use only canonical `url`.
- [x] Users can add/edit/clear External URL from existing instance settings.
- [x] Regression tests cover fallback behavior and non-impact on backend connectivity.
- [x] Regression tests cover add/update/clear External URL outcomes in CI-required flow coverage.

## Technical Specifications

### Architecture Overview

```text
[InstanceForm + server actions]
            |
            v
[arr_instances: url, external_url]
            |
            v
[layout load: instance]
            |
            v
[UI Open-in resolver: external_url || url]
     |                     |
     v                     v
[Library links]      [Arr list/card links]

Backend Arr clients, sync jobs, tests --> always use instance.url
```

### Data Models

#### `arr_instances` (existing + extension)

| Field          | Type    | Constraints | Description                                    |
| -------------- | ------- | ----------- | ---------------------------------------------- |
| `id`           | INTEGER | PK          | Instance identifier                            |
| `url`          | TEXT    | NOT NULL    | Canonical server-to-server Arr endpoint        |
| `external_url` | TEXT    | NULL        | Optional browser-facing endpoint for "Open in" |
| `api_key`      | TEXT    | NOT NULL    | Arr API auth                                   |
| `type`         | TEXT    | NOT NULL    | Arr type discriminator                         |

**Migration considerations:**

- Add nullable `external_url` column via new migration file.
- Register migration and update schema documentation.
- Normalize blank input to NULL in create/update queries.

### API Design

#### `POST /arr/new?/save` (existing SvelteKit action)

**Purpose**: Create Arr instance including optional `external_url`.

**Request fields:**

```json
{
  "name": "string",
  "type": "radarr|sonarr|lidarr|...",
  "url": "required http(s) URL",
  "external_url": "optional http(s) URL",
  "api_key": "string",
  "tags": "comma-delimited optional"
}
```

**Behavior:**

- Validate `url` required.
- Validate `external_url` only when non-empty.
- Persist `external_url` as NULL when empty.

#### `POST /arr/{id}/settings?/update` (existing SvelteKit action)

**Purpose**: Update Arr instance including add/edit/clear `external_url`.

**Request/response model:** same field semantics as create action.

### System Integration

#### Files to Create

- `src/lib/server/db/migrations/0XX_add_arr_instances_external_url.ts`: add nullable `external_url`.

#### Files to Modify

- `src/lib/server/db/schema.sql`: document new column.
- `src/lib/server/db/queries/arrInstances.ts`: types and create/update persistence.
- `src/routes/arr/components/InstanceForm.svelte`: optional field + hidden form plumbing.
- `src/routes/arr/new/+page.server.ts`: parse/validate/persist optional field.
- `src/routes/arr/[id]/settings/+page.server.ts`: parse/validate/persist optional field.
- `src/routes/arr/[id]/library/+page.svelte`: shared browser link-base resolver.
- `src/routes/arr/[id]/library/components/LibraryActionBar.svelte`: open action uses resolved base.
- `src/routes/arr/views/CardView.svelte`: open action uses resolved base.
- `src/routes/arr/views/TableView.svelte`: open action uses resolved base.

#### Configuration

- No new env vars required.
- No external secrets required.

## UX Considerations

### User Workflows

#### Primary Workflow: Configure External URL

1. User opens Arr settings for a configured instance.
2. User enters optional `External URL` below canonical `URL` and saves.
3. User visits library/list views and clicks "Open in".
4. System opens resolved URL based on `external_url || url`.

#### Error Recovery Workflow

1. User enters invalid `external_url` format.
2. Form save fails with field-specific error text.
3. User corrects value or clears field.
4. Save succeeds and link behavior updates.

### UI Patterns

| Component              | Pattern                        | Notes                                |
| ---------------------- | ------------------------------ | ------------------------------------ |
| Instance form          | Optional secondary URL field   | Label clarifies "Open in links only" |
| Action-bar open button | Uses resolved browser base URL | New tab with safe window features    |
| Row-level open links   | Same resolver as action-bar    | Keep app-specific path logic intact  |

### Accessibility Requirements

- Explicit label for `External URL (optional)`.
- Validation errors linked with `aria-describedby`.
- Icon/open buttons retain descriptive accessible names.
- Keyboard and screen-reader flow unchanged from existing form/link patterns.

### Performance UX

- No additional network calls for link resolution.
- Behavior is deterministic and immediate after save + reload.
- No loading-state changes beyond existing save flow.

## Recommendations

### Implementation Approach

Recommended strategy is a minimal-schema extension plus centralized browser-link resolver. Keep strict separation of responsibilities: backend communication uses `url`, frontend open links use resolved browser base. Implement in phases to preserve low regression risk and allow scoped validation across all Arr surfaces.

### Technology Decisions

| Decision         | Recommendation                                            | Rationale                                                          |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------ |
| Storage location | Add `external_url` to `arr_instances`                     | Minimal join overhead; naturally co-located with instance metadata |
| URL resolution   | `external_url                                             |                                                                    | url` in shared helper/expression | Deterministic, backward compatible, easy to test |
| Validation       | Optional absolute `http(s)` validation for `external_url` | Prevent malformed links while keeping field optional               |
| Client behavior  | Keep Arr clients on `url` only                            | Avoid breaking internal Docker service-name connectivity           |

### Quick Wins

- Add helper text under the new field: "Used for Open in links; API calls still use URL."
- Normalize empty `external_url` to NULL in one place in query layer.
- Add focused tests for add/edit/clear behavior before broad UI changes.

### Future Enhancements

- Extend same resolver to any future "Open in" surfaces beyond library/list if new pages are added.
- Optional non-blocking reachability hint in browser context.
- Optional autofill suggestion from Arr host config `applicationUrl` in a follow-up.

## Risk Assessment

### Technical Risks

| Risk                                             | Likelihood | Impact | Mitigation                                                                          |
| ------------------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------------------- |
| Backend accidentally starts using `external_url` | Low        | High   | Keep API client paths untouched; add regression tests asserting canonical URL usage |
| Inconsistent link behavior across pages          | Medium     | Medium | Centralize resolver and patch all in-scope "Open in" entry points                   |
| Malformed External URL stored                    | Medium     | Medium | Validate optional field on create/update and reject invalid values                  |
| Reverse-proxy subpath breaks deep links          | Medium     | Medium | Use URL API path composition and preserve existing app-specific path builders       |

### Integration Challenges

- Migration ordering must be correct for existing DBs.
- Form and hidden-save payload must stay in sync in Svelte component.
- Arr-specific path generation differs by app; only swap base URL, not path templates.

### Security Considerations

- Continue opening links with safe browser options (`noopener,noreferrer`).
- Validate allowed schemes (`http` and `https`) to reduce unsafe link targets.
- Do not log sensitive values (API keys), keep URL logging minimal and context-only.

## Task Breakdown Preview

### Phase 1: Data Contract

**Focus**: Add persistence support without changing link behavior.
**Tasks**:

- Add DB migration and schema doc update.
- Extend Arr query types and create/update inputs.
- Add unit tests for persistence semantics.
  **Parallelization**: migration/schema and query typing can proceed in parallel, then integrate.

### Phase 2: Settings and Actions

**Focus**: Expose optional field and wire server actions.
**Dependencies**: Phase 1 complete.
**Tasks**:

- Add `External URL` input to `InstanceForm` and hidden submit payload.
- Update create/edit server actions for parse/validation/persist.
- Add tests for add/edit/clear flows.

### Phase 3: Link Surface Adoption

**Focus**: Apply resolver to all in-scope "Open in" links.
**Dependencies**: Phase 2 complete.
**Tasks**:

- Update library action bar and row links.
- Update Arr card/table "Open in" links.
- Add regression tests for fallback and override behavior.

## Decisions Needed

1. **Scope boundary for first implementation**

- Options: `library only`, `library + list views`.
- Impact: broader scope yields behavior consistency now; narrower scope reduces immediate risk.
- Recommendation: `library + list views` in same change to avoid user confusion from mixed behavior.

2. **Validation strictness for `external_url`**

- Options: syntax-only URL validation, or syntax + reachability checks.
- Impact: reachability checks can produce false negatives across network contexts.
- Recommendation: syntax-only in v1, with clear UI guidance.

3. **HostConfig seeding**

- Options: manual-only entry, optional autofill from Arr `applicationUrl` later.
- Impact: autofill adds complexity and Arr-specific behavior.
- Recommendation: manual entry for v1, evaluate telemetry/feedback for autofill follow-up.

## Research References

- [research-external.md](./research-external.md): external API and integration behavior.
- [research-business.md](./research-business.md): user stories, business rules, success criteria.
- [research-technical.md](./research-technical.md): architecture and file-level impact analysis.
- [research-ux.md](./research-ux.md): workflows, accessibility, and interaction guidance.
- [research-recommendations.md](./research-recommendations.md): phased strategy, tradeoffs, and mitigations.
