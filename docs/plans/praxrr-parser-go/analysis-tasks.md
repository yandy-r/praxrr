### Executive Summary

The migration should begin with parity and harness work, then port parser internals in modular slices, and finally perform integration cutover with build/deploy updates. Tasking should stay narrowly scoped (one parser domain or endpoint per task) with explicit dependencies on fixture artifacts and shared parser utilities.

### Recommended Phase Structure

#### Phase 1: Parity Validation and Test Harness

- purpose
  Build a golden comparison foundation against the current parser behavior.
- suggested tasks
  - Capture broad fixture corpus and baseline outputs for `/parse` and `/match`.
  - Build regression harness for parity checks.
  - Document contract expectations from existing client/types usage.
- parallelization notes
  Fixture authoring, output capture, and harness scaffolding can proceed concurrently.

#### Phase 2: Go Parser Implementation

- purpose
  Port parser logic and endpoint behavior while preserving contract fidelity.
- suggested tasks
  - Scaffold `src/services/parser-go` with models/server/parser packages.
  - Port shared parser utilities first, then parser domains independently.
  - Implement `/parse`, `/match`, `/match/batch`, and `/health` with matching timeouts and serialization.
- dependencies
  Requires Phase 1 fixture/harness availability; parser domain tasks depend on shared utilities.

#### Phase 3: Integration and Pipeline Cutover

- purpose
  Switch runtime/build pipeline to Go parser and validate system-wide compatibility.
- suggested tasks
  - Update spawn/build/docker/workflow files for Go binary.
  - Run side-by-side output diff verification before full cutover.
  - Finalize cache/version behavior and clean up legacy parser artifacts.
- integration focus
  Keep TypeScript caller and route integration unchanged by preserving parser API contract.

### Task Granularity Guidance

- appropriate task sizes
  One parser concern or endpoint per task; 1-3 target files per task.
- tasks to split
  Separate `/match` vs `/match/batch` implementation and timeout logic validation.
- tasks to combine
  Combine fixture capture and golden snapshot generation into one verification stream.

### Dependency Analysis

#### Independent Tasks

- Fixture creation and baseline snapshot capture.
- Go module scaffolding and package layout.
- CI/Docker planning work once artifact conventions are fixed.

#### Sequential Tasks

- Shared parser utility port before domain parser ports.
- Domain parser parity validation before endpoint cutover.
- Pipeline cutover after end-to-end parity confidence is established.

#### Potential Bottlenecks

- Shared parser client contract expectations.
- Cache version strategy and invalidation consistency.
- Spawn/runtime assumptions for binary naming and health readiness.

### Suggested Task Template

- title format
  `parser-go: <area> - <action>`
- dependency annotation format
  `Depends on [task-id, task-id]`
- instruction completeness checklist
  - includes exact file targets (1-3 files)
  - states endpoint/behavior contract requirements when applicable
  - defines verification intent for parity scope
  - identifies cache/version/timeout impacts when relevant
