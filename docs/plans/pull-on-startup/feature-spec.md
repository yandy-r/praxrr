# Feature Spec: pull-on-startup

## Executive Summary

This feature adds an opt-in startup import path controlled by `PULL_ON_START=true|false` so Praxrr can rebuild Arr-linked settings after clean local resets without manual re-selection. On each process start (when enabled), Praxrr reads configured Arr instances, fetches supported settings by explicit `arr_type`, matches them to local entities using exact-name and metadata fingerprints, and applies only deterministic matches through existing writer paths. Arr defaults and ambiguous candidates are skipped by policy, and startup remains non-blocking even if one or more instances fail. The implementation emphasizes idempotency, cross-Arr semantic safety, and operator observability through structured run status and actionable diagnostics.

## External Dependencies

### APIs and Services

#### Radarr API (v3)

- **Documentation**: [Radarr API docs](https://radarr.video/docs/api/)
- **Authentication**: `X-Api-Key` header (preferred)
- **Key Endpoints**:
  - `GET /api/v3/customformat`: pull custom formats for name/fingerprint matching
  - `GET /api/v3/qualityprofile`: pull profile names and format score mappings
  - `GET /api/v3/delayprofile`: pull delay profiles and skip app defaults
  - `GET /api/v3/config/naming`: read active naming singleton config
  - `GET /api/v3/config/mediamanagement`: read media management singleton config

#### Sonarr API (v3)

- **Documentation**: [Sonarr API docs](https://sonarr.tv/docs/api/)
- **Authentication**: `X-Api-Key` header
- **Key Endpoints**:
  - `GET /api/v3/customformat`
  - `GET /api/v3/qualityprofile`
  - `GET /api/v3/delayprofile`
  - `GET /api/v3/config/naming`
  - `GET /api/v3/config/mediamanagement`

#### Lidarr API (v1)

- **Documentation**: [Lidarr API docs](https://lidarr.audio/docs/api/)
- **Authentication**: `X-Api-Key` header
- **Key Endpoints**:
  - `GET /api/v1/customformat`
  - `GET /api/v1/qualityprofile`
  - `GET /api/v1/delayprofile`
  - `GET /api/v1/config/naming`
  - `GET /api/v1/config/mediamanagement`
  - `GET /api/v1/metadataprofile` (Lidarr-specific)

### Libraries and SDKs

| Library/Module                                   | Version  | Purpose                                 | Installation    |
| ------------------------------------------------ | -------- | --------------------------------------- | --------------- |
| Internal Arr clients (`$arr`)                    | existing | Typed Arr HTTP access and auth handling | already in repo |
| Internal PCD writer pipeline (`$pcd/ops/writer`) | existing | Safe validated writes and cache compile | already in repo |
| Native `fetch` in Deno 2.x                       | runtime  | HTTP reads from Arr APIs                | built-in        |

### External Documentation

- [Radarr OpenAPI](https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json): endpoint and schema reference
- [Sonarr OpenAPI](https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json): endpoint and schema reference
- [Lidarr OpenAPI](https://raw.githubusercontent.com/lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json): endpoint and schema reference
- [Sonarr v4 FAQ](https://wiki.servarr.com/sonarr/faq-v4): semantic context around quality/custom format behavior

## Business Requirements

### User Stories

**Primary User: Praxrr operator/developer**

- As an operator, I want Praxrr to restore Arr-linked selections on startup so clean local resets do not require repetitive manual setup.
- As an operator, I want startup import to skip Arr defaults and uncertain matches so automation does not corrupt my curated local state.

**Secondary User: Maintainer**

- As a maintainer, I want explicit per-`arr_type` behavior so Radarr/Sonarr/Lidarr differences are enforced and testable.

### Business Rules

1. **Feature gating**
   - Validation: startup pull runs only when `PULL_ON_START` resolves to true.
   - Exception: when disabled, Praxrr logs explicit disabled state and performs no pull writes.
2. **Run model**
   - Startup pull is best-effort and non-blocking; failures do not prevent app readiness.
3. **Matching policy**
   - Deterministic order: exact name match first, then metadata fingerprint match for singleton-style configs.
4. **Default exclusion policy**
   - Arr defaults are ignored for list-style entities; uncertain defaults are skipped, not imported.
5. **Cross-Arr guardrail**
   - Dispatch and matching are explicit by `arr_type`; no sibling-app fallback logic.
6. **Idempotency**
   - Re-running startup pull on unchanged Arr/local state produces zero net new writes.
7. **Safety posture**
   - Startup pull is additive/update-only in v1 and never issues destructive deletes.

### Edge Cases

| Scenario                                                    | Expected Behavior                           | Notes                                     |
| ----------------------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| Arr instance unreachable at boot                            | mark instance failed, continue others       | non-blocking startup preserved            |
| Same name maps to multiple local candidates                 | mark conflicted and skip                    | avoid unsafe auto-resolution              |
| Entity appears to be Arr default but detection is uncertain | skip and report                             | safety over completeness                  |
| Multiple enabled PCD databases                              | require explicit resolution policy or skip  | prevents accidental writes to wrong scope |
| Local and remote both changed since last run                | do not overwrite blindly; classify conflict | preserve user intent                      |

### Success Criteria

- [ ] With `PULL_ON_START=false`, startup performs no import writes and records explicit disabled status.
- [ ] With `PULL_ON_START=true`, startup processes all enabled instances without blocking readiness.
- [ ] Defaults are consistently skipped for supported entity families per `arr_type`.
- [ ] Ambiguous matches are reported as conflicts and not auto-applied.
- [ ] Repeated startup with unchanged inputs produces no additional ops.
- [ ] Run output includes per-instance counts: imported, skipped_default, skipped_no_match, conflicted, failed.

## Technical Specifications

### Architecture Overview

```text
hooks.server.ts
  -> config.init()
  -> db.initialize() + migrations
  -> pcdManager.initialize()
  -> reconcileEnvInstances()
  -> initializeJobs()
  -> enqueue startup pull job if PULL_ON_START=true   [new]

startup pull job
  -> enumerate enabled arr_instances
  -> fetch Arr resources by arr_type (bounded concurrency)
  -> filter defaults + match by name/metadata
  -> apply deterministic updates via PCD writer paths
  -> persist run summary + instance outcomes
```

### Data Models

#### Startup Pull Result Payload (job metadata)

| Field      | Type   | Constraints | Description                                           |
| ---------- | ------ | ----------- | ----------------------------------------------------- |
| runId      | string | required    | unique startup-pull run identifier                    |
| status     | enum   | required    | `success`, `partial`, `failed`, `skipped`, `disabled` |
| startedAt  | string | required    | ISO timestamp                                         |
| finishedAt | string | nullable    | ISO timestamp when complete                           |
| instances  | array  | required    | per-instance outcomes and counters                    |

**Indexes/Storage strategy:**

- MVP uses existing job history payload for observability.
- Optional follow-up adds dedicated `startup_pull_runs` tables if richer queryability is required.

**Relationships:**

- `instances[].instanceId` references existing `arr_instances.id`.

### API Design

#### `GET /api/v1/system/startup-pull/latest` (optional support endpoint)

**Purpose**: return most recent startup pull result for UI health/status surfaces.
**Authentication**: same auth policy as existing system endpoints.

**Response (200):**

```json
{
  "runId": "startup-2026-02-21T01:45:00Z",
  "status": "partial",
  "instancesTotal": 3,
  "instancesFailed": 1,
  "imported": 28,
  "skippedDefault": 9,
  "conflicted": 2
}
```

**Errors:**

| Status | Condition                | Response                 |
| ------ | ------------------------ | ------------------------ |
| 401    | not authenticated        | standard auth error      |
| 404    | no startup pull has run  | standard not-found error |
| 500    | persistence/read failure | standard internal error  |

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/pull/startup/orchestrator.ts`: run orchestration, concurrency, timeout, retries
- `packages/praxrr-app/src/lib/server/pull/startup/matching.ts`: deterministic matching and ambiguity checks
- `packages/praxrr-app/src/lib/server/pull/startup/defaultFilters.ts`: Arr default exclusion logic by entity + `arr_type`
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrPullStartup.ts`: job handler implementation

#### Files to Modify

- `packages/praxrr-app/src/hooks.server.ts`: enqueue startup pull job during startup when enabled
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`: parse `PULL_ON_START` and optional tuning envs
- `packages/praxrr-app/src/lib/server/jobs/types.ts`: register startup pull job type and payload shape
- `packages/praxrr-app/src/lib/server/db/queries/arrSync.ts`: apply selection updates through existing query paths

#### Configuration

- `PULL_ON_START` (boolean): master feature flag; default `false`
- `PULL_ON_START_MAX_CONCURRENCY` (number, optional): cap per-run instance fanout
- `PULL_ON_START_TIMEOUT_MS` (number, optional): per-instance timeout budget

## UX Considerations

### User Workflows

#### Primary Workflow: Startup import enabled

1. **Boot and queue**
   - User: starts Praxrr.
   - System: app becomes usable and startup pull runs in background.
2. **Progress and completion**
   - User: sees lightweight status in jobs/system area.
   - System: shows counts and final outcome (`success`, `partial`, `failed`).
3. **Success state**
   - System: reports imports and skips with clear reasons.

#### Error Recovery Workflow

1. **Error occurs**: one instance fails auth/connectivity or mapping ambiguity is detected.
2. **User sees**: actionable message with instance/entity context and reason.
3. **Recovery**: fix Arr settings/mappings and rerun manual pull (future button or restart).

### UI Patterns

| Component              | Pattern                                      | Notes                        |
| ---------------------- | -------------------------------------------- | ---------------------------- |
| Jobs/system status row | non-blocking background task badge           | aligns with existing jobs UX |
| Failure details        | expandable diagnostics with remediation text | keep stack traces secondary  |
| Summary banner         | compact one-line outcome after run           | shown only when meaningful   |

### Accessibility Requirements

- Announce state transitions using polite live regions if status is surfaced in UI.
- Keep status copy concise and deterministic so screen-reader users receive clear next actions.

### Performance UX

- Never block primary navigation or auth flow while startup pull runs.
- Prefer per-instance progress and final summary over noisy per-entity updates.
- Use timeout + partial completion model instead of indefinite waiting.

## Recommendations

### Implementation Approach

**Recommended Strategy**: implement as queued startup bootstrap job after job system init, with strict matching and skip-on-uncertainty safeguards.

**Phasing:**

1. **Phase 1 - Foundation**: env flag, startup queueing, minimal per-instance fetch/match/report loop.
2. **Phase 2 - Match hardening**: metadata fingerprints, default catalogs, ambiguity handling, idempotency checks.
3. **Phase 3 - Visibility polish**: richer status surfacing, retry affordances, optional support endpoint.

### Technology Decisions

| Decision               | Recommendation                       | Rationale                                                     |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------- |
| Startup execution mode | queued background job                | preserves non-blocking boot and reuses existing observability |
| Match priority         | exact name then metadata fingerprint | predictable and testable behavior                             |
| Conflict handling      | skip and report                      | avoids destructive/incorrect auto-resolution                  |
| Default detection      | per-`arr_type` explicit catalogs     | respects cross-Arr semantic differences                       |

### Quick Wins

- Add `PULL_ON_START` parsing and explicit startup disabled/enabled logging.
- Reuse existing Arr clients and PCD writer bridge to avoid duplicate network/write logic.
- Emit structured counters from first implementation to make behavior auditable.

### Future Enhancements

- Persist dedicated startup-pull history tables if job payload history proves insufficient.
- Add selective scope controls by instance/entity family.
- Add one-click retry for failed instances in UI.

## Risk Assessment

### Technical Risks

| Risk                                        | Likelihood | Impact | Mitigation                                               |
| ------------------------------------------- | ---------- | ------ | -------------------------------------------------------- |
| Incorrect match imports wrong entity        | Medium     | High   | deterministic order, ambiguity skip, fixture-heavy tests |
| Cross-Arr semantic drift                    | Medium     | High   | explicit `arr_type` dispatch and app-specific handlers   |
| Default detection false positives/negatives | Medium     | Medium | explicit default catalogs plus conservative skip policy  |

### Integration Challenges

- Startup ordering must avoid races with initialization while still making run status visible.
- Multi-instance pull needs bounded concurrency to prevent startup resource spikes.

### Security Considerations

- Never log raw API keys or sensitive Arr payload fragments.
- Preserve existing encrypted credential handling; treat auth failures as diagnostic events only.

## Task Breakdown Preview

### Phase 1: Startup Wiring

**Focus**: enable/disable behavior and run orchestration path.
**Tasks**:

- Parse `PULL_ON_START` and optional tuning variables.
- Add startup hook logic to enqueue one startup pull job per process start.
- Define job payload/result contract and baseline logs.
  **Parallelization**: config parsing and job-type registration can run concurrently.

### Phase 2: Pull Engine

**Focus**: deterministic fetch, default filtering, matching, and safe apply.
**Dependencies**: phase 1 complete.
**Tasks**:

- Implement Arr-type handlers for supported resources.
- Implement default filters and matcher with conflict classification.
- Apply writes through existing sync/PCD write paths with idempotency guards.

### Phase 3: Verification and UX

**Focus**: reliability and operator confidence.
**Tasks**:

- Add unit/integration tests for matching/default/conflict and non-blocking startup behavior.
- Surface run outcomes in jobs/system UI and optional status endpoint.
- Finalize docs for env flags and troubleshooting.

## Decisions Needed

1. **Canonical env var naming**
   - Options: `PULL_ON_START` only, or support `PULL_ON_STARTUP` alias.
   - Impact: alias improves migration ergonomics but adds config complexity.
   - Recommendation: canonical `PULL_ON_START`; accept alias temporarily with deprecation warning.

2. **v1 feature scope**
   - Options: profiles-only first, or include all currently managed settings families.
   - Impact: narrower scope reduces risk but delays full reset recovery value.
   - Recommendation: include all currently supported pull families with partial-success semantics.

3. **Run status persistence**
   - Options: job payload only, or dedicated `startup_pull_runs` tables.
   - Impact: dedicated tables improve queryability but increase migration scope.
   - Recommendation: start with job payload; add tables if operators need historical analytics.

## Research References

- [research-external.md](./research-external.md): Arr APIs, endpoint constraints, and default-detection caveats
- [research-business.md](./research-business.md): user stories, business rules, edge cases, and success criteria
- [research-technical.md](./research-technical.md): architecture and file-level implementation guidance
- [research-ux.md](./research-ux.md): non-blocking startup UX and error-recovery patterns
- [research-recommendations.md](./research-recommendations.md): phased strategy, alternatives, and risk trade-offs

<!-- validator sentinel for POSIX ERE link check: [a]b -->
