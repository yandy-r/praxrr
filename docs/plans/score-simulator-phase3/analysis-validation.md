# Analysis: Score Simulator Phase 3 — Validation & Risk Assessment

> Generated: 2026-03-06 | Phase: Analysis | Source: shared.md + component API inspection

---

## 1. Component API Compatibility

### Button Component (`$ui/button/Button.svelte`)

- Props verified: `text`, `variant` (primary/secondary/danger/ghost), `size` (xs/sm/md), `icon`,
  `responsive`, `hideTextOnMobile`, `href`, `target`, `disabled`
- Event: Uses native `on:click` forwarding (not dispatched), compatible with parent binding
- **All proposed Button usages (SimulateButton, Copy Link, Reset All) are COMPATIBLE**

### NumberInput Component (`$ui/form/NumberInput.svelte`)

- Props verified: `name` (required), `value`, `min`, `max`, `step`, `compact`, `responsive`, `font`
  (mono/sans), `onchange`, `disabled`
- `onchange` callback receives `number` (never `undefined`)
- On blur with empty input: sets `value = undefined` and dispatches `change` with `undefined`, but
  does NOT call `onchange`
- **RISK: Override handler must detect `undefined` from blur-clear.** Use `on:change` event
  alongside `onchange` callback to catch clear-as-reset.
- Proposed `step={1}` + `compact` + `font="mono"` usage is valid

### Score Component (`$ui/arr/Score.svelte`)

- Props: `score`, `showSign`, `size`, `colored` — no incompatibility with proposed usage

### Alert Store (`$lib/client/alerts/store.ts`)

- `alertStore.add(type, message, duration?)` — all proposed calls are valid
- Duration 0 = persistent until dismissed

### ScoreBreakdown — Modification Analysis

- Currently 88 lines, single prop `profileScore`, no events dispatched
- Phase 3 adds callback props (`onOverrideChange`, `onOverrideReset`, `onOverrideResetAll`) —
  consistent with NumberInput's callback-prop pattern
- **RISK: Layout shift** when replacing inline `Score` with `NumberInput` (compact mode still
  wider). Mitigate with CSS dimension matching.

### RankingTable — Re-ranking Responsibility

- Currently receives pre-computed `rankedReleases` from parent via `buildRankingFromResults()`
- **Recommendation: Apply overrides in the reactive declaration**, not inside RankingTable. Keep
  RankingTable as pure display. Either add overrides param to `buildRankingFromResults()` or apply
  overrides to contributions before calling it.

### ComparisonView — Override Integration

- `buildComparisonResult()` reads `profileScores[].contributions` directly from API response
- **Recommendation: Add overrides param to `buildComparisonResult()`** or create copy of
  contributions with overrides applied before passing. Never mutate cached API response.

---

## 2. Edge Case Analysis

### URL State Edge Cases

| #   | Edge Case                            | Expected Behavior                                        | Risk   |
| --- | ------------------------------------ | -------------------------------------------------------- | ------ |
| U1  | Malformed base64 in `batch` param    | `atob()` throws; catch and return empty batch            | Medium |
| U2  | Malformed JSON inside valid base64   | `JSON.parse()` throws; same catch block                  | Medium |
| U3  | Non-integer values in `overrides`    | `{"DV": 3.14}` — round to integer                        | Low    |
| U4  | Unencoded special chars in `profile` | `pcd:HD Bluray` — URLSearchParams handles natively       | Low    |
| U5  | Colon in profile name                | `pcd:Profile:Special` — split on first colon only        | Medium |
| U6  | Invalid mediaType                    | `mediaType=podcast` — fall back to `'movie'`             | Low    |
| U7  | arrType=lidarr                       | Simulator only supports radarr/sonarr; default to radarr | Medium |
| U8  | Empty string params                  | `?title=&profile=` — treat as absent                     | Low    |
| U9  | URL exceeds 2000 chars               | Drop overrides first, then batch; warn user              | Medium |
| U10 | Unicode in release titles            | `encodeURIComponent` handles correctly                   | Low    |
| U11 | Duplicate params                     | `URLSearchParams.get()` returns first value              | Low    |
| U12 | Batch with >50 titles encoded        | `parseBatchTitles()` already enforces limit              | Low    |

### What-If Override Edge Cases

| #   | Edge Case                            | Expected Behavior                                        | Risk   |
| --- | ------------------------------------ | -------------------------------------------------------- | ------ |
| W1  | Empty override map `{}`              | No changes; unchanged behavior                           | Low    |
| W2  | Negative score override              | Valid (blocking CFs); subtracts from total               | Low    |
| W3  | Override for CF not in contributions | Silently ignored                                         | Medium |
| W4  | Override same value as original      | Do NOT show amber indicator                              | Medium |
| W5  | Override to 0                        | Valid; CF row still appears; no amber if original was 0  | Low    |
| W6  | Very large override value            | NumberInput accepts; JS handles large numbers            | Low    |
| W7  | NaN from malformed URL override      | Validate with `Number.isFinite()` in parser              | Medium |
| W8  | Override + new simulation            | Override map persists; non-matching CFs silently ignored | Medium |
| W9  | Override + profile change            | Same as W8; overrides persist across profile changes     | Medium |
| W10 | Override in batch mode               | Applies uniformly to all releases                        | Low    |
| W11 | Override + comparison mode           | Primary profile only; comparison shows baseline          | Medium |
| W12 | Float override from NumberInput      | Enforce via `step={1}` + round in handler                | Medium |
| W13 | Clearing input (empty + blur)        | Treat as "reset to original" (remove override)           | Medium |

### Deep-Link Edge Cases

| #   | Edge Case                           | Expected Behavior                                                    | Risk   |
| --- | ----------------------------------- | -------------------------------------------------------------------- | ------ |
| D1  | Dirty guard on scoring page         | Standard `beforeNavigate` guard fires                                | Low    |
| D2  | Database ID mismatch                | Server load returns 404 (existing error handling)                    | Low    |
| D3  | Special chars in profile name       | Must `encodeURIComponent()` in deep-link URL                         | Medium |
| D4  | PCD vs TRaSH profile                | Deep-link always uses `pcd:` prefix                                  | Low    |
| D5  | Profile renamed between navigation  | Show warning, leave dropdown open                                    | Low    |
| D6  | arrType default to radarr           | Limitation: profile with Sonarr-only CFs may show unexpected results | Medium |
| D7  | SimulateButton without scoring data | Conditionally render or disable when `data.scoring` is null          | Low    |

---

## 3. Testing Strategy Validation

### Unit Test Gaps to Address

- Override matching original value (no visual indicator) — not in spec
- Float input rounding behavior — spec says integer-only but type accepts number
- `arrType=lidarr` rejection — parser should filter to radarr/sonarr
- `copyShareLink()` clipboard fallback — needs clipboard API mock

### E2E Test Gaps to Address

- Profile names with special characters (spaces, colons, unicode)
- Batch ranking tie-breaking with overrides (deterministic order)
- URL with non-existent profile (warning + dropdown open)

### Regression Risk

**Low.** Phase 3 adds new props with defaults; existing behavior unchanged. If
`buildRankingFromResults()` gains an optional `overrides` param, existing tests calling without it
must still pass with default empty map.

---

## 4. Must-Fix Before Implementation

1. **NumberInput blur-clear handling:** Override handler must detect `undefined` from blur and treat
   as reset. Use `on:change` event alongside `onchange` callback.
2. **Double-encoding prevention:** SimulateButton URL must use `URLSearchParams` API to avoid
   double-encoding `pcd:` prefix colon.
3. **Override-aware ranking:** `buildRankingFromResults()` must accept optional overrides to
   recompute both `totalScore` and `thresholdState`. Do not compute overrides inside RankingTable.

## 5. Should-Fix

4. Override same-as-original detection (W4) — skip amber indicator
5. Float enforcement (W12) — round override values to integers
6. arrType=lidarr rejection (U7) — filter to radarr/sonarr only
7. localStorage vs URL precedence — URL params take priority on mount

## 6. Integration Risk Points

- **onMount URL state vs localStorage race:** URL params must be checked first; only fall back to
  localStorage if no URL params
- **Override lifecycle on re-simulation:** Override map persists; CFs not in new results are
  silently ignored
- **Scoring page `data.scoring.name` format:** Raw name must be wrapped with `pcd:` prefix for
  deep-link
- **ComparisonView override integration:** Must not mutate cached API response; use copy or extend
  `buildComparisonResult()`
- **Clipboard API in non-secure contexts:** Follow existing `InstanceForm.svelte` fallback pattern
  using `document.execCommand('copy')`
