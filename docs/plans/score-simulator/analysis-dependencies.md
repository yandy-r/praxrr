# Score Simulator - Phase 1 Dependency Analysis

**Scope**: Phase 1 (MVP) — single release scoring with full condition detail
**Branch**: `feat/score-simulator`

---

## Task List

13 tasks cover the complete Phase 1 implementation.

| ID  | Task                               | Files                                                                      | Effort |
| --- | ---------------------------------- | -------------------------------------------------------------------------- | ------ |
| T01 | OpenAPI schema YAML                | `docs/api/v1/schemas/score-simulator.yaml` (create)                        | 1h     |
| T02 | OpenAPI path YAML                  | `docs/api/v1/paths/score-simulator.yaml` (create)                          | 30m    |
| T03 | Register in openapi.yaml           | `docs/api/v1/openapi.yaml` (modify)                                        | 15m    |
| T04 | Generate TypeScript types          | `packages/praxrr-app/src/lib/api/v1.d.ts` (regenerated)                    | 10m    |
| T05 | API endpoint implementation        | `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts` (create) | 3-4h   |
| T06 | Parent redirect route              | `src/routes/score-simulator/+page.server.ts` + `+page.svelte` (create)     | 30m    |
| T07 | Child route server load            | `src/routes/score-simulator/[databaseId]/+page.server.ts` (create)         | 1h     |
| T08 | Main page Svelte component         | `src/routes/score-simulator/[databaseId]/+page.svelte` (create)            | 3-4h   |
| T09 | ReleaseInput component             | `.../[databaseId]/components/ReleaseInput.svelte` (create)                 | 1-2h   |
| T10 | SimulationResults component        | `.../[databaseId]/components/SimulationResults.svelte` (create)            | 2-3h   |
| T11 | ScoreBreakdown component           | `.../[databaseId]/components/ScoreBreakdown.svelte` (create)               | 1-2h   |
| T12 | ProfileComparison component        | `.../[databaseId]/components/ProfileComparison.svelte` (create)            | 1-2h   |
| T13 | Nav registration + disclosure keys | `registry.ts` + `sectionKeys.ts` (modify)                                  | 30m    |

---

## Dependency Graph

```
T01 ──────────┐
              ├──► T03 ──► T04 ──► T05 ──────────────────────────┐
T02 ──────────┘             │                                     │
                            ├──► T10 ──────────────────────────┐  │
                            ├──► T11 ──────────────────────────┤  │
                            └──► T12 ──────────────────────────┤  │
                                                               │  │
T06 ──────────────────────────────────────────────────────┐   │  │
T07 ──────────────────────────────────────────────────────┤   │  │
T09 ──────────────────────────────────────────────────────┴───┴──┴──► T08
T13 (independent, no outbound deps in Phase 1)
```

**Edges** (A → B means "A must complete before B starts"):

- T01 → T03, T02 → T03
- T03 → T04
- T04 → T05, T04 → T10, T04 → T11, T04 → T12
- T05 → T08 (full integration)
- T06 → T08, T07 → T08 (route infrastructure)
- T09 → T08, T10 → T08, T11 → T08, T12 → T08 (components)
- T13 → (none)

---

## Parallel Execution Batches

### Batch 1 — No Prerequisites (start immediately)

| Task | Work                    |
| ---- | ----------------------- |
| T01  | OpenAPI schema YAML     |
| T02  | OpenAPI path YAML       |
| T06  | Parent redirect route   |
| T07  | Child route server load |
| T09  | ReleaseInput component  |
| T13  | Nav + disclosure keys   |

### Batch 2 — Contract Gate (sequential, non-parallelizable)

| Task | Work                           | Prerequisite |
| ---- | ------------------------------ | ------------ |
| T03  | Register in openapi.yaml       | T01 + T02    |
| T04  | `deno task generate:api-types` | T03          |

### Batch 3 — Core Implementation (after T04 green)

| Task | Work                        |
| ---- | --------------------------- |
| T05  | API endpoint implementation |
| T10  | SimulationResults component |
| T11  | ScoreBreakdown component    |
| T12  | ProfileComparison component |

### Batch 4 — Integration

| Task | Work                       | Prerequisite    |
| ---- | -------------------------- | --------------- |
| T08  | Main page Svelte component | All above tasks |

---

## Critical Path

```
T01 → T03 → T04 → T05 → T08
```

- **Single developer**: ~8-11h focused work
- **Two developers**: ~5-6h wall-clock
- The T04 gate is the highest-leverage point — any schema error forces a loop back

---

## Risk Dependencies

| ID  | Risk                                                               | Severity | Affects                 | Mitigation                                                                                                      |
| --- | ------------------------------------------------------------------ | -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| R1  | OpenAPI cross-file `$ref` for `ParsedInfo` breaks type generation  | HIGH     | T04, blocks T05+T10-T12 | Verify `$ref` syntax against existing cross-file references; run `deno task check:server` immediately after T04 |
| R2  | `scoring()` called N times per request (40 queries at 10 profiles) | MEDIUM   | T05 performance         | Accept for MVP; in-memory SQLite concurrent reads are safe                                                      |
| R3  | Parser service must be running for end-to-end testing              | MEDIUM   | T05, T08 testing        | Test degraded mode first; start parser for happy-path                                                           |
| R4  | `evaluateCustomFormat()` conditions must NOT be discarded          | LOW      | T05 correctness         | Use `result.conditions` directly; no changes to evaluator.ts needed                                             |
| R5  | Score resolution must use `scoring()` not direct table queries     | LOW      | T05 correctness         | Call `scoring()` per profile; access `.scores[arrType]` directly                                                |
| R6  | SvelteKit `$types` not generated for new route directory           | LOW      | T08 dev env             | Restart `deno task dev` after creating route directory                                                          |

---

## Summary Matrix

| Task | Batch | Earliest Start | Hard Blockers    | Unblocks       | Risk    |
| ---- | ----- | -------------- | ---------------- | -------------- | ------- |
| T01  | 1     | Immediately    | none             | T03            | R1      |
| T02  | 1     | Immediately    | none             | T03            | Low     |
| T06  | 1     | Immediately    | none             | T08 navigation | Low     |
| T07  | 1     | Immediately    | none             | T08 PageData   | Low     |
| T09  | 1     | Immediately    | none             | T08 wiring     | Low     |
| T13  | 1     | Immediately    | none             | none           | Low     |
| T03  | 2     | T01 + T02      | T01, T02         | T04            | R1      |
| T04  | 2     | T03            | T03              | T05, T10-T12   | R1 HIGH |
| T05  | 3     | T04            | T04              | T08 API data   | R2-R5   |
| T10  | 3     | T04            | T04              | T08 wiring     | Low     |
| T11  | 3     | T04            | T04              | T08 wiring     | Low     |
| T12  | 3     | T04            | T04              | T08 wiring     | Low     |
| T08  | 4     | All above      | T04-T07, T09-T12 | Feature ships  | R3, R6  |
