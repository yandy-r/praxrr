# API Documentation

This directory documents the Praxrr HTTP API currently exposed under `/api/v1`.

Source of truth:

- Contract: `docs/api/v1/openapi.yaml`
- Runtime behavior: `packages/praxrr-app/src/routes/api/v1/**`

## Base URL

- Relative: `/api/v1`
- Example local URL: `http://localhost:5173/api/v1`

## Quick start

Health endpoint (public):

```bash
curl -sS http://localhost:5173/api/v1/health | jq
```

Authenticated endpoint (API key example):

```bash
curl -sS \
  -H 'X-Api-Key: <your-api-key>' \
  'http://localhost:5173/api/v1/arr/library?instanceId=1&page=1&pageSize=50' | jq
```

## Docs map

- Endpoint reference: `docs/api/endpoints.md`
- Authentication and access modes: `docs/api/authentication.md`
- Error semantics and status codes: `docs/api/errors.md`
- OpenAPI JSON endpoint: `GET /api/v1/openapi.json`
- OpenAPI YAML file: `docs/api/v1/openapi.yaml`

## Scope notes

- These docs cover versioned API endpoints under `/api/v1`, including shared endpoints and arr app routes (Radarr, Sonarr, Lidarr).
- Additional `/api/*` routes outside `/api/v1` exist in the codebase and are primarily app-internal utilities, not part of the versioned API contract.
