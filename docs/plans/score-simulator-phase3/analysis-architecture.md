# Analysis: Score Simulator Phase 3 — Architecture & Dependencies

> Generated: 2026-03-06 | Phase: Analysis | Source: shared.md + codebase inspection

---

## Dependency Graph

```
                         +------------------------+
                         |  helpers.ts             |
                         |  (override functions)   |
                         |  LAYER 0 - Foundation   |
                         +------------+------------+
                                      |
              +-----------------------+------------------------+
              |                       |                        |
              v                       v                        v
+---------------------+ +--------------------+ +-------------------------+
|  urlState.ts        | | ScoreBreakdown     | | SimulateButton.svelte   |
|  (new file)         | | .svelte (modify)   | | (new file)              |
|  LAYER 1            | | LAYER 1            | | LAYER 1 - Independent   |
+----------+----------+ +--------+-----------+ +-----------+-------------+
           |                      |                         |
           |          +-----------+                         |
           |          |           |                         |
           v          v           v                         v
+------------------------------------------+ +-------------------------+
|  +page.svelte (score-simulator)          | | scoring/+page.svelte    |
|  (modify: URL state + override wiring)   | | (modify: add button)    |
|  LAYER 2 - Orchestrator                  | | LAYER 2                 |
+------+-------------+--------------------+ +-------------------------+
       |              |
       v              v
+--------------+ +------------------+
| RankingTable | | ComparisonView   |
| .svelte      | | .svelte          |
| LAYER 2      | | LAYER 2          |
+--------------+ +------------------+
       |              |
       v              v
+------------------------------------------+
|  scripts/test.ts  (add aliases)          |
|  LAYER 0 - Independent                   |
+------------------------------------------+
       |
       v
+------------------------------------------------------------------+
|  TESTS (LAYER 3)                                                  |
|  +---------------------------+ +------------------------------+  |
|  | Unit: phase3Helpers       | | Unit: urlState               |  |
|  | (depends: helpers.ts)     | | (depends: urlState.ts)       |  |
|  +---------------------------+ +------------------------------+  |
|  +---------------------------+ +------------------------------+  |
|  | E2E: 4.1 deep-link        | | E2E: 4.2 what-if            |  |
|  | (needs: SimulateButton    | | (needs: ScoreBreakdown +     |  |
|  |  + scoring page mod)      | |  +page.svelte overrides)     |  |
|  +---------------------------+ +------------------------------+  |
|  +-------------------------------------------------------------+ |
|  | E2E: 4.3 url-state (needs: urlState + Copy Link button)     | |
|  +-------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

---

## Parallel Batches

### Batch 0 — Foundation (no dependencies, all parallelizable)

| Task | File                                                                                                      | Rationale                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| T0a  | `helpers.ts` — add `applyScoreOverrides()`, `computeOverriddenTotal()`, `resolveThresholdWithOverrides()` | Pure functions, no imports from new files. All override work depends on these.     |
| T0b  | `urlState.ts` — create with `parseUrlState()`, `serializeUrlState()`, `copyShareLink()`                   | Self-contained module. Imports only `SimulatorUrlState` type defined in same file. |
| T0c  | `SimulateButton.svelte` — create deep-link button                                                         | Standalone component. Imports only `Button` + `goto`. No Phase 3 dependency.       |
| T0d  | `scripts/test.ts` — add test aliases                                                                      | Single file edit, no dependencies.                                                 |

### Batch 1 — Component Modifications (depend on Batch 0)

| Task | File                                                                  | Depends On                     |
| ---- | --------------------------------------------------------------------- | ------------------------------ |
| T1a  | `ScoreBreakdown.svelte` — inline-editable scores, override indicators | T0a (override helpers + types) |
| T1b  | `scoring/+page.svelte` — import and render SimulateButton             | T0c (SimulateButton.svelte)    |

### Batch 2 — Orchestrator Wiring (depends on Batches 0 + 1)

| Task | File                                                                            | Depends On             |
| ---- | ------------------------------------------------------------------------------- | ---------------------- |
| T2a  | `+page.svelte` (score-simulator) — URL state reading, override state, Copy Link | T0a, T0b, T1a          |
| T2b  | `RankingTable.svelte` — accept overrides, re-rank                               | T0a (override helpers) |
| T2c  | `ComparisonView.svelte` — show overrides on primary profile                     | T0a (override helpers) |

### Batch 3 — Tests (depend on implementation)

| Task | File                                    | Depends On      |
| ---- | --------------------------------------- | --------------- |
| T3a  | `scoreSimulatorPhase3Helpers.test.ts`   | T0a             |
| T3b  | `scoreSimulatorUrlState.test.ts`        | T0b             |
| T3c  | `4.1-score-simulator-deep-link.spec.ts` | T0c + T1b       |
| T3d  | `4.2-score-simulator-what-if.spec.ts`   | T0a + T1a + T2a |
| T3e  | `4.3-score-simulator-url-state.spec.ts` | T0b + T2a       |

---

## Critical Path

Longest dependency chain (4 steps):

```
T0a (helpers.ts: override functions)
  -> T1a (ScoreBreakdown.svelte: inline editing + indicators)
    -> T2a (+page.svelte: wire overrides + URL state + Copy Link)
      -> T3d (E2E: 4.2-what-if test)
```

All other work can proceed in parallel alongside this chain.

---

## File Modification Details

### New Files

**`urlState.ts`** — Self-contained. Defines `SimulatorUrlState` interface, `ScoreOverrideMap` type.
Exports `parseUrlState()`, `serializeUrlState()`, `copyShareLink()`. URL length truncation logic
(drop overrides first, then batch). Depends on nothing. Depended on by `+page.svelte` and URL state
unit tests.

**`SimulateButton.svelte`** — Props: `databaseId: string`, `profileName: string`. Imports `Button`
from `$ui/button/Button.svelte`, `goto` from `$app/navigation`, `FlaskConical` from `lucide-svelte`.
Constructs URL with `pcd:` prefix + `encodeURIComponent`. Depends on nothing. Depended on by
`scoring/+page.svelte`.

### Modified Files

**`helpers.ts`** — Pure additions only. Three new exported functions + `ScoreOverrideMap` type. No
modifications to existing functions. Foundation for all override work.

**`ScoreBreakdown.svelte`** (88 -> ~160 lines) — New props: `overrides`, `onOverrideChange`,
`onOverrideReset`, `onOverrideResetAll`. Each contribution row gains click-to-edit `NumberInput`.
Active overrides show amber border + background. Original value as strikethrough. Delta display.

**`RankingTable.svelte`** — New prop: `overrides: ScoreOverrideMap = {}`. Apply
`computeOverriddenTotal()` before ranking. Visual indicator on override-affected rows.

**`ComparisonView.svelte`** — New prop: `overrides: ScoreOverrideMap = {}`. Overrides apply to
Profile A (primary) only. Profile B shows baseline. Delta recalculated with overridden A.

**`+page.svelte` (score-simulator)** — New state: `scoreOverrides`, `hasActiveOverrides`,
`overrideCount`. onMount reads URL params via `parseUrlState()`. New handlers: override
change/reset/resetAll, copy link. Passes overrides to all children. Info banner + Reset All button.

**`scoring/+page.svelte`** — Import `SimulateButton`, render in StickyCard right slot between
Options and Save buttons. Wire `databaseId` and `profileName` props.

**`scripts/test.ts`** — Add aliases: `url-state`, `what-if`, `phase3`.
