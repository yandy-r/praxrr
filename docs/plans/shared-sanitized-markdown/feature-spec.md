# Feature Spec: shared-sanitized-markdown (YAN-560 / GH #289)

## Executive Summary

Praxrr renders markdown descriptions (custom formats, regexes, quality profiles, CF tests, change diffs, TRaSH entities) that originate from remote PCD git repos. Seven client modules call `marked` directly and pass output to `{@html}` unsanitized, and the only sanitizer (server `sanitizeHtml`, regex-based) has live bypasses (unquoted `onerror=`, unquoted/entity-encoded `javascript:`, `data:` URLs) — this is stored XSS. The fix moves markdown parsing into one shared isomorphic module (`$shared/markdown/markdown.ts`) built on an isolated `Marked` instance plus the `xss` (js-xss) string sanitizer configured with an explicit tag/attribute allowlist and a strict URL scheme policy; every client sink and the server re-export route through it. `svelte/no-at-html-tags` is enabled so new raw sinks fail lint; the remaining legitimate sinks (shared `Markdown.svelte`, Table html cells, highlight.js output) carry narrowly justified disable comments. Primary risks: render regressions (inline vs block parsing, table/card layouts) and the residual raw-interpolation sinks in Table cell producers, which this change escapes where confirmed.

## External Dependencies

### APIs and Services

None. No network, Arr or PCD API changes.

### Libraries and SDKs

| Library  | Version              | Purpose                                                                        | Installation                                                                         |
| -------- | -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `marked` | 15.0.12 (existing)   | Markdown → HTML (`parse` block, `parseInline` inline), isolated `new Marked()` | already in root `package.json` + `deno.json`                                         |
| `xss`    | 1.0.15 (new, pinned) | DOM-free allowlist HTML sanitizer usable in browser + Deno                     | root `package.json` `"xss": "1.0.15"`; `deno.json` imports `"xss": "npm:xss@1.0.15"` |

`xss` facts (checked 2026-10-07): OSV zero advisories for xss/cssfilter/commander; ~5.8 KB gzip client cost; deps `cssfilter` (runtime) and `commander` (CLI only). Defaults are too permissive (`data:image/`, `ftp:`, `tel:`, `//host`, media tags) → never call bare `xss(html)`.

### External Documentation

- [js-xss README](https://github.com/leizongmin/js-xss): `whiteList`, `onIgnoreTag`, `stripIgnoreTagBody`, `safeAttrValue`, `escapeAttrValue`, `friendlyAttrValue`
- [marked docs](https://marked.js.org/using_pro): `new Marked()`, `parseInline`, renderer hooks
- [eslint-plugin-svelte no-at-html-tags](https://sveltejs.github.io/eslint-plugin-svelte/rules/no-at-html-tags/): rule + `<!-- eslint-disable-next-line svelte/no-at-html-tags -->`

## Business Requirements

### User Stories

**Primary User: Praxrr operator**

- As an operator, I want to browse and sync third-party PCDs without a malicious description executing script in my authenticated session.
- As an operator, I want descriptions to keep rendering bold/italic/code/links/lists/tables exactly as before.

**Secondary User: PCD author**

- As an author editing a description, I want the preview in `MarkdownInput` to match the final rendered output exactly.

### Business Rules

1. **Single renderer**: only `packages/praxrr-app/src/lib/shared/markdown/markdown.ts` imports `marked` (and `xss`) within `src/`.
   - Validation: grep check in review + lint rule on sinks.
2. **Always sanitize final HTML**: both `parseMarkdown` (block) and `parseMarkdownInline` sanitize output before returning; no exported path returns unsanitized marked output.
3. **Storage unchanged**: markdown source is stored as-is; sanitization happens on render only (no data mutation, no migrations).
4. **Allowlist only**: tags `p br hr strong em del u ins code pre blockquote ul ol li h1-h6 table thead tbody tr th td a img input`; attrs `a[href,title]`, `img[src,alt,title]`, `ol[start]` (integer), `th/td[align ∈ left|center|right]`, `input[type=checkbox, checked, disabled]` (non-checkbox input dropped, `disabled` forced). No `class/style/id/name/on*/data-*/target`.
5. **URL policy**: `a[href]` allows `http:`, `https:`, `mailto:`, relative refs, `?query`, `#fragment`; `img[src]` allows `http:`, `https:`, relative. Reject everything else incl. `javascript: vbscript: data: blob: file: ftp: tel:`, protocol-relative `//host`, backslash tricks, control characters, entity-obfuscated schemes. Rejected URL → attribute dropped, text kept.
6. **Links stay same-tab** (current behavior; no `target`/`rel` added).
7. **Raw HTML policy**: allowlisted raw HTML is sanitized, not escaped (compatibility: TRaSH/QP descriptions are pre-rendered HTML that `Markdown.svelte` re-parses; escaping would show literal tags).

### Edge Cases

| Scenario                                  | Expected Behavior                           | Notes                           |
| ----------------------------------------- | ------------------------------------------- | ------------------------------- |
| `null` / `undefined` / `''`               | `''`                                        | Both functions                  |
| Inline render of `hello`                  | `hello` (no `<p>`)                          | Card/table cells                |
| Already-sanitized HTML re-sanitized       | Identical output (idempotent)               | QP / TRaSH double path          |
| `MarkdownInput` empty preview placeholder | Placeholder markup stays outside sanitizer  | Placeholder has `class`         |
| Fenced code containing `<img onerror>`    | Shown as escaped text in `<code>`           |                                 |
| Diff tables (before/after)                | Both columns sanitized identically          | FieldDiffTable / TestsDiffTable |
| `line-clamp` / `maxLines` truncation      | Unchanged; sanitized output is tag-balanced | CSS-based truncation            |

### Success Criteria

- [ ] Exactly one module in `packages/praxrr-app/src` imports `marked` (and `xss`).
- [ ] Unit test proves `<script>`, quoted and unquoted `onerror=`, `javascript:` (plain/unquoted/case/entity), `data:` payloads are neutralized, and benign GFM survives.
- [ ] Every markdown `{@html}` sink routes through the shared renderer; `svelte/no-at-html-tags` enabled and `deno task lint` passes.
- [ ] `deno task check` and `deno task test` pass; Vite build succeeds.

## Technical Specifications

### Architecture Overview

```text
PCD text (remote git) ──▶ server/client loaders ──▶ $shared/markdown/markdown.ts
                                                     ├─ md = new Marked({ gfm: true, async: false })
                                                     ├─ parseMarkdown(src)       = sanitizeHtml(md.parse(src))
                                                     ├─ parseMarkdownInline(src) = sanitizeHtml(md.parseInline(src))
                                                     └─ sanitizeHtml(html)       = FilterXSS(whitelist + URL policy)
        ▲ re-export                                   ▲ import
$utils/markdown/markdown.ts (server shim)        Markdown.svelte (sole markdown {@html} sink)
  ├ trashguide/displayTransform.ts                 MarkdownInput / CF CardView / FieldDiffTable / TestsDiffTable
  ├ pcd/entities/qualityProfiles/list.ts           CF + regex TableView (html cell strings via parseMarkdownInline)
  └ routes/databases/[id]/config/+page.server.ts
```

### Data Models

None. No app DB or PCD schema change; no migrations; render-time only.

### API Design

No HTTP API changes. Module API (`$shared/markdown/markdown.ts`):

```ts
export function sanitizeHtml(html: string | null | undefined): string;
export function parseMarkdown(markdown: string | null | undefined): string; // block
export function parseMarkdownInline(
  markdown: string | null | undefined
): string; // inline, no <p>
```

`stripMarkdown` is deleted (zero callers).

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/shared/markdown/markdown.ts`: shared renderer + sanitizer.
- `packages/praxrr-app/src/tests/shared/markdown/markdown.test.ts`: `Deno.test` payload corpus.

#### Files to Modify

- `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts`: replace body with `export { parseMarkdown, parseMarkdownInline, sanitizeHtml } from '$shared/markdown/markdown.ts';`.
- `packages/praxrr-app/src/lib/client/ui/display/Markdown.svelte`: use shared fns; single justified `{@html}`.
- `packages/praxrr-app/src/lib/client/ui/form/MarkdownInput.svelte`: preview via shared `parseMarkdown` (or `<Markdown>`); drop local marked.
- `packages/praxrr-app/src/routes/custom-formats/[databaseId]/views/CardView.svelte`, `TableView.svelte`: shared inline renderer.
- `packages/praxrr-app/src/routes/regular-expressions/[databaseId]/views/TableView.svelte`: shared inline renderer.
- `packages/praxrr-app/src/routes/databases/[id]/changes/components/FieldDiffTable.svelte`, `TestsDiffTable.svelte`: shared renderer.
- `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/views/CardView.svelte`: route via `<Markdown>`-equivalent sanitized sink or justified disable (server-sanitized value).
- `packages/praxrr-app/src/lib/client/ui/table/Table.svelte`, `CodeBlock.svelte`, `JsonView.svelte`: justified `eslint-disable-next-line svelte/no-at-html-tags` comments.
- Raw Table cell producers confirmed unescaped (metadata-profiles name/description, delay-profiles name): wrap with existing `escapeHtml`.
- `eslint.config.js`: enable `'svelte/no-at-html-tags': 'error'` in the svelte files block.
- `package.json`, `deno.json`, `deno.lock`: add `xss@1.0.15`.

#### Configuration

- None (no env var, no feature switch — complete security fix, nothing half-built becomes reachable; trunk stays releasable per RELEASING.md "Unfinished work").

## UX Considerations

### User Workflows

#### Primary Workflow: View description

1. **Open list/card/detail**
   - User: opens CF/regex/QP lists or TRaSH entity pages.
   - System: renders sanitized markdown with unchanged styling (`.markdown`, `.prose-inline`, `.prose`).
2. **Edit description**
   - User: types in `MarkdownInput`, toggles preview.
   - System: preview uses identical renderer → parity with saved view.
3. **Success State**
   - Same visuals as before; malicious markup inert.

#### Error Recovery Workflow

1. **Error Occurs**: description contains disallowed HTML/URL.
2. **User Sees**: surrounding text preserved; dangerous tags/attributes silently removed (link text without href).
3. **Recovery**: author edits source; nothing destructive happens to stored data.

### UI Patterns

| Component   | Pattern                   | Notes                                       |
| ----------- | ------------------------- | ------------------------------------------- |
| Markdown    | Single sanitized sink     | Keeps inline/block prop and wrapper classes |
| Table cells | `{ html }` from shared fn | Inline variant to avoid `<p>` in cells      |
| Diff tables | Shared block/inline fn    | Identical sanitization both columns         |

### Accessibility Requirements

- Link semantics preserved (anchor text retained when href rejected).
- No visual redesign; heading hierarchy in cards kept for parity (follow-up candidate).

### Performance UX

- **Loading States**: N/A (synchronous render).
- **Optimistic Updates**: N/A.
- **Error Feedback**: none needed; silent safe degradation.
- Sanitizer is a module-level singleton `FilterXSS` instance (tables render per row).

## Recommendations

### Implementation Approach

**Recommended Strategy**: single PR — build shared module + tests first, then migrate sinks in parallel by area, then enable lint and fix flagged sinks.

**Phasing:**

1. **Phase 1 - Foundation**: add `xss`, create shared module + test corpus, server re-export shim.
2. **Phase 2 - Core**: migrate 7 client sites + QP CardView; escape raw Table producers.
3. **Phase 3 - Polish**: enable lint rule, justified disables, full check/lint/test/build.

### Technology Decisions

| Decision     | Recommendation                            | Rationale                                                                              |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Sanitizer    | `xss@1.0.15` + explicit policy            | Proven regex bypasses; DOMPurify needs DOM on server; in-house parser rewrite rejected |
| Raw HTML     | Sanitize (not escape)                     | TRaSH/QP pre-rendered HTML compatibility                                               |
| Images       | Keep http/https/relative                  | Compatibility; privacy hardening is follow-up                                          |
| Link target  | Same-tab (unchanged)                      | No behavior change in a security refactor                                              |
| Module shape | `$shared/markdown/markdown.ts`, no barrel | Matches `$shared/utils` precedent                                                      |
| Feature flag | None                                      | Complete fix, not unfinished work                                                      |

### Quick Wins

- Delete dead `stripMarkdown`.
- Escape confirmed raw PCD fields in metadata/delay profile table cells with existing `escapeHtml`.

### Future Enhancements

- CSP (report-only first) via `kit.csp`.
- Consolidate duplicated `escapeHtml` helpers.
- Audit logs/upgrades table interpolations (`row.level`, `row.logger`, info labels).
- Remote-image privacy (referrer policy / opt-out).

## Risk Assessment

### Technical Risks

| Risk                                               | Likelihood | Impact | Mitigation                                   |
| -------------------------------------------------- | ---------- | ------ | -------------------------------------------- |
| Inline vs block mismatch breaks card/table layout  | Med        | Med    | Preserve each site's current mode; inline fn |
| `xss` ESM/CJS interop in Vite or Deno              | Low        | Med    | Verify `deno task check`, test, build early  |
| Over-stripping benign markdown (task lists, align) | Med        | Low    | Corpus includes benign GFM fixtures          |
| Custom `safeAttrValue` undoing escaping            | Low        | High   | Always return `escapeAttrValue(...)`; tests  |

### Integration Challenges

- Lint rule flags ~10 non-markdown sinks: add narrow, justified disable comments; never blanket file disables.
- Trash pages re-parse server HTML through `Markdown.svelte`: idempotent sanitizer keeps it safe.

### Security Considerations

#### Critical — Hard Stops

| Finding                           | Risk                        | Required Mitigation                                  |
| --------------------------------- | --------------------------- | ---------------------------------------------------- |
| Unsanitized client markdown sinks | Stored XSS from remote PCDs | All sinks via shared sanitized renderer              |
| Regex sanitizer bypasses          | XSS even on server path     | Replace with `xss` + explicit allowlist + URL policy |

#### Warnings — Must Address

| Finding                       | Risk                              | Mitigation                                | Alternatives                    |
| ----------------------------- | --------------------------------- | ----------------------------------------- | ------------------------------- |
| `xss` defaults too permissive | `data:`/`//host`/media allowed    | Explicit whitelist + URL callback         | —                               |
| Raw Table cell producers      | Stored XSS via names/descriptions | `escapeHtml` at producer (confirmed ones) | Follow-up issue for unconfirmed |
| Hooks can undo escaping       | Attribute breakout                | Return library-escaped values only        | —                               |

#### Advisories — Best Practices

- No CSP configured: add report-only CSP later (deferral justification: sanitizer is primary control; CSP needs hydration testing).
- Remote images leak viewer IP: policy decision later (deferral: no script risk).

## Task Breakdown Preview

### Phase 1: Foundation

**Focus**: shared module, dependency, tests, server shim
**Tasks**:

- Add `xss@1.0.15` to `package.json` / `deno.json` / lock
- Create `$shared/markdown/markdown.ts` + test corpus
- Replace server module with re-export
  **Parallelization**: test file can be written alongside module

### Phase 2: Migrate sinks

**Focus**: route every client renderer through shared module
**Dependencies**: Phase 1
**Tasks**:

- `Markdown.svelte`, `MarkdownInput.svelte`
- CF CardView/TableView, regex TableView
- FieldDiffTable, TestsDiffTable, QP CardView
- Escape metadata/delay profile raw producers

### Phase 3: Enforce

**Focus**: lint enforcement and validation
**Tasks**:

- Enable `svelte/no-at-html-tags`; justified disables
- `deno task check`, `deno task lint`, `deno task test`, `deno task build`

## Decisions Needed

All resolved with recommended options (security/data-integrity aligned):

1. **Sanitizer** — Options: `xss`, in-house allowlist rewrite, DOMPurify+jsdom. Decision: `xss@1.0.15` with explicit policy.
2. **Raw HTML** — Options: escape, sanitize. Decision: sanitize (compat with pre-rendered HTML).
3. **Wider Table XSS** — Options: fix now, follow-up. Decision: escape confirmed raw PCD fields now; file follow-up for logs/upgrades audit.
4. **Links/images** — Decision: unchanged behavior (same tab; http/https/relative images).

## Research References

- [research-external.md](./research-external.md): External library details
- [research-business.md](./research-business.md): Business logic analysis
- [research-technical.md](./research-technical.md): Technical specifications
- [research-ux.md](./research-ux.md): UX research
- [research-security.md](./research-security.md): Security analysis (severity-leveled findings)
- [research-practices.md](./research-practices.md): Engineering practices (modularity, reuse, KISS)
- [research-recommendations.md](./research-recommendations.md): Full recommendations
