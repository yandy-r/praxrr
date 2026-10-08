# External Research: shared-sanitized-markdown (YAN-560)

## Executive Summary

- Repo pins `marked` via Deno import map: `npm:marked@^15.0.6`, resolved **15.0.12** (deno.lock). Marked v15 output is **never sanitized**; upstream docs say explicitly to sanitize output with DOMPurify / sanitize-html / js-xss. async `marked.parse` returns string sync unless `async:true` (not used here).
- In-house `sanitizeHtml` in `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts` is **unsound as-is** — local runtime probe (2026-10-07, Deno) showed live bypasses (details below). Moving it verbatim into `$shared/` does not close stored-XSS from remote PCD git content.
- Both mature no-DOM options (`js-xss`, sanitize-html-on-htmlparser2) are pure-string, run in browser and Deno without jsdom. DOMPurify is **DOM-only**; isomorphic reuse on server/SSR requires jsdom (or jsdom-backed isomorphic-dompurify) — heavy for compiled Deno binary and Vite client bundle. **Recommend `xss` (js-xss, pure string, zero DOM dep) unless team wants to harden regex in-house + add fuzz-style tests.** sanitize-html repo is **archived Feb 2026** (moved to Apostrophe monorepo) — avoid new adoption.
- ESLint: `eslint-plugin-svelte` resolved **3.20.0**; rule `svelte/no-at-html-tags` exists, off by default (not in `recommended`, on in `flat/recommended`), disable per-line in `.svelte` templates via HTML comment `<!-- eslint-disable-next-line svelte/no-at-html-tags -->` (requires `svelte/comment-directive`, included in `plugin:svelte/base` which repo already extends via `svelte.configs.base`).
- Six client `marked` call sites confirmed unsanitized (`Markdown.svelte`, `MarkdownInput.svelte` preview, 2× custom-formats views, 2× databases changes diff views); `QualityProfiles CardView` `{@html profile.description}` also raw. Markdown famous `javascript:`-link vector is live: `[x](javascript:alert(1))` renders `<a href="javascript:...">` and current sanitizer only strips it when quoted exactly.

## Primary APIs

### marked 15.0.12 (npm:marked@^15.0.6)

- `marked.parse(md: string): string` (sync unless `async:true`), `marked.parseInline(md): string`. Link/image tokens keep raw `href` (`javascript:`, `data:`, `vbscript:` pass through). No `sanitize` option (removed in v0.4+).
- Safe-link hardening pattern: `marked.use({ renderer: { link({href,title,tokens}) { …validate href… } } })` OR `walkTokens` to rewrite `token.href` before render. Renderer `link`/`image` overrides + `html` override (to escape raw inline HTML) are token-typed (USING_PRO.md).
- `marked.use({ hooks: { postprocess(html) { return sanitize(html); } } })` — official sanitize-output hook; proves intent: sanitize **after** parse, not inside renderer.
- Docs: <https://marked.js.org/> , <https://github.com/markedjs/marked> (README "Marked does not sanitize"; USING_PRO.md renderer/hooks).

### DOMPurify / isomorphic-dompurify

- `DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true }, ALLOWED_TAGS/ATTR, FORBID_TAGS/ATTR, ALLOWED_URI_REGEXP })`. DOM-only; server needs `new JSDOM('').window` passed in. isomorphic-dompurify wraps this; server path pulls **jsdom** (heavy, needs periodic `clearWindow()` in long-lived processes; happy-dom explicitly unsafe per DOMPurify README).
- Docs: <https://github.com/cure53/DOMPurify> , <https://github.com/kkomelin/isomorphic-dompurify> .

### js-xss (leizongmin/xss)

- `filterXSS(html, { whiteList, stripIgnoreTagBody: ['script'], allowCommentTag, onTagAttr, safeAttrValue, css })`. Pure string parser, no DOM, works in browser + Deno (`npm:xss` / `jsr` equivalent). Default whitelist already strips `on*`, `<script>`, `javascript:` hrefs (safeAttrValue blanks them). `stripIgnoreTagBody:['script']` drops script bodies like current behavior.
- Docs: <https://github.com/leizongmin/js-xss> .

### sanitize-html — do NOT adopt

- Repo **archived 2026-02-26**, README points to Apostrophe monorepo (`apostrophecms/apostrophe/tree/main/packages/sanitize-html`). htmlparser2-based, no DOM, but dead upstream → reject for new dep.

### eslint-plugin-svelte 3.20.0

- Rule doc: <https://sveltejs.github.io/eslint-plugin-svelte/rules/no-at-html-tags/> — "`{@html}` is XSS footgun; if content is sanitized, disable rule". Enable globally: `'svelte/no-at-html-tags': 'error'` in eslint.config.js.
- Per-line allow in `.svelte` template: `<!-- eslint-disable-next-line svelte/no-at-html-tags -- Description -->` on line above `{@html …}` (comment-directive rule, already active via `svelte.configs.base` in repo's eslint.config.js). Syntax verified in rule + comment-directive docs: <https://sveltejs.github.io/eslint-plugin-svelte/rules/comment-directive/> .

## Libraries and SDKs

| Option                                   | Isomorphic w/o DOM           | Deps/size                                       | Maintenance (Oct 2026)                             | Verdict                                                                                                    |
| ---------------------------------------- | ---------------------------- | ----------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| In-house regex `sanitizeHtml` (current)  | yes (pure string)            | zero                                            | unmaintained one-off, **proven bypasses** (below)  | Ship only with rewrite + negative tests; cheapest diff, highest review burden                              |
| `xss` (js-xss) ~1.x                      | yes                          | zero-dep, tiny                                  | active, 10k+ stars, Deno/npm compatible            | **Recommended if adding one dep**: allowlist parser handles quoting/entity/obfuscation cases regex misses  |
| DOMPurify + jsdom / isomorphic-dompurify | no (needs jsdom server-side) | jsdom ~MBs, slow cold start, `clearWindow` mgmt | DOMPurify active (v3.4.x); isomorphic wrapper thin | Reject for `$shared/`: breaks "pure string fns, no DOM" constraint, bloats client bundle + compiled binary |
| sanitize-html                            | yes (htmlparser2)            | small                                           | **archived Feb 2026**                              | Reject                                                                                                     |

## Integration Patterns

**Recommended shape (either sanitizer choice):**

- `packages/praxrr-app/src/lib/shared/markdown/markdown.ts` — only module importing `marked`. Exports `parseMarkdown(md): string` (sanitized HTML), `parseMarkdownInline(md): string`, `stripMarkdown(md): string`. No `window`/`document` refs; pure string in/out so Vitest/Deno tests + Vite browser bundle + Deno SSR all import it.
- Server `server/utils/markdown/markdown.ts` becomes thin re-export (or deleted; update its ~N importers).
- All six client sinks + `quality-profiles CardView` import from `$shared/markdown`. Single `{@html}` allow: the shared `Markdown.svelte`-style sink keeps one `<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by $shared/markdown -->`; rule set to `error` globally catches future raw sinks.
- Defense in depth: `marked.use({ renderer: { link, image } })` to neutralize `javascript:`/`data:text/html`/`vbscript:` at token level **plus** post-parse sanitize (covers raw inline `<img onerror>` markdown passes through — marked outputs raw HTML blocks verbatim).

**Link allowlist sketch:** allow `http,https,mailto,tel,relative,#,/`. Reject rest → render text or `href="#"`. Same rule client+server since it lives in shared module.

## Constraints and Gotchas

- **Current sanitizer bypasses (probed 2026-10-07 against exact repo code):**
  1. Unquoted attrs pass through untouched: `<img src=x onerror=alert(1)>` → unchanged (regexes require quotes). **Exploitable.**
  2. Unquoted `href=javascript:...` untouched → unchanged. **Exploitable** (`[x](javascript:alert(1))` emits exactly this shape).
  3. Case/whitespace variant `<a HREF="  javascript:...">` kept (attr filter lowercases name for check but re-emits original name; pre-strip regex misses leading spaces). Browser executes case-insensitive `HREF` + trims URL → **exploitable**.
  4. `onerror` without quotes after `/>` (`<img src="x"/onerror=alert(1)>`) kept — attr regex requires `=` + quotes and tag-split regex chokes on `/>`. **Exploitable.**
  5. Unquoted `onclick` (`<p onclick=alert(1)>`) kept.
  6. `data:text/html` hrefs kept (only `javascript:` pre-stripped, quoted-only). `vbscript:` kept.
  7. Entity-obfuscated `jav&#x09;ascript:` kept (no entity decode before check; browser decodes on parse).
  8. Attribute value containing `>` breaks tag regex (`title="x>y"` splits tag early) — correctness bug, potential smuggling.
  9. Minor: `<script>never closed` → text `never closed` leaks (acceptable); `<svg onload>` stripped only because `svg` not allowlisted (defense by luck).
- marked emits raw inline HTML verbatim (by design) — sanitizer must assume arbitrary HTML input, not "markdown-shaped" HTML.
- `marked.parse` sync return type: `string` (cast `as string` still needed under TS types returning `string | Promise<string>`); keep cast in shared module, single place.
- `stripMarkdown` = sanitize-then-strip-tags is correct order (current code already does); keep.
- Deno import-map: add `"xss": "npm:xss@^1.0.15"` (or chosen) to root `deno.json` imports if dep chosen; browser bundle via Vite handles npm specifier. No new dep → zero config change.
- ESLint flat config: add rule in main `rules` block; per-file `files: ['**/*.svelte']` override not needed since directive comments are inline. `reportUnusedDisableDirectives` optional.
- Tests: `deno test` unit file asserting `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` inputs produce output containing neither `script` nor `onerror`; add `javascript:` link case + entity-obfuscated case.

## Code Examples

```ts
// $shared/markdown/markdown.ts — renderer-level link safety (marked v15 token API)
import { marked } from 'marked';

const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/|[^:/?#]*([/?#]|$))/i;
marked.use({
  renderer: {
    link({ href, title, tokens }: any) {
      const raw = String(href ?? '')
        .trim()
        .replace(/&#x0?9;/gi, '');
      const text = this.parser.parseInline(tokens);
      if (!SAFE_HREF.test(raw) || /^data:text\/html/i.test(raw)) return text;
      const t = title ? ` title="${title}"` : '';
      return `<a href="${raw}"${t}>${text}</a>`;
    },
  },
});
```

```ts
// Option A (recommended): js-xss post-parse — pure string, no DOM
import xss from 'xss';
export function parseMarkdown(md: string | null | undefined): string {
  if (!md) return '';
  const html = marked.parse(md) as string;
  return xss(html, { stripIgnoreTagBody: ['script'] });
}
```

```svelte
<!-- single allowed sink: shared Markdown.svelte -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -- output sanitized by $shared/markdown -->
{@html html}
```

```js
// eslint.config.js — enable globally
rules: { 'svelte/no-at-html-tags': 'error' }
```

## Open Questions

1. New dep (`xss`) vs hardened in-house? Cost = one import-map line + audit of `xss` default whitelist vs current tag set (`u/ins/del/table` — check `xss` defaults cover; else pass explicit `whiteList`). Decision for implementer + reviewer.
2. `img[src]` policy: current allows any `src` (including `data:` images). Keep or restrict to http(s)/relative/data:image? Remote PCD content could embed tracking pixels — product call.
3. `stripMarkdown` consumers: any caller relying on current leaky output (e.g. search index containing tag text)? grep importers before changing behavior.
4. Should `html` renderer token be overridden to escape raw inline HTML entirely (strictest) instead of sanitizing it (current approach preserves tables/code)? UX call — sanitizer path preserves more formatting.
5. Deno compile: if `xss` chosen, verify `deno compile` bundles `npm:xss` cleanly (pure JS, expected fine; confirm in implementation).

## Sources

- marked docs (sanitize stance, renderer/link tokens, postprocess hook): <https://marked.js.org/> , <https://github.com/markedjs/marked/blob/master/README.md> , <https://github.com/markedjs/marked/blob/master/docs/USING_PRO.md>
- js-xss API (filterXSS, stripIgnoreTagBody, safeAttrValue): <https://github.com/leizongmin/js-xss>
- DOMPurify server-side/jsdom requirement + happy-dom warning: <https://github.com/cure53/DOMPurify>
- isomorphic-dompurify (jsdom wrapper, clearWindow): <https://github.com/kkomelin/isomorphic-dompurify>
- sanitize-html archived notice: <https://github.com/apostrophecms/sanitize-html>
- svelte/no-at-html-tags rule: <https://sveltejs.github.io/eslint-plugin-svelte/rules/no-at-html-tags/>
- svelte/comment-directive (HTML-comment disables): <https://sveltejs.github.io/eslint-plugin-svelte/rules/comment-directive/>
- Repo pins verified 2026-10-07: root `deno.json` (`marked: npm:marked@^15.0.6`), `deno.lock` (marked 15.0.12, eslint-plugin-svelte 3.20.0), `eslint.config.js` (`svelte.configs.base`), `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts`.
