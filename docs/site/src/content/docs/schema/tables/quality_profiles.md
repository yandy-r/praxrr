---
title: quality_profiles
description: Complete media acquisition strategy definitions.
---

## Purpose

Quality profiles define complete media acquisition strategies including upgrade limits, minimum custom format scores, and upgrade-until thresholds. The profile `name` is the stable FK target for all profile-scoped junction tables.

## Columns

| Column                        | Type         | Nullable | Default           | Description |
| ----------------------------- | ------------ | -------- | ----------------- | ----------- |
| `id`                          | INTEGER      | Yes      | —                 | —           |
| `name`                        | VARCHAR(100) | No       | —                 | —           |
| `description`                 | TEXT         | Yes      | —                 | —           |
| `upgrades_allowed`            | INTEGER      | No       | 1                 | —           |
| `minimum_custom_format_score` | INTEGER      | No       | 0                 | —           |
| `upgrade_until_score`         | INTEGER      | No       | 0                 | —           |
| `upgrade_score_increment`     | INTEGER      | No       | 1                 | —           |
| `created_at`                  | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`                  | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**Referenced by:**

- [quality_groups](/schema/tables/quality_groups/)
- [quality_profile_tags](/schema/tables/quality_profile_tags/)
- [quality_profile_languages](/schema/tables/quality_profile_languages/)
- [quality_group_members](/schema/tables/quality_group_members/)
- [quality_profile_qualities](/schema/tables/quality_profile_qualities/)
- [quality_profile_custom_formats](/schema/tables/quality_profile_custom_formats/)

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE (name)
- **CHECK:** upgrade_score_increment: CHECK (upgrade_score_increment > 0)

## Related

- [quality_groups](/schema/tables/quality_groups/)
- [quality_profile_tags](/schema/tables/quality_profile_tags/)
- [quality_profile_languages](/schema/tables/quality_profile_languages/)
- [quality_profile_qualities](/schema/tables/quality_profile_qualities/)
- [quality_profile_custom_formats](/schema/tables/quality_profile_custom_formats/)
