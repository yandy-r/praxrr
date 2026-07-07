# Research: UX Patterns & Best Practices — Resolved Config Viewer (Issue #25)

⚠️ **Freshness Note**: Sources span 2023–2026. IaC/GitOps diff-UX conventions (Terraform, ArgoCD) are stable (3+ years); accessibility guidance (WCAG 1.4.1) is a stable standard; self-hosted *arr-ecosystem tool comparisons (Recyclarr, Profilarr, Notifiarr) reflect 2026 state and move quickly — re-verify before implementation if this research is used more than ~6 months from now.

## Executive Summary

Resolved Config Viewer surfaces Praxrr's PCD compilation result (base ops + user ops + overrides → resolved state) and compares it against live Arr instance state. This is structurally the same problem three mature product categories already solve well:

1. **IaC plan review** (Terraform/HCP Terraform) — desired state computed from layered sources, shown before an irreversible apply.
2. **GitOps reconciliation** (ArgoCD) — continuous desired-vs-live diffing with drift/sync status.
3. **Layered settings editors** (VS Code) — per-field provenance (default vs user vs workspace) with visual "modified" indicators and one-click reset.

The winning pattern across all three is the same: **normalize before diffing, categorize into a small status vocabulary (Synced/OutOfSync/Unknown, or Create/Update/Delete/Unchanged), never rely on color alone, and let users progressively disclose from summary → per-entity → per-field**. Praxrr already has a component that implements most of this correctly (`SyncPreviewEntityDiff.svelte`) — the Resolved Config Viewer should extend that component's visual language (icon + label + color per change type, expandable rows, current/desired columns) rather than invent a new one.

The two genuinely new problems Praxrr must solve that none of the reference tools solve well are: **(a) a 3-way view** (base vs user-override vs resolved — not just 2-way desired-vs-live), and **(b) cross-instance comparison** (N-way, not 2-way). Neither Terraform, ArgoCD, Recyclarr, Profilarr, nor Notifiarr does true side-by-side multi-instance resolved-config comparison — this is Praxrr's differentiator per the issue's own research notes, and also the area with the least prior art to borrow from, so it needs the most original design work and the most conservative UX defaults (start with 2 instances, table-first, prove it before scaling to N).

**Confidence**: High — corroborated across independent tool ecosystems (Terraform, ArgoCD, VS Code) and the existing in-repo precedent.

---

## User Workflows

### Primary Flow 1: Entity editor → resolved panel (in-context transparency)

1. User is editing a quality profile / custom format in its normal editor route.
2. A panel or tab ("Resolved") sits alongside the edit form, not blocking it — mirrors VS Code's Settings editor, where the "modified" indicator and reset action live *inline* with each field rather than in a separate page.
3. Panel shows: final resolved value per field, with a provenance chip (`base` / `user override` / `default`) next to any field that isn't base-only — this is the VS Code pattern (colored bar = modified; hover reveals gear icon → "Reset Setting") adapted to entity-level granularity.
4. User can toggle "base only / user overrides / resolved" without leaving the editor (segmented control, not a route change — content changes, not navigation, per segmented-control usage guidance).
5. Clicking a user-override field jumps to (or highlights) the editor field that produced it — closes the loop between "what changed" and "where do I change it back."

**Why this ordering**: Editing and inspecting resolved state are the same mental task ("what will this actually do"), so co-locating them avoids a context switch. This mirrors the design considerations in issue #25 itself ("could be a page or a panel within entity editors") and VS Code's inline-modified-indicator precedent.

**Confidence**: High — directly supported by VS Code settings UX precedent and the issue's own design considerations. [VS Code settings docs](https://code.visualstudio.com/docs/getstarted/settings), [DEV: All-new VSCode Settings Editor UI](https://dev.to/vscode/all-new-vscode-settings-editor-ui-----3j48)

### Primary Flow 2: Global resolved-config viewer page → pick entity → compare instances

1. User lands on a dedicated `/resolved-config` (or similar) page — entry point for users who don't yet know *which* entity is misbehaving (debugging-first, not editing-first).
2. Entity picker (search + type filter: quality profile / custom format / release profile) — reuse existing `SourceFilterAction.svelte` / `SearchAction.svelte` patterns already in `packages/praxrr-app/src/lib/client/ui/actions/`.
3. Selecting an entity shows the resolved view (tree or table, see UI/UX section) with the layer-breakdown segmented control front and center.
4. An "Add instance to compare" affordance turns the single view into a side-by-side N-column comparison (cap visible columns; overflow to a picker/dropdown beyond 3-4 instances — mirrors data-table horizontal-scan guidance and avoids the "many segments" anti-pattern segmented controls warn against).
5. Each instance column header shows: instance name, connection status dot, last-synced timestamp — directly answers "is this comparison even valid right now."

**Why this ordering**: Matches ArgoCD's pattern of Application list → drill into one app → Diff tab — start broad, narrow to one entity, then widen again (across instances) only once the user has a concrete target.

**Confidence**: High — ArgoCD's UI navigation (App list → resource diff tab) is a proven analog for "pick target, then diff." [ArgoCD diff strategies](https://argo-cd.readthedocs.io/en/stable/user-guide/diff-strategies/), [DeepWiki: State Comparison and Diff Engine](https://deepwiki.com/argoproj/argo-cd/3.3-state-comparison-and-diff-engine)

### Primary Flow 3: Debugging a bad sync via diff (desired vs actual)

1. Entry point is almost always reactive — user notices unexpected behavior on the Arr instance, or a sync job reports unexpected changes.
2. From the sync history / job result, a "View resolved diff" link jumps straight into the resolved-vs-live comparison for the affected entity, pre-scoped to the instance that ran the sync — avoid making the user re-navigate and re-pick.
3. Default view is **Resolved (desired) vs Actual (live)**, not base-vs-user — this is the debugging-relevant comparison, matching ArgoCD's default "Diff" tab which shows live vs desired, not a breakdown of Git commit layers.
4. If the diff reveals unexpected desired state (not a sync bug but a PCD authoring bug), a one-click pivot to "layer breakdown" explains *why* — did a user override introduce this, or is it in the base ops. This is the transparency payoff the issue calls out ("resolved view shows exactly what Praxrr was trying to apply").
5. Terminal state: either "convergent" (no diff — false alarm, likely user misread something else) or a field-level diff table identical in shape to the existing `SyncPreviewEntityDiff.svelte` (Field / Change type / Current / Desired columns).

**Why this ordering**: This flow is time-pressured and anxiety-driven (something broke). Best practice for error/debugging flows is to minimize navigation depth and preserve context (arrive pre-scoped), consistent with error-state guidance to "place the error message close to its origin" and preserve enough context that users can act without re-orienting.

**Confidence**: High — this reuses an existing in-repo component contract (`SyncPreviewFieldChangeType`, `EntityChange`) and directly matches ArgoCD's default drill-in behavior, so the pattern is doubly validated (industry + codebase precedent).

### Alternative Flow: Empty state (no user overrides yet)

For entities where `user ops` is empty, the "user overrides" segment of the layer toggle must not silently show a blank pane with no explanation. Apply the empty-state pattern (message + context + optional action): *"No user overrides for this entity — resolved state is identical to base."* with a CTA-less but clearly stated reason (informational empty state, not action-oriented — there's nothing actionable to prompt here since overrides are created via the editor, not this viewer). Avoid a generic "No data" — that violates the "avoid lazy placeholder text" guidance and would read like a bug rather than a fact about the entity's state.

**Confidence**: Medium — general empty-state best practice is well established, but its specific application to "layer has legitimately zero content" (as opposed to "loading failed" or "no results from filter") is my inference, not sourced from a tool that solves this exact case.

---

## UI/UX Best Practices

### Layered-config visualization patterns (industry survey)

| Tool | Pattern | Applicability to Praxrr |
|---|---|---|
| **Terraform plan** | Symbol + color per action (`+`/green=create, `~`/yellow=update, `-`/red=destroy); concise diff hides unchanged fields by default, shows counts of hidden unchanged blocks in low-contrast text; `-json` flag for machine-readable output that GUIs build on top of | Directly maps to Praxrr's ops model (create/update/delete). Adopt "hide unchanged, show count" for large entities (e.g., 40-field custom format where 2 fields changed) — Praxrr's existing `SyncPreviewEntityDiff` already collapses to a "N field changes" summary before expansion, which is the right instinct; extend it with a muted "N unchanged fields (show)" affordance inside the expanded view too. [Terraform 0.14 concise diff](https://www.hashicorp.com/en/blog/terraform-0-14-adds-a-new-concise-diff-format-to-terraform-plans), [HashiCorp plan docs](https://developer.hashicorp.com/terraform/cli/commands/plan) |
| **HCP Terraform Cloud runs** | Plan is generated, then requires explicit "Confirm & Apply" or "Discard"; workspace locks during review so the reviewed plan can't drift before apply; VCS-linked runs post a status/diff link directly on the PR | For Praxrr's sync flow (adjacent issue #7, Sync Preview): the *reviewed* resolved state should be the *applied* state — don't silently recompute between preview and apply. Not core to the viewer itself but a dependency to flag. [HCP Terraform run UI](https://www.terraform.io/cloud-docs/run/ui) |
| **ArgoCD** | Normalizes both sides (strips server-managed fields, ignores controller-added annotations) before diffing; structured (parsed) comparison, not string diff; 3-state status vocabulary (Synced / OutOfSync / Unknown); side-by-side Diff tab per resource | Praxrr must normalize live Arr API responses the same way (e.g., Arr-assigned `id`, timestamps, or fields Praxrr doesn't manage) before diffing against resolved state, or every comparison will show phantom noise. This is a **must-have architectural requirement**, not just a UI nicety — an un-normalized diff will erode user trust in the feature within the first session. [ArgoCD diffing customization](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/), [OneUptime: ArgoCD live vs desired](https://oneuptime.com/blog/post/2026-02-26-argocd-live-state-vs-desired-state/view) |
| **VS Code Settings** | Colored left-bar on any modified row; gear icon on hover → context menu ("Reset Setting", copy JSON, copy setting ID); global `@modified` search filter to audit *all* deviations from default at once | Directly reusable for the "user overrides" layer: a global filter/view of "show me every entity with a user override, repo-wide" would be a natural companion feature (possibly out of scope for #25 but worth flagging as a fast-follow). [VS Code settings docs](https://code.visualstudio.com/docs/getstarted/settings) |
| **k9s (Xray)** | Terminal tree view for parent→child resource chains (Deployment→ReplicaSet→Pod), visually indicating which link in the chain is broken; separate flat table view with configurable columns | Validates tree-for-hierarchy / table-for-siblings split (see next section). Less directly applicable since k9s is TUI, but the Xray "highlight the broken link" concept maps to highlighting which layer (base/user/resolved) diverges from live. [k9s docs](https://k9scli.io/) |
| **GitHub PR diff** | Unified diff is default; `+`/`-` line prefixes are the *primary* signal, color is reinforcement, not sole signal; official colorblind theme (blue/orange) shipped in Settings → Appearance | Confirms the existing Praxrr pattern (icon glyphs `+ ~ - =` alongside color pills in `SyncPreviewEntityDiff.svelte`) is already accessibility-aligned — extend, don't replace. [GitHub colorblind themes changelog](https://github.blog/changelog/2021-09-29-colorblind-themes-beta/) |

### Tree vs. table for nested config

- **Tree view**: correct default for entities with genuine multi-level nesting (e.g., custom format → condition groups → conditions), where relationships matter more than side-by-side scanning. Expand-only-the-relevant-branch reduces noise. [UX Patterns for Developers: Tree View](https://uxpatterns.dev/patterns/data-display/tree-view), [Retool: Designing a UI for Tree Data](https://retool.com/blog/designing-a-ui-for-tree-data)
- **Table view**: correct for flat/sibling comparisons — e.g., "all fields of this quality profile," or "this custom format's conditions as rows." Also the *only* sane layout for cross-instance comparison (each instance = a column).
- **Hybrid tree-table**: works only for 2-level hierarchies with homogeneous fields per node; explicitly degrades beyond that (cited limitation: "harder to see the hierarchy," "diverse attributes break it"). Praxrr's entities (custom format conditions, quality profile items) are mostly 2-level — a hybrid expandable table (which is what `ExpandableTable.svelte` / `SyncPreviewEntityDiff.svelte` already implement) is appropriate; do not build a generic N-level tree unless a specific entity type demands it. [Hagan Rivers: Interaction Design for Trees](https://medium.com/@hagan.rivers/interaction-design-for-trees-5e915b408ed2)
- **Recommendation**: default to table (row-per-field) for the single-entity resolved view, matching the existing `SyncPreviewEntityDiff` field table; reserve tree-style expansion only for genuinely nested sub-structures (condition groups). For cross-instance comparison, table is not optional — it's the only layout that scales to N instances.

**Confidence**: High — consistent across three independent sources (UX Patterns for Developers, Retool, Carbon Design System) plus existing in-repo precedent already using the table approach successfully.

### Toggle/segmented-control pattern for layer switching

- Base/User Overrides/Resolved is a textbook segmented-control use case: 3 mutually exclusive, equally-weighted views of the *same underlying entity* (not navigation to different content) — exactly the "SaaS dashboard toggling between Table and Card views" reference case. [Mobbin: Segmented Control](https://mobbin.com/glossary/segmented-control), [designsystems.surf: Segmented Control Blueprints](https://designsystems.surf/blueprints/segmented-control)
- Do **not** implement this as tabs — tabs imply separate content areas/navigation; segmented control implies "same content, different lens," which is semantically correct here (it's the same entity, three projections). Praxrr already has a `ViewToggle.svelte` component under `ui/actions/` — reuse/extend it rather than reaching for `navigation/tabs`.
- Placement: directly above the resolved-state panel (proximity to the content it controls) — poor placement (e.g., in a global header, far from the panel) breaks the "spatial relationship" heuristic called out in the segmented-control guidance.
- Cap at 3 segments here — well within the "six or fewer" ceiling; no dropdown fallback needed.

**Confidence**: High — well-established, unambiguous pattern match; low risk of misapplication.

### Accessibility of diff coloring (do not rely on color alone)

- **WCAG 1.4.1 (Use of Color), Level A**: color must never be the *only* means of conveying a state change. This is not optional/nice-to-have — it's a baseline conformance requirement. [W3C: Understanding SC 1.4.1](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html)
- ~8% of men have red-green color blindness — the single most common form — making red=delete/green=create color pairing (used by Terraform, GitHub, and Praxrr's own `SyncPreviewEntityDiff`) specifically risky if color is the *only* signal.
- **Praxrr is already partially compliant**: `SyncPreviewEntityDiff.svelte` pairs each color with a text label ("Create"/"Update"/"Delete"/"Unchanged") *and* a glyph (`+`/`~`/`-`/`=`). This satisfies 1.4.1 today — preserve this triple-redundancy (color + icon + label) in every new resolved-viewer component; do not regress to color-only badges or color-only cell backgrounds for the sake of a denser layout.
- For cross-instance comparison specifically (new surface, not yet built): if a cell-background-only "this instance differs" indicator is used, it must also carry a glyph or text tag — a bare colored cell in an N-column table is the highest-risk pattern in this whole feature for color-only violations, since space pressure in wide tables tempts corner-cutting.
- Recommend: verify final designs in grayscale/simulated colorblindness (e.g., browser devtools vision deficiency emulation) before shipping — this is standard testing guidance across every source reviewed.

**Confidence**: High — WCAG 1.4.1 is a formal, unambiguous standard; the risk pattern (color-only cells in dense comparison tables) is a well-documented, recurring failure mode across cited sources (Prisma docs issue, Gitea issue, GitButler PR).

---

## Error Handling

### Error states table

| Scenario | Trigger | Recommended UX | Source pattern |
|---|---|---|---|
| Instance unreachable during live diff | Arr API times out / connection refused for one instance in a comparison | Per-instance status badge in the column header (not a blocking full-page error); that column shows a clear inline message ("Unreachable — showing last known state as of [timestamp]" or "No cached state available") while *other* instance columns still render normally | Matches "per-widget status badges" partial-failure guidance and multi-service dashboard error-category conventions — don't let one failing dependency block unrelated data |
| Stale data indicator | Live state was fetched >N minutes ago, or resolved cache predates last known PCD change | Persistent, non-modal "Last fetched: 3m ago · Refresh" affordance in each comparison column (stale-while-revalidate UX pattern) — show stale data immediately, mark it visibly stale, refresh in background rather than blocking on a live fetch | stale-while-revalidate pattern; general "freshness metadata visible to consumers" guidance |
| Partial results across instances | 3 of 5 selected instances respond, 2 fail | Render the 3 successful columns immediately; failed columns show inline retry, not a global "comparison failed" error; aggregate banner ("2 of 5 instances unreachable") is supplementary, not a blocker | Partial-failure/multi-service dashboard guidance — treat responses as asynchronous and occasionally partial |
| Empty state — no user overrides | Entity has zero user ops | Informational empty state within the "User Overrides" segment only (not the whole page): explain *why* it's empty ("Resolved state matches base — no user overrides exist for this entity") — no dead-end, no bogus CTA | Empty-state best practice (context + no dead ends); note this differs from an *error* — it's valid data, must not use error styling/red |
| Empty state — no diff (resolved == live) | Sync is fully convergent | Same informational treatment, ideally with a subtle positive/celebratory framing ("In sync — no differences detected") distinct from the neutral "no user overrides" case, so users can tell "nothing to show because it's fine" apart from "nothing to show because you haven't configured anything" | Empty-state taxonomy (informational vs. celebratory) |
| Rate-limited during multi-instance fetch | Arr API 429s during comparison fetch | Do not silently retry with an indistinguishable spinner (this is a documented anti-pattern — cf. Claude Code's silent-retry UX bug where users couldn't tell "frozen" from "working," leading to unnecessary session restarts). Surface retry state explicitly: "Retrying instance X (attempt 2/4, waiting 8s)..." | [Claude Code rate-limit UX issue](https://github.com/anthropics/claude-code/issues/57134) — cited directly as a worked example of what *not* to do |
| Ambiguous/mixed arr_type comparison | User attempts cross-instance compare across incompatible `arr_type` (e.g., Radarr vs Sonarr instance) for an entity that isn't valid on both | Fail fast with an explicit message identifying the incompatible instance and why (not a silent empty diff) — this is a **hard project-level requirement** per this repo's Cross-Arr Semantic Validation Policy, not just a UX nicety | Repo `CLAUDE.md`: "Fail fast on missing, ambiguous, or inferred cross-Arr mappings" |

### Validation / trust patterns

- Every comparison column must show its data's provenance (instance name, last-synced-at, connection status) at all times — never let a user unknowingly compare live data from one instance against 20-minute-stale cached data from another without a visible marker distinguishing the two.
- When "Diff against live" fails entirely (instance totally unreachable, no cache), do not show an empty/blank diff — an empty diff on failure is indistinguishable from "no differences found," which is the single most dangerous ambiguity this feature could introduce (a user could conclude "sync is fine" when actually "we couldn't check"). This must be a distinct, unmistakable state.

**Confidence**: High for the general partial-failure/staleness/rate-limit patterns (multiple independent sources + a concrete real-world regression case). Medium for the specific "empty diff on failure must not resemble empty diff on success" recommendation — this is a reasoned inference from the stakes of the feature (Praxrr issue explicitly frames this as a debugging tool), not a pattern directly lifted from a cited source.

---

## Performance UX

### Loading indicators for multi-instance fetches

- Use **skeleton screens**, not spinners, for the per-instance comparison columns — skeletons preview layout/structure and reduce perceived wait, especially relevant here because the final layout (a table with N field rows) is already known before data arrives. [Onething Design: Skeleton vs Spinners](https://www.onething.design/post/skeleton-screens-vs-loading-spinners)
- Each instance column should resolve **independently** — render columns as their fetches complete rather than waiting for all N instances (progressive/streamed rendering), consistent with the "primary batch: skeleton structure, then progressively more detail" pattern. This is directly analogous to Recyclarr's own preview-mode improvement (added visual separators + instance name in section headers for multi-instance preview output) — validates that *even a CLI tool in this exact problem domain* found per-instance sectioning necessary for readability.
- Rule of thumb from cited UX research: use loading indicators when a fetch is likely to exceed ~3 seconds; below that, avoid indicators entirely (they add more perceived latency than they save) — relevant given Arr API round-trips are typically sub-second per instance but aggregate N-instance fetches could cross this threshold.

### Progressive/streamed results

- Resolved (PCD-cache-only) side of the comparison should render **immediately** — it's already computed and cached per the issue's design notes ("Praxrr's PCD cache is already the resolved state"). Only the "live" (Arr API) side needs a loading state. Do not gate the whole view behind the slower, network-dependent half.
- This gives a natural "desired renders instantly, actual streams in" affordance that itself communicates the desired/actual distinction the issue requires — free UX signal from the architecture.

### Caching + refresh affordances

- Explicit, visible "Refresh" per instance column (not just a global refresh) — since staleness is per-instance (one Arr instance can be slow/down while others are current), a single global refresh button would force an unnecessary full re-fetch when only one instance needs it.
- Timestamp ("Last fetched: Xm ago") always visible — never silent caching. Matches stale-while-revalidate guidance: show cached data immediately, mark its age, refresh in background, swap in when ready without a jarring full reload.

### Rate-limit feedback

- If Arr API rate limits are hit during a multi-instance fetch, surface which instance is throttled and an estimated retry window rather than a generic spinner (see Error Handling table above) — this is the single most-cited concrete anti-pattern found in this research (Claude Code's silent-retry regression), worth treating as a hard requirement, not a suggestion.

**Confidence**: High for skeleton/progressive-loading guidance (multiple corroborating UX sources plus a strong architectural gift in Praxrr's own resolved-cache-is-precomputed design). Medium for exact timing thresholds (3-second rule is a commonly cited heuristic, not a hard measured number for this specific feature).

---

## Competitive Analysis

| Tool | Desired vs Actual UX | Cross-instance / multi-target compare | Layer breakdown (base/override/resolved) | Diff accessibility | Notable gap vs. Praxrr's plan |
|---|---|---|---|---|---|
| **Recyclarr** | CLI-only; `sync --preview` shows a table (action/name/trash-id) per instance, with instance-name headers and visual separators for multi-instance runs added in recent releases | No side-by-side compare — sequential per-instance sections in one CLI output, not a true comparison view | No — score resolution priority (entry → profile override → guide default) exists internally but isn't surfaced as a UI layer toggle; it's YAML-config-driven, not visually inspectable | N/A (terminal text output, no color-blind-specific handling documented) | No web UI at all for this workflow; no persistent "resolved state" view outside of a sync run |
| **Profilarr** | Has a real web UI; "Test" workflow lets users simulate how a quality profile scores/ranks a release and see custom-format condition pass/fail with "match visualization" — closer to a *scoring* preview than a desired-vs-live diff | Sync pushes to multiple instances but no evidence of a cross-instance side-by-side resolved-state comparison view | Not evidenced in available docs — appears to present the built profile directly, not a layered breakdown | Not evidenced | No drift/live-diff view found; strongest at pre-sync simulation, weaker at post-sync verification against live state |
| **Notifiarr** | TRaSH Guides sync feature (paid tier) pushes profile/format updates to Radarr/Sonarr; sync UI shows Profiles/Naming/Formats as tables | Multi-instance ("Starr Apps") configuration exists, but no evidence of side-by-side resolved-config comparison across instances | Not evidenced | Not evidenced | Primarily a notification/monitoring hub with sync as a secondary feature; not designed around config transparency |
| **ArgoCD** | Best-in-class 2-way (desired vs live) diff: normalized structured comparison, 3-state status vocabulary, per-resource Diff tab, dry-run preview before sync | No — ArgoCD's unit of comparison is one cluster/Application at a time; no native N-cluster side-by-side resolved-manifest view (closest analog, ApplicationSets, targets *deployment*, not *comparison* UX) | No layer breakdown UI — Git *is* the single source of desired state; no concept of "base vs override" layers in the UI itself (Helm value layering exists but isn't surfaced as a toggle) | Relies on syntax-highlighted structured diff; no explicit colorblind-mode documentation found in these sources | Praxrr's cross-instance comparison is a genuine gap ArgoCD doesn't fill |
| **Terraform / HCP Terraform Cloud** | Best-in-class plan-before-apply UX: concise diff (hides unchanged), symbol+color coding, machine-readable JSON for custom UIs, workspace-lock during review to prevent drift-before-apply | Each workspace is independent; no native cross-workspace side-by-side plan comparison UI (would require external tooling) | No — Terraform state is already fully resolved (no base/override layering concept exposed in plan UI; that layering exists in *module* composition, not surfaced as a runtime toggle) | Color-coded by default; `-no-color` flag exists for accessibility/automation but no colorblind-specific palette documented | Same gap as ArgoCD — no cross-target comparison in the reference tool itself |

### Best-in-class diff UX synthesis

No competitor in the Arr ecosystem (Recyclarr, Profilarr, Notifiarr) has a true desired-vs-actual live diff view *or* cross-instance comparison — this validates the issue's own claim ("No competing tool offers cross-instance comparison of config state"). The best UX patterns to borrow all come from adjacent categories (IaC/GitOps), not direct competitors:

- **From Terraform**: concise diffs (hide-unchanged-with-count), symbol+color redundancy, JSON-first architecture enabling custom UI on top of a stable data contract.
- **From ArgoCD**: normalize-before-diff (critical to avoid noise), 3-state status vocabulary, side-by-side Diff tab as the canonical per-resource view.
- **From VS Code**: per-field modified indicator + reset affordance, global "show me everything overridden" filter.
- **From Recyclarr** (the one *direct* competitor with any relevant precedent): even a CLI tool found it necessary to add per-instance visual separation once multi-instance preview output existed — validates that Praxrr's planned per-instance column/section treatment is not over-engineering, it's a response to a real, already-encountered readability problem in this exact domain.

**Confidence**: High for "no direct competitor solves cross-instance comparison" (consistent across all three Arr-ecosystem tool searches, corroborating the issue's own research notes). Medium for the detailed feature claims about Profilarr/Notifiarr UI specifics, since I could not access live screenshots — claims are based on documentation/wiki text descriptions, not direct UI inspection. Flagged explicitly below as an open question.

---

## Recommendations

### Must have

1. **Triple-redundant change indicators** (color + icon/glyph + text label) on every diff/change surface — extend Praxrr's existing `SyncPreviewEntityDiff.svelte` convention (`+`/`~`/`-`/`=` + colored pill + label) rather than introducing a new visual language. This is a WCAG 1.4.1 conformance requirement, not a preference.
2. **Normalize before diffing** live Arr state against resolved PCD state — strip Arr-managed/non-Praxrr-owned fields before comparison, or the feature will produce phantom noise and lose user trust immediately (ArgoCD's core lesson).
3. **Segmented control** (not tabs) for Base / User Overrides / Resolved — reuse/extend the existing `ViewToggle.svelte` and `Toggle.svelte` components; placed directly above the panel it controls.
4. **Per-instance independent loading and error states** in cross-instance comparison — one unreachable instance must never block or blank out the others. Persistent per-column "last fetched" timestamp and manual refresh.
5. **Unmistakable distinction between "no diff found" and "diff check failed"** — an empty-looking result must never be ambiguous between "everything's fine" and "we couldn't tell." This is the highest-stakes error case for a debugging tool.
6. **Cross-Arr semantic guardrails**: cross-instance comparison must fail fast and explicitly when comparing incompatible `arr_type`s or entity shapes, per this repo's existing Cross-Arr Semantic Validation Policy — not a general UX best practice, but a hard repo-level requirement directly applicable here.
7. **Resolved (desired) side renders instantly** from PCD cache; only the live/Arr side needs a loading state — architectural gift that should shape the UI (don't gate the whole view on network fetches).

### Should have

1. **Skeleton screens**, not spinners, for the live-state columns during multi-instance fetch; progressive/streamed rendering per instance rather than all-or-nothing.
2. **Concise diff by default** — collapse unchanged fields with a count ("12 unchanged fields — show"), matching Terraform 0.14's evolution away from full-resource dumps; Praxrr's existing "N field changes" summary-before-expand pattern is the right foundation, extend it inside the expanded view too.
3. **Explicit rate-limit/retry state messaging** ("Retrying instance X, attempt 2/4...") instead of a silent generic spinner — directly avoid the documented Claude Code anti-pattern.
4. **Jump-to-source links**: from a "user override" field in the resolved view back to the editor field that set it (closes the loop between inspection and action, per Flow 1).
5. **Table-first cross-instance layout**, capped column count with overflow handling beyond ~3-4 instances, rather than an unbounded N-column layout that degrades on smaller screens.

### Nice to have

1. **Global "show all entities with user overrides" filter/view**, analogous to VS Code's `@modified` settings search — a natural fast-follow, not core to #25's scope but flagged for #21 (Transparent Automation) or a future issue.
2. **Celebratory/positive empty state** for "fully in sync" (visually distinct from neutral "no overrides exist") to give users a positive signal, not just absence-of-red.
3. **Grayscale/colorblind-simulation QA pass** before shipping the final visual design, as a lightweight validation step (browser devtools vision-deficiency emulation is sufficient, no special tooling required).

---

## Open Questions

1. **Profilarr/Notifiarr UI specifics are under-verified.** I was unable to retrieve actual screenshots (search-only access); claims about their diff/comparison capabilities are inferred from documentation/wiki prose. **Recommend**: before finalizing IA, someone with direct access should spin up Profilarr and Notifiarr locally (or view their public demo/screenshot galleries) to confirm neither has shipped a cross-instance resolved-config comparison since these sources were indexed — the "no competitor does this" claim is a key part of the value proposition and should be double-checked visually, not just from prose docs. **Confidence**: Low on the specific UI-detail claims; Medium-High on the overall "no direct competitor" conclusion (corroborated by issue #25's own prior research per its cited `research/praxrr-additional-features/` sources).
2. **Exact column cap for cross-instance comparison is undetermined.** Segmented-control/table-scanning guidance suggests keeping visible comparison targets small (3-6), but no source addresses "N-instance resolved-config diff" directly since no reference tool does this. This number should be validated with real Praxrr users' typical instance counts (how many Radarr/Sonarr instances does a typical self-hoster run side-by-side?) rather than assumed from generic UI guidance.
3. **Where does normalization logic live, and who owns the "ignore these fields" list per Arr type?** ArgoCD externalizes this into `resource.customizations` config; Praxrr's Cross-Arr Semantic Validation Policy suggests this must be explicit and `arr_type`-scoped rather than a single shared ignore-list, but the concrete mapping isn't something UX research can determine — this is an architecture/implementation decision that should be resolved before diff-rendering work starts, since it directly determines what the diff table can trust as "real" vs. "noise."
4. **Should the "resolved config viewer" be a standalone page, an editor panel, or both — and does #25 intend a shared component used both ways, or two separate implementations?** The issue text itself leaves this open ("Could be a page or a panel"). This research recommends **both**, unified by one shared component (per Flow 1 vs Flow 2), but confirming that's in scope for this issue (vs. deferring the standalone page to a later phase) is a product decision, not a UX-research finding.
5. **Performance ceiling for "how many instances can be fetched live in parallel before rate-limit becomes the dominant UX problem"** is unknown without real Arr API rate-limit numbers from Praxrr's own `$arr/` client implementation — flagged for the implementation-planning phase, not resolvable via external research.

---

## Sources

- [Terraform 0.14 concise diff format](https://www.hashicorp.com/en/blog/terraform-0-14-adds-a-new-concise-diff-format-to-terraform-plans)
- [Terraform plan command reference](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [GitHub issue: Improving perception of changes when showing diff (hashicorp/terraform #15180)](https://github.com/hashicorp/terraform/issues/15180)
- [HCP Terraform: UI and VCS-driven run workflow](https://www.terraform.io/cloud-docs/run/ui)
- [HCP Terraform: Manage and view runs](https://www.terraform.io/cloud-docs/run/manage)
- [ArgoCD: Diff Strategies](https://argo-cd.readthedocs.io/en/stable/user-guide/diff-strategies/)
- [ArgoCD: Diff Customization](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)
- [DeepWiki: ArgoCD State Comparison and Diff Engine](https://deepwiki.com/argoproj/argo-cd/3.3-state-comparison-and-diff-engine)
- [OneUptime: How ArgoCD Compares Live State vs Desired State](https://oneuptime.com/blog/post/2026-02-26-argocd-live-state-vs-desired-state/view)
- [GitHub Changelog: Colorblind themes beta](https://github.blog/changelog/2021-09-29-colorblind-themes-beta/)
- [GitButler PR #10024: color-blind friendly diff colors](https://github.com/gitbutlerapp/gitbutler/pull/10024)
- [Gitea issue #25680: user preference for diff colorblindness](https://github.com/go-gitea/gitea/issues/25680)
- [k9scli.io](https://k9scli.io/)
- [DeepWiki: k9s Custom Views and View Settings](https://deepwiki.com/derailed/k9s/6.4-custom-views-and-view-settings)
- [VS Code: User and workspace settings](https://code.visualstudio.com/docs/getstarted/settings)
- [DEV Community: All-new VSCode Settings Editor UI](https://dev.to/vscode/all-new-vscode-settings-editor-ui-----3j48)
- [Recyclarr: Quality Profiles reference](https://recyclarr.dev/reference/configuration/quality-profiles/)
- [Recyclarr CHANGELOG](https://github.com/recyclarr/recyclarr/blob/master/CHANGELOG.md)
- [Configarr configuration docs](https://configarr.de/docs/configuration/config-file/)
- [Profilarr GitHub repository](https://github.com/Dictionarry-Hub/profilarr)
- [JellyWatch: Profilarr overview](https://jellywatch.app/blog/profilarr-configuration-management-radarr-sonarr-custom-formats-2026)
- [Notifiarr GitHub repository](https://github.com/Notifiarr/notifiarr)
- [Notifiarr Client Web UI docs](https://notifiarr.wiki/pages/client/gui/)
- [Notifiarr Radarr integration wiki](https://notifiarr.wiki/pages/integrations/radarr/)
- [Mobbin: Segmented Control glossary](https://mobbin.com/glossary/segmented-control)
- [designsystems.surf: Segmented Control Blueprints](https://designsystems.surf/blueprints/segmented-control)
- [Apple HIG: Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)
- [Eleken: Empty state UX examples](https://www.eleken.co/blog-posts/empty-state-ux)
- [Carbon Design System: Empty states pattern](https://carbondesignsystem.com/patterns/empty-states-pattern/)
- [SAP Fiori: Designing for Empty States](https://www.sap.com/design-system/fiori-design-web/v1-96/foundations/best-practices/global-patterns/designing-for-empty-states)
- [Onething Design: Skeleton Screens vs Loading Spinners](https://www.onething.design/post/skeleton-screens-vs-loading-spinners)
- [Carbon Design System: Loading pattern](https://carbondesignsystem.com/patterns/loading-pattern/)
- [Toptal: React Hooks stale-while-revalidate](https://www.toptal.com/react-hooks/stale-while-revalidate)
- [IBM: What Is Stale Data?](https://www.ibm.com/think/topics/stale-data)
- [NamasteDev: API Usage Patterns — Rate Limiting, Retries, Backoff](https://namastedev.com/blog/api-usage-patterns-in-front-end-apps-rate-limiting-retries-and-backoff/)
- [GitHub issue: Claude Code silent retry / 429 UX (anthropics/claude-code #57134)](https://github.com/anthropics/claude-code/issues/57134)
- [UX Patterns for Developers: Tree View](https://uxpatterns.dev/patterns/data-display/tree-view)
- [Retool Blog: Designing a UI for Complex Tree Data](https://retool.com/blog/designing-a-ui-for-tree-data)
- [Hagan Rivers: Interaction Design for Trees](https://medium.com/@hagan.rivers/interaction-design-for-trees-5e915b408ed2)
- [Carbon Design System: Tree view](https://carbondesignsystem.com/components/tree-view/usage/)
- [matklad: Unified Versus Split Diff](https://matklad.github.io/2023/10/23/unified-vs-split-diff.html)
- [Zed Blog: Split Diffs are Here](https://zed.dev/blog/split-diffs)
- [W3C: Understanding SC 1.4.1 (Use of Color)](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html)
- [figr.design: Error State Design Patterns](https://figr.design/blog/error-state-design-patterns)
- [Spacelift docs: Drift detection](https://docs.spacelift.io/concepts/stack/drift-detection)
- [env0: Environment Drift Detection Framework](https://www.env0.com/frameworks/environment-drift-detection-model-maintaining-consistency-across-infrastructure-environments)
- In-repo precedent: `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte`, `packages/praxrr-app/src/lib/client/ui/state/EmptyState.svelte`, `packages/praxrr-app/src/lib/client/ui/toggle/Toggle.svelte`, `packages/praxrr-app/src/lib/server/sync/preview/diff.ts`, `packages/praxrr-app/src/routes/databases/[id]/changes/components/` (QualityProfileDiff.svelte, FieldDiffTable.svelte, ConditionsDiffTable.svelte, OrderedItemsDiff.svelte, TagsDiffTable.svelte, TestsDiffTable.svelte)
- GitHub issue #25 (this repo): [yandy-r/praxrr#25](https://github.com/yandy-r/praxrr/issues/25) and its referenced research corpus (`research/praxrr-additional-features/`)
