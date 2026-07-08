---
title: Display & Formatting
description: 'Content-display components: code blocks, rendered Markdown, and formatted JSON view.'
---

This category covers reusable content-display components for rendering code, Markdown, and structured data. All components live under `$ui/` (source: `packages/praxrr-app/src/lib/client/ui/`) and use Svelte 4 `export let` prop declarations.

## CodeBlock (display)

Minimal preformatted code display that renders raw text as escaped content inside a styled `<pre><code>` block with word-wrapping, monospace font, and optional line clamping. No syntax highlighting.

```svelte
import CodeBlock from '$ui/display/CodeBlock.svelte';
```

| Prop       | Type                  | Default     | Required | Description                                                                                                                                                            |
| ---------- | --------------------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`     | `string`              | —           | Yes      | The raw code/text to render. Output as escaped text (`{code}`), not HTML.                                                                                              |
| `maxLines` | `number \| undefined` | `undefined` | No       | When set, truncates the display to this many lines using `-webkit-line-clamp` / `-webkit-box` truncation with overflow hidden. When undefined, no clamping is applied. |

### Usage

```svelte
<script>
  import CodeBlock from '$ui/display/CodeBlock.svelte';
</script>

<CodeBlock code={rawSql} maxLines={5} />
```

### Variants & Notes

- Line-clamped vs full: controlled by the presence of `maxLines`.
- Light/dark theming is baked in via Tailwind `dark:` classes (`bg-neutral-100/800`, `text-neutral-900/100`).
- Distinct from `$ui/meta/CodeBlock.svelte` (same file name, different directory and API). This display variant has no highlight.js, no `language`, and no label/icon slot; it renders escaped plain text only.
- Not referenced in the dev/components showcase route.

## Markdown

Renders a Markdown string to HTML using the `marked` library and injects it via `{@html}`. Supports inline (`parseInline`) or block (`parse`) rendering with small muted typography and optional line clamping. Renders nothing when content is empty or null.

```svelte
import Markdown from '$ui/display/Markdown.svelte';
```

| Prop       | Type                  | Default     | Required | Description                                                                                                                                        |
| ---------- | --------------------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content`  | `string \| null`      | `null`      | No       | Markdown source string to parse and render. When null or empty, the component renders nothing (the `{#if html}` guard fails).                      |
| `inline`   | `boolean`             | `true`      | No       | When true, uses `marked.parseInline` (no wrapping block/paragraph elements); when false, uses `marked.parse` for full block-level Markdown.        |
| `maxLines` | `number \| undefined` | `undefined` | No       | When set, truncates rendered output to this many lines via `-webkit-line-clamp` / `-webkit-box` with overflow hidden. When undefined, no clamping. |

### Usage

```svelte
<script>
  import Markdown from '$ui/display/Markdown.svelte';
</script>

<Markdown content={item.description} inline={false} maxLines={3} />
```

### Variants & Notes

- `inline` (default) vs block rendering.
- Scoped `:global` styles style rendered `code` (light/dark backgrounds), `strong` (font-weight 600), and `a` (accent-colored underlined links, light/dark).
- Line-clamped vs full via `maxLines`.
- Wraps output in a `<span>` with class `markdown`.
- Uses `{@html}` on `marked` output — assumes trusted/controlled Markdown input (no sanitization shown).
- Not referenced by name in the dev/components showcase (that page demos the related `MarkdownInput` form component instead).

## CodeBlock (meta)

Syntax-highlighted code block using highlight.js (`json` and `sql` languages registered, plaintext fallback via `highlightAuto`). Renders inside a bordered/rounded panel with an optional uppercase label and an icon slot.

```svelte
import CodeBlock from '$ui/meta/CodeBlock.svelte';
```

| Prop       | Type             | Default | Required | Description                                                                                                                                                              |
| ---------- | ---------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `code`     | `string`         | `''`    | No       | The code to highlight and display. When empty string, nothing is highlighted (empty output).                                                                             |
| `language` | `string`         | `'sql'` | No       | Highlight language. Resolved against `hljs.getLanguage`; if unknown it falls back to `'plaintext'` which uses `hljs.highlightAuto`. Registered languages: `json`, `sql`. |
| `label`    | `string \| null` | `null`  | No       | Optional heading rendered above the code in small uppercase tracking-wide style. When null, the label row (and icon slot) is not rendered.                               |

### Slots

- `icon` — named slot rendered inside the label row (only shown when `label` is set), before the label text.

### Usage

```svelte
<script>
  import CodeBlock from '$ui/meta/CodeBlock.svelte';
</script>

<CodeBlock
  code="SELECT * FROM profiles WHERE name = 'HD-1080p';"
  language="sql"
  label="Query"
>
  <SomeIcon slot="icon" />
</CodeBlock>

<CodeBlock code={'{ "name": "HD-1080p", "cutoff": 7 }'} language="json" />
```

### Variants & Notes

- Language-driven highlighting: `sql`, `json`, or plaintext (auto) fallback.
- Labeled vs unlabeled (`label` prop).
- Light/dark themed panel (`bg-neutral-50/950`, border, text); hljs backgrounds forced transparent via scoped `:global` style, monospace via `--font-mono`.
- Output uses `{@html highlighted}` from highlight.js — highlight.js escapes input, so this is safe for arbitrary code strings.
- Registers languages at module load (`hljs.registerLanguage` for json and sql).
- Shares the file name `CodeBlock.svelte` with the display variant but has a completely different API (adds `language`, `label`, `icon` slot; drops `maxLines`).
- Shown in the showcase _Meta_ card.

## JsonView

Renders an arbitrary data object as syntax-highlighted JSON (via highlight.js). If the object has a `queries` array of SQL strings, those are stripped from the JSON view and rendered separately as a labeled list of individually SQL-highlighted blocks.

```svelte
import JsonView from '$ui/meta/JsonView.svelte';
```

| Prop   | Type      | Default | Required | Description                                                                                                                                                                                                                                      |
| ------ | --------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data` | `unknown` | —       | Yes      | The value to display. Serialized with `JSON.stringify(…, null, 2)` and highlighted as JSON. If it is an object containing a `queries` array, the queries are removed from the JSON output and rendered as separate SQL-highlighted blocks below. |

### Usage

```svelte
<script>
  import JsonView from '$ui/meta/JsonView.svelte';
</script>

<JsonView
  data={{
    name: 'HD-1080p',
    cutoff: 7,
    upgradesAllowed: true,
    queries: [
      "INSERT INTO profiles (name) VALUES ('HD-1080p');",
      "UPDATE profiles SET cutoff = 7 WHERE name = 'HD-1080p';",
    ],
  }}
/>
```

### Variants & Notes

- Two rendering modes driven by data shape: plain JSON (no `queries` key) vs JSON-plus-SQL-queries section (when data is an object with an array `queries`).
- The queries section shows a count header `Queries (N)` and one bordered card per query.
- Detects queries via `hasQueries` (data is object, has `queries` key, value is an array); `dataWithoutQueries` filters out the queries key before JSON stringify.
- Uses `{@html}` on highlight.js output (json for metadata, sql per query) — hljs escapes input so it is safe.
- Registers json and sql languages at module load; uses reactive `$:` derivations.
- Shown in the showcase _Meta_ card with a data object containing name/cutoff/upgradesAllowed and a queries array.
