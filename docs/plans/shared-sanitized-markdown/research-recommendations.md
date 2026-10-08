# shared-sanitized-markdown — Recommendations

## Executive Summary

Threat real: 7 client files pipe `marked` output straight into `{@html}` with zero sanitization; remote PCD content = stored XSS vector. Server already has regex-based `sanitizeHtml`+`parseMarkdown` (`lib/server/utils/markdown/markdown.ts`) with no deps beyond `marked`. Move is pure relocation, ~0KB bundle delta. Single PR, no flag. One wrinkle: client sinks mix `parse` (block) and `parseInline`; shared module must export both variants or table cells regress.

## Implementation Recommendations

- New module `src/lib/shared/markdown/markdown.ts`: move `sanitizeHtml`, `parseMarkdown` verbatim; add `parseMarkdownInline` (marked `parseInline` + same sanitizer). Keep both — sinks depend on distinction:
  - Block `parse`: `Markdown.svelte` (non-inline), `MarkdownInput` preview, `FieldDiffTable`, `TestsDiffTable`.
  - Inline `parseInline`: `CF CardView`, `CF TableView`, `Regex TableView`, `Markdown.svelte` (inline mode).
- `src/lib/server/utils/markdown/markdown.ts` becomes re-export shim so `displayTransform.ts`, `qualityProfiles/list.ts`, `databases/[id]/config/+page.server.ts` keep working untouched.
- Swap 7 sinks (8th `marked` importer is server module itself): `display/Markdown.svelte`, `form/MarkdownInput.svelte`, CF `CardView`+`TableView`, Regex `TableView`, `FieldDiffTable`, `TestsDiffTable`. Delete local `parseMarkdown` copies in each.
- AC check: `grep -rn "from 'marked'" src` must return exactly one hit (shared module). Add to PR description as reviewer check.
- Tests: `src/tests/shared/markdown/markdown.test.ts` (follow existing `Deno.test` + `@std/assert` pattern, e.g. `tests/server/utils/config/parserUrl.test.ts`). Cases: `<script>` stripped with content, `onerror=` stripped (double-quoted at minimum), `javascript:` href neutralized, allowed tags/attrs survive (`a[href]`, `img[src]`), `null`/`undefined` → `''`, `stripMarkdown` unchanged, inline variant emits no wrapping `<p>`.
- Lint: enabling `svelte/no-at-html-tags` will flag ~20 files, not 7. Handle in same PR via file overrides + inline disables (see table). Verify whether installed `eslint-plugin-svelte@3.12.4` rule supports an `allow` option; if not, targeted `<!-- eslint-disable-next-line svelte/no-at-html-tags -- justification -->` is the mechanism.

### `{@html}` inventory — disposition each

| File                                                                                                                                  | Source                                                | Verdict                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 7 markdown sinks above                                                                                                                | `marked` raw                                          | Route through shared renderer (the fix)                                                                                              |
| `quality-profiles/*/CardView.svelte`, `TableView.svelte` `row.description`                                                            | Server-`parseMarkdown` HTML from `list.ts`            | Already sanitized server-side — disable comment, do NOT re-parse client-side (double-parse mangles HTML)                             |
| `ui/table/Table.svelte` (3 sites)                                                                                                     | Generic `{html}` cell passthrough from callers        | File-level override/disable; renderer's contract, callers own safety                                                                 |
| `ui/meta/CodeBlock.svelte`, `JsonView.svelte`                                                                                         | `highlight.js` token output                           | Disable with comment (hljs escapes input text; output is generated spans). Note: `highlightAuto` on empty-lang fallback — acceptable |
| `sync-history`, `canary`, `delay/metadata-profiles`, `snapshots`, `conflicts`, trash pages, `arr/*`, `settings/*` table `html:` cells | Template literals with `escapeHtml()` + static badges | Disable comments; all dynamic parts escaped at construction. Spot-check each for a missed unescaped interpolation during PR          |

## Improvement Ideas

- Quick win (same PR, near-free): `FieldDiffTable`/`TestsDiffTable` run _every_ field value through markdown — patterns/naming templates containing `_`/`*` render as emphasis. Keep parity now; file follow-up to only markdown-render `isMarkdownField` values.
- `MarkdownInput` empty-state string (`<p class="...">Nothing to preview</p>`) is static trusted HTML — disable comment, fine as-is.
- Sanitizer hardening (follow-up, not this PR): current regex approach misses unquoted attrs (`<img src=x onerror=...>` without quotes), `data:` URLs, `style` attr (stripped only via allowlist — actually safe), single-quote edge in `javascript:` check. Tests should pin current behavior; DOMPurify rejected deliberately (binary-compile/postcss issue per code comment — keep that comment when moving).
- Unblocks YAN-559: single shared importer means one `marked` upgrade point afterwards.

## Risk Assessment

- **Bundle size: negligible.** `marked` already ships client-side (7 importers, deduped by bundler); sanitizer is dependency-free regex. Shared module adds ~2KB.
- **Behavior regression (main risk): block vs inline.** `CF TableView`/`Regex TableView` use `parseInline`; naively pointing all sinks at block `parseMarkdown` wraps cell content in `<p>`, breaking table layout and `prose-inline` styling. Mitigated by two-variant API. `Markdown.svelte` needs runtime branch preserved.
- **Double-sanitize mangles QP descriptions.** Server `list.ts`/`displayTransform.ts` output is HTML already; if any client sink re-runs `parseMarkdown` over it, markdown treats tags as text. Keep data-flow direction: sanitize once at creation, render raw with disable comment.
- **Lint blast radius.** Rule touches files far outside feature scope (logs, snapshots, settings). Risk of drive-by churn: restrict PR to disables/comments only in those files, zero logic changes. Suggest `pnpm lint` + `svelte-check` green as merge gate.
- **SSR/`$shared` import legality.** `$shared` maps to `src/lib/shared`, importable both sides; `marked` resolves via `npm:marked` (deno.json) and npm dep — no server-only leakage. Confirm no `node:`/`Deno.` APIs sneak into moved code (current file is clean).
- **Residual XSS via sanitizer gaps** (unquoted handlers). Documented above; AC tests pin `<script>`/`onerror` quoted forms. Remote-PCD threat reduced, not eliminated — state honestly in PR.

## Alternative Approaches

- **DOMPurify client-side:** stronger sanitization, but adds ~20KB + reintroduces dep the codebase deliberately avoided for compiled binaries. Rejected; regex allowlist is proportionate for markdown subset.
- **Server-render all markdown, ship HTML:** kills client `marked` entirely (better bundle), but diff tables and previews need client reactivity; would require API/LOADER reshaping across 7 views. Effort M, not S. Revisit if YAN-559 makes `marked` client cost painful.
- **CSP `script-src` as sole mitigation:** defense-in-depth worth adding anyway, but not a substitute — `javascript:` URLs and event handlers need output sanitization regardless.
- **Per-file local sanitize copies:** what exists today by accident; shared module strictly dominates.

## Task Breakdown Preview

Single PR, suggested order (all in `packages/praxrr-app`):

1. Create `src/lib/shared/markdown/markdown.ts` (move + `parseMarkdownInline`).
2. Re-export shim in `src/lib/server/utils/markdown/markdown.ts`; run `check:server`.
3. Swap 7 sinks, delete local copies; run `check:client`.
4. Add `src/tests/shared/markdown/markdown.test.ts`; run `deno task test`.
5. Enable `svelte/no-at-html-tags`, add overrides/disables per table above; run `lint`.
6. Grep-verify exactly one `marked` importer; open PR with threat + residual-risk note.

## Key Decisions Needed

- Two-variant API (`parseMarkdown` + `parseMarkdownInline`) vs single block-only: recommend two (layout parity). Confirm.
- Lint mechanism: rule `allow` option vs disable comments — whoever implements checks installed plugin version's schema first.
- QP `CardView`/`TableView` descriptions: confirm server-sanitized passthrough (disable comment) rather than client re-render.

## Open Questions

- Does `Markdown.svelte` `maxLines` clamp rely on inline (span-safe) output in block mode anywhere? Grep callers with `inline={false}` before merge.
- Any other remote-content `{@html}` outside `src` (e.g. email/notification templates)? Grep covered `*.svelte`; non-Svelte HTML assembly (notifications?) out of scope but worth one grep for `innerHTML`/`{@html}` equivalents.
- Should residual sanitizer gaps get a tracking issue now (honest-XSS accounting), or ride along YAN-559's `marked` upgrade?
