---
title: Migration Paths
description: How the PCD schema evolves through OSQL operations, layers, and value guards.
---

PCD schema changes do not use traditional database migrations. Instead, the schema and data evolve
through **Operational SQL (OSQL)** — an append-only, ordered, replayable sequence of SQL
operations. See [Structure](/schema/structure/) for the full architecture reference.

## Operational SQL (OSQL)

**OSQL** stores the complete history of operations that produce database state. History is immutable,
but results are mutable because new operations can always be appended to override earlier effects.

### Four properties

1. **Append-only** — operations are never edited or deleted; changes append new operations.
2. **Ordered** — file names encode order (`0.schema.sql`, `1.languages.sql`, …); statements run
   top-to-bottom within each file.
3. **Replayable** — replaying all operations against a fresh SQLite file produces a deterministic
   result.
4. **Relational** — foreign keys, CHECK constraints, and UNIQUE constraints are enforced during
   replay; invalid operations fail loudly.

### Operation types

| Operation      | Purpose                           | Example                                     |
| -------------- | --------------------------------- | ------------------------------------------- |
| `CREATE TABLE` | Define schema structure           | Used in the Schema layer (`0.schema.sql`)   |
| `INSERT`       | Add new data                      | Quality profiles, languages, custom formats |
| `UPDATE`       | Override a previous value         | Changing a score or toggling a flag         |
| `DELETE`       | Remove data from a previous layer | Removing a quality from a profile           |

Updates never edit the original INSERT — they append an UPDATE that changes the resulting state.

## Layers

PCDs run in five layers. Later layers override earlier ones:

| Layer | Name         | Content                                             |
| ----- | ------------ | --------------------------------------------------- |
| 1     | Schema       | DDL only (`0.schema.sql`); seed languages/qualities |
| 2     | Dependencies | Reserved for future PCD composition                 |
| 3     | Base         | Shipped profiles, formats, scores, arr configs      |
| 4     | Tweaks       | Optional behavioral adjustments                     |
| 5     | User Ops     | Per-instance user customizations                    |

The Schema layer (`praxrr-schema`) defines all 42 tables in [`0.schema.sql`](/schema/tables/). It
contains no content-level data such as quality profiles or custom formats.

## Base vs user layers

- **Base ops** — published canonical state from the PCD repository; synced to arr instances.
- **User ops** — local overrides that persist across syncs; stored separately and replayed after
  base ops.

Praxrr replays base ops then user ops into an in-memory SQLite cache on each compile. User changes
do not mutate base ops directly.

## Value guards

Updates and deletes use **value guards** (old-value checks) to detect upstream changes. When an
UPDATE or DELETE affects zero rows during recompose, the tool flags a potential conflict — the
expected prior state may have changed in an upstream PCD.

This protects against silent data corruption when base ops change underneath local overrides.

## Name-based foreign keys

All foreign keys reference UNIQUE `name` columns rather than autoincrement `id` columns. This is
essential because PCDs rebuild from scratch on every recompose — autoincrement IDs are not stable
across rebuilds.

See [Structure §8](/schema/structure/#8-key-design-decisions) for examples of why ID-based FKs fail
and how `ON DELETE CASCADE ON UPDATE CASCADE` propagates name changes.

## Schema version evolution

When the schema itself changes (new tables, new columns, new constraints):

1. Changes land in `packages/praxrr-schema/ops/0.schema.sql` (DDL authority).
2. Built-in base-op migrations may backfill existing PCDs.
3. Newly initialized databases receive migrations through the seed pipeline.

The current schema defines **42 tables** (see [Tables index](/schema/tables/)). The table count has
grown beyond the original 36 as Lidarr support and metadata profiles were added — each addition is
reflected in the DDL, not as a separate migration file.

## Related

- [Structure](/schema/structure/) — full OSQL, CDD, and layer documentation
- [Tables index](/schema/tables/) — per-table DDL reference for all 42 tables
- [Condition Types](/schema/condition-types/) — condition dispatch system
