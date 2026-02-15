# Feature Spec: Enhance Lidarr Support

## Executive Summary

This feature removes the current Sonarr-backed reuse strategy for Lidarr media-management and introduces first-class Lidarr entities: `lidarr_naming`, `lidarr_media_settings`, and `lidarr_quality_definitions`. It matters because current behavior mixes domain models, causes confusing UX, and creates repeated sync/mapping warnings instead of true Lidarr-native behavior. The implementation adds dedicated schema and entity operations, updates API import/export and route wiring, and changes sync resolution to consume Lidarr entities directly. The largest challenge is deterministic migration of legacy reused records while preserving sync references and avoiding collisions. A staged rollout with strict validation, idempotent migration, and focused regression tests is the recommended path.

## External Dependencies

### APIs and Services

#### Lidarr REST API v1

- **Documentation**: <https://lidarr.audio/docs/api/>
- **OpenAPI**: <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json>
- **Authentication**: `X-Api-Key` header (query `apikey` also supported)
- **Key Endpoints**:
  - `GET /api/v1/config/naming`: read naming config
  - `PUT /api/v1/config/naming/{id}`: update naming config
  - `GET /api/v1/config/mediamanagement`: read media settings
  - `PUT /api/v1/config/mediamanagement/{id}`: update media settings
  - `GET /api/v1/qualitydefinition`: list quality definitions
  - `PUT /api/v1/qualitydefinition/update`: bulk quality-definition update
  - `POST /api/v1/command`: start reconciliation commands
- **Rate Limits**: no explicit documented limits
- **Pricing**: self-hosted OSS (GPLv3)

### Libraries and SDKs

| Library                                | Version      | Purpose                                                      | Installation                                           |
| -------------------------------------- | ------------ | ------------------------------------------------------------ | ------------------------------------------------------ |
| OpenAPI Generator (`typescript-fetch`) | latest       | Generate typed Lidarr client contracts from official OpenAPI | `npx @openapitools/openapi-generator-cli generate ...` |
| Existing internal Deno HTTP stack      | current repo | Keep API calls consistent with current server patterns       | existing dependency set                                |

### External Documentation

- [Issue 130](https://github.com/yandy-r/profilarr/issues/130): scope, acceptance criteria, migration requirements
- [Lidarr OpenAPI](https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json): authoritative endpoint contract

## Business Requirements

### User Stories

**Primary User: Lidarr Operator**

- As a Lidarr operator, I want media-management presets persisted as first-class Lidarr entities so music workflows are not constrained by Sonarr reuse behavior.
- As a Lidarr operator, I want sync to resolve dedicated Lidarr config names so I can trust behavior and logs.

**Secondary User: API/Automation User**

- As an API user, I want import/export to include `lidarr_*` entities so backups and portability are deterministic.
- As an administrator, I want migration outcomes (migrated/skipped/conflicted) to be explicit and repeatable.

### Business Rules

1. **First-Class Lidarr Storage**: default Lidarr CRUD/list/get paths must use dedicated `lidarr_*` entities.
   - Validation: all Lidarr route/server operations resolve to `lidarr_*` tables.
   - Exception: temporary read-compatibility for migration window only.
2. **Deterministic Migration**: migration must be idempotent and collision-aware.
   - Validation: reruns produce stable results and no duplicate inserts.
3. **Sync Correctness**: sync resolution must consume Lidarr-native entities.
   - Validation: no default dependency on Sonarr reuse behavior/log paths.
4. **Contract Parity**: API/docs/runtime must agree on supported Lidarr entity families.
   - Validation: OpenAPI + portable types + runtime serializers all include `lidarr_*`.

### Edge Cases

| Scenario                                                                      | Expected Behavior                                                                   | Notes                             |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------- |
| Legacy Sonarr-backed Lidarr config exists with same name as new Lidarr config | Deterministic conflict policy applies (skip/rename/report based on migration rules) | Must be idempotent                |
| Missing Lidarr quality mappings                                               | Write/sync blocked with explicit actionable error                                   | No silent fallback                |
| Migration rerun after partial completion                                      | Already migrated rows remain unchanged                                              | Report-only for completed records |

### Success Criteria

- [ ] Lidarr media-management CRUD/list/read no longer defaults to Sonarr-backed entities.
- [ ] `lidarr_naming`, `lidarr_media_settings`, `lidarr_quality_definitions` are represented in schema/registry/API contracts.
- [ ] Sync path resolves dedicated Lidarr configs and removes default reuse dependency.
- [ ] Migration is deterministic, idempotent, and produces explicit operator-facing results.
- [ ] Regression tests cover CRUD, import/export, sync, and migration rerun behavior.

## Technical Specifications

### Architecture Overview

```text
Media Management Routes
    -> Lidarr Entity Operations (CRUD/List/Get)
        -> PCD DB Tables (lidarr_*) + quality_api_mappings(lidarr)
            -> Sync Resolver (arr_sync_media_management)
                -> Lidarr API v1 (config + qualitydefinition + command)
```

### Data Models

#### `lidarr_naming`

| Field         | Type          | Constraints          | Description                     |
| ------------- | ------------- | -------------------- | ------------------------------- |
| name          | text          | PK                   | config key scoped to DB         |
| naming fields | table-defined | NOT NULL as required | Lidarr naming behavior settings |

#### `lidarr_media_settings`

| Field        | Type          | Constraints            | Description                       |
| ------------ | ------------- | ---------------------- | --------------------------------- |
| name         | text          | PK                     | config key scoped to DB           |
| media fields | table-defined | validation constraints | media import/rename/move settings |

#### `lidarr_quality_definitions`

| Field   | Type      | Constraints                | Description                         |
| ------- | --------- | -------------------------- | ----------------------------------- |
| name    | text      | PK                         | config key scoped to DB             |
| entries | json/text | validated against mappings | ordered quality definitions payload |

#### `quality_api_mappings` additions

| Field               | Type            | Constraints               | Description                   |
| ------------------- | --------------- | ------------------------- | ----------------------------- |
| arr_type            | text            | include `lidarr`          | arr-family scope for mappings |
| quality_id/api_name | existing schema | unique/indexed per schema | endpoint mapping resolution   |

### API Design

#### `POST /api/v1/pcd/import`

**Purpose**: import PCD entities including first-class `lidarr_*` media-management types.

**Request**:

```json
{
  "entities": [
    {
      "type": "lidarr_naming",
      "name": "music-default",
      "payload": {}
    }
  ]
}
```

**Response (200)**:

```json
{
  "imported": 1,
  "skipped": 0,
  "errors": []
}
```

#### `GET /api/v1/pcd/export`

**Purpose**: export PCD entities including `lidarr_*` with deterministic typing metadata.

### System Integration

#### Files to Create

- `src/lib/server/db/migrations/*`: migration for `lidarr_*` tables and mapping seed updates.

#### Files to Modify

- `docs/pcdReference/0.schema.sql`: add first-class Lidarr media-management tables and mapping coverage.
- `src/lib/server/pcd/entities/mediaManagement/**`: add/use dedicated Lidarr operations and remove default reuse branches.
- `src/lib/server/sync/mediaManagement/syncer.ts`: resolve Lidarr from dedicated entities.
- `src/lib/shared/pcd/portable.ts`: include first-class Lidarr entity types.
- `docs/api/v1/schemas/pcd.yaml`: document `lidarr_*` portable contracts.
- `src/routes/media-management/[databaseId]/**/+page.server.ts`: route actions call dedicated Lidarr handlers.

## UX Considerations

### User Workflows

#### Primary Workflow: Native Lidarr Preset Lifecycle

1. User navigates to media-management section, filters by Lidarr, and creates/edits preset.
2. System validates input and persists to first-class `lidarr_*` storage.
3. User sees confirmation with config name and entity family.

#### Error Recovery Workflow

1. Error occurs due to mapping gaps, validation failures, or migration collision.
2. User sees clear inline summary and field-specific guidance.
3. Recovery is explicit: fix input/mapping, retry, or resolve migration conflict action.

### UI Patterns

| Component        | Pattern                             | Notes                                                           |
| ---------------- | ----------------------------------- | --------------------------------------------------------------- |
| List rows        | Status badges                       | Show `Native Lidarr` vs `Legacy Sonarr-backed` during migration |
| Detail/Edit page | Migration banner + CTA              | Explicit conversion path for legacy rows                        |
| Forms            | Inline error summary + field errors | Reduce dependence on transient toasts                           |

### Accessibility Requirements

- Provide live-region announcements for async save/sync/migration states.
- Keep errors non-color-only and move focus to error summary after failed submit.
- Preserve accessible modal and tab keyboard behavior in existing patterns.

### Performance UX

- **Loading States**: action-level loading labels and section placeholders.
- **Optimistic Updates**: avoid optimistic persistence for migration operations; use confirmed responses.
- **Error Feedback**: persistent, actionable messages with deterministic next steps.

## Recommendations

### Implementation Approach

**Recommended Strategy**: staged cutover with immediate write-target migration to `lidarr_*`, temporary legacy read compatibility, and strict deprecation gates.

1. **Phase 1 - Foundation**: schema/types/contracts/mapping seeds + migration scaffolding.
2. **Phase 2 - Cutover**: CRUD/API/UI/sync updated to first-class Lidarr entities.
3. **Phase 3 - Cleanup**: compatibility removal, docs finalization, and regression hardening.

### Technology Decisions

| Decision               | Recommendation                                            | Rationale                           |
| ---------------------- | --------------------------------------------------------- | ----------------------------------- |
| Migration scope        | Start with copy-all + deterministic conflict handling     | safest for preserving operator data |
| Data model shape       | Maintain parity first, then evolve Lidarr-specific fields | lowers migration complexity         |
| Command reconciliation | Operator-triggered initially                              | limits unintended side effects      |

### Quick Wins

- Fix Lidarr nested-route parity in media-management layout behavior.
- Align OpenAPI schema with runtime portable entity support for `lidarr_*`.
- Add fail-fast checks for missing `lidarr_*` schema capability.

### Future Enhancements

- Introduce fully Lidarr-native naming payloads where Sonarr parity is currently retained.
- Add migration telemetry/reporting surfaces.

## Risk Assessment

### Technical Risks

| Risk                                   | Likelihood | Impact | Mitigation                                           |
| -------------------------------------- | ---------- | ------ | ---------------------------------------------------- |
| Migration collisions/duplicates        | Medium     | High   | deterministic policy + idempotent reruns + reporting |
| Sync behavior drift                    | Medium     | High   | targeted sync regression tests + staged rollout      |
| Contract mismatch between docs/runtime | Medium     | Medium | update OpenAPI + portable types + tests together     |
| Mapping incompleteness for Lidarr      | High       | High   | seed/validate `quality_api_mappings` before cutover  |

### Integration Challenges

- Coordinating schema, runtime entity registry, sync logic, and route actions in one migration window.
- Preserving existing user configs while eliminating default Sonarr reuse behavior.

### Security Considerations

- Continue enforcing existing write-layer permission checks.
- Avoid query-string API keys in operational integrations when possible.
- Fail fast on invalid cross-entity payloads instead of silent fallback paths.

## Task Breakdown Preview

### Phase 1: Data Foundation

**Focus**: schema and contracts.
**Tasks**:

- Add `lidarr_*` tables and `quality_api_mappings` coverage.
- Register new entity families in portable/runtime maps.
- Build idempotent migration with deterministic conflict strategy.

### Phase 2: Product and Sync Cutover

**Focus**: behavior switch.
**Dependencies**: Phase 1 complete.
**Tasks**:

- Route CRUD/list/get actions to dedicated Lidarr operations.
- Update sync resolver and rename propagation to use first-class Lidarr identities.
- Update import/export handlers and schemas.

### Phase 3: Hardening

**Focus**: validation and cleanup.
**Tasks**:

- Add/expand regression tests (CRUD/sync/import-export/migration).
- Remove compatibility branches and reuse-specific messaging.
- Finalize docs and operator migration guidance.

## Decisions Needed

1. **Migration Coverage**
   - Options: `copy-all legacy rows`, `only sync-referenced rows`
   - Impact: data preservation vs migration complexity/time
   - Recommendation: copy-all with deterministic conflict reporting
2. **Model Evolution Timing**
   - Options: `parity-first`, `native-fields-now`
   - Impact: delivery risk vs long-term domain correctness speed
   - Recommendation: parity-first in this initiative, native-field expansion follow-up
3. **Post-Migration Commands**
   - Options: `operator-triggered`, `auto-run`
   - Impact: operational safety vs convenience
   - Recommendation: operator-triggered initially

## Research References

- [research-external.md](./research-external.md): external API and integration constraints
- [research-business.md](./research-business.md): business rules, workflows, and success criteria
- [research-technical.md](./research-technical.md): architecture/data/API/file impact
- [research-ux.md](./research-ux.md): UX/accessibility/workflow guidance
- [research-recommendations.md](./research-recommendations.md): phased strategy and risk mitigation
