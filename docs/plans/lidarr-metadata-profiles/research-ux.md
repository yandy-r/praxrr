# UX Research: Lidarr Metadata Profiles

## Executive Summary

Lidarr metadata profiles are Lidarr-exclusive filters that control which types of music releases (albums, singles, EPs, etc.) are discovered and monitored for artists. They comprise three checkbox groups: Primary Album Types (5 options), Secondary Album Types (12 options), and Release Statuses (4 options). Praxrr should model this feature after its existing quality profile management patterns -- card/table list views, route-based editing with StickyCard headers, dirty tracking, and base/user layer writes -- while introducing a checkbox group component purpose-built for the allow/disallow toggle pattern that metadata profiles require. The feature is Lidarr-only and must not leak into Sonarr/Radarr code paths.

**Confidence**: High -- sourced from Lidarr's official API schema, MusicBrainz type definitions, Lidarr source code, Servarr wiki documentation, and the existing Praxrr codebase.

## Lidarr Metadata Profile Data Model

### API Endpoint

```
GET    /api/v1/metadataprofile          -- List all profiles
GET    /api/v1/metadataprofile/{id}     -- Get single profile
GET    /api/v1/metadataprofile/schema   -- Get schema with all available types
POST   /api/v1/metadataprofile          -- Create profile
PUT    /api/v1/metadataprofile/{id}     -- Update profile
DELETE /api/v1/metadataprofile/{id}     -- Delete profile
```

**Confidence**: High -- confirmed via Lidarr OpenAPI spec, Go SDK (starr), Python SDK (devopsarr/lidarr-py), and Terraform provider documentation.

### JSON Structure

```json
{
  "id": 1,
  "name": "Standard",
  "primaryAlbumTypes": [
    { "albumType": { "id": 0, "name": "Album" }, "allowed": true },
    { "albumType": { "id": 1, "name": "Single" }, "allowed": false },
    { "albumType": { "id": 2, "name": "EP" }, "allowed": false },
    { "albumType": { "id": 3, "name": "Broadcast" }, "allowed": false },
    { "albumType": { "id": 4, "name": "Other" }, "allowed": false }
  ],
  "secondaryAlbumTypes": [
    { "albumType": { "id": 0, "name": "Studio" }, "allowed": true },
    { "albumType": { "id": 1, "name": "Compilation" }, "allowed": false },
    { "albumType": { "id": 2, "name": "Soundtrack" }, "allowed": false },
    { "albumType": { "id": 3, "name": "Spokenword" }, "allowed": false },
    { "albumType": { "id": 4, "name": "Interview" }, "allowed": false },
    { "albumType": { "id": 5, "name": "Audiobook" }, "allowed": false },
    { "albumType": { "id": 6, "name": "Live" }, "allowed": false },
    { "albumType": { "id": 7, "name": "Remix" }, "allowed": false },
    { "albumType": { "id": 8, "name": "DJ-mix" }, "allowed": false },
    { "albumType": { "id": 9, "name": "Mixtape/Street" }, "allowed": false },
    { "albumType": { "id": 10, "name": "Demo" }, "allowed": false },
    { "albumType": { "id": 11, "name": "Field recording" }, "allowed": false }
  ],
  "releaseStatuses": [
    { "releaseStatus": { "id": 0, "name": "Official" }, "allowed": true },
    { "releaseStatus": { "id": 1, "name": "Promotional" }, "allowed": false },
    { "releaseStatus": { "id": 2, "name": "Bootleg" }, "allowed": false },
    { "releaseStatus": { "id": 3, "name": "Pseudo-Release" }, "allowed": false }
  ]
}
```

**Confidence**: High -- structure confirmed via Go SDK (`MetadataProfile` struct in golift.io/starr/lidarr), MusicBrainz Release Group Type documentation, and Configarr YAML mapping. The exact numeric IDs for secondary types beyond Studio/Compilation should be verified against a live Lidarr `/api/v1/metadataprofile/schema` response before implementation.

### Type Enumeration (MusicBrainz-sourced)

| Category           | ID  | Name            | Description                                                 |
| ------------------ | --- | --------------- | ----------------------------------------------------------- |
| **Primary**        | 0   | Album           | Long-play releases with previously unreleased material      |
| **Primary**        | 1   | Single          | Short releases, typically one main song plus extras         |
| **Primary**        | 2   | EP              | Extended play, shorter than a full album                    |
| **Primary**        | 3   | Broadcast       | Episodic content originally broadcast via radio/TV/internet |
| **Primary**        | 4   | Other           | Releases that do not fit other categories                   |
| **Secondary**      | 0   | Studio          | Standard studio recordings                                  |
| **Secondary**      | 1   | Compilation     | Collections from various sources                            |
| **Secondary**      | 2   | Soundtrack      | Musical score to movies, TV, games, etc.                    |
| **Secondary**      | 3   | Spokenword      | Non-music spoken content                                    |
| **Secondary**      | 4   | Interview       | Contains an interview, generally with an artist             |
| **Secondary**      | 5   | Audiobook       | A book read by a narrator without music                     |
| **Secondary**      | 6   | Live            | Material recorded live                                      |
| **Secondary**      | 7   | Remix           | Primarily contains remixed material                         |
| **Secondary**      | 8   | DJ-mix          | Sequence of recordings blended into continuous flow         |
| **Secondary**      | 9   | Mixtape/Street  | Promotional releases, often for new artists                 |
| **Secondary**      | 10  | Demo            | Limited circulation material for reference                  |
| **Secondary**      | 11  | Field recording | Mostly field recordings                                     |
| **Release Status** | 0   | Official        | Official release                                            |
| **Release Status** | 1   | Promotional     | Promotional release                                         |
| **Release Status** | 2   | Bootleg         | Unofficial/unauthorized release                             |
| **Release Status** | 3   | Pseudo-Release  | Not a real release (e.g., different script)                 |

**Confidence**: High -- sourced from MusicBrainz Release Group/Type documentation (https://musicbrainz.org/doc/Release_Group/Type). Lidarr uses MusicBrainz as its metadata backend. The "Audio drama" secondary type exists in MusicBrainz but is NOT present in Lidarr's current metadata profiles.

### Default Profiles in Lidarr

Lidarr ships with two built-in profiles:

1. **Standard** -- Primary: Album (allowed). Secondary: Studio (allowed). Release Status: Official (allowed). All other options disabled.
2. **None** -- All types and statuses allowed. This profile is protected from deletion in tools like Configarr.

**Confidence**: Medium -- "Standard" profile defaults confirmed via Servarr wiki and Configarr documentation. "None" profile confirmed via Configarr's `delete_unmanaged_metadata_profiles` documentation which notes the "None" profile is always protected. Exact "None" profile semantics (whether it truly allows all types) should be verified against a live instance.

### Performance Warning

The Servarr wiki explicitly warns about enabling too many types for prolific artists. Example: Metallica shows ~10 primary album releases under the Standard profile, but enabling EPs and other types can pull 600+ releases, causing significant loading delays. This should influence our UI guidance.

**Confidence**: High -- directly from Servarr wiki documentation at https://wikiold.servarr.com/Lidarr_Settings.

---

## User Workflows

### Primary Flow: Create Metadata Profile

1. **Navigate to metadata profiles**: User clicks "Metadata Profiles" in the navigation sidebar (under a Lidarr-specific section or as a sub-route of the database view).
   - System displays the metadata profile list page with existing profiles in card or table view.

2. **Initiate creation**: User clicks the "+" (Plus) action button in the ActionsBar.
   - System navigates to `/metadata-profiles/{databaseId}/new`.

3. **Enter profile name**: User types a name in the Name field (e.g., "Albums Only", "Everything").
   - System validates uniqueness (case-insensitive) against existing profile names.
   - System enables dirty tracking via the existing `dirty` store.

4. **Configure Primary Album Types**: User sees a checkbox group with all 5 primary types.
   - Each type has a toggle (allowed/disallowed).
   - A "Toggle All" control at the group header enables/disables all at once.
   - Default state for new profiles: Album checked, all others unchecked (matching Lidarr's Standard default).

5. **Configure Secondary Album Types**: User sees a checkbox group with all 12 secondary types.
   - Same toggle pattern as primary types.
   - Default state for new profiles: Studio checked, all others unchecked.

6. **Configure Release Statuses**: User sees a checkbox group with all 4 release statuses.
   - Same toggle pattern.
   - Default state for new profiles: Official checked, all others unchecked.

7. **Save**: User clicks "Create" in the StickyCard header.
   - System validates at least one option is selected across all three groups (see validation rules below).
   - System writes PCD ops (base or user layer depending on permissions).
   - System navigates back to the profile list with a success alert.

### Edit Flow

1. **Select profile**: User clicks a profile card or table row.
   - System navigates to `/metadata-profiles/{databaseId}/{id}`.

2. **Modify settings**: User toggles checkboxes in any of the three groups.
   - Dirty tracking marks the form as modified.
   - Navigation guard (DirtyModal) prevents accidental loss of changes.

3. **Save changes**: User clicks "Save" in the StickyCard header.
   - System validates and writes PCD ops with value guards for conflict detection.
   - System shows success alert and resets dirty state.

### Delete Flow

1. **Initiate delete**: User clicks the "Delete" button in the StickyCard header (edit mode only).
   - System shows a confirmation modal: "Are you sure you want to delete '{name}'? This action cannot be undone."

2. **Confirm deletion**: User clicks "Delete" in the confirmation modal.
   - System checks if the profile is referenced by any sync configurations.
   - If in use: System shows an error alert: "Cannot delete '{name}' because it is assigned to one or more Lidarr instances. Reassign those instances first."
   - If not in use: System writes delete PCD op and navigates back to list with success alert.

### Sync Flow

1. **Assign profile to instance**: In the sync configuration for a Lidarr instance, user selects a metadata profile from a dropdown.
   - Only metadata profiles from the currently active database are shown.

2. **Trigger sync**: Sync runs on schedule or manual trigger.
   - System reads the PCD metadata profile data.
   - System transforms it to Lidarr API format (`primaryAlbumTypes`, `secondaryAlbumTypes`, `releaseStatuses` arrays with `allowed` booleans).
   - System calls `GET /api/v1/metadataprofile` on the target Lidarr instance to check for existing profile with same name.
   - If exists: `PUT /api/v1/metadataprofile/{id}` to update.
   - If not: `POST /api/v1/metadataprofile` to create.

3. **Handle sync errors**: If the Lidarr API returns an error:
   - System logs the error with full context.
   - System marks the sync as failed with the error message.
   - User sees the error state in the sync status UI.

### Clone Flow

1. **Initiate clone**: User clicks the "Clone" button on a profile card/row.
   - System opens the CloneModal (reuse existing `$ui/modal/CloneModal.svelte`).
   - User enters a new name (pre-validated for uniqueness).

2. **Confirm clone**: System creates a new profile with all the same checkbox states.
   - Navigates to the new profile's edit view.

---

## UI/UX Best Practices

### Checkbox Group Management

#### Group Layout Pattern

Each of the three checkbox groups (Primary Types, Secondary Types, Release Statuses) should follow this pattern:

```
+--------------------------------------------------+
| [Section Header]                     [Toggle All] |
| Brief description of what this group controls     |
+--------------------------------------------------+
| [ ] Option 1                                      |
| [x] Option 2                                      |
| [ ] Option 3                                      |
+--------------------------------------------------+
```

- **Section headers** use the existing Praxrr heading style (`text-neutral-900 dark:text-neutral-100`, `font-medium`).
- **Toggle All** uses a tri-state checkbox:
  - All checked: filled checkbox
  - Some checked: indeterminate state (dash icon)
  - None checked: empty checkbox
- **Individual items** use the existing `IconCheckbox` component with `Check` icon, `color="blue"`, `shape="rounded"`.
- **Clickable labels**: The entire row should be clickable, not just the checkbox (matching the quality profile toggle behavior).

#### Recommended Dimensions

- Checkbox items: Full-width rows with 44px minimum touch target height.
- Padding: `p-3` on each row for comfortable spacing.
- Gap: `space-y-1` between items within a group, `space-y-6` between groups.

#### Visual Differentiation Between Groups

- **Primary Types**: Standard blue checkboxes (fewer items, higher importance).
- **Secondary Types**: Standard blue checkboxes (more items, scroll may be needed on mobile).
- **Release Statuses**: Standard blue checkboxes (fewest items).

All three groups use the same visual treatment for consistency. The section headers provide sufficient differentiation without needing color-coding on individual checkboxes.

### Profile List View

Follow the existing quality profile CardView/TableView pattern:

#### Card View

```
+--------------------------------------------------+
| Profile Name                      [Export] [Clone]|
|                                                   |
| [Album] [EP]           <- primary types (labels)  |
| [Studio] [Live]        <- secondary types (labels)|
| [Official]             <- release statuses        |
+--------------------------------------------------+
```

- Show allowed types as `Label` components (reuse `$ui/label/Label.svelte`).
- Primary types: `variant="secondary"` (neutral pills).
- Secondary types: `variant="info"` (blue-tinted pills) -- matching how Lidarr uses `kinds.INFO` for secondary types.
- Release statuses: `variant="success"` (green-tinted pills).
- If more than 3 items in a category, show "+N more" truncation.
- Progressive list loading for large profile counts (reuse `createProgressiveList`).

#### Table View

| Name       | Primary Types          | Secondary Types          | Release Statuses           |
| ---------- | ---------------------- | ------------------------ | -------------------------- |
| Standard   | Album                  | Studio                   | Official                   |
| Everything | Album, Single, EP, ... | Studio, Compilation, ... | Official, Promotional, ... |

- Truncate long type lists with "+N more" in table cells.
- Sortable by name column.

### Profile Detail/Edit View

#### Layout

Use a single-page form layout (no tabs needed -- metadata profiles are simpler than quality profiles):

```
+--------------------------------------------------+
| StickyCard: "Edit Metadata Profile"               |
|                              [Delete] [Save]      |
+--------------------------------------------------+

[Name Input]
[Description Input] (optional, for Praxrr-internal notes)

[Primary Album Types]
  Section header with toggle all
  5 checkbox rows

[Secondary Album Types]
  Section header with toggle all
  12 checkbox rows

[Release Statuses]
  Section header with toggle all
  4 checkbox rows
```

**Rationale**: Unlike quality profiles (which need General/Scoring/Qualities tabs), metadata profiles have a small enough surface area to fit comfortably on a single page. This reduces navigation friction for a 21-checkbox form.

#### Form Fields

1. **Name** -- Required text input. Reuse `FormInput` component. Case-insensitive uniqueness validation.
2. **Description** -- Optional markdown input. Reuse `MarkdownInput` component. For Praxrr-internal notes (not synced to Lidarr, since Lidarr's API has no description field for metadata profiles).
3. **Tags** -- Optional tag input. Reuse `TagInput` component. For organizing profiles in Praxrr.
4. **Primary Album Types** -- Checkbox group (5 items).
5. **Secondary Album Types** -- Checkbox group (12 items).
6. **Release Statuses** -- Checkbox group (4 items).

### Industry Standards

- **Consistent patterns**: Follow the same StickyCard + form + dirty tracking + base/user layer pattern established by quality profiles.
- **Progressive disclosure**: Consider collapsible sections for Secondary Types (12 items) on mobile, but default to expanded since the total item count (21) is manageable.
- **Immediate feedback**: Show a count badge on each section header indicating "N of M allowed" (e.g., "1 of 5 allowed").

### Accessibility (WCAG)

- **Checkbox grouping** (WCAG 1.3.1): Wrap each checkbox group in a `<fieldset>` with a `<legend>` element, or use `role="group"` with `aria-labelledby`. Source: W3C ARIA APG Checkbox Pattern (https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/).
- **Tri-state checkbox** (Toggle All): Use `aria-checked="mixed"` for the indeterminate state. Use `aria-checked="true"` when all are checked, `aria-checked="false"` when none are.
- **Keyboard navigation**: `Space` to toggle checkboxes. `Tab` to move between checkboxes. The existing `IconCheckbox` component already implements `role="checkbox"` and `aria-checked`.
- **Contrast**: Minimum 3:1 contrast ratio for checkbox indicators (WCAG 1.4.11). The existing `IconCheckbox` meets this requirement.
- **Touch targets**: Minimum 44x44px interactive area (WCAG 2.5.5). Make the entire row clickable, not just the checkbox icon.
- **Visible focus indicator**: Ensure keyboard focus ring is visible on checkbox rows.

---

## Error Handling

### Validation Rules

1. **Name required**: Profile name cannot be empty.
2. **Name uniqueness**: Profile name must be unique (case-insensitive) within the database.
3. **At least one primary type**: At least one primary album type must be allowed.
4. **At least one release status**: At least one release status must be allowed.
5. **Secondary types optional**: It is valid to have no secondary types allowed (this means only primary-type-only releases match).

**Confidence**: Medium -- rules 1-2 follow Praxrr conventions. Rules 3-5 are inferred from Lidarr behavior (a profile with no primary types or no release statuses would match nothing). Verify against Lidarr's own validation by testing `POST /api/v1/metadataprofile` with empty arrays.

### Error States

| Error                          | User Message                                                                                            | Recovery Action                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Empty profile name             | "Profile name is required."                                                                             | Focus name input, show inline error                     |
| Duplicate name                 | "A metadata profile with this name already exists."                                                     | Focus name input, show inline error                     |
| No primary types selected      | "At least one primary album type must be allowed."                                                      | Highlight Primary Types section, show inline warning    |
| No release statuses selected   | "At least one release status must be allowed."                                                          | Highlight Release Statuses section, show inline warning |
| Delete profile in use          | "Cannot delete '{name}' because it is assigned to sync configurations. Reassign those instances first." | Close delete modal, show error alert                    |
| Sync API error                 | "Failed to sync metadata profile to {instance}: {error}"                                                | Show error in sync status, allow retry                  |
| Conflict on save (value guard) | "This profile was modified externally. Review the changes and save again."                              | Reload current data, show diff if possible              |
| Network error during save      | "Failed to save: network error. Please try again."                                                      | Keep form state, allow retry                            |

### Preventing User Mistakes

- **Cannot uncheck the last primary type**: When only one primary type is checked and user tries to uncheck it, show an inline warning: "At least one primary type must be allowed." Do NOT silently prevent the toggle -- show feedback.
- **Cannot uncheck the last release status**: Same pattern as primary types.
- **Toggle All to "none" warning**: When user clicks Toggle All to uncheck all in Primary Types or Release Statuses, either prevent it (grayed out when only one remains) or immediately re-check the last item with a warning.

---

## Performance UX

### Loading States

1. **Profile list page**: Use the existing skeleton/loading pattern. Show a neutral card placeholder during data fetch.
2. **Profile edit page**: Show a loading spinner in the main content area while fetching profile data. The StickyCard header should render immediately with the profile name if available from the list page's data.
3. **Save operation**: Disable the Save button and show a spinner icon (reuse `Loader2` from lucide-svelte). Show "Saving..." text.
4. **Delete operation**: Disable the Delete button and show "Deleting..." text with spinner.

### Sync Progress Indicators

- Follow the existing sync status pattern used by quality profiles and delay profiles.
- Show per-instance sync status: pending, syncing, success, failed.
- Show the metadata profile name being synced.

### Optimistic Updates for Checkbox Toggles

- Checkbox toggles should be instant (client-side state update via the `dirty` store).
- No server round-trip for individual toggle changes -- only on Save.
- This matches the existing quality profile behavior where changes are batched and submitted together.

### Pagination/Progressive Loading

- For the profile list view, reuse `createProgressiveList` with `pageSize: 30` (matching quality profiles).
- In practice, users will rarely have more than 5-10 metadata profiles, so pagination is a safeguard, not a primary concern.

---

## Competitive Analysis

### Lidarr Native UI

- **Approach**: Lidarr uses a modal-based editor for metadata profiles. The profile list is displayed as cards within the Settings > Profiles page. Each card shows the profile name and the allowed types as colored labels. Clicking a card opens an `EditMetadataProfileModal` (medium-sized modal).
- **Modal layout**: Name input at the top, followed by three sections: Primary Album Types (via `PrimaryTypeItems` component), Secondary Album Types (via `SecondaryTypeItems` component), and Release Statuses (via `ReleaseStatusItems` component).
- **Visual differentiation**: Primary types use `kinds.DEFAULT` labels, secondary types use `kinds.INFO` labels (matching Lidarr's React component source).
- **Clone support**: Each profile card has a clone button.
- **Delete protection**: Profiles in use cannot be deleted. The save button is disabled in the modal footer with an "in use" indicator.
- **Strengths**:
  - Simple, focused modal. The total number of options (21 checkboxes) fits well in a modal.
  - Clear visual hierarchy with section headings and label differentiation.
  - Clone functionality for quick profile duplication.
- **Weaknesses**:
  - No description/notes field -- users cannot document why a profile is configured a certain way.
  - No toggle-all shortcut -- users must individually check/uncheck each option.
  - No performance warning in the UI about enabling too many types for prolific artists.
  - No indication of how many artists/lists use a given profile (only prevents deletion when in use).
  - Modal-based editing limits space for future enhancements (e.g., testing, preview).

**Confidence**: High -- verified against Lidarr frontend source code (GitHub: Lidarr/Lidarr, develop branch, frontend/src/Settings/Profiles/Metadata/).

### Configarr (Third-Party Configuration Manager)

- **Approach**: YAML-based configuration. Users define metadata profiles in config files with `name`, `primary_types`, `secondary_types`, and `release_statuses` arrays. Only listed types are enabled; unlisted types are disabled.
- **Management features**: `delete_unmanaged_metadata_profiles` flag to auto-remove profiles not in config. The built-in "None" profile is protected.
- **Strengths**: Declarative, version-controllable configuration.
- **Weaknesses**: No GUI -- requires manual YAML editing. No preview of what the profile will match.
- **Lidarr support status**: Marked as "experimental" (added in Configarr v1.19.0 for Lidarr v2).

**Confidence**: High -- sourced from Configarr documentation at https://configarr.de/docs/configuration/experimental-support/.

### Existing Praxrr Quality Profile UI (Baseline)

Based on analysis of the actual Praxrr codebase (`src/routes/quality-profiles/`):

- **Patterns to reuse**:
  - `CardView.svelte` / `TableView.svelte` dual-view pattern with `ViewToggle`.
  - `ActionsBar` with `SearchAction`, `ActionButton` (Plus), and `ViewToggle`.
  - `StickyCard` for page headers with left (title + description) and right (action buttons) slots.
  - `createDataPageStore` for search/filter/view state management.
  - `CloneModal` for profile duplication.
  - `DirtyModal` for unsaved changes warning.
  - `dirty` store (`initEdit`, `initCreate`, `update`, `isDirty`, `current`) for form state tracking.
  - `enhance` form action pattern with loading states and alert feedback.
  - `GeneralForm.svelte` pattern: `FormInput` for name, `MarkdownInput` for description, `TagInput` for tags.
  - Base/user layer selection for PCD writes.
  - Progressive list loading via `createProgressiveList`.
  - `IconCheckbox` component (already used in quality profile qualities page for enable/disable toggles).

- **Patterns to adapt**:
  - Quality profiles use a tabbed layout (General / Scoring / Qualities) -- metadata profiles should use a single-page layout since they are much simpler.
  - Quality profiles have drag-and-drop reordering -- metadata profiles do not need ordering (checkboxes are unordered).
  - Quality profiles have complex group/member management -- metadata profiles just have flat checkbox lists.

- **New components needed**:
  - `CheckboxGroup.svelte` -- A reusable component rendering a labeled group of checkboxes with toggle-all, count badge, and fieldset accessibility.
  - `MetadataProfileForm.svelte` -- Form combining Name + Description + Tags + 3 checkbox groups.

---

## Praxrr-Specific Architecture Considerations

### PCD Integration

Metadata profiles must follow the existing PCD ops pattern:

1. **Table**: `lidarr_metadata_profiles` (Lidarr-scoped, not shared with other Arr apps).
2. **Related tables**:
   - `lidarr_metadata_profile_primary_types` (profile_name, type_name, allowed)
   - `lidarr_metadata_profile_secondary_types` (profile_name, type_name, allowed)
   - `lidarr_metadata_profile_release_statuses` (profile_name, status_name, allowed)
3. **Key column**: `name` (case-insensitive uniqueness).
4. **Entity type for registry**: `lidarr_metadata_profile`.

This follows the established pattern where entity types are prefixed with the Arr app name (e.g., `lidarr_naming`, `lidarr_media_settings`).

### Sync Integration

- **SectionType**: Add `'metadataProfiles'` to the `SectionType` union in `src/lib/server/sync/types.ts`.
- **SectionHandler**: Implement a new handler following the existing pattern in `src/lib/server/sync/qualityProfiles/`.
- **LidarrClient**: Add `getMetadataProfiles()`, `createMetadataProfile()`, `updateMetadataProfile()`, and `deleteMetadataProfile()` methods.
- **Transformer**: Convert PCD format (name + allowed type names) to Lidarr API format (arrays with `{albumType: {id, name}, allowed}` objects).
- **Scope guard**: The sync handler must verify `instance.type === 'lidarr'` before attempting to sync metadata profiles. This is NOT applicable to Radarr/Sonarr/Readarr.

### Cross-Arr Semantic Validation

Per the project's Cross-Arr Semantic Validation Policy:

- [ ] Metadata profiles are verified as Lidarr-only (Radarr and Sonarr have no equivalent concept).
- [ ] No implicit fallback to other Arr types.
- [ ] Entity table uses `lidarr_` prefix to prevent cross-Arr confusion.
- [ ] Sync dispatch resolves by explicit `arr_type = 'lidarr'` check.

### Route Structure

```
/metadata-profiles/                          -- Database selector
/metadata-profiles/{databaseId}/             -- Profile list (card/table view)
/metadata-profiles/{databaseId}/new          -- Create new profile
/metadata-profiles/{databaseId}/{id}         -- Edit existing profile
```

Single-page edit (no tab layout needed), following the pattern of simpler entities rather than the multi-tab quality profile pattern.

---

## Recommendations

### Must Have

1. **Three-section checkbox form**: Primary Types, Secondary Types, and Release Statuses as distinct `<fieldset>` groups with headers, descriptions, and toggle-all controls.
2. **Toggle All per section**: Tri-state checkbox (all/some/none) at the section header level.
3. **Count badges**: Show "N of M allowed" on each section header for at-a-glance status.
4. **Validation**: Prevent saving with zero primary types or zero release statuses. Show clear inline errors.
5. **Dirty tracking**: Reuse the existing `dirty` store to track checkbox changes and warn on navigation.
6. **Card and table list views**: Reuse existing `CardView`/`TableView` pattern with `Label` pills showing allowed types.
7. **Clone support**: Reuse `CloneModal` for profile duplication.
8. **Delete protection**: Prevent deletion of profiles assigned to sync configurations.
9. **Lidarr-only scoping**: Metadata profiles must only appear in Lidarr-related contexts. Do not show in Radarr/Sonarr navigation.
10. **PCD ops integration**: Full base/user layer support with value guards.

### Should Have

1. **Performance warning**: Show an informational note near Primary/Secondary Types: "Enabling many types for prolific artists can significantly increase loading times in Lidarr."
2. **Reusable CheckboxGroup component**: Build a generic `CheckboxGroup.svelte` that can be reused for future similar features.
3. **Description/tags fields**: Allow users to annotate profiles with notes and tags (Praxrr-only, not synced to Lidarr).
4. **Export/import support**: Follow the existing quality profile export pattern for metadata profiles.
5. **Default profile templates**: When creating a new metadata profile, offer preset templates ("Standard Albums", "Everything", "Albums + EPs") to reduce configuration effort.

### Nice to Have

1. **Preview/impact indicator**: Show an estimate of how many releases would match the current profile configuration (would require querying Lidarr's API -- potentially complex).
2. **Bulk operations**: Mass-assign metadata profiles to multiple Lidarr instances at once.
3. **Profile comparison view**: Side-by-side comparison of two metadata profiles to see differences.
4. **Sync diff preview**: Before syncing, show what will change on the Lidarr instance (added/removed types).

---

## Open Questions

1. **Where in navigation?** Should metadata profiles get their own top-level nav item, or be nested under a "Lidarr" section? Consider: quality profiles are shared across Arr apps, but metadata profiles are Lidarr-only. Options:
   - Top-level `/metadata-profiles/` route (consistent with `/quality-profiles/`).
   - Nested under a `/lidarr/metadata-profiles/` route (emphasizes Lidarr-only scope).
   - Under existing `/quality-profiles/` with a tab or section for Lidarr metadata profiles.

2. **Should secondary types be mandatory?** Is it valid to have zero secondary types allowed? If yes, what does that mean in Lidarr (releases with NO secondary type only, or all releases regardless of secondary type)?

3. **Schema endpoint usage**: Should Praxrr fetch the available types from `GET /api/v1/metadataprofile/schema` at sync time to ensure compatibility with the Lidarr instance's version? Or should the types be hardcoded based on MusicBrainz definitions?

4. **"None" profile handling**: Should Praxrr have a concept of a "None" profile that means "allow everything"? Or should users explicitly check all boxes?

5. **Profile assignment to artists**: In Lidarr, metadata profiles are assigned per-artist. Should Praxrr's sync overwrite per-artist assignments, or only manage the profile definitions (leaving assignment to the user in Lidarr)? Recommendation: manage definitions only -- assignment is an artist-level concern.

6. **Audio drama type**: MusicBrainz has an "Audio drama" secondary type that Lidarr may or may not expose. Should Praxrr include it? Verify against a current Lidarr instance's schema endpoint.

---

## Search Queries Executed

1. `Lidarr metadata profiles primary types secondary types release statuses configuration`
2. `Lidarr metadata profile API endpoint settings`
3. `Lidarr UI metadata profile management screenshots`
4. `Lidarr API v1 metadataprofile endpoint schema JSON`
5. `Lidarr metadata profile primary album types list "Album" "Single" "EP" "Broadcast" "Other"`
6. `Lidarr metadata profile secondary types "Studio" "Compilation" "Soundtrack" "Spokenword" complete list`
7. `Configarr Lidarr metadata profile support configuration`
8. `Lidarr source code MetadataProfile PrimaryAlbumType SecondaryAlbumType ReleaseStatus enum`
9. `Lidarr release status values "Official" "Promotional" "Bootleg" "Pseudo-Release"`
10. `Lidarr frontend MetadataProfile React component UI implementation site:github.com/Lidarr`
11. `devopsarr lidarr-go metadataprofile schema primaryAlbumTypes secondaryAlbumTypes releaseStatuses`
12. `checkbox group UX pattern best practices toggle all none accessibility WCAG`
13. `Lidarr EditMetadataProfileModalContent source code`
14. `"metadata profile" Lidarr user experience "all types" "none" default profile workflow`
15. `Lidarr "None" metadata profile default "Standard" profile behavior delete in use`
16. `Lidarr API metadataprofile GET POST PUT DELETE endpoints schema response example`

---

## Sources

- [Servarr Wiki - Lidarr Settings](https://wiki.servarr.com/lidarr/settings) -- Primary documentation for Lidarr settings including metadata profiles.
- [Servarr Wiki (Old) - Lidarr Settings](https://wikiold.servarr.com/Lidarr_Settings) -- Detailed description of metadata profile behavior and performance warnings.
- [MusicBrainz Release Group/Type](https://musicbrainz.org/doc/Release_Group/Type) -- Authoritative source for primary types, secondary types, and their definitions.
- [Lidarr GitHub Repository](https://github.com/Lidarr/Lidarr) -- Frontend source code for MetadataProfile components (React).
- [Lidarr API Docs](https://lidarr.audio/docs/api/) -- OpenAPI specification for Lidarr API endpoints.
- [Go SDK (starr/lidarr)](https://pkg.go.dev/github.com/craigjmidwinter/starr/lidarr) -- MetadataProfile struct definition confirming API schema.
- [Configarr - Experimental Support](https://configarr.de/docs/configuration/experimental-support/) -- Configarr's YAML-based metadata profile management for Lidarr.
- [Terraform Provider (devopsarr/lidarr)](https://registry.terraform.io/providers/devopsarr/lidarr/latest/docs/resources/metadata_profile) -- Terraform resource definition for metadata profiles.
- [W3C ARIA APG - Checkbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/) -- Accessibility best practices for checkbox groups and tri-state checkboxes.
- [W3C WAI - Grouping Controls](https://www.w3.org/WAI/tutorials/forms/grouping/) -- Accessibility guidelines for grouped form controls.
- [Checkbox UX Best Practices (Eleken)](https://www.eleken.co/blog-posts/checkbox-ux) -- UX design patterns for checkbox groups.
- [Lidarr Issue #3731 - Release Statuses](https://github.com/Lidarr/Lidarr/issues/3731) -- Discussion of release status limitations.
- [Lidarr Issue #5400 - Can't Delete Profile](https://github.com/Lidarr/Lidarr/issues/5400) -- Profile deletion constraints and error behavior.
- [Lidarr Issue #2302 - Mass Editor](https://github.com/Lidarr/Lidarr/issues/2302) -- Request for metadata profile mass assignment.
