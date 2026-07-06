---
title: custom_formats
description: Pattern and condition definitions for media matching.
---

## Purpose

Custom formats define patterns and conditions for media matching. Each format has a `name`, optional `description`, and an `include_in_rename` flag controlling whether the format name appears in renamed filenames.

## Columns

| Column              | Type         | Nullable | Default           | Description |
| ------------------- | ------------ | -------- | ----------------- | ----------- |
| `id`                | INTEGER      | Yes      | —                 | —           |
| `name`              | VARCHAR(100) | No       | —                 | —           |
| `description`       | TEXT         | Yes      | —                 | —           |
| `include_in_rename` | INTEGER      | No       | 0                 | —           |
| `created_at`        | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`        | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**Referenced by:**

- [custom_format_conditions](/schema/tables/custom_format_conditions/)
- [custom_format_tags](/schema/tables/custom_format_tags/)
- [quality_profile_custom_formats](/schema/tables/quality_profile_custom_formats/)
- [custom_format_tests](/schema/tables/custom_format_tests/)

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE (name)

## Related

- [custom_format_conditions](/schema/tables/custom_format_conditions/)
- [custom_format_tags](/schema/tables/custom_format_tags/)
- [quality_profile_custom_formats](/schema/tables/quality_profile_custom_formats/)
- [custom_format_tests](/schema/tables/custom_format_tests/)
