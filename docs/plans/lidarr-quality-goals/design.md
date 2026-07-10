# Design — Quality Goals: Lidarr Native Apply Path (Issue #222)

> Status: authoritative design (supersedes the raw synthesis). Grounded in a direct
> read of `$shared/goals/{types,classifier,policy,engine,presets}.ts`, the 3 real
> Lidarr custom formats in `packages/praxrr-db`, and the cross-Arr guardrails in
> `CLAUDE.md`.

## 1. Problem & Goal

Quality Goals (#20, shipped in #215) translate a preset + slider intent into concrete
custom-format scores and quality-profile thresholds, persisted through the standard PCD
user-op path (`updateScoring`). Apply is currently gated to `radarr | sonarr` at every
layer; the only Lidarr wiring is a **dead forward seam** in the classifier
(`LIDARR_EXCLUDED_CATEGORIES`), unreachable because `GoalArrType = 'radarr' | 'sonarr'`.

Lidarr's quality domain is **audio** (codecs, not video resolution/HDR/remux). The goal is
an **end-to-end Lidarr apply path** (preview → apply → binding → scores in `pcd_ops`)
backed by an **explicitly-validated audio-domain policy**, with strict `arr_type='lidarr'`
dispatch, **no sibling fallback**, portable-contract / runtime-validator lockstep, and
transparent per-score / per-skip reasons — while leaving Radarr/Sonarr behavior
byte-identical.

## 2. Current State (verified)

- **Engine** `engine.ts` `computeGoalPlan(input): GoalPlan` classifies each `CfFacts`,
  scores via `decide()`, emits `scoringInput: UpdateScoringInput` stamped with an explicit
  per-CF `arrType` (never `'all'`). Uncategorized CFs are excluded from `scoringInput`
  (value guards leave existing scores untouched) with `reason: 'no-matching-rule'`.
- **Classifier** `classifier.ts` ordered first-match `CATEGORY_RULES`;
  `classifyCustomFormat(facts, arrType: GoalArrType | 'lidarr')` already drops
  `LIDARR_EXCLUDED_CATEGORIES = {hdr_dv, hdr_hdr10plus, hdr_baseline, remux, resolution}`
  to `{category:null, ruleId: FALLBACK_RULE_ID}` when `arrType==='lidarr'` — but the seam
  is never reached because the engine passes `input.arrType: GoalArrType`.
- **Policy** `policy.ts` `CATEGORY_POLICY` **already contains audio-tuned rows** with
  `hdrPreference:0`:
  `audio_lossless {base 400, qVsS 300, compat -200}`, `audio_advanced {300, 150, -300}`,
  `audio_baseline {150, 50, -50}`, `repack_proper {5,0,0}`. `computeThresholds` is
  arr-neutral (driven by `unwantedStrictness` + `qualityVsSize`). `ceilingGate` is
  resolution-only.
- **Types** `GoalArrType = 'radarr' | 'sonarr'` (`types.ts:25`);
  `GoalPresetId = 'best-quality' | 'smallest-size' | 'balanced' | '4k-hdr-priority'`
  (closed enum, `:28`); `GoalCfDecision.arrType` / `GoalPlan.arrType` /
  `ComputeGoalPlanInput.arrType` are `GoalArrType`. `GOALS_ENGINE_VERSION = '1'`.
- **Grounding**: the ONLY 3 Lidarr CFs in praxrr-db are
  `Lidarr - FLAC (Praxrr)` (tag `Audio`, name `FLAC`),
  `Lidarr - AAC (Praxrr)` (tag `Audio`, name `AAC`),
  `Lidarr - Opus (Praxrr)` (tag `Audio`, name `Opus`). `QUALITIES.lidarr`
  (`sync/mappings.ts`) lists native audio quality names (all `source='audio'`,
  `resolution=0`); `semanticDifferences.ts` documents "Lidarr quality definitions are
  audio formats, not video resolutions" and that REMUX/HYBRID is Radarr-only.

## 3. Lidarr Audio-Domain Policy (locked)

### 3a. Surviving categories for `arr_type='lidarr'`

`audio_lossless`, `audio_advanced`, `audio_baseline`, `repack_proper`, `unwanted`.

### 3b. Excluded (dropped to uncategorized with a distinct reason)

Extend `LIDARR_EXCLUDED_CATEGORIES` to:
`{hdr_dv, hdr_hdr10plus, hdr_baseline, remux, resolution, movie_version,
streaming_service, release_group_tier_1, release_group_tier_2, release_group_tier_3}`.

- `movie_version` (editions) and `streaming_service` (video-tuned `+100` compatibility)
  are video concepts; excluded.
- `release_group_tier_*` uses **video-derived** group lists (`resolveReleaseGroupTier`);
  no music-group parity proof exists → **excluded for v1** (fail-safe). Re-admit only with
  proven music groups (follow-up).

### 3c. Classification (arrType-scoped, AC5-safe)

The existing audio rules are gated on the `audio` tag and **shared** with radarr/sonarr;
editing their tokens would change radarr/sonarr output. Instead add **lidarr-scoped**
rules via a new optional `arrScope?: 'lidarr'` on `ClassifierRule`; the rule loop skips
rules whose `arrScope` ≠ the current `arrType`. Radarr/sonarr rule evaluation is therefore
**byte-identical** (their rule set is unchanged).

Lidarr audio rules (inserted after the shared audio rules, before the gate-only
`rule.audio.baseline`):

| Rule                         | category         | tokens (name, gated on `audio` tag)                | Grounded in                                |
| ---------------------------- | ---------------- | -------------------------------------------------- | ------------------------------------------ |
| `rule.audio.lidarr.lossless` | `audio_lossless` | `flac, alac, wav, ape, wavpack, wv`                | FLAC CF; `QUALITIES.lidarr` lossless names |
| `rule.audio.lidarr.advanced` | `audio_advanced` | `aac, opus, ogg, vorbis, mp3-320, mp3 320, vbr v0` | AAC + Opus CFs; `QUALITIES.lidarr`         |

`audio_baseline` remains the gate-only fallback (any other `audio`-tagged Lidarr CF, e.g.
low-bitrate MP3/WMA). Result for the 3 real CFs: **FLAC→lossless, AAC→advanced,
Opus→advanced** (deterministic, uses lossless + advanced tiers; baseline reserved for
legacy). No AAC-vs-Opus ranking is invented (both = advanced modern lossy).

### 3d. Scoring — dedicated `LIDARR_AUDIO_POLICY`

Rather than let Lidarr fall through the shared `CATEGORY_POLICY`, introduce an **explicit
audio policy table** (satisfies AC1 "explicitly validated" + fail-fast guardrail). Only the
surviving categories get rows; `scoreCategory` resolves the table by `arrType` and
**throws** if `arrType==='lidarr'` and the category is absent (never a video fallback).

| Category         | base | qualityVsSize | compatibility | hdrPreference |
| ---------------- | ---- | ------------- | ------------- | ------------- |
| `audio_lossless` | 500  | +300          | −150          | 0             |
| `audio_advanced` | 250  | +100          | +50           | 0             |
| `audio_baseline` | 100  | −50           | +150          | 0             |
| `repack_proper`  | 50   | 0             | 0             | 0             |

Audio-as-primary rationale: lossless rewarded most, penalized on compatibility (larger,
less universal); baseline rewarded on compatibility (universally playable) but penalized on
quality-vs-size; repack a small neutral bonus. `hdrPreference` sensitivity is `0`
everywhere → contributes exactly 0. **Golden fixtures pin the exact emitted scores.**

### 3e. Audio presets

Add `GoalPresetId` members `audio-lossless-priority | audio-balanced | audio-space-saver`
whose weight vectors set only `qualityVsSize` / `compatibility` / `unwantedStrictness` and
leave `hdrPreference`/`resolutionCeiling` at neutral/inert defaults. The presets endpoint
returns **arr-scoped** presets + axes (video presets for radarr/sonarr; audio presets for
lidarr with `hdrPreference`/`resolutionCeiling` axes hidden). `4k-hdr-priority` is never
offered for Lidarr.

### 3f. Inert video axes on the wire

`GoalWeights` stays shared. `hdrPreference` and `resolutionCeiling` are **accepted-but-inert**
for `lidarr` (documented): `resolutionCeiling` never gates (resolution excluded);
`hdrPreference` contributes 0 (sensitivity 0). This avoids a breaking `GoalWeights` split
for existing radarr/sonarr consumers (AC5).

## 4. Dispatch (`arr_type='lidarr'`, no sibling fallback)

1. `types.ts:25` widen `GoalArrType` → `'radarr' | 'sonarr' | 'lidarr'` (propagates to
   `ComputeGoalPlanInput`/`GoalCfDecision`/`GoalPlan`). Simplify
   `classifyCustomFormat(..., arrType: GoalArrType)`.
2. `classifier.ts` extend `LIDARR_EXCLUDED_CATEGORIES` (§3b); add `arrScope` + lidarr audio
   rules (§3c); return a distinct `EXCLUDED_RULE_ID` for excluded CFs (not `FALLBACK_RULE_ID`).
3. `policy.ts` add `LIDARR_AUDIO_POLICY` + resolve-by-arrType in `scoreCategory` with
   fail-fast throw (§3d).
4. `engine.ts:76-79` map the excluded reason: `ruleId===EXCLUDED_RULE_ID` →
   `'excluded.video-only-on-lidarr'`, else `'no-matching-rule'`.
5. `server/goals/planRequest.ts` widen `isGoalArrType` + 400 message to admit `lidarr`.
6. `routes/api/v1/goals/binding/+server.ts` widen the guard + message.
7. `routes/api/v1/goals/preview/+server.ts` widen `buildQualityProfileConfigDiff` arrType;
   verify it renders for a Lidarr profile.
8. `routes/api/v1/goals/apply/+server.ts` — no structural change once types+binding accept
   `lidarr`; `updateScoring(layer:'user')` already writes `arr_type='lidarr'` rows.
9. `routes/api/v1/goals/presets/+server.ts` — arr-scoped presets/axes (§3e).
10. Fail-fast: unknown arrType → 400; lidarr category without audio row → engine throw; DB
    `CHECK` rejects non-widened `arr_type` until the migration lands (ship together).

## 5. Contract lockstep

- OpenAPI source (multi-file spec under `docs/api/v1/`): add `lidarr` to the goals
  `arrType` enums (or `$ref` the shared `ArrType` that already includes lidarr); add
  `arrType` query param to the presets path; add `lidarr` to the impact-simulator
  `EntityConfigDiff.arrType` / `ProposedChange.arrType` (referenced by the goals preview
  response — otherwise the Lidarr preview response is type-invalid).
- Regenerate in the **same change**: `deno task` for api types → `src/lib/api/v1.d.ts`;
  bundle → `packages/praxrr-api/openapi.json` (+`prettier --write`, CI-gated).
- Runtime twins move together: `types.ts`, `planRequest.ts`, `binding/+server.ts`,
  `db/queries/qualityGoalBindings.ts` (`UpsertQualityGoalBindingInput.arrType` union +lidarr).

### Binding persistence

New app-DB migration (version later than the latest; watch date-collision) rebuilds
`quality_goal_bindings` widening `CHECK (arr_type IN ('radarr','sonarr','lidarr'))` — SQLite
CHECK is immutable so full table rebuild preserving the `ON DELETE CASCADE` FK and the
composite `PRIMARY KEY (database_id, profile_name, arr_type)`. Register in `migrations.ts`
(import + ordered array) and, per the Arr Cutover Guardrail, mirror in
`seedBuiltInBaseOps.ts` only if seeded base ops are added (not required by the table alone).

Engine version stays `'1'`: Lidarr paths are additive and radarr/sonarr output is provably
unchanged (golden diff), so no existing binding is invalidated and the 409 staleness guard
is undisturbed.

## 6. UI

- `routes/goals/[databaseId]/+page.svelte`: add `<option value="lidarr">Lidarr</option>`;
  widen the local `ArrType`; seed **audio-safe default weights** so a Lidarr request never
  carries video weights; for Lidarr hide the `hdrPreference` + `resolutionCeiling` sliders
  (arr-scoped axes from the presets endpoint). Svelte 5, no runes — `on:*` handlers.
- `GeneratedConfig.svelte`: reuse existing `audio_*` `CATEGORY_LABELS`; add a Lidarr branch
  to the "Not scored by this goal" copy keyed on the `excluded.video-only-on-lidarr` reason:
  "Video-only formats (HDR, Remux, resolution, editions) are intentionally excluded from
  audio goals." — so excluded video CFs don't misread as a coverage gap.
- `+page.server.ts`: scope the profile list to Lidarr-compatible profiles (Arr Cutover
  Guardrail) so a Lidarr goal cannot target a video-only profile.

## 7. Transparency

- Scored CFs: `axisContributions` sum exactly to `score` (per-axis rounding). For audio,
  `hdrPreference` contributes 0, `ceiling` is null.
- Skipped video-only CFs carry the distinct `excluded.video-only-on-lidarr` reason (vs
  `no-matching-rule`), rendered with distinct UI copy (AC4).
- Preview never writes (`withSandboxCache`); apply re-derives the identical plan from
  `preset + weights + engineVersion` via the pure `computeGoalPlan`, so persisted scoring
  exactly matches the preview (AC2/AC3).

## 8. Acceptance-criteria traceability

| #   | Criterion                                    | Design elements                                                                                                                                                                         |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lidarr policy documented & grounded          | §3; this doc + `LIDARR_AUDIO_POLICY` doc comment; grounded in `QUALITIES.lidarr` + the 3 real CFs; golden fixtures pin magnitudes.                                                      |
| 2   | Deterministic preview, no writes             | pure `computeGoalPlan` reached via widened `GoalArrType`; non-persisting preview; arr-neutral `computeThresholds`; §7 reasons.                                                          |
| 3   | Apply persists exactly the preview + binding | value-guarded `updateScoring` `arr_type='lidarr'`; `upsertBinding` + widened CHECK migration; deterministic re-derivation; 409 guard.                                                   |
| 4   | Video-only excluded with explicit reasons    | extended `LIDARR_EXCLUDED_CATEGORIES`; distinct `excluded.video-only-on-lidarr`; branched `GeneratedConfig` copy.                                                                       |
| 5   | Radarr/Sonarr unchanged                      | policy/classifier dispatch reached only for lidarr; arrScope-gated rules; engine version `'1'`; shared `GoalWeights` unbroken; golden-diff test proving identical radarr/sonarr output. |

## 9. Risks / open items

- Audio magnitudes (§3d) are validated by golden fixtures, not external parity — documented
  as engine-internal scale (consistent with the module doc: "engine uses its own coherent
  internal scale").
- `buildQualityProfileConfigDiff` for Lidarr must be verified to render (preview) before
  ship.
- Lockstep hazard: OpenAPI enum sites + impact-simulator schemas + `v1.d.ts` + `openapi.json`
  - runtime validators + binding type + DB CHECK must all move in one change.
- Migration date-collision: pick a version later than the latest and rebump after syncing
  `main`.
- `release_group_tier_*` / `streaming_service` for music are deferred (excluded v1) pending
  proven music vocabulary — candidate follow-up.
