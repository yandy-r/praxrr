# Pattern Research: resolved-config-viewer

Concrete, verified implementation patterns for issue #25, pulled from real files. This
supplements `feature-spec.md` (contract) and `research-practices.md` (reuse-vs-build
rationale) with copy-paste-grade examples. Oriented via `graphify query` before reading
raw source, per repo convention.

## Architectural Patterns

### 1. API route handler shape (copy target: `routes/api/v1/compatibility/parity/+server.ts`)

File: `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts`

Verified shape, in order:

1. Imports `RequestHandler` type, `components` from `$api/v1.d.ts` for response typing
   (`type ParityMapResponse = components['schemas']['ParityMapResponse']`).
2. Module-level cache for static/derived data that doesn't vary per request
   (`let cachedStaticPayload: StaticParityMapPayload | null = null;` + lazy getter).
3. Auth gate is the **first statement** in the handler:
   ```ts
   if (!locals.user && !locals.authBypass) {
     return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
   }
   ```
4. Param validation with strict digit regex, not `parseInt` alone:
   ```ts
   if (!/^\d+$/.test(databaseIdParam)) {
     return json({ error: 'Invalid databaseId' } satisfies ErrorResponse, { status: 400 });
   }
   ```
   (Rejects `"1e5"`, `"1abc"`, `" 1"` — `Number.parseInt` alone would silently accept these.)
5. Cache-guard, returning **400 not 404** for an unbuilt/unknown database ("caller input
   problem, no sibling-app fallback"):
   ```ts
   const cache = pcdManager.getCache(databaseId);
   if (!cache?.isBuilt()) {
     return json({ error: 'Database not found' } satisfies ErrorResponse, { status: 400 });
   }
   ```
6. try/catch around the actual compute, logging via `$logger/logger.ts` with `source` +
   `meta.error` (never the raw `Error` object serialized directly), returning a generic
   500 message to the client:
   ```ts
   } catch (error) {
     await logger.error('Failed to compute compatibility parity map', {
       source: 'compatibility/parity',
       meta: { databaseId, error: error instanceof Error ? error.message : String(error) },
     });
     return json({ error: 'Failed to compute compatibility parity map' } satisfies ErrorResponse, { status: 500 });
   }
   ```
7. Every response body is typed with `satisfies <SchemaType>` against the generated
   OpenAPI types — never a bare object literal.

This is the exact shape to copy for `.../resolved/[entityType]/+server.ts`,
`.../[name]/+server.ts`, `.../compare/+server.ts`, `.../diff/+server.ts`.

### 2. Server service module shape in `pcd/` (directory-per-feature, `index.ts` exports)

- `packages/praxrr-app/src/lib/server/pcd/index.ts` is the **public API surface** for the
  whole `pcd/` tree: grouped `// ====` banner comments (`MANAGER`, `CACHE`, `WRITER`,
  `MANIFEST`, `DEPENDENCIES`, `OPERATIONS`, `TYPES`, `SNAPSHOTS`, `ERRORS`), each a
  named re-export from an internal submodule file, plus `export type {...}` blocks kept
  separate from value exports.
- New `pcd/resolved/*` submodules (per feature-spec) must add a matching
  `// RESOLVED CONFIG` section here, re-exporting only the public surface
  (`getResolvedQualityProfile`, `buildLayerScopedCache`, etc.) — do not have route code
  import from `pcd/resolved/read.ts` directly; import from `$pcd/index.ts`.
- Existing precedent for this exact "directory owns a `service.ts`, index owns nothing"
  variant: `pcd/snapshots/service.ts` (a single exported const object `snapshotService`
  with methods) — an equally valid shape if the resolved module wants one cohesive
  object instead of loose functions. Both patterns coexist in the codebase; the
  feature-spec's proposed `readers.ts`/`layers.ts`/`layerDiff.ts`/`liveDiff.ts`/
  `compare.ts`/`limits.ts` file-per-concern split matches the `pcd/ops/*` and
  `pcd/conflicts/*` directories more closely than the single-object `snapshots/service.ts`
  style — prefer the file-per-concern split since it's explicitly named in the spec's
  "Files to Create" list.

### 3. Per-entity-type function convention (`entities/serialize.ts`)

File: `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts`

- **One function per entity type**, not a generic dispatcher: `serializeDelayProfile`,
  `serializeRegularExpression`, `serializeCustomFormat`, `serializeQualityProfile`,
  `serializeRadarrNaming`/`serializeSonarrNaming`/`serializeLidarrNaming`,
  `serializeRadarrMediaSettings`/`serializeSonarrMediaSettings`/`serializeLidarrMediaSettings`,
  `serializeRadarrQualityDefinitions`/`serializeSonarrQualityDefinitions`/`serializeLidarrQualityDefinitions`,
  `serializeLidarrMetadataProfile`. Grouped with `// ====` banner comments per entity family.
- Signature convention: `async function serializeX(cache: PCDCache, name: string): Promise<PortableX>`.
- Each function either delegates to an existing `entities/<type>/index.ts` query module
  (`delayProfileQueries.getByName`, `namingQueries.getRadarrByName`, etc.) or, if no
  query module exists yet, reads directly via `cache.kb` (Kysely) with explicit
  `selectFrom`/`where('name', '=', name)`.
- Not-found is a thrown `Error`, not a null return: `if (!row) throw new Error('X "name" not found')`.
  This means callers (routes) must catch and translate to 404 — confirmed by feature-spec's
  404 error table for the named-entity GET route.
- Per-Arr-app fields are **separate functions**, never one function branching on `arrType`
  internally (`serializeRadarrNaming` vs `serializeSonarrNaming` vs `serializeLidarrNaming`
  each has a distinct `Portable*Naming` return type) — this is the concrete precedent for
  the Cross-Arr Semantic Validation Policy's "no sibling-app fallback" rule at the read
  layer, and the pattern `pcd/resolved/read.ts` must replicate per `research-practices.md`.

### 4. Svelte page structure (`+page.server.ts` load + `+page.svelte`, parity-map example)

Files: `packages/praxrr-app/src/routes/parity-map/+page.server.ts`,
`packages/praxrr-app/src/routes/parity-map/+page.svelte`,
`packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte`.

- `+page.server.ts`'s `load` mirrors the route handler's param validation exactly
  (same `/^\d+$/` regex, same `pcdManager.getCache(id)?.isBuilt()` guard) but returns
  `{ ..., error: <string|undefined> }` in the data payload instead of throwing/erroring
  the SvelteKit load — the page renders its own inline error banner rather than a
  SvelteKit error page. No auto-resolve of a "primary" database: stays `null` until the
  user explicitly picks one via `?databaseId=`.
- Static/computation-heavy sub-data (the entity/app matrix) is intentionally NOT part of
  server load — `ParityMatrix.svelte` computes `buildParityRows()` itself as a component
  default-prop (`export let rows: ParityRow[] = buildParityRows();`) for a "zero-round-trip"
  render of static data, per the load's own doc comment.
- `+page.svelte` structure: `<script lang="ts">` (imports, `export let data: PageData`,
  local handlers) → `<svelte:head><title>...</title></svelte:head>` → sectioned page body
  (`<section>` per logical block) with `{#if}/{:else if}/{:else}` empty-state ladder
  (no databases linked / no database selected / empty result / populated result) —
  reuse this ladder directly for the resolved-config viewer's entity/layer states.
- Database picker is a plain `<select>` with `on:change` calling `goto()` to update the
  URL query param (`?databaseId=`), not a client store — URL is the source of truth for
  page selection state.

### 5. Svelte 5 NO-runes convention

Confirmed throughout `parity-map/*.svelte` and `SyncPreviewEntityDiff.svelte`:

- `export let propName: Type = default;` for props (not `$props()`).
- Local reactive derivations use the legacy `$:` label (not `$derived`):
  `$: entityLabel = ...; $: summaryText = entity.fields.length === 1 ? '1 field change' : ...;`
  — see `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte:64-69`.
- Local mutable component state is a plain `let` (not `$state`):
  `let expanded = defaultExpanded;` in `SyncPreviewEntityDiff.svelte:7`.
- Event handlers use `on:click`/`on:change` (Svelte 4 directive syntax), not the Svelte 5
  `onclick=` attribute shorthand — confirmed in `parity-map/+page.svelte:52`
  (`on:change={handleDatabaseChange}`). Note: CLAUDE.md's own text says "Use `onclick`
  handlers, not `$state`/`$derived`" but the actual codebase convention observed in both
  reused example files is `on:click`/`on:change` — **follow the actual code
  (`on:event`), not the CLAUDE.md wording**, since it is the load-bearing, consistently
  applied pattern across every existing component checked.
- Slots use `<svelte:fragment slot="cell" let:row let:column>` (Svelte 4 slot API), not
  Svelte 5 snippets — see `ParityMatrix.svelte:72`.
- Global user feedback via `$alerts/store` (`alertStore.add(type, message)` per
  CLAUDE.md); dirty-state tracking via `$lib/client/stores/dirty` — not directly exercised
  by parity-map (read-only page) but required for any resolved-config write affordance
  (none planned — the viewer is read-only, so dirty tracking is likely N/A for v1).

## Code Conventions

- **Prettier** (`/home/yandy/Projects/github.com/yandy-r/praxrr/.prettierrc`): `tabWidth: 2`,
  `useTabs: false` (2-space, NOT tabs — contradicts CLAUDE.md's summary "Tabs, single
  quotes..."; the actual `.prettierrc` on disk uses spaces), `printWidth: 120` (not 100 —
  again the actual file says 120, CLAUDE.md's "100 char print width" is stale/inaccurate),
  `singleQuote: true`, `trailingComma: "es5"` (adds trailing commas where ES5-valid, i.e.
  NOT "no trailing commas" as CLAUDE.md states), `semi: true`. Markdown files get
  `printWidth: 80`. **Trust the actual `.prettierrc` file, not the CLAUDE.md prose
  summary, when formatting new code** — run `deno task format` rather than hand-matching
  the CLAUDE.md description.
- **Import aliases**: consistently used everywhere seen — `$pcd/index.ts` (never deep
  `pcd/database/cache.ts` imports from routes/tests), `$logger/logger.ts`,
  `$api/v1.d.ts` for generated OpenAPI types (`components['schemas'][...]`),
  `$shared/arr/*`, `$shared/pcd/portable.ts`, `$ui/table/Table.svelte`,
  `$ui/badge/Badge.svelte`, `$sync/preview/*` (referenced in feature-spec, matches
  `$sync/` alias table in root `CLAUDE.md`). New `pcd/resolved/*` files should import
  sibling `pcd/` internals via relative path (`./entities/serialize.ts` style, as
  `serialize.ts` itself does with `./delayProfiles/index.ts`) and import outward
  (`$sync/preview/diff.ts`) via the `$sync/` alias — never a relative `../../sync/...`
  reach-across.
- **Naming**: entity read functions are `serialize<Entity><App?>` (`serializeQualityProfile`,
  `serializeRadarrNaming`); sanitized status/enum types are `<Domain>Reason`
  (`TestConnectionReason`); route handlers are always named `GET`/`POST`/etc. (uppercase,
  matches SvelteKit `RequestHandler` convention) and exported directly for test import
  (`import { GET } from '../../routes/.../+server.ts'`).
- **File size**: `serialize.ts` (386 lines) and `+server.ts` (85 lines) both sit
  comfortably under the ~500-line soft cap; if `pcd/resolved/readers.ts` grows past ~500
  lines once every entity type is added, split by entity family (mirrors how
  `entities/serialize.ts` itself could be split but hasn't needed to be yet).

## Error Handling

- **Logger call shape**: `await logger.error(message: string, { source: string, meta: Record<string, unknown> })`.
  `meta.error` is always `error instanceof Error ? error.message : String(error)` — never
  pass the raw `Error` object or `error.stack` into a response body or an untraced log
  call. For traces, use `logger.errorWithTrace(message, error, options)`
  (`packages/praxrr-app/src/lib/server/utils/logger/logger.ts:166`), which separately
  writes `error.stack` to console/file, still never to the HTTP response.
- **API error response shape**: always `json({ error: string } satisfies ErrorResponse, { status })`.
  No nested error objects, no `code` field observed in this route — a single sanitized
  `error` string plus HTTP status carries the semantics (400 vs 401 vs 404 vs 500).
- **Sanitized reason enums** (`$arr/testConnectionReason.ts` pattern): file
  `packages/praxrr-app/src/lib/server/utils/arr/testConnectionReason.ts` defines a
  closed string-union type (`export type TestConnectionReason = 'unreachable' | 'unauthorized' | 'invalid_response' | 'timeout';`)
  plus pure mapping functions (`toFailureReason(error: unknown)`,
  `reasonFromStatus(status?: number)`) that pattern-match on `error.message`/HTTP status
  and return only the enum — raw messages/hostnames never escape this boundary. The
  feature-spec's `ResolvedInstanceState.error` and per-instance `diff` error field must
  follow this exact shape: define a closed reason union (e.g.
  `'unreachable' | 'timeout' | 'rate-limited' | 'unsupported'`) in a new
  `pcd/resolved/` (or reuse `testConnectionReason.ts` if the taxonomy overlaps) rather
  than serializing caught errors ad hoc.
- **Not-found convention split**: entity serializers throw plain `Error` on missing row
  (`serialize.ts`); routes translate that into the correct HTTP status themselves (per
  feature-spec's error tables, 404 for named-entity misses vs. 400 for cache-not-built).
  Do not let a thrown `Error` bubble to a generic 500 — catch specifically around the
  serializer call site and check message/instance-of before falling through to the
  generic try/catch's 500.

## Testing Approach

- **Pure-function tests** (mirror target: `tests/base/syncPreviewDiff.test.ts`): plain
  `Deno.test('description', () => {...})` blocks, `assertEquals` from `@std/assert`, zero
  server/DB bootstrap — call `diffToFieldChanges(current, desired, options?)` directly
  with inline object literals. New `pcd/resolved/diff.ts`/`layers.ts` pure logic must be
  tested the same way, no fixtures needed.
- **Route-level tests** (mirror target: `tests/routes/parityMapApi.test.ts`): import the
  route's exported `GET` handler directly (`import { GET } from '../../routes/api/v1/compatibility/parity/+server.ts'`),
  build a minimal fake `RequestHandler` event via `type GetEvent = Parameters<typeof GET>[0]`
  and a `buildGetEvent(query, authenticated)` helper that fills only `url` and
  `locals.{user,session,authBypass}` (cast through `Partial<GetEvent> as GetEvent`) — no
  real SvelteKit server needed. For cache-backed endpoints, build an **in-memory SQLite
  fixture** with `new Database(':memory:', { int64: true })` +
  `new Kysely<PCDDatabase>({ dialect: new DenoSqlite3Dialect({ database: db }) })`, `db.exec(schemaAndDataSql)`
  with hand-written `CREATE TABLE`/`INSERT` SQL scoped to only the tables the handler
  reads, then wrap as `{ cache: { kb, isBuilt: () => true } as unknown as PCDCache, destroy }`
  and register/unregister via `setCache(databaseId, fixture.cache)` /
  `deleteCache(databaseId)` from `$pcd/database/registry.ts` in a `try/finally`. This is
  the exact fixture-build recipe `tests/routes/resolvedConfigApi.test.ts` should reuse —
  each resolved-config test only needs the subset of PCD tables its entity type touches.
- **PCD feature tests** (mirror target: `tests/pcd/snapshots/service.test.ts`): tests
  live under `tests/pcd/<feature>/*.test.ts`. Heavy use of a `patchTarget(target, key, replacement, restores)`
  helper (monkey-patch a module export, push a restore closure, restore in `finally`) to
  stub `db.query`/`db.queryFirst`/query-module methods/`logger.*` without a real DB or
  real logger I/O — `patchLoggerForTest(restores)` silences all logger methods first in
  every test. New `tests/pcd/resolved/*.test.ts` should follow the same
  patch-and-restore idiom rather than instantiating a real `PCDCache`/app DB unless the
  test specifically needs Kysely-backed SQL behavior (in which case use the in-memory
  SQLite fixture pattern from the route test instead).
- **Redaction suite** (`tests/base/arrCredentialRedactionRoutes.test.ts`): a
  `class ...Test extends BaseTest` (from `tests/base/BaseTest.ts`) with
  `override run(): Promise<void>` that calls one `this.test('description', async () => {...})`
  per case, each asserting `this.assertPayloadNoLeak(payload, SECRET_VALUE, context)` on
  every response/load payload that could carry a credential, plus explicit
  `assertFalse('api_key' in payload)` checks. Routes get registered in this suite simply
  by importing their `GET`/`load` export and adding a new `run...RedactionTest()` private
  method invoked from `override run()` — **any new resolved-config route/load that could
  echo an Arr instance's stored fields (name, url, arrType — never api_key) must add a
  case here**, per feature-spec's explicit success criterion "no credential fields in any
  response (extend `arrCredentialRedactionRoutes` test suite)".
- **`scripts/test.ts` alias registration**: `aliases: Record<string, string>` map at the
  top of `scripts/test.ts`; a value can be a single file, a directory, or a **comma-joined
  list of paths** (see `parity: 'tests/arr/parityMap.test.ts,tests/pcd/qualityProfileCompatibility.test.ts,tests/routes/parityMapApi.test.ts'`).
  Add a `resolvedConfig: 'packages/praxrr-app/src/tests/pcd/resolved,packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts'`
  entry so `deno task test resolvedConfig` runs both the pure-logic dir and the route
  test in one invocation — this matches the `parity` alias precedent exactly.
- **How tests obtain a built `PCDCache`**: two confirmed approaches, choose per test
  need — (1) minimal ad hoc in-memory SQLite + hand-rolled schema fragment
  (`parityMapApi.test.ts`, cheapest, scoped to exactly the tables under test), or (2)
  monkey-patch the `db`/query-module layer entirely and never touch a real `PCDCache`
  (`snapshots/service.test.ts`, appropriate when the code under test doesn't read
  `cache.kb` directly). No test file observed builds a *real* `PCDCache.build()` from
  actual ops — all PCD-cache-dependent tests fabricate a minimal fixture cache instead;
  do the same for `pcd/resolved/*` tests rather than trying to run the full ops pipeline.

## Patterns to Follow

1. Copy `compatibility/parity/+server.ts`'s five-step shape verbatim for every new
   `resolved/**/+server.ts`: auth-first → strict-digit param validation → cache
   `isBuilt()` guard (400) → try/catch with sanitized `logger.error` + generic 500 →
   `satisfies <GeneratedSchemaType>` on every response.
2. Add one function per entity type to a new `pcd/resolved/readers.ts`, each delegating
   to the matching `entities/serialize.ts` function (do not re-derive SQL) — throw
   `Error('X "name" not found')` on miss, same as `serialize.ts`, and let the route
   translate to 404.
3. Re-export the new `pcd/resolved/*` public surface from `$pcd/index.ts` under a new
   `// RESOLVED CONFIG` banner section; never import `pcd/resolved/*` files directly from
   routes/tests by relative/deep path.
4. `+page.server.ts` load mirrors route-handler validation but returns
   `{ ..., error?: string }` in page data instead of erroring the load, so
   `+page.svelte` can render an inline `{#if data.error}` banner — follow the
   `parity-map` empty-state ladder (no databases / none selected / empty result /
   populated) exactly for the entity/layer picker states.
5. Svelte components: `export let` props, `$:` reactive labels, plain `let` local state,
   `on:click`/`on:change` directives, `<svelte:fragment slot=... let:x>` for table cells
   — no runes anywhere, matching every existing component inspected (note the
   discrepancy vs. CLAUDE.md's "onclick" wording; the codebase itself uses `on:click`).
   Reuse `$ui/table/Table.svelte` + `$ui/badge/Badge.svelte` + a `Column<T>[]` config for
   the cross-instance comparison grid, exactly as `ParityMatrix.svelte` does — do not
   build a bespoke grid component.
6. Reuse `SyncPreviewEntityDiff.svelte`'s `ACTION_META`/`FIELD_META` glyph+color+label
   triple-encoding (`+ ~ - =`, WCAG 1.4.1 requirement from the spec) for the field-diff
   table rather than inventing new diff iconography.
7. Sanitize every instance-facing error into a closed reason-string union before it
   reaches a response body, following `testConnectionReason.ts`'s
   `toFailureReason(error)`/`reasonFromStatus(status)` shape — never forward
   `error.message` to the client.
8. Run `deno task format` to match the real `.prettierrc` (2-space, 120-width,
   trailing commas where ES5-valid) rather than hand-formatting to the CLAUDE.md prose
   description, which is out of sync with the checked-in config.
9. Register new tests in `scripts/test.ts` under a `resolvedConfig` alias
   (comma-joined dir + route-test path, matching the `parity` alias), add a redaction
   case to `arrCredentialRedactionRoutes.test.ts` for any new response surface, and build
   `PCDCache` test fixtures via the minimal in-memory-SQLite-or-patch approach — never a
   full real `PCDCache.build()`.

## Files Referenced

- `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts` — route handler copy target
- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts` — per-entity-type read function convention
- `packages/praxrr-app/src/lib/server/pcd/index.ts` — public-surface re-export pattern
- `packages/praxrr-app/src/lib/server/pcd/snapshots/service.ts` — alternate single-object service shape
- `packages/praxrr-app/src/routes/parity-map/+page.server.ts` — load function pattern
- `packages/praxrr-app/src/routes/parity-map/+page.svelte` — page structure, empty-state ladder
- `packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte` — Svelte 5 no-runes component, Table/Badge/Column<T> usage
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte` — diff visual language (glyph+color+label)
- `.prettierrc` — authoritative formatting config (2-space, 120-width, es5 trailing commas)
- `packages/praxrr-app/src/lib/server/utils/arr/testConnectionReason.ts` — sanitized reason-enum pattern
- `packages/praxrr-app/src/lib/server/utils/logger/logger.ts` — logger method signatures (`error`, `errorWithTrace`)
- `packages/praxrr-app/src/tests/base/syncPreviewDiff.test.ts` — pure-function Deno.test shape
- `packages/praxrr-app/src/tests/routes/parityMapApi.test.ts` — route-level test + in-memory SQLite cache fixture recipe
- `packages/praxrr-app/src/tests/pcd/snapshots/service.test.ts` — patch-and-restore test idiom for pcd/ feature modules
- `packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts` — redaction test suite registration pattern
- `packages/praxrr-app/src/tests/base/BaseTest.ts` — shared test base class (`installPatch`, `assertPayloadNoLeak`)
- `scripts/test.ts` — test alias registry
