# Lidarr Support Implementation Plan

This implementation introduces first-class `lidarr` coverage in a SQL-first repository by extending
arr-scoped seed data and gating rollout through manifest metadata. The safest strategy is
compatibility-first: define explicit scope and release criteria, then add idempotent Lidarr
operations that mirror proven Radarr/Sonarr patterns. Work is organized to maximize parallel
authoring of independent SQL seeds while keeping dependency-sensitive junctions (mapping joins,
release gate, and final docs) serialized. The plan keeps scope constrained to planning-approved
artifacts and shared-table extension first, with follow-up depth deferred until compatibility and
mapping completeness are verified.

## Critically Relevant Files and Documentation

- `docs/plans/lidarr-support/shared.md`: canonical shared context for architecture, tables,
  patterns, and must-read docs.
- `docs/plans/lidarr-support/analysis-context.md`: condensed context synthesis used for
  phase/dependency shaping.
- `docs/plans/lidarr-support/analysis-code.md`: concrete operation and manifest patterns to copy.
- `docs/plans/lidarr-support/analysis-tasks.md`: parallelization and bottleneck analysis baseline.
- `docs/plans/lidarr-support/feature-spec.md`: source of scope constraints, edge cases, and success
  criteria.
- `docs/plans/lidarr-support/research-technical.md`: schema and table implications, idempotency
  constraints.
- `docs/plans/lidarr-support/research-business.md`: business rules including arr-type isolation and
  minimum complete set.
- `docs/plans/lidarr-support/research-external.md`: Lidarr API concepts that influence mapping and
  seed coverage.
- `pcd.json`: arr type declaration and `praxrr.minimum_version` release gate.
- `README.md`: public support-surface documentation.
- `ops/24.1080p-balanced-score-refactor-add-hdtv-fallbacks.sql`: idempotent insert pattern.
- `ops/30.fix-720p-web-dl-scoring.sql`: arr-type-scoped update/insert pattern.
- `ops/34.add-remux-negation-to-release-group-missing.sql`: custom-format condition insertion
  pattern.
- `AGENTS.md`: repository conventions for op naming, ordering, and verification commands.

## Implementation Plan

### Phase 1: Scope and Gate Foundation

#### Task 1.1: Define Lidarr v1 Support Contract Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/feature-spec.md`
- `docs/plans/lidarr-support/research-business.md`
- `docs/plans/lidarr-support/research-recommendations.md`

**Instructions**

Files to Create

- `docs/plans/lidarr-support/requirements.md`

Files to Modify

- `docs/plans/lidarr-support/feature-spec.md`

Capture a precise v1 support boundary for Lidarr (what is in scope, explicitly out of scope, and
what blocks release). Document the minimum complete data set required for publication and map each
requirement to a measurable verification step. Keep this contract implementation-oriented so later
SQL tasks can be validated without reinterpretation.

#### Task 1.2: Build Lidarr Seed Inventory and Mapping Checklist Depends on [1.1]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/research-technical.md`
- `docs/plans/lidarr-support/research-external.md`
- `ops/0.rosettarr.sql`

**Instructions**

Files to Create

- `docs/plans/lidarr-support/lidarr-seed-inventory.md`

Files to Modify

- `docs/plans/lidarr-support/research-technical.md`

Produce a concrete inventory of Lidarr seed targets (profiles, custom formats, conditions, quality
definitions, and mapping joins). Use a strict row shape for every item: `entity`, `source`,
`target_table`, `unique_key_tuple`, `arr_type_scope`, `status`, and `evidence_link`. For each
target, include source rationale, arr-type scope, and idempotency guard expectations to remove
ambiguity before SQL work begins. Record unresolved schema decisions that could force dedicated
`lidarr_*` entities.

#### Task 1.3: Finalize Schema Gate for Phase 2 Depends on [1.2]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/lidarr-seed-inventory.md`
- `docs/plans/lidarr-support/research-technical.md`
- `pcd.json`

**Instructions**

Files to Create

- `docs/plans/lidarr-support/lidarr-schema-gate.md`

Files to Modify

- `docs/plans/lidarr-support/lidarr-seed-inventory.md`

Lock one schema path for this implementation wave (`shared-table extension` or
`dedicated Lidarr entities`) and define a hard stop condition for any conflicting assumptions
discovered later. Record concrete Phase 2 table/key contracts in `lidarr-schema-gate.md` using
explicit fields: `custom_formats_target`, `custom_formats_unique_key`, `quality_profiles_target`,
`quality_profiles_unique_key`, `quality_definitions_target`, `quality_definitions_unique_key`,
`profile_format_target`, and `conditions_target`. Phase 2 tasks must not start until this gate is
approved.

### Phase 2: Lidarr SQL Publication

Parallel execution note: if Task 1.3 approves the shared-table path, Tasks 2.1, 2.2, and 2.3 can run
concurrently, and Task 2.5 starts after Task 2.1. If Task 1.3 selects dedicated entities, stop Phase
2 SQL work and re-plan before implementation.

#### Task 2.1: Seed Lidarr Custom Formats Depends on [1.3]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/lidarr-seed-inventory.md`
- `ops/24.1080p-balanced-score-refactor-add-hdtv-fallbacks.sql`
- `ops/34.add-remux-negation-to-release-group-missing.sql`

**Instructions**

Files to Create

- `ops/50.seed-lidarr-custom-formats.sql`

Files to Modify

- None.

Precondition: shared-table schema path is approved in Task 1.3. Add Lidarr custom format base rows
in the exact `custom_formats_target` table using the `custom_formats_unique_key` tuple defined in
`docs/plans/lidarr-support/lidarr-schema-gate.md`. Every row inserted in this task must be
explicitly scoped to `arr_type='lidarr'` where schema supports arr typing; if any shared/global row
is required, document the exact exception and justification in a SQL comment. Keep guard predicates
deterministic (`NOT EXISTS` keyed by unique identity) so replays remain no-op safe.

#### Task 2.2: Seed Lidarr Quality Profiles Depends on [1.3]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/lidarr-seed-inventory.md`
- `ops/30.fix-720p-web-dl-scoring.sql`
- `docs/plans/lidarr-support/research-technical.md`

**Instructions**

Files to Create

- `ops/51.seed-lidarr-quality-profiles.sql`

Files to Modify

- None.

Precondition: shared-table schema path is approved in Task 1.3. Introduce Lidarr quality profile
rows aligned with the documented v1 contract using `quality_profiles_target` and
`quality_profiles_unique_key` from `docs/plans/lidarr-support/lidarr-schema-gate.md`, with
`arr_type='lidarr'` and `NOT EXISTS` guards. If Task 1.3 selected dedicated entities, do not execute
this task and re-plan the dedicated track first.

#### Task 2.3: Seed Lidarr Quality Definitions Depends on [1.3]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/lidarr-seed-inventory.md`
- `docs/plans/lidarr-support/research-external.md`
- `ops/0.rosettarr.sql`

**Instructions**

Files to Create

- `ops/52.seed-lidarr-quality-definitions.sql`

Files to Modify

- None.

Precondition: shared-table schema path is approved in Task 1.3. Shared-path outcome: insert quality
definitions into the exact `quality_definitions_target` table and `quality_definitions_unique_key`
tuple defined in `docs/plans/lidarr-support/lidarr-schema-gate.md`, with idempotent guards and
`arr_type='lidarr'` scoping as applicable. Dedicated-path outcome: do not execute this task; create
`docs/plans/lidarr-support/lidarr-dedicated-entities-plan.md`, record deferred definitions in that
document, and re-run planning for the dedicated-entity track.

#### Task 2.4: Seed Lidarr Profile-to-Format Score Mappings Depends on [2.1, 2.2]

**READ THESE BEFORE TASK**

- `ops/50.seed-lidarr-custom-formats.sql`
- `ops/51.seed-lidarr-quality-profiles.sql`
- `ops/30.fix-720p-web-dl-scoring.sql`

**Instructions**

Files to Create

- `ops/53.seed-lidarr-profile-format-scores.sql`

Files to Modify

- None.

Create join-table mappings between Lidarr profiles and custom formats, including score values that
reflect the agreed v1 behavior. Use strict duplicate-prevention predicates and maintain
deterministic ordering so replay and diff reviews remain readable. Validate that all referenced
profiles and custom formats already exist. Write mappings into `quality_profile_custom_formats`
using uniqueness tuple `(quality_profile_name, custom_format_name, arr_type)` with
`arr_type='lidarr'` and `NOT EXISTS` guards. Pull score values only from `lidarr-seed-inventory.md`,
and record one traceability reference per inserted mapping.

#### Task 2.5: Seed Lidarr Custom Format Conditions Depends on [1.3, 2.1]

**READ THESE BEFORE TASK**

- `ops/50.seed-lidarr-custom-formats.sql`
- `ops/34.add-remux-negation-to-release-group-missing.sql`
- `docs/plans/lidarr-support/lidarr-seed-inventory.md`

**Instructions**

Files to Create

- `ops/54.seed-lidarr-custom-format-conditions.sql`
- `docs/plans/lidarr-support/lidarr-condition-evidence.md`

Files to Modify

- None.

Add condition rows needed for Lidarr custom formats with explicit arr-type scoping and deterministic
predicates. Keep condition semantics music-appropriate and avoid reusing video-specific assumptions
unless explicitly documented as shared behavior. Ensure every condition introduced is traceable to
the seed inventory. Insert into `custom_format_conditions` with uniqueness keyed by
`(custom_format_name, name, type, arr_type)` plus deterministic guard predicates. For each condition
family, capture one expected-match and one expected-non-match example in
`docs/plans/lidarr-support/lidarr-condition-evidence.md` so Task 2.6 can publish them in the final
results artifact.

#### Task 2.6: Reconcile Seed Inventory with Implemented SQL Depends on [2.1, 2.2, 2.3, 2.4, 2.5]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/lidarr-seed-inventory.md`
- `ops/50.seed-lidarr-custom-formats.sql`
- `ops/54.seed-lidarr-custom-format-conditions.sql`
- `docs/plans/lidarr-support/lidarr-condition-evidence.md`

**Instructions**

Files to Create

- `docs/plans/lidarr-support/lidarr-seed-results.md`

Files to Modify

- `docs/plans/lidarr-support/lidarr-seed-inventory.md`

Consolidate all SQL outputs into one authoritative inventory update to avoid parallel edit
conflicts. Mark each planned item as implemented, deferred, or dropped with rationale and direct
file references to the final ops scripts. Publish condition-level match/non-match examples from
`docs/plans/lidarr-support/lidarr-condition-evidence.md` into `lidarr-seed-results.md`. This task is
the single writer for seed inventory state after Phase 2.

### Phase 3: Validation and Release Surface

#### Task 3.1: Produce SQL Verification Evidence Depends on [1.1, 2.6]

**READ THESE BEFORE TASK**

- `AGENTS.md`
- `docs/plans/lidarr-support/requirements.md`
- `docs/plans/lidarr-support/feature-spec.md`

**Instructions**

Files to Create

- `docs/plans/lidarr-support/lidarr-validation.md`

Files to Modify

- `docs/plans/lidarr-support/feature-spec.md`

Run and document verification with explicit commands and pass criteria: `ls ops/*.sql | sort -V`
(new Lidarr ops in correct order, no numbering conflicts), `git diff -- ops/` (diff limited to
intended Lidarr operations), and a replay procedure that applies the new Lidarr ops twice against
the same staging dataset. Add table-level assertion queries in `lidarr-validation.md` and require
zero-row results for duplicate checks over `(quality_profile_name, custom_format_name, arr_type)` in
`quality_profile_custom_formats`, `(custom_format_name, name, type, arr_type)` in
`custom_format_conditions`, and `(name, arr_type)` in `quality_profiles`. Include a
requirement-to-evidence table that maps each item from `requirements.md` to concrete proof and
pass/fail status.

#### Task 3.2: Apply Manifest Release Gate Depends on [1.1, 3.1]

**READ THESE BEFORE TASK**

- `pcd.json`
- `docs/plans/lidarr-support/requirements.md`
- `docs/plans/lidarr-support/lidarr-validation.md`

**Instructions**

Files to Create

- `docs/plans/lidarr-support/lidarr-rollout-checklist.md`

Files to Modify

- `pcd.json`

Add `lidarr` to `arr_types` and set `praxrr.minimum_version` to the exact semver value recorded in
`requirements.md` compatibility policy. In the rollout checklist, capture exact pre-release checks
and cross-repo coordination points so publication cannot bypass readiness conditions. Ensure
manifest changes are synchronized with validation evidence and include a semver-format sanity check
before commit.

#### Task 3.3: Publish Support and Compatibility Documentation Depends on [1.1, 3.1, 3.2]

**READ THESE BEFORE TASK**

- `README.md`
- `docs/plans/lidarr-support/requirements.md`
- `docs/plans/lidarr-support/lidarr-validation.md`

**Instructions**

Files to Create

- `docs/plans/lidarr-support/lidarr-compatibility-matrix.md`

Files to Modify

- `README.md`

Document what Lidarr capabilities are supported in v1, what remains out of scope, and which Praxrr
versions are required. Do not modify `requirements.md` in this task; treat it as immutable baseline
input after Task 1.1. Required README sections: `Lidarr Support Scope`, `Compatibility Gate`, and
`Known Limitations`. Required matrix sections: `DB Version`, `Minimum Praxrr Version`,
`Supported Lidarr Features`, and `Unsupported Features`. Add a claim-to-evidence map linking each
published statement back to `requirements.md` and `lidarr-validation.md`.

#### Task 3.4: Final Rollout Signoff Depends on [3.1, 3.2, 3.3]

**READ THESE BEFORE TASK**

- `docs/plans/lidarr-support/lidarr-rollout-checklist.md`
- `docs/plans/lidarr-support/lidarr-compatibility-matrix.md`
- `docs/plans/lidarr-support/lidarr-validation.md`

**Instructions**

Files to Create

- `docs/plans/lidarr-support/lidarr-signoff.md`

Files to Modify

- `docs/plans/lidarr-support/lidarr-rollout-checklist.md`

Finalize release signoff with explicit pass/fail status for every gate item and capture any approved
deferrals. Ensure unresolved risks are tagged with owners and follow-up milestones before declaring
readiness. This task closes the plan by producing an auditable decision record.

## Advice

- Keep SQL tasks independent by table concern, but reserve one integration checkpoint before
  manifest changes to avoid publishing partial data.
- Treat `pcd.json` as the final gate artifact, not the first change, so versioning reflects
  validated compatibility rather than intent.
- Use the seed inventory as a live source-of-truth; if a row is not in the inventory, it should not
  be seeded.
- Preserve established idempotent SQL style exactly; subtle predicate drift is the fastest path to
  replay regressions.
- Coordinate early with the Praxrr consumer maintainers on the minimum supported version because
  that single value controls rollout safety.
