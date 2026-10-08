# Engineering Practices — shared-sanitized-markdown (YAN-560)

## Executive Summary

Feature is sound and matches codebase conventions. Move `markdown.ts` to `$shared/markdown/markdown.ts` (no barrel needed), leave server file as one-line re-export, add `parseMarkdownInline` export, rewire 6 client sites to the shared functions, delete 6 local `parseMarkdown` copies plus already-dead `stripMarkdown`. One `Deno.test` file under `src/tests/shared/markdown/` is auto-discovered by `deno task test` — no `scripts/test.ts` change required. Two real risks: (1) the hand-rolled regex sanitizer has an unquoted-attribute XSS bypass worth a ponytail note at minimum; (2) `svelte/no-at-html-tags` has no allowlist option and enabling it repo-wide forces disables in ~4 components outside the six target files.

## Existing Reusable Code

| Asset                                              | Path                                                            | Relevance                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseMarkdown` / `sanitizeHtml` / `stripMarkdown` | `packages/praxrr-app/src/lib/server/utils/markdown/markdown.ts` | The code being promoted. Already used server-side by 3 importers: `lib/server/trashguide/displayTransform.ts:20`, `lib/server/pcd/entities/qualityProfiles/list.ts:16`, `routes/databases/[id]/config/+page.server.ts:13`                                                                                        |
| `<Markdown>` component                             | `lib/client/ui/display/Markdown.svelte`                         | Already consumed by 3 routes (`regular-expressions/.../CardView.svelte:11`, `databases/trash/[id]/custom-formats/.../general/+page.svelte:5`, `databases/trash/[id]/quality-profiles/.../general/+page.svelte:5`). Keep it; rewire its internals to the shared module. Its 3 consumers get sanitization for free |
| `$shared` import alias                             | `deno.json:8`, mirrored in `svelte.config.js`                   | Client `.svelte` files already import runtime code from `$shared/` directly with `.ts` extension, e.g. `$shared/arr/capabilities.ts` (`CompatibilityBadges.svelte:3`), `$shared/complexity/tiers.ts`, `$shared/pcd/mediaManagement.ts`. No new pattern needed                                                    |
| `marked`                                           | `deno.json:27` (`npm:marked@^15.0.6`), `package.json:17`        | Already a root-level Deno import-map entry and npm dep. Shared module keeps using it — zero dependency changes                                                                                                                                                                                                   |

## Modularity Design

**`$shared` conventions observed:**

- Multi-file domains use a folder + `index.ts` barrel: `security/`, `plugins/`, `narration/`, `goals/`, `health/`.
- Single-topic folders with no barrel also exist: `utils/` (`dates.ts`, `masking.ts`, `uuid.ts`, `version.ts` — four files, no `index.ts`).
- Flat single files exist at the root: `filters.ts`, `selectors.ts`, `resolvedConfig.ts`.

**Recommendation:** `packages/praxrr-app/src/lib/shared/markdown/markdown.ts`, one file, **no `index.ts`**. One module with three exports does not earn a barrel (matches `utils/` precedent). Skip the barrel; add one only if the folder grows past two files.

**Server compatibility:** keep `lib/server/utils/markdown/markdown.ts` as:

```ts
export * from '$shared/markdown/markdown.ts';
```

This leaves the 3 server importers untouched (zero edits in `displayTransform.ts`, `list.ts`, `+page.server.ts`). The alternative — updating 3 import lines and deleting the server file — is also tiny but touches more files and breaks any out-of-tree references. Re-export wins on fewest moving parts, and the ticket mandates it. Cost: one permanent indirection file. Acceptable.

**Client call sites — function, not component.** The six sites split into two shapes:

- _Template `{@html}` sites_ (`Markdown.svelte`, `MarkdownInput.svelte`, custom-formats `CardView.svelte`, diff tables): could in theory use `<Markdown>`, but `Markdown.svelte` bakes in `text-xs text-neutral-600` wrapper styling and a `maxLines` clamp prop — swapping it into `CardView.svelte:195` or the diff tables changes visual output. Shortest safe diff: import the shared function, keep the local `{@html}`.
- _Table cell renderers_ (custom-formats `TableView.svelte:153`, regular-expressions `TableView.svelte:86`): build HTML strings inside `cell: (row) => ({ html })` callbacks rendered by `Table.svelte`'s `{@html rendered.html}` (lines 192/221/343). A Svelte component **cannot** be used here — the function is the only option.

So: shared **function** is the universal sink; `<Markdown>` remains as the styled-display component for its existing 3 consumers and simply re-points at the shared function.

## KISS Assessment

1. **No new abstraction layers.** Do not add a "renderer registry", options bag, or class wrapper. Three exported functions (`parseMarkdown`, `parseMarkdownInline`, `stripMarkdown` if kept) over `marked` is the entire surface.
2. **No new deps.** `marked` is already imported both places. The old file's comment (`markdown.ts:8-9`) says the hand-rolled sanitizer exists specifically to avoid a postcss/DOMPurify-style dependency in compiled binaries — respect that constraint.
3. **Inline variant is one line.** `parseMarkdownInline = (md) => md ? sanitizeHtml(marked.parseInline(md) as string) : ''`. Required because 4 of 6 client sites call `parseInline` (Markdown.svelte, both TableViews, custom-formats CardView) and the server module only wraps `parse`. Do not add an `{ inline?: boolean }` options param — two named functions read better at call sites.
4. **eslint rule blast radius.** `svelte/no-at-html-tags` takes **no options** (no allowlist). Enabling it flags every `{@html}` in the repo: `Table.svelte` (×3, generic cell renderer), `JsonView.svelte` (highlight.js output), `CodeBlock.svelte` (highlight.js output), `quality-profiles/.../CardView.svelte:141` (server-sanitized `profile.description`), plus the markdown sites. "One allow" is not literally achievable unless all markdown sites route through one component (impossible for table cells — see above). Realistic KISS plan: enable the rule, put the single documented `<!-- eslint-disable-next-line svelte/no-at-html-tags -->` (or `// eslint-disable-next-line` in markup context) on `Markdown.svelte` as the sanctioned markdown sink, and add reason-commented disables at `Table.svelte`, `JsonView.svelte`, `CodeBlock.svelte` — those are non-markdown, already-trusted content and out of this feature's scope to redesign. Do **not** disable the rule globally in config; that defeats the ticket.
5. **Sanitizer weakness (known, pre-existing).** The regex attr-strippers at `markdown.ts:53-54` only match quoted values: `onerror=alert(1)` and `href=javascript:...` (unquoted) survive. `marked` passes raw HTML through by default, so this is a live (if narrow) XSS gap being promoted to client-side rendering of remote PCD content. Fix is ~2 regex lines (extend character class to include unquoted values), no new dep. Move the code as-is first; add the hardening + test case in the same change or mark with a `ponytail:` comment naming the ceiling and upgrade path (DOMPurify if the binary-compile constraint is ever lifted). Do not silently expand scope without flagging it to the reviewer.

## Abstraction vs. Repetition

**Extract (threshold met):**

- `parseMarkdown` local copies × 6 — identical 3-line `marked.parse*` wrappers across `Markdown.svelte`, `MarkdownInput.svelte:112-115`, custom-formats `CardView.svelte:72-75` + `TableView.svelte:93-96`, regular-expressions `TableView.svelte:30-33`, `FieldDiffTable.svelte:15-17`, `TestsDiffTable.svelte:53-55`. Six occurrences, two variants (inline/block). This is the extraction the ticket is for. All six local functions become dead code — delete them and their `marked` imports.

**Leave duplicated (out of scope):**

- `escapeHtml` — duplicated in 7 files (custom-formats `TableView.svelte:85`, regular-expressions `TableView.svelte:21`, `sync-history/+page.svelte`, `canary/+page.svelte`, trash scoring, `snapshots/+page.svelte`, `conflicts/+page.svelte`). Rule of three is met and it belongs in `$shared/utils/`, but it is **not** markdown and not dead after this change. Mention in the PR as a follow-up candidate; do not fold into this diff.

**Delete (already dead):**

- `stripMarkdown` (`markdown.ts:106-110`) — zero call sites anywhere under `packages/praxrr-app/src` outside its own definition. Drop it during the move rather than maintaining a dead export in the new shared surface. Verify once more with `grep -rn stripMarkdown packages/praxrr-app/src` before deleting.

## Interface Design

Proposed shared surface (`$shared/markdown/markdown.ts`):

```ts
export function parseMarkdown(md: string | null | undefined): string; // block, sanitized
export function parseMarkdownInline(md: string | null | undefined): string; // inline, sanitized
// stripMarkdown: delete (dead) — or keep as export * passthrough if any doubt
```

- `sanitizeHtml` stays **unexported** (file-private, as today). It is an implementation detail; exporting it invites callers to sanitize without parsing and to depend on its exact allowlist.
- Keep the `string | null | undefined` input signature — all 6 client copies already handle `null`, and server callers pass nullable entity fields (`displayTransform.ts:245`, `list.ts:182`).
- Extension point: none needed. If a future caller needs a different tag allowlist, that is a new function, not an options parameter (YAGNI until a second allowlist actually appears).
- Server file keeps `export *` so `stripMarkdown` removal is a (verified-safe) breaking change only for the shared path; no server importer uses it.

## Testability Patterns

**Conventions observed** (`src/tests/shared/`):

- Location mirrors source: `$shared/security/ip.ts` → `src/tests/shared/security/ip.test.ts`. So: `packages/praxrr-app/src/tests/shared/markdown/markdown.test.ts`.
- Style: `import { assert, assertEquals } from '@std/assert';`, `Deno.test('name', () => { ... })`, import subject via `$shared/.../x.ts` alias (works in Deno tests because `deno.json` maps the alias).
- Discovery: `deno task test` with no args runs the whole `packages/praxrr-app/src/tests` tree (`scripts/test.ts:62`) — **the new test is picked up automatically, no `scripts/test.ts` alias edit needed**. Aliases are optional conveniences; skip adding one (KISS), or add `markdown: 'packages/praxrr-app/src/tests/shared/markdown'` if the team wants a targeted run — either is fine, absence is fine.

**Testability of the code itself:** the module is pure functions over a string — no DI seams, fixtures, or DB needed. Ideal unit-test target. One test file covering:

1. `parseMarkdown` strips `<script>` and its content.
2. Event-handler attributes (`onclick="..."`) removed from allowed tags.
3. `javascript:` hrefs removed.
4. Allowed tags/attrs survive (`<a href title>`, `<code>`, table elements).
5. `null` / `undefined` / `''` → `''`.
6. `parseMarkdownInline` produces no wrapping `<p>`.

If the unquoted-attribute hardening (KISS §5) lands, add case 7: `onerror=x` (unquoted) stripped — this is the regression test that proves the fix.

## Build vs. Depend

| Decision                                                         | Verdict         | Rationale                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep hand-rolled `sanitizeHtml` vs add DOMPurify/`sanitize-html` | **Keep custom** | File comment documents the constraint: npm deps with DOM/postcss assumptions break `deno compile` binaries (`build`/`build:standalone` tasks). The allowlist is 25 tags / 2 attr sets — small enough to own. Cost: regex sanitizers are imperfect (see KISS §5); mitigate with the 2-line hardening + tests, not a new dep |
| `marked` for both block and inline                               | **Keep**        | Already pinned `^15.0.6` in both `deno.json` and `package.json`; server bundle and Vite client both consume it today. No action                                                                                                                                                                                            |
| Barrel `index.ts` for the new folder                             | **Don't build** | Single file; `utils/` precedent has no barrel                                                                                                                                                                                                                                                                              |
| `scripts/test.ts` alias entry                                    | **Don't build** | Auto-discovered                                                                                                                                                                                                                                                                                                            |

## Open Questions

1. **eslint baseline:** does `svelte.configs.base` (spread at `eslint.config.js:17`) already include `svelte/no-at-html-tags`? `node_modules` is absent in this worktree so it could not be verified. First implementation step: run `deno task lint` on a clean tree. If the rule is already active and passing, something is suppressing it — find that before adding config. If inactive, add `'svelte/no-at-html-tags': 'error'` to the svelte block (`eslint.config.js:41-53`) and expect to touch `Table.svelte`, `JsonView.svelte`, `CodeBlock.svelte` with justified disables — confirm this wider-than-six-files blast radius is in scope for YAN-560.
2. **`stripMarkdown` deletion:** confirmed zero usages in this worktree, but a final grep before deletion is required (it rides along in the server `export *`, so removing it changes that module's surface).
3. **Sanitizer hardening in-scope?** The unquoted-attribute bypass pre-dates the move, but the move _increases exposure_ (same sanitizer now guards client rendering of remote database content, e.g. `Table.svelte` cells fed by PCD rows). Recommend including the 2-line regex fix + test in this change; if the reviewer wants a pure-move PR, split hardening into a fast-follow issue instead of dropping it.
4. **`quality-profiles/[databaseId]/views/CardView.svelte:141`** renders `{@html profile.description}` where the description is already server-sanitized (`list.ts:182`). It is not one of the six, but the new lint rule will flag it. Leave with a disable comment, or render as plain text? Needs a product call — the HTML is intentional (server-parsed markdown), so disable-with-reason is the likely answer.
