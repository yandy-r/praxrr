# Documentation Research: lidarr-metadata-profiles

## Architecture Docs

- `docs/ARCHITECTURE.md`: Core architecture, Arr-cutover policy, sync/PCD integration standards.
- `docs/plans/lidarr-metadata-profiles/feature-spec.md`: Feature requirements, target files, acceptance checklist.
- `docs/plans/lidarr-metadata-profiles/research-technical.md`: Technical decomposition across schema, entities, sync, API, and UI.

## API Docs

- `docs/api/v1/openapi.yaml`: Current API contract source; metadata profile endpoints are not yet modeled and will need updates.
- `docs/plans/lidarr-metadata-profiles/research-external.md`: Lidarr endpoint and payload research (`/api/v1/metadataprofile*`).
- `docs/plans/lidarr-metadata-profiles/research-recommendations.md`: Integration recommendations and contract alignment notes.

## Development Guides

- `docs/CONTRIBUTING.md`: Contribution workflow and links to architecture references.
- `docs/DEVELOPMENT.md`: Branching/release process and development conventions.
- `docs/todo/op-splitting-checklist.md`: Useful guidance for operation granularity in PCD change design.

## README Files

- `README.md`: Product-level context, Arr scope, and key project concepts.
- `src/lib/server/utils/auth/README.md`: API auth behavior context for new route handlers.

## Must-Read Documents

- `docs/plans/lidarr-metadata-profiles/feature-spec.md`: You _must_ read this when implementing scope, constraints, and acceptance criteria.
- `docs/plans/lidarr-metadata-profiles/research-technical.md`: You _must_ read this when mapping implementation to concrete files and table contracts.
- `docs/plans/lidarr-metadata-profiles/research-external.md`: You _must_ read this when implementing Lidarr payload mapping and endpoint calls.
- `docs/ARCHITECTURE.md`: You _must_ read this when enforcing Arr-specific semantics and cutover guardrails.
- `docs/api/v1/openapi.yaml`: You _must_ read this when documenting new API routes or schema updates.

## Documentation Gaps

- No current OpenAPI paths document `lidarr-metadata-profiles` PCD endpoints; this must be added when routes are implemented.
- No dedicated user/developer doc exists for metadata profile sync configuration UX in `src/routes/arr/[id]/sync`.
- Existing plan research mentions both 12 and 13 secondary album types in different places; final implementation docs should normalize the authoritative enum source.
- No runbook doc exists for migration verification specific to this feature; add one if rollout risk increases.
