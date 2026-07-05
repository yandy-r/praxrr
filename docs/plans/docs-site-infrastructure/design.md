# Docs Site Infrastructure Design

Issue: [#38](https://github.com/yandy-r/praxrr/issues/38)

## Goal

Ship a functional Astro Starlight documentation site under `docs/site/` that can publish the Praxrr
application docs, PCD schema docs, PCD database docs, and generated OpenAPI reference from one static
site.

## Site Shape

- `docs/site/` owns the Astro project, dependencies, and static build output.
- Starlight provides docs routing, sidebar navigation, dark mode, and Pagefind search.
- `@astrojs/svelte` enables Svelte islands inside docs pages.
- Tailwind CSS v4 is enabled through the Vite plugin and imported from Starlight custom CSS.
- `starlight-openapi` reads `docs/api/v1/openapi.yaml` and generates `/api/` pages at build time.

## Multi-Repo Documentation Import

Until all docs sources live in the monorepo, `docs/site/scripts/import-external-docs.mjs` imports:

- `praxrr-schema/docs/structure.md`
- `praxrr-schema/docs/manifest.md`
- `praxrr-db/README.md`

Local builds read from `packages/praxrr-schema` and `packages/praxrr-db`. CI builds sparse-checkout
copies of `yandy-r/praxrr-schema` and `yandy-r/praxrr-db`, then points the import script at those
copies.

## CI and Deployment

`.github/workflows/docs-site.yml` validates the docs site on pull requests and pushes that touch docs
site inputs. On pushes to `main` and repository dispatch rebuild events, it uploads the static site
artifact and deploys `docs/site/dist` to Cloudflare Pages when Cloudflare credentials are configured.

The mirror publish workflows trigger repository dispatch rebuilds after successful non-dry-run
publishes:

- `praxrr-db-docs`
- `praxrr-schema-docs`

## Validation

Required local checks:

- `cd docs/site && npm ci`
- `cd docs/site && npm run build`
- `cd docs/site && npm audit --omit=dev`
- repository docs lint/format checks

Manual checks:

- `/api/` renders generated OpenAPI pages.
- `/schema/structure/`, `/schema/manifest/`, and `/database/readme/` render imported mirror docs.
- The landing page renders the Svelte island and Tailwind styling.
- `docs/site/dist/pagefind/` exists after production build.
