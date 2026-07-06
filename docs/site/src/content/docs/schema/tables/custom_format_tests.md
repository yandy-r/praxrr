---
title: custom_format_tests
description: Test cases for custom format matching logic.
---

## Purpose

Each test belongs to a custom format and specifies whether a release title should match. The `type` column (`movie` or `series`) sets parser context; `should_match` declares the expected result.

## Columns

| Column               | Type         | Nullable | Default           | Description                              |
| -------------------- | ------------ | -------- | ----------------- | ---------------------------------------- |
| `id`                 | INTEGER      | Yes      | —                 | —                                        |
| `custom_format_name` | VARCHAR(100) | No       | —                 | —                                        |
| `title`              | TEXT         | No       | —                 | Release title to test against            |
| `type`               | VARCHAR(20)  | No       | —                 | 'movie' or 'series'                      |
| `should_match`       | INTEGER      | No       | —                 | 1 = should match, 0 = should not match   |
| `description`        | TEXT         | Yes      | —                 | Why this test exists / edge case covered |
| `created_at`         | TEXT         | No       | CURRENT_TIMESTAMP | —                                        |

## Relationships

**References:**

- [custom_formats](/schema/tables/custom_formats/) — custom_formats (custom_format_name)

- FOREIGN KEY (custom_format_name) REFERENCES custom_formats(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE(custom_format_name, title, type)
- UNIQUE on `(custom_format_name, title, type)`.

## Related

- [custom_formats](/schema/tables/custom_formats/)
