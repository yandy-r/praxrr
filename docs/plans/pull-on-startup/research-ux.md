# UX Research: pull-on-startup

## Executive Summary

`PULL_ON_STARTUP` should behave like a safe, non-blocking bootstrap job: app starts normally, startup pull runs in background, and users get clear status + remediation when needed. In Praxrr, this aligns with existing patterns: startup tasks are logged with `source` context and typically do not fail app boot (`hooks.server.ts`), while operational status is already surfaced well through badges and job history (`/settings/jobs`).

The UX priority is trust and predictability: users should always know whether startup pull was disabled, queued, running, skipped, succeeded, partially succeeded, or failed, and what to do next.

## User Workflows

### First startup (flag enabled)

1. App boots and is usable immediately.
2. Startup pull job is queued automatically after core init.
3. UI shows a subtle "Startup import in progress" status (dashboard/settings/jobs), not a blocking modal.
4. Result state appears with counts:
   - matched/imported
   - skipped defaults
   - skipped no-match
   - conflicts requiring review
5. User can open details and optionally run a manual retry/import action.

UX note: first-run users need one extra line of orientation text: "Praxrr can import from Arr at startup when enabled."

### Repeated startups (flag enabled)

1. On each restart, startup pull runs idempotently.
2. Most runs should end in "No changes" or small deltas.
3. Surface concise history (last run, duration, outcome, per-instance status) so restarts feel predictable.

UX note: default to collapsed details when no changes to reduce noise.

### Conflict cases

1. Name/metadata match ambiguity detected.
2. Job continues for unaffected items (partial success model).
3. Conflicts are recorded with exact entity + reason + suggested action.
4. User gets direct path to resolve (instance sync/import settings or target entity page).

Conflict copy should explicitly state whether the item was skipped, overwritten, or needs manual review.

### Disabled-flag flow (`PULL_ON_STARTUP=false`)

1. App boots normally with no startup pull.
2. Status should still be explicit: "Startup import disabled by env flag."
3. Users can still run manual pull/import from existing routes.

UX note: explicit disabled state avoids "did it fail or is it off?" confusion.

## UI/UX Best Practices

### Communicating background startup work

- Prefer layered visibility:
  - logs for operators
  - job row/history for admins
  - lightweight in-app status badge for day-to-day users
- Do not block setup/auth/dashboard flows for startup pull; treat it as background automation.
- Use existing Praxrr conventions:
  - alerts (`alertStore.add`) for actionable outcomes only
  - status badges for state (`running`, `queued`, `failed`, `success`)
  - jobs page as canonical audit trail

### Recommended state model

- `disabled`
- `queued`
- `running`
- `success`
- `success_no_changes`
- `partial_success`
- `failed`
- `skipped` (for guardrail-driven no-op conditions)

### Message quality guidelines

- Say what happened.
- Say why (technical but concise).
- Say what to do next (retry/edit settings/view logs).
- Include instance/entity context in every failure.

## Error Handling

### Error UX patterns

- Classify errors by remediation path, not by stack trace category.
- Keep startup robust: one instance failure should not prevent app readiness.
- Show inline actionable copy; keep raw error details in expandable sections/logs.

### Recommended error categories and copy pattern

- Connection/auth: "Cannot reach Radarr 'Home' (401 Unauthorized). Check API key in Arr settings."
- Validation/mapping: "Skipped 'HD-1080p': no unambiguous metadata match. Review matching rules."
- Timeout: "Startup pull timed out after 30s for Sonarr 'Anime'. Import skipped for this instance."
- Rate/remote errors: "Arr API returned 429. Retry after cooldown."

### Recovery affordances

- `Retry failed instances`
- `Run startup pull now` (manual one-shot)
- `Open Arr settings`
- `View job details`

## Performance UX

- Keep startup non-blocking; avoid gating main UI on import completion.
- Show progress at meaningful granularity (per instance + overall count), not high-frequency noise.
- Use soft timeout + partial completion over all-or-nothing failure.
- Record run duration and affected counts for trust over time.
- If work is large, show staged language: "Preparing", "Matching", "Applying", "Finalizing".

Suggested defaults for UX consistency:

- startup pull begins after core init succeeds
- per-instance timeout with partial completion
- visible "last startup pull" timestamp + outcome badge

## Competitive Analysis

- Terraform `init`: explicitly safe to run repeatedly; strong model for idempotent startup actions and confidence messaging.
- Argo CD sync options: selective sync (`ApplyOutOfSyncOnly`) and explicit confirmation for destructive actions; useful for "skip defaults" and conflict guardrails.
- GitLab import history: asynchronous import with visible status/error history; strong precedent for a dedicated status history surface.
- Common admin tooling pattern (Jenkins/Grafana-style ops UIs): startup/config bootstrap does not block UI and relies on logs + admin pages for deep diagnostics.

Industry pattern convergence:

- non-blocking boot
- explicit states
- partial success over hard stop
- durable run history
- clear retry path

## Recommendations

### Must

- Non-blocking startup behavior when `PULL_ON_STARTUP=true`.
- Explicit disabled state when `PULL_ON_STARTUP=false`.
- Add startup-pull run record to background jobs/history with badge states.
- Provide actionable failure messages with instance + remediation.
- Preserve partial success behavior (continue unaffected instances/entities).
- Clearly report skipped defaults and skipped unmatched items.

### Should

- Show compact startup status badge on dashboard or settings landing.
- Add one-click retry for failed instances only.
- Add structured result summary counts in job output.
- Add links from error rows to relevant Arr/settings pages.
- Announce important status changes via polite live regions if surfaced in UI.

### Nice

- "Startup import diagnostics" panel with per-instance timeline.
- Export/import run report for troubleshooting.
- User-tunable startup timeout/backoff env vars documented with UX guidance.

## Open Questions

1. Should startup pull run before or after job queue init, if we want it visible in `/settings/jobs` immediately?
2. For conflicts, should v1 only skip + report, or allow policy-driven auto-resolution in startup mode?
3. Should "disabled by env" appear globally (settings header) or only in jobs/logs to reduce UI noise?
4. Do we need a dedicated setup-state flag (similar to default DB auto-link tracking) to mark first successful startup pull?
5. What timeout and retry defaults best fit typical home-lab Arr response times?
