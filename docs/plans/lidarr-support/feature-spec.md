# Feature Spec: Lidarr Support for Praxrr DB

## Executive Summary

This feature adds first-class `lidarr` support to `praxrr-db` so `yandy-r/praxrr` can consume and
manage music-focused configurations alongside existing `radarr` and `sonarr` data. The
implementation is SQL-first and should remain additive: update manifest metadata, seed
Lidarr-compatible mappings/profiles/custom-format conditions, and preserve existing query contracts.
The most important design choice is v1 scope: either compatibility-first with shared `arr_type`
rows, or immediate expansion into deeper Lidarr-specific metadata/release-profile modeling. Main
risks are semantic mismatch between video and music quality models, consumer version skew, and
incomplete mapping coverage.

## External Dependencies

### APIs and Services

#### Lidarr REST API v1

- **Documentation**: [Lidarr API docs](https://lidarr.audio/docs/api/),
  [OpenAPI source](https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json)
- **Authentication**: API key via `X-Api-Key` header (preferred) or `apikey` query parameter
- **Key Endpoints**:
  - `GET /api/v1/qualityprofile`: list quality profiles
  - `GET /api/v1/customformat`: list custom formats
  - `GET /api/v1/qualitydefinition`: list quality definitions
  - `GET /api/v1/metadataprofile`: list metadata profiles
  - `GET /api/v1/releaseprofile`: list release profiles
  - `POST /api/v1/command`: run asynchronous operations
- **Rate Limits**: No explicit first-party documented quota; apply client-side throttling/backoff
- **Pricing**: Self-hosted OSS, no API fee

#### Lidarr SignalR Messages Hub (optional)

- **Documentation**:
  [Startup wiring](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Host/Startup.cs),
  [Message hub](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.SignalR/MessageHub.cs)
- **Authentication**: API-key based auth policy
- **Capability**: near-real-time command/resource updates for reconciliation

### Libraries and SDKs

| Library                               | Version       | Purpose                                | Installation                                             |
| ------------------------------------- | ------------- | -------------------------------------- | -------------------------------------------------------- |
| `@openapitools/openapi-generator-cli` | latest        | Generate typed Lidarr client contracts | `npm i -D @openapitools/openapi-generator-cli`           |
| `typescript-fetch` generator          | latest        | TypeScript API client output target    | via OpenAPI Generator                                    |
| `Microsoft.AspNetCore.SignalR.Client` | latest stable | Optional realtime event subscription   | `dotnet add package Microsoft.AspNetCore.SignalR.Client` |

### External Documentation

- [Lidarr Settings (Servarr wiki)](https://wiki.servarr.com/lidarr/settings): operational semantics
  for quality, metadata, and release profile behavior.
- [OpenAPI Generator docs](https://openapi-generator.tech/docs/usage/): generation workflow for
  typed clients.
- [Lidarr OpenAPI JSON](https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json):
  canonical schema reference.

## Business Requirements

### User Stories

**Primary User: Praxrr Administrator**

- As a Praxrr administrator, I want `praxrr-db` to publish Lidarr-ready data so I can manage music
  workflows from the same profile-driven process used for Radarr/Sonarr.
- As a Praxrr administrator, I want clear validation when Lidarr rows are incomplete or incompatible
  so bad configurations do not reach production instances.

**Secondary User: Music Curator**

- As a music curator, I want music-aware quality and custom-format behavior so Lidarr acquisition
  reflects artist/album expectations.

### Business Rules

1. **Arr Type Isolation**: Lidarr records must be explicitly scoped and not mixed with video-only
   semantics.
   - Validation: reject rows that claim `arr_type='lidarr'` but reference unsupported
     quality/mapping semantics.
   - Exception: temporary compatibility rows are allowed only when documented and gated by consumer
     version.
2. **Idempotent Publication**: Lidarr operations must be additive and safe to replay.
   - Validation: enforce `NOT EXISTS`/restrictive predicates in new SQL ops.
3. **Minimum Complete Set**: a published Lidarr profile set must include profile, conditions, and
   quality mapping compatibility.
   - Validation: fail release checks if minimum set is not present.

### Edge Cases

| Scenario                                                   | Expected Behavior                                    | Notes                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| Praxrr consumer is older and does not support lidarr rows  | Block rollout using version gate and release notes   | Coordinate with `praxrr.minimum_version` in `pcd.json` |
| Lidarr quality names do not map to existing DB conventions | Mark unsupported and skip with explicit error/report | Do not coerce silently                                 |
| Partial migration applied                                  | Re-running operations should converge safely         | Require idempotent SQL                                 |
| Upstream Lidarr API schema drift                           | Regenerate mappings/client types and re-validate     | Pin OpenAPI source revision where possible             |

### Success Criteria

- [ ] `pcd.json` includes `lidarr` in supported arr types and release compatibility notes.
- [ ] At least one end-to-end Lidarr profile dataset is consumable by Praxrr without breaking
      existing Radarr/Sonarr queries.
- [ ] Lidarr data insert operations are idempotent and pass replay checks.
- [ ] Rollout includes explicit v1 scope documentation and unsupported-feature disclosure.
- [ ] All blocking requirements in [`requirements.md`](./requirements.md) pass with linked
      validation evidence.

### Validation Evidence

- Task 3.1 evidence artifact: [`lidarr-validation.md`](./lidarr-validation.md)
- Current blocking requirement status from Task 3.1:
  - failing: `LID-V1-01` (manifest gate not yet applied)
  - failing: `LID-V1-08` (README rollout disclosures not yet published)
  - passing: `LID-V1-02`, `LID-V1-03`, `LID-V1-04`, `LID-V1-05`, `LID-V1-06`, `LID-V1-07`,
    `LID-V1-09`

### V1 Contract Baseline

Task 1.1 defines the implementation contract in [`requirements.md`](./requirements.md). The v1
boundary is locked to compatibility-first shared-table support for:

- quality profiles
- custom formats
- custom format conditions
- quality profile-to-custom-format score mappings
- quality definitions required by seeded Lidarr profiles

V1 explicitly excludes metadata profile and release profile seeding. Any conflict with this boundary
is a release blocker and must trigger re-planning before SQL scope changes.

## Technical Specifications

### Architecture Overview

```text
praxrr-db (SQL ops + pcd.json)
        |
        | publishes arr-typed config data
        v
praxrr consumer
  |-- loads shared profile/custom format data by arr_type
  |-- maps quality API names
  '-- applies to Arr instance APIs
                 |
                 v
               Lidarr
```

### Data Models

#### Existing Shared Arr-Type Extensions (preferred v1)

| Field                | Type    | Constraints | Description                                                               |
| -------------------- | ------- | ----------- | ------------------------------------------------------------------------- |
| arr_type             | text    | required    | Add `lidarr` discriminator where schema supports shared rows              |
| custom_format_name   | text    | required    | Existing custom format identifier reused for lidarr-scoped rows           |
| quality_profile_name | text    | required    | Existing quality profile key; lidarr coverage requires compatible mapping |
| score                | integer | required    | Custom-format score within profile                                        |

**Indexes:**

- Reuse existing indexes over arr-type/profile/custom-format join paths.

**Relationships:**

- `quality_profile_custom_formats`-style relations should remain consistent with existing
  Radarr/Sonarr query patterns.

#### App-Specific Settings Pattern (current baseline)

| Entity              | Current Evidence                                           | Lidarr Implication                                                       |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| media settings      | `radarr_media_settings`, `sonarr_media_settings`           | decide whether to add `lidarr_media_settings` or reuse consumer defaults |
| naming settings     | `radarr_naming`, `sonarr_naming`                           | evaluate if Lidarr naming requires dedicated seeded defaults             |
| quality definitions | `radarr_quality_definitions`, `sonarr_quality_definitions` | add lidarr-compatible quality mapping/definitions                        |

**Schema uncertainty:** this repository depends on external schema package
(`https://github.com/yandy-r/praxrr-schema` in `pcd.json`), so exact table-creation changes must be
validated against that dependency before choosing a `lidarr_*` table strategy.

### API Design

#### `GET /api/pcd/*` (consumer-facing, in `yandy-r/praxrr`)

**Purpose**: Return arr-scoped profile and quality data including Lidarr. **Authentication**:
existing Praxrr auth model.

**Request (conceptual):**

```json
{
  "arrType": "lidarr",
  "profileName": "default"
}
```

**Response (200, conceptual):**

```json
{
  "arrType": "lidarr",
  "qualityProfiles": [],
  "customFormats": [],
  "qualityDefinitions": []
}
```

**Errors:**

| Status | Condition                                       | Response                 |
| ------ | ----------------------------------------------- | ------------------------ |
| 400    | Unsupported arr type or invalid mapping request | Validation error payload |
| 409    | Duplicate or conflicting seeded records         | Conflict payload         |
| 500    | Migration/data integrity issue                  | Internal error payload   |

### System Integration

#### Files to Create

- `ops/<next-number>.add-lidarr-support-*.sql`: idempotent inserts for lidarr rows/mappings.

#### Files to Modify

- `pcd.json`: add `lidarr` to `arr_types`; potentially raise `praxrr.minimum_version` when required.
- `README.md`: document Lidarr support scope and compatibility expectations.

#### Configuration

- `pcd.json.praxrr.minimum_version`: release gate for Lidarr-enabled database versions.
- Mapping source pinning: maintain source reference for Lidarr OpenAPI and mapping derivation
  process.

## UX Detail

### User Workflows

#### Primary Workflow: Connect, Configure, Review, Apply

1. **Connect Lidarr**
   - User: enters Lidarr URL and API key.
   - System: validates connection and supported capabilities.
2. **Configure Profiles**
   - User: selects Lidarr template/profile set.
   - System: loads mapped data and flags unsupported items.
3. **Review and Apply**
   - User: reviews diff and confirms apply.
   - System: applies changes and reports per-item status.

#### Error Recovery Workflow

1. **Error Occurs**: mapping mismatch, validation failure, or connectivity issue.
2. **User Sees**: clear classification (`mapping`, `validation`, `connectivity`) and actionable fix
   text.
3. **Recovery**: retry failed items only, or roll back to last synced state.

### UI Patterns

| Component           | Pattern                                            | Notes                       |
| ------------------- | -------------------------------------------------- | --------------------------- |
| profile migration   | side-by-side diff table                            | highlight changed rows only |
| conflict resolution | explicit modal actions (`Merge`, `Rename`, `Skip`) | deterministic behavior      |
| progressive options | collapsed advanced section                         | keeps default flow simple   |

### Accessibility Requirements

- WCAG 2.2 contrast and focus-visible compliance for all controls and state indicators.
- Keyboard-accessible interaction for all conflict and apply flows.
- Screen-reader-friendly error summary with linked inline field errors.
- Status announcements for long-running apply/sync actions.

### Performance UX

- **Loading States**: skeleton/table placeholders with explicit progress text.
- **Optimistic Updates**: avoid optimistic apply for destructive/mapping changes; prefer explicit
  completion states.
- **Error Feedback**: classify retryable vs non-retryable errors with stable remediation actions.

## Recommendations

### Implementation Approach

**Recommended Strategy**: compatibility-first rollout with gated activation.

**Phasing:**

1. **Phase 1 - Consumer Hardening**: ensure Praxrr safely handles `arr_type='lidarr'` inputs and
   mixed-arr datasets.
2. **Phase 2 - DB Expansion**: add Lidarr arr_type metadata and idempotent SQL rows for
   mappings/profiles/conditions.
3. **Phase 3 - Default Enablement**: enable by default only when mapping coverage and regression
   criteria pass.

### Technology Decisions

| Decision                   | Recommendation                                                                                  | Rationale                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Lidarr API contract source | Use official OpenAPI JSON as source of truth                                                    | reduces drift and enables generated types |
| Data-model strategy        | Start with shared arr*type rows; add dedicated `lidarr*\*` only if required by schema semantics | minimizes immediate schema churn          |
| Event model                | REST polling first, SignalR optional                                                            | lower complexity for v1                   |
| Release strategy           | consumer-first then DB release                                                                  | avoids version skew breakages             |

### Quick Wins

- Add `lidarr` to manifest metadata when consumer compatibility lands.
- Seed a minimal valid Lidarr dataset for integration testing.
- Publish compatibility matrix for DB version vs Praxrr version.

### Future Enhancements

- Full metadata-profile and release-profile depth for Lidarr.
- Generated mapping refresh pipeline from pinned OpenAPI revisions.
- Runtime capability detection by Lidarr version.

## Risk Assessment

### Technical Risks

| Risk                                              | Likelihood | Impact | Mitigation                                                        |
| ------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------- |
| Consumer cannot parse new lidarr rows             | Medium     | High   | Ship consumer compatibility first and gate release                |
| Mapping gaps for music-specific quality semantics | High       | High   | define minimum mapping coverage and block release below threshold |
| Schema mismatch with external dependency          | Medium     | High   | validate against schema dependency before table-strategy decision |
| Replay/drift issues in SQL operations             | Low        | Medium | enforce idempotent operation patterns and replay checks           |

### Integration Challenges

- Coordinating release order between `praxrr-db` and `yandy-r/praxrr`.
- Translating Lidarr music semantics into existing profile abstractions.
- Balancing v1 scope with user expectations for full Lidarr parity.

### Security Considerations

- Treat all generated mapping and regex content as data, not executable instructions.
- Preserve existing secret-handling boundaries for API keys in consumer applications.
- Avoid introducing unvalidated user-provided values into SQL seed operations.

## Task Breakdown Preview

### Phase 1: Compatibility Foundation

**Focus**: Make consumer behavior safe for lidarr arr type data. **Tasks**:

- Audit Praxrr arr-type handling paths for Radarr/Sonarr assumptions.
- Add mixed-arr integration tests with lidarr rows.
- Define release gate criteria. **Parallelization**: test scaffolding and path audit can run
  concurrently.

### Phase 2: Database Lidarr Data Introduction

**Focus**: Publish Lidarr metadata and seed records. **Dependencies**: Phase 1 compatibility checks
complete. **Tasks**:

- Update `pcd.json` arr types/version gate.
- Add new idempotent `ops/*.sql` for lidarr mappings/profiles.
- Validate operation replay and diff scope.

### Phase 3: Rollout and Hardening

**Focus**: Production readiness and scope expansion planning. **Tasks**:

- Validate end-to-end import/apply behavior.
- Document supported and unsupported Lidarr capabilities.
- Prepare next milestone for metadata/release-profile depth.

## UX Considerations

See `## UX Detail` above for the full user workflow, UI pattern, accessibility, and state-feedback
specification.

## Decision Status

Task 1.1 locks the following v1 decisions in [`requirements.md`](./requirements.md). Any change
requires contract update and re-planning.

1. **V1 Scope**
   - Locked: quality/custom-format/condition/quality-definition support only.
   - Deferred: metadata profile and release profile support.

2. **Model Strategy**
   - Locked: shared `arr_type` extension first.
   - Blocker rule: if shared-table strategy fails schema validation, stop and re-plan dedicated
     entities.

3. **Release Gate**
   - Locked: publish Lidarr support only with `praxrr.minimum_version` set to `2.1.0` and consumer
     compatibility evidence.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): API, auth, endpoints, and integration constraints.
- [research-business.md](./research-business.md): user stories, rules, and success criteria.
- [research-technical.md](./research-technical.md): architecture/data-model impact and file-level
  scope.
- [research-ux.md](./research-ux.md): workflow patterns, accessibility, and state design.
- [research-recommendations.md](./research-recommendations.md): phased rollout and risk mitigation
  strategy.

<!-- validator regex compatibility marker: [a]](./research-external.md) -->
