# Setup Wizard (#12) — Cross-Cutting Recommendations Synthesis

> Feeds the ycc:prp-plan synthesizer. Scope: what falls *between* the single-dimension
> research tracks (security / technical / UX / business / practices). Does NOT restate
> per-dimension findings — surfaces the seams where they interact.

## Notes

- **Phase so `main` stays always-green: land the P0 gating spine first, before any reuse
  phase.** The thinnest end-to-end slice is a wizard you can *enter, skip, and complete
  with no real steps* — migration + `setupStateQueries` extensions + `getSetupProgress()`
  + `hooks.server.ts` gate/reverse-gate + `/setup/welcome` + `/setup/done` + Skip action +
  auth-mode matrix tests. Every later step folder (`connect-arr`, `link-database`,
  `select-profiles`, `preview-sync`) is skipped by the server-side step resolver until it
  exists, so partial merges never strand a first-run user. This is the single most
  load-bearing sequencing decision in the plan.
- **Server-authoritative current step, everywhere.** The step is resolved from persisted
  facts (`wizard_completed` flag + `getSetupProgress()` derived from
  `arrInstancesQueries.getAll()` / `databaseInstancesQueries.getAll()` / `arrSyncQueries`),
  computed *identically* in `hooks.server.ts` (gate) and `routes/setup/+layout.server.ts`
  (resolver). Factor the resolver into one pure `$server/setup/progress.ts` module and call
  it from both — two copies of the "which step" logic is the drift bug waiting to happen.
  The client store (`$stores/`) holds transient form values only, never the source of truth.
- **Contract-first is a hard ordering constraint, not a preference.** Add the `Setup` tag +
  `/api/v1/setup/*` paths/schemas to `docs/api/v1/openapi.yaml`, run
  `deno task generate:api-types`, then import from `$api/v1.d.ts` in the handlers — *before*
  writing handler bodies. Reversing this order (hand-written types first) guarantees a
  `deno task check` failure later and a re-do. This is one task boundary, not a side note.
- **The migration must be statically registered, not filesystem-scanned.** Create
  `db/migrations/<YYYYMMDD>_add_setup_wizard_state.ts` with the next unused integer
  `version` (mirror the existing `20260221_encrypt_arr_api_keys.ts` shape / `Migration`
  type in `db/migrations.ts:72`), then add both the `import` and the `loadMigrations()`
  entry in `migrations.ts`. The runner does not scan the directory — a file that isn't
  registered simply never runs, and this failure is silent (no error, wizard just never
  gets its columns). Verify by applying against a fresh DB.
- **`getSystemStatus()` + `assertSafeArrUrl()` are shared surfaces — land them once, wire
  them into both callers in the same change.** `assertSafeArrUrl()` (new `$arr/urlSafety.ts`)
  must be called by both the new `POST /api/v1/setup/test-connection` *and* the existing
  `routes/arr/test/+server.ts`; `getSystemStatus()` is added to `$utils/arr/base.ts` while
  keeping the boolean `testConnection()` wrapper for existing callers. Adding SSRF guarding
  to only the wizard path leaves the pre-existing hole open and violates the "hardens an
  existing hole" framing — do both or the security value is half-captured.
- **Run `graphify update .` after the changes land** so the graph reflects the new
  `routes/setup/**`, `$server/setup/progress.ts`, and `$arr/urlSafety.ts` nodes (AST-only,
  no API cost) — per the repo graphify rule.
- **`assertSafeArrUrl` is a narrow deny-list, not an allow-list.** Self-hosted Arr instances
  legitimately live on RFC1918 LAN addresses; deny only cloud-metadata (`169.254.169.254`,
  `fd00:ec2::254`), link-local, `0.0.0.0`, non-`http(s)` schemes, and use `redirect:'manual'`.
  An allow-list breaks the primary use case. This is a cross-cut between security (C3) and
  the core UX goal (connecting a real, LAN-hosted instance).

## NOT Building (cross-cutting)

- **No new sync executor or preview format** — Preview & Sync reuses `POST /api/v1/sync/preview`
  (#7, already rate/body/capacity-limited) and the existing `apply` path + render components.
  Rationale: #7 is done and hardened; a second preview surface doubles the maintenance and
  test burden for zero new capability.
- **No new instance-create / DB-link / profile-save logic** — steps write through
  `arrInstancesQueries.create`, `pcdManager.link`, `arrSyncQueries.saveQualityProfilesSync`.
  Rationale: forking these drifts from the canonical routes (R5) and re-opens per-Arr
  semantic validation already solved there.
- **No local-path PCD linking in the wizard (git-URL-only)** — local-path linking stays in
  the authenticated Databases UI. Rationale: closes security C4 (pre-auth arbitrary-directory
  read) without adding root-confinement scope to this feature.
- **No widening of `PUBLIC_PATHS`** — `/setup` reachability is special-cased like
  `/auth/setup`, and every `/api/v1/setup/*` handler self-guards. Rationale: `PUBLIC_PATHS`
  placement is *routing*, not *authorization*; conflating them is exactly security C1.
- **No hard redirect from `/` for incomplete wizard** — reverse-gate `/setup` for
  done/skipped users and nudge via a dismissable banner instead. Rationale: a blanket
  redirect traps intentional skippers/power users (R7); only account-creation stays a hard gate.
- **No `schema.sql` edit and no `seedBuiltInBaseOps.ts` change** — state change is a
  migration only; the wizard seeds no PCD base-ops. Rationale: `schema.sql` is reference-only
  per CLAUDE.md; no default-profile seeding means no base-op registration obligation.
- **No independent custom-format selection UI** — CFs follow the chosen profiles, presented
  read-only. Rationale: no per-instance CF table exists; inventing one is out of scope.
- **No telemetry/analytics SaaS** — funnel measurement, if any, is structured `logger.info`
  only, and Phase 5 (non-blocking). Rationale: no telemetry sink exists; adding one is a
  separate decision.
- **No changes to legacy `/arr/new`, `/arr/test` behavior, `/databases/new/custom`** beyond
  adding the shared SSRF guard to `/arr/test`. Rationale: they remain the canonical
  authenticated entry points; the wizard composes, it doesn't replace.

## Risks (cross-cutting)

| Risk | Why it's cross-cutting | Likelihood × Impact | Mitigation |
| ---- | ---------------------- | ------------------- | ---------- |
| Half-wired gate strands first-run users if a reuse phase merges before P0 is landed + test-covered | Gating (security/technical) × first-run detection (business) × always-green (practices) | Med × High | P0 spine lands first with auth-mode matrix + gate-redirect tests; unbuilt steps are resolver-skipped, never exposed |
| Client/server step drift | Two copies of "which step" logic in `hooks.server.ts` and `+layout.server.ts` (technical × UX resume) | Med × Med | Single pure `getSetupProgress()` in `$server/setup/progress.ts`, imported by both; no client-owned step |
| Migration/version collision or silent non-registration | Migration chain (technical) × fresh-deploy correctness (ops) — a wrong `version` or missing `loadMigrations()` entry fails silently | Med × High | Pick next unused integer `version`; register import + `loadMigrations()` entry; verify apply-on-fresh-DB in CI/test |
| Simultaneous blast radius: touches auth middleware + migration chain + PCD manager + sync-preview at once | The four highest-risk subsystems in one feature (security × data × integration) | Med × High | Strict phase gating (P0 → P1 → P4; P2/P3 parallel only after P0); one subsystem-touching PR per phase |
| SSRF guard scoped to wizard only, leaving `/arr/test` open | Security C3 × shared-surface (practices reuse) — guarding one caller misses the pre-existing hole | Med × High | Land `assertSafeArrUrl()` once, wire into *both* `test-connection` and `/arr/test` in the same change |
| `wizard_completed` keyed to auth mode → never runs under `AUTH=off` (or over-runs) | First-run detection (business R3/W6) × auth-mode matrix (security) | Med × Med | Gate on `wizard_completed` flag independent of auth mode; never infer from `existsLocal()` or `default_database_linked` |
| Gate accidentally intercepts `/api/*` | Nav-gate (UX) × API contract (technical) — a page-nav redirect firing on API calls breaks fetch flows | Low × High | Gate is page-navigation only, explicitly excludes `/api/*`; assert in `hooks.server.ts` gate test |
| Env-preseeded state re-prompts duplicates | `reconcileEnvInstances()` / `PRAXRR_DEFAULT_DB_URL` auto-link (config) × idempotent resume (UX) | Med × Med | Steps detect existing entity rows and show "already done"; treat `PRAXRR_DEFAULT_DB_URL=""` as opt-out, not "nothing to link" |

## Completion Checklist additions

- [ ] `deno task check` passes (both `check:server` deno check **and** `check:client` svelte-check)
- [ ] `deno task lint` passes (Prettier check + ESLint)
- [ ] `deno task test setup-wizard` passes (new alias registered in `scripts/test.ts`)
- [ ] At least one Playwright e2e happy-path click-through of the full funnel (`deno task test:e2e`)
- [ ] OpenAPI `Setup` tag + `/api/v1/setup/*` paths added to `docs/api/v1/openapi.yaml`; `deno task generate:api-types` re-run and the regenerated `$api/v1.d.ts` committed
- [ ] Migration applies cleanly on a fresh DB (new `setup_state` columns present), and is statically registered (import + `loadMigrations()` entry in `migrations.ts`)
- [ ] Wizard gate is page-navigation only and never redirects `/api/*` (asserted in gate test)
- [ ] Auth-mode matrix verified: `on` / `local` / `off` / `oidc` — wizard gating correct in each; `AUTH=off` still runs the wizard (keyed on `wizard_completed`, not auth state)
- [ ] `/setup/*` and all `/api/v1/setup/*` handlers reject unauthenticated callers once setup is complete; no `PUBLIC_PATHS` widening
- [ ] `assertSafeArrUrl()` wired into both `POST /api/v1/setup/test-connection` and `routes/arr/test/+server.ts`; SSRF rejection cases (metadata / link-local / `0.0.0.0` / non-http) tested
- [ ] No CORS `Access-Control-Allow-Origin` header on setup endpoints (test guard, security A1)
- [ ] `graphify update .` run after changes land (graph reflects new `routes/setup/**`, `$server/setup/progress.ts`, `$arr/urlSafety.ts`)
- [ ] PR body `Closes #12`
