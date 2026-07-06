---
title: condition_resolutions
description: Resolution custom format conditions.
---

## Purpose

Matches based on video resolution (for example 1080p, 2160p). Parent `type` must be `resolution`.

## Columns

| Column               | Type         | Nullable | Default | Description |
| -------------------- | ------------ | -------- | ------- | ----------- |
| `custom_format_name` | VARCHAR(100) | No       | —       | —           |
| `condition_name`     | VARCHAR(100) | No       | —       | —           |
| `resolution`         | VARCHAR(100) | No       | —       | —           |

## Relationships

**References:**

- [custom_format_conditions](/schema/tables/custom_format_conditions/) — custom_format_conditions (custom_format_name, condition_name)

- FOREIGN KEY (custom_format_name, condition_name) REFERENCES custom_format_conditions(custom_format_name, name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (custom_format_name, condition_name)

## Related

- [custom_format_conditions](/schema/tables/custom_format_conditions/)
