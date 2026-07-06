---
title: regular_expressions
description: Regex patterns used in custom format pattern conditions.
---

## Purpose

Stores named regex patterns used in pattern-type custom format conditions. The optional `regex101_id` links to regex101.com for interactive testing; `description` documents the pattern purpose.

## Columns

| Column        | Type         | Nullable | Default           | Description                               |
| ------------- | ------------ | -------- | ----------------- | ----------------------------------------- |
| `id`          | INTEGER      | Yes      | —                 | —                                         |
| `name`        | VARCHAR(100) | No       | —                 | —                                         |
| `pattern`     | TEXT         | No       | —                 | —                                         |
| `regex101_id` | VARCHAR(50)  | Yes      | —                 | Optional link to regex101.com for testing |
| `description` | TEXT         | Yes      | —                 | —                                         |
| `created_at`  | TEXT         | No       | CURRENT_TIMESTAMP | —                                         |
| `updated_at`  | TEXT         | No       | CURRENT_TIMESTAMP | —                                         |

## Relationships

**Referenced by:**

- [condition_patterns](/schema/tables/condition_patterns/)
- [regular_expression_tags](/schema/tables/regular_expression_tags/)

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE (name)

## Related

- [condition_patterns](/schema/tables/condition_patterns/)
- [regular_expression_tags](/schema/tables/regular_expression_tags/)
