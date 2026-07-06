---
title: tags
description: Reusable labels applied to multiple entity types.
---

## Purpose

Tags are reusable labels that can be applied to regular expressions, custom formats, and quality profiles through dedicated junction tables. The `name` column is the stable identifier used as a foreign key target.

## Columns

| Column       | Type        | Nullable | Default           | Description |
| ------------ | ----------- | -------- | ----------------- | ----------- |
| `id`         | INTEGER     | Yes      | —                 | —           |
| `name`       | VARCHAR(50) | No       | —                 | —           |
| `created_at` | TEXT        | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**Referenced by:**

- [regular_expression_tags](/schema/tables/regular_expression_tags/)
- [custom_format_tags](/schema/tables/custom_format_tags/)
- [quality_profile_tags](/schema/tables/quality_profile_tags/)

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE (name)

## Related

- [regular_expression_tags](/schema/tables/regular_expression_tags/)
- [custom_format_tags](/schema/tables/custom_format_tags/)
- [quality_profile_tags](/schema/tables/quality_profile_tags/)
