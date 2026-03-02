# Quality Profiles Rollout Notes

## Planned Advanced Sections

- `quality-profiles:general:custom-format-scoring`
  - Planned label: `Custom Format Scoring`
  - Planned hint: `Score weighting and per-format scoring rules.`
  - Planned target fields: `minimum_custom_format_score`, `custom_format_scores` (all custom formats and arr-type score overrides).
  - Intended behavior: advanced controls remain grouped with a navigation shortcut to the nested scoring route.

- `quality-profiles:general:upgrade-settings`
  - Planned label: `Upgrade Settings`
  - Planned hint: `Upgrade eligibility and score cutoffs.`
  - Planned target fields: `upgrade_until_score`, `upgrade_score_increment`.
  - Intended behavior: cutoffs and increments are managed in the nested scoring route in a later phase.

- `quality-profiles:general:advanced-thresholds`
  - Planned label: `Advanced Thresholds`
  - Planned hint: `Advanced threshold and priority controls.`
  - Planned target fields: quality-item ordering and upgrade-until boundary controls in the nested qualities route.
  - This section is currently blocked on quality-profile advanced form wiring.

## Persisted State Notes

- Section keys are defined but not yet wired into route data for this rollout.
- Once the quality-profile general route consumes preference state, these keys should use `getUserInterfacePreferenceSectionStore`.
- Initial mode fallback remains `basic`.

## Rollout Edge Cases

- The route does not currently render the scoring/quality edit fields inline in `general`; sections currently provide explicit disclosure and cross-linking to nested routes.
- Create flow (no profile ID) intentionally hides section navigation links while preserving the advanced-section controls and persisted mode state.
