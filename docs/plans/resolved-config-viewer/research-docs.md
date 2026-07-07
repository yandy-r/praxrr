# Documentation Research: Resolved Config Viewer (Issue #25)

## Overview

The feature spec at `docs/plans/resolved-config-viewer/feature-spec.md` is already complete and
detailed; this document maps the surrounding documentation a builder needs. The most load-bearing
precedent is the **completed Cross-Arr Parity Map plan** (`docs/prps/plans/completed/cross-arr-parity-map.plan.md`
+ its design doc), which the spec explicitly reuses (`ParityMatrix.svelte`, error-handling
conventions, contract-first workflow). The PCD schema/layer model (schema → base → tweaks → user)
is documented three times at different altitudes (`packages/praxrr-schema/README.md`,
`docs/architecture/*`, `docs/ARCHITECTURE.md`) and all three agree; the sibling
`docs/plans/pcd-state-snapshot/*` plan constrains nothing structurally but shares the same
`pcd_ops`/fingerprint vocabulary and should not be confused with this feature's read-only layer
builds.

## Architecture Docs

| Doc | Relevance |
| --- | --- |
| `docs/architecture/overview.md` | System context diagram; confirms PCD state is DB-first (`pcd_ops` + in-memory cache), not file-first. |
| `docs/architecture/components.md` | "PCD Lifecycle Components" section names `pcd/core/manager.ts`, `pcd/ops/loadOps.ts`, `pcd/database/compiler.ts` — the exact op-load chain `PCDCache.build()`/`buildReadOnly()` sits on top of. "Sync Components" section names `sync/processor.ts`, `sync/mappings.ts`, `sync/registry.ts` — what `liveDiff.ts` reuses via `generatePreview()`. |
| `docs/architecture/data-flow.md` | Sequence diagram "2) PCD Link/Sync/Compile Flow" shows `PM->>Ops` / `PM->>Compiler` ordering — clarifies where a read-only rebuild must NOT re-enter (no `pcd_op_history` writes, no cache registry re-registration). |
| `docs/ARCHITECTURE.md` (root, 46K) | Older, more prose-heavy single-file architecture doc; still current (dated Feb 26) and cross-links to `docs/DEVELOPMENT.md`. Overlaps with `docs/architecture/*` — treat the three-file split as the more current/scoped reference and this file as background. |
| `packages/praxrr-schema/README.md` | Authoritative for the schema → base → tweaks → user **layer model** with diagrams, OSQL/CDD definitions, and the value-guard example (`UPDATE ... WHERE score = 400` pattern) that directly explains Business Rule 4 (user overrides = diff(base-only, resolved)) and Edge Case "pending value-guard conflicts". Also documents `quality_profile_custom_formats.arr_type` (`radarr`/`sonarr`/`all` resolution) referenced in CLAUDE.md's Arr Cutover Guardrails. |
| `packages/praxrr-db/README.md` | Confirms YAML-first entity ingestion (not SQL) and Lidarr v1 scope/limitations — relevant if resolved-view entity coverage needs to match what's actually seedable per arr_type. |

## API Docs

| Doc | Relevance |
| --- | --- |
| `docs/api/README.md` | States the contract-first source of truth: `docs/api/v1/openapi.yaml` for contract, route handlers for runtime behavior; docs map to `endpoints.md`/`authentication.md`/`errors.md`. |
| `docs/api/v1/openapi.yaml` | Existing path registrations to mirror; confirms `/pcd/{databaseId}/lidarr-metadata-profiles` and `/pcd/{databaseId}/snapshots` as precedent for the new `/pcd/{databaseId}/resolved/**` namespace. `ErrorResponse` is defined once at `./schemas/arr.yaml#/ErrorResponse` and re-`$ref`'d — new schemas must follow the same single-definition + `$ref` pattern, not redeclare. |
| `docs/api/v1/paths/compatibility.yaml` + `docs/api/v1/schemas/compatibility.yaml` | The literal parity endpoint the spec says to mirror for the 400-not-404 "cache not built" convention and optional-`databaseId` query pattern. Read this file, not just the spec's paraphrase — it shows the exact `responses:` block shape (`200`/`400`/`401`/`500`, each `$ref`ing `ErrorResponse`). |
| `docs/api/v1/paths/pcd-snapshots.yaml` + `schemas/pcd-snapshots.yaml` | Sibling precedent for a **new** `/pcd/{databaseId}/...` sub-resource contract (created for the pcd-state-snapshot feature); useful as a second example of path/schema file organization alongside the parity one. |
| `docs/api/errors.md` | Canonical error-shape (`{ "error": "..." }`) and a status-code-semantics table per API area (400 for invalid params/unbuilt cache, 404 for missing entity/instance, 500 for runtime failure, 403 reserved for base-layer-write-without-auth). New `/resolved/**` endpoints should add a row to this table's mental model even though the file itself is not auto-generated — it is maintained by hand per area. |
| `docs/api/endpoints.md` | Living endpoint reference with request/response examples per area (PCD export/import, Lidarr metadata profiles, etc.); the style/format to match if resolved-config endpoints get documented here too (not required by the spec, but consistent with repo convention — spec's own `docs/api/v1/paths/resolved-config.yaml` covers the OpenAPI half only). |
| `docs/api/authentication.md` | Confirms session-cookie vs API-key vs `AUTH` mode behavior; relevant to the spec's requirement "401 without a session; no CORS headers; no credential fields in response". |

## Development Guides

| Doc | Relevance |
| --- | --- |
| `docs/prps/plans/completed/cross-arr-parity-map.plan.md` (57K) | **Primary implementation template.** Its "Mandatory Reading" table, "Patterns to Mirror" section (NAMING_CONVENTION, NON_REGRESSION_PIN, SUPPORT_DERIVATION, COMPATIBILITY_ALGORITHM, ERROR_HANDLING, STATIC_CACHE_TIER, CONTRACT_TYPING, TABLE_RENDER, TEST_STRUCTURE, SVELTE_LEGACY_EVENTS) are near-directly transferable: e.g. ERROR_HANDLING shows the exact 401/400/cache-guard code shape the spec asks new resolved-config handlers to copy; STATIC_CACHE_TIER shows the module-level-cache idiom possibly relevant to `resolved/limits.ts`; SVELTE_LEGACY_EVENTS reinforces the "Svelte 5, no runes" convention with a concrete warning. Its task breakdown (contract → algorithm extraction → endpoint → UI → tests → JSR mirror regen) is essentially the same phasing the resolved-config-viewer spec adopted. |
| `docs/prps/designs/cross-arr-parity-map.design.md` (45K) | The authoritative design doc behind the above plan — data model, architecture, and the semantic-differences catalog that `compare.ts`'s `compatible: false` semantics should stay consistent with. |
| `docs/plans/pcd-state-snapshot/feature-spec.md` + `shared.md` | Sibling in-flight plan touching the same `pcd_ops`/cache internals. Does not block this feature, but establishes vocabulary this feature must not collide with: `ops_sequence_max_id`, `cache_state_hash`/`state_hash_v1`, "published ops" as the replay boundary. Confirms `PCDManager.sync()` is the single pull entrypoint and `pcdOpsQueries`/`pcdOpHistoryQueries` are the only sanctioned op accessors — same accessor discipline the resolved-config service must follow for `pcd_ops`/`pcd_op_history` reads. |
| `docs/features/README.md` + `docs/features/portable-import-export.md` | `portable-import-export.md` is the best existing example of documenting a `Portable*`-shaped read/write contract end-to-end (supported entity types list, troubleshooting section, curl examples) — a template for documenting the new resolved-read endpoints if the team extends `docs/features/` later. Confirms the full supported `entityType` enum (14 types incl. family-specific `radarr_media_settings`/`sonarr_media_settings`/etc.) that `readers.ts` dispatch must fail-fast against for unknown types. |
| `docs/pr-reviews/pr-140-review.md` (finding I-4) | Documents a prior real incident: "Raw HTML interpolation of `custom_format_trash_id` in scoring page" — concrete precedent for security finding C1 in the feature spec (unsanitized `marked.parse()` + `{@html}` pattern). Worth reading as evidence the "escaped text only, no `{@html}`" rule is not hypothetical. |
| `docs/pcdReference/0.schema.sql`, `1.initial.sql` | Local copies of the schema/seed SQL for reference without needing to check out `praxrr-schema` separately. |

## README Files

| README | Relevance |
| --- | --- |
| `README.md` (root) | Product framing: "OSQL... append-only SQL operations. Readable, auditable, diffable... complete history" — directly motivates the Resolved Config Viewer's value prop (making that auditability visible in UI). No implementation detail. |
| `packages/praxrr-api/README.md` | Confirms `praxrr-api` publishes the bundled OpenAPI 3.1 spec + generated TS types (`spec`, `components['schemas'][...]`) — the target of `deno task bundle:api` mentioned in both this feature's contract-first workflow and the parity-map plan's Task 21 "Regenerate JSR mirror". |
| `packages/praxrr-db/README.md` | Mirror governance boilerplate (distribution-only, edits must land in monorepo, subtree-split publish workflow) — matches CLAUDE.md's Mirror Governance section; also documents Lidarr v1 additive scope, relevant if resolved-view must gate Lidarr entity types. |
| `packages/praxrr-schema/README.md` | See Architecture Docs above — doubles as the best conceptual primer on "resolved state" itself (OSQL replay, Layers, CDD/value guards), even though it's a sibling-package README, not app code. |

## Must-Read Documents

### REQUIRED (read before writing code)

1. `docs/plans/resolved-config-viewer/feature-spec.md` — already read; the authoritative spec.
2. `docs/prps/plans/completed/cross-arr-parity-map.plan.md` — direct implementation template; the
   spec explicitly says to reuse its UI idiom and this plan shows the exact code patterns, task
   ordering, and file list that shipped for a nearly identical shape of feature (contract-first,
   `/api/v1` read endpoint, `PCDCache`-backed, cross-Arr gated, Table/Badge UI).
3. `docs/api/v1/paths/compatibility.yaml` + `docs/api/v1/schemas/compatibility.yaml` — the literal
   endpoint contract to mirror for error-status conventions (400 not 404 for unbuilt cache).
4. CLAUDE.md sections in this repo (already loaded in context): **Cross-Arr Semantic Validation
   Policy**, **Portable Contract Fidelity**, **Arr Cutover Guardrails** — all three are called out
   by name in the spec's Business Rules and Risk table; the checklist items map 1:1 to spec
   requirements (explicit `arr_type` dispatch, no sibling fallback, fail-fast on ambiguous mapping).
5. `packages/praxrr-app/src/lib/server/sync/preview/diff.ts` header docblock — documents the three
   invariants of `diffToFieldChanges()` (explicit array-key strategy, volatile-field exclusion,
   null-vs-missing equivalence) that `layerDiff.ts` and `liveDiff.ts` inherit verbatim; getting
   these invariants wrong would silently break Success Criteria #1 (resolved view must equal sync
   preview's desired payload).
6. `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` (`PCDCache.build()`) — must be read in
   full before extracting the op-execution loop for `buildReadOnly({ layers })`; the spec's hardest
   risk item (corrupting `pcd_ops`/history) lives entirely in this file's current write path.
7. `docs/api/errors.md` — status-code semantics table; new endpoints must slot into the existing
   per-area conventions (400/401/404/500 usage) rather than inventing new codes.

### Nice-to-have (context, not blocking)

- `docs/prps/designs/cross-arr-parity-map.design.md` — deeper rationale behind the plan above.
- `docs/architecture/overview.md`, `components.md`, `data-flow.md` — general orientation, already
  summarized above; useful if unfamiliar with startup/PCD/sync wiring.
- `packages/praxrr-schema/README.md` — conceptual background on OSQL/CDD/Layers if the schema→base→
  tweaks→user model is unfamiliar.
- `docs/features/portable-import-export.md` — documentation-style template and full supported
  `entityType` enum.
- `docs/plans/pcd-state-snapshot/*` — vocabulary awareness only; no functional dependency.
- `docs/pr-reviews/pr-140-review.md` — concrete precedent for the XSS/`{@html}` hard-stop.
- ROADMAP.md lines ~97-118 (P1 "Core Product Differentiation: Onboarding and Transparency") — states
  #25 should "share model work" with #26 (Dependency Graph) and #30 (Impact Simulator); worth a skim
  so resolved-state modeling choices don't foreclose those two follow-on features.

## Documentation Gaps

- **No `docs/api/v1/paths/resolved-config.yaml` / `schemas/resolved-config.yaml` yet** — Phase 0 of
  the spec must author these from scratch; no existing partial draft found anywhere in the repo.
- **No `.github/pull_request_template.md` exists** in this repo despite CLAUDE.md instructing
  "Follow the repo's `.github/pull_request_template.md` when present" — the file is genuinely
  absent (confirmed via `ls`), so this is a repo-level gap, not something specific to this feature;
  flag before opening a PR for this work in case a template should be authored first.
  `.github/ISSUE_TEMPLATE/` does exist (`bug.yml`, `feature.yml`, `engineering-task.yml`,
  `tweak.yml`, `config.yml`).
- **`docs/architecture/*` and `docs/ARCHITECTURE.md` are not cross-linked** — the three-file split
  under `docs/architecture/` doesn't reference the older root `docs/ARCHITECTURE.md` or vice versa;
  a reader following `docs/features/README.md`'s "Related documentation" link lands on the older
  single-file doc, not the newer split. Not blocking, but a latent doc-drift risk if the two ever
  disagree.
- **No standalone doc for `PCDCache` internals** beyond the file's own docblock/inline comments —
  there is no `docs/architecture` or `docs/internal-docs` page describing cache build stats,
  value-guard evaluation, or the registry (`pcd/database/registry.ts`) lifecycle in prose. The spec's
  riskiest primitive (`buildReadOnly`) has to be understood entirely from source, not docs.
- **`docs/internal-docs/` is nearly empty** (one unrelated bug-fix doc:
  `duplicate-regex-on-restart-bug.md`) — despite CLAUDE.md's `docs(internal): …` commit-type carve-out
  implying this directory is a going concern, there's no PCD-ops/cache/sync architecture note here;
  this research file itself is the first substantial addition.
- **No existing doc explicitly enumerates the "sanitized reason enum" pattern** (`testConnectionReason.ts`)
  that the spec's W2 mitigation depends on — it exists only as source code with no accompanying
  markdown explanation of the enum's values/intent; a builder must read the source file directly
  since graphify's code-graph query for it did not resolve as a named node in this pass.
- **`docs/api/endpoints.md` is hand-maintained and not auto-generated from OpenAPI** — if the team
  wants resolved-config endpoints documented there too (matching the style of every other area), that
  is extra, undocumented-as-required work beyond the spec's Phase 0 (which only covers
  `openapi.yaml` + generated types, not this prose reference file).

## Relevant File Paths (quick index)

- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/resolved-config-viewer/feature-spec.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/prps/plans/completed/cross-arr-parity-map.plan.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/prps/designs/cross-arr-parity-map.design.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/README.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/errors.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/authentication.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/compatibility.yaml`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/compatibility.yaml`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/paths/pcd-snapshots.yaml`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/schemas/pcd-snapshots.yaml`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/overview.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/components.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/architecture/data-flow.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/ARCHITECTURE.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/DEVELOPMENT.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/README.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/portable-import-export.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-state-snapshot/feature-spec.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/pcd-state-snapshot/shared.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/docs/pr-reviews/pr-140-review.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/ROADMAP.md` (lines ~97-118)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/README.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-api/README.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-db/README.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-schema/README.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/CLAUDE.md`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/.github/copilot-instructions.md` (mirror of CLAUDE.md)
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/database/cache.ts`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/preview/diff.ts`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/preview/store.ts`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/preview/limits.ts`
- `/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/sync/preview/types.ts`
