# Documentation Research: monorepo-strategy

## Architecture Docs

- /docs/plans/monorepo-strategy/feature-spec.md: Captures the mission, business requirements, workflows, success criteria, and high-level architecture for adding `packages/praxrr-db`/`packages/praxrr-schema` while keeping the app at the repo root. Includes dependency inventories, CI/publish expectations, configuration changes, and explicit edge cases for implementing the strategy.
- /docs/plans/monorepo-strategy/research-technical.md: Deep dive on the directory restructure, workspace configuration, deno.json/tsconfig/svelte config implications, Docker/CI adjustments, and release pipeline updates needed (plus hardcoded-file call-outs and risk analysis). Treats the migration as a step-by-step technical specification with phase breakdowns.
- /docs/plans/monorepo-strategy/research-business.md: Documents maintainer/contributor/end-user stories, business rules (manifest contract, auto-link defaults, ops layering), current vs proposed workflows, domain model, and coupling points that any implementer must understand before touching the stack.

## API Docs

- _None currently document the monorepo strategy; the new packages do not yet expose API-level docs in `docs/api/v1` or similar. An API-focused summary of the PCD system behaviour under the monorepo would fill this gap._

## Development Guides

- /docs/plans/monorepo-strategy/research-ux.md: Maps the preferred developer workflow (single clone + `deno task dev`), testing/commit conventions, onboarding docs (root README, per-package READMEs, CONTRIBUTING updates), and post-cutover communication plan (README banners, changelog entries, cutover runbook).
- /docs/plans/monorepo-strategy/research-recommendations.md: Recommends the phased rollout, workspace + publish tooling choices, configurable defaults, type-generation safeguards, contract-testing ideas, and detailed CI/publish risk mitigation steps for the monorepo strategy.
- /docs/plans/monorepo-strategy/research-external.md: Aggregates authoritative external references (Deno workspace docs, Git subtree/split strategies, release-please guidance, monorepo CI practices) and translates them into actionable guidance about workspaces, import maps, task orchestration, subtree mirroring, and release automation.

## README Files

- /README.md: Current root README reviews the app in its pre-migration state but does not describe the new workspace layout or packages. The feature spec and UX research explicitly call for updates that explain the monorepo structure and new workspace commands.

## Must-Read Documents

- /docs/plans/monorepo-strategy/feature-spec.md: Alignment on the migration goal, CI gates, mirror expectations, and success criteria; every implementer should internalize this first.
- /docs/plans/monorepo-strategy/research-technical.md: The canonical technical playbook for directory moves, workspace definitions, config rewrites, and CI/publish workflow adjustments.
- /docs/plans/monorepo-strategy/research-ux.md: Guides how developers should experience the monorepo (workflows, onboarding docs, commit conventions, contributor-facing changelog/communication needs).

## Documentation Gaps

- No dedicated API doc explaining how the monorepo affects the PCD APIs, schema type generation script, or manifest contracts; consider adding a `docs/api/monorepo` section or augmenting existing API docs.
- The root README, package-level READMEs, and CONTRIBUTING/CLAUDE.md still lack the monorepo layout, workspace commands, and config guidance described in the research documents; these need explicit updates before the transition ships.
- Inline code comments/architecture notes do not yet highlight the monorepo-specific assumptions (hooks defaults, `generate-pcd-types.ts`, `dependencies.ts` parsing). Documenting the new env vars and workspace hooks near the code would help future maintainers.
- No public runbook/ADR in `docs/` captures the rationale/decision for this redesign; translating the business research context into a concise ADR or onboarding note would protect institutional knowledge.
