# UX Research: Live Job and Sync Progress (SSE)

Linear YAN-593 / GitHub #335. Scope: user-facing behaviour of `/api/v1/events`. Covers toasts, live
status rendering, connection state, reconnect recovery and accessibility. Transport, auth and event
schema belong to the sibling technical, security and practices research.

All file references are relative to `packages/praxrr-app/src/` at worktree base `origin/main` 8417c992.

## Executive Summary

- Today a manual sync gives exactly one piece of feedback: a `success` toast with text such as
  "Delay profiles sync queued" (`routes/arr/[id]/sync/+page.server.ts:794,835,876,922`, rendered by
  `+page.svelte:363` and `components/DelayProfiles.svelte:112`). Users learn nothing more unless
  they reload. The word "success" is misleading here, because the sync has only been queued.
- The alert system is small (`lib/client/alerts/`, 268 lines). It is the right place to show
  completion toasts, but it is missing four things this feature needs:
  1. Toasts are message-only. There is no slot for an action or link, so "View details" cannot be
     rendered.
  2. There is no deduplication or coalescing key, so bursts of events would stack up.
  3. There is no `aria-live` region. Toasts are `role="button"` divs, so screen readers never
     announce them.
  4. Every type uses the same global duration (default 5000 ms, `settings.ts:22`). Failures
     disappear as fast as successes.
- Recommended UX model:
  - **Live state is ambient. Toasts are reserved for outcomes the user cares about.**
  - Table and badge rows update in place on every event.
  - A toast fires only for terminal events (success, partial, failed) of jobs this browser tab
    started manually, plus failures of any job.
  - Scheduled successes stay silent.
  - Bursts are coalesced into one summary toast.
- Connection status: no indicator while the stream is healthy. Show one small, non-blocking
  indicator only when the stream has been down for more than ~10 s, and never a toast or modal for
  it.
- On (re)connect, refetch authoritative state (`invalidate('app:jobs')` and similar). Never replay
  missed events as toasts.

## User Workflows

### W1: Manual sync from an instance page (primary; acceptance criteria 1 and 2)

1. The user is on `/arr/{id}/sync` and clicks Sync for a section: quality profiles, delay
   profiles, media management, or metadata profiles (metadata profiles are Lidarr-only, see
   `+page.svelte:350`).
2. The action enqueues one job per section (`jobType: 'arr.sync.<section>'`, `source: 'manual'`)
   and returns "… sync queued".
3. **New behaviour:**
   - The toast text becomes neutral: `info`, "Quality profiles sync queued for {instance}".
   - The section card shows a `Queued` badge, then `Running` when the dispatcher picks up the job.
   - When the job ends, the section's "Last synced" timestamp updates and a completion toast
     appears.
   - The user can navigate away. The toast still appears on whatever page they are on, because the
     store and toasts live in the root layout (`routes/+layout.svelte:27`).
4. Clicking "View details" opens `/sync-history/{syncHistoryId}`. This requires the terminal event
   to carry `syncHistoryId`. The arrSync handler already computes it (`jobs/handlers/arrSync.ts:61`).
   The job id is **not** a sync-history id, so the client must never build that link from the job
   id.

### W2: Watching background jobs (`/settings/jobs`)

- The page loads with `jobQueueQueries.listScheduled()` and the last 50 runs
  (`routes/settings/jobs/+page.server.ts`) and never refreshes.
- **New behaviour:** status badges change in place (`Queued` → `Running` → back to the
  scheduled/`Queued` row with `Last Run: Success/Failed`). "Last Run" relative times stay correct,
  and new rows are prepended to `JobHistory`. No toasts on this page beyond the global rules (W4).

### W3: Sync history and Canary detail

- **`/sync-history`:** when a sync for any instance finishes, a new row appears at the top, but
  only if it matches the active status/trigger filters (`+page.svelte:49-60`). Never move or reorder
  rows the user is reading. If the user is on page 2 or later, or the list is scrolled away from the
  top, show a "N new syncs — show" pill instead of inserting rows.
- **`/canary/{id}`:** the rollout status badge (`ROLLOUT_STATUS_VARIANT`, `+page.svelte:185`) and
  the per-instance batch results (L259) update live. The `awaiting_confirmation` gate is a decision
  point, so it is the one Canary state that justifies a toast (warning: "Canary {name} is waiting
  for confirmation", with a link). The page already reloads after a stale `stateToken`
  (`+page.svelte:124-142`). Live updates make that path rarer, but it must stay as the safety net.

### W4: Away from the triggering page / unattended

- A user doing PCD editing while a scheduled `arr.sync.*` or `pcd.sync` runs:
  - successful scheduled runs: silent;
  - failed scheduled runs: one error toast per coalescing window, linking to `/settings/jobs` or to
    the sync-history row.
- Drift detection (`driftCheck` handler) changing an instance from in-sync to drifted is a
  **state change**, not a job outcome. It updates drift badges in place. A toast appears only if
  the user is on that instance's sync or drift page, so a global drift toast does not fire every
  check cycle.

### W5: Multiple tabs / multiple users

- Each tab holds its own stream. "Started by me" is decided per tab: the action response returns
  the job id(s) and the tab records them in a short-lived `pendingJobIds` set. Only that tab shows
  the "your sync finished" toast. Other tabs, and other admins, update state silently and show only
  failure toasts.

## UI Patterns

### Toast content

| Event                                     | Type                   | Message                                                       | Action                                                       | Duration               |
| ----------------------------------------- | ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------- |
| Enqueue accepted (existing)               | `info` (was `success`) | "Quality profiles sync queued for Radarr 4K"                  | none                                                         | default                |
| Manual job success                        | `success`              | "Quality profiles synced to Radarr 4K · 12 items"             | View details                                                 | default (5 s)          |
| Partial (`SyncOperationStatus='partial'`) | `warning`              | "Quality profiles partially synced to Radarr 4K · 2 failures" | View details                                                 | sticky until dismissed |
| Failed (any trigger)                      | `error`                | "Delay profiles sync to Sonarr failed: {short reason}"        | View details                                                 | sticky until dismissed |
| Skipped (`skipped`)                       | none (row update only) |                                                               |                                                              |                        |
| Coalesced burst                           | by worst status        | "5 syncs finished · 1 failed"                                 | View history (`/sync-history?status=failed` when any failed) | by worst status        |
| Canary gate                               | `warning`              | "Canary 'X' is waiting for confirmation"                      | Review                                                       | sticky                 |

Rules:

- Name the **instance** and **section** in every message. Users run several Radarr/Sonarr/Lidarr
  instances. Use the Arr-specific section labels already built by `buildJobDisplayName`
  (`lib/server/jobs/display.ts`), and do not invent cross-Arr wording ("profiles" vs "metadata
  profiles" is Lidarr-only).
- Keep the reason short. Truncate the error to one line (about 120 characters) in the toast and
  show the full error on the detail page. Never put stack traces or Arr URLs in a toast.
- Sticky failures: pass `duration: 0`. The store already skips auto-dismiss when the duration is
  not positive (`store.ts:28`). Cap visible sticky toasts at 3. Older ones fold into the burst
  summary.
- Each toast should get an explicit close button. Today clicking the toast body dismisses it, and
  that would collide with the link click.

### Required alert-store extension (minimal, backwards-compatible)

```ts
interface Alert {
 id: string;
 type: AlertType;
 message: string;
 duration?: number;
 action?: { label: string; href: string }; // rendered as <a>, never {@html}
 key?: string; // coalescing key, e.g. `job:${jobId}` or `burst`
}
add(type, message, duration?, options?: { action?; key? }): string
upsert(key, alert): string // replace the existing alert with the same key instead of stacking
```

- Callers that use `add(type, message)` keep working.
- `Alert.svelte` renders `action` as a real `<a href>`. Click it to navigate, then dismiss.
- `MobileNavAlert.svelte` shows only the latest alert, truncated (`navbar.svelte:10`). On mobile,
  the action becomes the tap target: tapping the alert navigates when `action` is set, and dismisses
  otherwise.

### Flood control

Floods come from schedules (one `arr.sync.<section>` job per instance and section,
`jobs/schedule.ts:22-36`), from Canary batches, and from "sync all" style flows.

1. **Ambient by default.** Only job outcomes that pass the filter above raise toasts. All other
   events only update stores.
2. **Coalescing window.** Hold terminal events for ~1.5 s. One event produces a normal toast. Two
   or more produce one `upsert('burst', …)` summary whose counts update in place while the burst
   continues.
3. **Per-job key.** `queued` → `running` → `succeeded` for one job reuses `key: job:{id}`, so the
   user never sees three toasts for one job.
4. **Hard cap.** At most 4 toasts are visible. Overflow is dropped into the summary.
5. **Background tab.** When `document.hidden` is true, buffer toasts. On `visibilitychange`, show
   one summary of what happened while the tab was hidden, with no replay.

### Live status in tables and cards

- Jobs table (`routes/settings/jobs/+page.svelte:101-110`): keep the existing `Badge` variants
  (`accent` = Running, `neutral` = Queued, `danger` = Cancelled). Additions:
  - Running gets a small spinner icon. Respect `prefers-reduced-motion`, which the codebase already
    checks in `CollapsibleCard.svelte:14` and `app.css:374`; with reduced motion, show a static icon.
  - Unknown statuses currently fall through to a raw `{row.status}` badge (L109). Add explicit
    `success`/`failed` cases so terminal states render as words, not raw enum values.
  - Brief highlight on change: a 1 s background fade on the changed row, disabled under reduced
    motion. No reordering while sorted, and the sort applies on the next refetch only.
  - Recompute relative times ("2m ago"): one shared 30 s ticker in the events store, rather than
    adding another per-component `setInterval` (see the existing ones in
    `SyncPreviewPanel.svelte:147`, `RenameSettings.svelte:40`, `CoreSettings.svelte:38`). Those
    tickers are UI clocks, not data polling, so this feature does not need to remove them.
- Sync page section cards: show a status chip next to "Last synced", cycling Queued → Running →
  "Synced just now" or "Failed · View". While queued or running, disable the section's Sync button
  (labelled "Syncing…") to prevent duplicate enqueues. If the stream is unavailable, fall back to
  today's behaviour: re-enable the button once the action returns.
- Sync preview: a successful sync makes the existing preview stale. Mark it stale through the
  existing staleness UI (`SyncPreviewPanel.svelte:156-167`) instead of silently discarding it.

## Accessibility

Findings in the current code:

- **No live region for toasts.** `AlertContainer.svelte` and `Alert.svelte` render plain divs with
  `role="button"`, `tabindex="0"` and click-to-dismiss. Screen readers do not announce toasts.
  Other parts of the app do use live regions (`SyncPreviewTrigger.svelte:211`,
  `SyncPreviewPanel.svelte:732-745`, `impact-simulator/[databaseId]/+page.svelte:438`), so the
  pattern exists in the codebase.
- **The desktop container is `hidden md:block`.** On mobile, `MobileNavAlert` is the only
  rendering. Any live region must therefore exist outside both visual containers, or it will be
  `display:none` on one breakpoint.

Recommendations:

1. **Two persistent visually-hidden regions in the root layout.** Mount them before any message
   arrives, otherwise assistive tech ignores late-inserted regions.
   - `role="status" aria-live="polite" aria-atomic="true"` for success, info and coalesced
     summaries.
   - `role="alert"` (assertive) for failures only.
   - Write each toast's text into the region. Keep the visual toasts `aria-hidden` to avoid double
     announcement.
2. **Do not announce every transition.** Queued/Running row changes are not announced globally.
   The jobs page gets one polite page-scoped region ("Arr sync for Radarr 4K is running"),
   throttled to one announcement per 5 s. Terminal outcomes come from the global region only.
3. **Make toasts real controls.** Use a `<div>` with a separate `<a>` (View details) and a
   `<button aria-label="Dismiss notification">`. Do not use a whole-toast `role="button"`, which is
   ambiguous now that it holds a link.
4. **Meet WCAG 2.2.1 (timing adjustable).** Failures and partials are sticky. The user-adjustable
   duration (`alertSettingsStore.durationMs`) already exists. Pause auto-dismiss while the toast is
   hovered or focused.
5. **Do not rely on colour alone.** Badges already pair colour with a word and icon
   (`CheckCircle`/`XCircle`). Keep that pairing for the new success, failed and partial states and
   for the connection indicator.
6. **Never move focus** on incoming events. Toasts must not steal focus from forms. This matters
   because dirty-tracked editors are common in this app.

## Error States

| Situation                                              | UX                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stream never connects (proxy strips SSE, auth expired) | Pages work exactly as today: SSR load plus manual reload. No toast. After ~10 s the indicator shows "Live updates unavailable".                                                                                                                                                              |
| Stream drops mid-session                               | Silent reconnect with backoff. Indicator appears only if down for more than ~10 s. On reconnect, refetch every live-subscribed load (`invalidate` of the page's dependency keys), then hide the indicator. Do **not** toast "Reconnected".                                                   |
| Events missed during the gap                           | Never replay missed terminal events as toasts; that would flood. Exception: a job this tab started (in `pendingJobIds`) that finished during the gap. After refetch, if the job is terminal, show its normal outcome toast once, which keeps acceptance criterion 2 true across short drops. |
| Session expired (401 on reconnect)                     | Stop reconnecting and set the indicator to "Signed out — live updates paused". The existing auth redirect on the next navigation handles re-login. No retry storm.                                                                                                                           |
| Server restart / redeploy                              | Same as a drop. The dispatcher restarts and jobs are recovered from the DB. Refetch-on-reconnect shows the authoritative state, including jobs that were re-queued.                                                                                                                          |
| Job stuck in Running (no terminal event)               | No client-side timeout toast. The row keeps showing Running with its start time, so the user sees elapsed time. Refetch on reconnect or focus corrects it.                                                                                                                                   |
| Enqueue failure                                        | Unchanged: the existing error toast from the action (`+page.svelte:366-370`).                                                                                                                                                                                                                |
| Unknown or new event type                              | Ignore silently on the client (forward compatibility). Log only in dev.                                                                                                                                                                                                                      |

The connection indicator itself:

- Placement: a small dot plus label next to the version in `pageNav` (`version.svelte`) on desktop,
  and on the jobs page header. Not in the mobile navbar, whose centre slot is used for alerts.
- States: hidden (healthy or connecting under 10 s), amber "Reconnecting…", neutral "Live updates
  paused" (auth or permanent failure).
- Clicking it can trigger an immediate reconnect and refetch.

## Competitive Analysis

**Sonarr / Radarr / Lidarr (SignalR `/signalr/messages`).** Closest analogue, and familiar to this
app's users.

- Commands (RefreshSeries, RssSync, Backup) appear in System → Tasks → Queue with live status. A
  small spinner in the sidebar footer (lower-left) shows the currently running command name.
- Toasts appear mainly for manually triggered commands and errors. Scheduled RSS syncs are silent.
- On reconnect the UI does a full resync, and shows a "Reconnecting" or "Connection lost" message
  after repeated failures. Copy the silent-on-schedule, toast-on-manual rule and the
  refetch-on-reconnect behaviour.
- Their connection-lost modal is the heavier choice. Praxrr is admin tooling where reload is cheap,
  so a subtle indicator fits better.

**GitHub Actions (live logs, check runs).**

- Status icons transition in place (queued → in-progress spinner → check or cross) inside lists
  without reordering.
- Notifications are opt-in and outcome-only, with no per-step toasts. Copy in-place badge
  transitions and the "outcome-only notification" principle.

**Portainer / Home Assistant (WebSocket UIs).**

- Home Assistant shows a persistent "Connection lost. Reconnecting…" banner only while
  disconnected and refreshes state on reconnect. This supports the delayed, subtle indicator.

**Vercel / Netlify deploy dashboards.**

- A deploy row shows live status, and a completion toast with a "Visit" or "View deployment" link
  appears for the deploy you triggered. Copy the "View details" action targeting the persisted
  result record (sync-history id), not the transient job.

## Performance UX

- **Loading:** pages keep their SSR `load()` data, so first paint is unchanged. Live events trigger
  a debounced (about 250 ms) `invalidate()`, with no skeletons or spinners on refresh.
- **Feedback:** row badges change in place. Terminal outcomes toast by policy. The connection
  indicator appears only after the stream has been down for more than 10 s.
- **Optimistic updates:** none. Events are hints, and the DB stays authoritative.

## Recommendations

1. **Toast policy:**
   - Terminal outcomes only.
   - Manual jobs started by this tab: success, warning (partial) or error.
   - Scheduled or system jobs: failures only.
   - Skipped: never.
   - Coalesce within ~1.5 s using a `burst` key and a per-job `job:{id}` key.
   - Cap 4 visible.
2. **Change the enqueue toast from `success` to `info`.** "Queued" is not success.
3. **Extend `alertStore`:**
   - additively: `action {label, href}`, `key`, `upsert`;
   - make failures sticky (`duration: 0`);
   - pause dismiss on hover or focus;
   - add an explicit dismiss button.
4. **Add persistent `status` and `alert` live regions** in `routes/+layout.svelte`, independent of
   breakpoint-hidden containers.
5. **Terminal event payloads must carry what the UX needs** (coordinate with the tech design):
   `jobId`, `jobType`, `source` (manual/schedule/system), `instanceId` + `arrType`, a
   `displayName` (server-built via `buildJobDisplayName`), terminal `status`, and `syncHistoryId`
   when one exists, plus an error summary. The client must not build display text from raw enums.
6. **Make in-place updates the primary channel:**
   - jobs table badges and timestamps;
   - sync page per-section chip and button disable;
   - sync-history "N new" pill when scrolled or paged, otherwise prepend;
   - Canary status and batch results.
   - Pages declare dependency keys (`depends('app:jobs')`, `'app:sync-history'`,
     `'app:canary:{id}'`) so the store can `invalidate()` precisely instead of `invalidateAll()`.
7. **Connection indicator:** hidden when healthy, shown after more than ~10 s down, placed by
   `pageNav` version and the jobs header, never a toast or modal.
8. **On reconnect:** invalidate the subscribed keys once, toast only this tab's pending jobs that
   finished, and never replay.
9. **Motion and timing:** one shared ticker for relative times, spinner and row-flash honour
   `prefers-reduced-motion`.

## Open Questions

1. **Toasts for scheduled successes?** Should there be a user setting ("Notify on scheduled job
   success"), stored next to the alert position and duration in `alertSettingsStore`? Default: off.
2. **What does "View details" link to for non-sync jobs?** Examples are `pcd.sync`, backups and
   rename/upgrade jobs, which have no sync-history row. Proposed: `/settings/jobs` with the run
   expanded, or the job-specific page. This needs a mapping per job type.
3. **Who counts as the triggering user?** Should failure toasts for manual jobs started by
   _another_ admin be visible to everyone? This depends on whether events are user-scoped. Ask the
   security research about multi-user and API-token visibility.
4. **Drift toasts:** should transitioning to `drifted` ever toast globally, or only update badges?
   Proposed: badges only, plus a toast scoped to the instance page.
5. **Canary gate across tabs:** should the `awaiting_confirmation` toast be sticky on every open
   tab, or only on the tab that started the rollout?
6. **Running progress granularity:** should Running show per-section progress such as "3/4
   sections" or an item count, or stay binary? This depends on whether the dispatcher can emit
   intermediate progress cheaply. Proposed: binary for v1 of this issue, with the payload shape
   leaving room for later.
7. **Indicator placement on mobile:** BottomNav or nothing? Proposed: nothing on mobile beyond the
   jobs page header.
