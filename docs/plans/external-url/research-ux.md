# UX Research: external-url

## Executive Summary

The feature should make browser navigation reliable in split-network setups without changing existing server connectivity behavior. Users need a clear mental model: `URL` is for Praxrr-to-Arr API communication, while optional `External URL` is for all user-facing "Open in" links. The fallback rule must be simple and visible: use `External URL` when present, otherwise use `URL`. Existing instances should adopt this behavior automatically after save, with no extra migration steps in the UI.

### Core User Workflows

1. Configure a new instance with internal connectivity and optional external browsing.

- User enters required `URL` and `API Key` for connectivity.
- User optionally enters `External URL` for browser-open actions.
- On save, all library "Open in" actions resolve to `External URL` if set.

2. Update an already-configured instance to add `External URL` later.

- User opens `/arr/{id}/settings`, adds `External URL`, saves.
- Returning to `/arr/{id}/library`, existing "Open in" links now resolve via `External URL` automatically.
- No additional toggle or per-view setting is needed.

3. Remove or clear `External URL`.

- User clears field and saves.
- "Open in" links immediately fall back to the existing `URL` value.

4. Recover from bad configuration.

- If `External URL` is malformed, save should fail inline with a targeted validation message.
- If `External URL` is syntactically valid but unreachable from the user browser, links may fail at click time; copy should clarify this field is not connectivity-tested by the server.

## UI and Interaction Patterns

- Add an optional `External URL` field directly below `URL` in instance settings.
- Field label: `External URL (optional)`.
- Help text: `Used for Open in links. API calls still use URL.`
- Keep `URL` as required and primary; `External URL` should never be required.
- Keep interaction model deterministic with one resolution rule:
- `effectiveOpenUrl = external_url if non-empty else url`.
- Show lightweight preview text under the field after input:
- `Open in links will use: <resolved host>`.
- Do not add a second test-connection path for `External URL`; current connection testing remains tied to `URL` + `API Key`.
- Ensure all library "Open in" affordances use the same resolver:
- Action bar "Open in [App]" button.
- Row-level external-link icons.

## Accessibility Considerations

- Keep explicit label text (not placeholder-only) for `External URL`.
- Associate helper copy and validation errors to the input via `aria-describedby`.
- Surface validation errors in text, not color alone.
- Keep icon-only "Open in" controls with descriptive accessible names (for example `Open in Radarr`).
- Preserve keyboard path: tab to "Open in" controls and activate with Enter/Space.
- Announce save result and validation failures via existing alert/live-region behavior.

### Feedback and State Design

- Save success: existing success toast is sufficient, but include field-specific context when changed:
- `Settings saved. Open in links now use External URL.`
- Validation failure:
- Invalid format: `External URL must be a valid http(s) URL.`
- Prevent silent trimming/normalization surprises in UI; display what is saved.
- Runtime open behavior:
- Always open in a new tab/window with `noopener,noreferrer`.
- If pop-up is blocked, rely on browser-native handling; no custom modal needed in v1.
- Empty state and unaffected paths:
- If `External URL` is unset, behavior remains exactly current fallback-to-`URL` behavior.
- No additional badges/chips are required in library tables for v1.

## UX Risks

- Mental-model confusion between connection URL and browse URL.
- Mitigation: short helper copy directly under both URL fields and deterministic fallback wording.

- False expectation that `External URL` is server-tested.
- Mitigation: explicit note that connection tests validate only `URL` + `API Key`.

- Inconsistent adoption across "Open in" entry points.
- Mitigation: centralize one link resolver and apply it to action bar + row actions.

- Broken deep links due to app-specific path shaping (slug/id differences).
- Mitigation: keep existing app-specific path builders and swap only base origin from the resolved effective URL.

- Existing users may not discover the new capability.
- Mitigation: add concise release note/changelog entry and optional one-time tooltip on settings page.
