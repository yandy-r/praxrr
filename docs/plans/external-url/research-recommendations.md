## Executive Summary

Add an optional `external_url` for Arr instances and use it only for browser-facing "Open in" links on `/arr/{id}/library`. Keep `url` as the canonical server-to-server endpoint for API calls, sync, jobs, and health checks. This preserves current behavior for existing configs, avoids operational regressions in Docker/internal DNS setups, and automatically enables browsable links as soon as users fill `external_url`.

### Recommended Implementation Strategy

1. Extend the Arr instance contract with a nullable `external_url`.

- Add a migration that appends `external_url TEXT` to `arr_instances`.
- Register the migration in `src/lib/server/db/migrations.ts` and update `src/lib/server/db/schema.sql` documentation.
- Update `ArrInstance`, `CreateArrInstanceInput`, and `UpdateArrInstanceInput` in `src/lib/server/db/queries/arrInstances.ts`.

2. Keep strict URL responsibility boundaries.

- Continue using `instance.url` for all Arr API clients (`createArrClient`, library fetch, releases, logs, sync, jobs).
- Use `instance.external_url ?? instance.url` only for UI "Open in" destinations.
- Do not repurpose existing `url`, and do not auto-overwrite one field from the other.

3. Add settings support with backward compatibility.

- Update `src/routes/arr/components/InstanceForm.svelte` to include an optional `External URL` input.
- Thread the field through hidden form payloads and dirty-state init/update.
- Parse and persist it in both `src/routes/arr/new/+page.server.ts` and `src/routes/arr/[id]/settings/+page.server.ts`.
- Validation recommendation: required absolute URL validation for `url`; optional absolute URL validation for `external_url` when present.

4. Centralize link base resolution in library UI.

- In `src/routes/arr/[id]/library/+page.svelte`, derive `browserBaseUrl` once from fallback logic.
- Reuse `browserBaseUrl` for action bar `handleOpen`.
- Reuse `browserBaseUrl` for Radarr row links.
- Reuse `browserBaseUrl` for Sonarr row links.
- Reuse `browserBaseUrl` for Lidarr row links.
- Avoid duplicating fallback expressions at each anchor.

5. Add regression tests where behavior changed.

- Add unit/server tests for create/update actions with `external_url` omitted, set, and cleared.
- Add UI or integration coverage for library link fallback with no `external_url` (uses `url`).
- Add UI or integration coverage for library link fallback with `external_url` present (uses `external_url`).
- Keep Arr-type semantics unchanged (no cross-app behavior coupling).

Tradeoff summary:

- `external_url` in `arr_instances` is simplest and query-friendly, but introduces another URL field users must understand.
- A separate settings table reduces table width but adds avoidable joins and complexity for a small, instance-scoped attribute.

## Phased Rollout Suggestion

Phase 1: Data contract and persistence

- Ship migration + query type updates + create/update action handling.
- Keep UI hidden behind existing flow if needed; no link behavior changes yet.
- Exit criteria: existing instances load unchanged; new field persists safely.

Phase 2: Settings UI exposure

- Add `External URL` field in Arr instance form with clear helper text.
- Keep optional; support empty string -> `NULL` persistence.
- Exit criteria: users can add/edit/remove external URL without touching API connectivity.

Phase 3: Library "Open in" adoption

- Switch `/arr/{id}/library` open destinations to resolved browser URL.
- Validate fallback behavior for all supported Arr types.
- Exit criteria: Docker/internal hostnames no longer break browser opens when external URL exists.

Phase 4: Broader UI consistency (optional)

- Apply same fallback logic to Arr list views (`src/routes/arr/views/TableView.svelte`, `src/routes/arr/views/CardView.svelte`) so all "Open in" actions behave consistently.

## Quick Wins

- Add a tiny shared helper (for example `resolveArrBrowserUrl(instance)`) to prevent repeated fallback code.
- Add form helper copy: `Optional. Used only for browser "Open in" links.`
- Log both `url` and `external_url` presence on save (without secrets) to simplify support debugging.
- Ensure trailing slash normalization is consistent when building links.

## Future Enhancements

- Per-surface URL overrides (for example separate external base for library vs logs) if users need reverse-proxy path differences.
- Reachability preflight for `external_url` from browser context (non-blocking warning only).
- Optional migration utility to suggest `external_url` from known reverse proxy settings.
- Unified "Open in" URL resolver used across library, releases, list cards, and table rows.

### Risk Mitigations

- Regression risk: accidental API traffic to `external_url`.
- Mitigation: enforce and test that all Arr clients still consume `url` only.

- Data quality risk: invalid optional URLs.
- Mitigation: validate format on submit when non-empty; persist `NULL` when blank.

- UX confusion risk: two URL fields with unclear semantics.
- Mitigation: use precise labels and descriptions (`URL` = app connectivity, `External URL` = browser opens).

- Partial rollout risk: inconsistent open behavior across pages.
- Mitigation: define `/arr/{id}/library` as MVP scope, then schedule list-view parity in follow-up.

- Test coverage risk: mocks and fixtures drift after type updates.
- Mitigation: make `external_url` optional/nullable in types and add targeted tests for changed flows only.

## Decision Checklist

- [ ] `external_url` stays optional and nullable in `arr_instances`.
- [ ] `url` remains the only field used for Arr API communication.
- [ ] `/arr/{id}/library` "Open in" actions use `external_url ?? url` fallback.
- [ ] Create/update forms support add/edit/clear for external URL.
- [ ] Validation rules are explicit for required vs optional URL fields.
- [ ] Migration is registered and schema docs are updated.
- [ ] Regression tests cover fallback behavior and no-impact on existing instances.
- [ ] Follow-up scope for Arr list-view open buttons is either accepted or explicitly deferred.
