# Documentation Research: enhance-lidarr-support

## Architecture Docs

- `docs/ARCHITECTURE.md`: system architecture, PCD/sync/media-management structure.
- `docs/plans/enhance-lidarr-support/feature-spec.md`: issue-driven feature synthesis for first-class Lidarr entities.
- `docs/plans/enhance-lidarr-support/research-technical.md`: schema/entity/sync/API technical implications.
- `docs/plans/lidarr-support/shared.md`: prior Lidarr initiative context and relevant paths.

## API Docs

- `docs/api/v1/schemas/pcd.yaml`: portable/import/export schema contracts.
- `docs/api/v1/schemas/arr.yaml`: Arr endpoint payload schema references.
- `docs/api/v1/paths/arr.yaml`: Arr route behavior and identifiers.

## Development Guides

- `docs/DEVELOPMENT.md`: contribution workflow and conventions.
- `docs/plans/enhance-lidarr-support/research-recommendations.md`: staged rollout and risk mitigations.
- `docs/plans/enhance-lidarr-support/research-business.md`: business rules and success criteria.

## README Files

- `README.md`: project context and current focus areas.
- `packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr client architecture and usage.

## Must-Read Documents

- `docs/ARCHITECTURE.md`: You _must_ read this when changing media-management architecture.
- `docs/api/v1/schemas/pcd.yaml`: You _must_ read this when changing import/export entities.
- `docs/plans/enhance-lidarr-support/feature-spec.md`: You _must_ read this when planning scope/risks/acceptance.
- `docs/plans/lidarr-support/shared.md`: You _must_ read this for existing Lidarr patterns and known gaps.

## Documentation Gaps

- Architecture docs currently emphasize `radarr_*`/`sonarr_*` families and do not yet describe first-class `lidarr_*` entities.
- Portable API schema needs explicit first-class Lidarr entity contract coverage once cutover is implemented.
- Operator-facing migration guidance for legacy Sonarr-backed Lidarr configs should be added when implementation lands.
