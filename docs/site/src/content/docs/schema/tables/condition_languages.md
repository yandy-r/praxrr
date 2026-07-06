---
title: condition_languages
description: Language-based custom format conditions.
---

## Purpose

Matches based on release language metadata. The `except_language` flag inverts the match to any language except the specified one. Parent `type` must be `language`.

## Columns

| Column               | Type         | Nullable | Default | Description                           |
| -------------------- | ------------ | -------- | ------- | ------------------------------------- |
| `custom_format_name` | VARCHAR(100) | No       | —       | —                                     |
| `condition_name`     | VARCHAR(100) | No       | —       | —                                     |
| `language_name`      | VARCHAR(30)  | No       | —       | —                                     |
| `except_language`    | INTEGER      | No       | 0       | Match everything EXCEPT this language |

## Relationships

**References:**

- [custom_format_conditions](/schema/tables/custom_format_conditions/) — custom_format_conditions (custom_format_name, condition_name)
- [languages](/schema/tables/languages/) — languages (language_name)

- FOREIGN KEY (custom_format_name, condition_name) REFERENCES custom_format_conditions(custom_format_name, name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (language_name) REFERENCES languages(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (custom_format_name, condition_name)

## Related

- [custom_format_conditions](/schema/tables/custom_format_conditions/)
- [languages](/schema/tables/languages/)
