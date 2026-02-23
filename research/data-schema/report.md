# PCD Data Schema Format: Deep Research Report

## Asymmetric Research Squad Analysis

**Research Subject**: Should Praxrr's PCD ingestion data format migrate from SQL ops files to JSON/YAML?

**Date**: 2026-02-22

**Research Depth**: 8 parallel personas, 2 synthesis agents, 4 strategic analysis agents

---

## Executive Summary

**Recommendation: Yes, migrate to a hybrid JSON/YAML + SQL model, executed in 5 phases.**

The research deployed 8 independent analytical perspectives that converged with remarkable consistency on three findings:

1. **The SQL DDL schema must stay as SQL** (7/8 personas unanimous, zero dissent)
2. **A hybrid model is the right architecture** (6/8 personas independently converged)
3. **Value guards are the critical technical gate** (7/8 personas identified this as the hardest problem)

The winning strategy is **Option E: Full-Authoring Hybrid** -- YAML for authoring, JSON for distribution, SQL for execution -- scoring **158/170 (93%)** on weighted criteria aligned with your stated priorities. However, it must be executed as a **phased roadmap** where Phase 3 (value guard prototype) serves as the critical go/no-go gate. If that gate fails, the fallback **Option C/D** still delivers **78%** of maximum value.

**The key insight**: Your existing `portable.ts` types, `serialize.ts`, and `deserialize.ts` infrastructure already define the YAML schema and provide the compilation pipeline. This is an evolution of existing architecture, not a new invention.

---

## The Problem Statement

The PCD data layer currently stores all configuration data (300+ custom formats, 11+ quality profiles, 500+ regex patterns across 33 interrelated tables) as raw SQL operations in `.sql` files. The initial seed alone is **25,220 lines / 7,057 INSERT statements**. This creates four pain points:

| Pain Point                                                                 | Impact                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Readability**: SQL INSERT/UPDATE statements are not self-documenting     | Contributors cannot quickly understand what an entity looks like |
| **Automation/API**: SQL requires a SQLite execution environment to consume | Third-party tools cannot programmatically access PCD data        |
| **Documentation**: SQL doesn't lend itself to auto-generated docs          | No browsable entity documentation exists                         |
| **Ecosystem**: Every other tool uses JSON/YAML; Praxrr is the outlier      | Limits community adoption and TRaSH-Guides interoperability      |

**Constraint**: The runtime must not change. The in-memory SQLite cache, append-only ops model, value guard conflict detection, and layered compilation pipeline are non-negotiable.

---

## What the Research Found

### Strong Convergences (5+ personas agreeing)

| #   | Finding                                                  | Personas | Confidence    |
| --- | -------------------------------------------------------- | -------- | ------------- |
| 1   | SQL schema (DDL) must stay SQL                           | 7/8      | Very High     |
| 2   | Hybrid model is the right architecture                   | 6/8      | High          |
| 3   | Value guards are the hardest problem                     | 7/8      | High          |
| 4   | TRaSH import should be an adapter, not format alignment  | 6/8      | High          |
| 5   | Event-sourced architecture must be preserved             | 6/8      | High          |
| 6   | Seed data vs. incremental mutations is the natural split | 5/8      | High          |
| 7   | SQL format has underappreciated emergent properties      | 5/8      | Moderate-High |

### Key Contradictions

| Tension                             | Strategic View                                       | Tactical View                                           | Resolution                                                |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| Is migration worth it?              | Historian/Futurist: Historical trajectory demands it | Contrarian/Systems Thinker: Architectural cost too high | Phase incrementally; each phase delivers standalone value |
| Can JSON/YAML express value guards? | Futurist: Compile-time generation makes it moot      | Contrarian: Inherently SQL-native                       | Prototype resolves empirically                            |
| Is TRaSH alignment real?            | Journalist: Ecosystem lingua franca                  | Contrarian: 5 structural divergences                    | Build adapter, not format coupling                        |
| Who is the actual user?             | Futurist: 5-10x contributor expansion                | Negative Space: Primary author uses UI                  | Measure via git history analysis                          |

### Surprising Finding

The **Archaeologist** discovered that the original 25K-line seed was itself **generated FROM YAML** (line 1 of `0.rosettarr.sql` says "Generated by YAML to SQL Converter"). The YAML source no longer exists in the repo. This means YAML-to-SQL compilation was already proven feasible -- and the existing `deserialize.ts` pipeline essentially reimplements this pattern.

---

## Strategic Options

Five options were evaluated across 9 weighted criteria (readability, API friendliness, doc generation, ecosystem alignment, scalability at HIGH weight; migration risk, architectural elegance, community contribution at MEDIUM weight; runtime integrity as a non-negotiable GATE):

| Rank  | Option                       | Score   | % of Max | Summary                                            |
| ----- | ---------------------------- | ------- | -------- | -------------------------------------------------- |
| **1** | **E: Full-Authoring Hybrid** | **158** | **93%**  | YAML authoring for everything, SQL compile target  |
| 2     | C: Exchange-Format Hybrid    | 132     | 78%      | JSON exchange + TRaSH adapter; SQL authoring stays |
| 2     | D: Seed-Data Hybrid          | 132     | 78%      | YAML for new entities; SQL for mutations           |
| 4     | B: Metadata Hybrid           | 97      | 57%      | SQL stays; add YAML metadata layer                 |
| 5     | A: Status Quo + Tooling      | 80      | 47%      | SQL everywhere; invest in tooling only             |

Rankings remain stable across all sensitivity scenarios (migration risk increase, community priority shift, TRaSH format instability, new Arr app support) except one: if the **value guard prototype fails**, Option E is disqualified and C/D become co-leaders at 78%.

---

## Recommended Phased Roadmap

Each phase delivers standalone value. Each gate provides empirical data for the next decision.

### Phase 1: JSON Schema Formalization

**Risk: Low | Effort: 1-2 days | Maps to: Option B**

- Formalize `portable.ts` types as published JSON Schema (`pcd-entities.schema.json`)
- Publish to `packages/praxrr-schema/`
- Enables IDE validation, autocomplete for entity files
- **Gate**: Schema validates 100% of compiled cache entities

### Phase 2: JSON Exchange + TRaSH Adapter

**Risk: Medium | Effort: 5-8 days | Maps to: Option C**

- Build JSON import/export from compiled cache via `serialize.ts`
- Build one-way TRaSH-Guides import adapter
- Publish JSON API distribution via CI
- Semantic changelog generation from structured diffs
- **Gate**: Round-trip fidelity (entity -> JSON -> SQL -> cache = identical rows)

### Phase 3: Value Guard Prototype (GO/NO-GO GATE)

**Risk: Medium | Effort: 3-5 days**

- Convert the 3 most complex ops files to JSON/YAML representation
- Prove compiled SQL produces identical row-change behavior
- **If PASS**: Proceed to Phase 4/5
- **If FAIL**: Stop at Phase 2 (Option C at 78% -- still delivers majority of goals)

### Phase 4: YAML Entity Authoring (Seed Data)

**Risk: Medium | Effort: 5-8 days | Maps to: Option D**

- Convert `0.rosettarr.sql` into per-entity YAML files using `serialize.ts`
- Build YAML -> SQL compiler leveraging `deserialize.ts` pipeline
- Modify `importBaseOps.ts` to handle `entities/` directory
- Incremental ops (1-56.sql) remain as SQL historical record
- **Gate**: All existing entities representable with successful compilation

### Phase 5: Full YAML Authoring

**Risk: High | Effort: 8-15 days | Maps to: Option E**

- YAML authoring for incremental mutations (operation DSL with value guards)
- Export pipeline produces YAML operation files
- Legacy SQL import supported but deprecated
- **Gate**: Full PCD compilation from YAML produces identical SQLite cache

---

## Concrete Format Examples

What entities look like in YAML (from the technical design):

**Custom Format:**

```yaml
# entities/custom-formats/AMZN.yaml
name: 'AMZN'
description: "Matches 'Amazon Prime' WEB-DLs. Negates any encodes."
includeInRename: true
tags:
  - Streaming Service
  - WEB-DL

conditions:
  - name: 'Amazon Prime'
    type: release_title
    arrType: all
    negate: false
    required: true
    patterns:
      - name: 'Amazon Prime' # references regular_expressions by name

  - name: 'Not WEBRip'
    type: release_title
    arrType: all
    negate: true
    required: true
    patterns:
      - name: 'WEBRip'
```

**Quality Profile (with arr-scoped scores):**

```yaml
# entities/quality-profiles/1080p-Balanced.yaml
name: '1080p Balanced'
description: |
  1080p Balanced targets consistent & immutable 1080p WEB-DLs.
upgradesAllowed: true
minimumScore: 20000
upgradeUntilScore: 888888

orderedItems:
  - type: group
    name: '1080p Balanced'
    position: 1
    enabled: true
    upgradeUntil: true
    members:
      - name: 'Bluray-1080p'
      - name: 'WEB-DL 1080p'

customFormatScores:
  - customFormatName: 'AMZN'
    arrType: all
    score: 1500
  - customFormatName: 'Banned Groups'
    arrType: all
    score: -999999
```

Compare with the current SQL (spread across multiple sections of a 25K-line file):

```sql
INSERT INTO custom_formats (name, description) VALUES ('AMZN', '...');
INSERT INTO custom_format_conditions (custom_format_name, name, type, arr_type, negate, required)
SELECT cf.name, 'Amazon Prime', 'release_title', 'all', 0, 1
FROM custom_formats cf WHERE cf.name = 'AMZN';
INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
SELECT 'AMZN', 'Amazon Prime', re.name
FROM regular_expressions re WHERE re.name = 'Amazon Prime';
-- ... repeated across 6+ tables per entity
```

---

## Risk Profile

**25 risks identified across 6 categories.** The critical finding: a **full migration (Option B)** carries 3 Critical-rated risks and is never recommended. The phased hybrid approach avoids all Critical risks:

| Risk Level | Full Migration (B)                                           | Phased Hybrid (Phases 1-5)                          |
| ---------- | ------------------------------------------------------------ | --------------------------------------------------- |
| Critical   | 3 (value guards, compiler corruption, architecture mismatch) | 0                                                   |
| High       | 11                                                           | 2 (mitigated by existing `deserialize.ts` pipeline) |
| Medium     | 6                                                            | 8 (manageable with phasing)                         |

**The single biggest risk**: R-001 (value guard semantics loss) -- resolved by Phase 3 prototype.

---

## Key Architectural Decisions

| Decision                                       | Rationale                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Schema DDL stays SQL                           | JSON Schema cannot express FK, CASCADE, CHECK, multi-column UNIQUE (7/8 consensus) |
| `portable.ts` IS the YAML schema               | No new entity model; extend proven types                                           |
| SQL ops remain the execution format            | YAML compiles down to SQL; runtime unchanged                                       |
| One file per entity                            | Clean git diffs, reviewable PRs, one-entity-per-change                             |
| Scores live in QP files, not CF files          | Matches relational schema (`quality_profile_custom_formats`)                       |
| Incremental mutations can stay SQL             | Natural boundary; value guards are native to SQL                                   |
| TRaSH import via adapter, not format alignment | 5 structural divergences make drop-in impossible                                   |
| YAML 1.2 strict parsing                        | Eliminates Norway problem, type coercion risks                                     |

---

## What This Enables

Once the migration reaches Phase 4+:

- **Community contributions** in YAML (estimated 5-10x contributor pool expansion)
- **Auto-generated documentation** from structured entity files
- **Semantic changelogs** from YAML git diffs ("CF Z score changed from 100 to 150")
- **API-first distribution** via JSON endpoints, CDN, npm/JSR packages
- **TRaSH-Guides import** via one-way adapter
- **AI/LLM entity creation** via JSON Schema constrained decoding (near-100% structural accuracy vs ~52% for SQL generation)
- **Cross-tool consumption** without SQLite runtime dependency

---

## Pre-Decision Action Items

Before committing beyond Phase 1, gather these empirical data points:

| #   | Action                                                                       | Priority | Effort   |
| --- | ---------------------------------------------------------------------------- | -------- | -------- |
| 1   | Analyze praxrr-db git history: what % of changes are UI-generated vs manual? | HIGH     | Low      |
| 2   | Run value guard prototype (Phase 3): convert ops 42, 50, 56 to YAML          | HIGH     | Medium   |
| 3   | Audit `deserialize.ts`: can it accept YAML input with modest extensions?     | HIGH     | Low      |
| 4   | Define TRaSH interop scope: import-only, bidirectional, or format parity?    | MEDIUM   | Decision |
| 5   | Benchmark compilation: measure SQL replay time vs YAML parse+transform       | MEDIUM   | Low      |
| 6   | Investigate why original YAML source was abandoned                           | MEDIUM   | Question |

---

## Research Quality Metrics

| Metric                            | Value            |
| --------------------------------- | ---------------- |
| Independent perspectives deployed | 8                |
| Convergences identified (strong)  | 7                |
| Contradictions mapped             | 13               |
| Risks cataloged                   | 25               |
| Strategic options evaluated       | 5                |
| Sensitivity scenarios tested      | 5                |
| Concrete format examples produced | 12+ entity types |

---

## Full Research Artifacts

| Document                 | Location                                                   |
| ------------------------ | ---------------------------------------------------------- |
| Historian findings       | `research/data-schema/persona-findings/historian.md`       |
| Contrarian findings      | `research/data-schema/persona-findings/contrarian.md`      |
| Analogist findings       | `research/data-schema/persona-findings/analogist.md`       |
| Systems Thinker findings | `research/data-schema/persona-findings/systems-thinker.md` |
| Journalist findings      | `research/data-schema/persona-findings/journalist.md`      |
| Archaeologist findings   | `research/data-schema/persona-findings/archaeologist.md`   |
| Futurist findings        | `research/data-schema/persona-findings/futurist.md`        |
| Negative Space findings  | `research/data-schema/persona-findings/negative-space.md`  |
| Contradiction mapping    | `research/data-schema/synthesis/contradiction-mapping.md`  |
| Convergence mapping      | `research/data-schema/synthesis/convergence-mapping.md`    |
| Strategic options        | `research/data-schema/synthesis/strategic-options.md`      |
| Technical design         | `research/data-schema/synthesis/technical-design.md`       |
| Risk assessment          | `research/data-schema/synthesis/risk-assessment.md`        |
| Decision framework       | `research/data-schema/synthesis/decision-framework.md`     |
