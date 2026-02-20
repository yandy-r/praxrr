# Analysis Tasks: API Key Masking

### Executive Summary

The highest-leverage plan is a three-phase execution that isolates foundational contract shifts, parallel feature implementation, and final verification. This reduces merge risk in shared settings routes while keeping logger hardening independent. Tasks should stay small (1-3 file targets) with explicit dependencies to maximize parallel throughput.

### Recommended Phase Structure

#### Phase 1: Foundation and Contract Shift

- purpose:
- introduce shared masking primitives and update server payload contracts.
- suggested tasks:
- create `masking.ts` plus core tests.
- convert general and security settings load payloads to masked fields.
- fix Arr logs client creation to use decrypted credentials.
- parallelization notes:
- Arr logs fix can run independently; load conversions depend on masking utility.

#### Phase 2: UI and Runtime Hardening

- purpose:
- deliver reveal/copy UX and logger redaction to prevent operational leaks.
- suggested tasks:
- implement `MaskedApiKey.svelte`.
- add reveal actions in general/security routes.
- migrate TMDB/AI/security UI to masked contract.
- add logger sanitizer and wire into logger.
- dependencies:
- UI migration depends on component and updated server contracts.
- logger sanitizer can proceed independently of UI tasks.

#### Phase 3: Verification and Closure

- purpose:
- prove no plaintext exposure remains in payloads and logs.
- suggested tasks:
- expand redaction and masking tests.
- validate edge behaviors (short keys, empty keys, reveal/copy failure states).
- integrate final contract checks across settings routes.
- integration focus:
- tests should validate both server payloads and logger outputs.

### Task Granularity Guidance

- appropriate task sizes:
- one logical concern per task, touching at most 3 files.
- tasks to split:
- separate logger hardening from UI component work.
- split general settings server contract changes from component migration.
- tasks to combine:
- utility creation and utility tests belong together.
- security page reveal action and UI wiring can stay in one task.

### Dependency Analysis

#### Independent Tasks

- Arr logs client fix.
- logger sanitizer implementation.
- `MaskedApiKey` component scaffold.

#### Sequential Tasks

- masking utility before server contract changes.
- server contract changes before full UI migration.
- logger hook before logger redaction assertions.

#### Potential Bottlenecks

- shared file contention in `settings/general/+page.server.ts`.
- contract drift between server field names and component interfaces.
- hidden regressions in regenerate/reveal key precedence on security page.

### Suggested Task Template

- title format:
- `Task X.Y: <Area> - <Outcome>`
- dependency annotation format:
- `Depends on [none]` or `Depends on [X.Y, A.B]`
- instruction completeness checklist:
- include existing files to read first.
- list precise files to create/modify.
- define expected behavior and edge-case constraints.
