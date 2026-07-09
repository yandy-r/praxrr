I have the grounding I need. The critical reuse boundary is confirmed: `withSandboxCache` takes `Map<profileName, ProfileEdit>` where `ProfileEdit = { input: UpdateScoringInput; changes: ProposedChange[] }` — so the goals engine's `UpdateScoringInput` feeds the sandbox verbatim, and `buildConfigDiff` diffs current vs sandbox via `computeUserOverrides`. Here is the synthesized design doc.

---

# Design: Quality Goals — Foundation Slice (issue #20)

**Status:** Ready to build · **Engine version:** `GOALS_ENGINE_VERSION = '1'` · **Targets this slice:** `radarr`, `sonarr`

## Architectural decision (resolving the two panels)

The product panel favored **curated-anchor** (TRaSH-native, hand-validated presets, coverage %); the engineering panel favored **rule-classifier** (clean `classify → policy` decomposition, auditable table, no catalog to maintain, matches the brief's "categorize by tags/name/description" framing). Both panels converged on the _same synthesis_: a classifier→policy engine whose preset outputs are **golden-anchored to validated TRaSH-native score maps**.

This doc adopts that synthesis:

- **Base = rule-classifier** (classify by available semantic signal, then a single tunable policy table). It matches the brief's data-driven framing, generalizes to any tagged library, and gives per-score traceability (one `ruleId` + one policy row).
- **Graft from curated-anchor:** (1) **golden-anchor discipline** — the policy constants are _tuned_ so each preset at default weights emits a hand-validated, TRaSH-native map, pinned by golden fixtures (converts "locks intent" → "locks correctness"); (2) **native TRaSH magnitudes** (unwanted `-10000` hard-reject, rewards in the hundreds/thousands) so generated scores read coherently beside existing manual TRaSH scores; (3) **coverage %** transparency and advisory suggestions for uncategorized CFs; (4) the **exact, verified reuse boundary** — `UpdateScoringInput → ProfileEdit → withSandboxCache → buildConfigDiff`.
- **Graft from data-driven:** (5) a **5th `unwantedStrictness` slider** (both other proposals have direct junk-rejection tuning; rule-classifier's 4-slider set was the product panel's main ding); (6) **per-arr axis filtering at classification time** (drop video-only categories for lidarr) as the forward seam.
- **Explicitly rejected:** data-driven's baroque interacting formulas + formula-derived thresholds (highest latent mis-scoring risk, hardest to test); rule-classifier's unconditional `-1000` resolution sentinel (product panel: over-aggressive) — replaced with a **bounded additive ceiling demotion** and an honest UI note; a second `CATALOG_VERSION` stamp (no catalog → one version stamp); a dedicated `narrate.ts` in this slice (reason objects are already narration-ready; wire #21 in a follow-up).

---

## 1. Summary & goals

**Ships in this slice:** an intent→implementation bridge for one quality profile at a time. The user picks one of 4 presets and adjusts 5 sliders; a **pure, versioned, deterministic** engine (`$shared/goals`) classifies every custom format present in the PCD cache into a closed semantic category, applies a tunable scoring policy, and emits a standard `UpdateScoringInput`. That input flows through the **existing** `buildScoringOps`/`withSandboxCache` (non-persisting preview) and `updateScoring` (persisting apply) — the same op layer as manual config. A goal _binding_ (intent metadata: preset + weights + engine version) is persisted in the app DB; the actual scores live only in `pcd_ops`. The UI always shows the full generated config with per-score rationale, a coverage split, an uncategorized panel, and a live goal-diff.

**Goals**

- Goals compile to the **same in-memory cache** as manual config — no parallel scoring system.
- Engine is pure (`no I/O`), deterministic, unit-testable, versioned, importable by client **and** server.
- **Transparency is structural, not optional:** every score carries a machine-readable reason; the full config is always shown before any write; uncategorized CFs are flagged, never silently mis-scored.
- **Override is first-class:** applied scores are standard user ops, editable everywhere manual scores are; the binding surfaces drift ("you hand-edited these away from the goal") but never reverts edits.
- Per-arr correctness enforced: concrete `arrType` always, never `'all'`.

**Explicit non-goals (this slice)** — see §9 for the crisp boundary. Headlines: no quality-ladder gating (`quality_profile_qualities` enabled/cutoff), no Lidarr apply path, no natural-language input, no multi-profile batch, no dedicated narration module wiring.

---

## 2. Translation model — exact, deterministic math

The engine is `computeGoalPlan(input): GoalPlan`, composed of two pure stages plus threshold derivation. All arithmetic is integer (`Math.round`, half-up); no `Date`, `Math.random`, or Map-iteration-order dependence. Identical input ⇒ deep-equal output.

### 2.1 Input (materialized by the route; engine touches no DB)

```ts
interface ComputeGoalPlanInput {
  arrType: 'radarr' | 'sonarr'; // 'lidarr' accepted by classifier, not by apply in slice 1
  preset: GoalPresetId; // resolves default weights; overridden by weights
  weights: GoalAxisWeights; // the 5 sliders (resolved: preset defaults + user edits)
  customFormats: CfFacts[]; // one per CF in the cache for this arrType
  currentThresholds: { minimumScore; upgradeUntilScore; upgradeScoreIncrement };
}
interface CfFacts {
  name: string; // stable case-insensitive key
  description: string | null;
  tags: string[]; // lowercased custom_format_tags
}
```

`resolutionLevel` is **not** an input field — it is derived purely by `detectResolutionLevel(facts)` (below), independent of category classification.

### 2.2 Slider axes

Five axes. Four map to a **signed weight** `w = (v − 50) / 50 ∈ [−1, +1]`; `unwantedStrictness` maps to a **one-directional** `u = v / 100 ∈ [0, 1]`; `resolutionCeiling` is a discrete enum, not a weight.

| key                  | label               | range/type                                | numeric effect                                                                                                                                                                                        |
| -------------------- | ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qualityVsSize`      | Quality vs Size     | 0–100 → `wQ`                              | Scales fidelity categories: remux `+700·wQ`, audio_lossless `+300·wQ`, audio_advanced `+150·wQ`, rg_tier1/2/3 `+150/75/25·wQ`, movie_version `+100·wQ`. Also scales `upgradeUntilScore` by `wQ·1000`. |
| `compatibility`      | Compatibility       | 0–100 → `wC`                              | Penalizes hardware-demanding categories: hdr_dv `−500·wC`, audio_advanced `−300·wC`, hdr_hdr10plus `−200·wC`, audio_lossless `−200·wC`, hdr_baseline `−100·wC`; rewards streaming_service `+100·wC`.  |
| `hdrPreference`      | HDR Preference      | 0–100 → `wH`                              | Dominant HDR driver: hdr_dv `+700·wH`, hdr_hdr10plus `+600·wH`, hdr_baseline `+500·wH`. No effect on non-HDR categories.                                                                              |
| `unwantedStrictness` | Unwanted Strictness | 0–100 → `u`                               | Sets `minimumScore = round(−(1 − u)·100)` (strict → floor rejects net-negative). Does **not** change the unwanted category score (fixed `-10000` hard reject).                                        |
| `resolutionCeiling`  | Resolution Ceiling  | enum `720p\|1080p\|2160p` → `C ∈ {0,1,2}` | Post-policy gate on resolution-category CFs only (see §2.5). Bounded additive demotion, **not** a flat sentinel. Honest UI note: reshapes CF scores only; quality-ladder gating is deferred.          |

### 2.3 Stage 1 — classifier (`classifier.ts`)

An **ordered array of pure rules; first match wins.** Ordering _is_ the transparency contract (documented + first-match). Each rule tests lowercased `tags` first, then `name`, then `description` substrings, and returns `{ category, ruleId }`.

```
 1 unwanted           tags/name ∈ {br-disk, lq, x265 (hd), upscaled, obfuscated, retags, unwanted, sample, extras}
 2 hdr_dv             {dolby vision, dovi, ' dv', dv hdr}
 3 hdr_hdr10plus      {hdr10+, hdr10plus, 'hdr10 plus'}
 4 hdr_baseline       {hdr, hdr10, pq, hlg, colour, 'wcg'}
 5 remux              {remux}
 6 release_group_tier {tier} with {release group|group} → tierRank from digit (1/2/3, else 3)
 7 audio_lossless     {truehd, flac, pcm, dts-hd ma, lossless, 'dts hd ma'}
 8 audio_advanced     {atmos, dts-x, 'dts:x', ddp, eac3, 'e-ac-3', advanced}
 9 streaming_service  {amzn, nf, dsnp, hmax, atvp, ' web '}
10 repack_proper      {repack, proper}
11 movie_version      {imax, hybrid, remaster, 'special edition', uncut, 'director'}
12 resolution         {2160p, 1080p, 720p, 4k}
—  fallback           → uncategorized (category = null, ruleId = 'rule.fallback.no-match')
```

`detectResolutionLevel(facts)` runs **independently** of category: scans `{2160p,4k}→2, 1080p→1, 720p→0, else undefined`. Feeds the ceiling gate for _any_ CF that has a detectable resolution (including resolution-category CFs).

**Per-arr axis filtering (forward seam, graft #6):** for `arrType === 'lidarr'`, video-only categories (`hdr_*`, `remux`, `resolution`) are dropped to uncategorized at classification time. Slice 1 does not ship a lidarr _apply_ path, but the seam is present and tested so the deferred lidarr policy plugs in cleanly.

`GoalCategory` is a **closed, versioned enum**. Adding/renaming a category or reordering rules bumps `GOALS_ENGINE_VERSION`.

### 2.4 Stage 2 — policy (`policy.ts`)

A single `CATEGORY_POLICY` table: `base` + per-axis sensitivities, in **native TRaSH magnitudes**. Score:

```
scoreCategory(cat, w) = clamp( round( base[cat] + Σ_axis sens[cat][axis] · w[axis] ), −10000, +10000 )
```

`CATEGORY_POLICY` (v1 — **tuned so preset defaults reproduce validated maps; must be validated against an imported TRaSH PCD before merge**, see §8):

| category             | base                                                   | ·wQ  | ·wC  | ·wH  |
| -------------------- | ------------------------------------------------------ | ---- | ---- | ---- |
| remux                | 700                                                    | +700 | 0    | 0    |
| audio_lossless       | 400                                                    | +300 | −200 | 0    |
| audio_advanced       | 300                                                    | +150 | −300 | 0    |
| hdr_baseline         | 300                                                    | 0    | −100 | +500 |
| hdr_hdr10plus        | 350                                                    | 0    | −200 | +600 |
| hdr_dv               | 200                                                    | 0    | −500 | +700 |
| release_group_tier_1 | 350                                                    | +150 | 0    | 0    |
| release_group_tier_2 | 150                                                    | +75  | 0    | 0    |
| release_group_tier_3 | 50                                                     | +25  | 0    | 0    |
| streaming_service    | 100                                                    | 0    | +100 | 0    |
| movie_version        | 150                                                    | +100 | 0    | 0    |
| repack_proper        | 5                                                      | 0    | 0    | 0    |
| unwanted             | **fixed −10000 sentinel** (hard reject, not modulated) |      |      |      |
| resolution           | scored by ceiling gate §2.5 (base/sens not used)       |      |      |      |

Every reward score is emitted with a `GoalReason`:

```ts
interface GoalReason {
  code: string; // e.g. 'category.remux'
  category: GoalCategory;
  ruleId: string;
  base: number;
  axisContributions: { axis: GoalAxisKey; delta: number }[]; // additive terms, for '+700 = base +700 · 0' rendering
  ceiling: 'above' | 'match' | 'below' | null;
}
```

### 2.5 Resolution ceiling gate (bounded, not a sentinel)

Applied **after** policy to any CF whose `detectResolutionLevel` is defined, at ceiling `C`:

- `level > C` → score `= CEILING_ABOVE_PENALTY = −500` (`ceiling:'above'`) — demoted below a strict accept gate but **not** a `-10000` sentinel; preserves the honest "slice 1 reshapes CF scores only" contract.
- `level === C` → `+CEILING_MATCH_BONUS = 200` (`ceiling:'match'`).
- `level < C` → `+CEILING_BELOW = 50` (`ceiling:'below'`, acceptable lower-res).

For a _resolution-category_ CF this is the whole score. For a non-resolution CF that also carries a resolution token, the gate **overrides** its policy score only when `above` (demotion wins); otherwise the policy score stands. This is documented and unit-tested. `CEILING_*` are named constants in one place, tunable.

### 2.6 Threshold derivation (`computeThresholds(preset, weights)`)

Anchored to per-preset base thresholds (not summed from emitted scores — the safe approach both winning panels endorsed):

```
minimumScore          = round( −(1 − u) · 100 )                       // u = unwantedStrictness/100
upgradeUntilScore     = max( minimumScore, presetBaseUpgrade + round(wQ · UPGRADE_SPAN) )   // UPGRADE_SPAN = 1000
upgradeScoreIncrement = 1                                             // schema minimum
```

`presetBaseUpgrade`: best-quality 1000, 4k-hdr 1000, balanced 600, smallest-size 300.

### 2.7 Presets (`presets.ts`) — 4 definitions with concrete default weights

| id                | label           | qualityVsSize | compatibility | hdrPreference | unwantedStrictness | resolutionCeiling |
| ----------------- | --------------- | ------------- | ------------- | ------------- | ------------------ | ----------------- |
| `best-quality`    | Best Quality    | 100 (wQ=+1)   | 30 (wC=−0.4)  | 70 (wH=+0.4)  | 85 (u=0.85)        | 2160p (C=2)       |
| `smallest-size`   | Smallest Size   | 0 (wQ=−1)     | 70 (wC=+0.4)  | 40 (wH=−0.2)  | 85                 | 1080p (C=1)       |
| `balanced`        | Balanced        | 50 (wQ=0)     | 55 (wC=+0.1)  | 50 (wH=0)     | 80                 | 1080p (C=1)       |
| `4k-hdr-priority` | 4K HDR Priority | 80 (wQ=+0.6)  | 20 (wC=−0.6)  | 100 (wH=+1)   | 85                 | 2160p (C=2)       |

**Worked golden maps** (illustrative — pin as fixtures, validate vs imported PCD):

_Best Quality:_ remux `1400`, hdr_dv `680`, hdr_hdr10plus `670`, hdr_baseline `540`, audio_lossless `780`, audio_advanced `570`, rg_tier1 `500`, movie_version `250`, streaming `60`, resolution@2160p `+200`, resolution@1080p `+50`, unwanted `−10000`; `minimumScore=−15`, `upgradeUntilScore=2000`, `increment=1`.

_4K HDR Priority:_ remux `1120`, hdr_dv `1200`, hdr_hdr10plus `1070`, hdr_baseline `860`, resolution@2160p `+200`, unwanted `−10000`; `upgradeUntilScore=1600`.

_Smallest Size:_ remux `0`, audio_lossless `20`, audio_advanced `30`, hdr_dv `−140`, resolution@2160p `−500` (above 1080p ceiling), resolution@1080p `+200`, unwanted `−10000`; `upgradeUntilScore` floored to `minimumScore`.

_Balanced:_ remux `700`, audio_lossless `380`, hdr_baseline `290`, rg_tier1/2/3 `350/150/50`, resolution@2160p `−500`, resolution@1080p `+200`, unwanted `−10000`; `upgradeUntilScore=600`.

The same policy table produces all four maps by varying only the weight vector — presets are **points in one continuous space**, which is what makes the slider goal-diff meaningful (a Remux-2160p CF is `+1400` under Best Quality but `−500`-demoted under Balanced's 1080p ceiling).

### 2.8 Output (`GoalPlan`)

```ts
interface GoalPlan {
  engineVersion: '1';
  arrType: 'radarr' | 'sonarr';
  decisions: GoalCfDecision[]; // { customFormatName, arrType, category, ruleId, score, reason }
  uncategorized: {
    name: string;
    suggestedCategory: GoalCategory | null;
    reason: string;
  }[];
  thresholds: { minimumScore; upgradeUntilScore; upgradeScoreIncrement };
  coverage: { total; scored; uncategorized }; // for the coverage % transparency surface
  scoringInput: UpdateScoringInput; // ready for buildScoringOps — customFormatScores use EXPLICIT arrType, never 'all'
}
```

**Uncategorized handling (graceful degradation, never mis-score):** an uncategorized CF is **excluded** from `scoringInput.customFormatScores`, so `buildScoringOps`' value guards leave its existing score untouched (never zeroed, never guessed). It is surfaced in `uncategorized[]` with an **advisory-only** `suggestedCategory` (from the classifier's tag signal, clearly labeled "unvalidated") that the UI can offer as a one-click manual apply. A CF whose tag vocabulary TRaSH later renames simply falls to uncategorized (fails safe).

`diffGoalPlans(a, b): GoalDiff` is a pure helper (per-CF score deltas + threshold deltas) powering the client-side slider diff.

---

## 3. Module layout

Pure engine (`$shared/goals`, no runtime/DB imports — mirrors `$shared/narration`):

| path                                 | purpose                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.../lib/shared/goals/types.ts`      | `GOALS_ENGINE_VERSION='1'`, `GoalPresetId`, `GoalAxisKey`, `GoalAxisWeights`, `GoalCategory` (closed enum), `CfFacts`, `GoalReason`, `GoalCfDecision`, `GoalPlan`, `GoalDiff`, `ComputeGoalPlanInput`, `SLIDER_AXES` metadata. |
| `.../lib/shared/goals/classifier.ts` | Ordered first-match `CATEGORY_RULES`, `classifyCustomFormat(facts)`, `detectResolutionLevel(facts)`, per-arr axis filtering.                                                                                                   |
| `.../lib/shared/goals/policy.ts`     | `CATEGORY_POLICY` table, `scoreCategory`, `applyCeilingGate`, `computeThresholds`, all constants (`UPGRADE_SPAN`, `CEILING_*`).                                                                                                |
| `.../lib/shared/goals/presets.ts`    | The 4 `GOAL_PRESETS` (default weights + `presetBaseUpgrade`) + axis metadata served to the UI.                                                                                                                                 |
| `.../lib/shared/goals/engine.ts`     | `computeGoalPlan(input)` composition + pure `diffGoalPlans(a,b)`.                                                                                                                                                              |
| `.../lib/shared/goals/index.ts`      | Public surface re-export (narration/index.ts pattern).                                                                                                                                                                         |

Server generation layer (only I/O boundary):

| path                                                               | purpose                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.../lib/server/goals/materializeCfFacts.ts`                       | Read `custom_formats` (+ `description`) and `custom_format_tags` from a `PCDCache` into `CfFacts[]`. **Reuse** the existing `scoring()` read (`read.ts` already materializes name+tags+per-arr scores); add only a `description` select. Do not build a wholly new adapter. |
| `.../lib/server/goals/toProfileEdit.ts`                            | Map `GoalPlan.scoringInput` → `ProfileEdit { input, changes }`; synthesize one `ProposedChange` per scored CF for the sandbox `SandboxReport` attribution. Enables `withSandboxCache` + `buildConfigDiff` reuse **verbatim**.                                               |
| `.../lib/server/db/queries/qualityGoalBindings.ts`                 | Typed get/upsert/delete for `quality_goal_bindings` (modeled on `driftStatus.ts`).                                                                                                                                                                                          |
| `.../lib/server/db/migrations/041_create_quality_goal_bindings.ts` | Migration (next number after `040`; `Migration {version,name,up,down}`, `_template.ts`). Plain app table; `seedBuiltInBaseOps` not involved.                                                                                                                                |

API routes (`routes/api/v1/goals/*`, drift/impact validation + typed OpenAPI response style):

| path                 | purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `presets/+server.ts` | GET presets + axis metadata + engineVersion.         |
| `preview/+server.ts` | POST non-persisting preview (impact-route template). |
| `apply/+server.ts`   | POST persist via `updateScoring` + upsert binding.   |
| `binding/+server.ts` | GET persisted binding.                               |

Contract-first + UI + tests:

| path                                                                                           | purpose                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/api/v1/paths/goals.yaml`, `docs/api/v1/schemas/goals.yaml`                               | Spec, tag `Quality Goals`, wired into `openapi.yaml` (tag + path `$ref` + schema `$ref`).                                                                                                            |
| `packages/praxrr-app/src/lib/api/v1.d.ts`                                                      | Regenerate via `deno task generate:api-types` (see §8 risk on regen noise).                                                                                                                          |
| `packages/praxrr-api/openapi.json`                                                             | Regenerate mirror via `scripts/bundle-api.ts`; **prettier-gated**, same change set (see §8).                                                                                                         |
| `routes/goals/+page.svelte` (+ `+page.server.ts`)                                              | Goal editor page. Svelte 5 **no runes** (`export let data; let x; $:; on:click; bind:value; onMount`), `$ui` Card/CardGrid/Badge/EmptyState, `alertStore.add`, 2-space/single-quote (`.prettierrc`). |
| `$ui/goals/{PresetPicker,GoalSliders,GeneratedConfigTable,UncategorizedPanel,GoalDiff}.svelte` | Reusable no-runes components.                                                                                                                                                                        |
| `packages/praxrr-app/src/tests/shared/goals/*.test.ts`                                         | Pure-engine unit + golden fixtures.                                                                                                                                                                  |
| `packages/praxrr-app/src/tests/server/goals/*.test.ts` + route tests                           | Server-layer + route type-check.                                                                                                                                                                     |

**No new writer.** The engine emits only `UpdateScoringInput`; all persistence rides the existing `buildScoringOps`/`updateScoring`/`writeOperation` path. This module boundary makes a parallel scoring system structurally impossible.

---

## 4. API contract

All under tag `Quality Goals`. Handlers consume `components['schemas'][...]`. Validation follows the drift/impact style (`type ErrorResponse = { error: string }`, inline per-handler, `arrType` via `isArrType`).

### GET `/api/v1/goals/presets`

- **Request:** none.
- **Response 200:** `GoalPresetsResponse` — `{ presets: GoalPreset[], axes: GoalAxisMeta[], engineVersion: string }`. Lets the editor render sliders and run the pure engine client-side with zero hardcoding.

### POST `/api/v1/goals/preview` — **non-persisting**

- **Request:** `GoalPreviewRequest` — `{ databaseId, arrType('radarr'|'sonarr'), profileName, preset, weights }`.
- **Flow:** validate → `pcdManager.getCache(databaseId)` → `materializeCfFacts` → `computeGoalPlan` → `toProfileEdit` → `withSandboxCache(databaseId, Map{profileName→ProfileEdit}, …)` → `buildConfigDiff(currentCache, sandboxCache, arrType, [profileName])`. **Mutates nothing** (`buildScoringOps` runs only in the ephemeral sandbox; `pcd_ops` untouched).
- **Response 200:** `GoalPreviewResponse` — `{ plan: GoalPlan (decisions+reasons+thresholds+coverage+uncategorized), configDiff: EntityConfigDiff[], sandboxReport: SandboxReport }`. This is the authoritative "what apply will write" view; preview and apply share the one op builder, so they cannot diverge.
- **Errors:** 400 `ErrorResponse` (bad arrType, unknown preset, out-of-range weights, missing profile).

### POST `/api/v1/goals/apply` — **persists via `updateScoring`**

- **Request:** `GoalApplyRequest` — `{ databaseId, arrType, profileName, preset, weights, expectedEngineVersion }`.
- **Flow:** validate → `computeGoalPlan` → `updateScoring({ input: plan.scoringInput, layer:'user', … })` (writes standard value-guarded PCD **user ops** via `writeOperation`, recompiling the same cache) → upsert `quality_goal_bindings`.
- **Response 200:** `GoalApplyResponse` — `{ appliedOps: OpSummary[], binding: GoalBinding }`.
- **Errors:** 400 `ErrorResponse`; **409** `ErrorResponse` when `expectedEngineVersion !== GOALS_ENGINE_VERSION` (optimistic concurrency — prevents a stale-engine client clobbering scores).

### GET `/api/v1/goals/binding` — **binding read**

- **Request:** query `?databaseId=&profileName=&arrType=`.
- **Response 200:** `GoalBindingResponse` — persisted `{ presetId, weights, engineVersion, appliedAt }` **or `null`**. `engineVersion !== GOALS_ENGINE_VERSION` drives a staleness/re-apply banner. The editor may recompute the plan and diff it against current resolved config (`computeUserOverrides`) to surface manual overrides ("N scores diverge from this goal" — the "not a cage" signal).

**OpenAPI schemas to define in `schemas/goals.yaml`:** `GoalPreset`, `GoalAxisMeta`, `GoalWeights`, `GoalReason`, `GoalCfDecision`, `GoalPlan`, `GoalCoverage`, `GoalBinding`, `GoalPresetsResponse`, `GoalPreviewRequest`, `GoalPreviewResponse`, `GoalApplyRequest`, `GoalApplyResponse`, `GoalBindingResponse`. Reuse existing `EntityConfigDiff`, `ProposedChange`, `SkippedChange`, `ErrorResponse` from the current spec.

---

## 5. Persistence — goal-binding table

Persist a **binding (intent metadata only)** in the app DB. The actual scores + thresholds persist as standard PCD user ops (single source of truth, same cache as manual config). The binding never participates in cache materialization or sync — it cannot fork the scoring system.

**Migration `041_create_quality_goal_bindings.ts`:**

```sql
CREATE TABLE quality_goal_bindings (
  database_id     INTEGER  NOT NULL REFERENCES database_instances(id) ON DELETE CASCADE,
  profile_name    TEXT     NOT NULL,
  arr_type        TEXT     NOT NULL CHECK (arr_type IN ('radarr','sonarr')),   -- tightened to slice scope
  preset_id       TEXT     NOT NULL,
  weights_json    TEXT     NOT NULL,        -- serialized GoalAxisWeights (5 keys, 0..100)
  engine_version  TEXT     NOT NULL,
  applied_at      TEXT     NOT NULL,        -- ISO-8601 UTC
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (database_id, profile_name, arr_type)
);
```

`down` drops the table. Per-arr PK because per-arr semantics differ and a profile is shaped per arr. `CHECK` is scoped to `('radarr','sonarr')` (matching the slice's apply scope — an over-permissive `lidarr` constraint would let a binding persist the engine cannot produce; both winning panels flagged the looser check as a hygiene miss).

**Powers:** reopen-editor-at-last-position, slider-diff-vs-last-applied, engine-version staleness detection, and override-drift (binding intent vs live `pcd_ops`). Deleting a binding never touches scores; hand-editing scores never touches the binding. Goals are a starting point, not a cage.

---

## 6. Transparency & override

Transparency is enforced structurally, not cosmetically:

1. **Preview always returns the complete generated config** before any write: every scored CF with its `GoalReason { ruleId, category, base, axisContributions[], ceiling }`, all three thresholds, and the coverage split (`scored / total`, e.g. "goals scored 28 of 41 CFs; 13 are outside the classifier and were left untouched").
2. **Additive per-score rationale** (grafted rendering style): the UI renders `axisContributions` additively — `remux +1400 = base +700, quality-favored +700` — the clearest "why exactly this number." Reason objects are **narration-ready** (structured headline/detail/tone-mappable) so #21's `NarrationBlock` can render them in a follow-up without engine changes.
3. **Authoritative sandbox `configDiff`** (`buildScoringOps` + `buildConfigDiff`, the exact impact-simulator path) proves what apply will actually write; preview and apply share one op builder.
4. **Client-side pure engine** (`engine.ts` + `diffGoalPlans` imported into the browser, narration precedent) gives **instant, zero-round-trip** slider feedback and the goal-diff — essential for a drag-driven editor (the product panel's key differentiator).
5. **Uncategorized panel:** flagged CFs shown in a dedicated surface with the advisory (clearly "unvalidated") suggested category and a one-click "apply suggested score" action — never hidden, never silently auto-scored.
6. **Override is first-class:** apply is explicit and diffed; the generated table is fully editable before apply; applied scores are standard user ops editable in the normal scoring editor; the binding view flags manual divergence rather than reverting it.

---

## 7. Test strategy

**Pure-engine unit tests** (`deno task test`, `$shared`, no cache):

- **Classifier:** each rule fires on representative TRaSH tag/name fixtures; first-match ordering (unwanted before resolution; hdr_dv before hdr_baseline); case-insensitivity; uncategorized fallback; `detectResolutionLevel` across 720/1080/2160/4k/none; per-arr filtering (lidarr drops video categories).
- **Policy:** monotonicity — raising `qualityVsSize` never lowers remux; raising `hdrPreference` never lowers any HDR CF; ceiling gate (`above → −500`, `match → +200`, `below → +50`); threshold formula boundaries + `upgradeUntil` floor at `minimumScore`.
- **Determinism:** identical input ⇒ deep-equal output; output invariant under input CF-list reordering; no `Date`/`random`.
- **Golden preset fixtures (bedrock):** each of the 4 presets at default weights against a fixed `CfFacts` fixture ⇒ frozen expected `UpdateScoringInput` + thresholds. Any engine/policy change diffs the golden — converts "locks intent" into "locks correctness."
- **Uncategorized/degradation:** a no-match CF is excluded from `scoringInput`, appears in `uncategorized`, and never mutates an existing manual score.
- **`diffGoalPlans`:** known-delta, zero-diff on equal inputs, symmetry.

**Server-layer tests** (`deno test`):

- `materializeCfFacts` builds `CfFacts[]` from a cache incl. description + tags.
- `toProfileEdit` → `buildScoringOps` produces value-guarded ops; **idempotent apply** (no ops when weights match current scores).
- Migration `up`/`down` + `ON DELETE CASCADE` on database-instance removal.
- Binding queries round-trip; upsert overwrites; delete leaves scores intact.

**Route tests** (type-checked via `deno test` on the routes dir — routes are excluded from `deno check` but `deno test <dir>` type-checks them):

- `preview` returns `plan` + `configDiff` and does **not** mutate `pcd_ops` (assert op-row count unchanged — the non-persistence guarantee).
- `apply` persists user ops **and** upserts the binding; `binding` GET reflects it.
- **Sandbox parity:** preview `configDiff` equals what apply writes (same `buildScoringOps` path).
- **Per-arr correctness:** radarr vs sonarr produce independent scores; scores always carry explicit `arrType`, never `'all'`.
- Validation 400 matrix (bad arrType, unknown preset, out-of-range weights, missing profile); `expectedEngineVersion` mismatch → 409.

**Contract fidelity:** run `deno task check` + prettier on `goals.yaml`/`openapi.json` before merge (mirror is prettier-gated); assert handlers consume `components['schemas'][...]` and documented fields match runtime validators.

**Optional e2e smoke** (Playwright, follow-up-friendly): open editor, pick preset, move a slider, see live diff + flagged uncategorized, apply, reload shows binding restored.

---

## 8. Risks & mitigations

- **Policy constants / classifier vocabulary are guessed** (no TRaSH tag strings in the checkout). _Mitigation — non-negotiable gate:_ before merge, validate `CATEGORY_RULES` + the four golden preset maps against an **imported real TRaSH PCD** fixture; tune `CATEGORY_POLICY` so preset defaults reproduce community-known-good maps; pin as golden fixtures. Fail-safe design (uncategorized flagged, never mis-scored) bounds the blast radius.
- **`v1.d.ts` regen noise (not CI-gated).** Regenerating `generate:api-types` emits ~3300 lines of tool-version churn; CI does not gate it. _Mitigation:_ commit only the goals-relevant additions; do not commit a wholesale local regen. Cross-check the handful of new `components['schemas']` entries by hand.
- **`openapi.json` mirror is prettier-gated.** The generated bundle _is_ prettier-checked in CI. _Mitigation:_ regenerate via `scripts/bundle-api.ts` and `prettier --write packages/praxrr-api/openapi.json` in the **same change set**; never hand-graft without formatting.
- **Per-arr semantics.** Reusing radarr rules for sonarr/lidarr risks cross-arr mis-scoring. _Mitigation:_ `arrType` required; concrete-arr scores only (never `'all'`, so `buildScoringOps` `'all'`-expansion + value guards stay correct); lidarr axis-filtered at classification and out of scope for apply; binding `CHECK` scoped to radarr/sonarr.
- **Resolution-ceiling illusion.** Users may expect it to disable 4K qualities; slice 1 only reshapes CF scores. _Mitigation:_ bounded additive demotion (not the rejected `−1000` sentinel), explicit UI note, and an out-of-scope flag until the `buildQualityOps` (`quality_profile_qualities`) follow-up lands.
- **Engine-version drift.** Bumping `GOALS_ENGINE_VERSION` silently changes bound-profile scores. _Mitigation:_ version stamped on plan + binding; UI staleness banner; `expectedEngineVersion → 409` on apply; re-apply is user-initiated.
- **Override staleness.** Hand-edits after apply make the binding misrepresent live config. _Mitigation:_ binding is advisory metadata; binding view diffs recomputed plan vs current resolved config; apply never reverts manual edits.
- **Scope creep.** Ceiling "feels like" it should reorder the quality ladder; NL input and lidarr tempt inclusion. _Mitigation:_ the §9 boundary is a hard gate; honest UI copy; a single `CATEGORY_POLICY` table keeps tuning to one file.

---

## 9. Scope boundary

**IN (this PR)**

- Pure versioned `$shared/goals` engine: `types`, `classifier` (ordered first-match, ~13 categories + uncategorized fallback, `detectResolutionLevel`, lidarr axis-filter seam), `policy` (single `CATEGORY_POLICY` table + ceiling gate + threshold formulas), 4 `presets`, `computeGoalPlan`, `diffGoalPlans`, `GOALS_ENGINE_VERSION='1'`.
- Native TRaSH-scale magnitudes; unwanted `-10000` hard reject; golden preset fixtures validated against an imported PCD.
- 5 sliders incl. `unwantedStrictness`.
- Server layer: `materializeCfFacts` (reusing `scoring()` read + `description`), `toProfileEdit`, binding queries — reusing `buildScoringOps`/`updateScoring`/`withSandboxCache`/`buildConfigDiff`, **no new writer**.
- Contract-first `goals.yaml` (paths + schemas) wired into `openapi.yaml`; `v1.d.ts` regen (goals-only diff); prettier-gated `openapi.json` mirror in the same change set.
- 4 endpoints: `presets` (GET), `preview` (POST, non-persisting), `apply` (POST, persist + binding + 409 on version mismatch), `binding` (GET).
- `quality_goal_bindings` migration + typed queries (metadata only, `CHECK` radarr/sonarr).
- `/goals` editor page + `$ui/goals` components: preset picker, 5 sliders, always-shown generated-config table with additive reason chips, coverage %, uncategorized panel with advisory one-click, live goal-diff + diff-vs-current, apply, override-drift indicator. Svelte 5 no-runes.
- `radarr` + `sonarr` apply targets (matching the impact simulator).
- Full test matrix per §7.

**OUT (follow-ups)**

- Quality-ladder gating (`quality_profile_qualities` enabled/cutoff) — needs a `buildQualityOps` writer; ceiling is CF-score-only this slice.
- Lidarr apply path end-to-end (axis-filter seam exists; audio-domain policy + parity proof deferred).
- Dedicated `narrate.ts` / full `NarrationBlock` (#21) wiring — reason objects are narration-ready; render later.
- Natural-language goal input ("high-quality Blu-ray" via LLM) — sliders only.
- Condition-based classification (parsing `custom_format_conditions`) — `CfFacts` leaves the seam open.
- Multi-profile / bulk apply, goal export/sharing, scheduled auto-reapply on engine-version bump (staleness is detected + surfaced; re-apply is user-initiated).
- User-authored custom rules/policies; ML/heuristic auto-categorization of uncategorized CFs (flagged for manual action only).
- Score Simulator (#13/#30) integration beyond reusing the `UpdateScoringInput` shape.

---

## 10. Implementation corrections (post-design red-team)

Verified against the current `origin/main` before building. These override the design body where they conflict:

- **Migration** is `20260711_create_quality_goal_bindings.ts` with `version: 20260711` (not `041` — taken by `041_create_pcd_ops.ts`; not `20260710` — taken by `20260710_create_sync_history_tables.ts` on the advanced main). Register via static import + an ordered entry in `loadMigrations()` in `db/migrations.ts`. FK target `database_instances(id)` (correct).
- **`GoalPreviewResponse` inlines** `appliedChanges: ProposedChange[]` + `skippedChanges: SkippedChange[]` as top-level fields — `SandboxReport` is a TS-only interface, not an OpenAPI schema. Reuse `EntityConfigDiff`/`ProposedChange`/`SkippedChange` (`$ref` into `impact-simulator.yaml`) and `ErrorResponse` (`$ref` into `arr.yaml`).
- **Extract `buildConfigDiff`** (currently private in `routes/api/v1/simulate/impact/+server.ts`) into a shared module and import it from both impact and goals preview (DRY).
- **`materializeCfFacts`** is a direct cache query (`custom_formats.name`, `custom_formats.description`, `custom_format_tags`→`tags`), profile-independent — not bolted onto `scoring()`.
- **Classifier vocabulary** matches the REAL Title-Case praxrr-db tags (`Banned`, `Remux`, `Release Group Tier`, `Streaming Service`, `Source`, `Audio`, `Codec`, `Enhancement`, `Colour Grade`, `HDR`, `Edition`, `Efficient`, `Compact`, `Quality`), lowercased before matching. `Banned` is THE unwanted signal.
- **Dual-tag ordering:** `Remux Tier N` carries both `Release Group Tier` and `Remux`; classify as `release_group_tier` (its scoring role) — release-group-tier rule precedes the bare remux rule. Pinned by golden fixtures.
- **Threshold mapping:** map `scoring()`'s snake_case (`minimum_custom_format_score`…) to engine camelCase at the route boundary (per `impact/+server.ts`).
- **`OperationLayer` = `'base' | 'user'`** string union; apply uses `layer: 'user'`. Null-check `getCache(databaseId)` → 404. All emitted scores are integers (`Math.round`); `customFormatScores` carry concrete `arrType`, never `'all'`.
