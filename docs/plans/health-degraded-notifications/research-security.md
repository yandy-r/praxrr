# Security Research: Health Degraded Notifications

## Executive Summary

No critical vulnerability is inherent in an opt-in `health.degraded` event. The design can safely
reuse persisted config-health snapshots and the existing notification manager if it treats the
notification as a narrow, bounded projection of trusted fields rather than forwarding snapshot JSON.

The principal risks are: an unvalidated Discord webhook URL can act as a server-side request target;
the notifications list currently serializes full service rows, including the webhook secret; stored
snapshot strings can produce oversized or misleading Discord content; and non-atomic deduplication can
create alert storms. The implementation should validate both stored snapshot data and outbound payloads,
claim a persisted degradation edge atomically before dispatch, and never place webhook URLs, raw errors,
credentials, or full criterion/profile JSON in messages, history, logs, or client responses.

## Findings by Severity

### CRITICAL

- **CRITICAL — None identified.** The event is a read-only notification derived from existing local
  state, does not accept unauthenticated event input, and uses an existing best-effort transport. Do not
  inflate the SSRF, disclosure, or spam findings below to critical unless Praxrr's deployment threat
  model treats authenticated settings users or local database writers as untrusted tenants.

### WARNING

- **WARNING — Discord webhook configuration permits arbitrary outbound URLs (SSRF).** The create/edit
  actions only require a non-empty `webhook_url`, and `WebhookClient` will POST to it. Redirects are
  correctly disabled, but an authenticated operator, compromised session, or modified database can
  target loopback, link-local, or private services. Scheduled degradation events make the POST repeatable.
  **Mitigation:** because Discord is the only supported notifier, accept only HTTPS Discord webhook URLs
  with an exact approved hostname and `/api/webhooks/{id}/{token}` shape; reject credentials, fragments,
  non-default ports, IP literals, and non-HTTPS schemes on create, edit, test, and send. Revalidate stored
  configuration at dispatch so legacy rows cannot bypass the check. Keep redirects disabled.

- **WARNING — The notification list can expose the webhook secret to the browser.** The edit loader
  removes `webhook_url`, but the main notifications loader returns `notificationServicesQueries.getAll()`
  rows inside `servicesWithStats`; those rows include the JSON `config` containing the webhook token.
  **Mitigation:** return an explicit sanitized DTO from every settings load/API, never a database row.
  Expose only non-secret presentation fields and a boolean such as `webhookConfigured`. Do not put the URL
  in logs, errors, form failure data, notification metadata, or history. Add a regression test that the
  serialized page data does not contain `/api/webhooks/` or the configured token.

- **WARNING — Unbounded stored strings can exceed Discord limits or create misleading content.** Instance
  names, criterion labels/details, and suggestion headlines are persisted strings; snapshot JSON parsing
  checks only that the top-level value is an array. The embed builder and notifier count characters after
  a failure but do not enforce Discord's per-field or 6,000-character aggregate limits. Markdown, control
  characters, bidi controls, newlines, or crafted links can visually spoof an alert even though JSON
  serialization prevents code injection. **Mitigation:** construct one embed from an allowlisted payload;
  cap title to 256, description to 4,096, field names to 256, field values to 1,024, fields to 25, and total
  embed text conservatively below 6,000. Cap generic title/message and notification-history text too.
  Normalize CRLF, remove C0/C1 and bidi control characters, escape Discord Markdown in user-controlled
  names, and truncate with a visible ellipsis. Never interpolate raw snapshot JSON or raw errors.

- **WARNING — Non-atomic deduplication can cause duplicate notifications.** A read-then-write check is
  vulnerable to retries, overlapping jobs, or process restarts and can send the same degradation edge more
  than once. **Mitigation:** persist a unique identity for `(instance_id, previous_snapshot_id,
current_snapshot_id)` (or an equivalent versioned digest) and claim it with a single `INSERT OR IGNORE`
  or transaction before dispatch. Dispatch only for the successful claimant. The issue's at-most-once
  contract favors claim-before-send: a delivery failure may lose an alert but must not trigger duplicate
  sends or fail/back off the snapshot job.

### ADVISORY

- **ADVISORY — Persisted snapshot data needs runtime validation at the notification boundary.** Type casts
  do not protect against legacy, corrupt, or manually edited rows. **Mitigation:** require positive integer
  IDs, finite integer scores in `0..100`, allowlisted bands/Arr types/criterion IDs, matching non-empty
  engine versions, valid timestamps, and bounded strings. Treat `unknown`, missing data, malformed arrays,
  incompatible engine versions, or changed scored-criterion bases as non-comparable and emit nothing.

- **ADVISORY — Notifications disclose operational metadata to a third party.** Instance names, Arr type,
  health scores, criterion names, and timestamps can reveal deployment topology and configuration posture.
  **Mitigation:** keep `health.degraded` disabled for existing and new services until explicitly selected,
  describe the fields sent in the UI, send only the selected actionable criterion, and avoid profile names,
  media titles, filesystem paths, hostnames, URLs, versions, API responses, and drift error text.

- **ADVISORY — Notification history retains the externalized message and delivery errors.** History is
  useful for auditability but becomes another copy of instance names and health context; remote response
  bodies may contain more detail than needed. **Mitigation:** keep message content minimal, bound stored
  errors, sanitize control characters, never store request URLs or payload secrets, and apply/document a
  retention policy consistent with config-health snapshot retention.

- **ADVISORY — Mention behavior can amplify noise.** `enable_mentions` currently adds `@here` to the first
  webhook message. **Mitigation:** preserve the existing explicit service-level opt-in, emit exactly one
  bounded embed, and never derive `content` or allowed mentions from snapshot strings. Consider sending
  `allowed_mentions: { parse: [] }` when mentions are disabled and an explicit allowlist when enabled.

- **ADVISORY — Degradation comparison integrity depends on canonical persisted evidence.** Comparing a
  newly computed report to a stale/live mix can produce false claims. **Mitigation:** persist the current
  snapshot first, compare it with the immediately preceding snapshot for the same non-null instance ID,
  and include snapshot IDs in the dedupe record. Do not rerun criteria or query mutable Arr/PCD state while
  building the notification.

## Authentication and Authorization

The global SvelteKit hook protects settings and config-health routes unless `AUTH=off` or the configured
local-network bypass applies. Reuse that boundary; do not add a public webhook-trigger or event-emission
endpoint. Praxrr currently has no role distinction, so any authenticated/bypassed operator can configure
webhooks and opt into this event. That is consistent with the existing single-operator model, but it means
deployments using `AUTH=off` must rely on a correctly configured reverse proxy and network isolation.

State-changing notification settings must remain server actions/API handlers covered by the existing
session and same-origin protections. If a dedicated API field for a health threshold or opt-in is added,
validate it server-side and do not trust checkbox presence or client catalog metadata as authorization.

## Data Protection

The outbound payload should contain only instance ID/name, explicit Arr type, previous/current score and
band, point drop, one bounded criterion label/action, timestamps, and a relative details path. Webhook URLs
are bearer secrets and are currently stored in plaintext notification configuration; at minimum, remove
them from all response DTOs and logs and ensure database/backups have restrictive permissions. Reusing the
repository's secret-encryption facility would improve at-rest protection, but can be a separate migration
if local database access is already inside the trusted-admin boundary.

Do not include detected versions, Arr URLs/API keys, database tokens, filesystem paths, raw criterion JSON,
profile/custom-format names, exception messages, or webhook response bodies. Treat Discord as an external
processor: the opt-in copy should make the disclosed operational metadata clear.

## Dependency Security

No new dependency or Discord SDK is needed. Native `fetch`, the existing `WebhookClient`, embed types, and
SQLite queries cover the feature and keep supply-chain exposure unchanged. Preserve the 10-second timeout,
zero-retry behavior, and `redirect: 'manual'`. A future general webhook hardening change can add shared URL
validation and rate-limit handling; issue #223 should not add a health-specific network stack.

## Input Validation

Validate at three boundaries:

1. **Settings:** exact event ID `health.degraded`; opt-in false by default; integer score-drop threshold
   with a documented narrow range; validated Discord HTTPS webhook URL.
2. **Snapshot comparison:** same instance and engine version, known ordered bands, finite `0..100` scores,
   identical scored-criterion basis, valid IDs/timestamps, and structurally validated criterion arrays.
3. **Rendering:** allowlisted fields only, deterministic criterion selection, safe Markdown interpolation,
   control-character removal, and hard per-field/aggregate size caps.

Invalid or ambiguous input must fail closed by suppressing the event and logging only identifiers plus a
stable reason code. It must not fail snapshot persistence, the batch, sweep progress, or job scheduling.

## Infrastructure Security

Keep outbound delivery egress-limited to Discord where deployment controls allow it. DNS and proxy policy
should block loopback, link-local, metadata-service, and private-network destinations as defense in depth;
application hostname validation remains necessary. The persisted dedupe table should use foreign keys or
intentional pruning semantics and a unique constraint so cleanup cannot create replay opportunities.

Use bounded concurrency already present in the snapshot job. One eligible edge should produce one logical
event and one embed per opted-in service; notification failures remain isolated with `Promise.allSettled`.
Avoid health-specific retries, since retries plus multi-service fan-out can magnify rate limits and spam.

## Secure Coding Guidelines

- Define `HEALTH_DEGRADED` once and reuse the exact constant across catalog, filter, builder, and tests.
- Keep degradation detection and payload selection pure; keep persistence/dispatch orchestration separate.
- Parameterize all SQL and enforce a database uniqueness constraint for event identity.
- Claim dedupe state before best-effort dispatch; never roll back a saved snapshot because delivery failed.
- Render from a typed, validated event DTO, not `ConfigHealthSnapshotDetail` or arbitrary JSON directly.
- Escape and truncate every user-controlled string at the transport boundary; do not concatenate JSON.
- Log snapshot/service IDs and reason codes only. Do not log webhook URLs, tokens, outbound payloads, or raw
  provider response bodies.
- Add tests for malformed persisted JSON, oversized Unicode/control-character names, Markdown/link text,
  duplicate concurrent claims, unknown bands, engine changes, disabled opt-in, timeout/429/5xx failures,
  and absence of webhook secrets from page data/history/logs.

## Trade-off Recommendations

1. **Ship blocker:** sanitize notification service DTOs and enforce payload size/interpolation bounds before
   enabling scheduled health notifications; both prevent direct disclosure or externally triggered noise.
2. **Strongly recommended in scope:** atomic persisted edge claiming, strict snapshot comparability checks,
   one embed/one criterion, and dispatch-time webhook URL validation.
3. **Acceptable trade-off:** at-most-once delivery may lose an alert after a failed webhook call. This is
   safer than send-then-mark duplicates and matches the issue's best-effort acceptance criterion.
4. **Reasonable follow-up:** encrypt existing webhook URLs at rest and generalize rate-limit-aware delivery.
   Do not add new dependencies or broaden issue #223 into a notification subsystem replacement.

## Open Questions

- Which exact Discord hostnames must be supported for existing installations, and is migration-time
  validation needed for legacy webhook rows?
- Is a configurable same-band score-drop threshold in scope, and what server-enforced min/max/default will
  avoid zero-threshold alert spam?
- Should notification history retention follow config-health retention or the existing log-cleanup policy?
- Does the details field need an absolute public URL? Prefer a relative route unless a separately validated
  canonical application base URL already exists.
- Is plaintext webhook storage accepted by the documented local-admin threat model, or should this issue
  migrate webhook secrets to the existing encryption facility?
