---
title: Database Changelog
description: Notable changes to curated PCD entities sourced from repository history.
---

Highlights from `packages/praxrr-db/entities/` git history. Package version **0.1.0**
(`pcd.json`).

## 2026

### Prefer Usenet split by Arr app

Per-Arr delay profiles replace a single shared profile:

- Prefer Usenet (Radarr)
- Prefer Usenet (Sonarr)
- Prefer Usenet (Lidarr)

Usenet delay tuned to 20 minutes on all three.

### Lidarr quality expansion

Expanded Lidarr quality size limits and added Q10 quality mapping.

### SQL-to-YAML cutover (#104)

`entities/` became the canonical YAML source. Legacy SQL fixtures in `ops/` used for bootstrap
ingestion were removed; repository seed data is YAML-only. Includes Lidarr YAML entity cutover and
local dev override support.

### Phase-2 PCD data migration (#100)

Completed phase-2 rollout of portable PCD entity migration across the database package.

## Earlier

### Media naming updates

Updated default naming formats for media files across Arr types.

---

For mirror publication workflow see the [Mirror README](/database/readme/). Report data issues on
[GitHub](https://github.com/yandy-r/praxrr-db/issues).
