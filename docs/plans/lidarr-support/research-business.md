# Lidarr Support - Business Logic Analysis

## Executive Summary

Adding Lidarr support means treating music workflows as first-class in this database while
preserving the existing profile-driven model already used for Radarr and Sonarr. `pcd.json`
currently declares only `radarr` and `sonarr`, so business behavior must define how Lidarr entities
are introduced, validated, and consumed without breaking existing consumers. The key product
requirement is parity in operability with media-type-specific rules for artists/albums/audio
releases.

## User Stories

- Primary user story: As a Praxrr administrator, I want to apply centralized profiles for Lidarr so
  music quality and release preferences are managed with the same operational flow used for
  Radarr/Sonarr.
- Secondary user story: As a music curator, I want profile rules for audio sources, codecs, and
  release metadata so Lidarr acquisition behavior aligns with my music-library goals.

## Business Rules

- Core rules:
  - Lidarr data must be explicitly scoped by arr type and not mixed with video-only logic.
  - Existing profile/custom-format strategy should remain the default authoring model to preserve
    operator familiarity.
  - Music-relevant rule assets (regex, tags, custom formats, qualities) must be present before
    profiles referencing them are published.
- Validations and exceptions:
  - Reject profiles that combine incompatible media assumptions (for example video-only quality
    semantics in Lidarr-only records).
  - Reject profiles missing required linked data (no associated quality definitions, no usable
    condition set).
  - Permit phased rollout exceptions when a feature is intentionally unsupported in v1, but require
    explicit feature gating metadata.

## Workflows

- Primary flow:
  - Database publishes Lidarr-arr_type profile data.
  - Praxrr reads and displays that data as a manageable configuration set.
  - User selects and applies profile configuration to Lidarr instance.
  - Sync status and version information are recorded for repeatability.
- Error recovery flow:
  - Validation/import failure is surfaced with specific missing or invalid entities.
  - User corrects profile inputs or mapping configuration.
  - Retry applies only failed units where possible, with idempotent behavior.

## Domain Concepts

- Key entities:
  - `arr_type` discriminator (`lidarr` addition)
  - quality profiles
  - custom formats and conditions
  - quality definitions/mappings
  - optional music-domain metadata profile and release profile constructs
- State transitions:
  - draft content -> validated content -> published DB operation -> consumed by Praxrr -> applied to
    Lidarr -> monitored/iterated.

## Success Criteria

- `lidarr` is represented in DB metadata and consumable by Praxrr without regressions to existing
  `radarr` and `sonarr` behavior.
- At least one complete, valid Lidarr profile set (profile + formats + conditions + quality mapping)
  can be applied end to end.
- Validation detects and blocks invalid mixed-media or incomplete Lidarr records.
- Release notes and support docs clearly describe supported Lidarr scope for v1.

## Open Questions

- Is v1 limited to quality-profile and custom-format support, or should it include metadata/release
  profile support from day one?
- Should music tagging/regex taxonomies be shared with existing structures or split into
  Lidarr-focused catalogs?
- What minimum compatibility version in Praxrr should gate Lidarr-enabled DB releases?
