# Lidarr First-Class Defaults - Recommendations

## Executive Summary

Adopt a `Lidarr - ... (Praxrr)` naming convention for quality profiles and custom formats, and
create additive Lidarr-only defaults to avoid reuse ambiguity. Implement three explicit tiers
(`Lossless`, `High Quality Lossy`, `Lossy`) as first-class seeded entities. Keep rollout safe with
compatibility aliasing only if required, then deprecate reused rows.

## Recommended Implementation Strategy

- High-confidence approach:
  - Add new Lidarr-specific default rows rather than mutating reused rows in place.
  - Use naming convention: `Lidarr - <Tier> (Praxrr)` for quality profiles and custom formats.
- Rationale and tradeoffs:
  - Prefix improves queryability, auditing, and operator scanability.
  - Additive rollout lowers migration risk but may temporarily duplicate semantics.

## Phased Rollout Suggestion

- Phase 1:
  - Seed three first-class Lidarr tiers and related mappings/conditions.
  - Keep existing reused rows untouched.
- Phase 2:
  - Switch consumer default selection to new tiers.
  - Add validation to prevent future reuse for Lidarr properties.
- Phase 3:
  - Remove/deprecate legacy reused Lidarr defaults after compatibility window.

## Quick Wins

- Create tier names and seed placeholders now (`Lidarr - Lossless (Praxrr)`,
  `Lidarr - High Quality Lossy (Praxrr)`, `Lidarr - Lossy (Praxrr)`).
- Add release validation query ensuring no reused-generic fallback for Lidarr defaults.
- Document naming contract in plan/spec and README.
- Document quality-definition sizing policy as release-level (whole album/EP/single) and keep
  baseline defaults aligned to Lidarr `Quality.cs` values.
- Publish a sensible CF grouping baseline:
  - Lossless-focused: `Lidarr - FLAC (Praxrr)` (+ optional ALAC/APE/WavPack expansion)
  - High-quality lossy: `Lidarr - AAC (Praxrr)`, `Lidarr - Opus (Praxrr)`
  - Broad lossy compatibility: MP3/Vorbis family expansion only if regex/conditions are explicitly
    added

## Future Enhancements

- Schema evolution to enforce arr-type-level uniqueness where currently name-based.
- Optional expansion to Lidarr metadata/release profile defaults.
- Automation to detect drift with upstream Lidarr quality definitions.

## Risk Mitigations

- Duplicate/collision risk:
  - `NOT EXISTS` guards and deterministic name keys.
- Cross-arr leakage risk:
  - Validate no dependency on shared `default` semantics for Lidarr tier records.
- Consumer compatibility risk:
  - Alias window with explicit deprecation timeline when necessary.

## Decision Checklist

- Confirm whether `(Praxrr)` should remain limited to quality profiles/custom formats or expand to
  other Lidarr-named entities.
- Confirm codec/bitrate boundaries for each tier.
- Confirm transition policy for existing `Lidarr Default` behavior.
- Confirm whether schema hardening is in this scope or deferred.
