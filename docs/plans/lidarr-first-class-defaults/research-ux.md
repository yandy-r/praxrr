# Lidarr First-Class Defaults - UX Research

## Executive Summary

The default-tier choice should emphasize recognition and error prevention. Using names that start
with `Lidarr -` and end with `(Praxrr)` improves scanability in mixed lists and lowers ambiguity
risk. Users should choose one explicit tier (`Lossless`, `High Quality Lossy`, `Lossy`) with clear
helper text.

## Core User Workflows

- Happy path:
  - User opens Lidarr defaults.
  - Selects one tier from explicit options.
  - Reviews generated Lidarr-only names.
  - Saves and sees clear success summary.
- Recovery/error flow:
  - Save fails due to conflict/validation.
  - User gets error summary + inline fixes without losing input.
  - User corrects and retries.

## UI and Interaction Patterns

- Use radio-group/fieldset for mutually exclusive tier selection.
- Prefer `Lidarr - ... (Praxrr)` naming for list scanning, filtering, and ownership clarity.
- Provide helper text per tier with concrete examples:
  - Lossless: FLAC/ALAC
  - High Quality Lossy: AAC/Opus/MP3 high bitrate
  - Lossy: MP3/AAC standard bitrate

## Accessibility Considerations

- Proper fieldset/legend and explicit labels.
- Keyboard-compliant radio behavior.
- Status/error announcements with accessible patterns.
- Focus management to error summary on validation failure.

## Feedback and State Design

- Loading: determinate when possible during seed/apply jobs.
- Empty: explain no Lidarr defaults yet and provide create action.
- Success: concise outcome including selected tier and affected count.
- Error: preserve inputs and surface actionable field-level corrections.

## UX Risks

- Risk: confusion between old reused defaults and new first-class Lidarr defaults.
  - Mitigation: enforce `Lidarr - ... (Praxrr)` naming and grouped labeling.
- Risk: ambiguous tier boundaries.
  - Mitigation: publish codec/bitrate examples in docs and UI hints.
- Risk: silent fallback to reused defaults.
  - Mitigation: explicit validation and no-fallback behavior.

## Sources

- Accessed on 2026-02-16.
- <https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/>
- <https://www.nngroup.com/articles/ten-usability-heuristics/>
- <https://design-system.service.gov.uk/components/radios/>
- <https://design-system.service.gov.uk/components/error-summary/>
- <https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html>
- <https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html>
- <https://www.w3.org/WAI/ARIA/apg/patterns/radio/>
