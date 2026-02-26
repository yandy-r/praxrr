# Documentation Research: trash-guide-sync-ux

## Architecture Docs

- `/docs/ARCHITECTURE.md`: System overview of PCD lifecycle, app DB schema/migrations, job queue,
  and Arr credential handling that TrashGuide sync must integrate with when persisting ops and
  scheduling jobs.
- `/docs/architecture/overview.md`: Runtime map covering startup hooks, API routes, PCD manager, and
  sync registry—useful for locating where TrashGuide managers, API routes, and caches belong.
- `/docs/architecture/data-flow.md`: Sequence diagrams for startup, PCD link/sync, Arr sync jobs,
  and package contracts that mirror the flow TRaSH syncing introduces (background pulls, cache
  rebuilds, job dispatch).

## API Docs

- `/docs/api/README.md`: Entry point for `/api/v1`, explaining conventions (base path, auth, error
  formats) that TrashGuide endpoints must follow and pointing to the OpenAPI source.
- `/docs/plans/trash-guide-sync/research-technical.md`: Deep dive into TRaSH-specific REST routes
  (sources CRUD, sync trigger, entities/quality-profile listings), related tables/jobs
  (`trash_guide_sources`, `trash_guide_sync_selections`, `trashguide.sync`), and request/response
  expectations; effectively the only authoritative API doc for this feature.

## Development Guides

- `/docs/DEVELOPMENT.md`: Workflow commands, branching strategy, release cadence, and testing
  checklist developers must follow while working on the TRaSH UX changes to ensure clean merges.
- `/docs/CONTRIBUTING.md`: Local setup, Svelte/UI conventions, and navigation pointers
  (architecture/API/plans) that surface the high-level docs needed before touching TRaSH routes or
  components.
- `/docs/features/link-bridge-sync.md`: Workflow guide for linking PCDs, bridging Arr instances, and
  configuring sync sections—the existing UX behavior TRaSH tabs, filters, and sync selections must
  align with.

## README Files

- `/README.md`: Repository overview, feature summary, deployment/env details, and primary links to
  `/docs/ARCHITECTURE.md` and `/docs/DEVELOPMENT.md` so new contributors know where to begin.
- `/docs/README.md`: Documentation index with quick links to architecture, API, features, and plans,
  serving as an orientation hub.
- `/docs/features/README.md`: Feature guide index recommending reading order for workflows
  (Link/Bridge/Sync, Entity Testing, Portable Import/Export), contextualizing how TRaSH UX
  enhancements fit into the user journey.

## Must-Read Documents

- `/docs/plans/trash-guide-sync-ux/feature-spec.md` (Must-read): Definitive UX spec detailing
  tabs/actions/badges, multi-source listing rules, validation expectations, sync-selection
  persistence, and page-level data requirements for custom formats, quality profiles, and Arr sync
  flows.
- `/docs/plans/trash-guide-sync/research-technical.md` (Must-read): Backend spec for TRaSH sync
  including tables, query modules, job handler, fetch/parse/transform/cache pipeline, REST routes
  with payload examples, and rationale for integration choices.
- `/docs/plans/trash-guide-sync-ux/research-external.md` (Nice-to-have): External TRaSH Guides
  documentation, Recyclarr/Notifiarr UX heuristics, and taxonomy guidance capturing community
  terminology and filter conventions beneficial for polishing the UX.
- `/docs/pr-reviews/pr-122-review.md` (Nice-to-have): Recent review notes highlighting type safety
  gaps, error mappings, missing tests, and sync assumptions to avoid in downstream work.

## Documentation Gaps

- The `/docs/api` directory and `docs/api/v1/openapi.yaml` omit `/api/v1/trash-guide/*` routes;
  engineers extending or consuming those endpoints must hunt through plans rather than a canonical
  API doc.
- `packages/praxrr-app/src/lib/server/trashguide` lacks a README/module-level guide summarizing the
  public APIs (`TrashGuideManager`, fetcher/parser/transformer), lifecycle, and how it hooks into
  jobs/caches.
- TRaSH-specific UI routes/components (`/routes/custom-formats/trash`, `/quality-profiles/trash`,
  badges/tabs in `/routes/arr/[id]/sync`) are documented only in the feature spec, so component
  props, badge variants, and filter expectations remain implicit in code instead of documented.
