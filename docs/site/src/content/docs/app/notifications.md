---
title: Notifications
description: NotificationManager best-effort delivery, database-backed service config, Config Health events, the Notifier plugin pattern, and Discord webhook integration.
---

Praxrr sends operational alerts (upgrades, renames, tests) through a pluggable
**notification manager**. Delivery is **fire-and-forget**: failures are logged and
recorded in history but never thrown to callers.

## NotificationManager

`NotificationManager.notify()` in `notifications/NotificationManager.ts`:

1. Loads all enabled services from `notification_services`
2. Filters services whose `enabled_types` JSON includes the notification `type`
3. Creates the appropriate `Notifier` implementation per `service_type`
4. Sends in parallel via `Promise.allSettled`
5. Records success/failure in `notification_history`

Callers (upgrade/rename processors, test routes) invoke the singleton
`notificationManager` without awaiting delivery guarantees.

## Service Configuration

Notification services are stored in the app database:

| Column          | Purpose                                 |
| --------------- | --------------------------------------- |
| `service_type`  | Plugin key (`discord` today)            |
| `config`        | JSON blob parsed per notifier           |
| `enabled_types` | JSON array of notification type strings |
| `enabled`       | Master toggle                           |

UI settings pages write these rows; the manager reads them at send time.

## Config Health Decreased

`health.degraded` is an explicitly opted-in event. A notification service receives it only when the
service is enabled and **Config Health Decreased** is selected for that service. Enabling the event
does not replay older snapshot pairs.

The Config Health snapshot job evaluates the event after persisting a snapshot. It compares only the
adjacent, same-instance persisted snapshots when their health engine and scoring basis are
comparable. A transition to a worse health band qualifies regardless of the point change; within the
same band, the score must fall by at least five points. Smaller changes do not accumulate across
snapshots.

Before delivery, Praxrr atomically claims a signature for the current degraded state. This makes the
send attempt at most once for that state, including overlapping job work and process restarts. A
comparable recovery to a better band, or a same-band gain of at least five points, silently clears
the claim so a later degradation can notify again. Uncertain or incomparable snapshots neither
notify nor re-arm the event.

The notification includes previous and current score/band evidence, the Arr app and instance,
bounded contributor context, the snapshot time, and the instance detail path
`/config-health/{instanceId}`. Delivery is best effort: rendering, manager, provider, and history
failures are isolated from snapshot persistence and job success. A failure after the state is claimed
is not replayed for that same state.

## Notifier Plugin Pattern

All notifiers implement `Notifier`:

```typescript
interface Notifier {
  notify(notification: Notification): Promise<void>;
  getName(): string;
}
```

`createNotifier()` switches on `service_type`:

| Type      | Implementation                                              |
| --------- | ----------------------------------------------------------- |
| `discord` | `DiscordNotifier` — webhook embeds via `notifiers/discord/` |

Future services (Slack, email) would add cases here without changing callers.

## Notification Definitions

Typed payloads live under `notifications/definitions/` (upgrade, rename, test). The
`builder.ts` module assembles generic title/message fields for history recording.

## Example Webhook Config

Discord webhook URLs in documentation use placeholder hosts — never real secrets:

```json
{
  "webhookUrl": "https://hooks.example.com/services/REDACTED/REDACTED"
}
```

Store production webhook URLs only in the encrypted app database via settings UI.

## Source References

- `packages/praxrr-app/src/lib/server/notifications/NotificationManager.ts`
- `packages/praxrr-app/src/lib/server/notifications/base/Notifier.ts`
- `packages/praxrr-app/src/lib/server/notifications/notifiers/discord/`
- `packages/praxrr-app/src/lib/server/notifications/definitions/`

## Related

- [Architecture Overview](/app/architecture/) — `$notifications/` alias
- [Job System](/app/jobs/) — upgrade/rename jobs may emit notifications
- [Development Setup](/app/development/) — local testing without webhooks
- [Configuration Guide](/guides/configuration/) — user-facing notification settings
