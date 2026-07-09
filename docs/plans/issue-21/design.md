# Transparent Automation Engine — Design (Issue #21)

> **Reconciliation note (authoritative):** The adversarial critique in `design-critique.md`
> was accepted in full. The binding scope for this PR is the **Final Scope** section at the
> bottom of this document, which overrides any wider scope implied by the original body
> (notably: this PR ships the **drift surface only**; the sync-preview surface,
> `narrateSyncError`, `narrateEntityChanges`, and `narrateSummary` are deferred to a
> follow-up). Read the body for architecture and rationale; read Final Scope for what
> actually ships.

## Summary

Issue #21 is a design philosophy — automated operations should explain themselves in
user-facing language (inputs, decisions, outputs, failure reasons). This PR ships the
reusable **foundation** for that philosophy plus two concrete user-visible surfaces.

We add a **pure, versioned narration engine** under `$shared/narration` that turns the
diff atoms the sync-preview and drift engines **already computed** (`EntityChange`,
`FieldChange`, `SyncPreviewResult`, plus drift `DriftEntityChange` / `DriftReason` and
sync `SyncResult` error records) into leveled human-readable "Decision Log" lines —
**summary by default, verbose on expand**. Narration is derived client-side from data
already present in the responses (`SyncPreviewPanel.loadPreview` already fetches the full
`SyncPreviewResult`; `DriftDetailResponse` already carries `arrType` + reason + change
arrays). Nothing is recomputed, no diff is re-run, no route/OpenAPI/migration is touched.

One dumb presentational renderer (`NarrationBlock.svelte`) surfaces the engine output on
the **sync-preview panel** and the **`/drift/[instanceId]` detail page**, each gaining a
summary/verbose toggle and human-readable failure-reason explanations. Other features
(jobs, upgrades, notifications, resolved-config #25, server-side decision logging #20)
plug into the same engine later with no engine change.

## Goals & Non-Goals

**Goals**

- A reusable, versioned, **pure-function** explanation engine (`$shared/narration`) that
  renders existing diff/error records into summary + verbose narration.
- Reuse — **never recompute** — the preview/drift diff data.
- Two concrete user-visible surfaces proving cross-feature reuse in one PR:
  sync-preview and drift detail.
- Satisfy the issue's "Done When": show inputs, decisions, outputs, **and failure
  reasons** in user language.
- Deno-unit-testable via pure functions (mirrors `src/tests/shared/thresholdState.test.ts`).
- Cross-Arr safe: templates keyed by explicit `arrType`; literal/structural fallback,
  never a borrowed sibling-Arr label.

**Non-Goals (this PR)**

- No new API endpoint, no OpenAPI/`v1.d.ts` change, no DB migration.
- No server-side decision-log emission into `logger.meta` (#20) — engine seam ready, wiring deferred.
- No relocation/consolidation of `formatFieldValue` (documented dup; deferred to a separate refactor PR).
- No resolved-config (#25) provenance wiring — the `NarrationProvenance` type is defined
  as a forward seam only.
- No i18n, no persisted verbose preference, no narration history/audit table.

## Chosen Approach & Why

**Base:** Proposal 2 — _client-side pure narration layer in `$shared/narration`_. It won
the aggregate judge score (48 / 50 / 51, highest on every ballot) on the two axes that
matter most for a one-PR foundation: **shippability** (no endpoint, no prettier-gated
OpenAPI entry, no migration, purely additive edits) and **testability** (pure `$shared`
engine following the established test pattern). It is the most faithful reading of the
issue's binding constraint — _"sync narration should use the SAME diff data as sync
preview (#7)"_ — because `SyncPreviewPanel.loadPreview` already fetches the full
`SyncPreviewResult` client-side (verified, `SyncPreviewPanel.svelte:251`), so deriving
narration in `$shared` adds zero recompute and zero transport. It is the only proposal
that ships **two** surfaces and the only one covering the Done-When "failure reasons"
dimension (`narrateSyncError` / `narrateDriftReason`).

**Grafts adopted from the runners-up:**

- _From Proposal 3 (Decision Log):_ the **"Decision Log" framing** (actions rendered as
  decisions with an inputs→outcome shape, and a "don't over-explain" collapse rule), plus
  the forward-looking **`NarrationProvenance`** type (base/user/override) defined now,
  wired for resolved-config #25 later. We **do not** relocate `formatFieldValue` in this
  PR — all three judges flagged that as scope creep touching the resolved-config panels;
  it lands as a separate dedup PR.
- _From Proposal 1 (server engine):_ the **granular template keying**
  `(arrType, entityType, section, field)` with an explicit **STRUCTURAL/literal fallback**
  that never borrows sibling-Arr phrasing (closes P2's `arrType+field`-only precision
  gap); the explicitly-named **`narrateEntityChanges`** reuse seam; the **engine remains
  importable server-side** (it lives in `$shared`) so #20 can later emit the same template
  into `logger.meta` with no second implementation; and an explicit
  **`NARRATION_TEMPLATE_VERSION` bump-discipline** note. We **reject** P1's dedicated
  `/api/v1/.../narration` endpoint — it re-serves data the client already fetched.

## Architecture

```
                 already computed, already fetched
   SyncPreviewResult ─┐        DriftDetailResponse ─┐        SyncResult.error ─┐
   (EntityChange/     │        (DriftEntityChange/  │        (coarse string)   │
    FieldChange)      │         DriftReason/status) │                          │
                      ▼                             ▼                          ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │  $shared/narration  (PURE, versioned, client+server importable)        │
        │                                                                        │
        │   templates.ts  ── versioned registry, arr-keyed labels + phrasing     │
        │   narrate.ts    ── narrateEntityChange / narrateEntityChanges /        │
        │                    narrateDriftEntity / narrateDriftReason /           │
        │                    narrateSyncError                                    │
        │   types.ts      ── NarrationLine, NarrationLevel, NarrationProvenance  │
        └──────────────────────────────────────────────────────────────────────┘
                      │  NarrationLine { headline, detail[], templateVersion }
                      ▼
        $ui/narration/NarrationBlock.svelte  (dumb: headline always, detail[] if verbose)
                      │
        ┌─────────────┴───────────────────────────────┐
        ▼                                              ▼
   sync-preview surface                          /drift/[instanceId] surface
   (SyncPreviewPanel + SyncPreviewEntityDiff)    (+page.svelte + DriftFieldDiff)
```

Key invariants:

- The engine's **only inputs** are already-computed records. It never fetches, never
  re-diffs, never re-tallies (rollups reuse `SyncPreviewSummary` / `DriftCounts`).
- The engine produces the **decision sentence** only. Raw field values and value tables
  stay owned by the existing components + `formatFieldValue` — narration does not
  re-render values (that would duplicate the diff tables).
- Server-path imports into `$shared` are **type-only** (established precedent: drift
  client components import `$sync/drift/types.ts` type-only), so no server runtime leaks
  into the client bundle.

## Module & File Layout

New files (all pure TS except the one Svelte renderer; each well under the ~500-line cap):

| Path                                                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/shared/narration/types.ts`                 | Pure narration contracts. Type-only imports of existing diff types; never redefines them. Exports `NARRATION_TEMPLATE_VERSION`, `NarrationLevel`, `NarrationLine`, `NarrationTone`, `NarrationProvenance` (forward seam).                                                                                                                                                     |
| `packages/praxrr-app/src/lib/shared/narration/templates.ts`             | Versioned template registry — the single place features register phrasing. Action verbs (create/update/delete/unchanged as decisions), field-change verbs per `FieldChange.type`, per-`arrType` entity/field label maps keyed `(arrType, entityType, section, field)` with literal/structural fallback, drift-category + `DriftReason` explanation sentences, section labels. |
| `packages/praxrr-app/src/lib/shared/narration/narrate.ts`               | The pure engine. `narrateEntityChange`, `narrateEntityChanges` (reuse seam), `narrateDriftEntity`, `narrateDriftReason`, `narrateSyncError`.                                                                                                                                                                                                                                  |
| `packages/praxrr-app/src/lib/shared/narration/index.ts`                 | Barrel: re-exports `narrate.ts` + `types.ts` + `NARRATION_TEMPLATE_VERSION`.                                                                                                                                                                                                                                                                                                  |
| `packages/praxrr-app/src/lib/client/ui/narration/NarrationBlock.svelte` | Dumb presentational renderer. Props `{ line, verbose, tone? }`. Headline always; `detail[]` only when verbose. Svelte 5 no-runes (`$:` from props, `on:click` toggle owned by host).                                                                                                                                                                                          |
| `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`        | Deno unit tests for the pure engine (`@std/assert`, `$shared` alias).                                                                                                                                                                                                                                                                                                         |

Edited in place (additive: a toggle + a `NarrationBlock`; no behavior removed):

| Path                                                               | Edit                                                                                                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.../routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`      | Add a "Decision Log" summary/verbose toggle (`let verbose = false`, `on:click`); render a section-level narration rollup. Reuses the already-fetched `preview: SyncPreviewResult`.                 |
| `.../routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte` | Add a one-line `NarrationBlock` rationale header above the existing raw field table (value table unchanged).                                                                                       |
| `.../routes/drift/[instanceId]/+page.svelte`                       | Replace raw `Reason: {detail.reason}` (`+page.svelte:164`) with `narrateDriftReason`; add per-entity `NarrationBlock` above each `DriftFieldDiff` for drift/missing/unmanaged; add verbose toggle. |
| `.../lib/client/ui/drift/DriftFieldDiff.svelte`                    | Host slot for the per-entity narration header (badge/label ownership stays with `driftStatus.ts`).                                                                                                 |

## Type Contracts

```ts
// $shared/narration/types.ts
// Type-only imports; the engine consumes existing atoms verbatim.
import type {
  EntityChange,
  FieldChange,
  SyncPreviewArrType,
  SyncPreviewSection,
} from '$sync/preview/types.ts';
import type {
  DriftEntityChange,
  DriftReason,
  DriftStatus,
} from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';

/** Bump alongside any feature that changes phrasing. Stamped onto every NarrationLine. */
export const NARRATION_TEMPLATE_VERSION = '1';

export type NarrationLevel = 'summary' | 'verbose';

/** Drives NarrationBlock styling; reuses the Tailwind palette already used by drift/preview. */
export type NarrationTone = 'neutral' | 'info' | 'warning' | 'danger';

/**
 * The unit of narration. `headline` is the always-shown decision sentence;
 * `detail` lines render only in verbose mode. `templateVersion` is always stamped.
 */
export interface NarrationLine {
  readonly headline: string;
  readonly detail: readonly string[];
  readonly tone: NarrationTone;
  readonly templateVersion: string;
}

/**
 * Forward seam for resolved-config (#25). Defined now, unwired this PR: lets a later
 * change attach base/user/override provenance to a field's narration without an engine
 * signature change.
 */
export type NarrationProvenance = 'base' | 'user-override' | 'database-default';
```

```ts
// $shared/narration/templates.ts
import type {
  FieldChange,
  SyncPreviewArrType,
  SyncPreviewSection,
} from '$sync/preview/types.ts';
import type { EntityChange } from '$sync/preview/types.ts';
import type { DriftCategory, DriftReason } from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';

export const NARRATION_TEMPLATE_VERSION = '1';

/** create/update/delete/unchanged framed as a decision verb. */
export function resolveActionPhrase(action: EntityChange['action']): string;

/** added='set to', changed='changed from A to B', removed='cleared'. */
export function resolveFieldVerb(type: FieldChange['type']): string;

/**
 * Per-arr label. Keyed (arrType, entityType, section, field); unmapped field falls back to
 * the RAW field name — never a borrowed sibling-Arr label (STRUCTURAL fallback).
 */
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

/** Full-sentence explanation for a drift reason, e.g. unreachable → "Praxrr could not reach…". */
export function resolveReasonExplanation(
  status: DriftSummaryStatus,
  reason: DriftReason | null
): string;

/** drift/missing/unmanaged phrasing. */
export function resolveDriftCategoryPhrase(category: DriftCategory): string;
```

```ts
// $shared/narration/narrate.ts — the PURE engine (no I/O, no fetch, no re-diff)
import type {
  EntityChange,
  SyncPreviewArrType,
  SyncPreviewSection,
} from '$sync/preview/types.ts';
import type { DriftEntityChange, DriftReason } from '$sync/drift/types.ts';
import type { DriftSummaryStatus } from '$sync/drift/responses.ts';
import type { NarrationLevel, NarrationLine } from './types.ts';

/**
 * Narrate a single sync-preview entity change as a decision.
 * summary → one headline (empty detail). verbose → headline + one detail line per FieldChange.
 * `unchanged` and trivial single-field updates collapse (the "don't over-explain" rule).
 */
export function narrateEntityChange(
  change: EntityChange,
  arrType: SyncPreviewArrType,
  section: SyncPreviewSection | null,
  level: NarrationLevel
): NarrationLine;

/**
 * The named reuse seam: narrate a batch of entity changes for one (arrType, section).
 * Consumed by both surfaces now and by #20 server-side logging later (same templates → logger.meta).
 */
export function narrateEntityChanges(
  changes: readonly EntityChange[],
  arrType: SyncPreviewArrType,
  section: SyncPreviewSection | null,
  level: NarrationLevel
): readonly NarrationLine[];

/** Drift-detail entity narration; consumes DriftEntityChange verbatim (already carries section/category). */
export function narrateDriftEntity(
  change: DriftEntityChange,
  arrType: SyncPreviewArrType,
  level: NarrationLevel
): NarrationLine;

/** Failure-reason explanation for a drift instance (Done-When "failure reasons"). */
export function narrateDriftReason(
  status: DriftSummaryStatus,
  reason: DriftReason | null,
  level: NarrationLevel
): NarrationLine;

/** Failure explanation for a coarse SyncResult error string; null → generic safe sentence. */
export function narrateSyncError(
  error: string | null,
  level: NarrationLevel
): NarrationLine;
```

Notes:

- Every returned `NarrationLine` carries `templateVersion === NARRATION_TEMPLATE_VERSION`.
- The engine deliberately does not re-render `FieldChange.current` / `.desired` values —
  it names the decision (`resolveFieldVerb` + `resolveFieldLabel`); the existing diff
  tables keep rendering raw values via `formatFieldValue`.

## API Contract

**No new endpoint, no OpenAPI change, no `v1.d.ts` regeneration.**

Contract-first review outcome: the two required inputs are **already delivered** by
existing endpoints —

- `GET /api/v1/sync/preview/{previewId}` → full `SyncPreviewResult` (fetched at
  `SyncPreviewPanel.svelte:251`).
- `GET /api/v1/drift/{instanceId}` → `DriftDetailResponse` (carries `arrType`, `reason`,
  `status`, `drift`/`missing`/`unmanaged`).

Because narration is a pure client-side derivation of data the client already holds, a
`/narration` transport would be redundant (all three judges penalized Proposal 1's
endpoint for exactly this). The `narrateEntityChanges` seam keeps the door open: if a
**non-UI** consumer (e.g. a webhook or export) ever needs server-rendered narration, add
a contract-first `/api/v1` endpoint then — not now.

## UI Surface

1. **Sync preview** (`/setup/preview-sync`, `/arr/[id]/sync` via `SyncPreviewPanel`):
   - A "Decision Log" block with a single **summary/verbose toggle** (`let verbose`,
     `on:click`; summary is default). Section rollup rendered from the already-fetched
     `SyncPreviewResult`.
   - Per-entity `NarrationBlock` rationale header inside `SyncPreviewEntityDiff` sitting
     above the existing raw field table.
   - Error state narrates known failures via `narrateSyncError`.
2. **Drift detail** (`/drift/[instanceId]`):
   - Raw `Reason: {reason}` replaced by the `narrateDriftReason` sentence.
   - Verbose toggle; per-entity `NarrationBlock` above each `DriftFieldDiff` for the
     drift / missing / unmanaged sections. `driftStatus.ts` keeps owning the short badge.
3. **`$ui/narration/NarrationBlock.svelte`** — reusable renderer future surfaces (jobs,
   upgrades, notifications) drop in unchanged.

Conventions honored: Svelte 5 **no runes** (`$:`, `on:click`, local `let`), `alertStore.add`
for any fetch error surfacing, routes-over-modals (no new modal). Verbose state is
per-panel local (`let`), not persisted — acceptable for v1.

## Cross-Arr Handling

Strict per the repo policy: every `narrate*` function takes an **explicit** `arrType`
(present on `SyncPreviewResult.arrType` and `DriftDetailResponse.arrType`) — nothing is
inferred from a sibling app, and there is no sibling fallback.

- Template labels are keyed `(arrType, entityType, section, field)`. An unmapped field
  degrades to its **raw field name** (STRUCTURAL/literal fallback) — never a borrowed
  radarr/sonarr/lidarr label. Unknown reasons/errors degrade to a generic safe sentence.
- Radarr/Sonarr/Lidarr phrasing lives in **separate** map entries; divergent domain
  semantics (e.g. delay-profile, quality-profile naming) resolve per Arr.
- Unit tests assert the same field name under `radarr` vs `sonarr` yields the arr-specific
  label, and that unknown fields fall back to the literal name (cross-Arr guard).

## Data & Persistence

**None.** Narration is a pure derivation of already-computed, already-cached diff data.
No migrations, no new tables, no persisted narration. The diff itself is already persisted
where it needs to be (the sync-preview store snapshot; the one-row-per-instance drift
record). This matches the issue's "prefer pure derivation over persistence" and
"PCD ops model is inherently auditable — surface it" guidance.

## Testing Strategy

Pure Deno unit tests at
`packages/praxrr-app/src/tests/shared/narration/narrate.test.ts` (mirrors
`src/tests/shared/thresholdState.test.ts`; `@std/assert`; `$shared` alias). Driven by
inline fixture `EntityChange` / `DriftEntityChange` records — no I/O, no fetch.

Cases:

- `narrateEntityChange` for create/update/delete/unchanged at **both** levels: summary =
  one headline + empty `detail`; verbose = headline + one `detail` line per `FieldChange`.
- **"Don't over-explain"**: `unchanged` and a trivial single-field update stay terse — no
  verbose noise beyond the single decision line.
- Field pluralization ("1 field differs" vs "N fields differ").
- Each `FieldChange.type` maps to its verb (added/changed/removed) with distinct text.
- **Cross-Arr guard**: same field name under `radarr` vs `sonarr` → arr-specific label;
  unmapped field → raw field name (no sibling borrow).
- `narrateDriftReason` returns a distinct sentence for every `DriftReason` and for
  `never-checked` / `in-sync` / `drifted` statuses.
- `narrateSyncError` maps `null` and arbitrary strings to safe sentences (never throws).
- `narrateEntityChanges` batch = per-entity lines, non-`unchanged` only in summary.
- Every `NarrationLine.templateVersion === NARRATION_TEMPLATE_VERSION`.

Gates: `deno task check` (type-checks the tests, which type-check the route/component
imports) and `lint-docs` (this design doc — markdownlint + prettier). `deno task test
narration` alias expected (not CI-gated but run locally). Manual: load a sync preview and
`/drift/[instanceId]`, toggle verbose on both.

## Risks & Mitigations

| Risk                                                                                      | Mitigation                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-path (`$sync/*`) imports into `$shared` leak server runtime into the client bundle | Keep **type-only** imports (established drift precedent); barrel exports only pure functions/data.                                                                                |
| Field-label coverage initially partial                                                    | Literal/structural fallback keeps output **correct-but-plain** — never wrong, never a cross-Arr borrow. Value is incremental.                                                     |
| `NARRATION_TEMPLATE_VERSION` discipline is convention, not CI-enforced                    | Documented in `templates.ts` module doc so feature PRs bump it; low blast radius (stamp only).                                                                                    |
| Scope creep: `narrate.ts` starts re-rendering values and duplicates the diff tables       | Hard rule: engine emits **decision sentences** only; value rendering stays in the components via `formatFieldValue`. Enforced in review + tests.                                  |
| Two surfaces + ~4 in-place edits is the largest diff among proposals                      | Each edit is strictly additive (toggle + `NarrationBlock`); if the PR must shrink, keep the **drift** surface (it delivers the failure-reason dimension) over trimming elsewhere. |
| `NarrationProvenance` ships defined-but-unwired (mild YAGNI)                              | Documented as a forward seam for #25; zero runtime cost; reviewers told not to expect the resolved-config surface yet.                                                            |

## Out of Scope (follow-ups)

- **`formatFieldValue` consolidation** — `SyncPreviewEntityDiff.formatValue`
  (`SyncPreviewEntityDiff.svelte:68`) duplicates `$ui/resolved/fieldChangeDisplay.formatFieldValue`.
  Land as a **separate, isolated** dedup PR that keeps a re-export, to protect the
  resolved-config panels (`ResolvedStatePanel`, `LiveDiffPanel`, `CrossInstanceGrid`).
- **Server-side decision logging (#20)** — emit a narrated summary via `logger.info(meta)`
  from `BaseSyncer.sync()` / the preview orchestrator using the `narrateEntityChanges` seam.
- **Resolved-config "why" (#25)** — wire `NarrationProvenance` from
  `$pcd/resolved/*` (base/user/override) into per-field narration.
- **Post-apply sync-result narration** — narrate what actually happened vs previewed once
  `SyncResult` carries per-entity outcomes (today it is coarse: success/itemsSynced/error).
- **Inline documentation / tooltips (#17)** tying narration to entity docs.
- **Narrating jobs, upgrade engine, rename processor, notifications** — same
  `NarrationBlock` + engine plug in later.
- **Persisted verbose preference** across sessions via `$stores`.
- **i18n / localization** of templates; exhaustive per-`arrType` field-label coverage.
- **A server `/api/v1/.../narration` endpoint** — only if a non-UI consumer needs it.

## Rejected Alternatives

- **Proposal 1 — server engine + `GET /api/v1/sync/preview/{previewId}/narration`.**
  Cleanest architectural mirror of drift and the most granular cross-Arr keying, but it
  adds a contract-first, prettier-gated OpenAPI endpoint to **re-serve data the client
  already fetches** (`SyncPreviewPanel.svelte:251`), couples narration to preview TTL
  (post-expiry 404), covers only one surface, and explicitly **defers error
  explanations** (a Done-When item). Its best ideas (granular `(arrType, entityType,
section, field)` keying + STRUCTURAL fallback, the `narrateEntityChanges` seam, the
  version-bump discipline, server-importability) are **grafted** without paying for the
  endpoint. Aggregate judge total: lowest.
- **Proposal 3 — Decision Log engine that also relocates `formatFieldValue` into
  `$shared`.** Strongest conceptual framing (adopted) and a real DRY win, but bundling a
  cross-layer relocation of the resolved-config value formatter into a feature PR is scope
  creep that touches `ResolvedStatePanel` / `LiveDiffPanel` / `CrossInstanceGrid`. We
  adopt its framing + `NarrationProvenance` seam and **defer** the relocation to its own PR.

## Final Scope (post-critique, authoritative)

The design critique (`design-critique.md`) raised two blocking items and five should-fixes,
all accepted. This section is the binding contract for implementation.

### Accepted changes

- **B1 — pure rollup function (accepted).** Add a pure `narrateDriftCounts(counts, status,
level)` that consumes the drift `DriftCounts` and returns a `NarrationLine` rollup
  headline. The rollup is produced by the engine and unit-tested — never re-tallied inline
  in a component.
- **B2 — one surface (accepted).** Ship the **drift-detail surface only**
  (`/drift/[instanceId]`). It uniquely delivers the Done-When "failure reasons" dimension
  via `narrateDriftReason`. The **sync-preview surface** (`SyncPreviewPanel`,
  `SyncPreviewEntityDiff`) is deferred to a follow-up, along with `narrateSyncError`,
  `narrateEntityChanges`, and `narrateSummary` (they only serve that surface).
- **S1 — safe error narration (accepted, deferred).** `narrateSyncError` is deferred with
  the sync surface. When it lands: map only `null`/empty to a generic sentence; frame the
  raw error verbatim in a neutral wrapper; never substring-match arbitrary cross-Arr text.
- **S2 — single version source (accepted).** `NARRATION_TEMPLATE_VERSION` is declared once
  in `types.ts`; `templates.ts` imports it; the barrel re-exports it. No second `export const`.
- **S3 — one entity-narration core (accepted).** `narrateDriftEntity` normalizes a
  `DriftEntityChange` (which is `EntityChange` + `section` + `category`) and **delegates to
  the single `narrateEntityChange` core**; the drift category only adds a prefix/tone. No
  parallel phrasing path.
- **S4 — correct gates (accepted).** `deno task check` runs both `check:server`
  (`deno check`, which excludes routes) and `check:client` (`svelte-check`, which type-checks
  `.svelte`). The edited `.svelte` components are covered by `check:client`. Engine unit-test
  coverage is scoped to `narrate.ts` / `templates.ts` / `types.ts` (pure).
- **S5 — badge vs sentence ownership (accepted).** The short status badge stays owned by
  `driftStatus.ts`; `NarrationBlock` renders the sentence only. Action/category labels are
  sourced from one place; no duplicate label computation in components.

### Files that ship in this PR

New:

- `packages/praxrr-app/src/lib/shared/narration/types.ts`
- `packages/praxrr-app/src/lib/shared/narration/templates.ts`
- `packages/praxrr-app/src/lib/shared/narration/narrate.ts`
- `packages/praxrr-app/src/lib/shared/narration/index.ts`
- `packages/praxrr-app/src/lib/client/ui/narration/NarrationBlock.svelte`
- `packages/praxrr-app/src/tests/shared/narration/narrate.test.ts`

Edited (drift surface only, strictly additive):

- `packages/praxrr-app/src/routes/drift/[instanceId]/+page.svelte` — replace the raw
  `Reason:` line with `narrateDriftReason`; add a `narrateDriftCounts` rollup headline with
  a summary/verbose toggle; add a per-entity `NarrationBlock` above each `DriftFieldDiff`.
- `packages/praxrr-app/src/lib/client/ui/drift/DriftFieldDiff.svelte` — only if a host slot
  is needed for the per-entity narration header; otherwise the header is rendered by the
  page around the existing component and this file is left untouched.

### Engine surface that ships in this PR

- `narrateEntityChange(change, arrType, section, level)` — the single reusable core
  primitive (exported + unit-tested; the delegation target for drift).
- `narrateDriftEntity(change, arrType, level)` — normalizes + delegates to
  `narrateEntityChange`; adds category prefix/tone.
- `narrateDriftReason(status, reason, level)` — user-facing failure-reason sentence.
- `narrateDriftCounts(counts, status, level)` — rollup headline (B1).
- `templates.ts` resolvers: `resolveActionPhrase`, `resolveFieldVerb`,
  `resolveFieldLabel(arrType, entityType, section, field)`, `resolveEntityLabel`,
  `resolveDriftCategoryPhrase`, `resolveReasonExplanation`.

Deferred to the sync-preview follow-up PR: `narrateSyncError`, `narrateEntityChanges`,
`narrateSummary`, and the `SyncPreviewPanel` / `SyncPreviewEntityDiff` edits.
