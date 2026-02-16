# Business Logic Analysis: external-url

## Executive Summary

Current Arr instances share a single `URL` value for both API traffic and the various "Open in" buttons that navigate users to the upstream app UI. In Docker/internal-network deployments that URL is commonly an internal hostname that browsers cannot reach, so the "Open in" links are effectively broken. Introducing an optional `External URL` that is used only for browser navigation lets us keep the existing `URL` for Diplomarr-to-app communication while giving operators a browsable address they can control. The solution must work for every Arr record (including ones created before the feature) and take effect immediately when the extra URL is provided.

### User Stories

- Primary: As a deployment operator, I want the "Open in" actions to open a browser-accessible address even when the canonical Arr URL is an internal container hostname, so I can inspect the upstream UI without proxying.
- Primary: As a Profilarr administrator, I want to keep the existing `URL` field as the single source of truth for API calls, tests, and background jobs, while optionally supplying a separate `External URL` for user-facing links.
- Secondary: As someone managing existing Arr instances, I want the new External URL to be optional and to start being used as soon as I enter it—no re-adding or re-syncing the instance.
- Secondary: As a support engineer, I want consistent behavior across the list view, cards, and library so every "Open in" button can be relied upon regardless of deployment topology.

### Business Rules

- Every Arr instance continues to require one canonical `URL` for all server-to-server traffic (tests, syncs, library fetches, jobs). Nothing should switch to `External URL` for those flows.
- Each Arr instance may optionally store an `External URL` that represents the browser-accessible address for that app
  - When `External URL` is non-empty after trimming whitespace, every "Open in" link must resolve to it.
  - When `External URL` is null/empty or consists only of whitespace, fall back to the canonical `URL` so behavior remains unchanged.
- The resolver for "Open in" must be shared across the library view, the Arr list table, and the card layout so the link semantics are the same everywhere.
- The moment the stored value of `External URL` changes, UI actions must pick up the new value, and removing it must immediately revert to the canonical URL; no extra steps or caching invalidation should be required.
- `External URL` must only be used for navigation; it must never be substituted into any backend client, HTTP call, or job that currently relies on the canonical `URL`.
- Link generation should normalize trailing slashes so that `External URL` and `URL` behave identically when concatenated with known subpaths (`/movie/...`, `/series/...`, `/artist/...`).

### Workflows

- Configuration:
  1. Admin adds or edits an Arr instance via the existing form and populates the `URL` (required) and, optionally, `External URL`.
  2. The canonical URL continues to be used for connection testing and background syncs; the new field is stored alongside it.
  3. Upon save, any browser "Open in" action immediately starts using the provided `External URL` whenever present while existing instances without the field remain unchanged.
- "Open in" usage:
  1. User clicks the open action from the library action bar or a per-row open icon, or from the Arr list view cards/table.
  2. UI resolves the browser base address by looking first at the `External URL` and falling back to the canonical `URL` if necessary.
  3. The link opens in a new tab, targeting the resolved host; no other part of the app is affected.

### Domain Concepts

- **Arr Instance**: A Radarr/Sonarr/Lidarr/etc. server configured in Profilarr with credentials, tags, and its canonical connection URL.
- **Canonical URL**: The existing `URL` field that Profilarr trusts for API calls, jobs, syncs, and connection validation.
- **External URL**: The new optional address that points to the same Arr UI but is reachable from the browser; it is used exclusively for navigation actions.
- **Open in Action**: Any button or link that opens the Arr UI from Profilarr (library action bar, row-level buttons, list view cards/tables).
- **Resolution Logic**: The shared decision of whether to use `External URL` or fall back to the canonical URL when rendering an "Open in" link.

### Success Criteria

- Existing instances without an External URL continue to behave exactly as today; their "Open in" links still navigate via the canonical URL.
- When an External URL is supplied, every "Open in" action in the library, cards, and table uses it instantly without touching other flows.
- Canonical connections, API clients, sync jobs, and cleanup routines still rely on the required `URL` field and never route through the External URL.
- Operators clearly understand the split semantics via labeling/help text and can edit or remove the External URL without a schema migration impacting workflow.
- Normalized links avoid double slashes regardless of which URL is used, keeping downstream redirects predictable.

### Open Questions

- Should the UI validate that any External URL is absolute and reachable, or leave that to the operator with a help note?
- Should the External URL field be visible to every user immediately, or gated behind an "advanced" toggle to avoid confusion?
- Are there other "Open in" surfaces (logs, releases, other dashboards) that should share this resolver now, or can they be rolled into a follow-up once the library/list core is stable?
