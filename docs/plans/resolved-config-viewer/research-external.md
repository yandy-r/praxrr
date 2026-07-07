# External Research: Resolved Config Viewer (Issue #25)

Research scope: Radarr/Sonarr APIs relevant to comparing desired (PCD-resolved) vs actual (live
Arr) configuration state; JS/TS diff libraries for Deno + SvelteKit; comparable
desired-vs-actual/state-diff tooling (Terraform, ArgoCD, Flux, Recyclarr/Notifiarr/Profilarr);
and Radarr/Sonarr API quirks that affect a diff/compare feature.

⚠️ **Freshness note**: Radarr/Sonarr do not publish versioned API changelogs outside their GitHub
`develop` branches, and their public docs pages (`radarr.video/docs/api`, `sonarr.tv/docs/api`)
are JS-rendered Swagger/Redoc UIs that don't yield useful content to static fetchers — most
authoritative detail below was sourced from the live C# source (`develop` branch) and from
DeepWiki/community-generated OpenAPI clients, which track source directly. Field-level facts
should be spot-checked against a running instance's `/api/v3/openapi.json` before finalizing the
UI's data model, since these are unversioned, source-of-truth-is-the-code APIs.

---

## Executive Summary

1. **Radarr and Sonarr expose no native "resolved config" or diff endpoint.** Both apps expose
   flat CRUD REST APIs per entity (`/api/v3/customformat`, `/api/v3/qualityprofile`,
   `/api/v3/releaseprofile` [Sonarr only], `/api/v3/config/mediamanagement`,
   `/api/v3/config/naming`). "Desired vs actual" is something every comparable tool (Recyclarr,
   Configarr, Profilarr, Notifiarr) computes client-side by fetching full live state and diffing
   it against a locally computed desired state — there is no server-assisted diff/dry-run API to
   lean on. This validates Praxrr's existing approach (PCD compiled state vs. Arr GET response)
   and means the "diff against live Arr instance" bullet (#4) is 100% a client-side computation
   problem, not something an Arr endpoint can do for you. **Confidence: High** (confirmed via
   Radarr/Sonarr C# source, Recyclarr/Configarr/Profilarr docs, ArrAPI/devopsarr client libs).

2. **`microdiff` is the best-fit diff library for this stack.** It's <1kb, zero-dependency,
   Deno-native (`https://deno.land/x/microdiff`, plus npm/JSR), TypeScript-typed, and its
   `{type, path, value, oldValue}` output shape maps directly onto a "base vs user vs resolved vs
   live" layered diff without extra transformation. `jsondiffpatch` is heavier but adds
   patch/revert and a built-in visual diff formatter if a more "GitHub-style" diff view is wanted
   later. **Confidence: High** (multiple independent benchmarks + official docs/README agree).

3. **Radarr and Sonarr custom format/quality profile payloads are structurally similar but
   semantically incompatible per-app** — same JSON shape (`specifications[].implementation`,
   `.fields[].value`), but numeric enum values (e.g. `SourceSpecification` for WEBDL/WEBRIP/etc.)
   differ between apps, and Sonarr has `ReleaseTypeSpecification` with no Radarr equivalent.
   TRaSH Guides explicitly states custom formats are **not** portable between Radarr and Sonarr.
   This directly reinforces Praxrr's existing Cross-Arr Semantic Validation Policy — a resolved
   viewer must never render a generic "field diff" that assumes shared semantics across
   `arr_type`. **Confidence: High** (Radarr/Sonarr GitHub source + TRaSH Guides docs).

4. **Neither API paginates `customformat`/`qualityprofile`/`releaseprofile`** — they return full
   arrays in one response, no `X-Total-Count` or page params (unlike `/log` and `/queue`, which
   are paginated with `page`/`pageSize`). This simplifies "fetch full live state per instance"
   fan-out logic (no pagination loop needed for the entities this feature cares about) but means
   large libraries can produce large single responses. **Confidence: High.**

5. **Comparable tools converge on the same architecture pattern**: fetch full live state → compute
   local "desired" state → structural diff (not raw JSON diff) → render categorized results
   (create/update/no-op/delete) → optional preview/dry-run gate before write. ArgoCD's server-side
   diff and Flux's dry-run diff both emphasize *normalization before diffing* (defaults, ordering,
   computed fields) to avoid false-positive drift — directly relevant to Radarr/Sonarr since
   arrays like `items`/`formatItems`/`specifications` are order-sensitive in the API but should
   often be compared as sets. **Confidence: High** (ArgoCD/Flux official docs; Recyclarr/Profilarr
   docs describe equivalent behavior for Arr-specific sync).

---

## Primary APIs

### Radarr API v3

- **Docs**: https://radarr.video/docs/api/ (JS-rendered Swagger UI; use a running instance's
  `/api/v3/openapi.json` or `/docs` for the authoritative live schema — the public docs page does
  not serve static, fetchable content).
- **Source of truth used here**: https://github.com/Radarr/Radarr — resource classes under
  `src/Radarr.Api.V3/`.
- **Auth**: `X-Api-Key` header (also accepted as `apikey` query param per generated OpenAPI
  clients). Radarr V5 tightened this — API keys/passwords are now obfuscated in responses and the
  key can no longer be read from `initialize.json` without auth
  ([Radarr#9397](https://github.com/Radarr/Radarr/issues/9397)) — not relevant to v3 API used by
  Praxrr today but worth flagging if/when Radarr v5 support is considered.
- **Relevant endpoints**:
  - `GET /api/v3/qualityprofile` — full array, no pagination.
  - `GET /api/v3/qualityprofile/schema` — template/default shape for a new profile.
  - `GET /api/v3/qualityprofile/{id}`, `PUT`, `DELETE`.
  - `GET /api/v3/customformat` — full array, no pagination.
  - `GET /api/v3/customformat/schema` — default shape for new custom formats.
  - `GET /api/v3/customformat/{id}`, `PUT`, `DELETE`.
  - `GET /api/v3/config/mediamanagement`, `GET /api/v3/config/naming` — singleton config
    resources (PUT requires `/{id}`).
  - `GET /api/v3/qualitydefinition` — quality size/definition list (relevant to "resolved config"
    scope beyond profiles/CFs).
  - `GET /api/v3/system/status` — version/app identification, already used by Praxrr's
    `getSystemStatus()`.
- **Rate limiting**: Radarr/Sonarr do **not** rate-limit their own local REST API by API key —
  there is no documented 429/backoff contract for `/api/v3/*`. The only rate-limiting concerns in
  the ecosystem are for *downstream indexer* calls (Torznab/Jackett), which is unrelated to this
  feature. Practical implication: self-imposed client-side concurrency limiting is a courtesy
  (avoid saturating a small home-server instance with N parallel fan-out requests), not a
  contract requirement. **Confidence: Medium** (no rate-limit docs exist to confirm; inferred from
  absence of any documented rate-limit behavior across GitHub issues/forums searched).

### Sonarr API v3 (also serves Sonarr v4 apps)

- **Docs**: https://sonarr.tv/docs/api/ (same JS-rendered limitation as Radarr's docs page).
  Sonarr's dev docs note two API generations: **V3** (stable, used by both Sonarr v3 and v4 apps)
  and **V5** (Sonarr v5 app only, not yet relevant to Praxrr's stated Sonarr v3/v4 support). Docs
  are generated from source and exposed per-instance at `/docs/{version}/openapi.json`.
- **Source of truth used here**: https://github.com/Sonarr/Sonarr —
  `src/Sonarr.Api.V3/Profiles/Quality/QualityProfileResource.cs`.
- **Auth**: `X-Api-Key` header, same convention as Radarr.
- **Relevant endpoints**:
  - `GET /api/v3/qualityprofile` — array, no pagination. Fields: `name`, `upgradeAllowed`,
    `cutoff`, `items[]`, `minFormatScore`, `cutoffFormatScore`, `minUpgradeFormatScore`,
    `formatItems[]`. **No `language` field** on Sonarr's `QualityProfileResource` — Radarr's
    equivalent adds a `language` field (Radarr is film-language-aware; Sonarr is not). This is a
    concrete field-parity gap the resolved viewer must account for per `arr_type` (do not render
    "language" as a universal profile attribute).
  - `GET /api/v3/releaseprofile` — Sonarr-only concept (no Radarr equivalent). Fields per the Go
    client (`golift.io/starr/sonarr`): `name`, `enabled`, `required`, `ignored`, `indexerId`,
    `tags`, `id`; **`incPrefOnRename` and `preferred` are v3-app-only and were removed in the v4
    app's payload** — another concrete version-skew gotcha for the "layer breakdown" / "resolved
    view" feature if Praxrr ever needs to render release profiles across mixed v3/v4 Sonarr
    instances.
  - `GET /api/v3/customformat` — **Sonarr custom-format management is v4-app-only.** Sonarr v3
    apps do not expose custom format CRUD endpoints at all. Any resolved-config view that includes
    custom formats must gate that view per-instance on detected Sonarr app version, not just
    `arr_type === 'sonarr'`.
  - `GET /api/v3/config/mediamanagement`, `GET /api/v3/config/naming` — same shape pattern as
    Radarr, singleton resources.

### Auth / Rate Limiting — Practical Guidance

No formal rate-limit contract exists for either app's local API. Recommended pattern (also used
by Recyclarr/Profilarr conceptually): treat each Arr instance as a small, potentially
resource-constrained home server — bound concurrent in-flight requests **per instance** (e.g. via
`p-limit`/Deno's `BatchQueue`) rather than relying on the Arr app to reject excess load, and
apply Praxrr's existing retry logic (`BaseArrClient`/`BaseHttpClient` already has a `retries`
option) for transient network failures during fan-out compare-all-instances operations.

---

## Libraries and SDKs

### JSON/Object Diff Libraries (Deno + SvelteKit compatible)

| Library | Size | Deno support | Patch/revert | Notes |
|---|---|---|---|---|
| [`microdiff`](https://github.com/AsyncBanana/microdiff) | <1kb min+gzip | Native (`deno.land/x/microdiff`, npm, JSR-installable via npm specifier) | No | Fastest in every published benchmark (up to ~4x faster than `deep-diff`, ~2x faster than `deep-object-diff`); output `{type: CREATE\|REMOVE\|CHANGE, path, value, oldValue}[]`; `cyclesFix` option (disable for parsed-JSON-only inputs, which is Praxrr's use case, for a further speed win); MIT license, v1.5.0 (Dec 2024). |
| [`jsondiffpatch`](https://github.com/benjamine/jsondiffpatch) | ~15-20kb | Works via npm specifier (`npm:jsondiffpatch`) | Yes (diff/patch/unpatch/reverse) | Array diffing with `objectHash` for move-detection; ships an HTML/visual formatter (`formatters.html`) that could shortcut a "resolved vs base" visual diff UI; heavier and more configuration surface. |
| [`deep-object-diff`](https://github.com/mattphillips/deep-object-diff) | small, higher npm downloads than microdiff | Works via npm specifier | No | Middle ground; `detailedDiff()` returns `{added, deleted, updated}` trees rather than a flat path list — arguably a more natural shape for a "layer breakdown" (base/user/resolved) UI than microdiff's flat array, at the cost of raw speed. |
| [`diff`](https://www.npmjs.com/package/diff) (jsdiff) | small | Works | Line/text diff only | Not suited to structured JSON diffing (2000%+ slower than microdiff in benchmarks when abused for object diffing) — only relevant if Praxrr wants raw-text/JSON-string diffs as a secondary view. |

**Recommendation**: `microdiff` for the core diff computation (fast, tiny, Deno-native, and its
`path`-based output composes cleanly with Praxrr's existing PCD ops/path conventions), with a thin
adapter layer that regroups its flat `Difference[]` into base/user/resolved "layers" for the UI
rather than adopting a heavier all-in-one library. Reserve `jsondiffpatch` as a fallback only if
patch/revert semantics are needed later (e.g., "revert this field to base value" as a one-click
action — worth flagging as a possible V2 feature that would justify swapping in `jsondiffpatch`
instead of hand-rolling revert on top of microdiff's diff-only output).

Sources: [microdiff GitHub](https://github.com/AsyncBanana/microdiff),
[microdiff on Deno](https://deno.land/x/microdiff@v1.5.0),
[jsondiffpatch GitHub](https://github.com/benjamine/jsondiffpatch),
[npm-compare: deep-diff/jsondiffpatch/object-diff](https://npm-compare.com/deep-diff,jsondiffpatch,object-diff).

### Svelte Tree/Diff View Rendering

| Library | Svelte 5 | Diff-aware | Notes |
|---|---|---|---|
| [`svelte-tree-view` v2](https://github.com/TeemuKoivisto/svelte-tree-view) | Yes (v2 rewritten for Svelte 5 runes/snippets) | Yes — explicitly documents accepting diff data (e.g. `data={contentDiff}`) with a custom `valueComponent` for rendering per-node diff state, base16 theming | Best fit if the "layer breakdown toggle" needs a real interactive tree rather than a flat table. **Caveat**: Praxrr's CLAUDE.md convention is "Svelte 5, no runes" — v2 of this library is built around runes/snippets, so it needs a compatibility check before adoption; may require using it in "compat mode" or building a lighter bespoke tree component instead. |
| [`svelte-json-view-lite`](https://jsonview.svelte.page/) | Yes (Svelte-5-native, zero deps) | No (view-only, no diff highlighting) | Good candidate for the plain "resolved state" viewer (no diff), simpler adoption risk than svelte-tree-view v2. |
| [`git-diff-view`](https://mrwangjusttodo.github.io/git-diff-view/) | Yes (React/Vue/Solid/Svelte) | Yes — GitHub-style unified/split diff | Best fit if "diff against live Arr instance" should look like a code review diff rather than a tree; heavier dependency, multi-framework core.
| [`svelte-json-tree`](https://github.com/tanhauhau/svelte-json-tree) | Predates Svelte 5 | No | Used in the Svelte REPL itself; lower risk historically but not confirmed Svelte-5-native. |

**Recommendation**: Given the "no runes" convention, a bespoke lightweight tree/table component
built on top of `microdiff`'s flat path output (grouped by top-level field, rendered as
expand/collapse rows with base/user/resolved/live columns) is likely lower-risk than adopting a
runes-based external tree component. If a polished out-of-the-box diff view is preferred over
build cost, `git-diff-view`'s Svelte target is the most actively maintained diff-specific option
found and doesn't require runes.

---

## Integration Patterns

### Terraform (`plan`/`state`) — Resolved Config Precedent

Terraform's `terraform show -json` plan output is the closest existing precedent for a "resolved
config" concept: it separates **`configuration`** (unevaluated, resolved expression tree — analogous
to Praxrr's "base ops + user ops" resolved definition), **`planned_values`** (a flattened
values-only view — analogous to a "resolved" tab), and **`resource_drift`** (changes detected
between prior recorded state and live infrastructure — directly analogous to bullet #4, "diff
against live Arr instance"). Terraform's `resource_drift` uses the *same* diff structure as
`resource_changes` (before/after/before_sensitive/after_sensitive), which is a useful modeling
idea: reuse one diff shape for both "user ops vs base" and "resolved vs live Arr" rather than
building two bespoke diff renderers.
[Docs](https://developer.hashicorp.com/terraform/internals/json-format).

### ArgoCD — Desired vs Live State Diff

ArgoCD's Application Controller continuously diffs generated (desired) manifests against live
cluster state, and — critically — **normalizes both sides before diffing** to avoid false-positive
drift from defaulted/computed fields and object/array ordering
([diff strategies docs](https://argo-cd.readthedocs.io/en/stable/user-guide/diff-strategies/),
[diffing customization](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)). Two
takeaways directly applicable to Radarr/Sonarr:
1. **Normalize before diff.** Arr quality-profile `items[]`/`formatItems[]` and custom-format
   `specifications[]` arrays should be compared as ID-keyed sets (or hashed by stable identity),
   not by array index/order — otherwise a server-side reorder (which the Arr UI can produce) will
   register as a false diff on every field.
2. **`ignoreDifferences`-style exclusions are necessary.** ArgoCD lets teams ignore fields
   mutated by controllers outside their control (e.g., HPA-managed `replicas`). Radarr/Sonarr
   equivalents: server-assigned `id`, and any field known to be locally overridden by a user via
   the Arr UI outside Praxrr's control — these need an explicit "ignore in diff" list rather than
   surfacing as permanent unresolvable drift.

### Flux (`flux diff kustomization`) — Dry-Run Diff Command Pattern

Flux's `flux diff kustomization` performs a build + server-side dry-run, then diffs against the
live cluster, printing a unified (`---`/`+++`) diff per resource and using **secret redaction** to
avoid leaking sensitive values in diff output
([docs](https://fluxcd.io/flux/cmd/flux_diff_kustomization/)). Two applicable ideas: (a) a CLI/API
"dry-run diff" endpoint that returns exit-code-style status (no diff / diff found / error) is a
clean contract for a future automation/CI use case on top of the resolved-config viewer; (b)
**redact secrets in diff output** — directly relevant, since Arr `config/*` payloads and download
client configs can contain credentials; any resolved/diff view must redact sensitive fields
(Praxrr already has credential-redaction conventions per its test suite —
`arrCredentialRedactionRoutes.test.ts` — reuse that redaction logic in any new diff-rendering
path).

### Recyclarr / Configarr / Profilarr / Notifiarr — Arr-Specific Sync Precedent

- **Recyclarr**: config-driven (YAML), 4 independent sync pipelines (custom formats → quality
  profiles → quality sizes → naming/media management), `--preview` dry-run mode that computes the
  same diff it would apply without writing, and a **local state file** to disambiguate "did the
  user rename this in the Arr UI" from "did the source change" — a instance-identity-scoped cache
  keyed by base URL. [recyclarr.dev/guide/sync-behavior](https://recyclarr.dev/guide/sync-behavior/),
  [recyclarr.dev/guide/troubleshooting/state](https://recyclarr.dev/guide/troubleshooting/state/).
- **Configarr**: same TRaSH-sync model as Recyclarr but container/cron-oriented, extensible beyond
  guide-provided values. [configarr.de](https://configarr.de/docs/intro/).
- **Profilarr**: closest analog to Praxrr's own product shape — full web UI (no YAML/CLI), custom
  format testing with match visualization, quality profile **simulation** (scoring/ranking
  preview), sync to multiple Arr instances, and a PCD-like "local tweaks that persist across
  upstream updates with smart conflict handling" model.
  [github.com/Dictionarry-Hub/profilarr](https://github.com/Dictionarry-Hub/profilarr) — worth a
  closer look as a UX reference for the "layer breakdown" and "cross-instance comparison" bullets
  specifically, since it already solves a very similar base/override/sync problem for the same
  domain.
- **Notifiarr**: paid, fully-managed automatic sync with periodic guide-update polling; profiles
  are templated from guides rather than built from scratch — less relevant architecturally, more
  relevant as a UX example of "detect update, notify, don't auto-apply."

Sources: [trash-guides.info/Guide-Sync](https://trash-guides.info/Guide-Sync/),
[recyclarr.dev](https://recyclarr.dev/), [configarr.de/docs/comparison](https://configarr.de/docs/comparison/),
[Profilarr GitHub](https://github.com/Dictionarry-Hub/profilarr).

### DevOpsArr Terraform Providers (`terraform-provider-radarr`/`-sonarr`)

Built on HashiCorp's `terraform-plugin-framework`; they don't implement bespoke diff logic
themselves — Terraform Core's schema-driven plan/diff engine does the comparison, while the
provider's job is purely translating Arr REST responses into typed Terraform schema attributes on
`Read`. Useful as a **field-mapping reference** (their resource docs enumerate every
Radarr/Sonarr field with its Terraform type) rather than as an architecture pattern to copy, since
Praxrr doesn't have Terraform Core's plan engine to lean on and must build the diff itself (as
Recyclarr/Configarr/Profilarr already do).
[devopsarr/radarr docs](https://registry.terraform.io/providers/devopsarr/radarr/latest/docs),
[devopsarr/sonarr docs](https://registry.terraform.io/providers/devopsarr/sonarr/latest/docs).

### Rate-Limit-Aware Fan-Out (Cross-Instance Comparison, Bullet #3)

For "cross-instance comparison of resolved state for the same profile across instances," the
established Deno/TS pattern is bounded concurrency, not raw `Promise.all`:
- [`p_limit` for Deno](https://deno.land/x/p_limit) — direct Deno port of the npm `p-limit`
  API; wrap each per-instance fetch in `limit(() => client.getQualityProfiles())` and cap
  concurrent in-flight instance calls.
- Deno's built-in `BatchQueue` (Deno std) is a native alternative avoiding an extra dependency.
- A documented reason to avoid naive `Promise.all` fan-out beyond politeness: concurrent
  HTTP/2 requests issued before a server's SETTINGS frame arrives can trigger
  `REFUSED_CONNECTION` on some servers
  ([denoland/deno#21789](https://github.com/denoland/deno/issues/21789)) — a concrete argument
  for bounding concurrency per-instance even though Arr doesn't publish a rate limit.
- Praxrr's `BaseArrClient`/`BaseHttpClient` already supports a `retries` option
  (`packages/praxrr-app/src/lib/server/utils/arr/base.ts`) — reuse that for per-instance fetch
  resilience during fan-out rather than introducing a second retry mechanism.

---

## Constraints and Gotchas

1. **No shared field semantics across `arr_type`, even where JSON shape matches.**
   `QualityProfileResource`: Radarr has a `language` field, Sonarr's does not. Custom format
   `specifications[].fields[].value` numeric enums (e.g., `SourceSpecification`) mean different
   things in Radarr vs. Sonarr (WEBDL/WEBRIP mapped to different integers per app). TRaSH Guides
   explicitly states custom formats are not portable/backward-compatible between the two apps.
   **A resolved-config diff must never assume "same field name/value = same meaning" across
   `arr_type`** — this is exactly what the repo's existing Cross-Arr Semantic Validation Policy
   already mandates, and this feature is a strong candidate for accidentally violating it (e.g., a
   naive generic-diff-component approach) if not careful.

2. **Sonarr version skew inside "v3 API."** Sonarr's `/api/v3/*` surface is shared by both the
   Sonarr v3 app (EOL, no custom format support) and the Sonarr v4 app (adds custom formats,
   removes `ReleaseProfileResource.Preferred`/`IncPrefOnRename`). A resolved-config viewer that
   supports multiple Sonarr instances must branch behavior on detected Sonarr **app version**
   (available from `system/status`), not just the API path version, when deciding whether to
   render/fetch custom formats or which release-profile fields to expect.

3. **No pagination on the entities this feature needs** (`qualityprofile`, `customformat`,
   `releaseprofile`) — full arrays only. Good for simplicity, bad for very large custom-format
   libraries on constrained instances; consider payload size when doing cross-instance fan-out
   (bullet #3) rather than assuming cheap responses.

4. **No formalized validation-error contract.** 400 responses from Radarr/Sonarr wrap raw .NET
   exceptions inconsistently (`message`/`description` from `ValidationFailure`, sometimes a raw
   `ArgumentNullException` message) rather than a stable JSON schema like RFC 7807
   `application/problem+json`
   ([Radarr#10555](https://github.com/Radarr/Radarr/issues/10555)). Any "diff against live" fetch
   path needs defensive error handling that doesn't assume a parseable structured error body —
   this is consistent with the existing `HttpError`/status-code-based handling already in
   `BaseArrClient.getSystemStatus()`.

5. **Custom-format tag/name validation is strict and app-side** (e.g., tag labels are restricted
   to lowercase/digits/hyphens) — a resolved view that shows "what would be written" should
   surface these constraints as pre-flight validation rather than only discovering them via a 400
   on write.

6. **Arrays are order-sensitive in the API but often should be order-insensitive in a diff.**
   `qualityprofile.items[]`, `formatItems[]`, and `customformat.specifications[]` all come back as
   ordered arrays. A raw index-based diff (what `microdiff` and most libraries do by default) will
   flag a pure reorder as N changes. Mirror ArgoCD's normalization approach: key these arrays by a
   stable identity (format ID, quality ID) before diffing, not array index.

7. **Secrets/credentials in config payloads.** `config/mediamanagement`, download client configs,
   and similar endpoints can carry sensitive values. Any generic diff/tree renderer must route
   through Praxrr's existing credential redaction rather than rendering raw API JSON — reuse
   redaction logic already covered by `arrCredentialRedactionRoutes.test.ts` /
   `arrCredentialEncryption.test.ts`.

---

## Code Examples

### Radarr `CustomFormatResource` (C#, from `develop` branch)

```csharp
public class CustomFormatResource : RestResource
{
    public string Name { get; set; }
    public bool? IncludeCustomFormatWhenRenaming { get; set; }
    public List<CustomFormatSpecificationSchema> Specifications { get; set; }
}
```

### Radarr `QualityProfileResource` (C#, from `develop` branch)

```csharp
public class QualityProfileResource : RestResource
{
    public string Name { get; set; }
    public bool UpgradeAllowed { get; set; }
    public int Cutoff { get; set; }
    public List<QualityProfileQualityItemResource> Items { get; set; }
    public int MinFormatScore { get; set; }
    public int CutoffFormatScore { get; set; }
    public int MinUpgradeFormatScore { get; set; }
    public List<ProfileFormatItemResource> FormatItems { get; set; }
    public Language Language { get; set; } // Radarr-only; no Sonarr equivalent
}
```

### Sonarr `QualityProfileResource` (C#, from `develop` branch — note: no `Language` field)

```csharp
public class QualityProfileResource : RestResource
{
    public string Name { get; set; }
    public bool UpgradeAllowed { get; set; }
    public int Cutoff { get; set; }
    public List<QualityProfileQualityItemResource> Items { get; set; }
    public int MinFormatScore { get; set; }
    public int CutoffFormatScore { get; set; }
    public int MinUpgradeFormatScore { get; set; }
    public List<ProfileFormatItemResource> FormatItems { get; set; }
}
```

### Custom Format Specification JSON shape (shared shape, per-app semantics)

```json
{
  "name": "WEB Tier 01",
  "includeCustomFormatWhenRenaming": false,
  "specifications": [
    {
      "name": "Source",
      "implementation": "SourceSpecification",
      "negate": false,
      "required": true,
      "fields": [{ "name": "value", "value": 7 }]
    }
  ]
}
```
`value: 7` for `SourceSpecification` means different things in Radarr vs. Sonarr — never diff or
copy this field cross-app without an explicit `arr_type`-scoped mapping table.

### `microdiff` usage sketch for a layered resolved-config diff

```ts
import diff from "https://deno.land/x/microdiff@v1.5.0/index.ts";
// or, with npm specifiers in deno.json: import diff from "npm:microdiff";

type Layered<T> = { base: T; resolved: T; live?: T };

function diffLayer<T extends Record<string, unknown>>(a: T, b: T) {
  // cyclesFix: false is safe here since inputs are parsed JSON (no cycles) — faster path.
  return diff(a, b, { cyclesFix: false });
}

// base -> resolved (what user ops changed on top of base)
const userOverrides = diffLayer(baseQualityProfile, resolvedQualityProfile);

// resolved -> live Arr instance (drift / out-of-band changes)
const driftFromLive = liveQualityProfile
  ? diffLayer(resolvedQualityProfile, liveQualityProfile)
  : [];
```

Before diffing order-sensitive arrays (`items`, `formatItems`, `specifications`), normalize by
sorting on a stable key (id/name) so reorders don't register as spurious CHANGE entries:

```ts
function byId<T extends { id: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id - b.id);
}
```

### Bounded fan-out across instances (Deno)

```ts
import pLimit from "https://deno.land/x/p_limit/mod.ts";

const limit = pLimit(3); // cap concurrent in-flight instance calls

const results = await Promise.allSettled(
  instances.map((instance) =>
    limit(() => arrClientFor(instance).getQualityProfiles())
  ),
);
```

---

## Open Questions

1. **Does Praxrr's PCD writer already expose a "resolved" read path per entity** (base ops +
   user ops merged, pre-sync) that this feature can reuse directly, or does the resolved-config
   viewer need to independently replay/compile ops for display purposes? (Internal question —
   not resolvable from external research; needs a codebase-side research pass, e.g. into
   `packages/praxrr-app/src/lib/server/pcd/ops/writer.ts` and the ops compiler.)
2. **What is Praxrr's existing convention (if any) for redacting/handling sensitive fields in
   API responses returned to the client** for display purposes, and can it be reused unmodified
   for a diff/tree view, or does diff rendering need its own redaction pass (e.g., to avoid
   leaking a redacted-vs-real value as a false "CHANGE")?
3. **Should "diff against live Arr instance" treat server-assigned/computed fields (id, any
   `formatItems[].format` id references) as always-ignored**, similar to ArgoCD's
   `ignoreDifferences`? Needs a product decision on which fields are structurally
   non-comparable vs. meaningfully comparable.
4. **Svelte 5 "no runes" constraint vs. `svelte-tree-view` v2's runes-based API** — confirm
   whether the "no runes" convention is a hard rule for all new components or specifically about
   avoiding `$state`/`$derived` in Praxrr's own code (in which case consuming a runes-internal
   third-party component might be acceptable, since its internals wouldn't need to match Praxrr's
   own component conventions). This determines whether `svelte-tree-view` v2 is viable or a
   bespoke tree component is required.
5. **Sonarr app-version detection for gating custom-format/release-profile field sets** — confirm
   whether Praxrr already tracks per-instance Sonarr app version (v3 vs v4) anywhere in
   `arr_instances`/sync metadata, since the resolved viewer needs it to avoid showing
   fields/entities that don't exist for a given instance's actual app version.
6. **Live Arr API rate-limit behavior is not formally documented anywhere** (see Primary APIs
   section) — if cross-instance comparison fan-out becomes a frequent, user-triggered action (not
   just a background sync), it may be worth empirically testing concurrency limits against a real
   instance rather than relying solely on courtesy-based bounding.

---

## Sources

- [Radarr API docs (JS-rendered, limited static value)](https://radarr.video/docs/api/)
- [Sonarr API docs (JS-rendered, limited static value)](https://sonarr.tv/docs/api/)
- [Radarr GitHub — CustomFormatResource.cs](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/CustomFormats/CustomFormatResource.cs)
- [Radarr GitHub — QualityProfileResource.cs](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/Profiles/Quality/QualityProfileResource.cs)
- [Sonarr GitHub — QualityProfileResource.cs](https://github.com/Sonarr/Sonarr/blob/develop/src/Sonarr.Api.V3/Profiles/Quality/QualityProfileResource.cs)
- [DeepWiki — Radarr REST API overview](https://deepwiki.com/radarr/radarr/4.1-rest-api)
- [DeepWiki — Sonarr API and application startup](https://deepwiki.com/Sonarr/Sonarr/2.2-api-and-application-startup)
- [golift.io/starr/sonarr Go client (ReleaseProfile v3/v4 field diffs)](https://pkg.go.dev/golift.io/starr/sonarr)
- [Radarr#9397 — API key/password obfuscation](https://github.com/Radarr/Radarr/issues/9397)
- [Radarr#10555 — misleading API error messages](https://github.com/Radarr/Radarr/issues/10555)
- [Radarr#5246 — no API paging/filtering](https://github.com/Radarr/Radarr/issues/5246)
- [TRaSH-Guides — Custom Format JSON structure](https://deepwiki.com/TRaSH-Guides/Guides/2.1-custom-format-structure)
- [TRaSH-Guides — Sonarr custom formats collection](https://trash-guides.info/Sonarr/sonarr-collection-of-custom-formats/)
- [Servarr Wiki — Sonarr v4 FAQ](https://wiki.servarr.com/sonarr/faq-v4)
- [microdiff GitHub](https://github.com/AsyncBanana/microdiff)
- [microdiff on Deno](https://deno.land/x/microdiff@v1.5.0)
- [jsondiffpatch GitHub](https://github.com/benjamine/jsondiffpatch)
- [npm-compare — deep-diff/jsondiffpatch/object-diff](https://npm-compare.com/deep-diff,jsondiffpatch,object-diff)
- [svelte-tree-view GitHub](https://github.com/TeemuKoivisto/svelte-tree-view)
- [svelte-json-view-lite](https://jsonview.svelte.page/)
- [git-diff-view](https://mrwangjusttodo.github.io/git-diff-view/)
- [Terraform JSON output format](https://developer.hashicorp.com/terraform/internals/json-format)
- [ArgoCD diff strategies](https://argo-cd.readthedocs.io/en/stable/user-guide/diff-strategies/)
- [ArgoCD diffing customization](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)
- [flux diff kustomization docs](https://fluxcd.io/flux/cmd/flux_diff_kustomization/)
- [Recyclarr — Sync Behavior](https://recyclarr.dev/guide/sync-behavior/)
- [Recyclarr — Sync State](https://recyclarr.dev/guide/troubleshooting/state/)
- [Configarr comparison](https://configarr.de/docs/comparison/)
- [Profilarr GitHub](https://github.com/Dictionarry-Hub/profilarr)
- [devopsarr/radarr Terraform provider docs](https://registry.terraform.io/providers/devopsarr/radarr/latest/docs)
- [devopsarr/sonarr Terraform provider docs](https://registry.terraform.io/providers/devopsarr/sonarr/latest/docs)
- [p_limit for Deno](https://deno.land/x/p_limit)
- [denoland/deno#21789 — concurrent HTTP/2 requests REFUSED_CONNECTION](https://github.com/denoland/deno/issues/21789)
