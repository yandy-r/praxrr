# Documentation Research: pcd-data-migration-2

## Architecture Docs

- `docs/ARCHITECTURE.md`: overall platform architecture and subsystem boundaries.
- `docs/architecture/components.md`: component map including PCD manager/import/sync areas.
- `docs/architecture/data-flow.md`: lifecycle and data-flow diagrams relevant to compile/import.
- `docs/plans/pcd-data-migration-2/feature-spec.md`: feature scope and acceptance baseline.

## API Docs

- `docs/api/README.md`: API doc index and usage patterns.
- `docs/api/endpoints.md`: route-level endpoint narratives including PCD import/export.
- `docs/features/portable-import-export.md`: portable entity workflow and behavioral contract.
- `docs/api/v1/openapi.yaml` and related path docs: strict API schema references.

## Development Guides

- `docs/plans/pcd-data-migration-2/research-business.md`: user stories and business constraints.
- `docs/plans/pcd-data-migration-2/research-technical.md`: technical architecture and gap analysis.
- `docs/plans/pcd-data-migration-2/research-recommendations.md`: phased delivery and risk guidance.
- `docs/plans/pcd-data-migration-2/research-ux.md`: CLI/reporting/authoring UX guidance.
- `docs/plans/pcd-data-migration-2/research-external.md`: dependency and external reference notes.

## README Files

- `README.md`: root project overview and key links.
- `docs/README.md`: documentation hub and navigation.
- `docs/features/README.md`: feature-guide index.
- `packages/praxrr-schema/README.md`: schema-layer ownership and seed-data behavior.

## Must-Read Documents

- `docs/plans/pcd-data-migration-2/feature-spec.md`: required for scope, deliverables, and success
  criteria.
- `docs/plans/pcd-data-migration-2/research-technical.md`: required for concrete integration points
  and data model mappings.
- `docs/features/portable-import-export.md`: required to maintain compatibility with existing
  portable entity contracts.

## Documentation Gaps

- No finalized operator-facing guide for planned converter/parity CLI commands.
- Non-entity migration files (`tags.yaml`, `quality-api-mappings.yaml`) are acknowledged in code but
  lack full implementation and operator documentation.
- CI parity workflow documentation is not yet standardized into a single runbook.
