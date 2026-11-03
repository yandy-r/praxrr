# Plan: Global command palette and cross-entity quick search (YAN-588 / GH #404)

Target release: next minor (v0.8.0), from `main`.

## Acceptance criteria (spec)

1. Ctrl/Cmd+K opens a focus-trapped palette from any authenticated page. Esc closes it and returns focus to where it was.
2. Typing an entity name returns matches from every linked database; Enter goes to that entity's edit route.
3. Results are navigable with arrow keys and Enter, announced via `aria-activedescendant`.
4. A Playwright spec covers open, search, navigate and close.

Proposal extras delivered: `/` shortcut (ignored inside editable fields), navbar trigger, nav-item results,
action results, recents ranked first and persisted per user, results grouped by type with a PCD/TRaSH source badge,
contract-first OpenAPI.

## Decisions

| Decision                                                                                                                                                                                                                                                                                | Why                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Lightweight `SELECT id, name` per PCD cache, not the heavy entity `list()` functions                                                                                                                                                                                                    | Search runs on every keystroke (debounced); the list functions load tags, conditions and tests                                   |
| Server-side ranking: exact > prefix > word-prefix > substring, case-insensitive; then name                                                                                                                                                                                              | Predictable ordering; client only prepends recents                                                                               |
| `q` trimmed, 1–100 chars; `limit` default 20, max 50 per response; per-type cap `max(3, ceil(limit / requestedTypeCount))` then rank-order backfill; `truncated` iff any match omitted                                                                                                  | Bounded work and payload; rejects empty/oversized input with 400; one dense type (e.g. 30 CFs) cannot hide an Arr instance       |
| TRaSH entities matched in JS over a narrow `trash_id, name` query per source from `trashGuideSourcesQueries.getAll()` (no SQL LIKE)                                                                                                                                                     | Existing `searchByName` does not escape `%`/`_`; avoids LIKE-injection semantics and loading `json_data`                         |
| A PCD cache that throws mid-query (concurrent rebuild/invalidate) is skipped with a warn log                                                                                                                                                                                            | One database's race must not fail the whole search with 500                                                                      |
| Arr instances returned without `url`/`api_key`                                                                                                                                                                                                                                          | Never leak credentials or internal URLs through search                                                                           |
| Quality-profile `arrType` filter uses `computeCompatibleProfileNames`                                                                                                                                                                                                                   | Repo rule: never trust `quality_profile_custom_formats.arr_type` for QP compatibility                                            |
| Metadata profiles only for `arrType` `lidarr` or `all`                                                                                                                                                                                                                                  | Lidarr-only feature (`supportsFeature`)                                                                                          |
| Recents: new additive table `user_command_palette_recents` + `GET/PUT /api/v1/ui-preferences/command-palette-recents`                                                                                                                                                                   | Existing ui-preferences table is mode-only with a CHECK constraint; additive table avoids altering it. Non-destructive migration |
| Recents backend chosen by root layout data (`recentsBackend`): `api` for a real user (id > 0), `localStorage` only for auth-bypass sessions; with `api`, a 401 (expired session) drops the write and network/5xx errors never fall back to `localStorage`; the key is cleared on logout | Network blips or session expiry must not silently fork recents into a browser-local copy another user could inherit              |
| Recents writes wait until the stored list has loaded; activations during load (or while the API is unavailable) merge ahead of it and save once; 429/5xx retry with bounded backoff; teardown flushes with `keepalive`                                                                  | A save must never overwrite recents it has not read                                                                              |
| Recents bounded to 10 entries, each field length-capped, href must be a same-origin relative path (`/` but not `//`); the 500-char href cap applies only to stored recents, not to navigation or search results                                                                         | Prevents stored open-redirect / oversized payloads without hiding long entity routes                                             |
| Toggle shortcut: Cmd+K on Apple platforms, Ctrl+K elsewhere, never with Shift/Alt, matched by `code === 'KeyK'` or `key` `k`                                                                                                                                                            | Avoids stealing browser/OS shortcuts and works on non-Latin layouts                                                              |
| "Sync instance X" navigates to `/arr/{id}/sync`                                                                                                                                                                                                                                         | No full-instance sync API exists; adding one is out of scope and would bypass the existing reviewed sync UI                      |
| Palette is a dedicated dialog, not `Modal.svelte`                                                                                                                                                                                                                                       | Modal always renders Cancel/Confirm                                                                                              |
| Svelte 5 legacy syntax (no runes)                                                                                                                                                                                                                                                       | Repo convention                                                                                                                  |

## Shared contract

### `GET /api/v1/search`

Query: `q` (required, trimmed 1–100 chars), `types` (optional, comma list of `SearchResultType`),
`arrType` (optional `radarr|sonarr|lidarr|all`, default `all`), `databaseId` (optional positive int), `limit` (optional 1–50, default 20).
Auth: normal `/api/v1` auth; API tokens need `read` scope (GET default). Response header `Cache-Control: no-store`.

```ts
type SearchResultType =
  | 'custom_format'
  | 'quality_profile'
  | 'regular_expression'
  | 'delay_profile'
  | 'metadata_profile'
  | 'arr_instance'
  | 'database';

interface SearchResult {
  type: SearchResultType;
  id: string; // stable key, e.g. "pcd:3:custom_format:12", "trash:5:custom_format:<trashId>", "arr:2", "database:3"
  name: string;
  href: string; // relative edit route
  source: {
    type: 'pcd' | 'trash';
    id: number;
    name: string;
    arrType?: 'radarr' | 'sonarr';
  } | null; // null for arr_instance/database
  arrType?: 'radarr' | 'sonarr' | 'lidarr'; // arr_instance type, or TRaSH source arr type
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
  truncated: boolean;
}
```

Errors: 400 `{ error }` for invalid params; 500 `{ error: 'Failed to search' }` (no internals).

Routes (`href`):

- CF `/custom-formats/{databaseId}/{id}`; TRaSH CF `/databases/trash/{sourceId}/custom-formats/{trashId}/`
- QP `/quality-profiles/{databaseId}/{id}/general`; TRaSH QP `/databases/trash/{sourceId}/quality-profiles/{trashId}/`
- Regex `/regular-expressions/{databaseId}/{id}`
- Delay profile `/delay-profiles/{databaseId}/{encodeURIComponent(name)}`
- Metadata profile `/metadata-profiles/{databaseId}/{encodeURIComponent(name)}`
- Arr instance `/arr/{id}` ; Database `/databases/{id}` (TRaSH sources are not returned as `database`)

### `GET|PUT /api/v1/ui-preferences/command-palette-recents`

```ts
interface CommandPaletteRecent {
  key: string;
  label: string;
  href: string;
  kind: string;
  usedAt: string;
} // ISO
interface CommandPaletteRecentsResponse {
  recents: CommandPaletteRecent[];
}
// PUT body: { recents: CommandPaletteRecent[] } (≤10; key ≤200, label ≤200, href ≤500 relative "/..." not "//", kind ≤40)
```

401 when `!locals.user` or user id 0 (client falls back to localStorage key `praxrr:command-palette:recents`). 400 on invalid body.

## Tasks

- Backend: OpenAPI (paths/search.yaml, schemas/search.yaml, recents), regenerate types + bundle, `lib/server/search/` service,
  routes, migration + query module + schema.sql, unit tests (`tests/routes/search.test.ts`, recents), `scripts/test.ts` alias `search`, docs.
- Frontend: `lib/client/ui/command-palette/CommandPalette.svelte`, open store, navbar trigger, root-layout mount, nav/action sources,
  recents client, Playwright `6.3-command-palette.spec.ts`, docs site sections.
