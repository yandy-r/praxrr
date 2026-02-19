# Lidarr First-Class Defaults - Technical Specification Analysis

## Executive Summary

The technical approach should be additive SQL operations aligned with existing Lidarr seed ordering,
with no reuse of generic default rows. A `Lidarr - ... (Praxrr)` naming convention for quality
profiles and custom formats is most robust against collisions in current schema patterns.
Implementation should introduce three dedicated Lidarr tier datasets: Lossless, High Quality Lossy,
and Lossy.

## Architecture Approach

- Component/service boundaries:
  - `praxrr-db` remains SQL-only canonical seed source.
  - Consumer behavior remains in downstream Praxrr.
- Integration points:
  - New `ops/<next>.sql` files extending existing Lidarr seed chain.
  - Optional `pcd.json` compatibility/min-version notes if contract expands.

## Lidarr Native Parameters (Verified 2026-02-16)

- **Custom format specification types**: Lidarr supports only 4 types: `release_title`
  (ReleaseTitleSpecification), `release_group` (ReleaseGroupSpecification), `indexer_flag`
  (IndexerFlagSpecification), `size` (SizeSpecification). Missing from Lidarr: `language`,
  `resolution`, `source`, `quality_modifier`, `release_type`, `edition`, `year`.
- **Quality definitions**: 38 audio qualities (IDs 0-37) across 8 group-weight levels including
  `Unknown`; OGG Vorbis Q10 is grouped as High Quality Lossy (weight 6), and WAV is in the highest
  group (weight 8).
- **API version**: Lidarr uses API v1 (not v3). The praxrr LidarrClient overrides
  `apiVersion = 'v1'`.
- **Quality parser**: Detects audio codecs (FLAC, MP3, AAC, OGG, Opus, ALAC, APE, WavPack, WMA, WAV)
  and bitrates. Does NOT detect video codecs (Dolby Digital, DTS, TrueHD).
- **Opus handling**: Lidarr has no standalone `Opus` quality label, but `QualityParser` maps Opus to
  OGG Vorbis Q5-Q10 tiers based on bitrate.
- **PCM is valid audio**: WAV/PCM is Quality ID 13 in Lidarr. Do NOT negate PCM in music CFs.
- **Metadata profiles**: Lidarr-unique concept controlling album types and release statuses. Out of
  scope for v1.

## Data Model Implications

- Entities/tables/collections:
  - Extend existing Lidarr-targeted seed entities:
    - custom formats
    - quality profiles
    - quality definitions
    - quality profile/custom format score mappings
    - custom format conditions
  - Introduce first-class Lidarr-only names, e.g.:
    - `Lidarr - Lossless (Praxrr)`
    - `Lidarr - High Quality Lossy (Praxrr)`
    - `Lidarr - Lossy (Praxrr)`
- Indexes and migration considerations:
  - Preserve uniqueness semantics with `NOT EXISTS` and deterministic lookup keys.
  - Keep operation ordering dependency-safe (formats before mappings/conditions).

## API Design Considerations

- Endpoints/interfaces:
  - No new API in this repo; data is consumed by Praxrr.
- Request/response shape guidance:
  - Consumer-facing payloads should expose tier name and associated profile/format mappings.
- Error handling model:
  - Fail hard on missing dependencies and conflicting duplicates.

## System Constraints

- Performance:
  - Keep inserts idempotent and indexed by stable keys.
- Security:
  - No secrets in seed artifacts; no dynamic code paths introduced.
- Compatibility:
  - Avoid breaking existing Radarr/Sonarr rows.
  - Gate rollout with consumer version expectations when needed.

## File-Level Impact Preview

- Likely files to create:
  - `ops/<next>.seed-lidarr-first-class-defaults.sql`
- Likely files to modify:
  - `pcd.json` (if compatibility metadata changes)
  - `README.md` (document new Lidarr defaults)
  - `docs/plans/lidarr-support/*` cross-reference updates if needed
