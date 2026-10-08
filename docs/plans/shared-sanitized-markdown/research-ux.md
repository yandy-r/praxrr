# UX Research: shared-sanitized-markdown (YAN-560)

## Executive Summary

Six client renderers (`marked` → `{@html}`, unsanitized) consolidate onto one shared renderer with sanitization.
UX mandate: **zero visual change**. Same inline vs block split, same style hooks (`.markdown`, `.prose-inline`,
`.prose`), same truncation, same preview. Only behavioral deltas allowed: safe link attrs and stripped
unsafe HTML. Like-for-like swap; no redesign.
**Confidence**: High (all call sites read, 2026-10-07).

## User Workflows

- **Card/table browsing** (`custom-formats/.../views/CardView.svelte` `line-clamp-2`,
  `TableView.svelte` inline `parseInline`, `regular-expressions/.../views/TableView.svelte`, `Markdown.svelte`
  `maxLines` prop): descriptions truncated mid-render. Sanitizer must not break clamping (no
  block wrapper that defeats `-webkit-box`, no unclosed tag breaking layout).
- **Editor authoring** (`MarkdownInput.svelte` toolbar → Preview toggle): preview is WYSIWYG promise.
  Preview must use shared renderer + identical sanitizer config, else author sees formatting that readers don't.
- **Diff review** (`FieldDiffTable.svelte`, `TestsDiffTable.svelte`, block `marked.parse` in `.prose`
  wrappers): before/after columns compared side by side. Sanitizer must treat both columns identically;
  stripped content in one column must not shift meaning of comparison.
- **Link following**: today rendered `<a>` has no `target`/`rel` (verified: no `target=`/`_blank` at any
  call site). Clicks navigate same-tab. Any change (e.g. new-tab) is a behavior change — decide explicitly.

## UI/UX Best Practices

- **Style parity**: keep all three style hooks. `Markdown.svelte` `.markdown` span (`text-xs`,
  `code`/`strong`/`a` globals + dark variants); table/card `.prose-inline` duplicates; diff tables use
  app.css `.prose` (custom, no typography plugin — `app.css` defines `.prose` by hand). Shared renderer
  must accept a `variant: 'inline' | 'block'` and emit same wrapper-neutral HTML so each call site's CSS
  still matches. Never centralize wrapper classes without auditing every call site.
- **Inline vs block**: `parseInline` (cards, tables, `Markdown.svelte` default) vs `parse` (editor preview,
  diff tables). Preserve exactly — switching tables to block output injects `<p>` margins inside clamped rows.
- **Links**: GitHub pattern is `target="_blank" rel="noopener noreferrer"` on rendered markdown links.
  Current app opens same-tab. Recommendation: keep same-tab (must), or switch only with explicit product
  sign-off (not silent). At minimum add `rel="noopener"` if `target` ever set.
- **Truncation**: `line-clamp-2` / `maxLines` rely on sanitized HTML being tag-balanced. Sanitize _before_
  clamp styling applies (it does — CSS clamp), and ensure sanitizer never emits unclosed tags. No
  "expand to read more" exists — out of scope.
- **a11y**: rendered headings inside cards break heading hierarchy (card title should be the heading;
  markdown `#` inside body renders `h1`). GitHub renders user markdown headings downgraded in constrained
  contexts. Must: keep current heading output (parity) but long-term consider demoting `h1–h3` in inline
  variant. Links keep underline + accent color (already in styles); sanitizer must preserve `href` text so
  link purpose stays readable. Code spans keep monospace bg (already styled).

## Error Handling

- **Stripped content**: show text, don't vanish it. DOMPurify-style default drops `<script>`/event attrs
  but keeps text nodes — correct behavior. Never blank a whole description because one tag was unsafe;
  users (especially diff reviewers) must see _something_ where content was removed. Optional: `title`
  tooltip on sanitized links is out of scope.
- **Empty/whitespace**: `Markdown.svelte` renders nothing when empty (`{#if html}`); tables return `''`.
  Preserve: no "Nothing to preview" leakage outside editor (that string belongs only to `MarkdownInput`
  preview empty state).
- **Markdown parse failure**: `marked` rarely throws, but shared renderer should fail to plain-text escape,
  never raw `{@html}` of unsanitized input.

## Performance UX

- Tables render one `parseInline` per row; cards use progressive list (pageSize 30). Shared renderer must
  stay synchronous and cheap (parse + sanitize, no async, no per-row DOM round-trip beyond string ops).
  Heavy sanitizer config (large allowlists, hooks) multiplied by row count = jank on first paint. Keep
  config static/singleton, not rebuilt per call.
- Preview toggle re-renders on each toggle; must feel instant (<50ms for typical description length). Same
  renderer path as tables guarantees this.

## Competitive Analysis

| Product                | Sanitizer posture                                             | UX notes relevant here                                                        |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GitHub comments/README | Allowlist HTML, `target=_blank rel=noopener`, heading anchors | Gold standard: strip silently but keep text; links new-tab                    |
| GitLab descriptions    | Similar allowlist, GFM + sanitization                         | Preview tab guaranteed identical to rendered output — parity rule to copy     |
| Stack Overflow         | Aggressive strip, no images in comments                       | Context-dependent variants (inline vs block) — same idea as our `inline` flag |

Takeaway: everyone keeps text content of stripped markup, guarantees preview==rendered, and scopes link
behavior per context. Copy all three.

## Recommendations

**Must**

1. One `renderMarkdown(source, { inline })` + one `sanitizeHtml()`; all six call sites use it, zero exceptions.
2. Pixel parity: same wrappers at call sites (`.markdown` span, `.prose-inline`, `.prose`), same
   inline/block choice per site, same `maxLines`/`line-clamp` behavior.
3. Preview (`MarkdownInput.svelte`) uses shared renderer with identical config — preview==rendered, verified by test.
4. Link behavior unchanged (same-tab, no new `target`) unless explicitly approved; add `rel="noopener"` only if `target` added later.
5. Stripped unsafe markup degrades to visible text, never silent whole-field blanking; diff columns use identical config.
6. Test matrix: inline bold/italic/code/link, block headings/lists/code, `<script>`/`<img onerror>` stripped, empty input, truncation still clamps.

**Should**

- Hoist duplicated `code`/`strong`/`a` globals (`.markdown` vs `.prose-inline` copies) into one shared stylesheet later — visual parity first, dedupe second.
- Consider demoting `h1`→`h3`-ish inside cards/tables for heading hierarchy (a11y), as follow-up only.
- Singleton sanitizer config (no per-call rebuild) for table row counts.

**Nice**

- "Expand" affordance for clamped descriptions; heading anchors in diff tables; sanitized-content indicator for authors.

## Open Questions

1. Link behavior: keep same-tab (parity) or adopt GitHub-style new-tab? Needs product call.
2. Should inline variant strip block constructs (headings/lists) or keep `parseInline` pass-through as today?
3. Sanitizer lib choice (DOMPurify vs `sanitize-html` vs custom allowlist) — server/sec researcher owns; UX only requires text-preserving strip + sync + singleton config.
