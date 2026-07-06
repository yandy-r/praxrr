---
title: Getting Started
description: Install Praxrr, run your first sync, and find task-oriented guides.
---

Praxrr v2 is under active development. Use these pages to install the app, link a
configuration database, connect Arr instances, and sync quality profiles.

## Install and Run

- [Installation](./installation/) — Docker, binary, and from-source setup
- [Quick Start](./quick-start/) — link a PCD, bridge Arr, and sync end-to-end
- [Docker](./docker/) — compose files, volumes, networking, parser opt-in

## Guides

- [Configuration](../guides/configuration/) — environment variables and auth modes
- [Connecting Arr Instances](../guides/connecting-arr-instances/) — URLs, API keys,
  external links
- [Syncing Profiles](../guides/syncing-profiles/) — preview, triggers, user ops
- [Custom Formats](../guides/custom-formats/) — formats and shared regex entities
- [Quality Profiles](../guides/quality-profiles/) — qualities and scoring
- [Upgrading](../guides/upgrading/) — release channels and migrations
- [Troubleshooting](../guides/troubleshooting/) — common errors

## Contributor Docs

- [Application architecture](/app/architecture/) — runtime modules and sync pipeline
- [Development setup](/app/development/) — Deno tasks, env vars, and local workflows
- [Testing guide](/app/testing/) — unit test aliases and e2e prerequisites
- [Startup sequence](/app/startup/) — server initialization order
- [PCD schema structure](/schema/structure/) — portable database contracts
- [API reference](/api/) — `/api/v1` OpenAPI endpoints

## Build the Docs Site

From the repository root:

```bash
deno task docs:build
```

The build imports schema and database mirror docs, renders Starlight pages,
generates the OpenAPI reference, and emits static output to `docs/site/dist`.
