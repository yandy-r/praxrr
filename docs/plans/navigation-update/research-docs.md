# Documentation Research: navigation-update

## Architecture Docs

- /docs/ARCHITECTURE.md: Catalogs frontend navigation components (`navbar`, `pageNav`, `bottomNav`, `tabs`), stores, and UI layer expectations that the navigation refactor must honor.
- /docs/plans/navigation-update/research-technical.md: Deep dive into the existing hard-coded nav flows, the stores that animate them, and the proposed registry-driven shell with NavItem/NavShell types plus file-by-file wiring guidance.

## API Docs

- /docs/plans/navigation-update/feature-spec.md: Defines the NavShell data contract, user stories, success criteria, and the optional `navigation_events` table plus `POST /api/v1/navigation/events` telemetry endpoint for future phases.
- /docs/plans/navigation-update/research-external.md: Captures the `navigation_events` DDL/indices, resolver data flow (`+layout.server.ts` → nav registry → nav shell), and sample telemetry payloads that describe how the navigation data/API should behave.

## Development Guides

- /docs/plans/navigation-update/research-ux.md: UX guidance on the two-layer navigation model, scope selector placement, mobile drawer/bottom-bar behavior, semantic landmarks, accessibility considerations, and external references supporting the new layout.
- /docs/plans/navigation-update/research-business.md: Persona-driven requirements, user stories, and business rules (deep-link stability, arr capability gating, redirect preservation) that frame every implementation decision.
- /docs/CONTRIBUTING.md: Coding conventions affecting the nav work (Svelte 5 “no runes”, navigation/dirty store expectations, API extension policy) that any new nav components must follow.

## README Files

- /README.md: Product overview, core feature list (Databases, Arr, Quality Profiles, Media Management, Settings), and getting-started instructions that define the navigation destinations the update must surface.

## Must-Read Documents

- /docs/plans/navigation-update/research-technical.md: Required to understand the current hard-coded structure, the stores involved, the proposed data models, and the server/client flow that needs to change.
- /docs/plans/navigation-update/feature-spec.md: Required for goals, NavShell flow, API/telemetry definitions, and user stories that validate the refactor.
- /docs/plans/navigation-update/research-recommendations.md: Required for the task-level breakdown (registry extraction, section headers, scope awareness) and for knowing which behaviors must be preserved while refactoring.
- /docs/plans/navigation-update/research-ux.md: Required to keep the new navigation accessible, responsive, and aligned with the recommended external patterns.

## Documentation Gaps

- No single document currently maps the registry, feature flags, and nav-shell resolver together—implementers must cross-reference multiple research docs and code to understand the full flow.
- `/docs/api` lacks a standalone entry for the internal `POST /api/v1/navigation/events` endpoint or the nav shell payload, so there’s no canonical API contract outside the feature spec.
- There is no dedicated testing or verification guide that describes how to exercise the navigation shell (mobile drawer, scope changes, mobile vs desktop combos), leaving QA coverage to ad-hoc manual checks.
