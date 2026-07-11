# Architecture Data Flow

## 1) Server Startup Flow

```mermaid
sequenceDiagram
    participant Runtime as Deno Runtime
    participant Hooks as hooks.server.ts
    participant ParserSpawn as parser/spawn.ts
    participant Parser as Go cmd/praxrr-parser
    participant DB as db.ts
    participant Mig as migrations.ts
    participant PCD as pcdManager
    participant Jobs as job init/dispatcher

    Runtime->>Hooks: load server hooks
    Hooks->>ParserSpawn: inspect external host / adjacent binary
    opt standalone parser binary is available
		ParserSpawn->>Parser: spawn and wait for /health
    end
    Hooks->>DB: initialize SQLite + pragmas
    Hooks->>Mig: run pending migrations
    Hooks->>PCD: initialize linked DB caches
    Hooks->>Jobs: recover and start queue
    Hooks-->>Runtime: ready to serve requests
```

Key references:

- `packages/praxrr-app/src/hooks.server.ts`
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`
- `packages/praxrr-parser/cmd/praxrr-parser/main.go`
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
    participant Client as parser client
    participant ParserCache as behavior-versioned SQLite caches
    participant HTTP as Go HTTP adapter
    participant Contract as JSON contract
    participant Parser as domain parser/matcher
    participant PCDCache as PCD cache
    participant CF as custom format evaluator

    UI->>Eval: POST /api/v1/entity-testing/evaluate
    Eval->>ParserHealth: isParserHealthy()
    alt parser unavailable
        Eval-->>UI: parserAvailable=false
    else parser available
		Eval->>Client: parseWithCacheBatch + matchPatternsBatch
		Client->>HTTP: /health, /parse, /match/batch
		HTTP->>Contract: decode and validate exact wire DTOs
		HTTP->>Parser: parse title / run .NET-compatible patterns
		Parser-->>HTTP: structured result within finite limits
		HTTP-->>Client: versioned health or JSON result
		Client->>ParserCache: read/write behavior-versioned results
		Eval->>PCDCache: load custom format conditions
        Eval->>CF: evaluate conditions per release
        Eval-->>UI: parsed metadata + cfMatches
    end
```

Key references:

- `packages/praxrr-app/src/routes/api/v1/entity-testing/evaluate/+server.ts`
- `packages/praxrr-app/src/lib/server/utils/arr/parser/index.ts`
- `packages/praxrr-app/src/lib/server/utils/parser/spawn.ts`
- `packages/praxrr-app/src/lib/server/db/queries/parsedReleaseCache.ts`
- `packages/praxrr-app/src/lib/server/db/queries/patternMatchCache.ts`
- `packages/praxrr-parser/cmd/praxrr-parser/main.go`
- `packages/praxrr-parser/internal/httpserver/handler.go`
- `packages/praxrr-parser/internal/contract/`
- `packages/praxrr-parser/internal/parser/`
- `packages/praxrr-parser/testdata/golden/`

The parser is an optional capability: startup and the main health surface do not
depend on it. The entity-testing flow probes the parser directly and degrades to
`parserAvailable: false` without invoking parse, match, or cache writes when the
service is unavailable.

## 5) Contract Flow Between Packages

`praxrr-api` provides typed API contracts consumed by route handlers and clients, while `praxrr-schema` and `praxrr-db` provide operation sources consumed by the PCD layer.

Key references:

- `packages/praxrr-api/mod.ts`
- `packages/praxrr-api/openapi.json`
- `packages/praxrr-schema/ops/0.schema.sql`
- `packages/praxrr-db/ops/0.rosettarr.sql`
