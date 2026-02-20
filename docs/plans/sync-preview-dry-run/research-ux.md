# UX Research: sync-preview-dry-run

## Executive Summary

The sync preview feature should follow the Terraform plan/apply workflow pattern: generate a complete change plan, present it in a structured diff view organized by instance and entity type, and require explicit confirmation before execution. Research across Terraform Cloud, ArgoCD, AWS CloudFormation, Pulumi, and GitHub PR reviews reveals a strong consensus on key patterns: summary-first information hierarchy (counts at top, details on expand), color-coded change types with non-color-dependent secondary indicators, collapsible sections to manage density, and progressive disclosure from overview to field-level detail. For Praxrr specifically, the multi-instance dimension requires a two-level grouping (instance then entity type) with instance-level badges and per-section expand/collapse, drawing from Spacelift's resource filtering and CloudFormation's property-level before/after table format.

## User Workflows

### Primary Flow: Preview -> Review -> Apply

1. **Initiate Preview**: User clicks "Preview Sync" button on an Arr instance sync page (or on the global sync page for multi-instance). System begins fetching current state from each target Arr instance.
2. **Loading/Progress**: System shows per-instance progress indicators as each instance's state is fetched and diffed. Instances complete independently and results stream in progressively.
3. **Review Summary**: System presents a summary banner: "3 instances scanned: 12 creates, 8 updates, 2 deletes, 45 unchanged". Each instance appears as a collapsible card with its own summary counts.
4. **Drill Into Details**: User expands an instance card to see per-section (Quality Profiles, Custom Formats, Delay Profiles, Media Management, Metadata Profiles) breakdowns. Each section shows entity-level changes.
5. **Inspect Field Diffs**: User expands an individual entity to see field-level before/after values for updates, or the full entity payload for creates.
6. **Confirm and Apply**: User clicks "Apply All Changes" (or selectively applies per-instance). A confirmation step re-states the scope of changes before execution begins.
7. **Execution Progress**: System shows real-time progress as changes are applied, with per-entity success/failure status.
8. **Results**: Final summary showing what was applied, what succeeded, and what failed.

**Confidence**: High -- This flow directly mirrors Terraform Cloud's plan/apply workflow, CloudFormation's change set review/execute pattern, and Pulumi's preview/up sequence. All three are proven at scale with similar "preview then confirm" UX.

### Alternative Flows

- **Selective Apply**: User reviews the full preview, then unchecks specific entities or entire instances they do not want to apply. System applies only the selected changes. This follows Spacelift's "targeted replan" pattern where users select specific resources from the plan output. The UI uses checkboxes at both the instance level (select/deselect all for an instance) and entity level, with a tri-state parent checkbox (PatternFly bulk selection pattern) when partial selection exists.

- **Cancel/Discard**: User clicks "Cancel" or navigates away. Preview state is discarded (ephemeral, no persistence needed). If the user has spent significant time reviewing (staleness concern), the system warns that the preview will be lost. No undo needed since no writes have occurred.

- **Re-Preview After Changes**: User reviews the preview, notices something unexpected, navigates to PCD/database settings to adjust configuration, then returns and clicks "Preview Sync" again to generate a fresh preview. The stale preview is automatically replaced.

- **Post-PCD-Update Auto-Preview**: After pulling a PCD database update, instead of auto-syncing, the system generates a preview and presents it to the user. This is the most safety-critical flow: the user explicitly sees and approves upstream changes before they reach Arr instances.

**Confidence**: High -- Selective apply is well-established in Spacelift and CloudFormation. Cancel/discard follows standard web application patterns.

## Diff Visualization Best Practices

### Color Coding Standards

The industry-standard color conventions for infrastructure change visualization are well-established across Terraform, GitHub, ArgoCD, CloudFormation, and Pulumi:

| Change Type | Primary Color | Tailwind Token                     | Symbol | Text Label             |
| ----------- | ------------- | ---------------------------------- | ------ | ---------------------- |
| Create      | Green         | `text-green-600` / `bg-green-50`   | `+`    | "New" or "Create"      |
| Update      | Amber/Yellow  | `text-amber-600` / `bg-amber-50`   | `~`    | "Modified" or "Update" |
| Delete      | Red           | `text-red-600` / `bg-red-50`       | `-`    | "Remove" or "Delete"   |
| No Change   | Gray          | `text-gray-400` / `bg-gray-50`     | `=`    | "Unchanged"            |
| Warning     | Orange        | `text-orange-600` / `bg-orange-50` | `!`    | "Warning"              |

**Critical accessibility requirement**: Per WCAG 2.2 Success Criterion 1.4.1 (Use of Color), color must never be the sole indicator. Every color-coded element must also include at minimum one of: a text label, an icon/shape, or a pattern/border style. The recommended approach is a colored badge containing both an icon and text: `[+ Create]`, `[~ Update]`, `[- Delete]`. This triples the information channel (color + icon + text) and works for color-blind users and screen readers.

**Contrast requirements**: Non-text status indicators require a minimum 3:1 contrast ratio against their background (WCAG 2.2 SC 1.4.11). The green/amber/red palette on white backgrounds meets this requirement at the 600 shade level in Tailwind's default palette.

**Confidence**: High -- Terraform, GitHub, and ArgoCD all use this exact color scheme. WCAG requirements are codified standards, not opinion.

### Information Hierarchy

The proven pattern across all reviewed tools follows a four-level progressive disclosure hierarchy:

**Level 1 -- Global Summary Banner**
A persistent summary bar at the top of the preview page showing aggregate counts across all instances. Terraform Cloud uses a dynamic summary count above the resource list. Pulumi shows a summary line at the bottom of preview output. For Praxrr:

```
Preview Summary: 3 instances | 12 creates | 8 updates | 2 deletes | 45 unchanged
[Apply All Changes] [Cancel]
```

**Level 2 -- Instance Cards**
Each Arr instance is a collapsible card showing instance name, Arr type badge (Radarr/Sonarr/Lidarr), connection status, and per-instance summary counts. Collapsed by default if no changes; expanded by default if changes exist. This follows ArgoCD's application-level grouping where each application shows its own sync status.

**Level 3 -- Section Groups**
Within each instance card, changes are grouped by sync section (Quality Profiles, Custom Formats, Delay Profiles, Media Management, Metadata Profiles). Each section header shows its own create/update/delete counts. This mirrors CloudFormation's resource-type grouping and Spacelift's ability to filter by resource type.

**Level 4 -- Entity Detail / Field Diffs**
Individual entity rows expand to show field-level before/after diffs. This is the CloudFormation property-level changes pattern with Path, Change Type, Before Value, and After Value columns.

**Confidence**: High -- This four-level hierarchy is used by Terraform Cloud (run summary -> resource list -> resource detail -> attribute diffs), CloudFormation (change set summary -> resource changes -> property-level changes), and Pulumi (summary -> resource tree -> diff detail).

### Nested Object Diffs

Quality profiles in Praxrr contain nested structures (format scores within profiles, specifications within custom formats). The recommended approach combines patterns from CloudFormation's property-level changes and GitHub's file diff:

**For flat property changes** (e.g., `cutoff`, `upgradeAllowed`, `minFormatScore`): Display as a simple before/after table:

```
Field              Before    After
---              ------    -----
cutoff             Quality5  Quality7
upgradeAllowed     false     true
minFormatScore     0         25
```

**For collection property changes** (e.g., format scores, quality items): Display as a nested expandable section showing additions, removals, and modifications within the collection:

```
formatItems (3 changes)
  [+] HDR10+        score: 1500
  [~] DV            score: 1000 -> 1200
  [-] x265 (HD)     score: -500 (removed)
```

**For deeply nested objects** (e.g., custom format specifications with nested conditions): Use a dot-path notation inspired by CloudFormation's Path column (e.g., `specifications[0].fields[1].value`) with each leaf change as its own row.

GitHub's approach of showing the diff inline with context lines does not translate well to structured data. Instead, the tree-table approach (used by CloudFormation and JSON diff viewers) works better for configuration objects where the structure is hierarchical rather than linear.

**Confidence**: High -- CloudFormation's property-level diff table and JSON diff viewer conventions are the established patterns for structured data diffs, as opposed to line-based diffs used for code.

### Inline vs. Side-by-Side

For Praxrr's configuration management context, **inline diff is the recommended default** with an option to switch to side-by-side for complex changes:

- **Inline (default)**: Each changed field shows on one line with before -> after values. This is space-efficient, works on mobile/narrow screens, and matches how Terraform and Pulumi display plan output. Most Praxrr changes will be single-value property changes (score updates, boolean toggles) where side-by-side adds visual overhead without clarity.

- **Side-by-side (optional)**: For complex nested objects like full quality profile comparisons, a side-by-side view can help users compare the overall structure. This should be available as a toggle per entity, similar to GitHub's unified/split diff toggle and VS Code's inline/side-by-side diff toggle.

**Confidence**: Medium -- Both approaches are valid. Inline is recommended as default based on the predominantly simple property-level changes in Arr sync, but user testing may reveal preference for side-by-side on specific entity types.

## Multi-Instance Preview UX

### Layout Patterns

**Recommended: Instance-First Grouping with Tabs or Accordion**

The primary organizational axis should be the Arr instance, with entity-type grouping as the secondary axis within each instance. This matches how users think about their infrastructure: "What will happen to my Radarr instance?" rather than "What quality profiles will change across all instances?"

Two viable layout patterns:

**Pattern A -- Accordion Cards (Recommended for Praxrr)**
Each instance is a card that can be expanded/collapsed. All instances are visible at once, with summary counts shown on collapsed cards. This works well for 1-6 instances (typical Praxrr deployment). Advantages: all instance summaries are scannable at a glance, familiar expand/collapse interaction, and natural vertical flow.

```
+--[Radarr - 192.168.1.10]--[3 creates, 2 updates]--[v]--+
|  Quality Profiles (2 changes)                             |
|    [~] HD Bluray + WEB  [expand for details]             |
|    [+] Remux + WEB      [expand for details]             |
|  Custom Formats (3 changes)                               |
|    [+] HDR10+           [expand for details]             |
|    [+] DV               [expand for details]             |
|    [~] x265 (HD)        [expand for details]             |
+-----------------------------------------------------------+

+--[Sonarr - 192.168.1.11]--[1 update]--[>]----------------+
|  (collapsed -- click to expand)                           |
+-----------------------------------------------------------+

+--[Lidarr - 192.168.1.12]--[No changes]--[>]--------------+
|  (collapsed -- no changes, lowest visual weight)          |
+-----------------------------------------------------------+
```

**Pattern B -- Tab Navigation**
Each instance is a tab. Better for many instances (7+) where vertical scrolling becomes excessive. However, loses the "scan all at once" capability.

For Praxrr, Pattern A (accordion cards) is recommended because: most users have 1-4 instances, the scan-all-at-once behavior is critical for cross-instance verification, and the card pattern aligns with Praxrr's existing UI conventions.

**Confidence**: High -- Accordion/card pattern is the dominant approach in multi-target deployment tools (ArgoCD's application cards, Spacelift's stack runs, Kubernetes dashboard resource groups).

### Filtering and Navigation

Users need controls to manage complexity when reviewing many changes:

- **Filter by change type**: Buttons/toggles to show only creates, only updates, only deletes, or only entities with changes (hiding unchanged). Spacelift offers this exact filter by "Change type" in their resource view.
- **Filter by section**: Toggle visibility of specific sync sections (e.g., show only Quality Profiles changes across all instances).
- **Filter by instance**: In a batch preview, toggle which instances are shown (useful if reviewing one instance at a time).
- **Search**: Text search across entity names to quickly find a specific custom format or quality profile.
- **Sort options**: By change type (creates first, then updates, then deletes), by entity name (alphabetical), or by instance.
- **Expand All / Collapse All**: Global controls to expand or collapse all detail sections at once, following the GitHub PR pattern.

**Confidence**: Medium -- Filtering is standard UX. The specific filter categories are tailored to Praxrr's domain and may need adjustment based on real usage patterns.

### Instance Badges and Tags

Each instance card should display identifying information through badges:

- **Arr type badge**: Colored pill badge indicating Radarr (blue), Sonarr (purple), Lidarr (green) -- using distinct hues with adequate contrast.
- **Instance name**: The user-configured name prominently displayed.
- **Connection indicator**: Small dot or icon showing instance reachability (green dot for online, red for unreachable).
- **Database tags**: If the instance syncs from multiple PCD databases, show small tag badges for each database name, allowing users to quickly see the source of changes.

These badges serve as scannable identifiers when reviewing multiple instances, following the badge/tag pattern established in design systems like PatternFly and Carbon.

**Confidence**: High -- Badge-based instance identification is standard in multi-environment dashboards.

## Confirmation UX

### Confirmation Patterns

Research across NNGroup, Terraform, and enterprise design systems suggests a tiered confirmation approach based on the risk level of the changes:

**Tier 1 -- Low Risk (Creates and Minor Updates Only)**
A standard confirmation dialog with a summary and descriptive button labels:

```
Apply 5 changes to Radarr (192.168.1.10)?
  3 new custom formats will be created
  2 quality profiles will be updated

[Apply Changes]  [Cancel]
```

The "Apply Changes" button uses descriptive labeling (not "Yes") per NNGroup guidance. Focus defaults to "Cancel" (the safe option).

**Tier 2 -- Medium Risk (Includes Meaningful Updates)**
Same dialog but with an expanded detail section and a brief pause (button disabled for 2-3 seconds) to force the user to read the summary. The dialog shows a collapsible "View Details" section listing the specific entities and fields that will change.

**Tier 3 -- High Risk (Includes Deletes or Destructive Updates)**
An enhanced confirmation with explicit friction. Display a prominent warning banner listing each destructive change. Require the user to type the instance name (or a confirmation phrase) to proceed, following Terraform's `terraform destroy` pattern and MailChimp's "type DELETE" pattern. NNGroup specifically recommends this "nonstandard action" approach for rare, high-consequence operations.

```
WARNING: This will delete 2 quality profiles from Radarr (192.168.1.10).

Profiles to be deleted:
  - "Ultra-HD" (assigned to 0 media items)
  - "Legacy SD" (assigned to 12 media items -- BLOCKED)

Type "Radarr" to confirm: [________]

[Delete and Apply]  [Cancel]
```

**Selective Apply Pattern**: If the user has unchecked some changes, the confirmation dialog reflects only the selected changes and clearly states what is being skipped: "Applying 3 of 5 changes. 2 changes will be skipped." This follows the partial-selection pattern from PatternFly's bulk selection guidelines.

**Confidence**: High -- Tiered confirmation based on risk is a well-documented pattern (NNGroup, Carbon Design System, PatternFly). The type-to-confirm pattern for destructive actions is proven at Terraform, GitHub (repo deletion), and AWS (resource deletion).

### Warning Levels

A three-tier visual hierarchy for warnings within the preview:

| Level           | Visual Treatment                       | Use Case                                                                          | Icon                   |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------------- | ---------------------- |
| **Info**        | Blue/gray banner, subtle               | Informational notes (e.g., "Lidarr conditions skipped: language, source")         | `(i)` circle-info      |
| **Warning**     | Amber/yellow banner, medium prominence | Potential issues (e.g., "Preview is 5+ minutes old", "Instance has pending sync") | `(!)` triangle-warning |
| **Destructive** | Red banner, high prominence, border    | Deletions, blocked operations, assigned-to-media conflicts                        | `(x)` octagon-alert    |

Each warning level uses the color + icon + text triple-encoding for accessibility. Destructive warnings are never collapsible (always visible). Info and warning banners can be dismissed.

**Confidence**: High -- Three-tier warning hierarchy is standard in enterprise design systems (Carbon, PatternFly, Material Design).

## Performance UX

### Loading and Progress

### Preview Generation

Preview generation involves multiple API calls (one per instance, potentially multiple per section). The recommended approach:

**Step 1 -- Initiate with Optimistic UI**
Immediately transition to the preview page with skeleton/loading state. Show the list of instances that will be previewed with loading spinners.

**Step 2 -- Stream Per-Instance Results**
As each instance's preview completes, replace its loading state with actual results. Instances that complete first are immediately reviewable while others load. This follows the progressive loading pattern from Cloudscape Design System and matches ArgoCD's per-application sync status updates.

```
Radarr (192.168.1.10)    [3 creates, 2 updates]   -- done
Sonarr (192.168.1.11)    [Loading... fetching state]
Lidarr (192.168.1.12)    [ERROR: Connection refused]
```

**Step 3 -- Enable Actions on Partial Completion**
The "Apply" button should be disabled until all instances have completed (or failed). If some instances fail, the user can apply changes for successful instances only, with failed instances clearly marked.

**Progress indicator type**: Use **determinate progress** (not a spinner) when possible. Since the system knows the number of instances and sections, it can show "Previewing instance 2 of 3" or "Fetching Quality Profiles for Radarr...". NNGroup research confirms that progress indicators with status text reduce perceived wait time.

**Confidence**: High -- Progressive/streaming results are the standard approach for multi-target operations (ArgoCD, Kubernetes dashboard, CI/CD pipeline views).

### Staleness Indicators

A preview becomes stale when the underlying state changes after generation. The recommended approach:

**Timestamp Display**: Show "Preview generated at [time]" in a subtle position near the summary banner. Use relative time for recent previews ("Generated 2 minutes ago") and absolute time for older ones ("Generated at 2:15 PM").

**Staleness Warning Threshold**: After a configurable threshold (recommended: 5 minutes), display an amber warning banner: "This preview was generated 8 minutes ago. Remote state may have changed. [Refresh Preview]". This follows the Cloudscape Design System pattern of "Data Freshness Indicator" with color-coded thresholds (green = fresh, yellow = aging, red = stale).

**Hard Staleness Block**: After a longer threshold (recommended: 30 minutes), block the "Apply" action and require a fresh preview. Display: "This preview is too old to apply safely. Please generate a new preview." This prevents users from applying changes based on significantly outdated state.

**Concurrent Activity Warning**: If a sync is currently in-progress for any of the previewed instances, show a warning: "A sync is currently running for [instance]. Preview results may be outdated when it completes."

**ARIA live region**: The staleness timer should update an `aria-live="polite"` region so screen readers announce when a preview transitions from fresh to stale.

**Confidence**: High -- Staleness indicators are standard in dashboard design (Cloudscape, Power BI, Looker). The threshold values are recommendations that should be validated through user testing.

## Error Handling UX

### Error States

| Error                          | User Message                                                                                                         | Visual Treatment                                                    | Recovery Action                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Instance unreachable           | "Cannot connect to [Instance Name] at [host:port]. The instance may be offline or the URL/API key may be incorrect." | Red destructive banner on the instance card                         | "Retry Connection" button; link to instance settings                                    |
| API authentication failure     | "Authentication failed for [Instance Name]. The API key may be invalid or expired."                                  | Red destructive banner                                              | "Check API Key" link to instance settings                                               |
| Partial preview failure        | "[Instance Name] failed. 2 of 3 instances previewed successfully."                                                   | Red banner on failed instance; green/normal on successful instances | "Retry Failed" button to retry only the failed instance; "Apply Successful Only" option |
| PCD cache missing              | "Database '[DB Name]' has not been compiled yet. Changes from this database are excluded from the preview."          | Amber warning banner within the relevant instance card              | "Compile Database" action link                                                          |
| Stale database reference       | "Sync selection references database '[DB Name]' which no longer exists. Skipping."                                   | Amber warning, listed as informational note                         | "Edit Sync Settings" link                                                               |
| Preview timeout                | "Preview generation timed out for [Instance Name]. The instance may be responding slowly."                           | Amber warning banner                                                | "Retry" button with longer timeout option                                               |
| Apply failure (per entity)     | "[Entity Name] failed to apply: [Arr API error message]"                                                             | Red inline indicator on the specific entity row                     | "Retry" button on the failed entity; option to skip and continue                        |
| Apply failure (instance-level) | "Apply failed for [Instance Name]: [error summary]"                                                                  | Red destructive banner replacing the instance card content          | "Retry All Failed" button; link to instance logs                                        |

**Partial Failure Handling**: Following the saga pattern for distributed systems, the apply operation should track what succeeded and what failed. The results view should clearly separate successful operations from failed ones, with the option to retry only the failed operations. This matches the HTTP 207 Multi-Status pattern where individual items in a batch can succeed or fail independently.

**Error message principles** (from Pencil & Paper's error feedback research):

1. State what happened (tie to user's action, not generic "Error occurred")
2. Explain why (appropriate detail level for the audience)
3. Provide a forward path (specific recovery action, not just "try again")

**Confidence**: High -- Error state taxonomy is derived from the technical research document's edge cases. Error message principles follow NNGroup and Pencil & Paper guidelines.

## Competitive Analysis

### Terraform Cloud Plan UI

**What they do well**:

- **Structured Run Output**: Each resource is a clickable row showing resource type, name, and planned action. Expanding a row shows a timeline of stages (plan, apply) with elapsed time. This transforms raw plan output into scannable, navigable UI.
- **Summary counts**: A dynamic summary bar above the resource list shows aggregate create/update/delete counts, updating in real-time as the plan progresses.
- **Resource filtering**: Users can filter resources by action type, provider, or resource address, enabling focused review of large plans.
- **Progressive disclosure**: The default view shows only changed resources. Unchanged resources are hidden behind a "show unchanged" toggle, following Terraform 0.14's concise diff format that hides unchanged attributes.

**What to learn for Praxrr**:

- Adopt the resource-row pattern: each entity (CF, QP) as a clickable row with inline action badge and expand-to-detail behavior.
- Use the summary banner pattern with real-time count updates during preview generation.
- Default to hiding unchanged entities (collapsible "N entities unchanged" row) to reduce cognitive load.

**Confidence**: High -- Based on HashiCorp's published blog posts and documentation about the Structured Run Output and new Apply UI.

### ArgoCD Sync Dashboard

**What they do well**:

- **Live vs. Desired State Comparison**: ArgoCD's core UI concept shows the diff between what is in Git (desired) and what is running (live), which directly maps to Praxrr's PCD (desired) vs. Arr (live) comparison.
- **Multiple diff view modes**: Inline (compact), Split (side-by-side), with toggle between compact and detailed views. The default is inline compact.
- **Resource tree visualization**: Applications show resources in a tree structure with parent-child relationships, allowing users to drill into specific resource groups.
- **Sync status badges**: Each application shows a clear sync status (Synced, OutOfSync, Unknown) with color-coded badges, providing at-a-glance status across many applications.
- **Grouping options**: Resources can be grouped by environment label, cluster, or custom properties, enabling different organizational views.

**What to learn for Praxrr**:

- The "desired vs. live" mental model maps perfectly to "PCD state vs. Arr state". Use this framing in the UI.
- Adopt the compact/detailed view toggle for entity diffs.
- Use sync status badges on instance cards (analogous to application status in ArgoCD).

**Confidence**: High -- Based on ArgoCD documentation on diff strategies, diff customization, and monitoring applications.

### AWS CloudFormation Change Sets

**What they do well**:

- **Property-Level Before/After Table**: The strongest pattern from CloudFormation is the property-level changes view that shows Path, Change Type, Before Value, and After Value in a structured table. This is exactly what Praxrr needs for field-level diffs on quality profiles and custom formats.
- **Color-coded template views**: Before and After template views highlight changes in green (add), blue (modify), and red (remove), with checkboxes to select which changes to highlight.
- **Resource-type filtering**: The changes table can be filtered by resource type (e.g., show only EC2 instances), mapping to Praxrr's section-type filtering (show only Quality Profiles).
- **Nested change set navigation**: For nested stacks, CloudFormation provides "View nested change set" links that navigate to child changes, useful if Praxrr ever needs hierarchical preview (e.g., database -> instance -> section).
- **Change set as a named, reviewable artifact**: Change sets are created, named, and can be reviewed multiple times before execution or deletion. This matches Praxrr's preview-as-ephemeral-artifact approach.

**What to learn for Praxrr**:

- Directly adopt the property-level changes table format for field diffs (Path | Change Type | Before | After).
- Use the checkbox-highlight pattern if implementing a side-by-side view.
- Show "requires recreation" style warnings when an update has cascading effects (e.g., changing a quality profile's qualities might affect media items).

**Confidence**: High -- Based on AWS CloudFormation documentation with detailed UI descriptions of the change set view, property-level changes, and filtering capabilities.

### Pulumi Preview

**What they do well**:

- **Hierarchical tree output**: Resources are displayed in a tree structure showing parent-child relationships, with symbols (`+`, `~`, `+-`) indicating the type of change.
- **Concise diff annotations**: Each resource row shows a bracketed annotation of which properties changed (e.g., `[diff: ~resourceLabels]`), giving a quick summary without expanding.
- **Summary line**: The preview ends with a clear summary: "Resources: ~1 to update, 6 unchanged".
- **Improved accuracy**: Pulumi's improved preview queries providers to determine actual output changes, reducing false positives. This is analogous to Praxrr filtering out zero-score format items that technically exist but represent no meaningful change.

**What to learn for Praxrr**:

- Show which specific fields changed in the entity-level summary row (before requiring expansion), e.g., "HD Bluray + WEB [cutoff, formatScores]".
- Include a global summary count at both top and bottom of the preview.
- Filter out noise (zero-score formatItems, identical nested objects) to reduce false-positive "changes".

**Confidence**: High -- Based on Pulumi's official documentation and blog post on improved preview experience.

### GitHub Pull Request Review

**What they do well**:

- **File tree navigation**: A sidebar file tree lets users jump between changed files, see which files they have reviewed, and filter by extension or ownership.
- **Collapse/expand per file**: Each file diff can be collapsed, and files can be marked as "Viewed" to track review progress.
- **Unified vs. split toggle**: Users can switch between unified (inline) and split (side-by-side) diff views per their preference.
- **Summary statistics**: The PR header shows "+X / -Y" additions/deletions counts and the "Files changed" tab shows the total file count.
- **Review progress tracking**: The "Viewed" checkbox pattern helps users track which parts of a large diff they have reviewed.

**What to learn for Praxrr**:

- The "Viewed" / review-tracking pattern could apply to Praxrr: let users mark individual entities or sections as "reviewed" to track their progress through a large preview.
- The file tree sidebar pattern could become an entity navigation sidebar for large previews.
- Expand/collapse all controls are essential for managing large diffs.

**Confidence**: High -- GitHub's PR review UI is the most widely used diff review interface in the industry.

### Flyway / Prisma Database Migration Tools

**What they do well**:

- **Dry-run as SQL output**: Flyway's dry-run generates the exact SQL that would execute, giving users complete transparency. Prisma Migrate's diff command outputs a human-readable summary or executable SQL script.
- **State comparison**: Both tools compare current database state against desired state (migrations), matching Praxrr's current-vs-desired pattern.
- **Read-only operations**: Both emphasize that the preview/diff operation is purely read-only, building user trust.

**What to learn for Praxrr**:

- Emphasize the read-only nature of the preview in the UI ("This is a preview only. No changes will be made until you click Apply.").
- Consider offering a "raw diff" or "export preview" option for power users who want to share or archive the preview output (e.g., as JSON).

**Confidence**: Medium -- Database migration tools are CLI-focused; their web UI patterns are less developed than infrastructure-as-code tools.

## Recommendations

### Must Have

- **Summary-first information hierarchy**: Global summary banner with aggregate counts, expandable instance cards, expandable section groups, expandable entity detail with field diffs. Four levels of progressive disclosure.
- **Color + icon + text triple-encoding for change types**: Green/`+`/"Create", Amber/`~`/"Update", Red/`-`/"Delete" with all three indicators always present. Never rely on color alone.
- **Property-level before/after table**: CloudFormation's Path | Change Type | Before | After format for field-level diffs on entity updates.
- **Staleness indicator with refresh**: Timestamp display, amber warning after 5 minutes, hard block after 30 minutes. Refresh button always available.
- **Tiered confirmation**: Simple confirm for creates/updates, enhanced friction (type-to-confirm) for deletes/destructive changes.
- **Progressive loading**: Per-instance streaming results with individual loading/success/error states.
- **Instance-first grouping**: Accordion card layout with instance identity badges (Arr type, name, connection status).
- **Error recovery paths**: Every error state has a specific recovery action (retry, edit settings, skip and continue).
- **"No changes" positive state**: Clear, friendly messaging when an instance is already in sync: "All entities are up to date. No changes needed." with a subtle green checkmark. Not an error, not an empty state -- a success state.
- **Read-only emphasis**: Clear indicator that preview is non-destructive: "Preview mode -- no changes will be applied until you confirm."

### Should Have

- **Selective apply with checkboxes**: Per-instance and per-entity checkboxes with tri-state parent selection. Apply only selected changes.
- **Filter by change type**: Toggle buttons to filter visible entities by create/update/delete/unchanged.
- **Search**: Text search across entity names within the preview.
- **Expand All / Collapse All**: Global controls for managing information density.
- **Changed-fields annotation on entity rows**: Show which fields changed in the summary row before expansion (Pulumi pattern: `[cutoff, formatScores]`).
- **Keyboard navigation**: Tab through instance cards, Enter to expand/collapse, arrow keys to navigate within sections. Follows GitHub's PR diff keyboard navigation patterns.
- **ARIA live regions**: Announce preview completion, staleness transitions, and apply progress to screen readers.
- **Review progress tracking**: Optional "mark as reviewed" checkboxes per entity/section for large previews (GitHub "Viewed" pattern).

### Nice to Have

- **Unified/split diff toggle**: Per-entity option to switch between inline and side-by-side comparison for complex updates.
- **Entity navigation sidebar**: A sidebar tree view for large previews (10+ entities) allowing quick jumps to specific entities, inspired by GitHub's file tree.
- **Export preview as JSON**: Allow users to download the full preview payload for archiving, sharing, or programmatic analysis.
- **Diff syntax highlighting**: Syntax highlighting for JSON values in the before/after columns.
- **Animation on apply**: Subtle transition animation as entities move from "pending" to "applied" during execution, providing visual feedback of progress.
- **Comparison with last sync**: Show not just current-vs-desired but also what changed since the last successful sync, adding temporal context.

## Responsive Design Considerations

**Desktop (1024px+)**: Full four-level hierarchy with side-by-side option for field diffs. Instance cards as full-width accordions. Filters and search visible in a toolbar.

**Tablet (768-1023px)**: Same layout but property-level tables may need horizontal scrolling for long values. Entity navigation sidebar collapses to a dropdown.

**Mobile (below 768px)**: Force inline-only diffs (no side-by-side). Instance cards stack vertically. Filters move to a dropdown/sheet. Summary banner becomes sticky and compact. The property-level table switches from multi-column to stacked card format:

```
Field: cutoff
Change: Modified
Before: Quality5
After: Quality7
```

Diffs on mobile are inherently challenging. The priority is the summary view (which entities change, which instances are affected). Detailed field-level diffs should be accessible but not the default mobile experience. A "View on Desktop" prompt can be shown for complex previews.

**Confidence**: Medium -- Mobile diff review is not well-solved by any of the analyzed tools. Terraform Cloud, ArgoCD, and CloudFormation are primarily desktop experiences. The stacked-card approach for mobile is a reasonable adaptation.

## Open Questions

1. **Selective apply granularity**: Should users be able to apply changes at the entity level (individual CFs/QPs) or only at the instance/section level? Entity-level gives maximum control but adds UI complexity and requires the sync pipeline to support partial execution.

2. **Auto-preview on PCD update**: Should the system automatically generate a preview when a PCD database update is pulled, or should the user always explicitly request a preview? Auto-preview improves safety but adds latency to the update flow.

3. **Preview persistence**: Should previews be purely ephemeral (in-memory with TTL per the technical spec) or should users be able to "save" a preview for later review? Persistence adds complexity but enables async review workflows.

4. **Concurrent preview limit**: How many simultaneous previews should the system allow? One per user? One per instance? The technical spec mentions a CONCURRENCY_LIMIT of 3 for parallel instance previews, but should users be able to generate multiple independent previews?

5. **Unchanged entity display**: Should unchanged entities be completely hidden (Terraform approach) or shown in a collapsed "N unchanged" summary section? Complete hiding is cleaner but loses context; the collapsed summary preserves awareness of what is being managed.

6. **Mobile priority**: Given that Praxrr is a server management tool likely used primarily on desktop, how much investment should go into mobile-optimized diff views? A "summary only" mobile view with "view details on desktop" may be sufficient.

## Sources

### Infrastructure-as-Code Tools

- [New Apply User Interface for Terraform Cloud](https://www.hashicorp.com/en/blog/new-apply-user-interface-for-terraform-cloud) - HashiCorp (Terraform Cloud structured run output UI)
- [Terraform 0.14 Concise Diff Format](https://www.hashicorp.com/en/blog/terraform-0-14-adds-a-new-concise-diff-format-to-terraform-plans) - HashiCorp (diff format symbols and color coding)
- [Terraform Plan Diff Viewer](https://fossa.com/resources/devops-tools/terraform-plan-diff-viewer/) - FOSSA (plan visualization tool)
- [Spacelift Terraform Plan UI](https://spacelift.io/blog/terraform-plan) - Spacelift (resource filtering, targeted replans)
- [Improved Pulumi Preview Experience](https://www.pulumi.com/blog/improved-preview-experience/) - Pulumi (hierarchical preview, summary format)
- [Pulumi Preview CLI Reference](https://www.pulumi.com/docs/iac/cli/commands/pulumi_preview/) - Pulumi (output options)
- [Tools to Visualize Your Terraform Plan](https://overmind.tech/resources/terraform-tools/plan-comparisons) - Overmind (plan visualization comparison)
- [Top Terraform UI Tools 2026](https://www.bytebase.com/blog/top-terraform-ui-tools/) - Bytebase

### GitOps and Deployment Tools

- [ArgoCD Diff Strategies](https://argo-cd.readthedocs.io/en/stable/user-guide/diff-strategies/) - ArgoCD (3-way diff, live vs desired)
- [ArgoCD Diff Customization](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/) - ArgoCD (diff display configuration)
- [How to Preview and Diff Your ArgoCD Deployments](https://codefresh.io/blog/argo-cd-preview-diff/) - Codefresh
- [ArgoCD Sync Options](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/) - ArgoCD (dry-run, selective sync)
- [ArgoCD Diffs at Scale](https://engineering.monday.com/argocd-diffs-at-scale/) - monday engineering
- [Argo CD v3.1 Enhanced UI](https://www.infoq.com/news/2025/08/argocd-oci-support-new-ui/) - InfoQ

### AWS CloudFormation

- [View a Change Set for a CloudFormation Stack](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets-view.html) - AWS (property-level changes table, before/after values, color-coded highlights)
- [Update CloudFormation Stacks Using Change Sets](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html) - AWS (change set workflow)
- [CloudFormation ChangeSets Enhanced Change Visibility](https://aws.amazon.com/about-aws/whats-new/2024/04/aws-cloudformation-changesets-enhanced-change-visibility-deployments/) - AWS (2024 property-level improvements)

### Database Migration Tools

- [Flyway Dry Run Reports](https://documentation.red-gate.com/flyway/flyway-cli-and-api/reports/reports-dry-run) - Redgate (dry-run pattern)
- [Prisma Migrate Diff](https://www.prisma.io/docs/orm/prisma-migrate) - Prisma (diff command, read-only comparison)

### Kubernetes Tools

- [kubectl diff](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/) - Kubernetes (YAML diff preview)
- [Helm Diff Plugin](https://oneuptime.com/blog/post/2026-02-09-helm-diff-plugin-preview-changes/view) - OneUptime (preview before upgrade)
- [Ansible Check Mode](https://docs.ansible.com/ansible/2.8/user_guide/playbooks_checkmode.html) - Ansible (dry-run with diff output)

### UX Research and Design Systems

- [Confirmation Dialogs Can Prevent User Errors](https://www.nngroup.com/articles/confirmation-dialog/) - NNGroup (when to use, friction levels, button labeling)
- [A UX Guide to Destructive Actions](https://medium.com/design-bootcamp/a-ux-guide-to-destructive-actions-their-use-cases-and-best-practices-f1d8a9478d03) - Medium/Bootcamp
- [Confirmation Dialogs Without Irritation](https://uxplanet.org/confirmation-dialogs-how-to-design-dialogues-without-irritation-7b4cf2599956) - UX Planet
- [How to Design Destructive Actions That Prevent Data Loss](https://uxmovement.com/buttons/how-to-design-destructive-actions-that-prevent-data-loss/) - UXMovement
- [Error Message UX and Feedback Patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-error-feedback) - Pencil & Paper
- [UX Strategies for Real-Time Dashboards](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/) - Smashing Magazine (data freshness)
- [Loading and Refreshing Patterns](https://cloudscape.design/patterns/general/loading-and-refreshing/) - Cloudscape Design System (timestamps, refresh buttons, staleness)
- [Loading and Progress Indicators](https://uxdesign.cc/loading-progress-indicators-ui-components-series-f4b1fc35339a) - UX Collective
- [Progress Indicators Overview](https://m3.material.io/components/progress-indicators/overview) - Material Design 3
- [PatternFly Bulk Selection](https://www.patternfly.org/patterns/bulk-selection/) - PatternFly (tri-state checkbox, partial selection)
- [PatternFly Modal Guidelines](https://www.patternfly.org/components/modal/design-guidelines/) - PatternFly (confirmation dialog patterns)
- [Carbon Design System Dialog Pattern](https://carbondesignsystem.com/patterns/dialog-pattern/) - Carbon
- [Carbon Empty States Pattern](https://carbondesignsystem.com/patterns/empty-states-pattern/) - Carbon
- [Designing Empty States in Complex Applications](https://www.nngroup.com/articles/empty-state-interface-design/) - NNGroup

### Accessibility

- [Using GitHub Pull Requests with a Screen Reader](https://accessibility.github.com/documentation/guide/pull-requests/) - GitHub (diff accessibility patterns)
- [WCAG 2.2 Specification](https://www.w3.org/TR/WCAG22/) - W3C (SC 1.4.1 Use of Color, SC 1.4.11 Non-text Contrast)
- [Color Contrast Accessibility WCAG Guide](https://www.allaccessible.org/blog/color-contrast-accessibility-wcag-guide-2025) - AllAccessible
- [Understanding Non-text Contrast](https://w3c.github.io/wcag21/understanding/21/non-text-contrast.html) - W3C
- [Designing Destructive Buttons: Balancing Function and Accessibility](https://dubbot.com/dubblog/2025/designing-destructive-buttons-balancing-function-and-accessibility.html) - DubBot

### Diff and Comparison Tools

- [Badges vs. Pills vs. Chips vs. Tags](https://smart-interface-design-patterns.com/articles/badges-chips-tags-pills/) - Smart Interface Design Patterns
- [Data Table Design UX Patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) - Pencil & Paper
- [Checkbox UX Best Practices](https://www.eleken.co/blog-posts/checkbox-ux) - Eleken
