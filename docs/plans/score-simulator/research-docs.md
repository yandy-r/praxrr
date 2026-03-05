# Documentation Research: Score Simulator

The score simulator touches nearly every major subsystem documented in the codebase: PCD cache, parser microservice, custom format evaluation, quality profile scoring, and the OpenAPI contract-first API workflow. This report catalogs all documentation relevant to implementation, organized by category with required-reading prioritization.

## Architecture Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ARCHITECTURE.md`: Comprehensive system architecture covering PCD ops model, tech stack, glossary, startup sequence, entity lifecycle, sync pipeline, and all module boundaries. The authoritative reference for understanding how PCD cache compilation, ops layers, and the in-memory SQLite cache work together.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/overview.md`: High-level system context diagram showing how the SvelteKit app, API routes, PCD manager, sync registry, parser service, and supporting packages relate. Includes the package boundary table (praxrr-app, praxrr-api, praxrr-schema, praxrr-db, praxrr-parser).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/components.md`: Component map with Mermaid diagram. Covers startup wiring, API route layer, PCD lifecycle, sync, job queue, and Arr/parser integration. Each component lists key reference files.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/data-flow.md`: Sequence diagrams for five core flows: server startup, PCD link/sync/compile, Arr sync job, entity testing evaluation, and cross-package contract flow. The entity testing evaluation flow (section 4) is directly reusable for the score simulator pipeline.

## API Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/README.md`: API documentation index. Covers base URL (`/api/v1`), quick start examples, and links to endpoint reference, authentication, errors, and OpenAPI spec.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md`: Complete endpoint reference for `/api/v1`. Documents the `POST /entity-testing/evaluate` endpoint (the closest existing API to the score simulator), including request/response shapes, semantics, and examples. Also covers health, ui-preferences, Arr library/releases, PCD import/export, and Lidarr metadata profiles.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/errors.md`: Error semantics reference. Documents the common `{ "error": "..." }` shape, status code semantics by area (including entity testing: 400 for invalid request, 404 for missing cache), and authentication error behavior. Essential for defining score simulator error responses consistently.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/authentication.md`: Authentication modes (session cookie, API key, AUTH=on/local/off/oidc). The score simulator API endpoint will follow the same protected-endpoint pattern.

### OpenAPI Contract Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml`: Root OpenAPI 3.1.0 spec. New score simulator paths and schemas must be registered here. Currently defines tags: System, Entity Testing, Arr, Trash Guide, PCD, PCD Snapshots, User Preferences.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/entity-testing.yaml`: Schema definitions for `MediaType`, `ParsedInfo`, `ReleaseInput`, `ReleaseEvaluation`, `EvaluateRequest`, `EvaluateResponse`. The `ParsedInfo` schema is directly referenceable by the score simulator schemas (already referenced in the feature spec). `ReleaseInput` differs from the simulator's `SimulateReleaseInput` (integer ID vs string ID).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/entity-testing.yaml`: Path definition for `POST /entity-testing/evaluate`. Serves as the structural template for the new `POST /simulate/score` path definition.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/common.yaml`: Common schema components (error responses, etc.).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/pcd.yaml`: PCD entity schemas.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/arr.yaml`: Arr-related schemas.

## Feature Docs

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/entity-testing.md`: The closest reference feature to the score simulator. Documents the user workflow (pick database, add test entities, add/import releases, evaluate, score against profile), the evaluate API, and troubleshooting. The score simulator essentially extracts the "evaluate + score" workflow into an ad-hoc playground without requiring persistent test entities.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/progressive-disclosure.md`: Documents the progressive disclosure system: section keys format (`route-family:route-section:ui-section`), persistence via API (`GET/PATCH /api/v1/ui-preferences`), design rules, and rollout guidance. The score simulator will need to register section keys if using disclosure for advanced modes (batch, comparison, condition details).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/link-bridge-sync.md`: PCD database linking and sync workflow. Relevant for understanding how databases become available for the simulator's database selector.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/portable-import-export.md`: Portable entity contract. Less directly relevant but useful for understanding entity data shapes.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/README.md`: Feature guides index with recommended reading order.

## Development Guides

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/DEVELOPMENT.md`: Branching strategy (GitHub Flow), release channels (develop/beta/stable), versioning (semver), and commit conventions.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/CONTRIBUTING.md`: Contributor quickstart covering setup (Deno 2.x, .NET 8+ optional), daily commands, coding conventions (Svelte 5 no runes, alertStore, dirty tracking, routes over modals).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`: Project-level AI coding instructions. Contains critical implementation constraints: path aliases, server/client layout, key concepts (PCD, app DB, startup sequence), conventions (Svelte 5 no runes, contract-first API, conventional commits, formatting rules, Cross-Arr Semantic Validation Policy, Portable Contract Fidelity, Arr Cutover Guardrails, Local-Path Source Guardrails), and environment variables.

## Score Simulator Planning Docs (Already Written)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/feature-spec.md`: Complete feature specification with executive summary, external dependencies, business requirements, user stories, business rules, edge cases, success criteria, technical specifications (architecture diagram, data models, API design, system integration, files to create/modify), UX considerations, recommendations, risk assessment, and task breakdown.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-technical.md`: Architecture design, data flow, data models (TypeScript interfaces and OpenAPI YAML schemas), API design with endpoint details, system constraints (performance, parser dependency, PCD cache, security), codebase changes (files to create/modify), technical decisions with rationale, and relevant file references.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-business.md`: User stories, business rules (read-only operation, parser dependency, CF matching logic, score resolution precedence, total score computation), domain model (entities and relationships), state transitions, existing codebase integration points, components to leverage, and data model references.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-external.md`: Parser microservice API details (parse, match, batch match endpoints with request/response examples), custom format condition types table with matching methods and data sources, JS fallback parser (`@ctrl/video-filename-parser`), scoring algorithm verified from Radarr source, integration patterns, and ecosystem tool analysis (Profilarr, Recyclarr, TRaSH Guides).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-ux.md`: Split-pane playground pattern analysis, score visualization approaches (color-coded breakdown, stacked bar, thermometer/gauge, tabular), comparison UI patterns (SAP Fiori), competitive analysis (Regex101, GraphQL Playground, TRaSH Guides, Notifiarr, Recyclarr/Configarr), accessibility (WCAG), responsive design breakpoints, error handling states, performance UX (debouncing, loading states).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-recommendations.md`: Implementation strategy (hybrid server/client), technology choices, phasing (MVP -> comparison/batch -> integration/polish), quick wins, risk assessment, alternative approaches (server-side vs hybrid vs WASM), task breakdown preview, and key decisions needed.

## README Files

- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr HTTP client architecture (BaseHttpClient -> BaseArrClient -> RadarrClient/SonarrClient/etc.). Documents the class hierarchy and file structure. Not directly used by the simulator (which uses the parser client, not Arr clients), but helpful for understanding the broader HTTP client patterns.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-api/README.md`: Published API contract package.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/README.md`: Schema ops package consumed by PCD compilation.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/README.md`: Default PCD content ops repository.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/README.md`: Auth middleware documentation.

## Other Planning Docs (Reference Patterns)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-state-snapshot/`: Complete planning cycle for PCD snapshots feature (feature-spec, research-technical, research-business, research-external, research-ux, research-recommendations, parallel-plan, shared). Useful as a reference for the planning artifact pattern and parallel implementation planning.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/`: Progressive disclosure planning cycle with rollout notes per page. Useful for understanding how disclosure section keys are structured and rolled out.
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/documentation-strategy.md`: Documentation audit and gap analysis. Notes that existing docs contain many Radarr/Sonarr-specific references and identifies generalization gaps.

## Must-Read Documents

These documents are **required reading** before implementing the score simulator, listed in recommended order:

1. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/feature-spec.md`** -- The authoritative specification. Defines API contract, data models, file creation/modification plan, UX workflows, and phasing strategy. Start here.
2. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-technical.md`** -- Architecture design, OpenAPI schema definitions (ready to copy), codebase change plan, and technical decisions. Contains the exact TypeScript interfaces and YAML schemas to implement.
3. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-external.md`** -- Parser microservice integration details (request/response formats), condition type matching table, and scoring algorithm logic verified from Radarr source. Critical for understanding evaluation semantics.
4. **`/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`** -- Project conventions: contract-first API workflow, Svelte 5 no runes, path aliases, Cross-Arr Semantic Validation Policy, formatting rules. Violations will cause review failures.
5. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/entity-testing.md`** -- The closest reference feature. The score simulator's backend pipeline mirrors entity testing's evaluate flow. Understanding this workflow is essential.
6. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/entity-testing.yaml`** -- Existing OpenAPI schemas that the simulator schemas must reference (`ParsedInfo`, `MediaType`). The new `score-simulator.yaml` schemas import from here.
7. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/errors.md`** -- Error response conventions. The simulator endpoint must follow the same `{ "error": "..." }` pattern and status code semantics.
8. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/data-flow.md`** -- Entity testing evaluation flow diagram (section 4) shows the exact server-side pipeline the simulator reuses: health check -> parse batch -> load conditions -> evaluate CFs.
9. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/progressive-disclosure.md`** -- Section key format and rollout guidance, needed if adding disclosure sections to the simulator UI.
10. **`/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-ux.md`** -- UI/UX patterns, comparison layout, accessibility requirements, and responsive design breakpoints.

## Nice-to-Have Documents

These provide useful context but are not blocking for implementation:

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-business.md` -- Domain model and user stories (already summarized in feature-spec).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/score-simulator/research-recommendations.md` -- Phasing strategy and alternative approaches (already incorporated into feature-spec).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ARCHITECTURE.md` -- Deep system architecture (useful for edge cases around PCD cache lifecycle).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/authentication.md` -- Auth modes (the simulator uses standard protected-endpoint auth, no special handling needed).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/CONTRIBUTING.md` -- Setup and conventions (largely covered by CLAUDE.md).
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/` -- Full disclosure planning cycle (only relevant if adding disclosure sections).

## Documentation Gaps

1. **No parser microservice standalone documentation**: The parser endpoints (`/parse`, `/match`, `/match/batch`, `/health`) are documented only in the research-external.md planning artifact and inline code comments. There is no `packages/praxrr-parser/README.md` or dedicated parser API doc. Implementers must refer to the C# source (`ParseEndpoints.cs`, `MatchEndpoints.cs`) or the research doc.

2. **No navigation registry documentation**: The navigation item registration pattern (`registry.ts`) is mentioned in CLAUDE.md and research docs but has no dedicated guide explaining the registry structure, group hierarchy, icon conventions, or ordering semantics.

3. **No scoring/evaluation pipeline documentation**: The CF evaluation pipeline (`evaluateCustomFormat`, `getAllConditionsForEvaluation`, `extractAllPatterns`, `matchPatternsBatch`) is documented only in planning artifacts (research-technical, research-business). There is no standalone doc explaining the evaluation algorithm, condition type semantics, or score resolution precedence (`all` vs arr-type-specific). The feature-spec contains this information, but a reusable reference doc would help future features.

4. **No PCD cache query patterns guide**: The PCD cache (`PCDCache.kb` Kysely instance) is the primary data source for the simulator. Documented in ARCHITECTURE.md at a high level, but there is no guide showing common query patterns, how to access the cache via `pcdManager.getCache(id)`, or the in-memory SQLite schema.

5. **No UI component catalog**: Reusable components (`Score.svelte`, `ExpandableTable`, `Badge`, `CollapsibleCard`, `Tabs`, `ActionsBar`) are referenced in planning docs but have no standalone component documentation or storybook-equivalent.

6. **Missing `docs/api/v1/paths/score-simulator.yaml` and `docs/api/v1/schemas/score-simulator.yaml`**: These files are specified in the feature-spec as "files to create" but do not exist yet. They are the first implementation step per the contract-first API convention.

7. **No OpenAPI generation workflow documentation**: The `deno task generate:api-types` command is mentioned in CLAUDE.md but the full workflow (edit YAML -> register in openapi.yaml -> run generation -> verify v1.d.ts) is not documented as a step-by-step guide.
