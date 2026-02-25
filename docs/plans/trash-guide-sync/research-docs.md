# Documentation Research: trash-guide-sync

## Architecture Docs

- /docs/plans/trash-guide-sync/feature-spec.md: Executive summary + architecture diagram for TRaSH
  Guide Sync, listing dependency matrix (TRaSH repo, Radarr/Sonarr APIs), user stories, business
  rules, edge cases, success criteria, and high-level data model sketches that show how TRaSH
  content becomes PCD base ops before hitting existing sync handlers.
- /docs/plans/trash-guide-sync/research-technical.md: Detailed component/flow breakdown
  (fetcher/parser/transformer/manager/cache/job handler), new database tables
  (`trash_guide_sources`, `sync_config`, etc.), pull/push workflows, and integration points with job
  queue, cache registry, and sync processor; includes the explicit architecture diagram referenced
  in the spec.
- /research/data-schema/synthesis/technical-design.md: Deep adapter design notes for converting
  TRaSH JSON (trash_id, trash_scores, specs) into Praxrr’s normalized PCD entities, including regex
  deduplication strategy, field mapping tables, and importer context code snippets—key for anyone
  writing the transformer/migration layer.

## API Docs

- /docs/plans/trash-guide-sync/research-technical.md: API surface described with endpoint list
  (`GET /api/v1/trash-guide/sources`, `POST /api/v1/trash-guide/sources/:id/sync`,
  `GET …/entities|quality-profiles|score-profiles`), request/response samples, and routemap
  references (planned files under `packages/praxrr-app/src/routes/api/v1/trash-guide/...`), plus
  tables capturing TRaSH-specific configuration (score profiles, sync strategy) needed to implement
  server handlers and persistence queries.
- /docs/plans/trash-guide-sync/feature-spec.md: Companion API section summarizing the same endpoints
  with payload expectations, along with the Arr API contracts (Radarr/Sonarr custom format/quality
  profile/quality definition/naming endpoints) that the syncer must satisfy.

## Development Guides

- /docs/plans/trash-guide-sync/research-business.md: Business justification, prioritized user
  stories (self-hosters + power users), sync scheduling/conflict rules, per-instance selection
  requirements, workflows (scheduled sync, manual sync, preview, error recovery), and operational
  constraints that dictate how the backend jobs, preview system, and UI must behave.
- /docs/plans/trash-guide-sync/research-external.md: TRaSH repo metadata/schema
  (metadata.json/metadata.schema.json), JSON directory layout (`docs/json/radarr/…`,
  naming/quality/CF files), sample payload structures, schema fields, and signal links to competitor
  docs (Recyclarr wiki, Configarr repo) for reference implementation patterns.
- /docs/plans/trash-guide-sync/research-ux.md: UX research for the sync dashboard (status-first
  instance cards, SSE progress), preview workflows with TRaSH attribution, setup/conflict/error
  flows, and UI best practices (global status bar, card layout, copy/animations) that front-end
  developers must follow for dashboard/panel screens.
- /docs/plans/trash-guide-sync/research-recommendations.md: Recommended PCD-first implementation
  approach, phasing strategy (Phase 1 custom format import → Phase 4 analytics), risks/mitigations
  (schema drift, large repo clones, timeline), and alternative architectures (direct sync, hybrid)
  that guide technology/priority decisions.
- /research/data-schema/synthesis/{decision-framework.md,risk-assessment.md,contradiction-mapping.md}:
  Strategic decision summaries (criteria weightings for TRaSH alignment), granular risk catalog
  (format instability, schema mismatches, repo size), and contradiction mapping (competing
  perspectives on TRaSH alignment vs internal format changes) that explain why the adapter path was
  chosen, useful for documenting trade-offs and alerting reviewers.
- /research/praxrr-additional-features/persona-findings/futurist.md: Persona research noting TRaSH’s
  format evolution (February 2026 breaking change), JSON ecosystem dominance, and recommended
  import/tracking approaches that can inform backlog prioritization, downstream analytics, and
  automation coverage.

## README Files

- _(none found: no README currently documents trash-guide-sync outside the `/docs/plans` folder;
  consider adding a README or README section that links to the plan docs above for quick
  onboarding)._

## Must-Read Documents

- /docs/plans/trash-guide-sync/feature-spec.md: Core architecture, business rules, edge cases, and
  success criteria—start here to understand why TRaSH must flow through PCD ops.
- /docs/plans/trash-guide-sync/research-technical.md: Component diagrams, data models, API
  endpoints, and integration points—essential for engineers wiring fetch/transform/cache/sync
  pieces.
- /docs/plans/trash-guide-sync/research-recommendations.md: Phasing, risk assessment, and upgrade
  path recommendations that steer implementation order and operational safety.
- /docs/plans/trash-guide-sync/research-external.md: TRaSH repository/JSON schema documentation plus
  downstream Arr API notes—must read before parsing or consuming upstream data.
- /docs/plans/trash-guide-sync/research-ux.md: UX flows for dashboard, previews, errors, and
  conflict resolution—required for anyone touching the UI.
- /research/data-schema/synthesis/technical-design.md: Adapter design/spec mappings for TRaSH → PCD
  (regex deduplication, field tables)—critical if you are building the transformer/migration layer.

## Documentation Gaps

- No README or high-level doc outside `docs/plans/trash-guide-sync/` references the feature; a
  developer hitting the repo without plan knowledge will miss the TRaSH plans entirely.
- Codebase lacks inline documentation/comments for the planned API routes
  (`packages/praxrr-app/src/routes/api/v1/trash-guide/...`) referenced in the docs—those files do
  not yet exist, so the plan relies solely on the spec PDF rather than code-level docs or
  interfaces.
- There is no consolidated doc summarizing required Arr API expectations (Radarr/Sonarr endpoints,
  field mappings) apart from the plan files; a reusable reference (maybe under
  `/packages/praxrr-app/README.md` or new `docs/api/`) would help implementation teams avoid manual
  lookups.
- External reference docs (TRaSH repo metadata, Recyclarr/Configarr guides) are noted in the plan
  but not mirrored in an internal summary or checklist, so tracking which upstream files/configs to
  monitor (e.g., metadata.json path changes) still requires reading multiple markdown sources.
