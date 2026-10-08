# Business Research: shared-sanitized-markdown (YAN-560 / GH #289)

All paths relative to `packages/praxrr-app/` unless noted.

## Executive Summary

Eight client files import `marked` directly and push its output into `{@html}` (or into Table `{ html }` cells, which Table renders with `{@html}`) with no sanitization. Markdown text comes from remote PCD repos (custom format, regex, quality profile, test descriptions) and TRaSH guide data, so any PCD author can ship stored XSS. A sanitizer already exists, but it is server-only and its server copy has bypasses (see Edge Cases). Goal: one shared module owning the only `marked` import, with every sink going through it, enforced by lint. The sanitizer must be hardened as part of the move, because "reuse the server one" alone leaves the hole open.

## User Stories

- **Praxrr operator browsing a PCD** sees descriptions rendered as markdown in:
  - Custom format card grid (inline) `routes/custom-formats/[databaseId]/views/CardView.svelte:195`
  - Custom format table (inline, Table `html` cell) `.../views/TableView.svelte:152-153`
  - Regex table (inline, `html` cell) `routes/regular-expressions/[databaseId]/views/TableView.svelte:85-86`
  - Regex card `routes/regular-expressions/[databaseId]/views/CardView.svelte:74` via `<Markdown content>` (inline default)
  - Quality profile card `routes/quality-profiles/[databaseId]/views/CardView.svelte:141` (server-rendered HTML)
  - Quality profile table `routes/quality-profiles/[databaseId]/views/TableView.svelte:135` (server-rendered HTML in an `html` cell)
  - TRaSH custom format / quality profile general pages `routes/databases/trash/[id]/{custom-formats,quality-profiles}/[trashId]/general/+page.svelte:61,38` via `<Markdown>`
- **PCD maintainer reviewing upstream changes** sees before/after markdown diffs:
  - `routes/databases/[id]/changes/components/FieldDiffTable.svelte:194,248` (only fields `description|readme|notes`, line 19-21)
  - `routes/databases/[id]/changes/components/TestsDiffTable.svelte:112,118,124` (test descriptions)
- **PCD author / editor** writes descriptions in `MarkdownInput` (toolbar + Preview toggle). Used in custom-format GeneralForm:198, quality-profile GeneralForm:230, regex form:206, test form:217, database config page:413, and the dev gallery.
- **Security-conscious user** expects a malicious remote PCD to be unable to run script in their authenticated session (Praxrr holds Arr API keys and admin session).

## Business Rules

Markdown features that must keep rendering (the server allow-list `lib/server/utils/markdown/markdown.ts:12-41` already covers them):

- Emphasis, strong, `code`, `pre`, links (`a` with `href`,`title`), images (`img` `src`,`alt`,`title`), lists, blockquote, headings h1-h6, tables (`table/thead/tbody/tr/th/td`), `hr`, `del`, `ins`, `p`, `br`.
- Missing from allow-list but marked can emit them: `tfoot`, `span`, `div`, `sup/sub`, `input` (GFM task lists `[ ]`, stripped to nothing, leaving list text), table `align` attribute (marked emits `<th align="left">`; sanitizer strips attrs on `th`, so alignment is lost), `id` on headings (v15 no longer emits). Decide whether to extend allow-list; default: keep as-is.

Per-call-site `marked` usage (all use global default options, no `setOptions`/`marked.use`/custom renderer anywhere; grep confirmed). Defaults in marked 15: `gfm: true`, `breaks: false`, `async: false`. Pin: `deno.json:27` / `package.json:17` `marked ^15.0.6`.

| Site                                                   | Call                                                  | Mode                | Empty handling                                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/client/ui/display/Markdown.svelte:8`              | `parseInline` if `inline` (default true) else `parse` | inline/block switch | falsy `content` -> `''`, wrapper `<span>` not rendered (`{#if html}`)                                                                                                                              |
| `lib/client/ui/form/MarkdownInput.svelte:112-115`      | `parse`                                               | block               | empty -> literal placeholder `<p class="text-neutral-400 ... italic">Nothing to preview</p>` (HTML containing a `class` attribute; must NOT go through the sanitizer, which strips `class` on `p`) |
| `custom-formats/.../CardView.svelte:72-75`             | `parseInline`                                         | inline              | falsy -> `''`                                                                                                                                                                                      |
| `custom-formats/.../TableView.svelte:93-96,152-153`    | `parseInline`                                         | inline              | falsy -> `''`                                                                                                                                                                                      |
| `regular-expressions/.../TableView.svelte:30-33,85-86` | `parseInline`                                         | inline              | falsy -> `''`                                                                                                                                                                                      |
| `FieldDiffTable.svelte:15-17`                          | `parse`                                               | block               | no guard; caller checks `typeof === 'string'`                                                                                                                                                      |
| `TestsDiffTable.svelte:53-55`                          | `parse`                                               | block               | no guard; callers pass `String(x ?? '')`                                                                                                                                                           |
| server `parseMarkdown`                                 | `parse` only                                          | block               | falsy (null/undefined/'') -> `''`                                                                                                                                                                  |

Key rules derived:

1. Server `parseMarkdown` is block-only. Five sinks need **inline** (`parseInline`: no wrapping `<p>`, used in `<span>`/table cells). Shared module must expose inline + block variants (e.g. `parseMarkdown(md)` and `parseMarkdownInline(md)` or an `{inline}` option), both sanitized. Using block output in the inline sites would inject `<p>` inside `<span>` (invalid HTML, spacing change).
2. Sanitizer allow-list only passes `a[href,title]` and `img[src,alt,title]`; all other attributes are dropped. Consequence: `target`, `rel`, `class` are never emitted. Consider forcing `rel="noopener noreferrer"` (and maybe `target=_blank`) on links; currently none.
3. Null/undefined/empty must return `''` everywhere; Markdown.svelte relies on falsy `html` to hide its wrapper.
4. MarkdownInput placeholder and any structural HTML (`class=...`) must be produced outside the sanitizer (static literal, not user text).
5. Sanitization must happen at the sink path (client call or server render), never rely on server-pre-sanitized data alone: quality profiles are pre-rendered on the server (`lib/server/pcd/entities/qualityProfiles/list.ts:182`) and trash descriptions too (`lib/server/trashguide/displayTransform.ts:245`), but the client then renders that string through `{@html}` (QP CardView:141, TableView:135) or **re-parses it with marked** (`<Markdown content={entity.description}>` on trash pages: input is already HTML; marked passes inline HTML through, so output is sanitized-then-reparsed-then-(currently) unsanitized).
6. Repo convention: Svelte 5 without runes, class-based Tailwind; no new dependency preferred (comment in server file: avoids postcss/DOMPurify issues in the compiled Deno binary, `markdown.ts:7-9`). Shared code must work in both browser and Deno server (no `node:` / DOM APIs; regex sanitizer satisfies this; DOMPurify would need jsdom on server, so unsuitable).
7. Lint rule: enable `svelte/no-at-html-tags` (currently NOT configured; `eslint.config.js:13-54` uses only `svelte.configs.base` + prettier, which does not turn on the rule). Needs exactly one allowed sink (a shared `SafeHtml.svelte`-style wrapper or one allow-listed file) with `eslint-disable-next-line` + justification, or files overrides.

## Workflows

1. Remote PCD synced -> descriptions stored in PCD cache -> list endpoint (server) either returns raw markdown (CF, regex, tests, diff payloads) or pre-rendered HTML (quality profiles, trash).
2. Page renders -> client component calls shared `parseMarkdown[Inline]` -> sanitized HTML -> `{@html}` (or Table `html` cell -> `Table.svelte:192,221,343`).
3. Editor: user types in `MarkdownInput` -> toggles Preview -> `renderMarkdown(value)` -> sanitized preview; the hidden `<input name value>` posts raw markdown (unchanged, `MarkdownInput.svelte:208-210`). Raw markdown stays unsanitized in storage; sanitize on render only.
4. Diff review: change payload `before`/`after` per field -> `FieldDiffTable`/`TestsDiffTable` -> block markdown -> sanitized.

## Domain Model

- Markdown source (untrusted string; sources: PCD ops, TRaSH JSON, user edits).
- Rendered HTML (sanitized string, safe for `{@html}`); two shapes: block (`marked.parse`) and inline (`marked.parseInline`).
- Allow-list: tag set + per-tag attribute set (`markdown.ts:12-47`).
- Table cell contract: `cell: (row) => string | Component | { html: string }` (`lib/client/ui/table/types.ts:33`); `{ html }` is rendered raw by `Table.svelte`.

## Existing Codebase Integration

`marked` imports (exhaustive grep `from 'marked'`, only these 8):

- `lib/server/utils/markdown/markdown.ts:5` (keep, move)
- `lib/client/ui/display/Markdown.svelte:2`
- `lib/client/ui/form/MarkdownInput.svelte:3`
- `routes/custom-formats/[databaseId]/views/CardView.svelte:6`
- `routes/custom-formats/[databaseId]/views/TableView.svelte:11`
- `routes/regular-expressions/[databaseId]/views/TableView.svelte:8`
- `routes/databases/[id]/changes/components/FieldDiffTable.svelte:4`
- `routes/databases/[id]/changes/components/TestsDiffTable.svelte:4`

Server consumers of `parseMarkdown` (must keep import path working or be updated; `$utils/markdown/markdown.ts`): `routes/databases/[id]/config/+page.server.ts:13,36` (`readmeHtml` returned but not referenced by any Svelte file: dead output, still sanitized), `lib/server/trashguide/displayTransform.ts:20,245`, `lib/server/pcd/entities/qualityProfiles/list.ts:16,182`. `stripMarkdown` (`markdown.ts:106`) has no callers outside the file; move with module or drop (YAGNI).

ALL `{@html` usages in `src/` (grep exhaustive, 15 matches):

- Markdown-related raw sinks (in scope): `Markdown.svelte:18`, `MarkdownInput.svelte:206`, custom-formats `CardView:195`, `FieldDiffTable:194,248`, `TestsDiffTable:112,118,124`.
- **Not listed in issue, still markdown-derived HTML: `routes/quality-profiles/[databaseId]/views/CardView.svelte:141`** `{@html profile.description}` (server-sanitized today, but a direct raw sink; lint rule will flag it).
- **Table `html` cells (generic sink)**: `lib/client/ui/table/Table.svelte:192,221,343`. Feeds from callers: custom-formats TableView:152, regex TableView:85, `quality-profiles/.../TableView.svelte:135` (`row.description || ...` raw), and `routes/metadata-profiles/[databaseId]/+page.svelte:93` (`String(row.description)` raw with no escaping and no markdown: a separate XSS vector for plain description text). Also unescaped interpolations: `routes/delay-profiles/.../TableView.svelte:49` (`row.name`), `metadata-profiles/.../+page.svelte:85` (`row.name`), `arr/upgrades/info/+page.svelte:31,40`, `settings/logs` & `arr/[id]/logs` (`row.level`/`row.logger`). Flag as follow-ups outside the six-component scope; the lint rule will flag `Table.svelte` as the third allowlist entry.
- highlight.js sinks (safe: hljs escapes): `lib/client/ui/meta/JsonView.svelte:34,47`, `lib/client/ui/meta/CodeBlock.svelte:33`. Need `eslint-disable` or allow entries when the lint rule is turned on.

So "one allow" in the issue is optimistic: lint will report at least `Markdown.svelte` (the intended single sink if all callers use `<Markdown>`), `Table.svelte` x3, `JsonView.svelte` x2, `CodeBlock.svelte`, `quality-profiles/.../CardView.svelte`. Either per-line `eslint-disable-next-line svelte/no-at-html-tags -- reason` for each, or a flat-config `files` override with a short allow list.

Existing component reuse option: `Markdown.svelte` already has `inline`/`maxLines`/styling and could become the single sink (sanitized inside). Diff tables and CF CardView use `prose` block styling (`class="prose prose-sm ..."`) not Markdown.svelte's span with `text-xs`; migrating would need a class/wrapper prop. Table `html` cells cannot use a component unless the shared module returns a string, so keep the function API too.

Lint/test infra: `eslint.config.js` (root, flat config, `eslint-plugin-svelte` already installed); tests live in `src/tests/**` with `Deno.test` (alias runner `scripts/test.ts`; aliases listed in CLAUDE.md). Shared module location `lib/shared/markdown/` is new (no existing dir). `$shared/` alias exists.

## Edge Cases and Behaviour Differences (verified by running server `parseMarkdown` under Deno)

Current server sanitizer is regex-based and bypassable; shipping it as-is would not satisfy the AC meaningfully:

- `<img src=x onerror=alert(1)>` (unquoted attrs, raw HTML line) -> output unchanged: handler strip at `markdown.ts:53` only matches quoted `on*="..."`; attr filter at `:76-84` replaces only quoted `name="value"` matches and returns everything else in `attrs` untouched (`.replace` keeps non-matching text). So both event handlers and unquoted `href`/`src` survive verbatim. Same for `<a href=javascript:alert(1)>x</a>` and `<a href="x" onclick=alert(1)>` (quoted href kept — only quoted attrs are rewritten, unquoted `onclick` copied through).
- Entity-encoded scheme `<a href="java&#115;cript:alert(1)">` passes; `javascript:` filter at `:54` is literal-match.
- `![i](javascript:alert(1))` -> `<img src="javascript:alert(1)">` (img src not scheme-checked; harmless in modern browsers but should be blocked); `data:` hrefs pass (`data:text/html,...` navigations are blocked top-level in modern browsers, but should be allow-listed to http/https/mailto/relative).
- Markdown link `[x](javascript:...)` is handled (href stripped, leaves `<a >`).
- Tag filter regex `[^>]*` breaks on `>` inside quoted attr values (`title="a>b"`).
- Output rewriting artifact: attributes get extra spaces (`<a  href=...>`); tests must not assert exact strings with single-space.
- `<script>` removal works for the simple case; nested/obfuscated forms (`<scr<script>ipt>`) untested.
  Recommendation: strengthen sanitizer in the same change (parse attributes robustly incl. unquoted, URL scheme allow-list `http|https|mailto|relative` for `href`/`src`, strip all `on*`, strip `style`), or replace with an escape-first approach: configure marked with a renderer override for `html` tokens that escapes raw HTML (`renderer.html = ({text}) => escape(text)`) so only markdown-generated tags exist, then URL-scheme-check in `link`/`image` renderers. That removes the raw-HTML attack surface entirely and is shorter than regex filtering; downside: authors lose raw HTML in descriptions (which sanitizer drops anyway except allow-listed tags like `<br>`, `<u>`, `<ins>`).

Other edge cases:

- `breaks` is false everywhere: single newline does not render `<br>`; two trailing spaces do. Preserve (do not turn on `breaks`).
- Inline vs block: block parse of text like `- a` yields lists; inline parse leaves `- a` literal. Keep per-site mode.
- Inline mode, sanitized: `parseInline` can still emit `<a>`/`<img>`/`<code>`/raw inline HTML; same sanitizer applies.
- Diff tables: `FieldDiffTable.svelte:192-195` guards `typeof === 'string'`, others fall to `formatValue`; `TestsDiffTable.svelte:107` compares `before !== after` to show both panels; empty string renders `''`/`<p>` nothing. No diff highlighting exists in the markdown path (before/after are separate renders), so sanitizer doesn't need to preserve highlight markup (`ins`/`del` are in allow-list but only from author markdown/HTML).
- `FieldDiffTable` `readme` field: README can be long, block markdown with tables/code fences; `pre`/`code` allowed, but `class="language-x"` on `code` is dropped (no syntax highlight classes were ever used).
- `MarkdownInput` preview: placeholder HTML literal; `markdown={false}` mode skips preview. Preview must display exactly what the read-only views will show (same shared function, block mode).
- Trash descriptions: server-rendered HTML passed to `<Markdown content=...>`; marked re-parse of HTML is idempotent-ish but could mangle (indented code blocks). Prefer: trash pages render server HTML via the sanitized path without re-parse, or let shared `Markdown.svelte` accept `html` prop. Flag in Open Questions.
- Quality profile `description` is already `<p>...</p>` block HTML placed inside `text-xs` div; do not double-sanitize in a way that changes it (sanitizing sanitized output is idempotent for the current allow-list, verify by test).
- SSR: shared function runs on server (SSR render of pages) and client hydrate; output must be deterministic to avoid hydration mismatch (pure function, yes).
- `marked.parse` may return `Promise` if `async` option enabled; keep sync and cast.

## Success Criteria

- Exactly one file under `src/` imports `marked`: `lib/shared/markdown/*.ts`; `grep -rn "from 'marked'" src` returns one module (dir). Server `lib/server/utils/markdown/markdown.ts` re-exports (or callers updated) with all three server import sites unchanged/working.
- Unit test (`src/tests/shared/markdown*.test.ts`, `Deno.test`; add alias in `scripts/test.ts` if desired) asserts: `<script>` stripped; `onerror`/`onclick` stripped incl. unquoted; `javascript:` href/src neutralized (incl. entity-encoded); null/undefined/'' -> `''`; inline mode yields no `<p>`; links, `code`, tables, lists, `br` (two-space), `del` survive.
- All eight client files use the shared function; local `parseMarkdown`/`renderMarkdown` copies deleted.
- `svelte/no-at-html-tags` enabled in `eslint.config.js`; `deno task lint` passes with the remaining sinks explicitly justified; reintroducing raw `marked` + `{@html}` fails lint (consider also `no-restricted-imports` for `marked` outside shared dir to enforce "one module imports marked").
- `deno task check` and `deno task test` pass; manual smoke: CF card/table, regex table/card, QP card, diff pages, MarkdownInput preview render identically for benign markdown.

## Open Questions

1. Harden existing regex sanitizer, or switch to marked-renderer escaping of raw HTML (+URL scheme check)? Recommended: the latter; confirm raw HTML in PCD descriptions is not an intended feature (current sanitizer already drops all non-allow-listed tags).
2. Should shared API be `parseMarkdown(md, {inline?: boolean})` or two functions? Needed for 5 inline sites.
3. Scope of "one allow": accept per-line disables for `Table.svelte` (x3), `JsonView` (x2), `CodeBlock`, QP CardView:141, or fix them (QP CardView -> use shared sink; Table keeps one justified disable)? Does the issue want the Table `html` contract hardened (metadata-profiles description:93, unescaped `row.name` cells) as a separate ticket?
4. Add `rel="noopener noreferrer"`/`target` to rendered links? Currently links open in same tab with no rel.
5. Trash/quality-profile descriptions: keep server pre-render + `{@html}` and re-parse in `Markdown.svelte` (current), or move to raw-markdown payload and render client-side via shared module?
6. Extend allow-list for table `align`, `tfoot`, `sup/sub`, task-list `input`? Default no (preserve server behavior).
7. Remove unused `stripMarkdown` and dead `readmeHtml` output (`databases/[id]/config/+page.server.ts:36,42`) or leave?
8. Re-export from server: keep `$utils/markdown/markdown.ts` as thin `export * from '$shared/markdown/...'` (as planned) or update the three importers directly and delete the file?
