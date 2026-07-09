# Security Research: Transparent Automation Engine

## Executive Summary

No critical hard stop was identified. The existing narration renderer uses
escaped Svelte text, global API authentication already covers the affected
routes, and no new dependency is required. The main risks are integrity and
information-disclosure risks: narrating intended work as completed, logging
excessive decision data, rendering upstream text through an unsafe HTML path, or
applying a sibling Arr app's semantics to the wrong target.

## Findings by Severity

### CRITICAL — Hard Stops

No critical findings identified.

### WARNING — Must Address

| Finding                                                               | Risk                                                                                                                                                                                                                                                          | Suggested Mitigation                                                                                                                                                                                                                                                  | Alternatives                                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Post-apply narration can confuse planned changes with actual outcomes | The current apply route re-runs selected sync sections and returns job-level output; `SyncResult` does not prove which create/update/delete succeeded. A false success narrative can cause an operator to trust a partially applied or changed configuration. | Narrate only run/section facts now. Require an actual per-entity terminal outcome contract before using completed-action wording. Label pre-sync history changes as planned.                                                                                          | Return a durable sync-history ID and show its section results; keep per-entity completion as a linked follow-up.                     |
| Quality Goals rationale can leak or amplify operational data in logs  | Logging every custom-format name, profile name, score, weights, and raw reason for every apply creates a durable copy of operator configuration and can produce large log entries. Future reason payloads could accidentally include secrets.                 | Emit a bounded, versioned structured event after successful apply. Allowlist fields; run all metadata through `sanitizeLogMeta`; exclude raw request bodies, headers, API keys, tokens, regex bodies, and arbitrary config values. Test nested arrays and truncation. | Log decision codes/counts plus a binding/history identifier; keep full rationale in the authenticated API response rather than logs. |
| Raw error text may be exposed as “human-readable narration”           | Preview and apply paths currently carry some arbitrary `error.message` strings. Upstream/proxy errors can reveal hostnames, URLs, implementation details, or credentials accidentally embedded by a dependency.                                               | Map UI/API explanations from a closed sanitized reason union. Keep raw diagnostic detail server-side after log sanitization. Test all failure branches, including unknown errors.                                                                                     | Show a generic user message plus correlation/run ID and retain detailed error only in protected logs.                                |
| Unsafe HTML reuse would turn Arr/PCD names and fields into XSS input  | Entity names, field names, descriptions, and upstream values can originate in linked databases or Arr responses. `NarrationBlock.svelte` is safe because it uses `{value}`, but shared Markdown/Table components elsewhere use `{@html}`.                     | Keep all narration and provenance values in escaped Svelte interpolation. Prohibit `{@html}`, `marked.parse`, and generic rich-table renderers for these strings unless output passes the existing audited sanitizer. Add an XSS regression fixture.                  | Render server-sanitized allowlisted markdown only for explicitly markdown-typed fields; render all other data as plain text.         |
| Cross-Arr misnarration can authorize the wrong destructive operation  | Radarr, Sonarr, and Lidarr have different endpoints and semantics. A borrowed label or implicit fallback can make an operator approve an action they did not understand, especially deletes.                                                                  | Pass explicit `arrType` to every narrator; use per-Arr mapping tables and literal fallback; fail closed on unsupported section/entity combinations; test divergent labels and no sibling fallback.                                                                    | Use raw API field/entity names whenever an Arr-specific friendly mapping has not been verified.                                      |
| Provenance overclaim can hide an override or conflict                 | Current resolved-config APIs prove layer-wide base/user/resolved state, but not the exact op/default responsible for each final field. Calling a field “database default” without lineage can mislead incident response or change approval.                   | Ship only evidence-backed layer wording. Preserve `hasPendingConflict` prominently. Move per-field op/default attribution to a follow-up requiring replay lineage and tests.                                                                                          | Omit provenance badges entirely for ambiguous fields and show only base-versus-resolved overrides.                                   |
| A prose-only automation audit will silently go stale                  | New job types or routes can bypass the issue #21 checklist, leaving automation without inputs, decisions, outputs, or safe failure reasons.                                                                                                                   | Implement a typed audit registry keyed exhaustively by `JobType`, with a test that fails when a registered type lacks coverage. Audit user-triggered automation routes separately.                                                                                    | Generate an inventory from the job registry during tests and compare it with a checked-in audit manifest.                            |

### ADVISORY — Best Practices

| Finding                                                                         | Benefit                                                                                                                     | Recommendation                                                                                                                                                                             | Defer Justification                                                                                                      |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Narration can create client-side denial-of-service pressure                     | Bounding verbose details prevents a large PCD/Arr response from producing thousands of DOM nodes or one enormous log event. | Cap visible verbose lines per group, announce omitted counts, and paginate/virtualize existing diff lists where needed.                                                                    | Safe to defer if existing preview size tests demonstrate bounded real-world payloads and logs never include full arrays. |
| Decision and narration events lack a correlation identifier                     | Correlation makes protected logs useful without exposing raw details to users.                                              | Include job ID, preview ID, sync-history ID, or generated operation ID in user-safe errors and structured events.                                                                          | Can defer if the existing request always maps unambiguously to one durable history record.                               |
| `AUTH=off` and local-IP bypass expand the trust boundary                        | Transparency surfaces expose configuration strategy and instance topology even when they contain no credentials.            | Document that `AUTH=off` trusts an authenticating reverse proxy and that local bypass trusts network classification. Preserve explicit auth checks on sensitive resolved-config endpoints. | This is existing product behavior; documentation can follow the feature if no endpoint becomes public.                   |
| Session cookies are `SameSite=Lax` and `httpOnly` but currently `secure: false` | Secure cookies protect session tokens on TLS deployments.                                                                   | Make `secure` deployment-aware and prefer HTTPS at the reverse proxy. Do not weaken SameSite behavior for this feature.                                                                    | Existing LAN/HTTP support makes an unconditional secure cookie incompatible; handle as platform hardening.               |
| Versioned explanation templates aid forensic interpretation                     | Keeping template version distinct from engine/API versions explains wording changes across logs and screenshots.            | Persist or log `templateVersion` and `engineVersion` separately; never reuse one as the other.                                                                                             | Can defer for transient UI-only narration if durable records retain the underlying reason codes.                         |

## Authentication and Authorization

The affected `/api/v1` routes are protected by the global SvelteKit hook unless
authentication is explicitly bypassed by configured `AUTH=off` or trusted-local
mode. Resolved-config handlers also perform explicit
`locals.user || locals.authBypass` checks. The implementation should preserve
these controls and avoid creating a parallel unauthenticated narration or audit
endpoint.

Quality Goals apply and sync-preview apply are state-changing operations. New
narration parameters must never change authorization decisions or allow a client
to select arbitrary log fields. Treat the authenticated server-computed
plan/result as authoritative; client-supplied narration text, reason codes,
template versions, profile names, or provenance claims must not be trusted.

API-key authentication supports a header and query parameter in the existing
middleware. New code must never echo either into narration or logs. Prefer the
`X-Api-Key` header for automated clients because query parameters are more
likely to enter proxy and browser history logs.

## Data Protection

No new regulated PII is required. However, the following operational data is
sensitive enough to minimize and protect:

- instance names, URLs, topology, and Arr type;
- profile/custom-format names, scoring policy, quality thresholds, and
  provenance;
- preview diffs, current/desired values, and failure diagnostics;
- user identity, IP address, job/preview IDs, and timestamps;
- all Arr/Praxrr API keys, cookies, OIDC material, tokens, and authorization
  headers.

Use allowlisted structured metadata rather than spreading an arbitrary
`GoalPlan`, preview, or error object into logs. Keep existing rotation/cleanup
behavior, document retention for decision events, and ensure exports or support
bundles apply the same secret redaction. Values shown in the UI remain behind
the normal authentication boundary and should be escaped, not treated as trusted
HTML.

## Dependency Security

| Dependency       | Version                    | Known Issues                                                                                                                              | Risk Level        | Alternative                                                                                              |
| ---------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| New dependencies | None proposed              | No new supply-chain exposure is needed for narration, audit, logging, or provenance                                                       | Low               | Reuse existing pure engine, logger, OpenAPI types, and Svelte renderer                                   |
| `marked`         | Locked 15.0.12 (`^15.0.6`) | Markdown output is HTML and is unsafe for untrusted operational text without sanitization; this is a usage risk, not a newly verified CVE | Warning if reused | Plain Svelte interpolation; existing server-side sanitized markdown path only when rich text is required |
| `highlight.js`   | Locked 11.11.1             | Produces HTML for display; unnecessary for narration                                                                                      | Advisory          | Plain `<code>{value}</code>` escaped text                                                                |

Do not add a templating, markdown, telemetry, or diff library for this feature.
Dependency scanning should continue through the repository's existing CI; this
research does not claim a full transitive CVE audit.

## Input Validation

- Accept narration inputs only through TypeScript discriminated unions: actions,
  sections, tones, levels, reason codes, Arr types, and provenance layers.
- Keep the runtime API schemas and generated types in lockstep when changing
  apply/result responses.
- Validate identifiers as the existing routes do: positive integer IDs, known
  entity types, explicit Arr type, bounded arrays, and bounded request bodies.
- Never construct SQL, HTML, shell commands, file paths, or log messages by
  interpreting narration text. Narration is output-only.
- Render names and details with Svelte interpolation. Add fixtures containing
  `<script>`, event attributes, `javascript:` URLs, quotes, newlines, ANSI
  escapes, and long strings.
- Use stable reason codes for logic; human sentences are presentation and must
  never drive branching.
- When logging strings, JSON serialization protects the file format, but bound
  length/counts and strip or escape control characters for console readability.

## Infrastructure Security

No CORS expansion, public callback, new secret, or external service is required.
Keep same-origin API calls, current preview rate/body/store limits, Arr-client
timeouts, live-diff rate limits, and TLS at the reverse proxy. Do not weaken
Content Security Policy to support narration; the renderer needs no inline
scripts or remote assets.

If the automation audit becomes an API, it should expose coverage metadata
rather than raw logs or credentials, inherit normal authentication, and remain
read-only. Detailed server logs should not be made directly downloadable without
a separate access-control and redaction review.

## Secure Coding Guidelines

1. Render only server/computation-derived structured records; never accept
   client-authored prose.
2. Separate `planned`, `attempted`, `succeeded`, `failed`, and `skipped` in both
   types and wording.
3. Keep `arrType` explicit and exhaustive at every label/mapping boundary.
4. Use literal fallback for unknown labels and fail closed for unsupported
   behavior.
5. Use closed sanitized error reasons in API/UI; log diagnostics separately
   through `sanitizeLogMeta`.
6. Allowlist and bound Quality Goals decision-event metadata; record only after
   the write succeeds.
7. Keep narration rendered with plain escaped interpolation. Do not use
   `{@html}`.
8. Treat pending value-guard conflicts as ambiguity and show them before
   resolved/provenance claims.
9. Make the audit registry exhaustive at compile/test time and distinguish
   user-visible evidence from internal-only logs.
10. Add negative tests for secret-shaped values, XSS strings, unknown Arr types,
    partial syncs, preview/apply mismatch, and ambiguous provenance.

## Trade-off Recommendations

Full per-decision logs improve supportability but increase retention and
disclosure risk. Prefer a small structured apply event containing stable reason
codes, versions, counts, thresholds, and a durable record identifier; keep the
full explanation in the authenticated response/UI.

Per-field provenance is valuable but unsafe to infer. Layer-level provenance
preserves most of the user value now without inventing lineage. Defer exact
op/default attribution until replay can produce verifiable evidence.

Post-apply entity narration should not be simulated from preview data.
Section-level narration plus a linked per-entity-outcome follow-up is the
correct security/integrity trade-off.

## Open Questions

1. What retention and export policy should apply to structured Quality Goals
   decision events?
2. Should the apply response return a sync-history ID so UI explanations and
   audit evidence share one durable source of truth?
3. Will preview apply be bound to stored preview configuration, including
   transient `sectionConfigs`, or explicitly documented as a fresh section sync?
4. Which fields, if any, may contain intended markdown, and can all transparency
   surfaces standardize on plain text?
5. Should op-level provenance be stored during replay or derived on demand, and
   how will conflicts and schema defaults be represented without false
   certainty?
