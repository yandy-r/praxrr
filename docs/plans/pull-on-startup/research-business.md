# Business Logic Research: pull-on-startup

## Executive Summary

`pull-on-startup` introduces an optional startup reconciliation pass that imports Arr-side settings into Praxrr-local state when they can be matched safely to existing local entities. The business goal is faster operator onboarding and lower drift at restart time without turning startup into a destructive or blocking process.

The feature should be treated as a guarded bootstrap behavior, not a full bidirectional sync replacement: only deterministic matches are applied, Arr defaults are excluded, ambiguous matches are skipped, and startup continues even if individual instances fail.

## User Stories

- As an operator running Praxrr in a homelab, I want startup to pull known Arr settings automatically so I do not need to manually re-map every instance after restarts.
- As an operator with multiple Arr instances, I want pull outcomes per instance (pulled/skipped/conflicted/failed) so I can fix only the problematic targets.
- As a maintainer/developer, I want strict Arr-type-specific behavior so Radarr/Sonarr/Lidarr semantic differences do not corrupt data.
- As a risk-conscious admin, I want defaults and ambiguous matches skipped by policy so startup automation cannot silently override intended local state.
- As a platform operator, I want startup pull to be idempotent and non-blocking so repeated restarts do not create duplicate ops or delay service readiness.

## Business Rules

- **Env flag and default behavior**
- `PULL_ON_START` gates the feature; default is `false` when unset.
- Accepted values should follow existing boolean env parsing conventions (`1/true/yes/on` = enabled; otherwise disabled).
- Disabled state must be explicit in logs/status (not a silent no-op).

- **Startup lifecycle position**
- Pull runs after core startup prerequisites are complete: config init, DB init/migrations, log settings, PCD cache initialization, and env-instance reconciliation.
- Pull runs before normal background job scheduling to avoid startup races with sync jobs.
- Pull must not block server readiness; failures degrade to status/log outputs.

- **Matching rules (name + metadata)**
- Primary key: exact name match in target PCD scope (case-insensitive match logic, preserve stored name casing).
- Secondary key: Arr-type-specific metadata fingerprint (only fields with stable domain meaning for that entity and arr type).
- If multiple local candidates match one remote item (or vice versa), classify as `conflicted` and skip write.
- No cross-arr fallback (never resolve Lidarr payloads via Radarr/Sonarr entity logic).

- **Default-item exclusions**
- Do not import Arr built-ins/defaults.
- Delay profile defaults require app-specific detection: Radarr/Sonarr default profile behavior differs from Lidarr runtime default resolution.
- Singleton config endpoints (naming/media management) are not list defaults; exclusion policy applies to list-style entities only.
- For entities without explicit `isDefault` in API payloads, use conservative allowlist/heuristics and skip uncertain candidates.

- **Idempotency expectations**
- Re-running startup pull against unchanged Arr and local state should produce zero net new local ops.
- No duplicate create operations for already-matched entities.
- Repeated runs should converge to `skipped`/`no change` outcomes for stable inputs.

- **Fail-fast + partial-failure behavior**
- Fail fast per entity for invalid mapping, ambiguous match, or unsupported surface.
- Continue processing other entities in the same instance where safe.
- Continue processing other instances even if one instance fails.
- Overall run status supports partial success (`success`, `partial`, `failed`, `skipped`) with per-instance details.

- **Cross-Arr edge cases (required)**
- Radarr and Sonarr both support quality/custom/delay/media-management surfaces, but field semantics differ (for example naming enum shape and quality vocabulary).
- Lidarr includes metadata profiles and has different media-management payload support; unsupported fields must be skipped, not inferred.
- Delay profile default targeting differs by app and must not be generalized.
- Any Arr-surface not explicitly supported for that app is `skipped` with reason.

## Workflows

- **Happy path (enabled)**
- Startup completes core initialization.
- Pull orchestrator scans enabled Arr instances and fetches supported resources with bounded concurrency.
- For each resource: classify into `pulled`, `skipped` (default/no-match/unsupported), or `conflicted`.
- Deterministic matches write through existing PCD entity writer paths (user-layer ops), then compile/validate through normal pipeline.
- Run summary is logged/persisted with counts by outcome and instance.

- **Disabled path**
- Startup logs that pull is disabled by env flag.
- No pull writes are attempted; normal app operation continues.

- **Error recovery path**
- Instance connectivity/auth failure marks that instance `failed`; other instances continue.
- Ambiguous match marks entity `conflicted`; skip and continue.
- Transient fetch errors may retry within bounded budget; terminal failures are persisted with actionable context.
- Operators recover by fixing instance credentials/mappings and restarting or manually triggering equivalent pull flow (when available).

## Domain Model

- **Core entities**
- `StartupPullRun`: one startup execution envelope containing aggregate status and counts.
- `StartupPullInstanceRun`: per Arr instance execution result.
- `PulledResourceDecision`: per-entity classification result for matching/writing.

- **Decision states**
- `not_pulled`: candidate discovered but not processed yet.
- `pulled`: matched and applied to local DB via sanctioned writer path.
- `skipped_default`: identified as Arr default/built-in and excluded.
- `skipped_no_match`: no deterministic local match.
- `skipped_unsupported`: surface or payload unsupported for this `arr_type`.
- `conflicted`: ambiguous or incompatible match requiring manual resolution.
- `failed`: processing error (fetch/transform/write).

- **State transitions**
- `not_pulled -> pulled` (deterministic match + successful write).
- `not_pulled -> skipped_*` (policy guardrails trigger).
- `not_pulled -> conflicted` (ambiguous/incompatible mapping).
- `not_pulled -> failed` (technical failure).
- Run-level status derives from child outcomes:
- all pulled/skipped => `success` or `skipped`;
- mixed success + conflict/failure => `partial`;
- all failed => `failed`.

## Existing Codebase Integration

- **Startup sequencing hook**
- `packages/praxrr-app/src/hooks.server.ts`: insert pull invocation after `pcdManager.initialize()` and `reconcileEnvInstances()`, before `initializeJobs()`.

- **Config/env parsing pattern**
- `packages/praxrr-app/src/lib/server/utils/config/config.ts`: extend existing env parsing style for `PULL_ON_START` and optional tuning vars.

- **Arr instance discovery and gating**
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: source of enabled/configured instances.
- `packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`: startup reconciliation already normalizes env-provisioned instances before pull.

- **Arr API client and app-specific semantics**
- `packages/praxrr-app/src/lib/server/utils/arr/base.ts`: shared fetch methods for quality/delay/custom/media/naming.
- `packages/praxrr-app/src/lib/server/utils/arr/clients/lidarr.ts`: Lidarr-only metadata profile endpoints.
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts` and `packages/praxrr-app/src/lib/server/sync/mappings.ts`: authoritative app/surface support checks.

- **Write-path and idempotency conventions**
- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`: centralized validation/compile/write behavior; reuse instead of direct SQL writes.
- `packages/praxrr-app/src/lib/server/pcd/entities/**`: entity-level create/update modules for delay, quality, media management, metadata profiles.

- **Status/audit and operator visibility patterns**
- `packages/praxrr-app/src/lib/server/jobs/*` and `packages/praxrr-app/src/lib/server/db/queries/jobQueue.ts`: existing pattern for background run observability.
- `packages/praxrr-app/src/lib/server/db/queries/setupState.ts`: example singleton startup state handling (useful reference, but insufficient alone for run history).

## Success Criteria

- Startup with `PULL_ON_START=false` performs zero pull writes and emits explicit disabled status.
- Startup with `PULL_ON_START=true` processes all enabled Arr instances without preventing server readiness.
- At least 95% of deterministic matches on test fixtures land in `pulled`; ambiguous candidates are `conflicted` (not auto-resolved).
- Arr default resources are excluded consistently across supported app/entity combinations.
- Re-running startup pull on unchanged fixtures yields no additional local ops (idempotency).
- Outcome metrics are available per run and per instance (`pulled`, `skipped_default`, `skipped_no_match`, `conflicted`, `failed`).
- Cross-arr guardrails are enforced: no unsupported surface processing and no sibling-app fallback.

## Open Questions

1. Env var naming: should canonical flag be `PULL_ON_START` (requested) or `PULL_ON_STARTUP` (used in UX research)?
2. Database targeting policy: when multiple databases are enabled, should startup pull target one explicit database, all eligible databases, or fail/skip until configured?
3. Conflict policy at startup: should `conflicted` always skip, or should policy-based auto-resolution be allowed in v1?
4. Scope boundary for v1: include only sync-surface settings (quality/delay/media-management/metadata) or also custom formats/release profiles?
5. "Clean run" definition: should startup pull run only when no recovered in-progress jobs/synces are detected, and what exact recovery signals define "unclean"?
6. Failure posture: if all instances fail, should run remain non-blocking (recommended) or escalate to startup hard-fail mode?
7. Persisted visibility: should startup pull state live in dedicated run-history tables, job queue records, or both?
