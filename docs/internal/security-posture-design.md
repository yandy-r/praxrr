# Issue #28 — Ecosystem Security Posture / "Shield Check": Authoritative Design

<!-- Produced by the ultracode design workflow: 3 independent proposals (threat-model purist /
     config-health parity / UX-actionability) → 2 adversarial judges → synthesis. -->

**Status:** Implementation-ready. Every decision below is final — no open questions.
**Guiding mandate (ROADMAP):** threat-model driven; non-blocking (informs, never blocks); no network probing; every scored signal must **vary by deployment** and yield an **action the operator can take**.

---

## 1. Summary & threat model

Shield Check is a **read-only, on-demand audit of the security state Praxrr already knows** from its own config singleton and DB tables. It emits a 0–100 **shield score**, a **band**, per-check results, an **assurances strip**, **advisories**, and a **ranked "To reach Hardened" action list**. Zero network I/O.

### Assets we defend

- **A1 — Admin control plane.** Praxrr's UI/API grants full control over every Arr config, sync, rollback, and credential operation.
- **A2 — Decryptable Arr credentials.** Arr API keys; possession = full control of downstream Arr instances.
- **A3 — Praxrr's own API key.** `auth_settings.api_key` (plaintext at rest); a live auth vector to A1 in certain modes.

### Attackers / capabilities we model

- **T1 — Unauthenticated network peer** who can reach Praxrr's port. Wants A1.
- **T2 — LAN cleartext sniffer** on a shared segment. Wants A2 (Arr API keys in flight over http) and A1/A3 (Praxrr session cookie / `X-Api-Key` in flight over http).
- **T3 — DB / backup reader** with read access to `praxrr.db` or an unencrypted backup. Wants A3 (plaintext app key), and A2 only if the master key also leaks or credentials sit under a retired key.

### What we deliberately do **NOT** check, and why (anti-theater)

| Omitted signal                                                                             | Why it is theater / out of scope                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Is `ARR_CREDENTIAL_MASTER_KEY` set?"**                                                  | **VERIFIED boot invariant.** `hooks.server.ts` calls `getActiveArrCredentialKeyVersion()` → `keys.ts:getConfiguredKeys()` **throws** on a missing/invalid key and startup **aborts**. A process that can serve this route provably has a valid key → constant 100. Belongs to the startup guard/test, never a score. |
| **Credential-row _coverage_** (enabled instance missing an encrypted row)                  | Post-#9 that instance simply **cannot authenticate** — a broken/functional state already surfaced by drift/config-health, not an attacker capability. Scoring it double-counts and creeps scope. (Rotation _staleness_ — a decryptable row under a **retired** key — is different and _is_ scored; see Check 4.)     |
| **Log redaction as a weighted contributor**                                                | `sanitizeLogMeta` is always-on and non-configurable (#8). On the happy path it must contribute **zero**; a failure is a code regression, not an operator action. Kept as a runtime-verified **assurance** + regression banner + unit test.                                                                           |
| **Bind host `0.0.0.0` as a standalone penalty**                                            | It is the container default and required inside Docker; true exposure depends on port publishing + host firewall Praxrr cannot see. Used **only** as a _mitigating_ modifier (a loopback-only bind softens the AUTH=off blast radius).                                                                               |
| **`external_url` transport grading**                                                       | It is a display/deep-link target; the Arr API key never travels over it. Grading it flags a non-risk.                                                                                                                                                                                                                |
| **Encryption-code-exists (#9)**                                                            | Always ships → constant. Rendered as a verified assurance, never scored.                                                                                                                                                                                                                                             |
| **Instance reachability / port scan / WAN exposure / TLS cert validity / cipher strength** | Requires active network probing #28 forbids and Praxrr's own state cannot answer. Any score here is fabricated.                                                                                                                                                                                                      |
| **Session-cookie `secure:false` as a _score_**                                             | The flag is a hard-coded code constant (4 auth routes) whose **exploitability** depends on the served scheme, which Praxrr cannot observe (same unknowability as the AUTH=off proxy problem). Surfaced as an actionable **advisory** (front with TLS + a code follow-up), never a fabricated score.                  |
| **Snapshots / trends / sparkline / recurring job / retention**                             | Posture is a **step function** that moves only when the operator edits config; a near-flat time series is decorative. On-demand compute only. (Also sidesteps the repo's known date-based migration-version-collision hazard.)                                                                                       |
| **User-tunable weights / per-check disable**                                               | Would let a user down-weight "auth is off" to fake green. Weights are fixed in code.                                                                                                                                                                                                                                 |

**Cross-Arr policy (required checklist).** Transport (TLS-on-the-wire) and at-rest (encryption/rotation) are **genuinely `arr_type`-agnostic** — they are transport/storage concerns, not Arr-domain semantics. No per-`arr_type` branching is used or needed; `arrType` is preserved for display only. Read/compute paths never fall back across sibling apps.

**Self-exposure note.** Under `AUTH=off` this endpoint is itself served unauthenticated (it rides the same middleware). The report therefore **never emits secret values** — only presence booleans and host strings — so a "you are wide open" report cannot itself leak a credential.

---

## 2. Final check set

Four **scored** checks (fixed code weights, sum 100) + one registered **assurance** check. Every scored check varies by deployment and carries a typed `fix`.

| id                                                        | label                               | signals (exact fields)                                                                                                                                         | scoring (raw → 0–100 \| null)                                                                                                                                                                                                                                                                              | tone / band-cap                                                                                         | weight               | example recommendation                                                                                                                                                                                                     |
| --------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `control_plane_auth`                                      | Control-plane authentication        | `config.authMode`; `config.host` (loopback mitigation only); `config.oidc.{discoveryUrl,clientId,clientSecret}` presence                                       | `on`→100 · `oidc` all 3 present→100 · `oidc` any missing→**50** · `local`→**60** · `off`+loopback bind→**55** · `off`+non-loopback bind→**35** · never `null`                                                                                                                                              | off/non-loop=**danger, cap `exposed`**; off/loop & oidc-misconfig=warning, cap `guarded`; local=warning | **40**               | env-var `AUTH=on`/`AUTH=oidc` chip + `/settings/security` link: "AUTH=off authenticates no requests and relies on an unverifiable upstream proxy; if none fronts Praxrr, anyone who reaches port {port} has full control." |
| `arr_transport`                                           | Arr connection transport            | per **enabled** instance: `new URL(instance.url).protocol` + `classifyHost(hostname)`. **`instance.url` only, never `external_url`.**                          | per instance: https→100 · http+loopback→100 · http+single-label docker alias→100 · http+private (RFC1918 literal or `.local/.lan/.home/.internal`)→**65** · http+unknown FQDN→**65** · http+public-IP literal→**30** · unparseable→**null**. Check = **mean of non-null**; `null` when 0 enabled instances | private/unknown=warning; public-http=**danger, cap `guarded`**                                          | **30**               | instance-link `/arr/{id}`: "Radarr-4K is reached at http://10.0.0.5:7878; its API key crosses the LAN in cleartext every request. Point Praxrr at an https URL or front the instance with TLS."                            |
| `app_key_at_rest`                                         | Praxrr API key at rest              | `authSettingsQueries.getApiKey()` **presence + length only (value never read out)**; `config.authMode`                                                         | authMode∈{`on`,`local`} & key present & `len≥32`→**70** · present & `len<32`→**45** · no key→**null** · authMode∈{`oidc`,`off`}→**null** (inert: **verified** oidc/off bypass the `X-Api-Key` path)                                                                                                        | 70=warning, 45=danger                                                                                   | **15**               | env-var `AUTH=oidc` chip + docs: "Your Praxrr API key is plaintext in praxrr.db; anyone who reads the DB or an unencrypted backup gets full API access. Restrict/encrypt backups, rotate the key, or switch to AUTH=oidc." |
| `credential_rotation`                                     | Arr credential key freshness        | `getActiveArrCredentialKeyVersion()`, `getAllArrCredentialKeyVersions()`, per enabled instance `arrInstanceCredentialsQueries.getByInstanceId(id).key_version` | **null** when only one key version is configured (no rotation in play) **or** 0 enabled instances · else `100 − 20 × (enabled instances whose row is decryptable but `key_version ≠ active`)`, clamped ≥0                                                                                                  | warning                                                                                                 | **15**               | instance-link list: "2 instances are still encrypted under a retired key. Re-save Radarr-4K and Sonarr to re-encrypt them under the current master key, then you can drop the old key from ARR_CREDENTIAL_PREVIOUS_KEYS."  |
| `log_redaction` _(assurance, registered-but-non-scoring)_ | Log redaction (runtime self-verify) | `gather.ts` runs `sanitizeLogMeta({api_key, token:'sk-…', hex:<32>, nested:{secret}})` → `redactionVerified: boolean`                                          | pass→**null** (excluded, assurance strip) · fail→**score 0, weight 25**, promoted to a top-of-page danger banner                                                                                                                                                                                           | pass=assured; fail=danger                                                                               | 0 (pass) / 25 (fail) | pass: green "Log redaction verified — secrets stripped before every log write." fail: docs anchor: "sanitizeLogMeta did not redact a planted secret — a logger regression; do not share logs and file a bug."              |

**`classifyHost(hostname)` (new, pure, unit-tested — `isLocalAddress` is insufficient: it returns a single boolean, parses only IP literals, and does not classify hostnames):** strip surrounding IPv6 brackets (`[::1]`→`::1`); `::1`→loopback; `127.0.0.0/8`/`localhost`/`0.0.0.0`→loopback; RFC1918 literals + `fc00::/7`,`fe80::/10`→private; single-label host (no dots, not an IP)→docker-alias; `.local/.lan/.home/.internal`→private; other IPv6 / `::ffff:`-mapped / unresolved multi-label FQDN→**unknown** (conservative, never "public danger" — avoids crying wolf on split-horizon DNS); routable public-IP **literal**→public. Reuse `isLocalAddress` only as the private-IP-literal helper.

---

## 3. Scoring & bands

- **Engine version const:** `SECURITY_POSTURE_ENGINE_VERSION = '1'` (declared once in `$shared/security/types.ts`; bump on any check/threshold/formula change).
- **`clamp0100(n)`** and **`rollUp(scored)`** are imported from the **new generic `$shared/scoring/rollup.ts`** (see §4 DRY). `clamp0100` = integer 0–100.
- **Rollup invariant (unchanged from #22):** `overall = round(Σ score·w / Σ w)` over **non-null** checks; each `contribution = round(score·w / Σw)`; the rounding **residual is assigned to the largest-weight check** so **contributions sum EXACTLY to `overall`** (test-pinned). Zero-weight fallback → equal weighting.
- **`null` handling:** `null` = "cannot evaluate / not applicable" → **filtered out before rollup, NEVER treated as 0**. Nulls re-normalize the remaining weights.
- **`recoverablePoints`** (pure, for ranking): `round((100 − score) × normalizedWeight)` for scored checks `< 100`, else 0. `normalizedWeight = weight / Σ(scored weights)`.
- **Bands** (distinct security vocabulary; `$shared/security/policy.ts`): `HARDENED_THRESHOLD = 85`, `GUARDED_THRESHOLD = 60` → **`hardened` ≥85**, **`guarded` ≥60**, **`exposed` <60**, **`unknown`** only when every check is `null` (via `anyScored` gate — in practice unreachable because `control_plane_auth` always scores).
- **Critical band-cap (anti-false-confidence):** each `CheckResult` may carry `bandCapWhenAction: ShieldBand | null`. After the numeric rollup, `capBand(rolledBand, checks)` lowers the overall band to the **worst** declared cap among checks whose status is `action` (danger). The **numeric score still displays**; the report carries `bandCappedBy: {checkId,label} | null`. So strong transport/creds can never average a wide-open front door into a green band.

**Worked examples**

- Typical compose (AUTH=on, http docker instances, strong app key, no rotation): auth 100·40 + transport 100·30 + app_key 70·15 (rotation & redaction null) → 8050/85 = **95 → hardened**, zero nag.
- AUTH=off + `0.0.0.0`, public-http instance: auth 35·40 + transport 30·30 → 2300/70 = **33**, cap `exposed` (bandCappedBy `control_plane_auth`) → **exposed**.
- AUTH=off + loopback bind, https instances: 55·40 + 100·30 → 5200/70 = **74**, cap `guarded` → **guarded**.

---

## 4. Architecture & exact file tree

**DEFINITIVE:** **NO** DB migration, **NO** settings table, **NO** settings PUT/GET endpoint, **NO** recurring job, **NO** snapshot/trends. Compute on-demand at the summary route. Justification: posture is a step function; persistence adds a migration + table + job + cleanup for a flat, unactionable series, and avoids the date-based migration-version-collision hazard. All facts derive live from `$config`, `arr_instances`, `arr_instance_credentials`, `auth_settings`, and the encryption key ring.

```
CREATE — pure shared engine (client+server safe; no I/O, no Date/Math.random)
  packages/praxrr-app/src/lib/shared/scoring/rollup.ts        NEW generic primitive: clamp0100, rollUp<Id extends string>, WeightedScore<Id>, RollupResult<Id>
  packages/praxrr-app/src/lib/shared/security/types.ts        versioned contracts (see §5); type-only NarrationLine import
  packages/praxrr-app/src/lib/shared/security/policy.ts       band thresholds, shieldBandFor(score,anyScored), capBand(); re-uses clamp0100/rollUp from $shared/scoring
  packages/praxrr-app/src/lib/shared/security/checks.ts       5 pure scorers + classifyHost + ALL_CHECKS registry + line()/result() helpers
  packages/praxrr-app/src/lib/shared/security/catalog.ts      CHECK_CATALOG: CheckMeta[] (id,label,description) — client imports directly (no /settings route)
  packages/praxrr-app/src/lib/shared/security/engine.ts       computeShieldReport(inputs): run checks, rollUp, stamp contributions+recoverablePoints, derive+cap band, split scored/assurance/advisory, build topActions
  packages/praxrr-app/src/lib/shared/security/index.ts        barrel (mirrors $shared/health/index.ts)

MODIFY — DRY (public surface preserved, covered by existing #22 tests)
  packages/praxrr-app/src/lib/shared/health/policy.ts         re-export clamp0100/rollUp from $shared/scoring/rollup.ts (byte-identical health surface)
  packages/praxrr-app/src/lib/shared/narration/narrate.ts     add exported sortSuggestions(lines); health + security engines both import it

CREATE — server (only config/DB read path)
  packages/praxrr-app/src/lib/server/security/gather.ts       buildPostureInputs(): materialize facts; run redaction self-verify; degrade-never-throw
  packages/praxrr-app/src/lib/server/security/service.ts      computeShield() = computeShieldReport(await buildPostureInputs())
  packages/praxrr-app/src/lib/server/security/responses.ts    mutable Wire* DTOs mirroring OpenAPI; toSummaryResponse(report)

CREATE — routes
  packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts   GET → 200 SecurityPostureSummaryResponse | 500 {error}
  packages/praxrr-app/src/routes/security-posture/+page.server.ts             load: enabled-instance-exists hint (mirrors config-health load)
  packages/praxrr-app/src/routes/security-posture/+page.svelte                dashboard (client-fetches /summary)

CREATE — client UI (minimal new surface; reuse $ui/card, $ui/badge, $ui/state/EmptyState, NarrationBlock)
  packages/praxrr-app/src/lib/client/ui/security/shieldStatus.ts             ShieldBand → variant/label/text-class (mirrors healthStatus.ts)
  packages/praxrr-app/src/lib/client/ui/security/ShieldFixControl.svelte     renders ShieldFix union (link / instance-link / copyable env-var chip / docs)
  packages/praxrr-app/src/lib/client/ui/security/ShieldRecommendationBlock.svelte  thin wrapper: NarrationBlock + ShieldFixControl (never a warning without a fix)
    (No new SVG gauge: hero renders a band-tinted score number via $ui/card + HEALTH-style text-class, keeping new UI lean.)

MODIFY — nav + cross-link
  packages/praxrr-app/src/lib/client/navigation/iconMap.ts    import ShieldCheck from lucide-svelte + add to NAV_ICON_MAP (allowlist; else resolveNavIcon → undefined)
  packages/praxrr-app/src/lib/server/navigation/registry.ts   add overview.security_posture entry (see §8)
  packages/praxrr-app/src/routes/settings/security/+page.svelte  add "View security posture →" link (bidirectional actionability)

CREATE — OpenAPI (contract-first)
  docs/api/v1/schemas/security-posture.yaml                   SecurityPostureSummaryResponse + Wire* schemas
  docs/api/v1/paths/security-posture.yaml                     GET /security-posture/summary
MODIFY
  docs/api/v1/openapi.yaml                                    re-export per-schema under components.schemas + register path
    (regen v1.d.ts is noisy + NOT CI-gated → route `satisfies components['schemas'][...]`; responses.ts stays the mirror)

CREATE — tests
  packages/praxrr-app/src/tests/shared/security/engine.test.ts
  packages/praxrr-app/src/tests/shared/security/checks.test.ts
  packages/praxrr-app/src/tests/shared/scoring/rollup.test.ts     extracted residual-exact + zero-weight invariants
  packages/praxrr-app/src/tests/routes/securityPosture.test.ts
  packages/praxrr-app/src/tests/logger/sanitizerRegression.test.ts  durable redaction regression guard (logger alias)
MODIFY
  packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts     add '/security-posture' after '/config-health' in topLevelHrefs + deepLinks
  packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts  add '/security-posture' in sidebarOrder + the two other href arrays
  scripts/test.ts                                              add alias 'security-posture' (→ tests/shared/security, tests/shared/scoring, tests/routes/securityPosture.test.ts)
```

`routes/settings/+page.svelte` `settingsItems` is **intentionally NOT modified**: Shield Check is a top-level Overview page, not a `/settings/*` sub-route; adding it there would mis-route/mis-categorize. Cross-linking is via the link on `/settings/security`.

---

## 5. Shared-engine contracts (`$shared/security/types.ts`)

Mirrors `$shared/health` naming (`SubScore`, `CheckResult`, `ScoredUnit`-shaped report, `nowIso` passed in).

```ts
export const SECURITY_POSTURE_ENGINE_VERSION = '1';

export type SecurityCheckId =
  | 'control_plane_auth'
  | 'arr_transport'
  | 'app_key_at_rest'
  | 'credential_rotation'
  | 'log_redaction'; // log_redaction registered-but-non-scoring
export const CHECK_IDS: readonly SecurityCheckId[] = [
  /* stable display order */
];

export type SubScore = number | null; // null = skipped, NEVER 0
export type ShieldBand = 'hardened' | 'guarded' | 'exposed' | 'unknown';
export type ShieldArrType = 'radarr' | 'sonarr' | 'lidarr';
export type CheckStatus =
  'pass' | 'advisory' | 'attention' | 'action' | 'assured' | 'na'; // tone-derived badge
export type TransportTier =
  'encrypted' | 'loopback' | 'docker-alias' | 'private' | 'unknown' | 'public';

export type ShieldFix =
  | { kind: 'settings-link'; href: string; label: string }
  | { kind: 'instance-link'; instanceId: number; href: string; label: string }
  | { kind: 'env-var'; name: string; docHref?: string; label: string }
  | { kind: 'docs'; href: string; label: string }
  | { kind: 'none' };

export interface ShieldRecommendation {
  readonly line: NarrationLine;
  readonly fix: ShieldFix;
}
export interface CheckMeta {
  readonly id: SecurityCheckId;
  readonly label: string;
  readonly description: string;
}

export interface CheckResult {
  readonly id: SecurityCheckId;
  readonly label: string;
  readonly score: SubScore;
  readonly weight: number;
  readonly contribution: number;
  readonly recoverablePoints: number;
  readonly status: CheckStatus;
  readonly critical: boolean;
  readonly bandCapWhenAction: ShieldBand | null;
  readonly detail: readonly string[];
  readonly recommendations: readonly ShieldRecommendation[];
}

export interface TransportRow {
  readonly instanceId: number;
  readonly instanceName: string;
  readonly arrType: ShieldArrType;
  readonly scheme: 'http' | 'https';
  readonly host: string; // host only — never the api key
  readonly tier: TransportTier;
  readonly score: SubScore;
  readonly status: CheckStatus;
  readonly fix: ShieldFix;
}

export interface Assurance {
  readonly id: string;
  readonly label: string;
  readonly verified: boolean;
  readonly note: string;
}
export interface Advisory {
  readonly id: string;
  readonly label: string;
  readonly detail: readonly string[];
  readonly fix: ShieldFix;
}
export interface TopAction {
  readonly checkId: SecurityCheckId;
  readonly headline: string;
  readonly tone: NarrationLine['tone'];
  readonly recoverablePoints: number;
  readonly fix: ShieldFix;
}

export interface InstanceFact {
  readonly id: number;
  readonly name: string;
  readonly arrType: ShieldArrType;
  readonly url: string;
}
export interface RotationFacts {
  readonly activeVersion: string;
  readonly configuredVersions: readonly string[]; // getAll…()
  readonly instanceKeyVersions: readonly {
    readonly instanceId: number;
    readonly keyVersion: string | null;
  }[];
}

export interface PostureInputs {
  // fully materialized; engine does no I/O
  readonly authMode: 'on' | 'local' | 'off' | 'oidc';
  readonly bindHost: string;
  readonly port: number;
  readonly oidcConfigured: boolean;
  readonly oidcPartiallyConfigured: boolean;
  readonly appApiKeyPresent: boolean;
  readonly appApiKeyStrong: boolean; // length≥32; value never carried
  readonly instances: readonly InstanceFact[];
  readonly rotation: RotationFacts;
  readonly redactionVerified: boolean;
  readonly sessionCookieSecure: boolean; // const false today → drives the advisory
  readonly nowIso: string; // engine never calls Date.now()/new Date()
}

export interface SecurityCheck {
  readonly id: SecurityCheckId;
  readonly label: string;
  readonly weight: number;
  score(inputs: PostureInputs): CheckResult;
}

export interface ShieldReport {
  // single deployment-scoped report (not a fleet)
  readonly engineVersion: string;
  readonly generatedAt: string; // === inputs.nowIso
  readonly score: number;
  readonly band: ShieldBand;
  readonly bandCappedBy: {
    readonly checkId: SecurityCheckId;
    readonly label: string;
  } | null;
  readonly checks: readonly CheckResult[];
  readonly transport: readonly TransportRow[];
  readonly assurances: readonly Assurance[];
  readonly advisories: readonly Advisory[];
  readonly topActions: readonly TopAction[]; // recoverablePoints desc, then severity
}
```

---

## 6. Server gather / service / responses

- **`gather.ts` — the ONLY config/DB read path; degrade-never-throw.** Reads: `config.authMode`, `config.host`, `config.port`, `config.oidc.{discoveryUrl,clientId,clientSecret}` (→ `oidcConfigured` = all three present, `oidcPartiallyConfigured` = some-but-not-all), `authSettingsQueries.getApiKey()` (→ `appApiKeyPresent`/`appApiKeyStrong` via length; **value discarded**), `arrInstancesQueries.getEnabled()` (id/name/type/url only), `getActiveArrCredentialKeyVersion()` + `getAllArrCredentialKeyVersions()` + `arrInstanceCredentialsQueries.getByInstanceId(id)` (→ `key_version` per instance). Runs the `sanitizeLogMeta` self-verify → `redactionVerified`. Sets `sessionCookieSecure=false` (current constant), `nowIso = new Date().toISOString()`. A malformed `instance.url` degrades that row (engine assigns tier `unknown`, score `null`) — never throws.
- **`service.ts`:** `computeShield(): Promise<ShieldReport> = computeShieldReport(await buildPostureInputs())`. Read-only, never persists.
- **`responses.ts`:** mutable `Wire*` DTOs (`WireCheck`, `WireTransportRow`, `WireRecommendation`, `WireFix`, `WireAssurance`, `WireAdvisory`, `WireTopAction`, `SecurityPostureSummaryResponse`) mirroring the OpenAPI schemas; `toSummaryResponse(report)` maps `ReadonlyArray`→mutable. Source of truth the yaml mirrors (Portable Contract Fidelity).

---

## 7. API surface

Single GET endpoint. No settings endpoint (static catalog is imported directly from `$shared/security/catalog.ts`), no `[instanceId]` detail, no trends.

- **`GET /api/v1/security-posture/summary`** → **200** `SecurityPostureSummaryResponse` `{ engineVersion, generatedAt, score, band, bandCappedBy, checks[], transport[], assurances[], advisories[], topActions[] }`; **500** `{ error }` **only on internal failure**. Degraded/never-evaluable states ride in the 200 body (per-check `score:null`/`status:'na'`, per-row `tier:'unknown'`). Rides the standard auth middleware; **never returns any secret value** (presence booleans + host strings only).

---

## 8. UI

**Placement — top-level Overview nav item `/security-posture` (chosen over a `/settings/security` panel).** Justification: it is a cross-cutting, whole-deployment audit (not a single settings form), it is the structural sibling of `/config-health` and `/drift`, and its recommendations deep-link _into_ settings — so it belongs beside them in Overview, with a reciprocal link from `/settings/security`.

Nav registry entry (after `config_health`, order 6):

```ts
{ id: 'overview.security_posture', label: 'Security Posture', href: '/security-posture',
  groupId: ensureGroupId('overview'), order: 6, arrScope: scopeAll,
  mobilePriority: 'medium', iconKey: 'ShieldCheck', emoji: '🛡️', hasChildren: false }
```

`iconMap.ts` gains `import { ShieldCheck } from 'lucide-svelte'` + `ShieldCheck` in `NAV_ICON_MAP`.

**`shieldStatus.ts`** (mirrors `healthStatus.ts`): `SHIELD_BAND_LABEL {hardened:'Hardened',guarded:'Guarded',exposed:'Exposed',unknown:'Unknown'}`, `SHIELD_BAND_TEXT_CLASS` (emerald/amber/red/neutral), `bandVariant` → `hardened:'success' · guarded:'warning' · exposed:'danger' · unknown:'neutral'`.

**Page layout** (`+page.svelte`, client-fetches `/summary`, Refresh + request-id guard like config-health):

1. **Header** — h1 "Security Posture", subtitle "A read-only audit of the security settings Praxrr already knows — no scanning, no probing.", a neutral **"Non-blocking"** pill, Refresh.
2. **Redaction-failure banner** — full-width danger banner **only** when `redactionVerified` is false.
3. **Hero** — band-tinted score number (via `$ui/card` + `SHIELD_BAND_TEXT_CLASS`) + band `Badge`; if `bandCappedBy` set, "Band limited by a critical finding: {label}" anchoring to that check. `unknown` → em-dash, never a misleading 0.
4. **"To reach Hardened"** — `topActions` (recoverablePoints desc): severity dot + headline + inline `ShieldFixControl` + "+X pts". When already hardened → green affirmation card.
5. **Check cards** — one `$ui/card` per scored check: tone-derived status `Badge`, sub-score, contribution, machine `detail` bullets, then each recommendation as a `ShieldRecommendationBlock` (NarrationBlock + fix). A `null` check renders "Not evaluated" + reason — never 0.
6. **Transport table** (inside the `arr_transport` card) — one row per enabled instance: name, `arrType` badge, scheme badge (green https / red http), tier badge (encrypted/loopback/docker-alias/private = ok-to-warning; public = danger; unknown = neutral), host (host only), per-row "Edit" fix link. `$ui/state/EmptyState` **only** in this section when 0 enabled instances (auth/app-key/rotation still score).
7. **Assurances strip — "Always-on protections"** — verified green badges: Log redaction (runtime-verified #8), Arr credentials encrypted at rest (#9). These contribute **zero** to the score.
8. **Advisories** — non-scored actionable notes: session-cookie `secure:false` / serve-Praxrr-over-TLS (with a code-follow-up note), and the neutral "Arr API keys are AES-256-GCM encrypted at rest, which is why they are not flagged here."

Copy is non-alarmist, colorblind-safe (label + icon, not color alone), and never implies the app blocks anything.

---

## 9. Integration checklist

- [ ] `registry.ts` — add `overview.security_posture` (order 6, `iconKey:'ShieldCheck'`).
- [ ] `iconMap.ts` — import + register `ShieldCheck` (allowlist).
- [ ] `tests/base/navigationShellLayout.test.ts` — add `'/security-posture'` after `'/config-health'` in **both** `topLevelHrefs` and `deepLinks`.
- [ ] `tests/base/navigationScopeFiltering.test.ts` — add `'/security-posture'` in `sidebarOrder` **and** the two other expected href arrays.
- [ ] `routes/settings/security/+page.svelte` — "View security posture →" link. (`settingsItems` NOT touched — top-level page, by design.)
- [ ] OpenAPI: `schemas/security-posture.yaml` + `paths/security-posture.yaml` + re-export in `openapi.yaml`. Route `satisfies` generated types; do **not** commit a noisy full `v1.d.ts` regen.
- [ ] `scripts/test.ts` — add `security-posture` alias.
- [ ] DRY: `$shared/scoring/rollup.ts` created; `$shared/health/policy.ts` re-exports it (existing #22 tests must stay green); `$shared/narration/narrate.ts` exports `sortSuggestions`.
- [ ] Confirm **no** migration / settings table / job / snapshot added.

---

## 10. Test plan

**`tests/shared/scoring/rollup.test.ts`** (extracted, generic): contributions sum EXACTLY to overall across random weight sets; zero-weight fallback → equal weighting; residual to largest weight.

**`tests/shared/security/engine.test.ts`** (Deno.test + `@std/assert`, `makePostureInputs` factory): determinism (same input → deep-equal report); instance-order-invariance (shuffle → deep-equal); no `Date`/`Math.random` reachable (nowIso passed in, `generatedAt === nowIso`); `null` excluded from rollup and band (adding a null-returning check changes neither); weight re-normalization when a check is null; band thresholds at 85/60; monotonicity (auth `oidc≥on≥local≥off-loopback≥off-public` never inverts; transport `https≥loopback-http≥private-http≥public-http`); `unknown` only when all checks null; **critical-cap** — AUTH=off+0.0.0.0 with otherwise-perfect checks yields numeric ≈33 but `band='exposed'`, `bandCappedBy='control_plane_auth'`; public-http caps at `guarded`; `recoverablePoints == round((100−score)×normalizedWeight)`; `topActions` sorted by recoverablePoints then severity; **actionability invariant** — every recommendation with tone ∈ {warning,danger} has `fix.kind !== 'none'`, and env-var recs carry exact names (`AUTH`, `OIDC_*`, `ARR_CREDENTIAL_MASTER_KEY`).

**`tests/shared/security/checks.test.ts`**: `control_plane_auth` off/loop=55, off/non-loop=35, local=60, on=100, oidc-full=100, oidc-partial=50, never null. `arr_transport` **classifier table**: https=100; http+`127.0.0.1`/`::1`/`[::1]`/`localhost`/`0.0.0.0`=100; http+bare `radarr`=100; http+`10.x`/`192.168.x`/`.local`=65; http+unknown FQDN=65 (never public/danger); http+public-IP literal=30; malformed URL → tier `unknown`, score `null`; mean aggregation; 0 instances → null. `app_key_at_rest` on/local+strong=70, +weak=45, no-key=null, oidc/off=null, value never emitted. `credential_rotation` single-version → null; multi-version with N stale decryptable rows → `100−20N`; 0 instances → null.

**`tests/routes/securityPosture.test.ts`**: `GET /summary` 200 shape `satisfies` schema; malformed-URL instance degrades to `na` without a 500; 0-instances still returns auth/app-key/rotation checks + assurances; forced gather error → 500 `{error}`; **no secret value present anywhere in the payload**.

**`tests/logger/sanitizerRegression.test.ts`** (logger alias): the real `sanitizeLogMeta` redacts a synthetic secret bundle → `redactionVerified===true`; the durable home for the ex-"self-verify" idea.

**Gather test** (with config/instance fixtures): presence-only api-key read (value discarded), `external_url` ignored, per-instance URL parse failure degrades without throwing, rotation facts assembled from key-version helpers.

Smoke: `deno task test security-posture`, `deno task check`, and `deno task dev:noauth` across `AUTH=off/on/oidc` and http/https instance URLs.

---

## 11. Out-of-scope / future follow-ups

- **Code follow-up (separate issue):** make the session cookie `secure` flag conditional on the served/forwarded scheme (`X-Forwarded-Proto`) instead of hard-coded `false`, and introduce a session-signing secret. Shield surfaces this as an advisory today; the code fix is a `fix`/`feat(auth)` change, not part of #28.
- **Optional `TRUSTED_PROXY` assertion:** a future env flag letting an AUTH=off operator confirm an authenticating proxy, so `control_plane_auth` could lift the `exposed` cap. Not inventing that config now — the current narration handles the proxy case.
- **Hoist rollup consumers:** once a third scorer appears, formalize `$shared/scoring` as the canonical weighted-rollup module.
- **App-key entropy (beyond length):** current strength check is length-based (Praxrr keys are 32-hex); a richer entropy heuristic could follow if weak custom keys become common.
- **DNS-aware transport grading:** unknown FQDNs are graded conservatively; an opt-in resolver (still no probing of the Arr port) could later distinguish public vs split-horizon — deferred as it risks reintroducing network I/O.
