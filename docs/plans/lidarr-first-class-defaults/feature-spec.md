# Feature Spec: Lidarr First-Class Defaults

## Executive Summary

This feature introduces dedicated Lidarr-only defaults so music configuration no longer reuses
shared records originally designed for cross-arr compatibility. The implementation remains SQL-first
and additive: create new Lidarr names, map them to Lidarr quality data, and preserve idempotent
operation behavior. The naming convention for custom formats and quality profiles is
`Lidarr - ... (Praxrr)` so records are both Lidarr-identifiable and explicitly owned by Praxrr. The
feature must ship three explicit defaults: `Lossless`, `High Quality Lossy`, and `Lossy`, each with
clear quality/format intent and no row reuse from existing generic defaults.

## Current vs Target State (2026-02-16)

- Current seed state in this repository still includes legacy rows in
  `ops/50.seed-lidarr-custom-formats.sql`, `ops/51.seed-lidarr-quality-profiles.sql`,
  `ops/53.seed-lidarr-profile-format-scores.sql`, and
  `ops/54.seed-lidarr-custom-format-conditions.sql` (generic `AAC`/`FLAC`/`Opus` and
  `Lidarr Default` naming).
- This spec defines the target state for first-class Lidarr defaults (`Lidarr - ... (Praxrr)`), not
  a claim that migration has already landed.
- Verification rule for completion: planned first-class rows exist and legacy reuse paths are either
  removed or explicitly gated.

## External Dependencies

### APIs and Services

#### Lidarr REST API v1

- **Documentation**:
  - <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json>
  - <https://lidarr.audio/docs/api/>
  - <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Profiles/Qualities/QualityProfileService.cs>
  - <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Qualities/Quality.cs>
- **Authentication**: API key via `X-Api-Key` header
- **Key Endpoints**:
  - `GET /api/v1/qualityprofile`
  - `GET /api/v1/qualityprofile/schema`
  - `GET /api/v1/qualitydefinition`
  - `GET /api/v1/customformat`
- **Rate Limits**: no explicit hard quota documented
- **Pricing**: self-hosted OSS

#### Optional Metadata Dependency: MusicBrainz

- **Documentation**:
  - <https://musicbrainz.org/doc/MusicBrainz_API>
  - <https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting>
- **Authentication**: meaningful `User-Agent`
- **Rate Limits**: public guidance around 1 request/second
- **Pricing**: free/public baseline

### Libraries and SDKs

| Library                                  | Version | Purpose                                 | Installation                                     |
| ---------------------------------------- | ------- | --------------------------------------- | ------------------------------------------------ |
| `@openapitools/openapi-generator-cli`    | latest  | Typed Lidarr client generation          | `npm i -D @openapitools/openapi-generator-cli`   |
| `NSwag.ApiDescription.Client` (optional) | latest  | C# client generation path               | `dotnet add package NSwag.ApiDescription.Client` |
| `pyarr` (optional, community maintained) | latest  | Quick Python Servarr integration checks | `pip install pyarr`                              |

### External Documentation

- <https://wiki.servarr.com/lidarr/settings>
- <https://davoslidarrguides.github.io/Quality-Definitions>
- <https://davoslidarrguides.github.io/Quality-Profiles>
- <https://www.nngroup.com/articles/ten-usability-heuristics/>
- <https://design-system.service.gov.uk/components/radios/>

## Business Requirements

### User Stories

**Primary User: Praxrr Administrator**

- As a Praxrr administrator, I want Lidarr defaults that are not reused from generic records so
  music behavior is explicit and maintainable.
- As a Praxrr administrator, I want three clear quality tiers so teams can standardize music
  acquisition defaults quickly.

**Secondary User: Music Curator**

- As a music curator, I want predictable tier behavior (`Lossless`, `High Quality Lossy`, `Lossy`)
  so results match codec/bitrate expectations.

### Business Rules

1. **No Reuse Rule**: New Lidarr defaults must not reuse generic default records.
   - Validation: every seeded custom format and quality profile row for this feature must use newly
     introduced `Lidarr - ... (Praxrr)` names.
   - Exception: temporary compatibility aliases are allowed only if explicitly documented and
     time-bounded.

2. **Tier Completeness Rule**: All three Lidarr tiers must be seeded together.
   - Validation: release checks fail if one of the three tiers is missing.

3. **Idempotent Publication Rule**: SQL operations remain replay-safe.
   - Validation: inserts use restrictive predicates/`NOT EXISTS` and preserve deterministic keys.

4. **Lidarr-Native Parameter Rule**: Lidarr defaults must only use condition and mapping shapes that
   the Lidarr API and praxrr sync path actually support.
   - Validation: custom format conditions are limited to `release_title`, `release_group`,
     `indexer_flag`, and `size`; `quality_profile_custom_formats` rows for new defaults are scoped
     with `arr_type='lidarr'`.

### Edge Cases

| Scenario                                 | Expected Behavior                                                     | Notes                                 |
| ---------------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| Existing `Lidarr Default` remains in DB  | New suffixed tiers are additive and do not overwrite existing rows    | Allows controlled migration           |
| Name collision from prior manual seeds   | Operation skips duplicate and reports mismatch for manual remediation | Keep deterministic behavior           |
| Upstream Lidarr quality taxonomy changes | Mapping review required before altering tier membership               | Reference `Quality.cs` source         |
| Consumer not yet expecting new names     | Gate activation via documented compatibility window                   | Coordinate with Praxrr release timing |

### Success Criteria

- [ ] Three first-class Lidarr tiers are defined: `Lidarr - Lossless (Praxrr)`,
      `Lidarr - High Quality Lossy (Praxrr)`, `Lidarr - Lossy (Praxrr)`.
- [ ] Tier-linked defaults do not reuse generic names from existing Lidarr v1 seeds (`AAC`, `FLAC`,
      `Opus`, `Lidarr Default`).
- [ ] Seed operations are idempotent and dependency-safe.
- [ ] Lidarr custom formats in defaults use only supported Lidarr condition types (`release_title`,
      `release_group`, `indexer_flag`, `size`) and do not rely on skipped condition types.
- [ ] Documentation clearly defines tier semantics and migration behavior.

## Technical Specifications

### Architecture Overview

```text
praxrr-db (SQL ops)
  |-- seed suffixed Lidarr custom formats
  |-- seed suffixed Lidarr quality profiles (3 tiers)
  |-- seed arr_type='lidarr' score mappings
  '-- seed suffixed Lidarr condition rows
                |
                v
         praxrr consumer reads DB
                |
                v
             Lidarr API
```

### Data Models

#### Proposed First-Class Lidarr Naming Set

| Entity Type               | Proposed Names                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Quality Profiles          | `Lidarr - Lossless (Praxrr)`, `Lidarr - High Quality Lossy (Praxrr)`, `Lidarr - Lossy (Praxrr)` |
| Custom Formats (minimum)  | `Lidarr - FLAC (Praxrr)`, `Lidarr - Opus (Praxrr)`, `Lidarr - AAC (Praxrr)`                     |
| Optional Format Expansion | `Lidarr - ALAC (Praxrr)`, `Lidarr - MP3 V0 (Praxrr)`, `Lidarr - MP3 320 (Praxrr)`               |

#### Tier Mapping Intent

| Tier                                   | Primary Targets                                                     | Notes                                             |
| -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| `Lidarr - Lossless (Praxrr)`           | FLAC/ALAC/APE/WavPack/24-bit lossless/WAV                           | Highest preference and strict lossless conditions |
| `Lidarr - High Quality Lossy (Praxrr)` | AAC-320/AAC-VBR/MP3-320/MP3-VBR-V0/OGG Vorbis Q9-Q10/Opus           | Modern lossy quality target                       |
| `Lidarr - Lossy (Praxrr)`              | AAC-192/AAC-256/MP3-192/MP3-224/MP3-256/MP3-VBR-V2/OGG Vorbis Q6-Q8 | Broader compatibility tier                        |

**Verified against Lidarr native quality groups (2026-02-16)**: Lidarr's `Quality.cs` defines 38
audio qualities with 8 group-weight levels (including `Unknown`), where OGG Vorbis Q10 is natively
grouped as High Quality Lossy (weight 6), FLAC/ALAC/APE/WavPack/FLAC 24bit/ALAC 24bit are grouped as
Lossless (weight 7), and WAV is in the top group (weight 8).

**Excluded qualities**: 16 low-quality definitions (Unknown, MP3-8 through MP3-128, MP3-160, OGG
Vorbis Q5, WMA) are intentionally excluded from all profiles.

**Opus limitation**: Lidarr does not define a standalone `Opus` quality label. `QualityParser.cs`
detects Opus and maps it into OGG Vorbis Q5-Q10 tiers by bitrate. The Opus custom format remains
useful for release-title scoring, but quality labels shown in Lidarr will be Vorbis-tier names
rather than `Opus`.

#### Quality Definition Sizing Guidance

- Servarr's Lidarr settings guide states quality definition sizes apply to the entire music release
  (album/EP/single), not per-minute runtime.
- Baseline recommendation: keep the Lidarr `Quality.cs` defaults represented in
  `ops/52.seed-lidarr-quality-definitions.sql` for initial rollout consistency.
- Community practice for short-release libraries (singles/EP-heavy) often lowers minimums relative
  to Lidarr defaults; example values from community guides include MP3-320 min `50`, AAC-320 min
  `50`, FLAC min `200`, FLAC 24bit min `300`.

**Indexes / Constraints**

- Respect existing uniqueness constraints by using deterministic unique names.
- Use idempotent insert guards (`NOT EXISTS`) keyed by seeded name + scope columns.

### API Design

#### Consumer Contract (Conceptual)

`GET /api/pcd/defaults?arrType=lidarr`

**Purpose**: expose available Lidarr default tiers from seeded DB rows.

**Response (conceptual)**

```json
{
  "arrType": "lidarr",
  "defaults": [
    {
      "name": "Lidarr - Lossless (Praxrr)",
      "tier": "lossless",
      "customFormats": ["Lidarr - FLAC (Praxrr)", "Lidarr - ALAC (Praxrr)"]
    },
    {
      "name": "Lidarr - High Quality Lossy (Praxrr)",
      "tier": "hq_lossy",
      "customFormats": ["Lidarr - AAC (Praxrr)", "Lidarr - Opus (Praxrr)"]
    },
    {
      "name": "Lidarr - Lossy (Praxrr)",
      "tier": "lossy",
      "customFormats": ["Lidarr - AAC (Praxrr)", "Lidarr - MP3 V0 (Praxrr)"]
    }
  ]
}
```

**Errors**

| Status | Condition                     | Response         |
| ------ | ----------------------------- | ---------------- |
| 400    | Unsupported arr type          | Validation error |
| 404    | Expected tier dataset missing | Not found error  |
| 409    | Duplicate conflicting rows    | Conflict error   |

### System Integration

#### Files to Create

- `ops/<next>.seed-lidarr-first-class-defaults.sql`: new non-reused Lidarr default seeds.

#### Files to Modify

- `README.md`: document Lidarr first-class tier defaults.
- `pcd.json`: update compatibility metadata if required by consumer rollout.
- `docs/plans/lidarr-support/*` (optional cross-reference): link migration context.

#### Configuration

- Manifest gating through `pcd.json` release/consumer compatibility notes.

## UX Considerations

### User Workflows

#### Primary Workflow: Choose Tier and Apply

1. **Select Tier**
   - User: chooses one tier (`Lossless`, `High Quality Lossy`, `Lossy`).
   - System: previews Lidarr `... (Praxrr)` records to be applied.
2. **Confirm Apply**
   - User: confirms default set.
   - System: applies deterministic mapping and reports result.
3. **Success State**
   - System: confirms selected tier and affected record count.

#### Error Recovery Workflow

1. **Error Occurs**: conflicting or missing seeded dependencies.
2. **User Sees**: actionable error summary with problematic record names.
3. **Recovery**: user adjusts settings/seed version and retries.

### UI Patterns

| Component           | Pattern               | Notes                                                         |
| ------------------- | --------------------- | ------------------------------------------------------------- |
| Tier selector       | radio group           | Single-choice among 3 tiers                                   |
| Record naming       | prefix + suffix label | `Lidarr - ... (Praxrr)` for scanability and ownership clarity |
| Validation feedback | summary + inline      | preserve user input on failure                                |

### Accessibility Requirements

- Use proper fieldset/legend semantics for tier selection.
- Ensure keyboard interaction for radio groups.
- Announce validation and success status messages accessibly.

### Performance UX

- Loading: show progress for apply/sync operations.
- Error feedback: immediate and actionable, no silent fallback.

## Recommendations

### Implementation Approach

**Recommended Strategy**: Additive, non-reused, suffix-qualified Lidarr seeds with three explicit
tiers.

**Phasing:**

1. **Phase 1 - Seed Foundation**: introduce `Lidarr - ... (Praxrr)` records and tier structure.
2. **Phase 2 - Consumer Switch**: move default selection to new tiers and enforce no-reuse checks.
3. **Phase 3 - Cleanup**: deprecate transitional aliases and tighten validations.

### Technology Decisions

| Decision          | Recommendation                                                  | Rationale                                             |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| Naming convention | `Lidarr - ... (Praxrr)` for custom formats and quality profiles | Better filtering, scanability, and ownership clarity  |
| Tier count        | Exactly 3 tiers now                                             | Matches user requirement and keeps rollout manageable |
| Migration style   | Additive first, no in-place overwrite                           | Lower risk and easier rollback                        |

### Quick Wins

- Define final canonical names for the 3 tiers.
- Add validation SQL that blocks reused generic default dependencies.
- Document tier codec/bitrate boundaries in README.

### Future Enhancements

- Schema evolution to enforce stronger arr-type uniqueness in shared tables.
- Additional Lidarr-specific metadata/release-profile defaults.

## Risk Assessment

### Technical Risks

| Risk                                    | Likelihood | Impact | Mitigation                                                         |
| --------------------------------------- | ---------- | ------ | ------------------------------------------------------------------ |
| Name collisions in shared tables        | Medium     | High   | Deterministic `Lidarr - ... (Praxrr)` names + `NOT EXISTS` guards  |
| Tier semantics drift vs upstream Lidarr | Medium     | Medium | Periodic review of Lidarr quality source mappings                  |
| Consumer expecting legacy names only    | Medium     | High   | Compatibility window and explicit migration docs                   |
| Opus naming mismatch in UI              | Medium     | Low    | Lidarr maps Opus into Vorbis quality tiers; CF scoring still works |
| Invalid condition types for Lidarr      | Low        | High   | Only use release_title, release_group, indexer_flag, size          |

### Integration Challenges

- Current schema has mixed shared/per-arr boundaries; avoid assumptions and keep changes additive.
- Existing `arr_type='all'` condition behavior can leak semantics if not explicitly fenced.
- Lidarr uses API v1 (not v3 like Radarr/Sonarr); the praxrr `LidarrClient` handles this.
- Lidarr supports only 4 custom format specification types (`release_title`, `release_group`,
  `indexer_flag`, `size`). Do NOT use `language`, `resolution`, `source`, `quality_modifier`, or
  `release_type` conditions.
- Praxrr skips unsupported Lidarr condition types during transform and can drop a custom format
  entirely if no supported specs remain.
- Video-codec negation conditions (Not Dolby Digital, Not DTS, Not PCM, Not TrueHD) are
  inappropriate for music and have been removed from the plan.

### Security Considerations

- No secrets in SQL/docs.
- Fail-fast validation; no implicit fallback to reused defaults.

## Task Breakdown Preview

### Phase 1: Naming and Seed Contract

**Focus**: lock naming and tier definitions. **Tasks**:

- finalize canonical tier names
- finalize format membership for each tier
- define no-reuse validation queries

**Parallelization**: naming confirmation and SQL validation drafting can run in parallel.

### Phase 2: SQL Seed Implementation

**Focus**: add new operations and dependency-safe inserts. **Dependencies**: Phase 1 complete.
**Tasks**:

- add `ops/<next>.sql` with suffixed Lidarr defaults
- wire profile-format-condition mappings
- run idempotency verification

### Phase 3: Rollout and Documentation

**Focus**: publish contract and migration behavior. **Tasks**:

- update README and compatibility notes
- publish validation evidence
- define deprecation timeline for legacy reused behavior

## Decisions Needed

Before implementation planning:

1. **Canonical Naming Scope**
   - Options: apply `(Praxrr)` suffix to profiles/custom formats only, or broaden to additional
     Lidarr-named entities
   - Impact: affects migration scripts and consumer selectors
   - Recommendation: lock profiles/custom formats now, review expansion separately

2. **Tier Threshold Boundaries**
   - Options: conservative (`Lossy` starts at 192 kbps) vs stricter (`Lossy` starts at 256 kbps)
   - Impact: download behavior and storage profile
   - Recommendation: conservative baseline for broader compatibility

3. **Legacy `Lidarr Default` Transition**
   - Options: keep alias window vs immediate switch
   - Impact: compatibility risk vs cleanup speed
   - Recommendation: one release alias window, then deprecate

## Research References

- [research-external.md](./research-external.md)
- [research-business.md](./research-business.md)
- [research-technical.md](./research-technical.md)
- [research-ux.md](./research-ux.md)
- [research-recommendations.md](./research-recommendations.md)
