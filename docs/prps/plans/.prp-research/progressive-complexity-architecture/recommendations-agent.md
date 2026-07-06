# recommendations-agent — Progressive Complexity Architecture (#29)

Synthesis role: cross-cutting scope, risks, confidence, and completion gates that fall _between_ api/business/tech/ux/security/practices dimensions. Foundation-only (types, DB, queries, API, store, $ui context, reference integration on 1–2 sections) — not a full rollout.

## Notes

- **Confidence in RECOMMENDED DIRECTION: HIGH.** Layering a tier concept _on top of_ the existing `basic|advanced` mode primitive is the right call — the enum is hardcoded in 4 lockstep locations (`sectionKeys.ts:12`, migration `CHECK (mode IN ('basic','advanced'))` `050_...ts:14`, runtime `parseMode`/`isUiPreferenceMode` `+server.ts:233`/`userInterfacePreferences.ts:96`, generated `v1.d.ts:1273`), so breaking it is expensive. Prior research already scoped this exact feature as "User preference profiles (Beginner/Intermediate/Advanced)" in `enhance-progressive-disclosure/research-recommendations.md:257-262` (Phase 3.4) — reuse that framing.
- **UNDER-SPECIFIED (biggest confidence gap): tier→mode-default mapping.** 2 modes cannot represent 3 tiers 1:1. Beginner→`basic` default, Advanced→`advanced` default are obvious; **Intermediate has no distinct render** in the 2-mode `AdvancedSection.svelte` (`mode === 'advanced'` is the only branch, `AdvancedSection.svelte:35`). Plan MUST define Intermediate semantics (likely: "per-section persistence honored / no tier-forced default"). Resolve before Phase 2.
- **UNDER-SPECIFIED: granularity axis.** Issue #29 says both "per-section granularity" AND "per-user per-section state". A tier that is itself per-section-key is nearly redundant with the existing per-section mode. More coherent model: **one tier per user (or per section-family), driving per-section-key mode _defaults_, with `mode` remaining the per-section override**. Plan must pick: global-tier vs per-family-tier vs per-section-tier. Recommend global-or-family.
- **UNDER-SPECIFIED: activity counters.** "automatic progression via subtle suggestions" needs a defined storage location (new table vs column), increment trigger (page visit? toggle? save?), and threshold. None exist today. Keep heuristic dead-simple (counter + threshold), no ML.
- **UNDER-SPECIFIED: reset semantics.** "reset lowers tier" — unclear whether it also clears explicit per-section `mode` overrides. Define explicitly (recommend: reset tier only, preserve/confirm before clearing overrides).
- **Orientation:** `mode` is the single source of truth for what actually renders. Tier is a _defaults driver_. Server hydration path to mirror: `loadSectionModes(locals.user?.id, KEYS)` (`loadSectionModes.ts:9`) → `+page.server.ts` data → store seed (`custom-formats/[databaseId]/[id]/general/+page.server.ts:48`). Post-050 migrations use **date-based `YYYYMMDD_` naming**, not `051_` (`migrations.ts:55-69`).

## NOT Building (cross-cutting)

- **Full #12 Setup Wizard** — separate feature; this only lays the tier foundation it will later consume.
- **Full rollout across all ~15 route families** — reference integration on 1–2 sections only; prior recs list ~12 pages as Phase 2/3 (`enhance-progressive-disclosure/research-recommendations.md:184-234`).
- **ML / predictive / behavioral-model progression** — only a simple activity-counter + threshold heuristic; anything smarter is out.
- **#20 Quality Goals abstraction** (goals-as-beginner-scoring) — related but a distinct domain feature, not part of the UI-tier plumbing.
- **Changing/extending the `basic|advanced` mode enum values** — tier is additive; the mode primitive stays 2-valued to avoid breaking the 4 lockstep contract sites.
- **Forced/automatic tier promotion** — issue #29 says "never forced"; suggestions only, user-confirmed. Auto-applying a tier change is out.
- **Anonymous / AUTH=off tier _persistence_** — no `users` row → no FK target; anonymous gets deterministic default tier + defaults only, no DB writes (mirrors existing `docs/features/progressive-disclosure.md:76`).
- **Expand-all / collapse-all, deep-linking, keyboard shortcuts, badges** — Phase 3 polish from prior recs, not foundation.
- **Admin/org-wide global tier policy** — per-user only for now.
- **Backfilling tier onto existing users' historical activity** — new users/sessions start at default tier; no retroactive computation.

## Risks (cross-cutting)

| Risk                                                                                                                                   | Likelihood | Impact | Mitigation                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two overlapping concepts (3-tier vs 2-mode) confuse users AND devs; unclear which wins                                                 | High       | High   | Define tier as _defaults-driver_ only; `mode` stays single source of truth for render; document the relationship in `docs/features`; one section (Notes) states "tier sets default, mode overrides". |
| Intermediate tier has no distinct render in the 2-mode component → dead/ambiguous state                                                | High       | Medium | Lock Intermediate semantics in plan (e.g. "honor per-section persistence, no tier-forced default") before coding the reference integration.                                                          |
| Anonymous / AUTH=off users have no `user_id` FK → tier can't persist; risk of 500s or lost state                                       | Medium     | Medium | Deterministic default tier (Beginner) for `!locals.user`; server helper returns tier-derived defaults with no user; no DB writes; API returns default record like existing GET (`+server.ts:70`).    |
| SSR hydration mismatch → flash of wrong complexity on first paint                                                                      | Medium     | Medium | Add a `loadUserTier(locals.user?.id)` server helper mirroring `loadSectionModes`; pass via `+page.server.ts` data; seed store from SSR value so first render matches.                                |
| Contract drift: tier added to OpenAPI/`v1.d.ts` but not runtime validators, or vice-versa (4 lockstep sites)                           | Medium     | High   | Define tier enum/field in shared constants (like `sectionKeys.ts`); update OpenAPI + regenerate `v1.d.ts` + runtime parse/guard + migration `CHECK` in one change; add a contract/round-trip test.   |
| "Must design before Phase 2" sequencing: shipping foundation with an ambiguous tier→mode contract bakes rework into every future route | Medium     | High   | Freeze tier→mode-default mapping + granularity decision in THIS plan; validate on 1–2 reference sections before any broader rollout.                                                                 |
| New migration not registered in `migrations.ts` (import + array) → table missing at runtime                                            | Low        | High   | Follow date-based `YYYYMMDD_` convention; add both import and array entry (mirrors `migration050` at `migrations.ts:54`,`:350`).                                                                     |
| New tier store doesn't clear on auth change → next user inherits prior user's tier                                                     | Medium     | Medium | Mirror `userInterfacePreferencesStore.clearOnAuthChange` (`userInterfacePreferences.ts:82`); hook tier store into the same logout/auth-change reset.                                                 |
| `reset lowers tier` silently discards explicit per-section advanced overrides → feels like data loss                                   | Medium     | Low    | Define reset scope (tier-only vs full); confirm before clearing overrides.                                                                                                                           |
| Tier + activity counters not covered by backup/restore expectations (open question in prior recs)                                      | Low        | Low    | Decide inclusion/exclusion explicitly; document as ephemeral or backed-up.                                                                                                                           |

## Completion Checklist additions

- [ ] Tier→mode-default mapping and granularity axis (global vs per-family vs per-section) are explicitly documented in the plan before implementation.
- [ ] `deno task generate:api-types` re-run and the regenerated `packages/praxrr-app/src/lib/api/v1.d.ts` committed (only if OpenAPI touched).
- [ ] Any new tier enum/field is defined once and kept in lockstep across: OpenAPI `openapi.yaml`, generated `v1.d.ts`, runtime validators (`+server.ts` parse fns, store type guards), and migration `CHECK` constraint.
- [ ] New migration created with date-based `YYYYMMDD_` name AND registered in `migrations.ts` (import + array entry, sequential after existing latest).
- [ ] `seedBuiltInBaseOps.ts` confirmed **N/A** (tier state is app-DB, not PCD base ops) with a one-line rationale — no PCD op added.
- [ ] `deno task generate:pcd-types` confirmed **N/A** (PCD schema unchanged).
- [ ] Existing basic/advanced disclosure still passes: `loadSectionModes.test.ts` + `/api/v1/ui-preferences` route tests green; reference sections still toggle correctly.
- [ ] Anonymous / AUTH=off path verified: deterministic default tier, zero DB writes, no 500s from tier read/write.
- [ ] SSR hydration verified on the reference section(s): correct tier on first paint, no basic→advanced flash.
- [ ] New tier store clears on auth change (verified alongside `clearOnAuthChange`).
- [ ] `docs/features/progressive-disclosure.md` (or new `progressive-complexity.md`) updated to document tier↔mode relationship and reset behavior.
- [ ] e2e spec added covering tier switch → section default change on the reference section(s).
- [ ] `deno task test`, `deno task lint`, `deno task check` all green.
