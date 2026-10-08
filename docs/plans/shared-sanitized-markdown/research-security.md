# Security Research: shared-sanitized-markdown (YAN-560)

## Executive Summary

- **Decision: adopt `xss` (js-xss), with explicit project allowlist and stricter URL policy. Do not move regex sanitizer unchanged or rewrite HTML parsing in-house.** Proven bypasses remain release blockers. String-based parser fits browser and DOM-free Deno server. **Confidence: High** for existing vulnerability; **Medium** for dependency choice pending runtime/build tests.
- Sanitize after both `marked.parse` and `marked.parseInline`. Include preview, change review, Table markdown cells, server-rendered quality-profile descriptions, and TRaSH render paths. Authentication does not make remote PCD content trustworthy.
- Escape raw HTML with instance-local `renderer.html` as defense-in-depth if product accepts raw HTML becoming literal text. Never substitute renderer escaping for final sanitization: markdown links/images still carry attacker-controlled URLs.
- Wider Table cells contain separate unescaped PCD fields. Record follow-ups; do not claim six-component migration removes every stored-XSS sink.

Scope/date: repo inspection and dependency checks, **2026-10-07**. Prior findings reused from [research-external.md](research-external.md) and [research-business.md](research-business.md); bypass research not repeated. No application code changed.

## Findings by Severity

### CRITICAL — Hard Stops

| Finding                                  | Evidence / confidence                                                                                                                                                                                                                                       | Required action                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Stored XSS in markdown sinks             | Client `marked` output reaches `{@html}` without sanitization; remote PCD descriptions and change payloads are untrusted. Server regex preserves unquoted attributes and encoded dangerous schemes. Local source + prior live probes. **Confidence: High**. | Replace sanitizer during shared-module move; all inline/block paths must sanitize before HTML insertion. |
| Regex sanitizer is not security boundary | `server/utils/markdown/markdown.ts:76-84` uses replacement on matching quoted attributes, retaining unmatched attacker text. Tag parsing fails on quoted `>`. **Confidence: High**, direct inspection.                                                      | No regex HTML parser rewrite. Parser-backed allowlist, URL checks, negative tests mandatory.             |

### WARNING — Must Address

| Finding                                     | Evidence / confidence                                                                                                                                                                                                                                                                | Required action                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xss` defaults exceed required policy       | Upstream `safeAttrValue` accepts `tel:`, `ftp:`, `data:image/`, protocol-relative paths; default tags include media, `target`, and broad attributes. [Source](https://github.com/leizongmin/js-xss/blob/master/lib/default.js). **Confidence: High**, source checked.                | Supply explicit tag/attribute map and URL callback; never use bare `xss(html)` as final project policy.                                              |
| Quality profiles remain indirect HTML sinks | `quality-profiles/[databaseId]/views/CardView.svelte:141` inserts `profile.description`; TableView:135 returns server HTML. `server/pcd/entities/qualityProfiles/list.ts` uses current vulnerable sanitizer. **Confidence: High**, source and sibling trace.                         | Shared sanitizer must replace server path too; avoid reparsing rendered HTML through escape-raw-HTML markdown renderer.                              |
| Table has wider stored-XSS exposure         | `lib/client/ui/table/Table.svelte:192,221,343` inserts `rendered.html`. Metadata profiles page:85,93 interpolates raw name/description; delay-profile TableView:49 interpolates raw name. **Confidence: High**, source checked; exploit reach depends on writable/importable fields. | Escape plain text at producer or use Svelte/component cells. Track separate fixes if outside YAN-560; blanket lint exemption is not proof of safety. |
| Custom hooks can undo sanitizer safety      | `onTagAttr` returning HTML bypasses default serialization; `safeAttrValue` overrides default escaping. [API](https://github.com/leizongmin/js-xss). **Confidence: High**.                                                                                                            | Never return raw attribute strings; preserve attribute escaping for every emitted value. Test quote/entity breakout and URL canonicalization.        |

### ADVISORY — Best Practices

| Finding                                                  | Evidence / confidence                                                                                                                                                                       | Recommendation                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No app-configured CSP                                    | No `kit.csp` in `packages/praxrr-app/svelte.config.js`; no CSP response header in `src/hooks.server.ts`. **Confidence: High** for these files; deployment proxy not inspected.              | Follow-up report-only CSP, then enforce nonce/hash-based scripts, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors` policy. CSP supplements sanitizer, never replaces it. |
| Remote images leak viewing metadata                      | Browser fetch exposes IP and potentially referrer to image host. **Confidence: High**, browser behavior; product policy unsettled.                                                          | Preserve images for compatibility initially; consider opt-out, host restriction, or restrictive referrer policy. No server-side image fetch introduced.                           |
| Highlighted HTML sinks need separate trust justification | `CodeBlock.svelte:33` and `JsonView.svelte:34,47` use highlight.js `.value`, not direct user HTML. **Confidence: Medium**, source flow inspected, dependency output not dynamically tested. | Keep scoped lint comments and regression test for `<img onerror>` input as escaped code. Do not pass highlight spans through markdown allowlist.                                  |
| Lint cannot infer HTML provenance                        | `no-at-html-tags` catches sinks, not raw `{html}` cell producers. **Confidence: High**, Table contract.                                                                                     | Restrict direct `marked` imports to shared module; narrowly justified sink exceptions; audit Table producer interpolation.                                                        |

## Authentication and Authorization

Remote repo author need not hold Praxrr session: operator syncing/browsing PCD supplies execution context. Preview also handles user-authored input. Auth, CSRF checks, and HttpOnly cookies do not stop same-origin XSS from making authenticated requests. Cookie theft is not required for impact. **Confidence: High**, source trust flow and established browser semantics.

No new endpoint, permission, or Arr field mapping required. Keep existing auth intact. This research does not verify API-key readability, credential extraction, or every authorization route; do not assert confirmed credential theft.

## Data Protection

Store original markdown unchanged; sanitize on render. Sanitization is not schema validation and should not destroy editable PCD source. Do not log malicious full content by default: descriptions may contain private URLs/text. **Confidence: High**, current preview/storage flow documented in business research.

Keep links same-tab; do not allow user `target`. If product later forces `_blank`, add trusted constant `rel="noopener noreferrer"`, not user-controlled attributes. Images permit tracking even with script-free HTML. Relative URLs can trigger same-origin GETs; state-changing GET routes must not exist. **Confidence: High** for risk, route mutation audit not performed.

## Dependency Security

**Adopt `xss@1.0.15`, exact initial pin**, subject to negative corpus and runtime checks. It is pure-string CommonJS with browser support, no DOM requirement. [npm](https://www.npmjs.com/package/xss), [source](https://github.com/leizongmin/js-xss). **Confidence: High** for architecture; **Medium** for integration until build executes.

Correction to external research: **not zero dependencies**. `npm view xss` reports `commander: ^2.20.3` (CLI only) and `cssfilter: 0.0.10`, unpacked size **145,290 bytes**; client bundle (Bundlephobia, tree-shaken browser build) is **~17.9 KB / 5.8 KB gzip**, split `xss` 8.9 KB + `cssfilter` 9.2 KB. Checked 2026-10-07:

- **Latest version: 1.0.15, published 2024-03-03** (registry `time` field). Last repo commit **2026-05-06** — repo alive, npm release cadence slow (last four: 2022-03, 2022-06, 2022-06, 2022-08, 2024-03). Low patch velocity risk; weigh in review.
- **OSV.dev queries (2026-10-07): zero known advisories** for `xss@1.0.15`, `cssfilter@0.0.10`, `commander@2.20.3`. Absence of advisories is not a guarantee; own tests required.
- Registry `modified` 2026-02-11 reflects metadata, not code.

Sources inspected 2026-10-07: npm registry/package (publication metadata separately queried), upstream README/default.js (undated, current branch; published version must be compared), OSV.dev API, security databases below. Search query executed: `leizongmin js-xss npm xss package vulnerability CVE 2025 2026 maintained`. Broad search yielded unrelated CVEs; no proof of vulnerability absence.

Repo declares `marked` in **root** `package.json` (`^15.0.6`) and `deno.json` imports (`npm:marked@^15.0.6`); `deno.lock` resolves 15.0.12. Mirror same pattern: root package dependency `"xss": "1.0.15"`, import map `"xss": "npm:xss@1.0.15"`, shared bare import `from 'xss'`, updated lockfile via normal project tooling. No package-local manifest needed unless implementation discovers different tooling. **Confidence: High**, inspected declarations.

Verify Deno tests, server check, Vite client build, SSR output parity, and Deno compile. `commander` belongs CLI graph, but verify bundle rather than assuming exclusion; `cssfilter` remains imported even when style is forbidden. No CDN runtime script.

Sources inspected 2026-10-07: npm registry/package (publication metadata separately queried), upstream README/default.js (undated, current branch; published version must be compared), security databases below. Search query executed: `leizongmin js-xss npm xss package vulnerability CVE 2025 2026 maintained`. Broad search yielded unrelated CVEs; no proof of vulnerability absence.

## Input Validation

### Exact HTML allowlist

All unspecified tags and attributes forbidden. No global attributes.

| Tags                                                                                                                | Allowed attributes / value constraints                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p`, `br`, `hr`, `strong`, `em`, `del`, `pre`, `blockquote`, `ul`, `li`, `h1`–`h6`, `table`, `thead`, `tbody`, `tr` | None                                                                                                                                                                                                       |
| `code`                                                                                                              | None; fenced code text preserved, `language-*` class intentionally dropped (current server behavior). Add narrowly constrained class only if syntax highlighting required.                                 |
| `ol`                                                                                                                | `start`: integer only, needed for marked ordered list beginning other than 1.                                                                                                                              |
| `a`                                                                                                                 | `href`, `title`; URL policy below; title attribute always escaped.                                                                                                                                         |
| `th`, `td`                                                                                                          | `align`: exactly `left`, `center`, or `right`.                                                                                                                                                             |
| `img`                                                                                                               | `src`, `alt`, `title`; image URL policy below. Keep existing image compatibility; no `srcset`, `style`, `on*`, `loading` from source.                                                                      |
| `input`                                                                                                             | `type`, `checked`, `disabled`; only canonical disabled checkbox elements, `type="checkbox"`, `disabled` forced; `checked` boolean by presence. Drop entire non-checkbox input, do not merely strip `type`. |
| `u`, `ins`                                                                                                          | None; compatibility with prior allowed raw HTML, not native GFM requirements.                                                                                                                              |

Task checkbox policy needs tag-level handling: simple attribute allowlist permits `type=text` and enabled controls. Prefer canonical rendering from task tokens; sanitizer still enforces checkbox-only and disabled. Do not add `form`, `button`, `textarea`, `svg`, `math`, `iframe`, `object`, `embed`, `script`, `style`, `id`, `name`, arbitrary `class`, event handlers, `data-*`, or `aria-*` without concrete need. **Confidence: High**, marked GFM shape from sibling research; `ol[start]` requires regression check.

### URL policy

- `a[href]`: only `http:`, `https:`, `mailto:`, relative references and fragments.
- `img[src]`: only `http:`, `https:`, relative references; no `mailto:` or fragment-only image.
- Reject `javascript:`, `vbscript:`, `data:` (including SVG), `blob:`, `file:`, `ftp:`, `tel:` and unknown schemes. Reject protocol-relative `//host`, backslash variants, and ASCII controls. This is deliberately stricter than upstream defaults.
- Use sanitizer attribute decoding first (`friendlyAttrValue`); reject control characters in original/decoded value rather than turning obfuscated schemes into relative URLs. Classify scheme case-insensitively; explicit scheme must match allowlist. Parse with native `URL` against fixed dummy HTTPS base to check actual protocol; recognize relative references by absence of scheme, not broad “does not start with javascript” regex. Do not percent-decode a URL repeatedly or treat percent-encoded colon as actual scheme.
- Serialize decoded validated attributes with library escaping. In custom `safeAttrValue`, retain `escapeAttrValue` for non-URL attrs too. Never reinsert rejected original strings. Invalid URL becomes missing/empty attribute (no navigation); link text and image alt remain.

**Confidence: High** for policy necessity; **Medium** for callback mechanics until tested against published version and browser parsing.

### Concrete unit-test corpus

Run raw HTML cases through `sanitizeHtml`; run same cases through both markdown modes (raw HTML escaped if renderer policy enabled). Assertions must check effective tags/attributes, not require substring `onerror` absent from harmless escaped text.

| Input                                                                                      | Expected outcome                                                                                                  |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `null`, `undefined`, `''`                                                                  | Empty rendered string.                                                                                            |
| `<img src=x onerror=alert(1)>`                                                             | Sanitizer retains safe relative `src`, removes handler; markdown escape policy displays raw HTML as text.         |
| `<a href=javascript:alert(1)>x</a>`                                                        | No executable href; text `x` retained.                                                                            |
| `<a HREF="  JaVaScRiPt:alert(1)">x</a>`                                                    | Dangerous href removed/empty.                                                                                     |
| `<img src="x"/onerror=alert(1)>`                                                           | No event attribute survives parser serialization.                                                                 |
| `<a href="java&#115;cript:alert(1)">x</a>`                                                 | Encoded scheme rejected.                                                                                          |
| `<a href="jav&#x09;ascript:alert(1)">x</a>`                                                | Control-obfuscated scheme rejected.                                                                               |
| `<a href="javascript&colon;alert(1)">x</a>`                                                | Named colon obfuscation rejected.                                                                                 |
| `<a href="data:text/html,<script>alert(1)</script>">x</a>`                                 | No data href.                                                                                                     |
| `![x](javascript:alert(1))`, `![x](data:image/svg+xml;base64,PHN2Zz4=)`                    | Image lacks unsafe src; no script-capable URL.                                                                    |
| `[x](javascript:alert(1))`, `[x](vbscript:msgbox(1))`                                      | Text preserved, unsafe href absent.                                                                               |
| `<script>alert(1)</script><svg onload=alert(1)></svg><math><mi>x</mi></math>`              | No active script/SVG/MathML nodes; sanitizer removes script body; markdown raw-HTML policy escapes text instead.  |
| `<a title='x" onmouseover="alert(1)' href="/ok">x</a>`                                     | Single escaped title, safe href, no extra attribute.                                                              |
| `<a href="/ok" title="a>b">x</a>`                                                          | Title round-trips as text; no parser truncation or breakout.                                                      |
| `<p style="background:url(javascript:alert(1))" id="location" name="cookie">x</p>`         | No style/id/name (CSS injection and DOM clobbering excluded).                                                     |
| `<input type="text" value="fake"><input type="checkbox" checked>`                          | Text input dropped; remaining checkbox disabled, no value/name.                                                   |
| `<th align="left" onclick="alert(1)">x</th><td align="bogus">y</td>`                       | Allowed alignment only; handler and invalid alignment removed.                                                    |
| `[a](https://example.com "title")`, `[b](HTTP://example.com)`, `[c](mailto:a@example.com)` | Valid anchor URLs/title preserved.                                                                                |
| `[x](/path)`, `[x](../path)`, `[x](guide.md)`, `[x](?tab=1)`, `[x](#section)`              | Safe relative/query/fragment references preserved.                                                                |
| `[x](//evil.example)`, `[x](ftp://example.com)`, `[x](tel:123)`                            | Hrefs rejected by chosen stricter policy.                                                                         |
| `**bold** *em* ~~del~~`, inline backticks, fenced code containing `<img onerror=...>`      | Required tags survive; code content remains escaped, never becomes image.                                         |
| GFM aligned table; `3. item`; `- [x] done\n- [ ] todo`                                     | Table align, ordered start=3, checked/unchecked disabled task boxes retained.                                     |
| `![x](https://example.com/i.png "title")`                                                  | Safe image src/alt/title retained.                                                                                |
| Raw `<u>x</u><ins>y</ins><br>`                                                             | Sanitizer preserves compatibility tags; markdown escape policy renders literal tags (explicit product trade-off). |
| Sanitization twice, SSR/client same fixture, inline `hello`                                | Idempotent sanitizer, deterministic output, inline result has no wrapping `<p>`.                                  |

Add browser smoke payload stored in actual PCD description and change preview; assert no sentinel script execution, no dangerous attribute/scheme in DOM. String tests alone do not prove HTML-parser differential safety.

## Infrastructure Security

CSP gap advisory only: source files lack CSP; reverse proxy may set one. No DOM/server image fetch necessary. Deno permission set need not expand for sanitizer. Runtime CSRF is explicitly delegated in Svelte config to server security code; do not “fix” `checkOrigin: false` as part of markdown work without reading that implementation. **Confidence: High**, config comment.

No new filesystem/network access in shared utility. Long readmes may consume CPU/memory; avoid arbitrary size limit in rendering until contract established. Test a large fixture and consider import-boundary content limits as follow-up. **Confidence: Medium**, no benchmark performed.

## Secure Coding Guidelines

1. One shared module owns marked configuration and sanitizer instance. Both inline/block functions sanitize final output; async parsing remains disabled.
2. Use isolated `Marked` instance. Do not mutate global marked renderer or trust pre-sanitized-looking HTML.
3. Optional `renderer.html({ text })` escapes `&`, `<`, `>`, quotes as needed before final sanitize. Retain marked default link/image renderers plus final URL checks; custom string renderers are extra injection surface.
4. Do not modify sanitized HTML by concatenating unescaped remote data. Brand/type annotation can document provenance but is not runtime security.
5. Keep narrowly scoped lint exemptions. Highlighter output, static badges, escaped Table text, markdown HTML need different justifications.
6. Shared plain-text utility output must be inserted as text, never assumed HTML-safe. Removing tags is not contextual escaping.

Other sink classification (paths under `packages/praxrr-app/src/`):

| Sink/producer                                                        | Classification                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown/MarkdownInput, CF cards, FieldDiffTable, TestsDiffTable     | Unsanitized markdown; primary scope.                                                                                                                    |
| CF and regex TableView description `{html}`                          | Indirect unsanitized markdown; same scope even though no local `{@html}`.                                                                               |
| QP CardView/TableView description                                    | Server-rendered HTML from vulnerable sanitizer; covered by shared server path.                                                                          |
| Metadata profile description/name and delay-profile name             | Raw unescaped PCD data; separate stored-XSS follow-up.                                                                                                  |
| Arr logs `row.level`/`row.logger`, settings logs `row.level`         | Unescaped remote/log values in static wrappers; potential XSS, provenance/validation audit needed. **Confidence: Medium** for exploitability.           |
| `arr/upgrades/info` labels/operators                                 | Unescaped table wrapper interpolation; likely catalog-controlled, not proven attacker-controlled. **Confidence: Low** for exploitability; audit origin. |
| CF names/tags, regex pattern/id, snapshot descriptions, canary names | Observed explicit `escapeHtml`; not direct raw-data sinks for inspected producers. Still check URL-specific escaping where used as href.                |
| CodeBlock/JsonView                                                   | Highlight.js-produced markup; separate constrained generator, not arbitrary raw HTML.                                                                   |
| Static TRaSH boolean badges                                          | Trusted static literals, no untrusted interpolation.                                                                                                    |

## Trade-off Recommendations

| Option                          | Benefit                                                                                   | Cost / verdict                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `xss` + explicit policy         | DOM-free parser, handles quoted/unquoted attrs, established entity decoding/serialization | Small dependency graph, stale release cadence, custom URL policy tests. **Choose.**                                               |
| In-house HTML allowlist rewrite | No dependency                                                                             | Recreates parser, entity decoding and browser differential risks; proven local failures. **Reject.**                              |
| Escape raw HTML + sanitizer     | Reduces attack surface; still permits generated GFM                                       | Existing raw `<br>`, `<u>`, `<ins>` authors see literal tags. **Recommend after product confirmation**, not sanitizer substitute. |
| Preserve sanitized raw HTML     | Highest compatibility; pre-rendered TRaSH/QP HTML remains usable                          | Parser receives full hostile HTML. Acceptable with constrained library policy + corpus if escaping breaks contract.               |

Do not import previously rendered HTML into markdown parser after enabling raw HTML escaping. Keep distinct markdown-source and sanitized-HTML paths, or return raw markdown from endpoints. No new general-purpose HTML abstraction required.

## Open Questions

- Raw HTML compatibility: escape all author HTML, or preserve currently allowed tags? GFM does not need raw HTML for tables/tasks/code; pre-rendered TRaSH/QP descriptions do.
- Images: preserve remote http(s)/relative images for compatibility, or disable remote loads for privacy? URL-safe does not mean tracking-safe.
- Wider Table XSS: include minimal plain-text escaping now, or explicit blocking follow-up? YAN-560 completion must state remaining exposure.
- CSP may exist at deployment proxy; not inspected. Rollout must test Svelte hydration, dev HMR, and inline styles before enforcement.
- Exact installed-version advisory status, release timestamp, and measured bundle size require checks below; absence of search result is not assurance.

Research limitations: focused source inspection, not full auth/API audit. No dependency installed in repo, no application build/tests run. All file-based evidence inspected 2026-10-07; upstream README/default.js undated and may differ from npm publication. External security status is point-in-time, not guarantee.
