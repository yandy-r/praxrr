# Implementation Report: Live job and sync events via SSE (YAN-593)

- **Plan**: `docs/prps/plans/completed/live-events-sse.plan.md`
- **Research/spec**: `docs/plans/live-events-sse/` (`feature-spec.md`, `decisions.md`, seven `research-*.md`)
- **Mode**: parallel (5 batches, 24 tasks) and a review-fix pass

## Delivered

- `GET`/`HEAD /api/v1/events`: an auth-gated SSE stream using the existing `authHandle` and the `read` token scope.
  - **Stream**: a 20 s heartbeat that re-checks the session or token, a 60 min lifetime, and caps of 8 streams per principal and 100 globally (429/503 with `Retry-After`).
  - **Replay**: from a 256-event ring via `Last-Event-ID`; the server sends `resync` on a gap or a new boot.
  - **Payloads**: allow-list fields only; never raw error text or tokens.
- **Publishers**:
  - Job lifecycle: `job.queued`, `job.running`, `job.finished`.
  - Domain events: `sync.recorded`, `canary.updated`, `drift.updated`.
- **Client**:
  - **`eventsStore`**: one `EventSource` per tab, HEAD-probe backoff, visibility reconnect, and stop on 401/403/`session.expired`.
  - **Pages**: debounced `invalidate()` per page dependency key.
  - **Toasts**: completion and failure toasts with **View details**; a polite or assertive `aria-live` region; a "Reconnecting…" indicator.
- **Pages**:
  - **Settings → Jobs**: new "Active jobs" table.
  - **Arr sync page**: section status (Queued / Syncing… / Last sync failed), derived from active jobs.
  - **Live updates**: sync history, canary list and detail, and drift list and detail.
- **Docs**: the API endpoint reference, plus the Live progress and Troubleshooting guides.

## Validation

| Level                                       | Result                                                                                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deno task lint`                            | Pass                                                                                                                                                                                                                           |
| `deno task check`                           | Pass (0 errors)                                                                                                                                                                                                                |
| `deno task build`                           | Pass                                                                                                                                                                                                                           |
| `deno task test`                            | 2,7xx pass; 3 fail, and the same 3 fail on `origin/main` in this local environment (`arrExternalUrlLayoutPropagation`, `lidarrOnboarding`: missing `ARR_CREDENTIAL_MASTER_KEY`)                                                |
| Runtime smoke (dev and the compiled binary) | Stream headers, hello, queued → running → finished, replay, `resync: boot`; jobs page and toast update without a reload; on server kill the indicator shows "Reconnecting…", then it reconnects in about 3 s and toasts resume |

## Deviations (from implementers)

- **Formatting**: follows `.prettierrc` (2 spaces, width 120) rather than the tabs/100 note in the agent rules.
- **`HEAD /api/v1/events` probe**: added because `EventSource` can't see HTTP status codes.
- **Long replay**: a replay larger than the stream queue sends `resync: gap` rather than overflowing.
- **Session lifetime**: stream requests never extend the session.
- **Bypass principals** (AUTH=off, or local AUTH=local): only the global cap applies.
- **Sync page status**: derived from active `arr.sync*` jobs by explicit instance id, so a section without a job no longer shows "Queued" forever.
- **Toast policy**: a rescheduled failure (scheduled sync) still toasts; `partial` gives a warning.
- **Queued toasts**: all "queued" toasts are now `info`, including those on the logs, backups, rename and upgrades pages.
