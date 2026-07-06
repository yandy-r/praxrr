---
title: condition_patterns
description: Pattern-based custom format conditions (regex matching).
---

## Purpose

Pattern-based conditions match release titles, release groups, or editions using a regular expression. Each pattern condition references exactly one row in `regular_expressions`. Parent `type` must be `pattern`.

## Columns

| Column                    | Type         | Nullable | Default | Description |
| ------------------------- | ------------ | -------- | ------- | ----------- |
| `custom_format_name`      | VARCHAR(100) | No       | —       | —           |
| `condition_name`          | VARCHAR(100) | No       | —       | —           |
| `regular_expression_name` | VARCHAR(100) | No       | —       | —           |

## Relationships

**References:**

- [custom_format_conditions](/schema/tables/custom_format_conditions/) — custom_format_conditions (custom_format_name, condition_name)
- [regular_expressions](/schema/tables/regular_expressions/) — regular_expressions (regular_expression_name)

- FOREIGN KEY (custom_format_name, condition_name) REFERENCES custom_format_conditions(custom_format_name, name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (regular_expression_name) REFERENCES regular_expressions(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (custom_format_name, condition_name)

## Related

- [custom_format_conditions](/schema/tables/custom_format_conditions/)
- [regular_expressions](/schema/tables/regular_expressions/)
