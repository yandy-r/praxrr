# UX Research: Plugin Management UI (#266)

## Executive Summary

The plugin page should behave like an operator console, not a marketplace. Its
primary job is to make five independent facts understandable without requiring
knowledge of the plugin internals:

1. whether plugin management is globally enabled;
2. whether a plugin is present in the latest discovery scan;
3. whether the operator has saved an enablement preference;
4. what lifecycle state Praxrr last recorded; and
5. whether there is authoritative execution telemetry.

Those facts must not be compressed into one green/red “status.” In particular,
`enabled` is saved operator intent, not “running”; a declared extension point is
not necessarily wired; and `lastError` is a lifecycle error, not a run error.
The present API has no runtime-availability or recent-run fields, so the current
UI can truthfully say “Run telemetry unavailable,” but cannot show “last run
succeeded,” “runtime unavailable,” or “healthy” without a contract-first backend
addition.

Use a dedicated `/settings/plugins` route, consistent with the existing Settings
information architecture. On wide screens, a compact table should support
scanning identity, discovery, enablement intent, lifecycle, and actions. At
narrow widths and high zoom, the same records should become cards rather than
forcing a page-level horizontal scroll. Put complete capability and
extension-point explanations on an inspect route or explicit disclosure, not in
a modal or tooltip.

Mutations should be authoritative rather than optimistic: keep the old switch
value while a request is pending, replace the row with the successful API
response, and announce the result both visibly and programmatically. Reload
should retain the current list while refreshing, report its aggregate counts,
then refetch the whole list.

## User Workflows

### Primary flow: understand the subsystem at a glance

1. The authenticated operator opens **Settings → Plugins**.
2. The page immediately exposes a stable heading, short scope statement, and
   loading status.
3. The list response selects one of three normal page states:
   - **Feature off:** explain that `PLUGINS_ENABLED` is controlled by deployment
     configuration and that the page cannot enable it. This is not an error.
   - **Feature on, no records:** explain where the deployment operator installs
     local plugins and offer **Reload plugins**.
   - **Feature on, records present:** render the management list, separating
     currently discovered plugins from retained/missing records.
4. Each summary presents, in this order:
   - authored name, version, optional author, exact id, and API version;
   - **Discovery:** “Present” or “Missing from latest scan”;
   - **Enablement preference:** “Enabled for future dispatch” or “Disabled”;
   - **Lifecycle state:** the exact recorded state with a human label;
   - **Execution:** actual last-run evidence if a future API supplies it,
     otherwise “Run telemetry unavailable.”
5. The operator chooses **Inspect** to understand declarations and grants
   without cluttering every summary row.

The list should default to discovered records first, then retained/missing
records, with stable secondary ordering by authored name and composite identity.
Do not hide missing records by default: their retained enablement preference is
operationally meaningful.

### Inspect a plugin

Prefer a detail route such as `/settings/plugins/{apiVersion}/{id}` because
Praxrr favors routes over modals and plugin details are linkable, reviewable
content. A well-implemented explicit disclosure within the list is also
acceptable for a bounded first version, but the disclosure control must be
separate from row mutation controls.

The detail surface should contain:

- **Identity:** name, version, author if present, description if present, exact
  id, API version, runtime format, and advisory engine constraint. Missing
  optional metadata should show “Not provided,” not an error.
- **Availability and intent:** separate discovery and enablement fields. For a
  retained missing plugin, explain that the saved preference will apply if the
  same `(apiVersion, id)` reappears.
- **Lifecycle:** exact lifecycle label, registration/update times, and **Last
  lifecycle error**. A null error is “No lifecycle error recorded,” never
  “Healthy.”
- **Declared extension points:** one item per declared id with a text label for
  point kind and host wiring. Currently wired observe points should say **Wired
  observe point**. Every other point should say **Declared, not wired**. A
  transform/provider declaration must not look active.
- **Granted capabilities:** use the shared capability catalog's human label and
  description, retain the exact capability id as supporting technical text, and
  state once that the current grant model includes no credentials, secrets,
  network, filesystem, environment, database, or write access.
- **Execution:** a distinct panel for last-run evidence. Until the API supplies
  such evidence, render a neutral “Run telemetry unavailable” explanation rather
  than repurposing lifecycle data.

Tooltips may supplement unfamiliar terms, but must not be the sole location for
capability, wiring, safety, error, or state information. This follows WCAG
guidance that hover/focus content must be dismissible, hoverable, and
persistent, and it avoids hiding essential operator evidence.

### Enable or disable

1. The control's stable accessible name is **Plugin enabled** plus the plugin
   identity. The visible state should also include “Enabled” or “Disabled” text
   so color and switch position are not the only cues.
2. After activation, leave the displayed value at the last confirmed server
   value, disable that plugin's switch/actions, and show “Saving enablement
   preference…” in a nearby status region.
3. On success, replace the complete row with the returned record and show an
   alert such as “Enabled Acme Reporter for future plugin dispatch.” Avoid
   “started,” “activated,” or “running.”
4. On failure, preserve the old value, return focus to the same control
   naturally, show a persistent inline row error with **Retry**, and also use
   Praxrr's alert store for global feedback.
5. If the server returns `plugins_disabled`, transition the whole page to the
   feature-off state. If it returns `plugin_not_found`, refetch because the
   record set changed concurrently.

For a missing record, use the explicit action/state language **Enable when
rediscovered** or **Enabled when rediscovered**. If implementation constraints
require the normal switch label, add adjacent persistent text explaining that
the action only saves future intent.

Immediate mutation means there is no unsaved form state, so the dirty-navigation
store should not be used. The in-flight request state is not “dirty.”

### Reload plugins

1. **Reload plugins** is a page-level button with stable text; a spinner may
   accompany it but must not replace the text.
2. While reload is pending, retain the list to avoid a blank-page flash, mark
   the page/list busy, change supporting status to “Scanning and reconciling
   plugins…,” and disable reload plus row mutations that would compete with the
   serialized reconciliation.
3. On `reloaded: true`, announce a complete result, for example: “Reload
   complete: 4 discovered, 3 registered, 1 rejected, 1 missing.” Then refetch
   the entire list. The counts need text labels; icons or color alone are
   insufficient.
4. A nonzero rejected count deserves a warning alert and a link/pointer to logs,
   if an existing safe logs route can support that workflow. Do not invent
   rejected plugin names or reasons that the API does not return.
5. On `reloaded: false`, show the feature-off page rather than “Nothing
   changed.”
6. If reconciliation succeeded but the follow-up list fetch failed, retain and
   visibly label the old list **May be out of date**, report that reload
   completed but refresh failed, and offer **Retry list refresh**. Do not
   incorrectly report that reload itself failed.

### Alternative and recovery flows

#### Feature off

Use a neutral informational panel, not a red error banner:

- Heading: **Plugins are disabled**
- Body: “This deployment has `PLUGINS_ENABLED` turned off. Set it in the server
  environment and restart Praxrr to make plugin discovery and management
  available.”
- Supporting text: “This page cannot change deployment environment settings.”

Do not show an enabled-but-empty list, a retry loop, or active mutation
controls. A documentation link is useful if a stable operator document exists;
do not provide a fake button that appears to toggle the server flag.

#### Runtime unavailable versus telemetry unavailable

These are different claims:

- **Runtime unavailable** is a dynamic execution fact and requires an
  authoritative API field.
- **Run telemetry unavailable** means the management API does not expose recent
  execution evidence.

The current API proves only the second statement. Although the repository
currently ships an unavailable default executor, hard-coding that implementation
detail into the browser will become stale when a runtime is added. To satisfy
issue #266 fully, add an API status such as

`runtimeAvailability: 'available' | 'unavailable' | 'unknown'` and structured
recent-run evidence. Until then, show a page-level neutral limitation notice and
never infer runtime availability from `enabled`, `discovered`, `registered`,
`updatedAt`, a wired declaration, or `lastError`.

If a future response explicitly says the runtime is unavailable, keep discovery
and preference management usable, show a warning-level panel (“Plugin execution
is unavailable; saved enablement preferences and reload still work”), and
disable only actions that actually require execution.

#### Management API or network failure

Show a persistent inline error panel with a plain-language failure and
**Retry**. Avoid calling a generic fetch failure “offline” unless connectivity
is actually known. If data was already loaded, retain it, mark it **May be out
of date**, and leave safe inspection available while disabling mutations whose
outcome cannot be confirmed.

#### Empty registry

This is distinct from feature off and failure:

- Heading: **No plugins discovered**
- Explain that the feature is enabled but no registered or retained plugins are
  available.
- Offer **Reload plugins** after files have been placed in the configured plugin
  directory.
- Do not suggest a marketplace, remote install, upload, or one-click install;
  all are out of scope.

## UI/UX Best Practices

### Information architecture and layout

Add **Plugins** to both the Settings landing list and the shared navigation
registry. Use the same page heading and spacing rhythm as existing
Settings/operational pages. “Plugins” is preferable to “Extensions” because it
matches the API, manifest, issue, and operator documentation vocabulary.

Recommended wide-screen columns:

| Column       | Content                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| Plugin       | Name + version; id/API version below; author only when present                  |
| Availability | “Present” or “Missing from latest scan”                                         |
| Enablement   | Saved intent switch plus visible state text                                     |
| Lifecycle    | Exact state label; lifecycle error marker when present                          |
| Execution    | Last-run result/time only when authoritative; otherwise “Telemetry unavailable” |
| Actions      | Explicit **Inspect** action; do not make mutation controls depend on row click  |

The table is for comparison; capabilities and extension declarations are detail
content. At mobile widths or 400% zoom, switch to vertically stacked cards with
the same label/value pairs. WCAG 2.2 Reflow expects content to remain usable at
an equivalent 320 CSS-pixel viewport; a contained two-dimensional table may
scroll, but ordinary page content should reflow. Praxrr's existing
`Table.svelte` already has a responsive card mode and is a useful pattern, but
this page should avoid its full-row overlay link when row-level buttons/switches
are present. Use a distinct Inspect target.

The existing `ExpandableTable.svelte` makes the whole mobile header a
`role="button"`. Do not place a switch or other actionable descendant inside
that disclosure target. If an expandable design is chosen, expose a separate
native disclosure button with `aria-expanded`/`aria-controls`, then keep
enable/reload controls outside it. Otherwise prefer the detail route.

The existing `EmptyState.svelte` assumes an anchor CTA and consumes viewport
height. It fits some zero-data pages, but plugin feature-off and fetch-error
states need callback-free information or a Retry button. Reuse its visual
language, or generalize it deliberately; do not coerce an error retry or
environment setting into a link-shaped action.

### Status taxonomy and truthful labels

Use separate headings and badges. Suggested vocabulary:

| Dimension        | Recommended labels                                                        | Avoid                                          |
| ---------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| Global feature   | Plugins enabled; Plugins disabled                                         | Service down (when feature is off)             |
| Discovery        | Present; Missing from latest scan                                         | Installed (for retained missing records)       |
| Saved preference | Enabled for dispatch; Disabled; Enabled when rediscovered                 | Active; Running; Loaded                        |
| Lifecycle        | Discovered; Validated; Registered; Rejected; Activated; Failed; Unloaded  | Healthy; Working                               |
| Extension point  | Wired observe point; Declared, not wired                                  | Supported; Active extension                    |
| Capability       | Granted read capability; No mutating/secret access                        | Full access; Sandboxed (without qualification) |
| Lifecycle error  | Last lifecycle error; No lifecycle error recorded                         | Last run error; Healthy                        |
| Execution        | Last run succeeded/failed (only with evidence); Run telemetry unavailable | Never failed; Runtime available (inferred)     |

Lifecycle badge colors may aid scanning, but every badge needs text. Treat
`registered` as neutral or informational rather than green success. Treat
retained `unloaded` as neutral. Reserve success green for an evidenced
successful action/run, warning amber for declared-but-unwired/missing/runtime
unavailable, and red for an actual current failure or lifecycle error.

Extension points should be grouped by **Wired observe points** and **Declared,
not wired** rather than rendered as an undifferentiated chip cloud. Include the
kind in text. Capability descriptions should come from the shared catalog, not
be reauthored in the component. Place the deny-by- construction statement beside
the capability section so operators do not mistake an empty grant list for a
loading bug.

### Accessibility

- Prefer native `<button>` and `<input type="checkbox" role="switch">` where
  feasible. WAI's APG notes that a native checkbox with `role="switch"` and an
  HTML label is more robust than a generic element. If Praxrr's existing
  `Toggle.svelte` is reused, retain its keyboard support and `aria-checked`,
  provide a plugin-specific accessible name, and test it on mobile and with
  screen readers.
- Keep a switch's accessible name stable as its state changes; state belongs in
  `aria-checked`, not in a changing name. WAI's switch/button patterns
  explicitly distinguish stable label from state.
- Do not let `Toggle.svelte`'s internal immediate flip become the source of
  truth for an API-backed preference. The control needs a controlled/pending
  wrapper or adjustment so a failed mutation does not momentarily assert an
  unconfirmed state.
- Provide visible keyboard focus. Ensure every action target is at least 24 by
  24 CSS pixels or has the WCAG 2.2 spacing exception; 44 by 44 is a useful
  touch target goal for the mobile switch, Reload, Retry, and Inspect controls.
- Mark the relevant region `aria-busy="true"` while loading. Use a persistent
  `role="status"` or `aria-live="polite"` + `aria-atomic="true"` message for
  load, reload, and saved-preference results. WCAG 4.1.3 requires status
  messages to be programmatically determinable without moving focus.
- Use `role="alert"` sparingly for newly appearing errors that need immediate
  attention. Keep the visible inline error after the transient global alert so
  users can reread and recover. WAI warns against making routine updates
  assertive/chatty.
- Loading spinners and status icons are decorative when adjacent text already
  names the state; mark them `aria-hidden="true"`.
- Error text must identify the affected plugin/action and suggest recovery.
  “Request failed” alone is not sufficient. WCAG error-identification guidance
  requires errors to be described in text.
- Preserve focus on the initiating control after mutation/reload. Do not move
  focus to a success alert. If refetch removes the focused plugin, move focus to
  the page/list status and announce that the record is no longer available.
- Do not use title/tooltip-only labels for icon actions. Provide accessible
  names such as “Inspect Acme Reporter” and “Retry enabling Acme Reporter.”

Official accessibility references:

- [WAI switch example and keyboard/state requirements](https://www.w3.org/WAI/ARIA/apg/patterns/switch/examples/switch/)
- [WAI accessible names and native switch guidance](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/)
- [WCAG 2.2 status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages)
- [WCAG 2.2 error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification)
- [WCAG reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow)
- [WCAG 2.2 minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- [WCAG hover/focus content](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)

### Confirmation tradeoffs

Do **not** add a confirmation modal for ordinary enable, disable, or reload in
the present contract:

- enable/disable is a reversible saved preference;
- it does not prove or trigger activation in the current phase;
- reload is a bounded reconciliation action and does not delete plugin files;
  and
- repeated confirmations create habituation and slow a common operator workflow.

Use clear action labels, pending state, and post-action confirmation instead.
GOV.UK's confirmation guidance emphasizes reassuring users that a transaction
completed and explaining what happens next; for these small inline operations,
Praxrr's persistent status plus alert feedback provides that confirmation
without navigating away.

Confirmation becomes appropriate only if a later authoritative API says
disabling will interrupt a currently running invocation, discard work, cascade
to dependants, or otherwise create a material hard-to-reverse effect. In that
future case, the dialog must state the concrete impact and identify the plugin;
do not add a generic “Are you sure?” preemptively. If business stakeholders
still want friction for missing plugins, prefer the truthful label **Enable when
rediscovered** over a modal.

## Error Handling

### State and recovery table

| State or response                           | Page/row treatment                                                                        | Operator recovery                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Initial load                                | Stable heading plus skeleton/dashed loading panel; `aria-busy`; “Loading plugins…” status | None; avoid flashing empty state                      |
| `pluginsEnabled: false`                     | Neutral feature-off panel; no list/mutations                                              | Change deployment env and restart; optional docs link |
| Enabled + empty items                       | “No plugins discovered”; Reload available                                                 | Install locally, then Reload                          |
| Runtime explicitly unavailable (future API) | Warning notice; retain discovery and preference tools                                     | Resolve runtime deployment; management stays usable   |
| Runtime unknown/current contract            | Neutral “Run telemetry unavailable”                                                       | No fake retry; link to limitation/docs if available   |
| List HTTP/network failure                   | Persistent error panel; retain stale list if one exists                                   | Retry list load                                       |
| `invalid_identity`                          | Row/action error; indicates stale or malformed composite link                             | Refetch; report if persistent                         |
| `plugins_disabled` during mutation          | Transition to feature-off page                                                            | Deployment change required                            |
| `plugin_not_found`                          | Explain record changed, then refetch                                                      | Inspect refreshed list/reload                         |
| `internal_error`                            | Safe generic action-specific error; do not expose raw diagnostics                         | Retry; inspect safe logs                              |
| Enable/disable transport failure            | Keep confirmed switch state; inline row error                                             | Retry same action                                     |
| Reload rejected count > 0                   | Warning with exact aggregate counts                                                       | Inspect logs; correct local manifests; reload         |
| Reload succeeds, refetch fails              | Retain old list marked stale; say reload succeeded                                        | Retry list refresh, not reload                        |
| Last lifecycle error present                | Persistent error text in lifecycle detail                                                 | Correct plugin files/config, then reload              |

API errors should be mapped by stable `code`, with the server's safe message as
supporting text when appropriate. Do not expose stack traces, local paths, raw
manifests, or credentials. Row errors need plugin identity because global alerts
alone become ambiguous when multiple plugins are visible. Render every authored
manifest string and `lastError` through normal escaped Svelte text
interpolation; never pass them to `{@html}`. Treat even server-returned safe
error copy as text, not markup.

## Performance UX

### Loading and concurrency

- Show the page shell immediately. For initial load, use a short set of skeleton
  rows/cards or the repository's dashed loading-panel pattern; do not show the
  empty state until a successful enabled response returns an empty list.
- Do not delay a spinner artificially. If the request completes quickly, move
  directly to content; if it takes longer, the stable loading text still
  explains the wait.
- Disable only the affected row during enable/disable. Disable page mutations
  during reload because reload reconciles the full registry and the backend
  serializes it with preference changes.
- Deduplicate repeated clicks in the UI. Reload already shares an in-flight
  backend operation, but repeated browser requests add no operator value.
- Track a monotonically increasing request id (or use `AbortController`) for
  list/reload sequences so a slower, older response cannot overwrite a newer
  authoritative state. Row mutations should be keyed by composite identity and
  reject overlapping actions for that identity.
- Use keyed rows based on the full composite identity, for example
  `${apiVersion}\u0000${id.toLowerCase()}`, while displaying the authored id
  unchanged.

### Authoritative updates instead of optimistic updates

Do not optimistically flip enablement. The API returns the authoritative updated
record and the operation is small enough that optimism offers little benefit
while creating rollback and screen- reader confusion. Show a pending label, then
replace the row on success.

Reload is a two-stage action: reconcile, then refetch. Keep current records
visible throughout. Only replace the entire list after the fresh list response
succeeds. This preserves context and makes the rare partial-success case
understandable.

### Offline and stale behavior

No service worker or offline mutation queue is justified. Enablement and reload
require server authority and should fail closed when unreachable. If
already-loaded data remains on screen, label it **May be out of date** and
prevent new mutations until connectivity/authority is restored. Never queue a
switch change for later because the plugin may disappear or the global feature
may change in the meantime.

### Scale

The backend bounds discovery and retained records, so client-side pagination and
virtualization are not required for the first version. A search/filter can be a
later enhancement if real operator testing shows scanability problems. Avoid
progressive rendering that would make “missing” retained records appear late
without explaining the ordering.

## Competitive Analysis

### Grafana: dedicated administration catalog and explicit completion feedback

Grafana places plugins under **Administration → Plugins and data → Plugins**,
separates installed and available catalog concepts, and reports a confirmation
when installation completes. Its official documentation also notes that some
administratively preinstalled plugins cannot be uninstalled in the UI and that
asynchronous installs may not be available immediately.

Adopt the useful principles: a dedicated admin location, identity/version
visibility, configuration constraints stated near the action, and explicit
asynchronous completion feedback. Do not copy its marketplace/install/update
model because #266 is local discovery and management only.

Source:
[Grafana plugin management](https://grafana.com/docs/grafana/latest/administration/plugin-management/)
and
[Grafana plugin configuration](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/).

### Jenkins: installed list, soft disable, and delayed-effect clarity

Jenkins' Plugin Manager has a dedicated Installed view and describes disabling
as a softer, reversible alternative to uninstalling. Its documentation
explicitly warns when a restart is needed for a change to take effect and
distinguishes disable from removal/configuration cleanup.

Adopt the separation between present plugin, disable preference, and actual
effect. Praxrr must go further by labeling saved intent separately from
lifecycle/execution because the current API does not prove activation. Do not
copy Jenkins' dependency/restart confirmations unless Praxrr gains those
concrete semantics.

Source:
[Jenkins Managing Plugins](https://www.jenkins.io/doc/book/managing/plugins/).

### Backstage: discovery is configuration, not proof of active behavior

Backstage documents automatic feature discovery separately from manual
installation and extension configuration. Include/exclude configuration controls
what is discovered, while extension wiring is a separate step.

Adopt the conceptual separation between discovery, installation/registration,
and configured extension behavior. For Praxrr, this maps directly to
**Present**, saved enablement intent, and **Wired observe point** versus
**Declared, not wired**.

Source:
[Backstage Installing Plugins](https://backstage.io/docs/frontend-system/building-apps/installing-plugins/).

### Home Assistant: reload as an explicit operational recovery

Home Assistant exposes reload for supported configuration/integration surfaces
and documents that some items still require restart when reload is not
supported. The useful lesson is to say what a reload can and cannot accomplish,
rather than presenting it as a generic refresh icon.

For Praxrr, label the action **Reload plugins**, explain that it
rescans/reconciles local manifests, and report the result counts. Do not imply
that reload installs remote software or proves execution.

Source:
[Home Assistant Developer tools](https://www.home-assistant.io/docs/tools/dev-tools).

## Recommendations

### Must have

1. Model feature-off, enabled-empty, initial-loading, API-error, and populated
   states separately.
2. Use distinct fields/badges for discovery, enablement intent, lifecycle, and
   execution evidence.
3. Label each declared extension point from the shared catalog as **Wired
   observe point** or **Declared, not wired**; do not infer status from the id
   suffix.
4. Render capabilities from the shared catalog in plain language and state the
   deny-by-construction limits persistently.
5. Use a pessimistic/authoritative enable switch with pending state,
   returned-row replacement, inline recovery, alert feedback, and an accessible
   status announcement.
6. Keep the current list visible during reload, announce aggregate counts, then
   refetch the whole list; preserve and mark stale data if that refetch fails.
7. Provide a responsive desktop table/mobile card presentation with explicit
   Inspect and mutation targets. Avoid nested interactive controls or a row-wide
   link overlay over actions.
8. Name lifecycle and run telemetry separately: **Last lifecycle error** is
   never **Last run error**.
9. Add a contract-first backend field for runtime availability and recent
   structured run telemetry if the acceptance criterion is to show these as
   facts. Until then render **Run telemetry unavailable** rather than an
   inferred status.
10. Test keyboard operation, focus visibility, 320 CSS-pixel reflow, 200%/400%
    zoom, dark mode, switch announcement, live-status announcement, and failure
    recovery.

### Should have

1. Use a linkable inspect route under Settings rather than a modal.
2. Group discovered and retained/missing records and explain why missing records
   remain visible.
3. Show Reload result counts in both the alert and persistent page status; warn
   when rejected > 0.
4. Use **Enable when rediscovered** language for missing records.
5. Retain stale data on refresh failures and distinguish “reload failed” from
   “reload succeeded, list refresh failed.”
6. Add focused component/route tests for every state and accessible label,
   including the two nav snapshots explicitly called out by the issue.

### Nice to have

1. Client-side search/filter once operator testing demonstrates need at
   realistic registry sizes.
2. A safe deep link from rejected/lifecycle error messaging to filtered
   application logs.
3. Copy buttons for exact plugin id and API version on the detail page.
4. Relative time plus exact timestamp disclosure for lifecycle and future run
   timestamps.

## Open Questions

1. Will #266 add runtime availability and recent-run telemetry to the management
   API, or will those acceptance criteria be split into a backend child issue?
   What are the authoritative fields for last run time, extension point,
   outcome, duration, and safe run error?
2. Should enablement remain mutable for retained/missing records? The API
   permits it; the UI must either expose it as future intent or deliberately
   disable it with an explanation.
3. Does changing `PLUGINS_ENABLED` definitively require a process restart in
   every supported deployment? The feature-off instructions must match actual
   config loading semantics.
4. Is there a safe, stable filtered logs URL for rejected-manifest and
   lifecycle-error recovery, or should the first version only instruct operators
   to inspect logs?
5. Does the project want a detail route immediately, or an accessible explicit
   disclosure for the first bounded version? A modal should not be used for this
   review content.
6. When run telemetry exists, is it one latest result per plugin or per
   extension point? A single plugin-level “last run” can conceal one failing
   point behind another successful invocation.
7. Should management mutations require a future administrator role beyond the
   current authenticated boundary? If so, read-only and mutable states need
   distinct permission UX.
