# External URL (Dual Browser Link Base)

## Summary

Arr instances now support an optional `external_url` field for user-facing navigation.
`url` remains the canonical backend endpoint for all Arr API operations (sync jobs,
connection tests, and internal service calls).

## Behavior

- `Open in` actions (library rows + list/table actions) resolve to `external_url`
  when set.
- If `external_url` is unset, empty, or whitespace-only, links fall back to
  canonical `url`.
- This is immediate after save/reload (no migration pass required).

## Docker / Reverse-Proxy Guidance

When Profilarr runs inside Docker and Arr is accessed externally via a different
hostname or scheme, set `External URL` on each Arr instance to the browser-reachable
address (for example `https://arr.example.com` or a reverse-proxy path).
Keep `url` on the internal Docker name if that is what Profilarr uses for API access.

## Operations

- To update fallback behavior, edit an instance and set `External URL` to a new
  value, then save.
- To revert to legacy behavior, clear `External URL` and save.
