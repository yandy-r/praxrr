---
title: regular_expression_tags
description: Junction table linking regular expressions to tags.
---

## Purpose

Links regular expressions to tags using stable name-based composite keys. Part of the tag junction pattern shared with `custom_format_tags` and `quality_profile_tags`.

## Columns

| Column                    | Type         | Nullable | Default | Description |
| ------------------------- | ------------ | -------- | ------- | ----------- |
| `regular_expression_name` | VARCHAR(100) | No       | —       | —           |
| `tag_name`                | VARCHAR(50)  | No       | —       | —           |

## Relationships

**References:**

- [regular_expressions](/schema/tables/regular_expressions/) — regular_expressions (regular_expression_name)
- [tags](/schema/tables/tags/) — tags (tag_name)

- FOREIGN KEY (regular_expression_name) REFERENCES regular_expressions(name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (tag_name) REFERENCES tags(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (regular_expression_name, tag_name)

## Related

- [regular_expressions](/schema/tables/regular_expressions/)
- [tags](/schema/tables/tags/)
