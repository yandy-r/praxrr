# Analysis Context: API Key Masking

### Executive Summary

API key masking hardens credential handling across settings pages, UI rendering, and logging without changing storage schema. Arr credentials already follow a stronger pattern (query-level masking plus encrypted credential lookup), while TMDB, AI, and Auth keys still leak through `load()` payloads. The implementation should standardize masking at serialization boundaries, fetch full secrets only on explicit reveal/copy actions, and add logger redaction as defense-in-depth.

### Architecture Context

- System Structure: Server-side `+page.server.ts` loaders are the main browser exposure boundary, and `logger.ts` is the global telemetry exposure boundary.
- Data Flow: Current flow leaks plaintext via `load()` return values into `__data.json`; target flow returns masked values plus `has_*` flags and uses on-demand reveal actions for full values.
- Integration Points: `settings/general/+page.server.ts`, `settings/security/+page.server.ts`, settings UI components, `logger.ts`, and Arr logs route client creation.

### Critical Files Reference

- `docs/plans/api-key-masking/shared.md`: canonical project context and target file list.
- `docs/plans/api-key-masking/feature-spec.md`: acceptance goals, masking format, and phased approach.
- `packages/praxrr-app/src/routes/settings/general/+page.server.ts`: TMDB/AI load payloads and action surface.
- `packages/praxrr-app/src/routes/settings/security/+page.server.ts`: auth key load payload and regenerate flow.
- `packages/praxrr-app/src/routes/settings/general/components/types.ts`: shared settings DTO contracts.
- `packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`: TMDB credential display/edit workflow.
- `packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`: AI credential display/edit workflow.
- `packages/praxrr-app/src/routes/settings/security/+page.svelte`: auth key display/copy/reveal UX.
- `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: global log formatting and metadata serialization.
- `packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts`: existing broken empty-key client creation.

### Patterns to Follow

- Pattern: query-level credential masking (`'' AS api_key`) before route serialization.
- Pattern: SvelteKit named form actions with `use:enhance` and structured `fail()` responses.
- Pattern: shared pure utility modules under `$shared/utils` with narrow typed APIs.
- Pattern: security-sensitive tests using `installPatch()` and payload leak assertions.

### Cross-Cutting Concerns

- Security: no plaintext secrets in `load()` payloads, page JSON, or logs.
- Type safety: replace plaintext fields with masked fields and presence booleans consistently.
- UX: keep write-only edit semantics while adding explicit reveal/copy affordances.
- Regression safety: preserve regenerate show-once behavior and Arr credential access behavior.

### Parallelization Opportunities

- Independent work areas:
- Build `maskApiKey()` utility and unit tests.
- Implement logger sanitizer and wire into `logger.ts`.
- Fix Arr logs route client creation bug.
- Coordination hotspots:
- `settings/general/+page.server.ts` and shared settings types must land with UI consumers.
- Security page server and UI changes must align on field names and reveal action contract.

### Implementation Constraints

- No new dependencies required for masking, reveal/copy, or logging redaction.
- Keep masked values out of persistence/update writes.
- Preserve existing auth regenerate behavior (full key returned once by action).
- Keep task scopes narrow enough for safe parallel implementation.

### Planning Recommendations

- Phase 1: foundation (`maskApiKey`, server payload contract updates, Arr logs fix).
- Phase 2: feature wiring (masked display component, reveal actions, settings UI migration, logger sanitizer).
- Phase 3: verification and hardening (payload leak tests, behavior edge cases, accessibility checks).
