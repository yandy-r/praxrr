# Issue #78 — Versioned Docs (Starlight) — Implementation Plan

> Derived from `78-docs-versioning-design.md` via a planning workflow (draft + two
> adversarial validators + finalize). Astro/Starlight mechanisms below were also
> **empirically confirmed** in this repo before implementation (spike builds).

## Empirical corrections applied

- **Per-version HTML count ≈ 215 (total ≈ 430), not ~110/~220.** A baseline
  `npm run build` reported "215 page(s) built / Found 215 HTML files" for a single
  version. The guard floors below (`>=90` per version, `>=180` total) are therefore
  conservative and will not false-throw; the **symmetry check** (default vs next within 5) is the meaningful assertion since both versions render identical pre-v2 content.
- **`starlight-versions` plugin rejected on evidence:** `astro build` with the plugin
  fails in `astro:config:setup` (`Could not parse expression with acorn`,
  `node_modules/starlight-versions/libs/plugin.ts:9`). Do not reintroduce it.

## Validated design invariants (build to these — confirmed, do not re-litigate)

- Astro `base` only rewrites generated link/asset hrefs; **physical output stays at
  `outDir` root** (not nested under base). Confirmed: `base='/next/'` +
  `outDir='dist/.versions/next'` emitted `dist/.versions/next/index.html` with
  `/next/`-prefixed URLs and `dist/.versions/next/pagefind/`.
- `process.env.DOCS_VERSION` is readable in `astro.config.mjs` and in `.astro`
  frontmatter at build time (frontmatter runs in Node). No `PUBLIC_` prefix needed.
- Pagefind writes to `outDir/pagefind/`; Starlight loads it via `BASE_URL + '/pagefind/'`,
  so each version's search is scoped to its own index.
- Starlight override: `components: { Sidebar: './src/components/VersionedSidebar.astro' }`;
  import the stock sidebar via `@astrojs/starlight/components/Sidebar.astro`. Stock
  `Sidebar.astro` reads `Astro.locals.starlightRoute` (NOT props/slot) → the override
  needs no prop/slot forwarding.
- starlight-openapi (`base: 'api'`) renders correctly under a non-root base
  (`/next/api/...`); its schema filesystem path is unaffected by web base.
- Cloudflare Workers static assets (`wrangler.toml assets = docs/site/dist`) serve
  `/next/` and `/next/pagefind/` with **no wrangler change**.
- `.gitignore` already ignores `/dist` and `/docs/site/dist` (covers `dist/.versions`);
  the 5 new tracked files live outside ignored paths.

## Tasks (strict order: T1 → T2 → T3 → T4 → T5 → T6 → {T7, T8} → T9)

### T1 — `docs/site/versions.json` (manifest, source of truth)

JSON array; exactly one `default:true`; default `base:'/'`, others `'/<id>/'`; `ref`
feeds editLink; `development:true` toggles the dev banner.

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

### T2 — `docs/site/src/components/VersionSelect.astro`

Build-time frontmatter reads the manifest + `process.env.DOCS_VERSION`; renders a native
`<select>` whose options' `value` is each version `base`; inline
`onchange="location.href=this.value"` (navigate-to-base). Includes an `sr-only` label.

### T3 — `docs/site/src/components/VersionedSidebar.astro`

`import Default from '@astrojs/starlight/components/Sidebar.astro'` + `import VersionSelect`;
render `<VersionSelect />` then `<Default />` (no slot/prop forwarding — stock reads locals).

### T4 — `docs/site/astro.config.mjs`

Resolve active version from `DOCS_VERSION` (default = manifest default). Set top-level
`base` (`'/'` or `'/next'` — **strip trailing slash** for Astro), `outDir:
./dist/.versions/<id>`. Inside `starlight({})`: parameterize `editLink.baseUrl` by `ref`;
add `banner` only for `development` versions; add `components.Sidebar` override; add an
Application-nav item `{ label: 'Docs Versioning', link: '/app/docs-versioning/' }`.

### T5 — `docs/site/scripts/build-versions.mjs` (orchestrator + guard)

Read manifest; `rm -rf dist`; for each entry run `astro build` with `DOCS_VERSION=<id>`
(emits into `dist/.versions/<id>`); assemble default → `dist/`, others → `dist/<id>/`
(fail fast if `<src>/index.html` missing); remove `dist/.versions`; copy `versions.json`
into `dist/`. **Guard:** assert `dist/index.html`, `dist/next/index.html`,
`dist/pagefind`, `dist/next/pagefind`, `dist/versions.json` exist; count `*.html` per
version + total; assert each `>=90`, total `>=180`, and symmetry `|default-next| <= 5`.

### T6 — `docs/site/package.json`

`build` = `npm run sync:external-docs && node scripts/build-versions.mjs` (sync runs once;
orchestrator re-runs only `astro build` per version). `dev`/`preview`/`sync` unchanged.

### T7 — `docs/site/src/content/docs/app/docs-versioning.md` + `docs/DEVELOPMENT.md`

New Starlight page documenting the mechanism + publish flow (edit `versions.json` →
`npm run build` → CI guard → Cloudflare deploy of `docs/site/dist`), the honest pre-v2
identical-content note, banner/selector semantics, and the inline-onchange/CSP caveat.
Append a short "Docs Versioning" note to `DEVELOPMENT.md`.

### T8 — `.github/workflows/docs-site.yml`

Add a guard step after "Build docs site", before "Upload…": recompute per-version/total
HTML counts, assert floors + symmetry + required files, and **grep the selector**
(`<option value="/" selected` in `dist/index.html`; `<option value="/next/" selected` in
`dist/next/index.html`) so criterion #7 is CI-enforced. `wrangler.toml` and the existing
`Prepare monorepo TypeScript fallback` step unchanged.

### T9 — Verification

Repo-root Svelte fallback exists; prove base-output invariant (`DOCS_VERSION=next astro
build` → `dist/.versions/next/index.html`, not double-nested); `npm run build` GREEN;
assert dist structure + two pagefind dirs + banner difference; serve (`wrangler dev`/`astro
preview`) and check `/`, `/next/`, `/next/pagefind/pagefind.js`; drive the selector with
Playwright (select "Next (dev)" → lands on `/next/`); dry-run the CI guard locally.

## Acceptance-criteria coverage

| #   | Criterion                               | Delivered                            | Enforced                            |
| --- | --------------------------------------- | ------------------------------------ | ----------------------------------- |
| 1   | Version selector in nav                 | T2/T3/T4                             | T8 selector grep; T9 Playwright     |
| 2   | Two versions accessible                 | T1/T5                                | T8 file asserts; T9                 |
| 3   | Default = latest stable at root         | T1 `default`+`base:'/'`, T5 assembly | T8 `dist/index.html`; T9            |
| 4   | Versioned `/next/` paths                | T4 base, T5 assembly                 | T8 `dist/next/**`; T9               |
| 5   | Publish-process documented              | T7                                   | T7/T9 build                         |
| 6   | Deploys versioned builds                | deploy job unchanged (validated)     | T8 contract asserts; T9 local serve |
| 7   | build + selector + per-version Pagefind | T2/T4/T5                             | T8 grep + pagefind-dir asserts; T9  |

## Unresolved risks (carry to review)

1. Selector is **navigate-to-base** (lands on version home, not equivalent sub-page) — by
   design for #78; revisit if page-preserving switching is required.
2. Inline `onchange` relies on no `script-src` CSP on the Cloudflare static deploy;
   documented, mitigation (Astro `<script>` addEventListener) not implemented.
3. Guard absolute floors assume current content size; symmetry check is growth-robust,
   floors are conservative (real ≈215/version).
4. Production `/next/` serving is only confirmed after merge-to-main triggers the deploy
   job (Cloudflare secrets unavailable in PR CI).
