---

# PLAN.md — Issue #28: Ecosystem Security Posture / "Shield Check"

Authoritative design: `docs/internal/security-posture-design.md` (read it; every decision there is final). This plan is the top-to-bottom build order, with all integration snippets inline and verified against the real tree.

## 0. Current state of the worktree (verified — read before starting)

A prior session already landed part of the shared engine. These files **exist and are correct** (untracked / modified, not yet committed) — do **not** recreate them:

| File                                                    | State                                                                                                                                                                                                                                   | Verified                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `packages/praxrr-app/src/lib/shared/scoring/rollup.ts`  | **DONE** — generic `clamp0100`, `WeightedScore<Id extends string>`, `RollupResult<Id>`, `rollUp<Id extends string>` (residual-to-largest-weight + zero-weight equal-weighting fallback)                                                 | matches design §3/§4                       |
| `packages/praxrr-app/src/lib/shared/health/policy.ts`   | **DONE (MODIFIED)** — re-exports `clamp0100`/`rollUp` from `$shared/scoring/rollup.ts`; `WeightedScore`/`RollupResult` aliased to `CriterionId`; keeps `HEALTHY/ATTENTION_THRESHOLD` + `bandFor`. Health public surface byte-identical. | `git status` shows only this file modified |
| `packages/praxrr-app/src/lib/shared/security/types.ts`  | **DONE** — full §5 contract set incl. `SECURITY_POSTURE_ENGINE_VERSION='1'`, `CHECK_IDS`, all interfaces                                                                                                                                | matches §5 verbatim                        |
| `packages/praxrr-app/src/lib/shared/security/policy.ts` | **DONE** — `HARDENED_THRESHOLD=85`, `GUARDED_THRESHOLD=60`, `shieldBandFor`, `capBand` (only `status==='action'` checks, worst `bandCapWhenAction`, numeric score untouched)                                                            | matches §3                                 |
| `packages/praxrr-app/src/lib/shared/security/checks.ts` | **DONE** — `classifyHost`, `buildTransportRows`, `ALL_CHECKS`; **client-safe** (grep confirms NO `$lib/server`/`isLocalAddress` import; RFC1918 logic inlined); imports `NARRATION_TEMPLATE_VERSION` as a **value**                     | client-safety risk already mitigated       |

Everything below is **still to build**. The DRY-refactor risk is therefore already retired in the tree — the Decision Log confirms it rather than re-opening it.

---

## 1. Decision log (resolved calls — do not re-litigate)

1. **DRY `$shared/scoring/rollup.ts` extraction: INCLUDE — already implemented and confirmed safe.** Grep confirms zero tests import `clamp0100`/`rollUp`/`WeightedScore`/`RollupResult`; only `health/engine.ts` and `health/index.ts` consume them, and both keep working because `health/policy.ts` re-exports the generic symbols specialized to `CriterionId`. A security-local copy of the residual-exact rollup math is rejected (violates DRY, invites silent drift between two scoring engines). **Action: keep as-is; prove it with `deno task test config-health`.**

2. **Route response typing: type against the local `responses.ts` mirror, NOT `components['schemas'][…]`.** config-health's route (`routes/api/v1/config-health/summary/+server.ts:7,10`) types against `components['schemas']['ConfigHealthSummaryResponse']` from `$api/v1.d.ts`. The security route **deliberately diverges**: `import type { SecurityPostureSummaryResponse } from '$lib/server/security/responses.ts'` and `return json(payload satisfies SecurityPostureSummaryResponse)`. Reason: a full `v1.d.ts` regen adds ~3300 lines of tool-version noise and is not CI-gated; re-exporting schemas into `openapi.yaml` does **not** populate the generated `v1.d.ts`, so `components['schemas']['SecurityPostureSummaryResponse']` would not exist. `responses.ts` is the hand-written source of truth the YAML mirrors (Portable Contract Fidelity). This matters because `tests/routes/securityPosture.test.ts` imports the handler and `deno test` type-checks it (routes are excluded from `deno check`).

3. **Client-safety of the shared engine: never import `$lib/server` into `$shared/security/*`.** `isLocalAddress` lives at `$lib/server/utils/auth/network.ts:25` (a server module). `checks.ts` already inlines the RFC1918/loopback literal logic. Keep it that way — SvelteKit hard-fails the app-build gate on any `$lib/server` import reaching client code.

4. **`narrate.ts` `sortSuggestions`: add it, consume it ONLY in the new security engine; leave `health/engine.ts` untouched.** `narrate.ts` currently has no `sortSuggestions`; the comparator lives inline in `health/engine.ts:25-42` (`TONE_SEVERITY` desc, then `headline.localeCompare`). Export a pure `sortSuggestions` (+ shared `TONE_SEVERITY`) from `narrate.ts` and use it in the security engine for deterministic recommendation/`topActions` tone-tie-break ordering. Do **not** refactor `health/engine.ts` to delegate — `deno test` is not CI-gated, so touching the #22 engine snapshot buys risk with no CI safety net. This keeps blast radius to one new export.

5. **No persistence.** DEFINITIVE (design §4): NO migration, NO settings table, NO settings PUT/GET, NO recurring job, NO snapshot/trends. Compute on-demand at the summary route only. (Also sidesteps the date-based migration-version-collision hazard.)

6. **No secret ever leaves `gather.ts`.** Only presence booleans (`appApiKeyPresent`, `appApiKeyStrong` via `length>=32`), host strings (`instance.url`, never `external_url`), and key-version strings. The api-key value is read for length then discarded.

---

## 2. Dependency-ordered build steps

Build in this order. Each `$shared` file must be pure (no I/O, no `Date`, no `Math.random`) and client-safe.

### Step 1 — `packages/praxrr-app/src/lib/shared/narration/narrate.ts` (MODIFY)

Add a pure export (mirror the comparator already in `health/engine.ts:25,38-41` exactly). Requires importing `NarrationLine`/`NarrationTone` types (already used in the module).

```ts
/** Tone → severity rank for ordering suggestion/recommendation lines (shared by health + security). */
export const TONE_SEVERITY: Record<NarrationTone, number> = {
  neutral: 0,
  info: 1,
  warning: 2,
  danger: 3,
};

/** Stable ordering for narration lines: highest tone-severity first, then headline A→Z. Pure, no mutation of input. */
export function sortSuggestions(
  lines: readonly NarrationLine[]
): NarrationLine[] {
  return [...lines].sort((a, b) => {
    const severity = TONE_SEVERITY[b.tone] - TONE_SEVERITY[a.tone];
    return severity !== 0 ? severity : a.headline.localeCompare(b.headline);
  });
}
```

Leave `narrateEntityChange`/`narrateDriftEntity`/etc. and all `import type { … } from '$sync/*'` (erased) unchanged — the module stays client-safe.

### Step 2 — `packages/praxrr-app/src/lib/shared/security/catalog.ts` (CREATE)

`CHECK_CATALOG: readonly CheckMeta[]` — one `{ id, label, description }` per check in `CHECK_IDS` order (incl. `log_redaction`). Client imports it directly (there is no settings route). Mirror `$shared/health/catalog.ts`'s `CRITERION_CATALOG` shape. Descriptions must be non-alarmist and describe the signal, not shame the operator.

### Step 3 — `packages/praxrr-app/src/lib/shared/security/engine.ts` (CREATE)

`computeShieldReport(inputs: PostureInputs): ShieldReport`. Pure. Logic (design §3, §5):

- Run every `ALL_CHECKS[i].score(inputs)` → `CheckResult[]`.
- Filter checks with `score !== null` → feed `{ id, score, weight }` to `rollUp<SecurityCheckId>` (import from `$shared/scoring/rollup.ts` or via `security/policy.ts` re-export).
- Stamp each check's `contribution` from `rollup.contributions.get(id)` and `recoverablePoints = round((100 − score) × normalizedWeight)` for scored checks `< 100` (else 0); `normalizedWeight = weight / Σ(scored weights)`.
- `anyScored = scored.length > 0`; `band = shieldBandFor(rollup.overall, anyScored)`; then `const { band: capped, cappedBy } = capBand(band, checks)` → `bandCappedBy = cappedBy`.
- Split: `assurances` (log_redaction pass → verified affirmation; Arr credentials encrypted-at-rest #9 constant), `advisories` (session-cookie `secure:false` + the encrypted-at-rest note), `transport = buildTransportRows(inputs.instances)`.
- `topActions`: scored checks `< 100` → sort by `recoverablePoints` desc, tone-severity desc as tie-break (use `TONE_SEVERITY` / `sortSuggestions` from `narrate.ts` for the tone tie-break).
- `generatedAt === inputs.nowIso`; `engineVersion = SECURITY_POSTURE_ENGINE_VERSION`. Order-invariant: never depend on `instances` array order for the final report (sort rows/actions deterministically).
- **Never** coerce `null` → 0. Adding a null-returning check must change neither `overall` nor `band`.

### Step 4 — `packages/praxrr-app/src/lib/shared/security/index.ts` (CREATE)

Barrel mirroring `$shared/health/index.ts`: re-export all types from `./types.ts`, `SECURITY_POSTURE_ENGINE_VERSION`, `CHECK_IDS`, `CHECK_CATALOG`, `ALL_CHECKS`, `classifyHost`, `buildTransportRows`, policy helpers (`HARDENED_THRESHOLD`, `GUARDED_THRESHOLD`, `shieldBandFor`, `capBand`, `clamp0100`, `rollUp`), and `computeShieldReport`.

### Step 5 — `packages/praxrr-app/src/lib/server/security/gather.ts` (CREATE)

`buildPostureInputs(): Promise<PostureInputs>` — the **only** config/DB read path; degrade-never-throw.

- `config.authMode`, `config.host` → `bindHost`, `config.port`.
- `config.oidc.{discoveryUrl,clientId,clientSecret}`: `oidcConfigured` = all three present, `oidcPartiallyConfigured` = some-but-not-all.
- `authSettingsQueries.getApiKey()` → `appApiKeyPresent` = non-empty, `appApiKeyStrong` = `len>=32`; **discard the value**.
- `arrInstancesQueries.getEnabled()` → `InstanceFact[]` (`id`, `name`, `arrType`, `url` only — never `external_url`). A malformed `url` is passed through as-is; the engine's `classifyHost`/`buildTransportRows` degrades that row to `tier:'unknown'`, `score:null` — gather never parses/throws.
- Rotation: `getActiveArrCredentialKeyVersion()` → `activeVersion`; `getAllArrCredentialKeyVersions()` → `configuredVersions`; per enabled instance `arrInstanceCredentialsQueries.getByInstanceId(id)?.key_version` → `instanceKeyVersions`.
- Run `sanitizeLogMeta({ api_key:'…', token:'sk-…', hex:<32 hex>, nested:{ secret:'…' } })` and assert those values are gone → `redactionVerified: boolean`.
- `sessionCookieSecure = false` (current constant); `nowIso = new Date().toISOString()`.

### Step 6 — `packages/praxrr-app/src/lib/server/security/service.ts` (CREATE)

```ts
export async function computeShield(): Promise<ShieldReport> {
  return computeShieldReport(await buildPostureInputs());
}
```

Read-only, never persists. Mirrors `health/service.ts` thinness.

### Step 7 — `packages/praxrr-app/src/lib/server/security/responses.ts` (CREATE)

Mutable `Wire*` DTOs mirroring the OpenAPI schemas + `toSummaryResponse(report: ShieldReport): SecurityPostureSummaryResponse` mapping `ReadonlyArray → mutable`. Interfaces: `WireFix`, `WireRecommendation`, `WireCheck`, `WireTransportRow`, `WireAssurance`, `WireAdvisory`, `WireTopAction`, `SecurityPostureSummaryResponse`. Mirror the pattern in `health/responses.ts` (mutable arrays, `[...line.detail]` spreads). **This file is the source of truth the route `satisfies` and the YAML mirrors.**

### Step 8 — `docs/api/v1/schemas/security-posture.yaml` (CREATE)

Per-schema definitions matching `responses.ts` exactly. Follow `docs/api/v1/schemas/config-health.yaml` conventions. Nullable score via `oneOf: [{type: integer}, {type: 'null'}]`. Enums: `ShieldBand` (`hardened|guarded|exposed|unknown`), `ShieldArrType` (`radarr|sonarr|lidarr`), `CheckStatus` (`pass|advisory|attention|action|assured|na`), `TransportTier` (`encrypted|loopback|docker-alias|private|unknown|public`). Include `WireFix`, `WireRecommendation`, `WireCheck`, `WireTransportRow`, `WireAssurance`, `WireAdvisory`, `WireTopAction`, `SecurityPostureSummaryResponse`.

### Step 9 — `docs/api/v1/paths/security-posture.yaml` (CREATE)

Single `summary:` key mirroring `paths/config-health.yaml#/summary` (verified structure):

```yaml
summary:
  get:
    operationId: getSecurityPostureSummary
    summary: Security posture summary
    description: |
      Read-only, on-demand audit of Praxrr's own security posture — control-plane auth, per-instance
      Arr transport, app key at rest, and credential-key rotation. Zero network probing. Degraded /
      not-evaluable states ride in the 200 body (per-check score:null / per-row tier:unknown); this
      returns 500 only on an internal error. Never emits a secret value.
    tags:
      - Security Posture
    responses:
      '200':
        description: Security posture summary
        content:
          application/json:
            schema:
              $ref: '../schemas/security-posture.yaml#/SecurityPostureSummaryResponse'
      '500':
        description: Internal error
        content:
          application/json:
            schema:
              $ref: '../schemas/arr.yaml#/ErrorResponse'
```

(`../schemas/arr.yaml#/ErrorResponse` is the shared error ref, verified registered at `openapi.yaml:768-769`.)

### Step 10 — `docs/api/v1/openapi.yaml` (MODIFY — 3 edits)

**(a) tags** — after the Config Health tag (currently ends at line 52), append as the last tag item:

```yaml
- name: Security Posture
  description: Read-only audit of Praxrr's own security posture — control-plane auth, Arr transport, app key at rest, and credential-key rotation
```

**(b) paths** — after `/config-health/settings` (line 691-692), add:

```yaml
/security-posture/summary:
  $ref: './paths/security-posture.yaml#/summary'
```

**(c) components.schemas** — after the Config Health block (last line 1644 `ConfigHealthSettingsUpdateRequest`), add a `# Security Posture` block, one re-export per schema, keys named **identically** to `responses.ts` `Wire*` interfaces:

```yaml
# Security Posture
ShieldBand:
  $ref: './schemas/security-posture.yaml#/ShieldBand'
ShieldArrType:
  $ref: './schemas/security-posture.yaml#/ShieldArrType'
CheckStatus:
  $ref: './schemas/security-posture.yaml#/CheckStatus'
TransportTier:
  $ref: './schemas/security-posture.yaml#/TransportTier'
WireFix:
  $ref: './schemas/security-posture.yaml#/WireFix'
WireRecommendation:
  $ref: './schemas/security-posture.yaml#/WireRecommendation'
WireCheck:
  $ref: './schemas/security-posture.yaml#/WireCheck'
WireTransportRow:
  $ref: './schemas/security-posture.yaml#/WireTransportRow'
WireAssurance:
  $ref: './schemas/security-posture.yaml#/WireAssurance'
WireAdvisory:
  $ref: './schemas/security-posture.yaml#/WireAdvisory'
WireTopAction:
  $ref: './schemas/security-posture.yaml#/WireTopAction'
SecurityPostureSummaryResponse:
  $ref: './schemas/security-posture.yaml#/SecurityPostureSummaryResponse'
```

Then `prettier --write docs/api/v1/**/*.yaml` (docs ARE the CI-gated lint surface). Do **not** regen `v1.d.ts`. Leave `packages/praxrr-api/openapi.json` (bundled mirror) stale — publish follow-up; only run prettier on it if you touch it.

### Step 11 — `packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts` (CREATE)

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { computeShield } from '$lib/server/security/service.ts';
import { toSummaryResponse } from '$lib/server/security/responses.ts';
import type { SecurityPostureSummaryResponse } from '$lib/server/security/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

export const GET: RequestHandler = async () => {
  try {
    const payload = toSummaryResponse(await computeShield());
    return json(payload satisfies SecurityPostureSummaryResponse);
  } catch (error) {
    await logger.error('Failed to build security posture summary', {
      source: 'SecurityPostureSummaryRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json(
      {
        error: 'Failed to build security posture summary',
      } satisfies ErrorResponse,
      { status: 500 }
    );
  }
};
```

(Note the divergence from config-health: types against the **local** `responses.ts`, per Decision 2.)

### Step 12 — `packages/praxrr-app/src/lib/client/ui/security/shieldStatus.ts` (CREATE)

Mirror `healthStatus.ts` verbatim, exhaustive `Record<ShieldBand,…>` over `hardened|guarded|exposed|unknown`:

```ts
import type { ShieldBand } from '$shared/security/index.ts';

export type ShieldBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

export const SHIELD_BAND_LABEL: Record<ShieldBand, string> = {
  hardened: 'Hardened',
  guarded: 'Guarded',
  exposed: 'Exposed',
  unknown: 'Unknown',
};

export const SHIELD_BAND_TEXT_CLASS: Record<ShieldBand, string> = {
  hardened: 'text-emerald-600 dark:text-emerald-400',
  guarded: 'text-amber-600 dark:text-amber-400',
  exposed: 'text-red-600 dark:text-red-400',
  unknown: 'text-neutral-500 dark:text-neutral-400',
};

export function bandVariant(band: ShieldBand): ShieldBadgeVariant {
  switch (band) {
    case 'hardened':
      return 'success';
    case 'guarded':
      return 'warning';
    case 'exposed':
      return 'danger';
    case 'unknown':
      return 'neutral';
  }
}
```

### Step 13 — `packages/praxrr-app/src/lib/client/ui/security/ShieldFixControl.svelte` (CREATE)

Svelte 5, **no runes** (`export let`, `$:`, `onclick`). Prop `fix: ShieldFix`. Render each union variant: `settings-link`/`docs` → `<a href>`; `instance-link` → `<a href="/arr/{instanceId}">`; `env-var` → copyable chip (`onclick` copies `name` to clipboard) + optional `docHref`; `none` → render nothing. Use `$ui/badge` where a chip fits `Badge`'s variant union (`accent|neutral|info|…`) — never pass a band literal to `Badge`.

### Step 14 — `packages/praxrr-app/src/lib/client/ui/security/ShieldRecommendationBlock.svelte` (CREATE)

Thin wrapper: `NarrationBlock` (`$ui/narration`, props `line: NarrationLine`, `verbose`) + `ShieldFixControl`. Prop `recommendation: ShieldRecommendation`. **Never** render a warning/danger line without a fix. The `line` must include `templateVersion` (already set by `checks.ts` via `NARRATION_TEMPLATE_VERSION`).

### Step 15 — `packages/praxrr-app/src/routes/security-posture/+page.server.ts` (CREATE)

Mirror `config-health/+page.server.ts` exactly: expose only `{ id, name, type }` for enabled sync-capable instances (`arrInstancesQueries.getEnabled().filter(isSyncPreviewArrType)`), for the transport EmptyState hint. No credential-adjacent fields; all scores fetched client-side.

### Step 16 — `packages/praxrr-app/src/routes/security-posture/+page.svelte` (CREATE)

Client-fetch `/api/v1/security-posture/summary` with the **request-id guard + Refresh** pattern from `config-health/+page.svelte` (`let summaryRequestId`; `const requestId = ++summaryRequestId`; bail `if (requestId !== summaryRequestId) return`; `onMount(loadSummary)`; `RefreshCw` spin while `loading`). Sections (design §8): (1) header h1 + subtitle + neutral "Non-blocking" pill + Refresh; (2) redaction-failure danger banner **only** when `!redactionVerified`; (3) band-tinted hero score via `$ui/card` + `SHIELD_BAND_TEXT_CLASS` + band `Badge`, em-dash when `band==='unknown'`, "Band limited by a critical finding: {label}" when `bandCappedBy` set; (4) "To reach Hardened" `topActions` list (`recoverablePoints` desc) with `ShieldFixControl` + "+X pts", green affirmation card when already hardened; (5) one card per scored check (status `Badge`, sub-score, contribution, `detail` bullets, `ShieldRecommendationBlock` per rec; null check → "Not evaluated" + reason, never 0); (6) transport table inside the `arr_transport` card (name, arrType badge using `radarr|sonarr|lidarr` `Badge` variants, scheme badge https→success/http→danger, tier badge, host, per-row Edit fix) — `$ui/state/EmptyState` **only** when 0 enabled instances, and it **requires** `icon`, `title`, `description`, `buttonText`, `buttonHref` (verified — no defaults): pass `buttonText="Add an Arr instance"` / `buttonHref="/arr"`; (7) assurances strip (green verified badges); (8) advisories.

### Step 17 — `packages/praxrr-app/src/lib/client/navigation/iconMap.ts` (MODIFY)

`ShieldCheck` is a valid `lucide-svelte` export. Add it alphabetically (between `Settings` and `Sliders`) in **both** the import and `NAV_ICON_MAP`:

```ts
// import block:
  Settings,
  ShieldCheck,
  Sliders,
// NAV_ICON_MAP:
  Settings,
  ShieldCheck,
  Sliders,
```

(Allowlist — `resolveNavIcon` returns `undefined` for unlisted keys, so both edits are mandatory.)

### Step 18 — `packages/praxrr-app/src/lib/server/navigation/registry.ts` (MODIFY)

Insert between the `overview.config_health` block (ends line 140) and `apps.arrs` (starts line 141). `ensureGroupId` and `scopeAll` are in scope (lines 49-56):

```ts
	{
		id: 'overview.security_posture',
		label: 'Security Posture',
		href: '/security-posture',
		groupId: ensureGroupId('overview'),
		order: 6,
		arrScope: scopeAll,
		mobilePriority: 'medium',
		iconKey: 'ShieldCheck',
		emoji: '🛡️',
		hasChildren: false
	},
```

No `requiredFeature` (scope `all` → always visible), consistent with `config_health`.

### Step 19 — `packages/praxrr-app/src/routes/settings/security/+page.svelte` (MODIFY)

Add a "View security posture →" link to `/security-posture` (bidirectional actionability). Do **not** touch `routes/settings/+page.svelte` `settingsItems` or the settings nav registry children — Shield Check is a top-level Overview page by design (§4/§8).

### Step 20 — Tests (CREATE)

**`packages/praxrr-app/src/tests/shared/scoring/rollup.test.ts`** — generic invariants: contributions sum EXACTLY to `overall` across random weight sets; residual assigned to largest weight; zero-weight fallback → equal weighting.

**`packages/praxrr-app/src/tests/shared/security/checks.test.ts`** — per-check tables (design §10/Check set §2): `control_plane_auth` off/loop=55, off/non-loop=35, local=60, on=100, oidc-full=100, oidc-partial=50, never null; `arr_transport` classifier table (https=100; http+`127.0.0.1`/`::1`/`[::1]`/`localhost`/`0.0.0.0`=100; http+bare `radarr`=100; http+`10.x`/`192.168.x`/`.local`=65; http+unknown FQDN=65 never public; http+public-IP literal=30; malformed→tier `unknown`/score `null`; mean of non-null; 0 instances→null); `app_key_at_rest` on/local+strong=70, +weak=45, no-key=null, oidc/off=null (value never emitted); `credential_rotation` single-version→null, N stale→`100−20N`, 0 instances→null.

**`packages/praxrr-app/src/tests/shared/security/engine.test.ts`** — `makePostureInputs` factory: determinism (deep-equal), instance-order-invariance (shuffle → deep-equal), `generatedAt===nowIso`, null excluded from rollup + weight re-normalization (adding a null check changes neither `overall` nor `band`), band thresholds 85/60, monotonicity, `unknown` only when all null, **critical-cap worked examples** (AUTH=off+`0.0.0.0`+public-http ≈33 but `band='exposed'`, `bandCappedBy.checkId==='control_plane_auth'`; public-http caps at `guarded`; AUTH=off+loopback+https =74 → `guarded`), `recoverablePoints==round((100−score)×normalizedWeight)`, `topActions` sort, **actionability invariant** (every rec with tone∈{warning,danger} has `fix.kind!=='none'`; env-var recs carry exact names `AUTH`/`OIDC_*`/`ARR_CREDENTIAL_MASTER_KEY`).

**`packages/praxrr-app/src/tests/logger/sanitizerRegression.test.ts`** — real `sanitizeLogMeta` redacts a synthetic secret bundle → `redactionVerified===true`. (Covered by the existing `logger` dir alias.)

**`packages/praxrr-app/src/tests/routes/securityPosture.test.ts`** — GET `/summary` 200 shape `satisfies SecurityPostureSummaryResponse`; malformed-URL instance degrades to `na` without 500; 0 instances still returns auth/app-key/rotation + assurances; forced gather error → 500 `{error}`; **assert NO secret value anywhere in the serialized payload**; cover presence-only api-key read + `external_url` ignored + rotation facts assembled.

### Step 21 — Nav snapshot tests (MODIFY — exact before/after)

**`packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`** — insert `'/security-posture',` after `'/config-health',` in **both** arrays:

- `topLevelHrefs` (line 27→28): `…'/config-health',` then add `'/security-posture',` then `'/arr',`
- `deepLinks` (line 55→56): `…'/config-health',` then add `'/security-posture',` then `'/arr',`

**`packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`** — TWO full-list arrays (the `.includes(...)` assertions at lines 231, 251-262, 267 need **no** change):

- `sidebarOrder` (line 192→193): `…'/config-health',` add `'/security-posture',` then `'/arr',`
- `buildBottomNavOrder(…, 'all')` (line 218→219): `…'/config-health',` add `'/security-posture',` then `'/regular-expressions',` — correct because bottom-nav groups by `mobilePriority` then source index, and `security_posture` (medium, source position right after `config_health`) lands in the medium run before `/regular-expressions`.

### Step 22 — `scripts/test.ts` (MODIFY)

Add to the `aliases` record (near `config-health`):

```ts
  'security-posture':
    'packages/praxrr-app/src/tests/shared/security,packages/praxrr-app/src/tests/shared/scoring,packages/praxrr-app/src/tests/routes/securityPosture.test.ts',
```

(`sanitizerRegression.test.ts` is already covered by the `logger` dir alias.)

---

## 3. Verification checkpoints (run at these exact points)

| After steps                           | Command                                                                                                                                          | Proves                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current state (before writing)        | `deno task test config-health`                                                                                                                   | The already-landed DRY extraction kept the #22 residual-exact rollup + health surface byte-identical.                                                 |
| Step 4 (shared engine complete)       | `deno task check:server`                                                                                                                         | `$shared` + `$server` type-check; catches generic `rollUp<Id>` / contract drift. Routes are intentionally excluded here.                              |
| Step 7 (server layer)                 | `deno task check:server`                                                                                                                         | `gather`/`service`/`responses` + transitive `$shared` chain compile.                                                                                  |
| Step 10 (OpenAPI)                     | `prettier --write docs/api/v1/**/*.yaml && deno task lint`                                                                                       | Docs are the CI-gated lint surface.                                                                                                                   |
| Steps 20 (rollup/checks/engine tests) | `deno task test security-posture` (add the alias in Step 22 first, or pass explicit dirs)                                                        | All pure-engine invariants pass BEFORE touching the route.                                                                                            |
| Step 11 + 20 route test               | `deno task test security-posture`                                                                                                                | Type-checks + exercises the handler; validates the `responses.ts`-mirror-vs-`v1.d.ts` typing decision (routes are type-checked only via `deno test`). |
| Step 21 (nav edits)                   | `deno test packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts` | All four exact href arrays pass. Not CI-gated — must run locally.                                                                                     |
| Before done                           | `deno task check` → `deno task lint` → `deno task test`                                                                                          | Server `deno check` + client `svelte-check`; prettier docs + eslint; full suite.                                                                      |
| Before done (smoke)                   | `deno task dev:noauth`, then also with `AUTH=on` / `AUTH=oidc`, across http and https instance URLs                                              | Bands/caps/advisories render; redaction banner only on failure; **no secret in the `/summary` payload**.                                              |

---

## 4. Pre-mortem risk table

| #   | Risk                                                                                                                                                                                            | Mitigation                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Route types against `components['schemas']['SecurityPostureSummaryResponse']` which does not exist (v1.d.ts not regenerated); route test (`deno test`) fails to type-check.                     | Type `satisfies` the local `SecurityPostureSummaryResponse` from `$lib/server/security/responses.ts` (Decision 2). Keep YAML ↔ `responses.ts` in lockstep by review.                           |
| 2   | Shared engine imports `isLocalAddress` from `$lib/server/utils/auth/network.ts` → first `$shared→$lib/server` import; breaks the app-build gate ("Cannot import $lib/server into client code"). | Already avoided — `checks.ts` inlines the RFC1918/loopback literal logic. Never add a `$lib/server` import to `$shared/security/*`.                                                            |
| 3   | Generalizing `rollUp` to `rollUp<Id extends string>` breaks the #22 health surface.                                                                                                             | Already handled — `health/policy.ts` re-exports generics aliased to `CriterionId`; `health/engine.ts` + barrel unchanged. Prove with `deno task test config-health`.                           |
| 4   | `sortSuggestions` scope creep into `health/engine.ts` risks the #22 engine snapshot (not CI-gated).                                                                                             | Add `sortSuggestions` to `narrate.ts`, consume ONLY in the security engine; leave `health/engine.ts` untouched (Decision 4).                                                                   |
| 5   | Nav snapshot tests aren't CI-gated; adding the registry entry silently breaks 4 exact href arrays; design's "two other arrays" count for `navigationScopeFiltering` is imprecise.               | Edit exactly the 4 full-list arrays in Step 21; run both base nav tests directly and insert `'/security-posture'` wherever an assertion fails.                                                 |
| 6   | Bottom-nav ordering: `buildBottomNavOrder('all')` sorts by priority then source index; wrong slot fails the snapshot.                                                                           | Insert `'/security-posture'` in the medium run immediately after `'/config-health'`, before `'/regular-expressions'`; confirm by running the scope-filtering test.                             |
| 7   | `iconKey:'ShieldCheck'` registered but iconMap import/map entry forgotten → missing icon, no error.                                                                                             | Add `ShieldCheck` to BOTH the lucide-svelte import and `NAV_ICON_MAP` in the same edit (Step 17).                                                                                              |
| 8   | `capBand` mishandled — caps on non-action status, mutates the numeric score, or omits `bandCappedBy` → averages a wide-open front door into green.                                              | `capBand` (already implemented) only considers `status==='action'`, lowers to worst `bandCapWhenAction`, leaves score intact; pin both worked examples in `engine.test.ts`.                    |
| 9   | null-as-zero regression tanks otherwise-hardened scores; re-normalization breaks.                                                                                                               | Filter nulls before `rollUp`; never coerce to 0; assert in `engine.test.ts` that adding a null check changes neither `overall` nor `band` and contributions still sum exactly.                 |
| 10  | Secret leakage in the (possibly-unauthenticated under AUTH=off) 200 body.                                                                                                                       | `gather.ts` emits only presence + `length>=32`; instances carry host only (never `api_key`/`external_url`); `securityPosture.test.ts` asserts no secret value appears anywhere in the payload. |
| 11  | `EmptyState` used without required props → `svelte-check` (client gate) fails.                                                                                                                  | Pass all of `icon`, `title`, `description`, `buttonText`, `buttonHref` (verified no defaults); use `buttonHref="/arr"`.                                                                        |
| 12  | Full `v1.d.ts` regen committed → ~3300 lines of tool-version noise.                                                                                                                             | Do NOT regen. Re-export schemas into `openapi.yaml` only; route types against `responses.ts`.                                                                                                  |

---

## 5. Definition of done

**Commands that must pass (all green):**

```bash
deno task check              # deno check (server) + svelte-check (client)
deno task check:server       # $shared + $server type-check
deno task lint               # prettier (docs/openapi *.yaml) + eslint
deno task test               # full suite
deno task test config-health # #22 surface unchanged (DRY refactor safe)
deno task test security-posture
deno test packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts \
          packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts
prettier --write docs/api/v1/**/*.yaml   # run before commit; docs are CI-gated
```

Plus the smoke matrix: `deno task dev:noauth` and `AUTH=on`/`AUTH=oidc`, each across http and https instance URLs — bands/caps/advisories render, redaction banner shows only on failure, and no secret appears in `/api/v1/security-posture/summary`.

**Issue #28 "Done When" (from the authoritative design — §1, §7, §8, §9):**

- [ ] `GET /api/v1/security-posture/summary` returns `{ engineVersion, generatedAt, score, band, bandCappedBy, checks[], transport[], assurances[], advisories[], topActions[] }`; 500 only on internal failure; degraded states ride in the 200 body.
- [ ] Four scored checks (`control_plane_auth` 40, `arr_transport` 30, `app_key_at_rest` 15, `credential_rotation` 15) + `log_redaction` assurance; every scored signal **varies by deployment** and carries an actionable typed `fix`.
- [ ] Bands `hardened≥85`/`guarded≥60`/`exposed<60`/`unknown`; critical band-cap prevents false-confidence (numeric score still displayed; `bandCappedBy` set).
- [ ] Zero network I/O; no migration, settings table, job, or snapshot added (§4 confirmed).
- [ ] Report **never emits a secret value** (presence booleans + host strings only) — proven by `securityPosture.test.ts`.
- [ ] `/security-posture` nav item (overview, order 6, `ShieldCheck`) renders; reciprocal "View security posture →" link on `/settings/security`.
- [ ] OpenAPI contract (`schemas/` + `paths/` + `openapi.yaml` re-exports) mirrors `responses.ts`; no noisy `v1.d.ts` regen committed.
- [ ] `docs/internal/security-posture-design.md` committed as `docs(internal): …`; feature commit as `feat(security): …`.
