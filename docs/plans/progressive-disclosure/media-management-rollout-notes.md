# Media Management Rollout Notes

## Applied Advanced Sections

- `media-management:media-settings:naming`
  - Wrapped `Propers and Repacks` controls.
  - Label: `Naming`
  - Hint: `Rename token controls and naming strategy options.`
- `media-management:media-settings:folder-management`
  - Added an explicit advanced section container for rollout readiness.
  - Label: `Folder Management`
  - Hint: `Folder and organization tuning controls.`
- `media-management:media-settings:importing`
  - Wrapped `Enable Media Info` control.
  - Label: `Importing`
  - Hint: `Import behavior toggles and advanced import rules.`

## Persisted State Notes

- State binding uses `getUserInterfacePreferenceSectionStore` and writes local section mode back to each section store.
- Section keys follow the required route-family mapping above and can persist across route instances.
- Initial section mode comes from store hydration; if no saved value exists, `basic` is the default.

## Rollout Edge Cases

- `media-settings` currently exposes only these persisted controls:
  - `Propers and Repacks` (naming family)
  - `Enable Media Info` (importing family)
- No dedicated folder/organization fields exist in the current form model yet, so `folder-management` is intentionally a placeholder for future controls in this rollout.
- If user-interface preference persistence is unavailable or auth-restricted, `AdvancedSection` still renders with local mode behavior and should degrade gracefully.
