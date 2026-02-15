# Lessons

## 2026-02-15

- When implementing mapping-gated reads, verify server log behavior under repeated page loads and dedupe repeated warnings by stable metadata keys (`arrType`, config name, skipped set), not only by message text.
- When creating GitHub tracking issues for major work, include full execution detail (scope, workstreams, acceptance criteria, risks, migration plan) and explicit priority labeling rather than relying on a short summary.
- When introducing first-class Arr schema tables, validate app-specific field parity before mirroring sibling schemas, and keep `docs/pcdReference/0.schema.sql` and migration SQL column contracts identical.
- For all enhancements, features, and bug fixes touching Arr apps, validate per-app semantics (`arr_type`) explicitly and never treat Sonarr/Radarr/Lidarr data models as interchangeable by API shape alone.
- When seeding built-in `pcd_ops` via migrations, also provide runtime seeding for newly linked `database_instances`; migration-time inserts alone do not cover future links.
