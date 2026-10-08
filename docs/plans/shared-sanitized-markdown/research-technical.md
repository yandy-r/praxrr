# shared-sanitized-markdown — Technical Spec (YAN-560 / GH #289)

## Executive Summary

The server's markdown pipeline (`packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts`) is **pure** — its only import is `marked` (deno.json:27, `npm:marked@^15.0.6`, isomorphic/browser-safe). No Deno, node, `$logger`, or DOM APIs. It can move to `$shared/markdown/` verbatim. Six client components call `marked.parse`/`marked.parseInline` directly and pipe the result into `{@html}` — stored XSS from any PCD/trash-sourced description. Fix: move module to shared, re-export from the old server path, add a `parseMarkdownInline` shared variant (inline sites exist), point all six client sinks at the shared functions, enable `svelte/no-at-html-tags` in `eslint.config.js`. Note: the task brief says "one allow" — in reality there are **10 pre-existing `{@html}` sinks** in `.svelte` files; only some can collapse into `<Markdown>` or a function call, so inline allows must be placed at each surviving raw sink (details below).

## Architecture Design

Current state:

- Sanitized pipeline lives server-only: `sanitizeHtml` (private, markdown.ts:10-88) + `parseMarkdown` (markdown.ts:93-101) + `stripMarkdown` (markdown.ts:106-111).
- Three server importers use `parseMarkdown` via `$utils/markdown/markdown.ts`:
  - `lib/server/trashguide/displayTransform.ts:20`
  - `lib/server/pcd/entities/qualityProfiles/list.ts:16` (pre-sanitizes QP descriptions server-side — this is why `quality-profiles/[databaseId]/views/CardView.svelte:141` `{@html profile.description}` is already safe)
  - `routes/databases/[id]/config/+page.server.ts:13`
- Six unsanitized client call sites (see Codebase Changes).

Target state:

```
$shared/markdown/markdown.ts        <- canonical: sanitizeHtml (now exported), parseMarkdown,
                                       parseMarkdownInline (new), stripMarkdown
$utils/markdown/markdown.ts         <- re-export shim only (keeps 3 server importers untouched)
client components                   <- import from $shared/markdown/markdown.ts
$ui/display/Markdown.svelte         <- THE shared sink; only component owning a raw {@html}
                                       for markdown; all other markdown rendering goes through
                                       shared functions and keeps its own (allow-commented) {@html}
```

Both `deno.json:8` and `packages/praxrr-app/deno.json` map `$shared/`; `packages/praxrr-app/svelte.config.js:40` maps it for Vite/svelte-check. The `$shared` alias is proven to resolve under `deno test` (e.g. `tests/base/networkTrust.test.ts:13` imports `$shared/security/index.ts`).

Parse-mode split (must be preserved — do not flatten):

| Site                                                         | Mode today                                           | Shared function       |
| ------------------------------------------------------------ | ---------------------------------------------------- | --------------------- |
| `ui/display/Markdown.svelte:8`                               | `parseInline` default, `parse` when `inline={false}` | both                  |
| `ui/form/MarkdownInput.svelte:114`                           | `parse` (preview)                                    | `parseMarkdown`       |
| `custom-formats/.../CardView.svelte:74`                      | `parseInline`                                        | `parseMarkdownInline` |
| `custom-formats/.../TableView.svelte:95`                     | `parseInline` (inside `Column.cell` html string)     | `parseMarkdownInline` |
| `regular-expressions/.../TableView.svelte:32`                | `parseInline` (inside `Column.cell`)                 | `parseMarkdownInline` |
| `databases/[id]/changes/components/FieldDiffTable.svelte:16` | `parse`                                              | `parseMarkdown`       |
| `databases/[id]/changes/components/TestsDiffTable.svelte:54` | `parse`                                              | `parseMarkdown`       |

## Data Models

None. Pure string→string rendering utility; no schema, DB, API contract, or persisted-data changes.

## API Design

`packages/praxrr-app/src/lib/shared/markdown/markdown.ts`:

```ts
/** Sanitize HTML: allowlisted tags/attrs; strips <script>, on*= handlers, javascript: URLs. */
export function sanitizeHtml(html: string): string;

/** Block markdown -> sanitized HTML. '' for null/undefined/empty. */
export function parseMarkdown(markdown: string | null | undefined): string;

/** Inline markdown (no <p> wrapper) -> sanitized HTML. '' for null/undefined/empty. */
export function parseMarkdownInline(
  markdown: string | null | undefined
): string;

/** Sanitized HTML -> plain text (tags stripped). */
export function stripMarkdown(markdown: string | null | undefined): string;
```

`packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts` becomes:

```ts
export {
  parseMarkdown,
  parseMarkdownInline,
  stripMarkdown,
  sanitizeHtml,
} from '$shared/markdown/markdown.ts';
```

`sanitizeHtml` becomes exported so the unit test and any future caller can exercise it directly; implementation unchanged (moved, not rewritten).

## System Constraints

- **Regex sanitizer is the shipped design.** Comment at markdown.ts:8 says it exists to avoid sanitizer-lib dependencies in compiled binaries. Do not swap in DOMPurify/sanitize-html here — that is a separate hardening decision (see Open Questions).
- **Sanitizer strips all attributes except `a[href,title]` and `img[src,alt,title]`** (markdown.ts:44-47). Consequence: client sites that previously rendered markdown passthrough like `<span class="...">` or `<kbd>` lose them — intentional, matches existing server-rendered output (QP descriptions already behave this way).
- **`MarkdownInput.renderMarkdown` empty-state string** (`MarkdownInput.svelte:113`) is a static literal, not user input. Keep it outside the sanitizer (it relies on `class`, which the sanitizer would strip); sanitize only `value`.
- **Client bundle:** `marked` is already client-bundled by every one of these components — moving to `$shared` changes nothing in payload size.
- **ESLint:** flat config (`eslint.config.js:13-54`), `eslint-plugin-svelte@^3.12.4` present (package.json:36), `svelte.configs.base` only (eslint.config.js:17) — `no-at-html-tags` is not in `base`, must be enabled explicitly in the svelte `files` block (eslint.config.js:40-53). In-template disables use `<!-- eslint-disable-next-line svelte/no-at-html-tags -->`.
- **Existing `svelte-ignore` precedent**: CardView.svelte:123, TableView.svelte:235 — inline ignores are the established pattern in this repo.
- **Deno check excludes routes** (deno.json:109) — client route files are only covered by `deno task check:client` (svelte-check) and eslint. Run both.

## Codebase Changes

**Create**

1. `packages/praxrr-app/src/lib/shared/markdown/markdown.ts` — moved `sanitizeHtml` (markdown.ts:10-88, now exported) + `parseMarkdown` (93-101) + `stripMarkdown` (106-111) + new `parseMarkdownInline` (same body as `parseMarkdown` but `marked.parseInline`).
2. `packages/praxrr-app/src/tests/shared/markdown/markdown.test.ts` — Deno.test unit tests (pattern: `tests/shared/thresholdState.test.ts`), run via `deno task test` (scripts/test.ts defaults to `packages/praxrr-app/src/tests`). Coverage:
   - `parseMarkdown('<b>x</b><script>alert(1)</script>y')` → no `<script`, bold preserved.
   - `<img src="x" onerror="alert(1)">` → `onerror` stripped, `src` kept.
   - `<a href="javascript:alert(1)">c</a>` → href dropped.
   - `<iframe src="x"></iframe>` → removed (not in allowlist).
   - `parseMarkdownInline('**b** and <span>k</span>')` → `<strong>` kept, `<span>` stripped, no `<p>` wrapper.
   - `parseMarkdown(null)` / `''` → `''`.
   - Optional: add a `markdown` alias to `scripts/test.ts` (not required — default run covers it).

**Modify**

3. `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts` — replace body with re-exports (server importers at displayTransform.ts:20, qualityProfiles/list.ts:16, config/+page.server.ts:13 keep working unchanged).
4. `packages/praxrr-app/src/lib/client/ui/display/Markdown.svelte` — drop `marked` import (:2), replace `$:` html (:8) with `parseMarkdownInline`/`parseMarkdown` by `inline` prop; add `<!-- eslint-disable-next-line svelte/no-at-html-tags -->` above :18 (the sanctioned allow).
5. `packages/praxrr-app/src/lib/client/ui/form/MarkdownInput.svelte` — drop `marked` import (:3); `renderMarkdown` (:112-115) calls shared `parseMarkdown(text)` for non-empty, keeps static empty-state literal; allow comment above `{@html}` at :206.
6. `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/CardView.svelte` — drop `marked` (:6) + local fn (:72-75); import `parseMarkdownInline`; allow comment above :195.
7. `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/TableView.svelte` — drop `marked` (:11) + local fn (:93-96); import `parseMarkdownInline` (used inside `cell()` html string at :153 — component reuse impossible here, string composition).
8. `packages/praxrr-app/src/routes/regular-expressions/[databaseId]/views/TableView.svelte` — same as above (:8, :30-33, :86).
9. `packages/praxrr-app/src/routes/databases/[id]/changes/components/FieldDiffTable.svelte` — drop `marked` (:4) + local fn (:15-17); import `parseMarkdown`; allow comments above :194 and :248.
10. `packages/praxrr-app/src/routes/databases/[id]/changes/components/TestsDiffTable.svelte` — drop `marked` (:4) + local fn (:53-55); import `parseMarkdown`; allow comments above :112, :118, :124.
11. `eslint.config.js` — in the svelte `files` block rules (after :42): `'svelte/no-at-html-tags': 'error'`.

**Unrelated `{@html}` sinks that will start erroring (must get allow comments or be judged safe to leave for follow-up)**

12. `lib/client/ui/table/Table.svelte:192,221,343` — generic `{html}` from `Column.cell` (types.ts:33 `{ html: string }`); after this change all markdown-bearing feeders sanitize, but Table also renders hand-built escaped HTML (regex101 SVG link etc.) — allow comment with justification "cell authors must sanitize; markdown feeders use $shared/markdown".
13. `lib/client/ui/meta/JsonView.svelte:34,47` and `lib/client/ui/meta/CodeBlock.svelte:33` — highlight.js output over escaped input — allow comments.
14. `routes/quality-profiles/[databaseId]/views/CardView.svelte:141` — input already sanitized server-side (qualityProfiles/list.ts:182) — allow comment citing that.

**Delete** — none (local fns removed inside modified files; server module retained as shim).

## Technical Decisions

- **Move, don't rewrite.** The sanitizer's regexes are imperfect (see Open Questions) but this change is about eliminating _zero-sanitization_ sinks, not hardening the sanitizer. Mixing both in one change bloats review of a security fix.
- **Re-export shim over updating importers.** Three server import paths keep working with zero diff; shim is greppable and can be deleted later.
- **Function calls, not `<Markdown>` component, at the 5 route/form sites.** Table cell renderers return HTML _strings_ (`Column.cell` types.ts:33) — components can't be used there at all. CardView/diff tables have their own wrapper markup + scoped `prose-inline`/`prose` styles (CardView.svelte:194, TestsDiffTable.svelte:111) that the component's fixed `text-xs` span (Markdown.svelte:12-16) would fight. Smallest diff, no visual change.
- **Inline eslint disables over config allowlist.** `eslint-plugin-svelte` flat config has no per-file allowlist mechanism for this rule; per-site `eslint-disable-next-line` is the supported pattern and matches existing `svelte-ignore` usage.
- **New `parseMarkdownInline` instead of a mode flag.** Call sites stay one-liners; mirrors `marked`'s own API split.
- **Test lives under `tests/shared/`** mirroring the source tree (`lib/shared/markdown/`) — matches `tests/shared/security/`, `tests/shared/pcd/` precedent; `$shared` alias resolution under `deno test` is already proven.

## Open Questions

1. **Sanitizer hardening (pre-existing, out of scope):** the attr-strip regexes only match quoted attributes — unquoted `onerror=alert(1)` inside an allowed tag (e.g. `img`) survives markdown.ts:53/:77 today. Same risk on server-rendered paths. Follow-up issue candidate: require quoted attrs, strip unquoted attrs entirely, or adopt a real sanitizer for compiled binaries if postcss-adjacent issues are resolved.
2. **`data:` URIs on `img src`** pass the allowlist (only `javascript:` hrefs are stripped, markdown.ts:54). Acceptable? `data:image/...` cannot execute script in modern browsers, but a CSP decision would settle it.
3. **`Table.svelte` remains a generic raw-HTML sink** (`{html: string}` column contract). Should the column type gain a `sanitized: true` marker or should Table document the invariant "cell authors must pre-sanitize"? This spec adds only a comment; a typed contract would be a small follow-up.
4. **Alias in `scripts/test.ts`** — add `markdown: 'packages/praxrr-app/src/tests/shared/markdown'` for convenience, or rely on default full run? Cosmetic; implementer's choice.
5. **`docs/ARCHITECTURE.md:1203`** references `utils/markdown/markdown.ts` — update the path reference to the shared module in the same change (docs-only, no behavior).
