# Complexity Analysis: Score Simulator - Phase 1 (MVP)

**Scope**: Phase 1 tasks only — single release scoring with full condition detail

---

## 1. Per-Task Complexity Ratings

| Task                            | Complexity  | Reasoning                                                                                                                                            |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 - OpenAPI Schema + Path      | Low         | Schema content pre-specified in research-technical.md; YAML conventions established by entity-testing.yaml                                           |
| T2 - API Endpoint               | Medium      | Pipeline copied from evaluate endpoint (65% reuse); new: multi-profile loop, score summation, `ConditionResult[]` preservation, profile 404 handling |
| T3 - Type Generation            | Low         | Single command (`deno task generate:api-types`); verification checkpoint, not implementation                                                         |
| T4a - Parent redirect pages     | Low         | Literal 11-LOC server + 45-LOC redirect page from entity-testing pattern                                                                             |
| T4b - Child server + page shell | Low-Medium  | Simpler than entity-testing (no entity tests, TMDB, Arr instances); ~50 LOC server, ~80 LOC page shell                                               |
| T5 - ReleaseInput               | Medium      | No direct analog; textarea + debounce + arr type selector + localStorage persistence                                                                 |
| T6 - ParsedMetadata             | Low         | Near-direct lift from `ReleaseTable.svelte` lines 239-305 (badge rendering)                                                                          |
| T7a - CF match table (flat)     | Medium      | `ExpandableTable` integration reused; column definitions and match/score display are new                                                             |
| T7b - Condition drill-down      | Medium-High | Most novel UI; nested condition sub-table has no codebase analog; N/A display, zero-score distinction                                                |
| T8 - ScoreBreakdown             | Medium      | `Score.svelte` + `Dropdown.svelte` reused; threshold indicators (minimum/upgrade-until) are new                                                      |
| T9+T10 - Registry items         | Low         | Single array entry + single constant; pure pattern copies                                                                                            |

---

## 2. Lines of Code Estimates

| Task                                       | New Logic LOC | Adapted Pattern LOC | Total Authored |
| ------------------------------------------ | ------------- | ------------------- | -------------- |
| T1 - OpenAPI schemas + path + openapi.yaml | 152           | 20                  | 172            |
| T2 - API endpoint                          | 80            | 55                  | 135            |
| T3 - Type generation                       | 0             | 0                   | 0              |
| T4a - Parent pages                         | 7             | 55                  | 62             |
| T4b - Child server + shell                 | 85            | 45                  | 130            |
| T5 - ReleaseInput                          | 85            | 35                  | 120            |
| T6 - ParsedMetadata                        | 20            | 70                  | 90             |
| T7a - CF table (flat)                      | 60            | 40                  | 100            |
| T7b - Condition drill-down                 | 65            | 35                  | 100            |
| T8 - ScoreBreakdown                        | 70            | 60                  | 130            |
| T9+T10 - Registry items                    | 15            | 0                   | 15             |
| **TOTAL**                                  | **639**       | **415**             | **1,054**      |

**Overall reuse: ~60%** of authored code is adapted from existing patterns. The remaining ~40% is genuinely new logic concentrated in T2 (score loop), T5 (input interaction), and T7b (condition drill-down).

---

## 3. Reuse Assessment

| Task   | Reuse % | What Is Reused                                                                    | What Is New                                                               |
| ------ | ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| T1     | 85%     | YAML format from entity-testing schema; schema content from research-technical.md | String correlation ID; response envelope shape                            |
| T2     | 65%     | Full parse-evaluate pipeline; all imported functions identical                    | Multi-profile loop; score summation; conditions preservation; profile 404 |
| T4a    | 90%     | Literal server + redirect templates                                               | Storage key; redirect path                                                |
| T4b    | 60%     | Database loading; cache access; parser health                                     | No entity tests/TMDB/Arr instances                                        |
| T5     | 30%     | onclick convention; alertStore; localStorage                                      | Textarea + debounce + API-trigger; type selectors                         |
| T6     | 80%     | Badge rendering from ReleaseTable.svelte                                          | Standalone wrapper; null-state                                            |
| T7a    | 45%     | ExpandableTable; Score.svelte; column patterns                                    | Match indicator column; CF-level score                                    |
| T7b    | 35%     | ExpandableTable expanded slot                                                     | Condition sub-table; N/A display; zero-score distinction                  |
| T8     | 50%     | Score.svelte; Dropdown.svelte; profile selection                                  | Threshold indicators; sorted contribution list                            |
| T9+T10 | 95%     | Array entry shape; constant export pattern                                        | New values only                                                           |

---

## 4. Risk Register

| Risk ID | Risk                                                             | Task | Severity | Mitigation                                                                     |
| ------- | ---------------------------------------------------------------- | ---- | -------- | ------------------------------------------------------------------------------ |
| RISK-01 | `scoring()` called N times: 40 Kysely queries at 10 profiles     | T2   | Medium   | Accept for MVP; in-memory SQLite sub-millisecond per query                     |
| RISK-02 | `scoring()` throws on missing profile (not null return)          | T2   | Medium   | Wrap in try-catch; convert "not found" to HTTP 404 with `missing` array        |
| RISK-03 | Score resolution re-implementation diverges from `scoring()`     | T2   | Medium   | Use `cfScoring.scores[arrType]` directly; do NOT re-implement precedence       |
| RISK-04 | Page server calls `allCfScores()` unnecessarily (expensive)      | T4b  | Low      | Use `qualityProfileQueries.select(cache)` for names only                       |
| RISK-05 | Debounce timer leak on component destroy                         | T5   | Low      | Clear timeout in `onDestroy` lifecycle                                         |
| RISK-06 | Arr type selector defaults silently (violates Cross-Arr Policy)  | T5   | Medium   | Initialize arrType to null; disable simulate until explicit selection          |
| RISK-07 | Zero-score matched CFs filtered out (copied from entity-testing) | T7   | Medium   | Do NOT copy `score !== 0` filter; show all matched CFs                         |
| RISK-08 | Condition drill-down data volume (10K objects at scale)          | T7b  | Low      | ExpandableTable only renders expanded rows; progressive rendering              |
| RISK-09 | Threshold indicator semantics ("upgrade until" is non-obvious)   | T8   | Medium   | Use Radarr-native labels: "Below Minimum", "Accepted", "Upgrade Until Reached" |

---

## 5. Task Sizing Recommendations

### Split

- **T4 → T4a + T4b**: Parent redirect (30m boilerplate) separate from child server + shell (1.5h with layout decisions)
- **T7 → T7a + T7b**: Flat CF table (1-2h) separate from condition drill-down (2-3h, highest UI risk)

### Merge

- **T9 + T10**: Single commit `chore: register score-simulator nav item and disclosure keys`
- **T6 can merge into T7a** if fewer files preferred (parsed metadata inlined in SimulationResults)

---

## 6. Implementation Order (Risk-Reducing)

```
Level 1 (no dependencies):     T1, T9+T10
Level 2 (requires T1):         T3 (type generation gate)
Level 3 (requires T3):         T4a, T2 (parallel)
Level 4 (requires T4a + T2):   T4b
Level 5 (requires T4b):        T5, T6 (parallel)
Level 6 (requires T5+T6+T2):   T7a, T8 (parallel)
Level 7 (requires T7a):        T7b
```

**Rationale**: Contract-first (T1) → types gate (T3) → API before UI (T2) → shell (T4b) → leaf components → results display → drill-down last (highest risk, benefits from stable foundation).

**Estimated Phase 1 duration**: 4-6 days single developer.
