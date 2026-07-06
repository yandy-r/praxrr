---
title: quality_profile_custom_formats
description: Assigns custom format scores to quality profiles.
---

## Purpose

Assigns custom format scores to quality profiles. Scores determine upgrade priority and filtering behavior. The `arr_type` column allows different scores for the same format in different arr applications.

## Columns

| Column                 | Type         | Nullable | Default | Description               |
| ---------------------- | ------------ | -------- | ------- | ------------------------- |
| `quality_profile_name` | VARCHAR(100) | No       | —       | —                         |
| `custom_format_name`   | VARCHAR(100) | No       | —       | —                         |
| `arr_type`             | VARCHAR(20)  | No       | —       | 'radarr', 'sonarr', 'all' |
| `score`                | INTEGER      | No       | —       | —                         |

## Relationships

**References:**

- [quality_profiles](/schema/tables/quality_profiles/) — quality_profiles (quality_profile_name)
- [custom_formats](/schema/tables/custom_formats/) — custom_formats (custom_format_name)

- FOREIGN KEY (quality_profile_name) REFERENCES quality_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (custom_format_name) REFERENCES custom_formats(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (quality_profile_name, custom_format_name, arr_type)
- **Arr-type note:** `arr_type` is `radarr`, `sonarr`, or `all`. Scores can differ per arr within the same profile; do not assume identical scoring across arr types.

## Related

- [quality_profiles](/schema/tables/quality_profiles/)
- [custom_formats](/schema/tables/custom_formats/)
