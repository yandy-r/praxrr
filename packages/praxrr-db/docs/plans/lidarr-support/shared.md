# Lidarr Support

Lidarr support in this repository is a SQL-first extension of existing Praxrr database publication
patterns: add `lidarr` as an arr type, then seed compatible rows with idempotent ops. The core
integration boundary is unchanged: `praxrr-db` publishes arr-scoped data and `yandy-r/praxrr`
consumes it to drive Arr API interactions, so rollout safety depends on consumer readiness before
data publication. Existing Radarr/Sonarr conventions (ordered ops files, `arr_type` discriminators,
guarded inserts/updates) are the primary implementation model for v1. Schema choices for
Lidarr-specific entities remain constrained by the external dependency declared in `pcd.json`, so
shared-table extension is the preferred initial path unless schema validation requires dedicated
`lidarr_*` structures.

## Relevant Files

- /pcd.json: Source of supported `arr_types` and `praxrr.minimum_version` release gate.
- /README.md: Public support-surface documentation to update when Lidarr support is published.
- /docs/plans/lidarr-support/feature-spec.md: Canonical scope, constraints, architecture, and
  decision points.
- /docs/plans/lidarr-support/research-technical.md: Technical model and file-level impact guidance
  for Lidarr rollout.
- /docs/plans/lidarr-support/research-business.md: Business rules and acceptance criteria for
  compatibility-first delivery.
- /docs/plans/lidarr-support/research-external.md: External API and integration contract references
  for Lidarr.
- /docs/plans/lidarr-support/research-recommendations.md: Phased rollout and risk-mitigation
  strategy.
- /docs/plans/lidarr-support/research-ux.md: Workflow and error-recovery expectations that shape
  release readiness.
- /ops/0.rosettarr.sql: Baseline seeded entities and app-specific table families referenced by
  technical research.
- /ops/24.1080p-balanced-score-refactor-add-hdtv-fallbacks.sql: Concrete idempotent insert pattern
  with `arr_type` guards.
- /ops/30.fix-720p-web-dl-scoring.sql: Mixed update/insert pattern over
  `quality_profile_custom_formats` by arr type.
- /ops/34.add-remux-negation-to-release-group-missing.sql: `custom_format_conditions` insert pattern
  using explicit arr typing.

## Relevant Tables

- `quality_profile_custom_formats`: Core arr-scoped profile-to-custom-format scoring table to extend
  with `lidarr` rows.
- `custom_format_conditions`: Condition-level arr-scoped behavior that may need Lidarr-compatible
  entries.
- `custom_formats`: Base custom-format definitions referenced by profile mappings.
- `radarr_media_settings`: Existing app-specific media settings baseline used to evaluate Lidarr
  modeling strategy.
- `sonarr_media_settings`: Existing app-specific media settings baseline used to evaluate Lidarr
  modeling strategy.
- `radarr_quality_definitions`: Existing quality-definition structure that informs Lidarr mapping
  parity decisions.
- `sonarr_quality_definitions`: Existing quality-definition structure that informs Lidarr mapping
  parity decisions.

## Relevant Patterns

**Idempotent Arr-Type Seeding**: Use additive SQL operations with restrictive predicates and
`NOT EXISTS` checks so replays converge safely without duplicate rows. Example:
[`ops/24.1080p-balanced-score-refactor-add-hdtv-fallbacks.sql`](ops/24.1080p-balanced-score-refactor-add-hdtv-fallbacks.sql).

**Arr-Type Discriminator Expansion**: Extend existing shared-table behavior by adding new `arr_type`
rows (instead of changing query shape), coupled with manifest metadata updates. Examples:
[`pcd.json`](pcd.json), [`ops/30.fix-720p-web-dl-scoring.sql`](ops/30.fix-720p-web-dl-scoring.sql).

**Ordered Operation Evolution**: Introduce changes via next-numbered `ops/*.sql` files and keep
operation blocks explicit and reviewable. Example:
[`ops/34.add-remux-negation-to-release-group-missing.sql`](ops/34.add-remux-negation-to-release-group-missing.sql).

**Compatibility-Gated Rollout**: Gate publication of new arr-type data behind documented consumer
compatibility and minimum-version enforcement. Examples: [`pcd.json`](pcd.json),
[`docs/plans/lidarr-support/research-recommendations.md`](docs/plans/lidarr-support/research-recommendations.md).

## Relevant Docs

**`docs/plans/lidarr-support/feature-spec.md`**: You _must_ read this when working on Lidarr scope,
architecture, release-gate decisions, and success criteria.

**`docs/plans/lidarr-support/research-technical.md`**: You _must_ read this when designing SQL/table
strategy and deciding shared vs dedicated Lidarr entities.

**`docs/plans/lidarr-support/research-business.md`**: You _must_ read this when validating business
rules, user stories, and compatibility acceptance criteria.

**`docs/plans/lidarr-support/research-external.md`**: You _must_ read this when mapping Lidarr API
concepts to seeded database data.

**`docs/plans/lidarr-support/research-recommendations.md`**: You _must_ read this when sequencing
rollout phases and risk mitigations.

**`AGENTS.md`**: You _must_ read this when authoring ops files, numbering operations, and running
repository-standard validation commands.
