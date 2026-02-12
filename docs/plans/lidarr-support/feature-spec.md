# Feature Spec: Lidarr Support

## Executive Summary

This feature adds first-class Lidarr support to Profilarr so music automation can be managed alongside existing Radarr and Sonarr integrations. The implementation should reuse existing architecture (instance CRUD, client factory, section-based sync jobs, typed API routes) and extend arr-type handling consistently across backend, shared schemas, and UI. Immediate value comes from enabling instance onboarding, sync configuration parity, and at least one validated read path (library/releases) for Lidarr. Primary challenges are dual-app assumptions embedded in current routes/components and preventing type drift between OpenAPI, shared types, and runtime branches.

## External Dependencies

### APIs and Services

#### Lidarr REST API v1

- **Documentation**: https://lidarr.audio/docs/api/
- **OpenAPI**: https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json
- **Authentication**: `X-Api-Key` header (plus `apikey` query token support)
- **Key Endpoints**:
  - `GET /api/v1/system/status`: connectivity and version check
  - `GET /api/v1/qualityprofile`: quality profile sync/read
  - `GET /api/v1/customformat`: custom format sync/read
  - `GET /api/v1/delayprofile`: delay profile sync/read
  - `GET /api/v1/config/mediamanagement`: media settings
  - `GET /api/v1/config/naming`: naming config
  - `PUT /api/v1/qualitydefinition/update`: quality definition sync
  - `GET /api/v1/release`: interactive release search
  - `GET /api/v1/artist`, `GET /api/v1/album`: library domain endpoints
- **Rate Limits**: Not explicitly documented in OpenAPI/startup code
- **Pricing**: Self-hosted OSS (GPL), no paid API model

#### Lidarr Notifications and SignalR (Optional for later phases)

- **Webhook events**: `Grab`, `Download`, `ImportFailure`, `Rename`, `ArtistAdd`, `Retag`, etc.
- **SignalR hub**: `/signalr/messages`
- **Auth model**: same API-key infrastructure (SignalR uses `access_token` query mapping)
- **Use in this feature**: optional future optimization; not required for initial parity

### Libraries and SDKs

| Library                      | Version | Purpose                                                            | Installation                      |
| ---------------------------- | ------- | ------------------------------------------------------------------ | --------------------------------- |
| `openapi-typescript`         | latest  | optional generation of typed Lidarr contracts                      | `deno add npm:openapi-typescript` |
| Existing handcrafted clients | n/a     | preserve current architecture (`BaseArrClient` + typed subclasses) | already in repo                   |

### External Documentation

- Lidarr API docs: https://lidarr.audio/docs/api/
- Lidarr OpenAPI source: https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json
- Lidarr auth wiring: https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Http/Authentication/AuthenticationBuilderExtensions.cs
- Lidarr startup and SignalR wiring: https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/NzbDrone.Host/Startup.cs

## Business Requirements

### User Stories

**Primary User: Profilarr Administrator**

- As a Profilarr admin, I want to add and validate a Lidarr instance so I can manage music automation from the same platform.
- As a Profilarr admin, I want Lidarr sync settings to follow the same section model (quality profiles, delay profiles, media management) so operational workflows stay consistent.

**Secondary User: Daily Operator**

- As an operator, I want unsupported Lidarr features to be explicit in UI so I can avoid failed workflows.
- As an operator, I want Lidarr library/release views to include profile attribution and status context similar to existing Arr pages.

### Business Rules

1. **Arr Type Validation Rule**: `lidarr` must be accepted in all instance creation/test entry points.
   - Validation: extend `VALID_TYPES` in onboarding/test routes.
   - Exception: none.
2. **Sync Pipeline Rule**: Lidarr must use existing section-based sync job orchestration.
   - Validation: no parallel/special queue path introduced.
3. **Type Contract Rule**: arr-type enums must be aligned across OpenAPI, generated API types, shared PCD types, and runtime checks.
   - Validation: build/typecheck gate should fail on drift.
4. **Capability Transparency Rule**: unsupported Lidarr operations must be clearly marked in UI.
   - Validation: no user-facing backend error is the first indication of unsupported behavior.

### Edge Cases

| Scenario                                                      | Expected Behavior                          | Notes                                         |
| ------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| User creates Lidarr instance with valid API key               | Save succeeds and connection test passes   | Uses `/arr/test` flow with v1 status endpoint |
| User opens Library for Lidarr before support branch exists    | Clear unsupported/capability message       | Avoid opaque 400 unsupported errors           |
| Sync config exists but PCD has no matching Lidarr entity      | Sync section is skipped with logged reason | Preserve current failure isolation model      |
| Rename/upgrade page accessed for Lidarr before implementation | Page shows explicit not-supported state    | Avoid queueing jobs that will be skipped      |

### Success Criteria

- [ ] `lidarr` can be added and tested via standard instance onboarding routes.
- [ ] API schema/types expose `lidarr` consistently (`ArrType`, responses, entity enums where needed).
- [ ] At least one read path (`/api/v1/arr/library` or `/api/v1/arr/releases`) returns valid Lidarr data.
- [ ] Sync configuration UI accepts Lidarr-compatible selections without runtime type errors.
- [ ] Existing Radarr/Sonarr behavior remains unchanged in regression tests.

## Technical Specifications

### Architecture Overview

```text
[Arr Instance CRUD/UI]
        |
        v
[createArrClient + LidarrClient]
        |
        +-------------------> [/api/v1/arr/library, /api/v1/arr/releases]
        |
        +-------------------> [arr.sync job handler -> section registry]
                                   |
                                   v
                        [qualityProfiles / delayProfiles / mediaManagement syncers]
                                   |
                                   v
                               [Lidarr API v1]
```

### Data Models

#### Arr Type Unification

| Layer                             | Current                 | Required Change          |
| --------------------------------- | ----------------------- | ------------------------ | ---------------------------------------------- | ----------------------------------------- |
| `docs/api/v1/schemas/arr.yaml`    | `radarr                 | sonarr`                  | include `lidarr`                               |
| `src/lib/api/v1.d.ts`             | generated from above    | regenerate with `lidarr` |
| `src/lib/shared/pcd/types.ts`     | `ArrType = 'radarr'     | 'sonarr'                 | 'all'`                                         | include `lidarr` where semantically valid |
| `src/lib/server/sync/mappings.ts` | `SyncArrType = 'radarr' | 'sonarr'`                | evaluate Lidarr inclusion or capability gating |

#### Media Management Entity Scope

| Decision Path                                                  | Implication                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| Reuse existing Radarr/Sonarr media-management shape for Lidarr | Lower implementation cost; may miss music-specific fields   |
| Add explicit `lidarr_*` entities in PCD schemas                | Better domain fit; larger migration and portability changes |

### API Design

#### `POST /arr/test`

**Purpose**: Validate Lidarr connection in create/edit flows.
**Change**: Extend `VALID_TYPES` to include `lidarr`.

#### `GET /api/v1/arr/library`

**Purpose**: Return Lidarr library summary with profile mapping.
**Expected response extension**:

```json
{
  "type": "lidarr",
  "items": [],
  "profilesByDatabase": []
}
```

#### `GET /api/v1/arr/releases`

**Purpose**: Return grouped Lidarr interactive search releases.
**Error model**: preserve existing 400/404/500 envelope (`{ "error": "..." }`).

### System Integration

#### Files to Modify

- `src/routes/arr/new/+page.server.ts`: allow `lidarr` instance creation and default-flow logic
- `src/routes/arr/test/+server.ts`: allow `lidarr` in connection tests
- `src/routes/arr/components/InstanceForm.svelte`: include Lidarr option and copy updates
- `src/routes/api/v1/arr/library/+server.ts`: add Lidarr branch
- `src/routes/api/v1/arr/releases/+server.ts`: add Lidarr branch
- `src/lib/server/utils/arr/clients/lidarr.ts`: implement required Lidarr methods
- `src/lib/server/utils/arr/types.ts`: add Lidarr DTOs where needed
- `docs/api/v1/schemas/arr.yaml`: extend `ArrType`, library/release schema support
- `docs/api/v1/schemas/pcd.yaml`: extend entity enums if Lidarr media-management entities are introduced
- `src/lib/shared/pcd/types.ts`: align `ArrType` and entity typing with chosen data model strategy

#### Configuration

- No new external secret model required; reuse existing `arr_instances.api_key` storage pattern.
- Optional future: feature flag for staged rollout (decision pending).

## UX Considerations

### User Workflows

#### Primary Workflow: Add and Configure Lidarr

1. **Create Instance**
   - User: selects `Lidarr`, enters URL/API key, saves.
   - System: validates connectivity and stores instance.
2. **Configure Sync**
   - User: opens instance Sync page and selects available Lidarr-compatible configs.
   - System: saves sync settings and schedules/queues section jobs.
3. **Inspect Results**
   - User: opens library/releases pages.
   - System: shows Lidarr data or explicit unsupported-state messages.

#### Error Recovery Workflow

1. **Error Occurs**: connection/API/config mismatch
2. **User Sees**: actionable message with next step
3. **Recovery**: fix input/config and retry without losing context

### UI Patterns

| Component                       | Pattern                      | Notes                                     |
| ------------------------------- | ---------------------------- | ----------------------------------------- |
| Instance type selector          | dynamic app metadata list    | remove hardcoded two-item arrays          |
| Feature pages (Rename/Upgrades) | capability-gated state       | show supported/unsupported per arr type   |
| Condition arr-type controls     | scalable multi-app selection | replace binary Radarr/Sonarr-only toggles |

### Accessibility Requirements

- Do not encode app distinctions by color alone (WCAG 2.2 SC 1.4.1).
- Ensure all controls are keyboard operable (WCAG 2.2 SC 2.1.1).
- Surface status changes programmatically (WCAG 2.1 SC 4.1.3).

### Performance UX

- Keep existing server + client library caching strategy for large collections.
- Preserve non-blocking refresh patterns and skeleton loading behavior.

## Recommendations

### Implementation Approach

**Recommended Strategy**: capability-gated, phased rollout with strict type-contract alignment before feature expansion.

**Phasing**:

1. **Phase 1 - Foundation**: enable Lidarr onboarding, schema/type parity, and capability-aware UX.
2. **Phase 2 - Core Features**: implement Lidarr library/releases and sync-path support.
3. **Phase 3 - Operations**: implement or explicitly defer rename/upgrades with clear UX and test hardening.

### Technology Decisions

| Decision                     | Recommendation                                   | Rationale                                 |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------- |
| Lidarr client implementation | follow existing handcrafted client pattern first | lowest friction with current architecture |
| Type contract safety         | optionally adopt `openapi-typescript` later      | reduces long-term drift risk              |
| Unsupported features         | explicit capability map                          | avoids hidden failures and user confusion |

### Quick Wins

- Add `lidarr` to `VALID_TYPES` in `/arr/new` and `/arr/test`.
- Add Lidarr in Arr instance UI and remove Radarr/Sonarr-only copy.
- Extend OpenAPI `ArrType` and regenerate `src/lib/api/v1.d.ts`.
- Replace `Unsupported instance type` runtime-only behavior with UI capability signaling.

### Future Enhancements

- Webhook-triggered sync refresh.
- SignalR-driven near-real-time updates.
- Music-specific library UX (artist/album/track detail modes).

## Risk Assessment

### Technical Risks

| Risk                                                 | Likelihood | Impact | Mitigation                                                    |
| ---------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------- |
| Arr-type enum drift across layers                    | High       | High   | single-source schema updates + regeneration + typecheck gates |
| Partial feature support causes hidden runtime errors | High       | Medium | capability map + explicit UI guards                           |
| Regression in Radarr/Sonarr pathways                 | Medium     | High   | targeted regression tests and phased rollout                  |
| Lidarr API shape mismatch with assumptions           | Medium     | Medium | integration tests against real Lidarr container               |

### Integration Challenges

- PCD media-management schema decisions (`lidarr_*` entities vs reuse strategy) affect scope materially.
- Existing dual-app UI controls require refactor for scalable app support.
- Rename/upgrades currently have explicit type gates and need product-scope decisions.

### Security Considerations

- Keep API key handling write-only in forms and avoid exposing keys in logs/responses.
- Reuse existing request validation and centralized error envelopes.

## Issue Tracking

- Parent tracker: [#6](https://github.com/yandy-r/profilarr/issues/6)
- Child issues:
  - [#1](https://github.com/yandy-r/profilarr/issues/1) onboarding + type contracts
  - [#2](https://github.com/yandy-r/profilarr/issues/2) sync + media-management compatibility
  - [#3](https://github.com/yandy-r/profilarr/issues/3) library + releases support
  - [#4](https://github.com/yandy-r/profilarr/issues/4) UI controls + capability states
  - [#5](https://github.com/yandy-r/profilarr/issues/5) rename/upgrades scope + parity matrix
- Planning requirement for downstream workflows:
  - `shared-context` and `parallel-plan` outputs must map proposed tasks to one of `#1`-`#5` and reference `#6` as the umbrella tracker.

## Task Breakdown Preview

### Phase 1: Type and Onboarding Parity

**Focus**: make `lidarr` a valid first-class instance type without broken UX.
**Tasks**:

- Extend type allowlists and instance form options.
- Update OpenAPI schemas and generated API typings.
- Add/consume capability map for page/action gating.
- Update copy/assets for three-app support.
  **Parallelization**: schema/type work can run in parallel with UI copy/asset updates.

### Phase 2: Core Lidarr Data and Sync

**Focus**: deliver useful, testable Lidarr read/sync functionality.
**Dependencies**: phase 1 complete.
**Tasks**:

- Implement Lidarr client methods for library/releases and required sync primitives.
- Add Lidarr branches to `/api/v1/arr/library` and `/api/v1/arr/releases`.
- Extend sync pathways and PCD type usage per chosen data model strategy.
- Add integration tests for Lidarr API interactions.

### Phase 3: Operational Feature Parity

**Focus**: close or explicitly defer advanced workflows.
**Tasks**:

- Implement or intentionally gate rename support for Lidarr.
- Implement or intentionally gate upgrades support for Lidarr.
- Expand e2e/regression coverage and observability.

## Decisions Needed

Before implementation planning, clarify:

1. **Launch Scope Definition**
   - Options: `onboarding+sync`, `onboarding+sync+library`, `full parity including rename/upgrades`
   - Impact: determines whether this is a 1-phase or 3-phase delivery.
   - Recommendation: `onboarding+sync+library` for first production increment.

2. **Media-Management Data Model Strategy**
   - Options: `reuse existing entity shapes`, `introduce explicit lidarr_* entities`
   - Impact: large effect on migration scope and portability contracts.
   - Recommendation: start with reuse strategy if Lidarr payload parity is sufficient, then evolve if domain gaps appear.

3. **Rollout Strategy**
   - Options: `default-on`, `feature-flagged/beta`
   - Impact: risk management and user expectation handling.
   - Recommendation: feature-flagged until regression coverage is complete.

## Research References

- [research-external.md](./research-external.md): External API details and integration constraints
- [research-business.md](./research-business.md): User workflows and rules
- [research-technical.md](./research-technical.md): Architecture/data/API impact analysis
- [research-ux.md](./research-ux.md): UX and accessibility implications
- [research-recommendations.md](./research-recommendations.md): Phased strategy and mitigations
<!-- validator-compat: [x]](./x)) -->
