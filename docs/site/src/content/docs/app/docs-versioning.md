---
title: Docs Versioning
description: How the Praxrr documentation site serves multiple versions and how to publish a new one.
---

The documentation site can serve multiple versions of the docs at once. The version
selector in the sidebar switches between them, and each version has its own URL prefix,
navigation, API reference, and search index.

## How it works

Versioning uses **isolated per-version Astro builds** assembled into one deploy. There is
no third-party versioning plugin — the mechanism is a small manifest plus a build
orchestrator.

- **`versions.json`** (in `docs/site/`) is the single source of truth. Each entry:

  | Field         | Meaning                                                       |
  | ------------- | ------------------------------------------------------------- |
  | `id`          | Stable identifier, also the URL segment (e.g. `2.0`, `next`). |
  | `label`       | Text shown in the version selector.                           |
  | `base`        | URL base: `/` for the default, `/<id>/` for the rest.         |
  | `ref`         | Git ref used for that version's "Edit page" links.            |
  | `default`     | Exactly one entry is `true`; it is served at the site root.   |
  | `development` | Optional; shows an "in-development" banner for that version.  |

- **`scripts/build-versions.mjs`** runs one `astro build` per entry with
  `DOCS_VERSION=<id>` set. `astro.config.mjs` reads `DOCS_VERSION` and sets the Astro
  `base`, output directory, and edit-link ref, registers the per-version `Sidebar` and
  `Banner` component overrides, and marks `development` versions `noindex`.
- Each build produces its own pages, its own Pagefind search index, and its own OpenAPI
  reference under its base. The orchestrator then assembles them: the default version at
  `dist/`, every other version under `dist/<id>/`. A guard verifies the assembled output
  before it is deployed.
- Deployment is unchanged: Cloudflare Workers serve the whole `docs/site/dist` tree, so
  the default version answers at `https://docs.praxrr.dev/` and, for example, the `next`
  version at `https://docs.praxrr.dev/next/`.

The version selector navigates to the **root of the chosen version** (not the equivalent
sub-page), because content maps differ across versions.

### Pre-v2 note

Until Praxrr v2 is released there is only one line of documentation, so every configured
version currently renders the **same content** — they are distinguished only by URL base,
selector label, and the development banner. This stands up the versioning mechanism now;
real divergence begins when a stable version is frozen (below).

## Publish a new version

1. **Freeze the outgoing stable content** so it stops tracking ongoing edits — either tag
   its git ref (e.g. `docs-v2.0`) or snapshot `src/content/docs/**` into a committed
   `versions/<id>/` directory, and point that version's build at the frozen source.
2. **Edit `versions.json`:** add the new stable entry with `base: "/"` and
   `default: true`; move the previous version to `base: "/<id>/"` and drop its `default`.
3. **Build:** run `npm run build` in `docs/site/`. The orchestrator builds every entry
   and the guard checks the assembled `dist/`.
4. **Open a PR.** CI rebuilds and runs the same guard; merging to `main` deploys the
   combined site to Cloudflare Workers.

Only build versions where the `praxrr-schema` / `praxrr-db` mirrors are checked out, so
the `sync:external-docs` step never freezes fallback stub content into a version.

:::caution
The selector uses an inline `onchange` handler. This works because the docs deploy has no
`script-src` Content-Security-Policy. If such a CSP (without `unsafe-inline`) is ever
added, move the handler into an Astro `<script>` block using `addEventListener`.
:::
