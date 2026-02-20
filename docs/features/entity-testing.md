# Entity Testing

## Overview

Entity Testing lets you simulate real releases against your custom formats and quality profile
scores before syncing to Arr.

Primary UI route:

- `/quality-profiles/entity-testing`

Evaluation API:

- `POST /api/v1/entity-testing/evaluate`

## User workflow

## 1) Pick a database

- Praxrr redirects to your last selected database at `/quality-profiles/entity-testing/{databaseId}`.
- If no databases are linked, you must link one first.

## 2) Add test entities

- Add movies or series from TMDB in the Entity Testing UI.
- Entities are stored as PCD operations (`test_entities`) so they remain auditable.
- Read-only databases block write actions.

## 3) Add or import test releases

- Add manual release titles, or import release candidates from Arr-backed lookup flows.
- Releases are stored in `test_releases` and grouped under the entity.

## 4) Evaluate releases

- Expanding an entity lazily calls `POST /api/v1/entity-testing/evaluate`.
- Parsing runs in batch and returns parsed metadata plus `cfMatches`.
- If `databaseId` is provided, matches are evaluated against all custom formats in that database.

## 5) Score against a quality profile

- Select a quality profile in the UI.
- Praxrr totals scores only for matched custom formats and the correct Arr target:
  - `movie` entities use Radarr-scoped scores.
  - `series` entities use Sonarr-scoped scores.

## Practical API examples

```bash
# Parse + evaluate with custom format matching
curl -sS -X POST "http://localhost:6868/api/v1/entity-testing/evaluate" \
  -H "Content-Type: application/json" \
  -d '{
    "databaseId": 1,
    "releases": [
      { "id": 1001, "title": "Movie.Title.2024.2160p.WEB-DL.DDP5.1.H.265-GROUP", "type": "movie" },
      { "id": 1002, "title": "Series.Name.S02E03.1080p.WEB.H264-GROUP", "type": "series" }
    ]
  }'

# Parse only (omit databaseId)
curl -sS -X POST "http://localhost:6868/api/v1/entity-testing/evaluate" \
  -H "Content-Type: application/json" \
  -d '{
    "releases": [
      { "id": 2001, "title": "Movie.Title.2024.1080p.BluRay.x264-GROUP", "type": "movie" }
    ]
  }'
```

## Troubleshooting

- `Parser service unavailable. Release scoring disabled.`:
  Parser health check failed; parsing and CF matching are unavailable until parser service is up.
- `TMDB API key not configured`:
  Configure TMDB in `/settings/general` before adding entities from search.
- `Entity tests are read-only for this database`:
  You can view but cannot add/edit/delete entities or releases in that database context.
- `Missing or empty releases array`:
  Your evaluate payload must include at least one release entry.
- Score appears lower than expected:
  Verify selected profile and Arr-specific score mapping (`movie` vs `series`) for matched custom formats.

## Related docs

- [Feature guides index](./README.md)
- [Link, Bridge, Sync](./link-bridge-sync.md)
- [Portable Import/Export](./portable-import-export.md)
- [OpenAPI paths: Entity Testing](../api/v1/paths/entity-testing.yaml)
