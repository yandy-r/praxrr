# Documentation Research: sync-preview-dry-run

## Overview

Comprehensive documentation inventory for implementing the sync preview / dry-run feature. This feature adds a Terraform-style plan/apply workflow to Praxrr's Arr sync pipeline, requiring changes to the sync module, new API endpoints, new OpenAPI spec files, and new UI components. The existing research is exceptionally thorough -- six research documents totaling 200+ pages already cover technical architecture, business rules, UX patterns, external APIs, and recommendations. The implementation can proceed with confidence from documentation alone.

---

## Feature Research (Existing -- sync-preview-dry-run)

These documents were produced specifically for this feature and are the primary implementation reference.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/feature-spec.md`: **Master spec.** Executive summary, external dependencies (Arr APIs, microdiff library), full business requirements with user stories and edge cases, complete technical specification (architecture diagram, data models, API design with request/response shapes), UX workflows, implementation recommendations, phased task breakdown, risk assessment, and open decisions. This is the single most important document for implementation.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-technical.md`: Deep dive into the sync pipeline architecture, syncer-by-syncer analysis, diff engine design, preview storage (ephemeral in-memory), API endpoint specifications, system constraints (performance, staleness, concurrency), files to create/modify, and five key technical decisions with rationale.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-business.md`: User stories (single-instance, multi-instance, API consumer, post-PCD-update), 10 business rules, edge case matrix (empty config, missing PCD cache, Lidarr conditions, namespace overflow, concurrent sync), detailed workflow descriptions, domain model, existing codebase integration analysis, and success criteria.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-ux.md`: Diff visualization best practices (color coding, information hierarchy, nested diffs), multi-instance layout (accordion cards), confirmation UX (3-tier risk-based), performance UX (streaming, staleness indicators), error handling matrix, competitive analysis (Terraform Cloud, ArgoCD, CloudFormation, Pulumi, GitHub PRs), accessibility requirements (WCAG 2.2), responsive design, and 45+ external source references.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-external.md`: Arr API endpoint inventory for all three apps (Radarr v3, Sonarr v3, Lidarr v1), diff library comparison (microdiff vs json-diff-ts vs jsondiffpatch vs deep-object-diff), IaC precedent analysis (Terraform plan format, ArgoCD diff strategies, Ansible check mode, Pulumi preview), SSE streaming patterns for SvelteKit/Deno, and 8 gotchas/constraints (namespace suffixes, ID mismatches, Arr-added fields, format item score detection, media management passthrough).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-recommendations.md`: Implementation approach (compute-on-demand diff engine), technology choices table, phasing strategy (Phase 1: MVP QP+CF, Phase 2: full coverage + apply, Phase 3: background + drift), quick wins, risk assessment (technical/integration/UX/security/compatibility), three alternative approaches compared (inline vs persistent vs background), task breakdown with parallelization opportunities, key decisions needed, and open questions.

---

## Architecture Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`: **Project-level architecture reference.** Defines path aliases, server-side layout (PCD, DB, sync, jobs, upgrades, rename, notifications, utils), client-side layout (UI, stores, alerts, utils), shared types, route structure, key concepts (PCD ops model, app database, startup sequence), conventions (Svelte 5, no runes, alerts, dirty tracking, routes over modals, API namespace, contract-first API, conventional commits, formatting), Cross-Arr Semantic Validation Policy (required checklist), Portable Contract Fidelity, Arr Cutover Guardrails, and environment variables. **Required reading** before any implementation.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr HTTP client class hierarchy (`BaseHttpClient -> BaseArrClient -> RadarrClient/SonarrClient/LidarrClient`), file structure, constructor patterns, and method signatures. Preview uses only GET methods from these clients.

---

## API Docs (OpenAPI Specifications)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml`: Root OpenAPI 3.1.0 spec. Defines all current API paths (health, entity-testing, arr library/episodes/releases/cleanup, PCD export/import, Lidarr metadata profiles) and schema references. **Sync preview paths must be added here** (`/sync/preview`, `/sync/preview/{previewId}`, `/sync/preview/{previewId}/apply`).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/arr.yaml`: Current Arr API paths -- library, episodes, releases, cleanup, and test. The cleanup endpoint (`/arr/cleanup`) is the **closest existing pattern** for the preview API: it uses a two-phase scan/execute flow with `oneOf` request schemas. Preview should follow this pattern.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/arr.yaml`: Arr API schemas -- ArrType enum, library item types (Radarr/Sonarr/Lidarr), release types, error response, and cleanup types (StaleItem, CleanupScanRequest, CleanupExecuteRequest, CleanupScanResult, CleanupDeleteResult). The cleanup schemas demonstrate the scan-then-execute contract that preview should mirror. **New sync preview schemas will be added** to a new `docs/api/v1/schemas/sync.yaml` file.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/pcd.yaml`: PCD entity schemas including all portable entity types (PortableCustomFormat, PortableQualityProfile, PortableDelayProfile, PortableMediaSettings, PortableNaming, PortableLidarrMetadataProfile, PortableQualityDefinitions). These define the PCD-side data shapes that preview compares against Arr state.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/common.yaml`: Common schemas (ComponentStatus, HealthStatus). Minimal relevance.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/pcd.yaml`: PCD export/import paths. Demonstrates the portable entity contract. Minimal direct relevance but shows entity type enumeration.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/system.yaml`: System health and OpenAPI spec paths. Minimal relevance.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/health.yaml`: Health response schema. No direct relevance.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/entity-testing.yaml`: Entity testing schemas. No direct relevance.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/entity-testing.yaml`: Entity testing paths. No direct relevance.

**Files to create (from feature-spec.md):**

- `docs/api/v1/paths/sync.yaml` -- New path definitions for sync preview endpoints
- `docs/api/v1/schemas/sync.yaml` -- New schema definitions for preview types

---

## Configuration Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/deno.json`: Monorepo workspace config. Defines all path alias imports (notably `$sync/` -> `./packages/praxrr-app/src/lib/server/sync/`), task definitions (dev, build, lint, test, generate commands), compiler options, and npm/jsr dependencies. The `generate:api-types` task (`npx openapi-typescript docs/api/v1/openapi.yaml -o packages/praxrr-app/src/lib/api/v1.d.ts`) must be re-run after adding preview schemas to generate TypeScript types.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/svelte.config.js`: SvelteKit configuration with `sveltekit-adapter-deno`, path aliases mirroring deno.json (including `$sync`), CSRF settings, and build output configuration.

---

## Strategic Research (Feature Validation)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/research/praxrr-additional-features/report.md`: Comprehensive multi-persona research report validating sync preview as the **highest-impact feature** (7/8 independent personas recommend it, no competitor offers it). Documents the "centralization paradox" (Praxrr's power = its risk), historical IaC evolution supporting preview/apply patterns, competitive gap analysis, and the "transparent automation" principle.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/research/praxrr-additional-features/persona-findings/analogist.md`: Terraform plan/apply analogy analysis -- maps Praxrr sync pipeline 1:1 to Terraform's resource lifecycle. Referenced as strongest cross-domain validation.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/research/praxrr-additional-features/persona-findings/systems-thinker.md`: Blast radius analysis and safety infrastructure reasoning. Identifies the Cloudflare 2025 outage parallel and argues sync validation gates are the "highest-ROI safety feature."

---

## Related Feature Plans

These existing feature plans share architectural patterns or touch overlapping code paths.

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-lidarr-support/`: Lidarr first-class entity support. Relevant because preview must handle Lidarr-specific entities (metadata profiles, condition skipping, v1 API). The migration runbook and post-cutover checklist document Lidarr-specific sync behavior.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/navigation-update/`: Navigation refactor plan. Relevant for understanding where the preview UI fits in the app's navigation structure and for following established UI patterns.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/arr-library-view-pagination/`: Library view with pagination. Demonstrates existing patterns for paginated data display, server-side filtering, and Arr-type-polymorphic responses that preview may follow.

---

## Development Checklists and TODOs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/todo/op-splitting-checklist.md`: PCD op-splitting checklist. Documents field-level granularity for PCD operations (CF conditions, QP qualities, QP scoring split into separate ops). Relevant because preview's field-level diffs must align with the same granularity.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/todo/component-check.md`: UI component inventory. Useful for identifying reusable components when building preview UI.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/todo/clone-and-portable-entities.md`: Clone/portable entity workflow. Shows how entity data shapes are used across import/export, which parallels how preview must handle entity comparison.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/todo/conflict-testing.md`: Conflict testing documentation. Relevant for understanding value-guard and concurrency patterns that preview must respect.

---

## Ideas/Future

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ideas/adaptive-backoff.md`: Adaptive backoff for upgrade filters. Not directly related to sync preview, but demonstrates the dry-run pattern already present in the codebase thinking (dry-run filter logic to check matched counts before full execution).

---

## Branch Status

The `feat/sync-preview-dry-run` branch (based on `v2`) currently contains **only documentation** -- the six research files listed above plus unrelated UI changes (card view defaults, Arr icon rendering). No implementation code has been written. The branch is clean with no uncommitted changes.

Key commit: `487b5a0 feat(sync-preview): introduce sync preview feature with detailed change diffs`

---

## Must-Read Documents

Ordered by implementation priority. Implementers should read these before writing any code.

| Priority | Document | Topics Covered |
|----------|----------|----------------|
| 1 | `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md` | Project conventions, path aliases, Svelte 5 rules, Cross-Arr Validation Policy, contract-first API requirement, formatting standards |
| 2 | `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/feature-spec.md` | Complete feature specification: architecture, data models, API design, UX workflows, phased task breakdown |
| 3 | `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-technical.md` | Sync pipeline analysis, diff engine design, preview storage, files to create/modify, technical decisions |
| 4 | `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-business.md` | Business rules, edge cases, domain model, existing codebase integration patterns |
| 5 | `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml` | Current API structure, schema references, where to add new preview paths |
| 6 | `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/arr.yaml` | Cleanup endpoint pattern (scan/execute two-phase) that preview API should follow |
| 7 | `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/arr.yaml` | Cleanup schemas (StaleItem, CleanupScanRequest/Result) as contract precedent |
| 8 | `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-external.md` | Diff library details, Arr API endpoint inventory, IaC format precedents, SSE patterns |
| 9 | `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-ux.md` | Diff visualization, multi-instance layout, confirmation tiers, accessibility |
| 10 | `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/sync-preview-dry-run/research-recommendations.md` | Phasing strategy, risk assessment, alternative approaches, task parallelization |

**Nice-to-have reads:**

| Document | Why |
|----------|-----|
| `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/README.md` | Arr client class hierarchy and file structure |
| `/home/yandy/Projects/github.com/yandy-r/praxrr/research/praxrr-additional-features/report.md` | Strategic validation (7/8 persona consensus) |
| `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/todo/op-splitting-checklist.md` | Field-level granularity for PCD operations |
| `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/pcd.yaml` | Portable entity shapes for diff comparison |
| `/home/yandy/Projects/github.com/yandy-r/praxrr/deno.json` | Path aliases, tasks, workspace config |

---

## Documentation Gaps

1. **No `docs/api/v1/paths/sync.yaml` exists yet.** The feature spec specifies this file must be created with preview endpoint definitions. This is a Phase 1 task per the contract-first API convention.

2. **No `docs/api/v1/schemas/sync.yaml` exists yet.** Must be created with `SyncPreviewResult`, `EntityChange`, `FieldChange`, `PreviewSummary`, and section-specific preview types.

3. **No analysis-code.md or analysis-context.md for sync-preview-dry-run.** Other feature plans (enhance-lidarr-support, arr-library-view-pagination) include these files for deeper code-level analysis. The `research-technical.md` partially covers this but a dedicated code analysis could identify more specific refactoring targets in the syncer implementations.

4. **No parallel-plan.md for sync-preview-dry-run.** Other feature plans include this for task decomposition and parallel workstream identification. The `feature-spec.md` covers phasing but not fine-grained parallel task coordination.

5. **No shared.md context file for sync-preview-dry-run.** Other feature plans include a `shared.md` that acts as a context summary for subagent coordination. If parallel implementation is planned (e.g., backend + frontend work simultaneously), this would be valuable.

6. **Arr client README is outdated.** The README in `packages/praxrr-app/src/lib/server/utils/arr/README.md` shows a "Future Usage" section with methods (`getMovies`, `addMovie`) that do not yet exist. It does not document the full set of GET methods already implemented that preview depends on (e.g., `getCustomFormats`, `getQualityProfiles`).

7. **No database schema documentation for sync-related tables.** The `research-technical.md` references `arr_sync_*` tables at "line 458+" of `schema.sql` but there is no standalone documentation of the sync config schema. Understanding which tables store sync selections, trigger configs, and sync status is critical for knowing what preview must NOT modify.

8. **No test pattern documentation.** The existing research does not document the project's testing patterns for the sync module specifically. Understanding how existing syncers are tested would inform the preview test strategy.
