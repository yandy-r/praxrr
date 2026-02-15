# Lessons

## 2026-02-15

- When implementing mapping-gated reads, verify server log behavior under repeated page loads and dedupe repeated warnings by stable metadata keys (`arrType`, config name, skipped set), not only by message text.
- When creating GitHub tracking issues for major work, include full execution detail (scope, workstreams, acceptance criteria, risks, migration plan) and explicit priority labeling rather than relying on a short summary.
- When introducing first-class Arr schema tables, validate app-specific field parity before mirroring sibling schemas, and keep `docs/pcdReference/0.schema.sql` and migration SQL column contracts identical.
- For all enhancements, features, and bug fixes touching Arr apps, validate per-app semantics (`arr_type`) explicitly and never treat Sonarr/Radarr/Lidarr data models as interchangeable by API shape alone.
- When seeding built-in `pcd_ops` via migrations, also provide runtime seeding for newly linked `database_instances`; migration-time inserts alone do not cover future links.
- Keep OpenAPI portable schema definitions aligned with runtime import validation and persistence behavior; do not publish Lidarr field names that runtime rejects, and never trim persisted identifier fields that must be exact-match lookup keys.
- When introducing transitional shared-table contracts (for example Sonarr-backed Lidarr naming), define table-name constants once in a shared module and reuse them across `read/create/update/delete` to prevent silent divergence between operation files.
- After cutting over an Arr entity family to first-class tables, verify `create/read/update/delete` plus portable `import/export/clone` dispatch all resolve to the same Arr-specific storage; partial cutovers cause silent not-found and orphaned records across UI/API flows.
- For PR automation, always write PR bodies to a temp file and use `gh pr create/edit --body-file`; if `gh pr edit` fails with GraphQL `projectCards` deprecation, update PR body with `gh api -X PATCH repos/<owner>/<repo>/pulls/<number> -f body=...` instead of retrying the same failing command.
