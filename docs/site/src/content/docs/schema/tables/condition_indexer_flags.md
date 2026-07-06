---
title: condition_indexer_flags
description: Indexer flag custom format conditions.
---

## Purpose

Matches based on indexer flags such as Scene or Freeleech. Parent `type` must be `indexer_flag`.

## Columns

| Column               | Type         | Nullable | Default | Description |
| -------------------- | ------------ | -------- | ------- | ----------- |
| `custom_format_name` | VARCHAR(100) | No       | —       | —           |
| `condition_name`     | VARCHAR(100) | No       | —       | —           |
| `flag`               | VARCHAR(100) | No       | —       | —           |

## Relationships

**References:**

- [custom_format_conditions](/schema/tables/custom_format_conditions/) — custom_format_conditions (custom_format_name, condition_name)

- FOREIGN KEY (custom_format_name, condition_name) REFERENCES custom_format_conditions(custom_format_name, name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (custom_format_name, condition_name)

## Related

- [custom_format_conditions](/schema/tables/custom_format_conditions/)
