# Command Palette

## Overview

The command palette is a global, keyboard-first search across pages, quick actions, and the
entities in every linked database. It is available on every authenticated page (and on bypass
sessions such as `AUTH=off`), but not on `/auth/*` or the `/setup` wizard.

Search API:

- `GET /api/v1/search?q=<term>&limit=20`

Recents API:

- `GET /api/v1/ui-preferences/command-palette-recents`
- `PUT /api/v1/ui-preferences/command-palette-recents`

## Opening and closing

- Press **Ctrl+K** (Windows/Linux) or **⌘K** (macOS) on any page. The same shortcut closes it.
- Press **/** when focus is not in a text field, textarea, select, or rich-text editor.
- Click the search button in the top navbar (it shows the shortcut hint on wider screens).
- Press **Esc** or click outside the panel to close. Focus returns to where it was before opening.

The palette does not open over another open dialog.

## Searching

Type in the search field. Results are grouped in this order:

1. **Recent**: items you opened from the palette, newest first.
2. **Pages**: navigation entries, including sub-pages such as Settings → Logs. Entries hidden by the
   current Arr scope selector are hidden here too. Log Out is never listed.
3. **Actions**: _New custom format_, _Open score simulator_, and _Sync instance {name}_ for each
   matching Arr instance.
4. **Entities**: custom formats, quality profiles, regular expressions, delay profiles, metadata
   profiles, Arr instances, and databases, from every linked database and TRaSH Guides source.

Pages and actions are matched in the browser; entities come from `GET /api/v1/search`, which runs
about 150 ms after you stop typing. Each entity shows a source badge (PCD database or TRaSH source)
so same-named entities from different databases can be told apart. When the Arr scope selector is
set to a single app, entity search is limited to that app.

With an empty query, the palette shows recents, then pages and the static actions.

### Actions

| Action               | Destination                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| New custom format    | `/custom-formats/{databaseId}/new` when the current page belongs to a database, otherwise `/custom-formats` (which opens the first database) |
| Open score simulator | `/score-simulator`                                                                                                                           |
| Sync instance {name} | `/arr/{id}/sync`, the reviewed sync page for that instance. The palette never starts a sync by itself.                                       |

## Keyboard reference

| Key                 | Effect                                                             |
| ------------------- | ------------------------------------------------------------------ |
| ArrowDown / ArrowUp | Move the highlighted result (wraps around)                         |
| Enter               | Open the highlighted result (the first result by default)          |
| Esc                 | Close the palette                                                  |
| Tab / Shift+Tab     | Cycle focus inside the palette (focus is trapped while it is open) |

The search field is an ARIA combobox. The highlighted result is announced through
`aria-activedescendant`, and a polite live region reports the result count, "No results", and
errors ("Searching…" only when a search takes longer than half a second).

## Recents

- Opening any result records it as a recent (max 10, deduplicated, newest first).
- Recents are stored per user through the recents API. Writes are coalesced client-side because the
  API is rate-limited, wait until the stored list has loaded (so nothing is overwritten unread), and
  retry with backoff after `429` or server errors.
- Auth-bypass sessions (`AUTH=off`, local bypass) have no user id, so the palette keeps their
  recents in the browser's `localStorage` under `praxrr:command-palette:recents`. Signed-in users
  never fall back to `localStorage`: after an expired session (`401`) the change is dropped; while
  the API is unreachable it stays in memory and is saved once the API answers again. Logging out
  from the nav clears the `localStorage` key.
- Recents read from the API or `localStorage` are validated. Entries with a non-relative link
  (anything not starting with a single `/`) are dropped. Links longer than 500 characters still
  open but are not stored as recents.
- A recent quick action (for example **New custom format**) opens its current, context-aware
  target rather than the link stored when it was used.

## Errors

- Search failures show a short inline message in the palette rather than an alert toast.
- If the session has expired, the palette asks you to sign in again.

## Related documentation

- [API endpoints: Search and UI preferences](../api/endpoints.md)
- [OpenAPI paths: Search](../api/v1/paths/search.yaml)
- Component reference: `docs/site/src/content/docs/app/components/shell.md` (CommandPalette)
