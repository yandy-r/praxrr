# Implementation Report: Shared Sanitized Markdown Renderer (YAN-560 / GH #289)

## Summary

`marked` is now imported only by `$shared/markdown/markdown.ts`. That module runs an isolated `Marked` instance
followed by a `xss@1.0.15` `FilterXSS` with an explicit tag/attribute allowlist and a fail-closed URL policy.
`sanitizeHtml`, `parseMarkdown` (block) and `parseMarkdownInline` (inline) serve every client markdown sink; the
server module re-exports them. Raw PCD names and descriptions in Table cells for metadata, delay and quality
profiles are now HTML-escaped. `svelte/no-at-html-tags` is set to `error`, and every remaining sink carries a
justified line or block disable comment.

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                                                                   |
| ------------- | ---------------- | ------------------------------------------------------------------------ |
| Complexity    | Medium           | Medium                                                                   |
| Confidence    | 8/10             | 8/10 (sanitizer verified with a parser-backed check: 68 cases × 3 modes) |
| Files Changed | ~22              | 24 (22 modified/added source/config + docs)                              |

## Tasks Completed

| #   | Task                                            | Status          | Notes                                                                                             |
| --- | ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| 1.1 | Dependency, shared module, tests, server shim   | [done] Complete | Typed cast for the CJS default import; implementor stalled twice and the orchestrator finished it |
| 2.1 | Markdown / MarkdownInput                        | [done] Complete |                                                                                                   |
| 2.2 | Justified disables (Table, CodeBlock, JsonView) | [done] Complete | Deviated: block disable around `<pre>` to keep the whitespace identical (review F002)             |
| 3.1 | Custom-format views                             | [done] Complete |                                                                                                   |
| 3.2 | Regex table view                                | [done] Complete |                                                                                                   |
| 3.3 | Change-review diff tables                       | [done] Complete |                                                                                                   |
| 3.4 | Quality profile views                           | [done] Complete | Also escaped `row.language.name`                                                                  |
| 3.5 | Metadata / delay profile producers              | [done] Complete | Finished by orchestrator after the fixer stalled                                                  |
| 4.1 | Lint rule, docs, full validation                | [done] Complete | Added one justified `no-control-regex` disable in the sanitizer                                   |

## Validation Results

| Level           | Status      | Notes                                                                                                  |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| Static Analysis | [done] Pass | `deno task check` 0 errors; prettier and eslint clean on changed files (repo-wide main debt untouched) |
| Unit Tests      | [done] Pass | 23 markdown tests; full suite 2562 pass, and the 3 env-gated tests pass with dotenvx secrets           |
| Build           | [done] Pass | `deno task build` produced the compiled binary (proves xss bundles for Vite and deno compile)          |
| Integration     | N/A         | No API or contract changes                                                                             |
| Edge Cases      | [done] Pass | 68-input parser-backed policy check, 0 violations, sanitizing twice changes nothing                    |

## Files Changed

| File                                                                                                      | Action                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------ |
| `packages/praxrr-app/src/lib/shared/markdown/markdown.ts`                                                 | CREATED                  |
| `packages/praxrr-app/src/tests/shared/markdown/markdown.test.ts`                                          | CREATED                  |
| `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts`                                           | UPDATED (re-export shim) |
| 7 client markdown sinks + 4 Table producers + 3 non-markdown sinks                                        | UPDATED                  |
| `eslint.config.js`, `package.json`, `deno.json`, `deno.lock`, `package-lock.json`, `docs/ARCHITECTURE.md` | UPDATED                  |

## Deviations from Plan

- **xss import**: a typed cast (`xssModule as unknown as typeof XSS`) was needed because the bundled typings model the
  default export as the filter function.
- **Attribute handling**: `onTagAttr` was added so a rejected allowlisted attribute is dropped entirely instead of
  being emitted bare.
- **Entity check**: a named-entity scheme check was added (`&` in the scheme region is rejected), because xss does
  not decode `&Tab;`.
- **Lockfiles**: patched to contain only the xss subtree, avoiding churn from regenerating under a newer toolchain.

## Issues Encountered

- **Stalled subagents**: two implementation subagents ended without reporting. Their partial work was inspected and
  finished.
- **Security review lane**: the review lane was content-filtered, so the orchestrator ran the parser-backed policy
  check in its place.
- **Local env gap**: the full suite's 3 failures need `ARR_CREDENTIAL_MASTER_KEY`. They are unrelated to this change
  and pass with secrets loaded.

## Tests Written

| Test File                                                        | Tests | Coverage                                                              |
| ---------------------------------------------------------------- | ----- | --------------------------------------------------------------------- |
| `packages/praxrr-app/src/tests/shared/markdown/markdown.test.ts` | 23    | XSS payload corpus, URL policy, GFM parity, idempotence, inline/block |

## Next Steps

- [x] Code review via `/code-review --parallel` (local artifact `docs/prps/reviews/local-20261007-234433-review.md`)
- [ ] Create PR via `/git-workflow --pr --ci --ci-yes`
