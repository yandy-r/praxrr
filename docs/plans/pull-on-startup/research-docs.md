# Documentation Research: pull-on-startup

## Architecture Docs

- `/docs/ARCHITECTURE.md`: Core runtime architecture, startup lifecycle, PCD, jobs, and sync integration.
- `/docs/architecture/overview.md`: System component map and boot-time flow.
- `/docs/architecture/data-flow.md`: PCD sync and Arr sync data paths relevant to startup pull placement.
- `/docs/architecture/components.md`: Responsibilities and boundaries for startup, jobs, and sync subsystems.
- `/docs/plans/pull-on-startup/feature-spec.md`: Current feature contract and expected behavior.
- `/docs/plans/pull-on-startup/research-technical.md`: Proposed implementation architecture, constraints, and tests.
- `/docs/plans/initiate-apps/feature-spec.md`: Startup env-driven reconciliation precedent.

## API Docs

- `/docs/api/README.md`: API documentation map and source-of-truth references.
- `/docs/api/endpoints.md`: Existing endpoint catalog and behavior.
- `/docs/api/authentication.md`: Auth requirements for system/status APIs.
- `/docs/api/errors.md`: Error shape and status code conventions.
- `/docs/api/v1/openapi.yaml`: Contract file to extend if adding startup-pull status endpoint.

## Development Guides

- `/docs/DEVELOPMENT.md`: Dev workflow, validation commands, and local run guidance.
- `/docs/CONTRIBUTING.md`: Conventions and contribution requirements.
- `/docs/features/link-bridge-sync.md`: Existing sync trigger model and operator workflows.
- `/docs/plans/radarr-pull-resources/feature-spec.md`: Pull-resource planning precedent.
- `/docs/plans/sonarr-pull-resources/feature-spec.md`: Sonarr pull-resource planning precedent.

## README Files

- `/README.md`: Environment variables and runtime overview.
- `/docs/README.md`: Docs directory index.
- `/docs/features/README.md`: Feature docs map.
- `/packages/praxrr-app/src/lib/server/utils/arr/README.md`: Arr client structure and conventions.
- `/packages/praxrr-api/README.md`: API package usage and contract tooling.
- `/packages/praxrr-db/README.md`: PCD database package context.
- `/packages/praxrr-schema/README.md`: Schema package context and mapping references.

## Must-Read Documents

- **`/docs/plans/pull-on-startup/feature-spec.md`**: You _must_ read this for feature scope, acceptance criteria, and startup behavior rules.
- **`/packages/praxrr-app/src/hooks.server.ts`**: You _must_ read this for real startup sequencing and non-blocking failure patterns.
- **`/packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`**: You _must_ read this for startup reconciliation patterns and Arr instance handling semantics.
- **`/packages/praxrr-app/src/lib/server/jobs/handlers/pcdSync.ts`**: You _must_ read this for pull-like background execution and job result conventions.
- **`/packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`**: You _must_ read this for Arr-type dispatch and section-level sync guardrails.
- **`/docs/ARCHITECTURE.md`**: You _must_ read this for system boundaries before changing startup integration points.
- **`/docs/api/v1/openapi.yaml`**: You _must_ read this when adding or modifying `/api/v1` startup-status endpoints.

## Documentation Gaps

- Startup placement guidance is inconsistent across existing planning docs (before vs after jobs init).
- Feature flag naming appears as both `PULL_ON_START` and `PULL_ON_STARTUP`; canonical naming needs one decision.
- No finalized default-detection catalog document exists per Arr/entity combination.
- No dedicated troubleshooting/runbook doc currently describes startup pull conflict recovery and retry flows.
