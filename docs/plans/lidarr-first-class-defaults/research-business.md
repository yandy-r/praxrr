# Lidarr First-Class Defaults - Business Logic Analysis

## Executive Summary

The feature should move Lidarr defaults from reused/shared behavior to explicit Lidarr-owned
defaults. Business value is predictable music-focused onboarding and safer arr-type isolation. The
product contract should require three preset tiers: `Lossless`, `High Quality Lossy`, and `Lossy`,
each uniquely named as Lidarr records.

## User Stories

- Primary: As a Praxrr administrator, I want dedicated Lidarr defaults so music instances are
  configured without reusing video defaults.
- Secondary: As a music curator, I want clear quality tiers so expected codec/bitrate behavior is
  predictable.

## Business Rules

- Core rules:
  - Do not reuse generic/default rows for Lidarr-specific properties.
  - Every new custom format and quality profile row must be obviously Lidarr-specific by name
    (`Lidarr - ... (Praxrr)`) and scope (`arr_type='lidarr'` where available).
  - Three mandatory tiers must be present: `Lossless`, `High Quality Lossy`, `Lossy`.
- Validations and exceptions:
  - Use idempotent inserts (`NOT EXISTS`) keyed by name + arr scope.
  - Block release if required dependent entities (formats, profiles, conditions, mappings) are
    missing.
  - If schema gate does not allow safe arr isolation, stop and re-plan rather than partially
    publish.

## Workflows

- Primary flow:
  - Seed dedicated Lidarr default entities.
  - Bind them to Lidarr quality definitions and custom-format logic.
  - Publish and verify consumer visibility.
- Error recovery flow:
  - On missing references or schema mismatch, fail fast.
  - Correct seed dependencies and rerun idempotent scripts.

## Domain Concepts

- Arr-scoped defaults for Lidarr.
- Tiered quality intent: lossless vs HQ lossy vs lossy.
- Deterministic naming contract for discovery and migration.
- Manifest/version gating before rollout.

## Success Criteria

- Three first-class Lidarr default tiers exist and are consumable.
- No Lidarr tier depends on reused generic default rows.
- Seed operations are replay-safe and pass integrity checks.
- Documentation and release notes explain supported tier semantics and limits.

## Open Questions

- Should tier names include `Default` suffix (`Lidarr - Lossless (Praxrr) Default`) or stay concise
  (`Lidarr - Lossless (Praxrr)`)?
- Exact quality/bitrate thresholds for `Lossy` cutoff.
- Whether to keep a temporary compatibility alias for existing `Lidarr Default`.
