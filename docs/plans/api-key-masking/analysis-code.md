# Analysis Code: API Key Masking

### Executive Summary

Credential masking work is concentrated in route loaders, settings UI components, and logger metadata serialization. Existing Arr credential code already demonstrates the intended security boundary model and should be treated as the pattern baseline. The plan should split server contract changes, UI integration, and logger hardening into parallel tracks that converge in verification tasks.

### Related Components

- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`: baseline credential masking pattern.
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`: decrypt-on-demand Arr client factory.
- `packages/praxrr-app/src/routes/settings/general/+page.server.ts`: TMDB/AI load and actions.
- `packages/praxrr-app/src/routes/settings/security/+page.server.ts`: auth load and regenerate action.
- `packages/praxrr-app/src/routes/settings/general/components/types.ts`: settings component data contracts.
- `packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`: TMDB display and edit flow.
- `packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`: AI display and edit flow.
- `packages/praxrr-app/src/routes/settings/security/+page.svelte`: auth display/copy interactions.
- `packages/praxrr-app/src/lib/client/ui/form/FormInput.svelte`: existing private input visibility controls.
- `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: redaction integration point.
- `packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts`: leak-check test pattern.

### Implementation Patterns

**Pattern Name**: Query-level redaction first

- Example: `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`
- Apply to: server route serialization and settings payloads

**Pattern Name**: Named action contracts for interactive secret operations

- Example: `packages/praxrr-app/src/routes/settings/general/+page.server.ts`
- Apply to: reveal and copy server actions

**Pattern Name**: Shared typed utility modules

- Example: `packages/praxrr-app/src/lib/shared/utils/uuid.ts`
- Apply to: `maskApiKey()` and masked-value helpers

**Pattern Name**: Defense-in-depth route and layout handling

- Example: `packages/praxrr-app/src/routes/arr/[id]/+layout.server.ts`
- Apply to: avoid exposing credentials across nested load flows

### Integration Points

#### Files to Create

- `packages/praxrr-app/src/lib/shared/utils/masking.ts`: reusable key masking helpers.
- `packages/praxrr-app/src/lib/server/utils/logger/sanitizer.ts`: metadata redaction logic.
- `packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte`: masked display with reveal/copy controls.
- `packages/praxrr-app/src/tests/base/apiKeyMasking.test.ts`: utility and logger-specific tests.

#### Files to Modify

- `packages/praxrr-app/src/routes/settings/general/+page.server.ts`: return masked key fields and reveal actions.
- `packages/praxrr-app/src/routes/settings/security/+page.server.ts`: return masked auth key fields and reveal action.
- `packages/praxrr-app/src/routes/settings/general/components/types.ts`: update settings interfaces.
- `packages/praxrr-app/src/routes/settings/general/components/TMDBSettings.svelte`: switch to masked display contract.
- `packages/praxrr-app/src/routes/settings/general/components/AISettings.svelte`: switch to masked display contract.
- `packages/praxrr-app/src/routes/settings/general/+page.svelte`: align prop wiring with new contracts.
- `packages/praxrr-app/src/routes/settings/security/+page.svelte`: wire masked display and reveal/copy.
- `packages/praxrr-app/src/lib/server/utils/logger/logger.ts`: invoke sanitizer before serialization.
- `packages/praxrr-app/src/routes/arr/[id]/logs/+page.server.ts`: use decrypted Arr client factory.

### Conventions

- Naming: DB fields remain `snake_case`; component and TS symbols use established project naming.
- Error handling: route actions return typed `fail()` responses and use existing alert patterns.
- Testing: use existing base test helpers and leak-assertion methods for regression coverage.

### Gotchas and Warnings

- `load()` payload changes must be synchronized with consuming Svelte components.
- Reveal and copy operations must fetch full values on demand, not from initial page payloads.
- Masked values must never be reused as real credentials in update actions.
- Logger sanitization must handle nested objects/arrays and unknown metadata types safely.
- Arr logs route must not use masked `instance.api_key` to instantiate clients.

### Task Guidance by Area

- database: no schema migration needed; enforce serialization-layer masking and encrypted Arr path usage.
- api: adjust settings loaders/actions contracts and ensure no plaintext in load return values.
- ui: replace plaintext display with `MaskedApiKey` usage while preserving edit semantics.
