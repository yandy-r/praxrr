# Custom Formats Rollout Notes

## Applied Advanced Sections

- `custom-formats:general:conditions`
  - Added `AdvancedSection` wrapper in `custom-formats/[databaseId]/components/GeneralForm.svelte` for match-condition workflow entry points.
  - Label: `Conditions`
  - Hint: `Advanced match-condition builder controls.`
  - Field-level assignment:
    - `Open Conditions` action linking to `/custom-formats/{databaseId}/{formatId}/conditions`
    - Guidance text for required/optional/negated and grouped condition composition.

- `custom-formats:general:scoring`
  - Added `AdvancedSection` wrapper in `custom-formats/[databaseId]/components/GeneralForm.svelte` for score application references.
  - Label: `Scoring`
  - Hint: `Score application and weighting controls.`
  - Field-level assignment:
    - `Open Quality Profiles` action linking to `/quality-profiles/{databaseId}`
    - Guidance text explaining scoring/weighting ownership is configured on quality profiles.

- `custom-formats:general:negation-and-groups`
  - Added `AdvancedSection` wrapper in `custom-formats/[databaseId]/components/GeneralForm.svelte` for advanced negation/grouping controls.
  - Label: `Negation and Groups`
  - Hint: `Negation/grouping and nested condition controls.`
  - Field-level assignment:
    - `Configure Condition Groups` action linking to `/custom-formats/{databaseId}/{formatId}/conditions`
    - Guidance text describing negation and nested group workflow.

## Persistence Notes

- `custom-formats/[databaseId]/[id]/general/+page.server.ts` now reads per-user values from `userInterfacePreferencesQueries` for:
  - `custom-formats:general:conditions`
  - `custom-formats:general:scoring`
  - `custom-formats:general:negation-and-groups`
- Defaults remain `basic` for anonymous or missing preference rows.
