# Lidarr UX Research

## Executive Summary

The main UX challenge is not adding one more dropdown option; it is removing pervasive two-app assumptions so Lidarr feels intentional instead of partially bolted on. Current UI copy, icon maps, toggles, and feature pages repeatedly hardcode Radarr/Sonarr, which will create user mistrust if Lidarr appears inconsistently. A capability-aware UX layer and explicit unsupported-state messaging are the fastest way to ship safely while preserving clarity.

## Core User Workflows

- Happy path
  - Add Lidarr instance from Arr page, test connectivity, save.
  - Configure sync sections (quality/delay/media-management) from instance Sync page.
  - Review library/release data and execute supported operations.
- Recovery/error flow
  - Invalid URL/API key shows actionable errors without losing entered form values.
  - Unsupported features for Lidarr are surfaced as explicit UI state (disabled + reason), not runtime API errors.

## UI and Interaction Patterns

- Replace hardcoded two-item app lists with central app metadata.
  - Current hardcoded examples:
    - `src/routes/arr/components/InstanceForm.svelte`
    - `src/routes/arr/views/CardView.svelte`
    - `src/routes/arr/views/TableView.svelte`
- Generalize binary Radarr/Sonarr toggles to scalable app selection controls.
  - Example: `src/routes/custom-formats/[databaseId]/[id]/conditions/components/ConditionCard.svelte`
- Keep current page IA (Settings, Sync, Library, Rename, Upgrades), but render feature availability by capability.

## Accessibility Considerations

- Do not use color as the only distinction for app type (WCAG 2.2 SC 1.4.1).
  - Source: `https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html`
- Ensure all interactive controls remain keyboard operable (WCAG 2.2 SC 2.1.1).
  - Source: `https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html`
- Ensure status feedback (success/error/unsupported) is programmatically conveyed (WCAG 2.1 SC 4.1.3).
  - Source: `https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html`
- Avoid hover-only action menus; follow ARIA menu button interaction patterns.
  - Source: `https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/`

## Feedback and State Design

- Loading states
  - Reuse current skeleton/table loading patterns in library pages.
- Empty states
  - Distinguish between truly empty Lidarr library and feature not supported.
- Success/error states
  - Keep existing toast + inline validation model for connection tests and saves.
- Unsupported states
  - Introduce consistent “Not available for Lidarr yet” patterns with rationale and next steps.

## UX Risks

- Risk: user perceives Lidarr as broken due hidden capability gaps.
  - Mitigation: explicit capability matrix in UI and per-page gating.
- Risk: binary controls become crowded/inconsistent with a third app.
  - Mitigation: migrate to generalized app selection components.
- Risk: visual inconsistency if logos/colors/tooltips are not extended.
  - Mitigation: centralize app presentation metadata and enforce in shared UI components.
