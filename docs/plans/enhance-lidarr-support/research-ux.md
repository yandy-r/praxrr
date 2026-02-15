# Research: UX

## Executive Summary

UX should preserve current media-management interaction patterns while making the storage-model migration explicit and understandable. The largest risk is silent behavioral differences between legacy and native Lidarr records, so the UI should expose status, migration state, and actionable remediation for mapping failures. Accessibility and feedback quality should be improved during this work, especially for error summaries and asynchronous operations.

## Core User Workflows

- Happy path:
  - Browse media-management list, filter/search, create/edit Lidarr presets, save successfully, and sync using dedicated Lidarr entities.
- Recovery flow:
  - User sees explicit validation/mapping errors, receives clear next-step guidance, and can retry without data ambiguity.
- Migration flow:
  - User can identify legacy rows, trigger conversion, and review migrated/skipped/conflict outcomes.

## UI and Interaction Patterns

- Keep existing list/action patterns (`ActionsBar`, `ViewToggle`, table/card rendering).
- Add badges/filters for record state:
  - `Native Lidarr`
  - `Legacy Sonarr-backed`
  - `Needs Mapping`
- Add migration banner and explicit conversion CTA on legacy detail pages.
- Ensure Lidarr route parity in nested navigation/back behavior.

## Accessibility Considerations

- Announce async status and completion via live regions.
- Keep errors non-color-only and provide persistent inline summaries.
- Ensure modal and tab keyboard behavior remains standards-compliant.
- Move focus to error summary on failed form submit.

## Feedback and State Design

- Loading: action-specific loading labels and section-level placeholders.
- Empty: separate “no data yet” from “filtered no results”.
- Success: include entity family and config name in confirmation.
- Error: classify by validation, mapping, permissions, and unexpected server faults.

## UX Risks

- Risk: operators do not understand legacy vs native behavior.
  - Mitigation: visible status badges and migration-state metadata.
- Risk: mapping failures feel opaque.
  - Mitigation: explicit remediation steps tied to failed fields.
- Risk: parity gaps in route behavior create confusion.
  - Mitigation: audit Lidarr route parity in list/new/edit/detail flows.

## References

- <https://www.nngroup.com/articles/ten-usability-heuristics/>
- <https://www.nngroup.com/articles/visibility-system-status/>
- <https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html>
- <https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html>
- <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
- <https://www.w3.org/WAI/ARIA/apg/patterns/tabs/>
- <https://design-system.service.gov.uk/components/error-summary/>
