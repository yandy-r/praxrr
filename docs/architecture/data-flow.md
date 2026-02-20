# Architecture Data Flow

## 1) Server Startup Flow

```mermaid
sequenceDiagram
    participant Runtime as Deno Runtime
    participant Hooks as hooks.server.ts
    participant Parser as parser/spawn.ts
    participant DB as db.ts
    participant Mig as migrations.ts
    participant PCD as pcdManager
    participant Jobs as job init/dispatcher

    Runtime->>Hooks: load server hooks
    Hooks->>Parser: optional parser auto-spawn
    Hooks->>DB: initialize SQLite + pragmas
    Hooks->>Mig: run pending migrations
    Hooks->>PCD: initialize linked DB caches
    Hooks->>Jobs: recover and start queue
    Hooks-->>Runtime: ready to serve requests
```

Key references:

- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/lib/server/db/db.ts`
- `packages/praxrr-app/src/lib/server/db/migrations.ts`
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- `packages/praxrr-app/src/lib/server/jobs/init.ts`

## 2) PCD Link/Sync/Compile Flow

```mermaid
sequenceDiagram
    participant API as /api/v1/pcd/*
    participant PM as PCDManager
    participant Git as Git + dependencies
    participant Ops as pcd_ops tables
    participant Compiler as PCD compiler/cache
    participant SyncTrigger as sync trigger

    API->>PM: link/sync/import request
    PM->>Git: clone/pull + dependency sync
    PM->>Ops: import base ops / write user ops
    PM->>Compiler: rebuild in-memory cache
    PM->>SyncTrigger: trigger on_pull/on_change syncs
    PM-->>API: result
```

Key references:

- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts`
- `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`
- `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts`
- `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts`
- `packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/pcd/export/+server.ts`

## 3) Arr Sync Job Flow

```mermaid
sequenceDiagram
    participant Sched as Scheduler/Trigger
    participant Queue as jobQueue
    participant Disp as dispatcher
    participant Handler as arrSync handler
    participant Registry as sync registry
    participant ArrClient as arrInstanceClients
    participant Arr as Arr API

    Sched->>Queue: enqueue/upsert arr.sync job
    Queue->>Disp: notify next run
    Disp->>Handler: execute claimed job
    Handler->>Registry: resolve section handlers
    Handler->>ArrClient: create client (decrypt key)
    Handler->>Arr: execute per-section sync
    Handler->>Registry: complete/fail status + next_run_at
    Disp->>Queue: mark finished or reschedule
```

Key references:

- `packages/praxrr-app/src/lib/server/jobs/queueService.ts`
- `packages/praxrr-app/src/lib/server/jobs/dispatcher.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`
- `packages/praxrr-app/src/lib/server/sync/processor.ts`
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts`

## 4) Entity Testing Evaluation Flow

```mermaid
sequenceDiagram
    participant UI as Entity testing UI/API consumer
    participant Eval as evaluate endpoint
    participant ParserHealth as parser health check
    participant Parser as parser client
    participant Cache as PCD cache
    participant CF as custom format evaluator

    UI->>Eval: POST /api/v1/entity-testing/evaluate
    Eval->>ParserHealth: isParserHealthy()
    alt parser unavailable
        Eval-->>UI: parserAvailable=false
    else parser available
        Eval->>Parser: parseWithCacheBatch + matchPatternsBatch
        Eval->>Cache: load custom format conditions
        Eval->>CF: evaluate conditions per release
        Eval-->>UI: parsed metadata + cfMatches
    end
```

Key references:

- `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts`
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`
- `packages/praxrr-parser/Program.cs`
- `packages/praxrr-parser/Endpoints/MatchEndpoints.cs`

## 5) Contract Flow Between Packages

`praxrr-api` provides typed API contracts consumed by route handlers and clients, while `praxrr-schema` and `praxrr-db` provide operation sources consumed by the PCD layer.

Key references:

- `packages/praxrr-api/mod.ts`
- `packages/praxrr-api/openapi.json`
- `packages/praxrr-schema/ops/0.schema.sql`
- `packages/praxrr-db/ops/0.rosettarr.sql`
