# Documentation Research: praxrr-parser-go

## Architecture Docs

- `docs/ARCHITECTURE.md`: Describes the overall Praxrr architecture, explicitly naming the parser service, where parser-related modules live (`packages/praxrr-parser/`), the runtime stack, PCD cache/operations, and how the parser fits into deploy/test flows.
- `docs/plans/praxrr-parser-go/feature-spec.md`: Provides the parser-specific architecture vision for the Go rewrite, covering API contract, regex inventory, QoS requirements, integration points, and the recommended drop-in HTTP microservice design.
- `docs/plans/praxrr-parser-go/research-technical.md`: Details the technical architecture for the Go parser (data models, Go module layout, regex migration strategy, CI/docker changes, and HTTP endpoint contracts).

## API Docs

- `docs/api/v1/openapi.yaml`: Defines the `/parse`, `/match`, `/match/batch`, and `/health` endpoints that the parser exposes (referenced by the existing TypeScript client); helpful to verify request/response schemas and ensure any rewrite keeps the API contract.

## Development Guides

- `docs/DEVELOPMENT.md`: Explains release cadence, branching rules, and tooling expectations (currently still references the .NET parser workflow but is the canonical development playbook, so understanding parser-related task timing/live deployments matters).
- `docs/CONTRIBUTING.md`: Points readers to `docs/ARCHITECTURE.md`, reiterates parser prerequisites (.NET SDK mention indicates parser dependency), and sets expectations about updating documentation when behavior changes—important when planning parser changes.
- `docs/plans/praxrr-parser-go/research-recommendations.md`: Maps out the phased plan (test infrastructure, port, integration, cleanup), evaluates technology options (Go vs. TS), identifies risks (regex parity), and lists tasks, making it a de facto development guide for implementing `praxrr-parser-go`.

## README Files

- `README.md`: Root overview referencing the parser service (Docker compose example, environment variables like `PARSER_HOST`/`PARSER_PORT`, note that the parser is optional but required for CF/QP testing) and links to auth documentation—sets context for the parser’s role in deployment.
- `packages/praxrr-app/src/lib/server/utils/arr/README.md`: Documents the arr HTTP client utilities that currently call the parser; useful to understand how the parser API is consumed and what needs updating if the service changes.
- `packages/praxrr-app/src/lib/server/utils/auth/README.md`: While centered on auth, it’s referenced from the root README and clarifies API/key expectations that also govern parser interactions through the same auth layer.

## Must-Read Documents

- `docs/ARCHITECTURE.md` (overall system architecture, parser positioning, caches, and parser service description).
- `docs/plans/praxrr-parser-go/feature-spec.md` (executor summary, API requirements, regex inventory, and the recommended Go rewrite path).
- `docs/plans/praxrr-parser-go/research-technical.md` (concrete Go implementation plan including data models, regex migration strategy, HTTP handlers, build/docker plans, and CI implications).
- `docs/plans/praxrr-parser-go/research-recommendations.md` (phase-by-phase implementation strategy, risk matrix, and why TypeScript/Deno port with a possible regexp2 shim is preferred).
- `docs/api/v1/openapi.yaml` (current parser API contract to keep unchanged during implementation).

## Documentation Gaps

- No dedicated parser worklog/documents describe existing parser tests or the lack thereof—implementers must create their own fixture/test corpus (current repo has zero parser-specific tests).
- API documentation (beyond the openapi spec) lacks detailed descriptions of parser endpoints’ behavior (timeouts, error handling) and the caching strategy used by the main app—those need updates once `praxrr-parser-go` is implemented.
- There is no developer guide documenting how to run or build the parser rewrite (e.g., Go build steps, Docker updates, CI workflow changes) outside of the research notes; this should be formalized once the new parser is wired into the repo.
