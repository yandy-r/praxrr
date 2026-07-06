---
title: condition_years
description: Release year range custom format conditions.
---

## Purpose

Matches based on release year. Either `min_year` or `max_year` may be NULL for open-ended ranges. Parent `type` must be `year`.

## Columns

| Column               | Type         | Nullable | Default | Description           |
| -------------------- | ------------ | -------- | ------- | --------------------- |
| `custom_format_name` | VARCHAR(100) | No       | —       | —                     |
| `condition_name`     | VARCHAR(100) | No       | —       | —                     |
| `min_year`           | INTEGER      | Yes      | —       | Null means no minimum |
| `max_year`           | INTEGER      | Yes      | —       | Null means no maximum |

## Relationships

**References:**

- [custom_format_conditions](/schema/tables/custom_format_conditions/) — custom_format_conditions (custom_format_name, condition_name)

- FOREIGN KEY (custom_format_name, condition_name) REFERENCES custom_format_conditions(custom_format_name, name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (custom_format_name, condition_name)

## Related

- [custom_format_conditions](/schema/tables/custom_format_conditions/)
