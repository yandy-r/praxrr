# Lessons

## 2026-02-22

- When creating GitHub issue research references, always use markdown file-path links
  (`[docs/...](https://github.com/.../blob/<branch>/docs/...)`) instead of bare URLs so links are
  consistently clickable in issue bodies.

## 2026-02-15

- When implementing mapping-gated reads, verify server log behavior under repeated page loads and
  dedupe repeated warnings by stable metadata keys (`arrType`, config name, skipped set), not only
  by message text.
- When creating GitHub tracking issues for major work, include full execution detail (scope,
  workstreams, acceptance criteria, risks, migration plan) and explicit priority labeling rather
  than relying on a short summary.
- When introducing first-class Arr schema tables, validate app-specific field parity before
  mirroring sibling schemas, and keep `docs/pcdReference/0.schema.sql` and migration SQL column
  contracts identical.
- For all enhancements, features, and bug fixes touching Arr apps, validate per-app semantics
  (`arr_type`) explicitly and never treat Sonarr/Radarr/Lidarr data models as interchangeable by API
  shape alone.
- When seeding built-in `pcd_ops` via migrations, also provide runtime seeding for newly linked
  `database_instances`; migration-time inserts alone do not cover future links.
- Keep OpenAPI portable schema definitions aligned with runtime import validation and persistence
  behavior; do not publish Lidarr field names that runtime rejects, and never trim persisted
  identifier fields that must be exact-match lookup keys.
- When introducing transitional shared-table contracts (for example Sonarr-backed Lidarr naming),
  define table-name constants once in a shared module and reuse them across
  `read/create/update/delete` to prevent silent divergence between operation files.
- After cutting over an Arr entity family to first-class tables, verify `create/read/update/delete`
  plus portable `import/export/clone` dispatch all resolve to the same Arr-specific storage; partial
  cutovers cause silent not-found and orphaned records across UI/API flows.
- When first-class Lidarr cutover is declared, remove legacy Sonarr alias fallback in route
  resolution and mapping seeds immediately; keeping alias paths active after cutover can silently
  route users to non-native configs and preserve TV-derived quality mappings.
- When adding a built-in PCD base-op migration, register it in
  `packages/praxrr-app/src/lib/server/pcd/ops/seedBuiltInBaseOps.ts`; migration runner coverage
  alone is insufficient for newly initialized instances after `clean:dev`.
- For first-class Arr cutovers with user-visible defaults, update both runtime form defaults and
  migration/backfill ops together; fixing only one layer leaves edit pages showing legacy
  sibling-app templates.
- For PR automation, always write PR bodies to a temp file and use `gh pr create/edit --body-file`;
  if `gh pr edit` fails with GraphQL `projectCards` deprecation, update PR body with
  `gh api -X PATCH repos/<owner>/<repo>/pulls/<number> -f body=...` instead of retrying the same
  failing command.
- For Arr-scoped quality profile UI filtering, do not rely on
  `quality_profile_custom_formats.arr_type` alone because legacy or shared `arr_type='all'` scores
  can make incompatible profiles appear valid; enforce app compatibility from enabled quality names
  mapped via `quality_api_mappings` for the target `arr_type`.
- For Arr-scoped quality profile compatibility, do not require `enabled=1` quality rows; profiles
  with all qualities disabled (or transitional defaults) must still be considered against
  app-compatible quality names, otherwise valid profiles can disappear from sync selection UI.

## 2026-02-23

- When editing a file interactively, always use `apply_patch` (not `exec_command`) unless the task
  explicitly requires another tool; treat the warning to switch tools as the correction cue.

## 2026-02-24

- For monorepo mirror workflows, always provide a local-path development override for both the
  primary PCD source and schema dependency before asking for mirror-merge validation; otherwise
  feature testing is blocked on publish/merge order.

## 2026-03-01

- For local-path PCD sources, never assume `database.local_path` is a Git repo. Any git-backed endpoint must detect/handle non-git local paths without returning 500.
- In `importBaseOps`, refresh `last_seen_in_repo_at` for matched published repo base ops before cache/entity-exists skips; reversing this order can orphan all repo base ops and make PCD data appear missing across sync/config UIs.
