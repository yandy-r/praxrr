---
title: custom_format_tags
description: Junction table linking custom formats to tags.
---

## Purpose

Links custom formats to tags using stable name-based composite keys.

## Columns

| Column               | Type         | Nullable | Default | Description |
| -------------------- | ------------ | -------- | ------- | ----------- |
| `custom_format_name` | VARCHAR(100) | No       | —       | —           |
| `tag_name`           | VARCHAR(50)  | No       | —       | —           |

## Relationships

**References:**

- [custom_formats](/schema/tables/custom_formats/) — custom_formats (custom_format_name)
- [tags](/schema/tables/tags/) — tags (tag_name)

- FOREIGN KEY (custom_format_name) REFERENCES custom_formats(name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (tag_name) REFERENCES tags(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (custom_format_name, tag_name)

## Related

- [custom_formats](/schema/tables/custom_formats/)
- [tags](/schema/tables/tags/)
