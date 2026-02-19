# Lidarr Support - UX Research

## Executive Summary

Lidarr support UX should prioritize safe configuration changes over raw editing because quality and
scoring decisions are easy to misapply in music workflows. A guided connect-configure-review-apply
flow with strong diffing and validation feedback will reduce error rates and support load.
Accessibility and error-state clarity are critical because network/API and metadata-provider issues
are common in real deployments.

## Core User Workflows

- Happy path flow:
  - Connect Lidarr instance and test connection.
  - Import current Lidarr profile/settings state.
  - Select template/preset and review a structured diff.
  - Apply changes and receive per-item status with summary.
- Recovery/error flow:
  - On failure, preserve draft state.
  - Show actionable root cause (validation issue, connectivity issue, unsupported mapping).
  - Allow retry of only failed items and provide revert-to-last-synced action.

## UI and Interaction Patterns

- Multi-step wizard (`Connect`, `Configure`, `Review & Apply`) for first-run clarity.
- Side-by-side diff table for changed quality/custom-format fields.
- Conflict resolution modal with deterministic choices (`Merge`, `Rename`, `Skip`).
- Progressive disclosure for advanced options to keep baseline workflow simple.
- Mobile-safe controls with explicit selection states and no double-click assumptions.

## Accessibility Considerations

- Maintain WCAG 2.2 contrast requirements for all status badges and text.
- Ensure visible keyboard focus indicators on all interactive elements.
- Provide screen-reader-compatible error summary and inline field associations.
- Use status announcements (live-region style behavior) for long-running sync/apply operations.
- Avoid interactions that require fine pointer precision without keyboard alternatives.

## Feedback and State Design

- Loading states:
  - skeleton/table placeholders and explicit progress messages (`Applying 3/12`).
- Empty states:
  - context-rich CTA prompts (`Connect Lidarr`, `Import profiles`).
- Success states:
  - transient confirmation plus persistent audit entry.
- Error states:
  - summary + inline errors, with retryability classification.

## UX Risks

- Risk: Users misinterpret music-quality/cutoff semantics.
  - Mitigation: inline educational hints and preview examples.
- Risk: Mapping collisions for imported custom formats.
  - Mitigation: explicit pre-apply conflict stage.
- Risk: Upstream metadata/API outages appear as config mistakes.
  - Mitigation: classify upstream vs local validation errors.
- Risk: Mobile interaction mistakes.
  - Mitigation: larger hit targets and explicit selected-state visuals.

## Sources

Accessed on 2026-02-13.

- https://wikijs.servarr.com/lidarr/settings
- https://wikiold.servarr.com/lidarr/settings#quality-profiles
- https://github.com/Lidarr/Lidarr/issues/3059
- https://github.com/Santiagosayshey/Praxrr/issues/178
- https://github.com/Santiagosayshey/Praxrr/issues/290
- https://www.gov.uk/service-manual/design/validation-on-the-client-side
- https://design-system.service.gov.uk/components/error-summary/
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA21.html
- https://atlassian.design/components/empty-state
- https://www.carbondesignsystem.com/components/loading/usage/
- https://wikiold.servarr.com/lidarr/metadata
