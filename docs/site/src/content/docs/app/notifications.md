---
title: Notifications
description: Notification providers (Discord, webhook, ntfy, Gotify, Pushover, Telegram, Slack, Apprise), the versioned webhook payload and HMAC signature, retry policy, secret handling, and the provider registry.
---

Praxrr sends operational alerts (sync results, drift, upgrades, renames, Config
Health, tests) through a single **notification manager**. Every event follows
one path: emitter → `notificationManager.notify()` → provider registry →
notifier. Delivery is **best effort**: failures are retried when transient,
recorded in history, and never thrown to callers.

## Providers

Add a service under **Settings → Notifications → Add Service**. Each service
has a provider type (fixed after creation), a name, provider settings, and the
event types it subscribes to.

| Provider | Delivers to                                   | Secret fields                      |
| -------- | --------------------------------------------- | ---------------------------------- |
| Discord  | Channel incoming webhook (rich embeds)        | Webhook URL                        |
| Webhook  | Any HTTP endpoint, versioned JSON payload     | URL, signing secret, header values |
| ntfy     | ntfy.sh or a self-hosted ntfy server          | Access token, password             |
| Gotify   | Self-hosted Gotify server                     | Application token                  |
| Pushover | Pushover devices                              | API token, user key                |
| Telegram | Bot message to a chat, group, or channel      | Bot token                          |
| Slack    | Slack (or Mattermost) incoming webhook        | Webhook URL                        |
| Apprise  | Any target supported by an Apprise API server | Apprise URLs                       |

### Provider settings

**Discord**

- `Webhook URL` (required): channel settings → Integrations → Webhooks → New
  Webhook → Copy Webhook URL.
- `Username`, `Avatar URL` (optional): override the webhook identity.
- `Mention @here` (optional): prefix the first message with `@here`.

**Webhook**

- `URL` (required): `http` or `https` endpoint that receives the JSON payload.
  Treated as a secret because URLs often embed tokens.
- `Signing secret` (optional): enables HMAC signing (see below).
- `Custom headers` (optional): one `Name: value` per line, up to 20.

**ntfy**

- `Server URL`: defaults to `https://ntfy.sh`.
- `Topic` (required): 1–64 letters, digits, `-` or `_`.
- `Access token` (optional): sent as `Authorization: Bearer …`; takes
  precedence over username/password.
- `Username` + `Password` (optional): Basic auth for protected topics.

Severity maps to ntfy priority (error → 4, otherwise 3) and a tag emoji.

**Gotify**

- `Server URL` (required): base URL of the Gotify server.
- `Application token` (required): Apps → Create Application → copy the token.

Severity maps to Gotify priority (error → 8, warning → 5, otherwise 2).

**Pushover**

- `API token` (required): 30-character application token from
  <https://pushover.net/apps/build>.
- `User key` (required): 30-character user or group key.
- `Device` (optional): comma-separated device names; blank targets all devices.

Titles are truncated to 250 characters and messages to 1024. Errors are sent
with priority 1.

**Telegram**

- `Bot token` (required): from `@BotFather` (`/newbot`).
- `Chat ID` (required): numeric ID (groups and channels are negative) or
  `@channelname`. Add the bot to the chat first.
- `Topic (thread) ID` (optional): forum topic for groups with topics enabled.
- `Send silently` (optional): deliver without a notification sound.

Messages are plain text (`title`, blank line, `message`), at most 4096
characters.

**Slack**

- `Webhook URL` (required): a Slack app incoming webhook. Mattermost incoming
  webhooks accept the same payload.

**Apprise**

- `Apprise API URL` (required): base URL of the Apprise API server.
- Exactly one of `Configuration key` (stateful, uses a configuration stored on
  the Apprise server) or `Apprise URLs` (stateless, one per line or
  comma-separated).
- `Tags` (optional, stateful mode): only notify stored URLs with these tags.

### Outbound URL safety

User-supplied server and webhook URLs are checked with
`assertSafeOutboundUrl` both when the service is saved and when a notification
is sent. Cloud metadata and link-local addresses are rejected; LAN hosts are
allowed because ntfy, Gotify and Apprise are commonly self-hosted. Redirects
are never followed.

## Webhook payload (v1)

The webhook provider POSTs `Content-Type: application/json` with this exact
shape. The schema is published as `NotificationWebhookPayload` in the OpenAPI
document under the top-level `webhooks.notification` entry and has
`additionalProperties: false`.

```json
{
  "version": 1,
  "id": "3f6c2b1e-8a4d-4c1f-9b7e-2d5a6f0c9e14",
  "type": "sync.failed",
  "severity": "error",
  "title": "Sync failed",
  "message": "Quality profiles could not be synced to Radarr 4K.",
  "instanceId": 3,
  "instanceName": "Radarr 4K",
  "arrType": "radarr",
  "occurredAt": "2026-10-20T16:00:00.000Z"
}
```

| Field                                   | Notes                                                            |
| --------------------------------------- | ---------------------------------------------------------------- |
| `version`                               | Always `1`. Breaking changes bump this number.                   |
| `id`                                    | UUID per delivery; stable across retries, use it to deduplicate. |
| `type`                                  | Notification event type, e.g. `sync.failed`.                     |
| `severity`                              | `info`, `success`, `warning` or `error`.                         |
| `title`, `message`                      | Plain text.                                                      |
| `instanceId`, `instanceName`, `arrType` | `null` when the event is not tied to an Arr instance.            |
| `occurredAt`                            | ISO 8601 timestamp of the event.                                 |

### Signature verification

When a signing secret is set, each request carries:

- `X-Praxrr-Timestamp`: Unix time in seconds.
- `X-Praxrr-Signature`: `sha256=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>`.

Verify against the **raw** request body (before JSON parsing), compare in
constant time, and reject stale timestamps to block replays. Works in Node 20+
and Deno:

```ts
const MAX_SKEW_SECONDS = 300;

async function verifyPraxrrSignature(
  request: Request,
  secret: string
): Promise<string> {
  const timestamp = request.headers.get('x-praxrr-timestamp') ?? '';
  const signature = request.headers.get('x-praxrr-signature') ?? '';
  const body = await request.text();

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !Number.isFinite(age) || age > MAX_SKEW_SECONDS) {
    throw new Error('Stale or missing timestamp');
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const hex = signature.startsWith('sha256=') ? signature.slice(7) : '';
  const bytes = new Uint8Array(
    hex.match(/.{2}/g)?.map((pair) => parseInt(pair, 16)) ?? []
  );
  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    bytes,
    encoder.encode(`${timestamp}.${body}`)
  );
  if (!valid) throw new Error('Invalid signature');

  return body; // safe to JSON.parse now
}
```

### Custom headers

- One `Name: value` per line; blank lines are ignored; at most 20 headers.
- Names must be RFC 7230 tokens.
- `Content-Type`, `Content-Length`, `Host` and any `X-Praxrr-*` header are
  reserved and rejected.
- Values must be non-empty and cannot contain CR, LF or NUL.
- Header values are secrets: they are never returned to the browser, logged,
  or written to history. Validation errors name the line or header, never the
  value.

## Delivery and retries

Each HTTP request a notifier makes goes through a shared `postJson` helper:

- Up to **3 attempts** per request (`MAX_ATTEMPTS`).
- Only transient failures are retried: network errors, `408`, `429` and `5xx`.
  Other `4xx` responses fail immediately.
- Backoff is exponential from 1 s (1 s, then 2 s).
- Any retried response honors `Retry-After` (seconds or HTTP date; Telegram's
  `parameters.retry_after` too) in place of the backoff delay. A wait over
  **60 s** stops retrying and fails the delivery instead of parking it.
- Retries happen per request, not per notification, so a Discord message split
  across several embeds never re-sends chunks that already arrived.

History records one row per service per notification, with `attempts` set to
the highest attempt number any request reached (1 means first-try success).

### History and Resend

**Settings → Notifications → Recent Notifications** shows status, attempts, and
time. Hover a **Failed** badge to see the (masked) error. Failed rows have a
**Resend** button that re-delivers the recorded title, message, severity and
instance context to the same service and records a new history row. Resend
fails if the service was deleted.

### Test action

The **Send test notification** button delivers a test message to that service
regardless of its enabled toggle and subscribed event types. It makes a single
attempt (no retries) so feedback is fast, does not write history, and shows the
masked provider error when it fails.

## Secret handling

- Fields marked secret (webhook URLs, tokens, passwords, keys, signing secrets,
  Apprise URLs, custom header values) are stripped before the edit page loads;
  the browser only learns which secrets are set.
- On edit, a secret field left blank keeps the stored value. Typing a new value
  replaces it.
- Optional secrets that hold a saved value (for example the webhook signing
  secret, custom headers, the ntfy access token or password, and Apprise URLs)
  show a **Remove saved value** checkbox on edit. Checking it with the field
  left blank deletes the stored value; this is how you drop ntfy basic auth
  (remove the password and clear the username) or switch Apprise from
  stateless URLs to a stateful configuration key. Required secrets cannot be
  removed, only replaced.
- Error text is masked with every secret value of the service (raw and
  URL-encoded forms, plus the normalized form of URL secrets, replaced with
  `***`) before it is logged, recorded in history, or returned to the UI. This
  matters for providers that put tokens in URLs, such as Telegram and Discord.
- Configs are stored as JSON in the app database. Encryption at rest is tracked
  separately (YAN-546).

Use placeholder values in docs and issues, never real webhook URLs:

```json
{
  "webhook_url": "https://hooks.example.com/services/REDACTED/REDACTED"
}
```

## Service storage

Notification services are rows in `notification_services`:

| Column          | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `service_type`  | Provider type (`discord`, `webhook`, `ntfy`, …) |
| `config`        | Provider config JSON, validated by the provider |
| `enabled_types` | JSON array of subscribed notification types     |
| `enabled`       | Master toggle                                   |

`notification_history` stores `status`, masked `error`, `attempts`, and
`metadata` (`severity` and instance `context`) for every recorded delivery.

## Config Health Decreased

`health.degraded` is an explicitly opted-in event. A notification service
receives it only when the service is enabled and **Config Health Decreased** is
selected for that service. Enabling the event does not replay older snapshot
pairs.

The Config Health snapshot job evaluates the event after persisting a snapshot.
It compares only the adjacent, same-instance persisted snapshots when their
health engine and scoring basis are comparable. A transition to a worse health
band qualifies regardless of the point change; within the same band, the score
must fall by at least five points. Smaller changes do not accumulate across
snapshots.

Before delivery, Praxrr atomically claims a signature for the current degraded
state. This makes the send attempt at most once for that state, including
overlapping job work and process restarts. A comparable recovery to a better
band, or a same-band gain of at least five points, silently writes a newer
re-arm tombstone so a later degradation can notify again without allowing
older overlapping snapshot work to restore stale state. Uncertain or
incomparable snapshots neither notify nor re-arm the event.

The notification includes previous and current score/band evidence, the Arr app
and instance, bounded contributor context, the snapshot time, and the instance
detail path `/config-health/{instanceId}`. Delivery is best effort: rendering,
manager, provider, and history failures are isolated from snapshot persistence
and job success. A failure after the state is claimed is not replayed for that
same state.

## Provider registry (contributors)

Providers are plugged in through `notifications/registry.ts`; there are no
per-provider `switch` statements in the manager, routes or processors.

Adding a provider takes three pieces:

1. **Descriptor** in `$shared/notifications/providers.ts` (client-safe): add the
   type to `NotificationProviderType` and a `ProviderDescriptor` with its label,
   description and `fields` (`text`, `url`, `password`, `textarea`, `checkbox`,
   `number`; mark secrets with `secret: true`). The settings form renders from
   this descriptor, so no new Svelte component is needed.
2. **Notifier** in `notifiers/<name>/<Name>Notifier.ts` implementing:

   ```ts
   interface Notifier {
     notify(
       notification: Notification,
       options?: DeliveryOptions
     ): Promise<DeliveryResult>;
     getName(): string;
   }
   ```

   Send through `postJson` from `base/delivery.ts` so retries, `Retry-After`
   handling and secret masking apply. Throw `NotificationDeliveryError` on
   failure. Use `renderText`, `resolveSeverity` and `truncate` from
   `content.ts` for provider-neutral content.

3. **Provider definition** in `notifiers/<name>/provider.ts`, registered in
   the registry:

   ```ts
   interface ProviderDefinition<C> {
     type: NotificationProviderType;
     validate(input: ProviderFormInput): ParseResult<C>;
     create(config: C): Notifier;
     secretValues(config: C): string[];
   }
   ```

   `validate` receives form input already merged with kept secrets and must
   fail fast with a message that never echoes secret values. `secretValues`
   must return every secret string, including tokens embedded in URLs.

The routes use `parseProviderForm(type, formData, existingConfig?)` to validate
saves and `toClientConfig(type, config)` to strip secrets for the edit page.
Provider wire formats are covered by `tests/notifications/providers.test.ts`,
and the webhook payload by a contract test against the OpenAPI schema.

## Source References

- `packages/praxrr-app/src/lib/server/notifications/NotificationManager.ts`
- `packages/praxrr-app/src/lib/server/notifications/registry.ts`
- `packages/praxrr-app/src/lib/server/notifications/base/delivery.ts`
- `packages/praxrr-app/src/lib/server/notifications/notifiers/`
- `packages/praxrr-app/src/lib/shared/notifications/providers.ts`
- `packages/praxrr-app/src/routes/settings/notifications/`
- `docs/api/v1/schemas/notifications.yaml`

## Related

- [Architecture Overview](/app/architecture/) — `$notifications/` alias
- [Job System](/app/jobs/) — upgrade/rename jobs may emit notifications
- [Development Setup](/app/development/) — local testing without webhooks
- [Configuration Guide](/guides/configuration/) — user-facing notification
  settings
