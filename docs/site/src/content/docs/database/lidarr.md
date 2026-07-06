---
title: Lidarr Support
description: Lidarr v1 seed scope, audio quality profiles, custom formats, and known limitations.
---

Lidarr support in the Praxrr Database is **compatibility-gated** at `praxrr >= 2.1.0`. Publication
requires `lidarr` in `pcd.json` `arr_types` and passing minimum dataset checks.

## v1 seed scope

Additive, arr-scoped seeding includes:

- Quality profiles (3 audio presets)
- Custom formats and conditions (`arrType: lidarr`)
- Quality profile to custom format score mappings
- Quality definitions required by selected profiles
- Media-management defaults (naming + media settings)
- Metadata profile defaults

## Audio quality profiles

| Profile                              | Target                                                |
| ------------------------------------ | ----------------------------------------------------- |
| Lidarr - Lossless (Praxrr)           | FLAC, ALAC, APE, WavPack, FLAC 24bit, ALAC 24bit, WAV |
| Lidarr - Lossy (Praxrr)              | Lossy codecs with controlled upgrades                 |
| Lidarr - High Quality Lossy (Praxrr) | Higher-tier lossy targets                             |

See YAML under `entities/quality-profiles/lidarr-*.yaml` for full tier ordering and scores.

## Lidarr custom formats

| Name                   | Description                                  |
| ---------------------- | -------------------------------------------- |
| Lidarr - AAC (Praxrr)  | Matches AAC audio for Lidarr                 |
| Lidarr - FLAC (Praxrr) | Matches FLAC lossless audio codec for Lidarr |
| Lidarr - Opus (Praxrr) | Matches Opus audio for Lidarr                |

These CFs use `arrType: lidarr` conditions and pair with the audio profiles above.

## Media and metadata defaults

Bundled under `entities/media-management/lidarr-*` and `entities/metadata-profiles/lidarr/`:

- Quality definitions and size limits
- Naming conventions
- Media settings defaults
- Metadata profile defaults

## Known limitations (v1)

Explicitly **out of scope**:

- Release profile seeding
- SignalR / event-stream integration
- Automatic OpenAPI client generation
- Non-essential schema redesign beyond the shared-table path

## Compatibility gate

Release remains blocked if Lidarr metadata or the minimum version gate is missing from the published
manifest, or if minimum dataset / idempotency checks fail.

## Related

- [Quality profiles overview](/database/quality-profiles/)
- [Custom formats catalog](/database/custom-formats/)
- [Release & delay profiles](/database/release-delay-profiles/)
