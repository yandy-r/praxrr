# Progressive Disclosure API Contract

## Scope

Task 1.3 defines the wire contract for disclosure preferences used by progressive disclosure UI sections.

This contract is intentionally limited to:

- Reading a section preference
- Updating (upserting) a section preference

## Canonical Keys

`section_key` must follow:

- Regex: `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$`
- Examples:
  - `media-management:media-settings:naming`
  - `quality-profiles:general:upgrade-settings`
  - `custom-formats:general:scoring`

Unknown keys are invalid.

## Endpoints

### `GET /api/v1/ui-preferences`

Read one disclosure preference.

- Query params:
  - `section_key` (required, string): canonical key
  - `strict` (optional, boolean, default `false`): when true, missing persisted values return `404`
- Success response (`200`): `UiPreferenceRecord`
- Missing key when `strict=true` returns `404`
- Invalid key/format returns `400`

### `PATCH /api/v1/ui-preferences`

Upsert one disclosure preference.

- Body: `UiPreferenceUpsertRequest`
- Success response (`200`): `UiPreferenceRecord`
- Unknown key, bad mode, or bad concurrency token returns `400`
- Concurrency mismatch returns `409`

## Shared Schemas

- `UiSectionKey` (`string`): section key format above
- `UiPreferenceMode` (`enum`): `basic` | `advanced`
- `UiPreferenceRecord` (`object`):
  - `section_key: string`
  - `mode: basic | advanced`
  - `updated_at: string | null` (RFC 3339 datetime)
  - `persisted: boolean`
- `UiPreferenceUpsertRequest` (`object`):
  - `section_key: string` (required)
  - `mode: basic | advanced` (required)
  - `expected_updated_at?: string | null` (optional concurrency token)

## Error Matrix (Authentication Required)

- `401`: missing/unauthenticated session
- `403`: persistence scope denied
- `404`: missing row in strict read mode
- `409`: optimistic concurrency mismatch
- `500`: storage/lookup failure
