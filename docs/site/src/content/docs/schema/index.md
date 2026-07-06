---
title: PCD Schema
description: Entry point for portable configuration database schema documentation.
---

The Praxrr Config Database schema defines the portable data contract used by published base ops and
local user overrides. Schema documentation is imported from the `praxrr-schema` mirror during docs
builds and from `packages/praxrr-schema` in the monorepo checkout.

## Imported References

- [Structure](/schema/structure/) describes the schema layout and operation model.
- [Manifest](/schema/manifest/) describes package metadata used by PCD repositories.

## Per-Table Reference

- [Tables index](/schema/tables/) — all 42 schema tables categorized by domain
- [Condition Types](/schema/condition-types/) — the nine condition types and dispatch model
- [Migration Paths](/schema/migrations/) — OSQL, layers, and value guards
