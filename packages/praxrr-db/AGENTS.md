# Repository Guidelines

## Project Structure & Module Organization

This repository is a SQL-first database package for Praxrr content.

- `ops/`: ordered SQL operation files (for example `ops/49.add-bluespots-to-qxr-regex.sql`).
- `.github/workflows/`: automation (`notify.yml`, `devSync.yml`).
- `.github/ISSUE_TEMPLATE/`: bug/feature templates and intake rules.
- `pcd.json`: package metadata and schema dependency declaration.
- `README.md`: project overview and support links.

There is no `src/` or application runtime here; contributors primarily edit SQL operation files and
project docs.

## Build, Test, and Development Commands

No local build system is defined in this repository. Use these commands for safe contributor
workflow:

- `ls ops/*.sql | sort -V`: verify operation ordering by numeric prefix.
- `git diff -- ops/`: review SQL-only changes before committing.
- `npx prettier --check "**/*.md"`: check Markdown formatting using `.prettierrc`.
- `npx markdownlint-cli "**/*.md"`: lint Markdown using `.markdownlint.json`.

## Coding Style & Naming Conventions

- Name new operation files as `ops/<number>.<kebab-case-description>.sql`.
- Keep SQL changes idempotent where possible (guard updates/inserts with restrictive `WHERE` clauses
  or `NOT EXISTS` checks).
- Follow the established operation comment headers (for example `-- @operation`,
  `-- --- BEGIN op ...`).
- Preserve existing SQL style in touched files (quoted identifiers, readable multi-line statements).

## Testing Guidelines

There is no automated test suite in-repo. Validate changes by:

- checking SQL diff scope (`git diff -- ops/`),
- verifying operation order and numbering,
- including concrete match/non-match examples for regex/custom-format updates.

For bug-style changes, mirror issue template quality: release title, expected vs actual behavior,
and Regex101 proof when applicable.

## Commit & Pull Request Guidelines

- Prefer concise, imperative commit subjects (examples in history: `Fix RARBG`,
  `fix: set qp languages to any ...`).
- Keep commits focused to one logical change.
- In PR descriptions, include: affected `ops/*.sql` files, behavior change summary, linked issue(s),
  and evidence (screenshots/history) for matching logic updates.
- CODEOWNERS routes review to `@yandy-r`; expect owner review before merge.

## Security & Configuration Tips

- Do not add secrets or personal tokens to SQL comments, docs, or workflow files.
- Treat local `.env*` files as machine-specific; avoid introducing new sensitive data to version
  control.
