# Lidarr Condition Evidence

Task 2.5 evidence for `ops/54.seed-lidarr-custom-format-conditions.sql`.

## Traceability

- Seed inventory entity: `custom_format_condition_seed` in
  [`docs/plans/lidarr-support/lidarr-seed-inventory.md`](./lidarr-seed-inventory.md).
- Source condition semantics:
  - [`ops/0.rosettarr.sql#L4388`](../../../ops/0.rosettarr.sql#L4388) (`AAC` condition family)
  - [`ops/0.rosettarr.sql#L5592`](../../../ops/0.rosettarr.sql#L5592) (`FLAC` condition family)
  - [`ops/0.rosettarr.sql#L6132`](../../../ops/0.rosettarr.sql#L6132) (`Opus` condition family)

## Expected Match and Non-Match Examples

| Condition Family | Seeded Conditions                                                                                          | Expected Match Example                     | Expected Non-Match Example                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| `AAC`            | `AAC` + negated `Not Dolby Digital`, `Not Dolby Digital +`, `Not DTS`, `Not FLAC`, `Not PCM`, `Not TrueHD` | `Artist.Album.2024.AAC.256kbps.WEB-DL-GRP` | `Artist.Album.2024.AAC.FLAC.24bit.WEB-DL-GRP` |
| `FLAC`           | `FLAC` + negated `Not AAC`, `Not Dolby Digital`, `Not Dolby Digital +`, `Not DTS`, `Not PCM`, `Not TrueHD` | `Artist.Album.2024.FLAC.16bit.CD-GRP`      | `Artist.Album.2024.FLAC.AAC.320kbps.CD-GRP`   |
| `Opus`           | `Opus` + negated release-group condition `Not OPUS Release Group`                                          | `Artist.Album.2024.OPUS.320kbps-QxR`       | `Artist.Album.2024.OPUS.320kbps-OPUS`         |

Non-match examples intentionally include at least one token expected to violate the seeded negated predicate for that family.
