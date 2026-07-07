# Cross-Arr Parity Map — Recommendations (cross-cutting synthesis)

Feeds `ycc:prp-plan`. Scope: what falls *between* the api/business/tech/ux/security/practices dimensions. Source of truth: `docs/prps/designs/cross-arr-parity-map.design.md` (OQ1–OQ4 already resolved). Grounded facts cite `file:line`.

## Notes

- **One authored layer, everything else derived.** The ONLY net-new support data is `NATIVE_ENTITY_APPS` (native vs shared refinement) in `$shared/arr/parity.ts`; tri-state `unsupported` is *computed* from `supportsArrSyncSurface(type, surface)`. Do NOT introduce a 4th boolean support map — that is the primary anti-drift invariant (design §4, §5.1). Mirror the existing `as const satisfies` pin pattern at `capabilities.ts:167` (`ARR_CAPABILITY_NON_REGRESSION_CHECK`) for `PARITY_NON_REGRESSION_CHECK`.
- **One compatibility algorithm.** `computeCompatibleProfileNames`/`computeProfileCompatibility` in the new `compatibility.ts` is the *single* implementation; `list.ts` (323 lines, `list.ts:59-163`) must delegate to it, not fork it. Both the page load and the API endpoint consume the same server helper — no reimplementation on either side.
- **Two tiers, strict.** Static tier (`parity.ts` + `semanticDifferences.ts`) is client-importable and touches zero DB; PCD cache is read ONLY when `?databaseId=` is explicitly present (design §6.1, §6.3). Keep the static/DB boundary clean or the "zero round-trip matrix" property breaks.
- **CLAUDE.md is wrong twice — trust the design + memory, not CLAUDE.md.** (1) Formatting is `.prettierrc.json` (2-space, single-quote, semicolons, es5 commas, ~120w) — NOT the tabs/100w in CLAUDE.md (memory `prettier-config-vs-claudemd`; design §6.4). (2) Svelte is **legacy-event mode** (`export let`/`$:`/`on:click`/`createEventDispatcher`) — NOT runes/`onclick` (design §6.4, verified against `Badge`/`Button`/`Table`). New code that copies CLAUDE.md conventions will fail lint/review.
- **Deno is not on PATH in non-interactive shells** (memory `deno-toolchain-path`) — prepend `~/.deno/bin` before running `deno task …` verify commands, or they silently fail-to-find.
- **Mandatory Cross-Arr Semantic Validation checklist applies** (CLAUDE.md policy + design §4): the PR body must affirm all four boxes (API semantics per arr_type; schema/field mappings per app; dispatch resolves by explicit `arr_type` with no sibling fallback; migration/import/export fail-fast on ambiguity). The design already structurally satisfies these — the plan must not regress them.
- **OQ1–OQ4 are resolved (do not re-litigate):** OQ1 schema-shape taxonomy (Lidarr quality profiles stay `shared`, audio disjointness is a *warning*); OQ2 preserve `list.ts` enabled-qualities semantics with "based on enabled qualities" copy; OQ3 `profiles` returned iff `?databaseId=` supplied (no auto-resolve); OQ4 all verdicts inline (no pagination).

## NOT Building (cross-cutting)

- **Inline quality-profile-editor "Usable by" indicator** — `CompatibilityBadges.svelte` ships now, but wiring it into the editor's own `+page.server.ts` load is deferred (design §3, §8). This PR is a *disclosed partial* of the issue's component 3.
- **Apply-time interactive migration hints** — MVP ships the *data* (`detail` "explain why" + `suggestion` "suggest alternatives") on the standalone page; the interactive `alertStore.add('warning', …)` wiring into the sync/apply flow (`routes/arr/[id]/sync/+page.server.ts` actions) is deferred (relates to #24).
- **Populating `UNSUPPORTED_SYNC_SECTION_REASONS` / `UNSUPPORTED_MEDIA_MANAGEMENT_SUBSECTION_REASONS`** (`$sync/mappings.ts:37,39`) from the shared catalog — the camelCase `SectionType` ↔ snake_case `ParityEntity` convergence bridge is plan-of-record but deferred (design §3, §8). Note `custom_formats` has no `SectionType`; `quality_definitions` is a subsection.
- **Server-side semantic-fact consolidation** — `transformer.ts`/`delayProfiles/syncer.ts`/`mappings.ts` remain the sync runtime's source; the client catalog does NOT yet feed sync.
- **DB-backed quality-name-level matrix augmentation** — per-`quality_definitions` min/max/preferred-size diffs are out.
- **Ecosystem expansion** — Readarr/Whisparr (#34) and the #24 API Adapter Layer consuming the new endpoint.
- **Pre-login / setup-wizard availability** — the route is auth-gated; NOT added to `PUBLIC_PATHS` (`$auth/middleware.ts`).

## Risks (cross-cutting)

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `list.ts` refactor regresses profile-list filtering (load-bearing: the extract feeds live sync-selection UI, not just the map) | Medium | High | Delegation-only change (`list.ts:59-163` → `compatibility.ts`); delegation-equivalence test asserting identical filtered set pre/post, covering both enabled=1 and zero-enabled arr-specific-score fallback (`list.ts:135-159`) |
| `v1.d.ts` regen emits ~3300 lines of openapi-typescript version noise (`generate:api-types` = `npx openapi-typescript`, `deno.json:69`); CI does NOT gate it | High | Medium | Regenerate deliberately, then scrub to a reviewable diff (only the new schema types) before commit (memory `v1dts-generator-drift`) |
| Multi-source drift — support facts hand-copied instead of derived from `capabilities.ts` | Medium | High | Derive via `supportsArrSyncSurface`; only `native`/`shared` authored; pin with `PARITY_NON_REGRESSION_CHECK` + axis↔capabilities consistency test |
| JSR mirror drift — API contract changed but `packages/praxrr-api/{openapi.json,types.ts}` not regenerated | Medium | Medium | Re-run `deno task bundle:api` (`deno.json:94`) after openapi edits; mirror governance covers `publish-api.yml` |
| `bundle-api.ts` silently drops a `compatibility.yaml` schema file not `$ref`d by ≥1 root `openapi.yaml` entry | Medium | Medium | Register every new schema under root `components.schemas`; verify presence in regenerated bundle |
| Nav icon silently vanishes — `resolveNavIcon` returns `undefined` for an unregistered `iconKey` (`iconMap.ts:28-29`, only ~10 icons today) | Medium | Low | Import + register `LayoutGrid` in `NAV_ICON_MAP` (`iconMap.ts:15`) in the same change as the registry entry |
| Nav entry over-scoped — setting `requiredFeature` hides the app-agnostic map behind the arr-scope selector | Low | Medium | Leave `requiredFeature` UNSET; `arrScope: scopeAll` (design §6.4) |
| Convention confusion from CLAUDE.md — new components authored with runes/`onclick` or tabs | Medium | Medium | Use legacy `export let`/`$:`/`on:click`; run `deno task format` (`.prettierrc.json`, not CLAUDE.md) |
| `quality_definitions` latent false-positive for a future app (derived from coarser `media_management`) | Low | Medium | Explicit bridge to `media_management` + subsection-pin test binding to `isMediaManagementSubsectionSupported(app,'qualityDefinitions')` |
| Deno absent from PATH → verify commands appear to pass/fail spuriously | Medium | Low | Prepend `~/.deno/bin` (memory `deno-toolchain-path`) before `deno task check`/`lint`/`test` |

## Completion Checklist additions

- [ ] `deno task check` green (server `deno check` + client `svelte-check`, `deno.json:63`).
- [ ] `deno task lint` green (`prettier --check . && eslint .`, `deno.json:53`).
- [ ] `deno task format` run so route-dir files and new components match `.prettierrc.json` (2-space/single-quote/semi/es5).
- [ ] `v1.d.ts` regenerated via `deno task generate:api-types` AND scrubbed to a reviewable diff (only new `ParityMapResponse`/`ArrSemanticDifference`/`ProfileCompatibility` types; no ~3300-line tool-version churn).
- [ ] JSR mirror regenerated: `deno task bundle:api` updated `packages/praxrr-api/openapi.json` + `packages/praxrr-api/types.ts` (mirror governance, `publish-api.yml`).
- [ ] Every new `compatibility.yaml` schema registered under root `openapi.yaml` `components.schemas` and confirmed present in the regenerated bundle (bundle-api drops unreferenced files).
- [ ] `LayoutGrid` imported from `lucide-svelte` and registered in `NAV_ICON_MAP` (`iconMap.ts:15`); nav registry entry added with `requiredFeature` UNSET and `arrScope: scopeAll`.
- [ ] New components use Svelte legacy-event mode (no runes / no `onclick` attributes); verified against `Badge`/`Button`/`Table`.
- [ ] Cross-Arr Semantic Validation 4-box checklist affirmed in the PR body (per CLAUDE.md policy + design §4).
- [ ] All three test files green: `parityMap.test.ts` (tri-state truth table + bridge totality + subsection pin + catalog invariants), `qualityProfileCompatibility.test.ts` (extracted-predicate + `list.ts` delegation-equivalence), `parityMapApi.test.ts` (200 no-`databaseId` / 200 with valid id / 400 on bad id).
- [ ] (Optional) `parity` alias added to the `aliases` map in `scripts/test.ts:11` for `deno task test parity`.
- [ ] Deferred scope explicitly disclosed in the PR body (inline editor indicator, apply-time hints, `UNSUPPORTED_*_REASONS` convergence) so reviewers do not read the map as full issue-#14 closure.
