# Progressive Disclosure

Progressive disclosure in Praxrr is for **end users configuring media apps** (Radarr/Sonarr/Lidarr).
It keeps setup and sync pages focused by showing advanced controls only when you ask for them.
It is not a developer-only page or an internal settings screen.

## User-facing behavior

A section that has advanced options shows two explicit actions:

- `Show Advanced`
- `Hide Advanced`

This behavior is implemented per section, not globally, so you can keep advanced options open for
`Custom Formats` while leaving `Media Settings` collapsed.

Key behaviors:

- All sections load in `basic` mode by default.
- If a section is wrapped in a complexity tier provider, its first-render default comes from the
  section tier: `beginner` and `intermediate` default to `basic`; `advanced` defaults to
  `advanced`.
- Basic controls are visible first.
- Advanced blocks are separated into distinct cards with a section label and short hint.
- Toggling preserves the current form data and only changes visibility.
- The control always reflects state via:
  - Button label (`Show Advanced` / `Hide Advanced`)
  - `aria-expanded`
  - Visible/hidden panel state

## Advanced-section design rules

### 1) Explicit state

- Use text actions; avoid icon-only disclosure.
- Keep actions near the section card header so users can discover the boundary quickly.

### 2) Structure

- Put only related, optional controls inside one advanced section.
- Do not mix required/critical controls into advanced-only sections.
- Use a short hint in each section so non-technical users know what it controls before opening it.

### 3) Deterministic ownership

- Every advanced block uses one deterministic section key in this format:

`route-family:route-section:ui-section`

Examples:

- `media-management:media-settings:naming`
- `media-management:media-settings:folder-management`
- `media-management:media-settings:importing`
- `custom-formats:general:conditions`
- `custom-formats:general:scoring`
- `custom-formats:general:negation-and-groups`
- `quality-profiles:general:custom-format-scoring`
- `quality-profiles:general:upgrade-settings`

Invalid keys are rejected.

- Uppercase or spaces in segments are invalid.
- Empty or missing segments are invalid.
- Keys must be exactly three `:`-separated tokens.

### 4) Route-family isolation

- Section visibility is isolated by family and section key.
- Preferences for `/media-management` do not affect `/custom-formats`, even when sections share
  similar labels.

## Persistence semantics (API-backed)

Section visibility mode is stored per logged-in user.

- Keyed by `section_key`.
- Value is `mode: basic | advanced`.
- Anonymous users get safe defaults and no DB writes.
- The read path returns defaults when no row exists.
- Writes are idempotent when the value is unchanged.

Default response for first visit:

```json
{
  "section_key": "custom-formats:general:scoring",
  "mode": "basic",
  "updated_at": null,
  "persisted": false
}
```

Endpoint behavior:

- `GET /api/v1/ui-preferences?section_key=...`
  - returns the current mode for the current user and section
  - includes `persisted` and `updated_at`
  - `strict=false` (default): missing preference returns `basic`
  - `strict=true`: missing preference returns `404`
- `PATCH /api/v1/ui-preferences`
  - body: `section_key`, `mode`, optional `expected_updated_at`
  - stores the preference for authenticated users
  - supports optimistic concurrency via `expected_updated_at`

## Progressive complexity tiers

Progressive complexity is a layer above disclosure mode. It stores a per-user, per-section tier:

- `beginner`
- `intermediate`
- `advanced`

The tier only chooses the **default** disclosure mode for a section. The existing
`basic | advanced` mode remains the render source of truth after a user manually toggles a
section, so manual overrides still win.

Tier-to-mode defaults:

| Tier           | Default disclosure mode |
| -------------- | ----------------------- |
| `beginner`     | `basic`                 |
| `intermediate` | `basic`                 |
| `advanced`     | `advanced`              |

Progression behavior:

- Activity counters are deterministic and bounded.
- After the advanced-toggle threshold is reached, the UI can show a non-blocking suggestion to
  move to the next tier.
- Suggestions are dismissible and persisted; they never auto-switch the tier and never use a
  modal.
- Reset sets the section tier back to `beginner` only. It does not delete or change saved
  `basic | advanced` disclosure mode overrides.

Endpoint behavior:

- `GET /api/v1/complexity-tiers?section_key=...`
  - returns the current tier, counters, suggestion metadata, `persisted`, and `updated_at`
  - `strict=false` (default): missing tier returns `beginner`
  - `strict=true`: missing tier returns `404`
- `PATCH /api/v1/complexity-tiers`
  - body: `section_key`, `tier`, optional `expected_updated_at`
  - may include bounded `interaction_delta`, `advanced_toggle_delta`, `last_suggested_tier`,
    and `suggestion_dismissed_at`
  - supports optimistic concurrency via `expected_updated_at`
  - API-key synthetic user id `0` returns default state and does not persist

## Rollout guidance

Current end-user pages using progressive disclosure:

- `/media-management/{databaseId}/media-settings`
  - `media-management:media-settings:naming`
  - `media-management:media-settings:folder-management`
  - `media-management:media-settings:importing`
- `/custom-formats/{databaseId}/{id}/general`
  - `custom-formats:general:conditions`
  - `custom-formats:general:scoring`
  - `custom-formats:general:negation-and-groups`

Current reference progressive-complexity integration:

- `/custom-formats/{databaseId}/{id}/general`
  - selector and suggestion surface for `custom-formats:general:conditions`
  - tier providers for `custom-formats:general:scoring`
  - tier providers for `custom-formats:general:negation-and-groups`

Planned/expandable sections for the quality profile workflow currently follow the same key format:

- `quality-profiles:general:custom-format-scoring`
- `quality-profiles:general:upgrade-settings`
- `quality-profiles:general:advanced-thresholds` (if introduced by your route design)

## Related

- [Endpoint reference: GET/PATCH UI preferences](../api/endpoints.md)
- [Feature guide index](./README.md)
