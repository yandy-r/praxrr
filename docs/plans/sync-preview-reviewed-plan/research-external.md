# External Research: Sync Preview Reviewed-Plan Binding

## Executive Summary

Issue #234 is best implemented as a server-held, versioned execution claim attached to each
preview. The claim should bind the reviewed preview to four things that must not be inferred again
at apply time:

1. the target `instanceId` and explicit `arrType`;
2. the exact ordered set of previewed sections, with apply allowed to choose only an explicit
   subset of those successful sections;
3. the materialized desired inputs actually used to build the preview, including any transient
   `sectionConfigs`, PCD/TRaSH transformations, namespace resolution, and quality mappings; and
4. the relevant live Arr representations read to compute the reviewed `current` side.

Store separate, versioned SHA-256 fingerprints for desired/PCD evidence and live Arr evidence,
preferably per section as well as in an aggregate envelope. Separate digests are essential: a
single combined digest can prove “something changed” but cannot satisfy the issue requirement to
name the evidence class that invalidated the review. Use the built-in Deno Web Crypto API and a
small explicit canonical projection; no hashing or canonical-JSON dependency is needed.

At apply, claim the preview once (`ready -> applying`), verify TTL and exact section/instance/type
claims, then re-materialize both evidence classes through the same builders used by preview. Do
this inside the sync execution boundary, after the per-instance/section claim and before any Arr
write. A mismatch or inability to obtain authoritative evidence must result in zero writes and a
typed, safe response that tells the UI to regenerate and review. Do not simply regenerate a
preview and then call the ordinary executor: that preserves the current time-of-check/time-of-use
gap and loses transient preview configuration.

Where practical, use a hybrid rather than fingerprint-only design: execute from the stored,
reviewed desired materialization and use the live Arr fingerprint as a value guard immediately
before the section's first mutation. Radarr, Sonarr, and Lidarr's published OpenAPI documents do
not advertise `ETag`, `If-Match`, or comparable conditional-write support on the relevant
configuration resources, so Praxrr cannot make cross-process Arr writes fully atomic against
external writers. The strongest dependency-free guarantee is therefore: serialize Praxrr's own
section execution, re-read the exact Arr fields immediately at the mutation boundary, fail closed
on mismatch/unavailability, and never silently recompute a different desired plan.

For HTTP semantics, `409 Conflict` is the least disruptive fit for server-held PCD/Arr claim
mismatches because the request is valid but conflicts with current authoritative state. `412
Precondition Failed` is the standards-native choice only if the public API adopts a real
`If-Match` contract. `428 Precondition Required` applies only when a required client precondition
is omitted. Keep the existing expiry/staleness behavior separate from evidence drift. A typed
extension of the existing apply error schema is sufficient; adopting `application/problem+json`
for only this route is optional, not required.

## Primary APIs and Documentation

### Praxrr local API and runtime

| Item                 | Current contract / relevance                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create preview       | `POST /api/v1/sync/preview`; request may contain `instanceId`, ordered `sections`, and transient `sectionConfigs`.                                                                                         |
| Read/discard preview | `GET` / `DELETE /api/v1/sync/preview/{previewId}`.                                                                                                                                                         |
| Apply preview        | `POST /api/v1/sync/preview/{previewId}/apply`; currently accepts an optional section subset and then re-enters `executeSyncJob` against current state.                                                     |
| Authentication       | Existing Praxrr application/session/API-key middleware; this feature needs no new credential or authorization surface.                                                                                     |
| Limits               | Local, in-memory preview creation limit: 6 attempts per instance per 60 seconds; 64 KiB request bodies; 200 stored snapshots.                                                                              |
| TTL                  | Store default is 10 minutes. Warning threshold is 5 minutes. A 30-minute hard-stale threshold also exists, but the default 10-minute expiry normally removes a preview before that threshold is reachable. |
| Pricing/service      | Entirely local/self-hosted; no external paid service and no usage pricing.                                                                                                                                 |

Important current-code findings:

- `SyncPreviewResult` preserves `instanceId`, `arrType`, `sections`, section outcomes, and the
  rendered diff, but it has no desired/live evidence claim.
- `sectionConfigs` are used by `generatePreview()` and then cleared; they are not stored in the
  preview. Applying such a preview through the normal executor can therefore execute saved config
  that differs even when no database or Arr mutation occurred.
- The apply route passes the reviewed `previewId` to Sync History, but `executeSyncJob()` rereads
  the current instance, sync config, PCD state, transformations, and Arr state.
- The existing PCD snapshot system already implements the right primitive shape:
  `computeStateFingerprint()` creates a deterministic, ordered SHA-256 fingerprint and rollback
  carries `expectedCurrentStateHash` as a value guard.
- Existing API helpers use `expectedUpdatedAt` plus `409` for optimistic concurrency, and the
  GitHub-avatar proxy uses a content SHA-256 `ETag`; these are useful local patterns, although the
  avatar's `If-None-Match` is a cache validator rather than a write guard.

### HTTP standards

| Documentation                                                                                             | Applicable rule                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RFC 9110 §13.1.1, If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1)                  | `If-Match` uses strong entity-tag comparison and is intended to prevent lost updates for state-changing requests. A false condition yields `412`.                                                                                           |
| [RFC 9110 §13.2.2, precondition order](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.2.2)        | Mutation preconditions are evaluated before performing the method. This supports validating claims before any sync write.                                                                                                                   |
| [RFC 9110 §15.5.10, 409 Conflict](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.10)            | Use when a request cannot complete because it conflicts with current target state and the user may resolve/retry. This maps naturally to a server-held reviewed-plan conflict.                                                              |
| [RFC 9110 §15.5.13, 412 Precondition Failed](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.13) | Use when a request-header precondition such as `If-Match` evaluates false. Do not call a body-only claim “ETag semantics” unless the HTTP header contract is actually implemented.                                                          |
| [RFC 6585 §3, 428 Precondition Required](https://www.rfc-editor.org/rfc/rfc6585.html#section-3)           | Useful only if clients must supply a conditional request and omit it. The response should explain how to resubmit. A server-stored preview claim does not need 428.                                                                         |
| [RFC 9457, Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)                    | Defines `application/problem+json`, stable problem `type`, `title`, occurrence-specific `detail`, and extension members. `detail` should help recovery and should not be parsed by clients; typed extensions should carry machine behavior. |

Recommended response mapping within the current Praxrr contract:

| Condition                                                        | Suggested status                                                                 | Typed code / recovery                                                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desired materialization differs                                  | `409`                                                                            | `pcd_drift`; `evidenceClass: "pcd"`; `regenerateRequired: true`                                                                                                                            |
| Live Arr comparable state differs                                | `409`                                                                            | `arr_drift`; `evidenceClass: "arr"`; `regenerateRequired: true`                                                                                                                            |
| Both differ                                                      | `409`                                                                            | `pcd_arr_drift`; `evidenceClass: "both"`; `regenerateRequired: true`                                                                                                                       |
| Instance `arr_type` differs or is unsupported                    | `409`                                                                            | `arr_type_drift`; never use a sibling-app fallback                                                                                                                                         |
| Authoritative Arr reread fails                                   | `409` or `503`                                                                   | Prefer a distinct `arr_evidence_unavailable`; no writes; regeneration/retry guidance. `503` is semantically stronger for transient unavailability, but `409` minimizes the contract delta. |
| Preview missing/expired                                          | Preserve current `404`/TTL behavior                                              | `preview_unavailable`; generate a new preview                                                                                                                                              |
| Preview age exceeds an apply policy threshold while still stored | Preserve current `422` behavior unless the API contract is intentionally revised | `preview_stale`; generate a new preview                                                                                                                                                    |
| Public `If-Match` added and does not match                       | `412`                                                                            | Standard precondition failure                                                                                                                                                              |

The API does not need a wholesale Problem Details migration for this issue. A backward-compatible
`SyncPreviewApplyErrorResponse` extension such as `code`, `evidenceClass`,
`regenerateRequired`, `changedSections`, and `staleWarning` provides the required machine-safe
contract. If Problem Details is adopted, use stable fields rather than asking the UI to parse
human-readable `detail`.

### Arr APIs

Praxrr talks directly to user-managed Arr instances using `X-Api-Key`; no new auth mechanism is
needed. Prefer the header form already used by `BaseArrClient`, not the query-string alternative,
because query strings are more likely to be logged.

| Arr    | Primary OpenAPI/docs                                                                                                                                                    | Relevant read resources                                                                                                                                           | Auth                                                     | Rate limits / pricing                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Radarr | [Official API docs](https://radarr.video/docs/api/) and [official OpenAPI JSON](https://raw.githubusercontent.com/Radarr/Radarr/develop/src/Radarr.Api.V3/openapi.json) | `/api/v3/customformat`, `/qualityprofile`, `/delayprofile`, `/config/naming`, `/config/mediamanagement`, `/qualitydefinition` (plus item routes where applicable) | `X-Api-Key` header (also documents `apikey` query input) | Self-hosted, no API pricing. The OpenAPI document advertises no universal request quota or `429` contract. |
| Sonarr | [Official API docs](https://sonarr.tv/docs/api/) and [official OpenAPI JSON](https://raw.githubusercontent.com/Sonarr/Sonarr/develop/src/Sonarr.Api.V3/openapi.json)    | Same v3 configuration families used by the selected sections                                                                                                      | `X-Api-Key` header                                       | Self-hosted, no API pricing. No universal request quota is specified in OpenAPI.                           |
| Lidarr | [Official API docs](https://lidarr.audio/docs/api/) and [official OpenAPI JSON](https://raw.githubusercontent.com/Lidarr/Lidarr/develop/src/Lidarr.Api.V1/openapi.json) | `/api/v1/customformat`, `/qualityprofile`, `/delayprofile`, `/config/naming`, `/config/mediamanagement`, `/qualitydefinition`, `/metadataprofile`                 | `X-Api-Key` header                                       | Self-hosted, no API pricing. No universal request quota is specified in OpenAPI.                           |

The published documents list ordinary GET/POST/PUT/DELETE operations but do not advertise
`ETag`, `If-Match`, `If-Unmodified-Since`, `412`, or `409` concurrency contracts on these
configuration endpoints. Do not assume Radarr/Sonarr v3 behavior applies to Lidarr v1, and do not
assume an undocumented response header is stable. Evidence gathering and normalization must
continue to dispatch by explicit `arrType`.

## Libraries and SDKs

### Recommended: built-in Web Crypto

Deno exposes the standard Web Crypto API through global `crypto.subtle`. The official
[`SubtleCrypto.digest`](https://docs.deno.com/api/web/~/SubtleCrypto.digest) API accepts an
algorithm and a `BufferSource`, and returns a `Promise<ArrayBuffer>`. SHA-256 is sufficient for a
state fingerprint. This matches the existing `pcd/snapshots/fingerprint.ts` implementation and
adds no dependency, network call, secret, or pricing.

```ts
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
```

`digest()` is not a streaming API in the standard Web Crypto form, but sync-preview evidence is
small JSON-like configuration, so buffering the canonical projection is appropriate.

### Canonicalization guidance

[RFC 8785, JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html) explains why
hash inputs require invariant serialization and defines deterministic property sorting and JSON
primitive serialization. It is useful design guidance, but a JCS package is not justified here:

- Praxrr controls both fingerprint producer and verifier.
- The evidence types are bounded internal projections rather than arbitrary signed external JSON.
- Existing code already uses explicit record construction and ordering for PCD fingerprints.
- A generic JCS implementation introduces edge cases (`-0`, non-finite numbers, Unicode/property
  ordering) that can be avoided by validating and projecting the exact supported domain fields.

Prefer explicit, versioned canonical projections. Preserve array order when it is semantic
(quality ladders, section order); sort only arrays that are true sets (for example, tags) using a
documented comparator. Sort object keys recursively only for bounded opaque subobjects that must
remain generic.

```ts
type EvidenceEnvelope = {
  version: 1;
  instanceId: number;
  arrType: 'radarr' | 'sonarr' | 'lidarr';
  sections: readonly SyncPreviewSection[];
  sectionClaims: readonly {
    section: SyncPreviewSection;
    desired: unknown; // normalized, materialized write input; no secrets
    current: unknown; // normalized Arr fields used by the differ/write guard
  }[];
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Non-finite evidence number');
  }
  return value;
}

async function fingerprint(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}
```

For production code, centralize this logic next to the sync-preview claim types and test it with
key-order permutations, semantic array order, null/undefined behavior, Unicode strings, empty
collections, and invalid numbers. Do not use `localeCompare` if cross-runtime locale variability is
a concern; a direct code-unit comparator is easier to specify byte-for-byte.

### SDK recommendation

Do not add an Arr SDK. Praxrr already has typed, `arrType`-specific clients, retry/timeout behavior,
credential handling, and normalization code. An SDK would not supply the missing concurrency
primitive because the upstream OpenAPI contracts do not define one. Likewise, do not add a hashing
or stable-stringify dependency unless a later requirement needs standards-compliant JCS exchange
with another implementation.

## Integration Patterns

### 1. Versioned, server-held claims

Add an internal claim to the stored preview rather than trusting a client to echo evidence:

```ts
type SyncPreviewDriftReason =
  | 'pcd_drift'
  | 'arr_drift'
  | 'pcd_arr_drift'
  | 'arr_type_drift'
  | 'arr_evidence_unavailable'
  | 'claims_invalid';

interface SyncPreviewExecutionClaim {
  readonly version: 1;
  readonly instanceId: number;
  readonly arrType: SyncPreviewArrType;
  readonly sections: readonly SyncPreviewSection[];
  readonly desiredFingerprint: string;
  readonly arrFingerprint: string;
  readonly sectionClaims: readonly {
    section: SyncPreviewSection;
    desiredFingerprint: string;
    arrFingerprint: string;
  }[];
}
```

The claim version is part of the hashed envelope. Unknown versions fail closed. The client may see
opaque fingerprints for support/debugging, but apply must use the trusted store copy. A bare
client-supplied hash is not evidence because a client could substitute it.

### 2. Materialize once, reuse the same pure evidence builders

Preview generation should produce three outputs from the same section-specific preparation:

- the human-reviewed `EntityChange` diff;
- normalized desired evidence representing the exact write input; and
- normalized current evidence representing the exact relevant Arr fields.

The apply path should use those same builders. Avoid hashing the rendered diff alone: diffs can
omit unchanged fields that a PUT later sends, and two materially different full payloads can
produce similar summaries. Hash the complete normalized inputs to the mutation, then derive the
diff from them.

For desired evidence, include all sources that affect output:

- saved sync configuration or the exact transient preview override;
- database IDs and selected entity names without trimming persisted lookup identifiers;
- materialized PCD rows and TRaSH-derived entities;
- explicit `arrType` mappings, quality mappings, namespace suffixes, and transformer version; and
- only the selected sections, in deterministic execution order.

For current Arr evidence, use the comparable projections already consumed by each section differ.
Include remote IDs as identity/value-guard fields where updates target an ID, but exclude server
timestamps, links, diagnostics, or other fields that the syncer neither compares nor writes.

### 3. Apply as a fail-closed protocol

Recommended sequence:

1. Load the preview and validate status/expiry.
2. Parse and deduplicate the requested section subset without reordering it.
3. Verify every requested section was successfully previewed and has a claim.
4. Atomically transition `ready -> applying` so the preview is single-use.
5. Re-read the instance and require exact `instanceId`, enabled state, and `arrType` equality.
6. Acquire the existing per-section sync claims in a deterministic order before validation. This
   blocks another Praxrr run from changing the same section between validation and execution.
7. Re-materialize all selected desired and live Arr evidence before the first write. Collect both
   mismatch classes so the typed error can accurately report PCD, Arr, or both.
8. If any selected section mismatches, an evidence builder fails, or mapping is ambiguous, perform
   no writes; mark the preview failed/invalidated and return regeneration guidance.
9. Execute using the stored reviewed desired materialization. Immediately before each section's
   first mutation, ensure the live value guard still matches if earlier sync setup performs extra
   network or database work.
10. Pass the exact selected sections, explicit `arrType`, claim/preview ID, and confirmed outcomes
    through Sync History. Planned changes remain distinct from actual outcomes.

The pre-sync snapshot and history-preview work currently performed inside `arrSyncHandler` must
not create a new unchecked interval. Claim validation should occur after any setup that can alter
or substantially delay the mutation, or the validated claim must be threaded into the syncers and
checked at their write boundary.

### 4. Typed recovery response

```json
{
  "error": "Reviewed sync preview is stale because live Arr configuration changed. Generate and review a new preview.",
  "code": "arr_drift",
  "evidenceClass": "arr",
  "changedSections": ["qualityProfiles"],
  "regenerateRequired": true,
  "staleWarning": null
}
```

Expose evidence class and section, not raw payloads, API keys, response bodies, or a field-level
dump that could leak configuration. The UI should branch on `code`/`regenerateRequired`, clear the
invalid preview, and offer a single “Regenerate preview” action. Human text should name the class
that changed and say explicitly that nothing was applied.

### 5. HTTP ETag alternative

If Praxrr later wants a generic conditional-resource API, `GET /sync/preview/{id}` can return a
strong `ETag` over the complete preview claim and apply can require `If-Match`. A mismatch then
returns `412`, and omission can return `428`. This is standards-clean but does not replace
server-side rereading of PCD and Arr evidence: an ETag proves which preview representation the
client reviewed, not that upstream PCD/Arr resources still match it. For issue #234, the existing
preview ID plus trusted server-held claim is simpler and equally effective for client binding.

### 6. Regression test patterns

Focused tests should prove negative guarantees, not only response codes:

- PCD desired evidence changes after preview: apply returns typed `pcd_drift`; mocked
  `executeSyncJob`/Arr write count remains zero.
- Live Arr evidence changes after preview: typed `arr_drift`; zero writes.
- Both change: typed combined reason or both classes; zero writes.
- Arr reread fails or yields ambiguous mapping: fail closed; zero writes.
- Stored `arrType` differs from the current instance: fail before dispatch; zero sibling fallback.
- Preview created with transient `sectionConfigs`: apply uses/binds those exact reviewed desired
  inputs rather than saved configuration.
- Request applies a subset: only those claimed sections validate and execute; unselected drift
  does not broaden execution, while selected-section drift blocks all selected writes.
- Requested section order and deduplication remain deterministic.
- TTL expiry and evidence drift remain distinct typed paths.
- Two concurrent apply requests: exactly one can transition to applying; the other gets conflict.
- Canonicalization: object key order is irrelevant, semantic array order is preserved, set order is
  normalized where specified, and any changed mutation field changes the digest.
- Fingerprint version mismatch or missing claim fails closed.

## Constraints and Gotchas

1. **Arr has no documented conditional writes.** Local validation cannot prevent an external
   actor from changing Arr in the final instant before a PUT. Minimize the window, serialize
   Praxrr writers, and use per-entity comparable value guards; do not claim transactional
   guarantees the upstream API cannot provide.
2. **Do not hash only PCD op-log state.** Quality-profile output can depend on multiple databases,
   TRaSH caches, sync selections, namespace assignment, quality mappings, and transformer logic.
   Hash the materialized desired payload actually reviewed; optional source fingerprints can be
   retained for diagnostics.
3. **Do not hash only `EntityChange`.** It is presentation evidence and can omit unchanged fields
   still sent by a PUT. The mutation payload/projection is authoritative.
4. **Transient preview config is currently lost.** This is already a silent divergence path even
   without later drift. Store it safely or store the resulting materialized desired evidence and
   ensure execution can consume it.
5. **Canonical array handling is domain-specific.** Sorting quality profile items, cutoff ladders,
   or ordered conditions can change meaning. Sort only documented sets.
6. **Remote IDs are both useful and unstable.** Include them when a reviewed update/delete targets
   that identity, but treat an ID change as Arr drift rather than matching by a sibling name and
   continuing silently.
7. **Never include secrets.** API keys, encrypted credentials, raw error bodies, and unrelated
   instance configuration have no place in claims or error details. SHA-256 does not make a
   low-entropy secret safe to expose.
8. **Hashes need a versioned schema.** A code deployment that changes normalization can invalidate
   in-memory previews. Fail closed with `claims_invalid` and regeneration guidance.
9. **In-memory store topology matters.** Claims are currently process-local. If Praxrr runs
   multiple workers/processes without sticky routing, a preview can disappear or apply on a
   process that lacks the claim. Persisting/distributing claims is outside the narrow issue unless
   multi-process operation is supported, but the limitation should be documented.
10. **Default TTL and hard-stale threshold conflict.** A 10-minute store TTL normally prevents a
    preview from reaching the 30-minute block. Preserve existing user behavior for this issue, but
    test expiry using the actual store TTL rather than assuming the hard-stale branch is reachable.
11. **Hash equality is not authorization.** Keep all existing auth, instance ownership/access,
    body-size, rate-limit, status-transition, and sync-in-progress checks.
12. **Partial apply must stay explicit.** Applying a selected subset is valid only when each
    selected section has reviewed claims. Never add configured/unreviewed sections because the
    ordinary sync executor defaults an empty list to all sections.
13. **Cross-Arr semantics stay separate.** Radarr/Sonarr use v3; Lidarr uses v1 and has a distinct
    metadata-profile section. Each evidence normalizer and endpoint dispatch must resolve from
    explicit `arrType`, with no sibling fallback.
14. **Errors must be safe and actionable.** Distinguish changed evidence from unreachable evidence
    and internal failures. Do not expose raw Arr response bodies. Always say whether any writes
    occurred; the drift paths must guarantee none.

## Open Questions

1. Should execution consume stored, fully materialized desired payloads, or should it re-materialize
   and compare before using current materialization? The strongest practical design is hybrid:
   compare current materialization to the stored desired fingerprint, then execute the stored
   reviewed payload so a later read cannot silently substitute a different plan.
2. Where should the per-section write-boundary guard live? Extending `BaseSyncer.sync()` with a
   reviewed claim/context is safer than a route-level recheck followed by the unchanged executor,
   but it touches each section syncer.
3. Should drift invalidate the preview terminally (`failed`) or introduce an explicit `invalidated`
   status? A new status is clearer but expands the OpenAPI/UI lifecycle. The issue can remain
   scoped by using `failed` plus a typed drift code and requiring regeneration.
4. Should apply drift use `409` everywhere, or adopt `412` with `If-Match`? `409` fits the existing
   server-held preview design and contract; `412` should be chosen only with a real header-based
   validator exposed by GET.
5. Should `arr_evidence_unavailable` be `409` for a uniform regeneration flow or `503` for precise
   transient-failure semantics? Either must fail before writes; a typed code keeps UI behavior
   stable.
6. Does supported deployment include more than one Praxrr process? If yes, the in-memory preview
   and sync-claim stores need shared persistence or enforced affinity before this guarantee can be
   described as process-independent.
7. Which fields are mutation-relevant for each Arr/version pair? The implementation should make
   the projection explicit per `arrType` and section and test it against the exact payload sent by
   each syncer rather than assuming API-shape parity.
8. Should source-level diagnostics identify changed database IDs/PCD sources while keeping raw
   values hidden? This would improve supportability, but the public requirement can be met with
   evidence class plus changed section.
