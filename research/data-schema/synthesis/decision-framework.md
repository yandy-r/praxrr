# Decision Framework: PCD Data Format Migration

## Purpose

This document provides a structured, weighted decision matrix for evaluating the PCD data format migration options. It synthesizes findings from eight research personas, the convergence mapping, and the contradiction mapping into an actionable framework.

---

## 1. Strategic Options Defined

The research identified five distinct strategic options along a spectrum of ambition. Each is defined precisely to avoid conflation.

| ID    | Option Name                | Description                                                                                                                                                                                                     | Scope                                                                  |
| ----- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **A** | **Status Quo + Tooling**   | Keep SQL ops as the sole format. Invest in SQL LSP, PCD-aware linting, CI validation, documentation generation from compiled cache. Add TRaSH import adapter as a standalone feature.                           | No format change. Tooling and adapters only.                           |
| **B** | **Metadata Hybrid**        | Keep SQL ops for all operations. Add a JSON/YAML metadata/manifest layer alongside ops for entity documentation, tags, and human-readable descriptions. Auto-generate from compiled cache.                      | Additive only. No authoring pipeline change.                           |
| **C** | **Exchange-Format Hybrid** | Keep SQL ops internally. Add JSON as an import/export exchange format. Formalize `portable.ts` as JSON Schema. Build TRaSH import adapter. Publish JSON API distribution.                                       | New ingestion path for external data. Internal format unchanged.       |
| **D** | **Seed-Data Hybrid**       | JSON/YAML for initial entity definitions (seed data). SQL ops for incremental migrations (updates, deletes, renames with value guards). New entities authored in YAML; mutations remain SQL.                    | Split authoring: YAML for creates, SQL for mutations.                  |
| **E** | **Full-Authoring Hybrid**  | JSON/YAML as the primary authoring and distribution format for all PCD data. SQL ops generated at compile time via existing Kysely/deserialize pipeline. SQL schema DDL unchanged. Legacy SQL import supported. | Complete authoring layer replacement. SQL becomes compile target only. |

**Note**: No option proposes replacing SQL DDL schema or the append-only ops runtime model. All eight personas converged on preserving these (Convergence 2 and 8).

---

## 2. Evaluation Criteria

Criteria are weighted according to the maintainer's explicitly stated priorities.

| #   | Criterion                              | Weight     | Rationale                                                                                                                                                                                    |
| --- | -------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **Readability of authored data**       | 5 (HIGH)   | Explicitly requested. Affects authoring, review, and contribution experience.                                                                                                                |
| C2  | **Automation / API friendliness**      | 5 (HIGH)   | Explicitly requested. Enables programmatic consumption, CI/CD pipelines, third-party tool integration.                                                                                       |
| C3  | **Documentation generation ease**      | 5 (HIGH)   | Explicitly requested. Structured data enables auto-generated entity docs, changelogs, comparison tables.                                                                                     |
| C4  | **TRaSH-Guides / ecosystem alignment** | 5 (HIGH)   | Explicitly requested. JSON is the ecosystem lingua franca. Alignment reduces adoption friction.                                                                                              |
| C5  | **Scalability**                        | 5 (HIGH)   | Explicitly requested. Handles growth in entities, contributors, consumers, and Arr app targets.                                                                                              |
| C6  | **Runtime integrity preservation**     | GATE       | Non-negotiable. Value guards, append-only model, conflict detection, layered compilation must be preserved. Any option that fails this criterion is disqualified regardless of other scores. |
| C7  | **Migration risk**                     | 3 (MEDIUM) | User stated "effort doesn't matter," but risk of regression, data loss, or extended instability still matters.                                                                               |
| C8  | **Architectural elegance**             | 3 (MEDIUM) | Clean separation of concerns, minimal duplication, no format-sensitive shims.                                                                                                                |
| C9  | **Community contribution enablement**  | 3 (MEDIUM) | Lowering barriers for external contributors to author/modify PCD data.                                                                                                                       |

**Maximum possible weighted score**: (5 x 5 criteria x 5 max) + (3 x 3 criteria x 5 max) = 125 + 45 = 170

---

## 3. Scoring Matrix

Each option is scored 1-5 per criterion. Justifications follow the table.

| Criterion               | Weight | A: Status Quo + Tooling | B: Metadata Hybrid | C: Exchange Hybrid | D: Seed-Data Hybrid | E: Full-Authoring Hybrid |
| ----------------------- | ------ | ----------------------- | ------------------ | ------------------ | ------------------- | ------------------------ |
| C1: Readability         | 5      | 2                       | 3                  | 3                  | 4                   | 5                        |
| C2: API friendliness    | 5      | 2                       | 2                  | 5                  | 4                   | 5                        |
| C3: Doc generation      | 5      | 3                       | 4                  | 5                  | 5                   | 5                        |
| C4: Ecosystem alignment | 5      | 1                       | 2                  | 4                  | 4                   | 5                        |
| C5: Scalability         | 5      | 2                       | 3                  | 4                  | 4                   | 5                        |
| C6: Runtime integrity   | GATE   | PASS                    | PASS               | PASS               | PASS                | PASS (conditional)       |
| C7: Migration risk      | 3      | 5                       | 4                  | 3                  | 3                   | 2                        |
| C8: Elegance            | 3      | 3                       | 3                  | 3                  | 2                   | 4                        |
| C9: Community contrib   | 3      | 2                       | 2                  | 3                  | 4                   | 5                        |

### Score Justifications

**Option A: Status Quo + Tooling**

| Criterion | Score                                                                                                                                                        | Justification |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| C1: 2     | SQL ops are structured but not self-documenting for non-SQL readers. Tooling (LSP, linting) improves authoring but does not change the format's readability. |
| C2: 2     | SQL files require a SQLite execution environment to consume. No HTTP/JSON API without additional build steps.                                                |
| C3: 3     | Documentation can be generated from the compiled SQLite cache (Negative Space). Requires custom tooling but is achievable.                                   |
| C4: 1     | Praxrr remains the sole SQL-based tool in an ecosystem standardized on JSON/YAML. TRaSH adapter is a point solution, not alignment.                          |
| C5: 2     | SQL ops scale linearly in file count but adding new Arr apps, entity types, or consumers all require SQL fluency.                                            |
| C7: 5     | Zero migration risk. All effort is additive tooling.                                                                                                         |
| C8: 3     | Clean single-format architecture. SQL serves all roles. But the "five-way identity" (Systems Thinker) is both a strength and a coupling point.               |
| C9: 2     | SQL remains the contribution format. Tooling helps but does not lower the fundamental barrier.                                                               |

**Option B: Metadata Hybrid**

| Criterion | Score                                                                                                                        | Justification |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------- |
| C1: 3     | YAML metadata files add human-readable context alongside SQL ops. The ops themselves remain SQL.                             |
| C2: 2     | Metadata layer is not a substitute for structured data API. Consumers still need SQL execution for actual entity data.       |
| C3: 4     | YAML metadata enables straightforward doc generation. Tags, descriptions, and entity overviews become first-class.           |
| C4: 2     | Metadata layer does not produce ecosystem-compatible JSON. TRaSH-Guides cannot consume YAML metadata files.                  |
| C5: 3     | Metadata scales well. But the dual-layer (SQL ops + YAML metadata) requires keeping them in sync.                            |
| C7: 4     | Low risk. Additive layer. No existing pipeline changes. Risk is limited to metadata-ops drift.                               |
| C8: 3     | Clean separation (ops for operations, metadata for documentation). Minor duplication risk between metadata and SQL comments. |
| C9: 2     | Contributors still write SQL for actual data changes. Metadata editing is low-impact.                                        |

**Option C: Exchange-Format Hybrid**

| Criterion | Score                                                                                                                                                                                        | Justification |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| C1: 3     | Authored data is still SQL for internal use. JSON exchange format improves external readability.                                                                                             |
| C2: 5     | JSON Schema-validated API distribution. Portable types formalized. Third-party tools can consume without SQLite. CDN/static hosting possible.                                                |
| C3: 5     | JSON entity representations are ideal for doc generation. Structured diffs, semantic changelogs, comparison tables all become straightforward.                                               |
| C4: 4     | JSON exchange format aligns with TRaSH-Guides ecosystem. Import adapter consumes TRaSH JSON. Export produces ecosystem-compatible JSON. Not full alignment because authoring format differs. |
| C5: 4     | JSON API scales to many consumers. New Arr apps get JSON representations. But internal authoring still scales at SQL pace.                                                                   |
| C7: 3     | Medium risk. New ingestion/export paths. Existing pipeline unchanged. Risk is in the JSON-SQL boundary translation and ensuring round-trip fidelity.                                         |
| C8: 3     | Clean boundary: SQL internal, JSON external. But two representations of the same data require synchronization.                                                                               |
| C9: 3     | External contributors can work in JSON for imports. Internal PCD authoring remains SQL. Partial barrier reduction.                                                                           |

**Option D: Seed-Data Hybrid**

| Criterion | Score                                                                                                                                                                                                                                     | Justification |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| C1: 4     | New entity definitions in YAML are highly readable. Incremental mutations remain SQL (less readable but less frequent). The seed data (25,220 lines) is the bulk of content.                                                              |
| C2: 4     | Seed data in JSON/YAML is API-friendly. Incremental ops in SQL are not. Mixed format reduces full API coverage.                                                                                                                           |
| C3: 5     | Entity definitions in YAML/JSON are ideal for docs. Incremental ops are less relevant to documentation.                                                                                                                                   |
| C4: 4     | Entity definitions align with ecosystem norms. Incremental ops do not, but these are internal operational concerns.                                                                                                                       |
| C5: 4     | New entities scale in YAML. Mutations scale in SQL. Growth in entity count benefits from YAML readability.                                                                                                                                |
| C7: 3     | Medium risk. Seed data conversion is tractable (Archaeologist: INSERTs are "TRIVIAL" for JSON). But dual-format authoring creates cognitive overhead and tooling complexity.                                                              |
| C8: 2     | Two authoring formats for different operation types is architecturally awkward. Contributors must know when to use which. The boundary between "new entity" and "mutation" can be ambiguous (e.g., adding a condition to an existing CF). |
| C9: 4     | New entity contribution in YAML is accessible. Mutation contribution still requires SQL knowledge, but new entities are the more common contribution type.                                                                                |

**Option E: Full-Authoring Hybrid**

| Criterion              | Score                                                                                                                                                                                                                    | Justification |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| C1: 5                  | All authored data in YAML/JSON. Maximum readability. Self-documenting structure with field names, comments (YAML), and JSON Schema validation.                                                                           |
| C2: 5                  | Full JSON/YAML data layer enables complete API distribution, CDN hosting, npm/JSR packaging, cross-language consumption.                                                                                                 |
| C3: 5                  | Structured data is the ideal input for doc generation. Semantic changelogs, entity pages, comparison matrices all become straightforward.                                                                                |
| C4: 5                  | Full alignment with ecosystem norms. JSON for interchange, YAML for authoring. TRaSH import adapter fits naturally. Praxrr becomes consumable by any ecosystem tool.                                                     |
| C5: 5                  | Scales to new entities, new Arr apps, new consumers, and new contributors without SQL barrier. API-first distribution enables ecosystem growth.                                                                          |
| C6: PASS (conditional) | Passes IF the value guard problem is solved. The Futurist's model preserves guards by generating them at compile time. The Archaeologist's `desired_state` JSON demonstrates feasibility. Requires prototype validation. |
| C7: 2                  | Highest risk. 3,000-5,000 lines of new code (Systems Thinker). 116 files affected (Archaeologist). Value guard expression in JSON/YAML is the critical technical gate. Multi-month engineering investment.               |
| C8: 4                  | Clean separation: YAML authoring, JSON distribution, SQL execution. Single conceptual model per layer. But the compilation layer is a new critical-path component.                                                       |
| C9: 5                  | Maximum contributor accessibility. YAML authoring is familiar to the entire Arr ecosystem. 5-10x contributor pool expansion potential (Futurist).                                                                        |

---

## 4. Weighted Totals

| Option                   | C1 (x5) | C2 (x5) | C3 (x5) | C4 (x5) | C5 (x5) | C7 (x3) | C8 (x3) | C9 (x3) | **Total** | **% of Max** |
| ------------------------ | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | --------- | ------------ |
| A: Status Quo + Tooling  | 10      | 10      | 15      | 5       | 10      | 15      | 9       | 6       | **80**    | **47%**      |
| B: Metadata Hybrid       | 15      | 10      | 20      | 10      | 15      | 12      | 9       | 6       | **97**    | **57%**      |
| C: Exchange Hybrid       | 15      | 25      | 25      | 20      | 20      | 9       | 9       | 9       | **132**   | **78%**      |
| D: Seed-Data Hybrid      | 20      | 20      | 25      | 20      | 20      | 9       | 6       | 12      | **132**   | **78%**      |
| E: Full-Authoring Hybrid | 25      | 25      | 25      | 25      | 25      | 6       | 12      | 15      | **158**   | **93%**      |

### Ranking

| Rank | Option                       | Score   | Delta from Next |
| ---- | ---------------------------- | ------- | --------------- |
| 1    | **E: Full-Authoring Hybrid** | **158** | +26             |
| 2    | C: Exchange Hybrid           | 132     | tied            |
| 2    | D: Seed-Data Hybrid          | 132     | +35             |
| 4    | B: Metadata Hybrid           | 97      | +17             |
| 5    | A: Status Quo + Tooling      | 80      | --              |

---

## 5. Sensitivity Analysis

### Scenario 1: Migration effort matters more than stated

If C7 (Migration risk) weight increases from 3 to 5:

| Option | Original | Adjusted | Change      |
| ------ | -------- | -------- | ----------- |
| A      | 80       | 90 (+10) | Gains most  |
| B      | 97       | 105 (+8) |             |
| C      | 132      | 138 (+6) |             |
| D      | 132      | 138 (+6) |             |
| E      | 158      | 162 (+4) | Gains least |

**Result**: Rankings unchanged. Option E still leads by 24 points. The HIGH-weight criteria (C1-C5) dominate so strongly that even doubling the risk weight does not shift the top position. However, the gap between E and C/D narrows from 26 to 24, making the phased approach more attractive as a risk management strategy.

### Scenario 2: Community contribution becomes the top priority

If C9 weight increases from 3 to 5:

| Option | Original | Adjusted  | Change      |
| ------ | -------- | --------- | ----------- |
| A      | 80       | 84 (+4)   |             |
| B      | 97       | 101 (+4)  |             |
| C      | 132      | 138 (+6)  |             |
| D      | 132      | 140 (+8)  | Overtakes C |
| E      | 158      | 168 (+10) | Gains most  |

**Result**: Option E extends its lead. Option D overtakes C because YAML entity authoring directly enables community contributions, while JSON exchange format (C) primarily benefits machine consumers. This scenario further strengthens the case for full authoring migration.

### Scenario 3: TRaSH-Guides releases a fundamentally new format

If C4 (Ecosystem alignment) drops from 5 to 2 (reduced relevance due to format instability):

| Option | Original | Adjusted  | Change                |
| ------ | -------- | --------- | --------------------- |
| A      | 80       | 77 (-3)   | Loses least           |
| B      | 97       | 91 (-6)   |                       |
| C      | 132      | 120 (-12) | Loses most            |
| D      | 132      | 120 (-12) |                       |
| E      | 158      | 143 (-15) | Loses most (absolute) |

**Result**: All options lose, but rankings remain identical. Option E still leads at 143. This confirms that even if TRaSH-Guides alignment becomes less relevant, the other HIGH-weight criteria (readability, API, docs, scalability) independently justify the migration. The recommendation is robust against TRaSH format instability.

### Scenario 4: Praxrr needs to support a new Arr app (e.g., Lidarr, Readarr, Whisparr)

New Arr app support primarily stresses C5 (Scalability) and C2 (API friendliness). These are already HIGH weight. The impact is:

- **Options A/B**: New Arr app requires SQL ops authoring for all entity mappings. Manual work scales linearly with entity count. Contribution barrier remains high per Arr.
- **Options C/D/E**: New Arr app entity definitions in JSON/YAML are self-documenting and reviewable. API distribution means new app data is immediately consumable. Schema validation catches Arr-specific constraint violations.

**Result**: No score changes needed (already captured in C2/C5 weights), but the practical advantage of E becomes more pronounced with each new Arr target. The Cross-Arr Semantic Validation Policy in CLAUDE.md makes structured, Arr-scoped entity definitions even more valuable.

### Scenario 5: Value guard prototype fails (cannot express guards in JSON/YAML)

This triggers Option E's conditional GATE status on C6.

| Impact   | Description                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Option E | **DISQUALIFIED**. Cannot proceed without solving value guard expression.                                            |
| Option D | Becomes the top viable option at 132. Seed data in YAML avoids the guard problem entirely (INSERTs have no guards). |
| Option C | Tied at 132. Exchange format avoids the guard problem (internal ops stay SQL).                                      |

**Result**: If the value guard prototype fails, the recommendation shifts to **Option D (Seed-Data Hybrid)** or **Option C (Exchange-Format Hybrid)** as co-leaders. Both avoid the guard problem by keeping incremental mutations in SQL.

---

## 6. Risk-Adjusted Recommendation

### Primary Recommendation: Option E (Full-Authoring Hybrid), executed as a phased roadmap

Option E scores highest across all sensitivity scenarios except the value guard failure case. The 26-point gap over the next option (C/D) is decisive. The maintainer's stated priorities (readability, API, docs, ecosystem, scalability) all weight heavily toward E.

### Phased Execution Path

The phased approach mitigates Option E's primary weakness (migration risk) by building incrementally and validating at each gate.

| Phase       | Maps To  | Deliverable                                                                                                                              | Risk Level | Gate Criterion                                                                        |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| **Phase 1** | Option B | Formalize `portable.ts` as JSON Schema. Publish `pcd.schema.json`. Add metadata layer.                                                   | Low        | JSON Schema validates against 100% of compiled cache entities.                        |
| **Phase 2** | Option C | Build JSON import/export. TRaSH import adapter. JSON API distribution via CI/CD.                                                         | Medium     | Round-trip fidelity: entity -> JSON -> SQL -> compiled cache produces identical rows. |
| **Phase 3** | --       | **Value guard prototype**. Convert the 3 most complex ops files to JSON/YAML. Prove compiled SQL produces identical row-change behavior. | Medium     | Prototype passes for all three files with zero behavioral divergence.                 |
| **Phase 4** | Option D | YAML authoring for new entity definitions. Seed data conversion. Dual-format import support.                                             | Medium     | All existing entities representable in YAML with successful compilation.              |
| **Phase 5** | Option E | YAML authoring for incremental mutations. Full exporter rewrite. Legacy SQL import deprecation path.                                     | High       | Full PCD compilation from YAML produces byte-identical SQLite cache.                  |

### Critical: Phase 3 is the Go/No-Go Gate

Phase 3 is where the value guard question gets answered empirically. If the prototype succeeds, proceed to Phase 4/5. If it fails, stop at Phase 2 (Option C) which already scores 132/170 (78%) and delivers the majority of API, documentation, and ecosystem benefits.

**This phased approach means the decision does not need to be made all at once.** Each phase delivers standalone value and each gate provides the data to decide whether to continue.

---

## 7. Decision Triggers

These are the conditions that would change the recommendation. Monitor them actively.

### Triggers that STRENGTHEN the case for Option E

| Trigger                                         | Current State        | Threshold                               | Action                                                 |
| ----------------------------------------------- | -------------------- | --------------------------------------- | ------------------------------------------------------ |
| External contributors blocked by SQL            | Unknown (no data)    | 3+ contributors report SQL as a barrier | Accelerate Phase 4/5                                   |
| TRaSH-Guides adopts a stable JSON Schema        | Implicit schema only | Published, versioned JSON Schema        | Build TRaSH adapter immediately (Phase 2)              |
| Profilarr/Dictionarry publishes YAML PCD format | SQL ops internally   | Public YAML specification               | Align on shared format to avoid fragmentation          |
| New Arr app support needed (Lidarr, Readarr)    | Radarr + Sonarr      | Third Arr app target                    | YAML entity definitions reduce per-Arr authoring cost  |
| LLM-assisted PCD authoring demand               | Not implemented      | User request for AI entity generation   | JSON Schema-constrained generation is production-ready |

### Triggers that WEAKEN the case for Option E

| Trigger                                         | Current State                  | Threshold                                          | Action                                                                          |
| ----------------------------------------------- | ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Value guard prototype fails                     | Not attempted                  | Prototype cannot reproduce SQL behavior            | Stop at Phase 2 (Option C). Do not proceed to D/E.                              |
| 95%+ PCD changes come through UI                | Unknown                        | Measured via git history analysis                  | Reduce priority. Format is invisible to primary workflow. Invest in UI instead. |
| TRaSH-Guides format breaks repeatedly           | One breaking change (Feb 2026) | 2+ breaking changes in 12 months                   | Decouple from TRaSH format. Build adapter, not alignment.                       |
| Compilation performance degrades                | Unmeasured                     | JSON/YAML compilation adds >500ms to cache rebuild | Profile and optimize, or limit scope to Option C.                               |
| Dual-format maintenance burden exceeds estimate | Not started                    | 2x estimated effort during Phase 4                 | Evaluate whether to complete Phase 5 or stabilize at Phase 4.                   |

### Triggers that shift to Option A (Status Quo + Tooling)

| Trigger                                      | Threshold                       | Reasoning                                                                |
| -------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Project remains solo-maintainer indefinitely | No community growth goal        | Format change has zero benefit if the UI is the only authoring interface |
| All PCD authoring moves to web UI            | 100% UI-driven workflow         | Investing in UI quality is higher leverage than format migration         |
| Praxrr pivots away from PCD distribution     | praxrr-db becomes internal-only | External consumption is the primary driver for JSON/YAML                 |

---

## 8. Pre-Decision Action Items

Before committing to any option beyond Phase 1, gather the empirical data that resolves the key contradictions.

| #   | Action                                                                                                                                            | Resolves                                         | Effort               | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------- | -------- |
| 1   | **Analyze git history of praxrr-db**: What percentage of commits are UI-generated vs. manual file edits?                                          | Contradiction 5 (Who is the user?)               | Low (scripting)      | HIGH     |
| 2   | **Run the value guard prototype**: Convert ops 42, 50, and 56 (highest complexity) to JSON/YAML. Verify compiled SQL produces identical behavior. | Contradiction 2 (Can JSON express guards?)       | Medium (engineering) | HIGH     |
| 3   | **Audit `deserialize.ts`**: Can it accept JSON/YAML input with modest extensions, or does it require a rewrite?                                   | Contradiction 8 (Relational model compatibility) | Low (code review)    | HIGH     |
| 4   | **Enumerate specific TRaSH interop use cases**: Is the goal import-only, bidirectional sync, or format parity?                                    | Contradiction 3 (TRaSH alignment depth)          | Low (decision)       | MEDIUM   |
| 5   | **Benchmark compilation performance**: Measure current SQL replay time. Estimate JSON/YAML parse + transform + SQL execution overhead.            | Negative Space concern 5.1-5.3                   | Low (benchmarking)   | MEDIUM   |
| 6   | **Investigate Profilarr/Dictionarry internals**: How does their YAML-to-SQL bridge handle value guards, validation, and incremental updates?      | Contradiction 9 (Profilarr precedent)            | Medium (research)    | LOW      |

---

## 9. Summary

| Question                                         | Answer                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **What should the maintainer do?**               | Start Phase 1 (JSON Schema formalization) immediately. It is zero-risk, purely additive, and delivers standalone value.                                            |
| **What is the target end state?**                | Option E (Full-Authoring Hybrid) -- YAML authoring, JSON distribution, SQL execution.                                                                              |
| **What could stop the migration?**               | Value guard prototype failure (Phase 3 gate). If guards cannot be faithfully expressed, stop at Option C.                                                          |
| **When should the decision be revisited?**       | After Phase 3 prototype results. After gathering contributor data (Action Item 1). After any TRaSH-Guides format change.                                           |
| **What is the fallback?**                        | Option C (Exchange-Format Hybrid) at 78% of max score. Delivers API distribution, doc generation, and ecosystem alignment without solving the value guard problem. |
| **What should NOT change regardless of option?** | SQL DDL schema. Append-only ops model. In-memory SQLite cache compilation. Value guard conflict detection. User ops / base ops layer separation.                   |
