# Transparent Automation Engine — Implementation Plan (Issue #21)

## Scope Recap

This PR ships the **drift-detail surface only** (design Final Scope, authoritative). It adds a
pure, versioned narration engine under `$shared/narration`, one dumb renderer
`NarrationBlock.svelte`, and additive edits to `/drift/[instanceId]/+page.svelte`.

Ships in this PR:

- Pure engine primitives: `narrateEntityChange` (single reusable core), `narrateDriftEntity`
  (normalizes `DriftEntityChange` → delegates to core, adds category prefix/tone),
  `narrateDriftReason` (failure-reason sentence), `narrateDriftCounts` (rollup headline, B1).
- Template resolvers: `resolveActionPhrase`, `resolveFieldVerb`,
  `resolveFieldLabel(arrType, entityType, section, field)`, `resolveEntityLabel`,
  `resolveDriftCategoryPhrase`, `resolveReasonExplanation`.
- `NarrationBlock.svelte` (props `{ line, verbose }`; tone read off `line.tone`).
- Pure Deno unit tests mirroring `src/tests/shared/thresholdState.test.ts`.
- Drift page edits: replace raw `Reason:` line, add counts rollup + verbose toggle, add
  per-entity `NarrationBlock` above each `DriftFieldDiff`.

**Deferred** (sync-preview follow-up PR): `narrateSyncError`, `narrateEntityChanges`,
`narrateSummary`, all `SyncPreviewResult`/preview-surface consumption, and the
`SyncPreviewPanel` / `SyncPreviewEntityDiff` edits. Preview types stay imported **type-only**
because `DriftEntityChange` references `EntityChange`, `FieldChange`, `SyncPreviewArrType`,
`SyncPreviewSection`.

**Guardrails (from verified facts):**

- `NARRATION_TEMPLATE_VERSION = '1'` declared **once** in `types.ts`; `templates.ts` imports it;
  barrel re-exports. No second `export const`.
- All `$sync/*` imports into `$shared` are `import type` only (no server runtime leak into the
  client bundle).
- Status params use `DriftSummaryStatus` (6 members incl. `never-checked`), NOT `DriftStatus`.
- Counts field is `counts.drifted` (NOT `counts.drift`); category value is `'drift'`. Do not
  conflate the naming asymmetry.
- `EntityChange` has no `section` field — `section` is a separate param to `narrateEntityChange`.
- `DriftFieldDiff.svelte` is **left untouched** — the page wraps it (no host slot needed).
- Badge label ownership stays with `driftStatus.ts`; narration renders the SENTENCE only.

## Ordered Tasks

Dependency order: T1 → T2 → T3 → T4 → (T5, T6) → T7. T5 (NarrationBlock) depends only on T1.
T6 (page) depends on T1–T4 and T5. T7 (tests) depends on T1–T4.

### T1 — `types.ts` (contracts + version single-source)

- **File:** `packages/praxrr-app/src/lib/shared/narration/types.ts` (new)
- **Change:** Declare `NARRATION_TEMPLATE_VERSION = '1'`, `NarrationLevel`, `NarrationTone`,
  `NarrationLine`, `NarrationProvenance` (forward seam, unwired). Type-only import of
  `SyncPreviewArrType`, `SyncPreviewSection`, `FieldChange`, `EntityChange` from
  `$sync/preview/types.ts` only as needed for re-export ergonomics — but keep imports minimal;
  `types.ts` itself does not need to import drift/preview types unless a type alias references
  them. Prefer importing `DriftSummaryStatus` only where consumed (templates/narrate), not here.
- **Verify:** included in `deno task check` (check:server); confirm no unused imports (the
  design's `DriftStatus` type-only import would be unused — do NOT add it here).

### T2 — `templates.ts` (versioned resolver registry)

- **File:** `packages/praxrr-app/src/lib/shared/narration/templates.ts` (new)
- **Change:** `import { NARRATION_TEMPLATE_VERSION } from './types.ts';` (no re-declare).
  Type-only import `FieldChange`, `EntityChange`, `SyncPreviewArrType`, `SyncPreviewSection`
  from `$sync/preview/types.ts`; `DriftCategory`, `DriftReason` from `$sync/drift/types.ts`;
  `DriftSummaryStatus` from `$sync/drift/responses.ts`. Implement the six resolvers with
  per-arrType label maps and literal/structural fallback (see Template Seed Coverage).
- **Verify:** `deno task check`; unit tests in T7 exercise every resolver branch.

### T3 — `narrate.ts` (pure engine)

- **File:** `packages/praxrr-app/src/lib/shared/narration/narrate.ts` (new)
- **Change:** Implement `narrateEntityChange`, `narrateDriftEntity` (S3 delegation),
  `narrateDriftReason`, `narrateDriftCounts` (B1). Every returned `NarrationLine` stamps
  `templateVersion: NARRATION_TEMPLATE_VERSION`. No I/O, no fetch, no re-diff, no re-tally.
  `narrateDriftEntity` builds an `EntityChange`-shaped object from the `DriftEntityChange`
  (action already narrowed to create/update/delete), delegates to `narrateEntityChange`, then
  applies the category prefix (via `resolveDriftCategoryPhrase`) + tone.
- **Verify:** `deno task check`; T7 asserts whole-`NarrationLine` equality per case.

### T4 — `index.ts` (barrel)

- **File:** `packages/praxrr-app/src/lib/shared/narration/index.ts` (new)
- **Change:** Re-export everything from `./types.ts` and `./narrate.ts`, and re-export
  `NARRATION_TEMPLATE_VERSION`. Do NOT re-export `templates.ts` internals unless a test needs a
  resolver directly (tests may import `./templates.ts` relatively). Keep the public surface to the
  narrate functions + types + version.
- **Verify:** `deno task check`; T5/T6 import types via this barrel.

### T5 — `NarrationBlock.svelte` (dumb renderer)

- **File:** `packages/praxrr-app/src/lib/client/ui/narration/NarrationBlock.svelte` (new)
- **Change:** Svelte 5 no-runes. Props `export let line: NarrationLine;` +
  `export let verbose = false;`. Tone class map keyed by `line.tone`. Render `line.headline`
  always; render `line.detail` list only when `verbose && line.detail.length > 0`. No toggle
  button here (host owns `let verbose`). Type-only import from `$shared/narration/index.ts`.
- **Verify:** `deno task check` (check:client / svelte-check).

### T6 — Drift page edits (additive)

- **File:** `packages/praxrr-app/src/routes/drift/[instanceId]/+page.svelte` (edit)
- **Change:** (1) Add imports: `NarrationBlock` from `$ui/narration/NarrationBlock.svelte`;
  `{ narrateDriftReason, narrateDriftCounts, narrateDriftEntity }` from
  `$shared/narration/index.ts`. (2) Add `let verbose = false;` state var. (3) Replace the raw
  `{#if detail.reason}<span>Reason: {detail.reason}</span>{/if}` (lines 163-165) with a
  `NarrationBlock` fed by `narrateDriftReason(detail.status, detail.reason, level)`. (4) Insert a
  counts rollup `NarrationBlock` from `narrateDriftCounts(detail.counts, detail.status, level)`
  after the metadata `</div>` (line 166) with a summary/verbose toggle button
  (`on:click={() => (verbose = !verbose)}`). (5) Wrap each of the three `{#each}` loop bodies
  (drift/missing/unmanaged) so a `NarrationBlock` from `narrateDriftEntity(change, detail.arrType,
level)` renders above each `<DriftFieldDiff {change} />`. `level = verbose ? 'verbose' :
'summary'`. `detail.arrType` is passed explicitly to every narrate call (cross-Arr policy).
- **Verify:** `deno task check` (check:client); manual load of `/drift/[instanceId]`, toggle verbose.

### T7 — Unit tests

- **File:** `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts` (new)
- **Change:** `import { assertEquals } from '@std/assert';` + import engine via
  `$shared/narration/index.ts` (resolvers via `../../../lib/shared/narration/templates.ts` if
  tested directly). Flat `Deno.test(...)` blocks, inline fixture literals. See Test Matrix.
- **File (optional):** `scripts/test.ts` — add a `narration` alias (not CI-gated; local convenience).
- **Verify:** `~/.deno/bin/deno test packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`.

## Exact Type & Function Signatures

```ts
// $shared/narration/types.ts
export const NARRATION_TEMPLATE_VERSION = '1';

export type NarrationLevel = 'summary' | 'verbose';
export type NarrationTone = 'neutral' | 'info' | 'warning' | 'danger';

export interface NarrationLine {
  readonly headline: string;
  readonly detail: readonly string[];
  readonly tone: NarrationTone;
  readonly templateVersion: string;
}

/** Forward seam for resolved-config (#25). Defined now, unwired this PR. */
export type NarrationProvenance = 'base' | 'user-override' | 'database-default';
```

```ts
// $shared/narration/templates.ts
import { NARRATION_TEMPLATE_VERSION } from './types.ts'; // single source (S2)
import type {
  EntityChange,
  FieldChange,
  SyncPreviewArrType,
  SyncPreviewSection,
} from '$sync/preview/types.ts';
import type { DriftCategory, DriftReason } from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';

/** create/update/delete/unchanged framed as a decision verb. */
export function resolveActionPhrase(action: EntityChange['action']): string;

/** added='set to', changed='changed from A to B', removed='cleared'. */
export function resolveFieldVerb(type: FieldChange['type']): string;

/** Keyed (arrType, entityType, section, field); unmapped → RAW field name (structural fallback). */
export function resolveFieldLabel(
  arrType: SyncPreviewArrType,
  entityType: string,
  section: SyncPreviewSection | null,
  field: string
): string;

/** Per-arr entity label; literal fallback to entityType. */
export function resolveEntityLabel(
  arrType: SyncPreviewArrType,
  entityType: string
): string;

/** drift/missing/unmanaged phrasing. */
export function resolveDriftCategoryPhrase(category: DriftCategory): string;

/** Full-sentence explanation keyed off DriftSummaryStatus + DriftReason (handles all 8 + null). */
export function resolveReasonExplanation(
  status: DriftSummaryStatus,
  reason: DriftReason | null
): string;
```

```ts
// $shared/narration/narrate.ts — PURE (no I/O, no fetch, no re-diff, no re-tally)
import type {
  EntityChange,
  SyncPreviewArrType,
  SyncPreviewSection,
} from '$sync/preview/types.ts';
import type {
  DriftCounts,
  DriftEntityChange,
  DriftReason,
} from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';
import type { NarrationLevel, NarrationLine } from './types.ts';

/** Single reusable core. summary → headline + empty detail; verbose → +1 detail line per FieldChange.
 *  `unchanged` and trivial single-field updates collapse ("don't over-explain"). */
export function narrateEntityChange(
  change: EntityChange,
  arrType: SyncPreviewArrType,
  section: SyncPreviewSection | null,
  level: NarrationLevel
): NarrationLine;

/** Normalizes DriftEntityChange (EntityChange + section + category, action already
 *  create|update|delete) → delegates to narrateEntityChange core; category adds prefix/tone. */
export function narrateDriftEntity(
  change: DriftEntityChange,
  arrType: SyncPreviewArrType,
  level: NarrationLevel
): NarrationLine;

/** User-facing failure-reason sentence (Done-When "failure reasons"). Handles all 8 reasons + null,
 *  and derives from BOTH status + reason (reason may be null even on failure). */
export function narrateDriftReason(
  status: DriftSummaryStatus,
  reason: DriftReason | null,
  level: NarrationLevel
): NarrationLine;

/** Rollup headline (B1) from DriftCounts {drifted, missing, unmanaged}. Never re-tallies inline. */
export function narrateDriftCounts(
  counts: DriftCounts,
  status: DriftSummaryStatus,
  level: NarrationLevel
): NarrationLine;
```

```ts
// $shared/narration/index.ts — barrel
export * from './types.ts';
export * from './narrate.ts';
export { NARRATION_TEMPLATE_VERSION } from './types.ts';
```

### NarrationBlock.svelte prop contract

```svelte
<script lang="ts">
  import type {
    NarrationLine,
    NarrationTone,
  } from '$shared/narration/index.ts';

  export let line: NarrationLine;
  export let verbose = false;

  const TONE_CLASS: Record<NarrationTone, string> = {
    neutral: 'text-neutral-700 dark:text-neutral-300',
    info: 'text-accent-700 dark:text-accent-400',
    warning: 'text-amber-800 dark:text-amber-300',
    danger: 'text-red-800 dark:text-red-300',
  };

  $: toneClass = TONE_CLASS[line.tone];
  $: showDetail = verbose && line.detail.length > 0;
</script>

<div class="space-y-1 text-sm {toneClass}">
  <p class="font-medium">{line.headline}</p>
  {#if showDetail}
    <ul class="list-disc space-y-0.5 pl-5 text-xs opacity-90">
      {#each line.detail as d}
        <li>{d}</li>
      {/each}
    </ul>
  {/if}
</div>
```

Contract: `line` required, `verbose` defaults false. Tone comes from `line.tone` — no separate
`tone` prop. Renders headline ALWAYS; detail only when verbose. Owns NO toggle button.

## Template Seed Coverage

Every enumerated value below MUST resolve to a distinct, non-throwing sentence. Unmapped
entity/field names degrade to a literal/structural fallback (never a sibling-Arr borrow).

### arrType — `SyncPreviewArrType` (3, union excludes `all`/`chaptarr`)

`radarr`, `sonarr`, `lidarr`. Passed explicitly to every narrate call (cross-Arr policy).

### DriftReason (all 8 + `null`) — `resolveReasonExplanation` / `narrateDriftReason`

| reason             | sentence intent (distinct)                                                |
| ------------------ | ------------------------------------------------------------------------- |
| `unreachable`      | Praxrr could not reach the instance (network/host down).                  |
| `timeout`          | The instance did not respond in time.                                     |
| `unauthorized`     | Praxrr's API key was rejected (auth failure).                             |
| `invalid_response` | The instance returned an unexpected/unparseable response.                 |
| `not_configured`   | The instance is not configured for drift checks.                          |
| `cache_not_ready`  | The PCD cache is not ready yet; drift cannot be computed.                 |
| `rate_limited`     | The instance rate-limited the request.                                    |
| `error`            | An unexpected error occurred during the check.                            |
| `null`             | Generic safe sentence derived from status (no specific reason available). |

### DriftCategory (3) — `resolveDriftCategoryPhrase` (+ tone)

| category                   | phrasing intent                                           | tone             |
| -------------------------- | --------------------------------------------------------- | ---------------- |
| `drift` (ALERTING)         | Managed entity has drifted from PCD.                      | `warning`        |
| `missing` (ALERTING)       | Managed entity is missing on the instance.                | `warning`        |
| `unmanaged` (NON-ALERTING) | Unmanaged extra entity found on the instance (info-only). | `neutral`/`info` |

Note the asymmetry: category value is `'drift'`; the count field is `counts.drifted`.

### DriftStatus (5) / DriftSummaryStatus (6)

DriftStatus: `in-sync`, `drifted`, `unreachable`, `unauthorized`, `error`.
DriftSummaryStatus = DriftStatus + `never-checked`. `narrateDriftReason` / `narrateDriftCounts` /
`resolveReasonExplanation` accept `DriftSummaryStatus`. Distinct sentences required at least across
`never-checked` / `in-sync` / `drifted`.

### Action phrasing — `resolveActionPhrase`

- `EntityChange['action']` core (4): `create`, `update`, `delete`, `unchanged` (must handle
  `unchanged` + the collapse rule).
- `DriftEntityChange.action` (3, no `unchanged`): `create`, `update`, `delete`.

### FieldChange.type (3) — `resolveFieldVerb`

`added` → "set to"; `changed` → "changed from A to B"; `removed` → "cleared".

### SyncPreviewSection (4) — section param + `resolveFieldLabel` section key

`qualityProfiles`, `delayProfiles`, `mediaManagement`, `metadataProfiles`.

### Initial per-arrType entity labels — `resolveEntityLabel` (literal fallback for the rest)

Seed friendly labels for the drift-facing entityType strings; literal fallback (raw entityType)
covers everything unmapped incl. internal Arr-prefixed source descriptors
(`radarr_naming`/`sonarr_media_settings`/`lidarr_quality_definitions`):

| entityType          | seeded label (fallback = raw) |
| ------------------- | ----------------------------- |
| `customFormat`      | Custom Format                 |
| `qualityProfile`    | Quality Profile               |
| `delayProfile`      | Delay Profile                 |
| `metadataProfile`   | Metadata Profile              |
| `naming`            | Naming                        |
| `mediaSettings`     | Media Management Settings     |
| `qualityDefinition` | Quality Definition            |

Field labels: seed a minimal per-`(arrType, entityType, section, field)` map only where a raw
field name reads poorly; everything else falls back to the RAW field name (structural fallback).
The cross-Arr test asserts a same-named field resolves to arr-specific labels where mapped, and an
unmapped field resolves to its literal name (no sibling borrow).

## Drift Page Edits (before / after)

File: `packages/praxrr-app/src/routes/drift/[instanceId]/+page.svelte`.

### E1 — imports + state (script, near lines 2-21)

Add:

```ts
import NarrationBlock from '$ui/narration/NarrationBlock.svelte';
import {
  narrateDriftReason,
  narrateDriftCounts,
  narrateDriftEntity,
} from '$shared/narration/index.ts';
// ...existing lets...
let verbose = false;
$: level = verbose ? 'verbose' : 'summary';
```

### E2 — reason line (lines 163-165)

Before:

```svelte
{#if detail.reason}
  <span>Reason: {detail.reason}</span>
{/if}
```

After (engine gates on status+reason internally; no `{#if detail.reason}`):

```svelte
<NarrationBlock
  line={narrateDriftReason(detail.status, detail.reason, level)}
  {verbose}
/>
```

### E3 — counts rollup + verbose toggle (after metadata `</div>`, ~line 166, before empty-state line 168)

After:

```svelte
<div class="flex items-center justify-between gap-2">
  <NarrationBlock
    line={narrateDriftCounts(detail.counts, detail.status, level)}
    {verbose}
  />
  <button
    type="button"
    class="text-xs underline"
    on:click={() => (verbose = !verbose)}
  >
    {verbose ? 'Hide details' : 'Show details'}
  </button>
</div>
```

### E4 — per-entity narration in each of the three `{#each}` loops (lines 182-183, 198-199, 211-212)

Before (each loop, identical shape):

```svelte
{#each detail.drift as change (`${change.section}:${change.entityType}:${change.name}:${change.remoteId ?? ''}`)}
  <DriftFieldDiff {change} />
{/each}
```

After (wrap; `detail.arrType` in scope under `{:else if detail}`):

```svelte
{#each detail.drift as change (`${change.section}:${change.entityType}:${change.name}:${change.remoteId ?? ''}`)}
  <div class="space-y-2">
    <NarrationBlock
      line={narrateDriftEntity(change, detail.arrType, level)}
      {verbose}
    />
    <DriftFieldDiff {change} />
  </div>
{/each}
```

Apply the same wrap to the `detail.missing` and `detail.unmanaged` loops.
`DriftFieldDiff.svelte` is NOT edited (page-wraps-component; no host slot).

## Test Matrix

File: `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`. Flat `Deno.test` blocks,
inline fixtures, whole-`NarrationLine` `assertEquals` (or field-by-field). Cases:

1. `narrateEntityChange` create — summary: one headline, empty `detail`.
2. `narrateEntityChange` update — verbose: headline + one `detail` line per `FieldChange`.
3. `narrateEntityChange` delete — summary + verbose.
4. `narrateEntityChange` `unchanged` — collapses (terse, no verbose noise) — don't over-explain.
5. Trivial single-field update — stays terse (collapse rule).
6. Field pluralization — "1 field differs" vs "N fields differ".
7. `resolveFieldVerb` — `added` / `changed` / `removed` each map to distinct verb text.
8. Cross-Arr guard — same field name under `radarr` vs `sonarr` → arr-specific label (where mapped).
9. Cross-Arr fallback — unmapped field → RAW field name (no sibling borrow).
10. `resolveEntityLabel` — seeded entityType → friendly label; unmapped → literal entityType.
11. `narrateDriftEntity` category prefix/tone — `drift` (update), `missing` (create),
    `unmanaged` (delete) each get correct prefix + tone; delegates to core (no parallel path).
12. `narrateDriftReason` — distinct sentence for EACH of the 8 `DriftReason` values.
13. `narrateDriftReason` — `null` reason → generic safe sentence (never throws).
14. `narrateDriftReason` — distinct sentences across `never-checked` / `in-sync` / `drifted` status.
15. `narrateDriftCounts` — reads `counts.drifted` / `.missing` / `.unmanaged`; correct rollup
    headline for zero counts vs mixed counts; correct tone.
16. Version stamp — every returned `NarrationLine.templateVersion === NARRATION_TEMPLATE_VERSION`.

## Verification Commands

```bash
# Type-check server + client (check:server deno check + check:client svelte-check)
cd /home/yandy/Projects/github.com/yandy-r/praxrr/.claude/worktrees/issue-21 && ~/.deno/bin/deno task check

# Run the new pure unit tests (also type-checks the tests dir)
cd /home/yandy/Projects/github.com/yandy-r/praxrr/.claude/worktrees/issue-21 && \
  ~/.deno/bin/deno test packages/praxrr-app/src/tests/shared/narration/narrate.test.ts
# (or, after adding the alias) ~/.deno/bin/deno task test narration

# Docs lint gate for the plan/design docs
cd /home/yandy/Projects/github.com/yandy-r/praxrr/.claude/worktrees/issue-21 && \
  npx prettier --check 'docs/plans/issue-21/**/*.md' && \
  npx markdownlint-cli 'docs/plans/issue-21/**/*.md'
```

Manual: load `/drift/[instanceId]` in a running dev server, verify the reason sentence renders,
the counts rollup renders, and the verbose toggle expands per-entity detail. Confirm the short
status badge (owned by `driftStatus.ts`) is unchanged.

## Rollback & Risk

| Risk                                                                         | Mitigation                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$sync/*` runtime import leaks server code into client bundle                | All `$sync/*` imports are `import type` only (barrel exports pure fns/data only).                                                                                        |
| Using `DriftStatus` instead of `DriftSummaryStatus` fails on `never-checked` | Status params typed `DriftSummaryStatus` from `responses.ts`; test case 14 covers it.                                                                                    |
| `counts.drift` typo (field is `drifted`)                                     | Read `counts.drifted`; test case 15 asserts rollup values.                                                                                                               |
| Second `NARRATION_TEMPLATE_VERSION` declaration drifts                       | Declared once in `types.ts`; templates imports; barrel re-exports (S2). Test 16 pins it.                                                                                 |
| Duplicating badge label logic in narration                                   | Narration renders sentence only; badge stays in `driftStatus.ts` (S5).                                                                                                   |
| `.svelte` edits only guarded by svelte-check                                 | `deno task check` runs check:client; manual toggle verification.                                                                                                         |
| Rollback                                                                     | All new files are isolated; page edits are strictly additive — revert the 6 new files + the `+page.svelte` diff to fully back out with zero schema/route/OpenAPI impact. |

## Definition of Done

- [ ] Six new files created (`types.ts`, `templates.ts`, `narrate.ts`, `index.ts`,
      `NarrationBlock.svelte`, `narrate.test.ts`).
- [ ] `+page.svelte` edited: reason line replaced, counts rollup + verbose toggle added,
      per-entity `NarrationBlock` wraps each `DriftFieldDiff` (three loops). `DriftFieldDiff.svelte`
      untouched.
- [ ] `NARRATION_TEMPLATE_VERSION` declared once; every `NarrationLine` stamps it.
- [ ] All `$sync/*` imports in `$shared/narration` are `import type` only.
- [ ] Every `DriftReason` (8 + null), `DriftCategory` (3), and status value resolves to a distinct,
      non-throwing sentence; unmapped entity/field names fall back to literal (no sibling borrow).
- [ ] `~/.deno/bin/deno task check` passes (server + client).
- [ ] The new test file passes; all 16 case groups green.
- [ ] Docs lint (`prettier --check` + `markdownlint`) passes on the plan doc.
- [ ] Deferred items (`narrateSyncError`, `narrateEntityChanges`, `narrateSummary`, sync-preview
      edits) are NOT in this PR.
