---
name: praxrr-commands
description: Praxrr repo command reference — deno tasks for dev, build, lint/type-check, tests (with aliases), Docker, and code generation. Use when running, building, testing, or generating types for this project.
---

# Praxrr Commands

## Development

```bash
deno task dev              # Run parser + Vite dev server (port 6969)
deno task dev:noauth       # Dev server with AUTH=off
deno task dev:server       # Vite dev server only (no parser)
deno task dev:parser       # Parser service only (dotnet watch, port 5000)
```

### Build

```bash
deno task build            # Vite build + Deno compile (Linux x86_64)
deno task build:windows    # Vite build + Deno compile (Windows)
deno task preview          # Run built binary (port 6869)
```

### Lint & Type Check

```bash
deno task lint             # Prettier check + ESLint
deno task format           # Prettier write
deno task check            # Type check both server (deno check) and client (svelte-check)
deno task check:server     # Deno type check server code only
deno task check:client     # svelte-check client code only
```

### Tests

```bash
deno task test             # Run all unit tests
deno task test filters     # Run specific test by alias
deno task test upgrades    # Run test directory by alias
deno task test:watch       # Watch mode
deno task test:e2e         # Playwright e2e tests (requires running server)
deno task test:e2e:headed  # E2e with browser visible
deno task test:e2e:reset   # Reset e2e test state
```

Test aliases defined in `scripts/test.ts`: `filters`, `normalize`, `selectors`, `backup`, `cleanup`, `upgrades`, `jobs`, `logger`.

### Docker

```bash
deno task docker:build     # Build dev image
deno task docker:up        # Build + run dev containers
deno task docker:down      # Stop dev containers
deno task arr              # Run local Radarr/Sonarr for testing
```

### Code Generation

```bash
deno task generate:api-types   # OpenAPI -> TypeScript types (packages/praxrr-app/src/lib/api/v1.d.ts)
deno task generate:pcd-types   # PCD schema -> TypeScript types (packages/praxrr-app/src/lib/shared/pcd/types.ts)
```
