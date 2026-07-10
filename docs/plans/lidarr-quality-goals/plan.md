# Implementation Plan — Lidarr Quality Goals Apply Path (Issue #222)

Ordered, dependency-batched plan. Every anchor was verified against the real files.
See `design.md` for the grounded audio-domain policy and rationale.

## Batch 1 — Engine core (`$shared/goals`)

- **T1 `types.ts`**: `GoalArrType` (line 25) → add `| 'lidarr'`; `GoalPresetId` (line 28) → append
  `'audio-lossless-priority' | 'audio-balanced' | 'audio-space-saver'`. `GOALS_ENGINE_VERSION` stays
  `'1'`; `GoalWeights` unchanged (inert video axes per design §3f).
- **T2 `classifier.ts`**: extend `LIDARR_EXCLUDED_CATEGORIES` (+`movie_version`, `streaming_service`,
  `release_group_tier_1/2/3`); add `arrScope?: GoalArrType` to `ClassifierRule` + skip in the loop when
  `rule.arrScope && rule.arrScope !== arrType`; insert two `arrScope:'lidarr'` audio rules before the
  gate-only baseline (`rule.audio.lidarr.lossless`: flac/alac/wav/ape/wavpack/wv;
  `rule.audio.lidarr.advanced`: aac/opus/ogg/vorbis/mp3-320/mp3 320/vbr v0); add
  `EXCLUDED_RULE_ID = 'rule.excluded.video-only'`; excluded early-return uses it; narrow signature to
  `arrType: GoalArrType`.
- **T3 `policy.ts`**: add `LIDARR_AUDIO_POLICY` (audio_lossless {500,+300,−150,0}, audio_advanced
  {250,+100,+50,0}, audio_baseline {100,−50,+150,0}, repack_proper {50,0,0,0}); `scoreCategory`
  gains `arrType` and resolves the table, throwing when a lidarr category has no audio row (fail-fast).
- **T4 `engine.ts`**: import `EXCLUDED_RULE_ID`; map uncategorized reason
  (`EXCLUDED_RULE_ID` → `'excluded.video-only-on-lidarr'`, else `'no-matching-rule'`); pass `arrType`
  to `scoreCategory`.
- **T5 `presets.ts`**: append 3 audio presets (inert `hdrPreference`/`resolutionCeiling` present so
  `parseWeights` passes); add `presetsForArrType(arrType)` + `axesForArrType(arrType)` (lidarr → audio
  presets / hide hdr+resolution axes).
- **T6 `index.ts`**: re-export `EXCLUDED_RULE_ID`, `LIDARR_AUDIO_POLICY`, `presetsForArrType`,
  `axesForArrType`.

## Batch 2 — Runtime validators / routes / binding / migration (lockstep twins of Batch 3)

- **T7 `server/goals/planRequest.ts`**: `isGoalArrType` accepts `lidarr`; 400 message widened.
- **T8 `routes/api/v1/goals/binding/+server.ts`**: guard + 400 message admit `lidarr`.
- **T9 `db/queries/qualityGoalBindings.ts`**: `UpsertQualityGoalBindingInput.arrType` union +lidarr.
- **T10 `pcd/sandbox/configDiff.ts`**: widen `buildQualityProfileConfigDiff` `arrType` param (reads are
  arr-agnostic — only stamps the output label; preview needs no other change).
- **T12 `routes/api/v1/goals/presets/+server.ts`**: `({ url }) =>` guarded (`url?.searchParams`);
  default radarr; use `presetsForArrType`/`axesForArrType`.
- **T13 migration `20260718_widen_quality_goal_bindings_arr_type.ts`** + `migrations.ts` registration:
  SQLite table rebuild widening `CHECK (arr_type IN ('radarr','sonarr','lidarr'))`, mirroring the 048
  FK-rebuild idiom (inside the runner transaction, no pragma toggle — nothing references the table).

## Batch 3 — OpenAPI + codegen (same change as Batch 2)

- **T14 `docs/api/v1/schemas/goals.yaml`**: `+lidarr` to the 4 goals arrType enums; +3 audio preset ids.
- **T15 `docs/api/v1/schemas/impact-simulator.yaml`**: `+lidarr` to `EntityConfigDiff.arrType` ONLY
  (NOT `SimulateImpactRequest.arrType`).
- **T16 `docs/api/v1/paths/goals.yaml`**: `+lidarr` to binding param; optional `arrType` presets param.
- **T17 `lib/api/v1.d.ts`**: hand-graft the ~7 semantic lines + presets query param (avoid the ~3300-line
  generator drift).
- **T18**: `deno task bundle:api` → `praxrr-api/openapi.json` + `types.ts`; `prettier --write` (gated).

## Batch 4 — UI

- **T19 `routes/goals/[databaseId]/+page.server.ts`**: attach `compatibleArrTypes` per profile via
  `computeProfileCompatibility`.
- **T20 `routes/goals/[databaseId]/+page.svelte`**: Lidarr option; arr-scoped presets fetch
  (`?arrType=`); filter profiles by `compatibleArrTypes`; audio-safe default weights; Svelte-5 `on:*`.
- **T21 `lib/client/ui/goals/GeneratedConfig.svelte`**: branch the "Not scored" copy on
  `excluded.video-only-on-lidarr` vs `no-matching-rule`.

## Batch 5 — Tests

- **T22 classifier.test.ts**: lidarr FLAC→lossless, AAC/Opus→advanced, video/streaming/tier CFs →
  excluded (`EXCLUDED_RULE_ID`); same video CFs under radarr still classify (arrScope proof).
- **T23 engine.test.ts**: golden exact audio scores; excluded reason string; radarr/sonarr no-change
  golden; `scoreCategory` fail-fast throw.
- **T25 goalsRoutes.test.ts**: flip lidarr preview/apply/binding to accepted; `presets` default (5 axes,
  4 ids) + `?arrType=lidarr` (3 axes, 3 audio ids); lidarr apply persists + binding round-trip.

## Regen + verify sequence

```
deno task generate:api-types   # then hand-stage only semantic hunks in v1.d.ts
deno task bundle:api
npx prettier --write packages/praxrr-api/openapi.json packages/praxrr-api/types.ts
deno task check
deno task test goals            # + goalsRoutes.test.ts
```

## Key risks (carried from planning)

- Lockstep: every arrType site (yaml ×6 + v1.d.ts + openapi.json + validators + binding type + DB CHECK)
  lands together.
- Migration date-collision after syncing `main` → rebump `20260718`.
- `SimulateImpactRequest.arrType` stays `[radarr,sonarr]` (impact sim has no lidarr support).
- presets endpoint must guard `url` undefined and default to radarr (existing `GET({})` test).
- Profile dropdown now scoped by `compatibleArrTypes` for all arr types — flag in PR body.
