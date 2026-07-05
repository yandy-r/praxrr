---
title: Architecture Overview
description: High-level map of the Praxrr runtime, PCD cache, and sync pipeline.
---

Praxrr is a Deno and SvelteKit application that manages configuration state for Radarr, Sonarr, and
Lidarr instances. The runtime app owns local state, compiles portable configuration database content,
and dispatches sync jobs to Arr APIs.

## Runtime Shape

- **SvelteKit app:** Serves the UI and `/api/v1` endpoints from `packages/praxrr-app`.
- **App database:** Stores local settings, instances, jobs, snapshots, and user preferences in
  SQLite through Kysely migrations.
- **PCD cache:** Replays append-only base and user ops into an in-memory SQLite cache for validated
  reads and writes.
- **Sync pipeline:** Resolves compiled PCD state into explicit Arr-type-specific API operations.
- **Parser service:** Provides release title parsing for custom format and profile testing when the
  optional .NET service is running.

## Startup Sequence

The app initializes configuration, opens the SQLite database, runs migrations, loads logging
settings, compiles the PCD cache, starts job dispatch, and then applies authentication middleware.

## Contract Boundaries

OpenAPI schemas, runtime validators, and portable entity handlers must stay in lockstep. Arr
semantics are validated per target app; shared payload shapes do not imply shared domain behavior.

## Source References

- App runtime: `packages/praxrr-app/src`
- PCD implementation: `packages/praxrr-app/src/lib/server/pcd`
- Sync implementation: `packages/praxrr-app/src/lib/server/sync`
- API spec: `docs/api/v1/openapi.yaml`
