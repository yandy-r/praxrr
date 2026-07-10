# Design: Versioned Documentation for the Praxrr Starlight Docs Site (Issue #78)

Status: **Decided** (evidence-backed). Off-the-shelf plugin rejected after an empirical
spike; adopting **isolated per-version Astro builds** orchestrated inside `npm run build`.

## Context

- Docs site `docs/site/` — Astro `^7.0.6` + `@astrojs/starlight ^0.41.3`,
  `@astrojs/svelte ^9`, `starlight-openapi ^0.26.0`, Tailwind v4, `astro-mermaid`.
- Sidebar is a large **manual array** in `docs/site/astro.config.mjs` plus
  `...openAPISidebarGroups` (single `starlight-openapi` instance, `base: 'api'`,
  schema `../api/v1/openapi.yaml`).
- `schema/*` and `database/*` content pages are **generated at build time** by
  `npm run sync:external-docs` (`docs/site/scripts/import-external-docs.mjs`) from the
  sparse-checked-out `praxrr-schema` / `praxrr-db` mirrors; it writes fallback stubs
  when the mirrors are absent.
- Deploy target: **Cloudflare Workers static assets** (`wrangler.toml`:
  `assets = { directory = "docs/site/dist" }`), deployed with `npx wrangler@latest deploy`.
  Site: `https://docs.praxrr.dev`. NOT Cloudflare Pages (the issue's wording is stale).
- CI `.github/workflows/docs-site.yml` builds on PR, deploys on push to `main`; it
  already creates the repo-root `dist/.svelte-kit/tsconfig.json` Svelte fallback.
- Praxrr is pre-v2 / v2 under active development; `docs/site/package.json` is `0.0.0`.

### Acceptance criteria (#78)

1. Version selector visible in nav.
2. At least two versions accessible (e.g. `v2.0` + development/next).
3. **Default route serves the latest stable version.**
4. Old versions accessible via versioned URL paths.
5. Documented process to publish a new docs version.
6. Versioned builds deploy correctly on Cloudflare (Workers here).
7. `cd docs/site && npm run build` builds cleanly; selector switches; Pagefind scopes
   per version.

## Approaches evaluated

### A) `starlight-versions` plugin (HiDeoo) — REJECTED (empirically blocked)

The obvious first choice (same author as the already-used `starlight-openapi`; native
selector; folder-based archiving). **Rejected on evidence, not on paper:**

- `starlight-versions@0.9.1` peer-dep is only `@astrojs/starlight >=0.39.0` (no Astro
  pin), so `npm i` resolves clean — a **false green**. Its changelog's most recent Astro
  support is **Astro v6** (0.8.0: "Adds support for Astro v6, drops v5"); no release
  declares Astro v7. This site is Astro `^7.0.6` (Starlight 0.41.3 requires `astro ^7.0.2`).
- **Spike (decisive):** installed `starlight-versions@0.9.1`, added
  `starlightVersions({ versions: [{ slug: '2.0' }] })`, ran `astro build`. Result:

  ```
  [@astrojs/starlight] An unhandled error occurred while running the "astro:config:setup" hook
  [AstroUserError] Could not parse expression with acorn
    Location: node_modules/starlight-versions/libs/plugin.ts:9:8
  ```

  The plugin's archiver crashes on the MDX/acorn stack, dying after archiving exactly 8
  of 98 files (deterministic across dev + build runs). It is not usable on this stack.

- Even if it built, its model serves live "current" at root and frozen snapshots at
  `/<slug>/` — inverted from acceptance #3 (root must serve the stable version).
- Forcing it (pin an unproven commit; or downgrade the whole docs stack to Astro 6) is a
  regression and is rejected.

### B) Single build with per-version content subdirectories — REJECTED

One `astro build`; versions as `src/content/docs/2.0/…`. Pagefind then produces one
global index, so per-version search scoping (acceptance #7) needs custom filter tagging +
a search wrapper; `starlight-openapi` needs multiple instances at different bases. Extra
fragile machinery for no benefit over (C).

### C) Isolated per-version Astro builds — CHOSEN

Each version is a self-contained `astro build` whose Astro `base` equals its URL prefix,
assembled into one `dist/`. Every version therefore gets, for free:

- its own **Pagefind** index at `<base>/pagefind/` → per-version search scoping (accept. #7);
- its own **starlight-openapi** reference under `<base>/api/`;
- its own **sidebar** (Astro `base` prefixes every `link:` automatically — no snapshot or
  link-rewrite of the manual sidebar);
- its own **editLink** ref.

## Decision

Orchestrate the multi-version build **inside `npm run build`** (a small
`scripts/build-versions.mjs`), not a CI matrix. `docs-site.yml` keeps calling
`npm run build`; the only CI addition is a dist file-count guard. This keeps one
checkout, no git-ref juggling, and makes `npm run build` reproduce the full versioned
site locally and in CI identically.

### Version manifest — single source of truth

`docs/site/versions.json`:

```json
[
  {
    "id": "2.0",
    "label": "v2.0 (Latest)",
    "base": "/",
    "ref": "main",
    "default": true
  },
  {
    "id": "next",
    "label": "Next (dev)",
    "base": "/next/",
    "ref": "main",
    "development": true
  }
]
```

### Build parametrization

`astro.config.mjs` reads `process.env.DOCS_VERSION` (defaults to the manifest's
`default` id), looks up its manifest entry, and sets:

- `base` = entry.base;
- `outDir` = `dist/.versions/<id>` (assembled afterward);
- `editLink.baseUrl` = `https://github.com/yandy-r/praxrr/edit/<ref>/docs/site/`;
- Starlight `banner` (only for `development` versions): a "you are viewing the
  in-development docs" notice — the concrete, honest distinction between the two versions
  while content is single-source.

`scripts/build-versions.mjs`: for each manifest entry, run `astro build` with
`DOCS_VERSION=<id>`; then assemble — the `default` version's output → `dist/` root, every
other version → `dist/<id>/`. Finally copy `versions.json` into `dist/` and run the
file-count guard.

### Version selector (acceptance #1)

`docs/site/src/components/VersionSelect.astro` — imports `versions.json`, reads the
current id from `process.env.DOCS_VERSION` (build-time, in the `.astro` frontmatter),
renders a native `<select>` whose options navigate to each version's `base`. Injected by
overriding Starlight's `Sidebar` component
(`components: { Sidebar: './src/components/VersionedSidebar.astro' }`), which renders
`<VersionSelect/>` above the imported default `<Sidebar/>`. Server-rendered; a tiny inline
`onchange` handler performs navigation (no framework hydration required).

### How acceptance #3 is satisfied (root = latest stable)

Structural, no redirect: the `2.0` build uses `base: '/'`, so its HTML and its
`/pagefind/` assets land at `dist/` root; `https://docs.praxrr.dev/` serves `2.0`
directly (HTTP 200). `next` is a separate build with `base: '/next/'` whose output is
placed under `dist/next/` — never at root.

### Pre-v2 reality (honest note)

There is no released stable version yet, so for the **first cut both versions render the
same current content**, distinguished by URL base, selector label, and the `next`
development banner. This stands up the versioning _mechanism_ (#1–#7) without inventing
divergent content or prematurely freezing unreleased docs. Genuine divergence is a
documented, content-only change (below).

## Publish-a-new-version process (acceptance #5)

Documented as a docs page (`docs/site/src/content/docs/app/docs-versioning.md`, added to
the Application nav) and referenced from `DEVELOPMENT.md`:

1. Freeze the outgoing stable: snapshot the current `src/content/docs/**` into
   `docs/site/versions/<old>/` (committed) **or** tag `docs-v<old>` and point that
   manifest entry's build at the frozen source; keep its built output rather than
   rebuilding rotting refs once ≥3 versions exist.
2. Add/adjust `versions.json`: new stable entry `base: '/'` `default: true`; the outgoing
   version moves to `base: '/<old>/'`.
3. `npm run build` (locally or CI) builds every entry and assembles `dist/`.
4. PR + merge → CI deploys the combined `dist/`.

Version builds must only run where the `praxrr-schema` / `praxrr-db` mirrors are present
(reuse CI's existing "Import mirror docs" step) so `sync:external-docs` never freezes
fallback stubs into a version.

## CI / deploy impact (exact files)

- `docs/site/astro.config.mjs` — env-parametrize `base`, `outDir`, `editLink`, `banner`;
  add `components.Sidebar` override.
- `docs/site/versions.json` (new) — manifest.
- `docs/site/scripts/build-versions.mjs` (new) — per-version build + assemble + guard.
- `docs/site/package.json` — `build` = `sync:external-docs` → `build-versions.mjs`.
- `docs/site/src/components/VersionSelect.astro` + `VersionedSidebar.astro` (new).
- `docs/site/src/content/docs/app/docs-versioning.md` (new) — publish process page.
- `.github/workflows/docs-site.yml` — add a `dist` file-count guard
  (`find docs/site/dist -type f | wc -l` under a threshold well below Cloudflare's
  20,000-files/Worker-version cap). `wrangler.toml` unchanged.

## Risks & mitigations

- **Plugin false-green (root cause of choosing C):** the real gate is `astro build` + a
  selector/per-version-search smoke test, never `npm i`. (Verified via spike.)
- **Old-ref toolchain rot:** freeze built output for archived stables once ≥3 versions.
- **Cloudflare file-count ceiling** (Pagefind emits many small files; ~215 HTML/version
  today): CI file-count guard; prune very old versions later.
- **Double build cost:** ~6s/version today; negligible; assembled sequentially.
- **Imported-stub freezing:** only build where both mirrors are checked out.
- **Selector cross-links:** link to each version's base root (content maps differ across
  versions), avoiding same-page 404s.

## Open decisions the plan resolves

1. Selector placement: `Sidebar` override (chosen) vs header slot.
2. `banner` copy + whether `next` is `noindex` for SEO (recommend `noindex` on `next`).
3. File-count guard threshold (proposed: 10,000).
4. Exact assemble strategy in `build-versions.mjs` (temp dirs vs ordered outDir).
