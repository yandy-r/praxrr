# Lidarr First-Class Defaults - External API Research

## Executive Summary

Lidarr provides enough first-party API and source-level contract detail to define dedicated default
tiers without reusing cross-app defaults. A `Lidarr - ... (Praxrr)` naming convention for quality
profiles and custom formats is the safest interoperability choice because current seeds rely heavily
on name keys. The recommended tier set is `Lossless`, `High Quality Lossy`, and `Lossy`, mapped to
Lidarr-native quality families.

## Candidate APIs and Services

### Lidarr REST API v1

- Documentation URL:
  - <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json>
  - <https://lidarr.audio/docs/api/>
  - <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Profiles/Qualities/QualityProfileService.cs>
  - <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Qualities/Quality.cs>
- Auth model:
  - API key via `X-Api-Key` header (preferred) or `apikey` query parameter.
- Key endpoints/capabilities:
  - `GET /api/v1/qualityprofile`, `GET /api/v1/qualityprofile/schema`
  - `GET /api/v1/qualitydefinition`, `PUT /api/v1/qualitydefinition/update`
  - `GET /api/v1/customformat`
  - `GET /api/v1/metadataprofile`, `GET /api/v1/metadataprofile/schema`
- Rate limits/quotas:
  - No explicit first-party hard quota documented.
- Pricing notes:
  - OSS/self-hosted, no API fee.

### Lidarr Event Channels

- Documentation URL:
  - <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Host/Startup.cs>
  - <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Notifications/Webhook/Webhook.cs>
- Auth model:
  - SignalR uses API-key-backed auth flow.
  - Webhooks support configured headers/credentials.
- Key endpoints/capabilities:
  - SignalR hub: `/signalr/messages`
  - Notification webhooks for grab/import/failure/update events.
- Rate limits/quotas:
  - No explicit limits documented.
- Pricing notes:
  - Included in Lidarr.

### Optional Metadata Source: MusicBrainz

- Documentation URL:
  - <https://musicbrainz.org/doc/MusicBrainz_API>
  - <https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting>
- Auth model:
  - No API key required for standard use; meaningful `User-Agent` required.
- Key endpoints/capabilities:
  - WS/2 metadata entities (`artist`, `release`, `release-group`).
- Rate limits/quotas:
  - Public guidance: ~1 request/second per app/IP.
- Pricing notes:
  - Free public use; commercial options exist.

## Libraries and SDKs

- Polyglot: OpenAPI Generator (`@openapitools/openapi-generator-cli`) from Lidarr OpenAPI.
- .NET: NSwag for typed clients if consumer stack is C#.
- Python: `pyarr` for quick integration, pinned version recommended.

## Integration Patterns

- Recommended auth flow:
  - Store API key in secrets; send `X-Api-Key` for REST requests.
- Sync/event/webhook strategy:
  - Reconcile by periodic REST reads keyed by deterministic names; optionally add SignalR/webhooks
    later for drift detection.
- Pagination/error handling approach:
  - Treat 400 validation failures as hard contract mismatches.
  - Retry only transient 5xx/network errors.

## Constraints and Gotchas

- Quality profile payloads are strictly validated (complete quality item set required).
- Quality profile cutoff must point to an allowed quality/group.
- Metadata profile name `None` is reserved.
- Root folder path has immutability constraints after creation.
- OpenAPI route availability can vary by runtime; repository OpenAPI JSON is safer for tooling.

### Lidarr-Specific Constraints (Verified 2026-02-16)

- **Custom format specification types are limited to 4**: `ReleaseTitleSpecification`,
  `ReleaseGroupSpecification`, `IndexerFlagSpecification`, `SizeSpecification`. Lidarr does NOT have
  `LanguageSpecification`, `ResolutionSpecification`, `SourceSpecification`,
  `QualityModifierSpecification`, `EditionSpecification`, `YearSpecification`, or
  `ReleaseTypeSpecification`.
- **Lidarr API is v1**: The praxrr consumer's `LidarrClient` overrides `apiVersion = 'v1'`
  (Radarr/Sonarr use v3).
- **Lidarr's QualityParser does NOT detect video codecs**: Dolby Digital, DTS, TrueHD are not
  parsed. PCM/WAV is a valid lossless audio format (Quality ID 13).
- **No standalone "Opus" quality definition label**: Lidarr maps Opus into OGG Vorbis Q5-Q10 quality
  tiers by bitrate in `QualityParser.cs`.
- **OGG Vorbis Q10 is classified as High Quality Lossy** by Lidarr (group weight 6), not Lossless.
- **Praxrr consumer enforces condition type restrictions**:
  `LIDARR_SUPPORTED_CONDITION_TYPES = new Set(['release_title', 'release_group', 'indexer_flag', 'size'])`
  in `src/lib/server/sync/customFormats/transformer.ts`. Unsupported conditions are silently skipped
  during sync.

### Servarr and Community Best-Practice Signals

- **Servarr wiki guidance**: Lidarr quality-definition expected sizes are for the whole release, not
  per-minute media runtime.
- **Community usage trend (Davos Lidarr Guides)**: users commonly retain Lidarr's default
  max/preferred values but lower minimums for short releases and singles/EP-heavy libraries.
- **Common tuning examples**: MP3-320 min `50`, AAC-320 min `50`, FLAC min `200`, FLAC 24bit min
  `300`.

## Open Decisions

- Final boundaries for `Lossy` vs `High Quality Lossy` thresholds.
- Whether `Opus` belongs only in `High Quality Lossy` or both lossy tiers. Note: Opus will still
  appear as Vorbis-tier quality labels in Lidarr, so this primarily affects custom format scoring
  strategy and user expectation messaging.
- Migration strategy: create additive first-class Lidarr rows vs in-place rename of reused rows.

## Sources

- Accessed on 2026-02-16.
- <https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json>
- <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Profiles/Qualities/QualityProfileService.cs>
- <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Qualities/Quality.cs>
- <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Host/Startup.cs>
- <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Notifications/Webhook/Webhook.cs>
- <https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Parser/QualityParser.cs>
- <https://wiki.servarr.com/lidarr/settings>
- <https://davoslidarrguides.github.io/Quality-Definitions>
- <https://musicbrainz.org/doc/MusicBrainz_API>
- <https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting>
