# PR Review #291 — fix(security): render all markdown through one shared sanitized renderer (YAN-560)

**Reviewed**: 2026-10-08
**Mode**: PR
**Author**: yandy-r
**Branch**: security/YAN-560-shared-sanitized-markdown → main
**Decision**: APPROVE (after fixes)

## Summary

Three parallel reviewers covered correctness, security/performance and quality. The sanitizer matches its documented
allowlist and URL policy. Every call site renders the same as before. The diff stays in scope. All 8 findings are
LOW or MEDIUM: 6 are fixed, and 2 are accepted as documented trade-offs. No CRITICAL or HIGH issues.

## Findings

### CRITICAL

### HIGH

### MEDIUM

- **[F001]** `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts:7` — Public export `stripMarkdown` removed from the server module
  - **Status**: Open
  - **Category**: Completeness
  - **Suggested fix**: None needed. The removal is intentional: there are zero callers, and the plan's NOT Building list
    covers it. Now documented in the PR body as an intentional API removal.

### LOW

- **[F002]** `packages/praxrr-app/src/routes/metadata-profiles/[databaseId]/+page.svelte:132` — `updated_at` interpolated into a Table html cell without escaping
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: `escapeHtml(row.updated_at || 'Never')`.
- **[F003]** `packages/praxrr-app/src/routes/delay-profiles/[databaseId]/views/TableView.svelte:32` — `formatProtocol` default branch returns the raw PCD string into an html cell
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: `return escapeHtml(protocol)`.
- **[F004]** `docs/plans/shared-sanitized-markdown/research-security.md:93` — URL-policy doc described a weaker check order than the code implements
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Document the implemented order (reject first, normalize last).
- **[F005]** `scripts/compat-check.ts` — `listByDatabase` shim returned live row references, unlike the real query's row copies
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: `.map((op) => ({ ...op }))`.
- **[F006]** `packages/praxrr-app/src/lib/shared/markdown/markdown.ts:68` — `align` value check was case-sensitive (`align="LEFT"` dropped)
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Case-insensitive match; emit the value lowercased.
- **[F007]** `packages/praxrr-app/src/lib/shared/markdown/markdown.ts:78` — A relative URL with `&` before any `/`, `?` or `#` (for example `Q&A.html`) loses its href
  - **Status**: Open
  - **Category**: Completeness
  - **Suggested fix**: None needed. Accepted fail-closed trade-off: an entity in the scheme region can hide a scheme.
    Rare in PCD descriptions.

## Validation Results

| Check      | Result                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------- |
| Type check | Pass (`deno task check:client` 0 errors; `check:server` clean)                                |
| Lint       | Pass (prettier + eslint on changed files)                                                     |
| Tests      | Pass (markdown 23/23; PCD import/atomicity 23/23; `deno task compat:check` all checks passed) |
| Build      | Pass (CI `build` job; local `deno task build`)                                                |

## Files Reviewed

- `packages/praxrr-app/src/lib/shared/markdown/markdown.ts` (Added)
- `packages/praxrr-app/src/tests/shared/markdown/markdown.test.ts` (Added)
- `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts` (Modified)
- 7 client markdown sinks, 4 Table producers, 3 non-markdown sinks (Modified)
- `scripts/compat-check.ts` (Modified)
- `eslint.config.js`, `package.json`, `deno.json`, `deno.lock`, `package-lock.json`, `docs/ARCHITECTURE.md` (Modified)
