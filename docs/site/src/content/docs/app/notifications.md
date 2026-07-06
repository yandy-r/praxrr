---
title: Notifications
description: NotificationManager fire-and-forget delivery, database-backed service config, Notifier plugin pattern, and Discord webhook integration.
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
