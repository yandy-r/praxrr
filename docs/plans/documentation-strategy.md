# Documentation Strategy

## Run Metadata

- Date: 2026-02-22
- Scope: entire codebase documentation
- Mode: update
- Source audit: `/home/yandy/.config/dotfiles/.codex/skills/write-docs/scripts/audit-documentation.sh`

## Audit Summary

- The main user-facing docs now span:
  - `README.md`
  - `docs/README.md`
  - `docs/ARCHITECTURE.md`
  - `docs/architecture/*.md`
  - `docs/api/*.md`
  - `docs/features/*.md`
  - `docs/api/v1/openapi.yaml`
  - `docs/api/v1/paths/*.yaml`
  - `docs/api/v1/schemas/*.yaml`
  - `packages/praxrr-app/src/lib/server/utils/arr/README.md`
  - `packages/praxrr-schema/README.md`
- Existing docs contain many static references to specific apps (notably Radarr and Sonarr) in non-historical narrative.
- Historical planning artifacts under `docs/plans/**` still intentionally keep historical app-specific scope and should be retained unless a feature is explicitly being rewritten.

## Gaps

1. Generalized language around Arr-family support is inconsistent across top-level docs and APIs.
2. Feature docs still describe some workflows in app-specific terms where future app families are implied.
3. Developer docs under `packages/praxrr-app` and `packages/praxrr-schema` could better reflect “Arr apps” + “media-management apps” semantics.
4. README docs still present app-specific setup language that can hide broader Arr support story.

## Priority Workstreams

1. README updates (`README.md`, package readmes, high-signal docs readmes)
2. Architecture docs (`docs/ARCHITECTURE.md`, `docs/architecture/*.md`)
3. Feature docs (`docs/features/*.md`)
4. API docs (`docs/api/*.md` and related narrative references in OpenAPI)
5. Arr utility docs (`packages/praxrr-app/src/lib/server/utils/arr/README.md`, `packages/praxrr-schema/README.md`)

## Planned Changes

### Update

- `README.md`
- `docs/README.md`
- `docs/ARCHITECTURE.md`
- `docs/architecture/overview.md`
- `docs/architecture/components.md`
- `docs/api/README.md`
- `docs/api/endpoints.md`
- `docs/features/*.md`
- `docs/api/v1/openapi.yaml`
- `docs/api/v1/paths/arr.yaml`
- `docs/api/v1/schemas/pcd.yaml`
- `packages/praxrr-app/src/lib/server/utils/arr/README.md`
- `packages/praxrr-schema/README.md`

### Defer / Keep As-Is

- Historical execution notes in `docs/plans/**` and `docs/pr-reviews/**` where app-specific scope is part of historical record.

## Scope and Boundaries

- Preserve explicit app-scoped requirements in schema/API details where behavior is not uniform.
- Replace only static, present-tense references where the generic family concept is accurate.
- Keep historical references (especially in plans and research archives) for auditability unless explicitly requested.
- Track future docs work as separate scopes; this run intentionally updates
  present-tense project documentation wording, not historical plan narratives.
