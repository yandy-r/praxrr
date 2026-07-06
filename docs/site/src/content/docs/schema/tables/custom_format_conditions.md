---
title: custom_format_conditions
description: Matching-condition rows that define custom format logic.
---

## Purpose

The parent table for the type-dispatched condition system. Each row defines a condition belonging to a custom format and dispatches to exactly one of nine child tables based on the `type` column. The `arr_type` column scopes conditions to a specific arr application or to all (`all`).

## Columns

| Column               | Type         | Nullable | Default           | Description               |
| -------------------- | ------------ | -------- | ----------------- | ------------------------- |
| `id`                 | INTEGER      | Yes      | —                 | —                         |
| `custom_format_name` | VARCHAR(100) | No       | —                 | —                         |
| `name`               | VARCHAR(100) | No       | —                 | —                         |
| `type`               | VARCHAR(50)  | No       | —                 | —                         |
| `arr_type`           | VARCHAR(20)  | No       | 'all'             | 'radarr', 'sonarr', 'all' |
| `negate`             | INTEGER      | No       | 0                 | —                         |
| `required`           | INTEGER      | No       | 0                 | —                         |
| `created_at`         | TEXT         | No       | CURRENT_TIMESTAMP | —                         |
| `updated_at`         | TEXT         | No       | CURRENT_TIMESTAMP | —                         |

## Relationships

**References:**

- [custom_formats](/schema/tables/custom_formats/) — custom_formats (custom_format_name)

**Referenced by:**

- [condition_patterns](/schema/tables/condition_patterns/)
- [condition_languages](/schema/tables/condition_languages/)
- [condition_indexer_flags](/schema/tables/condition_indexer_flags/)
- [condition_sources](/schema/tables/condition_sources/)
- [condition_resolutions](/schema/tables/condition_resolutions/)
- [condition_quality_modifiers](/schema/tables/condition_quality_modifiers/)
- [condition_sizes](/schema/tables/condition_sizes/)
- [condition_release_types](/schema/tables/condition_release_types/)
- [condition_years](/schema/tables/condition_years/)

- FOREIGN KEY (custom_format_name) REFERENCES custom_formats(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE(custom_format_name, name)
- **Arr-type note:** `arr_type` accepts `radarr`, `sonarr`, or `all`. Lidarr-specific conditions use the same column when applicable; validate per arr type rather than assuming cross-arr parity.

## Related

- [custom_formats](/schema/tables/custom_formats/)
- [condition_patterns](/schema/tables/condition_patterns/)
- [condition_languages](/schema/tables/condition_languages/)
- [condition_indexer_flags](/schema/tables/condition_indexer_flags/)
- [condition_sources](/schema/tables/condition_sources/)
- [condition_resolutions](/schema/tables/condition_resolutions/)
- [condition_quality_modifiers](/schema/tables/condition_quality_modifiers/)
- [condition_sizes](/schema/tables/condition_sizes/)
- [condition_release_types](/schema/tables/condition_release_types/)
- [condition_years](/schema/tables/condition_years/)
