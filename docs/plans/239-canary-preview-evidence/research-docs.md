# Documentation Research: Canary Remaining-Target Preview Evidence

## Architecture Docs

- `docs/plans/239-canary-preview-evidence/feature-spec.md` is the current
  issue-specific design synthesis. It defines the selected durable evidence
  model, exact-target promotion rule, null/corrupt behavior, migration/API/UI
  changes, phasing, and acceptance tests. Treat it as the implementation design
  source for #239, subordinate only to the GitHub issue if scope conflicts.
- `docs/plans/canary-sync-blast-radius/design.md` documents the original Canary
  architecture delivered for issue #19: two-phase orchestration, same-`arr_type`
  cohort selection, persisted rollout state, `state_token` guards, Sync History
  linkage, preview integration, and Abort-without-rollback semantics. It is
  important baseline context, but its exception-to-empty preview behavior is
  precisely what #239 supersedes.
- `docs/plans/canary-sync-blast-radius/plan.md` records the original dependency
  ordering, contracts, test strategy, and implementation paths. Use it to
  understand established boundaries and naming, not as authority for the new
  evidence contract.
- `docs/plans/transparent-automation-engine/analysis-architecture.md` places
  Canary within the broader transparent-automation initiative and helps
  distinguish planned preview evidence from confirmed execution evidence.
- `docs/internal-docs/automation-transparency-audit.md` is the most direct gap
  analysis. Its `direct.canary.start` row identifies the exact defect:
  remaining-preview failure becomes empty evidence that API consumers can
  confuse with no changes. It links the gap to issue #239 and separately marks
  Promote and Abort behavior, making it useful for regression boundaries.
- `docs/site/src/content/docs/app/sync-pipeline.md` documents preview as a
  read-only path, per-Arr section dispatch, bounded multi-instance previewing,
  and the separation between preview and execution. Its cross-Arr warning is
  directly relevant: Radarr, Sonarr, and Lidarr semantics must remain explicit.
- `docs/site/src/content/docs/app/architecture.md`,
  `docs/architecture/overview.md`, `docs/architecture/components.md`, and
  `docs/architecture/data-flow.md` provide general application context. They are
  secondary reading; #239 does not alter the overall app, job, or PCD
  architecture.

## API Docs

- `docs/api/v1/schemas/canary.yaml` is the source-of-truth portable schema for
  Canary DTOs. It currently defines `CanaryStartGated.remainingPreview` as a raw
  array and must be changed to the required versioned available/unavailable
  union. The rollout detail schema must expose the same persisted evidence after
  redirect/reload.
- `docs/api/v1/paths/canary.yaml` is the source-of-truth endpoint documentation
  for start, detail, Proceed, and Abort. It must describe fail-closed promotion
  when evidence is unavailable while preserving existing 400/404/409/422
  semantics and Abort behavior.
- `docs/api/v1/openapi.yaml` wires the Canary paths and schemas into the API. It
  is contract source, not a generated artifact.
- `packages/praxrr-api/openapi.json` is the bundled, dereferenced generated API
  artifact. It must be regenerated after source YAML changes; do not edit it as
  the primary source.
- `packages/praxrr-app/src/lib/api/v1.d.ts` is the generated application-side
  API type surface and must remain aligned with the OpenAPI source.
- `packages/praxrr-api/README.md` explains how consumers import the bundled spec
  and generated types. It confirms why schema changes must propagate through
  generation but requires no #239-specific prose unless package usage changes.
- `docs/api/README.md` explains the API documentation layout and generation
  workflow. Read it before updating or validating OpenAPI artifacts.

## Development Guides

- `CLAUDE.md` is the project development authority surfaced through `AGENTS.md`.
  For #239, the controlling rules are contract-first API work, generated type
  synchronization, migrations rather than reference-schema-only edits, Svelte 5
  without runes, explicit same-Arr validation, and portable contract fidelity.
- `docs/CONTRIBUTING.md` and the repository root contribution guidance define
  general validation and contribution expectations. They are useful for final
  checks but do not define Canary behavior.
- `docs/api/README.md` is the feature’s most relevant procedural guide because
  the implementation changes source OpenAPI, bundled OpenAPI, and generated
  TypeScript types.
- `packages/praxrr-app/src/lib/server/utils/arr/README.md` documents Arr-client
  conventions. It is only needed if preview-generation handling reaches into
  client construction; #239 should normally reuse the existing preview
  orchestrator and failure classifier without changing clients.

The issue’s explicit validation commands are authoritative for minimum
verification: focused `canaryCoordinator.test.ts`, focused
`routes/canary.test.ts`, and `deno task check`. The feature spec adds
migration/query coverage because persistence is the selected design.

## README Files

- `README.md` is the high-level product entry point. It does not currently
  document the #239 gate distinction and should not be expanded unless
  user-facing Canary behavior is described there already.
- `docs/README.md` and `docs/features/README.md` explain documentation
  organization; neither contains the detailed Canary contract.
- `packages/praxrr-api/README.md` is relevant to generated API consumption, as
  noted above.
- `packages/praxrr-db/README.md` and `packages/praxrr-schema/README.md` are not
  relevant: #239 changes the Praxrr application database, not the mirrored PCD
  database/schema packages.

## Must-Read Documents

1. GitHub issue `#239`, “[Task] transparent-automation | Canary | expose preview
   failures.” This is authoritative for scope, acceptance criteria, exclusions,
   and minimum tests. It requires explicit available/unavailable evidence, safe
   reasons/recovery, UI/API distinction, fail-closed promotion, retained Abort,
   exact same-Arr targeting, and unreachable/unauthorized/partial tests.
2. `docs/plans/239-canary-preview-evidence/feature-spec.md` for the agreed
   implementation contract and phasing.
3. `docs/internal-docs/automation-transparency-audit.md` for the originating
   evidence gap and confirmed/planned evidence distinction.
4. `docs/plans/canary-sync-blast-radius/design.md` for the original state
   machine, target scope, token guard, and rollback boundary that must remain
   intact.
5. `docs/api/v1/schemas/canary.yaml` and `docs/api/v1/paths/canary.yaml` for the
   portable API contract.
6. `docs/site/src/content/docs/app/sync-pipeline.md` for preview/execution
   separation and per-Arr dispatch rules.
7. `ROADMAP.md` entries for PR #218/issue #19 and PR #253/issue #235. These
   verify that Canary and typed preview-failure evidence already shipped
   separately. ROADMAP is authoritative as release history/status, not as #239
   implementation requirements.

Runtime code comments in
`packages/praxrr-app/src/lib/server/sync/canary/coordinator.ts`,
`packages/praxrr-app/src/lib/server/db/queries/canaryRollouts.ts`, and
`packages/praxrr-app/src/lib/server/sync/preview/failureReason.ts` accurately
describe the current implementation and safety intent. They are not standalone
product contracts; current executable code and tests are authoritative for
behavior, and comments must be updated when #239 removes exception-to-empty
semantics.

## Documentation Gaps

- There is no dedicated published Canary user guide explaining
  available-with-no-changes versus unavailable evidence, safe recovery, and
  Abort-not-rollback. The detail UI will carry the immediate guidance, but a
  site guide is a reasonable follow-up.
- The original Canary design describes a live preview and tolerates preview
  failure by degrading to `[]`; it will become historically stale. Add a short
  supersession note linking issue #239 rather than rewriting the original design
  record.
- `docs/site/src/content/docs/app/sync-pipeline.md` describes accumulated
  preview errors generically but not the closed `SyncPreviewFailureReason`
  vocabulary or aggregate `sectionErrors` rule. A targeted update would improve
  architecture documentation after implementation.
- The API docs currently do not define a Canary-specific unavailable-evidence
  response or a named Proceed conflict. Source schemas and path descriptions
  must be updated together.
- `ROADMAP.md` has the foundations (#19 and #235) but not yet #239. Add the
  resulting PR entry only when implementation ships; do not mark completion
  during planning.
- Code comments currently promise a “live preview” and document catch-to-empty
  behavior. Update them with the durable evidence and fail-closed promotion
  policy in the implementation change.
