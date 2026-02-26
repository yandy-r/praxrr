# UX Research: trash-guide-sync

## Executive Summary

The trash-guide-sync feature should deliver a dashboard-first experience that surfaces sync health
at a glance, provides structured diff previews before applying changes, and handles multi-instance
orchestration transparently. Research across the Arr ecosystem (Recyclarr, Configarr, Notifiarr),
DevOps sync dashboards (ArgoCD, Terraform Cloud, FluxCD, Atlantis), and established UX pattern
literature reveals three critical differentiators for Praxrr: (1) a unified sync status dashboard
that shows every instance's relationship with every database source in one view -- something no
existing Arr tool offers; (2) a Terraform-style plan/apply preview with progressive disclosure from
summary counts down to field-level before/after diffs; and (3) real-time progress feedback via SSE
for long-running sync operations, replacing the "fire and forget" model of CLI-based competitors.

## User Workflows

### Primary Flow: Scheduled Sync Dashboard

The dashboard is the entry point users see most often. It must answer the question "Is everything
healthy?" in under two seconds.

1. **User opens Sync page**: System renders the sync dashboard with status cards for each Arr
   instance. Each card shows: instance name, Arr type badge (Radarr/Sonarr/Lidarr), last sync
   timestamp with relative time ("3 hours ago"), sync status indicator
   (synced/pending/failed/in-progress), and database source tags.
2. **User scans for issues**: Cards with failures float to the top (sorted by severity). A global
   summary bar shows aggregate health: "5 instances synced, 1 pending, 0 failed". No-change states
   show a subtle green checkmark.
3. **User notices a pending sync**: An amber badge indicates a PCD database has upstream changes
   waiting to be applied. User clicks the card to drill into the instance detail view.
4. **Instance detail view**: Shows per-section (Quality Profiles, Custom Formats, Delay Profiles,
   Media Management, Metadata Profiles) sync status, last sync time, and next scheduled sync. A
   "Preview Changes" button initiates the preview flow. A "Sync Now" button triggers immediate sync.
5. **Scheduled sync fires automatically**: If the instance is configured with an `on_pull` or
   scheduled trigger, the system syncs in the background. The dashboard updates in real time via SSE
   -- the status badge transitions from "idle" to "syncing" (with a progress indicator) to "synced"
   or "failed".
6. **User receives notification**: On completion, a toast alert appears: "Radarr (192.168.1.10)
   synced successfully: 3 profiles updated, 12 custom formats synced." For failures, an inline alert
   persists until dismissed.

**Confidence**: High -- This flow synthesizes patterns from ArgoCD's application dashboard (sync
status badges, real-time updates), Notifiarr's TRaSH integration (instance-scoped cards with
last-sync timestamps), and Smashing Magazine's real-time dashboard strategies (visual hierarchy,
data freshness indicators).

### Setup Flow: First-Time Configuration

First-time configuration involves two independent tasks: linking a TRaSH Guide data source and
connecting Arr instances. The existing Praxrr database linking and instance setup flows cover these.
The new UX contribution is the "bridge" between them -- configuring what to sync from which database
to which instance.

1. **User navigates to Databases page**: Clicks "Link Database". Enters the TRaSH Guides repository
   URL (or selects from a preset dropdown offering the Praxrr-maintained TRaSH derivative).
   Configures name, branch, and sync schedule (interval in minutes via a simple number input with
   preset options: 60, 180, 360, 720).
2. **System clones and validates**: A loading state shows progress: "Cloning repository..." ->
   "Validating manifest..." -> "Importing entities..." -> "Compiling cache...". Each step
   transitions with a checkmark on completion. If validation fails, a clear error with recovery
   instructions appears inline.
3. **User navigates to Arr instance sync settings**: Selects the newly linked TRaSH database as a
   sync source. The UI presents available entities organized by section (Quality Profiles, Custom
   Formats, etc.) with checkboxes for selective sync. Entity groups from TRaSH (e.g., "Unwanted",
   "HDR Formats", "Audio Advanced") are shown as collapsible groups for batch selection.
4. **User configures sync trigger**: Selects from trigger options: `on_pull` (sync whenever the
   TRaSH database updates), `on_change` (sync when local PCD changes occur), `schedule` (independent
   cron/interval), or `manual` (only on explicit action). An explanatory tooltip describes each
   option.
5. **User runs initial sync or preview**: System offers "Preview First" (recommended for new setups,
   shows what will be created on the Arr instance) or "Sync Now" (applies immediately). For
   first-time setups, the UI defaults to preview-first with a callout: "We recommend previewing
   changes before your first sync to verify your configuration."

**Confidence**: High -- The step-by-step database linking mirrors Praxrr's existing flow. The entity
group selection pattern draws from Notifiarr's Profiles tab (group-based selection with
expand/collapse) and Recyclarr's template system (curated presets that abstract away individual
entity selection). NNGroup's wizard design research recommends progressive steps with clear progress
indication for unfamiliar one-time tasks.

### Review Flow: Pre-Sync Preview

This flow is covered extensively in the existing `sync-preview-dry-run` research. The key additions
for the TRaSH Guide context:

1. **User clicks "Preview Changes" from instance detail or dashboard card**: System initiates
   preview generation. A loading state shows per-instance progress with determinate indicators
   ("Fetching current state from Radarr...").
2. **Preview results appear**: The preview uses the four-level progressive disclosure hierarchy
   defined in the sync-preview-dry-run research:
   - **Level 1 -- Global Summary**: "3 creates, 8 updates, 0 deletes, 45 unchanged"
   - **Level 2 -- Instance Card**: Instance name + Arr type badge + per-instance counts
   - **Level 3 -- Section Groups**: Quality Profiles (2 updates), Custom Formats (3 creates, 5
     updates)
   - **Level 4 -- Entity Detail**: Field-level before/after diff table
3. **TRaSH-specific additions to preview**:
   - **Source attribution**: Each entity change shows a small "TRaSH" or "PCD" source tag indicating
     where the change originates, so users can distinguish TRaSH Guide updates from their own PCD
     modifications.
   - **TRaSH revision info**: Updated entities show the TRaSH Guide revision/date of the upstream
     change for traceability.
   - **Group context**: Changes are annotated with their TRaSH CF group name (e.g., "Unwanted", "HDR
     Formats") to provide semantic context.
4. **User reviews and applies**: Following the tiered confirmation pattern (simple confirm for
   creates/updates, type-to-confirm for deletes).

**Confidence**: High -- Builds directly on the proven sync-preview-dry-run patterns with
TRaSH-specific metadata enrichment. Source attribution is critical for multi-database environments
where users need to understand which upstream source drove each change.

### Error Flow: Sync Failure Handling

1. **Sync fails during execution**: The dashboard card transitions from "syncing" to "failed" with a
   red status indicator. A persistent inline alert appears with the error summary.
2. **User clicks the failed instance card**: The instance detail view shows:
   - **Error summary banner**: Red banner with the primary error message, categorized by type
     (connection error, authentication error, API error, validation error).
   - **Per-section status**: Sections that completed successfully show green checkmarks. The failed
     section shows a red X with the specific error. Sections that were not attempted (because the
     failure halted execution) show a gray "skipped" indicator.
   - **Partial success detail**: For section-level failures, the UI shows which entities within the
     section succeeded and which failed (item-level breakdown).
3. **Recovery actions**: Each error type maps to a specific recovery action:
   - Connection error: "Retry" button + "Check Instance Settings" link
   - Authentication error: "Update API Key" link to instance settings
   - API validation error: Error message from the Arr API + "View Details" expandable showing the
     full API response + "Skip and Continue" option
   - Timeout: "Retry with Extended Timeout" option
4. **Retry options**: "Retry Failed Only" re-attempts only the failed sections/entities. "Retry All"
   re-runs the complete sync. Both are available from the error detail view.

**Confidence**: High -- Error handling patterns synthesized from Recyclarr v8's unified diagnostics
panel (consolidated errors at end of sync), the LogRocket async workflows article (item-level
success/failure breakdown with recovery options), and Pencil & Paper's error feedback research
(state what happened, explain why, provide forward path).

### Alternative Flows

- **Manual sync trigger**: User clicks "Sync Now" on any instance. Bypasses schedule checks and
  trigger requirements. Useful for testing configuration changes or forcing an immediate update
  after modifying sync selections.
- **Database-scoped sync**: User triggers sync from the Database page, which fans out to all
  instances configured to sync from that database. Useful after a manual PCD pull to propagate
  changes to all consumers.
- **Conflict resolution flow**: When `conflict_strategy` is set to `ask`, conflicted entities appear
  as a notification badge on the database card. User navigates to a conflict resolution view showing
  the upstream value, the user's override value, and three resolution options (keep mine, accept
  upstream, view diff). This mirrors Git merge conflict resolution UX with a simplified,
  domain-specific interface.
- **Bulk operations**: User selects multiple instances and triggers batch sync or batch preview. The
  system processes them with bounded concurrency (CONCURRENCY_LIMIT = 3) and streams results
  progressively.

**Confidence**: Medium -- Manual and database-scoped sync mirror existing Praxrr behavior. Conflict
resolution UX needs more design validation since the `ask` strategy introduces a novel interaction
not present in CLI tools.

## UI/UX Best Practices

### Sync Dashboard Design

The sync dashboard should follow a **status-first, action-second** layout:

**Global Status Bar (Sticky)** A persistent bar at the top of the sync page showing aggregate
health. This follows the Smashing Magazine recommendation to place critical KPIs in the upper-left
scanning zone:

```
Sync Status: 5 Synced | 1 Pending | 0 Failed | Last check: 2 min ago  [Refresh]
```

Use micro-animations (fade-in, count-up) to signal real-time updates without distraction. Delta
indicators (green up-arrow for newly synced, amber for pending) help users notice state transitions.

**Instance Status Cards (Grid)** A responsive card grid (2-3 columns on desktop, single column on
mobile). Each card contains:

- **Header row**: Instance name (bold), Arr type pill badge (Radarr = blue, Sonarr = purple, Lidarr
  = green)
- **Status indicator**: Color-coded dot + text label ("Synced", "Pending", "Failed", "Syncing...").
  Never rely on color alone -- always pair with text and icon per WCAG 1.4.1.
- **Metadata row**: Last sync time (relative), next scheduled sync, database source tags
- **Quick actions**: "Sync Now", "Preview", overflow menu with "View History", "Settings"
- **Health sparkline** (optional): A tiny trend line showing sync success rate over the last 7 days,
  following the Smashing Magazine sparkline recommendation for compact trend visualization

Cards are sorted by severity (failed first, pending second, synced last), with failed cards visually
distinguished by a left border accent in red.

**Confidence**: High -- Card-based dashboard layout is the dominant pattern in multi-instance
monitoring tools (Syncthing Multi Server Monitor, Cockpit multi-server dashboard, Dashy). The
severity-first sort follows the Smashing Magazine guidance on directing attention to actionable
items.

### Diff/Preview Display

The diff/preview UX is extensively covered in the sync-preview-dry-run research. Key patterns to
adopt for the TRaSH Guide context:

**Summary-First Hierarchy** Global counts at the top, expandable instance accordion cards, section
groups within cards, entity-level field diffs on expand. Four levels of progressive disclosure,
matching Terraform Cloud's structured run output.

**Property-Level Before/After Table** For entity updates, use CloudFormation's property-level
changes format:

```
Field              Change     Before          After
-----              ------     ------          -----
cutoff             Modified   Quality5        Quality7
upgradeAllowed     Modified   false           true
minFormatScore     Added      --              25
```

**Collection Changes** For nested collections (format scores within profiles):

```
formatItems (3 changes)
  [+ Create]  HDR10+        score: 1500
  [~ Update]  DV            score: 1000 -> 1200
  [- Delete]  x265 (HD)     score: -500 (removed)
```

**Color + Icon + Text Triple-Encoding** Green/`+`/"Create", Amber/`~`/"Update", Red/`-`/"Delete".
All three indicators always present for accessibility. Use Tailwind tokens:
`text-green-600`/`bg-green-50`, `text-amber-600`/`bg-amber-50`, `text-red-600`/`bg-red-50`.

**Source Attribution Tags** In multi-database environments, each change row shows a small pill tag
indicating the originating database ("TRaSH-DB", "Custom PCD"). This is critical for users combining
TRaSH Guides with their own PCD databases.

**Confidence**: High -- Directly adopts patterns validated in the sync-preview-dry-run research with
TRaSH-specific enrichment.

### Schedule Configuration

Praxrr's existing sync configuration uses an interval-in-minutes approach, which is simpler than raw
cron expressions. The UX for TRaSH Guide sync scheduling should preserve this simplicity:

**Recommended Pattern: Interval Selector with Presets**

Rather than a cron expression editor (which requires domain knowledge most self-hosters do not
have), use a dropdown with preset intervals plus a custom option:

```
Sync Interval: [Every 6 hours  v]
  - Every 1 hour
  - Every 3 hours
  - Every 6 hours (recommended)
  - Every 12 hours
  - Every 24 hours
  - Custom: [___] minutes
```

Below the selector, display the next scheduled sync time: "Next sync: Today at 8:15 PM (in 4h 23m)".

For advanced users who need cron-level control, provide a "Use cron expression" toggle that reveals
a text input with inline validation and a human-readable description of the expression (using a
library like cronstrue). Include a link to crontab.guru for reference.

**Confidence**: High -- Recyclarr and Configarr both use interval-based scheduling (minutes/hours)
rather than raw cron. NNGroup wizard research recommends limiting options and reducing domain
knowledge requirements. Cron pickers add complexity without proportional benefit for the typical
self-hoster audience.

### Progress and Feedback

**Sync In Progress** When a sync is running, the instance card transitions to a "syncing" state:

- Progress bar (determinate when section count is known): "Syncing Quality Profiles (2 of 5
  sections)..."
- Current operation label: "Pushing 12 custom formats to Radarr..."
- Elapsed time display
- "Cancel" option for manual syncs

**Background Sync with Notification** For scheduled syncs, the user may not be on the sync page. The
system should:

1. Update the dashboard state via SSE if the page is open
2. Show a toast alert on sync completion (using `alertStore.add(type, message)`)
3. For failures, use a persistent inline alert that does not auto-dismiss

**SSE for Real-Time Updates** Server-Sent Events are the recommended transport for sync progress.
SSE is simpler than WebSockets (no bidirectional channel needed), has native browser reconnection,
and has become the standard for server-to-client push in 2025. SvelteKit supports SSE via streaming
responses from server endpoints. The SSE stream should emit events for:

- `sync:start` -- instance ID, sections being synced
- `sync:progress` -- current section, entity counts, percentage
- `sync:section-complete` -- section name, result (success/failure), summary stats
- `sync:complete` -- overall result, summary, errors/warnings
- `sync:error` -- error details, affected section/entity

Fallback to polling (5-second interval) for environments where SSE is not available (reverse proxies
that buffer responses).

**Confidence**: High -- SSE is the consensus recommendation for server-to-client progress updates in
2025 (portalZINE, MDN, multiple engineering blogs). Recyclarr v8 introduced live progress display
for CLI output; Praxrr should deliver the web equivalent.

### Industry Standards

- **Data freshness timestamps**: Every status display must show when the data was last refreshed.
  Use relative time for recent data ("2 min ago") and absolute time for older data ("Feb 25, 3:15
  PM"). Follow Cloudscape Design System's Data Freshness Indicator pattern.
- **Auto-retry with exponential backoff**: For transient errors (connection timeouts, rate limits),
  implement automatic retry with backoff before surfacing errors to the user. Show "Reconnecting..."
  banners during retry attempts.
- **Skeleton loading states**: Replace spinners with skeleton placeholders that mirror the final
  layout structure. Use Tailwind's `animate-pulse` class on gray placeholder elements. Research
  shows users perceive skeleton-loaded pages as faster than spinner-loaded pages.
- **Empty states**: When no syncs have occurred yet, show a purposeful empty state with an
  illustration, explanation, and call-to-action ("Set up your first sync" with a link to the
  database linking page). Follow Carbon Design System's empty states pattern.

**Confidence**: High -- These are codified standards across major design systems (Cloudscape,
Carbon, Material Design).

### Accessibility (WCAG)

- **Status indicators**: Use `role="status"` or `aria-live="polite"` regions to announce sync status
  changes without interrupting user focus. Critical failures use `role="alert"` or
  `aria-live="assertive"`.
- **Progress bars**: Use native `<progress>` elements with `aria-valuenow`, `aria-valuemin`,
  `aria-valuemax`. For indeterminate progress, omit `aria-valuenow`. Associate the progress bar with
  the loading region via `aria-describedby`.
- **Color independence**: All color-coded status indicators must include a text label and icon.
  Green/amber/red palette at the 600 shade level meets the 3:1 contrast requirement for non-text
  elements (WCAG 2.2 SC 1.4.11).
- **Keyboard navigation**: Tab through instance cards, Enter to expand/collapse, Escape to close
  detail views. All interactive elements focusable and operable without mouse.
- **Motion reduction**: Respect `prefers-reduced-motion` media query. Disable micro-animations,
  transition to instant state changes.
- **Live region management**: For SSE-driven updates, ensure `aria-live` regions are present in DOM
  from initial load (even if empty). Avoid flooding live regions with rapid updates -- batch or
  debounce announcements to one per 3-5 seconds.

**Confidence**: High -- WCAG 2.2 requirements are codified standards. ARIA progressbar and live
region patterns are documented by MDN and W3C.

### Responsive Design

- **Desktop (1024px+)**: Full card grid (2-3 columns), side-by-side diff option, filters visible in
  toolbar, full section detail views.
- **Tablet (768-1023px)**: 2-column card grid, inline-only diffs, filters in collapsible toolbar.
- **Mobile (below 768px)**: Single-column card stack, summary-only view (expand for detail), filters
  in bottom sheet. Sync operations are read-mostly on mobile (monitoring status), with write actions
  (sync now, apply) requiring confirmation. A "View on Desktop" prompt for complex diff previews is
  acceptable since this is primarily a server management tool.

**Confidence**: Medium -- Server management tools are predominantly desktop experiences. Mobile
optimization should focus on status monitoring rather than full interaction capability. ArgoCD,
Terraform Cloud, and Notifiarr are all desktop-first.

## Error Handling

### Error States

| Error                        | User Message                                                                                                 | Recovery Action                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Instance unreachable         | "Cannot connect to [Instance Name] at [host:port]. The instance may be offline or the URL may be incorrect." | "Retry Connection" button; "Check Settings" link to instance configuration                      |
| API authentication failure   | "Authentication failed for [Instance Name]. The API key may be invalid or expired."                          | "Update API Key" link to instance settings page                                                 |
| Database clone failure       | "Failed to clone [Database Name]. The repository URL may be incorrect or inaccessible."                      | "Retry Clone" button; "Edit Database" link; check network/credentials guidance                  |
| Database validation failure  | "Database [Database Name] has an invalid manifest or incompatible schema version."                           | "View Error Details" expandable; "Contact database maintainer" guidance                         |
| Cache compilation failure    | "Failed to compile cache for [Database Name]. Entity data may contain conflicts."                            | "View Compilation Errors" link to error log; "Retry Compilation" button                         |
| Partial sync failure         | "[2 of 5] sections synced to [Instance Name]. Quality Profiles failed: [error detail]."                      | "Retry Failed Sections" button; "View Successful Changes" collapse; "Skip and Continue" option  |
| TRaSH Guide structure change | "TRaSH Guide repository structure has changed. The importer needs to be updated."                            | Manual intervention required; "View Details" showing what changed; link to Praxrr release notes |
| Conflict detected (ask mode) | "[3] entities have conflicting changes between your overrides and upstream TRaSH updates."                   | "Resolve Conflicts" button navigating to conflict resolution view                               |
| Rate limit hit               | "GitHub API rate limit reached. Sync will retry in [X] minutes."                                             | Automatic retry with countdown display; "Use Personal Access Token" guidance                    |
| Sync timeout                 | "Sync to [Instance Name] timed out after [X] seconds."                                                       | "Retry" button; "Increase Timeout" setting link                                                 |

**Confidence**: High -- Error taxonomy derived from the business logic research's edge cases and
error recovery section, mapped to UX patterns from Pencil & Paper's error feedback research.

### Validation Patterns

- **Repository URL**: Validate on blur. Accept HTTPS URLs, SSH URLs, and local file paths. Show
  inline success/error indicator. For GitHub URLs, validate format and optionally test reachability.
- **API Key**: Validate format (alphanumeric, expected length). On save, test connectivity and
  display success/failure inline.
- **Sync Interval**: Minimum 15 minutes (prevent excessive API load). Show warning below 60 minutes:
  "Frequent syncing may increase API load on your Arr instances."
- **Entity selection**: At least one entity must be selected for a sync configuration to be valid.
  Show inline validation: "Select at least one item to sync."
- **Cron expression** (if exposed): Validate syntax on input. Show human-readable description below
  the input. Reject expressions that resolve to intervals shorter than 15 minutes.

**Confidence**: High -- Validation patterns follow standard form UX. Minimum interval thresholds
mirror Recyclarr's guidance on sync frequency.

## Performance UX

### Loading States

- **Initial dashboard load**: Skeleton cards with `animate-pulse` placeholders matching the card
  layout (header bar, status dot, metadata lines, action buttons). Each card resolves independently
  as data loads. Cards should render within 200ms for cached data, with skeletons visible only for
  uncached or slow responses.
- **Sync in progress**: Determinate progress bar on the instance card showing section progress
  (e.g., "Section 2 of 5"). Current operation label updates via SSE. Elapsed time counter.
- **Preview generation**: Per-instance loading indicators within the preview layout. Instances that
  complete first are immediately reviewable while others load (progressive streaming). Disabled
  "Apply" button until all instances resolve (or fail).
- **Database linking**: Multi-step progress indicator: "Cloning..." -> "Validating..." ->
  "Importing..." -> "Compiling...". Each step shows a checkmark on completion and a spinner on the
  active step.
- **Background sync**: No loading UI required on the sync page (it happens in the background).
  Status card transitions from "idle" -> "syncing" -> "synced"/"failed" via SSE. If the user is on a
  different page, a toast notification on completion.

**Confidence**: High -- Skeleton loading is the consensus pattern for dashboard UIs (Flowbite,
Tailwind documentation, Smashing Magazine). Progressive streaming is standard for multi-target
operations (ArgoCD, CI/CD pipelines).

### Real-Time Updates

**Recommended: Server-Sent Events (SSE)**

SSE is the recommended transport for real-time sync progress. Compared to WebSockets, SSE requires
no bidirectional channel, has built-in browser reconnection (`EventSource` auto-reconnects), works
through most reverse proxies, and aligns with HTTP semantics. SSE has seen a resurgence in 2025
driven by AI streaming responses, making it well-supported across the ecosystem.

**Implementation Pattern for SvelteKit:**

1. **Server endpoint** (`/api/v1/sync/events`): Returns a `ReadableStream` with `text/event-stream`
   content type. Emits events as sync status changes occur. Uses the existing job queue's state
   transitions as event sources.
2. **Client subscription**: On the sync dashboard page, create an `EventSource` connection on mount.
   Parse events and update Svelte stores reactively. Reconnect on connection loss with exponential
   backoff.
3. **Event format**:

   ```
   event: sync:progress
   data: {"instanceId":"uuid","section":"qualityProfiles","progress":40,"message":"Pushing 5 of 12 profiles..."}

   event: sync:complete
   data: {"instanceId":"uuid","result":"success","summary":{"created":3,"updated":8,"deleted":0}}
   ```

4. **Fallback**: If SSE connection fails after 3 retries, fall back to polling the
   `/api/v1/sync/status` endpoint every 5 seconds. Show a subtle banner: "Real-time updates
   unavailable. Refreshing every 5 seconds."

**Confidence**: High -- SSE is the consensus recommendation for server-push in web applications
(MDN, multiple 2025 engineering articles). SvelteKit supports streaming responses natively. Fallback
to polling is a standard resilience pattern.

### Feedback and State Design

**Toast Notifications (via `alertStore.add`)**

Use toast alerts for transient, non-critical feedback:

- **Sync success**:
  `alertStore.add('success', 'Radarr synced: 3 profiles updated, 12 custom formats synced.')` --
  auto-dismiss after 5 seconds.
- **Sync failure**:
  `alertStore.add('error', 'Radarr sync failed: Connection refused. Click to view details.')` --
  persistent until dismissed, with click-to-navigate.
- **Database update available**:
  `alertStore.add('info', 'TRaSH-DB has upstream changes. Preview available.')` -- auto-dismiss
  after 8 seconds.

**Inline Alerts (persistent, contextual)**

Use inline alerts for errors and warnings that require user action within a specific context:

- Instance card error banner (red) for sync failures visible on the dashboard
- Section-level error messages within the instance detail view
- Validation errors on configuration forms

**Notification Verbosity** (inspired by Recyclarr's three-tier system):

- **Normal** (default): Show sync results with statistics, errors, and warnings. Suppress empty
  results (no-change syncs).
- **Minimal**: Show only errors and warnings. Suppress success and informational messages.
- **Detailed**: Show everything including no-change syncs and individual entity-level results.

Users configure verbosity in sync settings. This prevents notification fatigue for users with many
instances syncing frequently.

**Confidence**: High -- Toast vs. inline alert selection follows Carbon Design System and Red Hat
Design System guidelines. Recyclarr's verbosity model is proven in the Arr ecosystem. Praxrr's
existing `alertStore.add(type, message)` pattern supports this directly.

## Competitive Analysis

### Recyclarr

- **Approach**: CLI-only tool using YAML configuration files. Runs as a scheduled Docker container
  or manual command. No web UI. Configuration is entirely file-based with template presets for
  common profiles.
- **Strengths**:
  - **Template system**: Pre-built configuration files for every TRaSH Guide profile reduce YAML
    complexity dramatically. Users pick a template and fill in `base_url` + `api_key`.
  - **Preview mode** (`--preview`): Performs all sync work read-only. v8 introduced structured table
    output (action/name/trash_id columns), live progress display, and a unified diagnostics panel.
  - **Notification system**: Consolidated sync summary via Apprise with three verbosity levels
    (minimal/normal/detailed). One notification per sync run regardless of instance count.
  - **Multi-instance output**: v8 added visual separators between instances and instance name
    headers in preview output.
  - **Error messaging**: v8 improved YAML error messages to be specific and actionable rather than
    generic stack traces.
- **Weaknesses**:
  - No web UI at all -- everything is CLI/YAML, creating a high barrier for non-technical users
  - No interactive conflict resolution -- conflicts require manual YAML editing
  - No real-time progress in a GUI -- the live progress display is terminal-only
  - No selective sync within a single run -- the user must modify YAML to change what syncs
  - Template compatibility breaks across major versions (v7 -> v8 templates changed)
- **What Praxrr can learn**: Adopt the structured preview output pattern (table with action/name
  columns). Replicate the notification verbosity system (normal/minimal/detailed). The template
  concept maps to Praxrr's PCD-backed preset profiles.

**Confidence**: High -- Based on Recyclarr documentation at recyclarr.dev, the v8 changelog, and the
TRaSH Guides sync page.

### Configarr

- **Approach**: Container-based tool designed for scheduled execution via cron in Docker/Kubernetes.
  YAML configuration similar to Recyclarr but with additional support for custom (non-TRaSH) custom
  format definitions. Supports Sonarr, Radarr, Lidarr, Readarr, Whisparr.
- **Strengths**:
  - **Broader Arr support**: Official support for more applications than Recyclarr (Whisparr,
    Readarr, Lidarr with experimental support)
  - **Custom format definitions**: Allows users to define custom formats directly in configuration
    alongside TRaSH formats -- not limited to what TRaSH provides
  - **Local file support**: Can read custom format definitions from local files, not just TRaSH repo
  - **Selective sync**: If a property is not specified in config, Configarr will not sync it,
    allowing manual configuration alongside automated sync
- **Weaknesses**:
  - No dry-run/preview mode documented
  - No web UI (GUI mentioned in comparison page but not substantiated in documentation)
  - Container-only deployment model limits accessibility
  - Recyclarr template compatibility only through v7.4.0
- **What Praxrr can learn**: The "if not specified, don't touch it" philosophy for selective sync is
  elegant. Users should be able to sync only the entities they explicitly select, with unselected
  entities remaining under manual control. The custom format definition capability (beyond TRaSH)
  maps to Praxrr's user ops system.

**Confidence**: Medium -- Based on Configarr documentation at configarr.de and the GitHub
repository. Some features mentioned in comparison tables could not be verified in detailed docs.

### Notifiarr

- **Approach**: The only existing tool with a full web GUI for TRaSH Guide sync. Part of the
  Notifiarr ecosystem (notification aggregation + monitoring). TRaSH sync is a paid "Patron"
  feature. Uses a client-server architecture with the Notifiarr client running locally.
- **Strengths**:
  - **GUI-first design**: Tabbed interface with Profiles, Formats, Scores, Quality, Naming sections.
    Instance-scoped configuration with a second row of tabs for target instances.
  - **Group-based selection**: Pre-made profile groups for common configurations. Users select
    groups rather than individual formats.
  - **Score management**: Multiplier-based score adjustment ("Multiplier \* TRaSH = Your Score") for
    fine-tuning without losing sync capability.
  - **Automated periodic sync**: Configurable check interval with last-sync timestamp display.
  - **Sync button with status**: Manual sync trigger with auto-closing completion dialog.
- **Weaknesses**:
  - Paid feature (Patron subscription required)
  - Tied to the Notifiarr ecosystem -- cannot be used standalone
  - No diff/preview before sync -- changes are applied directly
  - Limited conflict resolution -- no explicit handling of user overrides vs. upstream changes
  - Advanced features hidden behind a toggle, creating discoverability issues
  - No sync history or audit log visible in the UI
- **What Praxrr can learn**: The tabbed instance/action navigation is effective for multi-instance
  management. The score multiplier concept is a good UX for "follow the guide but scale scores." The
  group-based selection reduces cognitive load compared to individual entity selection. The
  last-sync timestamp display is essential.

**Confidence**: High -- Based on Notifiarr wiki documentation and Savvy Guides step-by-step
walkthrough.

### DevOps Dashboard Patterns (ArgoCD, Flux, Terraform)

#### Sync Status Indicators

**ArgoCD**:

- Three-state model: Synced (green), OutOfSync (amber), Unknown (gray)
- Health status as a separate axis: Healthy, Progressing, Degraded, Missing
- Both sync status and health are shown as color-coded badges on application cards
- Aggregated health: if one child resource is degraded, the parent application shows degraded

**FluxCD**:

- Reconciliation status via `gotk_reconcile_condition` metric (True/False)
- Kustomization and HelmRelease tracking with dependency graphs
- Grafana dashboards for visualization (not built-in UI)

**Terraform Cloud**:

- Run states: Pending -> Planning -> Cost Estimating -> Policy Checking -> Applying ->
  Applied/Errored
- Each state is a discrete step in a visible pipeline with elapsed time per step
- Resource-level status within the apply step (creating/created/failed)

**What to adopt for Praxrr**: The ArgoCD two-axis model (sync status + health/connectivity) maps
well to Praxrr's needs. Each instance has a "sync status" (synced/pending/failed) and a "connection
status" (online/offline/unknown). Display both as separate badges. The Terraform pipeline step
visualization is ideal for showing multi-section sync progress.

**Confidence**: High -- Based on ArgoCD docs (diff strategies, sync options, resource health),
FluxCD monitoring docs, and Terraform Cloud's structured run output blog post.

#### Diff/Plan Views

**ArgoCD**:

- Live vs. Desired state comparison with inline (compact) and split (side-by-side) toggle
- Resource tree visualization showing parent-child relationships
- Three-way diff: last-synced state, live state, desired state

**Terraform Cloud**:

- Structured Run Output: each resource as a clickable row with action badge, provider type, resource
  address
- Expand to see timeline of stages with elapsed time per stage
- Summary counts above the resource list updating in real-time during plan
- Resource filtering by action type and provider

**Atlantis**:

- Plan output posted as PR comment -- integrates with existing code review workflow
- No separate UI -- uses the version control platform's native interface
- Lock workspace during plan/apply to prevent concurrent conflicts

**What to adopt for Praxrr**: Terraform Cloud's structured row pattern (entity name + action badge +
click to expand) is the strongest fit for Praxrr's entity-based sync. ArgoCD's "desired vs. live"
framing maps directly to "PCD state vs. Arr state". Atlantis's approach of embedding diffs in
existing workflows is relevant for future PR-based PCD change review.

**Confidence**: High -- Based on published documentation and design wikis for all three tools.

#### History/Audit Trails

**ArgoCD**:

- Deployment history with timestamp, duration, and top parameters per deployment
- Revision-based history with rollback capability to any prior revision
- Event log per application showing reconciliation events

**Terraform Cloud**:

- Full run history with plan/apply output preserved
- Each run is a named, reviewable artifact
- State version history with the ability to compare states

**FluxCD**:

- Event-based audit via Kubernetes events
- Grafana dashboards showing reconciliation counts, durations, and failure rates over time

**What to adopt for Praxrr**: A sync history table per instance showing: timestamp, trigger type
(scheduled/manual/on_pull), result (success/partial/failed), summary stats (X created, Y updated, Z
deleted), duration, and an "expand" action to view the full detail. Retain the last 50-100 sync
records per instance. This maps to Praxrr's existing `job_queue` and sync status tables. ArgoCD's
rollback concept is interesting but complex -- defer to a "nice to have" unless user demand is
clear.

**Confidence**: High -- Audit trail patterns are consistent across all analyzed tools and align with
enterprise software best practices.

### Best Practices to Adopt

| Practice                                                                         | Source                                    | Priority     |
| -------------------------------------------------------------------------------- | ----------------------------------------- | ------------ |
| Summary-first information hierarchy (counts -> cards -> sections -> field diffs) | Terraform Cloud, CloudFormation           | Must Have    |
| Color + icon + text triple-encoding for change types                             | WCAG 2.2, all DevOps tools                | Must Have    |
| Structured entity rows with action badge and click-to-expand                     | Terraform Cloud Structured Run Output     | Must Have    |
| Data freshness timestamps on all status displays                                 | Smashing Magazine, Cloudscape             | Must Have    |
| Staleness warning with refresh capability                                        | Cloudscape, sync-preview-dry-run research | Must Have    |
| SSE for real-time sync progress                                                  | 2025 industry consensus                   | Must Have    |
| Per-instance accordion cards with severity-first sorting                         | ArgoCD, Syncthing Multi Server Monitor    | Must Have    |
| Skeleton loading states                                                          | Tailwind/Flowbite, UX research consensus  | Must Have    |
| Notification verbosity levels (normal/minimal/detailed)                          | Recyclarr                                 | Should Have  |
| Score multiplier concept for guided-but-adjustable sync                          | Notifiarr                                 | Should Have  |
| Group-based entity selection (TRaSH CF groups)                                   | Notifiarr, Recyclarr templates            | Should Have  |
| Sync history table with expandable detail per entry                              | ArgoCD, Terraform Cloud                   | Should Have  |
| Selective sync with "if not specified, don't touch" semantics                    | Configarr                                 | Should Have  |
| PR-comment-style diff for PCD change review                                      | Atlantis                                  | Nice to Have |
| Rollback to previous sync state                                                  | ArgoCD                                    | Nice to Have |

## Recommendations

### Must Have

- **Sync status dashboard**: Card-grid layout with per-instance status
  (synced/pending/failed/syncing), connection health, last-sync timestamp, database source tags, and
  quick-action buttons. Severity-first card ordering.
- **Global status bar**: Sticky summary showing aggregate sync health across all instances with
  refresh capability and data freshness timestamp.
- **SSE-driven real-time updates**: Server-Sent Events for sync progress, status transitions, and
  completion notifications. Fallback to 5-second polling.
- **Structured diff preview**: Four-level progressive disclosure (summary -> instance -> section ->
  entity field diffs) with color+icon+text triple-encoding for change types.
- **Error recovery paths**: Every error state has a specific, actionable recovery option (retry,
  edit settings, skip and continue). Per-section partial failure display showing which sections
  succeeded and which failed.
- **Skeleton loading states**: Layout-matching skeleton placeholders during initial load and preview
  generation. Use Tailwind `animate-pulse`.
- **Data freshness indicators**: All timestamps use relative time for recent data, absolute time for
  older data. Staleness warnings after configurable threshold.
- **Accessibility compliance**: ARIA live regions for status updates, keyboard navigation,
  color-independent status indicators, `prefers-reduced-motion` respect, native `<progress>`
  elements.

### Should Have

- **Sync history table**: Per-instance history of sync operations with timestamp, trigger type,
  result, summary stats, duration, and expandable detail. Retain 50-100 records.
- **Notification verbosity setting**: Normal (default), Minimal (errors only), Detailed (everything
  including no-change syncs). Configurable per instance or globally.
- **Group-based entity selection**: TRaSH CF groups (Unwanted, HDR Formats, Audio Advanced, etc.) as
  collapsible selection units in the sync configuration UI.
- **Source attribution in previews**: Each entity change shows a small pill tag indicating the
  originating database, critical for multi-database environments.
- **Interval preset selector with custom option**: Dropdown with common intervals (1h, 3h, 6h, 12h,
  24h) plus custom-minutes input. Show next scheduled sync time.
- **Conflict resolution view**: For databases with `ask` conflict strategy, a dedicated view showing
  upstream vs. user values with keep/accept/diff resolution options.
- **Instance detail view**: Drill-down from dashboard card to per-section sync configuration,
  status, and history.
- **Background sync with toast notification**: Scheduled syncs run silently with toast on
  completion/failure via `alertStore.add()`.

### Nice to Have

- **Score multiplier/adjustment UI**: Notifiarr-style interface for scaling TRaSH recommended scores
  by a multiplier while preserving sync relationship.
- **Sync health sparklines**: Tiny trend charts on instance cards showing sync success rate over the
  last 7 days.
- **Rollback capability**: Revert an instance to the state before the last sync, leveraging PCD ops
  history.
- **Export sync report**: Download sync results as JSON for archiving or sharing.
- **Bulk instance operations**: Select multiple instances for batch sync/preview with bounded
  concurrency.
- **Advanced cron expression input**: Toggle for power users who need precise cron scheduling beyond
  interval presets.
- **Webhook/external notification**: Apprise-style integration for sending sync summaries to
  Discord/Slack/email, mirroring Recyclarr's notification system.
- **Database update changelog**: Show a human-readable summary of what changed in the upstream TRaSH
  Guide between the last pull and the current one.

## Open Questions

1. **Preview auto-generation on PCD pull**: Should the system automatically generate a preview when
   a TRaSH database pull detects changes, or require the user to explicitly request a preview?
   Auto-preview improves safety but adds latency. Recommendation: auto-preview for databases with
   `on_pull` trigger, manual-preview for others.

2. **Sync history retention depth**: How many sync records should be retained per instance? 50? 100?
   Should old records be pruned automatically or configurable? The answer depends on database size
   constraints and user expectations for audit trail depth.

3. **Conflict resolution UI complexity**: The `ask` conflict strategy requires a dedicated conflict
   resolution view. Should this be a modal, a dedicated route, or inline within the dashboard?
   Recommendation: a dedicated route (following Praxrr's routes-over-modals convention) accessible
   via a notification badge on the database card.

4. **Multi-database diff attribution**: When an instance syncs from both a TRaSH database and a
   custom PCD database, and both contribute changes to the same entity type, how should the preview
   display attribute changes to their source? Should it show changes interleaved (by entity) or
   grouped by source database?

5. **SSE connection management**: Should there be one global SSE connection for all sync events, or
   per-page connections? A global connection is simpler but requires routing logic. A per-page
   connection is cleaner but adds connection overhead if users navigate between pages frequently.

6. **Notification channel for background syncs**: For background (scheduled) syncs, should
   notifications only appear as in-app toasts, or should there be an option for external
   notifications (Discord/email) from day one? Recyclarr's Apprise integration suggests users expect
   external notifications for unattended sync operations.

7. **Entity group granularity**: Should users be able to select individual TRaSH custom formats by
   `trash_id`, only select entire TRaSH-defined groups (e.g., "Unwanted"), or both? Individual
   selection provides maximum control but the UI complexity scales poorly with the 50+ CFs in a
   typical TRaSH profile. Group-level with an override capability (select group then deselect
   individuals) may be the sweet spot.

## Sources

### Arr Ecosystem

- [Recyclarr GitHub Repository](https://github.com/recyclarr/recyclarr) - CLI tool for TRaSH Guides
  sync
- [Recyclarr sync command documentation](https://recyclarr.dev/cli/sync/) - Preview mode, sync
  behavior
- [Recyclarr v8 Changelog](https://github.com/recyclarr/recyclarr/blob/master/CHANGELOG.md) -
  Structured preview output, live progress, diagnostics panel
- [Recyclarr Tutorial: Your First Sync](https://recyclarr.dev/guide/tutorial/) - Setup workflow,
  template system
- [Recyclarr Notifications](https://recyclarr.dev/reference/settings/notifications/) - Verbosity
  levels, Apprise integration
- [Recyclarr Quick Setup Templates](https://recyclarr.dev/guide/guide-configs/) - Template-based
  configuration
- [Configarr GitHub Repository](https://github.com/raydak-labs/configarr) - Container-based sync
  tool with broader Arr support
- [Configarr Documentation](https://configarr.de/) - Configuration, comparison with Recyclarr
- [Configarr Comparison Page](https://configarr.de/docs/comparison/) - Feature comparison table
- [TRaSH Guides - Guide Sync](https://trash-guides.info/Guide-Sync/) - Official feature comparison
  table (Recyclarr vs Configarr vs Notifiarr)
- [Notifiarr TRaSH Integration Wiki](https://notifiarr.wiki/pages/integrations/trash/) - Dashboard
  layout, sync controls, tabs
- [Savvy Guides - Notifiarr TRaSH Integration](https://savvyguides.wiki/settings/notifiarr/TrashGuides.html) -
  Step-by-step UI workflow, profile management
- [Prowlarr Settings - Servarr Wiki](https://wiki.servarr.com/prowlarr/settings) - Indexer sync
  modes (add-remove-only vs full sync)

### DevOps & GitOps Tools

- [ArgoCD Application Details Page Design](https://github.com/argoproj/argo-cd/wiki/Application-details-page-design) -
  UI design specification, resource tree, diff viewer
- [ArgoCD Diff Strategies](https://argo-cd.readthedocs.io/en/stable/user-guide/diff-strategies/) -
  3-way diff, server-side diff
- [ArgoCD Sync Waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/) - Phased
  sync, status indicators
- [ArgoCD Resource Health](https://argo-cd.readthedocs.io/en/stable/operator-manual/health/) -
  Health check patterns, status aggregation
- [ArgoCD v3.1 Enhanced UI](https://www.infoq.com/news/2025/08/argocd-oci-support-new-ui/) - 2025 UI
  improvements
- [ArgoCD Diff Preview Tool](https://github.com/dag-andersen/argocd-diff-preview) - PR-based diff
  rendering
- [Terraform Cloud New Apply UI](https://www.hashicorp.com/en/blog/new-apply-user-interface-for-terraform-cloud) -
  Structured run output, resource-level timeline
- [Terraform Cloud Run States and Stages](https://developer.hashicorp.com/terraform/cloud-docs/run/states) -
  Pipeline stage visualization
- [Atlantis - Terraform Pull Request Automation](https://www.runatlantis.io/) - Plan-as-PR-comment
  workflow
- [Using Atlantis](https://www.runatlantis.io/docs/using-atlantis) - Plan/apply via PR comments
- [FluxCD GitOps Dashboard](https://fluxcd.io/) - Reconciliation monitoring
- [FluxCD Monitoring](https://oneuptime.com/blog/post/2026-01-27-flux-monitoring/view) - Dashboard
  and metrics patterns
- [Flux UI Visualization Discussion](https://github.com/fluxcd/flux2/discussions/1431) - Community
  approaches to sync visualization

### UX Research & Design Systems

- [UX Strategies for Real-Time Dashboards - Smashing Magazine](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/) -
  Visual hierarchy, sparklines, micro-animations, data freshness, cognitive load
- [UI Patterns for Async Workflows - LogRocket](https://blog.logrocket.com/ui-patterns-for-async-workflows-background-jobs-and-data-pipelines) -
  Job lifecycle states, pipeline visualization, microcopy, partial failure
- [Error Message UX - Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-error-feedback) -
  Error categorization, recovery actions
- [Dashboard Design UX Patterns - Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards) -
  Card layouts, visual hierarchy, density management
- [Wizard UI Pattern - Eleken](https://www.eleken.co/blog-posts/wizard-ui-pattern-explained) - When
  to use wizards, step design
- [Wizards: Definition and Design - NNGroup](https://www.nngroup.com/articles/wizards/) -
  Step-by-step pattern, progress indication
- [Toast Notification Best Practices - LogRocket](https://blog.logrocket.com/ux-design/toast-notifications/) -
  When to use toasts vs inline alerts
- [Toast vs Inline Alert Guidelines - Carbon Design System](https://carbondesignsystem.com/patterns/notification-pattern/) -
  Notification type selection
- [Alert Guidelines - Red Hat Design System](https://ux.redhat.com/elements/alert/guidelines/) -
  Alert placement, persistence, severity
- [Notification Pattern - Carbon Design System](https://carbondesignsystem.com/components/notification/usage/) -
  Toast vs inline notification usage
- [Offline Sync & Conflict Resolution Patterns](https://www.sachith.co.uk/offline-sync-conflict-resolution-patterns-architecture-trade%E2%80%91offs-practical-guide-feb-19-2026/) -
  Conflict resolution strategies, hybrid approaches
- [Undo Design Pattern - UI Patterns](https://ui-patterns.com/patterns/undo) - Undo/revert UX
  patterns
- [Progress Trackers and Indicators - UserGuiding](https://userguiding.com/blog/progress-trackers-and-indicators) -
  Determinate vs indeterminate, perceived wait time
- [Audit Log Guide - Infisical](https://medium.com/@tony.infisical/guide-to-building-audit-logs-for-application-software-b0083bb58604) -
  Audit log UI patterns, filtering, pagination
- [Skeleton Loading - Flowbite/Tailwind](https://flowbite.com/docs/components/skeleton/) - Tailwind
  animate-pulse skeleton components

### Accessibility

- [ARIA Progressbar Role - MDN](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/progressbar_role) -
  Progress bar implementation with ARIA
- [Progress Bar with ARIA Live Regions - Level Access](https://labs.levelaccess.com/index.php/Progress_Bar_with_ARIA_Live_Regions) -
  Combining progress bars with live regions
- [WCAG 4.1.3 Status Messages](https://wcag.dock.codes/documentation/wcag413/) - Status message
  compliance requirements
- [Progress Indicator Accessibility Checklist - Atomic A11y](https://www.atomica11y.com/accessible-web/progress/) -
  Comprehensive progress indicator checklist
- [Accessible Status Messages - Orange Guidelines](https://a11y-guidelines.orange.com/en/articles/aria-status-messages/) -
  ARIA live region best practices

### Real-Time Communication

- [SSE vs WebSockets vs Long Polling - 2025 Comparison](https://dev.to/haraf/server-sent-events-sse-vs-websockets-vs-long-polling-whats-best-in-2025-5ep8) -
  Technology comparison and recommendations
- [SSE's Comeback in 2025 - portalZINE](https://portalzine.de/sses-glorious-comeback-why-2025-is-the-year-of-server-sent-events/) -
  Industry trends for SSE adoption
- [Server-Sent Events - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) -
  Implementation reference
- [Real-Time SSE Progress Tracking - Medium](https://itsmegayan.medium.com/webflux-sse-server-send-event-real-time-progress-tracking-with-webflux-sse-and-quartz-jobs-aa85ce437a68) -
  Progress tracking with SSE and job queues

### Diff Visualization Libraries

- [git-diff-view - Universal Diff Component](https://www.blog.brightcoding.dev/2025/12/16/the-ultimate-diff-view-component-one-library-to-rule-react-vue-solid-svelte/) -
  Cross-framework diff rendering (React, Vue, Solid, Svelte)
- [diff2html](https://diff2html.xyz/) - Framework-agnostic diff to HTML renderer
- [Tailwind Diff Component - daisyUI](https://daisyui.com/components/diff/) - Tailwind-native diff
  display
