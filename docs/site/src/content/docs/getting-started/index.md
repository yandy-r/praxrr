---
title: Getting Started
description: First steps for running Praxrr and finding the right documentation section.
---

Praxrr v2 is under active development. Use this page as the entry point for local development and
early setup flows while fuller user guides are written in follow-up documentation issues.

## Run the App Locally

From the repository root:

```bash
deno task dev:noauth
```

The development server starts the SvelteKit app on port `6969` with authentication disabled. Use
`deno task dev` when you also want the parser service started by the development launcher.

## Build the Docs Site

From the repository root:

```bash
deno task docs:build
```

The docs build imports available schema and database mirror documentation, renders Starlight pages,
generates the OpenAPI reference, and emits the static site to `docs/site/dist`.

## Where to Go Next

- Read the [application architecture](/app/architecture/) before changing runtime behavior.
- Read the [PCD schema structure](/schema/structure/) before changing portable database contracts.
- Read the [API reference](/api/) before adding or consuming `/api/v1` endpoints.
