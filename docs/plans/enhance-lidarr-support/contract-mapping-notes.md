# Lidarr Portable Contract Mapping Notes (Task 1.2)

## Canonical Contract Types

Lidarr media-management entities are first-class portable entity types and should be emitted as:

- `lidarr_naming`
- `lidarr_media_settings`
- `lidarr_quality_definitions`

## Runtime Validation Mapping

Current import validation maps `lidarr_*` payloads to existing validator implementations while preserving deterministic, fail-fast behavior:

- `lidarr_naming` -> validates with `sonarr_naming` rules + Lidarr allowlist/forbidden-field checks
- `lidarr_media_settings` -> validates with `sonarr_media_settings` rules + Lidarr allowlist checks
- `lidarr_quality_definitions` -> validates with `sonarr_quality_definitions` rules + Lidarr allowlist checks

The mapping above is an implementation detail for Task 1.2 contract parity and does not change canonical portable entity identifiers.

## Temporary Legacy Alias Behavior

Legacy non-Lidarr entity identifiers may still appear in existing clients/exports and are retained temporarily for compatibility:

- `lidarr_naming`: legacy alias `sonarr_naming`
- `lidarr_media_settings`: legacy aliases `radarr_media_settings`, `sonarr_media_settings`
- `lidarr_quality_definitions`: legacy aliases `radarr_quality_definitions`, `sonarr_quality_definitions`

Compatibility aliases are transitional. New clients should use canonical `lidarr_*` entity types.

## Deterministic Fail-Fast Rules

For `lidarr_*` imports, runtime validation fails immediately when:

- required fields are missing
- unknown fields are present
- cross-family fields are mixed in (for example Radarr naming fields on `lidarr_naming`)

This keeps import/export payload expectations deterministic and prevents silent cross-family coercion.
