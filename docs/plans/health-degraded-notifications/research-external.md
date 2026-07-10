# External API Research: Health Degraded Notifications

## Executive Summary

Issue [#223](https://github.com/yandy-r/praxrr/issues/223) does not require a new external API,
library, queue, or notification provider. The feature should produce a new internal
`health.degraded` event from the existing config-health snapshot workflow and route it through the
existing `NotificationManager`. Discord incoming webhooks remain the only implemented transport.

The external Discord contract reinforces a deliberately small payload: one embed containing the
instance, previous/current score and band, a bounded set of actionable criterion facts, and a
config-health details link. Discord accepts up to 10 embeds per webhook message, but individual
embed fields and the combined embed text have stricter limits. A single bounded embed avoids the
current notifier's one-second delay between split messages and reduces exposure to rate limits.

Deduplication belongs in the persisted health domain, not in Discord or notification history.
Compare the newly computed report with the immediately preceding persisted snapshot for the same
instance, exclude `unknown` and incompatible engine versions, persist the new snapshot, and record a
stable degradation episode/signature so an unchanged degraded state cannot alert repeatedly. The
notification send must remain best-effort and must never fail the snapshot job.

## Primary APIs

### Discord Execute Webhook

Official documentation:

- [Discord Webhook Resource — Execute Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook)
- [Discord Message Resource — Embed Limits](https://docs.discord.com/developers/resources/message#embed-limits)
- [Discord HTTP API Rate Limits](https://docs.discord.com/developers/topics/rate-limits)

Praxrr currently sends the following Discord webhook shape from
`packages/praxrr-app/src/lib/server/notifications/notifiers/discord/DiscordNotifier.ts`:

```typescript
{
  username: string,
  avatar_url?: string,
  content?: '@here',
  embeds: DiscordEmbed[]
}
```

The Execute Webhook endpoint requires at least one of `content`, `embeds`, a file, components, or a
poll. Praxrr's health event should use `embeds`, with `generic` content retained for transport-neutral
history and future notifiers.

Relevant Discord limits are:

| Element                         |            Limit |
| ------------------------------- | ---------------: |
| Embeds per webhook message      |               10 |
| Embed title                     |   256 characters |
| Embed description               | 4,096 characters |
| Fields per embed                |               25 |
| Field name                      |   256 characters |
| Field value                     | 1,024 characters |
| Combined embed text per message | 6,000 characters |

`DiscordNotifier.chunkEmbeds()` deliberately emits one embed per HTTP request even though Discord
allows multiple embeds in one message. It waits one second between those requests. Therefore,
`health.degraded` should normally generate exactly one embed and cap criterion context before payload
construction.

### Existing Praxrr Notification API

No public API contract is needed for transport delivery. The internal extension points already
exist:

- `packages/praxrr-app/src/lib/server/notifications/types.ts` — add the canonical
  `NotificationTypes.HEALTH_DEGRADED` identifier.
- `packages/praxrr-app/src/lib/shared/notifications/types.ts` — expose `health.degraded` in a Health
  category so each service can opt in through the settings form.
- `packages/praxrr-app/src/lib/server/notifications/builder.ts` — build generic and Discord-specific
  representations.
- `packages/praxrr-app/src/lib/server/notifications/NotificationManager.ts` — filter enabled services
  by the exact event ID, fan out with `Promise.allSettled`, and record per-service history.
- `packages/praxrr-app/src/lib/server/notifications/notifiers/discord/DiscordNotifier.ts` — use the
  Discord embed when present and fall back to generic content otherwise.

The manager already makes the event opt-in: a service receives an event only when its
`notification_services.enabled_types` JSON array contains the exact event ID. Adding the type to the
shared catalog does not mutate existing rows, so existing notification services remain opted out.

### Config-Health Snapshot Contract

The observable source is already persisted:

- `packages/praxrr-app/src/lib/server/jobs/handlers/configHealthSnapshot.ts` computes and inserts one
  report per eligible instance.
- `packages/praxrr-app/src/lib/server/db/queries/configHealthSnapshots.ts` stores instance identity,
  engine version, overall score/band, criterion results, profile scores, and generation time.
- `packages/praxrr-app/src/lib/shared/health/types.ts` defines `HealthReport`, `CriterionResult`, and
  the closed `HealthBand` union.
- `packages/praxrr-app/src/lib/shared/health/policy.ts` defines current band thresholds: `healthy` at
  85+, `attention` at 60–84, and `needs-review` below 60; `unknown` means no enabled criterion was
  measurable.

The snapshot table is the correct comparison source because it satisfies issue #223's requirement
to derive alerts from observable persisted results. Notification history is unsuitable for deciding
whether health degraded: it is transport-scoped, has one row per service, and records attempted
delivery rather than the health state itself.

## Libraries and SDKs

### Recommended: No New Dependency

Praxrr already has everything required:

- Native Deno `fetch`, wrapped by
  `packages/praxrr-app/src/lib/server/utils/http/client.ts`.
- `WebhookClient` in
  `packages/praxrr-app/src/lib/server/notifications/base/webhookClient.ts`, configured with a
  10-second timeout and zero retries.
- The repository's `DiscordEmbed` and `EmbedBuilder` types in
  `packages/praxrr-app/src/lib/server/notifications/notifiers/discord/embed.ts`.
- SQLite persistence through the existing config-health snapshot queries.
- Existing Deno tests using `@std/assert`.

A Discord SDK would add an unnecessary bot/application abstraction. Incoming webhooks are a single
HTTP POST and require neither a Gateway connection nor a bot token. A generic webhook/event SDK would
also duplicate the filtering, fan-out, history, and failure isolation already implemented by
`NotificationManager`.

### Existing Library Constraints

`WebhookClient` intentionally performs no retries. That is consistent with the current best-effort
notification contract, but Discord's official rate-limit guidance says clients should use returned
rate-limit headers and `Retry-After` rather than hard-code limits. The existing fixed one-second pause
only spaces multi-embed notifications; it does not parse rate-limit buckets or retry a 429.

Issue #223 should not introduce a health-specific retry stack. Keeping the event to one embed and
deduplicating before dispatch minimizes traffic while preserving the current transport contract. A
general rate-limit-aware webhook client would be a separate notification-infrastructure change.

## Integration Patterns

### 1. Compare Before Insert, Then Persist the Evidence

For each scored instance, read the newest prior snapshot, evaluate a pure degradation predicate,
insert the new report, and only then schedule a best-effort notification. The evidence referenced by
the alert is therefore durable before any webhook call begins.

Comparison rules should include:

1. Both snapshots belong to the same `arr_instance_id`.
2. Both have measurable bands; `unknown` never causes a degradation event.
3. Both use the same `engine_version`; a scoring-policy upgrade is not evidence that the user's
   configuration degraded.
4. A lower-ranked band is meaningful degradation.
5. A same-band score decrease is eligible only if the product defines a minimum meaningful delta;
   tiny score movement should not create alert noise.
6. Improving or unchanged results clear or preserve episode state as defined by the dedupe model,
   but never emit `health.degraded`.

The health snapshot handler already isolates each instance in `snapshotInstance()` and logs without
throwing, matching the required delivery-failure isolation.

### 2. Domain-Level Episode Deduplication

Use the established drift pattern as the closest repository analogue:

- `packages/praxrr-app/src/lib/server/sync/drift/persist.ts` computes a stable drift signature and
  calls `shouldNotify()`.
- `packages/praxrr-app/src/lib/server/db/queries/driftStatus.ts` persists
  `notified_signature` and clears it only after genuine recovery.

For health, the dedupe key should be instance-scoped and based on the degradation evidence, not a
Discord message ID or notification-history row. A suitable signature input is a versioned canonical
tuple such as:

```text
health-degraded:v1 | instanceId | engineVersion | previousBand | currentBand |
previousScore | currentScore | sortedDegradedCriterionIds
```

The exact persistence shape can be either a dedicated latest-state row/columns or explicit snapshot
metadata. It must survive process restarts and concurrent scheduled chunks; an in-memory `Set` is not
sufficient.

The episode model should distinguish:

- repeated identical degraded snapshots — suppress;
- continued worsening with new evidence — potentially emit once for the new degradation;
- improvement without full recovery — do not emit;
- measurable recovery followed by a later regression — emit again;
- transient `unknown` — do not emit and do not manufacture a recovery/regression cycle.

### 3. Reuse the Generic + Discord-Specific Builder Pattern

The canary helper in `packages/praxrr-app/src/lib/server/sync/canary/notify.ts` is the best compact
payload precedent. The drift payload in
`packages/praxrr-app/src/lib/server/sync/drift/persist.ts` is the closest warning/dedup precedent.

Recommended health embed content:

- Author: Arr icon plus instance name.
- Title: non-judgmental statement such as `Configuration health changed on <instance>`.
- Fields: app, previous score/band, current score/band.
- Detail: at most 3–5 criteria whose score/contribution worsened, with short actionable context.
- Details path: `/config-health/<instanceId>`.
- Color: `Colors.WARNING`.
- Timestamp: the new report's `generatedAt` when possible, rather than notification-send time.
- Footer: stable domain label such as `Praxrr Config Health`.

Always include `.generic(title, message)`. `NotificationManager` uses generic content for history,
and future transports will need a transport-neutral message even though Discord consumes the embed.

### 4. Fire-and-Forget at the Snapshot Boundary

Follow the canary/drift call-site pattern:

```typescript
void buildHealthDegradedNotification(event)
  .send()
  .catch(() => {
    /* delivery remains best-effort */
  });
```

Do not await transport success as part of the snapshot job's result. `NotificationManager.notify()`
already catches manager-level errors, uses `Promise.allSettled` for service fan-out, and writes
success/failure history per service.

## Constraints and Gotchas

### Delivery Success Is Not End-to-End Confirmation

Praxrr posts the configured webhook URL as supplied. Discord's Execute Webhook `wait` query parameter
defaults to `false`; Discord documents that with `wait=false`, a message that is not saved may not
return an error. Therefore, the current `notification_history.status = 'success'` means the notifier
request completed without an observed HTTP error, not that a Discord message was durably confirmed.

Additionally, `NotificationManager.notify()` catches failures and resolves after
`Promise.allSettled`. A caller's `.then()` is not proof that every service delivered successfully.
Health deduplication should consequently represent “event emitted/attempted,” not depend on claimed
Discord delivery. If confirmed delivery is ever required, adding `wait=true` and returning structured
per-service results would be a broader manager contract change.

### Rate Limits and Retries

Discord says rate limits are dynamic and clients should honor `X-RateLimit-*` and `Retry-After`.
Praxrr currently uses zero retries and does not specially handle 429 responses. Do not add multiple
health embeds or per-criterion messages. One event should map to one webhook request per opted-in
service.

### Mention Behavior

`DiscordNotifier` currently sets `content: '@here'` when `enable_mentions` is true but does not send
`allowed_mentions`. Discord's current documentation states that incoming webhooks parse only user
mentions by default; `@here`/`@everyone` require the `everyone` allowed-mention type and appropriate
permission. The health feature should not assume `enable_mentions` guarantees a ping. Correcting the
shared mention payload is transport-wide work, not something to special-case in `health.degraded`.

Criterion and instance text should remain in embed fields/descriptions rather than webhook `content`.
This also avoids treating user-controlled names as mention syntax.

### Payload Bounds

The shared `EmbedBuilder` does not enforce Discord limits. Existing upgrade/rename definitions do
their own truncation, while the compact drift/canary definitions bound list lengths. Health must do
the same:

- cap criterion lines;
- truncate or summarize long detail/suggestion strings;
- keep field names and values within Discord limits;
- avoid one field per profile or criterion when a short summary suffices.

### Engine Versions and Unknown Bands

`CONFIG_HEALTH_ENGINE_VERSION` changes when criteria, thresholds, or rollup math change. Comparing
scores across versions can generate a false regression with no configuration change. Treat a version
change as a new baseline unless a future migration explicitly defines cross-version comparability.

Likewise, `unknown` means no enabled criterion was scored. It is not worse than `needs-review`; it is
unmeasurable and must neither trigger nor reset degradation dedupe state.

### Opt-In Semantics

The catalog entry alone is sufficient to expose the checkbox. Create/edit actions dynamically accept
only IDs returned by `getAllNotificationTypeIds()`. Existing service rows will not contain the new ID,
which preserves opt-in behavior. Do not backfill `health.degraded` into existing `enabled_types`
arrays, and do not silently enable it for newly created services.

### Secrets and URLs

A Discord webhook URL contains a token and can execute without separate authentication. Never include
it in logs, notification payloads, test fixtures, or research examples. The edit route already removes
`webhook_url` from loaded page data. Issue #223 should reuse the stored service configuration without
introducing any new webhook URL surface.

## Code Examples

### Pure Degradation Predicate

Illustrative only; the score-delta threshold remains a product decision:

```typescript
const BAND_RANK: Record<Exclude<HealthBand, 'unknown'>, number> = {
  'needs-review': 0,
  attention: 1,
  healthy: 2,
};

function isMeaningfulDegradation(
  previous: ConfigHealthSnapshotDetail,
  current: HealthReport,
  minimumScoreDrop: number
): boolean {
  if (previous.engineVersion !== current.engineVersion) return false;
  if (previous.band === 'unknown' || current.overall.band === 'unknown')
    return false;

  const bandDropped =
    BAND_RANK[current.overall.band] < BAND_RANK[previous.band];
  const scoreDroppedEnough =
    previous.overallScore - current.overall.score >= minimumScoreDrop;

  return bandDropped || scoreDroppedEnough;
}
```

### Compact Notification Definition

```typescript
function healthDegraded(event: HealthDegradedEvent) {
  const title = `Configuration health changed on ${event.instanceName}`;
  const message =
    `${event.previousBand} ${event.previousScore} → ` +
    `${event.currentBand} ${event.currentScore}`;

  const embed = createEmbed()
    .author(`${getInstanceIcon(event.arrType)} ${event.instanceName}`)
    .title(title)
    .field('Previous', `${event.previousScore} · ${event.previousBand}`, true)
    .field('Current', `${event.currentScore} · ${event.currentBand}`, true)
    .field('App', event.arrType, true)
    .lines(event.criterionLines.slice(0, 5))
    .field('Details', `/config-health/${event.instanceId}`, false)
    .color(Colors.WARNING)
    .timestamp(new Date(event.generatedAt))
    .footer('Praxrr Config Health');

  return notify(NotificationTypes.HEALTH_DEGRADED)
    .generic(title, message)
    .discord((discord) => discord.embed(embed));
}
```

### Snapshot-Oriented Call Site

```typescript
const previous = configHealthSnapshotsQueries.getLatest(report.instanceId);
const snapshotId = configHealthSnapshotsQueries.insert(report);

const event = deriveHealthDegradation(previous, report);
if (event && healthDegradationStateQueries.claim(event.signature, snapshotId)) {
  void healthDegraded(event)
    .send()
    .catch(() => {});
}
```

`claim()` should be an atomic database operation so concurrent/manual runs cannot emit the same
episode twice. The snapshot insert remains independent of webhook delivery.

## Open Questions

1. What same-band score drop is “meaningful”: a fixed point delta, a percentage, or band changes
   only for the first release? This must be explicit and tested to avoid noise.
2. Does additional worsening within one degraded episode emit again, and if so, what constitutes new
   evidence: a lower band, another threshold-sized score drop, or a changed criterion signature?
3. What counts as recovery for re-arming an identical future regression: any measurable improvement,
   returning to the previous band/score, or returning to `healthy`?
4. Where should the durable dedupe marker live: additional snapshot metadata, a per-instance latest
   health state table, or a dedicated notification-state table? It must remain instance-scoped and
   atomic under concurrent sweep batches.
5. Should criterion context use contribution deltas, criterion score deltas, or the new report's
   highest-severity suggestions? Contribution deltas are sensitive to weight redistribution when
   another criterion becomes unmeasurable.
6. Should a notification use a fully qualified URL derived from the configured server URL? Existing
   notifications use relative paths, which are informative in Discord but may not be clickable.
7. Is transport confirmation intentionally best-effort, or should notification infrastructure later
   append `wait=true` and expose per-service delivery results? This is not required to satisfy issue
   #223, but it affects how operators interpret notification history.
8. Should the shared Discord notifier explicitly set `allowed_mentions` when `enable_mentions` is
   enabled? Current Discord defaults mean the existing `@here` content may not ping; any correction
   should apply to all notification types consistently.
