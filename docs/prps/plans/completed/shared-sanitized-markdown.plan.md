# Plan: Shared Sanitized Markdown Renderer (YAN-560 / GH #289)

## Summary

Seven client modules call `marked` directly and send the output to `{@html}` without sanitizing it, and the only sanitizer (server, regex-based) can be bypassed. Remote PCD text can therefore inject script (stored XSS). This plan replaces both with one isomorphic module, `$shared/markdown/markdown.ts`: an isolated `Marked` instance plus a `xss` (js-xss) `FilterXSS` singleton with an explicit allowlist and a strict URL policy. Every markdown sink is routed through it, confirmed raw PCD values in Table cells are escaped, and `svelte/no-at-html-tags` is enabled so new raw sinks fail lint.

## User Story

As a Praxrr operator browsing or syncing third-party PCDs, I want every description to be rendered through one sanitized renderer, so that a malicious or compromised PCD cannot run script in my authenticated session, and descriptions look the same as before.

## Problem → Solution

7 client files render unsanitized `marked` output via `{@html}`. The server regex sanitizer lets unquoted `onerror=`, unquoted or entity-encoded `javascript:`, and `data:` through → one shared `parseMarkdown` / `parseMarkdownInline` / `sanitizeHtml` (marked + js-xss allowlist + URL policy) used by every sink and re-exported for the server, with a lint rule that rejects new raw sinks.

## Metadata

- **Complexity**: Medium
- **Source PRD**: N/A (source spec: `docs/plans/shared-sanitized-markdown/feature-spec.md`)
- **PRD Phase**: N/A
- **Estimated Files**: ~20
- **Target release**: next app release from `main` (trunk-only model; no backport, no feature switch, because this is a complete security fix and not unfinished work)

## Batches

Tasks are grouped by dependency for parallel execution. Tasks in the same batch run concurrently; batches run in order.

| Batch | Tasks                   | Depends On | Parallel Width |
| ----- | ----------------------- | ---------- | -------------- |
| B1    | 1.1                     | —          | 1              |
| B2    | 2.1, 2.2                | B1         | 2              |
| B3    | 3.1, 3.2, 3.3, 3.4, 3.5 | B2         | 5              |
| B4    | 4.1                     | B3         | 1              |

- **Total tasks**: 9
- **Total batches**: 4
- **Max parallel width**: 5

## Worktree Setup

- **Parent**: /home/yandy/Projects/github.com/yandy-r/praxrr/.config/opencode/worktrees/YAN-560/ (branch: security/YAN-560-shared-sanitized-markdown)

---

## UX Design

### Before

```text
PCD description ──marked──▶ {@html} (raw: <code class=language-*>, live javascript: links,
                                      <details>/<div style>, data: images all render)
QP / TRaSH ──server regex sanitizer──▶ HTML (drops align/start/checkboxes; bypassable)
```

### After

```text
PCD description ──$shared parseMarkdown[Inline]──▶ sanitized HTML ──▶ {@html} (justified sink)
same wrappers (.markdown / .prose-inline / .prose prose-sm), same clamps, same-tab links
```

### Interaction Changes

| Touchpoint                                                         | Before                       | After                             | Notes                                          |
| ------------------------------------------------------------------ | ---------------------------- | --------------------------------- | ---------------------------------------------- |
| Link with rejected href (`javascript:`/`data:`/`//`/`tel:`/`ftp:`) | Live clickable link          | `<a>` without href, text kept     | Only visible change for malicious or odd links |
| Raw non-allowlisted HTML (`<details>`, `style`, `class`, `id`)     | Rendered on client           | Tag/attr dropped, inner text kept | Server already dropped these                   |
| Fenced code                                                        | `<code class="language-js">` | `<code>`                          | No CSS uses `language-*`                       |
| `data:` images                                                     | Rendered                     | Dropped (alt kept)                |                                                |
| Server-rendered QP/TRaSH tables/lists/tasks                        | align/start/checkbox dropped | Preserved                         | Slight improvement                             |
| MarkdownInput preview                                              | Unsanitized                  | Same renderer as readers          | Placeholder stays outside sanitizer            |
| Wrappers, line-clamp, inline-vs-block per site                     | —                            | Unchanged                         | Must not change                                |
| Metadata/delay/QP table names & descriptions                       | Raw HTML interpolation       | HTML-escaped text                 | Benign text looks identical                    |

---

## Mandatory Reading

| Priority       | File                                                                             | Lines  | Why                                                     |
| -------------- | -------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| P0 (critical)  | `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts`                  | 1-111  | Module being replaced (regex sanitizer anti-pattern)    |
| P0 (critical)  | `docs/plans/shared-sanitized-markdown/research-security.md`                      | 69-130 | Allowlist, URL policy, payload corpus                   |
| P0 (critical)  | `docs/prps/plans/.prp-research/shared-sanitized-markdown/security-researcher.md` | all    | URL guardrail steps + 22 critical test cases            |
| P1 (important) | `packages/praxrr-app/src/lib/client/ui/display/Markdown.svelte`                  | 1-30   | Main shared sink; props `content`, `inline`, `maxLines` |
| P1 (important) | `packages/praxrr-app/src/lib/shared/utils/masking.ts`                            | 1-22   | `$shared` module style                                  |
| P1 (important) | `packages/praxrr-app/src/tests/shared/security/checks.test.ts`                   | 1-19   | Test file style                                         |
| P1 (important) | `packages/praxrr-app/src/lib/client/utils/escapeHtml.ts`                         | 1-8    | Shared escaper for Table producers                      |
| P2 (reference) | `docs/prps/plans/.prp-research/shared-sanitized-markdown/tech-designer.md`       | all    | `{@html}` sink inventory + producers                    |
| P2 (reference) | `eslint.config.js`                                                               | 1-60   | Svelte config block                                     |

## External Documentation

| Topic                       | Source                                                                   | Key Takeaway                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| js-xss options              | <https://github.com/leizongmin/js-xss>                                   | `new FilterXSS({ whiteList, stripIgnoreTag, stripIgnoreTagBody, onTagAttr, safeAttrValue })`; defaults too permissive — always supply explicit `whiteList` and `safeAttrValue` |
| js-xss default URL handling | <https://github.com/leizongmin/js-xss/blob/master/lib/default.js>        | Default `safeAttrValue` allows `data:image/`, `ftp:`, `tel:`, `//`; override entirely                                                                                          |
| marked instance API         | <https://marked.js.org/using_pro>                                        | `new Marked({ gfm: true, async: false })` isolates config; `.parse()` block, `.parseInline()` inline                                                                           |
| eslint-plugin-svelte rule   | <https://sveltejs.github.io/eslint-plugin-svelte/rules/no-at-html-tags/> | Per-line `<!-- eslint-disable-next-line svelte/no-at-html-tags -->` in markup                                                                                                  |

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: packages/praxrr-app/src/lib/shared/utils/masking.ts:4-12
export function maskApiKey(key: string | null | undefined, visibleChars = 4): string {
  if (!key) {
    return '';
```

Topic folder, camelCase file, named exports, no `index.ts` barrel (`lib/shared/utils/`). Import with alias + `.ts`: `import { parseTrustedProxy } from '$shared/security/index.ts';` (`tests/base/networkTrust.test.ts:12`).

### ERROR_HANDLING

```ts
// SOURCE: packages/praxrr-app/src/lib/shared/security/origin.ts:12-21 (fail-closed URL check)
if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
// SOURCE: packages/praxrr-app/src/lib/server/utils/validation/url.ts:6
export const ALLOWED_HTTP_SCHEMES = ['http:', 'https:'] as const;
```

Sanitizer fails closed silently: a rejected URL becomes an empty attribute. No throw, no logging of the payload.

### LOGGING_PATTERN

None. The renderer is pure and does no logging (no `$logger` in `$shared`).

### SERVICE_PATTERN

```ts
// SOURCE: packages/praxrr-app/src/lib/shared/utils/dates.ts:1-11 — top /** */ purpose block
// SOURCE: packages/praxrr-app/src/lib/shared/utils/uuid.ts:7-9 — isomorphic, no Deno/DOM imports
```

Module-level `const` config and singletons; named `export function`.

### TEST_STRUCTURE

```ts
// SOURCE: packages/praxrr-app/src/tests/shared/security/checks.test.ts:1-19
/** Pure ... tests ... No DB, no mocks */
import { assert, assertEquals } from '@std/assert';
Deno.test('subject: behavior', () => { ... });
```

Flat `Deno.test('fn: case', ...)`, no `describe`. `deno task test` discovers the whole `packages/praxrr-app/src/tests` tree (`scripts/test.ts:62`); no alias is needed.

### Formatting

`.prettierrc` is authoritative for `deno task lint`: 2 spaces, `printWidth` 120, single quotes, `trailingComma: es5`, semicolons. (AGENTS.md says tabs; ignore that and follow `.prettierrc`.) Run `deno task format` before lint.

---

## Files to Change

| File                                                                                     | Action | Justification                                                   |
| ---------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| `package.json`                                                                           | UPDATE | Add `"xss": "1.0.15"` (exact pin)                               |
| `deno.json`                                                                              | UPDATE | Import map `"xss": "npm:xss@1.0.15"`                            |
| `deno.lock`                                                                              | UPDATE | Lock refresh                                                    |
| `package-lock.json`                                                                      | UPDATE | npm lock refresh (root dep + `node_modules/xss`, `cssfilter`)   |
| `packages/praxrr-app/src/lib/shared/markdown/markdown.ts`                                | CREATE | Shared renderer + sanitizer                                     |
| `packages/praxrr-app/src/tests/shared/markdown/markdown.test.ts`                         | CREATE | Security + parity corpus                                        |
| `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts`                          | UPDATE | Re-export shim; delete regex sanitizer + `stripMarkdown`        |
| `packages/praxrr-app/src/lib/client/ui/display/Markdown.svelte`                          | UPDATE | Shared fns; justified sink                                      |
| `packages/praxrr-app/src/lib/client/ui/form/MarkdownInput.svelte`                        | UPDATE | Preview via `parseMarkdown`; placeholder outside sanitizer      |
| `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/CardView.svelte`       | UPDATE | `parseMarkdownInline`                                           |
| `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/TableView.svelte`      | UPDATE | `parseMarkdownInline` in description cell                       |
| `packages/praxrr-app/src/routes/regular-expressions/[databaseId]/views/TableView.svelte` | UPDATE | `parseMarkdownInline` in description cell                       |
| `packages/praxrr-app/src/routes/databases/[id]/changes/components/FieldDiffTable.svelte` | UPDATE | Shared `parseMarkdown`                                          |
| `packages/praxrr-app/src/routes/databases/[id]/changes/components/TestsDiffTable.svelte` | UPDATE | Shared `parseMarkdown`                                          |
| `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/CardView.svelte`     | UPDATE | `{@html sanitizeHtml(profile.description)}` + justified disable |
| `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/TableView.svelte`    | UPDATE | `escapeHtml` on `row.name`, `tag.name`, `q.name`                |
| `packages/praxrr-app/src/routes/metadata-profiles/[databaseId]/+page.svelte`             | UPDATE | `escapeHtml` on `row.name`, `row.description`                   |
| `packages/praxrr-app/src/routes/delay-profiles/[databaseId]/views/TableView.svelte`      | UPDATE | `escapeHtml` on `row.name`                                      |
| `packages/praxrr-app/src/lib/client/ui/table/Table.svelte`                               | UPDATE | 3 justified disables (producers must escape/sanitize)           |
| `packages/praxrr-app/src/lib/client/ui/meta/CodeBlock.svelte`                            | UPDATE | Justified disable (highlight.js output)                         |
| `packages/praxrr-app/src/lib/client/ui/meta/JsonView.svelte`                             | UPDATE | 2 justified disables (highlight.js output)                      |
| `eslint.config.js`                                                                       | UPDATE | `'svelte/no-at-html-tags': 'error'` in the svelte block         |
| `docs/ARCHITECTURE.md`                                                                   | UPDATE | Fix stale markdown path/`stripMarkdown` mention (~line 1203)    |

## NOT Building

- `marked` upgrade (YAN-559). After this change it is a single-file bump.
- CSP (`kit.csp`). Follow-up issue.
- Link `target`/`rel` changes. Links stay same-tab.
- Remote-image privacy controls. Follow-up issue.
- Escaping Arr logs, upgrades info and settings table interpolations. Follow-up audit.
- Consolidating the duplicate local `escapeHtml` helpers. Follow-up issue.
- `index.ts` barrel, a generic HTML abstraction, a new Svelte component, an options-bag API.
- Keeping `stripMarkdown`. It has zero callers, so delete it.
- Moving rendering to the server, or data migrations. Storage stays unchanged.
- Alias in `scripts/test.ts`. The test is auto-discovered.
- Svelte component render tests. Function-level tests plus a manual smoke check are enough.

---

## Step-by-Step Tasks

### Task 1.1: Add dependency, shared module, tests, server shim — Depends on [none]

- **BATCH**: B1
- **ACTION**: Pin `xss@1.0.15` in root `package.json` (`"xss": "1.0.15"`) and the `deno.json` imports (`"xss": "npm:xss@1.0.15"`); refresh `deno.lock` (for example `deno install` or `deno cache` per repo tooling). CREATE `packages/praxrr-app/src/lib/shared/markdown/markdown.ts` and `packages/praxrr-app/src/tests/shared/markdown/markdown.test.ts`. Replace `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts` with a re-export shim.
- **IMPLEMENT**: The module creates `const md = new Marked({ gfm: true, async: false })` and one module-level `new FilterXSS({...})`, and exports `sanitizeHtml(html)`, `parseMarkdown(src)` (block) and `parseMarkdownInline(src)` (inline). All three return `''` for null, undefined or `''`, and both parse functions end with `sanitizeHtml(...)`.
  - **`whiteList`**:
    - No attributes: `p br hr strong em del u ins code pre blockquote ul li h1-h6 table thead tbody tr`
    - `ol: ['start']`
    - `a: ['href','title']`
    - `img: ['src','alt','title']`
    - `th/td: ['align']`
    - `input: ['type','checked','disabled']`
  - **Other options**: `stripIgnoreTag: true` and `stripIgnoreTagBody: ['script','style']`.
  - **`onTag` for `input`**: return `''` unless it is a checkbox. For a checkbox, return the canonical `<input type="checkbox" disabled>`, with `checked` added if present. Closing tags pass through.
  - **`safeAttrValue(tag, name, value, cssFilter)`**:
    - `ol.start`: only `/^\d+$/`.
    - `th/td.align`: only `left|center|right`.
    - `a.href` and `img.src`: the URL guardrail below.
    - Everything else: `escapeAttrValue(value)`.
    - Every return path is `''` or `escapeAttrValue(...)`.
  - **URL guardrail** (follow these steps in order):
    1. `v = friendlyAttrValue(value)`.
    2. Reject `[\u0000-\u001F\u007F]` in `v` or `value`, and reject leading/trailing whitespace.
    3. Reject a leading `//` or any `\`.
    4. If `/^([a-zA-Z][a-zA-Z0-9+.-]*):/` matches, `new URL(v, 'https://placeholder.invalid').protocol` must equal the lowercased match plus `:` and be in `ALLOWED_HREF_PROTOCOLS = ['http:','https:','mailto:']` (or `ALLOWED_SRC_PROTOCOLS = ['http:','https:']` for img). Catch errors and return `''`.
    5. If there is no scheme, the value is relative and allowed, except a fragment-only `#` for img src.
    6. Return `escapeAttrValue(v)`.
  - **Server shim**: `export { parseMarkdown, parseMarkdownInline, sanitizeHtml } from '$shared/markdown/markdown.ts';`. Delete `stripMarkdown` and the regex code.
  - **Test file**: implement every row in "Critical test cases" (Testing Strategy below).
- **MIRROR**: NAMING_CONVENTION, SERVICE_PATTERN, ERROR_HANDLING, TEST_STRUCTURE
- **IMPORTS**: `import { Marked } from 'marked'; import xss from 'xss';` and use `xss.FilterXSS`, `xss.escapeAttrValue`, `xss.friendlyAttrValue` (the default import works in Node ESM, Deno and Vite; named imports of `escapeAttrValue`/`friendlyAttrValue` FAIL under Node ESM because xss is CommonJS). Types: `import type { IFilterXSSOptions } from 'xss';` (bundled `typings/xss.d.ts`). Test: `import { assert, assertEquals } from '@std/assert'; import { ... } from '$shared/markdown/markdown.ts';`
- **GOTCHA**: Never call bare `xss()` or `filterXSS()`, whose defaults are too permissive (default whitelist has `a[target]`, `data:image/` src, no `input`/`ol[start]`). Do not mutate global `marked`. `md.parse()` / `md.parseInline()` are typed `string | Promise<string>` even with `async:false`, so cast `as string`. `new URL` silently strips tabs and newlines, so the control-character rejection must happen first. A custom `safeAttrValue` replaces the default entirely (the default runs `friendlyAttrValue` first and ends with `escapeAttrValue`; do the same). `stripIgnoreTag: true` installs `onIgnoreTagStripAll`; don't also set `onIgnoreTag`. Importing xss in the browser sets `window.filterXSS` (harmless). `sanitizeHtml` must be idempotent. Also refresh `package-lock.json` (`npm install --package-lock-only`) alongside `deno.lock`.
- **VALIDATE**: `deno task test packages/praxrr-app/src/tests/shared/markdown` passes; `deno task check:server` passes; `deno task build` succeeds (proves xss bundles for Vite + deno compile).

### Task 2.1: Migrate shared UI sinks — Depends on [1.1]

- **BATCH**: B2
- **ACTION**: UPDATE `lib/client/ui/display/Markdown.svelte` and `lib/client/ui/form/MarkdownInput.svelte`.
- **IMPLEMENT**:
  - **`Markdown.svelte`**: drop the `marked` import. Use `$: html = inline ? parseMarkdownInline(content) : parseMarkdown(content);`, keeping the existing wrapper span, classes and `maxLines`. Put `<!-- eslint-disable-next-line svelte/no-at-html-tags -->` with a reason comment ("shared sanitized markdown sink") above `{@html html}`.
  - **`MarkdownInput.svelte`**: `renderMarkdown` returns the placeholder markup unchanged when the value is empty, otherwise `parseMarkdown(value)`. Add a justified disable above the preview `{@html}`.
- **MIRROR**: existing component style (Svelte 5 legacy mode: `export let`, `$:`; no runes)
- **IMPORTS**: `import { parseMarkdown, parseMarkdownInline } from '$shared/markdown/markdown.ts';`
- **GOTCHA**: Keep the default `inline = true`. The placeholder has a `class`, so it must not go through the sanitizer. If an HTML-comment disable with a `-- reason` suffix breaks the parser, put the reason in a separate comment line above.
- **VALIDATE**: `grep -n "marked" <files>` is empty; `deno task check:client` passes.

### Task 2.2: Add justified disables on non-markdown sinks — Depends on [1.1]

- **BATCH**: B2
- **ACTION**: UPDATE `lib/client/ui/table/Table.svelte` (sinks ~192, 221, 343), `lib/client/ui/meta/CodeBlock.svelte` (~33) and `lib/client/ui/meta/JsonView.svelte` (~34, 47).
- **IMPLEMENT**: Add `<!-- eslint-disable-next-line svelte/no-at-html-tags -->` above each `{@html}`, with a reason. For Table: "cell html producers must escape (escapeHtml) or sanitize (parseMarkdownInline)". For CodeBlock and JsonView: "highlight.js escapes input". Add a one-line doc comment to the `html` field of the `Column.cell` return type in `lib/client/ui/table/types.ts` stating that contract.
- **MIRROR**: n/a
- **IMPORTS**: none
- **GOTCHA**: Comment-only changes; no behavior edits. Disable per line only, never per file.
- **VALIDATE**: `git diff` shows only comment additions in these files.

### Task 3.1: Custom-format views — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: UPDATE `routes/custom-formats/[databaseId]/views/CardView.svelte` and `TableView.svelte`.
- **IMPLEMENT**: Remove the `marked` import and the local `parseMarkdown` helper. CardView uses `parseMarkdownInline(...)` at the `{@html}` sink (with a justified disable). TableView's description cell builds `html` with `parseMarkdownInline(row.description)` inside the existing `.prose-inline` span. Keep the local `escapeHtml` used for other cells.
- **MIRROR**: Task 2.1 import style
- **IMPORTS**: `import { parseMarkdownInline } from '$shared/markdown/markdown.ts';`
- **GOTCHA**: Inline mode only; keep `line-clamp-2` and wrapper classes.
- **VALIDATE**: No `marked` in either file; `deno task check:client`.

### Task 3.2: Regex table view — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: UPDATE `routes/regular-expressions/[databaseId]/views/TableView.svelte`.
- **IMPLEMENT**: Remove the `marked` import and the local helper; the description cell uses `parseMarkdownInline(row.description)`.
- **MIRROR**: Task 3.1
- **IMPORTS**: `import { parseMarkdownInline } from '$shared/markdown/markdown.ts';`
- **GOTCHA**: Keep the local `escapeHtml` for the other cells.
- **VALIDATE**: No `marked`; `deno task check:client`.

### Task 3.3: Change-review diff tables — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: UPDATE `routes/databases/[id]/changes/components/FieldDiffTable.svelte` and `TestsDiffTable.svelte`.
- **IMPLEMENT**: Remove the `marked` import and the local helper; replace the calls with the shared `parseMarkdown(...)` (block). Add a justified disable above each `{@html}` (2 in FieldDiffTable, 3 in TestsDiffTable).
- **MIRROR**: Task 2.1
- **IMPORTS**: `import { parseMarkdown } from '$shared/markdown/markdown.ts';`
- **GOTCHA**: Before and after columns must both be sanitized identically; keep the `prose` wrappers.
- **VALIDATE**: No `marked`; `deno task check:client`.

### Task 3.4: Quality profile views — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: UPDATE `routes/quality-profiles/[databaseId]/views/CardView.svelte` and `TableView.svelte`.
- **IMPLEMENT**:
  - **CardView**: change `{@html profile.description}` to `{@html sanitizeHtml(profile.description)}` with a justified disable (defense in depth; idempotent on server-sanitized HTML).
  - **TableView**: wrap `row.name`, `tag.name` and `q.name` with `escapeHtml` from `$lib/client/utils/escapeHtml.ts`. Description cells that already contain server HTML are passed through `sanitizeHtml`.
- **MIRROR**: ERROR_HANDLING (shared escaper)
- **IMPORTS**: `import { sanitizeHtml } from '$shared/markdown/markdown.ts'; import { escapeHtml } from '$lib/client/utils/escapeHtml.ts';`
- **GOTCHA**: Do not re-parse server HTML as markdown here; sanitize only.
- **VALIDATE**: `deno task check:client`; benign names render identically.

### Task 3.5: Metadata and delay profile table producers — Depends on [2.1]

- **BATCH**: B3
- **ACTION**: UPDATE `routes/metadata-profiles/[databaseId]/+page.svelte` and `routes/delay-profiles/[databaseId]/views/TableView.svelte`.
- **IMPLEMENT**: Wrap `row.name` (both files) and `String(row.description)` (metadata) with `escapeHtml(...)`. Keep the "No description" placeholder markup unescaped.
- **MIRROR**: ERROR_HANDLING (shared escaper)
- **IMPORTS**: `import { escapeHtml } from '$lib/client/utils/escapeHtml.ts';`
- **GOTCHA**: Metadata descriptions are plain text, not markdown (Lidarr metadata profile); escaping keeps them looking the same.
- **VALIDATE**: `deno task check:client`.

### Task 4.1: Enforce lint rule and full validation — Depends on [3.1, 3.2, 3.3, 3.4, 3.5]

- **BATCH**: B4
- **ACTION**: UPDATE `eslint.config.js` and `docs/ARCHITECTURE.md`; run the full validation.
- **IMPLEMENT**:
  - Add `'svelte/no-at-html-tags': 'error'` to the rules of the svelte files block.
  - Fix the stale markdown module path in `docs/ARCHITECTURE.md` (~line 1203) to `$shared/markdown/markdown.ts`, and remove the `stripMarkdown` mention.
  - Run `deno task format`, `deno task lint`, `deno task check`, `deno task test`, `deno task build`.
  - Fix any `{@html}` the rule flags that the inventory missed: route it through the shared renderer or add a justified line disable.
- **MIRROR**: n/a
- **IMPORTS**: none
- **GOTCHA**: Prettier may reflow the HTML comments, so format before lint. No file-level disables.
- **VALIDATE**: All commands exit 0; `grep -rlE "from ['\"](marked|xss)['\"]" packages/praxrr-app/src` lists only `lib/shared/markdown/markdown.ts`; `grep -rn stripMarkdown packages/praxrr-app/src` is empty.

---

## Testing Strategy

### Unit Tests

File: `packages/praxrr-app/src/tests/shared/markdown/markdown.test.ts`. Mode S = `sanitizeHtml`; M = both `parseMarkdown` and `parseMarkdownInline`. Check by attribute and element scan (regex on output), not by plain substring absence of harmless escaped text.

| #   | Mode | Input                                                                                        | Expected Output                                        | Edge Case? |
| --- | ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| 1   | M    | `null` / `undefined` / `''`                                                                  | `''`                                                   | Yes        |
| 2   | S    | `<img src=x onerror=alert(1)>`                                                               | no `onerror`; `src="x"` kept                           | Yes        |
| 3   | S    | `<img src="x"/onerror=alert(1)>`                                                             | no `on*` attribute                                     | Yes        |
| 4   | S,M  | `<script>alert(1)</script>`                                                                  | no `<script`, no `alert(1)` body                       | Yes        |
| 5   | S    | `<svg onload=alert(1)></svg><math><mi>x</mi></math>`                                         | no `svg`/`math` elements                               | Yes        |
| 6   | S    | `<a href=javascript:alert(1)>x</a>`                                                          | no href; `x` kept                                      | Yes        |
| 7   | S    | `<a HREF="  JaVaScRiPt:alert(1)">x</a>`                                                      | no href                                                | Yes        |
| 8   | S    | `<a href="java&#115;cript:alert(1)">x</a>`                                                   | no href                                                | Yes        |
| 9   | S    | `<a href="jav&#x09;ascript:alert(1)">x</a>`                                                  | no href                                                | Yes        |
| 10  | S    | `<a href="javascript&colon;alert(1)">x</a>`                                                  | no href                                                | Yes        |
| 11  | S,M  | `<a href="data:text/html,...">x</a>` / `![x](data:image/svg+xml;base64,PHN2Zz4=)`            | no `data:` href/src                                    | Yes        |
| 12  | M    | `[x](javascript:alert(1))`, `[x](vbscript:msgbox(1))`, `![x](javascript:alert(1))`           | text/alt kept; no href/src                             | Yes        |
| 13  | M    | `[x](//evil.example)`, `[x](ftp://e.com)`, `[x](tel:123)`                                    | no href                                                | Yes        |
| 14  | S    | `<a title='x" onmouseover="alert(1)' href="/ok">x</a>`                                       | escaped title, `href="/ok"`, no `onmouseover`          | Yes        |
| 15  | S    | `<p style="..." id="location" name="cookie">x</p>`                                           | `<p>x</p>`                                             | Yes        |
| 16  | S    | `<input type="text" value="fake"><input type="checkbox" checked>`                            | text input gone; checkbox `disabled` + `checked`       | Yes        |
| 17  | S    | `<th align="left" onclick="alert(1)">x</th><td align="bogus">y</td>`                         | `align="left"` kept, no onclick, bogus align dropped   | Yes        |
| 18  | M    | `[a](https://example.com "t")`, `[c](mailto:a@example.com)`, `![i](https://e.com/i.png "t")` | href/src/title preserved                               | No         |
| 19  | M    | `[x](/p)`, `[x](../p)`, `[x](guide.md)`, `[x](?tab=1)`, `[x](#s)`                            | hrefs preserved                                        | No         |
| 20  | M    | fenced code containing `<img src=x onerror=alert(1)>`                                        | escaped text in `<code>`, no `<img`                    | Yes        |
| 21  | M    | GFM aligned table; `3. item`; `- [x] done\n- [ ] todo`; `**b** *e* ~~d~~`                    | align, `start="3"`, disabled checkboxes, strong/em/del | No         |
| 22  | S,M  | each above sanitized twice; inline `hello`                                                   | idempotent; inline has no `<p>`, block has `<p>`       | Yes        |

### Edge Cases Checklist

- [x] Empty input (null/undefined/'')
- [ ] Maximum size input (not tested; no size limit introduced)
- [x] Invalid types (nullable signature)
- [ ] Concurrent access (N/A, pure function)
- [ ] Network failure (N/A)
- [ ] Permission denied (N/A)
- [x] Idempotency (server-sanitized HTML re-sanitized on the client)

---

## Validation Commands

### Static Analysis

```bash
deno task format && deno task lint && deno task check
```

EXPECT: Zero type and lint errors.

### Unit Tests

```bash
deno task test packages/praxrr-app/src/tests/shared/markdown
```

EXPECT: All tests pass.

### Full Test Suite

```bash
deno task test
```

EXPECT: No regressions.

### Database Validation (if applicable)

N/A: no schema or migration changes.

### Browser Validation (if applicable)

```bash
deno task build && deno task preview
```

EXPECT: Binary starts. CF/regex/QP lists and cards, a changes diff page, the MarkdownInput preview and a TRaSH entity page render benign markdown identically to `main`.

### Manual Validation

- [ ] Grep proves `marked` and `xss` are imported only by `lib/shared/markdown/markdown.ts`.
- [ ] A scratch `{@html x}` without a disable fails `deno task lint` (revert afterwards).
- [ ] A description with `<img src=x onerror=alert(1)>` shows no alert in the browser.

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing (22-row corpus)
- [ ] No type errors
- [ ] No lint errors; `svelte/no-at-html-tags: 'error'` enabled; only line-level justified disables
- [ ] Exactly one module in `packages/praxrr-app/src` imports `marked` (and `xss`)
- [ ] `<script>`, quoted/unquoted `onerror=`, `javascript:` (plain/unquoted/case/entity/control), `data:`, `vbscript:`, `//host` are neutralized
- [ ] Inline sites render without `<p>`; block sites unchanged; wrappers/clamps unchanged
- [ ] Server importers (`trashguide/displayTransform.ts`, `qualityProfiles/list.ts`, `databases/[id]/config/+page.server.ts`) unedited and compiling
- [ ] No data migration, PCD op or schema change
- [ ] Matches UX design

## Completion Checklist

- [ ] Code follows discovered patterns
- [ ] Error handling matches codebase style (fail-closed, silent)
- [ ] Logging follows codebase conventions (none in pure module)
- [ ] Tests follow test patterns
- [ ] No hardcoded values beyond the documented allowlist constants
- [ ] Documentation updated (`docs/ARCHITECTURE.md`)
- [ ] No unnecessary scope additions; non-feature files have comment-only diffs
- [ ] Self-contained — no questions needed during implementation
- [ ] `xss` pinned exactly `1.0.15` in `package.json` and `deno.json`; `deno.lock` committed
- [ ] `deno task build` succeeds and the binary serves the CF list
- [ ] Follow-up Linear issue filed: Arr logs/upgrades table interpolations, CSP, `escapeHtml` consolidation, image privacy, non-Svelte HTML assembly; linked in the PR and on YAN-560
- [ ] Comment on YAN-559 that `marked` now has a single import point
- [ ] PR body (from the template) states target = next app release from `main`, no flag (why), no backport, remaining risk
- [ ] `graphify update .` run if `graphify-out/` is tracked

## Risks

| Risk                                                     | Likelihood | Impact | Mitigation                                                     |
| -------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------- |
| `safeAttrValue` returns raw value and undoes escaping    | Med        | High   | Every path returns `''` or `escapeAttrValue`; breakout tests   |
| Entity/control-char obfuscation slips past the URL check | Med        | High   | Decode once, reject controls before `new URL`; tests 8-10      |
| `xss` CJS interop fails in Vite SSR or deno compile      | Low        | High   | `deno task build` in Task 1.1; `ssr.noExternal` only if needed |
| Inline/block mismatch breaks card/table layouts          | Med        | Med    | Per-site modes fixed in plan; test 22                          |
| Lint blast radius tempts drive-by edits                  | High       | Med    | Comment-only diffs outside feature files                       |
| Prettier reflows disable comments                        | Med        | Low    | `deno task format` before lint                                 |
| Remaining Table sinks (logs/upgrades) stay unescaped     | Med        | Med    | Follow-up issue, stated in the PR                              |

## Notes

- Svelte 5 **legacy mode**: `export let` and `$:`; never `$state`/`$derived`/`$props`.
- Trunk-only (`RELEASING.md`): base and PR target is `main`; no backport; no feature switch (complete security fix; a switch left off would keep XSS reachable).
- Call-site parse modes (verified):
  - Inline: `Markdown.svelte` (default `inline=true`; its 3 users pass no prop), CF CardView/TableView, regex TableView.
  - Block: MarkdownInput, FieldDiffTable, TestsDiffTable, server `parseMarkdown`.
- TRaSH pages pass server HTML into inline `<Markdown>`, which re-parses it. Sanitizing raw HTML (not escaping it) keeps that working; idempotency is covered by test 22.
- The server shim keeps the 3 server importers untouched; `check:server` covers the shared module through the shim.
- `$shared` code must not use `Deno.*`, `node:*`, `document` or `window`.
