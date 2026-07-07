# Praxrr Roadmap

Reviewed: 2026-07-06 (updated after progressive complexity architecture #29 / #203 shipped)

Source: open GitHub issues in `yandy-r/praxrr` as of this review.

## Roadmap Principles

This roadmap orders open issues by delivery value, dependency order, and release risk. GitHub labels
are still respected, but they are not the only sorting rule.

- Stabilize recently shipped foundations before expanding the product surface.
- Prioritize safety, explainability, and recovery before advanced automation.
- Keep user onboarding work near the top because Praxrr's value depends on users completing setup.
- Treat Arr app semantics as app-specific. Do not hide Radarr, Sonarr, Lidarr, or future app
  differences behind shared assumptions.
- Keep deferred ecosystem ideas visible, but do not let them compete with v2 readiness work.

## Priority Legend

- **P0 - Current focus:** Do next. These reduce near-term regression or release risk.
- **P1 - Core product differentiation:** High-value features that make Praxrr easier to understand
  and trust.
- **P2 - Lifecycle safety:** Features that make Praxrr safer as the number of managed instances
  grows.
- **P3 - Advanced capabilities:** Valuable after the core lifecycle is reliable.
- **P4 - Maintenance and cost reduction:** Useful engineering work that should not block user-facing
  priorities.
- **Deferred:** Keep parked until explicit promotion criteria are met.

## Current Decision

The best next order is:

1. Finish remaining documentation content (#75 as needed).
2. Build onboarding and transparency features.
3. Build configuration lifecycle safety.
4. Add advanced automation, trust, and integration features.
5. Handle parser migration and deferred ecosystem expansion only when they become release or
   maintenance blockers.

Phase 1 safety work from the research backlog is complete: Sync Preview/Dry-Run, API Key Masking,
Encrypted API Key Storage, PCD State Snapshots, Progressive Disclosure rollout, Progressive Complexity
Architecture (#29, #203), Score Simulator (phases 1–3), TRaSH Guide Sync PR-122 hardening
(#125, #126, #194), and docs infrastructure (#38). The open roadmap should not restart those
completed issues.

## Recently Shipped

Merged work since the Score Simulator and TRaSH Guide Sync foundations landed.

| Date       | PR / commit                                        | Summary                                                                                                                                     | Closes / relates                                     |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 2026-07-06 | [#203](https://github.com/yandy-r/praxrr/pull/203) | Progressive complexity architecture: tier model, disclosure modes, section preferences API, `userComplexityTiers` store, and E2E coverage   | [#29](https://github.com/yandy-r/praxrr/issues/29)   |
| 2026-07-06 | [#201](https://github.com/yandy-r/praxrr/pull/201) | App technical documentation: 8 contributor pages (architecture, startup, development, PCD, jobs, sync, notifications, testing) with Mermaid | [#77](https://github.com/yandy-r/praxrr/issues/77)   |
| 2026-07-06 | [#200](https://github.com/yandy-r/praxrr/pull/200) | PCD schema per-table reference: 42 table pages with columns, relationships, constraints, and cross-links                                    | [#73](https://github.com/yandy-r/praxrr/issues/73)   |
| 2026-07-06 | [#199](https://github.com/yandy-r/praxrr/pull/199) | PCD database content docs: 253 custom formats, quality profile presets, release/delay profiles, Lidarr guide, changelog, sidebar wiring     | [#76](https://github.com/yandy-r/praxrr/issues/76)   |
| 2026-07-06 | [#198](https://github.com/yandy-r/praxrr/pull/198) | User-facing Getting Started and Guides (10 pages): install, configure, sync, upgrade, troubleshooting                                       | [#74](https://github.com/yandy-r/praxrr/issues/74)   |
| 2026-07-05 | `bf50467e`, `0f324ddd`, `56b359a9`                 | Docs deploy CI: Workers Assets deployment, wrangler config loading, and deploy trigger                                                      | [#38](https://github.com/yandy-r/praxrr/issues/38)   |
| 2026-07-05 | [#195](https://github.com/yandy-r/praxrr/pull/195) | Reject NUL bytes in TRaSH metadata paths with typed `TrashGuideFetcherError`                                                                | [#194](https://github.com/yandy-r/praxrr/issues/194) |
| 2026-07-05 | [#196](https://github.com/yandy-r/praxrr/pull/196) | Astro Starlight documentation site with OpenAPI generation, mirror-doc imports, docs CI, Cloudflare Pages wiring, and dispatches            | [#38](https://github.com/yandy-r/praxrr/issues/38)   |
| 2026-07-05 | [#193](https://github.com/yandy-r/praxrr/pull/193) | Test coverage for 8 TRaSH modules (~137 tests): fetcher, sync job, manager, sources route, transformers, parser, trash-id mappings          | [#125](https://github.com/yandy-r/praxrr/issues/125) |
| 2026-07-05 | [#191](https://github.com/yandy-r/praxrr/pull/191) | Type design hardening: narrow `arr_type`, consolidate parse helpers, boolean `enabled`/`auto_pull` at query boundary                        | [#126](https://github.com/yandy-r/praxrr/issues/126) |
| 2026-07-05 | [#192](https://github.com/yandy-r/praxrr/pull/192) | Fix pre-existing CI failures: lint-docs, lint-shell, autofix workflow                                                                       | Relates to #126                                      |
| 2026-07-05 | `177451b3`                                         | Shared lint/format tooling (`scripts/style.sh`) with CI workflows                                                                           | —                                                    |
| 2026-07-05 | `6c9f75c0`                                         | Remove Claude review workflows                                                                                                              | —                                                    |
| 2026-07-05 | `e5b4e260`                                         | Add project roadmap                                                                                                                         | —                                                    |
| 2026-07-05 | `2bb21043`                                         | Version management script and UI version display fix                                                                                        | —                                                    |
| 2026-03-08 | [#190](https://github.com/yandy-r/praxrr/pull/190) | Score Simulator phase 3                                                                                                                     | Score Simulator                                      |
| 2026-03-06 | [#184](https://github.com/yandy-r/praxrr/pull/184) | Score Simulator phase 2: batch input, profile comparison, ranking table                                                                     | Score Simulator                                      |
| 2026-03-05 | [#176](https://github.com/yandy-r/praxrr/pull/176) | Score Simulator phase 1                                                                                                                     | #171–#175                                            |
| 2026-03-04 | [#170](https://github.com/yandy-r/praxrr/pull/170) | Progressive Disclosure rollout across form and settings pages                                                                               | Progressive Disclosure                               |
| 2026-03-02 | [#164](https://github.com/yandy-r/praxrr/pull/164) | Persist advanced section visibility preferences                                                                                             | Progressive Disclosure                               |

## P0 - Current Focus: Documentation Foundation

Goal: make Praxrr understandable enough for users and contributors to run, debug, and extend it.

| Order | Issue                                                                               | Priority | Decision                                                                                                                                              | Done When                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1     | [#74](https://github.com/yandy-r/praxrr/issues/74) User-facing guides and tutorials | Medium   | **Done** — Getting Started and Guides pages shipped on docs.praxrr.dev.                                                                               | Users can install, configure, connect Arr instances, link a PCD, sync, upgrade, and troubleshoot from published docs.        |
| 2     | [#76](https://github.com/yandy-r/praxrr/issues/76) PCD database content docs        | Medium   | **Done** — Custom formats catalog (253 CFs), quality profile presets, release/delay profiles, Lidarr guide, and changelog shipped on docs.praxrr.dev. | Users can understand available custom formats, quality profiles, release profiles, Lidarr status, and PCD data organization. |
| 3     | [#73](https://github.com/yandy-r/praxrr/issues/73) PCD schema table reference       | Medium   | **Done** — Per-table schema reference for all 42 PCD tables shipped on docs.praxrr.dev ([#200](https://github.com/yandy-r/praxrr/pull/200)).          | All 42 PCD tables have reference pages with columns, relationships, constraints, and cross-links.                            |
| 4     | [#77](https://github.com/yandy-r/praxrr/issues/77) App technical documentation      | Low      | **Done** — Eight contributor pages shipped on docs.praxrr.dev ([#201](https://github.com/yandy-r/praxrr/pull/201)).                                   | Job system, sync pipeline, PCD ops, tests, notifications, and startup sequence are documented.                               |
| 5     | [#75](https://github.com/yandy-r/praxrr/issues/75) UI component library reference   | Low      | **Done** — Reusable `$ui` components, alert patterns, dirty tracking, and Tailwind conventions are documented.                                          |                                                                                                                              |

## Completed: TRaSH Guide Sync Stabilization

Goal: make the TRaSH Guide Sync pipeline safe to keep building on. **Closed 2026-07-05** (#125, #126, #194).

| Issue                                                                                  | PR   | Outcome                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#126](https://github.com/yandy-r/praxrr/issues/126) TRaSH Guide Sync type design gaps | #191 | `arr_type` narrowed to supported TRaSH apps, parse logic consolidated, boolean conversion normalized at the query boundary.                                                 |
| [#125](https://github.com/yandy-r/praxrr/issues/125) TRaSH Guide Sync test gaps        | #193 | ~137 tests across fetcher, sync job, manager, sources route, transformers, parser, and trash-id mappings; git error classification, path security, and error paths covered. |
| [#194](https://github.com/yandy-r/praxrr/issues/194) NUL-byte metadata path guard      | #195 | `normalizeMetadataPath` rejects embedded NUL bytes with typed `TrashGuideFetcherError` instead of surfacing raw filesystem errors.                                          |

## P1 - Core Product Differentiation: Onboarding and Transparency

Goal: help users understand what Praxrr will do before they trust it with their Arr instances.

| Order | Issue                                                                                  | Priority | Decision                                                                                                                                                                                                | Done When                                                                                                             |
| ----- | -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | [#29](https://github.com/yandy-r/praxrr/issues/29) Progressive Complexity Architecture | Medium   | **Done** — Tier model, disclosure modes, section preferences API, and reveal rules shipped ([#203](https://github.com/yandy-r/praxrr/pull/203)). Builds on Progressive Disclosure rollout (#164, #170). | Beginner and advanced surfaces have clear reveal rules, and new feature designs follow the same complexity model.     |
| 2     | [#12](https://github.com/yandy-r/praxrr/issues/12) Setup Wizard                        | High     | First user-facing feature in this phase. It addresses first-run abandonment directly.                                                                                                                   | A new user can connect the first Arr instance, link a PCD, and reach the first successful sync through a guided flow. |
| 3     | [#14](https://github.com/yandy-r/praxrr/issues/14) Cross-Arr Parity Map                | Medium   | Build before deeper cross-Arr automation so semantic differences are visible.                                                                                                                           | Users can see app compatibility for config entities and understand Radarr/Sonarr/Lidarr differences before sync.      |
| 4     | [#25](https://github.com/yandy-r/praxrr/issues/25) Resolved Config Viewer              | High     | Build as the desired-state visibility foundation.                                                                                                                                                       | Users can inspect base ops + user ops + overrides as Praxrr's final desired state.                                    |
| 5     | [#26](https://github.com/yandy-r/praxrr/issues/26) Dependency Graph                    | High     | Build after or with #25 because dependency edges are easier to explain from resolved state.                                                                                                             | Users can see which entities depend on which profiles, formats, qualities, and mappings.                              |
| 6     | [#30](https://github.com/yandy-r/praxrr/issues/30) Configuration Impact Simulator      | Medium   | Build the basic simulator after #25/#26 so simulations can explain inputs and impact.                                                                                                                   | Users can test score/profile changes and understand likely release-selection or sync impact before applying changes.  |

Notes:

- #25, #26, and #30 should share model work where possible. Avoid three separate interpretations of
  "resolved config."
- #14 is both UX and correctness work. It supports the cross-Arr semantic validation policy.
- #29 is shipped (#203). Treat the tier model and disclosure modes as the design constraint for all
  new UI in this phase. Progressive Disclosure UI rollout (#164, #170) remains the foundation.
- Score Simulator (phases 1–3, #176/#184/#190) is shipped and can inform #30, but #30 still covers
  broader profile/sync impact beyond release-title scoring.

## P2 - Lifecycle Safety: Detect, Explain, Recover

Goal: make Praxrr trustworthy after setup, especially when managing multiple Arr instances.

| Order | Issue                                                                                | Priority | Decision                                                                                                    | Done When                                                                                                              |
| ----- | ------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1     | [#24](https://github.com/yandy-r/praxrr/issues/24) Resilient Arr API Adapter Layer   | Medium   | Promote ahead of several high-priority lifecycle features because they depend on reliable Arr reads/writes. | Arr API version differences are isolated behind explicit adapters with graceful degradation and app-specific behavior. |
| 2     | [#15](https://github.com/yandy-r/praxrr/issues/15) Drift Detection Dashboard         | High     | First lifecycle safety feature after adapter confidence.                                                    | Praxrr can compare desired state to Arr state and show drift by instance/profile/entity.                               |
| 3     | [#17](https://github.com/yandy-r/praxrr/issues/17) Sync History / Audit Trail        | Medium   | Build before advanced timeline work and before canary sync needs richer history.                            | Sync operations record what changed, where, when, who/what triggered it, and success/failure details.                  |
| 4     | [#16](https://github.com/yandy-r/praxrr/issues/16) Rollback / Point-in-Time Restore  | High     | Build after snapshots are proven and audit records identify restore points.                                 | Users can restore a known-good PCD state and understand what will be re-synced.                                        |
| 5     | [#19](https://github.com/yandy-r/praxrr/issues/19) Canary Sync / Blast Radius Safety | High     | Build after drift, audit, and rollback foundations exist.                                                   | Users can sync one canary instance, verify, then roll out safely to more instances.                                    |
| 6     | [#27](https://github.com/yandy-r/praxrr/issues/27) Sync Archaeology Timeline         | High     | Build as the visual layer on top of #16 and #17, not as the source of truth.                                | Users can inspect a timeline of syncs, snapshots, rollbacks, and config changes.                                       |

Notes:

- #24 is only labeled medium, but it should be scheduled early if lifecycle features touch Arr API
  behavior.
- #16 depends on reliable snapshot semantics and clear restore UX. Do not ship restore flows that make
  it unclear what will happen on the next sync.
- #27 should be delayed until audit and rollback events exist as structured data.

## P3 - Advanced Capabilities: Automation, Trust, and Integrations

Goal: add higher-level intelligence after the core lifecycle is explainable and recoverable.

| Order | Issue                                                                                        | Priority | Decision                                                                                              | Done When                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1     | [#21](https://github.com/yandy-r/praxrr/issues/21) Transparent Automation Engine             | High     | Treat as a product principle during earlier phases, then formalize once audit/visibility data exists. | Automated actions show inputs, decisions, outputs, and failure reasons in user-facing language.               |
| 2     | [#20](https://github.com/yandy-r/praxrr/issues/20) Quality Goals                             | High     | Build after resolved config and simulator work can validate intent-to-score translation.              | Users can choose plain-language goals and inspect the exact technical configuration produced.                 |
| 3     | [#22](https://github.com/yandy-r/praxrr/issues/22) Config Health Scoring                     | Medium   | Build after drift and audit data exist.                                                               | Health scores are explainable, actionable, and based on observable config state rather than vague heuristics. |
| 4     | [#28](https://github.com/yandy-r/praxrr/issues/28) Ecosystem Security Posture / Shield Check | Medium   | Build when there is enough instance/config metadata to make checks actionable.                        | Praxrr can identify common security risks without presenting theater or unactionable warnings.                |
| 5     | [#18](https://github.com/yandy-r/praxrr/issues/18) Passkey / WebAuthn Auth                   | Medium   | Schedule as release hardening if password auth becomes a blocker, otherwise after lifecycle safety.   | Passkeys supplement or replace password auth without breaking existing auth modes.                            |
| 6     | [#23](https://github.com/yandy-r/praxrr/issues/23) MCP Server Interface                      | Medium   | Keep optional until core APIs and permissions are stable.                                             | AI tools can query state and trigger safe operations through a constrained, documented MCP interface.         |

Notes:

- #20 should not become opaque AI magic. It must show the generated scoring/profile details.
- #23 should wait for stable API contracts and clear authorization boundaries.
- #28 should be threat-model driven. Avoid generic security scorecards that users cannot act on.

## P4 - Maintenance and Cost Reduction

Goal: reduce operational complexity without distracting from the v2 user journey.

### Go Parser Migration

| Order | Issue                                                                         | Priority | Decision                                                                                 | Done When                                                                                               |
| ----- | ----------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1     | [#1](https://github.com/yandy-r/praxrr/issues/1) Go parser migration tracking | Low      | Keep as parent tracking only. Do not treat as a standalone implementation ticket.        | Children #2-#5 are complete and the parent checklist is closed.                                         |
| 2     | [#2](https://github.com/yandy-r/praxrr/issues/2) Parser foundation and parity | Low      | Start only when parser resource usage or .NET dependency becomes a real release concern. | Go module, fixtures, golden outputs, parity harness, shared utilities, and regex helpers exist.         |
| 3     | [#3](https://github.com/yandy-r/praxrr/issues/3) Domain parsers               | Low      | Depends on #2.                                                                           | Quality, language, title, episode, movie, and release-group parsers match existing behavior.            |
| 4     | [#4](https://github.com/yandy-r/praxrr/issues/4) HTTP orchestration           | Low      | Depends on #2 and #3.                                                                    | `/parse`, `/match`, and related responses match the existing .NET parser contract.                      |
| 5     | [#5](https://github.com/yandy-r/praxrr/issues/5) Integration and cutover      | Low      | Last parser step.                                                                        | Docker, CI, release artifacts, docs, and legacy parser retirement are complete without breaking setups. |

### Administrative Tracking

| Issue                                                                      | Decision                                                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#6](https://github.com/yandy-r/praxrr/issues/6) Research feature tracking | Keep as historical parent tracking. Update it to reflect closed Phase 1 issues and this roadmap, then close if all children are represented elsewhere. |

### Architecture Hygiene

| Issue | Priority | Decision                                          | Done When |
| ----- | -------- | ------------------------------------------------- | --------- |
| —     | —        | No active architecture hygiene maintenance items. | —         |

## Deferred

Do not start these until the promotion criteria are met.

| Issue                                                                                    | Why Deferred                                                                  | Promote When                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [#31](https://github.com/yandy-r/praxrr/issues/31) Community Config Sharing / PCD Hub    | Large trust and moderation burden.                                            | PCD content, provenance, signing/trust, and support workflows are mature.                        |
| [#32](https://github.com/yandy-r/praxrr/issues/32) RBAC / Multi-User Permissions         | Adds enterprise-style complexity to a mostly homelab product.                 | Multiple real deployments need distinct operators/viewers/admins and auth boundaries are stable. |
| [#33](https://github.com/yandy-r/praxrr/issues/33) AI / NL Configuration Builder         | Premature until domain validation, simulator, and quality goals are proven.   | Quality Goals works reliably and generated changes can be explained and validated.               |
| [#34](https://github.com/yandy-r/praxrr/issues/34) Ecosystem Expansion: Readarr/Whisparr | Scope expansion risks shallow support.                                        | Radarr, Sonarr, and Lidarr are stable and cross-Arr semantics are explicitly mapped.             |
| [#35](https://github.com/yandy-r/praxrr/issues/35) WASM Plugin System                    | Plugin APIs, sandboxing, and support cost are too high before core stability. | Public extension points are stable and there is clear third-party demand.                        |
| [#36](https://github.com/yandy-r/praxrr/issues/36) Federated Configuration Network       | Depends on trust infrastructure and community sharing maturity.               | PCD Hub/trust model exists and users need peer-to-peer configuration distribution.               |
| [#78](https://github.com/yandy-r/praxrr/issues/78) Versioned Documentation               | Not needed until v2 is stable and multiple supported versions exist.          | v2 is released and documentation must support at least two maintained versions.                  |

## Tracking Checklist

Use this checklist when planning a sprint or milestone.

### Completed (2026-07-06)

- [x] #29 - Progressive Complexity Architecture ([#203](https://github.com/yandy-r/praxrr/pull/203))
- [x] #197 - PCD display type split ([#202](https://github.com/yandy-r/praxrr/pull/202))
- [x] #77 - App technical docs ([#201](https://github.com/yandy-r/praxrr/pull/201))
- [x] #73 - PCD schema table reference ([#200](https://github.com/yandy-r/praxrr/pull/200))
- [x] #74 - User-facing guides ([#198](https://github.com/yandy-r/praxrr/pull/198))
- [x] #76 - PCD database content docs ([#199](https://github.com/yandy-r/praxrr/pull/199))

### Completed (2026-07-05)

- [x] #38 - Docs site infrastructure ([#196](https://github.com/yandy-r/praxrr/pull/196))
- [x] Docs deploy CI - Workers Assets deployment and wrangler config (`bf50467e`, `0f324ddd`, `56b359a9`)
- [x] #126 - TRaSH Guide Sync type hardening ([#191](https://github.com/yandy-r/praxrr/pull/191))
- [x] #125 - TRaSH Guide Sync test coverage ([#193](https://github.com/yandy-r/praxrr/pull/193))
- [x] #194 - TRaSH fetcher NUL-byte guard ([#195](https://github.com/yandy-r/praxrr/pull/195))

### Current Focus

- [ ] #75 - UI component reference

### Onboarding and Transparency

- [ ] #12 - Setup Wizard
- [ ] #14 - Cross-Arr Parity Map
- [ ] #25 - Resolved Config Viewer
- [ ] #26 - Dependency Graph
- [ ] #30 - Configuration Impact Simulator

### Lifecycle Safety

- [ ] #24 - Resilient Arr API Adapter Layer
- [ ] #15 - Drift Detection Dashboard
- [ ] #17 - Sync History / Audit Trail
- [ ] #16 - Rollback / Point-in-Time Restore
- [ ] #19 - Canary Sync / Blast Radius Safety
- [ ] #27 - Sync Archaeology Timeline

### Advanced Capabilities

- [ ] #21 - Transparent Automation Engine
- [ ] #20 - Quality Goals
- [ ] #22 - Config Health Scoring
- [ ] #28 - Ecosystem Security Posture / Shield Check
- [ ] #18 - Passkey / WebAuthn Auth
- [ ] #23 - MCP Server Interface

### Maintenance

- [ ] #1 - Go parser migration tracking
- [ ] #2 - Go parser foundation and parity
- [ ] #3 - Go domain parsers
- [ ] #4 - Go HTTP orchestration
- [ ] #5 - Go parser integration and cutover
- [ ] #6 - Research feature tracking cleanup

### Deferred Watchlist

- [ ] #31 - Community Config Sharing / PCD Hub
- [ ] #32 - RBAC / Multi-User Permissions
- [ ] #33 - AI / NL Configuration Builder
- [ ] #34 - Readarr/Whisparr ecosystem expansion
- [ ] #35 - WASM Plugin System
- [ ] #36 - Federated Configuration Network
- [ ] #78 - Versioned documentation

## Next Sprint Recommendation

Shift focus from documentation to onboarding:

1. Start #12 Setup Wizard as the next P1 onboarding feature.
2. Update #6 so the parent research checklist points to this roadmap and no longer implies closed
   Phase 1 items are still active.
3. Schedule #75 UI component reference when contributor onboarding becomes the bottleneck.

Docs infrastructure (#38), user guides (#74), PCD database content (#76), PCD schema table reference
(#73), app technical docs (#77), deploy CI, TRaSH Guide Sync stabilization (#125, #126, #194), and
progressive complexity architecture (#29, #203) are complete. The next documentation milestone is
the UI component reference (#75) as needed.
